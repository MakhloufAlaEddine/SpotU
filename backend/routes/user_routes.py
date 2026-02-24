from fastapi import APIRouter, Request, HTTPException
from datetime import datetime, timezone
from models import UserUpdate
from auth_utils import require_auth, USER_FIELDS
from database import get_pool, row_to_dict, rows_to_list

router = APIRouter()


@router.get("/profile")
async def get_profile(request: Request):
    pool = get_pool()
    return await require_auth(request, pool)


@router.put("/profile")
async def update_profile(data: UserUpdate, request: Request):
    pool = get_pool()
    user = await require_auth(request, pool)
    update_fields = {k: v for k, v in data.model_dump().items() if v is not None}
    if not update_fields:
        return user

    set_clauses = []
    values = []
    i = 1
    for key, val in update_fields.items():
        set_clauses.append(f"{key} = ${i}")
        values.append(val)
        i += 1
    values.append(user["user_id"])
    set_clauses.append("updated_at = NOW()")

    query = f"UPDATE users SET {', '.join(set_clauses)} WHERE user_id = ${i}"
    async with pool.acquire() as conn:
        await conn.execute(query, *values)
        row = await conn.fetchrow(f"SELECT {USER_FIELDS} FROM users WHERE user_id = $1", user["user_id"])
    return row_to_dict(row)


@router.post("/become-coach")
async def become_coach(request: Request):
    pool = get_pool()
    user = await require_auth(request, pool)
    if user["role"] in ("coach", "admin"):
        raise HTTPException(status_code=400, detail="Already a coach or admin")
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE users SET role = 'coach', updated_at = NOW() WHERE user_id = $1",
            user["user_id"]
        )
        row = await conn.fetchrow(f"SELECT {USER_FIELDS} FROM users WHERE user_id = $1", user["user_id"])
    return row_to_dict(row)


@router.get("/{user_id}/public")
async def get_public_profile(user_id: str):
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT user_id, name, picture, role, bio, is_coach_verified, coach_tags, hourly_rate FROM users WHERE user_id = $1",
            user_id
        )
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        user = row_to_dict(row)

        # Review stats
        reviews = await conn.fetch(
            "SELECT rating FROM reviews WHERE reviewee_id = $1", user_id
        )
        if reviews:
            user["avg_rating"] = round(sum(r["rating"] for r in reviews) / len(reviews), 1)
            user["review_count"] = len(reviews)
        else:
            user["avg_rating"] = None
            user["review_count"] = 0

        # Services if coach
        if user.get("role") == "coach":
            svcs = await conn.fetch(
                "SELECT service_id, title, description, price, duration_min, location_description, max_participants, tag_ids, domain_id FROM services WHERE coach_id = $1 AND active = TRUE",
                user_id
            )
            user["services"] = rows_to_list(svcs)
    return user
