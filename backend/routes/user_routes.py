from fastapi import APIRouter, Request, HTTPException
from datetime import datetime, timezone
from models import UserUpdate
from auth_utils import require_auth
from database import get_db

router = APIRouter()


@router.get("/profile")
async def get_profile(request: Request):
    db = get_db()
    return await require_auth(request, db)


@router.put("/profile")
async def update_profile(data: UserUpdate, request: Request):
    db = get_db()
    user = await require_auth(request, db)
    update_fields = {k: v for k, v in data.model_dump().items() if v is not None}
    update_fields["updated_at"] = datetime.now(timezone.utc)
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": update_fields})
    updated = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "password_hash": 0})
    return updated


@router.post("/become-coach")
async def become_coach(request: Request):
    db = get_db()
    user = await require_auth(request, db)
    if user["role"] in ("coach", "admin"):
        raise HTTPException(status_code=400, detail="Already a coach or admin")
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"role": "coach", "updated_at": datetime.now(timezone.utc)}}
    )
    updated = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "password_hash": 0})
    return updated


@router.get("/{user_id}/public")
async def get_public_profile(user_id: str):
    db = get_db()
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0, "email": 0, "phone": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    # Add review stats
    reviews = await db.reviews.find({"reviewee_id": user_id}).to_list(100)
    if reviews:
        user["avg_rating"] = round(sum(r["rating"] for r in reviews) / len(reviews), 1)
        user["review_count"] = len(reviews)
    else:
        user["avg_rating"] = None
        user["review_count"] = 0
    # Add services if coach
    if user.get("role") == "coach":
        services = await db.services.find({"coach_id": user_id, "active": True}, {"_id": 0}).to_list(20)
        user["services"] = services
    return user
