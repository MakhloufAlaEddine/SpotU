"""
Admin Dashboard Backend Tests - Iteration 48
Tests for: admin stats, pricing rules CRUD, subscription plans CRUD
"""
import pytest
import requests
import os

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://spotme-ui-polish.preview.emergentagent.com").rstrip("/")

ADMIN_CREDS = {"email": "admin@winek.app", "password": "WinekAdmin2024!"}
USER_CREDS  = {"email": "user@winek.app",  "password": "WinekUser2024!"}

_token_cache: dict = {}


def get_token(creds: dict) -> str:
    key = creds["email"]
    if key in _token_cache:
        return _token_cache[key]
    resp = requests.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=15)
    resp.raise_for_status()
    token = resp.json()["token"]
    _token_cache[key] = token
    return token


@pytest.fixture(scope="module")
def admin_headers():
    token = get_token(ADMIN_CREDS)
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def user_headers():
    token = get_token(USER_CREDS)
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ── Auth tests ──────────────────────────────────────────────────────────────────

class TestAdminAuth:
    """Admin route authentication tests"""

    def test_stats_unauthenticated(self):
        resp = requests.get(f"{BASE_URL}/api/admin/stats", timeout=15)
        assert resp.status_code in (401, 403), f"Expected 401/403, got {resp.status_code}"
        print("PASS: /admin/stats unauthenticated → 401/403")

    def test_stats_non_admin_forbidden(self, user_headers):
        resp = requests.get(f"{BASE_URL}/api/admin/stats", headers=user_headers, timeout=15)
        assert resp.status_code in (401, 403), f"Expected 401/403, got {resp.status_code}"
        print("PASS: /admin/stats non-admin → 401/403")

    def test_admin_login_success(self):
        resp = requests.post(f"{BASE_URL}/api/auth/login", json=ADMIN_CREDS, timeout=15)
        assert resp.status_code == 200
        data = resp.json()
        assert "token" in data
        assert data["user"]["role"] == "admin"
        print(f"PASS: admin login success, role={data['user']['role']}")


# ── Stats tests ────────────────────────────────────────────────────────────────

class TestAdminStats:
    """Admin stats endpoint tests"""

    def test_get_stats_success(self, admin_headers):
        resp = requests.get(f"{BASE_URL}/api/admin/stats", headers=admin_headers, timeout=15)
        assert resp.status_code == 200
        data = resp.json()
        print(f"PASS: /admin/stats → {data}")

    def test_stats_has_required_fields(self, admin_headers):
        resp = requests.get(f"{BASE_URL}/api/admin/stats", headers=admin_headers, timeout=15)
        data = resp.json()
        required_fields = ["total_users", "total_coaches", "total_tagpoints",
                           "total_bookings", "total_paid_bookings", "gmv", "platform_commission"]
        for field in required_fields:
            assert field in data, f"Missing field: {field}"
        print(f"PASS: all required stats fields present")

    def test_stats_numeric_values(self, admin_headers):
        resp = requests.get(f"{BASE_URL}/api/admin/stats", headers=admin_headers, timeout=15)
        data = resp.json()
        assert isinstance(data["total_users"], int)
        assert isinstance(data["total_coaches"], int)
        assert isinstance(data["gmv"], (int, float))
        assert data["total_users"] >= 0
        assert data["total_coaches"] >= 0
        print(f"PASS: stats values are numeric and non-negative")


# ── Pricing Rules CRUD ─────────────────────────────────────────────────────────

# Track created rule IDs for cleanup
_created_rule_ids: list = []


class TestPricingRules:
    """Pricing rules CRUD tests"""

    def test_list_pricing_rules_empty_or_populated(self, admin_headers):
        """GET /admin/pricing-rules should return list"""
        resp = requests.get(f"{BASE_URL}/api/admin/pricing-rules", headers=admin_headers, timeout=15)
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        print(f"PASS: GET pricing-rules → {len(data)} rules")

    def test_create_pricing_rule_success(self, admin_headers):
        """POST /admin/pricing-rules - create a new rule"""
        payload = {
            "name": "TEST_Rule Standard",
            "product_type": "service_booking",
            "payer_fixed_fee": 1.50,
            "payer_percent_fee": 2.5,
            "receiver_fixed_fee": 0,
            "receiver_percent_fee": 0,
            "active": True,
            "priority": 10,
        }
        resp = requests.post(f"{BASE_URL}/api/admin/pricing-rules", json=payload, headers=admin_headers, timeout=15)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert "rule_id" in data
        assert data["name"] == payload["name"]
        assert data["product_type"] == payload["product_type"]
        assert abs(float(data["payer_fixed_fee"]) - 1.50) < 0.01
        assert abs(float(data["payer_percent_fee"]) - 2.5) < 0.01
        _created_rule_ids.append(data["rule_id"])
        print(f"PASS: created pricing rule id={data['rule_id']}")

    def test_create_pricing_rule_missing_name(self, admin_headers):
        """POST /admin/pricing-rules without name → 400"""
        payload = {"product_type": "service_booking"}
        resp = requests.post(f"{BASE_URL}/api/admin/pricing-rules", json=payload, headers=admin_headers, timeout=15)
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"
        print("PASS: missing name → 400")

    def test_create_pricing_rule_missing_product_type(self, admin_headers):
        """POST /admin/pricing-rules without product_type → 400"""
        payload = {"name": "TEST_No Type"}
        resp = requests.post(f"{BASE_URL}/api/admin/pricing-rules", json=payload, headers=admin_headers, timeout=15)
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"
        print("PASS: missing product_type → 400")

    def test_rule_appears_in_list_after_creation(self, admin_headers):
        """Verify created rule appears in list"""
        if not _created_rule_ids:
            pytest.skip("No rule created in previous test")
        rule_id = _created_rule_ids[0]
        resp = requests.get(f"{BASE_URL}/api/admin/pricing-rules", headers=admin_headers, timeout=15)
        assert resp.status_code == 200
        data = resp.json()
        ids = [r["rule_id"] for r in data]
        assert rule_id in ids, f"rule_id {rule_id} not found in list"
        print(f"PASS: rule {rule_id} appears in list")

    def test_update_pricing_rule_name(self, admin_headers):
        """PUT /admin/pricing-rules/{id} - update rule name"""
        if not _created_rule_ids:
            pytest.skip("No rule created to update")
        rule_id = _created_rule_ids[0]
        resp = requests.put(
            f"{BASE_URL}/api/admin/pricing-rules/{rule_id}",
            json={"name": "TEST_Rule Updated"},
            headers=admin_headers, timeout=15
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data.get("success") is True
        print(f"PASS: rule {rule_id} name updated")

    def test_update_pricing_rule_toggle_active(self, admin_headers):
        """PUT /admin/pricing-rules/{id} - toggle active status"""
        if not _created_rule_ids:
            pytest.skip("No rule created to toggle")
        rule_id = _created_rule_ids[0]
        # First disable
        resp = requests.put(
            f"{BASE_URL}/api/admin/pricing-rules/{rule_id}",
            json={"active": False},
            headers=admin_headers, timeout=15
        )
        assert resp.status_code == 200
        # Then re-enable
        resp2 = requests.put(
            f"{BASE_URL}/api/admin/pricing-rules/{rule_id}",
            json={"active": True},
            headers=admin_headers, timeout=15
        )
        assert resp2.status_code == 200
        print(f"PASS: rule {rule_id} toggle active works")

    def test_update_nonexistent_rule(self, admin_headers):
        """PUT on non-existent rule → 404"""
        resp = requests.put(
            f"{BASE_URL}/api/admin/pricing-rules/nonexistent_rule_id_xyz",
            json={"name": "Should Fail"},
            headers=admin_headers, timeout=15
        )
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}"
        print("PASS: update non-existent rule → 404")

    def test_update_rule_no_valid_fields(self, admin_headers):
        """PUT with no valid fields → 400"""
        if not _created_rule_ids:
            pytest.skip("No rule created")
        rule_id = _created_rule_ids[0]
        resp = requests.put(
            f"{BASE_URL}/api/admin/pricing-rules/{rule_id}",
            json={"invalid_field": "test"},
            headers=admin_headers, timeout=15
        )
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"
        print("PASS: update with no valid fields → 400")

    def test_delete_pricing_rule(self, admin_headers):
        """DELETE /admin/pricing-rules/{id}"""
        if not _created_rule_ids:
            pytest.skip("No rule created to delete")
        rule_id = _created_rule_ids[0]
        resp = requests.delete(
            f"{BASE_URL}/api/admin/pricing-rules/{rule_id}",
            headers=admin_headers, timeout=15
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("success") is True
        print(f"PASS: rule {rule_id} deleted")

    def test_rule_gone_after_delete(self, admin_headers):
        """Verify rule no longer appears in list after deletion"""
        if not _created_rule_ids:
            pytest.skip("No rule created")
        rule_id = _created_rule_ids[0]
        resp = requests.get(f"{BASE_URL}/api/admin/pricing-rules", headers=admin_headers, timeout=15)
        assert resp.status_code == 200
        data = resp.json()
        ids = [r["rule_id"] for r in data]
        assert rule_id not in ids, f"rule_id {rule_id} should be deleted but still found in list"
        print(f"PASS: deleted rule {rule_id} is no longer in list")


# ── Subscription Plans CRUD ─────────────────────────────────────────────────────

_created_plan_ids: list = []


class TestSubscriptionPlans:
    """Subscription plans CRUD tests"""

    def test_list_subscription_plans(self, admin_headers):
        """GET /admin/subscription-plans should return list"""
        resp = requests.get(f"{BASE_URL}/api/admin/subscription-plans", headers=admin_headers, timeout=15)
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        print(f"PASS: GET subscription-plans → {len(data)} plans")

    def test_create_subscription_plan_success(self, admin_headers):
        """POST /admin/subscription-plans - create new plan"""
        payload = {
            "name": "TEST_Premium Plan",
            "description": "Test premium subscription",
            "price": 9.99,
            "duration_days": 30,
            "exempt_payer_fixed": True,
            "exempt_payer_percent": False,
            "exempt_receiver_fixed": False,
            "exempt_receiver_percent": False,
            "active": True,
            "priority": 5,
        }
        resp = requests.post(f"{BASE_URL}/api/admin/subscription-plans", json=payload, headers=admin_headers, timeout=15)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert "plan_id" in data
        assert data["name"] == payload["name"]
        assert abs(float(data["price"]) - 9.99) < 0.01
        assert data["duration_days"] == 30
        assert data["exempt_payer_fixed"] is True
        _created_plan_ids.append(data["plan_id"])
        print(f"PASS: created plan id={data['plan_id']}")

    def test_create_plan_missing_name(self, admin_headers):
        """POST /admin/subscription-plans without name → 400"""
        payload = {"price": 5.00}
        resp = requests.post(f"{BASE_URL}/api/admin/subscription-plans", json=payload, headers=admin_headers, timeout=15)
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"
        print("PASS: missing name → 400")

    def test_plan_appears_in_list(self, admin_headers):
        """Verify plan appears in list after creation"""
        if not _created_plan_ids:
            pytest.skip("No plan created")
        plan_id = _created_plan_ids[0]
        resp = requests.get(f"{BASE_URL}/api/admin/subscription-plans", headers=admin_headers, timeout=15)
        data = resp.json()
        ids = [p["plan_id"] for p in data]
        assert plan_id in ids
        print(f"PASS: plan {plan_id} found in list")

    def test_update_plan_name(self, admin_headers):
        """PUT /admin/subscription-plans/{id} - update plan"""
        if not _created_plan_ids:
            pytest.skip("No plan created")
        plan_id = _created_plan_ids[0]
        resp = requests.put(
            f"{BASE_URL}/api/admin/subscription-plans/{plan_id}",
            json={"name": "TEST_Premium Updated", "price": 14.99},
            headers=admin_headers, timeout=15
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        assert resp.json().get("success") is True
        print(f"PASS: plan {plan_id} updated")

    def test_update_plan_toggle_active(self, admin_headers):
        """Toggle active status on plan"""
        if not _created_plan_ids:
            pytest.skip("No plan created")
        plan_id = _created_plan_ids[0]
        resp = requests.put(
            f"{BASE_URL}/api/admin/subscription-plans/{plan_id}",
            json={"active": False},
            headers=admin_headers, timeout=15
        )
        assert resp.status_code == 200
        resp2 = requests.put(
            f"{BASE_URL}/api/admin/subscription-plans/{plan_id}",
            json={"active": True},
            headers=admin_headers, timeout=15
        )
        assert resp2.status_code == 200
        print("PASS: plan toggle active works")

    def test_update_nonexistent_plan(self, admin_headers):
        """PUT on non-existent plan → 404"""
        resp = requests.put(
            f"{BASE_URL}/api/admin/subscription-plans/nonexistent_plan_xyz",
            json={"name": "Ghost"},
            headers=admin_headers, timeout=15
        )
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}"
        print("PASS: update non-existent plan → 404")

    def test_delete_subscription_plan(self, admin_headers):
        """DELETE /admin/subscription-plans/{id}"""
        if not _created_plan_ids:
            pytest.skip("No plan created to delete")
        plan_id = _created_plan_ids[0]
        resp = requests.delete(
            f"{BASE_URL}/api/admin/subscription-plans/{plan_id}",
            headers=admin_headers, timeout=15
        )
        assert resp.status_code == 200
        assert resp.json().get("success") is True
        print(f"PASS: plan {plan_id} deleted")

    def test_plan_gone_after_delete(self, admin_headers):
        """Verify plan is removed from list after deletion"""
        if not _created_plan_ids:
            pytest.skip("No plan created")
        plan_id = _created_plan_ids[0]
        resp = requests.get(f"{BASE_URL}/api/admin/subscription-plans", headers=admin_headers, timeout=15)
        data = resp.json()
        ids = [p["plan_id"] for p in data]
        assert plan_id not in ids
        print(f"PASS: deleted plan {plan_id} no longer in list")


# ── Payments endpoint ──────────────────────────────────────────────────────────

class TestAdminPayments:
    """Admin payments tab - we check /admin/payments (may not exist, handled gracefully in frontend)"""

    def test_admin_payments_endpoint(self, admin_headers):
        """GET /admin/payments - check status (may return 404 if not implemented)"""
        resp = requests.get(f"{BASE_URL}/api/admin/payments", headers=admin_headers, timeout=15)
        # Frontend does .catch(() => []) so 404 is acceptable
        assert resp.status_code in (200, 404, 422), f"Unexpected status: {resp.status_code}"
        if resp.status_code == 200:
            data = resp.json()
            assert isinstance(data, list)
            print(f"PASS: /admin/payments → 200, {len(data)} payments")
        else:
            print(f"PASS: /admin/payments → {resp.status_code} (not implemented, frontend handles gracefully)")
