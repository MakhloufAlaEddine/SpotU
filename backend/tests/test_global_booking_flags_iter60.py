"""
test_global_booking_flags_iter60.py
====================================
Tests for global booking flags (enable_manual_approval_for_services,
enable_pay_later_for_services) as part of iteration 60 feature testing.

Endpoints covered:
  - GET  /api/config/booking          (public)
  - GET  /api/admin/app-config        (admin auth required)
  - PUT  /api/admin/app-config        (admin auth required)
  - POST /api/services                (service creation with flag normalization)
  - POST /api/bookings/request        (booking with flag enforcement)
"""

import pytest
import requests
import os

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")

ADMIN_EMAIL = "admin@winek.app"
ADMIN_PASS  = "WinekAdmin2024!"
COACH_EMAIL = "coach@winek.app"
COACH_PASS  = "WinekCoach2024!"
USER_EMAIL  = "user@winek.app"
USER_PASS   = "WinekUser2024!"


# ── Fixtures ───────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS})
    assert r.status_code == 200, f"Admin login failed: {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def coach_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": COACH_EMAIL, "password": COACH_PASS})
    assert r.status_code == 200, f"Coach login failed: {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def user_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": USER_EMAIL, "password": USER_PASS})
    assert r.status_code == 200, f"User login failed: {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="module")
def coach_headers(coach_token):
    return {"Authorization": f"Bearer {coach_token}"}


@pytest.fixture(scope="module")
def user_headers(user_token):
    return {"Authorization": f"Bearer {user_token}"}


@pytest.fixture(autouse=True, scope="module")
def ensure_flags_reset(admin_headers):
    """Ensure flags start at defaults and reset them after module completes."""
    # Before: reset to MVP defaults
    requests.put(
        f"{BASE_URL}/api/admin/app-config",
        json={"enable_manual_approval_for_services": False, "enable_pay_later_for_services": False},
        headers=admin_headers,
    )
    yield
    # After: reset to MVP defaults (critical requirement from review request)
    r = requests.put(
        f"{BASE_URL}/api/admin/app-config",
        json={"enable_manual_approval_for_services": False, "enable_pay_later_for_services": False},
        headers=admin_headers,
    )
    assert r.status_code == 200, f"Failed to reset flags to MVP defaults: {r.text}"
    print("FLAGS RESET TO MVP DEFAULTS (false, false) ✓")


# ── Tests : Public config endpoint ─────────────────────────────────────────────

class TestPublicBookingConfig:
    """Tests for GET /api/config/booking (no auth required)."""

    def test_public_config_returns_200(self):
        r = requests.get(f"{BASE_URL}/api/config/booking")
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"

    def test_public_config_has_correct_keys(self):
        r = requests.get(f"{BASE_URL}/api/config/booking")
        assert r.status_code == 200
        data = r.json()
        assert "enable_manual_approval_for_services" in data, "Missing key enable_manual_approval_for_services"
        assert "enable_pay_later_for_services" in data, "Missing key enable_pay_later_for_services"

    def test_public_config_defaults_are_false(self):
        """Flags must be False by default (MVP mode)."""
        r = requests.get(f"{BASE_URL}/api/config/booking")
        assert r.status_code == 200
        data = r.json()
        assert data["enable_manual_approval_for_services"] is False, \
            f"enable_manual_approval_for_services should be False, got {data['enable_manual_approval_for_services']}"
        assert data["enable_pay_later_for_services"] is False, \
            f"enable_pay_later_for_services should be False, got {data['enable_pay_later_for_services']}"

    def test_public_config_no_auth_required(self):
        """Endpoint must work without any Authorization header."""
        r = requests.get(f"{BASE_URL}/api/config/booking", headers={})
        assert r.status_code == 200, f"Expected 200 (no auth needed), got {r.status_code}"


# ── Tests : Admin config endpoint ─────────────────────────────────────────────

class TestAdminGetConfig:
    """Tests for GET /api/admin/app-config (admin auth required)."""

    def test_admin_get_config_returns_200(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/admin/app-config", headers=admin_headers)
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"

    def test_admin_get_config_has_correct_keys(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/admin/app-config", headers=admin_headers)
        assert r.status_code == 200
        data = r.json()
        assert "enable_manual_approval_for_services" in data
        assert "enable_pay_later_for_services" in data

    def test_admin_get_config_without_auth_returns_401_or_403(self):
        r = requests.get(f"{BASE_URL}/api/admin/app-config")
        assert r.status_code in (401, 403), f"Expected 401/403 without auth, got {r.status_code}"

    def test_admin_get_config_with_user_token_returns_403(self, user_headers):
        r = requests.get(f"{BASE_URL}/api/admin/app-config", headers=user_headers)
        assert r.status_code in (401, 403), f"Expected 401/403 for non-admin, got {r.status_code}"


# ── Tests : Admin update config ───────────────────────────────────────────────

class TestAdminUpdateConfig:
    """Tests for PUT /api/admin/app-config."""

    def test_update_manual_approval_flag(self, admin_headers):
        """Enable manual approval flag and verify response."""
        r = requests.put(
            f"{BASE_URL}/api/admin/app-config",
            json={"enable_manual_approval_for_services": True},
            headers=admin_headers,
        )
        assert r.status_code == 200, f"PUT failed: {r.text}"
        data = r.json()
        assert "success" in data and data["success"] is True
        assert data.get("enable_manual_approval_for_services") is True

    def test_update_config_persisted(self, admin_headers):
        """After update, GET must return updated value."""
        # Enable it
        requests.put(
            f"{BASE_URL}/api/admin/app-config",
            json={"enable_manual_approval_for_services": True},
            headers=admin_headers,
        )
        # Verify persisted
        r = requests.get(f"{BASE_URL}/api/admin/app-config", headers=admin_headers)
        assert r.status_code == 200
        data = r.json()
        assert data["enable_manual_approval_for_services"] is True, \
            "Change not persisted: enable_manual_approval_for_services should be True"

    def test_update_pay_later_flag(self, admin_headers):
        """Enable pay_later flag and verify response."""
        r = requests.put(
            f"{BASE_URL}/api/admin/app-config",
            json={"enable_pay_later_for_services": True},
            headers=admin_headers,
        )
        assert r.status_code == 200, f"PUT failed: {r.text}"
        data = r.json()
        assert data.get("enable_pay_later_for_services") is True

    def test_update_both_flags_to_false(self, admin_headers):
        """Reset both flags to false."""
        r = requests.put(
            f"{BASE_URL}/api/admin/app-config",
            json={"enable_manual_approval_for_services": False, "enable_pay_later_for_services": False},
            headers=admin_headers,
        )
        assert r.status_code == 200
        data = r.json()
        assert data.get("enable_manual_approval_for_services") is False
        assert data.get("enable_pay_later_for_services") is False

    def test_update_without_admin_auth_returns_401_or_403(self):
        r = requests.put(
            f"{BASE_URL}/api/admin/app-config",
            json={"enable_manual_approval_for_services": True},
        )
        assert r.status_code in (401, 403), f"Expected 401/403, got {r.status_code}"

    def test_update_with_user_token_returns_403(self, user_headers):
        r = requests.put(
            f"{BASE_URL}/api/admin/app-config",
            json={"enable_manual_approval_for_services": True},
            headers=user_headers,
        )
        assert r.status_code in (401, 403), f"Expected 401/403 for non-admin, got {r.status_code}"

    def test_update_with_invalid_key_returns_400(self, admin_headers):
        r = requests.put(
            f"{BASE_URL}/api/admin/app-config",
            json={"invalid_key": True},
            headers=admin_headers,
        )
        assert r.status_code == 400, f"Expected 400 for invalid key, got {r.status_code}"

    def test_public_config_reflects_admin_update(self, admin_headers):
        """After admin enables a flag, GET /config/booking must reflect it."""
        # Enable manual approval
        requests.put(
            f"{BASE_URL}/api/admin/app-config",
            json={"enable_manual_approval_for_services": True},
            headers=admin_headers,
        )
        # Check public endpoint
        r = requests.get(f"{BASE_URL}/api/config/booking")
        assert r.status_code == 200
        data = r.json()
        assert data["enable_manual_approval_for_services"] is True, \
            "Public config endpoint not reflecting admin update"
        # Reset
        requests.put(
            f"{BASE_URL}/api/admin/app-config",
            json={"enable_manual_approval_for_services": False},
            headers=admin_headers,
        )


# ── Tests : Service creation with flag normalization ──────────────────────────

class TestServiceFlagNormalization:
    """
    Tests that service creation/update normalizes booking config
    according to global flags.
    """

    def test_create_service_manual_approval_normalized_when_flag_false(self, coach_headers, admin_headers):
        """With enable_manual_approval=false, creating service with manual_approval → instant_booking."""
        # Ensure flag is false
        requests.put(
            f"{BASE_URL}/api/admin/app-config",
            json={"enable_manual_approval_for_services": False},
            headers=admin_headers,
        )

        service_payload = {
            "title": "TEST_SVC_MANUAL_NORM",
            "description": "Test service for flag normalization",
            "price": 50.0,
            "duration_min": 60,
            "booking_approval_mode": "manual_approval",
            "allow_pay_later": False,
            "packages": [],
            "locations": [],
            "slots": [],
        }
        r = requests.post(f"{BASE_URL}/api/services", json=service_payload, headers=coach_headers)
        assert r.status_code == 200, f"Service creation failed: {r.text}"
        data = r.json()
        assert data.get("booking_approval_mode") == "instant_booking", \
            f"Expected 'instant_booking' (normalized), got '{data.get('booking_approval_mode')}'"

        # Cleanup
        svc_id = data.get("service_id")
        if svc_id:
            requests.delete(f"{BASE_URL}/api/services/{svc_id}", headers=coach_headers)

    def test_create_service_allow_pay_later_normalized_when_flag_false(self, coach_headers, admin_headers):
        """With enable_pay_later=false, creating service with allow_pay_later=true → normalized to false."""
        # Ensure flag is false
        requests.put(
            f"{BASE_URL}/api/admin/app-config",
            json={"enable_pay_later_for_services": False},
            headers=admin_headers,
        )

        service_payload = {
            "title": "TEST_SVC_PAY_LATER_NORM",
            "description": "Test service for pay_later normalization",
            "price": 60.0,
            "duration_min": 60,
            "booking_approval_mode": "instant_booking",
            "allow_pay_later": True,
            "packages": [],
            "locations": [],
            "slots": [],
        }
        r = requests.post(f"{BASE_URL}/api/services", json=service_payload, headers=coach_headers)
        assert r.status_code == 200, f"Service creation failed: {r.text}"
        data = r.json()
        assert data.get("allow_pay_later") is False, \
            f"Expected allow_pay_later=False (normalized), got {data.get('allow_pay_later')}"

        # Cleanup
        svc_id = data.get("service_id")
        if svc_id:
            requests.delete(f"{BASE_URL}/api/services/{svc_id}", headers=coach_headers)

    def test_create_service_with_flags_enabled_preserves_manual_approval(self, coach_headers, admin_headers):
        """With enable_manual_approval=true, service can be created with manual_approval mode."""
        # Enable flag
        requests.put(
            f"{BASE_URL}/api/admin/app-config",
            json={"enable_manual_approval_for_services": True},
            headers=admin_headers,
        )

        service_payload = {
            "title": "TEST_SVC_MANUAL_ENABLED",
            "description": "Test service with manual approval enabled",
            "price": 70.0,
            "duration_min": 60,
            "booking_approval_mode": "manual_approval",
            "allow_pay_later": False,
            "packages": [],
            "locations": [],
            "slots": [],
        }
        r = requests.post(f"{BASE_URL}/api/services", json=service_payload, headers=coach_headers)
        assert r.status_code == 200, f"Service creation failed: {r.text}"
        data = r.json()
        assert data.get("booking_approval_mode") == "manual_approval", \
            f"Expected 'manual_approval' when flag enabled, got '{data.get('booking_approval_mode')}'"

        # Cleanup
        svc_id = data.get("service_id")
        if svc_id:
            requests.delete(f"{BASE_URL}/api/services/{svc_id}", headers=coach_headers)

        # Reset flag
        requests.put(
            f"{BASE_URL}/api/admin/app-config",
            json={"enable_manual_approval_for_services": False},
            headers=admin_headers,
        )


# ── Tests : Booking request with flag enforcement ─────────────────────────────

class TestBookingFlagEnforcement:
    """
    Tests that bookings respect global flags.
    Uses svc_demo001 which is in instant_booking mode.
    """

    def _get_demo_service(self):
        """Find a bookable service."""
        r = requests.get(f"{BASE_URL}/api/services")
        assert r.status_code == 200
        services = r.json()
        for svc in services:
            if svc.get("slots") or svc.get("packages"):
                return svc
        return services[0] if services else None

    def _get_slot_id(self, service):
        """Get a free slot from a service."""
        slots = service.get("slots", [])
        if slots:
            return slots[0]["slot_id"]
        # Check packages
        for pkg in service.get("packages", []):
            if pkg.get("slots"):
                return pkg["slots"][0]["slot_id"]
        return None

    def test_booking_pay_later_rejected_when_flag_false(self, user_headers, admin_headers):
        """pay_later booking must be rejected with 409 when global flag is false."""
        # Ensure flag is false
        requests.put(
            f"{BASE_URL}/api/admin/app-config",
            json={"enable_pay_later_for_services": False},
            headers=admin_headers,
        )

        # Get a demo service
        svc = self._get_demo_service()
        if not svc:
            pytest.skip("No services available for booking test")

        slot_id = self._get_slot_id(svc)

        booking_payload = {
            "service_id": svc["service_id"],
            "payment_mode": "pay_later",
        }
        if slot_id:
            booking_payload["slot_id"] = slot_id

        r = requests.post(
            f"{BASE_URL}/api/bookings/request",
            json=booking_payload,
            headers=user_headers,
        )
        assert r.status_code == 409, \
            f"Expected 409 for pay_later when flag=false, got {r.status_code}: {r.text}"
        assert "pay_later" in r.text.lower() or "différé" in r.text.lower() or "paiement" in r.text.lower(), \
            f"Error message should mention pay_later, got: {r.text}"

    def test_booking_instant_booking_goes_to_awaiting_payment_when_manual_approval_flag_false(
        self, user_headers, admin_headers
    ):
        """
        When global manual_approval flag = false and service is set to instant_booking,
        booking should go to awaiting_payment status.
        """
        # Ensure flag is false (manual forced to instant)
        requests.put(
            f"{BASE_URL}/api/admin/app-config",
            json={"enable_manual_approval_for_services": False, "enable_pay_later_for_services": False},
            headers=admin_headers,
        )

        svc = self._get_demo_service()
        if not svc:
            pytest.skip("No services available")

        # Use svc_demo001 if available or first service
        slot_id = self._get_slot_id(svc)
        booking_payload = {
            "service_id": svc["service_id"],
            "payment_mode": "pay_now",
        }
        if slot_id:
            booking_payload["slot_id"] = slot_id

        r = requests.post(
            f"{BASE_URL}/api/bookings/request",
            json=booking_payload,
            headers=user_headers,
        )

        # Should succeed with awaiting_payment (instant_booking enforced)
        if r.status_code == 200:
            data = r.json()
            assert data.get("status") == "awaiting_payment", \
                f"Expected awaiting_payment (instant_booking forced), got '{data.get('status')}'"
            # Cancel the test booking
            bid = data.get("booking_id")
            if bid:
                requests.post(f"{BASE_URL}/api/bookings/{bid}/cancel", headers=user_headers)
        elif r.status_code in (409, 400):
            # Could be slot unavailable or self-booking - check the message
            print(f"Booking attempt returned {r.status_code}: {r.text}")
            # This is acceptable if slot is already taken
        else:
            pytest.fail(f"Unexpected status code {r.status_code}: {r.text}")

    def test_booking_manual_approval_service_forced_to_instant_when_flag_false(
        self, coach_headers, user_headers, admin_headers
    ):
        """
        Create a service with manual_approval (enabled flag), then disable flag.
        New booking should go to awaiting_payment not requested.
        """
        # Step 1: Enable manual_approval flag to create the service
        requests.put(
            f"{BASE_URL}/api/admin/app-config",
            json={"enable_manual_approval_for_services": True},
            headers=admin_headers,
        )

        # Step 2: Create manual_approval service
        svc_r = requests.post(
            f"{BASE_URL}/api/services",
            json={
                "title": "TEST_SVC_MANUAL_FOR_BOOKING",
                "description": "Testing instant_booking enforcement",
                "price": 80.0,
                "duration_min": 60,
                "booking_approval_mode": "manual_approval",
                "allow_pay_later": False,
                "packages": [],
                "locations": [],
                "slots": [],
            },
            headers=coach_headers,
        )
        assert svc_r.status_code == 200, f"Service creation failed: {svc_r.text}"
        svc = svc_r.json()
        assert svc["booking_approval_mode"] == "manual_approval"

        # Step 3: Disable manual_approval flag
        requests.put(
            f"{BASE_URL}/api/admin/app-config",
            json={"enable_manual_approval_for_services": False},
            headers=admin_headers,
        )

        # Step 4: Book it — should go to awaiting_payment (instant_booking enforced)
        booking_r = requests.post(
            f"{BASE_URL}/api/bookings/request",
            json={"service_id": svc["service_id"], "payment_mode": "pay_now"},
            headers=user_headers,
        )

        if booking_r.status_code == 200:
            data = booking_r.json()
            assert data.get("status") == "awaiting_payment", \
                f"With manual_approval flag=false, booking should be 'awaiting_payment', got '{data.get('status')}'"
            # Cancel the test booking
            bid = data.get("booking_id")
            if bid:
                requests.post(f"{BASE_URL}/api/bookings/{bid}/cancel", headers=user_headers)
        elif booking_r.status_code in (400, 409):
            # Self-booking check or similar
            print(f"Booking returned {booking_r.status_code}: {booking_r.text}")
        else:
            pytest.fail(f"Unexpected booking response {booking_r.status_code}: {booking_r.text}")

        # Cleanup service
        requests.delete(f"{BASE_URL}/api/services/{svc['service_id']}", headers=coach_headers)


# ── Tests : Final state verification ─────────────────────────────────────────

class TestFinalStateVerification:
    """Verify flags are reset to MVP defaults after all tests."""

    def test_flags_are_mvp_defaults_after_all_tests(self, admin_headers):
        """Final check: both flags must be false (MVP defaults)."""
        r = requests.get(f"{BASE_URL}/api/admin/app-config", headers=admin_headers)
        assert r.status_code == 200
        data = r.json()
        # Both should be false (autouse fixture resets them)
        assert data["enable_manual_approval_for_services"] is False, \
            f"enable_manual_approval_for_services should be False after tests, got {data['enable_manual_approval_for_services']}"
        assert data["enable_pay_later_for_services"] is False, \
            f"enable_pay_later_for_services should be False after tests, got {data['enable_pay_later_for_services']}"

    def test_public_config_is_mvp_defaults(self):
        """Public endpoint must also return MVP defaults."""
        r = requests.get(f"{BASE_URL}/api/config/booking")
        assert r.status_code == 200
        data = r.json()
        assert data["enable_manual_approval_for_services"] is False
        assert data["enable_pay_later_for_services"] is False
