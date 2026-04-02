from fastapi import APIRouter, Request, HTTPException, Query
from datetime import datetime, timezone
from typing import Optional
from auth_utils import require_role
from database import get_pool, row_to_dict, rows_to_list
from models import new_id

router = APIRouter()


@router.get("/stats")
async def get_stats(request: Request):
    pool = get_pool()
    await require_role(request, pool, "admin")
    async with pool.acquire() as conn:
        total_users = await conn.fetchval("SELECT COUNT(*) FROM users")
        total_coaches = await conn.fetchval("SELECT COUNT(*) FROM users WHERE role = 'coach'")
        total_tagpoints = await conn.fetchval("SELECT COUNT(*) FROM tag_points WHERE active = TRUE")
        total_bookings = await conn.fetchval("SELECT COUNT(*) FROM bookings")
        total_paid = await conn.fetchval("SELECT COUNT(*) FROM bookings WHERE payment_status = 'paid'")

        # GMV = somme des montants payés (payer_total_amount dans le snapshot, sinon amount)
        gmv_row = await conn.fetchrow(
            """SELECT COALESCE(
                SUM(COALESCE(
                    (pricing_snapshot->>'payer_total_amount')::numeric,
                    amount
                )), 0) AS gmv
               FROM bookings WHERE payment_status = 'paid'"""
        )
        gmv = float(gmv_row["gmv"]) if gmv_row else 0.0

        # Frais plateforme tirés du snapshot (source de vérité)
        fees_row = await conn.fetchrow(
            """SELECT COALESCE(
                SUM((pricing_snapshot->>'platform_total_fee')::numeric), 0
               ) AS fees
               FROM bookings WHERE payment_status = 'paid' AND pricing_snapshot IS NOT NULL"""
        )
        platform_fees = float(fees_row["fees"]) if fees_row else 0.0

    return {
        "total_users": total_users,
        "total_coaches": total_coaches,
        "total_tagpoints": total_tagpoints,
        "total_bookings": total_bookings,
        "total_paid_bookings": total_paid,
        "gmv": round(gmv, 2),
        "platform_commission": round(platform_fees, 2),
    }


@router.get("/users")
async def list_users(
    request: Request,
    role: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=500),
):
    pool = get_pool()
    await require_role(request, pool, "admin")
    async with pool.acquire() as conn:
        if role:
            rows = await conn.fetch(
                "SELECT user_id, email, name, role, is_coach_verified, created_at FROM users WHERE role = $1 ORDER BY created_at DESC LIMIT $2",
                role, limit
            )
        else:
            rows = await conn.fetch(
                "SELECT user_id, email, name, role, is_coach_verified, created_at FROM users ORDER BY created_at DESC LIMIT $1",
                limit
            )
    return rows_to_list(rows)


@router.put("/users/{user_id}/role")
async def set_user_role(user_id: str, request: Request):
    pool = get_pool()
    await require_role(request, pool, "admin")
    body = await request.json()
    new_role = body.get("role")
    if new_role not in ("user", "coach", "admin"):
        raise HTTPException(status_code=400, detail="Invalid role")
    async with pool.acquire() as conn:
        result = await conn.execute(
            "UPDATE users SET role = $1, updated_at = NOW() WHERE user_id = $2",
            new_role, user_id
        )
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail="User not found")
    return {"success": True}


@router.put("/users/{user_id}/verify-coach")
async def verify_coach(user_id: str, request: Request):
    pool = get_pool()
    await require_role(request, pool, "admin")
    async with pool.acquire() as conn:
        result = await conn.execute(
            "UPDATE users SET is_coach_verified = TRUE, role = 'coach', updated_at = NOW() WHERE user_id = $1",
            user_id
        )
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail="User not found")
    return {"success": True}


@router.get("/tag-points")
async def admin_tag_points(request: Request):
    pool = get_pool()
    await require_role(request, pool, "admin")
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT point_id, user_id, title, domain_id, active, created_at FROM tag_points ORDER BY created_at DESC LIMIT 500"
        )
    return rows_to_list(rows)


@router.delete("/tag-points/{point_id}")
async def admin_delete_tag_point(point_id: str, request: Request):
    pool = get_pool()
    await require_role(request, pool, "admin")
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM tag_points WHERE point_id = $1", point_id)
    return {"success": True}


@router.get("/services")
async def admin_services(request: Request):
    pool = get_pool()
    await require_role(request, pool, "admin")
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT service_id, coach_id, title, price, active, created_at FROM services ORDER BY created_at DESC LIMIT 200"
        )
    return rows_to_list(rows)


@router.get("/pricing-rules")
async def list_pricing_rules(request: Request):
    pool = get_pool()
    await require_role(request, pool, "admin")
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT * FROM pricing_rules ORDER BY product_type, priority DESC"
        )
    return rows_to_list(rows)


@router.post("/pricing-rules")
async def create_pricing_rule(request: Request):
    pool = get_pool()
    await require_role(request, pool, "admin")
    body = await request.json()
    required = {"product_type", "name"}
    if not required.issubset(body.keys()):
        raise HTTPException(status_code=400, detail="product_type and name are required")
    rule_id = new_id("rule")
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """INSERT INTO pricing_rules
               (rule_id, product_type, name, payer_fixed_fee, payer_percent_fee,
                receiver_fixed_fee, receiver_percent_fee, active, priority)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *""",
            rule_id,
            body["product_type"], body["name"],
            float(body.get("payer_fixed_fee", 0)),
            float(body.get("payer_percent_fee", 0)),
            float(body.get("receiver_fixed_fee", 0)),
            float(body.get("receiver_percent_fee", 0)),
            bool(body.get("active", True)),
            int(body.get("priority", 0)),
        )
    return row_to_dict(row)


@router.put("/pricing-rules/{rule_id}")
async def update_pricing_rule(rule_id: str, request: Request):
    pool = get_pool()
    await require_role(request, pool, "admin")
    body = await request.json()
    allowed = {
        "name", "payer_fixed_fee", "payer_percent_fee",
        "receiver_fixed_fee", "receiver_percent_fee", "active", "priority",
    }
    fields = {k: v for k, v in body.items() if k in allowed}
    if not fields:
        raise HTTPException(status_code=400, detail="No valid fields to update")
    set_clause = ", ".join(f"{k} = ${i+2}" for i, k in enumerate(fields))
    async with pool.acquire() as conn:
        result = await conn.execute(
            f"UPDATE pricing_rules SET {set_clause}, updated_at = NOW() WHERE rule_id = $1",
            rule_id, *fields.values(),
        )
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail="Rule not found")
    return {"success": True}


@router.delete("/pricing-rules/{rule_id}")
async def delete_pricing_rule(rule_id: str, request: Request):
    pool = get_pool()
    await require_role(request, pool, "admin")
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM pricing_rules WHERE rule_id = $1", rule_id)
    return {"success": True}


# ── Plans d'abonnement ─────────────────────────────────────────────────────────

@router.get("/subscription-plans")
async def list_subscription_plans(request: Request):
    pool = get_pool()
    await require_role(request, pool, "admin")
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT * FROM subscription_plans ORDER BY priority DESC, created_at"
        )
    return rows_to_list(rows)


@router.post("/subscription-plans")
async def create_subscription_plan(request: Request):
    pool = get_pool()
    await require_role(request, pool, "admin")
    body = await request.json()
    if "name" not in body:
        raise HTTPException(status_code=400, detail="name is required")
    plan_id = new_id("plan")
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """INSERT INTO subscription_plans
               (plan_id, name, description, price, duration_days,
                exempt_payer_fixed, exempt_payer_percent,
                exempt_receiver_fixed, exempt_receiver_percent,
                active, priority)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *""",
            plan_id,
            body["name"],
            body.get("description"),
            float(body.get("price", 0)),
            body.get("duration_days"),
            bool(body.get("exempt_payer_fixed", False)),
            bool(body.get("exempt_payer_percent", False)),
            bool(body.get("exempt_receiver_fixed", False)),
            bool(body.get("exempt_receiver_percent", False)),
            bool(body.get("active", True)),
            int(body.get("priority", 0)),
        )
    return row_to_dict(row)


@router.put("/subscription-plans/{plan_id}")
async def update_subscription_plan(plan_id: str, request: Request):
    pool = get_pool()
    await require_role(request, pool, "admin")
    body = await request.json()
    allowed = {
        "name", "description", "price", "duration_days",
        "exempt_payer_fixed", "exempt_payer_percent",
        "exempt_receiver_fixed", "exempt_receiver_percent",
        "active", "priority",
    }
    fields = {k: v for k, v in body.items() if k in allowed}
    if not fields:
        raise HTTPException(status_code=400, detail="No valid fields to update")
    set_clause = ", ".join(f"{k} = ${i+2}" for i, k in enumerate(fields))
    async with pool.acquire() as conn:
        result = await conn.execute(
            f"UPDATE subscription_plans SET {set_clause}, updated_at = NOW() WHERE plan_id = $1",
            plan_id, *fields.values(),
        )
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail="Plan not found")
    return {"success": True}


@router.delete("/subscription-plans/{plan_id}")
async def delete_subscription_plan(plan_id: str, request: Request):
    pool = get_pool()
    await require_role(request, pool, "admin")
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM subscription_plans WHERE plan_id = $1", plan_id)
    return {"success": True}


@router.get("/domains")
async def admin_domains(request: Request):
    pool = get_pool()
    await require_role(request, pool, "admin")
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM domains ORDER BY name")
    return rows_to_list(rows)


@router.get("/tags-analytics")
async def get_tags_analytics(request: Request):
    """Statistiques d'utilisation des tags et domaines."""
    pool = get_pool()
    await require_role(request, pool, "admin")
    async with pool.acquire() as conn:
        # Top tags : utilisés dans tag_points ET profils utilisateurs
        top_tags_rows = await conn.fetch(
            """WITH safe_tp AS (
                 SELECT tag_ids FROM tag_points
                 WHERE tag_ids IS NOT NULL AND jsonb_typeof(tag_ids) = 'array'
               ),
               safe_users AS (
                 SELECT coach_tags FROM users
                 WHERE coach_tags IS NOT NULL AND jsonb_typeof(coach_tags) = 'array'
               ),
               tp_usage AS (
                 SELECT tid AS tag_id, COUNT(*) AS tp_count
                 FROM safe_tp, jsonb_array_elements_text(tag_ids) AS tid
                 GROUP BY tid
               ),
               user_usage AS (
                 SELECT tid AS tag_id, COUNT(*) AS u_count
                 FROM safe_users, jsonb_array_elements_text(coach_tags) AS tid
                 GROUP BY tid
               )
               SELECT t.tag_id, t.name, t.label_fr, t.label_en, t.icon,
                      d.name AS domain_name, d.color AS domain_color,
                      COALESCE(tp.tp_count, 0) AS tagpoint_count,
                      COALESCE(uu.u_count, 0) AS user_count,
                      COALESCE(tp.tp_count, 0) + COALESCE(uu.u_count, 0) AS total_usage
               FROM tags t
               LEFT JOIN tp_usage tp ON tp.tag_id = t.tag_id
               LEFT JOIN user_usage uu ON uu.tag_id = t.tag_id
               LEFT JOIN domains d ON d.domain_id = t.domain_id
               ORDER BY total_usage DESC
               LIMIT 20"""
        )

        # Top domaines : SpotYou + utilisateurs (via leurs tags)
        top_domains_rows = await conn.fetch(
            """WITH safe_users AS (
                 SELECT user_id, coach_tags FROM users
                 WHERE coach_tags IS NOT NULL AND jsonb_typeof(coach_tags) = 'array'
               ),
               tp_dom AS (
                 SELECT domain_id, COUNT(*) AS tp_count
                 FROM tag_points WHERE domain_id IS NOT NULL
                 GROUP BY domain_id
               ),
               user_dom AS (
                 SELECT t.domain_id, COUNT(DISTINCT su.user_id) AS u_count
                 FROM safe_users su
                 CROSS JOIN LATERAL jsonb_array_elements_text(su.coach_tags) AS tid
                 JOIN tags t ON t.tag_id = tid
                 WHERE t.domain_id IS NOT NULL
                 GROUP BY t.domain_id
               )
               SELECT d.domain_id, d.name, d.label_fr, d.label_en, d.color, d.icon,
                      COALESCE(td.tp_count, 0) AS tagpoint_count,
                      COALESCE(ud.u_count, 0) AS user_count,
                      COALESCE(td.tp_count, 0) + COALESCE(ud.u_count, 0) AS total_usage
               FROM domains d
               LEFT JOIN tp_dom td ON td.domain_id = d.domain_id
               LEFT JOIN user_dom ud ON ud.domain_id = d.domain_id
               ORDER BY total_usage DESC"""
        )

        # Totaux globaux
        total_tags = await conn.fetchval("SELECT COUNT(*) FROM tags WHERE active = TRUE")
        total_domains = await conn.fetchval("SELECT COUNT(*) FROM domains WHERE active = TRUE")
        total_categories = await conn.fetchval("SELECT COUNT(*) FROM tag_categories WHERE active = TRUE")
        total_tag_usages = await conn.fetchval(
            "SELECT COALESCE(SUM(jsonb_array_length(tag_ids)), 0) FROM tag_points WHERE tag_ids IS NOT NULL AND jsonb_typeof(tag_ids) = 'array'"
        )

    return {
        "top_tags": rows_to_list(top_tags_rows),
        "top_domains": rows_to_list(top_domains_rows),
        "totals": {
            "tags": int(total_tags),
            "domains": int(total_domains),
            "categories": int(total_categories),
            "tag_usages": int(total_tag_usages),
        }
    }


# ── Listes complètes pour l'admin (avec éléments inactifs) ────────────────────

@router.get("/all-domains")
async def admin_all_domains(request: Request):
    pool = get_pool()
    await require_role(request, pool, "admin")
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM domains ORDER BY active DESC, name")
    return rows_to_list(rows)


@router.get("/all-categories")
async def admin_all_categories(request: Request):
    pool = get_pool()
    await require_role(request, pool, "admin")
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT tc.*, d.name AS domain_name, d.color AS domain_color
               FROM tag_categories tc
               LEFT JOIN domains d ON d.domain_id = tc.domain_id
               ORDER BY tc.active DESC, tc.name"""
        )
    return rows_to_list(rows)


@router.get("/all-tags")
async def admin_all_tags(request: Request):
    pool = get_pool()
    await require_role(request, pool, "admin")
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT t.*, d.name AS domain_name, d.color AS domain_color,
                      c.name AS category_name
               FROM tags t
               LEFT JOIN domains d ON d.domain_id = t.domain_id
               LEFT JOIN tag_categories c ON c.category_id = t.category_id
               ORDER BY t.active DESC, t.name"""
        )
    return rows_to_list(rows)


# ── Configuration globale de l'application ─────────────────────────────────────

async def _get_booking_flags(conn) -> dict:
    """Retourne les flags de configuration booking sous forme de dict."""
    rows = await conn.fetch(
        """SELECT config_key, config_value FROM app_config
           WHERE config_key IN ('enable_manual_approval_for_services', 'enable_pay_later_for_services', 'pay_now_checkout_minutes')"""
    )
    cfg = {r["config_key"]: r["config_value"] for r in rows}
    return {
        "enable_manual_approval_for_services": cfg.get("enable_manual_approval_for_services", "false") == "true",
        "enable_pay_later_for_services":       cfg.get("enable_pay_later_for_services", "false") == "true",
        "pay_now_checkout_minutes":            int(cfg.get("pay_now_checkout_minutes", "30")),
    }


@router.get("/app-config")
async def get_app_config(request: Request):
    """Retourne la configuration globale de l'application (admin seulement)."""
    pool = get_pool()
    await require_role(request, pool, "admin")
    async with pool.acquire() as conn:
        return await _get_booking_flags(conn)


# ── Purge différée des fichiers R2 orphelins ──────────────────────────────────

@router.post("/purge")
async def trigger_purge(
    request: Request,
    dry_run: bool       = Query(default=True,  description="Simuler sans supprimer (défaut: true)"),
    retention_days: int = Query(default=30,    ge=1,  le=365, description="Jours de rétention avant purge"),
    batch_size: int     = Query(default=100,   ge=1,  le=500, description="Nombre max de fichiers par run"),
    retry_failed: bool  = Query(default=False, description="Re-tenter les entrées en status=failed"),
):
    """
    Déclenche un cycle de purge des fichiers R2 orphelins (pending_file_deletions).

    - **dry_run=true** (défaut) : lecture seule, retourne ce qui SERAIT supprimé.
    - **dry_run=false** : exécute la suppression réelle.
    - Seuls les fichiers planifiés il y a > `retention_days` jours sont traités.
    - Un échec individuel n'arrête pas le batch (robustesse partielle).
    - Idempotent : peut être relancé sans danger.

    Retourne :
      - `scanned`   : entrées lues
      - `eligible`  : entrées dont scheduled_at >= seuil de rétention
      - `deleted`   : fichiers supprimés avec succès (ou déjà absents)
      - `failed`    : erreurs irrécupérables
      - `skipped`   : ignorés (URL vide, déjà en traitement)
      - `dry_run`   : booléen du mode
      - `details`   : liste des entrées traitées (max batch_size)
    """
    pool = get_pool()
    await require_role(request, pool, "admin")

    import sys
    import os
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from admin_purge_worker import run_purge

    result = await run_purge(
        pool,
        dry_run=dry_run,
        retention_days=retention_days,
        batch_size=batch_size,
        retry_failed=retry_failed,
    )
    return result


@router.get("/purge/status")
async def purge_status(request: Request):
    """
    Retourne un résumé des entrées pending_file_deletions par statut.
    Permet de surveiller la file de purge sans déclencher de traitement.
    """
    pool = get_pool()
    await require_role(request, pool, "admin")
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT status,
                      COUNT(*)                              AS count,
                      MIN(scheduled_at)                    AS oldest,
                      MAX(scheduled_at)                    AS newest,
                      SUM(attempt_count)                   AS total_attempts,
                      COUNT(*) FILTER (WHERE processed_at IS NOT NULL) AS processed
               FROM pending_file_deletions
               GROUP BY status
               ORDER BY status"""
        )
        total = await conn.fetchval("SELECT COUNT(*) FROM pending_file_deletions")
        pending = await conn.fetchval(
            "SELECT COUNT(*) FROM pending_file_deletions WHERE status='pending'"
        )
        oldest_pending = await conn.fetchval(
            "SELECT MIN(scheduled_at) FROM pending_file_deletions WHERE status='pending'"
        )
    return {
        "total":           int(total),
        "pending":         int(pending),
        "oldest_pending":  oldest_pending.isoformat() if oldest_pending else None,
        "by_status":       [
            {
                "status":          r["status"],
                "count":           int(r["count"]),
                "oldest":          r["oldest"].isoformat() if r["oldest"] else None,
                "newest":          r["newest"].isoformat() if r["newest"] else None,
                "total_attempts":  int(r["total_attempts"]) if r["total_attempts"] else 0,
            }
            for r in rows
        ],
    }


@router.put("/app-config")
async def update_app_config(request: Request):
    """Met à jour un ou plusieurs flags de configuration (admin seulement)."""
    pool = get_pool()
    await require_role(request, pool, "admin")
    body = await request.json()
    allowed_keys = {"enable_manual_approval_for_services", "enable_pay_later_for_services", "pay_now_checkout_minutes"}
    updates = {k: v for k, v in body.items() if k in allowed_keys}
    if not updates:
        raise HTTPException(400, "Aucune clé valide fournie")
    async with pool.acquire() as conn:
        for key, value in updates.items():
            str_value = str(value) if key == "pay_now_checkout_minutes" else ("true" if value else "false")
            await conn.execute(
                """INSERT INTO app_config (config_key, config_value, updated_at)
                   VALUES ($1, $2, NOW())
                   ON CONFLICT (config_key) DO UPDATE SET config_value=$2, updated_at=NOW()""",
                key, str_value,
            )
    return {"success": True, **{k: v for k, v in updates.items()}}
