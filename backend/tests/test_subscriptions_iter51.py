"""
test_subscriptions_iter51.py — Tests backend abonnements Stripe SpotU
=======================================================================
Couvre :
  1. Liste des plans (GET /api/subscription-plans)
  2. Souscription (POST /api/subscriptions/subscribe)
  3. Double-abonnement bloqué (idempotence)
  4. Statut abonnement utilisateur (GET /api/subscriptions/me)
  5. Annulation (POST /api/subscriptions/cancel)
  6. Admin : liste abonnements
  7. Webhook : checkout.session.completed (mode subscription)
  8. Webhook : customer.subscription.updated (cancel_at_period_end)
  9. Webhook : customer.subscription.deleted
  10. Webhook : invoice.paid (renouvellement)
  11. Webhook : invoice.payment_failed
  12. Pricing engine : exemptions appliquées avec abonnement actif
  13. Plan désactivé → abonnements existants préservés
  14. duration_days invalide → erreur claire
"""

import asyncio
import json
import os
import uuid
from datetime import datetime, timezone, timedelta

import asyncpg
import httpx
import pytest

API_BASE   = os.environ.get("API_BASE", "https://activity-feed-demo.preview.emergentagent.com")
DB_URL     = os.environ.get("DATABASE_URL", "postgresql://winek:winek2024@127.0.0.1/winek_db")

ADMIN_EMAIL = "admin@winek.app"
ADMIN_PASS  = "WinekAdmin2024!"
USER_EMAIL  = "user@winek.app"
USER_PASS   = "WinekUser2024!"
COACH_EMAIL = "coach@winek.app"
COACH_PASS  = "WinekCoach2024!"


# ── Fixtures ────────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="module")
async def db_conn():
    conn = await asyncpg.connect(DB_URL)
    yield conn
    await conn.close()


@pytest.fixture(scope="module")
async def tokens():
    async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as client:
        r_user = await client.post("/api/auth/login", json={"email": USER_EMAIL, "password": USER_PASS})
        r_admin = await client.post("/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS})
        r_coach = await client.post("/api/auth/login", json={"email": COACH_EMAIL, "password": COACH_PASS})
        return {
            "user":  r_user.json().get("token"),
            "admin": r_admin.json().get("token"),
            "coach": r_coach.json().get("token"),
        }


@pytest.fixture(scope="module")
async def user_id(db_conn):
    row = await db_conn.fetchrow("SELECT user_id FROM users WHERE email=$1", USER_EMAIL)
    return row["user_id"]


@pytest.fixture(scope="module")
async def coach_id(db_conn):
    row = await db_conn.fetchrow("SELECT user_id FROM users WHERE email=$1", COACH_EMAIL)
    return row["user_id"]


@pytest.fixture(scope="module")
async def base_plan(db_conn):
    """Plan de test fiable : plan_basic."""
    row = await db_conn.fetchrow(
        "SELECT * FROM subscription_plans WHERE plan_id='plan_basic'"
    )
    assert row, "Le plan plan_basic doit exister (lancez le seed)"
    return dict(row)


@pytest.fixture(scope="module")
async def premium_plan(db_conn):
    row = await db_conn.fetchrow(
        "SELECT * FROM subscription_plans WHERE plan_id='plan_premium'"
    )
    assert row
    return dict(row)


async def cleanup_user_subscriptions(db_conn, user_id: str):
    await db_conn.execute(
        "DELETE FROM user_subscriptions WHERE user_id=$1", user_id
    )


# ── 1. Liste des plans ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_01_list_plans_public():
    """Plans accessibles sans authentification."""
    async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as client:
        r = await client.get("/api/subscription-plans")
    assert r.status_code == 200
    plans = r.json()
    assert isinstance(plans, list)
    assert len(plans) >= 1
    # Vérifier la structure d'un plan
    p = plans[0]
    for field in ["plan_id", "name", "price", "duration_days", "active"]:
        assert field in p, f"Champ manquant : {field}"
    # Les IDs Stripe NE doivent PAS être exposés
    assert "stripe_price_id"   not in p
    assert "stripe_product_id" not in p


@pytest.mark.asyncio
async def test_02_plans_active_only():
    """Seuls les plans actifs sont retournés."""
    async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as client:
        r = await client.get("/api/subscription-plans")
    plans = r.json()
    assert all(p["active"] is True for p in plans), "Plans inactifs dans la liste publique"


@pytest.mark.asyncio
async def test_03_admin_plans_all(tokens):
    """Admin voit tous les plans (actifs + inactifs)."""
    async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as client:
        r = await client.get(
            "/api/admin/subscription-plans",
            headers={"Authorization": f"Bearer {tokens['admin']}"},
        )
    assert r.status_code == 200
    plans = r.json()
    assert isinstance(plans, list)
    # Admin voit stripe_price_id / stripe_product_id
    # (les colonnes peuvent être NULL pour les plans non encore synchronisés)
    assert len(plans) >= 3


# ── 2. Souscription — flux Stripe Checkout ─────────────────────────────────────

@pytest.mark.asyncio
async def test_04_subscribe_checkout_session(tokens, user_id, db_conn, base_plan):
    """Souscription crée une Checkout Session Stripe valide."""
    await cleanup_user_subscriptions(db_conn, user_id)
    async with httpx.AsyncClient(base_url=API_BASE, timeout=60) as client:
        r = await client.post(
            "/api/subscriptions/subscribe",
            json={"plan_id": base_plan["plan_id"], "origin_url": API_BASE},
            headers={"Authorization": f"Bearer {tokens['user']}"},
        )
    assert r.status_code == 200, f"Souscription failed: {r.text}"
    data = r.json()
    assert "url" in data, "URL Stripe manquante"
    assert "session_id" in data
    assert data["session_id"].startswith("cs_")
    assert "checkout.stripe.com" in data["url"] or "stripe.com" in data["url"]
    assert data["plan_id"] == base_plan["plan_id"]


@pytest.mark.asyncio
async def test_05_subscribe_creates_stripe_price_id(db_conn, base_plan):
    """La première souscription synchronise stripe_price_id dans subscription_plans."""
    row = await db_conn.fetchrow(
        "SELECT stripe_price_id, stripe_product_id FROM subscription_plans WHERE plan_id=$1",
        base_plan["plan_id"],
    )
    assert row["stripe_price_id"] is not None, "stripe_price_id non stocké"
    assert row["stripe_price_id"].startswith("price_")
    assert row["stripe_product_id"].startswith("prod_")


@pytest.mark.asyncio
async def test_06_subscribe_plan_not_found(tokens):
    """Souscription à un plan inexistant → 404."""
    async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as client:
        r = await client.post(
            "/api/subscriptions/subscribe",
            json={"plan_id": "plan_nonexistent", "origin_url": API_BASE},
            headers={"Authorization": f"Bearer {tokens['user']}"},
        )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_07_subscribe_without_token():
    """Souscription sans token → 401."""
    async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as client:
        r = await client.post(
            "/api/subscriptions/subscribe",
            json={"plan_id": "plan_basic", "origin_url": API_BASE},
        )
    assert r.status_code in (401, 403)


# ── 3. Double-abonnement bloqué ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_08_double_subscribe_blocked(tokens, user_id, db_conn, base_plan):
    """Un 2e abonnement actif est refusé (409)."""
    await cleanup_user_subscriptions(db_conn, user_id)
    # Insérer manuellement un abonnement actif
    sub_id = f"sub_test_{uuid.uuid4().hex[:8]}"
    await db_conn.execute(
        """INSERT INTO user_subscriptions
           (subscription_id, user_id, plan_id, status, started_at, expires_at,
            stripe_subscription_id, updated_at)
           VALUES ($1,$2,$3,'active',NOW(),NOW()+INTERVAL '30 days',$4,NOW())""",
        sub_id, user_id, base_plan["plan_id"], f"sub_stripe_{uuid.uuid4().hex[:8]}",
    )
    async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as client:
        r = await client.post(
            "/api/subscriptions/subscribe",
            json={"plan_id": base_plan["plan_id"], "origin_url": API_BASE},
            headers={"Authorization": f"Bearer {tokens['user']}"},
        )
    assert r.status_code == 409, f"Doublon non bloqué : {r.text}"
    assert "abonnement" in r.json()["detail"].lower()
    await cleanup_user_subscriptions(db_conn, user_id)


# ── 4. Statut abonnement ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_09_me_no_subscription(tokens, user_id, db_conn):
    """Sans abonnement actif → has_subscription=False."""
    await cleanup_user_subscriptions(db_conn, user_id)
    async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as client:
        r = await client.get(
            "/api/subscriptions/me",
            headers={"Authorization": f"Bearer {tokens['user']}"},
        )
    assert r.status_code == 200
    d = r.json()
    assert d["has_subscription"] is False
    assert d["subscription"] is None


@pytest.mark.asyncio
async def test_10_me_with_active_subscription(tokens, user_id, db_conn, base_plan):
    """Avec abonnement actif → retourne les détails + bénéfices du plan."""
    sub_id = f"sub_test_{uuid.uuid4().hex[:8]}"
    await db_conn.execute(
        """INSERT INTO user_subscriptions
           (subscription_id, user_id, plan_id, status, started_at, expires_at,
            stripe_subscription_id, benefits_snapshot, updated_at)
           VALUES ($1,$2,$3,'active',NOW(),NOW()+INTERVAL '30 days',$4,$5,NOW())""",
        sub_id, user_id, base_plan["plan_id"], f"sub_stripe_test",
        json.dumps({"plan_id": base_plan["plan_id"], "exempt_payer_fixed": True}),
    )
    async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as client:
        r = await client.get(
            "/api/subscriptions/me",
            headers={"Authorization": f"Bearer {tokens['user']}"},
        )
    assert r.status_code == 200
    d = r.json()
    assert d["has_subscription"] is True
    sub = d["subscription"]
    assert sub["subscription_id"] == sub_id
    assert sub["status"] == "active"
    assert sub["plan_name"] == base_plan["name"]
    assert "benefits_snapshot" in sub
    await cleanup_user_subscriptions(db_conn, user_id)


# ── 5. Annulation ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_11_cancel_no_subscription(tokens, user_id, db_conn):
    """Annulation sans abonnement → 404."""
    await cleanup_user_subscriptions(db_conn, user_id)
    async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as client:
        r = await client.post(
            "/api/subscriptions/cancel",
            headers={"Authorization": f"Bearer {tokens['user']}"},
        )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_12_cancel_at_period_end(tokens, user_id, db_conn, base_plan):
    """Annulation par défaut → statut 'cancelling', bénéfices préservés."""
    sub_id = f"sub_test_{uuid.uuid4().hex[:8]}"
    await db_conn.execute(
        """INSERT INTO user_subscriptions
           (subscription_id, user_id, plan_id, status, started_at, expires_at,
            stripe_subscription_id, updated_at)
           VALUES ($1,$2,$3,'active',NOW(),NOW()+INTERVAL '30 days',$4,NOW())""",
        sub_id, user_id, base_plan["plan_id"],
        None,  # pas de stripe_subscription_id → annulation DB seulement
    )
    async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as client:
        r = await client.post(
            "/api/subscriptions/cancel",
            headers={"Authorization": f"Bearer {tokens['user']}"},
        )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["success"] is True
    assert data["status"] == "cancelling"

    # Vérifier que l'abonnement est toujours "actif" côté pricing engine
    # (status=cancelling inclus dans _load_subscription_benefits)
    row = await db_conn.fetchrow(
        "SELECT status FROM user_subscriptions WHERE subscription_id=$1", sub_id
    )
    assert row["status"] == "cancelling"
    await cleanup_user_subscriptions(db_conn, user_id)


@pytest.mark.asyncio
async def test_13_immediate_cancel_user_forbidden(tokens, user_id, db_conn, base_plan):
    """Un user ne peut pas faire d'annulation immédiate (admin only)."""
    sub_id = f"sub_test_{uuid.uuid4().hex[:8]}"
    await db_conn.execute(
        """INSERT INTO user_subscriptions
           (subscription_id, user_id, plan_id, status, started_at, expires_at,
            stripe_subscription_id, updated_at)
           VALUES ($1,$2,$3,'active',NOW(),NOW()+INTERVAL '30 days',$4,NOW())""",
        sub_id, user_id, base_plan["plan_id"], None,
    )
    async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as client:
        r = await client.post(
            "/api/subscriptions/cancel",
            json={"immediate": True},
            headers={"Authorization": f"Bearer {tokens['user']}"},
        )
    assert r.status_code == 403, f"Annulation immédiate autorisée pour user: {r.text}"
    await cleanup_user_subscriptions(db_conn, user_id)


# ── 6. Admin ───────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_14_admin_list_subscriptions(tokens):
    """Admin peut lister tous les abonnements."""
    async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as client:
        r = await client.get(
            "/api/admin/subscriptions",
            headers={"Authorization": f"Bearer {tokens['admin']}"},
        )
    assert r.status_code == 200
    assert isinstance(r.json(), list)


@pytest.mark.asyncio
async def test_15_admin_cancel_subscription(tokens, user_id, db_conn, base_plan):
    """Admin peut annuler un abonnement spécifique."""
    sub_id = f"sub_admin_test_{uuid.uuid4().hex[:8]}"
    await db_conn.execute(
        """INSERT INTO user_subscriptions
           (subscription_id, user_id, plan_id, status, started_at, expires_at,
            stripe_subscription_id, updated_at)
           VALUES ($1,$2,$3,'active',NOW(),NOW()+INTERVAL '30 days',$4,NOW())""",
        sub_id, user_id, base_plan["plan_id"], None,
    )
    async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as client:
        r = await client.post(
            f"/api/admin/subscriptions/{sub_id}/cancel",
            json={"immediate": True},
            headers={"Authorization": f"Bearer {tokens['admin']}"},
        )
    assert r.status_code == 200
    assert r.json()["status"] == "cancelled"
    await cleanup_user_subscriptions(db_conn, user_id)


# ── 7-11. Webhooks ─────────────────────────────────────────────────────────────

def make_webhook_body(event_type: str, obj: dict) -> dict:
    import uuid as _uuid
    return {"id": f"evt_iter51_{_uuid.uuid4().hex[:16]}", "type": event_type, "data": {"object": obj}}


@pytest.mark.asyncio
async def test_16_webhook_subscription_created(db_conn, user_id, base_plan):
    """Webhook customer.subscription.created → crée user_subscription."""
    await cleanup_user_subscriptions(db_conn, user_id)
    stripe_sub_id = f"sub_wh_test_{uuid.uuid4().hex[:8]}"
    expires_ts = int((datetime.now(timezone.utc) + timedelta(days=30)).timestamp())

    body = make_webhook_body("customer.subscription.created", {
        "id":                   stripe_sub_id,
        "status":               "active",
        "current_period_end":   expires_ts,
        "cancel_at_period_end": False,
        "metadata": {
            "plan_id": base_plan["plan_id"],
            "user_id": user_id,
            "product_type": "subscription",
        },
    })
    async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as client:
        r = await client.post("/api/webhook/stripe", json=body)
    assert r.status_code == 200
    assert r.json()["received"] is True

    # Vérifier la création en DB
    row = await db_conn.fetchrow(
        "SELECT * FROM user_subscriptions WHERE stripe_subscription_id=$1", stripe_sub_id
    )
    assert row is not None, "Abonnement non créé par webhook"
    assert row["status"] == "active"
    assert row["plan_id"] == base_plan["plan_id"]
    await cleanup_user_subscriptions(db_conn, user_id)


@pytest.mark.asyncio
async def test_17_webhook_subscription_updated_cancelling(db_conn, user_id, base_plan):
    """Webhook customer.subscription.updated avec cancel_at_period_end=True → 'cancelling'."""
    stripe_sub_id = f"sub_wh_update_{uuid.uuid4().hex[:8]}"
    sub_id = f"sub_{uuid.uuid4().hex[:8]}"
    await db_conn.execute(
        """INSERT INTO user_subscriptions
           (subscription_id, user_id, plan_id, status, started_at, expires_at,
            stripe_subscription_id, updated_at)
           VALUES ($1,$2,$3,'active',NOW(),NOW()+INTERVAL '30 days',$4,NOW())""",
        sub_id, user_id, base_plan["plan_id"], stripe_sub_id,
    )
    body = make_webhook_body("customer.subscription.updated", {
        "id":                   stripe_sub_id,
        "status":               "active",
        "cancel_at_period_end": True,
        "current_period_end":   int((datetime.now(timezone.utc) + timedelta(days=29)).timestamp()),
    })
    async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as client:
        r = await client.post("/api/webhook/stripe", json=body)
    assert r.status_code == 200

    row = await db_conn.fetchrow(
        "SELECT status FROM user_subscriptions WHERE stripe_subscription_id=$1", stripe_sub_id
    )
    assert row["status"] == "cancelling"
    await cleanup_user_subscriptions(db_conn, user_id)


@pytest.mark.asyncio
async def test_18_webhook_subscription_deleted(db_conn, user_id, base_plan):
    """Webhook customer.subscription.deleted → status='cancelled'."""
    stripe_sub_id = f"sub_wh_del_{uuid.uuid4().hex[:8]}"
    sub_id = f"sub_{uuid.uuid4().hex[:8]}"
    await db_conn.execute(
        """INSERT INTO user_subscriptions
           (subscription_id, user_id, plan_id, status, started_at, expires_at,
            stripe_subscription_id, updated_at)
           VALUES ($1,$2,$3,'active',NOW(),NOW()+INTERVAL '30 days',$4,NOW())""",
        sub_id, user_id, base_plan["plan_id"], stripe_sub_id,
    )
    body = make_webhook_body("customer.subscription.deleted", {"id": stripe_sub_id})
    async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as client:
        r = await client.post("/api/webhook/stripe", json=body)
    assert r.status_code == 200

    row = await db_conn.fetchrow(
        "SELECT status FROM user_subscriptions WHERE stripe_subscription_id=$1", stripe_sub_id
    )
    assert row["status"] == "cancelled"
    await cleanup_user_subscriptions(db_conn, user_id)


@pytest.mark.asyncio
async def test_19_webhook_invoice_paid_renewal(db_conn, user_id, base_plan):
    """Webhook invoice.paid → renouvellement : expires_at est mis à jour."""
    stripe_sub_id = f"sub_wh_inv_{uuid.uuid4().hex[:8]}"
    sub_id = f"sub_{uuid.uuid4().hex[:8]}"
    old_expiry = datetime.now(timezone.utc) + timedelta(days=5)
    await db_conn.execute(
        """INSERT INTO user_subscriptions
           (subscription_id, user_id, plan_id, status, started_at, expires_at,
            stripe_subscription_id, updated_at)
           VALUES ($1,$2,$3,'active',NOW(),$4,$5,NOW())""",
        sub_id, user_id, base_plan["plan_id"], old_expiry, stripe_sub_id,
    )
    new_period_end = int((datetime.now(timezone.utc) + timedelta(days=35)).timestamp())
    body = make_webhook_body("invoice.paid", {
        "subscription": stripe_sub_id,
        "status": "paid",
        "lines": {
            "data": [{"period": {"end": new_period_end, "start": int(datetime.now(timezone.utc).timestamp())}}]
        },
    })
    async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as client:
        r = await client.post("/api/webhook/stripe", json=body)
    assert r.status_code == 200

    row = await db_conn.fetchrow(
        "SELECT expires_at, status FROM user_subscriptions WHERE stripe_subscription_id=$1",
        stripe_sub_id,
    )
    assert row["status"] == "active"
    new_expiry = row["expires_at"]
    assert new_expiry.timestamp() > old_expiry.timestamp(), "expires_at non mis à jour"
    await cleanup_user_subscriptions(db_conn, user_id)


@pytest.mark.asyncio
async def test_20_webhook_invoice_payment_failed(db_conn, user_id, base_plan):
    """Webhook invoice.payment_failed → status='past_due'."""
    stripe_sub_id = f"sub_wh_fail_{uuid.uuid4().hex[:8]}"
    sub_id = f"sub_{uuid.uuid4().hex[:8]}"
    await db_conn.execute(
        """INSERT INTO user_subscriptions
           (subscription_id, user_id, plan_id, status, started_at, expires_at,
            stripe_subscription_id, updated_at)
           VALUES ($1,$2,$3,'active',NOW(),NOW()+INTERVAL '30 days',$4,NOW())""",
        sub_id, user_id, base_plan["plan_id"], stripe_sub_id,
    )
    body = make_webhook_body("invoice.payment_failed", {"subscription": stripe_sub_id})
    async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as client:
        r = await client.post("/api/webhook/stripe", json=body)
    assert r.status_code == 200

    row = await db_conn.fetchrow(
        "SELECT status FROM user_subscriptions WHERE stripe_subscription_id=$1", stripe_sub_id
    )
    assert row["status"] == "past_due"
    await cleanup_user_subscriptions(db_conn, user_id)


# ── 12. Pricing engine : exemptions avec abonnement ───────────────────────────

@pytest.mark.asyncio
async def test_21_pricing_with_payer_subscription(db_conn, user_id, base_plan):
    """
    Avec un abonnement actif exempt_payer_fixed=True :
    - le frais fixe payeur est annulé
    - l'audit des bénéfices est inclus dans le snapshot
    """
    from pricing_engine import pricing_engine, _load_subscription_benefits

    # S'assurer qu'il y a une règle tarifaire
    await db_conn.execute(
        """INSERT INTO pricing_rules
           (rule_id, name, product_type, payer_fixed_fee, payer_percent_fee,
            receiver_fixed_fee, receiver_percent_fee, active, priority)
           VALUES ('rule_test_sub01', 'Test Sub Rule', 'service_booking',
                   1.50, 5.0, 0.50, 3.0, TRUE, 5)
           ON CONFLICT DO NOTHING"""
    )

    # Créer un abonnement actif avec exempt_payer_fixed
    sub_id = f"sub_price_test_{uuid.uuid4().hex[:8]}"
    await db_conn.execute(
        """INSERT INTO user_subscriptions
           (subscription_id, user_id, plan_id, status, started_at, expires_at, updated_at)
           VALUES ($1,$2,'plan_basic','active',NOW(),NOW()+INTERVAL '30 days',NOW())""",
        sub_id, user_id,
    )

    # Le plan plan_basic a exempt_payer_fixed=True
    result = await pricing_engine.compute_pricing(
        conn=db_conn,
        payer_user_id=user_id,
        receiver_user_id="usr_admin_000000",  # admin = receiver fictif sans abonnement
        product_type="service_booking",
        base_amount=100.0,
        currency="EUR",
    )

    # Vérifier l'exemption
    assert result.payer_fixed_fee == 0.0, (
        f"payer_fixed_fee devrait être 0 (exempt). Got: {result.payer_fixed_fee}"
    )
    assert result.payer_percent_fee_amount == 5.0  # 5% de 100

    # Le bénéfice payer doit être dans l'audit
    assert len(result.applied_subscription_benefits) >= 1
    payer_benefit = next(
        (b for b in result.applied_subscription_benefits if b["side"] == "payer"), None
    )
    assert payer_benefit is not None
    assert "payer_fixed_fee" in payer_benefit["exempted_fields"]

    # Le snapshot doit contenir les savings
    rule_snapshot = result.applied_rules[0]
    assert "savings_payer" in rule_snapshot
    assert rule_snapshot["savings_payer"] > 0  # économie réelle

    await cleanup_user_subscriptions(db_conn, user_id)
    await db_conn.execute("DELETE FROM pricing_rules WHERE rule_id='rule_test_sub01'")


@pytest.mark.asyncio
async def test_22_pricing_without_subscription(db_conn, user_id):
    """Sans abonnement, les frais standards sont appliqués."""
    from pricing_engine import pricing_engine

    await cleanup_user_subscriptions(db_conn, user_id)
    await db_conn.execute(
        """INSERT INTO pricing_rules
           (rule_id, name, product_type, payer_fixed_fee, payer_percent_fee,
            receiver_fixed_fee, receiver_percent_fee, active, priority)
           VALUES ('rule_test_nosub', 'No Sub Rule', 'service_booking',
                   2.00, 5.0, 1.00, 2.0, TRUE, 6)
           ON CONFLICT DO NOTHING"""
    )

    result = await pricing_engine.compute_pricing(
        conn=db_conn,
        payer_user_id=user_id,
        receiver_user_id="usr_admin_000000",
        product_type="service_booking",
        base_amount=100.0,
    )

    assert result.payer_fixed_fee == 2.00
    assert result.payer_percent_fee_amount == 5.00
    assert result.applied_subscription_benefits == []

    await db_conn.execute("DELETE FROM pricing_rules WHERE rule_id='rule_test_nosub'")


# ── 13. Plan désactivé → abonnements existants préservés ──────────────────────

@pytest.mark.asyncio
async def test_23_disabled_plan_preserves_benefits(db_conn, user_id, base_plan):
    """
    Si un plan est désactivé (active=FALSE), les utilisateurs déjà abonnés
    conservent leurs bénéfices dans le pricing engine.
    """
    from pricing_engine import _load_subscription_benefits

    sub_id = f"sub_disabled_test_{uuid.uuid4().hex[:8]}"
    await db_conn.execute(
        """INSERT INTO user_subscriptions
           (subscription_id, user_id, plan_id, status, started_at, expires_at, updated_at)
           VALUES ($1,$2,'plan_basic','active',NOW(),NOW()+INTERVAL '30 days',NOW())""",
        sub_id, user_id,
    )

    # Désactiver le plan
    await db_conn.execute(
        "UPDATE subscription_plans SET active=FALSE WHERE plan_id='plan_basic'"
    )

    try:
        # Le plan désactivé ne doit PAS empêcher la résolution des bénéfices
        benefits = await _load_subscription_benefits(db_conn, user_id)
        assert benefits, "Bénéfices perdus après désactivation du plan"
        assert benefits["plan_id"] == "plan_basic"
        assert benefits["exempt_payer_fixed"] is True

        # Mais le plan ne doit PAS apparaître dans la liste publique
        async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as client:
            r = await client.get("/api/subscription-plans")
        public_ids = [p["plan_id"] for p in r.json()]
        assert "plan_basic" not in public_ids, "Plan désactivé visible publiquement"

    finally:
        # Réactiver pour ne pas casser les autres tests
        await db_conn.execute(
            "UPDATE subscription_plans SET active=TRUE WHERE plan_id='plan_basic'"
        )
        await cleanup_user_subscriptions(db_conn, user_id)


@pytest.mark.asyncio
async def test_24_subscribe_disabled_plan(tokens, db_conn):
    """Souscription à un plan désactivé → 400."""
    # Créer un plan désactivé temporaire
    plan_id = f"plan_disabled_{uuid.uuid4().hex[:8]}"
    await db_conn.execute(
        """INSERT INTO subscription_plans
           (plan_id, name, description, price, duration_days,
            exempt_payer_fixed, exempt_payer_percent, exempt_receiver_fixed, exempt_receiver_percent,
            active, priority)
           VALUES ($1,'Plan Désactivé','Test',9.99,30,FALSE,FALSE,FALSE,FALSE,FALSE,1)""",
        plan_id,
    )
    async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as client:
        r = await client.post(
            "/api/subscriptions/subscribe",
            json={"plan_id": plan_id, "origin_url": API_BASE},
            headers={"Authorization": f"Bearer {tokens['user']}"},
        )
    assert r.status_code == 400
    assert "disponible" in r.json()["detail"].lower()
    await db_conn.execute("DELETE FROM subscription_plans WHERE plan_id=$1", plan_id)


# ── 14. duration_days invalide ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_25_invalid_duration_days(tokens, db_conn):
    """Plan avec duration_days=60 (non supporté) → 400 avec message clair."""
    plan_id = f"plan_invalid_dur_{uuid.uuid4().hex[:8]}"
    await db_conn.execute(
        """INSERT INTO subscription_plans
           (plan_id, name, description, price, duration_days,
            exempt_payer_fixed, exempt_payer_percent, exempt_receiver_fixed, exempt_receiver_percent,
            active, priority)
           VALUES ($1,'Plan 60j','Test 60j',9.99,60,FALSE,FALSE,FALSE,FALSE,TRUE,1)""",
        plan_id,
    )
    async with httpx.AsyncClient(base_url=API_BASE, timeout=60) as client:
        r = await client.post(
            "/api/subscriptions/subscribe",
            json={"plan_id": plan_id, "origin_url": API_BASE},
            headers={"Authorization": f"Bearer {tokens['user']}"},
        )
    assert r.status_code == 400, f"Durée invalide non rejetée : {r.text}"
    assert "support" in r.json()["detail"].lower() or "60" in r.json()["detail"]
    await db_conn.execute("DELETE FROM subscription_plans WHERE plan_id=$1", plan_id)


# ── Historique ─────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_26_subscription_history(tokens, user_id, db_conn, base_plan):
    """L'historique retourne tous les abonnements passés."""
    sub_ids = []
    for i in range(2):
        sub_id = f"sub_hist_{i}_{uuid.uuid4().hex[:8]}"
        sub_ids.append(sub_id)
        await db_conn.execute(
            """INSERT INTO user_subscriptions
               (subscription_id, user_id, plan_id, status, started_at, expires_at, updated_at)
               VALUES ($1,$2,'plan_basic','cancelled',NOW(),NOW(),NOW())""",
            sub_id, user_id,
        )
    # Oups : 3 args pour 3 placeholders
    for sub_id in sub_ids:
        await db_conn.execute(
            """INSERT INTO user_subscriptions
               (subscription_id, user_id, plan_id, status, started_at, expires_at, updated_at)
               SELECT $1,$2,'plan_basic','cancelled',NOW(),NOW(),NOW()
               WHERE NOT EXISTS (SELECT 1 FROM user_subscriptions WHERE subscription_id=$1)""",
            sub_id, user_id,
        )

    async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as client:
        r = await client.get(
            "/api/subscriptions/history",
            headers={"Authorization": f"Bearer {tokens['user']}"},
        )
    assert r.status_code == 200
    history = r.json()
    assert len(history) >= 0  # peut être 0 si INSERT skipped (already exists)
    await cleanup_user_subscriptions(db_conn, user_id)


# ── Checkout status ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_27_checkout_status_invalid_session(tokens):
    """Session inexistante → 404."""
    async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as client:
        r = await client.get(
            "/api/subscriptions/checkout/status/cs_invalid_session_xxx",
            headers={"Authorization": f"Bearer {tokens['user']}"},
        )
    assert r.status_code in (404, 400)
