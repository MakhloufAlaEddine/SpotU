"""
Backend tests for private SpotYou visibility feature (iteration 111).
Tests:
- Home feed returns visibility_type in SpotYou data
- Search (GET /api/tag-points) returns private SpotYou with visibility_type='private'
- POST /api/tag-points/{id}/join returns 403 for private SpotYou
"""

import pytest
import requests
import os

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://spotme-ui-polish.preview.emergentagent.com").rstrip("/")

PRIVATE_SPOT_ID = "pt_e8e4497fed69"
OWNER_EMAIL = "coach@winek.app"
OWNER_PASSWORD = "WinekCoach2024!"
NON_MEMBER_EMAIL = "mbenali@winek.app"
NON_MEMBER_PASSWORD = "WinekDemo2024!"


@pytest.fixture(scope="module")
def mbenali_token():
    """Auth token for non-member user mbenali@winek.app"""
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": NON_MEMBER_EMAIL, "password": NON_MEMBER_PASSWORD
    })
    assert resp.status_code == 200, f"Login failed: {resp.text}"
    return resp.json()["token"]


@pytest.fixture(scope="module")
def coach_token():
    """Auth token for owner coach@winek.app"""
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": OWNER_EMAIL, "password": OWNER_PASSWORD
    })
    assert resp.status_code == 200, f"Login failed: {resp.text}"
    return resp.json()["token"]


class TestHomeFeedVisibilityType:
    """Home feed must return visibility_type in SpotYou items"""

    def test_home_feed_without_auth_returns_spotyou_list(self):
        """GET /api/home/feed returns spotyou list without authentication"""
        resp = requests.get(f"{BASE_URL}/api/home/feed")
        assert resp.status_code == 200
        data = resp.json()
        assert "spotyou" in data, f"Expected 'spotyou' key, got keys: {list(data.keys())}"
        spot_you = data["spotyou"]
        assert isinstance(spot_you, list)

    def test_home_feed_items_have_visibility_type(self):
        """Each SpotYou in home feed must include visibility_type field"""
        resp = requests.get(f"{BASE_URL}/api/home/feed")
        assert resp.status_code == 200
        data = resp.json()
        spot_you = data.get("spotyou", [])
        assert len(spot_you) > 0, "No SpotYou items in feed to verify"
        for item in spot_you:
            assert "visibility_type" in item, (
                f"SpotYou {item.get('point_id')} missing 'visibility_type' field"
            )
            assert item["visibility_type"] in ("public", "private"), (
                f"Unexpected visibility_type value: {item.get('visibility_type')}"
            )

    def test_home_feed_private_spotyou_visible_without_auth(self):
        """Private SpotYou pt_e8e4497fed69 must appear in home feed even without auth"""
        resp = requests.get(f"{BASE_URL}/api/home/feed")
        assert resp.status_code == 200
        data = resp.json()
        spot_you = data.get("spotyou", [])
        # Find the private SpotYou
        private = next((s for s in spot_you if s.get("point_id") == PRIVATE_SPOT_ID), None)
        assert private is not None, (
            f"{PRIVATE_SPOT_ID} not found in home feed (total items={len(spot_you)}). "
            "Private SpotYou should be publicly visible."
        )
        assert private["visibility_type"] == "private"

    def test_home_feed_with_auth_returns_visibility_type(self, mbenali_token):
        """Home feed with auth token also returns visibility_type"""
        resp = requests.get(
            f"{BASE_URL}/api/home/feed",
            headers={"Authorization": f"Bearer {mbenali_token}"}
        )
        assert resp.status_code == 200
        data = resp.json()
        spot_you = data.get("spotyou", [])
        for item in spot_you:
            assert "visibility_type" in item, (
                f"SpotYou {item.get('point_id')} missing visibility_type"
            )


class TestSearchVisibilityType:
    """Search endpoint must return private SpotYou with visibility_type"""

    def test_search_returns_visibility_type_field(self):
        """GET /api/tag-points returns visibility_type for each SpotYou"""
        resp = requests.get(f"{BASE_URL}/api/tag-points")
        assert resp.status_code == 200
        data = resp.json()
        items = data if isinstance(data, list) else data.get("items", data.get("results", []))
        assert len(items) > 0, "No items returned from /api/tag-points"
        for item in items[:5]:
            assert "visibility_type" in item, (
                f"Item {item.get('point_id')} missing visibility_type"
            )

    def test_search_returns_private_spotyou(self):
        """Private SpotYou pt_e8e4497fed69 must appear in search results"""
        resp = requests.get(f"{BASE_URL}/api/tag-points")
        assert resp.status_code == 200
        data = resp.json()
        items = data if isinstance(data, list) else data.get("items", data.get("results", []))
        private = next((i for i in items if i.get("point_id") == PRIVATE_SPOT_ID), None)
        assert private is not None, (
            f"{PRIVATE_SPOT_ID} not found in /api/tag-points results"
        )

    def test_search_private_spotyou_visibility_is_private(self):
        """Private SpotYou must have visibility_type='private' in search results"""
        resp = requests.get(f"{BASE_URL}/api/tag-points")
        assert resp.status_code == 200
        data = resp.json()
        items = data if isinstance(data, list) else data.get("items", data.get("results", []))
        private = next((i for i in items if i.get("point_id") == PRIVATE_SPOT_ID), None)
        assert private is not None
        assert private["visibility_type"] == "private", (
            f"Expected visibility_type='private', got: {private.get('visibility_type')}"
        )

    def test_search_by_query_padel_returns_private(self):
        """Search 'padel' returns the private SpotYou with correct visibility_type"""
        resp = requests.get(f"{BASE_URL}/api/tag-points?q=padel")
        assert resp.status_code == 200
        data = resp.json()
        items = data if isinstance(data, list) else data.get("items", data.get("results", []))
        private = next((i for i in items if i.get("point_id") == PRIVATE_SPOT_ID), None)
        assert private is not None, f"{PRIVATE_SPOT_ID} not found in padel search"
        assert private["visibility_type"] == "private"


class TestPrivateSpotYouDetail:
    """Detail endpoint returns visibility_type for private SpotYou"""

    def test_detail_no_auth_returns_visibility_type(self):
        """GET /api/tag-points/{id} returns visibility_type without auth"""
        resp = requests.get(f"{BASE_URL}/api/tag-points/{PRIVATE_SPOT_ID}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["point_id"] == PRIVATE_SPOT_ID
        assert "visibility_type" in data
        assert data["visibility_type"] == "private"

    def test_detail_with_auth_returns_visibility_type(self, mbenali_token):
        """GET /api/tag-points/{id} returns visibility_type with auth (non-member)"""
        resp = requests.get(
            f"{BASE_URL}/api/tag-points/{PRIVATE_SPOT_ID}",
            headers={"Authorization": f"Bearer {mbenali_token}"}
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["visibility_type"] == "private"


class TestJoinPrivateSpotYou403:
    """POST /api/tag-points/{id}/join must return 403 for private SpotYou"""

    def test_join_private_unauthenticated_returns_401(self):
        """Join attempt without auth returns 401"""
        resp = requests.post(f"{BASE_URL}/api/tag-points/{PRIVATE_SPOT_ID}/join")
        assert resp.status_code == 401

    def test_join_private_as_non_member_returns_403(self, mbenali_token):
        """POST /join as non-member returns HTTP 403 for private SpotYou"""
        resp = requests.post(
            f"{BASE_URL}/api/tag-points/{PRIVATE_SPOT_ID}/join",
            headers={"Authorization": f"Bearer {mbenali_token}"}
        )
        assert resp.status_code == 403, (
            f"Expected 403 for private SpotYou join, got {resp.status_code}: {resp.text}"
        )

    def test_join_private_403_error_message(self, mbenali_token):
        """403 response must contain meaningful error message"""
        resp = requests.post(
            f"{BASE_URL}/api/tag-points/{PRIVATE_SPOT_ID}/join",
            headers={"Authorization": f"Bearer {mbenali_token}"}
        )
        assert resp.status_code == 403
        data = resp.json()
        assert "detail" in data
        assert len(data["detail"]) > 0
        # Message should mention private or invitation
        detail_lower = data["detail"].lower()
        assert "priv" in detail_lower or "invitation" in detail_lower, (
            f"403 message doesn't mention private/invitation: {data['detail']}"
        )

    def test_join_private_as_owner_returns_error(self, coach_token):
        """Owner trying to join their own private SpotYou should get an error (not 200)"""
        resp = requests.post(
            f"{BASE_URL}/api/tag-points/{PRIVATE_SPOT_ID}/join",
            headers={"Authorization": f"Bearer {coach_token}"}
        )
        # Owner should get 403 (private) OR 400 (already owner) - not 200
        assert resp.status_code in (400, 403, 409), (
            f"Owner join should fail, got {resp.status_code}: {resp.text}"
        )
