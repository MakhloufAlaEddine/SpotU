"""
Iteration 19 - Backend tests for WINEK banking info (iban/bic/iban_name):
- GET /api/users/profile returns iban, bic, iban_name, avg_rating, review_count
- PUT /api/users/profile saves iban, bic, iban_name correctly
- GET /api/users/{id}/public does NOT return banking info (privacy)
"""
import pytest
import requests
import os

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")

USER_EMAIL = "user@winek.app"
USER_PASSWORD = "WinekUser2024!"
COACH_EMAIL = "coach@winek.app"
COACH_PASSWORD = "WinekCoach2024!"


@pytest.fixture(scope="module")
def user_token():
    """Login as regular user and get token"""
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": USER_EMAIL,
        "password": USER_PASSWORD
    })
    assert resp.status_code == 200, f"Login failed: {resp.text}"
    data = resp.json()
    assert "token" in data, f"No token in response: {data}"
    return data["token"]


@pytest.fixture(scope="module")
def user_id(user_token):
    """Get user ID from profile"""
    resp = requests.get(
        f"{BASE_URL}/api/users/profile",
        headers={"Authorization": f"Bearer {user_token}"}
    )
    assert resp.status_code == 200
    return resp.json()["user_id"]


@pytest.fixture(scope="module")
def coach_token():
    """Login as coach and get token"""
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": COACH_EMAIL,
        "password": COACH_PASSWORD
    })
    assert resp.status_code == 200, f"Coach login failed: {resp.text}"
    return resp.json()["token"]


class TestGetProfile:
    """GET /api/users/profile - should return banking + review stats"""

    def test_get_profile_returns_200(self, user_token):
        resp = requests.get(
            f"{BASE_URL}/api/users/profile",
            headers={"Authorization": f"Bearer {user_token}"}
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

    def test_get_profile_returns_iban_field(self, user_token):
        resp = requests.get(
            f"{BASE_URL}/api/users/profile",
            headers={"Authorization": f"Bearer {user_token}"}
        )
        data = resp.json()
        assert "iban" in data, f"iban field missing from profile response. Keys: {list(data.keys())}"

    def test_get_profile_returns_bic_field(self, user_token):
        resp = requests.get(
            f"{BASE_URL}/api/users/profile",
            headers={"Authorization": f"Bearer {user_token}"}
        )
        data = resp.json()
        assert "bic" in data, f"bic field missing from profile response. Keys: {list(data.keys())}"

    def test_get_profile_returns_iban_name_field(self, user_token):
        resp = requests.get(
            f"{BASE_URL}/api/users/profile",
            headers={"Authorization": f"Bearer {user_token}"}
        )
        data = resp.json()
        assert "iban_name" in data, f"iban_name field missing from profile response. Keys: {list(data.keys())}"

    def test_get_profile_returns_avg_rating(self, user_token):
        resp = requests.get(
            f"{BASE_URL}/api/users/profile",
            headers={"Authorization": f"Bearer {user_token}"}
        )
        data = resp.json()
        assert "avg_rating" in data, f"avg_rating missing. Keys: {list(data.keys())}"

    def test_get_profile_returns_review_count(self, user_token):
        resp = requests.get(
            f"{BASE_URL}/api/users/profile",
            headers={"Authorization": f"Bearer {user_token}"}
        )
        data = resp.json()
        assert "review_count" in data, f"review_count missing. Keys: {list(data.keys())}"
        assert isinstance(data["review_count"], int), f"review_count should be int, got {type(data['review_count'])}"

    def test_get_profile_unauthenticated_returns_401(self):
        resp = requests.get(f"{BASE_URL}/api/users/profile")
        assert resp.status_code == 401, f"Expected 401 without auth, got {resp.status_code}"


class TestPutProfile:
    """PUT /api/users/profile - should save iban, bic, iban_name"""

    def test_put_profile_saves_iban(self, user_token):
        """Save IBAN and verify it's persisted"""
        test_iban = "FR7630006000011234567890189"
        resp = requests.put(
            f"{BASE_URL}/api/users/profile",
            json={"iban": test_iban},
            headers={"Authorization": f"Bearer {user_token}"}
        )
        assert resp.status_code == 200, f"PUT profile failed: {resp.status_code} {resp.text}"

        # Verify by fetching profile
        get_resp = requests.get(
            f"{BASE_URL}/api/users/profile",
            headers={"Authorization": f"Bearer {user_token}"}
        )
        assert get_resp.status_code == 200
        data = get_resp.json()
        assert data.get("iban") == test_iban, f"IBAN not persisted. Got: {data.get('iban')}"

    def test_put_profile_saves_bic(self, user_token):
        """Save BIC and verify it's persisted"""
        test_bic = "BNPAFRPP"
        resp = requests.put(
            f"{BASE_URL}/api/users/profile",
            json={"bic": test_bic},
            headers={"Authorization": f"Bearer {user_token}"}
        )
        assert resp.status_code == 200, f"PUT profile failed: {resp.status_code} {resp.text}"

        # Verify by fetching profile
        get_resp = requests.get(
            f"{BASE_URL}/api/users/profile",
            headers={"Authorization": f"Bearer {user_token}"}
        )
        assert get_resp.status_code == 200
        data = get_resp.json()
        assert data.get("bic") == test_bic, f"BIC not persisted. Got: {data.get('bic')}"

    def test_put_profile_saves_iban_name(self, user_token):
        """Save IBAN holder name and verify it's persisted"""
        test_name = "TEST Thomas Dupont"
        resp = requests.put(
            f"{BASE_URL}/api/users/profile",
            json={"iban_name": test_name},
            headers={"Authorization": f"Bearer {user_token}"}
        )
        assert resp.status_code == 200, f"PUT profile failed: {resp.status_code} {resp.text}"

        # Verify by fetching profile
        get_resp = requests.get(
            f"{BASE_URL}/api/users/profile",
            headers={"Authorization": f"Bearer {user_token}"}
        )
        assert get_resp.status_code == 200
        data = get_resp.json()
        assert data.get("iban_name") == test_name, f"iban_name not persisted. Got: {data.get('iban_name')}"

    def test_put_profile_saves_all_banking_fields_together(self, user_token):
        """Save all 3 banking fields together and verify persistence"""
        payload = {
            "iban": "FR7630006000011234567890189",
            "bic": "BNPAFRPP",
            "iban_name": "TEST Thomas Dupont"
        }
        resp = requests.put(
            f"{BASE_URL}/api/users/profile",
            json=payload,
            headers={"Authorization": f"Bearer {user_token}"}
        )
        assert resp.status_code == 200, f"PUT profile failed: {resp.status_code} {resp.text}"

        # Verify persistence
        get_resp = requests.get(
            f"{BASE_URL}/api/users/profile",
            headers={"Authorization": f"Bearer {user_token}"}
        )
        assert get_resp.status_code == 200
        data = get_resp.json()
        assert data.get("iban") == payload["iban"], f"IBAN mismatch: {data.get('iban')}"
        assert data.get("bic") == payload["bic"], f"BIC mismatch: {data.get('bic')}"
        assert data.get("iban_name") == payload["iban_name"], f"iban_name mismatch: {data.get('iban_name')}"

    def test_put_profile_with_name_still_works(self, user_token):
        """Name update should still work alongside banking data"""
        resp = requests.put(
            f"{BASE_URL}/api/users/profile",
            json={"name": "Thomas Dupont"},
            headers={"Authorization": f"Bearer {user_token}"}
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("name") == "Thomas Dupont", f"Name not updated: {data.get('name')}"

    def test_put_profile_unauthenticated_returns_401(self):
        resp = requests.put(
            f"{BASE_URL}/api/users/profile",
            json={"iban": "FR76..."}
        )
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"


class TestPublicProfile:
    """GET /api/users/{id}/public - must NOT return banking info"""

    def test_public_profile_returns_200(self, user_id):
        resp = requests.get(f"{BASE_URL}/api/users/{user_id}/public")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

    def test_public_profile_no_iban(self, user_id):
        """Banking data must NOT be exposed on public profile"""
        resp = requests.get(f"{BASE_URL}/api/users/{user_id}/public")
        assert resp.status_code == 200
        data = resp.json()
        assert "iban" not in data, f"IBAN should NOT be in public profile! Found: {data.get('iban')}"

    def test_public_profile_no_bic(self, user_id):
        resp = requests.get(f"{BASE_URL}/api/users/{user_id}/public")
        assert resp.status_code == 200
        data = resp.json()
        assert "bic" not in data, f"BIC should NOT be in public profile! Found: {data.get('bic')}"

    def test_public_profile_no_iban_name(self, user_id):
        resp = requests.get(f"{BASE_URL}/api/users/{user_id}/public")
        assert resp.status_code == 200
        data = resp.json()
        assert "iban_name" not in data, f"iban_name should NOT be in public profile! Found: {data.get('iban_name')}"

    def test_public_profile_has_review_stats(self, user_id):
        """Public profile should still have review stats"""
        resp = requests.get(f"{BASE_URL}/api/users/{user_id}/public")
        assert resp.status_code == 200
        data = resp.json()
        assert "avg_rating" in data, f"avg_rating missing from public profile"
        assert "review_count" in data, f"review_count missing from public profile"

    def test_public_profile_has_basic_fields(self, user_id):
        """Public profile should have name, role, picture"""
        resp = requests.get(f"{BASE_URL}/api/users/{user_id}/public")
        assert resp.status_code == 200
        data = resp.json()
        assert "name" in data, "name missing from public profile"
        assert "role" in data, "role missing from public profile"
        assert "user_id" in data, "user_id missing from public profile"
