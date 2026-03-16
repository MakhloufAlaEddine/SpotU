"""
Iteration 25 - Tests for multi-day slots (days_of_week: List[int])
- POST /api/services with slot_type='recurring' + days_of_week=[0,2,4] → verify days_of_week=[0,2,4]
- POST /api/services with slot_type='single' + slot_date='2026-03-15' → verify slot_date
- POST /api/services with slot_type='availability' + days_of_week=[1,3] → verify days_of_week=[1,3]
- GET /api/services/{id} returns days_of_week correctly
- PUT /api/services/{id} with days_of_week multi-day → verify persistence
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


# ─── TEST 1: POST recurring with days_of_week multi-day ─────────────────────
class TestMultiDayRecurringSlot:
    """Test POST /api/services with days_of_week=[0,2,4] for recurring slots"""

    created_service_id = None

    def test_create_recurring_service_multi_days(self, coach_client):
        """POST /api/services with slot_type='recurring' + days_of_week=[0,2,4]"""
        payload = {
            "title": "TEST_Recurring Multi-Day Service",
            "description": "Test service for multi-day recurring slots",
            "price": 50.0,
            "duration_min": 60,
            "domain_id": "dom_coaching",
            "tag_ids": VALID_TAG_IDS,
            "max_participants": 1,
            "locations": [],
            "slots": [
                {
                    "slot_type": "recurring",
                    "days_of_week": [0, 2, 4],  # Lun, Mer, Ven
                    "start_time": "09:00",
                    "end_time": "10:00",
                    "slot_date": None
                }
            ]
        }
        resp = coach_client.post(f"{BASE_URL}/api/services", json=payload)
        assert resp.status_code == 200, f"Create service failed: {resp.text}"
        data = resp.json()
        assert "service_id" in data, "Response missing service_id"
        TestMultiDayRecurringSlot.created_service_id = data["service_id"]

        # Verify slots in response
        assert "slots" in data, "Response missing slots"
        assert len(data["slots"]) == 1, f"Expected 1 slot, got {len(data['slots'])}"
        slot = data["slots"][0]
        assert slot["slot_type"] == "recurring", f"Expected 'recurring', got '{slot['slot_type']}'"
        assert slot["start_time"] == "09:00", f"start_time mismatch: {slot['start_time']}"
        assert slot["end_time"] == "10:00", f"end_time mismatch: {slot['end_time']}"
        # Key assertion: days_of_week=[0,2,4]
        assert "days_of_week" in slot, f"days_of_week missing from slot: {slot}"
        assert sorted(slot["days_of_week"]) == [0, 2, 4], \
            f"Expected days_of_week=[0,2,4], got {slot['days_of_week']}"
        print(f"PASS: Created service {data['service_id']} with days_of_week={slot['days_of_week']}")

    def test_get_service_returns_days_of_week(self):
        """GET /api/services/{id} should return days_of_week=[0,2,4]"""
        if not TestMultiDayRecurringSlot.created_service_id:
            pytest.skip("No service ID from previous test")
        resp = requests.get(f"{BASE_URL}/api/services/{TestMultiDayRecurringSlot.created_service_id}")
        assert resp.status_code == 200, f"GET failed: {resp.text}"
        data = resp.json()
        assert "slots" in data
        assert len(data["slots"]) == 1
        slot = data["slots"][0]
        assert slot["slot_type"] == "recurring"
        assert "days_of_week" in slot, f"days_of_week missing from GET response: {slot}"
        assert sorted(slot["days_of_week"]) == [0, 2, 4], \
            f"Expected days_of_week=[0,2,4] from GET, got {slot['days_of_week']}"
        print(f"PASS: GET returns days_of_week={slot['days_of_week']}")

    def test_cleanup_recurring_multi_day(self, coach_client):
        """Delete the recurring multi-day service"""
        sid = TestMultiDayRecurringSlot.created_service_id
        if not sid:
            pytest.skip("No service to cleanup")
        resp = coach_client.delete(f"{BASE_URL}/api/services/{sid}")
        assert resp.status_code == 200, f"Delete failed: {resp.text}"
        print(f"PASS: Deleted service {sid}")


# ─── TEST 2: POST single slot with slot_date ──────────────────────────────────
class TestSingleSlotWithDate:
    """Test POST /api/services with slot_type='single' + slot_date"""

    created_service_id = None

    def test_create_single_slot_service(self, coach_client):
        """POST /api/services with slot_type='single' + slot_date='2026-03-15'"""
        payload = {
            "title": "TEST_Single Date Service",
            "description": "Test for single date slot",
            "price": 75.0,
            "duration_min": 90,
            "domain_id": "dom_coaching",
            "tag_ids": VALID_TAG_IDS,
            "max_participants": 5,
            "locations": [],
            "slots": [
                {
                    "slot_type": "single",
                    "days_of_week": None,
                    "day_of_week": None,
                    "start_time": "14:00",
                    "end_time": "15:30",
                    "slot_date": "2026-06-15"
                }
            ]
        }
        resp = coach_client.post(f"{BASE_URL}/api/services", json=payload)
        assert resp.status_code == 200, f"Create service failed: {resp.text}"
        data = resp.json()
        assert "service_id" in data
        TestSingleSlotWithDate.created_service_id = data["service_id"]

        slot = data["slots"][0]
        assert slot["slot_type"] == "single", f"Expected 'single', got '{slot['slot_type']}'"
        assert slot["slot_date"] == "2026-06-15", f"Expected '2026-06-15', got '{slot['slot_date']}'"
        print(f"PASS: Single slot with slot_date='{slot['slot_date']}'")

    def test_get_single_slot_returns_slot_date(self):
        """GET /api/services/{id} should return slot_date='2026-03-15'"""
        if not TestSingleSlotWithDate.created_service_id:
            pytest.skip("No service ID")
        resp = requests.get(f"{BASE_URL}/api/services/{TestSingleSlotWithDate.created_service_id}")
        assert resp.status_code == 200
        data = resp.json()
        slot = data["slots"][0]
        assert slot["slot_date"] == "2026-06-15", \
            f"slot_date persistence failed, got: {slot['slot_date']}"
        print(f"PASS: GET returns slot_date='{slot['slot_date']}'")

    def test_cleanup_single_slot(self, coach_client):
        """Delete the single date service"""
        sid = TestSingleSlotWithDate.created_service_id
        if not sid:
            pytest.skip("No service to cleanup")
        resp = coach_client.delete(f"{BASE_URL}/api/services/{sid}")
        assert resp.status_code == 200
        print(f"PASS: Deleted service {sid}")


# ─── TEST 3: POST availability with days_of_week=[1,3] ───────────────────────
class TestAvailabilityMultiDay:
    """Test POST /api/services with slot_type='availability' + days_of_week=[1,3]"""

    created_service_id = None

    def test_create_availability_multi_day(self, coach_client):
        """POST /api/services with slot_type='availability' + days_of_week=[1,3]"""
        payload = {
            "title": "TEST_Availability Multi-Day Service",
            "description": "Test for availability multi-day slots",
            "price": 40.0,
            "duration_min": 60,
            "domain_id": "dom_coaching",
            "tag_ids": VALID_TAG_IDS,
            "max_participants": 1,
            "locations": [],
            "slots": [
                {
                    "slot_type": "availability",
                    "days_of_week": [1, 3],  # Mar, Jeu
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
        TestAvailabilityMultiDay.created_service_id = data["service_id"]

        slot = data["slots"][0]
        assert slot["slot_type"] == "availability", f"Expected 'availability', got '{slot['slot_type']}'"
        assert "days_of_week" in slot, f"days_of_week missing from slot: {slot}"
        assert sorted(slot["days_of_week"]) == [1, 3], \
            f"Expected days_of_week=[1,3], got {slot['days_of_week']}"
        print(f"PASS: Availability slot with days_of_week={slot['days_of_week']}")

    def test_get_availability_returns_days_of_week(self):
        """GET /api/services/{id} should return days_of_week=[1,3] for availability slot"""
        if not TestAvailabilityMultiDay.created_service_id:
            pytest.skip("No service ID")
        resp = requests.get(f"{BASE_URL}/api/services/{TestAvailabilityMultiDay.created_service_id}")
        assert resp.status_code == 200
        data = resp.json()
        slot = data["slots"][0]
        assert slot["slot_type"] == "availability"
        assert sorted(slot["days_of_week"]) == [1, 3], \
            f"GET days_of_week mismatch: got {slot['days_of_week']}"
        print(f"PASS: GET availability returns days_of_week={slot['days_of_week']}")

    def test_cleanup_availability(self, coach_client):
        """Delete the availability service"""
        sid = TestAvailabilityMultiDay.created_service_id
        if not sid:
            pytest.skip("No service to cleanup")
        resp = coach_client.delete(f"{BASE_URL}/api/services/{sid}")
        assert resp.status_code == 200
        print(f"PASS: Deleted service {sid}")


# ─── TEST 4: PUT update with multi-day and verify persistence ─────────────────
class TestPutMultiDaySlot:
    """Test PUT /api/services/{id} with days_of_week multi-day"""

    def test_put_recurring_multi_day_and_verify(self, coach_client):
        """PUT svc_demo001 with recurring days_of_week=[0,2,4] and verify GET"""
        # Save original slots first
        orig_resp = requests.get(f"{BASE_URL}/api/services/{SVC_DEMO_ID}")
        orig_slots = orig_resp.json().get("slots", [])

        # PUT with multi-day recurring slot
        payload = {
            "slots": [
                {
                    "slot_type": "recurring",
                    "days_of_week": [0, 2, 4],
                    "start_time": "09:00",
                    "end_time": "10:00",
                    "slot_date": None
                }
            ]
        }
        put_resp = coach_client.put(f"{BASE_URL}/api/services/{SVC_DEMO_ID}", json=payload)
        assert put_resp.status_code == 200, f"PUT failed: {put_resp.text}"
        put_data = put_resp.json()
        slot = put_data["slots"][0]
        assert sorted(slot["days_of_week"]) == [0, 2, 4], \
            f"PUT response days_of_week wrong: {slot['days_of_week']}"

        # GET to verify persistence
        get_resp = requests.get(f"{BASE_URL}/api/services/{SVC_DEMO_ID}")
        assert get_resp.status_code == 200
        get_slot = get_resp.json()["slots"][0]
        assert sorted(get_slot["days_of_week"]) == [0, 2, 4], \
            f"Persistence failed: GET days_of_week={get_slot['days_of_week']}"
        print(f"PASS: PUT + GET days_of_week=[0,2,4] persisted correctly")

        # Restore original slots
        if orig_slots:
            restore = []
            for s in orig_slots:
                restore.append({
                    "slot_type": s.get("slot_type", "recurring"),
                    "days_of_week": s.get("days_of_week") or ([s["day_of_week"]] if s.get("day_of_week") is not None else []),
                    "start_time": s["start_time"],
                    "end_time": s["end_time"],
                    "slot_date": s.get("slot_date")
                })
            coach_client.put(f"{BASE_URL}/api/services/{SVC_DEMO_ID}", json={"slots": restore})
        print("INFO: svc_demo001 slots restored")
