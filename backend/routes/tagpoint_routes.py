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
    tp.minimum_participants, tp.maximum_participants,
    ST_Y(tp.location::geometry) as latitude,
    ST_X(tp.location::geometry) as longitude,
    u.name as owner_name, u.picture as owner_picture, u.role as owner_role,
    COALESCE((SELECT ROUND(AVG(v.rating)::numeric, 1) FROM tag_point_votes v WHERE v.point_id = tp.point_id), 0) as rating,
    COALESCE((SELECT COUNT(*) FROM tag_point_votes v WHERE v.point_id = tp.point_id), 0) as vote_count,
    COALESCE((SELECT COUNT(*) FROM spot_you_members WHERE spot_you_id = tp.point_id), 0) as participants_count
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

    conditions = ["active = TRUE"]
    params: list = []
    param_idx = 1

    # Visibilité : si connecté, exclure ses propres SpotYou; sinon seulement les publics
    if current_user_id:
        conditions.append("tp.is_public = TRUE")
        conditions.append(f"tp.user_id != ${param_idx}")
        params.append(current_user_id)
        param_idx += 1
    else:
        conditions.append("tp.is_public = TRUE")

    if lat is not None and lng is not None:
        lng_idx = param_idx
        lat_idx = param_idx + 1
        conditions.append(
            f"ST_DWithin(location::geography, ST_SetSRID(ST_MakePoint(${lng_idx}, ${lat_idx}), 4326)::geography, ${param_idx+2})"
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
        order_clause = f"ORDER BY tp.location::geography <-> ST_SetSRID(ST_MakePoint(${lng_idx}, ${lat_idx}), 4326)::geography"
        distance_field = f", ST_Distance(tp.location::geography, ST_SetSRID(ST_MakePoint(${lng_idx}, ${lat_idx}), 4326)::geography) as distance"

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
    from routes.spot_you_routes import get_next_session_date as _get_next
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""SELECT {TP_FIELDS}
                FROM tag_points tp
                LEFT JOIN users u ON tp.user_id = u.user_id
                WHERE tp.user_id = $1 AND tp.active = TRUE
                ORDER BY tp.created_at DESC""",
            user["user_id"]
        )
        points = [build_point_response(row_to_dict(r)) for r in rows]
        if not points:
            return []

        point_ids = [pt["point_id"] for pt in points]

        # Batch: participants count per spot
        part_rows = await conn.fetch(
            """SELECT spot_you_id, COUNT(*) AS cnt
               FROM spot_you_members WHERE spot_you_id = ANY($1::text[])
               GROUP BY spot_you_id""", point_ids)
        part_map = {r["spot_you_id"]: int(r["cnt"]) for r in part_rows}

        # Compute next session dates
        next_dates = {}
        for pt in points:
            nd = _get_next(pt)
            next_dates[pt["point_id"]] = nd

        # Batch: going count per spot for next session
        going_pairs = [(pid, nd) for pid, nd in next_dates.items() if nd]
        going_map = {}
        is_going_map = {}
        if going_pairs:
            for pid, nd in going_pairs:
                cnt = await conn.fetchval(
                    """SELECT COUNT(*) FROM spot_you_attendance
                       WHERE spot_you_id=$1 AND session_date=$2 AND status='going'""",
                    pid, nd) or 0
                going_map[pid] = int(cnt)
                is_going_map[pid] = bool(await conn.fetchval(
                    """SELECT EXISTS(SELECT 1 FROM spot_you_attendance
                       WHERE spot_you_id=$1 AND user_id=$2 AND session_date=$3 AND status='going')""",
                    pid, user["user_id"], nd))

        for pt in points:
            pid = pt["point_id"]
            pt["participants_count"] = part_map.get(pid, 0)
            pt["can_participate"] = True  # Le propriétaire est toujours membre
            nd = next_dates.get(pid)
            pt["next_session_date"] = nd.isoformat() if nd else None
            pt["going_count"] = going_map.get(pid, 0)
            pt["is_going"] = is_going_map.get(pid, False)
            max_p = pt.get("maximum_participants")
            pt["is_full"] = max_p is not None and pt["going_count"] >= max_p

    return points


@router.get("/tag-points/saved")
async def get_saved_tag_points(request: Request):
    pool = get_pool()
    user = await require_auth(request, pool)
    from routes.spot_you_routes import get_next_session_date as _get_next
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
        points = [build_point_response(row_to_dict(r)) for r in rows]
        if not points:
            return []

        point_ids = [pt["point_id"] for pt in points]

        # Batch: participants count
        part_rows = await conn.fetch(
            """SELECT spot_you_id, COUNT(*) AS cnt
               FROM spot_you_members WHERE spot_you_id = ANY($1::text[])
               GROUP BY spot_you_id""", point_ids)
        part_map = {r["spot_you_id"]: int(r["cnt"]) for r in part_rows}

        # Batch: rating & vote count
        vote_rows = await conn.fetch(
            """SELECT point_id, ROUND(AVG(rating)::numeric,1) as avg_r, COUNT(*) as vcnt
               FROM tag_point_votes WHERE point_id = ANY($1::text[])
               GROUP BY point_id""", point_ids)
        rating_map = {r["point_id"]: (float(r["avg_r"]), int(r["vcnt"])) for r in vote_rows}

        # Vérification membership pour l'utilisateur courant (batch)
        member_rows = await conn.fetch(
            """SELECT spot_you_id FROM spot_you_members
               WHERE spot_you_id = ANY($1::text[]) AND user_id = $2""",
            point_ids, user["user_id"])
        member_set = {r["spot_you_id"] for r in member_rows}

        for pt in points:
            pid = pt["point_id"]
            pt["participants_count"] = part_map.get(pid, 0)
            r_v = rating_map.get(pid)
            pt["rating"] = r_v[0] if r_v else 0
            pt["vote_count"] = r_v[1] if r_v else 0
            pt["is_saved"] = True  # by definition (in saved list)

            is_member = pid in member_set
            pt["can_participate"] = is_member

            nd = _get_next(pt)
            pt["next_session_date"] = nd.isoformat() if nd else None
            if is_member and nd:
                going_count = await conn.fetchval(
                    """SELECT COUNT(*) FROM spot_you_attendance
                       WHERE spot_you_id=$1 AND session_date=$2 AND status='going'""",
                    pid, nd) or 0
                pt["going_count"] = int(going_count)
                pt["is_going"] = bool(await conn.fetchval(
                    """SELECT EXISTS(SELECT 1 FROM spot_you_attendance
                       WHERE spot_you_id=$1 AND user_id=$2 AND session_date=$3 AND status='going')""",
                    pid, user["user_id"], nd))
                max_p = pt.get("maximum_participants")
                pt["is_full"] = max_p is not None and going_count >= max_p
            else:
                pt["going_count"] = None
                pt["is_going"] = False
                pt["is_full"] = False

    return points


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

        # Participants — utiliser spot_you_members (propriétaire toujours inclus via seed/création)
        member_count = await conn.fetchval(
            "SELECT COUNT(*) FROM spot_you_members WHERE spot_you_id=$1", point_id
        ) or 0
        pt["participants_count"] = int(member_count)

        # Prochaine séance
        from routes.spot_you_routes import get_next_session_date as _get_next
        next_date = _get_next(pt)
        pt["next_session_date"] = next_date.isoformat() if next_date else None
        # going_count n'est visible que pour les membres
        pt["going_count"] = None
        pt["is_full"] = False
        pt["can_participate"] = False

        # Current user participation + save
        pt["is_participant"] = False
        pt["is_member"] = False
        pt["is_going"] = False
        pt["is_saved"] = False
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            try:
                user = await require_auth(request, pool)
                # Vérification membre dans spot_you_members
                pt["is_participant"] = bool(await conn.fetchval(
                    "SELECT EXISTS(SELECT 1 FROM spot_you_members WHERE spot_you_id=$1 AND user_id=$2)",
                    point_id, user["user_id"]
                ))
                pt["is_member"] = pt["is_participant"]
                pt["can_participate"] = pt["is_member"]
                if pt["is_member"] and next_date:
                    going_count = await conn.fetchval(
                        """SELECT COUNT(*) FROM spot_you_attendance
                           WHERE spot_you_id=$1 AND session_date=$2 AND status='going'""",
                        point_id, next_date,
                    ) or 0
                    pt["going_count"] = int(going_count)
                    max_p = pt.get("maximum_participants")
                    pt["is_full"] = max_p is not None and going_count >= max_p
                if next_date:
                    pt["is_going"] = bool(await conn.fetchval(
                        """SELECT EXISTS(
                             SELECT 1 FROM spot_you_attendance
                             WHERE spot_you_id=$1 AND user_id=$2 AND session_date=$3 AND status='going'
                           )""",
                        point_id, user["user_id"], next_date,
                    ))
                pt["is_saved"] = bool(await conn.fetchval(
                    "SELECT EXISTS(SELECT 1 FROM tag_point_saves WHERE point_id=$1 AND user_id=$2)",
                    point_id, user["user_id"]
                ))
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
            uid_idx = 4 if current_user_id else None
            exclude_clause = f"AND tp.user_id != ${uid_idx}" if current_user_id else ""
            extra_params = [current_user_id] if current_user_id else []
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
                point_id, current["location"], tag_ids_list, *extra_params
            )
        else:
            uid_idx = 3 if current_user_id else None
            exclude_clause = f"AND tp.user_id != ${uid_idx}" if current_user_id else ""
            extra_params = [current_user_id] if current_user_id else []
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
                point_id, current["location"], *extra_params
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
            "INSERT INTO spot_you_members (id, spot_you_id, user_id) VALUES ($1,$2,$3) ON CONFLICT (spot_you_id, user_id) DO NOTHING",
            pid, point_id, user["user_id"]
        )
        count = await conn.fetchval("SELECT COUNT(*) FROM spot_you_members WHERE spot_you_id=$1", point_id)
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
            "DELETE FROM spot_you_members WHERE spot_you_id=$1 AND user_id=$2",
            point_id, user["user_id"]
        )
        count = await conn.fetchval("SELECT COUNT(*) FROM spot_you_members WHERE spot_you_id=$1", point_id)
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
    """Retourne la liste des participants d'un SpotYou — le propriétaire est toujours inclus en premier."""
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT u.user_id, u.name, u.picture, u.role,
                      (u.user_id = tp.user_id) as is_creator
               FROM spot_you_members m
               JOIN users u ON m.user_id = u.user_id
               JOIN tag_points tp ON tp.point_id = m.spot_you_id
               WHERE m.spot_you_id = $1
               ORDER BY (u.user_id = tp.user_id) DESC, m.joined_at ASC""",
            point_id
        )
        result = [
            {"user_id": r["user_id"], "name": r["name"], "picture": r["picture"], "role": r["role"], "is_creator": r["is_creator"]}
            for r in rows
        ]
    return result


@router.get("/users/me/notifications")
async def get_my_notifications(request: Request, limit: int = Query(50, ge=1, le=200)):
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
        raw = r["data"]
        if not raw:
            data = {}
        elif isinstance(raw, str):
            import json as _j
            try:
                data = _j.loads(raw)
            except Exception:
                data = {}
        else:
            data = dict(raw)
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
            f"""SELECT {TP_FIELDS}, m.joined_at,
                COALESCE(tp.event_date, tp.created_at) as sort_date
                FROM tag_points tp
                JOIN spot_you_members m ON tp.point_id = m.spot_you_id
                LEFT JOIN users u ON tp.user_id = u.user_id
                WHERE m.user_id = $1 AND tp.active = TRUE
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
    Seules les séances cochées via 'Je participe' (spot_you_attendance) apparaissent.
    Être membre d'un SpotYou n'impacte plus le planning."""
    from datetime import timedelta, date as date_type
    import asyncio

    pool = get_pool()
    user = await require_auth(request, pool)

    now = datetime.now(timezone.utc)
    range_start = now - timedelta(days=30)
    range_end   = now + timedelta(days=90)

    async with pool.acquire() as conn:
        # Uniquement les séances auxquelles l'utilisateur a confirmé sa présence
        # et dont la date n'est pas encore passée (heure locale Paris)
        rows = await conn.fetch(
            """SELECT tp.point_id, tp.title, tp.event_date, tp.event_end_date, tp.event_schedule,
                      tp.image_url, tp.user_id as owner_id, u.name as owner_name,
                      tp.cancelled,
                      a.session_date
               FROM tag_points tp
               JOIN spot_you_attendance a ON tp.point_id = a.spot_you_id
               LEFT JOIN users u ON tp.user_id = u.user_id
               WHERE a.user_id = $1 AND a.status = 'going' AND tp.active = TRUE
                 AND (tp.is_public = TRUE OR tp.user_id = $1)
                 AND a.session_date >= (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Paris')::date""",
            user["user_id"]
        )

    events = []
    for row in rows:
        tp = row_to_dict(row)
        event_date     = tp.get("event_date")
        event_schedule = tp.get("event_schedule")
        session_date   = tp.get("session_date")   # date précise de la séance cochée

        # ── Événement unique ──────────────────────────────────────────────────
        if event_date and not event_schedule:
            from zoneinfo import ZoneInfo
            paris = ZoneInfo('Europe/Paris')
            if isinstance(event_date, str):
                from dateutil.parser import parse as _parse
                dt = _parse(event_date)
            else:
                dt = event_date
            dt_local = dt.astimezone(paris)

            end_time_str = None
            end_date_raw = tp.get("event_end_date")
            if end_date_raw:
                if isinstance(end_date_raw, str):
                    from dateutil.parser import parse as _parse2
                    end_dt = _parse2(end_date_raw).astimezone(paris)
                else:
                    end_dt = end_date_raw.astimezone(paris)
                end_time_str = end_dt.strftime("%H:%M")

            events.append({
                "point_id":   tp["point_id"],
                "title":      tp["title"],
                "owner_name": tp.get("owner_name"),
                "image_url":  tp.get("image_url"),
                "is_own":     tp.get("owner_id") == user["user_id"],
                "is_cancelled": bool(tp.get("cancelled")),
                "date":       dt_local.strftime("%Y-%m-%d"),
                "time":       dt_local.strftime("%H:%M"),
                "end_time":   end_time_str,
                "type":       "single",
            })

        # ── Événement récurrent — séance spécifique ───────────────────────────
        elif event_schedule and session_date:
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

            # Récupérer le jour de semaine Python (0=Lun..6=Dim) de la session
            if isinstance(session_date, str):
                from datetime import date as _dt_date
                sd = _dt_date.fromisoformat(session_date)
            else:
                sd = session_date

            py_weekday = sd.weekday()  # 0=Lun..6=Dim

            # Récupérer les créneaux horaires pour ce jour
            schedule_dict = sched.get("schedule", {})
            time_slots = schedule_dict.get(str(py_weekday), [])

            if time_slots:
                # S'il y a plusieurs créneaux dans la journée, créer une entrée par créneau
                for slot in (time_slots if isinstance(time_slots, list) else [time_slots]):
                    if isinstance(slot, str):
                        time_str, end_str = slot, None
                    else:
                        time_str = slot.get("start", "00:00")
                        end_str  = slot.get("end")

                    events.append({
                        "point_id":     tp["point_id"],
                        "title":        tp["title"],
                        "owner_name":   tp.get("owner_name"),
                        "image_url":    tp.get("image_url"),
                        "is_own":       tp.get("owner_id") == user["user_id"],
                        "is_cancelled": bool(tp.get("cancelled")),
                        "date":         sd.isoformat(),
                        "time":         time_str,
                        "end_time":     end_str,
                        "type":         "recurring",
                    })
            else:
                # Pas d'horaire trouvé pour ce jour (données incohérentes) → fallback sans heure
                events.append({
                    "point_id":     tp["point_id"],
                    "title":        tp["title"],
                    "owner_name":   tp.get("owner_name"),
                    "image_url":    tp.get("image_url"),
                    "is_own":       tp.get("owner_id") == user["user_id"],
                    "is_cancelled": bool(tp.get("cancelled")),
                    "date":         sd.isoformat(),
                    "time":         None,
                    "end_time":     None,
                    "type":         "recurring",
                })

    # Dédoublonner (même point_id + date + time)
    seen = set()
    unique = []
    for e in events:
        key = f"{e['point_id']}_{e['date']}_{e.get('time','')}"
        if key not in seen:
            seen.add(key)
            unique.append(e)
    events = unique

    # ── Réservations de services confirmées ────────────────────────────────────
    async with pool.acquire() as conn:
        booking_rows = await conn.fetch(
            """
            SELECT b.booking_id, b.status, b.scheduled_at,
                   COALESCE(b.payer_user_id,   b.user_id)    AS payer_user_id,
                   COALESCE(b.receiver_user_id, b.coach_id)  AS receiver_user_id,
                   b.service_id,
                   s.title AS service_title, s.duration_min,
                   COALESCE(u_coach.name, '') AS coach_name,
                   COALESCE(u_payer.name, '') AS payer_name,
                   ss.end_time AS slot_end,
                   ss.slot_date, ss.start_time AS slot_start
            FROM bookings b
            JOIN services s ON b.service_id = s.service_id
            LEFT JOIN users u_coach ON s.coach_id = u_coach.user_id
            LEFT JOIN users u_payer ON COALESCE(b.payer_user_id, b.user_id) = u_payer.user_id
            LEFT JOIN service_slots ss ON b.slot_id = ss.slot_id
            WHERE (
                COALESCE(b.payer_user_id, b.user_id) = $1
                OR COALESCE(b.receiver_user_id, b.coach_id) = $1
            )
              AND b.status IN ('confirmed', 'awaiting_payment', 'accepted')
              AND (
                b.scheduled_at IS NOT NULL
                OR (ss.slot_date IS NOT NULL AND ss.start_time IS NOT NULL)
              )
              AND (
                COALESCE(b.scheduled_at,
                  (ss.slot_date || ' ' || ss.start_time)::timestamptz
                ) BETWEEN $2 AND $3
              )
            ORDER BY COALESCE(b.scheduled_at, (ss.slot_date || ' ' || ss.start_time)::timestamptz)
            """,
            user["user_id"], range_start, range_end
        )

    from zoneinfo import ZoneInfo as _ZI
    _paris = _ZI('Europe/Paris')
    for row in booking_rows:
        bk = row_to_dict(row)
        scheduled_at = bk.get("scheduled_at")
        if not scheduled_at:
            # Fallback: construire depuis slot_date + slot_start
            slot_date  = bk.get("slot_date")
            slot_start = bk.get("slot_start")
            if slot_date and slot_start:
                from datetime import datetime as _dt2
                d = slot_date if hasattr(slot_date, 'year') else _dt2.strptime(str(slot_date), '%Y-%m-%d').date()
                t = slot_start if hasattr(slot_start, 'hour') else _dt2.strptime(str(slot_start)[:5], '%H:%M').time()
                scheduled_at = _dt2.combine(d, t).replace(tzinfo=_paris)
            else:
                continue
        if isinstance(scheduled_at, str):
            from dateutil.parser import parse as _dp
            scheduled_at = _dp(scheduled_at)
        try:
            dt_local = scheduled_at.astimezone(_paris)
        except Exception:
            continue

        # end_time depuis slot ou durée service
        slot_end = bk.get("slot_end")
        end_time_str = None
        if slot_end is not None:
            if hasattr(slot_end, 'strftime'):
                end_time_str = slot_end.strftime("%H:%M")
            elif isinstance(slot_end, str):
                end_time_str = slot_end[:5]
        elif bk.get("duration_min"):
            end_mins = dt_local.hour * 60 + dt_local.minute + int(bk["duration_min"])
            end_time_str = f"{end_mins // 60:02d}:{end_mins % 60:02d}"

        is_payer = bk["payer_user_id"] == user["user_id"]
        other_name = bk["coach_name"] if is_payer else bk.get("payer_name", "")

        unique.append({
            "point_id":       f"bkg_{bk['booking_id']}",
            "booking_id":     bk["booking_id"],
            "service_id":     bk["service_id"],
            "title":          bk["service_title"],
            "owner_name":     other_name,
            "image_url":      None,
            "is_own":         not is_payer,
            "is_cancelled":   False,
            "date":           dt_local.strftime("%Y-%m-%d"),
            "time":           dt_local.strftime("%H:%M"),
            "end_time":       end_time_str,
            "type":           "booking",
            "booking_status": bk["status"],
            "is_payer":       is_payer,
        })

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

    # Validation max 10 images
    if data.images and len(data.images) > 10:
        raise HTTPException(status_code=400, detail="Maximum 10 images autorisées")

    # Validation : au moins un tag requis (règle métier)
    if not data.tag_ids:
        raise HTTPException(status_code=400, detail="Au moins un tag est requis.")

    # Validation capacité : min ne peut pas dépasser max
    min_p, max_p = data.minimum_participants, data.maximum_participants
    if min_p is not None and max_p is not None and min_p > max_p:
        raise HTTPException(status_code=400, detail="Le nombre minimum de participants ne peut pas dépasser le maximum.")

    stored_lat, stored_lng = randomize_for_storage(data.latitude, data.longitude, data.precision)
    event_schedule_val = data.event_schedule

    # Valeurs par défaut capacité (si un seul champ fourni)
    if min_p is not None and max_p is None:
        max_p = min_p
    elif max_p is not None and min_p is None:
        min_p = max_p
    if min_p is not None and min_p < 1:
        min_p = 1

    async with pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO tag_points
               (point_id, user_id, title, description, location, precision, tag_ids, domain_id, active, expires_at,
                event_date, event_end_date, event_schedule, images, minimum_participants, maximum_participants)
               VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326), $7, $8, $9, TRUE, $10, $11, $12, $13, $14, $15, $16)""",
            pid, user["user_id"], data.title, data.description,
            stored_lng, stored_lat,
            data.precision, data.tag_ids, data.domain_id, expires_at,
            data.event_date, data.event_end_date, event_schedule_val, data.images or [],
            min_p, max_p,
        )
        # Le créateur est automatiquement membre de son SpotYou
        await conn.execute(
            "INSERT INTO spot_you_members (id, spot_you_id, user_id) VALUES ($1,$2,$3) ON CONFLICT (spot_you_id, user_id) DO NOTHING",
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

        # Validation max 10 images
        if 'images' in raw and raw['images'] is not None and len(raw['images']) > 10:
            raise HTTPException(status_code=400, detail="Maximum 10 images autorisées")

        # Validation : tag_ids ne peut pas être vidé (règle métier)
        if 'tag_ids' in raw and raw['tag_ids'] is not None and len(raw['tag_ids']) == 0:
            raise HTTPException(status_code=400, detail="Au moins un tag est requis.")

        # Appliquer les règles métier capacité si l'un des deux champs est fourni
        if 'minimum_participants' in raw or 'maximum_participants' in raw:
            # Récupérer les valeurs existantes pour compléter les non-fournies
            ex_min = existing.get("minimum_participants") if hasattr(existing, 'get') else None
            ex_max = existing.get("maximum_participants") if hasattr(existing, 'get') else None
            try:
                ex_min_db = await conn.fetchval("SELECT minimum_participants FROM tag_points WHERE point_id=$1", point_id)
                ex_max_db = await conn.fetchval("SELECT maximum_participants FROM tag_points WHERE point_id=$1", point_id)
            except Exception:
                ex_min_db, ex_max_db = None, None
            min_p = raw.get('minimum_participants', ex_min_db)
            max_p = raw.get('maximum_participants', ex_max_db)
            # Validation : min ne peut pas dépasser max
            if min_p is not None and max_p is not None and min_p > max_p:
                raise HTTPException(status_code=400, detail="Le nombre minimum de participants ne peut pas dépasser le maximum.")
            if min_p is not None and max_p is None:
                max_p = min_p
                raw['maximum_participants'] = max_p
            elif max_p is not None and min_p is None:
                min_p = max_p
                raw['minimum_participants'] = min_p
            if min_p is not None and min_p < 1:
                raw['minimum_participants'] = 1

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
                    values.append(val)  # passer la liste Python directement (asyncpg codec gère l'encodage)
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
            "SELECT user_id FROM spot_you_members WHERE spot_you_id=$1 AND user_id != $2",
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
            "SELECT COUNT(*) FROM spot_you_members WHERE spot_you_id=$1 AND user_id != $2",
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
            "SELECT user_id FROM spot_you_members WHERE spot_you_id=$1 AND user_id != $2",
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
            "SELECT user_id FROM spot_you_members WHERE spot_you_id=$1 AND user_id != $2",
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
            "SELECT COUNT(*) FROM spot_you_members WHERE spot_you_id=$1 AND user_id != $2",
            point_id, existing["user_id"]
        )
        if other_count > 0:
            raise HTTPException(status_code=400, detail="Impossible: d'autres participants sont inscrits.")
        await conn.execute(
            "UPDATE tag_points SET active = FALSE, updated_at = NOW() WHERE point_id = $1", point_id
        )
    return {"success": True}
