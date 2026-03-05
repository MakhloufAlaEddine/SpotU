from fastapi import APIRouter, Request, HTTPException, Query
from datetime import datetime, timezone
from typing import Optional
from auth_utils import require_role
from database import get_pool, row_to_dict, rows_to_list

router = APIRouter()


@router.get("/stats")
async def get_stats(request: Request):
    pool = get_pool()
    await require_role(request, pool, "admin")
    async with pool.acquire() as conn:
        total_users = await conn.fetchval("SELECT COUNT(*) FROM users")
        total_coaches = await conn.fetchval("SELECT COUNT(*) FROM users WHERE role = 'coach'")
        total_tagpoints = await conn.fetchval("SELECT COUNT(*) FROM tag_points WHERE active = TRUE")
        total_bookings = await conn.fetchval("SELECT COUNT(*) FROM bookings")
        total_paid = await conn.fetchval("SELECT COUNT(*) FROM bookings WHERE payment_status = 'paid'")
        gmv_row = await conn.fetchrow("SELECT COALESCE(SUM(amount), 0) as gmv FROM bookings WHERE payment_status = 'paid'")
        gmv = float(gmv_row["gmv"]) if gmv_row else 0.0
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
    limit: int = Query(50, ge=1, le=500),
):
    pool = get_pool()
    await require_role(request, pool, "admin")
    async with pool.acquire() as conn:
        if role:
            rows = await conn.fetch(
                "SELECT user_id, email, name, role, is_coach_verified, created_at FROM users WHERE role = $1 ORDER BY created_at DESC LIMIT $2",
                role, limit
            )
        else:
            rows = await conn.fetch(
                "SELECT user_id, email, name, role, is_coach_verified, created_at FROM users ORDER BY created_at DESC LIMIT $1",
                limit
            )
    return rows_to_list(rows)


@router.put("/users/{user_id}/role")
async def set_user_role(user_id: str, request: Request):
    pool = get_pool()
    await require_role(request, pool, "admin")
    body = await request.json()
    new_role = body.get("role")
    if new_role not in ("user", "coach", "admin"):
        raise HTTPException(status_code=400, detail="Invalid role")
    async with pool.acquire() as conn:
        result = await conn.execute(
            "UPDATE users SET role = $1, updated_at = NOW() WHERE user_id = $2",
            new_role, user_id
        )
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail="User not found")
    return {"success": True}


@router.put("/users/{user_id}/verify-coach")
async def verify_coach(user_id: str, request: Request):
    pool = get_pool()
    await require_role(request, pool, "admin")
    async with pool.acquire() as conn:
        result = await conn.execute(
            "UPDATE users SET is_coach_verified = TRUE, role = 'coach', updated_at = NOW() WHERE user_id = $1",
            user_id
        )
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail="User not found")
    return {"success": True}


@router.get("/tag-points")
async def admin_tag_points(request: Request):
    pool = get_pool()
    await require_role(request, pool, "admin")
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT point_id, user_id, title, domain_id, active, created_at FROM tag_points ORDER BY created_at DESC LIMIT 500"
        )
    return rows_to_list(rows)


@router.delete("/tag-points/{point_id}")
async def admin_delete_tag_point(point_id: str, request: Request):
    pool = get_pool()
    await require_role(request, pool, "admin")
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM tag_points WHERE point_id = $1", point_id)
    return {"success": True}


@router.get("/services")
async def admin_services(request: Request):
    pool = get_pool()
    await require_role(request, pool, "admin")
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT service_id, coach_id, title, price, active, created_at FROM services ORDER BY created_at DESC LIMIT 200"
        )
    return rows_to_list(rows)


@router.get("/domains")
async def admin_domains(request: Request):
    pool = get_pool()
    await require_role(request, pool, "admin")
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM domains ORDER BY name")
    return rows_to_list(rows)
