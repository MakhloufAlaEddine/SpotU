from fastapi import APIRouter, Request, HTTPException
from models import BookingCreate, new_id
from auth_utils import require_auth
from database import get_pool, row_to_dict
from push_service import send_push_to_user
import asyncio

router = APIRouter()

BOOKING_FIELDS = "booking_id, service_id, user_id, coach_id, status, scheduled_at, slot_id, location_id, notes, amount, created_at"


@router.post("/bookings")
async def create_booking(data: BookingCreate, request: Request):
    pool = get_pool()
    user = await require_auth(request, pool)
    async with pool.acquire() as conn:
        svc_row = await conn.fetchrow(
            "SELECT service_id, coach_id, price FROM services WHERE service_id = $1 AND active = TRUE",
            data.service_id
        )
        if not svc_row:
            raise HTTPException(status_code=404, detail="Service not found")
        svc = dict(svc_row)
        if svc["coach_id"] == user["user_id"]:
            raise HTTPException(status_code=400, detail="Cannot book your own service")
        bid = new_id("bkg")
        await conn.execute(
            """INSERT INTO bookings
               (booking_id, service_id, user_id, coach_id, status, scheduled_at,
                slot_id, location_id, notes, amount)
               VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, $8, $9)""",
            bid, data.service_id, user["user_id"], svc["coach_id"],
            data.scheduled_at, data.slot_id, data.location_id,
            data.notes, float(svc["price"])
        )
        row = await conn.fetchrow(
            f"SELECT {BOOKING_FIELDS} FROM bookings WHERE booking_id = $1", bid
        )
    # Notification push au coach
    async with pool.acquire() as conn2:
        user_info = await conn2.fetchrow("SELECT name FROM users WHERE user_id = $1", user["user_id"])
        svc_title = await conn2.fetchrow("SELECT title FROM services WHERE service_id = $1", data.service_id)
    user_name = user_info["name"] if user_info else "Un utilisateur"
    svc_name = svc_title["title"] if svc_title else "votre service"
    asyncio.create_task(send_push_to_user(
        pool, svc["coach_id"],
        title="Nouvelle réservation",
        body=f"{user_name} souhaite réserver : {svc_name}",
        data={
            "type": "new_booking", "bookingId": bid, "service_id": data.service_id,
            "sender_id": user["user_id"], "sender_name": user.get("name", ""),
            "sender_picture": user.get("picture") or "",
            "action_text": "souhaite réserver",
            "content_title": svc_name,
        },
        notif_type="new_booking"
    ))
    return row_to_dict(row)
