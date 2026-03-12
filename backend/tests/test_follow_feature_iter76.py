"""
Tests for the Follower/Following feature (Iteration 76).
Tests: listing followers/following, block/unblock, remove follower.
"""
import pytest
import httpx
import os

BASE_URL = os.environ.get("API_URL", "https://relationship-mgmt-1.preview.emergentagent.com")

COACH_EMAIL = "coach@winek.app"
COACH_PASS  = "WinekCoach2024!"
USER_EMAIL  = "user@winek.app"
USER_PASS   = "WinekUser2024!"


def login(email: str, password: str) -> tuple[str, str]:
    """Returns (token, user_id)."""
    r = httpx.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"Login failed: {r.text}"
    d = r.json()
    return d["token"], d["user"]["user_id"]


class TestFollowListEndpoints:
    """Tests for GET /api/users/{id}/followers and /api/users/{id}/following."""

    def setup_method(self):
        self.coach_token, self.coach_id = login(COACH_EMAIL, COACH_PASS)
        self.user_token,  self.user_id  = login(USER_EMAIL,  USER_PASS)

    def _ensure_following(self):
        """Ensure user follows coach for setup."""
        httpx.post(
            f"{BASE_URL}/api/users/{self.coach_id}/follow",
            headers={"Authorization": f"Bearer {self.user_token}"},
        )

    def _ensure_unfollowed(self):
        httpx.delete(
            f"{BASE_URL}/api/users/{self.coach_id}/follow",
            headers={"Authorization": f"Bearer {self.user_token}"},
        )

    def test_list_followers_unauthenticated(self):
        """Public access: no is_following_back / is_blocked fields computed."""
        self._ensure_following()
        r = httpx.get(f"{BASE_URL}/api/users/{self.coach_id}/followers")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        for item in data:
            assert "user_id" in item
            assert "name"    in item
            assert "role"    in item
            # Unauthenticated → is_following_back must be False
            assert item.get("is_following_back") is False

    def test_list_followers_authenticated(self):
        """Authenticated access: is_following_back computed for me."""
        self._ensure_following()
        r = httpx.get(
            f"{BASE_URL}/api/users/{self.coach_id}/followers",
            headers={"Authorization": f"Bearer {self.coach_token}"},
        )
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        # Find user in coach's followers
        user_entry = next((x for x in data if x["user_id"] == self.user_id), None)
        assert user_entry is not None, f"User {self.user_id} not found in followers list"
        assert "is_following_back" in user_entry
        assert "is_blocked" in user_entry

    def test_followers_sorted_alphabetically(self):
        """Followers list should be sorted alphabetically by name."""
        r = httpx.get(
            f"{BASE_URL}/api/users/{self.coach_id}/followers",
            headers={"Authorization": f"Bearer {self.coach_token}"},
        )
        assert r.status_code == 200
        names = [u["name"] for u in r.json()]
        assert names == sorted(names, key=str.lower), f"Names not sorted: {names}"

    def test_list_following_authenticated(self):
        """Authenticated access: following list with follows_back."""
        self._ensure_following()
        r = httpx.get(
            f"{BASE_URL}/api/users/{self.user_id}/following",
            headers={"Authorization": f"Bearer {self.user_token}"},
        )
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        coach_entry = next((x for x in data if x["user_id"] == self.coach_id), None)
        assert coach_entry is not None, "Coach should be in user's following list"
        assert "follows_back" in coach_entry
        assert "is_blocked"   in coach_entry


class TestFollowActions:
    """Tests for follow/unfollow actions."""

    def setup_method(self):
        self.coach_token, self.coach_id = login(COACH_EMAIL, COACH_PASS)
        self.user_token,  self.user_id  = login(USER_EMAIL,  USER_PASS)
        # Reset: unfollow first
        httpx.delete(
            f"{BASE_URL}/api/users/{self.coach_id}/follow",
            headers={"Authorization": f"Bearer {self.user_token}"},
        )

    def test_follow(self):
        r = httpx.post(
            f"{BASE_URL}/api/users/{self.coach_id}/follow",
            headers={"Authorization": f"Bearer {self.user_token}"},
            json={},
        )
        assert r.status_code == 200
        d = r.json()
        assert d["is_following"] is True
        assert isinstance(d["followers_count"], int)

    def test_unfollow(self):
        # Follow first
        httpx.post(
            f"{BASE_URL}/api/users/{self.coach_id}/follow",
            headers={"Authorization": f"Bearer {self.user_token}"},
            json={},
        )
        r = httpx.delete(
            f"{BASE_URL}/api/users/{self.coach_id}/follow",
            headers={"Authorization": f"Bearer {self.user_token}"},
        )
        assert r.status_code == 200
        d = r.json()
        assert d["is_following"] is False

    def test_follow_requires_auth(self):
        r = httpx.post(f"{BASE_URL}/api/users/{self.coach_id}/follow", json={})
        assert r.status_code in (401, 403)


class TestRemoveFollower:
    """Tests for DELETE /api/users/{id}/followers/{follower_id}."""

    def setup_method(self):
        self.coach_token, self.coach_id = login(COACH_EMAIL, COACH_PASS)
        self.user_token,  self.user_id  = login(USER_EMAIL,  USER_PASS)
        # Ensure user follows coach
        httpx.post(
            f"{BASE_URL}/api/users/{self.coach_id}/follow",
            headers={"Authorization": f"Bearer {self.user_token}"},
            json={},
        )

    def test_remove_follower_as_owner(self):
        r = httpx.delete(
            f"{BASE_URL}/api/users/{self.coach_id}/followers/{self.user_id}",
            headers={"Authorization": f"Bearer {self.coach_token}"},
        )
        assert r.status_code == 200
        d = r.json()
        assert d["removed"] is True
        assert isinstance(d["followers_count"], int)

    def test_remove_follower_forbidden_if_not_owner(self):
        """A non-owner cannot remove someone else's follower."""
        r = httpx.delete(
            f"{BASE_URL}/api/users/{self.coach_id}/followers/{self.user_id}",
            headers={"Authorization": f"Bearer {self.user_token}"},
        )
        assert r.status_code == 403


class TestBlockUnblock:
    """Tests for POST/DELETE /api/users/{id}/block."""

    def setup_method(self):
        self.coach_token, self.coach_id = login(COACH_EMAIL, COACH_PASS)
        self.user_token,  self.user_id  = login(USER_EMAIL,  USER_PASS)
        # Unblock first to start clean
        httpx.delete(
            f"{BASE_URL}/api/users/{self.coach_id}/block",
            headers={"Authorization": f"Bearer {self.user_token}"},
        )

    def test_block_user(self):
        r = httpx.post(
            f"{BASE_URL}/api/users/{self.coach_id}/block",
            headers={"Authorization": f"Bearer {self.user_token}"},
            json={},
        )
        assert r.status_code == 200
        assert r.json()["blocked"] is True

    def test_block_removes_follow_links(self):
        """Blocking should remove follows in both directions."""
        # First follow each other
        httpx.post(
            f"{BASE_URL}/api/users/{self.coach_id}/follow",
            headers={"Authorization": f"Bearer {self.user_token}"},
            json={},
        )
        # Block
        httpx.post(
            f"{BASE_URL}/api/users/{self.coach_id}/block",
            headers={"Authorization": f"Bearer {self.user_token}"},
            json={},
        )
        # User should no longer be in coach's followers
        r = httpx.get(
            f"{BASE_URL}/api/users/{self.coach_id}/followers",
            headers={"Authorization": f"Bearer {self.coach_token}"},
        )
        ids = [u["user_id"] for u in r.json()]
        assert self.user_id not in ids, "Blocked user should not appear in followers list"
        # Cleanup
        httpx.delete(
            f"{BASE_URL}/api/users/{self.coach_id}/block",
            headers={"Authorization": f"Bearer {self.user_token}"},
        )

    def test_unblock_user(self):
        httpx.post(
            f"{BASE_URL}/api/users/{self.coach_id}/block",
            headers={"Authorization": f"Bearer {self.user_token}"},
            json={},
        )
        r = httpx.delete(
            f"{BASE_URL}/api/users/{self.coach_id}/block",
            headers={"Authorization": f"Bearer {self.user_token}"},
        )
        assert r.status_code == 200
        assert r.json()["blocked"] is False

    def test_cannot_block_yourself(self):
        r = httpx.post(
            f"{BASE_URL}/api/users/{self.user_id}/block",
            headers={"Authorization": f"Bearer {self.user_token}"},
            json={},
        )
        assert r.status_code == 400

    def test_block_requires_auth(self):
        r = httpx.post(f"{BASE_URL}/api/users/{self.coach_id}/block", json={})
        assert r.status_code in (401, 403)
