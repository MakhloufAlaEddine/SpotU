"""Marketplace routes — produits ET services filtrés par tags, avec distances."""
import json
import math
from fastapi import APIRouter, Query
from typing import Optional
from database import get_pool, rows_to_list

router = APIRouter()

MAX_DIST_KM = 40  # distance max pour afficher les produits physiques


def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distance en km entre deux points GPS (Haversine)."""
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2))
         * math.sin(dlon / 2) ** 2)
    return round(R * 2 * math.asin(math.sqrt(a)), 1)


def fmt_dist(km: float) -> str:
    if km < 1:
        return f"{int(km * 1000)} m"
    return f"{km:.1f} km"


@router.get("/marketplace/products")
async def get_marketplace_products(
    tag_ids: Optional[str]   = Query(None),
    spotyou_id: Optional[str] = Query(None),
    user_lat: Optional[float] = Query(None),
    user_lng: Optional[float] = Query(None),
):
    pool = get_pool()
    async with pool.acquire() as conn:
        filter_requested = bool(tag_ids or spotyou_id)
        owner_id:    Optional[str]   = None
        spotyou_lat: Optional[float] = None
        spotyou_lng: Optional[float] = None
        tags: list[str] = []

        if tag_ids:
            tags = [t.strip() for t in tag_ids.split(",") if t.strip()]

        if spotyou_id:
            row = await conn.fetchrow(
                """SELECT tag_ids, user_id,
                          ST_Y(location::geometry) AS slat,
                          ST_X(location::geometry) AS slng
                   FROM tag_points WHERE point_id = $1""",
                spotyou_id,
            )
            if row:
                owner_id    = row["user_id"]
                spotyou_lat = row["slat"]
                spotyou_lng = row["slng"]
                if not tags:
                    raw = row["tag_ids"]
                    if isinstance(raw, str):
                        try:    tags = json.loads(raw)
                        except: tags = []
                    else:
                        tags = list(raw or [])

        # ── Produits ──────────────────────────────────────────────────────────
        if tags:
            prows = await conn.fetch(
                """SELECT p.*, u.name AS seller_name, u.picture AS seller_picture
                   FROM marketplace_products p
                   LEFT JOIN users u ON p.seller_id = u.user_id
                   WHERE p.tag_ids && $1::text[]
                   ORDER BY CASE WHEN p.seller_id = $2 THEN 0 ELSE 1 END, p.created_at DESC""",
                tags, owner_id,
            )
        elif filter_requested:
            prows = []
        else:
            prows = await conn.fetch(
                """SELECT p.*, u.name AS seller_name, u.picture AS seller_picture
                   FROM marketplace_products p
                   LEFT JOIN users u ON p.seller_id = u.user_id
                   ORDER BY p.created_at DESC LIMIT 20"""
            )

        products = rows_to_list(prows)
        filtered_products = []
        for p in products:
            p["item_type"] = "product"
            if p.get("price") is not None:
                p["price"] = float(p["price"])

            # Distances pour produits physiques (lat IS NOT NULL)
            p_lat = p.get("lat")
            p_lng = p.get("lng")
            if p_lat is not None and p_lng is not None:
                p["is_physical"] = True
                if spotyou_lat and spotyou_lng:
                    d_spot = haversine(p_lat, p_lng, spotyou_lat, spotyou_lng)
                    p["dist_from_spotyou"]     = d_spot
                    p["dist_from_spotyou_fmt"] = fmt_dist(d_spot)
                if user_lat is not None and user_lng is not None:
                    d_user = haversine(p_lat, p_lng, user_lat, user_lng)
                    p["dist_from_user"]     = d_user
                    p["dist_from_user_fmt"] = fmt_dist(d_user)
            else:
                p["is_physical"] = False

            if owner_id and p.get("seller_id") == owner_id:
                p["badge_type"]  = "owner"
                p["badge_label"] = "Créateur du SpotYou"
            else:
                p["badge_type"]  = "other"
                p["badge_label"] = p.get("seller_name") or "SpotU"

            filtered_products.append(p)

        # ── Services coach ────────────────────────────────────────────────────
        services = []
        if tags:
            srows = await conn.fetch(
                """SELECT s.service_id, s.coach_id, s.title, s.description,
                          s.price, s.duration_min, s.images, s.tag_ids,
                          s.location_description, s.address,
                          u.name AS coach_name, u.picture AS coach_picture
                   FROM services s
                   LEFT JOIN users u ON s.coach_id = u.user_id
                   WHERE s.active = TRUE AND s.tag_ids ?| $1::text[]
                   ORDER BY CASE WHEN s.coach_id = $2 THEN 0 ELSE 1 END, s.created_at DESC
                   LIMIT 20""",
                tags, owner_id,
            )
            services = rows_to_list(srows)
            for s in services:
                s["item_type"]  = "service"
                s["is_physical"] = False
                if s.get("price") is not None:
                    s["price"] = float(s["price"])
                raw_imgs = s.get("images")
                s["images"]  = json.loads(raw_imgs) if isinstance(raw_imgs, str) else (raw_imgs or [])
                raw_ti = s.get("tag_ids")
                s["tag_ids"] = json.loads(raw_ti) if isinstance(raw_ti, str) else (raw_ti or [])
                if owner_id and s.get("coach_id") == owner_id:
                    s["badge_type"]  = "owner"
                    s["badge_label"] = "Créateur du SpotYou"
                else:
                    s["badge_type"]  = "other"
                    s["badge_label"] = s.get("coach_name") or "Coach"

        # ── Merge owner first ──────────────────────────────────────────────────
        all_items = filtered_products + services
        owner_items = [x for x in all_items if x["badge_type"] == "owner"]
        other_items = [x for x in all_items if x["badge_type"] != "owner"]
        items = owner_items + other_items

        return {"products": items, "count": len(items)}
