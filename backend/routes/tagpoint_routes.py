from fastapi import APIRouter, Request, HTTPException, Query
from datetime import datetime, timezone, timedelta
from typing import Optional, List
from models import TagPointCreate, TagPointUpdate, new_id
from auth_utils import require_auth
from database import get_db
import math

router = APIRouter()

DEFAULT_RADIUS = 5000  # 5km


def apply_precision_offset(lat: float, lng: float, precision: str):
    """Return lat/lng with precision-based rounding for non-owners."""
    if precision == "100m":
        # Round to ~100m grid
        return round(lat, 3), round(lng, 3)
    elif precision == "1000m":
        # Round to ~1km grid
        return round(lat, 2), round(lng, 2)
    return lat, lng


@router.get("/tag-points")
async def search_tag_points(
    lat: Optional[float] = Query(None),
    lng: Optional[float] = Query(None),
    radius: Optional[int] = Query(DEFAULT_RADIUS),
    domain_id: Optional[str] = Query(None),
    tag_ids: Optional[str] = Query(None),
    request: Request = None,
):
    db = get_db()
    query = {"active": True}

    if lat is not None and lng is not None:
        query["location"] = {
            "$near": {
                "$geometry": {"type": "Point", "coordinates": [lng, lat]},
                "$maxDistance": radius,
            }
        }
    if domain_id:
        query["domain_id"] = domain_id
    if tag_ids:
        ids = [t.strip() for t in tag_ids.split(",") if t.strip()]
        if ids:
            query["tag_ids"] = {"$in": ids}

    points = await db.tag_points.find(query, {"_id": 0}).to_list(200)

    # Get current user if authenticated
    current_user_id = None
    try:
        from auth_utils import get_token_from_request, decode_jwt
        token = get_token_from_request(request)
        if token:
            payload = decode_jwt(token)
            current_user_id = payload.get("user_id")
    except Exception:
        pass

    # Apply precision masking for non-owners
    result = []
    for pt in points:
        if pt.get("user_id") != current_user_id and pt.get("precision") in ("100m", "1000m"):
            loc = pt.get("location", {})
            coords = loc.get("coordinates", [0, 0])
            new_lat, new_lng = apply_precision_offset(coords[1], coords[0], pt["precision"])
            pt["location"] = {"type": "Point", "coordinates": [new_lng, new_lat]}
        result.append(pt)
    return result


@router.get("/tag-points/mine")
async def my_tag_points(request: Request):
    db = get_db()
    user = await require_auth(request, db)
    points = await db.tag_points.find({"user_id": user["user_id"]}, {"_id": 0}).to_list(100)
    return points


@router.get("/tag-points/{point_id}")
async def get_tag_point(point_id: str, request: Request):
    db = get_db()
    pt = await db.tag_points.find_one({"point_id": point_id}, {"_id": 0})
    if not pt:
        raise HTTPException(status_code=404, detail="TagPoint not found")
    # Enrich with user info
    owner = await db.users.find_one({"user_id": pt["user_id"]}, {"_id": 0, "password_hash": 0, "email": 0})
    pt["owner"] = owner
    # Enrich with tags
    if pt.get("tag_ids"):
        tags = await db.tags.find({"tag_id": {"$in": pt["tag_ids"]}}, {"_id": 0}).to_list(20)
        pt["tags"] = tags
    return pt


@router.post("/tag-points")
async def create_tag_point(data: TagPointCreate, request: Request):
    db = get_db()
    user = await require_auth(request, db)
    expires_at = None
    if data.expires_hours:
        expires_at = datetime.now(timezone.utc) + timedelta(hours=data.expires_hours)
    doc = {
        "point_id": new_id("pt"),
        "user_id": user["user_id"],
        "title": data.title,
        "description": data.description,
        "location": {"type": "Point", "coordinates": [data.longitude, data.latitude]},
        "precision": data.precision,
        "tag_ids": data.tag_ids,
        "domain_id": data.domain_id,
        "active": True,
        "expires_at": expires_at,
        "created_at": datetime.now(timezone.utc),
    }
    await db.tag_points.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.put("/tag-points/{point_id}")
async def update_tag_point(point_id: str, data: TagPointUpdate, request: Request):
    db = get_db()
    user = await require_auth(request, db)
    pt = await db.tag_points.find_one({"point_id": point_id})
    if not pt:
        raise HTTPException(status_code=404, detail="TagPoint not found")
    if pt["user_id"] != user["user_id"] and user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")
    update = {k: v for k, v in data.model_dump().items() if v is not None}
    update["updated_at"] = datetime.now(timezone.utc)
    await db.tag_points.update_one({"point_id": point_id}, {"$set": update})
    updated = await db.tag_points.find_one({"point_id": point_id}, {"_id": 0})
    return updated


@router.delete("/tag-points/{point_id}")
async def delete_tag_point(point_id: str, request: Request):
    db = get_db()
    user = await require_auth(request, db)
    pt = await db.tag_points.find_one({"point_id": point_id})
    if not pt:
        raise HTTPException(status_code=404, detail="TagPoint not found")
    if pt["user_id"] != user["user_id"] and user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")
    await db.tag_points.update_one({"point_id": point_id}, {"$set": {"active": False}})
    return {"success": True}
