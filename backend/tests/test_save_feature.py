"""
Backend tests for Tag Point Save/Unsave/Saved feature
Tests: POST /{id}/save, GET /saved, DELETE /{id}/unsave, GET /{id} (is_saved field)
"""
import pytest
import requests
import os

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/")

TEST_USER_EMAIL = "user@winek.app"
TEST_USER_PASSWORD = "WinekUser2024!"
TEST_POINT_ID = "pt_demo001"


@pytest.fixture(scope="module")
def auth_token():
    """Authenticate and get token"""
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
    """Ensure point is unsaved before each test"""
    requests.delete(f"{BASE_URL}/api/tag-points/{TEST_POINT_ID}/unsave", headers=auth_headers)
    yield
    # Cleanup after test
    requests.delete(f"{BASE_URL}/api/tag-points/{TEST_POINT_ID}/unsave", headers=auth_headers)


class TestSaveTagPoint:
    """POST /tag-points/{point_id}/save"""

    def test_save_requires_auth(self):
        """Save without auth returns 401"""
        resp = requests.post(f"{BASE_URL}/api/tag-points/{TEST_POINT_ID}/save",
                             headers={"Content-Type": "application/json"})
        assert resp.status_code == 401

    def test_save_returns_success_and_is_saved_true(self, auth_headers):
        """Save with auth returns {success: True, is_saved: True}"""
        resp = requests.post(f"{BASE_URL}/api/tag-points/{TEST_POINT_ID}/save",
                             headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["is_saved"] is True

    def test_save_idempotent(self, auth_headers):
        """Saving twice should still return is_saved: True (ON CONFLICT DO NOTHING)"""
        requests.post(f"{BASE_URL}/api/tag-points/{TEST_POINT_ID}/save", headers=auth_headers)
        resp = requests.post(f"{BASE_URL}/api/tag-points/{TEST_POINT_ID}/save", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["is_saved"] is True


class TestUnsaveTagPoint:
    """DELETE /tag-points/{point_id}/unsave"""

    def test_unsave_requires_auth(self):
        """Unsave without auth returns 401"""
        resp = requests.delete(f"{BASE_URL}/api/tag-points/{TEST_POINT_ID}/unsave",
                               headers={"Content-Type": "application/json"})
        assert resp.status_code == 401

    def test_unsave_returns_success_and_is_saved_false(self, auth_headers):
        """Unsave after save returns {success: True, is_saved: False}"""
        # First save
        requests.post(f"{BASE_URL}/api/tag-points/{TEST_POINT_ID}/save", headers=auth_headers)
        # Then unsave
        resp = requests.delete(f"{BASE_URL}/api/tag-points/{TEST_POINT_ID}/unsave",
                               headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["is_saved"] is False

    def test_unsave_when_not_saved_returns_200(self, auth_headers):
        """Unsave when not saved (idempotent DELETE) returns 200"""
        resp = requests.delete(f"{BASE_URL}/api/tag-points/{TEST_POINT_ID}/unsave",
                               headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["is_saved"] is False


class TestGetSavedTagPoints:
    """GET /tag-points/saved"""

    def test_saved_requires_auth(self):
        """GET saved without auth returns 401"""
        resp = requests.get(f"{BASE_URL}/api/tag-points/saved")
        assert resp.status_code == 401

    def test_saved_returns_empty_list_initially(self, auth_headers):
        """Saved list is empty before any save"""
        resp = requests.get(f"{BASE_URL}/api/tag-points/saved", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        # Should not have pt_demo001 since cleanup_save unsaved it
        point_ids = [item["point_id"] for item in data]
        assert TEST_POINT_ID not in point_ids

    def test_saved_shows_point_after_save(self, auth_headers):
        """Saved list shows point after saving it"""
        # Save the point
        requests.post(f"{BASE_URL}/api/tag-points/{TEST_POINT_ID}/save", headers=auth_headers)
        # Get saved list
        resp = requests.get(f"{BASE_URL}/api/tag-points/saved", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        point_ids = [item["point_id"] for item in data]
        assert TEST_POINT_ID in point_ids

    def test_saved_item_has_required_fields(self, auth_headers):
        """Saved list items have required fields"""
        # Save the point
        requests.post(f"{BASE_URL}/api/tag-points/{TEST_POINT_ID}/save", headers=auth_headers)
        resp = requests.get(f"{BASE_URL}/api/tag-points/saved", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) > 0
        item = data[0]
        # Check required fields
        assert "point_id" in item
        assert "title" in item
        assert isinstance(item["title"], str)
        assert len(item["title"]) > 0

    def test_saved_removed_after_unsave(self, auth_headers):
        """Point removed from saved list after unsave"""
        # Save
        requests.post(f"{BASE_URL}/api/tag-points/{TEST_POINT_ID}/save", headers=auth_headers)
        # Unsave
        requests.delete(f"{BASE_URL}/api/tag-points/{TEST_POINT_ID}/unsave", headers=auth_headers)
        # Check list
        resp = requests.get(f"{BASE_URL}/api/tag-points/saved", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        point_ids = [item["point_id"] for item in data]
        assert TEST_POINT_ID not in point_ids


class TestTagPointDetailIsSaved:
    """GET /tag-points/{point_id} - is_saved field"""

    def test_is_saved_false_when_not_saved(self, auth_headers):
        """is_saved is False when not saved"""
        resp = requests.get(f"{BASE_URL}/api/tag-points/{TEST_POINT_ID}", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "is_saved" in data
        assert data["is_saved"] is False

    def test_is_saved_true_after_save(self, auth_headers):
        """is_saved is True after saving"""
        requests.post(f"{BASE_URL}/api/tag-points/{TEST_POINT_ID}/save", headers=auth_headers)
        resp = requests.get(f"{BASE_URL}/api/tag-points/{TEST_POINT_ID}", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["is_saved"] is True

    def test_is_saved_false_after_unsave(self, auth_headers):
        """is_saved is False after unsaving"""
        requests.post(f"{BASE_URL}/api/tag-points/{TEST_POINT_ID}/save", headers=auth_headers)
        requests.delete(f"{BASE_URL}/api/tag-points/{TEST_POINT_ID}/unsave", headers=auth_headers)
        resp = requests.get(f"{BASE_URL}/api/tag-points/{TEST_POINT_ID}", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["is_saved"] is False

    def test_is_saved_absent_without_auth(self):
        """is_saved defaults to False when not authenticated"""
        resp = requests.get(f"{BASE_URL}/api/tag-points/{TEST_POINT_ID}")
        assert resp.status_code == 200
        data = resp.json()
        # is_saved should be present but False (no auth)
        assert data.get("is_saved", False) is False
