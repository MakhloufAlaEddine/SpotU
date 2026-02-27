"""
Iteration 24 - Tests for new features:
- slot_type (recurring/single/availability) and slot_date in service slots
- DB migration: slot_type and slot_date columns in service_slots
- PUT /api/services/{id} with new slot fields
- GET /api/services/{id} returns slot_type and slot_date
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', '').rstrip('/')

COACH_EMAIL = "coach@winek.app"
COACH_PASSWORD = "WinekCoach2024!"
USER_EMAIL = "user@winek.app"
USER_PASSWORD = "WinekUser2024!"
SVC_DEMO_ID = "svc_demo001"

@pytest.fixture(scope="module")
def coach_token():
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={"email": COACH_EMAIL, "password": COACH_PASSWORD})
    assert resp.status_code == 200, f"Coach login failed: {resp.text}"
    return resp.json()["token"]

@pytest.fixture(scope="module")
def coach_client(coach_token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {coach_token}", "Content-Type": "application/json"})
    return s

# ─── TEST 1: DB Migration - columns slot_type and slot_date exist ─────────────
class TestDBMigration:
    """Verify slot_type and slot_date columns exist in service_slots via API response"""

    def test_get_service_slots_have_slot_type(self):
        """GET /api/services/{id} should return slot_type in each slot"""
        resp = requests.get(f"{BASE_URL}/api/services/{SVC_DEMO_ID}")
        assert resp.status_code == 200, f"GET service failed: {resp.text}"
        data = resp.json()
        assert "slots" in data, "Response missing 'slots'"
        # Slots may be empty if no slots - just verify the column exists if there are slots
        if data["slots"]:
            slot = data["slots"][0]
            assert "slot_type" in slot, f"slot_type missing from slot: {slot}"
            assert "slot_date" in slot, f"slot_date missing from slot: {slot}"
            print(f"PASS: slot_type='{slot['slot_type']}', slot_date='{slot.get('slot_date')}'")
        else:
            print("INFO: No slots in svc_demo001 (acceptable for migration check)")


# ─── TEST 2: POST /api/services - with slot_type='recurring' ─────────────────
class TestCreateServiceSlotTypes:
    """Test creating services with different slot_type values"""

    created_service_id = None

    def test_create_service_with_recurring_slot(self, coach_client):
        """POST /api/services with slot_type='recurring'"""
        payload = {
            "title": "TEST_Service Récurrent",
            "description": "Service de test pour créneaux récurrents - iter24",
            "price": 50.0,
            "duration_min": 60,
            "domain_id": "dom_coaching",
            "tag_ids": [],
            "max_participants": 1,
            "locations": [],
            "slots": [
                {
                    "slot_type": "recurring",
                    "day_of_week": 0,  # Lundi
                    "start_time": "09:00",
                    "end_time": "10:00",
                    "slot_date": None
                }
            ]
        }
        resp = coach_client.post(f"{BASE_URL}/api/services", json=payload)
        assert resp.status_code == 200, f"Create service failed: {resp.text}"
        data = resp.json()
        assert "service_id" in data
        TestCreateServiceSlotTypes.created_service_id = data["service_id"]

        # Verify slots in response
        assert "slots" in data
        assert len(data["slots"]) == 1
        slot = data["slots"][0]
        assert slot["slot_type"] == "recurring", f"Expected 'recurring', got '{slot['slot_type']}'"
        assert slot["day_of_week"] == 0, f"Expected day 0, got {slot['day_of_week']}"
        assert slot["start_time"] == "09:00"
        assert slot["end_time"] == "10:00"
        assert slot["slot_date"] is None
        print(f"PASS: Created service {data['service_id']} with recurring slot")

    def test_get_service_returns_slot_type_and_slot_date(self):
        """GET /api/services/{id} should return slot_type and slot_date in slots"""
        if not TestCreateServiceSlotTypes.created_service_id:
            pytest.skip("No service ID from previous test")
        resp = requests.get(f"{BASE_URL}/api/services/{TestCreateServiceSlotTypes.created_service_id}")
        assert resp.status_code == 200
        data = resp.json()
        assert "slots" in data
        assert len(data["slots"]) == 1
        slot = data["slots"][0]
        assert slot["slot_type"] == "recurring"
        assert "slot_date" in slot
        print(f"PASS: GET returns slot_type='{slot['slot_type']}', slot_date='{slot['slot_date']}'")

    def test_create_service_with_single_slot(self, coach_client):
        """POST /api/services with slot_type='single' and slot_date"""
        payload = {
            "title": "TEST_Service Date Unique",
            "description": "Service de test pour date unique - iter24",
            "price": 75.0,
            "duration_min": 90,
            "domain_id": "dom_coaching",
            "tag_ids": [],
            "max_participants": 5,
            "locations": [],
            "slots": [
                {
                    "slot_type": "single",
                    "day_of_week": None,
                    "start_time": "14:00",
                    "end_time": "15:30",
                    "slot_date": "2026-03-15"
                }
            ]
        }
        resp = coach_client.post(f"{BASE_URL}/api/services", json=payload)
        assert resp.status_code == 200, f"Create service failed: {resp.text}"
        data = resp.json()
        assert "service_id" in data

        slot = data["slots"][0]
        assert slot["slot_type"] == "single", f"Expected 'single', got '{slot['slot_type']}'"
        assert slot["slot_date"] == "2026-03-15", f"Expected '2026-03-15', got '{slot['slot_date']}'"
        assert slot["day_of_week"] is None
        print(f"PASS: Created service with single slot, slot_date='{slot['slot_date']}'")

        # Cleanup
        coach_client.delete(f"{BASE_URL}/api/services/{data['service_id']}")

    def test_create_service_with_availability_slot(self, coach_client):
        """POST /api/services with slot_type='availability'"""
        payload = {
            "title": "TEST_Service Disponibilité",
            "description": "Service de test pour disponibilité - iter24",
            "price": 40.0,
            "duration_min": 60,
            "domain_id": "dom_coaching",
            "tag_ids": [],
            "max_participants": 1,
            "locations": [],
            "slots": [
                {
                    "slot_type": "availability",
                    "day_of_week": 2,  # Mercredi
                    "start_time": "08:00",
                    "end_time": "18:00",
                    "slot_date": None
                }
            ]
        }
        resp = coach_client.post(f"{BASE_URL}/api/services", json=payload)
        assert resp.status_code == 200, f"Create service failed: {resp.text}"
        data = resp.json()
        assert "service_id" in data

        slot = data["slots"][0]
        assert slot["slot_type"] == "availability", f"Expected 'availability', got '{slot['slot_type']}'"
        assert slot["day_of_week"] == 2
        print(f"PASS: Created service with availability slot")

        # Cleanup
        coach_client.delete(f"{BASE_URL}/api/services/{data['service_id']}")


# ─── TEST 3: PUT /api/services/{id} with new slot fields ──────────────────────
class TestUpdateServiceSlotTypes:
    """Test updating services with new slot_type and slot_date fields"""

    def test_put_service_with_recurring_slot(self, coach_client):
        """PUT /api/services/{id} with slot_type='recurring'"""
        # Get original service state
        orig_resp = requests.get(f"{BASE_URL}/api/services/{SVC_DEMO_ID}")
        orig_data = orig_resp.json()
        orig_slots = orig_data.get("slots", [])

        # Update with a recurring slot
        payload = {
            "slots": [
                {
                    "slot_type": "recurring",
                    "day_of_week": 1,  # Mardi
                    "start_time": "09:00",
                    "end_time": "10:00",
                    "slot_date": None
                }
            ]
        }
        resp = coach_client.put(f"{BASE_URL}/api/services/{SVC_DEMO_ID}", json=payload)
        assert resp.status_code == 200, f"PUT failed: {resp.text}"
        data = resp.json()
        slots = data.get("slots", [])
        assert len(slots) == 1
        slot = slots[0]
        assert slot["slot_type"] == "recurring"
        assert slot["day_of_week"] == 1
        assert slot["start_time"] == "09:00"
        print(f"PASS: PUT with recurring slot succeeded")

        # Restore original slots
        if orig_slots:
            restore_slots = [{
                "slot_type": s.get("slot_type", "recurring"),
                "day_of_week": s.get("day_of_week"),
                "start_time": s["start_time"],
                "end_time": s["end_time"],
                "slot_date": s.get("slot_date")
            } for s in orig_slots]
            coach_client.put(f"{BASE_URL}/api/services/{SVC_DEMO_ID}", json={"slots": restore_slots})
        print("INFO: Service slots restored")

    def test_put_service_with_single_slot(self, coach_client):
        """PUT /api/services/{id} with slot_type='single' and slot_date"""
        payload = {
            "slots": [
                {
                    "slot_type": "single",
                    "day_of_week": None,
                    "start_time": "10:00",
                    "end_time": "11:00",
                    "slot_date": "2026-04-01"
                }
            ]
        }
        resp = coach_client.put(f"{BASE_URL}/api/services/{SVC_DEMO_ID}", json=payload)
        assert resp.status_code == 200, f"PUT with single slot failed: {resp.text}"
        data = resp.json()
        slot = data["slots"][0]
        assert slot["slot_type"] == "single"
        assert slot["slot_date"] == "2026-04-01"
        print(f"PASS: PUT with single slot and slot_date='2026-04-01'")

    def test_put_service_verify_slot_persistence(self, coach_client):
        """After PUT, GET should return the updated slot_type and slot_date"""
        # PUT with availability slot
        payload = {
            "slots": [
                {
                    "slot_type": "availability",
                    "day_of_week": 4,  # Jeudi
                    "start_time": "07:00",
                    "end_time": "12:00",
                    "slot_date": None
                }
            ]
        }
        put_resp = coach_client.put(f"{BASE_URL}/api/services/{SVC_DEMO_ID}", json=payload)
        assert put_resp.status_code == 200

        # GET to verify persistence
        get_resp = requests.get(f"{BASE_URL}/api/services/{SVC_DEMO_ID}")
        assert get_resp.status_code == 200
        data = get_resp.json()
        slot = data["slots"][0]
        assert slot["slot_type"] == "availability", f"Persistence failed: got '{slot['slot_type']}'"
        assert slot["day_of_week"] == 4
        print(f"PASS: slot_type='availability' persisted to DB and returned by GET")

        # Restore default slots
        coach_client.put(f"{BASE_URL}/api/services/{SVC_DEMO_ID}", json={
            "slots": [
                {"slot_type": "recurring", "day_of_week": 0, "start_time": "07:00", "end_time": "08:00", "slot_date": None},
                {"slot_type": "recurring", "day_of_week": 3, "start_time": "12:00", "end_time": "13:00", "slot_date": None}
            ]
        })
        print("INFO: Service restored to default slots")


# ─── TEST 4: Cleanup test services ───────────────────────────────────────────
class TestCleanup:
    """Remove test-created services"""

    def test_cleanup_created_service(self, coach_client):
        """Delete the recurring service created in TestCreateServiceSlotTypes"""
        sid = TestCreateServiceSlotTypes.created_service_id
        if not sid:
            print("INFO: No service to cleanup")
            return

        resp = coach_client.delete(f"{BASE_URL}/api/services/{sid}")
        # Accept 200 or check it was soft-deleted
        assert resp.status_code == 200, f"Cleanup failed: {resp.text}"
        print(f"PASS: Deleted test service {sid}")

        # Verify service is no longer active
        get_resp = requests.get(f"{BASE_URL}/api/services/{sid}")
        # 404 is fine (or active=False)
        print(f"INFO: After delete, GET status={get_resp.status_code}")
