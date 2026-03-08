from fastapi import APIRouter, Request, HTTPException, Query
from datetime import datetime, timezone
from typing import Optional
from auth_utils import require_role
from database import get_pool, row_to_dict, rows_to_list
from models import new_id

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

        # GMV = somme des montants payés (payer_total_amount dans le snapshot, sinon amount)
        gmv_row = await conn.fetchrow(
            """SELECT COALESCE(
                SUM(COALESCE(
                    (pricing_snapshot->>'payer_total_amount')::numeric,
                    amount
                )), 0) AS gmv
               FROM bookings WHERE payment_status = 'paid'"""
        )
        gmv = float(gmv_row["gmv"]) if gmv_row else 0.0

        # Frais plateforme tirés du snapshot (source de vérité)
        fees_row = await conn.fetchrow(
            """SELECT COALESCE(
                SUM((pricing_snapshot->>'platform_total_fee')::numeric), 0
               ) AS fees
               FROM bookings WHERE payment_status = 'paid' AND pricing_snapshot IS NOT NULL"""
        )
        platform_fees = float(fees_row["fees"]) if fees_row else 0.0

    return {
        "total_users": total_users,
        "total_coaches": total_coaches,
        "total_tagpoints": total_tagpoints,
        "total_bookings": total_bookings,
        "total_paid_bookings": total_paid,
        "gmv": round(gmv, 2),
        "platform_commission": round(platform_fees, 2),
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


@router.get("/pricing-rules")
async def list_pricing_rules(request: Request):
    pool = get_pool()
    await require_role(request, pool, "admin")
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT * FROM pricing_rules ORDER BY product_type, priority DESC"
        )
    return rows_to_list(rows)


@router.post("/pricing-rules")
async def create_pricing_rule(request: Request):
    pool = get_pool()
    await require_role(request, pool, "admin")
    body = await request.json()
    required = {"product_type", "name"}
    if not required.issubset(body.keys()):
        raise HTTPException(status_code=400, detail="product_type and name are required")
    rule_id = new_id("rule")
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """INSERT INTO pricing_rules
               (rule_id, product_type, name, payer_fixed_fee, payer_percent_fee,
                receiver_fixed_fee, receiver_percent_fee, active, priority)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *""",
            rule_id,
            body["product_type"], body["name"],
            float(body.get("payer_fixed_fee", 0)),
            float(body.get("payer_percent_fee", 0)),
            float(body.get("receiver_fixed_fee", 0)),
            float(body.get("receiver_percent_fee", 0)),
            bool(body.get("active", True)),
            int(body.get("priority", 0)),
        )
    return row_to_dict(row)


@router.put("/pricing-rules/{rule_id}")
async def update_pricing_rule(rule_id: str, request: Request):
    pool = get_pool()
    await require_role(request, pool, "admin")
    body = await request.json()
    allowed = {
        "name", "payer_fixed_fee", "payer_percent_fee",
        "receiver_fixed_fee", "receiver_percent_fee", "active", "priority",
    }
    fields = {k: v for k, v in body.items() if k in allowed}
    if not fields:
        raise HTTPException(status_code=400, detail="No valid fields to update")
    set_clause = ", ".join(f"{k} = ${i+2}" for i, k in enumerate(fields))
    async with pool.acquire() as conn:
        result = await conn.execute(
            f"UPDATE pricing_rules SET {set_clause}, updated_at = NOW() WHERE rule_id = $1",
            rule_id, *fields.values(),
        )
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail="Rule not found")
    return {"success": True}


@router.delete("/pricing-rules/{rule_id}")
async def delete_pricing_rule(rule_id: str, request: Request):
    pool = get_pool()
    await require_role(request, pool, "admin")
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM pricing_rules WHERE rule_id = $1", rule_id)
    return {"success": True}


# ── Plans d'abonnement ─────────────────────────────────────────────────────────

@router.get("/subscription-plans")
async def list_subscription_plans(request: Request):
    pool = get_pool()
    await require_role(request, pool, "admin")
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT * FROM subscription_plans ORDER BY priority DESC, created_at"
        )
    return rows_to_list(rows)


@router.post("/subscription-plans")
async def create_subscription_plan(request: Request):
    pool = get_pool()
    await require_role(request, pool, "admin")
    body = await request.json()
    if "name" not in body:
        raise HTTPException(status_code=400, detail="name is required")
    plan_id = new_id("plan")
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """INSERT INTO subscription_plans
               (plan_id, name, description, price, duration_days,
                exempt_payer_fixed, exempt_payer_percent,
                exempt_receiver_fixed, exempt_receiver_percent,
                active, priority)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *""",
            plan_id,
            body["name"],
            body.get("description"),
            float(body.get("price", 0)),
            body.get("duration_days"),
            bool(body.get("exempt_payer_fixed", False)),
            bool(body.get("exempt_payer_percent", False)),
            bool(body.get("exempt_receiver_fixed", False)),
            bool(body.get("exempt_receiver_percent", False)),
            bool(body.get("active", True)),
            int(body.get("priority", 0)),
        )
    return row_to_dict(row)


@router.put("/subscription-plans/{plan_id}")
async def update_subscription_plan(plan_id: str, request: Request):
    pool = get_pool()
    await require_role(request, pool, "admin")
    body = await request.json()
    allowed = {
        "name", "description", "price", "duration_days",
        "exempt_payer_fixed", "exempt_payer_percent",
        "exempt_receiver_fixed", "exempt_receiver_percent",
        "active", "priority",
    }
    fields = {k: v for k, v in body.items() if k in allowed}
    if not fields:
        raise HTTPException(status_code=400, detail="No valid fields to update")
    set_clause = ", ".join(f"{k} = ${i+2}" for i, k in enumerate(fields))
    async with pool.acquire() as conn:
        result = await conn.execute(
            f"UPDATE subscription_plans SET {set_clause}, updated_at = NOW() WHERE plan_id = $1",
            plan_id, *fields.values(),
        )
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail="Plan not found")
    return {"success": True}


    pool = get_pool()
    await require_role(request, pool, "admin")
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM domains ORDER BY name")
    return rows_to_list(rows)
