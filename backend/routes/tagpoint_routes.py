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
    tp.precision, tp.tag_ids, tp.domain_id, tp.active, tp.is_public, tp.expires_at, tp.created_at, tp.updated_at,
    tp.image_url, tp.images, tp.schedule, tp.event_date, tp.event_schedule, tp.new_date_coming,
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
                WHERE tp.user_id = $1 ORDER BY tp.created_at DESC""",
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
async def get_similar_tag_points(point_id: str):
    pool = get_pool()
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
            rows = await conn.fetch(
                f"""
                SELECT {TP_FIELDS},
                       ST_Distance(tp.location::geography, $2::geography) AS dist_m
                FROM tag_points tp
                LEFT JOIN users u ON tp.user_id = u.user_id
                WHERE tp.point_id != $1
                  AND tp.active = TRUE
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
            rows = await conn.fetch(
                f"""
                SELECT {TP_FIELDS},
                       ST_Distance(tp.location::geography, $2::geography) AS dist_m
                FROM tag_points tp
                LEFT JOIN users u ON tp.user_id = u.user_id
                WHERE tp.point_id != $1
                  AND tp.active = TRUE
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
    pid = new_id("part")
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO tag_point_participants (participant_id, point_id, user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
            pid, point_id, user["user_id"]
        )
        count = await conn.fetchval("SELECT COUNT(*) FROM tag_point_participants WHERE point_id=$1", point_id)
    return {"success": True, "participants_count": count, "is_participant": True}


@router.delete("/tag-points/{point_id}/leave")
async def leave_tag_point(point_id: str, request: Request):
    pool = get_pool()
    user = await require_auth(request, pool)
    async with pool.acquire() as conn:
        await conn.execute(
            "DELETE FROM tag_point_participants WHERE point_id=$1 AND user_id=$2",
            point_id, user["user_id"]
        )
        count = await conn.fetchval("SELECT COUNT(*) FROM tag_point_participants WHERE point_id=$1", point_id)
    return {"success": True, "participants_count": count, "is_participant": False}


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
    body = await request.json()
    rating = body.get("rating")
    comment = body.get("comment", None)

    if not rating or not (1 <= int(rating) <= 5):
        raise HTTPException(status_code=400, detail="Rating must be between 1 and 5")

    vid = new_id("vote")
    async with pool.acquire() as conn:
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
        # Return updated stats
        stats = await conn.fetchrow(
            "SELECT ROUND(AVG(rating)::numeric, 1) as avg_rating, COUNT(*) as vote_count FROM tag_point_votes WHERE point_id = $1",
            point_id
        )
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
    
    # Apply precision-based randomization to stored coordinates
    stored_lat, stored_lng = randomize_for_storage(data.latitude, data.longitude, data.precision)
    
    event_schedule_val = data.event_schedule  # Pass dict directly — asyncpg JSONB codec handles encoding

    async with pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO tag_points
               (point_id, user_id, title, description, location, precision, tag_ids, domain_id, active, expires_at, event_date, event_schedule, images)
               VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326), $7, $8, $9, TRUE, $10, $11, $12, $13)""",
            pid, user["user_id"], data.title, data.description,
            stored_lng, stored_lat,
            data.precision, data.tag_ids, data.domain_id, expires_at,
            data.event_date, event_schedule_val, data.images or []
        )
        row = await conn.fetchrow(f"SELECT {TP_FIELDS} FROM tag_points tp LEFT JOIN users u ON tp.user_id = u.user_id WHERE tp.point_id = $1", pid)
    return build_point_response(row_to_dict(row))


@router.put("/tag-points/{point_id}")
async def update_tag_point(point_id: str, data: TagPointUpdate, request: Request):
    pool = get_pool()
    user = await require_auth(request, pool)
    async with pool.acquire() as conn:
        existing = await conn.fetchrow("SELECT user_id FROM tag_points WHERE point_id = $1", point_id)
        if not existing:
            raise HTTPException(status_code=404, detail="TagPoint not found")
        if existing["user_id"] != user["user_id"] and user["role"] != "admin":
            raise HTTPException(status_code=403, detail="Not authorized")

        update_dict = {k: v for k, v in data.model_dump().items() if v is not None}
        if not update_dict:
            row = await conn.fetchrow(f"SELECT {TP_FIELDS} FROM tag_points tp LEFT JOIN users u ON tp.user_id = u.user_id WHERE tp.point_id = $1", point_id)
            return build_point_response(row_to_dict(row))

        set_clauses = []
        values = []
        i = 1
        for key, val in update_dict.items():
            if key == "tag_ids":
                set_clauses.append(f"tag_ids = ${i}::jsonb")
                values.append(json.dumps(val))
            else:
                set_clauses.append(f"{key} = ${i}")
                values.append(val)
            i += 1
        values.append(point_id)
        set_clauses.append("updated_at = NOW()")
        query = f"UPDATE tag_points SET {', '.join(set_clauses)} WHERE point_id = ${i}"
        await conn.execute(query, *values)
        row = await conn.fetchrow(f"SELECT {TP_FIELDS} FROM tag_points tp LEFT JOIN users u ON tp.user_id = u.user_id WHERE tp.point_id = $1", point_id)
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
    """Owner can toggle public/private visibility."""
    pool = get_pool()
    user = await require_auth(request, pool)
    async with pool.acquire() as conn:
        existing = await conn.fetchrow(
            "SELECT user_id, is_public FROM tag_points WHERE point_id = $1 AND active = TRUE", point_id
        )
        if not existing:
            raise HTTPException(status_code=404, detail="TagPoint not found")
        if existing["user_id"] != user["user_id"] and user["role"] != "admin":
            raise HTTPException(status_code=403, detail="Not authorized")
        new_val = not (existing["is_public"] if existing["is_public"] is not None else True)
        await conn.execute(
            "UPDATE tag_points SET is_public = $1, updated_at = NOW() WHERE point_id = $2",
            new_val, point_id
        )
    return {"is_public": new_val}


@router.delete("/tag-points/{point_id}")
async def delete_tag_point(point_id: str, request: Request):
    pool = get_pool()
    user = await require_auth(request, pool)
    async with pool.acquire() as conn:
        existing = await conn.fetchrow("SELECT user_id FROM tag_points WHERE point_id = $1", point_id)
        if not existing:
            raise HTTPException(status_code=404, detail="TagPoint not found")
        if existing["user_id"] != user["user_id"] and user["role"] != "admin":
            raise HTTPException(status_code=403, detail="Not authorized")
        await conn.execute(
            "UPDATE tag_points SET active = FALSE, updated_at = NOW() WHERE point_id = $1", point_id
        )
    return {"success": True}
