from fastapi import APIRouter, Request, HTTPException, Query
from datetime import datetime, timezone
from typing import Optional
from models import ServiceCreate, ServiceUpdate, new_id
from auth_utils import require_auth
from database import get_db

router = APIRouter()


@router.get("/services")
async def search_services(
    lat: Optional[float] = Query(None),
    lng: Optional[float] = Query(None),
    radius: Optional[int] = Query(10000),
    coach_id: Optional[str] = Query(None),
    domain_id: Optional[str] = Query(None),
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
    if coach_id:
        query["coach_id"] = coach_id
    if domain_id:
        query["domain_id"] = domain_id

    services = await db.services.find(query, {"_id": 0}).to_list(100)
    # Enrich with coach info
    for svc in services:
        coach = await db.users.find_one(
            {"user_id": svc["coach_id"]},
            {"_id": 0, "password_hash": 0, "email": 0}
        )
        svc["coach"] = coach
        reviews = await db.reviews.find({"reviewee_id": svc["coach_id"]}).to_list(100)
        svc["avg_rating"] = round(sum(r["rating"] for r in reviews) / len(reviews), 1) if reviews else None
        svc["review_count"] = len(reviews)
    return services


@router.get("/services/mine")
async def my_services(request: Request):
    db = get_db()
    user = await require_auth(request, db)
    services = await db.services.find({"coach_id": user["user_id"]}, {"_id": 0}).to_list(50)
    return services


@router.get("/services/{service_id}")
async def get_service(service_id: str):
    db = get_db()
    svc = await db.services.find_one({"service_id": service_id}, {"_id": 0})
    if not svc:
        raise HTTPException(status_code=404, detail="Service not found")
    coach = await db.users.find_one({"user_id": svc["coach_id"]}, {"_id": 0, "password_hash": 0, "email": 0})
    svc["coach"] = coach
    reviews = await db.reviews.find({"reviewee_id": svc["coach_id"]}).to_list(100)
    svc["avg_rating"] = round(sum(r["rating"] for r in reviews) / len(reviews), 1) if reviews else None
    svc["review_count"] = len(reviews)
    return svc


@router.post("/services")
async def create_service(data: ServiceCreate, request: Request):
    db = get_db()
    user = await require_auth(request, db)
    if user["role"] not in ("coach", "admin"):
        raise HTTPException(status_code=403, detail="Coach role required")
    location = None
    if data.latitude and data.longitude:
        location = {"type": "Point", "coordinates": [data.longitude, data.latitude]}
    doc = {
        "service_id": new_id("svc"),
        "coach_id": user["user_id"],
        "title": data.title,
        "description": data.description,
        "price": data.price,
        "duration_min": data.duration_min,
        "tag_ids": data.tag_ids,
        "domain_id": data.domain_id,
        "location": location,
        "location_description": data.location_description,
        "max_participants": data.max_participants,
        "active": True,
        "created_at": datetime.now(timezone.utc),
    }
    await db.services.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.put("/services/{service_id}")
async def update_service(service_id: str, data: ServiceUpdate, request: Request):
    db = get_db()
    user = await require_auth(request, db)
    svc = await db.services.find_one({"service_id": service_id})
    if not svc:
        raise HTTPException(status_code=404, detail="Service not found")
    if svc["coach_id"] != user["user_id"] and user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")
    update = {k: v for k, v in data.model_dump().items() if v is not None}
    update["updated_at"] = datetime.now(timezone.utc)
    await db.services.update_one({"service_id": service_id}, {"$set": update})
    updated = await db.services.find_one({"service_id": service_id}, {"_id": 0})
    return updated


@router.delete("/services/{service_id}")
async def delete_service(service_id: str, request: Request):
    db = get_db()
    user = await require_auth(request, db)
    svc = await db.services.find_one({"service_id": service_id})
    if not svc:
        raise HTTPException(status_code=404, detail="Service not found")
    if svc["coach_id"] != user["user_id"] and user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")
    await db.services.update_one({"service_id": service_id}, {"$set": {"active": False}})
    return {"success": True}
