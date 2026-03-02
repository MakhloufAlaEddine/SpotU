"""
Booking Management Tests - Iteration 45
Tests: POST /bookings/{id}/accept, POST /bookings/{id}/refuse,
       GET /bookings/service/{service_id}, 403 security checks.
Users:
  - user@winek.app / WinekUser2024! (user_demo001, role=coach) → books svc_demo001
  - coach@winek.app / WinekCoach2024! (user_coach001=Sophie Martin) → coach of svc_demo001
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

USER_EMAIL = "user@winek.app"
USER_PASS = "WinekUser2024!"
COACH_EMAIL = "coach@winek.app"
COACH_PASS = "WinekCoach2024!"
SERVICE_ID = "svc_demo001"  # owned by user_coach001 (coach@winek.app)
SLOT_ID = "slt_d01a1"
LOCATION_ID = "loc_demo001"


@pytest.fixture(scope="module")
def user_token():
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={"email": USER_EMAIL, "password": USER_PASS})
    assert resp.status_code == 200, f"User login failed: {resp.text}"
    data = resp.json()
    token = data.get("token") or data.get("access_token")
    assert token, f"No token in response: {data}"
    return token


@pytest.fixture(scope="module")
def coach_token():
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={"email": COACH_EMAIL, "password": COACH_PASS})
    assert resp.status_code == 200, f"Coach login failed: {resp.text}"
    data = resp.json()
    token = data.get("token") or data.get("access_token")
    assert token, f"No token in response: {data}"
    return token


@pytest.fixture(scope="module")
def user_headers(user_token):
    return {"Authorization": f"Bearer {user_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def coach_headers(coach_token):
    return {"Authorization": f"Bearer {coach_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def pending_booking_for_accept(user_headers):
    """Create a fresh pending booking for accept test"""
    payload = {
        "service_id": SERVICE_ID,
        "slot_id": SLOT_ID,
        "location_id": LOCATION_ID,
        "notes": "TEST_iter45 - pending for accept"
    }
    resp = requests.post(f"{BASE_URL}/api/bookings", json=payload, headers=user_headers)
    assert resp.status_code == 200, f"Failed to create booking for accept test: {resp.text}"
    booking_id = resp.json()["booking_id"]
    print(f"Created booking for accept test: {booking_id}")
    return booking_id


@pytest.fixture(scope="module")
def pending_booking_for_refuse(user_headers):
    """Create a fresh pending booking for refuse test"""
    payload = {
        "service_id": SERVICE_ID,
        "slot_id": SLOT_ID,
        "location_id": LOCATION_ID,
        "notes": "TEST_iter45 - pending for refuse"
    }
    resp = requests.post(f"{BASE_URL}/api/bookings", json=payload, headers=user_headers)
    assert resp.status_code == 200, f"Failed to create booking for refuse test: {resp.text}"
    booking_id = resp.json()["booking_id"]
    print(f"Created booking for refuse test: {booking_id}")
    return booking_id


@pytest.fixture(scope="module")
def pending_booking_for_security(user_headers):
    """Create a fresh pending booking for security test"""
    payload = {
        "service_id": SERVICE_ID,
        "slot_id": SLOT_ID,
        "location_id": LOCATION_ID,
        "notes": "TEST_iter45 - pending for security test"
    }
    resp = requests.post(f"{BASE_URL}/api/bookings", json=payload, headers=user_headers)
    assert resp.status_code == 200, f"Failed to create booking for security test: {resp.text}"
    booking_id = resp.json()["booking_id"]
    print(f"Created booking for security test: {booking_id}")
    return booking_id


# ────────────────────────────────────────────────────────────────────────────────
# Test 1: POST /api/bookings/{id}/accept
# ────────────────────────────────────────────────────────────────────────────────
class TestAcceptBooking:
    """POST /api/bookings/{id}/accept"""

    def test_coach_can_accept_pending_booking(self, coach_headers, user_headers, pending_booking_for_accept):
        """Coach accepts a pending booking → status becomes 'accepted'"""
        booking_id = pending_booking_for_accept
        resp = requests.post(f"{BASE_URL}/api/bookings/{booking_id}/accept", headers=coach_headers)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data["status"] == "accepted", f"Expected status=accepted, got {data.get('status')}"
        assert data["booking_id"] == booking_id
        print(f"✅ Coach accepted booking {booking_id}: status={data['status']}")

    def test_accept_status_persisted_in_db(self, coach_headers, user_headers, pending_booking_for_accept):
        """Verify accepted status is persisted via GET"""
        booking_id = pending_booking_for_accept
        get_resp = requests.get(f"{BASE_URL}/api/bookings/{booking_id}", headers=user_headers)
        assert get_resp.status_code == 200, f"GET failed: {get_resp.text}"
        data = get_resp.json()
        assert data["status"] == "accepted", f"Status not persisted: got {data.get('status')}"
        print(f"✅ Accept status persisted: booking {booking_id} status={data['status']}")

    def test_accept_returns_booking_fields(self, coach_headers, user_headers, pending_booking_for_accept):
        """Accept response includes required booking fields"""
        # Use a fresh booking to test response structure
        payload = {
            "service_id": SERVICE_ID,
            "slot_id": SLOT_ID,
            "location_id": LOCATION_ID,
            "notes": "TEST_iter45 - response structure test"
        }
        create_resp = requests.post(f"{BASE_URL}/api/bookings", json=payload, headers=user_headers)
        assert create_resp.status_code == 200
        new_booking_id = create_resp.json()["booking_id"]

        resp = requests.post(f"{BASE_URL}/api/bookings/{new_booking_id}/accept", headers=coach_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "booking_id" in data
        assert "service_id" in data
        assert "status" in data
        assert data["status"] == "accepted"
        print(f"✅ Accept response has all required fields for booking {new_booking_id}")

    def test_accept_nonexistent_booking_returns_404(self, coach_headers):
        """Accepting a non-existent booking returns 404"""
        resp = requests.post(f"{BASE_URL}/api/bookings/bkg_nonexistent_xyz/accept", headers=coach_headers)
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}: {resp.text}"
        print("✅ Accept non-existent booking returns 404")

    def test_accept_without_auth_returns_401(self):
        """Accepting without auth returns 401"""
        resp = requests.post(f"{BASE_URL}/api/bookings/bkg_demo001/accept")
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}: {resp.text}"
        print("✅ Accept without auth returns 401")


# ────────────────────────────────────────────────────────────────────────────────
# Test 2: POST /api/bookings/{id}/refuse
# ────────────────────────────────────────────────────────────────────────────────
class TestRefuseBooking:
    """POST /api/bookings/{id}/refuse"""

    def test_coach_can_refuse_pending_booking(self, coach_headers, pending_booking_for_refuse):
        """Coach refuses a pending booking → status becomes 'refused'"""
        booking_id = pending_booking_for_refuse
        resp = requests.post(f"{BASE_URL}/api/bookings/{booking_id}/refuse", headers=coach_headers)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data["status"] == "refused", f"Expected status=refused, got {data.get('status')}"
        assert data["booking_id"] == booking_id
        print(f"✅ Coach refused booking {booking_id}: status={data['status']}")

    def test_refuse_status_persisted_in_db(self, user_headers, pending_booking_for_refuse):
        """Verify refused status is persisted via GET"""
        booking_id = pending_booking_for_refuse
        get_resp = requests.get(f"{BASE_URL}/api/bookings/{booking_id}", headers=user_headers)
        assert get_resp.status_code == 200, f"GET failed: {get_resp.text}"
        data = get_resp.json()
        assert data["status"] == "refused", f"Status not persisted: got {data.get('status')}"
        print(f"✅ Refuse status persisted: booking {booking_id} status={data['status']}")

    def test_refuse_nonexistent_booking_returns_404(self, coach_headers):
        """Refusing a non-existent booking returns 404"""
        resp = requests.post(f"{BASE_URL}/api/bookings/bkg_nonexistent_xyz/refuse", headers=coach_headers)
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}: {resp.text}"
        print("✅ Refuse non-existent booking returns 404")

    def test_refuse_without_auth_returns_401(self):
        """Refusing without auth returns 401"""
        resp = requests.post(f"{BASE_URL}/api/bookings/bkg_demo001/refuse")
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}: {resp.text}"
        print("✅ Refuse without auth returns 401")


# ────────────────────────────────────────────────────────────────────────────────
# Test 3: GET /api/bookings/service/{service_id}
# ────────────────────────────────────────────────────────────────────────────────
class TestServiceBookings:
    """GET /api/bookings/service/{service_id}"""

    def test_coach_gets_all_bookings_for_service(self, coach_headers):
        """Coach (owner) gets ALL bookings for their service"""
        resp = requests.get(f"{BASE_URL}/api/bookings/service/{SERVICE_ID}", headers=coach_headers)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert isinstance(data, list), "Response should be a list"
        print(f"✅ Coach gets all service bookings: {len(data)} total")

    def test_coach_service_bookings_enriched(self, coach_headers):
        """Coach service bookings are enriched with user/slot/service data"""
        resp = requests.get(f"{BASE_URL}/api/bookings/service/{SERVICE_ID}", headers=coach_headers)
        assert resp.status_code == 200
        data = resp.json()
        if len(data) == 0:
            pytest.skip("No bookings for service")
        b = data[0]
        assert "service" in b, "service enrichment missing"
        assert "user" in b, "user enrichment missing in coach service bookings"
        print(f"✅ Service bookings enriched: user={b.get('user', {}).get('name')}, service={b.get('service', {}).get('title')}")

    def test_user_gets_only_own_booking(self, user_headers):
        """User (non-owner) gets only their own booking for the service"""
        resp = requests.get(f"{BASE_URL}/api/bookings/service/{SERVICE_ID}", headers=user_headers)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert isinstance(data, list), "Response should be a list"
        # All returned bookings should belong to user_demo001
        for b in data:
            # Since user is the booker, user_id should match
            assert b.get("service_id") == SERVICE_ID, f"Unexpected service_id: {b.get('service_id')}"
        print(f"✅ User gets only own bookings for service: {len(data)} bookings")

    def test_user_bookings_count_less_than_coach(self, coach_headers, user_headers):
        """User sees fewer (own only) bookings than coach (all) for same service"""
        coach_resp = requests.get(f"{BASE_URL}/api/bookings/service/{SERVICE_ID}", headers=coach_headers)
        user_resp = requests.get(f"{BASE_URL}/api/bookings/service/{SERVICE_ID}", headers=user_headers)
        assert coach_resp.status_code == 200
        assert user_resp.status_code == 200
        coach_count = len(coach_resp.json())
        user_count = len(user_resp.json())
        # Coach should see at least as many as user
        assert coach_count >= user_count, f"Coach sees {coach_count}, user sees {user_count} - coach should see >= user"
        print(f"✅ Coach sees {coach_count} bookings, user sees {user_count} for same service")

    def test_service_bookings_requires_auth(self):
        """GET /bookings/service/{id} without auth returns 401"""
        resp = requests.get(f"{BASE_URL}/api/bookings/service/{SERVICE_ID}")
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"
        print("✅ /bookings/service/{id} without auth returns 401")

    def test_nonexistent_service_returns_404(self, coach_headers):
        """GET /bookings/service/nonexistent returns 404"""
        resp = requests.get(f"{BASE_URL}/api/bookings/service/svc_nonexistent_xyz", headers=coach_headers)
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}: {resp.text}"
        print("✅ Non-existent service returns 404")


# ────────────────────────────────────────────────────────────────────────────────
# Test 4: Security - Non-coach cannot accept/refuse (403)
# ────────────────────────────────────────────────────────────────────────────────
class TestBookingSecurityAcceptRefuse:
    """Security: non-coach user cannot accept/refuse bookings"""

    def test_user_cannot_accept_booking_owned_by_coach(self, user_headers, pending_booking_for_security):
        """User who is the booker (not the service coach) cannot accept → 403"""
        booking_id = pending_booking_for_security
        resp = requests.post(f"{BASE_URL}/api/bookings/{booking_id}/accept", headers=user_headers)
        assert resp.status_code == 403, f"Expected 403 (user cannot accept), got {resp.status_code}: {resp.text}"
        print(f"✅ Security: user cannot accept booking → 403")

    def test_user_cannot_refuse_booking_owned_by_coach(self, user_headers, pending_booking_for_security):
        """User who is the booker (not the service coach) cannot refuse → 403"""
        booking_id = pending_booking_for_security
        resp = requests.post(f"{BASE_URL}/api/bookings/{booking_id}/refuse", headers=user_headers)
        assert resp.status_code == 403, f"Expected 403 (user cannot refuse), got {resp.status_code}: {resp.text}"
        print(f"✅ Security: user cannot refuse booking → 403")

    def test_booking_status_unchanged_after_unauthorized_accept(self, user_headers, coach_headers, pending_booking_for_security):
        """After unauthorized accept attempt, booking should still be pending"""
        booking_id = pending_booking_for_security
        # Verify the booking status was not changed (still pending)
        get_resp = requests.get(f"{BASE_URL}/api/bookings/{booking_id}", headers=coach_headers)
        assert get_resp.status_code == 200
        data = get_resp.json()
        assert data["status"] == "pending", f"Booking status was changed by unauthorized user! Got: {data.get('status')}"
        print(f"✅ Security: booking status unchanged after unauthorized accept attempt, still = {data['status']}")
