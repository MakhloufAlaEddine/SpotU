"""Marketplace routes — produits filtrés par tags, associés à des utilisateurs."""
import json
from fastapi import APIRouter, Query
from typing import Optional
from database import get_pool, rows_to_list

router = APIRouter()


@router.get("/marketplace/products")
async def get_marketplace_products(
    tag_ids: Optional[str] = Query(None, description="Comma-separated tag IDs"),
    spotyou_id: Optional[str] = Query(None),
):
    """
    Retourne les produits marketplace filtrés par tags.
    Chaque produit appartient à un utilisateur (seller_id).
    Badge :
      - 'owner'  : seller_id == créateur du SpotYou (affiché en tête de liste)
      - 'other'  : tout autre utilisateur
    """
    pool = get_pool()
    async with pool.acquire() as conn:
        filter_requested = bool(tag_ids or spotyou_id)
        owner_id: Optional[str] = None
        tags: list[str] = []

        # 1. Résolution des tags depuis tag_ids
        if tag_ids:
            tags = [t.strip() for t in tag_ids.split(",") if t.strip()]

        # 2. Résolution owner_id + fallback tags depuis spotyou_id
        if spotyou_id:
            row = await conn.fetchrow(
                "SELECT tag_ids, user_id FROM tag_points WHERE point_id = $1",
                spotyou_id,
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

        # 3. Requête produits
        if tags:
            rows = await conn.fetch(
                """
                SELECT
                    p.*,
                    u.name    AS seller_name,
                    u.picture AS seller_picture,
                    u.role    AS seller_role
                FROM marketplace_products p
                LEFT JOIN users u ON p.seller_id = u.user_id
                WHERE p.tag_ids && $1::text[]
                ORDER BY
                    -- Produits du créateur du SpotYou en tête
                    CASE WHEN p.seller_id = $2 THEN 0 ELSE 1 END,
                    p.created_at DESC
                """,
                tags,
                owner_id,
            )
        elif filter_requested:
            rows = []
        else:
            rows = await conn.fetch(
                """
                SELECT
                    p.*,
                    u.name    AS seller_name,
                    u.picture AS seller_picture,
                    u.role    AS seller_role
                FROM marketplace_products p
                LEFT JOIN users u ON p.seller_id = u.user_id
                ORDER BY p.created_at DESC
                LIMIT 20
                """,
            )

        products = rows_to_list(rows)

        for p in products:
            # Decimal → float
            if p.get("price") is not None:
                p["price"] = float(p["price"])

            # Badge : owner ou other
            if owner_id and p.get("seller_id") == owner_id:
                p["badge_type"]  = "owner"
                p["badge_label"] = "Créateur du SpotYou"
            else:
                p["badge_type"]  = "other"
                p["badge_label"] = p.get("seller_name") or "Autre utilisateur"

        return {"products": products, "count": len(products)}
