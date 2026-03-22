"""
WINEK TagPoint Creation Tests - Iteration 8
Focus: New multi-day recurring schedule format {type:'weekly', days:[0,2,4], times:['09:00','17:00']}
Tests POST /api/tag-points with the new payload format from the updated create.tsx wizard
"""
import pytest
import requests
import os

def _load_base_url():
    url = os.environ.get('EXPO_PUBLIC_BACKEND_URL') or os.environ.get('REACT_APP_BACKEND_URL')
    if url:
        return url.rstrip('/')
    env_path = os.path.join(os.path.dirname(__file__), '../../frontend/.env')
    try:
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line.startswith('EXPO_PUBLIC_BACKEND_URL='):
                    return line.split('=', 1)[1].strip().rstrip('/')
    except Exception:
        pass
    return 'https://marketplace-modal.preview.emergentagent.com'

BASE_URL = _load_base_url()
USER_EMAIL = "user@winek.app"
USER_PASS = "WinekUser2024!"
PARIS_LAT = 48.8566
PARIS_LNG = 2.3522


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
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def auth_headers(api):
    resp = api.post(f"{BASE_URL}/api/auth/login", json={
        "email": USER_EMAIL,
        "password": USER_PASS
    })
    assert resp.status_code == 200, f"Login failed: {resp.text}"
    token = resp.json()["token"]
    return {"Authorization": f"Bearer {token}"}


class TestNewRecurringScheduleFormat:
    """Tests for POST /api/tag-points with new multi-day, multi-time recurring schedule"""

    def test_recurring_multi_day_single_time(self, api, auth_headers):
        """New format: days array + times array (single time)"""
        payload = {
            "title": "TEST_Recurring multi-day single-time",
            "latitude": PARIS_LAT,
            "longitude": PARIS_LNG,
            "precision": "exact",
            "tag_ids": VALID_TAG_IDS,
            "domain_id": "dom_sport",
            "images": [],
            "event_schedule": {
                "type": "weekly",
                "days": [0, 2, 4],  # Mon, Wed, Fri (new format - array)
                "times": ["09:00"]   # single time (new format - array of strings)
            }
        }
        resp = api.post(f"{BASE_URL}/api/tag-points", json=payload, headers=auth_headers)
        print(f"Recurring multi-day single-time: {resp.status_code} - {resp.text[:400]}")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert "point_id" in data
        # Verify event_schedule stored correctly
        sched = data.get("event_schedule")
        print(f"Stored event_schedule: {sched}")
        assert sched is not None, "event_schedule should be stored"
        # Cleanup
        api.delete(f"{BASE_URL}/api/tag-points/{data['point_id']}", headers=auth_headers)

    def test_recurring_multi_day_multi_time(self, api, auth_headers):
        """New format: days array + times array (multiple times - the main new feature)"""
        payload = {
            "title": "TEST_Recurring Mon+Wed+Fri with multiple slots",
            "latitude": PARIS_LAT,
            "longitude": PARIS_LNG,
            "precision": "exact",
            "tag_ids": VALID_TAG_IDS,
            "domain_id": "dom_sport",
            "images": [],
            "event_schedule": {
                "type": "weekly",
                "days": [0, 2, 4],  # Mon, Wed, Fri
                "times": ["09:00", "17:00"]  # Two time slots
            }
        }
        resp = api.post(f"{BASE_URL}/api/tag-points", json=payload, headers=auth_headers)
        print(f"Recurring multi-day multi-time: {resp.status_code} - {resp.text[:400]}")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert "point_id" in data
        pid = data["point_id"]

        # Verify via GET
        get_resp = api.get(f"{BASE_URL}/api/tag-points/{pid}")
        assert get_resp.status_code == 200
        stored = get_resp.json()
        sched = stored.get("event_schedule")
        print(f"GET event_schedule: {sched}")
        assert sched is not None

        # Cleanup
        api.delete(f"{BASE_URL}/api/tag-points/{pid}", headers=auth_headers)

    def test_recurring_single_day_three_times(self, api, auth_headers):
        """Single day, multiple time slots"""
        payload = {
            "title": "TEST_Recurring single day three times",
            "latitude": PARIS_LAT,
            "longitude": PARIS_LNG,
            "precision": "exact",
            "tag_ids": VALID_TAG_IDS,
            "domain_id": "dom_sport",
            "images": [],
            "event_schedule": {
                "type": "weekly",
                "days": [1],  # Tuesday
                "times": ["07:30", "12:00", "19:00"]  # Three slots
            }
        }
        resp = api.post(f"{BASE_URL}/api/tag-points", json=payload, headers=auth_headers)
        print(f"Single day 3 times: {resp.status_code}")
        assert resp.status_code == 200
        data = resp.json()
        assert "point_id" in data
        # Cleanup
        api.delete(f"{BASE_URL}/api/tag-points/{data['point_id']}", headers=auth_headers)

    def test_recurring_all_days_two_times(self, api, auth_headers):
        """All 7 days + 2 time slots"""
        payload = {
            "title": "TEST_Recurring all days",
            "latitude": PARIS_LAT,
            "longitude": PARIS_LNG,
            "precision": "exact",
            "tag_ids": VALID_TAG_IDS,
            "domain_id": "dom_sport",
            "images": [],
            "event_schedule": {
                "type": "weekly",
                "days": [0, 1, 2, 3, 4, 5, 6],  # All days
                "times": ["08:00", "18:00"]
            }
        }
        resp = api.post(f"{BASE_URL}/api/tag-points", json=payload, headers=auth_headers)
        print(f"All days: {resp.status_code}")
        assert resp.status_code == 200
        data = resp.json()
        assert "point_id" in data
        # Cleanup
        api.delete(f"{BASE_URL}/api/tag-points/{data['point_id']}", headers=auth_headers)

    def test_backward_compat_old_format(self, api, auth_headers):
        """Old format {type, day, time} should still work (backward compat)"""
        payload = {
            "title": "TEST_Old recurring format",
            "latitude": PARIS_LAT,
            "longitude": PARIS_LNG,
            "precision": "exact",
            "tag_ids": VALID_TAG_IDS,
            "domain_id": "dom_sport",
            "images": [],
            "event_schedule": {"type": "weekly", "day": 0, "time": "18:30"}
        }
        resp = api.post(f"{BASE_URL}/api/tag-points", json=payload, headers=auth_headers)
        print(f"Old format backward compat: {resp.status_code}")
        assert resp.status_code == 200
        data = resp.json()
        assert "point_id" in data
        # Cleanup
        api.delete(f"{BASE_URL}/api/tag-points/{data['point_id']}", headers=auth_headers)

    def test_recurring_multi_day_with_100m_precision(self, api, auth_headers):
        """Recurring multi-day + 100m precision"""
        payload = {
            "title": "TEST_Recurring 100m precision",
            "latitude": PARIS_LAT,
            "longitude": PARIS_LNG,
            "precision": "100m",
            "tag_ids": VALID_TAG_IDS,
            "domain_id": "dom_coaching",
            "images": [],
            "event_schedule": {
                "type": "weekly",
                "days": [1, 4],  # Tue, Fri
                "times": ["09:00", "17:00"]
            }
        }
        resp = api.post(f"{BASE_URL}/api/tag-points", json=payload, headers=auth_headers)
        print(f"Recurring 100m precision: {resp.status_code}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["precision"] == "100m"
        # Cleanup
        api.delete(f"{BASE_URL}/api/tag-points/{data['point_id']}", headers=auth_headers)
