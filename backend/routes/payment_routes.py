"""
payment_routes.py — Routes de gestion des paiements SpotU
==========================================================
Ces routes gèrent le cycle de vie des payments :
- Lecture par user (payeur ou bénéficiaire)
- Mise à jour Stripe (webhook ready)
- Accès admin agrégé
"""

from fastapi import APIRouter, Request, HTTPException
from auth_utils import require_auth, require_role
from database import get_pool, row_to_dict, rows_to_list
from models import new_id
import json

router = APIRouter()


def _deserialize(d: dict) -> dict:
    """Désérialise pricing_rule_snapshot si c'est une string."""
    if d.get("pricing_rule_snapshot") and isinstance(d["pricing_rule_snapshot"], str):
        d["pricing_rule_snapshot"] = json.loads(d["pricing_rule_snapshot"])
    return d


# ── Lecture utilisateur ────────────────────────────────────────────────────────

@router.get("/payments/me")
async def my_payments(request: Request):
    """Paiements émis OU reçus par l'utilisateur connecté."""
    pool = get_pool()
    user = await require_auth(request, pool)
    uid = user["user_id"]
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT p.*,
                u_pay.name AS payer_name,
                u_recv.name AS receiver_name
               FROM payments p
               LEFT JOIN users u_pay  ON u_pay.user_id  = p.payer_user_id
               LEFT JOIN users u_recv ON u_recv.user_id = p.receiver_user_id
               WHERE p.payer_user_id = $1 OR p.receiver_user_id = $1
               ORDER BY p.created_at DESC""",
            uid,
        )
    return [_deserialize(row_to_dict(r)) for r in rows]


@router.get("/payments/{payment_id}")
async def get_payment(payment_id: str, request: Request):
    """Détail d'un paiement — accessible par le payeur, le bénéficiaire ou un admin."""
    pool = get_pool()
    user = await require_auth(request, pool)
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM payments WHERE payment_id = $1", payment_id
        )
    if not row:
        raise HTTPException(status_code=404, detail="Payment not found")
    d = row_to_dict(row)
    if (
        d["payer_user_id"] != user["user_id"]
        and d["receiver_user_id"] != user["user_id"]
        and user.get("role") != "admin"
    ):
        raise HTTPException(status_code=403, detail="Access denied")
    return _deserialize(d)


# ── Webhook Stripe (à compléter lors de l'intégration Stripe) ────────────────

@router.patch("/payments/{payment_id}/stripe")
async def update_stripe_fields(payment_id: str, request: Request):
    """
    Met à jour les champs Stripe sur un paiement existant.
    Appelé par le webhook Stripe ou par le backend après confirmation.
    """
    pool = get_pool()
    # Note : en production ce endpoint sera sécurisé par signature Stripe webhook
    body = await request.json()
    allowed = {
        "stripe_payment_intent_id",
        "stripe_charge_id",
        "stripe_transfer_id",
        "status",
    }
    fields = {k: v for k, v in body.items() if k in allowed}
    if not fields:
        raise HTTPException(status_code=400, detail="No valid fields")

    set_clause = ", ".join(f"{k} = ${i+2}" for i, k in enumerate(fields))
    async with pool.acquire() as conn:
        result = await conn.execute(
            f"UPDATE payments SET {set_clause}, updated_at = NOW() WHERE payment_id = $1",
            payment_id, *fields.values(),
        )
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail="Payment not found")

    # Si le paiement est confirmé, mettre à jour le booking lié
    if fields.get("status") == "succeeded":
        async with pool.acquire() as conn:
            await conn.execute(
                """UPDATE bookings SET payment_status = 'paid', updated_at = NOW()
                   WHERE booking_id = (
                       SELECT booking_id FROM payments WHERE payment_id = $1
                   )""",
                payment_id,
            )
    return {"success": True}


# ── Admin ──────────────────────────────────────────────────────────────────────

@router.get("/admin/payments")
async def admin_list_payments(request: Request):
    """Liste tous les paiements — admin uniquement."""
    pool = get_pool()
    await require_role(request, pool, "admin")
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT p.*,
                u_pay.name  AS payer_name,
                u_recv.name AS receiver_name
               FROM payments p
               LEFT JOIN users u_pay  ON u_pay.user_id  = p.payer_user_id
               LEFT JOIN users u_recv ON u_recv.user_id = p.receiver_user_id
               ORDER BY p.created_at DESC
               LIMIT 500"""
        )
    return [_deserialize(row_to_dict(r)) for r in rows]


@router.get("/admin/payments/stats")
async def admin_payment_stats(request: Request):
    """Agrégats financiers depuis les colonnes plates de la table payments."""
    pool = get_pool()
    await require_role(request, pool, "admin")
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """SELECT
                COUNT(*)                            AS total_payments,
                COUNT(*) FILTER (WHERE status='succeeded') AS paid_count,
                COUNT(*) FILTER (WHERE status='pending')   AS pending_count,
                COUNT(*) FILTER (WHERE status='failed')    AS failed_count,
                COALESCE(SUM(base_amount)
                    FILTER (WHERE status='succeeded'), 0)  AS gmv,
                COALESCE(SUM(platform_total_fee)
                    FILTER (WHERE status='succeeded'), 0)  AS platform_revenue,
                COALESCE(SUM(payer_total_amount)
                    FILTER (WHERE status='succeeded'), 0)  AS total_charged,
                COALESCE(SUM(receiver_net_amount)
                    FILTER (WHERE status='succeeded'), 0)  AS total_disbursed
               FROM payments"""
        )
    d = row_to_dict(row)
    return {k: float(v) if isinstance(v, (int, float)) else v for k, v in d.items()}


@router.get("/admin/subscriptions")
async def admin_subscriptions(request: Request):
    """Liste tous les abonnements utilisateurs — admin uniquement."""
    pool = get_pool()
    await require_role(request, pool, "admin")
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT us.*, u.name AS user_name, u.email,
                sp.name AS plan_name, sp.price AS plan_price
               FROM user_subscriptions us
               LEFT JOIN users u              ON u.user_id   = us.user_id
               LEFT JOIN subscription_plans sp ON sp.plan_id = us.plan_id
               ORDER BY us.created_at DESC"""
        )
    return rows_to_list(rows)
