from fastapi import APIRouter, Request, HTTPException
from datetime import datetime, timezone
from models import BookingCreate, BookingStatusUpdate, new_id
from auth_utils import require_auth
from database import get_pool, row_to_dict, rows_to_list
from push_service import send_push_to_user
import asyncio

router = APIRouter()
COMMISSION_RATE = 0.15
BOOKING_FIELDS = "booking_id, service_id, user_id, coach_id, status, scheduled_at, slot_id, location_id, notes, amount, commission, payment_status, payment_session_id, created_at"


async def _enrich_bookings(conn, bookings: list) -> list:
    result = []
    for b in bookings:
        svc_row = await conn.fetchrow(
            "SELECT service_id, title, description, price, duration_min, location_description FROM services WHERE service_id = $1",
            b["service_id"]
        )
        b["service"] = row_to_dict(svc_row)
        if b.get("coach_id"):
            coach_row = await conn.fetchrow(
                "SELECT user_id, name, picture FROM users WHERE user_id = $1", b["coach_id"]
            )
            b["coach"] = row_to_dict(coach_row)
        if b.get("user_id"):
            user_row = await conn.fetchrow(
                "SELECT user_id, name, picture FROM users WHERE user_id = $1", b["user_id"]
            )
            b["user"] = row_to_dict(user_row)
        if b.get("slot_id"):
            slot_row = await conn.fetchrow(
                "SELECT slot_id, slot_type, slot_date, day_of_week, start_time, end_time FROM service_slots WHERE slot_id = $1",
                b["slot_id"]
            )
            b["slot"] = row_to_dict(slot_row)
        result.append(b)
    return result


@router.get("/bookings/service/{service_id}")
async def service_bookings(service_id: str, request: Request):
    """Coach : toutes les demandes pour ce service.
       User  : uniquement sa propre demande."""
    pool = get_pool()
    user = await require_auth(request, pool)
    async with pool.acquire() as conn:
        # Vérifier que le service existe et récupérer le coach_id
        svc = await conn.fetchrow("SELECT coach_id FROM services WHERE service_id = $1", service_id)
        if not svc:
            raise HTTPException(status_code=404, detail="Service not found")
        is_owner = svc["coach_id"] == user["user_id"]
        if is_owner:
            rows = await conn.fetch(
                f"SELECT {BOOKING_FIELDS} FROM bookings WHERE service_id = $1 ORDER BY created_at DESC",
                service_id
            )
        else:
            rows = await conn.fetch(
                f"SELECT {BOOKING_FIELDS} FROM bookings WHERE service_id = $1 AND user_id = $2 ORDER BY created_at DESC",
                service_id, user["user_id"]
            )
        bookings = rows_to_list(rows)
        return await _enrich_bookings(conn, bookings)


@router.get("/bookings/mine")
async def my_bookings(request: Request):
    pool = get_pool()
    user = await require_auth(request, pool)
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT {BOOKING_FIELDS} FROM bookings WHERE user_id = $1 ORDER BY created_at DESC".format(BOOKING_FIELDS=BOOKING_FIELDS),
            user["user_id"]
        )
        bookings = rows_to_list(rows)
        return await _enrich_bookings(conn, bookings)


@router.get("/bookings/coach")
async def coach_bookings(request: Request):
    pool = get_pool()
    user = await require_auth(request, pool)
    if user["role"] not in ("coach", "admin"):
        raise HTTPException(status_code=403, detail="Coach role required")
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT {BOOKING_FIELDS} FROM bookings WHERE coach_id = $1 ORDER BY created_at DESC".format(BOOKING_FIELDS=BOOKING_FIELDS),
            user["user_id"]
        )
        bookings = rows_to_list(rows)
        return await _enrich_bookings(conn, bookings)


@router.get("/bookings/{booking_id}")
async def get_booking(booking_id: str, request: Request):
    pool = get_pool()
    user = await require_auth(request, pool)
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT {BOOKING_FIELDS} FROM bookings WHERE booking_id = $1".format(BOOKING_FIELDS=BOOKING_FIELDS),
            booking_id
        )
        if not row:
            raise HTTPException(status_code=404, detail="Booking not found")
        booking = row_to_dict(row)
        if booking["user_id"] != user["user_id"] and booking["coach_id"] != user["user_id"] and user["role"] != "admin":
            raise HTTPException(status_code=403, detail="Not authorized")
        enriched = await _enrich_bookings(conn, [booking])
    return enriched[0]


async def _change_booking_status(booking_id: str, new_status: str, request: Request):
    pool = get_pool()
    user = await require_auth(request, pool)
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT coach_id, user_id, service_id FROM bookings WHERE booking_id = $1", booking_id
        )
        if not row:
            raise HTTPException(status_code=404, detail="Booking not found")
        if row["coach_id"] != user["user_id"] and user["role"] != "admin":
            raise HTTPException(status_code=403, detail="Not authorized")
        await conn.execute(
            "UPDATE bookings SET status = $1, updated_at = NOW() WHERE booking_id = $2",
            new_status, booking_id
        )
        updated = await conn.fetchrow(
            f"SELECT {BOOKING_FIELDS} FROM bookings WHERE booking_id = $1", booking_id
        )
    booking = row_to_dict(updated)
    async with pool.acquire() as conn2:
        svc_row = await conn2.fetchrow("SELECT title FROM services WHERE service_id = $1", booking["service_id"])
    svc_name = svc_row["title"] if svc_row else "votre service"
    status_fr = "acceptée ✅" if new_status == "accepted" else "refusée ❌"
    asyncio.create_task(send_push_to_user(
        pool, booking["user_id"],
        title=f"Réservation {status_fr}",
        body=f"Votre réservation pour {svc_name} a été {status_fr}",
        data={"type": "booking_status", "bookingId": booking_id, "status": new_status}
    ))
    return booking


@router.post("/bookings/{booking_id}/accept")
async def accept_booking(booking_id: str, request: Request):
    return await _change_booking_status(booking_id, "accepted", request)


@router.post("/bookings/{booking_id}/refuse")
async def refuse_booking(booking_id: str, request: Request):
    return await _change_booking_status(booking_id, "refused", request)


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
        commission = round(float(svc["price"]) * COMMISSION_RATE, 2)
        bid = new_id("bkg")
        await conn.execute(
            """INSERT INTO bookings
               (booking_id, service_id, user_id, coach_id, status, scheduled_at,
                slot_id, location_id, notes, amount, commission, payment_status)
               VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, $8, $9, $10, 'pending')""",
            bid, data.service_id, user["user_id"], svc["coach_id"],
            data.scheduled_at, data.slot_id, data.location_id,
            data.notes, float(svc["price"]), commission
        )
        row = await conn.fetchrow(
            "SELECT {BOOKING_FIELDS} FROM bookings WHERE booking_id = $1".format(BOOKING_FIELDS=BOOKING_FIELDS),
            bid
        )
    # Push notification au coach
    async with pool.acquire() as conn2:
        user_info = await conn2.fetchrow("SELECT name FROM users WHERE user_id = $1", user["user_id"])
        svc_title = await conn2.fetchrow("SELECT title FROM services WHERE service_id = $1", data.service_id)
    user_name = user_info["name"] if user_info else "Un utilisateur"
    svc_name = svc_title["title"] if svc_title else "votre service"
    asyncio.create_task(send_push_to_user(
        pool, svc["coach_id"],
        title="Nouvelle réservation",
        body=f"{user_name} souhaite réserver : {svc_name}",
        data={"type": "new_booking", "bookingId": bid}
    ))
    return row_to_dict(row)


@router.put("/bookings/{booking_id}/status")
async def update_booking_status(booking_id: str, data: BookingStatusUpdate, request: Request):
    pool = get_pool()
    user = await require_auth(request, pool)
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT coach_id FROM bookings WHERE booking_id = $1", booking_id)
        if not row:
            raise HTTPException(status_code=404, detail="Booking not found")
        if row["coach_id"] != user["user_id"] and user["role"] != "admin":
            raise HTTPException(status_code=403, detail="Not authorized")
        await conn.execute(
            "UPDATE bookings SET status = $1, updated_at = NOW() WHERE booking_id = $2",
            data.status, booking_id
        )
        updated = await conn.fetchrow(
            "SELECT booking_id, service_id, user_id, coach_id, status, amount, commission, payment_status, created_at FROM bookings WHERE booking_id = $1",
            booking_id
        )
    booking = row_to_dict(updated)
    # Push notification à l'utilisateur
    async with pool.acquire() as conn2:
        svc_row = await conn2.fetchrow("SELECT title FROM services WHERE service_id = $1", booking["service_id"])
    svc_name = svc_row["title"] if svc_row else "votre service"
    status_fr = "acceptée ✅" if data.status == "accepted" else "refusée ❌"
    asyncio.create_task(send_push_to_user(
        pool, booking["user_id"],
        title=f"Réservation {status_fr}",
        body=f"Votre réservation pour {svc_name} a été {status_fr}",
        data={"type": "booking_status", "bookingId": booking_id, "status": data.status}
    ))
    return booking
