"""
Tests for event_end_date feature on tag-points API
Tests: POST/PUT/GET /api/tag-points with event_end_date
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://local-connect-117.preview.emergentagent.com').rstrip('/')

TEST_USER_EMAIL = "user@winek.app"
TEST_USER_PASSWORD = "WinekUser2024!"

created_point_ids = []


@pytest.fixture(scope="module")
def auth_token():
    """Get auth token for test user"""
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": TEST_USER_EMAIL,
        "password": TEST_USER_PASSWORD
    })
    assert resp.status_code == 200, f"Login failed: {resp.text}"
    token = resp.json().get("token") or resp.json().get("access_token")
    assert token, f"No access token in response. Keys: {list(resp.json().keys())}"
    return token


@pytest.fixture(scope="module")
def auth_headers(auth_token):
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


class TestCreateTagPointWithEndDate:
    """POST /api/tag-points with event_end_date"""

    def test_create_with_event_end_date(self, auth_headers):
        """Create a tagpoint with event_date AND event_end_date"""
        payload = {
            "title": "TEST_Event With End Time",
            "description": "Test event with start and end time",
            "latitude": 48.8566,
            "longitude": 2.3522,
            "precision": "exact",
            "domain_id": "dom_sport",
            "tag_ids": [],
            "event_date": "2026-03-15T14:00:00Z",
            "event_end_date": "2026-03-15T15:30:00Z",
            "images": []
        }
        resp = requests.post(f"{BASE_URL}/api/tag-points", json=payload, headers=auth_headers)
        print(f"Create response status: {resp.status_code}")
        print(f"Create response: {resp.text[:500]}")
        
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        
        # Verify event_end_date is in response
        assert "event_end_date" in data, "event_end_date field missing from response"
        assert data["event_end_date"] is not None, "event_end_date should not be None"
        
        # Store point_id for cleanup and further tests
        point_id = data.get("point_id")
        assert point_id, "No point_id in response"
        created_point_ids.append(point_id)
        
        # Check the end date value contains the expected time
        assert "15:30" in data["event_end_date"] or "2026-03-15" in data["event_end_date"], \
            f"Unexpected event_end_date value: {data['event_end_date']}"
        
        print(f"✅ Created point {point_id} with event_end_date={data['event_end_date']}")

    def test_create_without_event_end_date(self, auth_headers):
        """Create a tagpoint with event_date but NO event_end_date (optional)"""
        payload = {
            "title": "TEST_Event Without End Time",
            "latitude": 48.8566,
            "longitude": 2.3522,
            "precision": "exact",
            "domain_id": "dom_sport",
            "tag_ids": [],
            "event_date": "2026-03-20T10:00:00Z",
            "images": []
        }
        resp = requests.post(f"{BASE_URL}/api/tag-points", json=payload, headers=auth_headers)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        
        point_id = data.get("point_id")
        assert point_id, "No point_id in response"
        created_point_ids.append(point_id)
        
        # event_end_date should be null/None when not provided
        print(f"event_end_date value: {data.get('event_end_date')}")
        assert data.get("event_end_date") is None, \
            f"event_end_date should be None when not set, got: {data.get('event_end_date')}"
        
        print(f"✅ Created point {point_id} without event_end_date (None confirmed)")


class TestGetTagPointWithEndDate:
    """GET /api/tag-points/{id} returns event_end_date field"""

    def test_get_returns_event_end_date(self, auth_headers):
        """GET returns event_end_date when it was set"""
        # Create a point first
        payload = {
            "title": "TEST_Get End Date",
            "latitude": 48.8566,
            "longitude": 2.3522,
            "precision": "exact",
            "domain_id": "dom_sport",
            "tag_ids": [],
            "event_date": "2026-04-10T09:00:00Z",
            "event_end_date": "2026-04-10T11:00:00Z",
            "images": []
        }
        create_resp = requests.post(f"{BASE_URL}/api/tag-points", json=payload, headers=auth_headers)
        assert create_resp.status_code == 200
        point_id = create_resp.json()["point_id"]
        created_point_ids.append(point_id)

        # GET the point
        get_resp = requests.get(f"{BASE_URL}/api/tag-points/{point_id}", headers=auth_headers)
        assert get_resp.status_code == 200, f"GET failed: {get_resp.text}"
        data = get_resp.json()
        
        # Verify event_end_date field is present and not None
        assert "event_end_date" in data, "event_end_date field missing from GET response"
        assert data["event_end_date"] is not None, "event_end_date should not be None"
        print(f"✅ GET returns event_end_date: {data['event_end_date']}")

    def test_get_event_end_date_is_null_when_not_set(self, auth_headers):
        """GET returns null event_end_date when not set"""
        payload = {
            "title": "TEST_Get No End Date",
            "latitude": 48.8566,
            "longitude": 2.3522,
            "precision": "exact",
            "domain_id": "dom_sport",
            "tag_ids": [],
            "event_date": "2026-04-15T09:00:00Z",
            "images": []
        }
        create_resp = requests.post(f"{BASE_URL}/api/tag-points", json=payload, headers=auth_headers)
        assert create_resp.status_code == 200
        point_id = create_resp.json()["point_id"]
        created_point_ids.append(point_id)

        get_resp = requests.get(f"{BASE_URL}/api/tag-points/{point_id}", headers=auth_headers)
        assert get_resp.status_code == 200
        data = get_resp.json()
        
        assert "event_end_date" in data, "event_end_date field should always be present in GET response"
        assert data["event_end_date"] is None, \
            f"event_end_date should be None when not set, got: {data['event_end_date']}"
        print(f"✅ GET returns event_end_date=None when not set")


class TestUpdateTagPointWithEndDate:
    """PUT /api/tag-points/{id} with event_end_date"""

    def test_update_adds_event_end_date(self, auth_headers):
        """Update a tagpoint to add event_end_date"""
        # Create without end date
        payload = {
            "title": "TEST_Update End Date",
            "latitude": 48.8566,
            "longitude": 2.3522,
            "precision": "exact",
            "domain_id": "dom_sport",
            "tag_ids": [],
            "event_date": "2026-05-01T14:00:00Z",
            "images": []
        }
        create_resp = requests.post(f"{BASE_URL}/api/tag-points", json=payload, headers=auth_headers)
        assert create_resp.status_code == 200
        point_id = create_resp.json()["point_id"]
        created_point_ids.append(point_id)
        
        assert create_resp.json().get("event_end_date") is None, "Should start without end date"
        
        # Update to add event_end_date
        update_payload = {
            "event_end_date": "2026-05-01T15:30:00Z"
        }
        update_resp = requests.put(f"{BASE_URL}/api/tag-points/{point_id}", json=update_payload, headers=auth_headers)
        print(f"Update response status: {update_resp.status_code}")
        print(f"Update response: {update_resp.text[:500]}")
        
        assert update_resp.status_code == 200, f"PUT failed: {update_resp.text}"
        data = update_resp.json()
        
        # Verify event_end_date was set
        assert "event_end_date" in data, "event_end_date not in PUT response"
        assert data["event_end_date"] is not None, "event_end_date should not be None after update"
        assert "15:30" in data["event_end_date"] or "2026-05-01" in data["event_end_date"], \
            f"Unexpected event_end_date: {data['event_end_date']}"
        
        print(f"✅ PUT updated event_end_date to: {data['event_end_date']}")

    def test_update_clears_event_end_date(self, auth_headers):
        """Update a tagpoint to clear event_end_date (set to null)"""
        # Create with end date
        payload = {
            "title": "TEST_Clear End Date",
            "latitude": 48.8566,
            "longitude": 2.3522,
            "precision": "exact",
            "domain_id": "dom_sport",
            "tag_ids": [],
            "event_date": "2026-05-10T10:00:00Z",
            "event_end_date": "2026-05-10T12:00:00Z",
            "images": []
        }
        create_resp = requests.post(f"{BASE_URL}/api/tag-points", json=payload, headers=auth_headers)
        assert create_resp.status_code == 200
        point_id = create_resp.json()["point_id"]
        created_point_ids.append(point_id)
        
        # Update to clear event_end_date
        update_payload = {"event_end_date": None}
        update_resp = requests.put(f"{BASE_URL}/api/tag-points/{point_id}", json=update_payload, headers=auth_headers)
        assert update_resp.status_code == 200, f"PUT failed: {update_resp.text}"
        data = update_resp.json()
        
        # Verify event_end_date was cleared
        assert data.get("event_end_date") is None, \
            f"event_end_date should be None after clearing, got: {data.get('event_end_date')}"
        
        # Also verify via GET
        get_resp = requests.get(f"{BASE_URL}/api/tag-points/{point_id}", headers=auth_headers)
        assert get_resp.status_code == 200
        assert get_resp.json().get("event_end_date") is None, \
            "GET should also return None after clearing"
        
        print(f"✅ PUT cleared event_end_date to None (verified via GET)")

    def test_update_preserves_event_end_date_when_not_sent(self, auth_headers):
        """PUT without event_end_date does NOT overwrite existing value (exclude_unset=True)"""
        # Create with end date
        payload = {
            "title": "TEST_Preserve End Date",
            "latitude": 48.8566,
            "longitude": 2.3522,
            "precision": "exact",
            "domain_id": "dom_sport",
            "tag_ids": [],
            "event_date": "2026-06-01T09:00:00Z",
            "event_end_date": "2026-06-01T10:30:00Z",
            "images": []
        }
        create_resp = requests.post(f"{BASE_URL}/api/tag-points", json=payload, headers=auth_headers)
        assert create_resp.status_code == 200
        point_id = create_resp.json()["point_id"]
        created_point_ids.append(point_id)
        
        # Update title only — should NOT affect event_end_date
        update_payload = {"title": "TEST_Preserve End Date - Updated Title"}
        update_resp = requests.put(f"{BASE_URL}/api/tag-points/{point_id}", json=update_payload, headers=auth_headers)
        assert update_resp.status_code == 200
        data = update_resp.json()
        
        assert data.get("event_end_date") is not None, \
            "event_end_date should be preserved when not sent in update"
        assert data["title"] == "TEST_Preserve End Date - Updated Title"
        
        print(f"✅ event_end_date preserved: {data['event_end_date']}")


class TestCleanup:
    """Cleanup test data"""
    
    def test_cleanup(self, auth_headers):
        """Delete all TEST_ prefixed tagpoints created during tests"""
        deleted = []
        failed = []
        for point_id in created_point_ids:
            resp = requests.delete(f"{BASE_URL}/api/tag-points/{point_id}", headers=auth_headers)
            if resp.status_code in [200, 204]:
                deleted.append(point_id)
            else:
                failed.append((point_id, resp.status_code))
        
        print(f"✅ Cleaned up {len(deleted)} test points")
        if failed:
            print(f"⚠️ Failed to delete {len(failed)} points: {failed}")
