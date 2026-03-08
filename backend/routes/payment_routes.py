"""
payment_routes.py — Routes de gestion des paiements SpotU
==========================================================
Utilise le SDK Stripe natif (stripe>=14) avec capture_method=manual.

Webhook /api/webhook/stripe :
  Endpoint unifié qui délègue TOUTE la logique événementielle
  à webhook_handlers.dispatch() — couche centralisée avec idempotence.
  Les handlers de paiements et d'abonnements sont dans webhook_handlers.py.
"""

import asyncio
import json
import logging
import os

import stripe
from fastapi import APIRouter, Request, HTTPException
from auth_utils import require_auth, require_role
from database import get_pool, row_to_dict, rows_to_list
from models import new_id
import stripe_service
import webhook_handlers

log = logging.getLogger("routes.payments")
router = APIRouter()

STRIPE_API_KEY        = os.environ.get("STRIPE_API_KEY", "")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")


def _deserialize(d: dict) -> dict:
    """Désérialise pricing_rule_snapshot si c'est une string."""
    if d.get("pricing_rule_snapshot") and isinstance(d["pricing_rule_snapshot"], str):
        d["pricing_rule_snapshot"] = json.loads(d["pricing_rule_snapshot"])
    return d


# ── Lecture utilisateur ────────────────────────────────────────────────────────

@router.get("/payments/me")
async def my_payments(request: Request):
    """Paiements émis OU reçus par l'utilisateur connecté."""
    pool = get_pool()
    user = await require_auth(request, pool)
    uid = user["user_id"]
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT p.*,
                u_pay.name AS payer_name,
                u_recv.name AS receiver_name
               FROM payments p
               LEFT JOIN users u_pay  ON u_pay.user_id  = p.payer_user_id
               LEFT JOIN users u_recv ON u_recv.user_id = p.receiver_user_id
               WHERE p.payer_user_id = $1 OR p.receiver_user_id = $1
               ORDER BY p.created_at DESC""",
            uid,
        )
    return [_deserialize(row_to_dict(r)) for r in rows]


@router.get("/payments/{payment_id}")
async def get_payment(payment_id: str, request: Request):
    """Détail d'un paiement — accessible par le payeur, le bénéficiaire ou un admin."""
    pool = get_pool()
    user = await require_auth(request, pool)
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM payments WHERE payment_id = $1", payment_id
        )
    if not row:
        raise HTTPException(status_code=404, detail="Payment not found")
    d = row_to_dict(row)
    if (
        d["payer_user_id"] != user["user_id"]
        and d["receiver_user_id"] != user["user_id"]
        and user.get("role") != "admin"
    ):
        raise HTTPException(status_code=403, detail="Access denied")
    return _deserialize(d)


# ── Stripe Checkout Session (capture manuelle) ────────────────────────────────

@router.post("/payments/checkout/session")
async def create_checkout_session(request: Request):
    """
    Crée une Checkout Session Stripe avec capture_method=manual.

    Body: { booking_id: str, origin_url: str }

    - Le PaymentIntent est en requires_capture après le checkout.
    - La capture est déclenchée par POST /bookings/{id}/accept.
    - L'annulation est déclenchée par refuse / cancel / expiry_worker.
    """
    pool = get_pool()
    user = await require_auth(request, pool)
    body = await request.json()
    booking_id = body.get("booking_id")
    origin_url = body.get("origin_url", "").rstrip("/")

    if not booking_id:
        raise HTTPException(status_code=400, detail="booking_id requis")

    async with pool.acquire() as conn:
        pay_row = await conn.fetchrow(
            """SELECT p.*, b.service_id FROM payments p
               LEFT JOIN bookings b ON b.booking_id = p.booking_id
               WHERE p.booking_id = $1 AND p.payer_user_id = $2""",
            booking_id, user["user_id"],
        )
        if not pay_row:
            raise HTTPException(status_code=404, detail="Paiement non trouvé")

    payment = row_to_dict(pay_row)

    # Paiement déjà capturé — ne pas recréer
    if payment.get("status") == "captured":
        raise HTTPException(status_code=400, detail="Ce paiement est déjà complété")

    # Session existante encore ouverte → réutiliser
    if payment.get("stripe_checkout_session_id"):
        try:
            existing = await stripe_service.retrieve_checkout_session(
                payment["stripe_checkout_session_id"]
            )
            if existing.status == "open":
                log.info("Réutilisation session Checkout ouverte : %s", existing.id)
                return {"url": existing.url, "session_id": existing.id}
        except Exception as exc:
            log.warning("Impossible de récupérer la session existante : %s", exc)

    # Calcul du montant en centimes (depuis le snapshot — aucun recalcul)
    amount_cents = int(round(float(payment["payer_total_amount"]) * 100))
    currency     = (payment.get("currency") or "EUR").lower()
    payment_id   = payment["payment_id"]

    success_url = (
        f"{origin_url}/payment-success"
        f"?session_id={{CHECKOUT_SESSION_ID}}&booking_id={booking_id}"
    )
    cancel_url = (
        f"{origin_url}/booking/confirm"
        f"?serviceId={payment.get('product_id', '')}"
    )

    meta = {
        "payment_id":    payment_id,
        "booking_id":    booking_id,
        "payer_user_id": user["user_id"],
    }

    session = await stripe_service.create_checkout_session(
        amount_cents=amount_cents,
        currency=currency,
        success_url=success_url,
        cancel_url=cancel_url,
        metadata=meta,
        idempotency_key=payment_id,
    )

    pi_id = session.payment_intent if isinstance(session.payment_intent, str) else None

    async with pool.acquire() as conn:
        await conn.execute(
            """UPDATE payments
               SET stripe_checkout_session_id = $1,
                   stripe_payment_intent_id   = $2,
                   status = CASE
                       WHEN status NOT IN ('authorized','captured') THEN 'authorized'
                       ELSE status
                   END,
                   updated_at = NOW()
               WHERE payment_id = $3""",
            session.id, pi_id, payment_id,
        )

    return {"url": session.url, "session_id": session.id}


@router.get("/payments/checkout/status/{session_id}")
async def get_checkout_status(session_id: str, request: Request):
    """
    Vérifie le statut d'une session Checkout et met à jour la BDD.
    Compatible avec l'ancien polling frontend (session_id = cs_test_...).
    """
    pool = get_pool()
    user = await require_auth(request, pool)

    # Chercher le paiement par session_id OU par payment_intent_id (rétrocompat)
    async with pool.acquire() as conn:
        pay_row = await conn.fetchrow(
            """SELECT * FROM payments
               WHERE stripe_checkout_session_id = $1
                  OR stripe_payment_intent_id   = $1
               LIMIT 1""",
            session_id,
        )
    if not pay_row:
        raise HTTPException(status_code=404, detail="Session de paiement non trouvée")

    payment = row_to_dict(pay_row)
    if payment["payer_user_id"] != user["user_id"] and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Accès refusé")

    # Récupérer la session depuis Stripe (utiliser le session_id réel)
    real_session_id = payment.get("stripe_checkout_session_id") or session_id
    try:
        session = await stripe_service.retrieve_checkout_session(real_session_id)
    except Exception as exc:
        log.warning("Impossible de récupérer la session Stripe %s : %s", real_session_id, exc)
        return {
            "payment_id":         payment["payment_id"],
            "booking_id":         payment.get("booking_id"),
            "session_id":         session_id,
            "status":             "unknown",
            "payment_status":     payment.get("status", "unknown"),
            "amount":             float(payment["payer_total_amount"]),
            "currency":           payment.get("currency", "EUR"),
        }

    # Mapper le statut Stripe → statut interne
    db_status = payment["status"]
    stripe_ps  = session.payment_status  # "paid" | "unpaid" | "no_payment_required"
    s_status   = session.status          # "open" | "complete" | "expired"

    async with pool.acquire() as conn:
        if s_status == "complete" and stripe_ps == "unpaid":
            # capture_method=manual : autorisé, pas encore capturé
            if db_status not in ("authorized", "captured"):
                await conn.execute(
                    "UPDATE payments SET status='authorized', updated_at=NOW() WHERE payment_id=$1",
                    payment["payment_id"],
                )
                db_status = "authorized"

        elif stripe_ps == "paid" and db_status not in ("captured",):
            async with conn.transaction():
                await conn.execute(
                    "UPDATE payments SET status='captured', updated_at=NOW() WHERE payment_id=$1",
                    payment["payment_id"],
                )
                if payment.get("booking_id"):
                    await conn.execute(
                        "UPDATE bookings SET payment_status='paid', updated_at=NOW() WHERE booking_id=$1",
                        payment["booking_id"],
                    )
            db_status = "captured"

        elif s_status == "expired" and db_status == "authorized":
            await conn.execute(
                "UPDATE payments SET status='cancelled', updated_at=NOW() WHERE payment_id=$1",
                payment["payment_id"],
            )
            db_status = "cancelled"

    return {
        "payment_id":     payment["payment_id"],
        "booking_id":     payment.get("booking_id"),
        "session_id":     session_id,
        "status":         s_status,
        "payment_status": stripe_ps,
        "db_payment_status": db_status,
        "amount": (
            session.amount_total / 100
            if session.amount_total
            else float(payment["payer_total_amount"])
        ),
        "currency": session.currency or payment.get("currency", "EUR"),
    }


# ── Webhook Stripe ─────────────────────────────────────────────────────────────

@router.post("/webhook/stripe")
async def stripe_webhook(request: Request):
    """
    Webhook Stripe — point d'entrée unique.

    Délègue TOUTE la logique à webhook_handlers.dispatch() qui assure :
      - Vérification d'idempotence (table stripe_webhook_events)
      - Transitions de statut : payments, bookings, user_subscriptions
      - Gestion de toutes les erreurs (log sans reraise → 200 forcé pour Stripe)

    Événements supportés (voir webhook_handlers.py pour la liste complète) :
      Paiements    : checkout.session.completed, payment_intent.*
      Remboursements : charge.refunded, refund.updated
      Abonnements  : customer.subscription.*, invoice.paid, invoice.payment_failed
    """
    pool       = get_pool()
    body_bytes = await request.body()
    sig        = request.headers.get("Stripe-Signature", "")

    # ── 1. Vérification signature Stripe ──────────────────────────────────────
    if STRIPE_WEBHOOK_SECRET:
        try:
            event = stripe_service.parse_webhook_event(body_bytes, sig)
        except stripe.error.SignatureVerificationError as exc:
            log.warning("Signature webhook invalide : %s", exc)
            raise HTTPException(status_code=400, detail=f"Signature invalide : {exc}")
    else:
        # Mode dev/test sans secret : parse JSON brut
        try:
            event = json.loads(body_bytes)
        except Exception:
            raise HTTPException(status_code=400, detail="Body JSON invalide")

    # ── 2. Extraction event_id / event_type / objet ───────────────────────────
    if isinstance(event, dict):
        event_id   = event.get("id", "")
        event_type = event.get("type", "")
        obj        = event.get("data", {}).get("object", {})
    else:
        event_id   = event.id
        event_type = event.type
        obj        = event.data.object

    if not event_id or not event_type:
        raise HTTPException(status_code=400, detail="event id/type manquant")

    log.info("Webhook reçu : type=%s | id=%s", event_type, event_id)

    # ── 3. Dispatch centralisé ────────────────────────────────────────────────
    return await webhook_handlers.dispatch(pool, event_id, event_type, obj)


# ── Mise à jour champs Stripe (usage interne) ─────────────────────────────────

@router.patch("/payments/{payment_id}/stripe")
async def update_stripe_fields(payment_id: str, request: Request):
    """
    Met à jour les champs Stripe sur un paiement existant.
    En production, sécurisé par signature Stripe webhook.
    """
    pool = get_pool()
    body = await request.json()
    allowed = {
        "stripe_payment_intent_id",
        "stripe_checkout_session_id",
        "stripe_charge_id",
        "stripe_transfer_id",
        "status",
    }
    fields = {k: v for k, v in body.items() if k in allowed}
    if not fields:
        raise HTTPException(status_code=400, detail="No valid fields")

    set_clause = ", ".join(f"{k} = ${i+2}" for i, k in enumerate(fields))
    async with pool.acquire() as conn:
        result = await conn.execute(
            f"UPDATE payments SET {set_clause}, updated_at = NOW() WHERE payment_id = $1",
            payment_id, *fields.values(),
        )
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail="Payment not found")

    if fields.get("status") == "captured":
        async with pool.acquire() as conn:
            await conn.execute(
                """UPDATE bookings SET payment_status = 'paid', updated_at = NOW()
                   WHERE booking_id = (
                       SELECT booking_id FROM payments WHERE payment_id = $1
                   )""",
                payment_id,
            )
    return {"success": True}


# ── Admin ──────────────────────────────────────────────────────────────────────

@router.get("/admin/payments")
async def admin_list_payments(request: Request):
    """Liste tous les paiements — admin uniquement."""
    pool = get_pool()
    await require_role(request, pool, "admin")
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT p.*,
                u_pay.name  AS payer_name,
                u_recv.name AS receiver_name
               FROM payments p
               LEFT JOIN users u_pay  ON u_pay.user_id  = p.payer_user_id
               LEFT JOIN users u_recv ON u_recv.user_id = p.receiver_user_id
               ORDER BY p.created_at DESC
               LIMIT 500"""
        )
    return [_deserialize(row_to_dict(r)) for r in rows]


@router.get("/admin/payments/stats")
async def admin_payment_stats(request: Request):
    """Agrégats financiers depuis les colonnes plates de la table payments."""
    pool = get_pool()
    await require_role(request, pool, "admin")
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """SELECT
                COUNT(*)                            AS total_payments,
                COUNT(*) FILTER (WHERE status='captured')  AS paid_count,
                COUNT(*) FILTER (WHERE status='pending')   AS pending_count,
                COUNT(*) FILTER (WHERE status='failed')    AS failed_count,
                COALESCE(SUM(base_amount)
                    FILTER (WHERE status='captured'), 0)   AS gmv,
                COALESCE(SUM(platform_total_fee)
                    FILTER (WHERE status='captured'), 0)   AS platform_revenue,
                COALESCE(SUM(payer_total_amount)
                    FILTER (WHERE status='captured'), 0)   AS total_charged,
                COALESCE(SUM(receiver_net_amount)
                    FILTER (WHERE status='captured'), 0)   AS total_disbursed
               FROM payments"""
        )
    d = row_to_dict(row)
    return {k: float(v) if isinstance(v, (int, float)) else v for k, v in d.items()}


@router.get("/admin/subscriptions")
async def admin_subscriptions(request: Request):
    """Liste tous les abonnements utilisateurs — admin uniquement."""
    pool = get_pool()
    await require_role(request, pool, "admin")
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT us.*, u.name AS user_name, u.email,
                sp.name AS plan_name, sp.price AS plan_price
               FROM user_subscriptions us
               LEFT JOIN users u              ON u.user_id   = us.user_id
               LEFT JOIN subscription_plans sp ON sp.plan_id = us.plan_id
               ORDER BY us.created_at DESC"""
        )
    return rows_to_list(rows)
