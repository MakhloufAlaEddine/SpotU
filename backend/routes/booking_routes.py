from fastapi import APIRouter, Request, HTTPException
from models import BookingCreate, new_id
from auth_utils import require_auth
from database import get_pool, row_to_dict
from push_service import send_push_to_user
from pricing_engine import pricing_engine
import asyncio
import json

router = APIRouter()

BOOKING_FIELDS = """
    booking_id, service_id, user_id, coach_id, status, scheduled_at,
    slot_id, location_id, notes, amount, payment_status,
    payer_user_id, receiver_user_id, pricing_snapshot, created_at
"""


@router.post("/bookings")
async def create_booking(data: BookingCreate, request: Request):
    pool = get_pool()
    user = await require_auth(request, pool)

    async with pool.acquire() as conn:
        svc_row = await conn.fetchrow(
            "SELECT service_id, coach_id, price FROM services WHERE service_id = $1 AND active = TRUE",
            data.service_id,
        )
        if not svc_row:
            raise HTTPException(status_code=404, detail="Service not found")

        svc = dict(svc_row)
        payer_user_id = user["user_id"]
        receiver_user_id = svc["coach_id"]

        if receiver_user_id == payer_user_id:
            raise HTTPException(status_code=400, detail="Cannot book your own service")

        # Calcul centralisé des frais via le pricing engine
        pricing = await pricing_engine.calculate(
            conn=conn,
            base_amount=float(svc["price"]),
            payer_user_id=payer_user_id,
            receiver_user_id=receiver_user_id,
            product_type="service_booking",
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

        # Insertion atomique : booking + payment dans la même transaction
        async with conn.transaction():
            await conn.execute(
                """INSERT INTO bookings
                   (booking_id, service_id, user_id, coach_id, status, scheduled_at,
                    slot_id, location_id, notes, amount,
                    payer_user_id, receiver_user_id, pricing_snapshot, payment_status, currency)
                   VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, $8, $9,
                           $10, $11, $12, 'pending', 'EUR')""",
                bid, data.service_id, payer_user_id, receiver_user_id,
                data.scheduled_at, data.slot_id, data.location_id, data.notes,
                pricing.payer_total_amount,
                payer_user_id, receiver_user_id,
                json.dumps(pricing.to_snapshot()),
            )
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
                ) VALUES (
                    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
                    $12,$13,$14,$15,$16,$17,$18,$19,$20
                )""",
                pd["payment_id"], pd["payer_user_id"], pd["receiver_user_id"],
                pd["product_type"], pd["product_id"], pd["booking_id"],
                pd["stripe_payment_intent_id"], pd["stripe_charge_id"], pd["stripe_transfer_id"],
                pd["status"], pd["currency"],
                pd["base_amount"], pd["payer_fixed_fee"], pd["payer_percent_fee_amount"],
                pd["receiver_fixed_fee"], pd["receiver_percent_fee_amount"],
                pd["platform_total_fee"], pd["receiver_net_amount"], pd["payer_total_amount"],
                json.dumps(pd["pricing_rule_snapshot"]),
            )

        row = await conn.fetchrow(
            f"SELECT {BOOKING_FIELDS} FROM bookings WHERE booking_id = $1", bid
        )

    # Notification push au bénéficiaire (coach / receiver)
    async with pool.acquire() as conn2:
        user_info = await conn2.fetchrow(
            "SELECT name FROM users WHERE user_id = $1", payer_user_id
        )
        svc_title = await conn2.fetchrow(
            "SELECT title FROM services WHERE service_id = $1", data.service_id
        )
    user_name = user_info["name"] if user_info else "Un utilisateur"
    svc_name = svc_title["title"] if svc_title else "votre service"

    asyncio.create_task(
        send_push_to_user(
            pool, receiver_user_id,
            title="Nouvelle réservation",
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
    )

    result = row_to_dict(row)
    # Désérialiser le snapshot pour la réponse
    if result.get("pricing_snapshot") and isinstance(result["pricing_snapshot"], str):
        result["pricing_snapshot"] = json.loads(result["pricing_snapshot"])
    return result


@router.get("/bookings/me")
async def my_bookings(request: Request):
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
    results = []
    for r in rows:
        d = row_to_dict(r)
        if d.get("pricing_snapshot") and isinstance(d["pricing_snapshot"], str):
            d["pricing_snapshot"] = json.loads(d["pricing_snapshot"])
        results.append(d)
    return results


@router.get("/bookings/received")
async def received_bookings(request: Request):
    """Réservations reçues par le bénéficiaire (ex-coach)."""
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
    results = []
    for r in rows:
        d = row_to_dict(r)
        if d.get("pricing_snapshot") and isinstance(d["pricing_snapshot"], str):
            d["pricing_snapshot"] = json.loads(d["pricing_snapshot"])
        results.append(d)
    return results


@router.patch("/bookings/{booking_id}/status")
async def update_booking_status(booking_id: str, request: Request):
    pool = get_pool()
    user = await require_auth(request, pool)
    body = await request.json()
    new_status = body.get("status")
    if new_status not in ("accepted", "refused", "cancelled", "completed"):
        raise HTTPException(status_code=400, detail="Invalid status")

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT booking_id, receiver_user_id, user_id FROM bookings WHERE booking_id = $1",
            booking_id,
        )
        if not row:
            raise HTTPException(status_code=404, detail="Booking not found")

        booking = dict(row)
        # Seul le bénéficiaire (receiver) peut accepter/refuser
        if new_status in ("accepted", "refused") and booking["receiver_user_id"] != user["user_id"]:
            raise HTTPException(status_code=403, detail="Only the receiver can accept or refuse")
        # Seul le payeur peut annuler
        if new_status == "cancelled" and booking["user_id"] != user["user_id"]:
            raise HTTPException(status_code=403, detail="Only the payer can cancel")

        await conn.execute(
            "UPDATE bookings SET status = $1, updated_at = NOW() WHERE booking_id = $2",
            new_status, booking_id,
        )
    return {"success": True, "status": new_status}
