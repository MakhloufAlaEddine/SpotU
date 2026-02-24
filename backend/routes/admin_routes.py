from fastapi import APIRouter, Request, HTTPException, Query
from datetime import datetime, timezone
from typing import Optional
from auth_utils import require_role
from database import get_db

router = APIRouter()


@router.get("/stats")
async def get_stats(request: Request):
    db = get_db()
    await require_role(request, db, "admin")
    total_users = await db.users.count_documents({})
    total_coaches = await db.users.count_documents({"role": "coach"})
    total_tagpoints = await db.tag_points.count_documents({"active": True})
    total_bookings = await db.bookings.count_documents({})
    total_paid = await db.bookings.count_documents({"payment_status": "paid"})
    # GMV
    paid_bookings = await db.bookings.find({"payment_status": "paid"}, {"amount": 1}).to_list(10000)
    gmv = sum(b.get("amount", 0) for b in paid_bookings)
    commission = round(gmv * 0.15, 2)
    return {
        "total_users": total_users,
        "total_coaches": total_coaches,
        "total_tagpoints": total_tagpoints,
        "total_bookings": total_bookings,
        "total_paid_bookings": total_paid,
        "gmv": round(gmv, 2),
        "platform_commission": commission,
    }


@router.get("/users")
async def list_users(
    request: Request,
    role: Optional[str] = Query(None),
    limit: int = Query(50),
):
    db = get_db()
    await require_role(request, db, "admin")
    query = {}
    if role:
        query["role"] = role
    users = await db.users.find(query, {"_id": 0, "password_hash": 0}).to_list(limit)
    return users


@router.put("/users/{user_id}/role")
async def set_user_role(user_id: str, request: Request):
    db = get_db()
    await require_role(request, db, "admin")
    body = await request.json()
    new_role = body.get("role")
    if new_role not in ("user", "coach", "admin"):
        raise HTTPException(status_code=400, detail="Invalid role")
    result = await db.users.update_one(
        {"user_id": user_id},
        {"$set": {"role": new_role, "updated_at": datetime.now(timezone.utc)}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"success": True}


@router.put("/users/{user_id}/verify-coach")
async def verify_coach(user_id: str, request: Request):
    db = get_db()
    await require_role(request, db, "admin")
    result = await db.users.update_one(
        {"user_id": user_id},
        {"$set": {"is_coach_verified": True, "role": "coach", "updated_at": datetime.now(timezone.utc)}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"success": True}


@router.get("/tag-points")
async def admin_tag_points(request: Request):
    db = get_db()
    await require_role(request, db, "admin")
    points = await db.tag_points.find({}, {"_id": 0}).to_list(500)
    return points


@router.delete("/tag-points/{point_id}")
async def admin_delete_tag_point(point_id: str, request: Request):
    db = get_db()
    await require_role(request, db, "admin")
    await db.tag_points.delete_one({"point_id": point_id})
    return {"success": True}


@router.get("/services")
async def admin_services(request: Request):
    db = get_db()
    await require_role(request, db, "admin")
    services = await db.services.find({}, {"_id": 0}).to_list(200)
    return services


@router.get("/domains")
async def admin_domains(request: Request):
    db = get_db()
    await require_role(request, db, "admin")
    domains = await db.domains.find({}, {"_id": 0}).to_list(50)
    return domains
