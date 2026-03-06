from fastapi import APIRouter, Request, HTTPException
from datetime import datetime, timezone
from models import UserUpdate, ProfileReviewCreate, new_id
from auth_utils import require_auth, USER_FIELDS
from database import get_pool, row_to_dict, rows_to_list

router = APIRouter()


@router.get("/profile")
async def get_profile(request: Request):
    pool = get_pool()
    user = await require_auth(request, pool)
    async with pool.acquire() as conn:
        reviews = await conn.fetch("SELECT rating FROM reviews WHERE reviewee_id = $1", user["user_id"])
        banking = await conn.fetchrow(
            "SELECT iban, bic, iban_name FROM users WHERE user_id = $1", user["user_id"]
        )
    if reviews:
        user["avg_rating"] = round(sum(r["rating"] for r in reviews) / len(reviews), 1)
        user["review_count"] = len(reviews)
    else:
        user["avg_rating"] = None
        user["review_count"] = 0
    if banking:
        user["iban"] = banking["iban"]
        user["bic"] = banking["bic"]
        user["iban_name"] = banking["iban_name"]
    return user


@router.put("/profile")
async def update_profile(data: UserUpdate, request: Request):
    from routes.upload_routes import delete_upload_file
    pool = get_pool()
    user = await require_auth(request, pool)
    # Fields that can be explicitly set to NULL to clear them
    CLEARABLE_FIELDS = {'iban', 'bic', 'iban_name', 'bio', 'phone', 'picture'}
    update_fields = {}
    for k, v in data.model_dump(exclude_unset=True).items():
        if v is not None:
            update_fields[k] = v
        elif k in CLEARABLE_FIELDS:
            update_fields[k] = None  # Allow explicitly clearing these fields
    if not update_fields:
        return user

    # Supprimer l'ancienne photo si elle est remplacée ou effacée
    if 'picture' in update_fields:
        old_picture = user.get("picture")
        if old_picture and old_picture != update_fields['picture']:
            delete_upload_file(old_picture)

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
            """SELECT user_id, name, picture, role, bio, is_coach_verified, coach_tags,
                      show_phone, show_reviews, phone
               FROM users WHERE user_id = $1""",
            user_id
        )
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        user = row_to_dict(row)

        # Phone: only expose if user opted in
        if not user.get("show_phone"):
            user["phone"] = None

        # Fetch tag details for interests (coach_tags)
        tag_ids = user.get("coach_tags") or []
        if isinstance(tag_ids, str):
            import json as _j
            try:
                tag_ids = _j.loads(tag_ids)
            except Exception:
                tag_ids = []
        if tag_ids:
            tag_rows = await conn.fetch(
                "SELECT tag_id, label_fr, label_en, icon FROM tags WHERE tag_id = ANY($1::text[])",
                tag_ids
            )
            user["interests"] = rows_to_list(tag_rows)
        else:
            user["interests"] = []

        # Review stats — only expose if user allows reviews
        if user.get("show_reviews"):
            all_reviews = await conn.fetch(
                "SELECT rating FROM reviews WHERE reviewee_id = $1", user_id
            )
            if all_reviews:
                user["avg_rating"] = round(sum(r["rating"] for r in all_reviews) / len(all_reviews), 1)
                user["review_count"] = len(all_reviews)
            else:
                user["avg_rating"] = None
                user["review_count"] = 0
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

        # Public tagpoints
        tp_rows = await conn.fetch(
            """SELECT point_id, title, images, event_date, event_schedule, domain_id, tag_ids
               FROM tag_points
               WHERE user_id = $1 AND active = TRUE AND is_public = TRUE
               ORDER BY created_at DESC LIMIT 20""",
            user_id
        )
        user["tag_points"] = rows_to_list(tp_rows)

    return user


@router.get("/{user_id}/reviews")
async def get_user_reviews(user_id: str):
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT show_reviews FROM users WHERE user_id = $1", user_id
        )
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        # Respect privacy: return empty list if user disabled reviews
        if not row["show_reviews"]:
            return []
        reviews = await conn.fetch(
            """SELECT r.review_id, r.rating, r.comment, r.created_at,
                      u.user_id as reviewer_id, u.name as reviewer_name, u.picture as reviewer_picture
               FROM reviews r
               JOIN users u ON u.user_id = r.reviewer_id
               WHERE r.reviewee_id = $1
               ORDER BY r.created_at DESC""",
            user_id
        )
        return rows_to_list(reviews)


@router.put("/{user_id}/reviews/{review_id}")
async def update_user_review(user_id: str, review_id: str, data: ProfileReviewCreate, request: Request):
    pool = get_pool()
    reviewer = await require_auth(request, pool)
    async with pool.acquire() as conn:
        existing = await conn.fetchrow(
            "SELECT review_id FROM reviews WHERE review_id = $1 AND reviewer_id = $2 AND reviewee_id = $3",
            review_id, reviewer["user_id"], user_id
        )
        if not existing:
            raise HTTPException(status_code=404, detail="Avis non trouvé ou non autorisé")
        await conn.execute(
            "UPDATE reviews SET rating = $1, comment = $2 WHERE review_id = $3",
            data.rating, data.comment, review_id
        )
        row = await conn.fetchrow(
            """SELECT r.review_id, r.rating, r.comment, r.created_at,
                      u.user_id as reviewer_id, u.name as reviewer_name, u.picture as reviewer_picture
               FROM reviews r
               JOIN users u ON u.user_id = r.reviewer_id
               WHERE r.review_id = $1""",
            review_id
        )
    review_data = row_to_dict(row)
    # Notifier le propriétaire du profil que l'avis a été modifié
    from push_service import send_push_to_user
    import asyncio
    action_text = "a modifié son évaluation de votre profil"
    stars = "⭐" * data.rating
    asyncio.create_task(send_push_to_user(
        pool, user_id,
        title="Évaluation modifiée",
        body=f'{action_text} {stars}',
        data={
            "type": "profile_review",
            "profile_id": user_id,
            "sender_id": reviewer["user_id"],
            "sender_name": reviewer.get("name", ""),
            "sender_picture": reviewer.get("picture") or "",
            "action_text": action_text,
            "content_title": "",
            "rating": data.rating,
        },
        notif_type="profile_review"
    ))
    return review_data


@router.post("/{user_id}/reviews")
async def create_user_review(user_id: str, data: ProfileReviewCreate, request: Request):
    pool = get_pool()
    reviewer = await require_auth(request, pool)

    if reviewer["user_id"] == user_id:
        raise HTTPException(status_code=400, detail="Cannot review yourself")

    async with pool.acquire() as conn:
        # Check target user exists and allows reviews
        target = await conn.fetchrow(
            "SELECT show_reviews FROM users WHERE user_id = $1", user_id
        )
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        if not target["show_reviews"]:
            raise HTTPException(status_code=403, detail="This user does not accept reviews")

        # Check for duplicate direct review (booking_id IS NULL)
        existing = await conn.fetchrow(
            "SELECT review_id FROM reviews WHERE reviewer_id = $1 AND reviewee_id = $2 AND booking_id IS NULL",
            reviewer["user_id"], user_id
        )
        if existing:
            raise HTTPException(status_code=409, detail="Vous avez déjà laissé un avis pour cet utilisateur")

        review_id = new_id("rev")
        await conn.execute(
            """INSERT INTO reviews (review_id, booking_id, reviewer_id, reviewee_id, rating, comment)
               VALUES ($1, NULL, $2, $3, $4, $5)""",
            review_id, reviewer["user_id"], user_id, data.rating, data.comment
        )

        row = await conn.fetchrow(
            """SELECT r.review_id, r.rating, r.comment, r.created_at,
                      u.user_id as reviewer_id, u.name as reviewer_name, u.picture as reviewer_picture
               FROM reviews r
               JOIN users u ON u.user_id = r.reviewer_id
               WHERE r.review_id = $1""",
            review_id
        )
    review_data = row_to_dict(row)
    # Notifier le propriétaire du profil évalué
    from push_service import send_push_to_user
    import asyncio
    action_text = "a évalué et commenté votre profil" if data.comment else "a évalué votre profil"
    stars = "⭐" * data.rating
    asyncio.create_task(send_push_to_user(
        pool, user_id,
        title="Nouvelle évaluation de profil",
        body=f'{action_text} {stars}',
        data={
            "type": "profile_review",
            "profile_id": user_id,
            "sender_id": reviewer["user_id"],
            "sender_name": reviewer.get("name", ""),
            "sender_picture": reviewer.get("picture") or "",
            "action_text": action_text,
            "content_title": "",
            "rating": data.rating,
        },
        notif_type="profile_review"
    ))
    return review_data

