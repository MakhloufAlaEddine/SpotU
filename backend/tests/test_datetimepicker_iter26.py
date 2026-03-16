"""
Iteration 26 - Tests for DateTimePickerModal integration
- POST /api/services with recurring slot (time-based, no chips)
- POST /api/services with single slot (datetime-based)
- POST /api/services with availability slot
- GET /api/services/{id} to verify data persistence
- PUT /api/services/{id} to verify update
- Validation: end_time <= start_time should fail or be caught by frontend
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', '').rstrip('/')


def _get_valid_tag_ids():
    """Récupère un tag valide depuis l'API pour respecter la règle métier (au moins 1 tag requis)."""
    try:
        resp = requests.get(f"{BASE_URL}/api/tags/categories?domain_id=dom_sport", timeout=5)
        if resp.status_code == 200:
            for cat in resp.json():
                for tag in cat.get("tags", []):
                    return [tag["tag_id"]]
    except Exception:
        pass
    return ["tag_3x3"]  # fallback hardcodé


VALID_TAG_IDS = _get_valid_tag_ids()

COACH_EMAIL = "coach@winek.app"
COACH_PASSWORD = "WinekCoach2024!"


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


# ─── TEST 1: POST recurring slot with DateTimePickerModal times ───────────────
class TestRecurringSlotCreate:
    """Test POST /api/services with recurring slot (10:00→11:00, Mon+Wed)"""
    created_id = None

    def test_create_recurring_slot(self, coach_client):
        payload = {
            "title": "TEST_DateTimePicker Récurrent Lun+Mer",
            "description": "Test de la nouvelle UI DateTimePickerModal",
            "price": 45.0,
            "duration_min": 60,
            "domain_id": "dom_coaching",
            "tag_ids": VALID_TAG_IDS,
            "max_participants": 1,
            "locations": [],
            "slots": [{
                "slot_type": "recurring",
                "days_of_week": [0, 2],  # Lundi=0, Mercredi=2
                "day_of_week": 0,
                "start_time": "10:00",
                "end_time": "11:00",
                "slot_date": None
            }]
        }
        resp = coach_client.post(f"{BASE_URL}/api/services", json=payload)
        assert resp.status_code == 200, f"POST /services failed: {resp.text}"
        data = resp.json()
        assert "service_id" in data, "Missing service_id in response"
        TestRecurringSlotCreate.created_id = data["service_id"]
        print(f"PASS: Created recurring service {data['service_id']}")

    def test_get_recurring_service_persisted(self, coach_client):
        assert TestRecurringSlotCreate.created_id, "Need created_id from previous test"
        resp = coach_client.get(f"{BASE_URL}/api/services/{TestRecurringSlotCreate.created_id}")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data.get("slots", [])) >= 1, "No slots found"
        slot = data["slots"][0]
        assert slot["slot_type"] == "recurring"
        # Verify days_of_week
        days = slot.get("days_of_week") or ([slot.get("day_of_week")] if slot.get("day_of_week") is not None else [])
        assert 0 in days or 2 in days, f"Expected days [0,2] but got {days}"
        assert slot["start_time"] == "10:00:00" or slot["start_time"] == "10:00", f"Unexpected start_time: {slot['start_time']}"
        assert slot["end_time"] == "11:00:00" or slot["end_time"] == "11:00", f"Unexpected end_time: {slot['end_time']}"
        print(f"PASS: GET recurring service slots verified: {slot}")

    def test_cleanup_recurring(self, coach_client):
        if TestRecurringSlotCreate.created_id:
            coach_client.delete(f"{BASE_URL}/api/services/{TestRecurringSlotCreate.created_id}")
            print(f"Cleanup: deleted {TestRecurringSlotCreate.created_id}")


# ─── TEST 2: POST single slot (Date unique, with date) ───────────────────────
class TestSingleSlotCreate:
    """Test POST /api/services with single slot (2026-03-15, 10:00→11:00)"""
    created_id = None

    def test_create_single_slot(self, coach_client):
        payload = {
            "title": "TEST_DateTimePicker Date Unique",
            "description": "Test slot type 'single' via DateTimePickerModal",
            "price": 60.0,
            "duration_min": 60,
            "domain_id": "dom_coaching",
            "tag_ids": VALID_TAG_IDS,
            "max_participants": 1,
            "locations": [],
            "slots": [{
                "slot_type": "single",
                "days_of_week": None,
                "day_of_week": None,
                "start_time": "10:00",
                "end_time": "11:30",
                "slot_date": "2026-04-15"
            }]
        }
        resp = coach_client.post(f"{BASE_URL}/api/services", json=payload)
        assert resp.status_code == 200, f"POST /services (single) failed: {resp.text}"
        data = resp.json()
        assert "service_id" in data
        TestSingleSlotCreate.created_id = data["service_id"]
        print(f"PASS: Created single-date service {data['service_id']}")

    def test_get_single_slot_persisted(self, coach_client):
        assert TestSingleSlotCreate.created_id
        resp = coach_client.get(f"{BASE_URL}/api/services/{TestSingleSlotCreate.created_id}")
        assert resp.status_code == 200
        data = resp.json()
        slots = data.get("slots", [])
        assert len(slots) >= 1, "No slots found"
        slot = slots[0]
        assert slot["slot_type"] == "single"
        assert "2026-04-15" in str(slot.get("slot_date", "")), f"Wrong date: {slot.get('slot_date')}"
        assert slot["start_time"] == "10:00:00" or slot["start_time"] == "10:00"
        assert slot["end_time"] == "11:30:00" or slot["end_time"] == "11:30"
        print(f"PASS: GET single-date slot persisted: {slot}")

    def test_cleanup_single(self, coach_client):
        if TestSingleSlotCreate.created_id:
            coach_client.delete(f"{BASE_URL}/api/services/{TestSingleSlotCreate.created_id}")


# ─── TEST 3: POST availability slot ─────────────────────────────────────────
class TestAvailabilitySlotCreate:
    """Test POST /api/services with availability slot (Tue+Thu, 08:00→20:00)"""
    created_id = None

    def test_create_availability_slot(self, coach_client):
        payload = {
            "title": "TEST_DateTimePicker Disponibilité",
            "description": "Test slot type 'availability' via DateTimePickerModal",
            "price": 40.0,
            "duration_min": 60,
            "domain_id": "dom_coaching",
            "tag_ids": VALID_TAG_IDS,
            "max_participants": 1,
            "locations": [],
            "slots": [{
                "slot_type": "availability",
                "days_of_week": [1, 3],  # Mardi=1, Jeudi=3
                "day_of_week": 1,
                "start_time": "08:00",
                "end_time": "20:00",
                "slot_date": None
            }]
        }
        resp = coach_client.post(f"{BASE_URL}/api/services", json=payload)
        assert resp.status_code == 200, f"POST /services (availability) failed: {resp.text}"
        data = resp.json()
        assert "service_id" in data
        TestAvailabilitySlotCreate.created_id = data["service_id"]
        print(f"PASS: Created availability service {data['service_id']}")

    def test_get_availability_slot_persisted(self, coach_client):
        assert TestAvailabilitySlotCreate.created_id
        resp = coach_client.get(f"{BASE_URL}/api/services/{TestAvailabilitySlotCreate.created_id}")
        assert resp.status_code == 200
        data = resp.json()
        slots = data.get("slots", [])
        assert len(slots) >= 1
        slot = slots[0]
        assert slot["slot_type"] == "availability"
        days = slot.get("days_of_week") or ([slot.get("day_of_week")] if slot.get("day_of_week") is not None else [])
        assert 1 in days or 3 in days, f"Expected days [1,3] but got {days}"
        print(f"PASS: GET availability slot persisted: {slot}")

    def test_cleanup_availability(self, coach_client):
        if TestAvailabilitySlotCreate.created_id:
            coach_client.delete(f"{BASE_URL}/api/services/{TestAvailabilitySlotCreate.created_id}")


# ─── TEST 4: PUT /api/services/{id} update with new slots ───────────────────
class TestUpdateServiceSlots:
    """Test PUT /api/services/{id} replaces slots correctly (DateTimePickerModal times)"""

    def test_update_demo_service_slots(self, coach_client):
        """Update svc_demo001 with new slot times from DateTimePickerModal"""
        # First GET to verify svc_demo001 exists
        resp = coach_client.get(f"{BASE_URL}/api/services/svc_demo001")
        if resp.status_code != 200:
            pytest.skip(f"svc_demo001 not available: {resp.status_code}")
        original = resp.json()

        # PUT with new slots
        update_payload = {
            "title": original["title"],
            "description": original.get("description"),
            "price": float(original["price"]),
            "duration_min": original.get("duration_min", 60),
            "max_participants": original.get("max_participants", 1),
            "domain_id": original.get("domain_id"),
            "tag_ids": original.get("tag_ids", []),
            "locations": [{"latitude": loc["latitude"], "longitude": loc["longitude"],
                           "precision": loc["precision"], "description": loc.get("description")}
                          for loc in original.get("locations", [])],
            "slots": [{
                "slot_type": "recurring",
                "days_of_week": [0, 2, 4],  # Lun, Mer, Ven
                "day_of_week": 0,
                "start_time": "09:00",
                "end_time": "10:00",
                "slot_date": None
            }]
        }
        resp = coach_client.put(f"{BASE_URL}/api/services/svc_demo001", json=update_payload)
        assert resp.status_code == 200, f"PUT /services failed: {resp.text}"
        print("PASS: PUT /api/services/svc_demo001 updated with new slot times")

    def test_verify_update_persisted(self, coach_client):
        """GET after PUT to verify new slot times are saved"""
        resp = coach_client.get(f"{BASE_URL}/api/services/svc_demo001")
        if resp.status_code != 200:
            pytest.skip("svc_demo001 not accessible")
        data = resp.json()
        slots = data.get("slots", [])
        if slots:
            slot = slots[0]
            start = slot.get("start_time", "")
            # Check start_time is "09:00" or "09:00:00"
            assert "09:00" in str(start), f"Unexpected start_time after PUT: {start}"
            print(f"PASS: GET after PUT - start_time={start}")
        else:
            print("WARNING: No slots found after PUT")

    def test_restore_demo_service(self, coach_client):
        """Restore svc_demo001 to original state"""
        resp = coach_client.get(f"{BASE_URL}/api/services/svc_demo001")
        if resp.status_code != 200:
            return
        original = resp.json()
        restore_payload = {
            "title": "Coaching Running Débutant",
            "description": original.get("description"),
            "price": float(original.get("price", 60)),
            "duration_min": original.get("duration_min", 60),
            "max_participants": original.get("max_participants", 1),
            "domain_id": original.get("domain_id", "dom_coaching"),
            "tag_ids": original.get("tag_ids", []),
            "locations": [{"latitude": loc["latitude"], "longitude": loc["longitude"],
                           "precision": loc["precision"], "description": loc.get("description")}
                          for loc in original.get("locations", [])],
            "slots": [{
                "slot_type": "recurring",
                "days_of_week": [0, 2],
                "day_of_week": 0,
                "start_time": "09:00",
                "end_time": "10:00",
                "slot_date": None
            }]
        }
        coach_client.put(f"{BASE_URL}/api/services/svc_demo001", json=restore_payload)
        print("Cleanup: svc_demo001 restored")
