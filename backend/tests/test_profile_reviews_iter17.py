"""
Backend tests for iteration 17: WINEK profile review features
Tests:
- GET /api/users/profile returns avg_rating and review_count
- GET /api/users/{id}/public returns avg_rating and review_count
- PUT /api/users/{id}/reviews/{review_id} - edit existing review
- PUT returns 404 if review_id does not belong to reviewer
- POST /api/users/{id}/reviews - create new review (fixed missing decorator)
"""
import pytest
import requests
import os

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    BASE_URL = "https://subscription-mgmt-16.preview.emergentagent.com"

USER_EMAIL = "user@winek.app"
USER_PASSWORD = "WinekUser2024!"
COACH_EMAIL = "coach@winek.app"
COACH_PASSWORD = "WinekCoach2024!"

USER_DEMO001 = "user_demo001"
USER_DEMO002 = "user_demo002"
USER_COACH001 = "user_coach001"
REVIEW_ID_DEMO001_TO_DEMO002 = "rev_5e079e168725"


@pytest.fixture(scope="module")
def user_token():
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={"email": USER_EMAIL, "password": USER_PASSWORD})
    assert resp.status_code == 200, f"Login failed: {resp.text}"
    return resp.json()["token"]


@pytest.fixture(scope="module")
def coach_token():
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={"email": COACH_EMAIL, "password": COACH_PASSWORD})
    assert resp.status_code == 200, f"Coach login failed: {resp.text}"
    return resp.json()["token"]


class TestGetProfile:
    """GET /api/users/profile - returns avg_rating and review_count"""

    def test_profile_returns_avg_rating(self, user_token):
        resp = requests.get(f"{BASE_URL}/api/users/profile",
                            headers={"Authorization": f"Bearer {user_token}"})
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        # avg_rating key must be present (None or float)
        assert "avg_rating" in data, "avg_rating missing from /users/profile response"
        assert "review_count" in data, "review_count missing from /users/profile response"

    def test_profile_review_count_is_int(self, user_token):
        resp = requests.get(f"{BASE_URL}/api/users/profile",
                            headers={"Authorization": f"Bearer {user_token}"})
        data = resp.json()
        assert isinstance(data["review_count"], int), f"review_count should be int, got {type(data['review_count'])}"

    def test_profile_avg_rating_is_float_or_none(self, user_token):
        resp = requests.get(f"{BASE_URL}/api/users/profile",
                            headers={"Authorization": f"Bearer {user_token}"})
        data = resp.json()
        assert data["avg_rating"] is None or isinstance(data["avg_rating"], (int, float)), \
            f"avg_rating should be float or None, got {type(data['avg_rating'])}"

    def test_profile_requires_auth(self):
        resp = requests.get(f"{BASE_URL}/api/users/profile")
        assert resp.status_code in [401, 403], f"Expected 401/403 without auth, got {resp.status_code}"


class TestGetPublicProfile:
    """GET /api/users/{id}/public - returns avg_rating and review_count"""

    def test_public_profile_avg_rating(self):
        resp = requests.get(f"{BASE_URL}/api/users/{USER_DEMO002}/public")
        assert resp.status_code == 200
        data = resp.json()
        assert "avg_rating" in data, "avg_rating missing from public profile"
        assert "review_count" in data, "review_count missing from public profile"

    def test_public_profile_review_count_positive(self):
        # user_demo002 has at least 2 reviews per context
        resp = requests.get(f"{BASE_URL}/api/users/{USER_DEMO002}/public")
        data = resp.json()
        assert data["review_count"] >= 1, f"Expected review_count >= 1, got {data['review_count']}"

    def test_public_profile_avg_rating_consistent_with_count(self):
        resp = requests.get(f"{BASE_URL}/api/users/{USER_DEMO002}/public")
        data = resp.json()
        if data["review_count"] > 0:
            assert data["avg_rating"] is not None, "avg_rating should not be None when review_count > 0"
        else:
            assert data["avg_rating"] is None, "avg_rating should be None when review_count == 0"

    def test_public_profile_not_found(self):
        resp = requests.get(f"{BASE_URL}/api/users/nonexistent_user_xyz/public")
        assert resp.status_code == 404


class TestUpdateReview:
    """PUT /api/users/{id}/reviews/{review_id} - edit existing review"""

    def test_update_review_success(self, user_token):
        # user_demo001 already has a review on user_demo002
        payload = {"rating": 4, "comment": "TEST_Avis modifié par test iter17"}
        resp = requests.put(
            f"{BASE_URL}/api/users/{USER_DEMO002}/reviews/{REVIEW_ID_DEMO001_TO_DEMO002}",
            json=payload,
            headers={"Authorization": f"Bearer {user_token}"}
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data["review_id"] == REVIEW_ID_DEMO001_TO_DEMO002
        assert data["rating"] == 4
        assert data["comment"] == "TEST_Avis modifié par test iter17"

    def test_update_review_returns_reviewer_info(self, user_token):
        payload = {"rating": 4, "comment": "TEST_Verify reviewer info returned"}
        resp = requests.put(
            f"{BASE_URL}/api/users/{USER_DEMO002}/reviews/{REVIEW_ID_DEMO001_TO_DEMO002}",
            json=payload,
            headers={"Authorization": f"Bearer {user_token}"}
        )
        data = resp.json()
        assert "reviewer_id" in data
        assert data["reviewer_id"] == USER_DEMO001
        assert "reviewer_name" in data
        assert "created_at" in data

    def test_update_review_get_verify_persistence(self, user_token):
        # Update to specific values, then GET to verify they persisted
        payload = {"rating": 3, "comment": "TEST_Persist check iter17"}
        requests.put(
            f"{BASE_URL}/api/users/{USER_DEMO002}/reviews/{REVIEW_ID_DEMO001_TO_DEMO002}",
            json=payload,
            headers={"Authorization": f"Bearer {user_token}"}
        )
        # GET reviews list to verify
        resp = requests.get(f"{BASE_URL}/api/users/{USER_DEMO002}/reviews")
        assert resp.status_code == 200
        reviews = resp.json()
        my_review = next((r for r in reviews if r["review_id"] == REVIEW_ID_DEMO001_TO_DEMO002), None)
        assert my_review is not None, "Review not found after update"
        assert my_review["rating"] == 3, f"Rating not persisted, got {my_review['rating']}"
        assert my_review["comment"] == "TEST_Persist check iter17"

    def test_update_review_404_wrong_reviewer(self, coach_token):
        # Coach tries to edit user_demo001's review on user_demo002 -> 404
        payload = {"rating": 1, "comment": "Should not be updated"}
        resp = requests.put(
            f"{BASE_URL}/api/users/{USER_DEMO002}/reviews/{REVIEW_ID_DEMO001_TO_DEMO002}",
            json=payload,
            headers={"Authorization": f"Bearer {coach_token}"}
        )
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}: {resp.text}"
        assert "non trouvé" in resp.json().get("detail", "").lower() or "autorisé" in resp.json().get("detail", "").lower()

    def test_update_review_requires_auth(self):
        payload = {"rating": 5, "comment": "No auth"}
        resp = requests.put(
            f"{BASE_URL}/api/users/{USER_DEMO002}/reviews/{REVIEW_ID_DEMO001_TO_DEMO002}",
            json=payload
        )
        assert resp.status_code in [401, 403], f"Expected 401/403, got {resp.status_code}"

    def test_update_review_null_comment(self, user_token):
        # rating with null comment should work
        payload = {"rating": 4, "comment": None}
        resp = requests.put(
            f"{BASE_URL}/api/users/{USER_DEMO002}/reviews/{REVIEW_ID_DEMO001_TO_DEMO002}",
            json=payload,
            headers={"Authorization": f"Bearer {user_token}"}
        )
        assert resp.status_code == 200
        # Restore with original rating
        requests.put(
            f"{BASE_URL}/api/users/{USER_DEMO002}/reviews/{REVIEW_ID_DEMO001_TO_DEMO002}",
            json={"rating": 4, "comment": "TEST_Restored after iter17 test"},
            headers={"Authorization": f"Bearer {user_token}"}
        )


class TestCreateReview:
    """POST /api/users/{id}/reviews - create new review (was missing decorator, now fixed)"""

    def test_post_reviews_route_exists(self, user_token):
        # user_demo001 already reviewed user_demo002, so should get 409 (not 405)
        payload = {"rating": 5, "comment": "TEST_Duplicate check"}
        resp = requests.post(
            f"{BASE_URL}/api/users/{USER_DEMO002}/reviews",
            json=payload,
            headers={"Authorization": f"Bearer {user_token}"}
        )
        # Should be 409 (duplicate) not 405 (method not allowed)
        assert resp.status_code != 405, "POST route not registered (405 Method Not Allowed)"
        assert resp.status_code == 409, f"Expected 409 for duplicate, got {resp.status_code}: {resp.text}"

    def test_post_reviews_requires_auth(self):
        resp = requests.post(
            f"{BASE_URL}/api/users/{USER_DEMO002}/reviews",
            json={"rating": 3}
        )
        assert resp.status_code in [401, 403], f"Expected 401/403, got {resp.status_code}"

    def test_post_reviews_cannot_review_yourself(self, user_token):
        # user_demo001 tries to review themselves
        resp = requests.post(
            f"{BASE_URL}/api/users/{USER_DEMO001}/reviews",
            json={"rating": 5, "comment": "Self review"},
            headers={"Authorization": f"Bearer {user_token}"}
        )
        assert resp.status_code == 400, f"Expected 400 for self-review, got {resp.status_code}: {resp.text}"


class TestGetReviews:
    """GET /api/users/{id}/reviews"""

    def test_get_reviews_list(self):
        resp = requests.get(f"{BASE_URL}/api/users/{USER_DEMO002}/reviews")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list), "Expected list of reviews"
        assert len(data) >= 1

    def test_get_reviews_contains_reviewer_info(self):
        resp = requests.get(f"{BASE_URL}/api/users/{USER_DEMO002}/reviews")
        data = resp.json()
        if data:
            review = data[0]
            assert "review_id" in review
            assert "rating" in review
            assert "reviewer_id" in review
            assert "reviewer_name" in review
            assert "created_at" in review

    def test_get_reviews_user_not_found(self):
        resp = requests.get(f"{BASE_URL}/api/users/nonexistent_xyz/reviews")
        assert resp.status_code == 404
