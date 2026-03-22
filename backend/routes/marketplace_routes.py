"""Marketplace routes — produits ET services filtrés par tags."""
import json
from fastapi import APIRouter, Query
from typing import Optional
from database import get_pool, rows_to_list

router = APIRouter()


@router.get("/marketplace/products")
async def get_marketplace_products(
    tag_ids: Optional[str] = Query(None),
    spotyou_id: Optional[str] = Query(None),
):
    """
    Retourne produits marketplace + services coach filtrés par tags.
    Badge :
      - 'owner'  : seller_id/coach_id == créateur du SpotYou (en tête)
      - 'other'  : tout autre utilisateur
    """
    pool = get_pool()
    async with pool.acquire() as conn:
        filter_requested = bool(tag_ids or spotyou_id)
        owner_id: Optional[str] = None
        tags: list[str] = []

        if tag_ids:
            tags = [t.strip() for t in tag_ids.split(",") if t.strip()]

        if spotyou_id:
            row = await conn.fetchrow(
                "SELECT tag_ids, user_id FROM tag_points WHERE point_id = $1", spotyou_id
            )
            if row:
                owner_id = row["user_id"]
                if not tags:
                    raw = row["tag_ids"]
                    if isinstance(raw, str):
                        try:
                            tags = json.loads(raw)
                        except (json.JSONDecodeError, TypeError):
                            tags = []
                    else:
                        tags = list(raw or [])

        # ── 1. Produits ───────────────────────────────────────────────────────
        if tags:
            prows = await conn.fetch(
                """
                SELECT p.*, u.name AS seller_name, u.picture AS seller_picture
                FROM marketplace_products p
                LEFT JOIN users u ON p.seller_id = u.user_id
                WHERE p.tag_ids && $1::text[]
                ORDER BY CASE WHEN p.seller_id = $2 THEN 0 ELSE 1 END, p.created_at DESC
                """,
                tags, owner_id,
            )
        elif filter_requested:
            prows = []
        else:
            prows = await conn.fetch(
                """
                SELECT p.*, u.name AS seller_name, u.picture AS seller_picture
                FROM marketplace_products p
                LEFT JOIN users u ON p.seller_id = u.user_id
                ORDER BY p.created_at DESC LIMIT 20
                """
            )

        products = rows_to_list(prows)
        for p in products:
            p["item_type"] = "product"
            if p.get("price") is not None:
                p["price"] = float(p["price"])
            if owner_id and p.get("seller_id") == owner_id:
                p["badge_type"]  = "owner"
                p["badge_label"] = "Créateur du SpotYou"
            else:
                p["badge_type"]  = "other"
                p["badge_label"] = p.get("seller_name") or "SpotU"

        # ── 2. Services coach ─────────────────────────────────────────────────
        if tags:
            srows = await conn.fetch(
                """
                SELECT s.service_id, s.coach_id, s.title, s.description,
                       s.price, s.duration_min, s.images, s.tag_ids,
                       s.location_description, s.address,
                       u.name AS coach_name, u.picture AS coach_picture
                FROM services s
                LEFT JOIN users u ON s.coach_id = u.user_id
                WHERE s.active = TRUE AND s.tag_ids ?| $1::text[]
                ORDER BY CASE WHEN s.coach_id = $2 THEN 0 ELSE 1 END, s.created_at DESC
                LIMIT 20
                """,
                tags, owner_id,
            )
        else:
            srows = []

        services = rows_to_list(srows)
        for s in services:
            s["item_type"] = "service"
            if s.get("price") is not None:
                s["price"] = float(s["price"])
            raw_imgs = s.get("images")
            s["images"] = json.loads(raw_imgs) if isinstance(raw_imgs, str) else (raw_imgs or [])
            raw_ti = s.get("tag_ids")
            s["tag_ids"] = json.loads(raw_ti) if isinstance(raw_ti, str) else (raw_ti or [])
            if owner_id and s.get("coach_id") == owner_id:
                s["badge_type"]  = "owner"
                s["badge_label"] = "Créateur du SpotYou"
            else:
                s["badge_type"]  = "other"
                s["badge_label"] = s.get("coach_name") or "Coach"

        # ── 3. Merge : owner d'abord, puis le reste ────────────────────────────
        owner_items = [x for x in products + services if x["badge_type"] == "owner"]
        other_items = [x for x in products + services if x["badge_type"] != "owner"]
        items = owner_items + other_items

        return {"products": items, "count": len(items)}
