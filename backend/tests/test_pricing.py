"""
test_pricing.py — Tests du moteur de pricing et du modèle de données
"""
import pytest
import httpx
import asyncio
import asyncpg
import os
import json

BASE = "http://localhost:8001/api"
DB_URL = os.environ.get("DATABASE_URL", "postgresql://winek:winek2024@127.0.0.1/winek_db")

# ── helpers ────────────────────────────────────────────────────────────────────

def login(email: str, password: str) -> str:
    r = httpx.post(f"{BASE}/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"Login failed: {r.text}"
    return r.json()["token"]

def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}

# ── Tests schéma DB ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_payments_table_schema():
    """Vérifie que la table payments existe avec toutes les colonnes requises."""
    conn = await asyncpg.connect(DB_URL)
    try:
        cols = await conn.fetch(
            """SELECT column_name, data_type
               FROM information_schema.columns
               WHERE table_name = 'payments'
               ORDER BY ordinal_position"""
        )
        col_names = {r["column_name"] for r in cols}
        required = {
            "payment_id", "payer_user_id", "receiver_user_id",
            "product_type", "product_id", "booking_id",
            "stripe_payment_intent_id", "stripe_charge_id", "stripe_transfer_id",
            "status", "currency",
            "base_amount", "payer_fixed_fee", "payer_percent_fee_amount",
            "receiver_fixed_fee", "receiver_percent_fee_amount",
            "platform_total_fee", "receiver_net_amount", "payer_total_amount",
            "pricing_rule_snapshot", "created_at", "updated_at",
        }
        missing = required - col_names
        assert not missing, f"Colonnes manquantes dans payments: {missing}"
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_user_subscriptions_enriched():
    """Vérifie les nouvelles colonnes sur user_subscriptions."""
    conn = await asyncpg.connect(DB_URL)
    try:
        cols = await conn.fetch(
            """SELECT column_name FROM information_schema.columns
               WHERE table_name = 'user_subscriptions'"""
        )
        col_names = {r["column_name"] for r in cols}
        required = {"plan_code", "stripe_subscription_id", "benefits_snapshot",
                    "cancelled_at", "updated_at"}
        missing = required - col_names
        assert not missing, f"Colonnes manquantes dans user_subscriptions: {missing}"
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_pricing_rules_enriched():
    """Vérifie les nouvelles colonnes sur pricing_rules."""
    conn = await asyncpg.connect(DB_URL)
    try:
        cols = await conn.fetch(
            """SELECT column_name FROM information_schema.columns
               WHERE table_name = 'pricing_rules'"""
        )
        col_names = {r["column_name"] for r in cols}
        assert "description" in col_names
        assert "currency" in col_names
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_bookings_currency_column():
    """Vérifie que bookings a maintenant la colonne currency."""
    conn = await asyncpg.connect(DB_URL)
    try:
        col = await conn.fetchval(
            """SELECT column_name FROM information_schema.columns
               WHERE table_name = 'bookings' AND column_name = 'currency'"""
        )
        assert col == "currency"
    finally:
        await conn.close()


# ── Tests moteur de pricing ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_pricing_engine_no_rule():
    """Sans règle active, le engine retourne zéro frais."""
    from pricing_engine import pricing_engine
    conn = await asyncpg.connect(DB_URL)
    try:
        # Désactiver toutes les règles temporairement
        await conn.execute("UPDATE pricing_rules SET active = FALSE")
        result = await pricing_engine.calculate(
            conn, 100.0, "user_test_payer", "user_test_receiver", "unknown_type"
        )
        assert result.payer_fixed_fee == 0.0
        assert result.payer_percent_fee == 0.0
        assert result.receiver_fixed_fee == 0.0
        assert result.receiver_percent_fee == 0.0
        assert result.platform_total_fee == 0.0
        assert result.receiver_net_amount == 100.0
        assert result.payer_total_amount == 100.0
        assert result.rule_id is None
    finally:
        # Réactiver les règles
        await conn.execute("UPDATE pricing_rules SET active = TRUE")
        await conn.close()


@pytest.mark.asyncio
async def test_pricing_engine_with_rule():
    """Avec une règle active, vérifie le calcul exact des frais."""
    from pricing_engine import pricing_engine
    conn = await asyncpg.connect(DB_URL)
    try:
        # La règle "Standard" créée en session précédente : 2.5% payeur + 10% bénéficiaire
        result = await pricing_engine.calculate(
            conn, 60.0, "u_payer", "u_receiver", "service_booking"
        )
        assert result.base_amount == 60.0
        # 2.5% de 60 = 1.50
        assert result.payer_percent_fee == 1.50
        # 10% de 60 = 6.00
        assert result.receiver_percent_fee == 6.00
        assert result.payer_total_amount == 61.50
        assert result.receiver_net_amount == 54.00
        assert result.platform_total_fee == 7.50
        assert result.rule_id is not None
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_pricing_snapshot_immutable():
    """Vérifie que to_snapshot() retourne un dict complet et cohérent."""
    from pricing_engine import pricing_engine
    conn = await asyncpg.connect(DB_URL)
    try:
        result = await pricing_engine.calculate(
            conn, 100.0, "u1", "u2", "service_booking"
        )
        snap = result.to_snapshot()
        required_keys = {
            "base_amount", "payer_fixed_fee", "payer_percent_fee",
            "receiver_fixed_fee", "receiver_percent_fee",
            "platform_total_fee", "receiver_net_amount", "payer_total_amount",
            "rule_id", "rule_name", "product_type", "subscription_exemptions",
        }
        assert required_keys.issubset(snap.keys()), f"Clés manquantes: {required_keys - snap.keys()}"
        # Vérifier que c'est sérialisable JSON
        json_str = json.dumps(snap)
        reloaded = json.loads(json_str)
        assert reloaded["base_amount"] == snap["base_amount"]
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_to_payment_dict():
    """Vérifie que to_payment_dict() produit toutes les colonnes de la table payments."""
    from pricing_engine import pricing_engine
    from models import new_id
    conn = await asyncpg.connect(DB_URL)
    try:
        result = await pricing_engine.calculate(
            conn, 50.0, "u_payer", "u_receiver", "service_booking"
        )
        pd = result.to_payment_dict(
            payment_id=new_id("pay"),
            payer_user_id="u_payer",
            receiver_user_id="u_receiver",
            product_type="service_booking",
            product_id="svc_test",
            booking_id="bkg_test",
        )
        required_keys = {
            "payment_id", "payer_user_id", "receiver_user_id",
            "product_type", "product_id", "booking_id",
            "stripe_payment_intent_id", "stripe_charge_id", "stripe_transfer_id",
            "status", "currency",
            "base_amount", "payer_fixed_fee", "payer_percent_fee_amount",
            "receiver_fixed_fee", "receiver_percent_fee_amount",
            "platform_total_fee", "receiver_net_amount", "payer_total_amount",
            "pricing_rule_snapshot",
        }
        missing = required_keys - pd.keys()
        assert not missing, f"Clés manquantes dans to_payment_dict: {missing}"
        assert pd["status"] == "pending"
        assert pd["currency"] == "EUR"
        assert pd["base_amount"] == 50.0
        assert isinstance(pd["pricing_rule_snapshot"], dict)
    finally:
        await conn.close()


# ── Tests API end-to-end ──────────────────────────────────────────────────────

def test_create_booking_creates_payment():
    """Créer un booking doit créer atomiquement un payment lié."""
    user_token = login("user@winek.app", "WinekUser2024!")
    admin_token = login("admin@winek.app", "WinekAdmin2024!")

    # Créer le booking
    r = httpx.post(f"{BASE}/bookings", json={"service_id": "svc_demo001"}, headers=auth(user_token))
    assert r.status_code == 200, f"Booking failed: {r.text}"
    booking = r.json()
    booking_id = booking["booking_id"]

    # Vérifier le pricing_snapshot sur le booking
    assert booking.get("pricing_snapshot") is not None, "pricing_snapshot absent du booking"
    snap = booking["pricing_snapshot"]
    assert "base_amount" in snap
    assert "payer_total_amount" in snap
    assert "receiver_net_amount" in snap
    assert "platform_total_fee" in snap

    # Vérifier que le payment existe via l'API admin
    r2 = httpx.get(f"{BASE}/admin/payments", headers=auth(admin_token))
    assert r2.status_code == 200
    payments = r2.json()
    related = [p for p in payments if p.get("booking_id") == booking_id]
    assert len(related) == 1, f"Aucun payment trouvé pour booking {booking_id}"

    pay = related[0]
    assert pay["product_type"] == "service_booking"
    assert pay["status"] == "pending"
    assert pay["base_amount"] == snap["base_amount"]
    assert pay["payer_total_amount"] == snap["payer_total_amount"]
    assert pay["receiver_net_amount"] == snap["receiver_net_amount"]
    assert pay["platform_total_fee"] == snap["platform_total_fee"]
    assert isinstance(pay["pricing_rule_snapshot"], dict)
    print(f"✓ Payment créé: {pay['payment_id']} | base={pay['base_amount']}€ "
          f"| total_payeur={pay['payer_total_amount']}€ "
          f"| net_receveur={pay['receiver_net_amount']}€ "
          f"| frais_plateforme={pay['platform_total_fee']}€")


def test_admin_payment_stats():
    """Vérifie que les stats agrégées renvoient des valeurs numériques cohérentes."""
    admin_token = login("admin@winek.app", "WinekAdmin2024!")
    r = httpx.get(f"{BASE}/admin/payments/stats", headers=auth(admin_token))
    assert r.status_code == 200
    stats = r.json()
    required = {"total_payments", "paid_count", "pending_count", "failed_count",
                "gmv", "platform_revenue", "total_charged", "total_disbursed"}
    missing = required - stats.keys()
    assert not missing, f"Champs manquants dans stats: {missing}"
    assert stats["total_payments"] >= 0
    print(f"✓ Stats paiements: {stats}")


def test_admin_pricing_rules_crud():
    """CRUD complet sur les règles de pricing."""
    admin_token = login("admin@winek.app", "WinekAdmin2024!")

    # Créer une règle
    r = httpx.post(f"{BASE}/admin/pricing-rules",
                   json={"product_type": "test_type", "name": "Test Rule",
                         "payer_percent_fee": 5.0, "receiver_percent_fee": 8.0},
                   headers=auth(admin_token))
    assert r.status_code == 200
    rule_id = r.json()["rule_id"]

    # Mettre à jour
    r2 = httpx.put(f"{BASE}/admin/pricing-rules/{rule_id}",
                   json={"payer_percent_fee": 3.0},
                   headers=auth(admin_token))
    assert r2.status_code == 200

    # Supprimer
    r3 = httpx.delete(f"{BASE}/admin/pricing-rules/{rule_id}",
                      headers=auth(admin_token))
    assert r3.status_code == 200
    print(f"✓ CRUD pricing rules OK (rule_id={rule_id})")


def test_admin_subscription_plans_crud():
    """Créer un plan d'abonnement avec exemptions."""
    admin_token = login("admin@winek.app", "WinekAdmin2024!")

    r = httpx.post(f"{BASE}/admin/subscription-plans",
                   json={"name": "Gold", "price": 19.99, "duration_days": 30,
                         "exempt_payer_percent": True, "exempt_receiver_fixed": True},
                   headers=auth(admin_token))
    assert r.status_code == 200
    plan = r.json()
    assert plan["exempt_payer_percent"] is True
    assert plan["exempt_receiver_fixed"] is True
    print(f"✓ Plan créé: {plan['plan_id']} — {plan['name']} {plan['price']}€/mois")


def test_my_payments_endpoint():
    """L'utilisateur peut voir ses propres paiements."""
    user_token = login("user@winek.app", "WinekUser2024!")
    r = httpx.get(f"{BASE}/payments/me", headers=auth(user_token))
    assert r.status_code == 200
    payments = r.json()
    assert isinstance(payments, list)
    print(f"✓ /payments/me retourne {len(payments)} paiements pour l'utilisateur")


if __name__ == "__main__":
    # Lancement direct sans pytest
    import sys
    sys.path.insert(0, "/app/backend")
    asyncio.run(test_payments_table_schema())
    print("✓ test_payments_table_schema")
    asyncio.run(test_user_subscriptions_enriched())
    print("✓ test_user_subscriptions_enriched")
    asyncio.run(test_pricing_rules_enriched())
    print("✓ test_pricing_rules_enriched")
    asyncio.run(test_bookings_currency_column())
    print("✓ test_bookings_currency_column")
    asyncio.run(test_pricing_engine_no_rule())
    print("✓ test_pricing_engine_no_rule")
    asyncio.run(test_pricing_engine_with_rule())
    print("✓ test_pricing_engine_with_rule")
    asyncio.run(test_pricing_snapshot_immutable())
    print("✓ test_pricing_snapshot_immutable")
    asyncio.run(test_to_payment_dict())
    print("✓ test_to_payment_dict")
    test_create_booking_creates_payment()
    test_admin_payment_stats()
    test_admin_pricing_rules_crud()
    test_admin_subscription_plans_crud()
    test_my_payments_endpoint()
    print("\n✅ Tous les tests passent")
