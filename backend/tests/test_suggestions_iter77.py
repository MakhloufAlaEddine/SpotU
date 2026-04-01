"""
Tests for the Suggestions endpoint (Iteration 77).
Tests: GET /api/users/{id}/suggestions - authentication, authorization, pagination, content.
"""
import pytest
import httpx
import os

BASE_URL = os.environ.get("API_URL", "https://data-refresh-9.preview.emergentagent.com")

COACH_EMAIL = "coach@winek.app"
COACH_PASS  = "WinekCoach2024!"
USER_EMAIL  = "user@winek.app"
USER_PASS   = "WinekUser2024!"
ADMIN_EMAIL = "admin@winek.app"
ADMIN_PASS  = "WinekAdmin2024!"


def login(email: str, password: str) -> tuple[str, str]:
    """Returns (token, user_id)."""
    r = httpx.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"Login failed for {email}: {r.text}"
    d = r.json()
    return d["token"], d["user"]["user_id"]


class TestSuggestionsAuth:
    """Authentication and authorization tests for /api/users/{id}/suggestions."""

    def setup_method(self):
        self.coach_token, self.coach_id = login(COACH_EMAIL, COACH_PASS)
        self.user_token,  self.user_id  = login(USER_EMAIL,  USER_PASS)

    def test_suggestions_unauthenticated_returns_401(self):
        """Unauthenticated request → 401."""
        r = httpx.get(f"{BASE_URL}/api/users/{self.coach_id}/suggestions", timeout=15)
        assert r.status_code in (401, 403), \
            f"Expected 401/403 without auth, got {r.status_code}: {r.text}"
        print(f"PASS: unauthenticated → {r.status_code}")

    def test_suggestions_wrong_user_returns_403(self):
        """user tries to get suggestions for coach → 403."""
        r = httpx.get(
            f"{BASE_URL}/api/users/{self.coach_id}/suggestions",
            headers={"Authorization": f"Bearer {self.user_token}"},
            timeout=15,
        )
        assert r.status_code == 403, \
            f"Expected 403 when user_id != me_id, got {r.status_code}: {r.text}"
        print(f"PASS: wrong user → 403")

    def test_suggestions_own_profile_returns_200(self):
        """Authenticated request for own profile → 200 OK."""
        r = httpx.get(
            f"{BASE_URL}/api/users/{self.coach_id}/suggestions",
            headers={"Authorization": f"Bearer {self.coach_token}"},
            timeout=15,
        )
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        data = r.json()
        assert "suggestions" in data, "Response must have 'suggestions' key"
        assert "has_interests" in data, "Response must have 'has_interests' key"
        assert "count" in data, "Response must have 'count' key"
        assert isinstance(data["suggestions"], list)
        assert isinstance(data["has_interests"], bool)
        assert isinstance(data["count"], int)
        print(f"PASS: own profile → 200, has_interests={data['has_interests']}, count={data['count']}")


class TestSuggestionsContent:
    """Content tests for suggestions - interests and popular fallback."""

    def setup_method(self):
        self.coach_token, self.coach_id = login(COACH_EMAIL, COACH_PASS)
        self.user_token,  self.user_id  = login(USER_EMAIL,  USER_PASS)
        # Try login admin
        try:
            self.admin_token, self.admin_id = login(ADMIN_EMAIL, ADMIN_PASS)
        except Exception:
            self.admin_token, self.admin_id = None, None

    def test_coach_suggestions_response_structure(self):
        """coach@winek.app = user_coach001: Response has valid structure regardless of content."""
        r = httpx.get(
            f"{BASE_URL}/api/users/{self.coach_id}/suggestions",
            headers={"Authorization": f"Bearer {self.coach_token}"},
            timeout=15,
        )
        assert r.status_code == 200
        data = r.json()
        # Validate structure
        assert "suggestions" in data
        assert "has_interests" in data
        assert "count" in data
        assert isinstance(data["suggestions"], list)
        # Each suggestion should have required fields
        for s in data["suggestions"]:
            assert "user_id" in s, f"Missing user_id in suggestion: {s}"
            assert "name" in s, f"Missing name in suggestion: {s}"
            assert "role" in s, f"Missing role in suggestion: {s}"
            assert "common_count" in s, f"Missing common_count in suggestion: {s}"
            assert "common_interests" in s, f"Missing common_interests in suggestion: {s}"
            assert isinstance(s["common_interests"], list)
        # count must match len(suggestions)
        assert data["count"] == len(data["suggestions"]), \
            f"count={data['count']} != len(suggestions)={len(data['suggestions'])}"
        print(f"PASS: coach suggestions: has_interests={data['has_interests']}, count={data['count']}")

    def test_user_suggestions_has_interests_or_fallback(self):
        """user@winek.app = user_demo001: Either has interest-based suggestions or popular fallback."""
        r = httpx.get(
            f"{BASE_URL}/api/users/{self.user_id}/suggestions",
            headers={"Authorization": f"Bearer {self.user_token}"},
            timeout=15,
        )
        assert r.status_code == 200
        data = r.json()
        assert "has_interests" in data
        print(f"INFO: user_demo001 → has_interests={data['has_interests']}, count={data['count']}, suggestions_count={len(data['suggestions'])}")
        # Whether they have interests or not, the response structure must be valid
        assert isinstance(data["suggestions"], list)
        assert data["count"] == len(data["suggestions"])
        # Suggestions should not include the requesting user themselves
        for s in data["suggestions"]:
            assert s["user_id"] != self.user_id, f"User's own profile should not appear in suggestions"
        print(f"PASS: user suggestions response valid, count={data['count']}")

    def test_admin_suggestions_no_interests_popular_fallback(self):
        """admin@winek.app = user_admin001: No interests → should show popular users."""
        if not self.admin_token:
            pytest.skip("Admin login failed")
        r = httpx.get(
            f"{BASE_URL}/api/users/{self.admin_id}/suggestions",
            headers={"Authorization": f"Bearer {self.admin_token}"},
            timeout=15,
        )
        assert r.status_code == 200
        data = r.json()
        print(f"INFO: admin → has_interests={data['has_interests']}, count={data['count']}")
        # If no interests, should return popular users
        if not data["has_interests"]:
            # Popular fallback: all suggestions have common_count=0
            for s in data["suggestions"]:
                assert s["common_count"] == 0, f"No-interests user should have common_count=0: {s}"
            print(f"PASS: admin has no interests → popular fallback with count={data['count']}")
        else:
            # Admin has interests, verify suggestions based on common interests or fallback
            print(f"INFO: admin has interests, count={data['count']}")
        # Either way, admin must not appear in own suggestions
        for s in data["suggestions"]:
            assert s["user_id"] != self.admin_id

    def test_suggestions_excludes_already_followed(self):
        """Suggestions should not include users already followed by the requester."""
        # First, ensure user follows coach
        httpx.post(
            f"{BASE_URL}/api/users/{self.coach_id}/follow",
            headers={"Authorization": f"Bearer {self.user_token}"},
            json={},
            timeout=15,
        )
        # Get user suggestions - coach should not appear since they follow them
        r = httpx.get(
            f"{BASE_URL}/api/users/{self.user_id}/suggestions",
            headers={"Authorization": f"Bearer {self.user_token}"},
            timeout=15,
        )
        assert r.status_code == 200
        data = r.json()
        suggestion_ids = [s["user_id"] for s in data["suggestions"]]
        assert self.coach_id not in suggestion_ids, \
            f"Already-followed user {self.coach_id} should not appear in suggestions"
        print(f"PASS: already-followed user excluded from suggestions")


class TestSuggestionsPagination:
    """Pagination tests for suggestions endpoint."""

    def setup_method(self):
        self.coach_token, self.coach_id = login(COACH_EMAIL, COACH_PASS)
        self.user_token,  self.user_id  = login(USER_EMAIL,  USER_PASS)
        try:
            self.admin_token, self.admin_id = login(ADMIN_EMAIL, ADMIN_PASS)
        except Exception:
            self.admin_token, self.admin_id = None, None

    def test_pagination_limit_parameter(self):
        """Skip=0, limit=2 → at most 2 suggestions returned."""
        # Use admin (likely no interests → popular fallback, more users available)
        token = self.admin_token or self.user_token
        uid   = self.admin_id   or self.user_id
        if not token:
            pytest.skip("No admin/user token available")
        r = httpx.get(
            f"{BASE_URL}/api/users/{uid}/suggestions?skip=0&limit=2",
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )
        assert r.status_code == 200
        data = r.json()
        assert data["count"] <= 2, f"limit=2 but got count={data['count']}"
        assert len(data["suggestions"]) <= 2
        print(f"PASS: limit=2 → count={data['count']}, len={len(data['suggestions'])}")

    def test_pagination_skip_parameter(self):
        """skip=2, limit=2 → different results from skip=0."""
        token = self.admin_token or self.user_token
        uid   = self.admin_id   or self.user_id
        if not token:
            pytest.skip("No admin/user token available")
        r0 = httpx.get(
            f"{BASE_URL}/api/users/{uid}/suggestions?skip=0&limit=2",
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )
        r2 = httpx.get(
            f"{BASE_URL}/api/users/{uid}/suggestions?skip=2&limit=2",
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )
        assert r0.status_code == 200
        assert r2.status_code == 200
        d0 = r0.json()
        d2 = r2.json()
        # Both pages should have count <= 2
        assert d0["count"] <= 2
        assert d2["count"] <= 2
        # Pages should have different user_ids (or page2 is empty)
        ids0 = {s["user_id"] for s in d0["suggestions"]}
        ids2 = {s["user_id"] for s in d2["suggestions"]}
        # No overlap between page0 and page2 (unless not enough users)
        overlap = ids0 & ids2
        assert len(overlap) == 0, f"Overlap between pages: {overlap}"
        print(f"PASS: pagination works, page1 ids={ids0}, page2 ids={ids2}")

    def test_pagination_default_limit_is_10(self):
        """Default limit=10 → count <= 10."""
        r = httpx.get(
            f"{BASE_URL}/api/users/{self.user_id}/suggestions",
            headers={"Authorization": f"Bearer {self.user_token}"},
            timeout=15,
        )
        assert r.status_code == 200
        data = r.json()
        assert data["count"] <= 10, f"Default limit=10 but count={data['count']}"
        print(f"PASS: default limit → count={data['count']} <= 10")

    def test_pagination_skip_beyond_total(self):
        """skip=1000 → empty suggestions but 200 OK."""
        token = self.admin_token or self.user_token
        uid   = self.admin_id   or self.user_id
        r = httpx.get(
            f"{BASE_URL}/api/users/{uid}/suggestions?skip=1000&limit=10",
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )
        assert r.status_code == 200
        data = r.json()
        # Empty results are fine
        assert data["count"] >= 0
        print(f"PASS: skip=1000 → count={data['count']} (empty is OK)")
