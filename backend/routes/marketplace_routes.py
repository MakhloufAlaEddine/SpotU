"""Marketplace routes — produits liés aux SpotYou par tags."""
import json
from fastapi import APIRouter, Query
from typing import Optional, List
from database import get_pool, rows_to_list

router = APIRouter()


@router.get("/marketplace/products")
async def get_marketplace_products(
    tag_ids: Optional[str] = Query(None, description="Comma-separated tag IDs"),
    spotyou_id: Optional[str] = Query(None),
):
    """Get marketplace products, optionally filtered by tag overlap."""
    pool = get_pool()
    async with pool.acquire() as conn:
        # Track whether a filter was explicitly requested
        filter_requested = bool(tag_ids or spotyou_id)

        if tag_ids:
            tags = [t.strip() for t in tag_ids.split(",") if t.strip()]
        elif spotyou_id:
            row = await conn.fetchrow(
                "SELECT tag_ids FROM tag_points WHERE point_id = $1", spotyou_id
            )
            if row and row["tag_ids"]:
                raw = row["tag_ids"]
                # tag_ids peut être une string JSON ou déjà une liste Python
                if isinstance(raw, str):
                    try:
                        tags = json.loads(raw)
                    except (json.JSONDecodeError, TypeError):
                        tags = []
                else:
                    tags = list(raw)
            else:
                tags = []
        else:
            tags = []

        if tags:
            rows = await conn.fetch(
                """SELECT p.*, u.name as seller_name, u.picture as seller_picture
                   FROM marketplace_products p
                   LEFT JOIN users u ON p.seller_id = u.user_id
                   WHERE p.tag_ids && $1::text[]
                   ORDER BY
                     CASE p.seller_type WHEN 'sponsored' THEN 0 WHEN 'spotu' THEN 1 WHEN 'affiliated' THEN 2 WHEN 'recommended' THEN 3 ELSE 4 END,
                     p.created_at DESC""",
                tags,
            )
        elif filter_requested:
            # Un filtre (spotyou_id ou tag_ids) a été demandé mais n'a résolu aucun tag
            # → retourner une liste vide plutôt que tous les produits
            rows = []
        else:
            rows = await conn.fetch(
                """SELECT p.*, u.name as seller_name, u.picture as seller_picture
                   FROM marketplace_products p
                   LEFT JOIN users u ON p.seller_id = u.user_id
                   ORDER BY p.created_at DESC
                   LIMIT 20"""
            )

        products = rows_to_list(rows)
        # Convert Decimal price to float for JSON
        for p in products:
            if p.get("price") is not None:
                p["price"] = float(p["price"])
        return {"products": products, "count": len(products)}
