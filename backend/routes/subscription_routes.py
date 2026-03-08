"""
subscription_routes.py — Abonnements payants SpotU (Stripe Subscriptions)
==========================================================================
Architecture :
  - Endpoints utilisateur : lister plans, souscrire, annuler, consulter état
  - Flow souscription : Stripe Checkout redirect (mode='subscription')
  - Gestion plan → Stripe : Product + Price créés à la première souscription
  - Webhook : handle_subscription_event() exporté, appelé depuis payment_routes

Règles métier :
  - Un seul abonnement actif par utilisateur (pas de double abonnement)
  - Annulation par défaut à la fin de la période (at_period_end=True)
  - Plan désactivé côté admin → abonnements existants préservés (pas de coupure)
  - Les bénéfices (exemptions de frais) sont calculés dans pricing_engine.py
  - Le snapshot des bénéfices est stocké à la souscription pour audit

États d'abonnement :
  'active'      — abonnement en cours, bénéfices actifs
  'cancelling'  — annulation programmée pour la fin de période
  'cancelled'   — annulation effective
  'past_due'    — paiement échoué, abonnement suspendu
  'trialing'    — période d'essai (extensible)
"""

import json
import logging
from datetime import datetime, timezone

import stripe
from fastapi import APIRouter, Request, HTTPException
from auth_utils import require_auth, require_role
from database import get_pool, row_to_dict, rows_to_list
from models import new_id
import stripe_service

log = logging.getLogger("routes.subscriptions")
router = APIRouter()


# ── Helpers internes ───────────────────────────────────────────────────────────

def _plan_to_dict(row) -> dict:
    """Convertit une ligne subscription_plans en dict sérialisable."""
    d = row_to_dict(row)
    # Masquer les IDs Stripe internes côté API publique
    d.pop("stripe_product_id", None)
    d.pop("stripe_price_id", None)
    return d


def _sub_to_dict(row) -> dict:
    """Convertit une ligne user_subscriptions en dict, désérialise le snapshot."""
    d = row_to_dict(row)
    if d.get("benefits_snapshot") and isinstance(d["benefits_snapshot"], str):
        d["benefits_snapshot"] = json.loads(d["benefits_snapshot"])
    return d


async def _get_or_create_stripe_price(conn, plan: dict) -> tuple[str, str]:
    """
    Garantit l'existence d'un Product + Price Stripe pour le plan donné.

    - Si stripe_price_id est déjà stocké en DB, le retourne directement.
    - Sinon, crée les objets Stripe et met à jour la DB.

    Returns: (stripe_product_id, stripe_price_id)
    """
    plan_id = plan["plan_id"]

    if plan.get("stripe_price_id"):
        return plan["stripe_product_id"], plan["stripe_price_id"]

    # Validation de l'intervalle avant d'appeler Stripe
    duration_days = plan.get("duration_days")
    if not duration_days:
        raise HTTPException(
            status_code=400,
            detail="Ce plan n'a pas de durée configurée (duration_days=null).",
        )
    # Lèvera ValueError si duration non supportée (30 ou 365)
    try:
        stripe_service._duration_to_interval(duration_days)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    amount_cents = int(round(float(plan["price"]) * 100))
    if amount_cents <= 0:
        raise HTTPException(
            status_code=400,
            detail="Le montant du plan doit être supérieur à 0.",
        )

    product_id, price_id = await stripe_service.ensure_subscription_price(
        plan_id=plan_id,
        plan_name=plan["name"],
        description=plan.get("description"),
        amount_cents=amount_cents,
        currency=plan.get("currency", "EUR"),
        duration_days=duration_days,
    )

    await conn.execute(
        """UPDATE subscription_plans
           SET stripe_product_id = $1, stripe_price_id = $2, updated_at = NOW()
           WHERE plan_id = $3""",
        product_id, price_id, plan_id,
    )
    log.info("Plan Stripe synchronisé : plan=%s | product=%s | price=%s", plan_id, product_id, price_id)
    return product_id, price_id


def _build_benefits_snapshot(plan: dict) -> dict:
    """
    Construit le snapshot des bénéfices à stocker dans user_subscriptions.
    Capture l'état des flags au moment de la souscription.
    """
    return {
        "plan_id":                plan["plan_id"],
        "plan_name":              plan["name"],
        "exempt_payer_fixed":     plan.get("exempt_payer_fixed", False),
        "exempt_payer_percent":   plan.get("exempt_payer_percent", False),
        "exempt_receiver_fixed":  plan.get("exempt_receiver_fixed", False),
        "exempt_receiver_percent": plan.get("exempt_receiver_percent", False),
        "snapshotted_at":         datetime.now(timezone.utc).isoformat(),
    }


# ── Plans ──────────────────────────────────────────────────────────────────────

@router.get("/subscription-plans")
async def list_subscription_plans(request: Request):
    """
    Retourne les plans d'abonnement actifs.
    Public (pas d'authentification requise) pour affichage sur la page tarifaire.
    Les IDs Stripe internes sont masqués.
    """
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT plan_id, name, description, price, duration_days,
                      exempt_payer_fixed, exempt_payer_percent,
                      exempt_receiver_fixed, exempt_receiver_percent,
                      active, priority, created_at, updated_at
               FROM subscription_plans
               WHERE active = TRUE
               ORDER BY priority DESC, price ASC"""
        )
    return [row_to_dict(r) for r in rows]


@router.get("/admin/subscription-plans")
async def admin_list_plans(request: Request):
    """Liste tous les plans (actifs + inactifs) — admin uniquement."""
    pool = get_pool()
    await require_role(request, pool, "admin")
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT * FROM subscription_plans ORDER BY priority DESC, created_at DESC"
        )
    return [row_to_dict(r) for r in rows]


# ── Abonnement utilisateur ─────────────────────────────────────────────────────

@router.get("/subscriptions/me")
async def get_my_subscription(request: Request):
    """
    Retourne l'abonnement actif ou en cours d'annulation de l'utilisateur.
    Inclut les bénéfices du plan et le snapshot stocké.
    """
    pool = get_pool()
    user = await require_auth(request, pool)
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """SELECT us.*,
                      sp.name        AS plan_name,
                      sp.description AS plan_description,
                      sp.price       AS plan_price,
                      sp.duration_days,
                      sp.exempt_payer_fixed,
                      sp.exempt_payer_percent,
                      sp.exempt_receiver_fixed,
                      sp.exempt_receiver_percent
               FROM user_subscriptions us
               JOIN subscription_plans sp ON sp.plan_id = us.plan_id
               WHERE us.user_id = $1
                 AND us.status IN ('active', 'cancelling', 'past_due', 'trialing')
               ORDER BY us.started_at DESC
               LIMIT 1""",
            user["user_id"],
        )
    if not row:
        return {"has_subscription": False, "subscription": None}

    d = _sub_to_dict(row)
    return {"has_subscription": True, "subscription": d}


@router.get("/subscriptions/history")
async def get_subscription_history(request: Request):
    """Historique complet des abonnements de l'utilisateur."""
    pool = get_pool()
    user = await require_auth(request, pool)
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT us.*,
                      sp.name AS plan_name, sp.price AS plan_price
               FROM user_subscriptions us
               JOIN subscription_plans sp ON sp.plan_id = us.plan_id
               WHERE us.user_id = $1
               ORDER BY us.created_at DESC""",
            user["user_id"],
        )
    return [_sub_to_dict(r) for r in rows]


@router.post("/subscriptions/subscribe")
async def subscribe(request: Request):
    """
    Lance le flow de souscription via Stripe Checkout.

    Body: { plan_id: str, origin_url: str }

    Retourne: { url: str, session_id: str }

    Flow :
      1. Vérifie que le plan est actif
      2. Vérifie qu'aucun abonnement actif n'existe déjà (idempotence)
      3. Crée / récupère le Product + Price Stripe pour le plan
      4. Crée / récupère le Customer Stripe pour l'utilisateur
      5. Crée une Checkout Session (mode='subscription')
      6. Retourne l'URL de redirect vers Stripe
    """
    pool = get_pool()
    user = await require_auth(request, pool)
    body = await request.json()
    plan_id    = body.get("plan_id")
    origin_url = body.get("origin_url", "").rstrip("/")

    if not plan_id:
        raise HTTPException(status_code=400, detail="plan_id requis")

    async with pool.acquire() as conn:
        # 1. Charger le plan (actif ou non — on vérifie séparément)
        plan_row = await conn.fetchrow(
            "SELECT * FROM subscription_plans WHERE plan_id = $1",
            plan_id,
        )
        if not plan_row:
            raise HTTPException(status_code=404, detail="Plan introuvable")

        plan = row_to_dict(plan_row)
        if not plan.get("active"):
            raise HTTPException(
                status_code=400,
                detail="Ce plan n'est plus disponible à la souscription.",
            )

        # 2. Vérifier doublon actif
        existing = await conn.fetchrow(
            """SELECT subscription_id, status FROM user_subscriptions
               WHERE user_id = $1
                 AND status IN ('active', 'cancelling', 'trialing')
               LIMIT 1""",
            user["user_id"],
        )
        if existing:
            d = dict(existing)
            raise HTTPException(
                status_code=409,
                detail=f"Vous avez déjà un abonnement {d['status']} (id={d['subscription_id']}). "
                       f"Annulez-le d'abord via POST /api/subscriptions/cancel.",
            )

        # 3. Garantir Product + Price Stripe
        _, price_id = await _get_or_create_stripe_price(conn, plan)

    # 4. Customer Stripe (hors transaction pour ne pas bloquer)
    customer_id = await stripe_service.get_or_create_customer(
        user_id=user["user_id"],
        email=user.get("email", ""),
        name=user.get("name", ""),
    )

    # Stocker le customer_id si nécessaire
    async with pool.acquire() as conn2:
        await conn2.execute(
            "UPDATE users SET stripe_customer_id = $1 WHERE user_id = $2 AND stripe_customer_id IS NULL",
            customer_id, user["user_id"],
        )

    # 5. Créer la Checkout Session
    success_url = f"{origin_url}/subscription-success?session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url  = f"{origin_url}/subscription-plans"
    meta = {
        "plan_id":    plan_id,
        "user_id":    user["user_id"],
        "product_type": "subscription",
    }

    session = await stripe_service.create_subscription_checkout_session(
        customer_id=customer_id,
        price_id=price_id,
        success_url=success_url,
        cancel_url=cancel_url,
        metadata=meta,
        idempotency_key=f"{user['user_id']}_{plan_id}",
    )

    log.info(
        "Checkout abonnement créée : user=%s | plan=%s | cs=%s",
        user["user_id"], plan_id, session.id,
    )

    return {
        "url":        session.url,
        "session_id": session.id,
        "plan_id":    plan_id,
    }


@router.post("/subscriptions/cancel")
async def cancel_subscription(request: Request):
    """
    Annule l'abonnement actif de l'utilisateur.

    Body (optionnel): { immediate: bool }  — défaut False (fin de période)
    Seul un admin peut forcer immediate=True.

    Après annulation à la fin de période :
      - status → 'cancelling'
      - Les bénéfices restent actifs jusqu'à expires_at
    """
    pool = get_pool()
    user = await require_auth(request, pool)
    body = {}
    try:
        body = await request.json()
    except Exception:
        pass
    immediate = body.get("immediate", False)

    # Seul un admin peut faire une annulation immédiate
    if immediate and user.get("role") != "admin":
        raise HTTPException(
            status_code=403,
            detail="L'annulation immédiate est réservée aux administrateurs.",
        )

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """SELECT subscription_id, stripe_subscription_id, status
               FROM user_subscriptions
               WHERE user_id = $1
                 AND status IN ('active', 'cancelling', 'trialing')
               ORDER BY started_at DESC
               LIMIT 1""",
            user["user_id"],
        )
    if not row:
        raise HTTPException(status_code=404, detail="Aucun abonnement actif à annuler")

    sub = dict(row)
    new_status = "cancelled" if immediate else "cancelling"

    # Annulation Stripe (hors transaction)
    if sub.get("stripe_subscription_id"):
        try:
            await stripe_service.cancel_subscription(
                sub["stripe_subscription_id"],
                at_period_end=not immediate,
            )
            log.info(
                "Abonnement Stripe annulé : sub_id=%s | immediate=%s",
                sub["stripe_subscription_id"], immediate,
            )
        except Exception as exc:
            log.error("Erreur annulation Stripe sub=%s : %s", sub["stripe_subscription_id"], exc)

    # Mise à jour DB
    async with pool.acquire() as conn:
        await conn.execute(
            """UPDATE user_subscriptions
               SET status = $1, cancelled_at = NOW(), updated_at = NOW()
               WHERE subscription_id = $2""",
            new_status, sub["subscription_id"],
        )

    return {
        "success":         True,
        "subscription_id": sub["subscription_id"],
        "status":          new_status,
        "message": (
            "Abonnement annulé immédiatement." if immediate
            else "Abonnement annulé à la fin de la période en cours. "
                 "Vous conservez vos avantages jusqu'à l'expiration."
        ),
    }


@router.get("/subscriptions/checkout/status/{session_id}")
async def get_subscription_checkout_status(session_id: str, request: Request):
    """
    Vérifie le statut d'une Checkout Session abonnement.
    Utilisé pour le polling frontend après redirection depuis Stripe.
    """
    pool = get_pool()
    user = await require_auth(request, pool)

    try:
        session = await stripe_service.retrieve_checkout_session(session_id)
    except Exception as exc:
        raise HTTPException(status_code=404, detail=f"Session introuvable : {exc}")

    # Vérifier que la session appartient au bon customer
    async with pool.acquire() as conn:
        user_row = await conn.fetchrow(
            "SELECT stripe_customer_id FROM users WHERE user_id = $1",
            user["user_id"],
        )
    customer_id = user_row["stripe_customer_id"] if user_row else None
    if customer_id and session.customer != customer_id and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Accès refusé")

    # Chercher l'abonnement local créé par webhook
    async with pool.acquire() as conn:
        sub_row = None
        stripe_sub_id = (
            session.subscription if isinstance(session.subscription, str) else None
        )
        if stripe_sub_id:
            sub_row = await conn.fetchrow(
                "SELECT subscription_id, status FROM user_subscriptions WHERE stripe_subscription_id = $1",
                stripe_sub_id,
            )

    return {
        "session_id":          session_id,
        "session_status":      session.status,
        "subscription_status": getattr(session, "status", None),
        "stripe_sub_id":       stripe_sub_id,
        "local_sub_id":        sub_row["subscription_id"] if sub_row else None,
        "local_status":        sub_row["status"] if sub_row else None,
        "metadata":            dict(session.metadata) if session.metadata else {},
    }


# ── Admin ──────────────────────────────────────────────────────────────────────

@router.get("/admin/subscriptions")
async def admin_list_subscriptions(request: Request):
    """Liste tous les abonnements utilisateurs — admin uniquement."""
    pool = get_pool()
    await require_role(request, pool, "admin")
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT us.*,
                      u.name AS user_name, u.email,
                      sp.name AS plan_name, sp.price AS plan_price
               FROM user_subscriptions us
               LEFT JOIN users u              ON u.user_id   = us.user_id
               LEFT JOIN subscription_plans sp ON sp.plan_id = us.plan_id
               ORDER BY us.created_at DESC
               LIMIT 500"""
        )
    return [_sub_to_dict(r) for r in rows]


@router.post("/admin/subscriptions/{subscription_id}/cancel")
async def admin_cancel_subscription(subscription_id: str, request: Request):
    """Annulation admin (peut être immédiate)."""
    pool = get_pool()
    await require_role(request, pool, "admin")
    body = {}
    try:
        body = await request.json()
    except Exception:
        pass
    immediate = body.get("immediate", False)

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM user_subscriptions WHERE subscription_id = $1",
            subscription_id,
        )
    if not row:
        raise HTTPException(status_code=404, detail="Abonnement introuvable")

    sub = row_to_dict(row)
    new_status = "cancelled" if immediate else "cancelling"

    if sub.get("stripe_subscription_id"):
        try:
            await stripe_service.cancel_subscription(
                sub["stripe_subscription_id"],
                at_period_end=not immediate,
            )
        except Exception as exc:
            log.error("Admin cancel Stripe error: %s", exc)

    async with pool.acquire() as conn:
        await conn.execute(
            """UPDATE user_subscriptions
               SET status = $1, cancelled_at = NOW(), updated_at = NOW()
               WHERE subscription_id = $2""",
            new_status, subscription_id,
        )
    return {"success": True, "status": new_status}


# ── Webhook handler (exporté pour dispatch depuis payment_routes) ──────────────

async def handle_subscription_event(pool, event_type: str, obj: dict | object) -> None:
    """
    Traite les événements Stripe liés aux abonnements.

    Appelé depuis le webhook unifié /api/webhook/stripe de payment_routes.py.
    Les events transactionnels (payment_intent.*, checkout.session.* mode=payment)
    restent gérés dans payment_routes.py.

    Événements gérés :
      customer.subscription.created     → activer l'abonnement en DB
      customer.subscription.updated     → mettre à jour statut (cancel_at_period_end, etc.)
      customer.subscription.deleted     → désactiver l'abonnement
      invoice.paid                      → renouvellement : mettre à jour expires_at
      invoice.payment_failed            → passer en past_due
      checkout.session.completed (subscription) → activer depuis la session
    """

    def _get(o, key, default=None):
        return o.get(key, default) if isinstance(o, dict) else getattr(o, key, default)

    async with pool.acquire() as conn:

        # ── checkout.session.completed (mode subscription) ─────────────────────
        if event_type == "checkout.session.completed":
            mode = _get(obj, "mode", "")
            if mode != "subscription":
                return  # payment mode → géré dans payment_routes.py

            meta         = _get(obj, "metadata", {}) or {}
            plan_id      = _get(meta, "plan_id") if isinstance(meta, dict) else None
            user_id      = _get(meta, "user_id") if isinstance(meta, dict) else None
            stripe_sub_id = _get(obj, "subscription")

            if not plan_id or not user_id or not stripe_sub_id:
                log.warning("checkout.session.completed subscription: données incomplètes — meta=%s", meta)
                return

            # Récupérer le plan pour le snapshot
            plan_row = await conn.fetchrow(
                "SELECT * FROM subscription_plans WHERE plan_id = $1", plan_id
            )
            if not plan_row:
                log.warning("Plan %s introuvable pour abonnement webhook", plan_id)
                return

            plan     = row_to_dict(plan_row)
            benefits = _build_benefits_snapshot(plan)

            # Récupérer les dates depuis Stripe si possible
            expires_at = None
            try:
                stripe_sub = await stripe_service.retrieve_subscription(stripe_sub_id)
                current_period_end = getattr(stripe_sub, "current_period_end", None)
                if current_period_end:
                    expires_at = datetime.fromtimestamp(current_period_end, tz=timezone.utc)
            except Exception as exc:
                log.warning("Impossible de récupérer la subscription Stripe %s : %s", stripe_sub_id, exc)

            # Idempotence : ne pas créer si déjà existant
            existing = await conn.fetchrow(
                "SELECT subscription_id FROM user_subscriptions WHERE stripe_subscription_id = $1",
                stripe_sub_id,
            )
            if existing:
                log.info(
                    "Abonnement %s déjà enregistré — webhook ignoré",
                    existing["subscription_id"],
                )
                return

            sub_id = new_id("sub")
            await conn.execute(
                """INSERT INTO user_subscriptions
                   (subscription_id, user_id, plan_id, status,
                    started_at, expires_at, stripe_subscription_id,
                    benefits_snapshot, updated_at)
                   VALUES ($1,$2,$3,'active',NOW(),$4,$5,$6,NOW())""",
                sub_id, user_id, plan_id,
                expires_at, stripe_sub_id,
                json.dumps(benefits),
            )
            log.info(
                "Abonnement activé via webhook : sub=%s | user=%s | plan=%s",
                sub_id, user_id, plan_id,
            )

        # ── customer.subscription.created ─────────────────────────────────────
        elif event_type == "customer.subscription.created":
            # Géré principalement via checkout.session.completed
            # Ici on gère uniquement si PAS encore en DB (souscription API directe)
            stripe_sub_id = _get(obj, "id")
            meta          = _get(obj, "metadata", {}) or {}
            plan_id       = _get(meta, "plan_id") if isinstance(meta, dict) else None
            user_id       = _get(meta, "user_id") if isinstance(meta, dict) else None

            if not plan_id or not user_id:
                return  # Pas assez d'info (e.g. souscription depuis Dashboard Stripe)

            existing = await conn.fetchrow(
                "SELECT subscription_id FROM user_subscriptions WHERE stripe_subscription_id = $1",
                stripe_sub_id,
            )
            if existing:
                return  # Déjà traité via checkout.session.completed

            plan_row = await conn.fetchrow(
                "SELECT * FROM subscription_plans WHERE plan_id = $1", plan_id
            )
            if not plan_row:
                return

            plan     = row_to_dict(plan_row)
            benefits = _build_benefits_snapshot(plan)
            period_end = _get(obj, "current_period_end")
            expires_at = (
                datetime.fromtimestamp(period_end, tz=timezone.utc)
                if period_end else None
            )

            sub_id = new_id("sub")
            await conn.execute(
                """INSERT INTO user_subscriptions
                   (subscription_id, user_id, plan_id, status,
                    started_at, expires_at, stripe_subscription_id,
                    benefits_snapshot, updated_at)
                   VALUES ($1,$2,$3,'active',NOW(),$4,$5,$6,NOW())""",
                sub_id, user_id, plan_id,
                expires_at, stripe_sub_id,
                json.dumps(benefits),
            )
            log.info("Abonnement créé via webhook sub.created: %s", sub_id)

        # ── customer.subscription.updated ─────────────────────────────────────
        elif event_type == "customer.subscription.updated":
            stripe_sub_id   = _get(obj, "id")
            stripe_status   = _get(obj, "status", "")
            cancel_at_period_end = _get(obj, "cancel_at_period_end", False)
            period_end      = _get(obj, "current_period_end")
            expires_at = (
                datetime.fromtimestamp(period_end, tz=timezone.utc)
                if period_end else None
            )

            # Mapping statut Stripe → statut interne
            if stripe_status == "active" and cancel_at_period_end:
                new_status = "cancelling"
            elif stripe_status == "active":
                new_status = "active"
            elif stripe_status in ("canceled", "cancelled"):
                new_status = "cancelled"
            elif stripe_status == "past_due":
                new_status = "past_due"
            elif stripe_status == "trialing":
                new_status = "trialing"
            else:
                new_status = stripe_status  # passthrough pour nouveaux statuts Stripe

            update_fields = "status=$1, updated_at=NOW()"
            params = [new_status]

            if expires_at:
                update_fields += ", expires_at=$2"
                params.append(expires_at)
                params.append(stripe_sub_id)
                await conn.execute(
                    f"UPDATE user_subscriptions SET {update_fields} WHERE stripe_subscription_id=$3",
                    *params,
                )
            else:
                params.append(stripe_sub_id)
                await conn.execute(
                    f"UPDATE user_subscriptions SET {update_fields} WHERE stripe_subscription_id=$2",
                    *params,
                )

            log.info(
                "Abonnement mis à jour : stripe=%s | status=%s | cancel_at_period_end=%s",
                stripe_sub_id, new_status, cancel_at_period_end,
            )

        # ── customer.subscription.deleted ─────────────────────────────────────
        elif event_type == "customer.subscription.deleted":
            stripe_sub_id = _get(obj, "id")
            await conn.execute(
                """UPDATE user_subscriptions
                   SET status='cancelled', cancelled_at=NOW(), updated_at=NOW()
                   WHERE stripe_subscription_id=$1""",
                stripe_sub_id,
            )
            log.info("Abonnement désactivé (supprimé Stripe) : %s", stripe_sub_id)

        # ── invoice.paid → renouvellement ──────────────────────────────────────
        elif event_type == "invoice.paid":
            stripe_sub_id = _get(obj, "subscription")
            if not stripe_sub_id:
                return
            # Récupérer la nouvelle période depuis Stripe (l'invoice contient lines)
            lines     = _get(obj, "lines", {})
            data      = lines.get("data", []) if isinstance(lines, dict) else []
            period    = data[0].get("period", {}) if data else {}
            period_end = period.get("end")

            if period_end:
                expires_at = datetime.fromtimestamp(period_end, tz=timezone.utc)
                await conn.execute(
                    """UPDATE user_subscriptions
                       SET expires_at=$1, status='active', updated_at=NOW()
                       WHERE stripe_subscription_id=$2
                         AND status NOT IN ('cancelled')""",
                    expires_at, stripe_sub_id,
                )
                log.info(
                    "Renouvellement abonnement : stripe=%s | expires_at=%s",
                    stripe_sub_id, expires_at,
                )

        # ── invoice.payment_failed → paiement échoué ──────────────────────────
        elif event_type == "invoice.payment_failed":
            stripe_sub_id = _get(obj, "subscription")
            if stripe_sub_id:
                await conn.execute(
                    """UPDATE user_subscriptions
                       SET status='past_due', updated_at=NOW()
                       WHERE stripe_subscription_id=$1
                         AND status NOT IN ('cancelled')""",
                    stripe_sub_id,
                )
                log.warning("Paiement abonnement échoué : stripe_sub=%s", stripe_sub_id)
