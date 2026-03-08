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

from fastapi import APIRouter, Request, HTTPException
from models import BookingRequest, BookingCreate, new_id   # BookingCreate = alias rétrocompat
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
# et comme garde côté endpoint /accept (avant que le worker ait tourné)
BOOKING_EXPIRY_HOURS = int(os.environ.get("BOOKING_EXPIRY_HOURS", "48"))

# ── Projection commune ─────────────────────────────────────────────────────────
BOOKING_FIELDS = """
    b.booking_id, b.service_id, b.user_id, b.coach_id, b.status,
    b.scheduled_at, b.slot_id, b.location_id, b.notes, b.amount,
    b.payment_status, b.payer_user_id, b.receiver_user_id,
    b.pricing_snapshot, b.idempotency_key, b.currency,
    b.created_at, b.updated_at, b.expires_at
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
    Logique commune à POST /bookings/request et POST /bookings.
    1. Idempotence : si idempotency_key déjà vu → retourner booking existant
    2. Idempotence slot  : si (slot_id, user_id) déjà actif → retourner booking existant
    3. Lock slot (single) via SELECT … FOR UPDATE NOWAIT
    4. Calcul tarifaire via pricing_engine (aucun calcul ici)
    5. INSERT atomique booking + payment dans une transaction
    6. Mise à jour slot_status = 'pending' (single) dans la même transaction
    """
    pool = get_pool()
    user = await require_auth(request, pool)
    payer_user_id = user["user_id"]

    async with pool.acquire() as conn:

        # ── 0. Résolution du service ───────────────────────────────────────────
        svc_row = await conn.fetchrow(
            "SELECT service_id, coach_id, price FROM services WHERE service_id = $1 AND active = TRUE",
            data.service_id,
        )
        if not svc_row:
            raise HTTPException(404, "Service introuvable ou inactif")

        svc = dict(svc_row)
        receiver_user_id = svc["coach_id"]

        if receiver_user_id == payer_user_id:
            raise HTTPException(400, "Impossible de réserver son propre service")

        # ── 1. Idempotence par clé explicite ──────────────────────────────────
        if data.idempotency_key:
            existing = await conn.fetchrow(
                "SELECT booking_id FROM bookings WHERE idempotency_key = $1",
                data.idempotency_key,
            )
            if existing:
                log.info("Idempotency hit (key=%s) → booking=%s", data.idempotency_key, existing["booking_id"])
                return await _fetch_booking(conn, existing["booking_id"])

        # ── 2. Idempotence par (slot_id, user_id) pour un même créneau ────────
        if data.slot_id:
            existing_slot_booking = await conn.fetchrow(
                """SELECT booking_id FROM bookings
                   WHERE slot_id = $1 AND user_id = $2
                     AND status NOT IN ('refused', 'cancelled', 'expired')
                   LIMIT 1""",
                data.slot_id, payer_user_id,
            )
            if existing_slot_booking:
                log.info("Slot idempotency hit (slot=%s, user=%s) → booking=%s",
                         data.slot_id, payer_user_id, existing_slot_booking["booking_id"])
                return await _fetch_booking(conn, existing_slot_booking["booking_id"])

        # ── 3. Calcul tarifaire centralisé (pricing_engine) ───────────────────
        # Base amount : prix du service (ou du package slot si connu)
        base_amount = float(svc["price"])

        async with conn.transaction():

            # ── 4. Vérification et lock du slot (single uniquement) ───────────
            slot_type = None
            if data.slot_id:
                try:
                    slot_row = await conn.fetchrow(
                        """SELECT slot_id, slot_type, slot_status
                           FROM service_slots
                           WHERE slot_id = $1
                           FOR UPDATE NOWAIT""",
                        data.slot_id,
                    )
                except asyncpg.LockNotAvailableError:
                    raise HTTPException(
                        409,
                        "Ce créneau est en cours de réservation — réessayez dans quelques secondes",
                    )

                if not slot_row:
                    raise HTTPException(404, "Créneau introuvable")

                slot = dict(slot_row)
                slot_type = slot["slot_type"]

                # Pour les créneaux spécifiques (single/specific) : vérifier la disponibilité
                if slot_type in ("single", "specific") and slot["slot_status"] != "available":
                    raise HTTPException(
                        409,
                        f"Ce créneau n'est plus disponible (état actuel : {slot['slot_status']})",
                    )

            # ── 5. Calcul de pricing (dans la transaction pour cohérence) ─────
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

            pd = pricing.to_payment_dict(
                payment_id=pid,
                payer_user_id=payer_user_id,
                receiver_user_id=receiver_user_id,
                product_type="service_booking",
                product_id=data.service_id,
                booking_id=bid,
            )
            # Statut initial payment : requires_authorization
            pd["status"] = "requires_authorization"

            # ── 6. INSERT booking ─────────────────────────────────────────────
            # expires_at = NOW() + TTL_HOURS — calculé une seule fois ici
            await conn.execute(
                """INSERT INTO bookings
                   (booking_id, service_id, user_id, coach_id, status,
                    scheduled_at, slot_id, location_id, notes, amount,
                    payer_user_id, receiver_user_id, pricing_snapshot,
                    payment_status, currency, idempotency_key, expires_at)
                   VALUES ($1,$2,$3,$4,'requested',
                           $5,$6,$7,$8,$9,
                           $10,$11,$12,
                           'pending','EUR',$13,
                           NOW() + ($14 || ' hours')::INTERVAL)""",
                bid, data.service_id, payer_user_id, receiver_user_id,
                data.scheduled_at, data.slot_id, data.location_id, data.notes,
                pricing.payer_total_amount,
                payer_user_id, receiver_user_id,
                json.dumps(pricing.to_snapshot()),
                data.idempotency_key,
                str(BOOKING_EXPIRY_HOURS),
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

            # ── 8. Verrouillage du slot (specific/single) ────────────────────
            if data.slot_id and slot_type in ("single", "specific"):
                await conn.execute(
                    "UPDATE service_slots SET slot_status = 'pending' WHERE slot_id = $1",
                    data.slot_id,
                )

        result = await _fetch_booking(conn, bid)

    # ── Notification push (hors transaction) ──────────────────────────────────
    async with pool.acquire() as conn2:
        user_info = await conn2.fetchrow("SELECT name FROM users WHERE user_id = $1", payer_user_id)
        svc_title = await conn2.fetchrow("SELECT title FROM services WHERE service_id = $1", data.service_id)

    user_name = user_info["name"] if user_info else "Un utilisateur"
    svc_name  = svc_title["title"] if svc_title else "votre service"

    _push(
        pool, receiver_user_id,
        title="Nouvelle demande de réservation",
        body=f"{user_name} souhaite réserver : {svc_name}",
        data={
            "type": "new_booking",
            "bookingId": bid,
            "service_id": data.service_id,
            "sender_id": payer_user_id,
            "sender_name": user.get("name", ""),
            "sender_picture": user.get("picture") or "",
            "action_text": "souhaite réserver",
            "content_title": svc_name,
        },
        notif_type="new_booking",
    )

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
    Le bénéficiaire (receiver) accepte la demande.
    - booking : requested → accepted
    - slot    : pending   → booked      (single uniquement)
    - payment : requires_authorization → authorized
    """
    pool = get_pool()
    user = await require_auth(request, pool)

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """SELECT booking_id, status, receiver_user_id, slot_id, expires_at,
                      user_id AS payer_user_id, service_id
               FROM bookings WHERE booking_id = $1""",
            booking_id,
        )
        if not row:
            raise HTTPException(404, "Réservation introuvable")

        bk = dict(row)
        if bk["receiver_user_id"] != user["user_id"]:
            raise HTTPException(403, "Seul le bénéficiaire peut accepter cette réservation")
        if bk["status"] == "accepted":
            return {"success": True, "status": "accepted", "idempotent": True}
        if bk["status"] != "requested":
            raise HTTPException(409, f"Impossible d'accepter une réservation en état '{bk['status']}'")

        # ── TTL guard : refuser si expiré même avant le prochain tick du worker ──
        expires_at = bk.get("expires_at")
        if expires_at is not None:
            # asyncpg retourne un datetime aware (UTC)
            now_utc = datetime.now(timezone.utc)
            if hasattr(expires_at, "tzinfo") and expires_at.tzinfo is None:
                from datetime import timezone as _tz
                expires_at = expires_at.replace(tzinfo=_tz.utc)
            if expires_at < now_utc:
                raise HTTPException(
                    410,
                    "Cette réservation a expiré et ne peut plus être acceptée — le créneau a été libéré",
                )

        # Récupérer le PI ID avant la transaction
        pi_row = await conn.fetchrow(
            "SELECT stripe_payment_intent_id, status AS pay_status FROM payments WHERE booking_id=$1 LIMIT 1",
            booking_id,
        )

        async with conn.transaction():
            await conn.execute(
                "UPDATE bookings SET status='accepted', updated_at=NOW() WHERE booking_id=$1",
                booking_id,
            )
            await conn.execute(
                """UPDATE payments SET status='authorized', updated_at=NOW()
                   WHERE booking_id=$1 AND status IN ('requires_authorization', 'authorized')""",
                booking_id,
            )
            if bk["slot_id"]:
                await conn.execute(
                    """UPDATE service_slots SET slot_status='booked'
                       WHERE slot_id=$1 AND slot_status='pending'""",
                    bk["slot_id"],
                )

    # ── Capture Stripe hors transaction ───────────────────────────────────────
    if pi_row and pi_row["stripe_payment_intent_id"]:
        pi_id = pi_row["stripe_payment_intent_id"]
        try:
            await stripe_service.capture_payment_intent(pi_id)
            # Mettre à jour le statut payment → captured
            async with pool.acquire() as conn2:
                await conn2.execute(
                    """UPDATE payments SET status='captured', updated_at=NOW()
                       WHERE booking_id=$1 AND status='authorized'""",
                    booking_id,
                )
            log.info("Capture Stripe réussie : pi=%s | booking=%s", pi_id, booking_id)
        except Exception as exc:
            log.error(
                "Erreur capture Stripe pi=%s | booking=%s : %s",
                pi_id, booking_id, exc,
            )
            # Le webhook payment_intent.succeeded se chargera de la mise à jour

    # ── Notification push au payer ─────────────────────────────────────────────
    _push(
        pool, bk["payer_user_id"],
        title="Réservation acceptée !",
        body="Votre demande de réservation a été acceptée.",
        data={
            "type": "booking_accepted",
            "bookingId": booking_id,
            "service_id": bk.get("service_id", ""),
            "action_text": "a accepté votre demande",
        },
        notif_type="booking_accepted",
    )

    return {"success": True, "status": "accepted", "booking_id": booking_id}

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
async def cancel_booking(booking_id: str, request: Request):
    """
    Le payeur (ou admin) annule.
    - booking : requested|accepted → cancelled
    - slot    : pending|booked → available (libération)
    - payment : requires_authorization|authorized → cancelled
                captured → refunded (paiement déjà capturé)
    """
    pool = get_pool()
    user = await require_auth(request, pool)

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """SELECT b.booking_id, b.status, b.user_id, b.slot_id,
                      b.receiver_user_id,
                      p.status AS pay_status, p.payment_id
               FROM bookings b
               LEFT JOIN payments p ON p.booking_id = b.booking_id
               WHERE b.booking_id = $1
               LIMIT 1""",
            booking_id,
        )
        if not row:
            raise HTTPException(404, "Réservation introuvable")

        bk = dict(row)
        is_admin = user.get("role") == "admin"
        if bk["user_id"] != user["user_id"] and not is_admin:
            raise HTTPException(403, "Seul le payeur ou un admin peut annuler")
        if bk["status"] == "cancelled":
            return {"success": True, "status": "cancelled", "idempotent": True}
        if bk["status"] in ("completed", "refused", "expired"):
            raise HTTPException(409, f"Impossible d'annuler une réservation en état '{bk['status']}'")

        pay_status = bk.get("pay_status", "")
        new_pay_status = (
            "refunded"  if pay_status == "captured" else
            "cancelled" if pay_status in ("requires_authorization", "authorized", "capture_pending") else
            pay_status
        )

        async with conn.transaction():
            await conn.execute(
                "UPDATE bookings SET status='cancelled', updated_at=NOW() WHERE booking_id=$1",
                booking_id,
            )
            if bk.get("payment_id") and new_pay_status:
                await conn.execute(
                    "UPDATE payments SET status=$1, updated_at=NOW() WHERE payment_id=$2",
                    new_pay_status, bk["payment_id"],
                )
            if bk["slot_id"]:
                await conn.execute(
                    """UPDATE service_slots SET slot_status='available'
                       WHERE slot_id=$1 AND slot_status IN ('pending','booked')""",
                    bk["slot_id"],
                )

    # ── Annulation / Remboursement Stripe hors transaction ────────────────────
    # Récupérer le PI ID (pas dans la requête initiale — on le charge séparément)
    if bk.get("payment_id") and new_pay_status in ("cancelled", "refunded"):
        async with pool.acquire() as conn2:
            pi_row = await conn2.fetchrow(
                "SELECT stripe_payment_intent_id FROM payments WHERE payment_id=$1",
                bk["payment_id"],
            )
        if pi_row and pi_row["stripe_payment_intent_id"]:
            pi_id = pi_row["stripe_payment_intent_id"]
            try:
                if new_pay_status == "cancelled":
                    await stripe_service.cancel_payment_intent(pi_id, reason="cancelled")
                # Note : le remboursement réel (refunded) nécessite stripe.Refund.create
                # — non implémenté ici (cas rare d'annulation post-capture)
                log.info(
                    "Stripe annulation : pi=%s | new_pay_status=%s | booking=%s",
                    pi_id, new_pay_status, booking_id,
                )
            except Exception as exc:
                log.error("Erreur Stripe annulation pi=%s : %s", pi_id, exc)

    # ── Notification push au receiver (coach) ─────────────────────────────────
    if bk.get("receiver_user_id"):
        _push(
            pool, bk["receiver_user_id"],
            title="Réservation annulée",
            body="Une demande de réservation a été annulée.",
            data={
                "type": "booking_cancelled",
                "bookingId": booking_id,
                "action_text": "a annulé sa demande",
            },
            notif_type="booking_cancelled",
        )

    return {
        "success": True,
        "status": "cancelled",
        "booking_id": booking_id,
        "payment_status": new_pay_status,
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
        return await cancel_booking(booking_id, request)
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
