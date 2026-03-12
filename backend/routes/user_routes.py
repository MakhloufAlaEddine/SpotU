from fastapi import APIRouter, Request, HTTPException
from datetime import datetime, timezone
from models import UserUpdate, ProfileReviewCreate, new_id
from auth_utils import require_auth, get_optional_auth, USER_FIELDS
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
async def get_public_profile(user_id: str, request: Request):
    pool = get_pool()
    # Try to get current user (optional auth)
    try:
        me = await require_auth(request, pool)
        me_id = me["user_id"]
    except Exception:
        me_id = None

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """SELECT user_id, name, picture, cover_picture, cover_offset_y, cover_scale, role, bio, is_coach_verified, coach_tags,
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

        # Followers / Following counts
        followers_count = await conn.fetchval(
            "SELECT COUNT(*) FROM user_follows WHERE following_id = $1", user_id
        )
        following_count = await conn.fetchval(
            "SELECT COUNT(*) FROM user_follows WHERE follower_id = $1", user_id
        )
        user["followers_count"] = int(followers_count or 0)
        user["following_count"] = int(following_count or 0)

        # Is current user following this profile?
        if me_id and me_id != user_id:
            is_following = await conn.fetchval(
                "SELECT EXISTS(SELECT 1 FROM user_follows WHERE follower_id=$1 AND following_id=$2)",
                me_id, user_id
            )
            user["is_following"] = bool(is_following)
        else:
            user["is_following"] = False

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
                "SELECT service_id, title, description, price, duration_min, location_description, max_participants, tag_ids, domain_id, images FROM services WHERE coach_id = $1 AND active = TRUE",
                user_id
            )
            user["services"] = rows_to_list(svcs)

        # Public tagpoints — enriched for SpotYouCard carousel
        tp_rows = await conn.fetch(
            """SELECT point_id, title, images, event_date, event_schedule, domain_id, tag_ids,
                      minimum_participants, maximum_participants, is_public
               FROM tag_points
               WHERE user_id = $1 AND active = TRUE AND is_public = TRUE
               ORDER BY created_at DESC LIMIT 20""",
            user_id
        )
        tag_points = rows_to_list(tp_rows)

        if tag_points:
            point_ids = [tp["point_id"] for tp in tag_points]

            # Batch: participants_count
            part_rows = await conn.fetch(
                "SELECT spot_you_id, COUNT(*) as cnt FROM spot_you_members WHERE spot_you_id = ANY($1::text[]) GROUP BY spot_you_id",
                point_ids
            )
            part_map = {r["spot_you_id"]: int(r["cnt"]) for r in part_rows}

            # Batch: going_count (next upcoming session only — approximate by counting all)
            going_rows = await conn.fetch(
                "SELECT spot_you_id, COUNT(*) as cnt FROM spot_you_attendance WHERE spot_you_id = ANY($1::text[]) AND status = 'going' GROUP BY spot_you_id",
                point_ids
            )
            going_map = {r["spot_you_id"]: int(r["cnt"]) for r in going_rows}

            # Batch: rating + vote_count
            vote_rows = await conn.fetch(
                "SELECT point_id, ROUND(AVG(rating)::numeric,1) as avg_r, COUNT(*) as vcnt FROM tag_point_votes WHERE point_id = ANY($1::text[]) GROUP BY point_id",
                point_ids
            )
            rating_map = {r["point_id"]: (float(r["avg_r"]), int(r["vcnt"])) for r in vote_rows}

            # Compute next_session_date per tag_point
            from routes.spot_you_routes import get_next_session_date as _get_next
            for tp in tag_points:
                pid = tp["point_id"]
                tp["participants_count"] = part_map.get(pid, 0)
                tp["going_count"] = going_map.get(pid, 0)
                rv = rating_map.get(pid)
                tp["rating"] = rv[0] if rv else 0
                tp["vote_count"] = rv[1] if rv else 0
                nd = _get_next(tp)
                tp["next_session_date"] = nd.isoformat() if nd else None
                max_p = tp.get("maximum_participants")
                tp["is_full"] = max_p is not None and tp["going_count"] >= max_p

        user["tag_points"] = tag_points

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



@router.get("/me/activity-feed")
async def get_activity_feed(request: Request):
    """
    Fil d'activité personnel — agrège l'activité de tous les SpotYou
    dont l'utilisateur est membre.

    Règles :
    - "going" : session_date >= today uniquement
    - "joined" : rejoints dans les 30 derniers jours, excluant l'utilisateur lui-même
    - Résultat trié par timestamp DESC, max 30 items
    """
    from datetime import timedelta, date as date_type

    pool = get_pool()
    user = await require_auth(request, pool)

    async with pool.acquire() as conn:
        now = datetime.now(timezone.utc)
        today = now.date()
        cutoff = now - timedelta(days=30)

        # SpotYou dont l'utilisateur est membre
        member_spots = await conn.fetch(
            """SELECT p.spot_you_id, tp.title
               FROM spot_you_members p
               JOIN tag_points tp ON tp.point_id = p.spot_you_id
               WHERE p.user_id = $1 AND tp.active = TRUE""",
            user["user_id"],
        )

        if not member_spots:
            return {"activities": []}

        spot_ids = [row["spot_you_id"] for row in member_spots]
        spot_titles = {row["spot_you_id"]: row["title"] for row in member_spots}

        DAY_NAMES = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
        activities: list[dict] = []

        # ── Présences futures ────────────────────────────────────────────────
        going_rows = await conn.fetch(
            """SELECT a.user_id, a.spot_you_id, a.session_date, a.created_at,
                      u.name, u.picture
               FROM spot_you_attendance a
               JOIN users u ON a.user_id = u.user_id
               WHERE a.spot_you_id = ANY($1)
                 AND a.status = 'going'
                 AND a.session_date >= $2
               ORDER BY a.created_at DESC
               LIMIT 80""",
            spot_ids, today,
        )
        for row in going_rows:
            session_date: date_type = row["session_date"]
            days_diff = (session_date - today).days
            if days_diff == 0:
                day_label = "aujourd'hui"
            elif days_diff == 1:
                day_label = "demain"
            else:
                day_label = DAY_NAMES[session_date.weekday()]
            spot_id = row["spot_you_id"]
            activities.append({
                "type": "going",
                "user_id": row["user_id"],
                "name": row["name"],
                "picture": row["picture"],
                "action_text": f"vient {day_label}",
                "session_date": session_date.isoformat(),
                "spot_you_id": spot_id,
                "spot_you_title": spot_titles.get(spot_id, ""),
                "timestamp": row["created_at"].isoformat(),
            })

        # ── Rejoints récents (sans l'utilisateur lui-même) ───────────────────
        join_rows = await conn.fetch(
            """SELECT p.user_id, p.spot_you_id, p.joined_at,
                      u.name, u.picture
               FROM spot_you_members p
               JOIN users u ON p.user_id = u.user_id
               WHERE p.spot_you_id = ANY($1)
                 AND p.user_id != $2
                 AND p.joined_at >= $3
               ORDER BY p.joined_at DESC
               LIMIT 80""",
            spot_ids, user["user_id"], cutoff,
        )
        for row in join_rows:
            spot_id = row["spot_you_id"]
            activities.append({
                "type": "joined",
                "user_id": row["user_id"],
                "name": row["name"],
                "picture": row["picture"],
                "action_text": "a rejoint",
                "session_date": None,
                "spot_you_id": spot_id,
                "spot_you_title": spot_titles.get(spot_id, ""),
                "timestamp": row["joined_at"].isoformat(),
            })

        # Déduplique (même user, même type, même jour, même spot)
        seen: set[tuple] = set()
        unique: list[dict] = []
        for a in activities:
            key = (a["user_id"], a["type"], a.get("session_date"), a["spot_you_id"])
            if key not in seen:
                seen.add(key)
                unique.append(a)

        unique.sort(key=lambda x: x["timestamp"], reverse=True)

    return {"activities": unique[:30]}


# ── FOLLOW SYSTEM ──────────────────────────────────────────────────────────

@router.post("/{user_id}/follow")
async def follow_user(user_id: str, request: Request):
    pool = get_pool()
    me = await require_auth(request, pool)
    if me["user_id"] == user_id:
        raise HTTPException(status_code=400, detail="Vous ne pouvez pas vous suivre vous-même.")
    async with pool.acquire() as conn:
        target = await conn.fetchval("SELECT user_id FROM users WHERE user_id=$1", user_id)
        if not target:
            raise HTTPException(status_code=404, detail="Utilisateur introuvable.")
        await conn.execute(
            "INSERT INTO user_follows(follower_id, following_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
            me["user_id"], user_id
        )
        followers = await conn.fetchval("SELECT COUNT(*) FROM user_follows WHERE following_id=$1", user_id)
    return {"is_following": True, "followers_count": int(followers)}


@router.delete("/{user_id}/follow")
async def unfollow_user(user_id: str, request: Request):
    pool = get_pool()
    me = await require_auth(request, pool)
    async with pool.acquire() as conn:
        await conn.execute(
            "DELETE FROM user_follows WHERE follower_id=$1 AND following_id=$2",
            me["user_id"], user_id
        )
        followers = await conn.fetchval("SELECT COUNT(*) FROM user_follows WHERE following_id=$1", user_id)
    return {"is_following": False, "followers_count": int(followers)}


@router.patch("/{user_id}/cover")
async def update_cover(user_id: str, request: Request):
    """Met à jour la photo de couverture du profil et son cadrage."""
    pool = get_pool()
    me = await require_auth(request, pool)
    if me["user_id"] != user_id:
        raise HTTPException(status_code=403, detail="Accès refusé.")
    body = await request.json()
    cover_url = body.get("cover_picture", "")
    cover_offset_y = body.get("cover_offset_y")
    cover_scale = body.get("cover_scale")

    async with pool.acquire() as conn:
        # Récupérer l'ancienne cover avant mise à jour (pour suppression)
        old_row = await conn.fetchrow(
            "SELECT cover_picture FROM users WHERE user_id=$1", user_id
        )
        old_cover = old_row["cover_picture"] if old_row else None

        if cover_offset_y is not None or cover_scale is not None:
            offset_val = float(cover_offset_y) if cover_offset_y is not None else 0.5
            scale_val = float(cover_scale) if cover_scale is not None else 1.0
            await conn.execute(
                "UPDATE users SET cover_picture=$1, cover_offset_y=$2, cover_scale=$3, updated_at=NOW() WHERE user_id=$4",
                cover_url or None, offset_val, scale_val, user_id
            )
        else:
            await conn.execute(
                "UPDATE users SET cover_picture=$1, updated_at=NOW() WHERE user_id=$2",
                cover_url or None, user_id
            )

    # Supprimer l'ancienne photo si elle est remplacée et c'est un upload local
    # (les URLs externes Pexels/Unsplash ne sont pas concernées — delete_upload_file vérifie /api/uploads/)
    if old_cover and old_cover != (cover_url or None):
        from routes.upload_routes import delete_upload_file
        delete_upload_file(old_cover)

    return {"cover_picture": cover_url or None, "cover_offset_y": cover_offset_y, "cover_scale": cover_scale}


# ── Abonnés / Abonnements ────────────────────────────────────────────────────

@router.get("/{user_id}/followers")
async def list_followers(user_id: str, request: Request):
    """Liste des abonnés d'un utilisateur, avec statuts suivi/blocage pour l'appelant."""
    pool = get_pool()
    me = await get_optional_auth(request, pool)
    me_id = me["user_id"] if me else None
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT u.user_id, u.name, u.picture, u.role,
                      CASE WHEN $1::TEXT IS NOT NULL THEN
                          EXISTS(SELECT 1 FROM user_follows WHERE follower_id=$1 AND following_id=u.user_id)
                      ELSE FALSE END AS is_following_back,
                      CASE WHEN $1::TEXT IS NOT NULL THEN
                          EXISTS(SELECT 1 FROM user_blocks WHERE blocker_id=$1 AND blocked_id=u.user_id)
                      ELSE FALSE END AS is_blocked
               FROM user_follows uf
               JOIN users u ON u.user_id = uf.follower_id
               WHERE uf.following_id = $2
               ORDER BY u.name ASC""",
            me_id, user_id
        )
    return [dict(r) for r in rows]


@router.get("/{user_id}/following")
async def list_following(user_id: str, request: Request):
    """Liste des abonnements d'un utilisateur."""
    pool = get_pool()
    me = await get_optional_auth(request, pool)
    me_id = me["user_id"] if me else None
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT u.user_id, u.name, u.picture, u.role,
                      CASE WHEN $1::TEXT IS NOT NULL THEN
                          EXISTS(SELECT 1 FROM user_follows WHERE follower_id=u.user_id AND following_id=$1)
                      ELSE FALSE END AS follows_back,
                      CASE WHEN $1::TEXT IS NOT NULL THEN
                          EXISTS(SELECT 1 FROM user_blocks WHERE blocker_id=$1 AND blocked_id=u.user_id)
                      ELSE FALSE END AS is_blocked
               FROM user_follows uf
               JOIN users u ON u.user_id = uf.following_id
               WHERE uf.follower_id = $2
               ORDER BY u.name ASC""",
            me_id, user_id
        )
    return [dict(r) for r in rows]


@router.delete("/{user_id}/followers/{follower_id}")
async def remove_follower(user_id: str, follower_id: str, request: Request):
    """Retirer un abonné (seul le propriétaire du profil peut le faire)."""
    pool = get_pool()
    me = await require_auth(request, pool)
    if me["user_id"] != user_id:
        raise HTTPException(403, "Seul le propriétaire du profil peut retirer un abonné.")
    async with pool.acquire() as conn:
        await conn.execute(
            "DELETE FROM user_follows WHERE follower_id=$1 AND following_id=$2",
            follower_id, user_id
        )
        count = await conn.fetchval("SELECT COUNT(*) FROM user_follows WHERE following_id=$1", user_id)
    return {"removed": True, "followers_count": int(count)}


@router.post("/{user_id}/block")
async def block_user(user_id: str, request: Request):
    """Bloquer un utilisateur : supprime les liens de suivi dans les deux sens."""
    pool = get_pool()
    me = await require_auth(request, pool)
    blocker_id = me["user_id"]
    if blocker_id == user_id:
        raise HTTPException(400, "Vous ne pouvez pas vous bloquer vous-même.")
    async with pool.acquire() as conn:
        # Supprimer les follows dans les deux sens
        await conn.execute(
            "DELETE FROM user_follows WHERE (follower_id=$1 AND following_id=$2) OR (follower_id=$2 AND following_id=$1)",
            blocker_id, user_id
        )
        # Insérer le blocage
        await conn.execute(
            "INSERT INTO user_blocks(blocker_id, blocked_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
            blocker_id, user_id
        )
    return {"blocked": True}


@router.delete("/{user_id}/block")
async def unblock_user(user_id: str, request: Request):
    """Débloquer un utilisateur."""
    pool = get_pool()
    me = await require_auth(request, pool)
    async with pool.acquire() as conn:
        await conn.execute(
            "DELETE FROM user_blocks WHERE blocker_id=$1 AND blocked_id=$2",
            me["user_id"], user_id
        )
    return {"blocked": False}


@router.get("/{user_id}/suggestions")
async def suggest_follows(user_id: str, request: Request, skip: int = 0, limit: int = 10):
    """Suggestions d'abonnements :
    - Si l'utilisateur a des intérêts (coach_tags) → utilisateurs avec tags en commun, triés par nb commun DESC.
    - Sinon → utilisateurs populaires (nb abonnés DESC).
    - Exclut : déjà suivi, bloqué, soi-même.
    - Réservé au profil du demandeur (me_id == user_id).
    """
    pool = get_pool()
    me = await require_auth(request, pool)
    me_id = me["user_id"]

    if me_id != user_id:
        raise HTTPException(403, "Suggestions disponibles uniquement pour votre propre profil.")

    async with pool.acquire() as conn:
        # Récupérer mes tags
        my_tags_raw = await conn.fetchval(
            "SELECT coach_tags FROM users WHERE user_id = $1", me_id
        )
        # asyncpg retourne JSONB comme string. Gérer le double-encodage (certains users).
        import json as _json
        my_tags: list = []
        if my_tags_raw is not None:
            val = my_tags_raw
            # Première passe
            if isinstance(val, str):
                try:
                    val = _json.loads(val)
                except Exception:
                    val = []
            # Deuxième passe si encore une string (double-encodage)
            if isinstance(val, str):
                try:
                    val = _json.loads(val)
                except Exception:
                    val = []
            my_tags = list(val) if isinstance(val, list) else []
        has_interests = len(my_tags) > 0

        # Helper SQL pour extraire les tags de façon robuste (gère les tableaux et scalaires)
        SAFE_TAGS = """
            CASE
                WHEN jsonb_typeof(COALESCE(u.coach_tags,'[]'::jsonb)) = 'array'
                    THEN COALESCE(u.coach_tags,'[]'::jsonb)
                WHEN jsonb_typeof(COALESCE(u.coach_tags,'[]'::jsonb)) = 'string'
                    THEN (COALESCE(u.coach_tags,'[]'::jsonb) #>> '{}')::jsonb
                ELSE '[]'::jsonb
            END
        """

        # ── Requête principale ──────────────────────────────────────────
        popular_query = """
            SELECT u.user_id, u.name, u.picture, u.role,
                0 AS common_count,
                ARRAY[]::text[] AS common_tag_ids,
                (SELECT COUNT(*) FROM user_follows WHERE following_id=u.user_id)::int AS _pop
            FROM users u
            WHERE u.user_id != $1
              AND NOT EXISTS(SELECT 1 FROM user_follows WHERE follower_id=$1 AND following_id=u.user_id)
              AND NOT EXISTS(SELECT 1 FROM user_blocks  WHERE blocker_id=$1 AND blocked_id=u.user_id)
              AND NOT EXISTS(SELECT 1 FROM user_blocks  WHERE blocker_id=u.user_id AND blocked_id=$1)
            ORDER BY _pop DESC, u.name ASC
            LIMIT $2 OFFSET $3
        """
        is_popular_fallback = False

        if has_interests:
            rows = await conn.fetch(
                f"""
                SELECT u.user_id, u.name, u.picture, u.role,
                    (SELECT COUNT(*) FROM jsonb_array_elements_text({SAFE_TAGS}) t
                     WHERE t = ANY($1::text[])) AS common_count,
                    ARRAY(SELECT t FROM jsonb_array_elements_text({SAFE_TAGS}) t
                          WHERE t = ANY($1::text[])) AS common_tag_ids
                FROM users u
                WHERE u.user_id != $2
                  AND NOT EXISTS(SELECT 1 FROM user_follows   WHERE follower_id=$2 AND following_id=u.user_id)
                  AND NOT EXISTS(SELECT 1 FROM user_blocks    WHERE blocker_id=$2 AND blocked_id=u.user_id)
                  AND NOT EXISTS(SELECT 1 FROM user_blocks    WHERE blocker_id=u.user_id AND blocked_id=$2)
                  AND (SELECT COUNT(*) FROM jsonb_array_elements_text({SAFE_TAGS}) t
                       WHERE t = ANY($1::text[])) > 0
                ORDER BY common_count DESC, u.name ASC
                LIMIT $3 OFFSET $4
                """,
                my_tags, me_id, limit, skip,
            )
            # Fallback vers les utilisateurs populaires si aucun résultat d'intérêts
            if not rows:
                is_popular_fallback = True
                rows = await conn.fetch(popular_query, me_id, limit, skip)
        else:
            rows = await conn.fetch(popular_query, me_id, limit, skip)

        # Batch-fetch tag labels pour les tags communs
        all_tag_ids: set = set()
        for row in rows:
            all_tag_ids.update(row["common_tag_ids"] or [])

        tag_labels: dict = {}
        if all_tag_ids:
            tag_rows = await conn.fetch(
                "SELECT tag_id, label_fr FROM tags WHERE tag_id = ANY($1::text[])",
                list(all_tag_ids),
            )
            tag_labels = {r["tag_id"]: r["label_fr"] for r in tag_rows}

        result = []
        for row in rows:
            result.append({
                "user_id": row["user_id"],
                "name": row["name"],
                "picture": row["picture"],
                "role": row["role"],
                "common_count": int(row["common_count"] or 0),
                "common_interests": [
                    {"tag_id": t, "label": tag_labels.get(t, t)}
                    for t in (row["common_tag_ids"] or [])
                ],
            })

        return {
            "suggestions": result,
            "has_interests": has_interests,
            "skip": skip,
            "limit": limit,
            "count": len(result),
        }
