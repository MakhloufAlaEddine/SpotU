"""
Product creation routes — flow complet de création produit (location, vente, etc.)
Status: draft → pending_review → active (validation admin)
Admin: auto-publication directe (pas de validation)
"""
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from database import get_pool
from routes.auth_routes import require_auth

router = APIRouter()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return "prod_" + uuid.uuid4().hex[:12]


def _clean(row: dict) -> dict:
    """Retire les champs non-sérialisables."""
    out = {}
    for k, v in row.items():
        if hasattr(v, 'isoformat'):
            out[k] = v.isoformat()
        else:
            out[k] = v
    return out


# ─── GET /api/products/mine ───────────────────────────────────────────────────
@router.get("/products/mine")
async def get_my_products(request: Request):
    """Retourne les produits créés par l'utilisateur connecté."""
    pool = get_pool()
    user = await require_auth(request, pool)
    user_id = user["user_id"]

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT
                product_id, title, short_description, description,
                price, currency, product_type, pricing_type,
                pricing_modes, price_per_hour, price_per_day, price_per_week, price_per_month,
                status, category, subcategory,
                cover_image_url, image_url, image_urls,
                condition_label, available_quantity,
                deposit_required, deposit_amount,
                pickup_type, city, location_privacy,
                related_spotyou_ids, created_at, updated_at,
                rejection_reason, admin_comment
            FROM marketplace_products
            WHERE seller_id = $1
              AND status != 'deleted'
            ORDER BY created_at DESC
            """,
            user_id,
        )

    products = [_clean(dict(r)) for r in rows]
    return {"products": products, "count": len(products)}


# ─── GET /api/products/{product_id}/detail ────────────────────────────────────
@router.get("/products/{product_id}/detail")
async def get_product_detail(request: Request, product_id: str):
    """Retourne le détail complet d'un produit appartenant à l'utilisateur (pour édition)."""
    pool = get_pool()
    user = await require_auth(request, pool)
    user_id = user["user_id"]

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT product_id, title, short_description, description,
                   price, currency, product_type, pricing_type,
                   status, category, subcategory,
                   cover_image_url, image_url, image_urls,
                   condition_label, available_quantity,
                   deposit_required, deposit_amount, max_duration_days,
                   pickup_type, pickup_notes, city, location_privacy, lat, lng,
                   return_rules, cancellation_rules, availability_note,
                   included_items, brand_model, size_dimensions,
                   tag_ids,
                   pricing_modes, price_per_hour, price_per_day, price_per_week, price_per_month,
                   related_spotyou_ids,
                   rejection_reason, admin_comment,
                   created_at, updated_at
            FROM marketplace_products
            WHERE product_id = $1 AND seller_id = $2 AND status != 'deleted'
            """,
            product_id, user_id,
        )
    if not row:
        return JSONResponse({"error": "Produit introuvable ou accès refusé."}, status_code=404)
    return _clean(dict(row))


# ─── POST /api/products ───────────────────────────────────────────────────────
@router.post("/products")
async def create_product(request: Request):
    """
    Crée ou met à jour un produit en brouillon.
    Si `product_id` est fourni dans le body, met à jour le brouillon existant.
    Sinon, crée un nouveau produit.
    Retourne le product_id.
    """
    pool = get_pool()
    user = await require_auth(request, pool)
    user_id = user["user_id"]

    body = await request.json()
    product_id = body.get("product_id") or _new_id()
    status = body.get("status", "draft")  # 'draft' ou 'pending_review'
    requested_status = status  # statut voulu par l'utilisateur

    # Si l'utilisateur est admin et soumet en pending_review → publication directe
    is_admin = user.get("role") == "admin"
    if is_admin and status == "pending_review":
        status = "active"

    # Validation minimale obligatoire
    title = (body.get("title") or "").strip()
    if not title:
        return JSONResponse({"error": "Le titre est obligatoire."}, status_code=400)

    price_raw = body.get("price")
    try:
        price = float(str(price_raw).replace(",", ".")) if price_raw is not None else 0.0
    except (ValueError, TypeError):
        price = 0.0

    deposit_raw = body.get("deposit_amount")
    try:
        deposit_amount = float(str(deposit_raw).replace(",", ".")) if deposit_raw else None
    except (ValueError, TypeError):
        deposit_amount = None

    max_days_raw = body.get("max_duration_days")
    try:
        max_duration_days = int(max_days_raw) if max_days_raw else None
    except (ValueError, TypeError):
        max_duration_days = None

    qty_raw = body.get("available_quantity")
    try:
        available_quantity = max(1, int(qty_raw)) if qty_raw else 1
    except (ValueError, TypeError):
        available_quantity = 1

    image_urls = body.get("image_urls") or []
    cover_image_url = body.get("cover_image_url") or (image_urls[0] if image_urls else None)
    # Rétro-compatibilité avec le champ image_url existant
    image_url = cover_image_url

    related_ids = body.get("related_spotyou_ids") or []

    now = _now()

    # ── Validation complète pour pending_review ────────────────────────────────
    if requested_status == "pending_review":
        category    = (body.get("category")       or "").strip()
        cond_label  = (body.get("condition_label") or "").strip()
        pickup_type = (body.get("pickup_type")     or "").strip()
        p_type      = (body.get("pricing_type")    or "day")
        deposit_req = body.get("deposit_required", False)

        errors = []
        if not category:
            errors.append("La catégorie du matériel est obligatoire.")
        if not cond_label:
            errors.append("L'état du matériel est obligatoire.")
        if not price or price <= 0:
            errors.append("Le prix doit être supérieur à 0.")
        if not image_urls:
            errors.append("Au moins une photo est requise.")
        if not pickup_type:
            errors.append("Le mode de remise du matériel est obligatoire.")
        if p_type == "day" and not max_duration_days:
            errors.append("La durée maximale de location est obligatoire.")
        if deposit_req and (not deposit_amount or deposit_amount <= 0):
            errors.append("Le montant de la caution est obligatoire si une caution est requise.")
        if errors:
            return JSONResponse(
                {"error": errors[0], "details": errors},
                status_code=422,
            )

    async with pool.acquire() as conn:
        # Vérifie si le produit existe déjà et appartient à l'utilisateur
        existing = await conn.fetchrow(
            "SELECT product_id FROM marketplace_products WHERE product_id = $1 AND seller_id = $2",
            product_id, user_id,
        )

        if existing:
            # UPDATE
            await conn.execute(
                """
                UPDATE marketplace_products SET
                    title = $1, short_description = $2, description = $3,
                    price = $4, currency = $5, product_type = $6, pricing_type = $7,
                    category = $8, subcategory = $9,
                    cover_image_url = $10, image_url = $11, image_urls = $12,
                    condition_label = $13, included_items = $14,
                    brand_model = $15, size_dimensions = $16,
                    available_quantity = $17, in_stock = $18,
                    deposit_required = $19, deposit_amount = $20,
                    max_duration_days = $21,
                    pickup_type = $22, pickup_notes = $23,
                UPDATE marketplace_products SET
                    title = $1, short_description = $2, description = $3,
                    price = $4, currency = $5, product_type = $6, pricing_type = $7,
                    pricing_modes = $8, price_per_hour = $9, price_per_day = $10,
                    price_per_week = $11, price_per_month = $12,
                    category = $13, subcategory = $14,
                    cover_image_url = $15, image_url = $16, image_urls = $17,
                    condition_label = $18, included_items = $19, brand_model = $20,
                    size_dimensions = $21, available_quantity = $22, in_stock = $23,
                    deposit_required = $24, deposit_amount = $25, max_duration_days = $26,
                    pickup_type = $27, pickup_notes = $28, availability_note = $29,
                    return_rules = $30, cancellation_rules = $31,
                    city = $32, lat = $33, lng = $34,
                    location_privacy = $35, radius_km = $36,
                    related_spotyou_ids = $37,
                    tag_ids = $38,
                    delivery_modes = $39,
                    status = $40, updated_at = $41
                WHERE product_id = $42 AND seller_id = $43
                """,
                title,
                body.get("short_description"),
                body.get("description"),
                price,
                body.get("currency", "EUR"),
                body.get("product_type", "rental"),
                body.get("pricing_type", "day"),
                body.get("pricing_modes") or ["day"],
                body.get("price_per_hour"),
                body.get("price_per_day"),
                body.get("price_per_week"),
                body.get("price_per_month"),
                body.get("category"),
                body.get("subcategory"),
                cover_image_url,
                image_url,
                image_urls,
                body.get("condition_label", "good"),
                body.get("included_items"),
                body.get("brand_model"),
                body.get("size_dimensions"),
                available_quantity,
                available_quantity > 0,
                body.get("deposit_required", False),
                deposit_amount,
                max_duration_days,
                body.get("pickup_type"),
                body.get("pickup_notes"),
                body.get("availability_note"),
                body.get("return_rules"),
                body.get("cancellation_rules"),
                body.get("city"),
                body.get("lat"),
                body.get("lng"),
                body.get("location_privacy", "100m"),
                body.get("radius_km", 0.1),
                related_ids,
                body.get("tag_ids") or [],
                body.get("delivery_modes") or _delivery_modes(body),
                status,
                now,
                product_id,
                user_id,
            )
        else:
            # INSERT
            seller_name = user.get("full_name") or user.get("username") or "Utilisateur"
            seller_picture = user.get("picture_url")

            await conn.execute(
                """
                INSERT INTO marketplace_products (
                    product_id, title, short_description, description,
                    price, currency, product_type, pricing_type,
                    pricing_modes, price_per_hour, price_per_day, price_per_week, price_per_month,
                    seller_id, seller_type, seller_name, seller_picture_url,
                    category, subcategory,
                    cover_image_url, image_url, image_urls,
                    condition_label, included_items,
                    brand_model, size_dimensions,
                    available_quantity, in_stock,
                    deposit_required, deposit_amount, max_duration_days,
                    pickup_type, pickup_notes, availability_note,
                    return_rules, cancellation_rules,
                    city, lat, lng, location_privacy, radius_km,
                    related_spotyou_ids, tag_ids, delivery_modes,
                    status, skill_level, created_at, updated_at
                ) VALUES (
                    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
                    $18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,
                    $33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47,$48
                )
                """,
                product_id,
                title,
                body.get("short_description"),
                body.get("description"),
                price,
                body.get("currency", "EUR"),
                body.get("product_type", "rental"),
                body.get("pricing_type", "day"),
                body.get("pricing_modes") or ["day"],
                body.get("price_per_hour"),
                body.get("price_per_day"),
                body.get("price_per_week"),
                body.get("price_per_month"),
                user_id,
                "user",
                seller_name,
                seller_picture,
                body.get("category"),
                body.get("subcategory"),
                cover_image_url,
                image_url,
                image_urls,
                body.get("condition_label", "good"),
                body.get("included_items"),
                body.get("brand_model"),
                body.get("size_dimensions"),
                available_quantity,
                available_quantity > 0,
                body.get("deposit_required", False),
                deposit_amount,
                max_duration_days,
                body.get("pickup_type"),
                body.get("pickup_notes"),
                body.get("availability_note"),
                body.get("return_rules"),
                body.get("cancellation_rules"),
                body.get("city"),
                body.get("lat"),
                body.get("lng"),
                body.get("location_privacy", "100m"),
                body.get("radius_km", 0.1),
                related_ids,
                body.get("tag_ids") or [],
                body.get("delivery_modes") or _delivery_modes(body),
                status,
                "tous",
                now,
                now,
            )

    # Notification admins si soumission en validation par un non-admin
    if requested_status == "pending_review" and not is_admin:
        await _notify_admins_new_product(pool, product_id, title, is_admin)

    return {"product_id": product_id, "status": status}


async def _notify_admins_new_product(pool, product_id: str, title: str, is_admin: bool):
    """Notifie tous les admins qu'un nouveau produit attend validation.
    Ignoré si le créateur est lui-même admin (publication directe).
    """
    if is_admin:
        return
    from push_service import send_push_to_user
    async with pool.acquire() as conn:
        admin_rows = await conn.fetch("SELECT user_id FROM users WHERE role = 'admin'")
    for row in admin_rows:
        await send_push_to_user(
            pool,
            row["user_id"],
            title="Nouvelle annonce à valider",
            body=f"« {title} » est en attente de publication.",
            data={
                "type": "admin_product_pending",
                "product_id": product_id,
                "action": "/admin?tab=products",
            },
            notif_type="admin_product_pending",
        )


# ─── DELETE /api/products/{product_id} ───────────────────────────────────────
@router.delete("/products/{product_id}")
async def delete_product(request: Request, product_id: str):
    """Suppression douce — met le statut à 'deleted'."""
    pool = get_pool()
    user = await require_auth(request, pool)
    user_id = user["user_id"]

    async with pool.acquire() as conn:
        result = await conn.execute(
            "UPDATE marketplace_products SET status='deleted', updated_at=$1 WHERE product_id=$2 AND seller_id=$3",
            _now(), product_id, user_id,
        )
    if result == "UPDATE 0":
        return JSONResponse({"error": "Produit introuvable ou non autorisé."}, status_code=404)
    return {"ok": True}


# ─── helpers ──────────────────────────────────────────────────────────────────
def _delivery_modes(body: dict) -> list:
    pickup = body.get("pickup_type", "")
    modes = []
    if pickup == "local_pickup":
        modes.append("local_pickup")
    elif pickup == "creator_handoff":
        modes.append("creator_handoff")
    return modes or ["local_pickup"]
