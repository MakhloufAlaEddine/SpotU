"""
Booking system tests - Iteration 44
Tests: POST /bookings, GET /bookings/mine, GET /bookings/coach, PUT /bookings/{id}/status
Users:
  - user@winek.app / WinekUser2024! (user_demo001, role=coach) → books svc_demo001 (owned by user_coach001)
  - coach@winek.app / WinekCoach2024! (user_coach001) → accepts/refuses bookings for svc_demo001
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

USER_EMAIL = "user@winek.app"
USER_PASS = "WinekUser2024!"
COACH_EMAIL = "coach@winek.app"
COACH_PASS = "WinekCoach2024!"

# svc_demo001 is owned by user_coach001 (coach@winek.app), so user@winek.app CAN book it
SERVICE_ID = "svc_demo001"
# A valid slot for svc_demo001
SLOT_ID = "slt_d01a1"
LOCATION_ID = "loc_demo001"


@pytest.fixture(scope="module")
def user_token():
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={"email": USER_EMAIL, "password": USER_PASS})
    assert resp.status_code == 200, f"User login failed: {resp.text}"
    return resp.json()["token"]


@pytest.fixture(scope="module")
def coach_token():
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={"email": COACH_EMAIL, "password": COACH_PASS})
    assert resp.status_code == 200, f"Coach login failed: {resp.text}"
    return resp.json()["token"]


@pytest.fixture(scope="module")
def user_headers(user_token):
    return {"Authorization": f"Bearer {user_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def coach_headers(coach_token):
    return {"Authorization": f"Bearer {coach_token}", "Content-Type": "application/json"}


# ──────────────────────────────────────────────────────────────────────────────
# Test 1: POST /api/bookings - Create a new booking (user books svc_demo001)
# ──────────────────────────────────────────────────────────────────────────────
class TestCreateBooking:
    """POST /api/bookings - Create booking as user"""

    def test_create_booking_success(self, user_headers):
        """User can create a booking for a service they don't own"""
        payload = {
            "service_id": SERVICE_ID,
            "slot_id": SLOT_ID,
            "location_id": LOCATION_ID,
            "notes": "TEST_iter44 - Je commence le sport, très motivé !"
        }
        resp = requests.post(f"{BASE_URL}/api/bookings", json=payload, headers=user_headers)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert "booking_id" in data, "booking_id missing from response"
        assert data["service_id"] == SERVICE_ID
        assert data["status"] == "pending", f"Expected status=pending, got {data.get('status')}"
        assert data["slot_id"] == SLOT_ID
        # Store created booking_id for later tests
        TestCreateBooking.created_booking_id = data["booking_id"]
        print(f"✅ Created booking: {data['booking_id']}")

    def test_create_booking_has_amount(self, user_headers):
        """Booking response includes amount and commission"""
        # Uses the booking created in previous test
        booking_id = getattr(TestCreateBooking, 'created_booking_id', None)
        if not booking_id:
            pytest.skip("No booking_id from previous test")
        resp = requests.get(f"{BASE_URL}/api/bookings/{booking_id}", headers=user_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("amount") is not None, "amount is missing"
        assert data.get("commission") is not None, "commission is missing"
        assert float(data["amount"]) > 0, "amount should be > 0"
        print(f"✅ Amount: {data['amount']}€, Commission: {data['commission']}€")

    def test_cannot_book_own_service(self, coach_headers):
        """Coach cannot book their own service"""
        payload = {
            "service_id": SERVICE_ID,
            "slot_id": SLOT_ID,
            "notes": "TEST - own service booking attempt"
        }
        resp = requests.post(f"{BASE_URL}/api/bookings", json=payload, headers=coach_headers)
        assert resp.status_code == 400, f"Expected 400 (own service), got {resp.status_code}: {resp.text}"
        print("✅ Cannot book own service - correctly rejected with 400")

    def test_booking_requires_auth(self):
        """Booking without auth returns 401"""
        payload = {"service_id": SERVICE_ID, "slot_id": SLOT_ID}
        resp = requests.post(f"{BASE_URL}/api/bookings", json=payload)
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"
        print("✅ Booking without auth returns 401")

    def test_booking_nonexistent_service(self, user_headers):
        """Booking a non-existent service returns 404"""
        payload = {"service_id": "svc_nonexistent_xyz"}
        resp = requests.post(f"{BASE_URL}/api/bookings", json=payload, headers=user_headers)
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}: {resp.text}"
        print("✅ Non-existent service returns 404")


# ──────────────────────────────────────────────────────────────────────────────
# Test 2: GET /api/bookings/mine - User's own bookings
# ──────────────────────────────────────────────────────────────────────────────
class TestGetMyBookings:
    """GET /api/bookings/mine"""

    def test_get_my_bookings_authenticated(self, user_headers):
        """Authenticated user can get their bookings"""
        resp = requests.get(f"{BASE_URL}/api/bookings/mine", headers=user_headers)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert isinstance(data, list), "Response should be a list"
        print(f"✅ GET /bookings/mine: {len(data)} bookings")

    def test_my_bookings_have_enriched_data(self, user_headers):
        """Bookings are enriched with service, coach, slot data"""
        resp = requests.get(f"{BASE_URL}/api/bookings/mine", headers=user_headers)
        assert resp.status_code == 200
        data = resp.json()
        if len(data) == 0:
            pytest.skip("No bookings to validate enrichment")
        b = data[0]
        # Verify enrichment
        assert "service" in b, "service enrichment missing"
        assert "coach" in b, "coach enrichment missing"
        assert "slot" in b or b.get("slot_id") is None, "slot enrichment expected if slot_id present"
        print(f"✅ Bookings enriched with service={b.get('service',{}).get('title')}, coach={b.get('coach',{}).get('name')}")

    def test_my_bookings_requires_auth(self):
        """GET /bookings/mine without auth returns 401"""
        resp = requests.get(f"{BASE_URL}/api/bookings/mine")
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"
        print("✅ /bookings/mine without auth returns 401")

    def test_my_bookings_contains_created_booking(self, user_headers):
        """The booking we created appears in /bookings/mine"""
        booking_id = getattr(TestCreateBooking, 'created_booking_id', None)
        if not booking_id:
            pytest.skip("No booking_id from create test")
        resp = requests.get(f"{BASE_URL}/api/bookings/mine", headers=user_headers)
        assert resp.status_code == 200
        data = resp.json()
        ids = [b["booking_id"] for b in data]
        assert booking_id in ids, f"Created booking {booking_id} not found in /bookings/mine"
        print(f"✅ Created booking {booking_id} found in /bookings/mine")


# ──────────────────────────────────────────────────────────────────────────────
# Test 3: GET /api/bookings/coach - Coach bookings list
# ──────────────────────────────────────────────────────────────────────────────
class TestGetCoachBookings:
    """GET /api/bookings/coach"""

    def test_coach_can_get_bookings(self, coach_headers):
        """Coach can get their incoming bookings"""
        resp = requests.get(f"{BASE_URL}/api/bookings/coach", headers=coach_headers)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert isinstance(data, list), "Response should be a list"
        print(f"✅ GET /bookings/coach: {len(data)} bookings")

    def test_coach_bookings_enriched(self, coach_headers):
        """Coach bookings are enriched with user, slot, service data"""
        resp = requests.get(f"{BASE_URL}/api/bookings/coach", headers=coach_headers)
        assert resp.status_code == 200
        data = resp.json()
        if len(data) == 0:
            pytest.skip("No coach bookings to validate enrichment")
        b = data[0]
        assert "user" in b, "user enrichment missing in coach bookings"
        assert "service" in b, "service enrichment missing in coach bookings"
        print(f"✅ Coach bookings enriched: user={b.get('user',{}).get('name')}")

    def test_coach_bookings_contains_new_booking(self, coach_headers):
        """The newly created booking appears in coach's list"""
        booking_id = getattr(TestCreateBooking, 'created_booking_id', None)
        if not booking_id:
            pytest.skip("No booking_id from create test")
        resp = requests.get(f"{BASE_URL}/api/bookings/coach", headers=coach_headers)
        assert resp.status_code == 200
        data = resp.json()
        ids = [b["booking_id"] for b in data]
        assert booking_id in ids, f"Created booking {booking_id} not found in /bookings/coach"
        print(f"✅ New booking {booking_id} found in /bookings/coach")

    def test_non_coach_cannot_access_coach_bookings(self):
        """Non-authenticated user cannot access coach bookings"""
        resp = requests.get(f"{BASE_URL}/api/bookings/coach")
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"
        print("✅ /bookings/coach without auth returns 401")


# ──────────────────────────────────────────────────────────────────────────────
# Test 4: PUT /api/bookings/{id}/status - Accept/Refuse booking
# ──────────────────────────────────────────────────────────────────────────────
class TestUpdateBookingStatus:
    """PUT /api/bookings/{id}/status"""

    @pytest.fixture(scope="class")
    def new_booking_for_status_test(self, user_headers):
        """Create a fresh booking specifically for status tests"""
        payload = {
            "service_id": SERVICE_ID,
            "slot_id": "slt_d01b1",  # different slot to avoid conflict
            "location_id": LOCATION_ID,
            "notes": "TEST_iter44_status - test accept/refuse"
        }
        resp = requests.post(f"{BASE_URL}/api/bookings", json=payload, headers=user_headers)
        if resp.status_code == 200:
            return resp.json()["booking_id"]
        # If slot already booked or other error, use the created booking from before
        return getattr(TestCreateBooking, 'created_booking_id', None)

    def test_coach_can_accept_booking(self, coach_headers, user_headers):
        """Coach can accept a pending booking"""
        # Create a fresh booking
        payload = {
            "service_id": SERVICE_ID,
            "slot_id": "slt_d01a2",
            "location_id": LOCATION_ID,
            "notes": "TEST_iter44 - accept test"
        }
        create_resp = requests.post(f"{BASE_URL}/api/bookings", json=payload, headers=user_headers)
        assert create_resp.status_code == 200, f"Failed to create booking: {create_resp.text}"
        booking_id = create_resp.json()["booking_id"]

        # Accept it
        resp = requests.put(
            f"{BASE_URL}/api/bookings/{booking_id}/status",
            json={"status": "accepted"},
            headers=coach_headers
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data["status"] == "accepted", f"Expected status=accepted, got {data.get('status')}"
        print(f"✅ Coach accepted booking {booking_id}: status={data['status']}")

        # Verify via GET
        get_resp = requests.get(f"{BASE_URL}/api/bookings/{booking_id}", headers=user_headers)
        assert get_resp.status_code == 200
        assert get_resp.json()["status"] == "accepted", "Status not persisted"
        print(f"✅ Verified: booking {booking_id} status=accepted persisted in DB")

    def test_coach_can_refuse_booking(self, coach_headers, user_headers):
        """Coach can refuse a pending booking"""
        # Create a fresh booking
        payload = {
            "service_id": SERVICE_ID,
            "slot_id": "slt_d01a3",
            "location_id": LOCATION_ID,
            "notes": "TEST_iter44 - refuse test"
        }
        create_resp = requests.post(f"{BASE_URL}/api/bookings", json=payload, headers=user_headers)
        assert create_resp.status_code == 200, f"Failed to create booking: {create_resp.text}"
        booking_id = create_resp.json()["booking_id"]

        # Refuse it
        resp = requests.put(
            f"{BASE_URL}/api/bookings/{booking_id}/status",
            json={"status": "refused"},
            headers=coach_headers
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data["status"] == "refused", f"Expected status=refused, got {data.get('status')}"
        print(f"✅ Coach refused booking {booking_id}: status={data['status']}")

        # Verify via GET
        get_resp = requests.get(f"{BASE_URL}/api/bookings/{booking_id}", headers=user_headers)
        assert get_resp.status_code == 200
        assert get_resp.json()["status"] == "refused", "Status not persisted"
        print(f"✅ Verified: booking {booking_id} status=refused persisted in DB")

    def test_user_cannot_update_booking_status(self, user_headers):
        """User (non-coach-of-service) cannot change booking status"""
        booking_id = getattr(TestCreateBooking, 'created_booking_id', None)
        if not booking_id:
            pytest.skip("No booking_id available")
        # user@winek.app is the booker, not the coach of svc_demo001
        # Wait - user_demo001 has role coach, but is not the coach_id of svc_demo001
        # The booking's coach_id = user_coach001, so user_demo001 should get 403
        resp = requests.put(
            f"{BASE_URL}/api/bookings/{booking_id}/status",
            json={"status": "accepted"},
            headers=user_headers
        )
        # Should be 403 (not authorized - not the service coach) or 401
        assert resp.status_code in [403, 401], f"Expected 403/401, got {resp.status_code}: {resp.text}"
        print(f"✅ User cannot change booking status: {resp.status_code}")

    def test_invalid_status_value(self, coach_headers):
        """Invalid status value returns 422"""
        booking_id = getattr(TestCreateBooking, 'created_booking_id', None)
        if not booking_id:
            pytest.skip("No booking_id available")
        resp = requests.put(
            f"{BASE_URL}/api/bookings/{booking_id}/status",
            json={"status": "invalid_status"},
            headers=coach_headers
        )
        assert resp.status_code == 422, f"Expected 422, got {resp.status_code}: {resp.text}"
        print(f"✅ Invalid status returns 422")

    def test_nonexistent_booking_status_update(self, coach_headers):
        """Updating status of non-existent booking returns 404"""
        resp = requests.put(
            f"{BASE_URL}/api/bookings/bkg_nonexistent_xyz/status",
            json={"status": "accepted"},
            headers=coach_headers
        )
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}: {resp.text}"
        print("✅ Non-existent booking returns 404")
