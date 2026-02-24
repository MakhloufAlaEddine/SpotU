from fastapi import APIRouter, Request, HTTPException
from datetime import datetime, timezone
from models import BookingCreate, BookingStatusUpdate, new_id
from auth_utils import require_auth
from database import get_db

router = APIRouter()
COMMISSION_RATE = 0.15


@router.get("/bookings/mine")
async def my_bookings(request: Request):
    db = get_db()
    user = await require_auth(request, db)
    bookings = await db.bookings.find({"user_id": user["user_id"]}, {"_id": 0}).to_list(50)
    return await _enrich_bookings(db, bookings)


@router.get("/bookings/coach")
async def coach_bookings(request: Request):
    db = get_db()
    user = await require_auth(request, db)
    if user["role"] not in ("coach", "admin"):
        raise HTTPException(status_code=403, detail="Coach role required")
    bookings = await db.bookings.find({"coach_id": user["user_id"]}, {"_id": 0}).to_list(50)
    return await _enrich_bookings(db, bookings)


@router.get("/bookings/{booking_id}")
async def get_booking(booking_id: str, request: Request):
    db = get_db()
    user = await require_auth(request, db)
    booking = await db.bookings.find_one({"booking_id": booking_id}, {"_id": 0})
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking["user_id"] != user["user_id"] and booking["coach_id"] != user["user_id"] and user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")
    enriched = await _enrich_bookings(db, [booking])
    return enriched[0]


@router.post("/bookings")
async def create_booking(data: BookingCreate, request: Request):
    db = get_db()
    user = await require_auth(request, db)
    svc = await db.services.find_one({"service_id": data.service_id, "active": True})
    if not svc:
        raise HTTPException(status_code=404, detail="Service not found")
    if svc["coach_id"] == user["user_id"]:
        raise HTTPException(status_code=400, detail="Cannot book your own service")
    commission = round(svc["price"] * COMMISSION_RATE, 2)
    doc = {
        "booking_id": new_id("bkg"),
        "service_id": data.service_id,
        "user_id": user["user_id"],
        "coach_id": svc["coach_id"],
        "status": "pending",
        "scheduled_at": data.scheduled_at,
        "notes": data.notes,
        "amount": svc["price"],
        "commission": commission,
        "payment_status": "pending",
        "payment_session_id": None,
        "created_at": datetime.now(timezone.utc),
    }
    await db.bookings.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.put("/bookings/{booking_id}/status")
async def update_booking_status(booking_id: str, data: BookingStatusUpdate, request: Request):
    db = get_db()
    user = await require_auth(request, db)
    booking = await db.bookings.find_one({"booking_id": booking_id})
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking["coach_id"] != user["user_id"] and user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")
    await db.bookings.update_one(
        {"booking_id": booking_id},
        {"$set": {"status": data.status, "updated_at": datetime.now(timezone.utc)}}
    )
    updated = await db.bookings.find_one({"booking_id": booking_id}, {"_id": 0})
    return updated


async def _enrich_bookings(db, bookings: list) -> list:
    result = []
    for b in bookings:
        svc = await db.services.find_one({"service_id": b["service_id"]}, {"_id": 0})
        b["service"] = svc
        if svc:
            coach = await db.users.find_one(
                {"user_id": svc["coach_id"]},
                {"_id": 0, "password_hash": 0, "email": 0}
            )
            b["coach"] = coach
        result.append(b)
    return result
