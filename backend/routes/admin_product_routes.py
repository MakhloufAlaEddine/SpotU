"""
Admin routes pour la modération des produits marketplace.
Approve / reject / list pending.
"""
from datetime import datetime, timezone
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse

from database import get_pool
from routes.auth_routes import require_auth
from push_service import send_push_to_user

router = APIRouter()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _clean(row: dict) -> dict:
    out = {}
    for k, v in row.items():
        if hasattr(v, 'isoformat'):
            out[k] = v.isoformat()
        else:
            out[k] = v
    return out


async def _require_admin(request, pool):
    user = await require_auth(request, pool)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return user


async def _get_all_admins(conn) -> list:
    rows = await conn.fetch("SELECT user_id FROM users WHERE role = 'admin'")
    return [r["user_id"] for r in rows]


# ─── GET /api/admin/products/pending ─────────────────────────────────────────
@router.get("/admin/products/pending")
async def list_pending_products(request: Request):
    pool = get_pool()
    await _require_admin(request, pool)

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT
                p.product_id, p.title, p.short_description, p.price, p.pricing_type,
                p.category, p.subcategory, p.cover_image_url, p.image_url, p.image_urls,
                p.condition_label, p.available_quantity,
                p.deposit_required, p.deposit_amount,
                p.pickup_type, p.city, p.lat, p.lng,
                p.return_rules, p.cancellation_rules, p.pickup_notes,
                p.availability_note, p.related_spotyou_ids,
                p.seller_id, p.status, p.created_at, p.updated_at,
                p.admin_reminder_sent_at,
                u.name AS seller_name, u.picture AS seller_picture,
                -- Score qualité simplifié côté backend
                (
                    CASE WHEN p.cover_image_url IS NOT NULL THEN 20 ELSE 0 END +
                    CASE WHEN jsonb_array_length(COALESCE(p.image_urls, '[]'::jsonb)) >= 3 THEN 10 ELSE 0 END +
                    CASE WHEN length(p.title) >= 10 THEN 15 ELSE 0 END +
                    CASE WHEN length(p.title) >= 25 THEN 5 ELSE 0 END +
                    CASE WHEN length(COALESCE(p.description,'')) >= 50 THEN 10 ELSE 0 END +
                    CASE WHEN length(COALESCE(p.description,'')) >= 150 THEN 10 ELSE 0 END +
                    CASE WHEN p.price > 0 THEN 10 ELSE 0 END +
                    CASE WHEN p.pickup_type IS NOT NULL THEN 10 ELSE 0 END +
                    CASE WHEN p.lat IS NOT NULL THEN 10 ELSE 0 END
                ) AS quality_score
            FROM marketplace_products p
            JOIN users u ON u.user_id = p.seller_id
            WHERE p.status = 'pending_review'
            ORDER BY p.created_at ASC
            """
        )
    return {"products": [_clean(dict(r)) for r in rows], "count": len(rows)}


# ─── GET /api/admin/products/{product_id} ─────────────────────────────────────
@router.get("/admin/products/{product_id}")
async def get_product_for_review(request: Request, product_id: str):
    pool = get_pool()
    await _require_admin(request, pool)

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT p.*, u.name AS seller_name, u.picture AS seller_picture, u.email AS seller_email,
                   (
                       CASE WHEN p.cover_image_url IS NOT NULL THEN 20 ELSE 0 END +
                       CASE WHEN jsonb_array_length(COALESCE(p.image_urls, '[]'::jsonb)) >= 3 THEN 10 ELSE 0 END +
                       CASE WHEN length(p.title) >= 10 THEN 15 ELSE 0 END +
                       CASE WHEN length(p.title) >= 25 THEN 5 ELSE 0 END +
                       CASE WHEN length(COALESCE(p.description,'')) >= 50 THEN 10 ELSE 0 END +
                       CASE WHEN length(COALESCE(p.description,'')) >= 150 THEN 10 ELSE 0 END +
                       CASE WHEN p.price > 0 THEN 10 ELSE 0 END +
                       CASE WHEN p.pickup_type IS NOT NULL THEN 10 ELSE 0 END +
                       CASE WHEN p.lat IS NOT NULL THEN 10 ELSE 0 END
                   ) AS quality_score
            FROM marketplace_products p
            JOIN users u ON u.user_id = p.seller_id
            WHERE p.product_id = $1
            """,            product_id,
        )
    if not row:
        return JSONResponse({"error": "Produit introuvable."}, status_code=404)
    return _clean(dict(row))


# ─── POST /api/admin/products/{product_id}/approve ────────────────────────────
@router.post("/admin/products/{product_id}/approve")
async def approve_product(request: Request, product_id: str):
    pool = get_pool()
    admin = await _require_admin(request, pool)

    body = await request.json()
    comment = (body.get("comment") or "").strip()
    now = _now()

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT seller_id, title FROM marketplace_products WHERE product_id = $1",
            product_id,
        )
        if not row:
            return JSONResponse({"error": "Produit introuvable."}, status_code=404)

        await conn.execute(
            """
            UPDATE marketplace_products
            SET status = 'active', in_stock = TRUE,
                admin_validated_by = $1, admin_validated_at = $2,
                admin_comment = $3, updated_at = $2
            WHERE product_id = $4
            """,
            admin["user_id"], now, comment or None, product_id,
        )

    # Notification au créateur
    await send_push_to_user(
        pool,
        row["seller_id"],
        title="Produit publié !",
        body=f"Ton annonce « {row['title']} » a été validée et est maintenant visible dans la boutique.",
        data={
            "type": "product_approved",
            "product_id": product_id,
            "action": "/products/my-products",
        },
        notif_type="product_approved",
    )

    return {"ok": True, "status": "active"}


# ─── POST /api/admin/products/{product_id}/reject ─────────────────────────────
@router.post("/admin/products/{product_id}/reject")
async def reject_product(request: Request, product_id: str):
    pool = get_pool()
    admin = await _require_admin(request, pool)

    body = await request.json()
    comment = (body.get("comment") or "").strip()
    # Commentaire optionnel mais recommandé pour le refus

    now = _now()

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT seller_id, title FROM marketplace_products WHERE product_id = $1",
            product_id,
        )
        if not row:
            return JSONResponse({"error": "Produit introuvable."}, status_code=404)

        await conn.execute(
            """
            UPDATE marketplace_products
            SET status = 'rejected', in_stock = FALSE,
                admin_validated_by = $1, admin_validated_at = $2,
                rejection_reason = $3, admin_comment = $3, updated_at = $2
            WHERE product_id = $4
            """,
            admin["user_id"], now, comment or None, product_id,
        )

    # Notification au créateur avec action vers l'édition
    await send_push_to_user(
        pool,
        row["seller_id"],
        title="Annonce refusée",
        body=f"Ton annonce « {row['title']} » n'a pas été validée. Clique pour voir les corrections à apporter.",
        data={
            "type": "product_rejected",
            "product_id": product_id,
            "admin_comment": comment,
            "action": f"/products/create?productId={product_id}&mode=edit",
        },
        notif_type="product_rejected",
    )

    return {"ok": True, "status": "rejected"}
