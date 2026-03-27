"""
Backend tests for WINEK profile review features - iteration 16
Tests: show_phone, show_reviews, public profile, reviews CRUD, duplicate prevention
"""
import pytest
import requests
import os

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://heic-support.preview.emergentagent.com").rstrip("/")

# Test credentials
USER_EMAIL = "user@winek.app"
USER_PASSWORD = "WinekUser2024!"
COACH_EMAIL = "coach@winek.app"
COACH_PASSWORD = "WinekCoach2024!"


# ── Fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def user_token():
    """Login as regular user and return token"""
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={"email": USER_EMAIL, "password": USER_PASSWORD})
    assert resp.status_code == 200, f"Login failed: {resp.text}"
    data = resp.json()
    return data["token"], data["user"]


@pytest.fixture(scope="module")
def coach_token():
    """Login as coach and return token"""
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={"email": COACH_EMAIL, "password": COACH_PASSWORD})
    assert resp.status_code == 200, f"Coach login failed: {resp.text}"
    data = resp.json()
    return data["token"], data["user"]


@pytest.fixture(scope="module")
def user_session(user_token):
    token, user = user_token
    session = requests.Session()
    session.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    return session, user


@pytest.fixture(scope="module")
def coach_session(coach_token):
    token, coach = coach_token
    session = requests.Session()
    session.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    return session, coach


# ── Auth / Login Tests ───────────────────────────────────────────────────────

class TestAuthLogin:
    """Verify login returns show_phone and show_reviews in user object"""

    def test_login_user_returns_show_phone(self, user_token):
        # user_token fixture already asserts 200
        _, user = user_token
        assert "show_phone" in user, f"show_phone missing in user object: {list(user.keys())}"
        assert isinstance(user["show_phone"], bool), f"show_phone is not bool: {user['show_phone']}"

    def test_login_user_returns_show_reviews(self, user_token):
        _, user = user_token
        assert "show_reviews" in user, f"show_reviews missing in user object: {list(user.keys())}"
        assert isinstance(user["show_reviews"], bool), f"show_reviews is not bool: {user['show_reviews']}"

    def test_login_coach_returns_show_phone(self, coach_token):
        _, coach = coach_token
        assert "show_phone" in coach, f"show_phone missing in coach object: {list(coach.keys())}"

    def test_login_coach_returns_show_reviews(self, coach_token):
        _, coach = coach_token
        assert "show_reviews" in coach, f"show_reviews missing in coach object: {list(coach.keys())}"


# ── Update Profile (show_phone, show_reviews) ───────────────────────────────

class TestUpdateProfilePrivacy:
    """PUT /api/users/profile - save show_phone and show_reviews"""

    def test_update_show_phone_true(self, user_session):
        session, user = user_session
        resp = session.put(f"{BASE_URL}/api/users/profile", json={"show_phone": True})
        assert resp.status_code == 200, f"Update failed: {resp.text}"
        data = resp.json()
        assert data["show_phone"] is True, f"show_phone not set to True: {data.get('show_phone')}"

    def test_update_show_reviews_false(self, user_session):
        session, user = user_session
        resp = session.put(f"{BASE_URL}/api/users/profile", json={"show_reviews": False})
        assert resp.status_code == 200, f"Update failed: {resp.text}"
        data = resp.json()
        assert data["show_reviews"] is False, f"show_reviews not set to False: {data.get('show_reviews')}"

    def test_update_show_reviews_true_restore(self, user_session):
        """Restore show_reviews to True for subsequent tests"""
        session, user = user_session
        resp = session.put(f"{BASE_URL}/api/users/profile", json={"show_reviews": True, "show_phone": False})
        assert resp.status_code == 200
        data = resp.json()
        assert data["show_reviews"] is True
        assert data["show_phone"] is False


# ── Public Profile ───────────────────────────────────────────────────────────

class TestPublicProfile:
    """GET /api/users/{id}/public"""

    def test_public_profile_user_exists(self, user_session):
        session, user = user_session
        user_id = user["user_id"]
        resp = requests.get(f"{BASE_URL}/api/users/{user_id}/public")
        assert resp.status_code == 200, f"Public profile failed: {resp.text}"

    def test_public_profile_has_interests(self, user_session):
        session, user = user_session
        user_id = user["user_id"]
        resp = requests.get(f"{BASE_URL}/api/users/{user_id}/public")
        data = resp.json()
        assert "interests" in data, f"interests missing: {list(data.keys())}"
        assert isinstance(data["interests"], list)

    def test_public_profile_has_show_reviews(self, user_session):
        session, user = user_session
        user_id = user["user_id"]
        resp = requests.get(f"{BASE_URL}/api/users/{user_id}/public")
        data = resp.json()
        assert "show_reviews" in data, f"show_reviews missing: {list(data.keys())}"

    def test_public_profile_has_avg_rating_and_count(self, user_session):
        session, user = user_session
        user_id = user["user_id"]
        resp = requests.get(f"{BASE_URL}/api/users/{user_id}/public")
        data = resp.json()
        assert "avg_rating" in data, f"avg_rating missing: {list(data.keys())}"
        assert "review_count" in data, f"review_count missing: {list(data.keys())}"
        assert isinstance(data["review_count"], int)

    def test_public_profile_phone_hidden_when_show_phone_false(self, user_session):
        """After setting show_phone=False, phone should be None in public profile"""
        session, user = user_session
        user_id = user["user_id"]
        # Ensure show_phone is False
        session.put(f"{BASE_URL}/api/users/profile", json={"show_phone": False})
        resp = requests.get(f"{BASE_URL}/api/users/{user_id}/public")
        data = resp.json()
        assert data.get("phone") is None, f"phone should be None when show_phone=False, got: {data.get('phone')}"

    def test_public_profile_phone_visible_when_show_phone_true(self, user_session):
        """After setting show_phone=True and phone set, phone should appear in public profile"""
        session, user = user_session
        user_id = user["user_id"]
        # Set phone and show_phone=True
        session.put(f"{BASE_URL}/api/users/profile", json={"phone": "+33 6 12 34 56 78", "show_phone": True})
        resp = requests.get(f"{BASE_URL}/api/users/{user_id}/public")
        data = resp.json()
        assert data.get("phone") == "+33 6 12 34 56 78", f"phone should be visible, got: {data.get('phone')}"
        # Restore
        session.put(f"{BASE_URL}/api/users/profile", json={"show_phone": False})

    def test_public_profile_404_for_unknown_id(self):
        resp = requests.get(f"{BASE_URL}/api/users/nonexistent_user_xxx/public")
        assert resp.status_code == 404

    def test_coach_public_profile_has_services(self, coach_session):
        session, coach = coach_session
        coach_id = coach["user_id"]
        resp = requests.get(f"{BASE_URL}/api/users/{coach_id}/public")
        assert resp.status_code == 200
        data = resp.json()
        assert "services" in data, f"services missing in coach public profile: {list(data.keys())}"
        assert isinstance(data["services"], list)


# ── Reviews GET ──────────────────────────────────────────────────────────────

class TestGetReviews:
    """GET /api/users/{id}/reviews"""

    def test_get_reviews_returns_list(self, user_session):
        session, user = user_session
        user_id = user["user_id"]
        # Ensure show_reviews is True
        session.put(f"{BASE_URL}/api/users/profile", json={"show_reviews": True})
        resp = requests.get(f"{BASE_URL}/api/users/{user_id}/reviews")
        assert resp.status_code == 200, f"Get reviews failed: {resp.text}"
        data = resp.json()
        assert isinstance(data, list)

    def test_get_reviews_404_for_unknown_user(self):
        resp = requests.get(f"{BASE_URL}/api/users/nonexistent_xxx/reviews")
        assert resp.status_code == 404

    def test_get_reviews_has_correct_fields_if_not_empty(self, coach_session):
        session, coach = coach_session
        coach_id = coach["user_id"]
        resp = requests.get(f"{BASE_URL}/api/users/{coach_id}/reviews")
        assert resp.status_code == 200
        data = resp.json()
        if data:
            review = data[0]
            assert "review_id" in review, f"review_id missing: {list(review.keys())}"
            assert "rating" in review, f"rating missing: {list(review.keys())}"
            assert "reviewer_id" in review, f"reviewer_id missing: {list(review.keys())}"
            assert "reviewer_name" in review, f"reviewer_name missing: {list(review.keys())}"


# ── Reviews POST ─────────────────────────────────────────────────────────────

class TestCreateReview:
    """POST /api/users/{id}/reviews"""

    def test_create_review_success(self, user_session, coach_session):
        """User reviews coach - should succeed"""
        user_sess, user = user_session
        _, coach = coach_session
        coach_id = coach["user_id"]

        # Ensure coach allows reviews
        coach_sess, _ = coach_session
        coach_sess.put(f"{BASE_URL}/api/users/profile", json={"show_reviews": True})

        # Delete any existing review from user about coach (cleanup)
        # We'll handle 409 gracefully in the duplicate test
        resp = user_sess.post(f"{BASE_URL}/api/users/{coach_id}/reviews", json={
            "rating": 5,
            "comment": "TEST_Excellent coach, très professionnel !"
        })
        # Either 200 (created) or 409 (already exists from previous test run)
        assert resp.status_code in [200, 409], f"Unexpected status: {resp.status_code} - {resp.text}"
        if resp.status_code == 200:
            data = resp.json()
            assert data["rating"] == 5
            assert "review_id" in data
            assert "reviewer_id" in data

    def test_create_review_rating_range_validation(self, user_session, coach_session):
        """Rating must be 1-5"""
        user_sess, user = user_session
        _, coach = coach_session
        coach_id = coach["user_id"]
        resp = user_sess.post(f"{BASE_URL}/api/users/{coach_id}/reviews", json={"rating": 6})
        assert resp.status_code == 422, f"Should reject rating=6: {resp.status_code} - {resp.text}"

    def test_create_review_rating_zero_rejected(self, user_session, coach_session):
        """Rating 0 should be rejected"""
        user_sess, _ = user_session
        _, coach = coach_session
        coach_id = coach["user_id"]
        resp = user_sess.post(f"{BASE_URL}/api/users/{coach_id}/reviews", json={"rating": 0})
        assert resp.status_code == 422, f"Should reject rating=0: {resp.status_code}"

    def test_create_review_without_comment(self, coach_session, user_session):
        """Comment is optional - test with coach reviewing user"""
        coach_sess, coach = coach_session
        _, user = user_session
        user_id = user["user_id"]
        resp = coach_sess.post(f"{BASE_URL}/api/users/{user_id}/reviews", json={"rating": 4})
        # Either 200 (created) or 409 (duplicate)
        assert resp.status_code in [200, 409], f"Unexpected: {resp.status_code} - {resp.text}"

    def test_create_review_duplicate_rejected_409(self, user_session, coach_session):
        """Duplicate review from same user should return 409"""
        user_sess, _ = user_session
        _, coach = coach_session
        coach_id = coach["user_id"]

        # First attempt - may succeed or 409 if already done in test above
        resp1 = user_sess.post(f"{BASE_URL}/api/users/{coach_id}/reviews", json={
            "rating": 3,
            "comment": "TEST_duplicate attempt"
        })
        # Second attempt - must be 409
        resp2 = user_sess.post(f"{BASE_URL}/api/users/{coach_id}/reviews", json={
            "rating": 4,
            "comment": "TEST_second attempt should fail"
        })
        assert resp2.status_code == 409, f"Duplicate should return 409, got: {resp2.status_code} - {resp2.text}"

    def test_cannot_review_self(self, user_session):
        """User cannot review themselves"""
        session, user = user_session
        user_id = user["user_id"]
        resp = session.post(f"{BASE_URL}/api/users/{user_id}/reviews", json={"rating": 5})
        assert resp.status_code == 400, f"Self-review should be rejected: {resp.status_code} - {resp.text}"

    def test_create_review_requires_auth(self, coach_session):
        """Unauthenticated request should fail"""
        _, coach = coach_session
        coach_id = coach["user_id"]
        resp = requests.post(f"{BASE_URL}/api/users/{coach_id}/reviews", json={"rating": 5})
        assert resp.status_code == 401, f"Should require auth: {resp.status_code}"

    def test_create_review_shows_reviews_false_rejected(self, user_session):
        """If target has show_reviews=False, review should be rejected (403)"""
        session, user = user_session
        # Temporarily disable reviews on user profile
        session.put(f"{BASE_URL}/api/users/profile", json={"show_reviews": False})

        # Try to have another user review this profile
        # We use admin token for this
        admin_resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@winek.app", "password": "WinekAdmin2024!"
        })
        if admin_resp.status_code == 200:
            admin_token = admin_resp.json()["token"]
            _, user_obj = user_session
            user_id = user_obj["user_id"]
            resp = requests.post(
                f"{BASE_URL}/api/users/{user_id}/reviews",
                json={"rating": 3},
                headers={"Authorization": f"Bearer {admin_token}"}
            )
            assert resp.status_code == 403, f"Should reject review when show_reviews=False: {resp.status_code}"

        # Restore
        session.put(f"{BASE_URL}/api/users/profile", json={"show_reviews": True})

    def test_create_review_404_unknown_user(self, user_session):
        session, _ = user_session
        resp = session.post(f"{BASE_URL}/api/users/nonexistent_xxx/reviews", json={"rating": 4})
        assert resp.status_code == 404, f"Should return 404 for unknown user: {resp.status_code}"


# ── Review persists in public profile stats ──────────────────────────────────

class TestReviewStats:
    """Verify avg_rating and review_count are updated after review creation"""

    def test_public_profile_review_count_gte_zero(self, coach_session):
        _, coach = coach_session
        coach_id = coach["user_id"]
        resp = requests.get(f"{BASE_URL}/api/users/{coach_id}/public")
        assert resp.status_code == 200
        data = resp.json()
        assert data["review_count"] >= 0
        if data["review_count"] > 0:
            assert data["avg_rating"] is not None
            assert 1 <= data["avg_rating"] <= 5, f"avg_rating out of range: {data['avg_rating']}"

    def test_reviews_list_matches_review_count(self, coach_session):
        _, coach = coach_session
        coach_id = coach["user_id"]
        profile_resp = requests.get(f"{BASE_URL}/api/users/{coach_id}/public")
        reviews_resp = requests.get(f"{BASE_URL}/api/users/{coach_id}/reviews")
        assert profile_resp.status_code == 200
        assert reviews_resp.status_code == 200
        profile_count = profile_resp.json()["review_count"]
        actual_count = len(reviews_resp.json())
        assert profile_count == actual_count, f"review_count mismatch: profile says {profile_count}, reviews list has {actual_count}"
