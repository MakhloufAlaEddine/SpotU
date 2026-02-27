"""
Iteration 21 Backend Tests
Tests for:
- GET /api/services/{id} - tags, locations, slots, coach fields
- POST /api/bookings with slot_id + location_id
- GET /api/bookings/mine - slot_id and location_id present
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test service IDs
SERVICE_WITH_LOCATIONS_SLOTS = "svc_0e29808ea881"
SERVICE_DEMO = "svc_demo001"

USER_EMAIL = "user@winek.app"
USER_PASSWORD = "WinekUser2024!"
COACH_EMAIL = "coach@winek.app"
COACH_PASSWORD = "WinekCoach2024!"


@pytest.fixture(scope="module")
def user_token():
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": USER_EMAIL,
        "password": USER_PASSWORD
    })
    assert resp.status_code == 200, f"User login failed: {resp.text}"
    token = resp.json().get("token")
    assert token, "No token in login response"
    return token


@pytest.fixture(scope="module")
def coach_token():
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": COACH_EMAIL,
        "password": COACH_PASSWORD
    })
    assert resp.status_code == 200, f"Coach login failed: {resp.text}"
    token = resp.json().get("token")
    assert token, "No token in login response"
    return token


@pytest.fixture(scope="module")
def user_headers(user_token):
    return {"Authorization": f"Bearer {user_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def coach_headers(coach_token):
    return {"Authorization": f"Bearer {coach_token}", "Content-Type": "application/json"}


# ─── GET /api/services/{id} tests ────────────────────────────────────────────

class TestGetServiceById:
    """Tests for service detail endpoint"""

    def test_service_has_required_top_level_keys(self):
        """Service response must include all required keys"""
        resp = requests.get(f"{BASE_URL}/api/services/{SERVICE_WITH_LOCATIONS_SLOTS}")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        for key in ["tags", "locations", "slots", "coach", "service_id", "title", "price"]:
            assert key in data, f"Missing key '{key}' in service response. Keys: {list(data.keys())}"

    def test_service_locations_present_and_valid(self):
        """Service svc_0e29808ea881 should have 1 location with lat/lng"""
        resp = requests.get(f"{BASE_URL}/api/services/{SERVICE_WITH_LOCATIONS_SLOTS}")
        assert resp.status_code == 200
        data = resp.json()
        locations = data.get("locations", [])
        assert len(locations) == 1, f"Expected 1 location, got {len(locations)}"
        loc = locations[0]
        assert "location_id" in loc, "location_id missing from location"
        assert "latitude" in loc, "latitude missing from location"
        assert "longitude" in loc, "longitude missing from location"
        assert "precision" in loc, "precision missing from location"
        assert abs(loc["latitude"] - 48.8566) < 0.01, f"Wrong latitude: {loc['latitude']}"
        assert abs(loc["longitude"] - 2.3522) < 0.01, f"Wrong longitude: {loc['longitude']}"

    def test_service_slots_present_and_valid(self):
        """Service svc_0e29808ea881 should have 1 slot (Monday 09:00-10:00)"""
        resp = requests.get(f"{BASE_URL}/api/services/{SERVICE_WITH_LOCATIONS_SLOTS}")
        assert resp.status_code == 200
        data = resp.json()
        slots = data.get("slots", [])
        assert len(slots) == 1, f"Expected 1 slot, got {len(slots)}"
        slot = slots[0]
        assert "slot_id" in slot, "slot_id missing"
        assert slot["day_of_week"] == 0, f"Expected day_of_week=0 (Monday), got {slot['day_of_week']}"
        assert slot["start_time"] == "09:00", f"Expected start_time=09:00, got {slot['start_time']}"
        assert slot["end_time"] == "10:00", f"Expected end_time=10:00, got {slot['end_time']}"

    def test_service_coach_present_and_valid(self):
        """Service should have a coach object with user_id, name"""
        resp = requests.get(f"{BASE_URL}/api/services/{SERVICE_WITH_LOCATIONS_SLOTS}")
        assert resp.status_code == 200
        data = resp.json()
        coach = data.get("coach")
        assert coach is not None, "coach field missing from service"
        assert "user_id" in coach, "user_id missing from coach"
        assert "name" in coach, "name missing from coach"
        assert len(coach["name"]) > 0, "coach name is empty"

    def test_service_tags_field_is_list(self):
        """Service should always have a tags list (even if empty)"""
        resp = requests.get(f"{BASE_URL}/api/services/{SERVICE_WITH_LOCATIONS_SLOTS}")
        assert resp.status_code == 200
        data = resp.json()
        tags = data.get("tags")
        assert isinstance(tags, list), f"tags should be a list, got {type(tags)}"

    def test_service_demo001_has_required_keys(self):
        """svc_demo001 (seed service) also has tags, locations, slots keys"""
        resp = requests.get(f"{BASE_URL}/api/services/{SERVICE_DEMO}")
        assert resp.status_code == 200
        data = resp.json()
        for key in ["tags", "locations", "slots", "coach"]:
            assert key in data, f"Missing '{key}' in svc_demo001 response"
        # Empty lists are fine for seed service
        assert isinstance(data["locations"], list)
        assert isinstance(data["slots"], list)
        assert isinstance(data["tags"], list)

    def test_service_not_found_returns_404(self):
        """Non-existent service ID returns 404"""
        resp = requests.get(f"{BASE_URL}/api/services/svc_nonexistent_xxx")
        assert resp.status_code == 404


# ─── POST /api/bookings tests ─────────────────────────────────────────────────

class TestCreateBooking:
    """Tests for booking creation with slot_id and location_id"""

    created_booking_id = None

    def test_create_booking_with_slot_and_location(self, user_headers):
        """Create booking with slot_id and location_id - both must be in response"""
        slot_id = "slot_d028db26386e"
        location_id = "sloc_df4d136d49a8"
        payload = {
            "service_id": SERVICE_WITH_LOCATIONS_SLOTS,
            "slot_id": slot_id,
            "location_id": location_id,
            "notes": "TEST_booking_with_slot_location"
        }
        resp = requests.post(f"{BASE_URL}/api/bookings", json=payload, headers=user_headers)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        TestCreateBooking.created_booking_id = data.get("booking_id")
        assert "booking_id" in data, "booking_id missing from response"
        assert data.get("slot_id") == slot_id, f"slot_id not returned: {data.get('slot_id')}"
        assert data.get("location_id") == location_id, f"location_id not returned: {data.get('location_id')}"
        assert data.get("status") == "pending", f"Expected status=pending, got {data.get('status')}"

    def test_create_booking_slot_id_persisted(self, user_headers):
        """slot_id and location_id must be persisted in DB (verify via GET)"""
        if not TestCreateBooking.created_booking_id:
            pytest.skip("Booking creation failed in previous test")
        resp = requests.get(
            f"{BASE_URL}/api/bookings/{TestCreateBooking.created_booking_id}",
            headers=user_headers
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("slot_id") == "slot_d028db26386e", f"slot_id not persisted: {data.get('slot_id')}"
        assert data.get("location_id") == "sloc_df4d136d49a8", f"location_id not persisted: {data.get('location_id')}"

    def test_create_booking_notes_persisted(self, user_headers):
        """Notes should be stored and returned"""
        if not TestCreateBooking.created_booking_id:
            pytest.skip("Booking creation failed")
        resp = requests.get(
            f"{BASE_URL}/api/bookings/{TestCreateBooking.created_booking_id}",
            headers=user_headers
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("notes") == "TEST_booking_with_slot_location", f"notes not persisted: {data.get('notes')}"

    def test_create_booking_without_slot_or_location(self, user_headers):
        """Booking without slot_id/location_id should still succeed (optional fields)"""
        payload = {
            "service_id": SERVICE_DEMO,
            "notes": "TEST_no_slot_no_location"
        }
        resp = requests.post(f"{BASE_URL}/api/bookings", json=payload, headers=user_headers)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data.get("slot_id") is None, f"Expected slot_id=None, got {data.get('slot_id')}"
        assert data.get("location_id") is None, f"Expected location_id=None, got {data.get('location_id')}"

    def test_coach_cannot_book_own_service(self, coach_headers):
        """Coach should not be able to book their own service"""
        payload = {"service_id": SERVICE_WITH_LOCATIONS_SLOTS}
        resp = requests.post(f"{BASE_URL}/api/bookings", json=payload, headers=coach_headers)
        assert resp.status_code == 400, f"Expected 400 for own service booking, got {resp.status_code}: {resp.text}"

    def test_booking_unauthenticated_fails(self):
        """Booking without auth token should return 401 or 403"""
        payload = {"service_id": SERVICE_WITH_LOCATIONS_SLOTS}
        resp = requests.post(f"{BASE_URL}/api/bookings", json=payload)
        assert resp.status_code in [401, 403], f"Expected 401/403, got {resp.status_code}"


# ─── GET /api/bookings/mine tests ─────────────────────────────────────────────

class TestGetMyBookings:
    """Tests for bookings/mine endpoint"""

    def test_bookings_mine_returns_list(self, user_headers):
        """bookings/mine should return a list"""
        resp = requests.get(f"{BASE_URL}/api/bookings/mine", headers=user_headers)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"

    def test_bookings_mine_has_slot_and_location_ids(self, user_headers):
        """Recent bookings must include slot_id and location_id fields"""
        resp = requests.get(f"{BASE_URL}/api/bookings/mine", headers=user_headers)
        assert resp.status_code == 200
        bookings = resp.json()
        assert len(bookings) > 0, "No bookings found - create one first"
        # Check latest booking
        recent = next(
            (b for b in bookings if b.get("slot_id") == "slot_d028db26386e"), None
        )
        assert recent is not None, "No booking found with slot_id=slot_d028db26386e"
        assert recent.get("slot_id") == "slot_d028db26386e"
        assert recent.get("location_id") == "sloc_df4d136d49a8"

    def test_bookings_mine_has_service_enrichment(self, user_headers):
        """bookings/mine should have enriched service data"""
        resp = requests.get(f"{BASE_URL}/api/bookings/mine", headers=user_headers)
        assert resp.status_code == 200
        bookings = resp.json()
        assert len(bookings) > 0, "No bookings"
        b = bookings[0]
        assert "service" in b, "service enrichment missing from booking"
        assert b["service"] is not None, "service is null in booking"

    def test_bookings_mine_unauthenticated_fails(self):
        """bookings/mine requires auth"""
        resp = requests.get(f"{BASE_URL}/api/bookings/mine")
        assert resp.status_code in [401, 403]
