from fastapi import APIRouter, Request, HTTPException, Query
from datetime import datetime, timezone
from typing import Optional
from models import DomainCreate, TagCategoryCreate, TagCreate, new_id
from auth_utils import require_role
from database import get_pool, row_to_dict, rows_to_list

router = APIRouter()


@router.get("/domains")
async def get_domains():
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM domains WHERE active = TRUE ORDER BY name")
    return rows_to_list(rows)


@router.post("/domains")
async def create_domain(data: DomainCreate, request: Request):
    pool = get_pool()
    await require_role(request, pool, "admin")
    did = new_id("dom")
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO domains (domain_id, name, label_fr, label_en, icon, color, active) VALUES ($1, $2, $3, $4, $5, $6, TRUE)",
            did, data.name, data.label_fr, data.label_en, data.icon, data.color
        )
        row = await conn.fetchrow("SELECT * FROM domains WHERE domain_id = $1", did)
    return row_to_dict(row)


@router.get("/tags/categories")
async def get_categories(domain_id: Optional[str] = Query(None)):
    pool = get_pool()
    async with pool.acquire() as conn:
        if domain_id:
            rows = await conn.fetch(
                "SELECT * FROM tag_categories WHERE active = TRUE AND domain_id = $1 ORDER BY name",
                domain_id
            )
        else:
            rows = await conn.fetch("SELECT * FROM tag_categories WHERE active = TRUE ORDER BY name")
    return rows_to_list(rows)


@router.post("/tags/categories")
async def create_category(data: TagCategoryCreate, request: Request):
    pool = get_pool()
    await require_role(request, pool, "admin")
    cid = new_id("cat")
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO tag_categories (category_id, domain_id, name, label_fr, label_en, icon, active) VALUES ($1, $2, $3, $4, $5, $6, TRUE)",
            cid, data.domain_id, data.name, data.label_fr, data.label_en, data.icon
        )
        row = await conn.fetchrow("SELECT * FROM tag_categories WHERE category_id = $1", cid)
    return row_to_dict(row)


@router.get("/tags")
async def get_tags(domain_id: Optional[str] = Query(None), category_id: Optional[str] = Query(None)):
    pool = get_pool()
    async with pool.acquire() as conn:
        if domain_id and category_id:
            rows = await conn.fetch(
                "SELECT * FROM tags WHERE active = TRUE AND domain_id = $1 AND category_id = $2 ORDER BY name",
                domain_id, category_id
            )
        elif domain_id:
            rows = await conn.fetch(
                "SELECT * FROM tags WHERE active = TRUE AND domain_id = $1 ORDER BY name",
                domain_id
            )
        elif category_id:
            rows = await conn.fetch(
                "SELECT * FROM tags WHERE active = TRUE AND category_id = $1 ORDER BY name",
                category_id
            )
        else:
            rows = await conn.fetch("SELECT * FROM tags WHERE active = TRUE ORDER BY name LIMIT 200")
    return rows_to_list(rows)


@router.post("/tags")
async def create_tag(data: TagCreate, request: Request):
    pool = get_pool()
    await require_role(request, pool, "admin")
    tid = new_id("tag")
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO tags (tag_id, category_id, domain_id, name, label_fr, label_en, icon, active) VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)",
            tid, data.category_id, data.domain_id, data.name, data.label_fr, data.label_en, data.icon
        )
        row = await conn.fetchrow("SELECT * FROM tags WHERE tag_id = $1", tid)
    return row_to_dict(row)
