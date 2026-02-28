"""
Backend tests for Service Save/Unsave/Saved feature (Iteration 43)
Tests: GET /services/saved, POST /services/{id}/save, DELETE /services/{id}/unsave
Route ordering: /services/saved must be before /services/{service_id}
"""
import pytest
import requests
import os

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/")

TEST_USER_EMAIL = "user@winek.app"
TEST_USER_PASSWORD = "WinekUser2024!"
TEST_SERVICE_ID = "svc_demo001"


@pytest.fixture(scope="module")
def auth_token():
    """Authenticate user and get token"""
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": TEST_USER_EMAIL,
        "password": TEST_USER_PASSWORD
    })
    assert resp.status_code == 200, f"Login failed: {resp.text}"
    token = resp.json().get("token")
    assert token, "No token in login response"
    return token


@pytest.fixture(scope="module")
def auth_headers(auth_token):
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


@pytest.fixture(autouse=True)
def cleanup_save(auth_headers):
    """Ensure service is unsaved before and after each test"""
    requests.delete(f"{BASE_URL}/api/services/{TEST_SERVICE_ID}/unsave", headers=auth_headers)
    yield
    requests.delete(f"{BASE_URL}/api/services/{TEST_SERVICE_ID}/unsave", headers=auth_headers)


class TestGetSavedServices:
    """GET /services/saved - Route must NOT be swallowed by /services/{service_id}"""

    def test_saved_route_requires_auth(self):
        """GET /services/saved without auth returns 401 (not 404 from service route)"""
        resp = requests.get(f"{BASE_URL}/api/services/saved")
        # If 404, route ordering is wrong (saved is being matched as service_id='saved')
        assert resp.status_code == 401, (
            f"Expected 401 (auth required), got {resp.status_code}. "
            f"If 404, route /services/saved is being swallowed by /services/{{service_id}}"
        )

    def test_saved_returns_list(self, auth_headers):
        """GET /services/saved with auth returns array"""
        resp = requests.get(f"{BASE_URL}/api/services/saved", headers=auth_headers)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"

    def test_saved_initially_empty_for_service(self, auth_headers):
        """After cleanup, svc_demo001 should not be in saved list"""
        resp = requests.get(f"{BASE_URL}/api/services/saved", headers=auth_headers)
        assert resp.status_code == 200
        service_ids = [item["service_id"] for item in resp.json()]
        assert TEST_SERVICE_ID not in service_ids, f"{TEST_SERVICE_ID} should not be in saved list"

    def test_saved_shows_service_after_save(self, auth_headers):
        """Service appears in saved list after POST /save"""
        # Save the service
        save_resp = requests.post(
            f"{BASE_URL}/api/services/{TEST_SERVICE_ID}/save", headers=auth_headers, json={}
        )
        assert save_resp.status_code == 200

        # Check it appears in saved list
        resp = requests.get(f"{BASE_URL}/api/services/saved", headers=auth_headers)
        assert resp.status_code == 200
        service_ids = [item["service_id"] for item in resp.json()]
        assert TEST_SERVICE_ID in service_ids, f"{TEST_SERVICE_ID} should be in saved list after saving"

    def test_saved_item_has_required_fields(self, auth_headers):
        """Saved service items must have required fields"""
        requests.post(f"{BASE_URL}/api/services/{TEST_SERVICE_ID}/save", headers=auth_headers, json={})
        resp = requests.get(f"{BASE_URL}/api/services/saved", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) > 0, "Expected at least one saved service"
        item = data[0]
        # Validate required fields
        assert "service_id" in item, "Missing service_id"
        assert "title" in item, "Missing title"
        assert "price" in item, "Missing price"
        assert "coach" in item, "Missing coach"
        assert isinstance(item["title"], str) and len(item["title"]) > 0
        assert "name" in (item.get("coach") or {}), "Missing coach.name"

    def test_saved_removed_after_unsave(self, auth_headers):
        """Service removed from saved list after DELETE /unsave"""
        # Save
        requests.post(f"{BASE_URL}/api/services/{TEST_SERVICE_ID}/save", headers=auth_headers, json={})
        # Unsave
        requests.delete(f"{BASE_URL}/api/services/{TEST_SERVICE_ID}/unsave", headers=auth_headers)
        # Verify removed
        resp = requests.get(f"{BASE_URL}/api/services/saved", headers=auth_headers)
        assert resp.status_code == 200
        service_ids = [item["service_id"] for item in resp.json()]
        assert TEST_SERVICE_ID not in service_ids, f"{TEST_SERVICE_ID} should not be in saved list after unsave"


class TestSaveService:
    """POST /services/{service_id}/save"""

    def test_save_requires_auth(self):
        """Save without auth returns 401"""
        resp = requests.post(
            f"{BASE_URL}/api/services/{TEST_SERVICE_ID}/save",
            headers={"Content-Type": "application/json"},
            json={}
        )
        assert resp.status_code == 401

    def test_save_returns_success(self, auth_headers):
        """Save with auth returns {success: True, is_saved: True}"""
        resp = requests.post(
            f"{BASE_URL}/api/services/{TEST_SERVICE_ID}/save", headers=auth_headers, json={}
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data.get("success") is True, "Expected success=True"
        assert data.get("is_saved") is True, "Expected is_saved=True"

    def test_save_idempotent(self, auth_headers):
        """Saving twice should succeed (ON CONFLICT DO NOTHING)"""
        requests.post(f"{BASE_URL}/api/services/{TEST_SERVICE_ID}/save", headers=auth_headers, json={})
        resp = requests.post(f"{BASE_URL}/api/services/{TEST_SERVICE_ID}/save", headers=auth_headers, json={})
        assert resp.status_code == 200
        assert resp.json().get("is_saved") is True

    def test_save_nonexistent_service_returns_404(self, auth_headers):
        """Saving a non-existent service returns 404"""
        resp = requests.post(
            f"{BASE_URL}/api/services/nonexistent_svc_999/save", headers=auth_headers, json={}
        )
        assert resp.status_code == 404


class TestUnsaveService:
    """DELETE /services/{service_id}/unsave"""

    def test_unsave_requires_auth(self):
        """Unsave without auth returns 401"""
        resp = requests.delete(
            f"{BASE_URL}/api/services/{TEST_SERVICE_ID}/unsave",
            headers={"Content-Type": "application/json"}
        )
        assert resp.status_code == 401

    def test_unsave_after_save_returns_success(self, auth_headers):
        """Unsave after save returns {success: True, is_saved: False}"""
        # First save
        requests.post(f"{BASE_URL}/api/services/{TEST_SERVICE_ID}/save", headers=auth_headers, json={})
        # Then unsave
        resp = requests.delete(
            f"{BASE_URL}/api/services/{TEST_SERVICE_ID}/unsave", headers=auth_headers
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data.get("success") is True
        assert data.get("is_saved") is False

    def test_unsave_idempotent(self, auth_headers):
        """Unsaving when not saved should succeed (no error)"""
        resp = requests.delete(
            f"{BASE_URL}/api/services/{TEST_SERVICE_ID}/unsave", headers=auth_headers
        )
        assert resp.status_code == 200
        assert resp.json().get("is_saved") is False
