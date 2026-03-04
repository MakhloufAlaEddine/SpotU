from fastapi import APIRouter, Request, HTTPException, Query
from datetime import datetime, timezone, timedelta
from typing import Optional, List
from models import TagPointCreate, TagPointUpdate, new_id
from auth_utils import require_auth, get_token_from_request, decode_jwt
from database import get_pool, row_to_dict, rows_to_list
import json
import random
import math

router = APIRouter()

DEFAULT_RADIUS = 5000  # 5km

TP_FIELDS = """
    tp.point_id, tp.user_id, tp.title, tp.description,
    tp.precision, tp.tag_ids, tp.domain_id, tp.active, tp.is_public, tp.cancelled, tp.expires_at, tp.created_at, tp.updated_at,
    tp.image_url, tp.images, tp.schedule, tp.event_date, tp.event_end_date, tp.event_schedule, tp.new_date_coming,
    ST_Y(tp.location::geometry) as latitude,
    ST_X(tp.location::geometry) as longitude,
    u.name as owner_name, u.picture as owner_picture, u.role as owner_role
"""

TP_FIELDS_SIMPLE = """
    point_id, user_id, title, description,
    precision, tag_ids, domain_id, active, expires_at, created_at, updated_at,
    image_url,
    ST_Y(location::geometry) as latitude,
    ST_X(location::geometry) as longitude
"""


def build_point_response(row_dict: dict) -> dict:
    lat = row_dict.pop("latitude", None)
    lng = row_dict.pop("longitude", None)
    if lat is not None and lng is not None:
        row_dict["location"] = {"type": "Point", "coordinates": [lng, lat]}
        row_dict["latitude"] = lat
        row_dict["longitude"] = lng
    # Build owner sub-object if owner fields present
    owner_name = row_dict.pop("owner_name", None)
    owner_picture = row_dict.pop("owner_picture", None)
    owner_role = row_dict.pop("owner_role", None)
    if owner_name:
        row_dict["owner"] = {"user_id": row_dict.get("user_id"), "name": owner_name, "picture": owner_picture, "role": owner_role}
    return row_dict


def apply_precision_offset(lat: float, lng: float, precision: str, seed: str = None):
    """
    Apply a random offset to coordinates based on precision level.
    Uses a seed (point_id) to ensure consistent offset for the same point.
    
    - exact: No offset
    - 100m: Random offset within 100m radius
    - 1000m: Random offset within 1000m radius
    """
    if precision == "exact" or precision is None:
        return lat, lng
    
    # Get radius in meters
    if precision == "100m":
        radius_m = 100
    elif precision == "1000m":
        radius_m = 1000
    else:
        return lat, lng
    
    # Use seed for consistent random offset per point
    if seed:
        random.seed(hash(seed))
    
    # Generate random angle and distance
    angle = random.uniform(0, 2 * math.pi)
    # Use square root for uniform distribution within circle
    distance = radius_m * math.sqrt(random.uniform(0, 1))
    
    # Convert meters to degrees (approximate)
    # 1 degree latitude ≈ 111,320 meters
    # 1 degree longitude ≈ 111,320 * cos(latitude) meters
    lat_offset = (distance * math.cos(angle)) / 111320
    lng_offset = (distance * math.sin(angle)) / (111320 * math.cos(math.radians(lat)))
    
    # Reset random seed
    random.seed()
    
    return lat + lat_offset, lng + lng_offset


def randomize_for_storage(lat: float, lng: float, precision: str):
    """
    Apply permanent randomization when storing coordinates.
    This adds a random offset that will be stored in the database.
    """
    if precision == "exact" or precision is None:
        return lat, lng
    
    # Get radius in meters
    if precision == "100m":
        radius_m = 100
    elif precision == "1000m":
        radius_m = 1000
    else:
        return lat, lng
    
    # Generate random angle and distance
    angle = random.uniform(0, 2 * math.pi)
    distance = radius_m * math.sqrt(random.uniform(0, 1))
    
    # Convert meters to degrees
    lat_offset = (distance * math.cos(angle)) / 111320
    lng_offset = (distance * math.sin(angle)) / (111320 * math.cos(math.radians(lat)))
    
    return lat + lat_offset, lng + lng_offset


@router.get("/tag-points")
async def search_tag_points(
    lat: Optional[float] = Query(None),
    lng: Optional[float] = Query(None),
    radius: Optional[int] = Query(DEFAULT_RADIUS),
    domain_id: Optional[str] = Query(None),
    tag_ids: Optional[str] = Query(None),
    request: Request = None,
):
    pool = get_pool()

    # Determine current user
    current_user_id = None
    try:
        token = get_token_from_request(request)
        if token:
            payload = decode_jwt(token)
            current_user_id = payload.get("user_id")
    except Exception:
        pass

    conditions = ["active = TRUE", f"(tp.is_public = TRUE OR tp.user_id = '{current_user_id or ''}')"]
    # Exclure les SpotYou créés par l'utilisateur connecté (accessibles via SpotMe)
    if current_user_id:
        conditions.append(f"tp.user_id != '{current_user_id}'")
    params = []
    param_idx = 1

    if lat is not None and lng is not None:
        conditions.append(
            f"ST_DWithin(location::geography, ST_SetSRID(ST_MakePoint(${param_idx}, ${param_idx+1}), 4326)::geography, ${param_idx+2})"
        )
        params.extend([lng, lat, radius])
        param_idx += 3

    if domain_id:
        conditions.append(f"domain_id = ${param_idx}")
        params.append(domain_id)
        param_idx += 1

    if tag_ids:
        ids = [t.strip() for t in tag_ids.split(",") if t.strip()]
        if ids:
            conditions.append(f"tag_ids ?| ARRAY[{', '.join([f'${param_idx+i}' for i in range(len(ids))])}]")
            params.extend(ids)
            param_idx += len(ids)

    where_clause = " AND ".join(conditions)
    order_clause = ""
    distance_field = ""
    if lat is not None and lng is not None:
        order_clause = f"ORDER BY tp.location::geography <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography"
        distance_field = f", ST_Distance(tp.location::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) as distance"

    query = f"""SELECT {TP_FIELDS} {distance_field}
        FROM tag_points tp 
        LEFT JOIN users u ON tp.user_id = u.user_id 
        WHERE {where_clause} {order_clause} LIMIT 200"""

    async with pool.acquire() as conn:
        rows = await conn.fetch(query, *params)

    result = []
    for row in rows:
        pt = build_point_response(row_to_dict(row))
        # Apply precision masking for non-owners
        if pt.get("user_id") != current_user_id and pt.get("precision") in ("100m", "1000m"):
            new_lat, new_lng = apply_precision_offset(
                pt.get("latitude", 0), pt.get("longitude", 0), pt["precision"]
            )
            pt["location"] = {"type": "Point", "coordinates": [new_lng, new_lat]}
            pt["latitude"] = new_lat
            pt["longitude"] = new_lng
        result.append(pt)
    return result


@router.get("/tag-points/mine")
async def my_tag_points(request: Request):
    pool = get_pool()
    user = await require_auth(request, pool)
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""SELECT {TP_FIELDS} 
                FROM tag_points tp 
                LEFT JOIN users u ON tp.user_id = u.user_id 
                WHERE tp.user_id = $1 AND tp.active = TRUE 
                ORDER BY tp.created_at DESC""",
            user["user_id"]
        )
    return [build_point_response(row_to_dict(r)) for r in rows]


@router.get("/tag-points/saved")
async def get_saved_tag_points(request: Request):
    pool = get_pool()
    user = await require_auth(request, pool)
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""SELECT {TP_FIELDS}, s.saved_at
                FROM tag_point_saves s
                JOIN tag_points tp ON s.point_id = tp.point_id
                LEFT JOIN users u ON tp.user_id = u.user_id
                WHERE s.user_id = $1
                ORDER BY s.saved_at DESC""",
            user["user_id"]
        )
    return [build_point_response(row_to_dict(r)) for r in rows]


@router.get("/tag-points/{point_id}")
async def get_tag_point(point_id: str, request: Request):
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            f"""SELECT {TP_FIELDS}
                FROM tag_points tp
                LEFT JOIN users u ON tp.user_id = u.user_id
                WHERE tp.point_id = $1""",
            point_id
        )
        if not row:
            raise HTTPException(status_code=404, detail="TagPoint not found")
        pt = build_point_response(row_to_dict(row))

        tag_ids_list = pt.get("tag_ids") or []
        if isinstance(tag_ids_list, str):
            try:
                tag_ids_list = json.loads(tag_ids_list)
            except (json.JSONDecodeError, TypeError):
                tag_ids_list = []
        if tag_ids_list:
            tags = await conn.fetch(
                "SELECT tag_id, name, label_fr, label_en, category_id FROM tags WHERE tag_id = ANY($1::text[])",
                tag_ids_list
            )
            pt["tags"] = rows_to_list(tags)
        else:
            pt["tags"] = []

        vote_stats = await conn.fetchrow(
            "SELECT ROUND(AVG(rating)::numeric, 1) as avg_rating, COUNT(*) as vote_count FROM tag_point_votes WHERE point_id = $1",
            point_id
        )
        pt["rating"] = float(vote_stats["avg_rating"]) if vote_stats["avg_rating"] else 0
        pt["votes"] = vote_stats["vote_count"] or 0

        # Distribution 1-5
        dist = await conn.fetch(
            "SELECT rating, COUNT(*) as cnt FROM tag_point_votes WHERE point_id=$1 GROUP BY rating ORDER BY rating",
            point_id
        )
        pt["rating_distribution"] = {str(r["rating"]): r["cnt"] for r in dist}

        # Participants
        pt["participants_count"] = await conn.fetchval(
            "SELECT COUNT(*) FROM tag_point_participants WHERE point_id=$1", point_id
        ) or 0

        # Current user participation + save
        pt["is_participant"] = False
        pt["is_saved"] = False
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            try:
                user = await require_auth(request, pool)
                pt["is_participant"] = await conn.fetchval(
                    "SELECT EXISTS(SELECT 1 FROM tag_point_participants WHERE point_id=$1 AND user_id=$2)",
                    point_id, user["user_id"]
                )
                pt["is_saved"] = await conn.fetchval(
                    "SELECT EXISTS(SELECT 1 FROM tag_point_saves WHERE point_id=$1 AND user_id=$2)",
                    point_id, user["user_id"]
                )
            except Exception:
                pass

    return pt


@router.get("/tag-points/{point_id}/similar")
async def get_similar_tag_points(point_id: str, request: Request = None):
    pool = get_pool()

    # Determine current user to exclude their own SpotYou
    current_user_id = None
    try:
        token = get_token_from_request(request)
        if token:
            payload = decode_jwt(token)
            current_user_id = payload.get("user_id")
    except Exception:
        pass

    async with pool.acquire() as conn:
        current = await conn.fetchrow(
            "SELECT tag_ids, location FROM tag_points WHERE point_id = $1", point_id
        )
        if not current:
            return []

        tag_ids_json = current["tag_ids"] or "[]"
        # Parse tag_ids into a Python list for the query
        import json as _json
        try:
            tag_ids_list = _json.loads(tag_ids_json) if isinstance(tag_ids_json, str) else tag_ids_json
        except Exception:
            tag_ids_list = []

        if tag_ids_list:
            exclude_clause = f"AND tp.user_id != '{current_user_id}'" if current_user_id else ""
            rows = await conn.fetch(
                f"""
                SELECT {TP_FIELDS},
                       ST_Distance(tp.location::geography, $2::geography) AS dist_m
                FROM tag_points tp
                LEFT JOIN users u ON tp.user_id = u.user_id
                WHERE tp.point_id != $1
                  AND tp.active = TRUE
                  {exclude_clause}
                  AND (
                      tp.tag_ids IS NOT NULL
                      AND EXISTS (
                          SELECT 1
                          FROM jsonb_array_elements_text(
                              CASE jsonb_typeof(tp.tag_ids)
                                  WHEN 'array' THEN tp.tag_ids
                                  ELSE (tp.tag_ids #>> '{{}}')::jsonb
                              END
                          ) t(v)
                          WHERE v = ANY($3::text[])
                      )
                      OR ST_DWithin(tp.location::geography, $2::geography, 10000)
                  )
                ORDER BY
                    CASE WHEN tp.tag_ids IS NOT NULL AND EXISTS (
                        SELECT 1
                        FROM jsonb_array_elements_text(
                            CASE jsonb_typeof(tp.tag_ids)
                                WHEN 'array' THEN tp.tag_ids
                                ELSE (tp.tag_ids #>> '{{}}')::jsonb
                            END
                        ) t(v)
                        WHERE v = ANY($3::text[])
                    ) THEN 0 ELSE 1 END,
                    dist_m
                LIMIT 10
                """,
                point_id, current["location"], tag_ids_list
            )
        else:
            exclude_clause = f"AND tp.user_id != '{current_user_id}'" if current_user_id else ""
            rows = await conn.fetch(
                f"""
                SELECT {TP_FIELDS},
                       ST_Distance(tp.location::geography, $2::geography) AS dist_m
                FROM tag_points tp
                LEFT JOIN users u ON tp.user_id = u.user_id
                WHERE tp.point_id != $1
                  AND tp.active = TRUE
                  {exclude_clause}
                  AND ST_DWithin(tp.location::geography, $2::geography, 10000)
                ORDER BY dist_m
                LIMIT 10
                """,
                point_id, current["location"]
            )

    result = []
    for row in rows:
        pt = build_point_response(row_to_dict(row))
        pt["dist_m"] = float(row["dist_m"]) if row["dist_m"] is not None else None
        result.append(pt)
    return result


@router.post("/tag-points/{point_id}/save")
async def save_tag_point(point_id: str, request: Request):
    pool = get_pool()
    user = await require_auth(request, pool)
    sid = new_id("save")
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO tag_point_saves (save_id, point_id, user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
            sid, point_id, user["user_id"]
        )
    return {"success": True, "is_saved": True}


@router.delete("/tag-points/{point_id}/unsave")
async def unsave_tag_point(point_id: str, request: Request):
    pool = get_pool()
    user = await require_auth(request, pool)
    async with pool.acquire() as conn:
        await conn.execute(
            "DELETE FROM tag_point_saves WHERE point_id=$1 AND user_id=$2",
            point_id, user["user_id"]
        )
    return {"success": True, "is_saved": False}


@router.post("/tag-points/{point_id}/join")
async def join_tag_point(point_id: str, request: Request):
    pool = get_pool()
    user = await require_auth(request, pool)
    from push_service import send_push_to_user
    import asyncio
    pid = new_id("part")
    async with pool.acquire() as conn:
        tp = await conn.fetchrow("SELECT user_id, title FROM tag_points WHERE point_id = $1", point_id)
        await conn.execute(
            "INSERT INTO tag_point_participants (participant_id, point_id, user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
            pid, point_id, user["user_id"]
        )
        count = await conn.fetchval("SELECT COUNT(*) FROM tag_point_participants WHERE point_id=$1", point_id)
    # Notifier le propriétaire du SpotYou (sauf si c'est lui-même)
    if tp and tp["user_id"] != user["user_id"]:
        content_title = tp["title"] or "SpotYou"
        asyncio.create_task(send_push_to_user(
            pool, tp["user_id"],
            title="Nouveau participant",
            body=f'{user["name"]} a rejoint votre SpotYou «{content_title}»',
            data={
                "type": "spotyu_join", "point_id": point_id,
                "sender_id": user["user_id"], "sender_name": user.get("name", ""),
                "sender_picture": user.get("picture") or "",
                "action_text": "a rejoint votre SpotYou",
                "content_title": content_title,
            },
            notif_type="spotyu_join"
        ))
    return {"success": True, "participants_count": count, "is_participant": True}


@router.delete("/tag-points/{point_id}/leave")
async def leave_tag_point(point_id: str, request: Request):
    pool = get_pool()
    user = await require_auth(request, pool)
    from push_service import send_push_to_user
    import asyncio
    async with pool.acquire() as conn:
        tp = await conn.fetchrow("SELECT user_id, title FROM tag_points WHERE point_id = $1", point_id)
        await conn.execute(
            "DELETE FROM tag_point_participants WHERE point_id=$1 AND user_id=$2",
            point_id, user["user_id"]
        )
        count = await conn.fetchval("SELECT COUNT(*) FROM tag_point_participants WHERE point_id=$1", point_id)
    # Notifier le propriétaire du SpotYou (sauf si c'est lui-même)
    if tp and tp["user_id"] != user["user_id"]:
        content_title = tp["title"] or "SpotYou"
        asyncio.create_task(send_push_to_user(
            pool, tp["user_id"],
            title="Participant retiré",
            body=f'{user["name"]} a quitté votre SpotYou «{content_title}»',
            data={
                "type": "spotyu_leave", "point_id": point_id,
                "sender_id": user["user_id"], "sender_name": user.get("name", ""),
                "sender_picture": user.get("picture") or "",
                "action_text": "a quitté votre SpotYou",
                "content_title": content_title,
            },
            notif_type="spotyu_leave"
        ))
    return {"success": True, "participants_count": count, "is_participant": False}


@router.get("/tag-points/{point_id}/participants")
async def get_tag_point_participants(point_id: str):
    """Retourne la liste des participants d'un SpotYou avec infos utilisateur."""
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT u.user_id, u.name, u.picture, u.role,
                      (u.user_id = tp.user_id) as is_creator
               FROM tag_point_participants p
               JOIN users u ON p.user_id = u.user_id
               JOIN tag_points tp ON tp.point_id = p.point_id
               WHERE p.point_id = $1
               ORDER BY (u.user_id = tp.user_id) DESC, p.joined_at ASC""",
            point_id
        )
    return [
        {
            "user_id": r["user_id"],
            "name": r["name"],
            "picture": r["picture"],
            "role": r["role"],
            "is_creator": r["is_creator"],
        }
        for r in rows
    ]


@router.get("/users/me/notifications")
async def get_my_notifications(request: Request, limit: int = Query(50)):
    """Récupère les notifications in-app avec la photo de profil à jour du sender."""
    pool = get_pool()
    user = await require_auth(request, pool)
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT n.notif_id, n.type, n.title, n.body, n.data, n.read, n.created_at,
                      u.picture as sender_current_picture
               FROM notifications n
               LEFT JOIN users u ON u.user_id = (n.data->>'sender_id')
               WHERE n.user_id = $1
               ORDER BY n.created_at DESC
               LIMIT $2""",
            user["user_id"], limit
        )
    result = []
    for r in rows:
        data = dict(r["data"]) if r["data"] else {}
        # Toujours utiliser la photo actuelle du sender (pas celle stockée)
        if r["sender_current_picture"] is not None:
            data["sender_picture"] = r["sender_current_picture"]
        result.append({
            "id": r["notif_id"],
            "type": r["type"],
            "title": r["title"],
            "body": r["body"],
            "data": data,
            "read": r["read"],
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
        })
    return result


@router.patch("/users/me/notifications/{notif_id}/read")
async def mark_notification_read(notif_id: str, request: Request):
    """Marque une notification spécifique comme lue et diffuse le nouveau compteur."""
    pool = get_pool()
    user = await require_auth(request, pool)
    from chat_manager import notif_manager
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE notifications SET read = TRUE WHERE notif_id = $1 AND user_id = $2",
            notif_id, user["user_id"]
        )
        unread = await conn.fetchval(
            "SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND read = FALSE",
            user["user_id"]
        )
    await notif_manager.notify(user["user_id"], {"type": "unread_notif", "count": int(unread)})
    return {"success": True, "unread_notif": int(unread)}


@router.patch("/users/me/notifications/read-all")
async def mark_all_notifications_read(request: Request):
    """Marque toutes les notifications comme lues."""
    pool = get_pool()
    user = await require_auth(request, pool)
    from chat_manager import notif_manager
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE notifications SET read = TRUE WHERE user_id = $1 AND read = FALSE",
            user["user_id"]
        )
    await notif_manager.notify(user["user_id"], {"type": "unread_notif", "count": 0})
    return {"success": True}


@router.get("/users/me/events")
async def get_my_events(request: Request):
    """Retourne tous les tagPoints auxquels l'utilisateur participe (son planning)."""
    pool = get_pool()
    user = await require_auth(request, pool)
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""SELECT {TP_FIELDS}, p.joined_at,
                COALESCE(tp.event_date, tp.created_at) as sort_date
                FROM tag_points tp
                JOIN tag_point_participants p ON tp.point_id = p.point_id
                LEFT JOIN users u ON tp.user_id = u.user_id
                WHERE p.user_id = $1 AND tp.active = TRUE
                ORDER BY sort_date DESC""",
            user["user_id"]
        )
    result = []
    for row in rows:
        d = row_to_dict(row)
        d["joined_at"] = str(d.get("joined_at")) if d.get("joined_at") else None
        d.pop("sort_date", None)
        result.append(build_point_response(d))
    return result


@router.get("/users/me/planning-events")
async def get_planning_events(request: Request):
    """Retourne les événements SpotYou dans un format compatible avec le planning.
    Génère les occurrences récurrentes sur les 90 prochains jours."""
    from datetime import timedelta, date as date_type
    import asyncio

    pool = get_pool()
    user = await require_auth(request, pool)

    now = datetime.now(timezone.utc)
    range_start = now - timedelta(days=30)
    range_end = now + timedelta(days=90)

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT tp.point_id, tp.title, tp.event_date, tp.event_end_date, tp.event_schedule,
                      tp.image_url, tp.user_id as owner_id, u.name as owner_name,
                      tp.cancelled
               FROM tag_points tp
               JOIN tag_point_participants p ON tp.point_id = p.point_id
               LEFT JOIN users u ON tp.user_id = u.user_id
               WHERE p.user_id = $1 AND tp.active = TRUE
                 AND (tp.is_public = TRUE OR tp.user_id = $1)""",
            user["user_id"]
        )

    events = []
    for row in rows:
        tp = row_to_dict(row)
        event_date = tp.get("event_date")
        event_schedule = tp.get("event_schedule")

        # Événement unique
        if event_date:
            from zoneinfo import ZoneInfo
            paris = ZoneInfo('Europe/Paris')
            if isinstance(event_date, str):
                from dateutil.parser import parse as _parse
                dt = _parse(event_date)
            else:
                dt = event_date
            dt_local = dt.astimezone(paris)

            # end_time depuis event_end_date si disponible
            end_date_raw = tp.get("event_end_date")
            end_time_str = None
            if end_date_raw:
                if isinstance(end_date_raw, str):
                    from dateutil.parser import parse as _parse2
                    end_dt = _parse2(end_date_raw).astimezone(paris)
                else:
                    end_dt = end_date_raw.astimezone(paris)
                end_time_str = end_dt.strftime("%H:%M")

            events.append({
                "point_id": tp["point_id"],
                "title": tp["title"],
                "owner_name": tp.get("owner_name"),
                "image_url": tp.get("image_url"),
                "is_own": tp.get("owner_id") == user["user_id"],
                "is_cancelled": bool(tp.get("cancelled")),
                "date": dt_local.strftime("%Y-%m-%d"),
                "time": dt_local.strftime("%H:%M"),
                "end_time": end_time_str,
                "type": "single",
            })

        # Événement récurrent (hebdomadaire)
        if event_schedule:
            import json as _json
            if isinstance(event_schedule, str):
                try:
                    sched = _json.loads(event_schedule)
                except Exception:
                    sched = {}
            elif isinstance(event_schedule, dict):
                sched = event_schedule
            else:
                sched = {}

            if sched.get("type") == "weekly":
                # Format : {"type":"weekly","schedule":{"0":[{"start":"07:00","end":"07:45"}],...}}
                # Clés = Python weekday (0=Lun, 1=Mar, ..., 6=Dim) — PAS JS convention
                schedule_dict = sched.get("schedule", {})
                for py_day_str, time_slots in schedule_dict.items():
                    py_weekday = int(py_day_str)  # direct, pas de conversion

                    for time_slot in (time_slots if isinstance(time_slots, list) else []):
                        time_str = time_slot.get("start", "00:00")
                        end_str  = time_slot.get("end")

                        cursor = range_start.date()
                        while cursor <= range_end.date():
                            if cursor.weekday() == py_weekday:
                                events.append({
                                    "point_id": tp["point_id"],
                                    "title": tp["title"],
                                    "owner_name": tp.get("owner_name"),
                                    "image_url": tp.get("image_url"),
                                    "is_own": tp.get("owner_id") == user["user_id"],
                                    "is_cancelled": bool(tp.get("cancelled")),
                                    "date": cursor.isoformat(),
                                    "time": time_str,
                                    "end_time": end_str,
                                    "type": "recurring",
                                })
                            cursor += timedelta(days=1)

    # Dédoublonner si un SpotYou a à la fois event_date ET event_schedule
    seen = set()
    unique = []
    for e in events:
        key = f"{e['point_id']}_{e['date']}"
        if key not in seen:
            seen.add(key)
            unique.append(e)

    return sorted(unique, key=lambda x: (x["date"], x["time"]))


@router.get("/tag-points/{point_id}/my-vote")
async def get_my_vote(point_id: str, request: Request):
    pool = get_pool()
    user = await require_auth(request, pool)
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT vote_id, rating, comment, created_at, updated_at FROM tag_point_votes WHERE point_id = $1 AND user_id = $2",
            point_id, user["user_id"]
        )
    if not row:
        return {"exists": False, "rating": 0, "comment": None}
    d = row_to_dict(row)
    d["exists"] = True
    return d


@router.post("/tag-points/{point_id}/vote")
async def vote_tag_point(point_id: str, request: Request):
    pool = get_pool()
    user = await require_auth(request, pool)
    from push_service import send_push_to_user
    import asyncio
    body = await request.json()
    rating = body.get("rating")
    comment = body.get("comment", None)

    if not rating or not (1 <= int(rating) <= 5):
        raise HTTPException(status_code=400, detail="Rating must be between 1 and 5")

    vid = new_id("vote")
    tp_owner_id = None
    tp_title = None
    async with pool.acquire() as conn:
        tp = await conn.fetchrow("SELECT user_id, title FROM tag_points WHERE point_id = $1", point_id)
        if tp:
            tp_owner_id = tp["user_id"]
            tp_title = tp["title"]
        existing = await conn.fetchrow(
            "SELECT vote_id FROM tag_point_votes WHERE point_id = $1 AND user_id = $2",
            point_id, user["user_id"]
        )
        if existing:
            await conn.execute(
                "UPDATE tag_point_votes SET rating = $1, comment = $2, updated_at = NOW() WHERE point_id = $3 AND user_id = $4",
                int(rating), comment, point_id, user["user_id"]
            )
        else:
            await conn.execute(
                "INSERT INTO tag_point_votes (vote_id, point_id, user_id, rating, comment) VALUES ($1, $2, $3, $4, $5)",
                vid, point_id, user["user_id"], int(rating), comment
            )
        stats = await conn.fetchrow(
            "SELECT ROUND(AVG(rating)::numeric, 1) as avg_rating, COUNT(*) as vote_count FROM tag_point_votes WHERE point_id = $1",
            point_id
        )
    # Notifier le propriétaire du SpotYou (sauf si c'est lui-même)
    if tp_owner_id and tp_owner_id != user["user_id"]:
        content_title = tp_title or "SpotYou"
        stars = "⭐" * int(rating)
        action_text = f"a évalué votre SpotYou {stars}"
        if comment:
            action_text = f"a évalué et commenté votre SpotYou {stars}"
        asyncio.create_task(send_push_to_user(
            pool, tp_owner_id,
            title="Nouvelle évaluation",
            body=f'{user["name"]} {action_text} «{content_title}»',
            data={
                "type": "spotyu_vote", "point_id": point_id,
                "sender_id": user["user_id"], "sender_name": user.get("name", ""),
                "sender_picture": user.get("picture") or "",
                "action_text": action_text,
                "content_title": content_title,
                "rating": int(rating),
            },
            notif_type="spotyu_vote"
        ))
    return {
        "success": True,
        "avg_rating": float(stats["avg_rating"]) if stats["avg_rating"] else 0,
        "vote_count": stats["vote_count"] or 0,
    }


@router.get("/tag-points/{point_id}/votes")
async def get_tag_point_votes(point_id: str):
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT v.vote_id, v.rating, v.comment, v.created_at,
                      u.name as user_name, u.picture as user_picture
               FROM tag_point_votes v
               JOIN users u ON v.user_id = u.user_id
               WHERE v.point_id = $1
               ORDER BY v.created_at DESC
               LIMIT 20""",
            point_id
        )
    return rows_to_list(rows)


@router.post("/tag-points")
async def create_tag_point(data: TagPointCreate, request: Request):
    pool = get_pool()
    user = await require_auth(request, pool)
    expires_at = None
    if data.expires_hours:
        expires_at = datetime.now(timezone.utc) + timedelta(hours=data.expires_hours)
    pid = new_id("pt")
    part_id = new_id("part")

    stored_lat, stored_lng = randomize_for_storage(data.latitude, data.longitude, data.precision)
    event_schedule_val = data.event_schedule

    async with pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO tag_points
               (point_id, user_id, title, description, location, precision, tag_ids, domain_id, active, expires_at, event_date, event_end_date, event_schedule, images)
               VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326), $7, $8, $9, TRUE, $10, $11, $12, $13, $14)""",
            pid, user["user_id"], data.title, data.description,
            stored_lng, stored_lat,
            data.precision, data.tag_ids, data.domain_id, expires_at,
            data.event_date, data.event_end_date, event_schedule_val, data.images or []
        )
        # Le créateur est automatiquement participant (#3)
        await conn.execute(
            "INSERT INTO tag_point_participants (participant_id, point_id, user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
            part_id, pid, user["user_id"]
        )
        row = await conn.fetchrow(f"SELECT {TP_FIELDS} FROM tag_points tp LEFT JOIN users u ON tp.user_id = u.user_id WHERE tp.point_id = $1", pid)
    return build_point_response(row_to_dict(row))


@router.put("/tag-points/{point_id}")
async def update_tag_point(point_id: str, data: TagPointUpdate, request: Request):
    pool = get_pool()
    user = await require_auth(request, pool)
    from push_service import send_push_to_user
    import asyncio, json as _json
    from datetime import timezone

    def _vals_equal(new_val, old_val) -> bool:
        """Compare une valeur entrante avec la valeur existante en base."""
        if new_val is None and old_val is None:
            return True
        if new_val is None or old_val is None:
            return False
        # Timestamps → comparer en UTC
        if hasattr(old_val, 'tzinfo'):
            try:
                nv = new_val.replace(tzinfo=timezone.utc) if new_val.tzinfo is None else new_val.astimezone(timezone.utc)
                ov = old_val.replace(tzinfo=timezone.utc) if old_val.tzinfo is None else old_val.astimezone(timezone.utc)
                return nv == ov
            except Exception:
                return str(new_val) == str(old_val)
        # Flottants (lat/lng) — tolérance numérique
        if isinstance(new_val, float) and isinstance(old_val, (float, int)):
            return abs(new_val - float(old_val)) < 1e-7
        # Listes / dicts (JSONB)
        if isinstance(new_val, (list, dict)) or isinstance(old_val, (list, dict)):
            return _json.dumps(new_val, sort_keys=True) == _json.dumps(old_val, sort_keys=True)
        return new_val == old_val

    async with pool.acquire() as conn:
        existing = await conn.fetchrow(
            """SELECT user_id, title, cancelled,
                      description, precision, tag_ids, images, domain_id,
                      active, is_public, event_date, event_end_date, event_schedule,
                      ST_Y(location::geometry) as latitude,
                      ST_X(location::geometry) as longitude
               FROM tag_points WHERE point_id = $1""", point_id
        )
        if not existing:
            raise HTTPException(status_code=404, detail="TagPoint not found")
        if existing["user_id"] != user["user_id"] and user["role"] != "admin":
            raise HTTPException(status_code=403, detail="Not authorized")

        raw = data.model_dump(exclude_unset=True)
        if not raw:
            row = await conn.fetchrow(f"SELECT {TP_FIELDS} FROM tag_points tp LEFT JOIN users u ON tp.user_id = u.user_id WHERE tp.point_id = $1", point_id)
            return build_point_response(row_to_dict(row))

        # Détecter les vrais changements avant de construire la requête
        lat = raw.pop('latitude', None)
        lng = raw.pop('longitude', None)
        has_real_changes = False
        for k, new_val in raw.items():
            if not _vals_equal(new_val, existing.get(k)):
                has_real_changes = True
                break
        if not has_real_changes and lat is not None and lng is not None:
            if not _vals_equal(lat, existing.get('latitude')) or not _vals_equal(lng, existing.get('longitude')):
                has_real_changes = True

        JSONB_FIELDS = {'tag_ids', 'images', 'event_schedule'}
        set_clauses = []
        values = []
        i = 1

        if lat is not None and lng is not None:
            set_clauses.append(f"location = ST_SetSRID(ST_MakePoint(${i}, ${i+1}), 4326)")
            values.extend([lng, lat])
            i += 2

        for key, val in raw.items():
            if key in JSONB_FIELDS:
                if val is None:
                    set_clauses.append(f"{key} = NULL")
                else:
                    set_clauses.append(f"{key} = ${i}::jsonb")
                    values.append(val)
                    i += 1
            else:
                if val is None:
                    set_clauses.append(f"{key} = NULL")
                else:
                    set_clauses.append(f"{key} = ${i}")
                    values.append(val)
                    i += 1

        if not set_clauses:
            row = await conn.fetchrow(f"SELECT {TP_FIELDS} FROM tag_points tp LEFT JOIN users u ON tp.user_id = u.user_id WHERE tp.point_id = $1", point_id)
            return build_point_response(row_to_dict(row))

        values.append(point_id)
        set_clauses.append("updated_at = NOW()")
        query = f"UPDATE tag_points SET {', '.join(set_clauses)} WHERE point_id = ${i}"
        await conn.execute(query, *values)

        # Supprimer les images retirées du disque
        if 'images' in raw:
            from routes.upload_routes import delete_upload_files
            old_images = list(existing.get("images") or [])
            new_images = raw['images'] or []
            removed = [url for url in old_images if url not in new_images]
            delete_upload_files(removed)

        row = await conn.fetchrow(f"SELECT {TP_FIELDS} FROM tag_points tp LEFT JOIN users u ON tp.user_id = u.user_id WHERE tp.point_id = $1", point_id)

        participants = await conn.fetch(
            "SELECT user_id FROM tag_point_participants WHERE point_id=$1 AND user_id != $2",
            point_id, existing["user_id"]
        )

    # Notifier si : vrais changements + non annulé + participants
    is_cancelled = bool(existing.get("cancelled"))
    if participants and has_real_changes and not is_cancelled:
        title_str = existing["title"] or "SpotYou"
        for p in participants:
            asyncio.create_task(send_push_to_user(
                pool, p["user_id"],
                title="SpotYou mis à jour",
                body=f'"{title_str}" a été mis à jour par son créateur.',
                data={
                    "type": "spotyu_updated", "point_id": point_id,
                    "sender_id": user["user_id"], "sender_name": user.get("name", ""),
                    "sender_picture": user.get("picture") or "",
                    "action_text": "a mis à jour le SpotYou",
                    "content_title": title_str,
                },
                notif_type="spotyu_updated"
            ))

    return build_point_response(row_to_dict(row))


@router.patch("/tag-points/{point_id}/new-date")
async def toggle_new_date_coming(point_id: str, request: Request):
    """Creator can toggle 'new date coming soon' flag when event is past."""
    pool = get_pool()
    user = await require_auth(request, pool)
    async with pool.acquire() as conn:
        existing = await conn.fetchrow(
            "SELECT user_id, new_date_coming FROM tag_points WHERE point_id = $1", point_id
        )
        if not existing:
            raise HTTPException(status_code=404, detail="TagPoint not found")
        if existing["user_id"] != user["user_id"] and user["role"] != "admin":
            raise HTTPException(status_code=403, detail="Not authorized")
        new_val = not existing["new_date_coming"]
        await conn.execute(
            "UPDATE tag_points SET new_date_coming = $1, updated_at = NOW() WHERE point_id = $2",
            new_val, point_id
        )
    return {"new_date_coming": new_val}


@router.patch("/tag-points/{point_id}/visibility")
async def toggle_visibility(point_id: str, request: Request):
    """Owner peut basculer public/masqué UNIQUEMENT si aucun autre participant."""
    pool = get_pool()
    user = await require_auth(request, pool)

    async with pool.acquire() as conn:
        existing = await conn.fetchrow(
            "SELECT user_id, is_public, title FROM tag_points WHERE point_id = $1 AND active = TRUE", point_id
        )
        if not existing:
            raise HTTPException(status_code=404, detail="TagPoint not found")
        if existing["user_id"] != user["user_id"] and user["role"] != "admin":
            raise HTTPException(status_code=403, detail="Not authorized")
        # Vérifier qu'il n'y a pas d'autres participants
        other_count = await conn.fetchval(
            "SELECT COUNT(*) FROM tag_point_participants WHERE point_id=$1 AND user_id != $2",
            point_id, existing["user_id"]
        )
        if other_count > 0:
            raise HTTPException(status_code=400, detail="Impossible: d'autres participants sont inscrits.")
        new_val = not (existing["is_public"] if existing["is_public"] is not None else True)
        await conn.execute(
            "UPDATE tag_points SET is_public = $1, updated_at = NOW() WHERE point_id = $2",
            new_val, point_id
        )
    return {"is_public": new_val}


@router.post("/tag-points/{point_id}/cancel")
async def cancel_tag_point(point_id: str, request: Request):
    """Annule un SpotYou (soft cancel). Notifie tous les participants."""
    pool = get_pool()
    user = await require_auth(request, pool)
    from push_service import send_push_to_user
    import asyncio

    async with pool.acquire() as conn:
        existing = await conn.fetchrow(
            "SELECT user_id, title, cancelled FROM tag_points WHERE point_id = $1 AND active = TRUE", point_id
        )
        if not existing:
            raise HTTPException(status_code=404, detail="TagPoint not found")
        if existing["user_id"] != user["user_id"] and user["role"] != "admin":
            raise HTTPException(status_code=403, detail="Not authorized")
        await conn.execute(
            "UPDATE tag_points SET cancelled = TRUE, updated_at = NOW() WHERE point_id = $1", point_id
        )
        participants = await conn.fetch(
            "SELECT user_id FROM tag_point_participants WHERE point_id=$1 AND user_id != $2",
            point_id, existing["user_id"]
        )

    title_str = existing["title"] or "SpotYou"
    for p in participants:
        asyncio.create_task(send_push_to_user(
            pool, p["user_id"],
            title="SpotYou annulé",
            body=f'"{title_str}" a été annulé par son créateur. Les créneaux restent visibles dans votre planning.',
            data={
                "type": "spotyu_cancelled", "point_id": point_id,
                "sender_id": user["user_id"], "sender_name": user.get("name", ""),
                "sender_picture": user.get("picture") or "",
                "action_text": "a annulé le SpotYou",
                "content_title": title_str,
            },
            notif_type="spotyu_cancelled"
        ))
    return {"success": True, "cancelled": True}


@router.post("/tag-points/{point_id}/restore")
async def restore_tag_point(point_id: str, request: Request):
    """Restaure un SpotYou annulé. Notifie tous les participants."""
    pool = get_pool()
    user = await require_auth(request, pool)
    from push_service import send_push_to_user
    import asyncio

    async with pool.acquire() as conn:
        existing = await conn.fetchrow(
            "SELECT user_id, title FROM tag_points WHERE point_id = $1 AND active = TRUE", point_id
        )
        if not existing:
            raise HTTPException(status_code=404, detail="TagPoint not found")
        if existing["user_id"] != user["user_id"] and user["role"] != "admin":
            raise HTTPException(status_code=403, detail="Not authorized")
        await conn.execute(
            "UPDATE tag_points SET cancelled = FALSE, updated_at = NOW() WHERE point_id = $1", point_id
        )
        participants = await conn.fetch(
            "SELECT user_id FROM tag_point_participants WHERE point_id=$1 AND user_id != $2",
            point_id, existing["user_id"]
        )

    title_str = existing["title"] or "SpotYou"
    for p in participants:
        asyncio.create_task(send_push_to_user(
            pool, p["user_id"],
            title="SpotYou restauré !",
            body=f'"{title_str}" est de nouveau actif. Le badge "Annulé" a été retiré de votre planning.',
            data={
                "type": "spotyu_restored", "point_id": point_id,
                "sender_id": user["user_id"], "sender_name": user.get("name", ""),
                "sender_picture": user.get("picture") or "",
                "action_text": "a restauré le SpotYou",
                "content_title": title_str,
            },
            notif_type="spotyu_restored"
        ))
    return {"success": True, "cancelled": False}


@router.delete("/tag-points/{point_id}")
async def delete_tag_point(point_id: str, request: Request):
    """Suppression définitive, UNIQUEMENT si aucun autre participant. Pas de notification."""
    pool = get_pool()
    user = await require_auth(request, pool)
    async with pool.acquire() as conn:
        existing = await conn.fetchrow("SELECT user_id FROM tag_points WHERE point_id = $1", point_id)
        if not existing:
            raise HTTPException(status_code=404, detail="TagPoint not found")
        if existing["user_id"] != user["user_id"] and user["role"] != "admin":
            raise HTTPException(status_code=403, detail="Not authorized")
        other_count = await conn.fetchval(
            "SELECT COUNT(*) FROM tag_point_participants WHERE point_id=$1 AND user_id != $2",
            point_id, existing["user_id"]
        )
        if other_count > 0:
            raise HTTPException(status_code=400, detail="Impossible: d'autres participants sont inscrits.")
        await conn.execute(
            "UPDATE tag_points SET active = FALSE, updated_at = NOW() WHERE point_id = $1", point_id
        )
    return {"success": True}
