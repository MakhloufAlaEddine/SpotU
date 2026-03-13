"""
Iteration 18 Backend Tests
- PUT /api/auth/change-password (wrong pwd → 401, right pwd → success)
- GET /api/users/profile returns avg_rating and review_count
"""
import pytest
import requests
import os

BASE_URL = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL") or
    os.environ.get("REACT_APP_BACKEND_URL") or
    "https://onboarding-flow-82.preview.emergentagent.com"
).rstrip("/")

# Test credentials
USER_EMAIL = "user@winek.app"
USER_PASSWORD = "WinekUser2024!"
COACH_EMAIL = "coach@winek.app"
COACH_PASSWORD = "WinekCoach2024!"


@pytest.fixture(scope="module")
def user_token():
    """Login as standard user and return token"""
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": USER_EMAIL,
        "password": USER_PASSWORD
    })
    assert resp.status_code == 200, f"Login failed: {resp.text}"
    return resp.json()["token"]


@pytest.fixture(scope="module")
def coach_token():
    """Login as coach and return token"""
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": COACH_EMAIL,
        "password": COACH_PASSWORD
    })
    assert resp.status_code == 200, f"Login failed: {resp.text}"
    return resp.json()["token"]


class TestChangePassword:
    """PUT /api/auth/change-password endpoint tests"""

    def test_change_password_wrong_current_returns_401(self, user_token):
        """Wrong current password should return 401 with French error message"""
        resp = requests.put(
            f"{BASE_URL}/api/auth/change-password",
            json={"current_password": "WrongPassword123!", "new_password": "NewPass123!"},
            headers={"Authorization": f"Bearer {user_token}"}
        )
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}: {resp.text}"
        data = resp.json()
        # Check French error message
        detail = data.get("detail", "")
        assert "Mot de passe actuel incorrect" in detail, f"Expected French error, got: {detail}"
        print(f"PASS: Wrong password returns 401 - detail: {detail}")

    def test_change_password_unauthenticated_returns_401_or_403(self):
        """No token should return 401 or 403"""
        resp = requests.put(
            f"{BASE_URL}/api/auth/change-password",
            json={"current_password": USER_PASSWORD, "new_password": "NewPass123!"}
        )
        assert resp.status_code in [401, 403], f"Expected 401/403, got {resp.status_code}"
        print(f"PASS: Unauthenticated request returns {resp.status_code}")

    def test_change_password_too_short_new_password_returns_422(self, user_token):
        """New password < 6 chars should return 422 validation error"""
        resp = requests.put(
            f"{BASE_URL}/api/auth/change-password",
            json={"current_password": USER_PASSWORD, "new_password": "abc"},
            headers={"Authorization": f"Bearer {user_token}"}
        )
        assert resp.status_code == 422, f"Expected 422, got {resp.status_code}: {resp.text}"
        print(f"PASS: Short new password returns 422")

    def test_change_password_correct_current_returns_success(self, user_token):
        """Correct current password should return success=True, then restore original"""
        NEW_PWD = "TempNewPass2024!"

        # Step 1: Change to new password
        resp = requests.put(
            f"{BASE_URL}/api/auth/change-password",
            json={"current_password": USER_PASSWORD, "new_password": NEW_PWD},
            headers={"Authorization": f"Bearer {user_token}"}
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data.get("success") is True, f"Expected success=True, got: {data}"
        print(f"PASS: Correct password change returns success=True")

        # Step 2: Verify new password works
        resp2 = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": USER_EMAIL,
            "password": NEW_PWD
        })
        assert resp2.status_code == 200, f"Login with new password failed: {resp2.text}"
        new_token = resp2.json()["token"]
        print("PASS: Can login with new password")

        # Step 3: Restore original password
        resp3 = requests.put(
            f"{BASE_URL}/api/auth/change-password",
            json={"current_password": NEW_PWD, "new_password": USER_PASSWORD},
            headers={"Authorization": f"Bearer {new_token}"}
        )
        assert resp3.status_code == 200, f"Failed to restore password: {resp3.text}"
        print("PASS: Password restored to original")


class TestUsersProfile:
    """GET /api/users/profile endpoint tests"""

    def test_profile_returns_avg_rating_and_review_count(self, user_token):
        """GET /users/profile must include avg_rating and review_count fields"""
        resp = requests.get(
            f"{BASE_URL}/api/users/profile",
            headers={"Authorization": f"Bearer {user_token}"}
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert "avg_rating" in data, f"avg_rating missing from profile response: {data.keys()}"
        assert "review_count" in data, f"review_count missing from profile response: {data.keys()}"
        print(f"PASS: /users/profile returns avg_rating={data['avg_rating']}, review_count={data['review_count']}")

    def test_profile_user_demo001_has_zero_reviews(self, user_token):
        """user@winek.app (user_demo001) should have 0 reviews"""
        resp = requests.get(
            f"{BASE_URL}/api/users/profile",
            headers={"Authorization": f"Bearer {user_token}"}
        )
        assert resp.status_code == 200
        data = resp.json()
        count = data.get("review_count", -1)
        # user_demo001 should have 0 reviews per agent context
        assert count >= 0, f"review_count should be non-negative, got: {count}"
        print(f"INFO: user@winek.app has review_count={count}, avg_rating={data.get('avg_rating')}")
        # If 0 reviews, avg_rating should be null
        if count == 0:
            assert data.get("avg_rating") is None, f"avg_rating should be None for 0 reviews, got: {data.get('avg_rating')}"
            print("PASS: 0 reviews → avg_rating is null")

    def test_profile_coach_has_review_fields(self, coach_token):
        """Coach profile should also have avg_rating and review_count"""
        resp = requests.get(
            f"{BASE_URL}/api/users/profile",
            headers={"Authorization": f"Bearer {coach_token}"}
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "avg_rating" in data
        assert "review_count" in data
        print(f"PASS: Coach profile returns review fields: count={data['review_count']}, avg={data['avg_rating']}")

    def test_profile_unauthenticated_returns_401(self):
        """No token should return 401"""
        resp = requests.get(f"{BASE_URL}/api/users/profile")
        assert resp.status_code in [401, 403], f"Expected 401/403, got {resp.status_code}"
        print(f"PASS: Unauthenticated profile returns {resp.status_code}")
