"""
/api/home/feed  — Fil d'accueil personnalisé

Équilibre 3 signaux :
  1. Centres d'intérêt / tags communs (≤40 pts)
  2. Popularité : going_count + membres (≤30 pts)
  3. Distance : plus proche = meilleur score (≤30 pts)

Bonus : +20 si l'utilisateur est déjà membre du SpotYou.

Auto-expansion du rayon : 50km → 100km → 200km → 500km
si le nombre total de résultats (SpotYou + services) < 3.
"""
from fastapi import APIRouter, Request, Query
from typing import Optional
import json
from datetime import datetime, timezone

from auth_utils import get_token_from_request, decode_jwt
from database import get_pool, row_to_dict

router = APIRouter()

RADIUS_STEPS = [50_000, 100_000, 200_000, 500_000]   # mètres
MIN_RESULTS   = 3                                      # seuil déclenchant l'expansion


# ── Endpoint : secteur le plus proche avec du contenu ──────────────────────

@router.get("/home/nearest-sector")
async def nearest_sector(
    lat: float = Query(...),
    lng: float = Query(...),
    request: Request = None,
):
    """
    Retourne les coordonnées du secteur le plus proche ayant au moins
    un SpotYou actif, ainsi que le nombre de SpotYou à 50 km autour.
    Utilisé pour l'état vide de l'écran d'accueil.
    """
    pool = get_pool()

    current_user_id: Optional[str] = None
    try:
        token = get_token_from_request(request)
        if token:
            payload = decode_jwt(token)
            current_user_id = payload.get("user_id")
    except Exception:
        pass

    async with pool.acquire() as conn:
        params: list = [lng, lat]
        user_cond = ""
        if current_user_id:
            user_cond = "AND tp.user_id != $3"
            params.append(current_user_id)

        nearest = await conn.fetchrow(f"""
            SELECT
                ST_Y(tp.location::geometry) AS near_lat,
                ST_X(tp.location::geometry) AS near_lng,
                ST_Distance(
                    tp.location::geography,
                    ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 4326)::geography
                ) AS distance_m
            FROM tag_points tp
            WHERE tp.active = TRUE
            {user_cond}
            ORDER BY distance_m ASC
            LIMIT 1
        """, *params)

        if not nearest:
            return None

        near_lat = float(nearest["near_lat"])
        near_lng = float(nearest["near_lng"])
        distance_km = float(nearest["distance_m"]) / 1000.0

        # Compter les SpotYou dans un rayon de 50 km autour du point le plus proche
        count = await conn.fetchval("""
            SELECT COUNT(*) FROM tag_points
            WHERE active = TRUE
              AND ST_DWithin(
                location::geography,
                ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 4326)::geography,
                50000
              )
        """, near_lng, near_lat)

        return {
            "lat": near_lat,
            "lng": near_lng,
            "distance_km": round(distance_km, 1),
            "spot_count": int(count or 0),
        }


# ── Helpers ────────────────────────────────────────────────────────────────

def _parse_tags(raw) -> list:
    if not raw:
        return []
    if isinstance(raw, list):
        return [str(t) for t in raw]
    if isinstance(raw, str):
        try:
            v = json.loads(raw)
            return [str(t) for t in v] if isinstance(v, list) else []
        except Exception:
            return []
    return []


def _score_spot(spot: dict, user_tags: list, member_ids: set, max_dist: float, max_pop: float) -> float:
    score = 0.0
    # 1. Tags en commun (0–40 pts)
    spot_tags = _parse_tags(spot.get("tag_ids"))
    common = len(set(user_tags) & set(spot_tags))
    score += min(common * 20, 40)
    # 2. Popularité (0–30 pts)
    pop = (spot.get("going_count") or 0) + (spot.get("participants_count") or 0)
    if max_pop > 0:
        score += (pop / max_pop) * 30
    # 3. Distance (0–30 pts)
    dist = spot.get("distance") or max_dist
    if max_dist > 0:
        score += ((max_dist - min(dist, max_dist)) / max_dist) * 30
    # Bonus membre
    if spot.get("point_id") in member_ids:
        score += 20
    return score


def _score_service(svc: dict, user_tags: list, max_dist: float, max_pop: float) -> float:
    score = 0.0
    svc_tags = _parse_tags(svc.get("tag_ids"))
    common = len(set(user_tags) & set(svc_tags))
    score += min(common * 20, 40)
    pop = svc.get("booking_count") or 0
    if max_pop > 0:
        score += (pop / max_pop) * 30
    dist = svc.get("distance") or max_dist
    if max_dist > 0:
        score += ((max_dist - min(dist, max_dist)) / max_dist) * 30
    return score


# ── Endpoint ───────────────────────────────────────────────────────────────

@router.get("/home/feed")
async def home_feed(
    lat: Optional[float] = Query(None),
    lng: Optional[float] = Query(None),
    request: Request = None,
):
    pool = get_pool()

    current_user_id: Optional[str] = None
    user_tags: list = []
    member_ids: set = set()

    try:
        token = get_token_from_request(request)
        if token:
            payload = decode_jwt(token)
            current_user_id = payload.get("user_id")
    except Exception:
        pass

    async with pool.acquire() as conn:

        # ── Données utilisateur ──────────────────────────────────────────
        if current_user_id:
            row = await conn.fetchrow(
                "SELECT coach_tags FROM users WHERE user_id = $1",
                current_user_id,
            )
            if row:
                user_tags = _parse_tags(row["coach_tags"])

            member_rows = await conn.fetch(
                "SELECT spot_you_id FROM spot_you_members WHERE user_id = $1",
                current_user_id,
            )
            member_ids = {r["spot_you_id"] for r in member_rows}

        # ── Auto-expansion du rayon ──────────────────────────────────────
        actual_radius = RADIUS_STEPS[0]
        raw_spots: list = []
        raw_services: list = []

        for radius in RADIUS_STEPS:
            actual_radius = radius

            # ── SpotYou ──────────────────────────────────────────────────
            params: list = []
            p = 1
            conditions = ["tp.active = TRUE"]

            if current_user_id:
                conditions.append(f"tp.user_id != ${p}")
                params.append(current_user_id)
                p += 1

            if lat is not None and lng is not None:
                conditions.append(
                    f"ST_DWithin(tp.location::geography, "
                    f"ST_SetSRID(ST_MakePoint(${p}::float8, ${p+1}::float8), 4326)::geography, ${p+2}::float8)"
                )
                dist_expr = (
                    f"ST_Distance(tp.location::geography, "
                    f"ST_SetSRID(ST_MakePoint(${p}::float8, ${p+1}::float8), 4326)::geography)"
                )
                order_clause = f"ORDER BY {dist_expr}"
                params.extend([lng, lat, float(radius)])
                p += 3
            else:
                dist_expr = "NULL::float8"
                order_clause = ""

            where = " AND ".join(conditions)

            spot_query = f"""
                SELECT
                    tp.point_id, tp.user_id, tp.title, tp.description,
                    tp.precision, tp.tag_ids, tp.domain_id, tp.active,
                    tp.cancelled, tp.image_url, tp.images,
                    tp.schedule, tp.event_date, tp.event_end_date,
                    tp.minimum_participants, tp.maximum_participants,
                    ST_Y(tp.location::geometry) AS latitude,
                    ST_X(tp.location::geometry) AS longitude,
                    u.name  AS owner_name,
                    u.picture AS owner_picture,
                    u.role  AS owner_role,
                    COALESCE((
                        SELECT COUNT(*) FROM spot_you_members sm
                        WHERE sm.spot_you_id = tp.point_id
                    ), 0) AS participants_count,
                    COALESCE((
                        SELECT COUNT(*) FROM spot_you_attendance sa
                        WHERE sa.spot_you_id = tp.point_id
                          AND sa.status = 'going'
                          AND sa.session_date >= CURRENT_DATE
                    ), 0) AS going_count,
                    CASE
                        WHEN tp.maximum_participants IS NOT NULL THEN (
                            SELECT COUNT(*) FROM spot_you_attendance sa2
                            WHERE sa2.spot_you_id = tp.point_id
                              AND sa2.status = 'going'
                              AND sa2.session_date >= CURRENT_DATE
                        ) >= tp.maximum_participants
                        ELSE FALSE
                    END AS is_full,
                    {dist_expr} AS distance
                FROM tag_points tp
                LEFT JOIN users u ON u.user_id = tp.user_id
                WHERE {where}
                {order_clause}
                LIMIT 60
            """
            spot_rows = await conn.fetch(spot_query, *params)

            # Première passe : désérialiser sans requête SQL par ligne
            raw_spots = []
            for row in spot_rows:
                d = row_to_dict(row)
                raw_ti = d.get("tag_ids")
                if isinstance(raw_ti, str):
                    try:
                        d["tag_ids"] = json.loads(raw_ti)
                    except Exception:
                        d["tag_ids"] = []
                d["is_going"] = False
                raw_spots.append(d)

            # Batch is_going : 1 requête pour tous les SpotYou (remplace N+1)
            if current_user_id and raw_spots:
                spot_ids = [d["point_id"] for d in raw_spots]
                is_going_rows = await conn.fetch(
                    """SELECT DISTINCT spot_you_id
                       FROM spot_you_attendance
                       WHERE spot_you_id = ANY($1::text[])
                         AND user_id = $2
                         AND status = 'going'
                         AND session_date >= CURRENT_DATE""",
                    spot_ids, current_user_id,
                )
                is_going_set = {r["spot_you_id"] for r in is_going_rows}
                for d in raw_spots:
                    d["is_going"] = d["point_id"] in is_going_set

            # ── Services ─────────────────────────────────────────────────
            svc_params: list = []
            sp = 1
            svc_conditions = ["s.active = TRUE"]

            if current_user_id:
                svc_conditions.append(f"s.coach_id != ${sp}")
                svc_params.append(current_user_id)
                sp += 1

            svc_dist_expr = "NULL::float8"
            svc_order = ""
            if lat is not None and lng is not None:
                svc_conditions.append(
                    f"EXISTS (SELECT 1 FROM service_locations sl "
                    f"WHERE sl.service_id = s.service_id "
                    f"AND ST_DWithin(sl.location::geography, "
                    f"ST_SetSRID(ST_MakePoint(${sp}::float8, ${sp+1}::float8), 4326)::geography, ${sp+2}::float8))"
                )
                svc_dist_expr = (
                    f"(SELECT MIN(ST_Distance(sl.location::geography, "
                    f"ST_SetSRID(ST_MakePoint(${sp}::float8, ${sp+1}::float8), 4326)::geography)) "
                    f"FROM service_locations sl WHERE sl.service_id = s.service_id)"
                )
                svc_order = f"ORDER BY {svc_dist_expr} NULLS LAST"
                svc_params.extend([lng, lat, float(radius)])
                sp += 3

            svc_where = " AND ".join(svc_conditions)
            svc_query = f"""
                SELECT s.service_id, s.coach_id, s.title, s.description, s.address,
                       s.price, s.duration_min, s.tag_ids, s.domain_id, s.images,
                       s.location_description, s.max_participants,
                       u.name AS coach_name, u.picture AS coach_picture,
                       {svc_dist_expr} AS distance,
                       COALESCE((
                           SELECT COUNT(*) FROM bookings b
                           WHERE b.service_id = s.service_id
                             AND b.status NOT IN ('cancelled', 'expired')
                       ), 0) AS booking_count
                FROM services s
                LEFT JOIN users u ON u.user_id = s.coach_id
                WHERE {svc_where}
                {svc_order}
                LIMIT 40
            """
            svc_rows = await conn.fetch(svc_query, *svc_params)

            raw_services = []
            for row in svc_rows:
                d = row_to_dict(row)
                raw_imgs = d.get("images")
                if isinstance(raw_imgs, str):
                    try:
                        d["images"] = json.loads(raw_imgs)
                    except Exception:
                        d["images"] = []
                elif raw_imgs is None:
                    d["images"] = []
                raw_ti = d.get("tag_ids")
                if isinstance(raw_ti, str):
                    try:
                        d["tag_ids"] = json.loads(raw_ti)
                    except Exception:
                        d["tag_ids"] = []
                raw_services.append(d)

            total = len(raw_spots) + len(raw_services)
            if total >= MIN_RESULTS:
                break   # assez de résultats

    # ── Scoring & ranking ──────────────────────────────────────────────────
    has_personalization = bool(user_tags or member_ids)
    is_expanded = actual_radius > RADIUS_STEPS[0]

    max_dist_spot = max((s.get("distance") or 0 for s in raw_spots), default=1) or 1
    max_pop_spot  = max(
        ((s.get("going_count") or 0) + (s.get("participants_count") or 0)) for s in raw_spots
    ) if raw_spots else 1

    max_dist_svc = max((s.get("distance") or 0 for s in raw_services), default=1) or 1
    max_pop_svc  = max((s.get("booking_count") or 0 for s in raw_services), default=1) or 1

    for s in raw_spots:
        s["_score"] = _score_spot(s, user_tags, member_ids, max_dist_spot, max_pop_spot)
    for s in raw_services:
        s["_score"] = _score_service(s, user_tags, max_dist_svc, max_pop_svc)

    spotyou_sorted  = sorted(raw_spots, key=lambda x: -x["_score"])
    services_sorted = sorted(raw_services, key=lambda x: -x["_score"])

    for s in spotyou_sorted:
        s.pop("_score", None)
    for s in services_sorted:
        s.pop("_score", None)
        # Enrober coach_name/coach_picture dans un objet `coach` attendu par le frontend
        s["coach"] = {
            "user_id": s.get("coach_id"),
            "name":    s.pop("coach_name", None),
            "picture": s.pop("coach_picture", None),
        }

    return {
        "spotyou":             spotyou_sorted[:30],
        "services":            services_sorted[:20],
        "actual_radius_km":    actual_radius // 1000,
        "is_expanded":         is_expanded,
        "has_personalization": has_personalization,
        "total_count":         len(spotyou_sorted) + len(services_sorted),
    }
