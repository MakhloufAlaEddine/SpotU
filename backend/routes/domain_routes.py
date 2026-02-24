from fastapi import APIRouter, Request, HTTPException, Query
from datetime import datetime, timezone
from typing import Optional
from models import DomainCreate, TagCategoryCreate, TagCreate, new_id
from auth_utils import require_auth, require_role
from database import get_db

router = APIRouter()


@router.get("/domains")
async def get_domains():
    db = get_db()
    domains = await db.domains.find({"active": True}, {"_id": 0}).to_list(20)
    return domains


@router.post("/domains")
async def create_domain(data: DomainCreate, request: Request):
    db = get_db()
    await require_role(request, db, "admin")
    doc = {**data.model_dump(), "domain_id": new_id("dom"), "active": True, "created_at": datetime.now(timezone.utc)}
    await db.domains.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.get("/tags/categories")
async def get_categories(domain_id: Optional[str] = Query(None)):
    db = get_db()
    query = {"active": True}
    if domain_id:
        query["domain_id"] = domain_id
    cats = await db.tag_categories.find(query, {"_id": 0}).to_list(50)
    return cats


@router.post("/tags/categories")
async def create_category(data: TagCategoryCreate, request: Request):
    db = get_db()
    await require_role(request, db, "admin")
    doc = {**data.model_dump(), "category_id": new_id("cat"), "active": True, "created_at": datetime.now(timezone.utc)}
    await db.tag_categories.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.get("/tags")
async def get_tags(domain_id: Optional[str] = Query(None), category_id: Optional[str] = Query(None)):
    db = get_db()
    query = {"active": True}
    if domain_id:
        query["domain_id"] = domain_id
    if category_id:
        query["category_id"] = category_id
    tags = await db.tags.find(query, {"_id": 0}).to_list(200)
    return tags


@router.post("/tags")
async def create_tag(data: TagCreate, request: Request):
    db = get_db()
    await require_role(request, db, "admin")
    doc = {**data.model_dump(), "tag_id": new_id("tag"), "active": True, "created_at": datetime.now(timezone.utc)}
    await db.tags.insert_one(doc)
    doc.pop("_id", None)
    return doc
