from fastapi import APIRouter, Request, HTTPException, Query
from datetime import datetime, timezone
from typing import Optional
from models import DomainCreate, TagCategoryCreate, TagCreate, new_id
from auth_utils import require_role
from database import get_pool, row_to_dict, rows_to_list

router = APIRouter()


@router.get("/domains")
async def get_domains(include_inactive: bool = Query(False)):
    pool = get_pool()
    async with pool.acquire() as conn:
        if include_inactive:
            rows = await conn.fetch("SELECT * FROM domains ORDER BY name")
        else:
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
async def get_categories(
    domain_id: Optional[str] = Query(None),
    entity_type: Optional[str] = Query(None)
):
    pool = get_pool()
    async with pool.acquire() as conn:
        # Build WHERE clause
        conditions = ["tc.active = TRUE"]
        params = []
        if domain_id:
            params.append(domain_id)
            conditions.append(f"tc.domain_id = ${len(params)}")
        if entity_type:
            params.append(entity_type)
            conditions.append(f"tc.entity_type = ${len(params)}")
        where = " AND ".join(conditions)

        cat_rows = await conn.fetch(
            f"SELECT * FROM tag_categories tc WHERE {where} ORDER BY tc.name",
            *params
        )

        # Tags via tag_category_links (many-to-many)
        if cat_rows:
            cat_ids = [r["category_id"] for r in cat_rows]
            tag_rows = await conn.fetch(
                """SELECT t.*, tcl.category_id as linked_category_id
                   FROM tags t
                   JOIN tag_category_links tcl ON t.tag_id = tcl.tag_id
                   WHERE t.active = TRUE AND tcl.category_id = ANY($1)
                   ORDER BY t.name""",
                cat_ids
            )
        else:
            tag_rows = []

    tags_by_category: dict = {}
    for tag in tag_rows:
        t = row_to_dict(tag)
        cid = t.pop("linked_category_id", None)
        if cid:
            tags_by_category.setdefault(cid, []).append(t)

    result = []
    for cat in cat_rows:
        c = row_to_dict(cat)
        c["tags"] = tags_by_category.get(c["category_id"], [])
        result.append(c)
    return result


@router.post("/tags/categories")
async def create_category(data: TagCategoryCreate, request: Request):
    pool = get_pool()
    await require_role(request, pool, "admin")
    cid = new_id("cat")
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO tag_categories (category_id, domain_id, entity_type, name, label_fr, label_en, icon, active) VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)",
            cid, data.domain_id, getattr(data, 'entity_type', None), data.name, data.label_fr, data.label_en, data.icon
        )
        row = await conn.fetchrow("SELECT * FROM tag_categories WHERE category_id = $1", cid)
    return row_to_dict(row)


@router.get("/tags")
async def get_tags(
    domain_id: Optional[str] = Query(None),
    category_id: Optional[str] = Query(None),
    entity_type: Optional[str] = Query(None)
):
    pool = get_pool()
    async with pool.acquire() as conn:
        conditions = ["t.active = TRUE"]
        params = []
        if domain_id:
            params.append(domain_id)
            conditions.append(f"t.domain_id = ${len(params)}")
        if category_id:
            params.append(category_id)
            conditions.append(f"tcl.category_id = ${len(params)}")
        if entity_type:
            params.append(entity_type)
            conditions.append(f"tetl.entity_type = ${len(params)}")

        if category_id or entity_type:
            join_clause = ""
            if category_id:
                join_clause += " JOIN tag_category_links tcl ON t.tag_id = tcl.tag_id"
            if entity_type:
                join_clause += " JOIN tag_entity_type_links tetl ON t.tag_id = tetl.tag_id"
            where = " AND ".join(conditions)
            rows = await conn.fetch(
                f"SELECT DISTINCT t.* FROM tags t{join_clause} WHERE {where} ORDER BY t.name LIMIT 200",
                *params
            )
        elif domain_id:
            rows = await conn.fetch(
                "SELECT * FROM tags t WHERE t.active = TRUE AND t.domain_id = $1 ORDER BY t.name LIMIT 200",
                domain_id
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
        # Liaison tag ↔ catégorie
        if data.category_id:
            await conn.execute(
                "INSERT INTO tag_category_links (tag_id, category_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
                tid, data.category_id
            )
            # Liaison tag ↔ entity_type (déduit de la catégorie)
            et = await conn.fetchval(
                "SELECT entity_type FROM tag_categories WHERE category_id = $1", data.category_id
            )
            if et:
                await conn.execute(
                    "INSERT INTO tag_entity_type_links (tag_id, entity_type) VALUES ($1, $2) ON CONFLICT DO NOTHING",
                    tid, et
                )
        row = await conn.fetchrow("SELECT * FROM tags WHERE tag_id = $1", tid)
    return row_to_dict(row)


# ── Mise à jour & suppression Domaines ────────────────────────────────────────

@router.put("/domains/{domain_id}")
async def update_domain(domain_id: str, request: Request):
    pool = get_pool()
    await require_role(request, pool, "admin")
    body = await request.json()
    allowed = {"name", "label_fr", "label_en", "icon", "color", "active"}
    fields = {k: v for k, v in body.items() if k in allowed}
    if not fields:
        raise HTTPException(400, "Aucun champ valide à mettre à jour")
    set_clause = ", ".join(f"{k} = ${i+2}" for i, k in enumerate(fields))
    async with pool.acquire() as conn:
        result = await conn.execute(
            f"UPDATE domains SET {set_clause} WHERE domain_id = $1",
            domain_id, *fields.values()
        )
        # Cascade désactivation (écrans de création uniquement)
        if fields.get("active") is False:
            await conn.execute(
                "UPDATE tag_categories SET active = FALSE WHERE domain_id = $1",
                domain_id
            )
    if result == "UPDATE 0":
        raise HTTPException(404, "Domaine introuvable")
    return {"success": True}


@router.get("/domains/{domain_id}/usage")
async def get_domain_usage(domain_id: str, request: Request):
    pool = get_pool()
    await require_role(request, pool, "admin")
    async with pool.acquire() as conn:
        tagpoint_count = await conn.fetchval(
            "SELECT COUNT(*) FROM tag_points WHERE domain_id = $1", domain_id
        )
        user_count = await conn.fetchval(
            """SELECT COUNT(DISTINCT su.user_id)
               FROM (
                 SELECT user_id, coach_tags FROM users
                 WHERE coach_tags IS NOT NULL AND jsonb_typeof(coach_tags) = 'array'
               ) su
               CROSS JOIN LATERAL jsonb_array_elements_text(su.coach_tags) AS tid
               JOIN tags t ON t.tag_id = tid
               WHERE t.domain_id = $1""",
            domain_id
        )
    return {"tagpoint_count": int(tagpoint_count), "user_count": int(user_count)}


@router.delete("/domains/{domain_id}")
async def delete_domain(domain_id: str, request: Request, mode: str = Query("deactivate")):
    pool = get_pool()
    await require_role(request, pool, "admin")
    async with pool.acquire() as conn:
        if mode == "cascade":
            await conn.execute("DELETE FROM domains WHERE domain_id = $1", domain_id)
        else:
            result = await conn.execute(
                "UPDATE domains SET active = FALSE WHERE domain_id = $1", domain_id
            )
            # Cascade désactivation catégories
            await conn.execute(
                "UPDATE tag_categories SET active = FALSE WHERE domain_id = $1", domain_id
            )
            if result == "UPDATE 0":
                raise HTTPException(404, "Domaine introuvable")
    return {"success": True}


# ── Mise à jour & suppression Catégories ──────────────────────────────────────

@router.put("/tags/categories/{category_id}")
async def update_category(category_id: str, request: Request):
    pool = get_pool()
    await require_role(request, pool, "admin")
    body = await request.json()
    allowed = {"name", "label_fr", "label_en", "icon", "active", "domain_id", "entity_type"}
    fields = {k: v for k, v in body.items() if k in allowed}
    if not fields:
        raise HTTPException(400, "Aucun champ valide à mettre à jour")
    set_clause = ", ".join(f"{k} = ${i+2}" for i, k in enumerate(fields))
    async with pool.acquire() as conn:
        result = await conn.execute(
            f"UPDATE tag_categories SET {set_clause} WHERE category_id = $1",
            category_id, *fields.values()
        )
        # Cascade désactivation tags liés (écrans de création uniquement)
        if fields.get("active") is False:
            await conn.execute(
                """UPDATE tags SET active = FALSE
                   WHERE tag_id IN (
                     SELECT tag_id FROM tag_category_links WHERE category_id = $1
                   )""",
                category_id
            )
    if result == "UPDATE 0":
        raise HTTPException(404, "Catégorie introuvable")
    return {"success": True}


@router.get("/tags/categories/{category_id}/usage")
async def get_category_usage(category_id: str, request: Request):
    pool = get_pool()
    await require_role(request, pool, "admin")
    async with pool.acquire() as conn:
        tag_count = await conn.fetchval(
            "SELECT COUNT(*) FROM tag_category_links WHERE category_id = $1", category_id
        )
        tagpoint_count = await conn.fetchval(
            """SELECT COUNT(DISTINCT safe_tp.point_id)
               FROM (
                 SELECT point_id, tag_ids FROM tag_points
                 WHERE tag_ids IS NOT NULL AND jsonb_typeof(tag_ids) = 'array'
               ) safe_tp
               JOIN (
                 SELECT t.tag_id FROM tags t
                 JOIN tag_category_links tcl ON t.tag_id = tcl.tag_id
                 WHERE tcl.category_id = $1
               ) cat_tags ON safe_tp.tag_ids @> jsonb_build_array(cat_tags.tag_id::text)""",
            category_id
        )
    return {"tag_count": int(tag_count), "tagpoint_count": int(tagpoint_count)}


@router.delete("/tags/categories/{category_id}")
async def delete_category(category_id: str, request: Request, mode: str = Query("deactivate")):
    pool = get_pool()
    await require_role(request, pool, "admin")
    async with pool.acquire() as conn:
        if mode == "cascade":
            await conn.execute("DELETE FROM tag_categories WHERE category_id = $1", category_id)
        else:
            result = await conn.execute(
                "UPDATE tag_categories SET active = FALSE WHERE category_id = $1", category_id
            )
            # Cascade désactivation tags liés
            await conn.execute(
                """UPDATE tags SET active = FALSE
                   WHERE tag_id IN (
                     SELECT tag_id FROM tag_category_links WHERE category_id = $1
                   )""",
                category_id
            )
            if result == "UPDATE 0":
                raise HTTPException(404, "Catégorie introuvable")
    return {"success": True}


# ── Mise à jour & suppression Tags ────────────────────────────────────────────

@router.put("/tags/{tag_id}")
async def update_tag(tag_id: str, request: Request):
    pool = get_pool()
    await require_role(request, pool, "admin")
    body = await request.json()
    allowed = {"name", "label_fr", "label_en", "icon", "active", "category_id", "domain_id"}
    fields = {k: v for k, v in body.items() if k in allowed}
    if not fields:
        raise HTTPException(400, "Aucun champ valide à mettre à jour")
    set_clause = ", ".join(f"{k} = ${i+2}" for i, k in enumerate(fields))
    async with pool.acquire() as conn:
        result = await conn.execute(
            f"UPDATE tags SET {set_clause} WHERE tag_id = $1",
            tag_id, *fields.values()
        )
    if result == "UPDATE 0":
        raise HTTPException(404, "Tag introuvable")
    return {"success": True}


@router.get("/tags/{tag_id}/usage")
async def get_tag_usage(tag_id: str, request: Request):
    pool = get_pool()
    await require_role(request, pool, "admin")
    async with pool.acquire() as conn:
        tagpoint_count = await conn.fetchval(
            "SELECT COUNT(*) FROM tag_points WHERE tag_ids @> jsonb_build_array($1::text)",
            tag_id
        )
        user_count = await conn.fetchval(
            "SELECT COUNT(*) FROM users WHERE coach_tags @> jsonb_build_array($1::text)",
            tag_id
        )
    return {"tagpoint_count": int(tagpoint_count), "user_count": int(user_count)}


@router.delete("/tags/{tag_id}")
async def delete_tag(tag_id: str, request: Request, mode: str = Query("deactivate")):
    pool = get_pool()
    await require_role(request, pool, "admin")
    async with pool.acquire() as conn:
        if mode == "cascade":
            await conn.execute("DELETE FROM tags WHERE tag_id = $1", tag_id)
        else:
            result = await conn.execute(
                "UPDATE tags SET active = FALSE WHERE tag_id = $1", tag_id
            )
            if result == "UPDATE 0":
                raise HTTPException(404, "Tag introuvable")
    return {"success": True}



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
            cat_rows = await conn.fetch(
                "SELECT * FROM tag_categories WHERE active = TRUE AND domain_id = $1 ORDER BY name",
                domain_id
            )
        else:
            cat_rows = await conn.fetch("SELECT * FROM tag_categories WHERE active = TRUE ORDER BY name")
        tag_rows = await conn.fetch("SELECT * FROM tags WHERE active = TRUE ORDER BY name")

    tags_by_category: dict = {}
    for tag in tag_rows:
        t = row_to_dict(tag)
        cid = t["category_id"]
        tags_by_category.setdefault(cid, []).append(t)

    result = []
    for cat in cat_rows:
        c = row_to_dict(cat)
        c["tags"] = tags_by_category.get(c["category_id"], [])
        result.append(c)
    return result


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


# ── Mise à jour & suppression Domaines ────────────────────────────────────────

@router.put("/domains/{domain_id}")
async def update_domain(domain_id: str, request: Request):
    pool = get_pool()
    await require_role(request, pool, "admin")
    body = await request.json()
    allowed = {"name", "label_fr", "label_en", "icon", "color", "active"}
    fields = {k: v for k, v in body.items() if k in allowed}
    if not fields:
        raise HTTPException(400, "Aucun champ valide à mettre à jour")
    set_clause = ", ".join(f"{k} = ${i+2}" for i, k in enumerate(fields))
    async with pool.acquire() as conn:
        result = await conn.execute(
            f"UPDATE domains SET {set_clause} WHERE domain_id = $1",
            domain_id, *fields.values()
        )
    if result == "UPDATE 0":
        raise HTTPException(404, "Domaine introuvable")
    return {"success": True}


@router.get("/domains/{domain_id}/usage")
async def get_domain_usage(domain_id: str, request: Request):
    pool = get_pool()
    await require_role(request, pool, "admin")
    async with pool.acquire() as conn:
        tagpoint_count = await conn.fetchval(
            "SELECT COUNT(*) FROM tag_points WHERE domain_id = $1", domain_id
        )
        user_count = await conn.fetchval(
            """SELECT COUNT(DISTINCT su.user_id)
               FROM (
                 SELECT user_id, coach_tags FROM users
                 WHERE coach_tags IS NOT NULL AND jsonb_typeof(coach_tags) = 'array'
               ) su
               CROSS JOIN LATERAL jsonb_array_elements_text(su.coach_tags) AS tid
               JOIN tags t ON t.tag_id = tid
               WHERE t.domain_id = $1""",
            domain_id
        )
    return {"tagpoint_count": int(tagpoint_count), "user_count": int(user_count)}


@router.delete("/domains/{domain_id}")
async def delete_domain(domain_id: str, request: Request, mode: str = Query("deactivate")):
    pool = get_pool()
    await require_role(request, pool, "admin")
    async with pool.acquire() as conn:
        if mode == "cascade":
            await conn.execute("DELETE FROM domains WHERE domain_id = $1", domain_id)
        else:
            result = await conn.execute(
                "UPDATE domains SET active = FALSE WHERE domain_id = $1", domain_id
            )
            if result == "UPDATE 0":
                raise HTTPException(404, "Domaine introuvable")
    return {"success": True}


# ── Mise à jour & suppression Catégories ──────────────────────────────────────

@router.put("/tags/categories/{category_id}")
async def update_category(category_id: str, request: Request):
    pool = get_pool()
    await require_role(request, pool, "admin")
    body = await request.json()
    allowed = {"name", "label_fr", "label_en", "icon", "active", "domain_id"}
    fields = {k: v for k, v in body.items() if k in allowed}
    if not fields:
        raise HTTPException(400, "Aucun champ valide à mettre à jour")
    set_clause = ", ".join(f"{k} = ${i+2}" for i, k in enumerate(fields))
    async with pool.acquire() as conn:
        result = await conn.execute(
            f"UPDATE tag_categories SET {set_clause} WHERE category_id = $1",
            category_id, *fields.values()
        )
    if result == "UPDATE 0":
        raise HTTPException(404, "Catégorie introuvable")
    return {"success": True}


@router.get("/tags/categories/{category_id}/usage")
async def get_category_usage(category_id: str, request: Request):
    pool = get_pool()
    await require_role(request, pool, "admin")
    async with pool.acquire() as conn:
        tag_count = await conn.fetchval(
            "SELECT COUNT(*) FROM tags WHERE category_id = $1", category_id
        )
        tagpoint_count = await conn.fetchval(
            """SELECT COUNT(DISTINCT safe_tp.point_id)
               FROM (
                 SELECT point_id, tag_ids FROM tag_points
                 WHERE tag_ids IS NOT NULL AND jsonb_typeof(tag_ids) = 'array'
               ) safe_tp
               JOIN (
                 SELECT t.tag_id FROM tags t WHERE t.category_id = $1
               ) cat_tags ON safe_tp.tag_ids @> jsonb_build_array(cat_tags.tag_id::text)""",
            category_id
        )
    return {"tag_count": int(tag_count), "tagpoint_count": int(tagpoint_count)}


@router.delete("/tags/categories/{category_id}")
async def delete_category(category_id: str, request: Request, mode: str = Query("deactivate")):
    pool = get_pool()
    await require_role(request, pool, "admin")
    async with pool.acquire() as conn:
        if mode == "cascade":
            await conn.execute("DELETE FROM tag_categories WHERE category_id = $1", category_id)
        else:
            result = await conn.execute(
                "UPDATE tag_categories SET active = FALSE WHERE category_id = $1", category_id
            )
            if result == "UPDATE 0":
                raise HTTPException(404, "Catégorie introuvable")
    return {"success": True}


# ── Mise à jour & suppression Tags ────────────────────────────────────────────

@router.put("/tags/{tag_id}")
async def update_tag(tag_id: str, request: Request):
    pool = get_pool()
    await require_role(request, pool, "admin")
    body = await request.json()
    allowed = {"name", "label_fr", "label_en", "icon", "active", "category_id", "domain_id"}
    fields = {k: v for k, v in body.items() if k in allowed}
    if not fields:
        raise HTTPException(400, "Aucun champ valide à mettre à jour")
    set_clause = ", ".join(f"{k} = ${i+2}" for i, k in enumerate(fields))
    async with pool.acquire() as conn:
        result = await conn.execute(
            f"UPDATE tags SET {set_clause} WHERE tag_id = $1",
            tag_id, *fields.values()
        )
    if result == "UPDATE 0":
        raise HTTPException(404, "Tag introuvable")
    return {"success": True}


@router.get("/tags/{tag_id}/usage")
async def get_tag_usage(tag_id: str, request: Request):
    pool = get_pool()
    await require_role(request, pool, "admin")
    async with pool.acquire() as conn:
        tagpoint_count = await conn.fetchval(
            "SELECT COUNT(*) FROM tag_points WHERE tag_ids @> jsonb_build_array($1::text)",
            tag_id
        )
        user_count = await conn.fetchval(
            "SELECT COUNT(*) FROM users WHERE coach_tags @> jsonb_build_array($1::text)",
            tag_id
        )
    return {"tagpoint_count": int(tagpoint_count), "user_count": int(user_count)}


@router.delete("/tags/{tag_id}")
async def delete_tag(tag_id: str, request: Request, mode: str = Query("deactivate")):
    pool = get_pool()
    await require_role(request, pool, "admin")
    async with pool.acquire() as conn:
        if mode == "cascade":
            await conn.execute("DELETE FROM tags WHERE tag_id = $1", tag_id)
        else:
            result = await conn.execute(
                "UPDATE tags SET active = FALSE WHERE tag_id = $1", tag_id
            )
            if result == "UPDATE 0":
                raise HTTPException(404, "Tag introuvable")
    return {"success": True}
