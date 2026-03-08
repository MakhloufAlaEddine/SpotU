from fastapi import APIRouter, Request, HTTPException, Query
from typing import Optional
from models import ServiceCreate, ServiceUpdate, new_id
from auth_utils import require_auth, get_token_from_request, decode_jwt
from database import get_pool, row_to_dict, rows_to_list
import json

router = APIRouter()

SVC_FIELDS = """
    service_id, coach_id, title, description, address, price, duration_min,
    tag_ids, domain_id, location_description, max_participants, active, images, created_at, updated_at,
    booking_approval_mode, allow_pay_later, pay_later_expiration_minutes
"""


def build_service(row_dict: dict) -> dict:
    # Parse images JSON string → list
    raw_images = row_dict.get("images")
    if isinstance(raw_images, str):
        try:
            row_dict["images"] = json.loads(raw_images)
        except (json.JSONDecodeError, TypeError):
            row_dict["images"] = []
    elif raw_images is None:
        row_dict["images"] = []
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
        """SELECT slot_id, slot_type, location_id, package_id, day_of_week, days_of_week, start_time, end_time, slot_date
           FROM service_slots ss
           WHERE ss.service_id = $1
           AND (
               ss.slot_date IS NULL
               OR (ss.slot_date || ' ' || ss.start_time)::timestamp > NOW()::timestamp
           )
           AND NOT EXISTS (
               -- Masquer les créneaux avec réservation active (pending, accepted, awaiting_payment, confirmed)
               SELECT 1 FROM bookings b
               WHERE b.slot_id = ss.slot_id
               AND b.status IN ('pending', 'accepted', 'awaiting_payment', 'confirmed')
           )
           ORDER BY ss.slot_date NULLS LAST, ss.start_time""",
        service_id
    )
    return rows_to_list(rows)


async def _get_service_packages(conn, service_id: str) -> list:
    pkgs = await conn.fetch(
        "SELECT package_id, type_id, type_label, duration_min, max_participants, price FROM service_packages WHERE service_id = $1 ORDER BY created_at",
        service_id
    )
    result = []
    for pkg in pkgs:
        pkg_dict = row_to_dict(pkg)
        slots = await conn.fetch(
            """SELECT slot_id, slot_date, start_time, end_time
               FROM service_slots ss
               WHERE ss.package_id = $1
               AND (
                   ss.slot_date IS NULL
                   OR (ss.slot_date || ' ' || ss.start_time)::timestamp > NOW()::timestamp
               )
               AND NOT EXISTS (
                   SELECT 1 FROM bookings b
                   WHERE b.slot_id = ss.slot_id
                   AND b.status IN ('pending', 'accepted', 'awaiting_payment', 'confirmed')
               )
               ORDER BY ss.slot_date, ss.start_time""",
            pkg["package_id"]
        )
        pkg_dict["slots"] = rows_to_list(slots)
        result.append(pkg_dict)
    return result


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
    svc["packages"] = await _get_service_packages(conn, svc["service_id"])
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
    request: Request = None,
):
    pool = get_pool()

    # Determine current user to exclude their own services
    current_user_id = None
    try:
        token = get_token_from_request(request)
        if token:
            payload = decode_jwt(token)
            current_user_id = payload.get("user_id")
    except Exception:
        pass

    conditions = ["active = TRUE"]
    # Exclure les services créés par l'utilisateur connecté (accessibles via "Mes services")
    params: list = []
    param_idx = 1
    if current_user_id:
        conditions.append(f"coach_id != ${param_idx}")
        params.append(current_user_id)
        param_idx += 1

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
            f"SELECT {SVC_FIELDS} FROM services WHERE coach_id = $1 AND active = TRUE ORDER BY created_at DESC",
            user["user_id"]
        )
        services = [build_service(row_to_dict(r)) for r in rows]
        result = []
        for svc in services:
            result.append(await _enrich_service(conn, svc))
    return result


@router.get("/services/saved")
async def get_saved_services(request: Request):
    pool = get_pool()
    user = await require_auth(request, pool)
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT s.service_id, s.title, s.price, s.images, s.address, s.location_description,
                      ss.saved_at,
                      json_build_object('user_id', u.user_id, 'name', u.name, 'picture', u.picture) as coach
               FROM service_saves ss
               JOIN services s ON ss.service_id = s.service_id
               JOIN users u ON s.coach_id = u.user_id
               WHERE ss.user_id = $1
               ORDER BY ss.saved_at DESC""",
            user["user_id"]
        )
        result = []
        for row in rows:
            d = dict(row)
            d["images"] = d.get("images") or []
            if isinstance(d["images"], str):
                import json as _j; d["images"] = _j.loads(d["images"])
            if isinstance(d.get("coach"), str):
                import json as _j; d["coach"] = _j.loads(d["coach"])
            result.append(d)
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
    # Compute service-level price: use data.price or min from packages, default 0
    service_price = data.price
    if service_price is None:
        service_price = min((p.price for p in data.packages), default=0.0)

    async with pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO services
               (service_id, coach_id, title, description, address, price, duration_min,
                tag_ids, domain_id, max_participants, images, active,
                booking_approval_mode, allow_pay_later, pay_later_expiration_minutes)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE,$12,$13,$14)""",
            sid, user["user_id"], data.title, data.description, data.address,
            service_price, data.duration_min, data.tag_ids, data.domain_id,
            data.max_participants, data.images or [],
            getattr(data, 'booking_approval_mode', None) or 'manual_approval',
            getattr(data, 'allow_pay_later', True) if getattr(data, 'allow_pay_later', True) is not None else True,
            getattr(data, 'pay_later_expiration_minutes', None) or 1440,
        )

        # Handle packages (new model)
        for pkg in data.packages:
            pkg_id = new_id("pkg")
            await conn.execute(
                """INSERT INTO service_packages
                   (package_id, service_id, type_id, type_label, duration_min, max_participants, price)
                   VALUES ($1,$2,$3,$4,$5,$6,$7)""",
                pkg_id, sid, pkg.type_id, pkg.type_label, pkg.duration_min,
                pkg.max_participants, pkg.price
            )
            for slot in pkg.slots:
                slotid = new_id("slot")
                await conn.execute(
                    """INSERT INTO service_slots
                       (slot_id, service_id, package_id, slot_type, slot_date, start_time, end_time)
                       VALUES ($1,$2,$3,'single',$4,$5,$6)""",
                    slotid, sid, pkg_id, slot.slot_date, slot.start_time, slot.end_time
                )

        # Handle legacy locations
        loc_ids: list[str] = []
        for loc in data.locations:
            lid = new_id("sloc")
            await conn.execute(
                """INSERT INTO service_locations
                   (location_id, service_id, location, precision, description)
                   VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5, $6)""",
                lid, sid, loc.longitude, loc.latitude, loc.precision, loc.description
            )
            loc_ids.append(lid)

        # Handle legacy slots
        for slot in data.slots:
            slotid = new_id("slot")
            days = slot.days_of_week if slot.days_of_week is not None else (
                [slot.day_of_week] if slot.day_of_week is not None else []
            )
            if slot.location_index is not None and 0 <= slot.location_index < len(loc_ids):
                resolved_loc_id = loc_ids[slot.location_index]
            else:
                resolved_loc_id = loc_ids[0] if loc_ids else None
            await conn.execute(
                """INSERT INTO service_slots
                   (slot_id, service_id, location_id, slot_type, days_of_week, day_of_week, start_time, end_time, slot_date)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)""",
                slotid, sid, resolved_loc_id, slot.slot_type,
                days, days[0] if days else None,
                slot.start_time, slot.end_time, slot.slot_date
            )

        row = await conn.fetchrow(
            f"SELECT {SVC_FIELDS} FROM services WHERE service_id = $1", sid
        )
        svc = build_service(row_to_dict(row))
        svc = await _enrich_service(conn, svc)
    return svc


@router.put("/services/{service_id}")
@router.patch("/services/{service_id}")
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
                         'location_description', 'max_participants', 'domain_id',
                         'booking_approval_mode', 'allow_pay_later', 'pay_later_expiration_minutes'}
        raw = data.model_dump()
        update_dict = {k: raw[k] for k in SCALAR_FIELDS if raw.get(k) is not None}

        # JSONB fields — passer les listes Python directement avec cast ::jsonb
        jsonb_updates: dict = {}
        if raw.get('tag_ids') is not None:
            jsonb_updates['tag_ids'] = raw['tag_ids']

        if raw.get('images') is not None:
            old_imgs_row = await conn.fetchrow("SELECT images FROM services WHERE service_id = $1", service_id)
            if old_imgs_row:
                raw_old = old_imgs_row["images"]
                if isinstance(raw_old, str):
                    try:
                        old_images = json.loads(raw_old)
                    except Exception:
                        old_images = []
                elif isinstance(raw_old, list):
                    old_images = raw_old
                else:
                    old_images = []
            else:
                old_images = []
            new_images = raw['images'] or []
            removed = [url for url in old_images if url not in new_images]
            if removed:
                from routes.upload_routes import delete_upload_files
                delete_upload_files(removed)
            jsonb_updates['images'] = new_images

        if update_dict or jsonb_updates:
            set_clauses = []
            values = []
            i = 1
            for k, v in update_dict.items():
                set_clauses.append(f"{k} = ${i}")
                values.append(v)
                i += 1
            for k, v in jsonb_updates.items():
                set_clauses.append(f"{k} = ${i}::jsonb")
                values.append(v)
                i += 1
            set_clauses.append("updated_at = NOW()")
            values.append(service_id)
            await conn.execute(
                f"UPDATE services SET {', '.join(set_clauses)} WHERE service_id = ${i}",
                *values
            )

        # Replace locations if provided (None = keep, [] = delete all)
        new_loc_ids: list[str] = []
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
                new_loc_ids.append(lid)

        # Replace slots if provided (None = keep, [] = delete all)
        if data.slots is not None:
            await conn.execute("DELETE FROM service_slots WHERE service_id = $1", service_id)
            # If no new locations were inserted, fetch existing ones for FK resolution
            loc_id_list = new_loc_ids
            if not loc_id_list:
                existing_locs = await conn.fetch(
                    "SELECT location_id FROM service_locations WHERE service_id = $1 ORDER BY created_at",
                    service_id
                )
                loc_id_list = [r["location_id"] for r in existing_locs]
            for slot in data.slots:
                slotid = new_id("slot")
                days = slot.days_of_week if slot.days_of_week is not None else (
                    [slot.day_of_week] if slot.day_of_week is not None else []
                )
                if slot.location_index is not None and 0 <= slot.location_index < len(loc_id_list):
                    resolved_loc_id = loc_id_list[slot.location_index]
                else:
                    resolved_loc_id = loc_id_list[0] if loc_id_list else None
                await conn.execute(
                    """INSERT INTO service_slots
                       (slot_id, service_id, location_id, slot_type, days_of_week, day_of_week, start_time, end_time, slot_date)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)""",
                    slotid, service_id, resolved_loc_id, slot.slot_type,
                    days,
                    days[0] if days else None,
                    slot.start_time, slot.end_time, slot.slot_date
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


@router.post("/services/{service_id}/save")
async def save_service(service_id: str, request: Request):
    pool = get_pool()
    user = await require_auth(request, pool)
    async with pool.acquire() as conn:
        existing = await conn.fetchrow("SELECT 1 FROM services WHERE service_id=$1 AND active=TRUE", service_id)
        if not existing:
            raise HTTPException(status_code=404, detail="Service not found")
        sid = new_id("svs")
        await conn.execute(
            "INSERT INTO service_saves (save_id, service_id, user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
            sid, service_id, user["user_id"]
        )
    return {"success": True, "is_saved": True}


@router.delete("/services/{service_id}/unsave")
async def unsave_service(service_id: str, request: Request):
    pool = get_pool()
    user = await require_auth(request, pool)
    async with pool.acquire() as conn:
        await conn.execute(
            "DELETE FROM service_saves WHERE service_id=$1 AND user_id=$2",
            service_id, user["user_id"]
        )
    return {"success": True, "is_saved": False}
