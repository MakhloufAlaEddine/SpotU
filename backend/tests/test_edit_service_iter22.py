"""
Backend tests for WINEK iteration 22 - Edit Service (PUT /api/services/{id})
Tests: title/price update, locations/slots replacement, owner check
"""
import pytest
import requests
import os

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://follow-modal.preview.emergentagent.com").rstrip("/")

SERVICE_ID = "svc_4842a8361c1f"  # Coaching Running Paris - coach@winek.app owns this

COACH_EMAIL = "coach@winek.app"
COACH_PWD = "WinekCoach2024!"
USER_EMAIL = "user@winek.app"
USER_PWD = "WinekUser2024!"


# ─── Fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def coach_token():
    """Login as coach and return JWT token"""
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={"email": COACH_EMAIL, "password": COACH_PWD})
    assert resp.status_code == 200, f"Coach login failed: {resp.status_code} {resp.text}"
    token = resp.json().get("token")
    assert token, "No token in coach login response"
    return token


@pytest.fixture(scope="module")
def user_token():
    """Login as non-owner user and return JWT token"""
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={"email": USER_EMAIL, "password": USER_PWD})
    assert resp.status_code == 200, f"User login failed: {resp.status_code} {resp.text}"
    token = resp.json().get("token")
    assert token, "No token in user login response"
    return token


@pytest.fixture(scope="module")
def coach_client(coach_token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {coach_token}", "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def user_client(user_token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {user_token}", "Content-Type": "application/json"})
    return s


# ─── 1. GET service to know initial state ─────────────────────────────────────

class TestGetService:
    """Verify service svc_4842a8361c1f exists and has expected structure"""

    def test_service_exists_and_has_locations_slots(self, coach_client):
        resp = coach_client.get(f"{BASE_URL}/api/services/{SERVICE_ID}")
        assert resp.status_code == 200, f"GET service failed: {resp.status_code}"
        data = resp.json()
        assert data["service_id"] == SERVICE_ID
        assert "locations" in data
        assert "slots" in data
        assert "title" in data
        assert "price" in data
        print(f"Initial state: title={data['title']}, price={data['price']}, "
              f"locations={len(data['locations'])}, slots={len(data['slots'])}")


# ─── 2. PUT - Update title+price only, preserve locations/slots ───────────────

class TestUpdateScalarsOnly:
    """PUT with title+price only - should preserve existing locations and slots"""

    def test_put_title_price_only(self, coach_client):
        # First get original state
        orig = coach_client.get(f"{BASE_URL}/api/services/{SERVICE_ID}").json()
        orig_loc_count = len(orig.get("locations", []))
        orig_slot_count = len(orig.get("slots", []))

        # PUT - only title and price, no locations/slots keys
        payload = {
            "title": "Coaching Running Paris EDIT",
            "price": 75.0,
        }
        resp = coach_client.put(f"{BASE_URL}/api/services/{SERVICE_ID}", json=payload)
        assert resp.status_code == 200, f"PUT failed: {resp.status_code} {resp.text}"
        data = resp.json()
        assert data["title"] == "Coaching Running Paris EDIT", f"Title not updated: {data['title']}"
        assert data["price"] == 75.0, f"Price not updated: {data['price']}"

        # Locations and slots must be preserved
        assert len(data["locations"]) == orig_loc_count, \
            f"Locations changed! was {orig_loc_count}, now {len(data['locations'])}"
        assert len(data["slots"]) == orig_slot_count, \
            f"Slots changed! was {orig_slot_count}, now {len(data['slots'])}"
        print(f"PASS: title+price updated, locations={len(data['locations'])} preserved, slots={len(data['slots'])} preserved")

    def test_verify_persistence_after_scalar_update(self, coach_client):
        resp = coach_client.get(f"{BASE_URL}/api/services/{SERVICE_ID}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["title"] == "Coaching Running Paris EDIT"
        assert data["price"] == 75.0
        print(f"PASS: Scalar update persisted: title={data['title']}, price={data['price']}")


# ─── 3. PUT - Update locations+slots (full replacement) ──────────────────────

class TestUpdateLocationsSlots:
    """PUT with new locations and slots - complete replacement"""

    def test_put_with_new_locations_and_slots(self, coach_client):
        new_locations = [
            {"latitude": 48.8566, "longitude": 2.3522, "precision": "exact", "description": "Paris Centre TEST"},
            {"latitude": 48.8738, "longitude": 2.2950, "precision": "100m", "description": "Boulogne TEST"},
            {"latitude": 48.8339, "longitude": 2.3217, "precision": "1000m", "description": "Montrouge TEST"},
        ]
        new_slots = [
            {"day_of_week": 0, "start_time": "08:00", "end_time": "09:00"},
            {"day_of_week": 1, "start_time": "10:00", "end_time": "11:00"},
            {"day_of_week": 3, "start_time": "14:00", "end_time": "15:00"},
            {"day_of_week": 5, "start_time": "09:00", "end_time": "10:30"},
        ]
        payload = {
            "title": "Coaching Running Paris EDIT",
            "price": 75.0,
            "locations": new_locations,
            "slots": new_slots,
        }
        resp = coach_client.put(f"{BASE_URL}/api/services/{SERVICE_ID}", json=payload)
        assert resp.status_code == 200, f"PUT with locations/slots failed: {resp.status_code} {resp.text}"
        data = resp.json()
        assert len(data["locations"]) == 3, f"Expected 3 locations, got {len(data['locations'])}"
        assert len(data["slots"]) == 4, f"Expected 4 slots, got {len(data['slots'])}"
        # Verify location descriptions
        descriptions = [l["description"] for l in data["locations"]]
        assert "Paris Centre TEST" in descriptions, f"Location descriptions: {descriptions}"
        print(f"PASS: locations={len(data['locations'])}, slots={len(data['slots'])} replaced correctly")

    def test_verify_persistence_after_location_slot_update(self, coach_client):
        resp = coach_client.get(f"{BASE_URL}/api/services/{SERVICE_ID}")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["locations"]) == 3, f"Expected 3 locations after GET, got {len(data['locations'])}"
        assert len(data["slots"]) == 4, f"Expected 4 slots after GET, got {len(data['slots'])}"
        # Verify slot times
        slot_starts = sorted([s["start_time"] for s in data["slots"]])
        assert "08:00" in slot_starts, f"Slot 08:00 missing: {slot_starts}"
        print(f"PASS: locations+slots persisted: {len(data['locations'])} locs, {len(data['slots'])} slots")


# ─── 4. PUT - Owner check: non-owner must get 403 ────────────────────────────

class TestOwnerCheck:
    """Only service owner can PUT - other users get 403"""

    def test_non_owner_cannot_update_service(self, user_client):
        payload = {"title": "HACKED by user"}
        resp = user_client.put(f"{BASE_URL}/api/services/{SERVICE_ID}", json=payload)
        assert resp.status_code in [401, 403], \
            f"Expected 401/403 for non-owner, got {resp.status_code}: {resp.text}"
        print(f"PASS: Non-owner blocked with {resp.status_code}")

    def test_unauthenticated_cannot_update_service(self):
        resp = requests.put(f"{BASE_URL}/api/services/{SERVICE_ID}", json={"title": "ANON HACK"})
        assert resp.status_code in [401, 403], \
            f"Expected 401/403 unauthenticated, got {resp.status_code}"
        print(f"PASS: Unauthenticated blocked with {resp.status_code}")

    def test_service_not_modified_by_non_owner(self, coach_client):
        """Verify the service title was NOT changed by non-owner"""
        resp = coach_client.get(f"{BASE_URL}/api/services/{SERVICE_ID}")
        data = resp.json()
        assert data["title"] != "HACKED by user", "Non-owner managed to update the title!"
        print(f"PASS: Title still correct: {data['title']}")


# ─── 5. PUT - Restore original data ──────────────────────────────────────────

class TestRestoreOriginalData:
    """Restore service to original expected state for frontend testing"""

    def test_restore_service_to_original(self, coach_client):
        """Restore: Coaching Running Paris, price=65, 3 locations, 4 slots"""
        payload = {
            "title": "Coaching Running Paris",
            "price": 65.0,
            "locations": [
                {"latitude": 48.8566, "longitude": 2.3522, "precision": "exact", "description": "Paris Centre"},
                {"latitude": 48.8738, "longitude": 2.2950, "precision": "100m", "description": "Boulogne"},
                {"latitude": 48.8339, "longitude": 2.3217, "precision": "1000m", "description": "Montrouge"},
            ],
            "slots": [
                {"day_of_week": 0, "start_time": "07:00", "end_time": "08:00"},
                {"day_of_week": 2, "start_time": "12:00", "end_time": "13:00"},
                {"day_of_week": 4, "start_time": "07:00", "end_time": "08:00"},
                {"day_of_week": 6, "start_time": "09:00", "end_time": "10:30"},
            ],
        }
        resp = coach_client.put(f"{BASE_URL}/api/services/{SERVICE_ID}", json=payload)
        assert resp.status_code == 200, f"Restore failed: {resp.status_code} {resp.text}"
        data = resp.json()
        assert data["title"] == "Coaching Running Paris"
        assert data["price"] == 65.0
        assert len(data["locations"]) == 3
        assert len(data["slots"]) == 4
        print(f"PASS: Service restored to original state")
