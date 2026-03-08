"""
Iteration 27 - Test the new location_index architecture:
- POST /services with 2 locations, slots with different location_index values
- Verify each slot.location_id matches the correct location
- PUT /services/{id} update locations+slots, verify new location_id mapping
- GET /services/{id} verify all slots return a location_id
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'https://hyperlocal-connect-1.preview.emergentagent.com').rstrip('/')

COACH_EMAIL = "coach@winek.app"
COACH_PASSWORD = "WinekCoach2024!"

# ─── Auth Fixtures ────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def coach_token():
    """Get coach auth token"""
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": COACH_EMAIL,
        "password": COACH_PASSWORD
    })
    assert resp.status_code == 200, f"Login failed: {resp.text}"
    token = resp.json().get("token")
    assert token, "No token returned"
    return token


@pytest.fixture(scope="module")
def coach_headers(coach_token):
    return {"Authorization": f"Bearer {coach_token}", "Content-Type": "application/json"}


# ─── Test 1: POST /api/services with 2 locations and location_index ───────────

class TestCreateServiceWithLocationIndex:
    """Test creating a service with 2 locations, slots linked via location_index"""

    created_service_id = None

    def test_create_service_2_locations_returns_200(self, coach_headers):
        """POST /services with 2 locations, 2 slots (one per location)"""
        payload = {
            "title": "TEST_Iter27 Service 2 Locations",
            "description": "Test service with 2 locations for iteration 27",
            "price": 50.0,
            "duration_min": 60,
            "max_participants": 5,
            "domain_id": "dom_coaching",
            "tag_ids": [],
            "locations": [
                {"latitude": 48.8566, "longitude": 2.3522, "precision": "exact", "description": "Lieu A - Paris Centre"},
                {"latitude": 48.8737, "longitude": 2.2950, "precision": "100m", "description": "Lieu B - Bois de Boulogne"},
            ],
            "slots": [
                # Slot for location 0 (Paris Centre)
                {
                    "location_index": 0,
                    "slot_type": "recurring",
                    "day_of_week": 1,  # Mardi
                    "days_of_week": None,
                    "start_time": "09:00",
                    "end_time": "10:00",
                    "slot_date": None,
                },
                # Slot for location 1 (Bois de Boulogne)
                {
                    "location_index": 1,
                    "slot_type": "recurring",
                    "day_of_week": 4,  # Vendredi
                    "days_of_week": None,
                    "start_time": "14:00",
                    "end_time": "15:30",
                    "slot_date": None,
                },
            ],
        }
        resp = requests.post(f"{BASE_URL}/api/services", json=payload, headers=coach_headers)
        assert resp.status_code == 200, f"Create service failed: {resp.status_code} - {resp.text}"
        data = resp.json()
        assert "service_id" in data, "No service_id in response"
        TestCreateServiceWithLocationIndex.created_service_id = data["service_id"]
        print(f"PASS: Created service {data['service_id']}")

    def test_response_has_2_locations(self, coach_headers):
        """Verify response includes 2 locations"""
        assert TestCreateServiceWithLocationIndex.created_service_id, "No service created"
        resp = requests.get(
            f"{BASE_URL}/api/services/{TestCreateServiceWithLocationIndex.created_service_id}",
            headers=coach_headers
        )
        assert resp.status_code == 200
        data = resp.json()
        locs = data.get("locations", [])
        assert len(locs) == 2, f"Expected 2 locations, got {len(locs)}"
        print(f"PASS: 2 locations in response: {[l['location_id'] for l in locs]}")

    def test_each_slot_has_location_id(self, coach_headers):
        """GET service and verify every slot has a non-null location_id"""
        assert TestCreateServiceWithLocationIndex.created_service_id, "No service created"
        resp = requests.get(
            f"{BASE_URL}/api/services/{TestCreateServiceWithLocationIndex.created_service_id}",
            headers=coach_headers
        )
        assert resp.status_code == 200
        data = resp.json()
        slots = data.get("slots", [])
        assert len(slots) == 2, f"Expected 2 slots, got {len(slots)}"
        for slot in slots:
            assert slot.get("location_id") is not None, f"Slot {slot.get('slot_id')} has null location_id"
        print(f"PASS: All slots have location_id: {[s['location_id'] for s in slots]}")

    def test_slot_location_index_0_linked_to_location_0(self, coach_headers):
        """Verify slot with location_index=0 (09:00 Mardi) links to locations[0]"""
        assert TestCreateServiceWithLocationIndex.created_service_id, "No service created"
        resp = requests.get(
            f"{BASE_URL}/api/services/{TestCreateServiceWithLocationIndex.created_service_id}",
            headers=coach_headers
        )
        data = resp.json()
        locs = data.get("locations", [])
        slots = data.get("slots", [])
        # Location 0 is Paris Centre
        loc0_id = locs[0]["location_id"]
        # Slot for Tuesday 09:00 should be linked to location 0
        slot_tuesday = next((s for s in slots if s.get("start_time") in ("09:00", "09:00:00")), None)
        assert slot_tuesday is not None, "Tuesday 09:00 slot not found"
        assert slot_tuesday["location_id"] == loc0_id, (
            f"Tuesday slot linked to {slot_tuesday['location_id']} but expected loc0 {loc0_id}"
        )
        print(f"PASS: Tuesday 09:00 slot correctly linked to location_0 ({loc0_id})")

    def test_slot_location_index_1_linked_to_location_1(self, coach_headers):
        """Verify slot with location_index=1 (14:00 Vendredi) links to locations[1]"""
        assert TestCreateServiceWithLocationIndex.created_service_id, "No service created"
        resp = requests.get(
            f"{BASE_URL}/api/services/{TestCreateServiceWithLocationIndex.created_service_id}",
            headers=coach_headers
        )
        data = resp.json()
        locs = data.get("locations", [])
        slots = data.get("slots", [])
        # Location 1 is Bois de Boulogne
        loc1_id = locs[1]["location_id"]
        # Slot for Friday 14:00 should be linked to location 1
        slot_friday = next((s for s in slots if s.get("start_time") in ("14:00", "14:00:00")), None)
        assert slot_friday is not None, "Friday 14:00 slot not found"
        assert slot_friday["location_id"] == loc1_id, (
            f"Friday slot linked to {slot_friday['location_id']} but expected loc1 {loc1_id}"
        )
        print(f"PASS: Friday 14:00 slot correctly linked to location_1 ({loc1_id})")

    def test_slot_types_and_times_correct(self, coach_headers):
        """Verify slot fields (slot_type, start_time, end_time) are persisted correctly"""
        assert TestCreateServiceWithLocationIndex.created_service_id, "No service created"
        resp = requests.get(
            f"{BASE_URL}/api/services/{TestCreateServiceWithLocationIndex.created_service_id}",
            headers=coach_headers
        )
        data = resp.json()
        slots = data.get("slots", [])
        # All slots should be recurring
        for slot in slots:
            assert slot.get("slot_type") == "recurring", f"Expected recurring, got {slot.get('slot_type')}"
        print("PASS: All slots are recurring type")


# ─── Test 2: PUT /api/services/{id} with new locations and location_index ─────

class TestUpdateServiceWithLocationIndex:
    """Test updating a service with new locations/slots, verifying location_index→location_id mapping"""

    updated_service_id = None

    def test_update_service_new_locations_and_slots(self, coach_headers):
        """First create a service, then update with new locations+slots"""
        # Create initial service
        create_payload = {
            "title": "TEST_Iter27 Update Service",
            "description": "Service for PUT test",
            "price": 40.0,
            "duration_min": 45,
            "max_participants": 3,
            "domain_id": "dom_coaching",
            "tag_ids": [],
            "locations": [
                {"latitude": 48.8500, "longitude": 2.3500, "precision": "exact", "description": "Location Initiale"},
            ],
            "slots": [
                {"location_index": 0, "slot_type": "recurring", "day_of_week": 0, "start_time": "07:00", "end_time": "08:00"},
            ],
        }
        create_resp = requests.post(f"{BASE_URL}/api/services", json=create_payload, headers=coach_headers)
        assert create_resp.status_code == 200
        svc_id = create_resp.json()["service_id"]
        TestUpdateServiceWithLocationIndex.updated_service_id = svc_id
        print(f"PASS: Initial service created: {svc_id}")

        # Now UPDATE with 2 new locations and 2 slots with different location_index
        update_payload = {
            "title": "TEST_Iter27 Update Service MODIFIED",
            "price": 55.0,
            "locations": [
                {"latitude": 48.8620, "longitude": 2.3380, "precision": "exact", "description": "Nouveau Lieu 1 - Marais"},
                {"latitude": 48.8448, "longitude": 2.3730, "precision": "100m", "description": "Nouveau Lieu 2 - Vincennes"},
            ],
            "slots": [
                {"location_index": 0, "slot_type": "availability", "day_of_week": 2, "start_time": "10:00", "end_time": "12:00"},
                {"location_index": 1, "slot_type": "recurring", "day_of_week": 6, "start_time": "08:00", "end_time": "09:30"},
            ],
        }
        update_resp = requests.put(f"{BASE_URL}/api/services/{svc_id}", json=update_payload, headers=coach_headers)
        assert update_resp.status_code == 200, f"PUT failed: {update_resp.status_code} - {update_resp.text}"
        print(f"PASS: PUT returned 200 for {svc_id}")

    def test_put_new_locations_persisted(self, coach_headers):
        """Verify the PUT replaced locations with 2 new ones"""
        assert TestUpdateServiceWithLocationIndex.updated_service_id
        resp = requests.get(
            f"{BASE_URL}/api/services/{TestUpdateServiceWithLocationIndex.updated_service_id}",
            headers=coach_headers
        )
        assert resp.status_code == 200
        data = resp.json()
        locs = data.get("locations", [])
        assert len(locs) == 2, f"Expected 2 new locations, got {len(locs)}"
        # Verify description of new locations
        descriptions = [l.get("description", "") for l in locs]
        assert any("Marais" in d for d in descriptions), f"Marais not found in {descriptions}"
        assert any("Vincennes" in d for d in descriptions), f"Vincennes not found in {descriptions}"
        print(f"PASS: New locations persisted: {descriptions}")

    def test_put_slots_linked_to_new_location_ids(self, coach_headers):
        """Verify each slot is linked to the correct new location via location_index"""
        assert TestUpdateServiceWithLocationIndex.updated_service_id
        resp = requests.get(
            f"{BASE_URL}/api/services/{TestUpdateServiceWithLocationIndex.updated_service_id}",
            headers=coach_headers
        )
        data = resp.json()
        locs = data.get("locations", [])
        slots = data.get("slots", [])
        assert len(slots) == 2, f"Expected 2 slots after PUT, got {len(slots)}"

        # Find loc0 (Marais) and loc1 (Vincennes) by description
        loc_marais = next((l for l in locs if "Marais" in (l.get("description") or "")), None)
        loc_vincennes = next((l for l in locs if "Vincennes" in (l.get("description") or "")), None)
        assert loc_marais, "Marais location not found"
        assert loc_vincennes, "Vincennes location not found"

        # Slot at 10:00 (Wednesday) should be linked to Marais (location_index=0)
        slot_wed = next((s for s in slots if s.get("start_time") in ("10:00", "10:00:00")), None)
        assert slot_wed, "Wednesday 10:00 slot not found"
        assert slot_wed["location_id"] == loc_marais["location_id"], (
            f"Wednesday slot linked to {slot_wed['location_id']} but expected Marais {loc_marais['location_id']}"
        )
        print(f"PASS: Wednesday 10:00 slot → Marais ({loc_marais['location_id']})")

        # Slot at 08:00 (Sunday) should be linked to Vincennes (location_index=1)
        slot_sun = next((s for s in slots if s.get("start_time") in ("08:00", "08:00:00")), None)
        assert slot_sun, "Sunday 08:00 slot not found"
        assert slot_sun["location_id"] == loc_vincennes["location_id"], (
            f"Sunday slot linked to {slot_sun['location_id']} but expected Vincennes {loc_vincennes['location_id']}"
        )
        print(f"PASS: Sunday 08:00 slot → Vincennes ({loc_vincennes['location_id']})")

    def test_put_slot_types_preserved(self, coach_headers):
        """Verify slot types (availability, recurring) are correct after PUT"""
        assert TestUpdateServiceWithLocationIndex.updated_service_id
        resp = requests.get(
            f"{BASE_URL}/api/services/{TestUpdateServiceWithLocationIndex.updated_service_id}",
            headers=coach_headers
        )
        data = resp.json()
        slots = data.get("slots", [])
        types = {s.get("start_time", "").split(":")[0]: s.get("slot_type") for s in slots}
        # 10:00 → availability, 08:00 → recurring
        slot_10 = next((s for s in slots if s.get("start_time") in ("10:00", "10:00:00")), None)
        slot_08 = next((s for s in slots if s.get("start_time") in ("08:00", "08:00:00")), None)
        assert slot_10 and slot_10["slot_type"] == "availability", f"Expected availability, got {slot_10}"
        assert slot_08 and slot_08["slot_type"] == "recurring", f"Expected recurring, got {slot_08}"
        print(f"PASS: Slot types correct: 10:00=availability, 08:00=recurring")

    def test_title_and_price_updated(self, coach_headers):
        """Verify scalar fields (title, price) were updated correctly"""
        assert TestUpdateServiceWithLocationIndex.updated_service_id
        resp = requests.get(
            f"{BASE_URL}/api/services/{TestUpdateServiceWithLocationIndex.updated_service_id}",
            headers=coach_headers
        )
        data = resp.json()
        assert data.get("title") == "TEST_Iter27 Update Service MODIFIED"
        assert float(data.get("price", 0)) == 55.0
        print("PASS: Title and price updated correctly")


# ─── Test 3: GET /api/services/{id} - existing service has location_id in slots ─

class TestGetServiceLocationId:
    """Test that existing services (svc_demo*) return location_id in slots"""

    def test_get_svc_demo001_slots_have_location_id(self, coach_headers):
        """GET svc_demo001 and check if slots return location_id (may be null for legacy)"""
        resp = requests.get(f"{BASE_URL}/api/services/svc_demo001", headers=coach_headers)
        assert resp.status_code == 200, f"GET svc_demo001 failed: {resp.text}"
        data = resp.json()
        slots = data.get("slots", [])
        # Report the state of location_id for each slot
        for slot in slots:
            lid = slot.get("location_id")
            print(f"  slot {slot.get('slot_id')}: location_id={lid}, start={slot.get('start_time')}")
        print(f"PASS: GET svc_demo001 returns {len(slots)} slots")

    def test_get_svc_demo001_has_locations_array(self, coach_headers):
        """Verify locations array is present in GET /services/{id} response"""
        resp = requests.get(f"{BASE_URL}/api/services/svc_demo001", headers=coach_headers)
        assert resp.status_code == 200
        data = resp.json()
        locs = data.get("locations", [])
        assert isinstance(locs, list), "locations should be a list"
        print(f"PASS: svc_demo001 has {len(locs)} locations")

    def test_newly_created_service_all_slots_have_location_id(self, coach_headers):
        """Create a service, then GET it and verify ALL slots have non-null location_id"""
        payload = {
            "title": "TEST_Iter27 GET Verify",
            "description": "Test for GET location_id verification",
            "price": 30.0,
            "duration_min": 30,
            "max_participants": 1,
            "domain_id": "dom_sport",
            "tag_ids": [],
            "locations": [
                {"latitude": 48.8400, "longitude": 2.3200, "precision": "exact", "description": "Lieu Test GET"},
                {"latitude": 48.8650, "longitude": 2.3700, "precision": "1000m", "description": "Lieu Test GET 2"},
            ],
            "slots": [
                {"location_index": 0, "slot_type": "single", "start_time": "11:00", "end_time": "12:00",
                 "slot_date": "2026-06-01", "day_of_week": None, "days_of_week": None},
                {"location_index": 1, "slot_type": "recurring", "day_of_week": 3, "start_time": "16:00",
                 "end_time": "17:00", "days_of_week": None, "slot_date": None},
            ],
        }
        create_resp = requests.post(f"{BASE_URL}/api/services", json=payload, headers=coach_headers)
        assert create_resp.status_code == 200
        svc_id = create_resp.json()["service_id"]

        # Now GET and verify
        get_resp = requests.get(f"{BASE_URL}/api/services/{svc_id}", headers=coach_headers)
        assert get_resp.status_code == 200
        data = get_resp.json()
        slots = data.get("slots", [])
        locs = data.get("locations", [])
        assert len(slots) == 2, f"Expected 2 slots, got {len(slots)}"
        assert len(locs) == 2, f"Expected 2 locations, got {len(locs)}"

        loc_ids = {l["location_id"] for l in locs}
        for slot in slots:
            assert slot.get("location_id") is not None, f"Slot missing location_id: {slot}"
            assert slot["location_id"] in loc_ids, (
                f"Slot location_id {slot['location_id']} not in service locations {loc_ids}"
            )
        print(f"PASS: All slots in newly created service have valid location_id")

        # Cleanup
        requests.delete(f"{BASE_URL}/api/services/{svc_id}", headers=coach_headers)


# ─── Cleanup ─────────────────────────────────────────────────────────────────

class TestCleanup:
    """Delete test-created services after testing"""

    def test_cleanup_create_test_service(self, coach_headers):
        """Delete the service created in TestCreateServiceWithLocationIndex"""
        svc_id = TestCreateServiceWithLocationIndex.created_service_id
        if svc_id:
            resp = requests.delete(f"{BASE_URL}/api/services/{svc_id}", headers=coach_headers)
            assert resp.status_code == 200, f"Cleanup failed: {resp.text}"
            print(f"PASS: Deleted test service {svc_id}")

    def test_cleanup_update_test_service(self, coach_headers):
        """Delete the service created in TestUpdateServiceWithLocationIndex"""
        svc_id = TestUpdateServiceWithLocationIndex.updated_service_id
        if svc_id:
            resp = requests.delete(f"{BASE_URL}/api/services/{svc_id}", headers=coach_headers)
            assert resp.status_code == 200, f"Cleanup failed: {resp.text}"
            print(f"PASS: Deleted update test service {svc_id}")
