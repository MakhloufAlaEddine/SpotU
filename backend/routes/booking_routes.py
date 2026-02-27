from fastapi import APIRouter, Request, HTTPException
from datetime import datetime, timezone
from models import BookingCreate, BookingStatusUpdate, new_id
from auth_utils import require_auth
from database import get_pool, row_to_dict, rows_to_list

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
        result.append(b)
    return result


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
    return row_to_dict(updated)
