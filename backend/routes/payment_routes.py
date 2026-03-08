"""
payment_routes.py — Routes de gestion des paiements SpotU
==========================================================
Ces routes gèrent le cycle de vie des payments :
- Lecture par user (payeur ou bénéficiaire)
- Création session checkout Stripe + vérification statut
- Webhook Stripe
- Accès admin agrégé
"""

from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse
from auth_utils import require_auth, require_role
from database import get_pool, row_to_dict, rows_to_list
from models import new_id
import os
import json
from emergentintegrations.payments.stripe.checkout import (
    StripeCheckout, CheckoutSessionRequest
)

router = APIRouter()

STRIPE_API_KEY = os.environ.get("STRIPE_API_KEY", "")


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


# ── Stripe Checkout ───────────────────────────────────────────────────────────

@router.post("/payments/checkout/session")
async def create_checkout_session(request: Request):
    """
    Crée une session Stripe Checkout pour un paiement existant (lié à un booking).
    Body: { booking_id: str, origin_url: str }
    """
    pool = get_pool()
    user = await require_auth(request, pool)
    body = await request.json()
    booking_id = body.get("booking_id")
    origin_url = body.get("origin_url", "")

    if not booking_id:
        raise HTTPException(status_code=400, detail="booking_id requis")

    async with pool.acquire() as conn:
        # Charger le paiement lié au booking
        pay_row = await conn.fetchrow(
            """SELECT p.*, b.service_id FROM payments p
               LEFT JOIN bookings b ON b.booking_id = p.booking_id
               WHERE p.booking_id = $1 AND p.payer_user_id = $2""",
            booking_id, user["user_id"]
        )
        if not pay_row:
            raise HTTPException(status_code=404, detail="Paiement non trouvé")

    payment = row_to_dict(pay_row)
    amount = float(payment["payer_total_amount"])
    currency = (payment.get("currency") or "EUR").lower()
    payment_id = payment["payment_id"]

    # Ne pas recréer une session si déjà payé
    if payment.get("status") == "succeeded":
        raise HTTPException(status_code=400, detail="Ce paiement est déjà complété")

    success_url = f"{origin_url}/payment-success?session_id={{CHECKOUT_SESSION_ID}}&booking_id={booking_id}"
    cancel_url  = f"{origin_url}/booking/confirm?serviceId={payment.get('product_id', '')}"

    stripe = StripeCheckout(
        api_key=STRIPE_API_KEY,
        webhook_url=f"{origin_url}/api/webhook/stripe",
    )
    session = await stripe.create_checkout_session(
        CheckoutSessionRequest(
            amount=float(round(amount, 2)),
            currency=currency,
            success_url=success_url,
            cancel_url=cancel_url,
            metadata={
                "payment_id": payment_id,
                "booking_id": booking_id,
                "payer_user_id": user["user_id"],
            },
        )
    )

    # Sauvegarder le session_id Stripe dans la table payments
    # et passer le statut à 'authorized' (session ouverte, paiement en attente)
    async with pool.acquire() as conn:
        await conn.execute(
            """UPDATE payments
               SET stripe_payment_intent_id = $1,
                   status = 'authorized',
                   updated_at = NOW()
               WHERE payment_id = $2""",
            session.session_id, payment_id
        )

    return {"url": session.url, "session_id": session.session_id}


@router.get("/payments/checkout/status/{session_id}")
async def get_checkout_status(session_id: str, request: Request):
    """
    Vérifie le statut d'une session Stripe Checkout et met à jour la BDD.
    """
    pool = get_pool()
    user = await require_auth(request, pool)

    # Retrouver le payment_id depuis la session Stripe stockée
    async with pool.acquire() as conn:
        pay_row = await conn.fetchrow(
            "SELECT * FROM payments WHERE stripe_payment_intent_id = $1",
            session_id
        )
    if not pay_row:
        raise HTTPException(status_code=404, detail="Session de paiement non trouvée")

    payment = row_to_dict(pay_row)
    if payment["payer_user_id"] != user["user_id"] and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Accès refusé")

    stripe = StripeCheckout(
        api_key=STRIPE_API_KEY,
        webhook_url="",
    )
    status_resp = await stripe.get_checkout_status(session_id)

    # Mettre à jour si le paiement est complété et pas encore traité
    if status_resp.payment_status == "paid" and payment["status"] != "succeeded":
        async with pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute(
                    "UPDATE payments SET status = 'succeeded', updated_at = NOW() WHERE payment_id = $1",
                    payment["payment_id"]
                )
                if payment.get("booking_id"):
                    await conn.execute(
                        "UPDATE bookings SET payment_status = 'paid', updated_at = NOW() WHERE booking_id = $1",
                        payment["booking_id"]
                    )
    elif status_resp.status == "expired" and payment["status"] == "pending":
        async with pool.acquire() as conn:
            await conn.execute(
                "UPDATE payments SET status = 'cancelled', updated_at = NOW() WHERE payment_id = $1",
                payment["payment_id"]
            )

    return {
        "payment_id": payment["payment_id"],
        "booking_id": payment.get("booking_id"),
        "session_id": session_id,
        "status": status_resp.status,
        "payment_status": status_resp.payment_status,
        "amount": status_resp.amount_total / 100 if status_resp.amount_total else float(payment["payer_total_amount"]),
        "currency": status_resp.currency or payment.get("currency", "EUR"),
    }


@router.post("/webhook/stripe")
async def stripe_webhook(request: Request):
    """Webhook Stripe — met à jour les paiements et bookings en temps réel."""
    pool = get_pool()
    body_bytes = await request.body()
    signature = request.headers.get("Stripe-Signature", "")

    stripe = StripeCheckout(api_key=STRIPE_API_KEY, webhook_url="")
    try:
        event = await stripe.handle_webhook(body_bytes, signature)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Webhook invalide: {e}")

    metadata = event.metadata or {}
    payment_id = metadata.get("payment_id")

    if not payment_id:
        return {"received": True}

    async with pool.acquire() as conn:
        pay_row = await conn.fetchrow(
            "SELECT * FROM payments WHERE payment_id = $1", payment_id
        )
        if not pay_row:
            return {"received": True}
        payment = row_to_dict(pay_row)

    if event.payment_status == "paid" and payment["status"] != "succeeded":
        async with pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute(
                    "UPDATE payments SET status = 'succeeded', updated_at = NOW() WHERE payment_id = $1",
                    payment_id
                )
                if payment.get("booking_id"):
                    await conn.execute(
                        "UPDATE bookings SET payment_status = 'paid', updated_at = NOW() WHERE booking_id = $1",
                        payment["booking_id"]
                    )

    return {"received": True}


# ── Webhook Stripe (à compléter lors de l'intégration Stripe) ────────────────

@router.patch("/payments/{payment_id}/stripe")
async def update_stripe_fields(payment_id: str, request: Request):
    """
    Met à jour les champs Stripe sur un paiement existant.
    Appelé par le webhook Stripe ou par le backend après confirmation.
    """
    pool = get_pool()
    # Note : en production ce endpoint sera sécurisé par signature Stripe webhook
    body = await request.json()
    allowed = {
        "stripe_payment_intent_id",
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

    # Si le paiement est confirmé, mettre à jour le booking lié
    if fields.get("status") == "succeeded":
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
                COUNT(*) FILTER (WHERE status='succeeded') AS paid_count,
                COUNT(*) FILTER (WHERE status='pending')   AS pending_count,
                COUNT(*) FILTER (WHERE status='failed')    AS failed_count,
                COALESCE(SUM(base_amount)
                    FILTER (WHERE status='succeeded'), 0)  AS gmv,
                COALESCE(SUM(platform_total_fee)
                    FILTER (WHERE status='succeeded'), 0)  AS platform_revenue,
                COALESCE(SUM(payer_total_amount)
                    FILTER (WHERE status='succeeded'), 0)  AS total_charged,
                COALESCE(SUM(receiver_net_amount)
                    FILTER (WHERE status='succeeded'), 0)  AS total_disbursed
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
