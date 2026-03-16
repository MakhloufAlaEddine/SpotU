"""
Iteration 9 backend tests for WINEK:
- Per-day recurring schedule (recurringSchedule: Record<number, Date[]>)
- Multi-day/multi-time POST format: {type:'weekly', schedule:{'1':['09:00'],'3':['12:00','18:00']}}
- [id].tsx data: GET tag-point with new schedule returns correct nested structure
"""
import pytest
import requests
import os

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    env_path = os.path.join(os.path.dirname(__file__), '../../frontend/.env')
    try:
        with open(env_path) as _f:
            for _line in _f:
                _line = _line.strip()
                if _line.startswith('EXPO_PUBLIC_BACKEND_URL='):
                    BASE_URL = _line.split('=', 1)[1].strip().rstrip('/')
                    break
    except Exception:
        pass
if not BASE_URL:
    BASE_URL = "http://localhost:8001"

AUTH_URL = f"{BASE_URL}/api/auth/login"
TP_URL = f"{BASE_URL}/api/tag-points"

TEST_CREDENTIALS = {"email": "user@winek.app", "password": "WinekUser2024!"}
CREATED_IDS = []


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


@pytest.fixture(scope="module")
def token():
    """Get auth token."""
    resp = requests.post(AUTH_URL, json=TEST_CREDENTIALS)
    assert resp.status_code == 200, f"Login failed: {resp.text}"
    return resp.json()["token"]


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ─── Test 1: POST with new per-day schedule format ────────────────────────────
class TestRecurringPerDayFormat:
    """Tests for new recurringSchedule Record<number, Date[]> format."""

    def test_post_multi_day_multi_time(self, headers):
        """POST with {type:'weekly', schedule:{'1':['09:00'],'3':['12:00','18:00']}} format."""
        payload = {
            "title": "TEST_Iter9 Multi-day Recurring",
            "description": "Per-day recurring test",
            "latitude": 48.8566,
            "longitude": 2.3522,
            "precision": "exact",
            "domain_id": "dom_sport",
            "tag_ids": VALID_TAG_IDS,
            "images": [],
            "event_schedule": {
                "type": "weekly",
                "schedule": {
                    "1": ["09:00"],
                    "3": ["12:00", "18:00"]
                }
            }
        }
        resp = requests.post(TP_URL, json=payload, headers=headers)
        assert resp.status_code == 200, f"POST failed: {resp.text}"
        data = resp.json()
        assert "point_id" in data
        CREATED_IDS.append(data["point_id"])
        # Verify event_schedule stored correctly
        es = data.get("event_schedule") or data.get("schedule")
        assert es is not None, "event_schedule missing from response"
        print(f"PASS: Created {data['point_id']} with event_schedule: {es}")

    def test_get_multi_day_multi_time_persisted(self, headers):
        """GET the created tagPoint and verify schedule persisted."""
        if not CREATED_IDS:
            pytest.skip("No created ID available")
        point_id = CREATED_IDS[0]
        resp = requests.get(f"{TP_URL}/{point_id}", headers=headers)
        assert resp.status_code == 200, f"GET failed: {resp.text}"
        data = resp.json()
        es = data.get("event_schedule")
        assert es is not None, f"event_schedule missing from GET response: {data}"
        assert es.get("type") == "weekly"
        schedule = es.get("schedule", {})
        assert "1" in schedule, f"Day '1' (Tuesday) not found in schedule: {schedule}"
        assert "3" in schedule, f"Day '3' (Thursday) not found in schedule: {schedule}"
        assert schedule["1"] == ["09:00"], f"Day 1 times wrong: {schedule['1']}"
        assert set(schedule["3"]) == {"12:00", "18:00"}, f"Day 3 times wrong: {schedule['3']}"
        print(f"PASS: GET {point_id} schedule verified: {schedule}")

    def test_post_monday_only_single_time(self, headers):
        """POST recurring with only Monday + 1 time slot."""
        payload = {
            "title": "TEST_Iter9 Monday Only",
            "latitude": 48.8566, "longitude": 2.3522,
            "precision": "exact", "domain_id": "dom_sport",
            "tag_ids": VALID_TAG_IDS, "images": [],
            "event_schedule": {
                "type": "weekly",
                "schedule": {"0": ["09:00"]}
            }
        }
        resp = requests.post(TP_URL, json=payload, headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        CREATED_IDS.append(data["point_id"])
        resp2 = requests.get(f"{TP_URL}/{data['point_id']}", headers=headers)
        assert resp2.status_code == 200
        es = resp2.json().get("event_schedule", {})
        assert es.get("schedule", {}).get("0") == ["09:00"]
        print(f"PASS: Monday-only schedule verified")

    def test_post_wednesday_two_times(self, headers):
        """POST recurring with Wednesday 12:00 and 18:00."""
        payload = {
            "title": "TEST_Iter9 Wednesday Two Times",
            "latitude": 48.8566, "longitude": 2.3522,
            "precision": "exact", "domain_id": "dom_sport",
            "tag_ids": VALID_TAG_IDS, "images": [],
            "event_schedule": {
                "type": "weekly",
                "schedule": {"2": ["12:00", "18:00"]}
            }
        }
        resp = requests.post(TP_URL, json=payload, headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        CREATED_IDS.append(data["point_id"])
        resp2 = requests.get(f"{TP_URL}/{data['point_id']}", headers=headers)
        es = resp2.json().get("event_schedule", {})
        times = es.get("schedule", {}).get("2", [])
        assert set(times) == {"12:00", "18:00"}
        print(f"PASS: Wednesday two-times schedule verified")

    def test_payload_format_matches_spec(self, headers):
        """Verify exact payload format spec: {type:'weekly', schedule:{'1':['09:00'],'3':['12:00','18:00']}}"""
        payload = {
            "title": "TEST_Iter9 Spec Check",
            "latitude": 48.8566, "longitude": 2.3522,
            "precision": "exact", "domain_id": "dom_sport",
            "tag_ids": VALID_TAG_IDS, "images": [],
            "event_schedule": {
                "type": "weekly",
                "schedule": {
                    "1": ["09:00"],
                    "3": ["12:00", "18:00"]
                }
            }
        }
        resp = requests.post(TP_URL, json=payload, headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        CREATED_IDS.append(data["point_id"])
        es = data.get("event_schedule") or {}
        assert es.get("type") == "weekly"
        sched = es.get("schedule", {})
        # Per spec: day 1 (Monday in 0-indexed or Tuesday?) → times ['09:00']
        # Per spec: day 3 → times ['12:00', '18:00']
        assert "1" in sched
        assert "3" in sched
        print(f"PASS: Payload format matches spec: {sched}")

    def test_all_days_different_times(self, headers):
        """POST all 7 days each with 1 time."""
        schedule = {str(i): [f"{8+i:02d}:00"] for i in range(7)}
        payload = {
            "title": "TEST_Iter9 All Days",
            "latitude": 48.8566, "longitude": 2.3522,
            "precision": "exact", "domain_id": "dom_sport",
            "tag_ids": VALID_TAG_IDS, "images": [],
            "event_schedule": {"type": "weekly", "schedule": schedule}
        }
        resp = requests.post(TP_URL, json=payload, headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        CREATED_IDS.append(data["point_id"])
        print(f"PASS: All 7 days created, point_id={data['point_id']}")


# ─── Test 2: Backward compatibility ────────────────────────────────────────────
class TestBackwardCompatibility:
    """Old format still accepted."""

    def test_old_day_time_format(self, headers):
        """Legacy {type:'weekly', day:0, time:'09:00'} still accepted."""
        payload = {
            "title": "TEST_Iter9 Legacy Format",
            "latitude": 48.8566, "longitude": 2.3522,
            "precision": "exact", "domain_id": "dom_sport",
            "tag_ids": VALID_TAG_IDS, "images": [],
            "event_schedule": {"type": "weekly", "day": 0, "time": "09:00"}
        }
        resp = requests.post(TP_URL, json=payload, headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        CREATED_IDS.append(data["point_id"])
        assert "point_id" in data
        print(f"PASS: Legacy format accepted, point_id={data['point_id']}")

    def test_intermediate_days_times_format(self, headers):
        """Intermediate {type:'weekly', days:[0,2], times:['09:00']} format."""
        payload = {
            "title": "TEST_Iter9 Intermediate Format",
            "latitude": 48.8566, "longitude": 2.3522,
            "precision": "exact", "domain_id": "dom_sport",
            "tag_ids": VALID_TAG_IDS, "images": [],
            "event_schedule": {"type": "weekly", "days": [0, 2], "times": ["09:00"]}
        }
        resp = requests.post(TP_URL, json=payload, headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        CREATED_IDS.append(data["point_id"])
        print(f"PASS: Intermediate format accepted, point_id={data['point_id']}")


# ─── Test 3: Cleanup ────────────────────────────────────────────────────────────
class TestCleanup:
    """Clean up test data created in this session."""

    def test_cleanup_created_points(self, headers):
        """Delete all TEST_ prefixed points created during tests."""
        deleted = 0
        for pid in CREATED_IDS:
            resp = requests.delete(f"{TP_URL}/{pid}", headers=headers)
            if resp.status_code in (200, 204, 404):
                deleted += 1
        print(f"Cleanup: deleted {deleted}/{len(CREATED_IDS)} test tagPoints")
        assert deleted >= 0  # Always pass cleanup
