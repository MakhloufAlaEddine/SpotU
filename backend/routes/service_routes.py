from fastapi import APIRouter, Request, HTTPException, Query
from typing import Optional
from models import ServiceCreate, ServiceUpdate, new_id
from auth_utils import require_auth
from database import get_pool, row_to_dict, rows_to_list
import json

router = APIRouter()

SVC_FIELDS = """
    service_id, coach_id, title, description, price, duration_min,
    tag_ids, domain_id, location_description, max_participants, active, created_at, updated_at
"""


def build_service(row_dict: dict) -> dict:
    return row_dict


async def _get_service_locations(conn, service_id: str) -> list:
    rows = await conn.fetch(
        """SELECT location_id, precision, description,
           ST_Y(location::geometry) as latitude,
           ST_X(location::geometry) as longitude
           FROM service_locations WHERE service_id = $1""",
        service_id
    )
    return [row_to_dict(r) for r in rows]


async def _get_service_slots(conn, service_id: str) -> list:
    rows = await conn.fetch(
        """SELECT slot_id, slot_type, day_of_week, start_time, end_time, slot_date
           FROM service_slots WHERE service_id = $1 ORDER BY day_of_week, start_time""",
        service_id
    )
    return rows_to_list(rows)


async def _enrich_service(conn, svc: dict) -> dict:
    coach_row = await conn.fetchrow(
        "SELECT user_id, name, picture, is_coach_verified FROM users WHERE user_id = $1",
        svc["coach_id"]
    )
    svc["coach"] = row_to_dict(coach_row)
    reviews = await conn.fetch(
        "SELECT rating FROM reviews WHERE reviewee_id = $1", svc["coach_id"]
    )
    svc["avg_rating"] = round(sum(r["rating"] for r in reviews) / len(reviews), 1) if reviews else None
    svc["review_count"] = len(reviews)
    svc["locations"] = await _get_service_locations(conn, svc["service_id"])
    svc["slots"] = await _get_service_slots(conn, svc["service_id"])
    # Resolve tags
    import json as _json
    raw_tags = svc.get("tag_ids")
    if isinstance(raw_tags, str):
        raw_tags = _json.loads(raw_tags)
    svc["tag_ids"] = raw_tags if raw_tags else []
    if raw_tags:
        tag_rows = await conn.fetch(
            "SELECT tag_id, label_fr, label_en, category_id FROM tags WHERE tag_id = ANY($1::text[])",
            raw_tags
        )
        svc["tags"] = rows_to_list(tag_rows)
    else:
        svc["tags"] = []
    return svc


@router.get("/services")
async def search_services(
    lat: Optional[float] = Query(None),
    lng: Optional[float] = Query(None),
    radius: Optional[int] = Query(10000),
    coach_id: Optional[str] = Query(None),
    domain_id: Optional[str] = Query(None),
):
    pool = get_pool()
    conditions = ["active = TRUE"]
    params = []
    param_idx = 1

    if lat is not None and lng is not None:
        conditions.append(
            f"""EXISTS (
                SELECT 1 FROM service_locations sl
                WHERE sl.service_id = service_id
                AND ST_DWithin(sl.location::geography,
                    ST_SetSRID(ST_MakePoint(${param_idx}, ${param_idx+1}), 4326)::geography,
                    ${param_idx+2})
            )"""
        )
        params.extend([lng, lat, radius])
        param_idx += 3

    if coach_id:
        conditions.append(f"coach_id = ${param_idx}")
        params.append(coach_id)
        param_idx += 1

    if domain_id:
        conditions.append(f"domain_id = ${param_idx}")
        params.append(domain_id)
        param_idx += 1

    where_clause = " AND ".join(conditions)
    query = f"SELECT {SVC_FIELDS} FROM services WHERE {where_clause} LIMIT 100"

    async with pool.acquire() as conn:
        rows = await conn.fetch(query, *params)
        services = [build_service(row_to_dict(r)) for r in rows]
        enriched = []
        for svc in services:
            enriched.append(await _enrich_service(conn, svc))
    return enriched


@router.get("/services/mine")
async def my_services(request: Request):
    pool = get_pool()
    user = await require_auth(request, pool)
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"SELECT {SVC_FIELDS} FROM services WHERE coach_id = $1 ORDER BY created_at DESC",
            user["user_id"]
        )
        services = [build_service(row_to_dict(r)) for r in rows]
        result = []
        for svc in services:
            result.append(await _enrich_service(conn, svc))
    return result


@router.get("/services/{service_id}")
async def get_service(service_id: str):
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            f"SELECT {SVC_FIELDS} FROM services WHERE service_id = $1", service_id
        )
        if not row:
            raise HTTPException(status_code=404, detail="Service not found")
        svc = build_service(row_to_dict(row))
        svc = await _enrich_service(conn, svc)
    return svc


@router.post("/services")
async def create_service(data: ServiceCreate, request: Request):
    pool = get_pool()
    user = await require_auth(request, pool)
    if user["role"] not in ("coach", "admin"):
        raise HTTPException(status_code=403, detail="Coach role required")
    sid = new_id("svc")
    async with pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO services
               (service_id, coach_id, title, description, price, duration_min,
                tag_ids, domain_id, max_participants, active)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE)""",
            sid, user["user_id"], data.title, data.description, data.price,
            data.duration_min, data.tag_ids, data.domain_id,
            data.max_participants
        )
        for loc in data.locations:
            lid = new_id("sloc")
            await conn.execute(
                """INSERT INTO service_locations
                   (location_id, service_id, location, precision, description)
                   VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5, $6)""",
                lid, sid, loc.longitude, loc.latitude, loc.precision, loc.description
            )
        for slot in data.slots:
            slotid = new_id("slot")
            await conn.execute(
                """INSERT INTO service_slots
                   (slot_id, service_id, day_of_week, start_time, end_time)
                   VALUES ($1, $2, $3, $4, $5)""",
                slotid, sid, slot.day_of_week, slot.start_time, slot.end_time
            )
        row = await conn.fetchrow(
            f"SELECT {SVC_FIELDS} FROM services WHERE service_id = $1", sid
        )
        svc = build_service(row_to_dict(row))
        svc = await _enrich_service(conn, svc)
    return svc


@router.put("/services/{service_id}")
async def update_service(service_id: str, data: ServiceUpdate, request: Request):
    pool = get_pool()
    user = await require_auth(request, pool)
    async with pool.acquire() as conn:
        existing = await conn.fetchrow(
            "SELECT coach_id FROM services WHERE service_id = $1", service_id
        )
        if not existing:
            raise HTTPException(status_code=404, detail="Service not found")
        if existing["coach_id"] != user["user_id"] and user["role"] != "admin":
            raise HTTPException(status_code=403, detail="Not authorized")

        # Update scalar fields only
        SCALAR_FIELDS = {'title', 'description', 'price', 'duration_min', 'active',
                         'location_description', 'max_participants', 'domain_id'}
        raw = data.model_dump()
        update_dict = {k: raw[k] for k in SCALAR_FIELDS if raw.get(k) is not None}
        if raw.get('tag_ids') is not None:
            update_dict['tag_ids'] = raw['tag_ids']

        if update_dict:
            set_clauses = [f"{k} = ${i+1}" for i, k in enumerate(update_dict.keys())]
            set_clauses.append("updated_at = NOW()")
            values = list(update_dict.values())
            values.append(service_id)
            await conn.execute(
                f"UPDATE services SET {', '.join(set_clauses)} WHERE service_id = ${len(values)}",
                *values
            )

        # Replace locations if provided (None = keep, [] = delete all)
        if data.locations is not None:
            await conn.execute("DELETE FROM service_locations WHERE service_id = $1", service_id)
            for loc in data.locations:
                lid = new_id("sloc")
                await conn.execute(
                    """INSERT INTO service_locations
                       (location_id, service_id, location, precision, description)
                       VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5, $6)""",
                    lid, service_id, loc.longitude, loc.latitude, loc.precision, loc.description
                )

        # Replace slots if provided (None = keep, [] = delete all)
        if data.slots is not None:
            await conn.execute("DELETE FROM service_slots WHERE service_id = $1", service_id)
            for slot in data.slots:
                slotid = new_id("slot")
                await conn.execute(
                    """INSERT INTO service_slots
                       (slot_id, service_id, day_of_week, start_time, end_time)
                       VALUES ($1, $2, $3, $4, $5)""",
                    slotid, service_id, slot.day_of_week, slot.start_time, slot.end_time
                )

        row = await conn.fetchrow(
            f"SELECT {SVC_FIELDS} FROM services WHERE service_id = $1", service_id
        )
        svc = build_service(row_to_dict(row))
        return await _enrich_service(conn, svc)


@router.delete("/services/{service_id}")
async def delete_service(service_id: str, request: Request):
    pool = get_pool()
    user = await require_auth(request, pool)
    async with pool.acquire() as conn:
        existing = await conn.fetchrow(
            "SELECT coach_id FROM services WHERE service_id = $1", service_id
        )
        if not existing:
            raise HTTPException(status_code=404, detail="Service not found")
        if existing["coach_id"] != user["user_id"] and user["role"] != "admin":
            raise HTTPException(status_code=403, detail="Not authorized")
        await conn.execute(
            "UPDATE services SET active = FALSE, updated_at = NOW() WHERE service_id = $1",
            service_id
        )
    return {"success": True}
