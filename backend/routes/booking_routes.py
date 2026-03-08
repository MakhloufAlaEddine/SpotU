"""
booking_routes.py — Workflow de réservation SpotU v2
=====================================================

Machine d'états booking :
  requested → accepted  → completed
           → refused
           → cancelled
           → expired

Machine d'états slot (single uniquement) :
  available → pending → booked → completed
           → available (si refus / annulation avant accepted)
           → available (si annulation après accepted, avant captured)

Machine d'états payment :
  requires_authorization → authorized      → captured
                         → capture_pending → captured
                         → cancelled
  captured → refunded (si annulation post-paiement)
  * → failed

Garanties :
  - Double clic idempotent (idempotency_key + UNIQUE INDEX)
  - 2 users en concurrence : SELECT … FOR UPDATE NOWAIT sur slot_id
  - Transactions atomiques (booking + payment + slot en un seul commit)
  - Aucun calcul de prix en dehors du pricing_engine
"""

from fastapi import APIRouter, Request, HTTPException, Body
from typing import Optional
from models import BookingRequest, BookingCreate, CancelRequest, new_id   # BookingCreate = alias rétrocompat
from auth_utils import require_auth
from database import get_pool, row_to_dict, rows_to_list
from push_service import send_push_to_user
from pricing_engine import pricing_engine
import stripe_service
import asyncio
import asyncpg
import json
import logging
import os
from datetime import timezone, datetime

log = logging.getLogger("routes.bookings")
router = APIRouter()

# TTL configuré dans .env — utilisé pour calculer expires_at à l'INSERT
BOOKING_EXPIRY_HOURS = int(os.environ.get("BOOKING_EXPIRY_HOURS", "48"))
# Délai pour payer immédiatement (pay_now) : 30 minutes
PAY_NOW_CHECKOUT_MINUTES = 30
# Délai minimum pour pay_later si non configuré par le service
DEFAULT_PAY_LATER_MINUTES = 1440  # 24h

# ── Projection commune ─────────────────────────────────────────────────────────
BOOKING_FIELDS = """
    b.booking_id, b.service_id, b.user_id, b.coach_id, b.status,
    b.scheduled_at, b.slot_id, b.location_id, b.notes, b.amount,
    b.payment_status, b.payer_user_id, b.receiver_user_id,
    b.pricing_snapshot, b.idempotency_key, b.currency,
    b.created_at, b.updated_at, b.expires_at,
    b.cancelled_by_user_id, b.cancellation_reason,
    b.payment_mode
"""


def _deserialize(d: dict) -> dict:
    """Désérialise pricing_snapshot si c'est une chaîne JSON."""
    if d and isinstance(d.get("pricing_snapshot"), str):
        try:
            d["pricing_snapshot"] = json.loads(d["pricing_snapshot"])
        except Exception:
            pass
    return d


# ── Helper : lire booking complet ─────────────────────────────────────────────
async def _fetch_booking(conn, booking_id: str) -> dict:
    row = await conn.fetchrow(
        f"""SELECT {BOOKING_FIELDS},
                s.title AS service_title, s.address
            FROM bookings b
            LEFT JOIN services s ON s.service_id = b.service_id
            WHERE b.booking_id = $1""",
        booking_id,
    )
    return _deserialize(row_to_dict(row)) if row else None


# ── Helper : push asynchrone ───────────────────────────────────────────────────
def _push(pool, user_id, title, body, data, notif_type):
    asyncio.create_task(
        send_push_to_user(pool, user_id, title=title, body=body,
                          data=data, notif_type=notif_type)
    )


# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  POST /bookings/request  (+ alias POST /bookings pour rétrocompat)         ║
# ╚══════════════════════════════════════════════════════════════════════════════╝

async def _do_booking_request(data: BookingRequest, request: Request):
    """
    POST /bookings — Workflow flexible (4 flux selon config service)

    A. instant_booking + pay_now    → awaiting_payment, slot réservé, expiry=30min
    B. instant_booking + pay_later  → awaiting_payment, slot réservé, expiry=pay_later_expiration_minutes
    C. manual_approval + pay_now    → requested, slot pending, accept → awaiting_payment(30min)
    D. manual_approval + pay_later  → requested, slot pending, accept → awaiting_payment(expiry configuré)

    Garanties : idempotence (clé + slot×user), row-level lock NOWAIT, pricing centralisé, atomicité.
    """
    pool = get_pool()
    user = await require_auth(request, pool)
    payer_user_id = user["user_id"]

    payment_mode = (data.payment_mode or "pay_now").strip()
    if payment_mode not in ("pay_now", "pay_later"):
        raise HTTPException(400, "payment_mode doit être 'pay_now' ou 'pay_later'")

    async with pool.acquire() as conn:

        # ── 0. Service + config workflow ──────────────────────────────────────
        svc_row = await conn.fetchrow(
            """SELECT service_id, coach_id, price,
                      booking_approval_mode, allow_pay_later, pay_later_expiration_minutes
               FROM services WHERE service_id = $1 AND active = TRUE""",
            data.service_id,
        )
        if not svc_row:
            raise HTTPException(404, "Service introuvable ou inactif")

        svc              = dict(svc_row)
        receiver_user_id = svc["coach_id"]
        approval_mode    = svc["booking_approval_mode"] or "manual_approval"
        allow_pay_later  = bool(svc["allow_pay_later"])
        expiry_minutes   = int(svc["pay_later_expiration_minutes"] or DEFAULT_PAY_LATER_MINUTES)

        if receiver_user_id == payer_user_id:
            raise HTTPException(400, "Impossible de réserver son propre service")
        if payment_mode == "pay_later" and not allow_pay_later:
            raise HTTPException(400, "Ce service ne permet pas le paiement différé")

        # ── 1. Idempotence par clé explicite ──────────────────────────────────
        if data.idempotency_key:
            existing = await conn.fetchrow(
                "SELECT booking_id FROM bookings WHERE idempotency_key = $1",
                data.idempotency_key,
            )
            if existing:
                return await _fetch_booking(conn, existing["booking_id"])

        # ── 2. Idempotence (slot_id, user_id) ─────────────────────────────────
        if data.slot_id:
            dup = await conn.fetchrow(
                """SELECT booking_id FROM bookings
                   WHERE slot_id=$1 AND user_id=$2
                     AND status NOT IN ('refused','cancelled','expired') LIMIT 1""",
                data.slot_id, payer_user_id,
            )
            if dup:
                return await _fetch_booking(conn, dup["booking_id"])

        base_amount = float(svc["price"])

        async with conn.transaction():

            # ── 3. Row-level lock NOWAIT ───────────────────────────────────────
            slot_type = None
            if data.slot_id:
                try:
                    slot_row = await conn.fetchrow(
                        "SELECT slot_id, slot_type, slot_status FROM service_slots WHERE slot_id=$1 FOR UPDATE NOWAIT",
                        data.slot_id,
                    )
                except asyncpg.LockNotAvailableError:
                    raise HTTPException(409, "Ce créneau est en cours de réservation — réessayez")

                if not slot_row:
                    raise HTTPException(404, "Créneau introuvable")

                slot      = dict(slot_row)
                slot_type = slot["slot_type"]

                if slot_type in ("single", "specific") and slot["slot_status"] != "available":
                    raise HTTPException(409, f"Créneau indisponible (état : {slot['slot_status']})")

            # ── 4. Pricing engine ─────────────────────────────────────────────
            pricing = await pricing_engine.compute_pricing(
                conn=conn,
                payer_user_id=payer_user_id,
                receiver_user_id=receiver_user_id,
                product_type="service_booking",
                base_amount=base_amount,
                currency="EUR",
            )

            bid = new_id("bkg")
            pid = new_id("pay")
            pd  = pricing.to_payment_dict(
                payment_id=pid, payer_user_id=payer_user_id,
                receiver_user_id=receiver_user_id,
                product_type="service_booking", product_id=data.service_id, booking_id=bid,
            )
            pd["status"] = "requires_authorization"

            # ── 5. Statut initial + délai d'expiration selon flux ─────────────
            from datetime import timedelta
            if approval_mode == "instant_booking":
                initial_status      = "awaiting_payment"
                initial_slot_status = "reserved"
                mins = PAY_NOW_CHECKOUT_MINUTES if payment_mode == "pay_now" else expiry_minutes
                expires_at_dt = datetime.now(timezone.utc) + timedelta(minutes=mins)
                expires_interval = f"{mins} minutes"  # pour les logs seulement
            else:
                initial_status      = "requested"
                initial_slot_status = "pending"
                expires_at_dt = datetime.now(timezone.utc) + timedelta(hours=BOOKING_EXPIRY_HOURS)
                expires_interval = f"{BOOKING_EXPIRY_HOURS} hours"

            # ── 6. INSERT booking ─────────────────────────────────────────────
            await conn.execute(
                """INSERT INTO bookings
                   (booking_id, service_id, user_id, coach_id, status,
                    scheduled_at, slot_id, location_id, notes, amount,
                    payer_user_id, receiver_user_id, pricing_snapshot,
                    payment_status, currency, idempotency_key,
                    payment_mode, expires_at)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
                           'pending','EUR',$14,$15,$16)""",
                bid, data.service_id, payer_user_id, receiver_user_id, initial_status,
                data.scheduled_at, data.slot_id, data.location_id, data.notes,
                pricing.payer_total_amount,
                payer_user_id, receiver_user_id,
                json.dumps(pricing.to_snapshot()),
                data.idempotency_key,
                payment_mode,
                expires_at_dt,
            )

            # ── 7. INSERT payment ─────────────────────────────────────────────
            await conn.execute(
                """INSERT INTO payments (
                    payment_id, payer_user_id, receiver_user_id,
                    product_type, product_id, booking_id,
                    stripe_payment_intent_id, stripe_charge_id, stripe_transfer_id,
                    status, currency,
                    base_amount, payer_fixed_fee, payer_percent_fee_amount,
                    receiver_fixed_fee, receiver_percent_fee_amount,
                    platform_total_fee, receiver_net_amount, payer_total_amount,
                    pricing_rule_snapshot
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
                          $12,$13,$14,$15,$16,$17,$18,$19,$20)""",
                pd["payment_id"], pd["payer_user_id"], pd["receiver_user_id"],
                pd["product_type"], pd["product_id"], pd["booking_id"],
                pd["stripe_payment_intent_id"], pd["stripe_charge_id"], pd["stripe_transfer_id"],
                pd["status"], pd["currency"],
                pd["base_amount"], pd["payer_fixed_fee"], pd["payer_percent_fee_amount"],
                pd["receiver_fixed_fee"], pd["receiver_percent_fee_amount"],
                pd["platform_total_fee"], pd["receiver_net_amount"], pd["payer_total_amount"],
                json.dumps(pd["pricing_rule_snapshot"]),
            )

            # ── 8. Verrouillage du créneau ─────────────────────────────────────
            if data.slot_id and slot_type in ("single", "specific"):
                await conn.execute(
                    "UPDATE service_slots SET slot_status=$1 WHERE slot_id=$2",
                    initial_slot_status, data.slot_id,
                )

        result = await _fetch_booking(conn, bid)

    # ── Notifications push ────────────────────────────────────────────────────
    async with pool.acquire() as nc:
        user_info = await nc.fetchrow("SELECT name FROM users WHERE user_id=$1", payer_user_id)
        svc_info  = await nc.fetchrow("SELECT title FROM services WHERE service_id=$1", data.service_id)

    user_name = user_info["name"] if user_info else "Un utilisateur"
    svc_name  = svc_info["title"] if svc_info else "votre service"

    notif_type_key = "booking_awaiting_payment" if initial_status == "awaiting_payment" else "new_booking"
    notif_title    = ("Créneau réservé (paiement en attente)" if initial_status == "awaiting_payment"
                      else "Nouvelle demande de réservation")
    notif_body     = (f"{user_name} a réservé un créneau : {svc_name}"
                      if initial_status == "awaiting_payment"
                      else f"{user_name} souhaite réserver : {svc_name}")

    _push(pool, receiver_user_id,
          title=notif_title, body=notif_body,
          data={"type": notif_type_key, "bookingId": bid, "service_id": data.service_id,
                "sender_id": payer_user_id, "sender_name": user.get("name","")},
          notif_type="new_booking")

    log.info("Booking créé : bk=%s | approval=%s | payment=%s | status=%s | expiry=%s",
             bid, approval_mode, payment_mode, initial_status, expires_interval)
    return result


@router.post("/bookings/request")
async def request_booking(data: BookingRequest, request: Request):
    """Soumettre une demande de réservation (nouveau endpoint v2)."""
    return await _do_booking_request(data, request)


@router.post("/bookings")
async def create_booking(data: BookingCreate, request: Request):
    """Alias rétrocompatibilité → /bookings/request."""
    return await _do_booking_request(data, request)


# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  POST /bookings/{id}/accept                                                ║
# ╚══════════════════════════════════════════════════════════════════════════════╝

@router.post("/bookings/{booking_id}/accept")
async def accept_booking(booking_id: str, request: Request):
    """
    Bénéficiaire accepte (uniquement pour manual_approval).

    Transitions :
      requested → awaiting_payment  (slot: pending → reserved)
      payment_mode=pay_now  → expires_at = NOW() + 30min
      payment_mode=pay_later → expires_at = NOW() + service.pay_later_expiration_minutes

    Garde TTL : refus si expires_at déjà passé.
    """
    pool = get_pool()
    user = await require_auth(request, pool)

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """SELECT b.booking_id, b.status, b.receiver_user_id, b.slot_id, b.expires_at,
                      b.user_id AS payer_user_id, b.service_id, b.payment_mode,
                      s.pay_later_expiration_minutes, s.booking_approval_mode
               FROM bookings b
               JOIN services s ON s.service_id = b.service_id
               WHERE b.booking_id = $1""",
            booking_id,
        )
        if not row:
            raise HTTPException(404, "Réservation introuvable")

        bk = dict(row)
        if bk["receiver_user_id"] != user["user_id"] and user.get("role") != "admin":
            raise HTTPException(403, "Seul le bénéficiaire peut accepter cette réservation")

        # Idempotence
        if bk["status"] == "awaiting_payment":
            return {"success": True, "status": "awaiting_payment", "booking_id": booking_id, "idempotent": True}
        if bk["status"] == "accepted":
            return {"success": True, "status": "accepted", "booking_id": booking_id, "idempotent": True}

        if bk["status"] != "requested":
            raise HTTPException(409, f"Impossible d'accepter une réservation en état '{bk['status']}'")

        # Garde TTL
        expires_at = bk.get("expires_at")
        if expires_at:
            now_utc = datetime.now(timezone.utc)
            if getattr(expires_at, 'tzinfo', None) is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            if expires_at < now_utc:
                raise HTTPException(410, "Cette réservation a expiré — le créneau a été libéré")

        # Calculer le nouveau expires_at pour le paiement
        payment_mode = bk.get("payment_mode") or "pay_now"
        exp_min = int(bk.get("pay_later_expiration_minutes") or DEFAULT_PAY_LATER_MINUTES)
        pay_expiry_minutes = PAY_NOW_CHECKOUT_MINUTES if payment_mode == "pay_now" else exp_min
        pay_expiry_interval = f"{pay_expiry_minutes} minutes"
        from datetime import timedelta
        new_expires_at = datetime.now(timezone.utc) + timedelta(minutes=pay_expiry_minutes)

        async with conn.transaction():
            await conn.execute(
                """UPDATE bookings
                   SET status='awaiting_payment',
                       expires_at = $2,
                       updated_at = NOW()
                   WHERE booking_id=$1""",
                booking_id, new_expires_at,
            )
            if bk["slot_id"]:
                await conn.execute(
                    "UPDATE service_slots SET slot_status='reserved' WHERE slot_id=$1 AND slot_status IN ('pending','available')",
                    bk["slot_id"],
                )

    _push(pool, bk["payer_user_id"],
          title="Réservation acceptée — paiement requis",
          body=f"Votre demande a été acceptée. Vous avez {exp_min if payment_mode=='pay_later' else PAY_NOW_CHECKOUT_MINUTES} min pour payer.",
          data={"type": "booking_accepted", "bookingId": booking_id,
                "requires_payment": True, "action_text": "a accepté votre demande"},
          notif_type="booking_accepted")

    return {"success": True, "status": "awaiting_payment", "booking_id": booking_id,
            "payment_mode": payment_mode, "pay_expiry_interval": pay_expiry_interval}


# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  POST /bookings/{id}/pay  — Payer une réservation en awaiting_payment       ║
# ╚══════════════════════════════════════════════════════════════════════════════╝

@router.post("/bookings/{booking_id}/pay")
async def pay_booking(booking_id: str, request: Request):
    """
    Initie le paiement Stripe pour un booking en état 'awaiting_payment'.

    Conditions :
      - booking.status = 'awaiting_payment'
      - expires_at > NOW()

    Retourne : { url, session_id }
    """
    pool = get_pool()
    user = await require_auth(request, pool)

    try:
        raw = await request.json()
    except Exception:
        raw = {}
    origin_url = raw.get("origin_url", "") if isinstance(raw, dict) else ""

    async with pool.acquire() as conn:
        bk_row = await conn.fetchrow(
            "SELECT booking_id, status, payer_user_id, expires_at FROM bookings WHERE booking_id=$1",
            booking_id,
        )
        if not bk_row:
            raise HTTPException(404, "Réservation introuvable")

        bk = dict(bk_row)
        if bk["payer_user_id"] != user["user_id"] and user.get("role") != "admin":
            raise HTTPException(403, "Seul le payeur peut initier le paiement")

        if bk["status"] != "awaiting_payment":
            raise HTTPException(
                409,
                f"Le paiement n'est possible qu'en état 'awaiting_payment' (actuel : '{bk['status']}')",
            )

        expires_at = bk.get("expires_at")
        if expires_at:
            now_utc = datetime.now(timezone.utc)
            if getattr(expires_at, 'tzinfo', None) is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            if expires_at < now_utc:
                raise HTTPException(410, "Le délai de paiement a expiré — réservation annulée")

        # Récupérer le payment lié
        pay_row = await conn.fetchrow(
            "SELECT payment_id, payer_total_amount, currency, stripe_checkout_session_id FROM payments WHERE booking_id=$1 LIMIT 1",
            booking_id,
        )
        if not pay_row:
            raise HTTPException(500, "Enregistrement de paiement manquant pour cette réservation")

        pay = dict(pay_row)

        # Si une session Stripe existe déjà (idempotence)
        existing_cs_id = pay.get("stripe_checkout_session_id")
        if existing_cs_id:
            try:
                session = await stripe_service.retrieve_checkout_session(existing_cs_id)
                if session.status == "open":
                    return {"url": session.url, "session_id": session.id, "reused": True}
            except Exception:
                pass  # session expirée → en créer une nouvelle

    # Créer la session Stripe Checkout
    import stripe as _stripe
    amount_cents = int(round(float(pay["payer_total_amount"]) * 100))
    currency     = (pay.get("currency") or "eur").lower()

    success_url = f"{origin_url}/payment-success?session_id={{CHECKOUT_SESSION_ID}}&booking_id={booking_id}"
    cancel_url  = f"{origin_url}/bookings"

    session = await stripe_service.create_checkout_session(
        amount_cents    = amount_cents,
        currency        = currency,
        success_url     = success_url,
        cancel_url      = cancel_url,
        metadata        = {"payment_id": pay["payment_id"], "booking_id": booking_id},
        idempotency_key = pay["payment_id"],
    )

    async with pool.acquire() as conn2:
        pi_id = session.payment_intent if isinstance(session.payment_intent, str) else None
        async with conn2.transaction():
            await conn2.execute(
                """UPDATE payments
                   SET stripe_checkout_session_id=$1,
                       stripe_payment_intent_id=COALESCE($2, stripe_payment_intent_id),
                       status = CASE
                           WHEN status NOT IN ('requires_authorization','authorized','captured')
                           THEN 'requires_authorization' ELSE status
                       END,
                       updated_at=NOW()
                   WHERE payment_id=$3""",
                session.id, pi_id, pay["payment_id"],
            )
            await conn2.execute(
                """UPDATE bookings SET payment_status='requires_authorization', updated_at=NOW()
                   WHERE booking_id=$1 AND payment_status NOT IN ('authorized','captured','paid')""",
                booking_id,
            )

    return {"url": session.url, "session_id": session.id}




@router.post("/bookings/{booking_id}/refuse")
async def refuse_booking(booking_id: str, request: Request):
    """
    Le bénéficiaire refuse la demande.
    - booking : requested → refused
    - slot    : pending   → available  (single uniquement)
    - payment : requires_authorization → cancelled
    """
    pool = get_pool()
    user = await require_auth(request, pool)

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT booking_id, status, receiver_user_id, slot_id, user_id AS payer_user_id FROM bookings WHERE booking_id=$1",
            booking_id,
        )
        if not row:
            raise HTTPException(404, "Réservation introuvable")

        bk = dict(row)
        if bk["receiver_user_id"] != user["user_id"]:
            raise HTTPException(403, "Seul le bénéficiaire peut refuser cette réservation")
        if bk["status"] == "refused":
            return {"success": True, "status": "refused", "idempotent": True}
        if bk["status"] not in ("requested",):
            raise HTTPException(409, f"Impossible de refuser une réservation en état '{bk['status']}'")

        # Récupérer le PI ID avant la transaction
        pi_row = await conn.fetchrow(
            "SELECT stripe_payment_intent_id, status AS pay_status FROM payments WHERE booking_id=$1 LIMIT 1",
            booking_id,
        )

        async with conn.transaction():
            await conn.execute(
                "UPDATE bookings SET status='refused', updated_at=NOW() WHERE booking_id=$1",
                booking_id,
            )
            await conn.execute(
                """UPDATE payments SET status='cancelled', updated_at=NOW()
                   WHERE booking_id=$1 AND status IN ('requires_authorization','authorized')""",
                booking_id,
            )
            if bk["slot_id"]:
                await conn.execute(
                    """UPDATE service_slots SET slot_status='available'
                       WHERE slot_id=$1 AND slot_status='pending'""",
                    bk["slot_id"],
                )

    # ── Annulation Stripe hors transaction ───────────────────────────────────
    if pi_row and pi_row["stripe_payment_intent_id"]:
        pi_id = pi_row["stripe_payment_intent_id"]
        try:
            await stripe_service.cancel_payment_intent(pi_id, reason="refused")
            log.info("Annulation Stripe réussie : pi=%s | booking=%s", pi_id, booking_id)
        except Exception as exc:
            log.error("Erreur annulation Stripe pi=%s : %s", pi_id, exc)

    # ── Notification push au payer ─────────────────────────────────────────────
    _push(
        pool, bk["payer_user_id"],
        title="Réservation refusée",
        body="Votre demande de réservation n'a pas pu être acceptée.",
        data={
            "type": "booking_refused",
            "bookingId": booking_id,
            "action_text": "a refusé votre demande",
        },
        notif_type="booking_refused",
    )

    return {"success": True, "status": "refused", "booking_id": booking_id}


# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  POST /bookings/{id}/cancel                                                ║
# ╚══════════════════════════════════════════════════════════════════════════════╝

@router.post("/bookings/{booking_id}/cancel")
async def cancel_booking(
    booking_id: str,
    request: Request,
    body: Optional[CancelRequest] = Body(default=None),
):
    """
    POLITIQUE D'ANNULATION SpotU
    ==============================

    Qui peut annuler :
      • Le payeur  (payer_user_id / user_id)  : états requested et accepted
      • Le bénéficiaire (receiver_user_id)     : uniquement état accepted
      • L'admin                                : tous les états annulables

    Traitement financier selon le statut du paiement :
    ┌──────────────────────────────┬──────────────────────────────────────────────┐
    │ pay_status avant annulation  │ Action Stripe                                │
    ├──────────────────────────────┼──────────────────────────────────────────────┤
    │ requires_authorization       │ PaymentIntent.cancel (aucun débit)           │
    │ authorized / capture_pending │ PaymentIntent.cancel (aucun débit)           │
    │ captured                     │ Refund.create (remboursement complet)         │
    │ pending / failed / other     │ Aucune action Stripe                          │
    └──────────────────────────────┴──────────────────────────────────────────────┘

    Machine d'états booking :
      requested + payeur/admin    → cancelled
      accepted  + payeur          → cancelled
      accepted  + bénéficiaire    → cancelled
      completed / refused/expired → 409 impossible

    Notifications :
      • Payeur annule   → notification au bénéficiaire
      • Bénéficiaire annule → notification au payeur (+ info remboursement si applicable)
      • Admin annule    → notification aux deux parties

    Colonnes tracées en DB :
      bookings.cancelled_by_user_id — qui a annulé
      bookings.cancellation_reason  — raison fournie (optionnel)
    """
    pool = get_pool()
    user = await require_auth(request, pool)
    cancel_reason = body.reason if body else None

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """SELECT b.booking_id, b.status, b.user_id, b.slot_id,
                      b.payer_user_id, b.receiver_user_id, b.service_id,
                      p.status AS pay_status, p.payment_id,
                      p.stripe_payment_intent_id, p.stripe_charge_id
               FROM bookings b
               LEFT JOIN payments p ON p.booking_id = b.booking_id
               WHERE b.booking_id = $1
               LIMIT 1""",
            booking_id,
        )
        if not row:
            raise HTTPException(404, "Réservation introuvable")

        bk = dict(row)
        uid = user["user_id"]
        is_admin    = user.get("role") == "admin"
        is_payer    = uid in filter(None, [bk["user_id"], bk["payer_user_id"]])
        is_receiver = uid == bk["receiver_user_id"]

        # ── Vérification des droits ────────────────────────────────────────────
        if not (is_payer or is_receiver or is_admin):
            raise HTTPException(403, "Vous n'êtes pas autorisé à annuler cette réservation")

        # Le bénéficiaire ne peut annuler que si accepted
        if is_receiver and not is_payer and not is_admin:
            if bk["status"] != "accepted":
                raise HTTPException(
                    409,
                    f"Le bénéficiaire peut annuler uniquement une réservation acceptée "
                    f"(état actuel : '{bk['status']}'). "
                    "Pour refuser une demande en attente, utilisez /refuse.",
                )

        # ── Idempotence ────────────────────────────────────────────────────────
        if bk["status"] == "cancelled":
            return {"success": True, "status": "cancelled", "idempotent": True}

        # ── États non annulables ───────────────────────────────────────────────
        if bk["status"] in ("completed", "refused", "expired"):
            raise HTTPException(
                409,
                f"Impossible d'annuler une réservation en état '{bk['status']}'",
            )

        pay_status = bk.get("pay_status") or ""

        # ── Déterminer la transition payment ──────────────────────────────────
        if pay_status in ("requires_authorization", "authorized", "capture_pending"):
            new_pay_status = "cancelled"
        elif pay_status == "captured":
            new_pay_status = "refunded"
        else:
            new_pay_status = pay_status  # pending / failed / None → pas de changement

        # ── Transaction DB atomique ────────────────────────────────────────────
        async with conn.transaction():
            await conn.execute(
                """UPDATE bookings
                   SET status='cancelled',
                       cancelled_by_user_id=$2,
                       cancellation_reason=$3,
                       updated_at=NOW()
                   WHERE booking_id=$1""",
                booking_id, uid, cancel_reason,
            )
            if bk.get("payment_id") and new_pay_status != pay_status:
                await conn.execute(
                    "UPDATE payments SET status=$1, updated_at=NOW() WHERE payment_id=$2",
                    new_pay_status, bk["payment_id"],
                )
            if bk["slot_id"]:
                await conn.execute(
                    """UPDATE service_slots SET slot_status='available'
                       WHERE slot_id=$1 AND slot_status IN ('pending','reserved','booked')""",
                    bk["slot_id"],
                )

    # ── Stripe hors transaction ────────────────────────────────────────────────
    stripe_action: str | None = None
    pi_id     = bk.get("stripe_payment_intent_id")
    charge_id = bk.get("stripe_charge_id")

    if new_pay_status == "cancelled" and pi_id:
        try:
            await stripe_service.cancel_payment_intent(pi_id, reason="cancelled")
            stripe_action = "pi_cancelled"
            log.info("PI annulé : pi=%s | booking=%s", pi_id, booking_id)
        except Exception as exc:
            log.error("Erreur annulation PI pi=%s booking=%s : %s", pi_id, booking_id, exc)

    elif new_pay_status == "refunded":
        if charge_id:
            try:
                await stripe_service.create_refund(
                    charge_id=charge_id,
                    reason="requested_by_customer",
                    idempotency_key=booking_id,
                )
                stripe_action = "refund_created"
                log.info(
                    "Remboursement Stripe : charge=%s | booking=%s", charge_id, booking_id
                )
            except Exception as exc:
                log.error(
                    "Erreur remboursement Stripe charge=%s booking=%s : %s",
                    charge_id, booking_id, exc,
                )
        else:
            # charge_id absent (proxy Emergent / PI sans capture) — pas de refund possible
            log.warning(
                "Paiement capturé sans stripe_charge_id — remboursement manuel requis (booking=%s)",
                booking_id,
            )

    # ── Notifications ──────────────────────────────────────────────────────────
    refund_suffix = " Un remboursement a été initié." if new_pay_status == "refunded" else ""
    payer_uid    = bk.get("payer_user_id") or bk.get("user_id")
    receiver_uid = bk.get("receiver_user_id")

    if is_admin:
        # Admin → notifie les deux parties
        if payer_uid:
            _push(
                pool, payer_uid,
                title="Réservation annulée",
                body=f"Votre réservation a été annulée par un administrateur.{refund_suffix}",
                data={"type": "booking_cancelled", "bookingId": booking_id,
                      "cancelled_by": "admin"},
                notif_type="booking_cancelled",
            )
        if receiver_uid:
            _push(
                pool, receiver_uid,
                title="Réservation annulée",
                body="Une réservation a été annulée par un administrateur.",
                data={"type": "booking_cancelled", "bookingId": booking_id,
                      "cancelled_by": "admin"},
                notif_type="booking_cancelled",
            )
    elif is_payer:
        # Payeur annule → notification au bénéficiaire
        if receiver_uid:
            _push(
                pool, receiver_uid,
                title="Réservation annulée par le client",
                body="Le client a annulé sa réservation.",
                data={"type": "booking_cancelled_by_payer", "bookingId": booking_id,
                      "action_text": "a annulé sa réservation"},
                notif_type="booking_cancelled",
            )
    elif is_receiver:
        # Bénéficiaire annule → notification au payeur
        if payer_uid:
            _push(
                pool, payer_uid,
                title="Réservation annulée par le prestataire",
                body=f"Votre réservation a été annulée par le prestataire.{refund_suffix}",
                data={"type": "booking_cancelled_by_receiver", "bookingId": booking_id,
                      "refund": new_pay_status == "refunded",
                      "action_text": "a annulé la réservation"},
                notif_type="booking_cancelled",
            )

    log.info(
        "Booking annulé : booking=%s | par=%s (payer=%s, receiver=%s, admin=%s) "
        "| pay=%s→%s | stripe=%s | reason=%s",
        booking_id, uid, is_payer, is_receiver, is_admin,
        pay_status, new_pay_status, stripe_action, cancel_reason,
    )

    return {
        "success":        True,
        "status":         "cancelled",
        "booking_id":     booking_id,
        "payment_status": new_pay_status,
        "cancelled_by":   uid,
        "stripe_action":  stripe_action,
    }


# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  Ancienne route PATCH /status — redirigée vers les verbes dédiés           ║
# ╚══════════════════════════════════════════════════════════════════════════════╝

@router.patch("/bookings/{booking_id}/status")
async def update_booking_status(booking_id: str, request: Request):
    """
    Endpoint legacy — redirige vers les verbes dédiés.
    Conservé pour rétrocompatibilité frontend.
    """
    body = await request.json()
    new_status = body.get("status")

    if new_status == "accepted":
        return await accept_booking(booking_id, request)
    elif new_status == "refused":
        return await refuse_booking(booking_id, request)
    elif new_status == "cancelled":
        return await cancel_booking(booking_id, request=request, body=CancelRequest())
    elif new_status == "completed":
        pool = get_pool()
        user = await require_auth(request, pool)
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT receiver_user_id FROM bookings WHERE booking_id=$1", booking_id
            )
            if not row:
                raise HTTPException(404, "Réservation introuvable")
            if dict(row)["receiver_user_id"] != user["user_id"] and user.get("role") != "admin":
                raise HTTPException(403, "Seul le bénéficiaire peut marquer comme terminé")
            async with conn.transaction():
                await conn.execute(
                    "UPDATE bookings SET status='completed', updated_at=NOW() WHERE booking_id=$1",
                    booking_id,
                )
                await conn.execute(
                    """UPDATE service_slots SET slot_status='completed'
                       WHERE slot_id = (SELECT slot_id FROM bookings WHERE booking_id=$1)
                         AND slot_status='booked'""",
                    booking_id,
                )
                await conn.execute(
                    """UPDATE payments SET status='captured', updated_at=NOW()
                       WHERE booking_id=$1 AND status='authorized'""",
                    booking_id,
                )
        return {"success": True, "status": "completed"}
    else:
        raise HTTPException(400, f"Statut '{new_status}' invalide ou non supporté via cet endpoint")


# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  GET — Listes de réservations                                              ║
# ╚══════════════════════════════════════════════════════════════════════════════╝

@router.get("/bookings/me")
@router.get("/users/me/bookings")
async def my_bookings(request: Request):
    """Réservations du payeur courant (les deux chemins supportés)."""
    pool = get_pool()
    user = await require_auth(request, pool)
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""SELECT {BOOKING_FIELDS},
                    s.title AS service_title, s.address,
                    u_recv.name AS receiver_name
                FROM bookings b
                LEFT JOIN services s ON s.service_id = b.service_id
                LEFT JOIN users u_recv ON u_recv.user_id = b.receiver_user_id
                WHERE b.user_id = $1
                ORDER BY b.created_at DESC""",
            user["user_id"],
        )
    return [_deserialize(row_to_dict(r)) for r in rows]


@router.get("/bookings/received")
@router.get("/receiver/requests")
async def received_bookings(request: Request):
    """Demandes reçues par le bénéficiaire courant (les deux chemins supportés)."""
    pool = get_pool()
    user = await require_auth(request, pool)
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""SELECT {BOOKING_FIELDS},
                    s.title AS service_title,
                    u_pay.name AS payer_name
                FROM bookings b
                LEFT JOIN services s ON s.service_id = b.service_id
                LEFT JOIN users u_pay ON u_pay.user_id = b.payer_user_id
                WHERE b.receiver_user_id = $1
                ORDER BY b.created_at DESC""",
            user["user_id"],
        )
    return [_deserialize(row_to_dict(r)) for r in rows]
