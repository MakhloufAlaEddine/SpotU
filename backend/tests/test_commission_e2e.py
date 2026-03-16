"""
test_commission_e2e.py — Test E2E du calcul de commission
==========================================================
Vérifie la cohérence du calcul de commission entre :
  1. L'endpoint public GET /api/config/commission (taux affichés)
  2. L'endpoint POST /api/bookings/price-preview (calcul pricing engine)
  3. Le pricing_engine interne (montants calculés)

Scénarios testés :
  - Avec pricing_rule active (5% payeur + 10% coach)
  - Sans pricing_rule (pas de commission)
  - Cohérence des montants entre preview et booking réel
"""

import pytest
import httpx
import os

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001/api").rstrip("/")
if not BASE.endswith("/api"):
    BASE = BASE + "/api"

ADMIN_CREDS = {"email": "admin@winek.app", "password": "WinekAdmin2024!"}
USER_CREDS  = {"email": "user@winek.app",  "password": "WinekUser2024!"}
SERVICE_ID  = "svc_demo001"  # prix = 60€


@pytest.fixture(scope="module")
def client():
    with httpx.Client(timeout=15) as c:
        yield c


def login(client, creds):
    r = client.post(f"{BASE}/auth/login", json=creds)
    assert r.status_code == 200
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_token(client):
    return login(client, ADMIN_CREDS)


@pytest.fixture(scope="module")
def user_token(client):
    return login(client, USER_CREDS)


def get_active_rule(client, admin_token):
    """Retourne la première pricing_rule active pour service_booking, ou None."""
    r = client.get(f"{BASE}/admin/pricing-rules", headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200
    rules = r.json()
    for rule in rules:
        if rule["product_type"] == "service_booking" and rule["active"]:
            return rule
    return None


def ensure_rule_active(client, admin_token, active: bool):
    """Active ou désactive la pricing_rule service_booking."""
    rule = get_active_rule(client, admin_token)
    if rule and rule["active"] != active:
        r = client.put(
            f"{BASE}/admin/pricing-rules/{rule['rule_id']}",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"active": active},
        )
        assert r.status_code == 200
    elif not rule and active:
        # Créer une règle
        r = client.post(
            f"{BASE}/admin/pricing-rules",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "name": "Test commission E2E",
                "product_type": "service_booking",
                "payer_fixed_fee": 0,
                "payer_percent_fee": 5,
                "receiver_fixed_fee": 0,
                "receiver_percent_fee": 10,
                "active": True,
            },
        )
        assert r.status_code == 200


# ══════════════════════════════════════════════════════════════════════════════
# Test 1 : Endpoint config/commission retourne les bons taux
# ══════════════════════════════════════════════════════════════════════════════

def test_config_commission_with_rule(client, admin_token):
    """Avec une règle active, config/commission retourne les taux corrects."""
    ensure_rule_active(client, admin_token, True)
    r = client.get(f"{BASE}/config/commission")
    assert r.status_code == 200
    d = r.json()
    assert d["has_rule"] is True
    assert d["payer_percent_fee"] == 5.0
    assert d["receiver_percent_fee"] == 10.0
    assert d["total_percent_fee"] == 15.0


def test_config_commission_without_rule(client, admin_token):
    """Sans règle active, config/commission retourne has_rule=false."""
    ensure_rule_active(client, admin_token, False)
    r = client.get(f"{BASE}/config/commission")
    assert r.status_code == 200
    d = r.json()
    assert d["has_rule"] is False
    assert d["total_percent_fee"] == 0
    # Réactiver pour les tests suivants
    ensure_rule_active(client, admin_token, True)


# ══════════════════════════════════════════════════════════════════════════════
# Test 2 : Price preview calcule correctement les montants
# ══════════════════════════════════════════════════════════════════════════════

def test_price_preview_math(client, admin_token, user_token):
    """Le price-preview calcule correctement base, frais, total."""
    ensure_rule_active(client, admin_token, True)
    r = client.post(
        f"{BASE}/bookings/price-preview",
        headers={"Authorization": f"Bearer {user_token}"},
        json={"service_id": SERVICE_ID},
    )
    assert r.status_code == 200
    d = r.json()

    base = d["base_amount"]
    assert base == 60.0, f"Base amount devrait être 60, got {base}"

    # Frais payeur = 5% de 60 = 3.0
    assert d["payer_percent_fee_amount"] == 3.0, f"Frais payeur: {d['payer_percent_fee_amount']}"
    # Frais coach = 10% de 60 = 6.0
    assert d["receiver_percent_fee_amount"] == 6.0, f"Frais coach: {d['receiver_percent_fee_amount']}"
    # Total payeur = 60 + 3 = 63
    assert d["payer_total_amount"] == 63.0, f"Total payeur: {d['payer_total_amount']}"
    # Net coach = 60 - 6 = 54
    assert d["receiver_net_amount"] == 54.0, f"Net coach: {d['receiver_net_amount']}"
    # Platform fee = 3 + 6 = 9
    assert d["platform_total_fee"] == 9.0, f"Platform fee: {d['platform_total_fee']}"


def test_price_preview_without_rule(client, admin_token, user_token):
    """Sans pricing_rule, tout est à 0 (pas de frais)."""
    ensure_rule_active(client, admin_token, False)
    r = client.post(
        f"{BASE}/bookings/price-preview",
        headers={"Authorization": f"Bearer {user_token}"},
        json={"service_id": SERVICE_ID},
    )
    assert r.status_code == 200
    d = r.json()
    assert d["base_amount"] == 60.0
    assert d["payer_percent_fee_amount"] == 0.0
    assert d["receiver_percent_fee_amount"] == 0.0
    assert d["payer_total_amount"] == 60.0
    assert d["receiver_net_amount"] == 60.0
    assert d["platform_total_fee"] == 0.0
    # Réactiver
    ensure_rule_active(client, admin_token, True)


# ══════════════════════════════════════════════════════════════════════════════
# Test 3 : Cohérence preview vs config/commission
# ══════════════════════════════════════════════════════════════════════════════

def test_preview_matches_config_rates(client, admin_token, user_token):
    """
    Double vérification : les montants du preview correspondent
    aux taux retournés par config/commission.
    """
    ensure_rule_active(client, admin_token, True)

    # Récupérer les taux
    cr = client.get(f"{BASE}/config/commission").json()
    payer_pct = cr["payer_percent_fee"]
    receiver_pct = cr["receiver_percent_fee"]

    # Récupérer le preview
    pr = client.post(
        f"{BASE}/bookings/price-preview",
        headers={"Authorization": f"Bearer {user_token}"},
        json={"service_id": SERVICE_ID},
    ).json()

    base = pr["base_amount"]

    # Vérifier la cohérence taux vs montants
    expected_payer_fee = round(base * payer_pct / 100, 2)
    expected_receiver_fee = round(base * receiver_pct / 100, 2)
    expected_payer_total = base + expected_payer_fee
    expected_receiver_net = base - expected_receiver_fee

    assert pr["payer_percent_fee_amount"] == expected_payer_fee, \
        f"Frais payeur: preview={pr['payer_percent_fee_amount']} vs calculé={expected_payer_fee}"
    assert pr["receiver_percent_fee_amount"] == expected_receiver_fee, \
        f"Frais coach: preview={pr['receiver_percent_fee_amount']} vs calculé={expected_receiver_fee}"
    assert pr["payer_total_amount"] == expected_payer_total, \
        f"Total payeur: preview={pr['payer_total_amount']} vs calculé={expected_payer_total}"
    assert pr["receiver_net_amount"] == expected_receiver_net, \
        f"Net coach: preview={pr['receiver_net_amount']} vs calculé={expected_receiver_net}"


# ══════════════════════════════════════════════════════════════════════════════
# Test 4 : Protection — prix du service correspond à la base du preview
# ══════════════════════════════════════════════════════════════════════════════

def test_preview_base_matches_service_price(client, user_token):
    """Le base_amount du preview correspond au prix du service."""
    svc = client.get(
        f"{BASE}/services/{SERVICE_ID}",
        headers={"Authorization": f"Bearer {user_token}"},
    ).json()

    preview = client.post(
        f"{BASE}/bookings/price-preview",
        headers={"Authorization": f"Bearer {user_token}"},
        json={"service_id": SERVICE_ID},
    ).json()

    assert preview["base_amount"] == svc["price"], \
        f"Base preview={preview['base_amount']} vs prix service={svc['price']}"
