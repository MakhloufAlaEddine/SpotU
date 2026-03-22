"""Marketplace routes — produits liés aux SpotYou par tags."""
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
    - tag_ids  : liste de tags séparés par virgule
    - spotyou_id : point_id du SpotYou courant (utilisé pour résoudre les tags
                   si tag_ids absent ET pour calculer badge_type par produit)
    Les deux paramètres peuvent être combinés.
    """
    pool = get_pool()
    async with pool.acquire() as conn:
        filter_requested = bool(tag_ids or spotyou_id)
        owner_id: Optional[str] = None
        tags: list[str] = []

        # 1. Résolution des tags depuis tag_ids
        if tag_ids:
            tags = [t.strip() for t in tag_ids.split(",") if t.strip()]

        # 2. Résolution owner_id (et fallback tags) depuis spotyou_id
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
                    u.name  AS seller_name,
                    u.picture AS seller_picture,
                    (
                        SELECT tp.title
                        FROM tag_points tp
                        WHERE tp.user_id = p.seller_id
                        ORDER BY tp.created_at DESC
                        LIMIT 1
                    ) AS creator_spotyou_title
                FROM marketplace_products p
                LEFT JOIN users u ON p.seller_id = u.user_id
                WHERE p.tag_ids && $1::text[]
                ORDER BY
                    -- Produits du owner du SpotYou courant en premier
                    CASE WHEN p.seller_id = $2 THEN 0 ELSE 1 END,
                    CASE p.seller_type
                        WHEN 'sponsored'   THEN 0
                        WHEN 'spotu'       THEN 1
                        WHEN 'affiliated'  THEN 2
                        WHEN 'recommended' THEN 3
                        ELSE 4
                    END,
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
                    u.name AS seller_name,
                    u.picture AS seller_picture,
                    (
                        SELECT tp.title
                        FROM tag_points tp
                        WHERE tp.user_id = p.seller_id
                        ORDER BY tp.created_at DESC
                        LIMIT 1
                    ) AS creator_spotyou_title
                FROM marketplace_products p
                LEFT JOIN users u ON p.seller_id = u.user_id
                ORDER BY
                    CASE p.seller_type
                        WHEN 'sponsored'   THEN 0
                        WHEN 'spotu'       THEN 1
                        WHEN 'affiliated'  THEN 2
                        WHEN 'recommended' THEN 3
                        ELSE 4
                    END,
                    p.created_at DESC
                LIMIT 20
                """,
            )

        products = rows_to_list(rows)

        for p in products:
            # Conversion Decimal → float
            if p.get("price") is not None:
                p["price"] = float(p["price"])

            # Badge logic
            seller_id = p.get("seller_id")
            seller_type = p.get("seller_type", "")

            if owner_id and seller_id and seller_id == owner_id:
                p["badge_type"] = "owner"
                p["badge_label"] = "Ce SpotYou"
            elif seller_type == "creator" and seller_id:
                spotyou_title = p.get("creator_spotyou_title")
                p["badge_type"] = "other_creator"
                p["badge_label"] = spotyou_title or p.get("seller_name") or "Autre créateur"
            elif seller_type == "sponsored":
                p["badge_type"] = "sponsored"
                p["badge_label"] = "Sponsorisé"
            elif seller_type == "affiliated":
                p["badge_type"] = "affiliated"
                p["badge_label"] = "Affilié"
            else:
                p["badge_type"] = "platform"
                p["badge_label"] = "SpotU"

        return {"products": products, "count": len(products)}
