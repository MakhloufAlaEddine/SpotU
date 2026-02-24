from fastapi import APIRouter, Request, HTTPException, Query
from datetime import datetime, timezone
from typing import Optional
from models import ServiceCreate, ServiceUpdate, new_id
from auth_utils import require_auth
from database import get_pool, row_to_dict, rows_to_list
import json

router = APIRouter()

SVC_FIELDS = """
    service_id, coach_id, title, description, price, duration_min,
    tag_ids, domain_id, location_description, max_participants, active, created_at, updated_at,
    ST_Y(location::geometry) as latitude,
    ST_X(location::geometry) as longitude
"""


def build_service(row_dict: dict) -> dict:
    lat = row_dict.pop("latitude", None)
    lng = row_dict.pop("longitude", None)
    if lat is not None and lng is not None:
        row_dict["location"] = {"type": "Point", "coordinates": [lng, lat]}
    else:
        row_dict["location"] = None
    return row_dict


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
            f"ST_DWithin(location::geography, ST_SetSRID(ST_MakePoint(${param_idx}, ${param_idx+1}), 4326)::geography, ${param_idx+2})"
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
    return [build_service(row_to_dict(r)) for r in rows]


@router.get("/services/{service_id}")
async def get_service(service_id: str):
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(f"SELECT {SVC_FIELDS} FROM services WHERE service_id = $1", service_id)
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
        if data.latitude and data.longitude:
            await conn.execute(
                """INSERT INTO services
                   (service_id, coach_id, title, description, price, duration_min, tag_ids, domain_id,
                    location, location_description, max_participants, active)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,ST_SetSRID(ST_MakePoint($9,$10),4326),$11,$12,TRUE)""",
                sid, user["user_id"], data.title, data.description, data.price, data.duration_min,
                json.dumps(data.tag_ids), data.domain_id,
                data.longitude, data.latitude,
                data.location_description, data.max_participants
            )
        else:
            await conn.execute(
                """INSERT INTO services
                   (service_id, coach_id, title, description, price, duration_min, tag_ids, domain_id,
                    location_description, max_participants, active)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE)""",
                sid, user["user_id"], data.title, data.description, data.price, data.duration_min,
                json.dumps(data.tag_ids), data.domain_id,
                data.location_description, data.max_participants
            )
        row = await conn.fetchrow(f"SELECT {SVC_FIELDS} FROM services WHERE service_id = $1", sid)
    return build_service(row_to_dict(row))


@router.put("/services/{service_id}")
async def update_service(service_id: str, data: ServiceUpdate, request: Request):
    pool = get_pool()
    user = await require_auth(request, pool)
    async with pool.acquire() as conn:
        existing = await conn.fetchrow("SELECT coach_id FROM services WHERE service_id = $1", service_id)
        if not existing:
            raise HTTPException(status_code=404, detail="Service not found")
        if existing["coach_id"] != user["user_id"] and user["role"] != "admin":
            raise HTTPException(status_code=403, detail="Not authorized")

        update_dict = {k: v for k, v in data.model_dump().items() if v is not None}
        if not update_dict:
            row = await conn.fetchrow(f"SELECT {SVC_FIELDS} FROM services WHERE service_id = $1", service_id)
            return build_service(row_to_dict(row))

        set_clauses = [f"{k} = ${i+1}" for i, k in enumerate(update_dict.keys())]
        set_clauses.append("updated_at = NOW()")
        values = list(update_dict.values())
        values.append(service_id)
        query = f"UPDATE services SET {', '.join(set_clauses)} WHERE service_id = ${len(values)}"
        await conn.execute(query, *values)
        row = await conn.fetchrow(f"SELECT {SVC_FIELDS} FROM services WHERE service_id = $1", service_id)
    return build_service(row_to_dict(row))


@router.delete("/services/{service_id}")
async def delete_service(service_id: str, request: Request):
    pool = get_pool()
    user = await require_auth(request, pool)
    async with pool.acquire() as conn:
        existing = await conn.fetchrow("SELECT coach_id FROM services WHERE service_id = $1", service_id)
        if not existing:
            raise HTTPException(status_code=404, detail="Service not found")
        if existing["coach_id"] != user["user_id"] and user["role"] != "admin":
            raise HTTPException(status_code=403, detail="Not authorized")
        await conn.execute(
            "UPDATE services SET active = FALSE, updated_at = NOW() WHERE service_id = $1", service_id
        )
    return {"success": True}
