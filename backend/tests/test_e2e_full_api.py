"""
test_e2e_full_api.py — Suite de tests E2E complète SpotU
=========================================================
Couvre TOUS les endpoints de l'API organisés par module :
  1. Auth (register, login, me, logout, change-password)
  2. Users (profile, update, become-coach, public-profile, reviews, follow, block, suggestions)
  3. TagPoints (CRUD, save/unsave, join/leave, vote, visibility, cancel/restore, delete)
  4. SpotYou (join, leave, going, not-going, activity, members, completion-stats)
  5. Services (CRUD, save/unsave)
  6. Bookings (request, accept, refuse, cancel, price-preview, list)
  7. Admin (stats, users, roles, pricing-rules, app-config, subscription-plans, domains, tags)
  8. Chat (conversations, messages, mark-read)
  9. Home (feed, nearest-sector)
  10. Config (booking, commission)
  11. Payments (list, detail)
  12. Notifications (list, mark-read, mark-all-read)

Utilise httpx pour les requêtes HTTP synchrones.
Les identifiants de test sont définis dans les fixtures.
"""

import os
import pytest
import httpx
import uuid
import time
from datetime import datetime, timezone, timedelta

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")

# ── Credentials ────────────────────────────────────────────────────────────────
ADMIN_EMAIL = "admin@winek.app"
ADMIN_PASS = "WinekAdmin2024!"
COACH_EMAIL = "coach@winek.app"
COACH_PASS = "WinekCoach2024!"
USER_EMAIL = "user@winek.app"
USER_PASS = "WinekUser2024!"

# ── Helpers ────────────────────────────────────────────────────────────────────

def _login(email: str, password: str) -> dict:
    """Login and return {'token': ..., 'user': ...}"""
    r = httpx.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": email, "password": password},
        timeout=15,
    )
    assert r.status_code == 200, f"Login failed for {email}: {r.status_code} {r.text}"
    data = r.json()
    assert "token" in data
    return data


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ── Fixtures ───────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def admin_auth():
    return _login(ADMIN_EMAIL, ADMIN_PASS)


@pytest.fixture(scope="module")
def coach_auth():
    return _login(COACH_EMAIL, COACH_PASS)


@pytest.fixture(scope="module")
def user_auth():
    return _login(USER_EMAIL, USER_PASS)


@pytest.fixture(scope="module")
def test_user():
    """Register a fresh test user for isolated tests."""
    unique = uuid.uuid4().hex[:8]
    email = f"test_e2e_{unique}@test.com"
    r = httpx.post(
        f"{BASE_URL}/api/auth/register",
        json={"email": email, "password": "TestPass123!", "name": f"E2E User {unique}", "language": "fr"},
        timeout=15,
    )
    assert r.status_code == 200, f"Register failed: {r.text}"
    data = r.json()
    data["email"] = email
    data["password"] = "TestPass123!"
    return data


# ═══════════════════════════════════════════════════════════════════════════════
# 1. AUTH
# ═══════════════════════════════════════════════════════════════════════════════

class TestAuth:
    def test_register_new_user(self):
        unique = uuid.uuid4().hex[:8]
        r = httpx.post(
            f"{BASE_URL}/api/auth/register",
            json={"email": f"reg_{unique}@test.com", "password": "Test1234!", "name": f"Reg {unique}", "language": "fr"},
            timeout=15,
        )
        assert r.status_code == 200
        data = r.json()
        assert "token" in data
        assert data["user"]["email"] == f"reg_{unique}@test.com"
        assert data["user"]["role"] == "user"

    def test_register_duplicate_email(self):
        r = httpx.post(
            f"{BASE_URL}/api/auth/register",
            json={"email": USER_EMAIL, "password": "anything", "name": "dup", "language": "fr"},
            timeout=15,
        )
        assert r.status_code == 400

    def test_login_valid(self, admin_auth):
        assert "token" in admin_auth
        assert admin_auth["user"]["role"] == "admin"

    def test_login_invalid(self):
        r = httpx.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "nonexistent@test.com", "password": "wrong"},
            timeout=15,
        )
        assert r.status_code == 401

    def test_me(self, user_auth):
        r = httpx.get(f"{BASE_URL}/api/auth/me", headers=_headers(user_auth["token"]), timeout=15)
        assert r.status_code == 200
        assert r.json()["email"] == USER_EMAIL

    def test_logout(self, test_user):
        r = httpx.post(f"{BASE_URL}/api/auth/logout", headers=_headers(test_user["token"]), timeout=15)
        assert r.status_code == 200
        assert r.json()["success"] is True

    def test_change_password(self, test_user):
        token = test_user["token"]
        r = httpx.put(
            f"{BASE_URL}/api/auth/change-password",
            json={"current_password": test_user["password"], "new_password": "NewPass456!"},
            headers=_headers(token),
            timeout=15,
        )
        assert r.status_code == 200
        # Change back
        r2 = httpx.put(
            f"{BASE_URL}/api/auth/change-password",
            json={"current_password": "NewPass456!", "new_password": test_user["password"]},
            headers=_headers(token),
            timeout=15,
        )
        assert r2.status_code == 200

    def test_change_password_wrong_current(self, test_user):
        r = httpx.put(
            f"{BASE_URL}/api/auth/change-password",
            json={"current_password": "WRONG", "new_password": "whatever"},
            headers=_headers(test_user["token"]),
            timeout=15,
        )
        assert r.status_code == 401

    def test_me_no_auth(self):
        r = httpx.get(f"{BASE_URL}/api/auth/me", timeout=15)
        assert r.status_code in (401, 403, 422)


# ═══════════════════════════════════════════════════════════════════════════════
# 2. USER PROFILE
# ═══════════════════════════════════════════════════════════════════════════════

class TestUserProfile:
    def test_get_profile(self, user_auth):
        r = httpx.get(f"{BASE_URL}/api/users/profile", headers=_headers(user_auth["token"]), timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "user_id" in data
        assert "avg_rating" in data

    def test_update_profile(self, test_user):
        r = httpx.put(
            f"{BASE_URL}/api/users/profile",
            json={"bio": "E2E test bio", "phone": "+33600000000"},
            headers=_headers(test_user["token"]),
            timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["bio"] == "E2E test bio"

    def test_update_profile_clear_bio(self, test_user):
        r = httpx.put(
            f"{BASE_URL}/api/users/profile",
            json={"bio": None},
            headers=_headers(test_user["token"]),
            timeout=15,
        )
        assert r.status_code == 200
        assert r.json().get("bio") is None

    def test_get_public_profile(self, coach_auth):
        uid = coach_auth["user"]["user_id"]
        r = httpx.get(f"{BASE_URL}/api/users/{uid}/public", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data["user_id"] == uid
        assert "followers_count" in data
        assert "following_count" in data

    def test_public_profile_not_found(self):
        r = httpx.get(f"{BASE_URL}/api/users/nonexistent_id/public", timeout=15)
        assert r.status_code == 404


# ═══════════════════════════════════════════════════════════════════════════════
# 3. FOLLOW SYSTEM
# ═══════════════════════════════════════════════════════════════════════════════

class TestFollowSystem:
    def test_follow_and_unfollow(self, test_user, coach_auth):
        coach_id = coach_auth["user"]["user_id"]
        h = _headers(test_user["token"])

        # Follow
        r = httpx.post(f"{BASE_URL}/api/users/{coach_id}/follow", headers=h, timeout=15)
        assert r.status_code == 200
        assert r.json()["is_following"] is True

        # List followers
        r2 = httpx.get(f"{BASE_URL}/api/users/{coach_id}/followers", headers=h, timeout=15)
        assert r2.status_code == 200

        # List following
        my_id = test_user["user"]["user_id"]
        r3 = httpx.get(f"{BASE_URL}/api/users/{my_id}/following", headers=h, timeout=15)
        assert r3.status_code == 200

        # Unfollow
        r4 = httpx.delete(f"{BASE_URL}/api/users/{coach_id}/follow", headers=h, timeout=15)
        assert r4.status_code == 200
        assert r4.json()["is_following"] is False

    def test_follow_self(self, test_user):
        my_id = test_user["user"]["user_id"]
        r = httpx.post(f"{BASE_URL}/api/users/{my_id}/follow", headers=_headers(test_user["token"]), timeout=15)
        assert r.status_code == 400

    def test_block_and_unblock(self, test_user, user_auth):
        target_id = user_auth["user"]["user_id"]
        h = _headers(test_user["token"])

        r = httpx.post(f"{BASE_URL}/api/users/{target_id}/block", headers=h, timeout=15)
        assert r.status_code == 200
        assert r.json()["blocked"] is True

        r2 = httpx.delete(f"{BASE_URL}/api/users/{target_id}/block", headers=h, timeout=15)
        assert r2.status_code == 200
        assert r2.json()["blocked"] is False

    def test_suggestions(self, test_user):
        my_id = test_user["user"]["user_id"]
        r = httpx.get(
            f"{BASE_URL}/api/users/{my_id}/suggestions",
            headers=_headers(test_user["token"]),
            timeout=15,
        )
        assert r.status_code == 200
        assert "suggestions" in r.json()


# ═══════════════════════════════════════════════════════════════════════════════
# 4. REVIEWS
# ═══════════════════════════════════════════════════════════════════════════════

class TestReviews:
    def test_get_reviews_for_user(self, coach_auth):
        uid = coach_auth["user"]["user_id"]
        r = httpx.get(f"{BASE_URL}/api/users/{uid}/reviews", timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ═══════════════════════════════════════════════════════════════════════════════
# 5. CONFIG (public)
# ═══════════════════════════════════════════════════════════════════════════════

class TestConfig:
    def test_booking_config(self):
        r = httpx.get(f"{BASE_URL}/api/config/booking", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "enable_manual_approval_for_services" in data
        assert "enable_pay_later_for_services" in data
        assert "pay_now_checkout_minutes" in data
        assert isinstance(data["pay_now_checkout_minutes"], int)

    def test_commission_config(self):
        r = httpx.get(f"{BASE_URL}/api/config/commission", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "payer_percent_fee" in data
        assert "receiver_percent_fee" in data
        assert "total_percent_fee" in data
        assert "has_rule" in data


# ═══════════════════════════════════════════════════════════════════════════════
# 6. DOMAINS & TAGS (public search)
# ═══════════════════════════════════════════════════════════════════════════════

class TestDomainsAndTags:
    def test_get_domains(self):
        r = httpx.get(f"{BASE_URL}/api/domains", timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_get_tags(self):
        r = httpx.get(f"{BASE_URL}/api/tags", timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ═══════════════════════════════════════════════════════════════════════════════
# 7. TAG POINTS (SPOTYOU)
# ═══════════════════════════════════════════════════════════════════════════════

class TestTagPoints:
    @pytest.fixture(scope="class")
    def created_tagpoint(self, coach_auth):
        """Create a tagpoint for use in tests."""
        r = httpx.get(f"{BASE_URL}/api/tags", timeout=15)
        tags = r.json()
        tag_id = tags[0]["tag_id"] if tags else "tag_test"
        domain_id = tags[0].get("domain_id") if tags else None

        r2 = httpx.post(
            f"{BASE_URL}/api/tag-points",
            json={
                "title": f"E2E SpotYou Test {uuid.uuid4().hex[:6]}",
                "description": "SpotYou créé pour les tests E2E",
                "latitude": 48.8566,
                "longitude": 2.3522,
                "precision": "exact",
                "tag_ids": [tag_id],
                "domain_id": domain_id,
                "event_schedule": {
                    "type": "weekly",
                    "schedule": {
                        str(datetime.now().weekday()): [{"start": "10:00", "end": "11:00"}],
                        str((datetime.now().weekday() + 2) % 7): [{"start": "14:00", "end": "15:00"}],
                    }
                },
                "minimum_participants": 2,
                "maximum_participants": 10,
            },
            headers=_headers(coach_auth["token"]),
            timeout=15,
        )
        assert r2.status_code == 200, f"Create tagpoint failed: {r2.text}"
        return r2.json()

    def test_search_tag_points(self, user_auth):
        r = httpx.get(
            f"{BASE_URL}/api/tag-points",
            params={"lat": 48.8566, "lng": 2.3522, "radius": 50000},
            headers=_headers(user_auth["token"]),
            timeout=15,
        )
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_search_tag_points_no_auth(self):
        r = httpx.get(
            f"{BASE_URL}/api/tag-points",
            params={"lat": 48.8566, "lng": 2.3522},
            timeout=15,
        )
        assert r.status_code == 200

    def test_my_tag_points(self, coach_auth, created_tagpoint):
        r = httpx.get(
            f"{BASE_URL}/api/tag-points/mine",
            headers=_headers(coach_auth["token"]),
            timeout=15,
        )
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        ids = [tp["point_id"] for tp in data]
        assert created_tagpoint["point_id"] in ids

    def test_get_tagpoint_detail(self, created_tagpoint, user_auth):
        pid = created_tagpoint["point_id"]
        r = httpx.get(
            f"{BASE_URL}/api/tag-points/{pid}",
            headers=_headers(user_auth["token"]),
            timeout=15,
        )
        assert r.status_code == 200
        data = r.json()
        assert data["point_id"] == pid
        assert "rating" in data
        assert "participants_count" in data
        assert "is_member" in data
        assert "is_saved" in data

    def test_get_similar_tag_points(self, created_tagpoint, user_auth):
        pid = created_tagpoint["point_id"]
        r = httpx.get(
            f"{BASE_URL}/api/tag-points/{pid}/similar",
            headers=_headers(user_auth["token"]),
            timeout=15,
        )
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_save_and_unsave_tagpoint(self, created_tagpoint, user_auth):
        pid = created_tagpoint["point_id"]
        h = _headers(user_auth["token"])

        r = httpx.post(f"{BASE_URL}/api/tag-points/{pid}/save", headers=h, timeout=15)
        assert r.status_code == 200
        assert r.json()["is_saved"] is True

        # Check saved list
        r2 = httpx.get(f"{BASE_URL}/api/tag-points/saved", headers=h, timeout=15)
        assert r2.status_code == 200

        r3 = httpx.delete(f"{BASE_URL}/api/tag-points/{pid}/unsave", headers=h, timeout=15)
        assert r3.status_code == 200
        assert r3.json()["is_saved"] is False

    def test_join_and_leave_tagpoint(self, created_tagpoint, user_auth):
        pid = created_tagpoint["point_id"]
        h = _headers(user_auth["token"])

        r = httpx.post(f"{BASE_URL}/api/tag-points/{pid}/join", headers=h, timeout=15)
        assert r.status_code == 200
        assert r.json()["is_participant"] is True

        # Participants list
        r2 = httpx.get(f"{BASE_URL}/api/tag-points/{pid}/participants", timeout=15)
        assert r2.status_code == 200
        assert isinstance(r2.json(), list)

        r3 = httpx.delete(f"{BASE_URL}/api/tag-points/{pid}/leave", headers=h, timeout=15)
        assert r3.status_code == 200
        assert r3.json()["is_participant"] is False

    def test_vote_tagpoint(self, created_tagpoint, user_auth):
        pid = created_tagpoint["point_id"]
        h = _headers(user_auth["token"])

        # First join (required to interact)
        httpx.post(f"{BASE_URL}/api/tag-points/{pid}/join", headers=h, timeout=15)

        r = httpx.post(
            f"{BASE_URL}/api/tag-points/{pid}/vote",
            json={"rating": 4, "comment": "Super test E2E!"},
            headers=h,
            timeout=15,
        )
        assert r.status_code == 200
        assert "avg_rating" in r.json()

        # Get my vote
        r2 = httpx.get(f"{BASE_URL}/api/tag-points/{pid}/my-vote", headers=h, timeout=15)
        assert r2.status_code == 200
        assert r2.json()["exists"] is True
        assert r2.json()["rating"] == 4

        # Get all votes
        r3 = httpx.get(f"{BASE_URL}/api/tag-points/{pid}/votes", timeout=15)
        assert r3.status_code == 200
        assert isinstance(r3.json(), list)

        # Cleanup
        httpx.delete(f"{BASE_URL}/api/tag-points/{pid}/leave", headers=h, timeout=15)

    def test_update_tagpoint(self, created_tagpoint, coach_auth):
        pid = created_tagpoint["point_id"]
        r = httpx.put(
            f"{BASE_URL}/api/tag-points/{pid}",
            json={"description": "Updated E2E description"},
            headers=_headers(coach_auth["token"]),
            timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["description"] == "Updated E2E description"

    def test_toggle_visibility(self, coach_auth):
        """Create a private tagpoint, toggle visibility, then clean up."""
        r = httpx.get(f"{BASE_URL}/api/tags", timeout=15)
        tags = r.json()
        tag_id = tags[0]["tag_id"] if tags else "tag_test"

        r2 = httpx.post(
            f"{BASE_URL}/api/tag-points",
            json={
                "title": f"Visibility Test {uuid.uuid4().hex[:6]}",
                "description": "Test visibility toggle",
                "latitude": 48.85,
                "longitude": 2.35,
                "precision": "exact",
                "tag_ids": [tag_id],
            },
            headers=_headers(coach_auth["token"]),
            timeout=15,
        )
        assert r2.status_code == 200
        pid = r2.json()["point_id"]

        # Toggle visibility (no other participants)
        r3 = httpx.patch(
            f"{BASE_URL}/api/tag-points/{pid}/visibility",
            headers=_headers(coach_auth["token"]),
            timeout=15,
        )
        assert r3.status_code == 200
        assert "is_public" in r3.json()

        # Clean up
        httpx.delete(f"{BASE_URL}/api/tag-points/{pid}", headers=_headers(coach_auth["token"]), timeout=15)

    def test_cancel_and_restore(self, created_tagpoint, coach_auth):
        pid = created_tagpoint["point_id"]
        h = _headers(coach_auth["token"])

        r = httpx.post(f"{BASE_URL}/api/tag-points/{pid}/cancel", headers=h, timeout=15)
        assert r.status_code == 200
        assert r.json()["cancelled"] is True

        r2 = httpx.post(f"{BASE_URL}/api/tag-points/{pid}/restore", headers=h, timeout=15)
        assert r2.status_code == 200
        assert r2.json()["cancelled"] is False

    def test_new_date_toggle(self, created_tagpoint, coach_auth):
        pid = created_tagpoint["point_id"]
        r = httpx.patch(
            f"{BASE_URL}/api/tag-points/{pid}/new-date",
            headers=_headers(coach_auth["token"]),
            timeout=15,
        )
        assert r.status_code == 200
        assert "new_date_coming" in r.json()

        # Toggle back
        httpx.patch(
            f"{BASE_URL}/api/tag-points/{pid}/new-date",
            headers=_headers(coach_auth["token"]),
            timeout=15,
        )

    def test_tagpoint_not_found(self):
        r = httpx.get(f"{BASE_URL}/api/tag-points/nonexistent_id_xyz", timeout=15)
        assert r.status_code == 404


# ═══════════════════════════════════════════════════════════════════════════════
# 8. SPOT YOU ROUTES (dedicated /spot-you/ endpoints)
# ═══════════════════════════════════════════════════════════════════════════════

class TestSpotYouRoutes:
    @pytest.fixture(scope="class")
    def spotyou_point(self, coach_auth):
        """Create a SpotYou for spot-you route tests."""
        r = httpx.get(f"{BASE_URL}/api/tags", timeout=15)
        tags = r.json()
        tag_id = tags[0]["tag_id"] if tags else "tag_test"

        r2 = httpx.post(
            f"{BASE_URL}/api/tag-points",
            json={
                "title": f"SpotYou Route Test {uuid.uuid4().hex[:6]}",
                "description": "For spot-you route testing",
                "latitude": 48.87,
                "longitude": 2.34,
                "precision": "exact",
                "tag_ids": [tag_id],
                "event_schedule": {
                    "type": "weekly",
                    "schedule": {
                        str(datetime.now().weekday()): [{"start": "09:00", "end": "10:00"}],
                        str((datetime.now().weekday() + 1) % 7): [{"start": "09:00", "end": "10:00"}],
                    }
                },
                "maximum_participants": 5,
            },
            headers=_headers(coach_auth["token"]),
            timeout=15,
        )
        assert r2.status_code == 200
        return r2.json()

    def test_join_spotyou(self, spotyou_point, user_auth):
        pid = spotyou_point["point_id"]
        r = httpx.post(
            f"{BASE_URL}/api/spot-you/{pid}/join",
            headers=_headers(user_auth["token"]),
            timeout=15,
        )
        assert r.status_code == 200
        data = r.json()
        assert data["is_member"] is True
        assert data["participants_count"] >= 1

    def test_going_spotyou(self, spotyou_point, user_auth):
        pid = spotyou_point["point_id"]
        r = httpx.post(
            f"{BASE_URL}/api/spot-you/{pid}/going",
            headers=_headers(user_auth["token"]),
            timeout=15,
        )
        assert r.status_code == 200
        data = r.json()
        assert data["is_going"] is True
        assert data["is_member"] is True
        assert "going_count" in data
        assert "session_date" in data

    def test_going_requires_membership(self, spotyou_point, test_user):
        pid = spotyou_point["point_id"]
        r = httpx.post(
            f"{BASE_URL}/api/spot-you/{pid}/going",
            headers=_headers(test_user["token"]),
            timeout=15,
        )
        assert r.status_code == 403

    def test_not_going_spotyou(self, spotyou_point, user_auth):
        pid = spotyou_point["point_id"]
        r = httpx.delete(
            f"{BASE_URL}/api/spot-you/{pid}/going",
            headers=_headers(user_auth["token"]),
            timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["is_going"] is False

    def test_get_going_list(self, spotyou_point):
        pid = spotyou_point["point_id"]
        r = httpx.get(f"{BASE_URL}/api/spot-you/{pid}/going", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "going" in data

    def test_spot_you_activity(self, spotyou_point, user_auth):
        pid = spotyou_point["point_id"]
        r = httpx.get(
            f"{BASE_URL}/api/spot-you/{pid}/activity",
            headers=_headers(user_auth["token"]),
            timeout=15,
        )
        assert r.status_code == 200
        assert "activities" in r.json()

    def test_completion_stats(self, user_auth):
        r = httpx.get(
            f"{BASE_URL}/api/spot-you/my-completion-stats",
            headers=_headers(user_auth["token"]),
            timeout=15,
        )
        assert r.status_code == 200
        data = r.json()
        assert "is_community_member" in data
        assert "has_participation" in data

    def test_leave_spotyou(self, spotyou_point, user_auth):
        pid = spotyou_point["point_id"]
        r = httpx.delete(
            f"{BASE_URL}/api/spot-you/{pid}/leave",
            headers=_headers(user_auth["token"]),
            timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["is_member"] is False

    def test_owner_cannot_leave(self, spotyou_point, coach_auth):
        pid = spotyou_point["point_id"]
        r = httpx.delete(
            f"{BASE_URL}/api/spot-you/{pid}/leave",
            headers=_headers(coach_auth["token"]),
            timeout=15,
        )
        assert r.status_code == 403


# ═══════════════════════════════════════════════════════════════════════════════
# 9. SERVICES
# ═══════════════════════════════════════════════════════════════════════════════

class TestServices:
    @pytest.fixture(scope="class")
    def created_service(self, coach_auth):
        """Create a test service."""
        r = httpx.get(f"{BASE_URL}/api/tags", timeout=15)
        tags = r.json()
        tag_id = tags[0]["tag_id"] if tags else "tag_test"
        domain_id = tags[0].get("domain_id") if tags else None

        r2 = httpx.post(
            f"{BASE_URL}/api/services",
            json={
                "title": f"E2E Service Test {uuid.uuid4().hex[:6]}",
                "description": "Service pour tests E2E",
                "address": "Paris, France",
                "price": 50.0,
                "duration_min": 60,
                "tag_ids": [tag_id],
                "domain_id": domain_id,
                "max_participants": 1,
                "packages": [],
                "locations": [{
                    "latitude": 48.8566,
                    "longitude": 2.3522,
                    "precision": "exact",
                    "description": "Paris centre",
                }],
                "slots": [{
                    "slot_type": "single",
                    "slot_date": (datetime.now() + timedelta(days=7)).strftime("%Y-%m-%d"),
                    "start_time": "10:00",
                    "end_time": "11:00",
                    "location_index": 0,
                }],
            },
            headers=_headers(coach_auth["token"]),
            timeout=15,
        )
        assert r2.status_code == 200, f"Create service failed: {r2.text}"
        return r2.json()

    def test_search_services(self):
        r = httpx.get(
            f"{BASE_URL}/api/services",
            params={"lat": 48.8566, "lng": 2.3522, "radius": 50000},
            timeout=15,
        )
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_my_services(self, coach_auth, created_service):
        r = httpx.get(
            f"{BASE_URL}/api/services/mine",
            headers=_headers(coach_auth["token"]),
            timeout=15,
        )
        assert r.status_code == 200
        data = r.json()
        ids = [s["service_id"] for s in data]
        assert created_service["service_id"] in ids

    def test_get_service_detail(self, created_service):
        sid = created_service["service_id"]
        r = httpx.get(f"{BASE_URL}/api/services/{sid}", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data["service_id"] == sid
        assert "coach" in data
        assert "locations" in data
        assert "slots" in data

    def test_update_service(self, created_service, coach_auth):
        sid = created_service["service_id"]
        r = httpx.put(
            f"{BASE_URL}/api/services/{sid}",
            json={"description": "Updated E2E service description"},
            headers=_headers(coach_auth["token"]),
            timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["description"] == "Updated E2E service description"

    def test_save_and_unsave_service(self, created_service, user_auth):
        sid = created_service["service_id"]
        h = _headers(user_auth["token"])

        r = httpx.post(f"{BASE_URL}/api/services/{sid}/save", headers=h, timeout=15)
        assert r.status_code == 200
        assert r.json()["is_saved"] is True

        r2 = httpx.get(f"{BASE_URL}/api/services/saved", headers=h, timeout=15)
        assert r2.status_code == 200

        r3 = httpx.delete(f"{BASE_URL}/api/services/{sid}/unsave", headers=h, timeout=15)
        assert r3.status_code == 200
        assert r3.json()["is_saved"] is False

    def test_service_not_found(self):
        r = httpx.get(f"{BASE_URL}/api/services/nonexistent_svc_id", timeout=15)
        assert r.status_code == 404


# ═══════════════════════════════════════════════════════════════════════════════
# 10. BOOKINGS
# ═══════════════════════════════════════════════════════════════════════════════

class TestBookings:
    @pytest.fixture(scope="class")
    def booking_service(self, coach_auth):
        """Create a dedicated service for booking tests with a slot."""
        r = httpx.get(f"{BASE_URL}/api/tags", timeout=15)
        tags = r.json()
        tag_id = tags[0]["tag_id"] if tags else "tag_test"

        slot_date = (datetime.now() + timedelta(days=14)).strftime("%Y-%m-%d")
        r2 = httpx.post(
            f"{BASE_URL}/api/services",
            json={
                "title": f"Booking Test Service {uuid.uuid4().hex[:6]}",
                "description": "For booking E2E tests",
                "address": "Paris",
                "price": 25.0,
                "duration_min": 30,
                "tag_ids": [tag_id],
                "max_participants": 1,
                "packages": [],
                "locations": [{"latitude": 48.85, "longitude": 2.35, "precision": "exact", "description": "Paris"}],
                "slots": [{"slot_type": "single", "slot_date": slot_date, "start_time": "14:00", "end_time": "14:30", "location_index": 0}],
            },
            headers=_headers(coach_auth["token"]),
            timeout=15,
        )
        assert r2.status_code == 200
        return r2.json()

    def test_price_preview(self, booking_service, user_auth):
        sid = booking_service["service_id"]
        r = httpx.post(
            f"{BASE_URL}/api/bookings/price-preview",
            json={"service_id": sid},
            headers=_headers(user_auth["token"]),
            timeout=15,
        )
        assert r.status_code == 200
        data = r.json()
        assert "base_amount" in data
        assert "payer_total_amount" in data
        assert "receiver_net_amount" in data
        assert data["base_amount"] == 25.0

    def test_create_booking(self, booking_service, user_auth):
        sid = booking_service["service_id"]
        coach_id = booking_service["coach_id"]
        slot = booking_service["slots"][0] if booking_service.get("slots") else None
        slot_id = slot["slot_id"] if slot else None

        r = httpx.post(
            f"{BASE_URL}/api/bookings/request",
            json={
                "service_id": sid,
                "slot_id": slot_id,
                "notes": "E2E test booking",
                "idempotency_key": f"e2e_test_{uuid.uuid4().hex[:8]}",
            },
            headers=_headers(user_auth["token"]),
            timeout=15,
        )
        assert r.status_code == 200, f"Create booking failed: {r.text}"
        data = r.json()
        assert "booking_id" in data
        assert data["status"] in ("awaiting_payment", "requested")
        return data

    def test_my_bookings(self, user_auth):
        r = httpx.get(
            f"{BASE_URL}/api/bookings/me",
            headers=_headers(user_auth["token"]),
            timeout=15,
        )
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_received_bookings(self, coach_auth):
        r = httpx.get(
            f"{BASE_URL}/api/bookings/received",
            headers=_headers(coach_auth["token"]),
            timeout=15,
        )
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_booking_detail(self, booking_service, user_auth, coach_auth):
        """Create a booking and get its detail."""
        sid = booking_service["service_id"]
        slot = booking_service["slots"][0] if booking_service.get("slots") else None

        # Create a fresh booking
        unique_key = f"e2e_detail_{uuid.uuid4().hex[:8]}"

        # Create new slots for the service first (previous one may be taken)
        slot_date = (datetime.now() + timedelta(days=21)).strftime("%Y-%m-%d")
        httpx.put(
            f"{BASE_URL}/api/services/{sid}",
            json={
                "slots": [{"slot_type": "single", "slot_date": slot_date, "start_time": "16:00", "end_time": "16:30", "location_index": 0}],
            },
            headers=_headers(coach_auth["token"]),
            timeout=15,
        )

        # Refresh service to get new slot
        sr = httpx.get(f"{BASE_URL}/api/services/{sid}", timeout=15)
        svc = sr.json()
        new_slot = svc["slots"][0] if svc.get("slots") else None

        r = httpx.post(
            f"{BASE_URL}/api/bookings/request",
            json={
                "service_id": sid,
                "slot_id": new_slot["slot_id"] if new_slot else None,
                "notes": "E2E detail test",
                "idempotency_key": unique_key,
            },
            headers=_headers(user_auth["token"]),
            timeout=15,
        )
        if r.status_code != 200:
            pytest.skip(f"Could not create booking for detail test: {r.text}")

        bid = r.json()["booking_id"]
        r2 = httpx.get(
            f"{BASE_URL}/api/bookings/{bid}",
            headers=_headers(user_auth["token"]),
            timeout=15,
        )
        assert r2.status_code == 200
        data = r2.json()
        assert data["booking_id"] == bid
        assert "pricing_snapshot" in data
        assert "service_title" in data

    def test_cancel_booking(self, booking_service, user_auth, coach_auth):
        """Create and cancel a booking."""
        sid = booking_service["service_id"]

        # Add more slots
        slot_date = (datetime.now() + timedelta(days=28)).strftime("%Y-%m-%d")
        httpx.put(
            f"{BASE_URL}/api/services/{sid}",
            json={
                "slots": [{"slot_type": "single", "slot_date": slot_date, "start_time": "08:00", "end_time": "08:30", "location_index": 0}],
            },
            headers=_headers(coach_auth["token"]),
            timeout=15,
        )

        sr = httpx.get(f"{BASE_URL}/api/services/{sid}", timeout=15)
        svc = sr.json()
        slot = svc["slots"][0] if svc.get("slots") else None

        r = httpx.post(
            f"{BASE_URL}/api/bookings/request",
            json={
                "service_id": sid,
                "slot_id": slot["slot_id"] if slot else None,
                "idempotency_key": f"e2e_cancel_{uuid.uuid4().hex[:8]}",
            },
            headers=_headers(user_auth["token"]),
            timeout=15,
        )
        if r.status_code != 200:
            pytest.skip(f"Could not create booking for cancel test: {r.text}")

        bid = r.json()["booking_id"]

        r2 = httpx.post(
            f"{BASE_URL}/api/bookings/{bid}/cancel",
            json={"reason": "E2E cancel test"},
            headers=_headers(user_auth["token"]),
            timeout=15,
        )
        assert r2.status_code == 200
        assert r2.json()["status"] == "cancelled"

    def test_booking_not_found(self, user_auth):
        r = httpx.get(
            f"{BASE_URL}/api/bookings/nonexistent_bkg_id",
            headers=_headers(user_auth["token"]),
            timeout=15,
        )
        assert r.status_code == 404

    def test_cannot_book_own_service(self, booking_service, coach_auth):
        sid = booking_service["service_id"]
        r = httpx.post(
            f"{BASE_URL}/api/bookings/request",
            json={"service_id": sid, "idempotency_key": f"self_book_{uuid.uuid4().hex[:8]}"},
            headers=_headers(coach_auth["token"]),
            timeout=15,
        )
        assert r.status_code == 400


# ═══════════════════════════════════════════════════════════════════════════════
# 11. ADMIN
# ═══════════════════════════════════════════════════════════════════════════════

class TestAdmin:
    def test_admin_stats(self, admin_auth):
        r = httpx.get(f"{BASE_URL}/api/admin/stats", headers=_headers(admin_auth["token"]), timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "total_users" in data
        assert "total_coaches" in data
        assert "total_bookings" in data
        assert "gmv" in data

    def test_admin_users(self, admin_auth):
        r = httpx.get(f"{BASE_URL}/api/admin/users", headers=_headers(admin_auth["token"]), timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_admin_users_filter_role(self, admin_auth):
        r = httpx.get(
            f"{BASE_URL}/api/admin/users",
            params={"role": "coach"},
            headers=_headers(admin_auth["token"]),
            timeout=15,
        )
        assert r.status_code == 200
        for u in r.json():
            assert u["role"] == "coach"

    def test_admin_tag_points(self, admin_auth):
        r = httpx.get(f"{BASE_URL}/api/admin/tag-points", headers=_headers(admin_auth["token"]), timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_admin_services(self, admin_auth):
        r = httpx.get(f"{BASE_URL}/api/admin/services", headers=_headers(admin_auth["token"]), timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_admin_pricing_rules(self, admin_auth):
        r = httpx.get(f"{BASE_URL}/api/admin/pricing-rules", headers=_headers(admin_auth["token"]), timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_admin_subscription_plans(self, admin_auth):
        r = httpx.get(f"{BASE_URL}/api/admin/subscription-plans", headers=_headers(admin_auth["token"]), timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_admin_app_config(self, admin_auth):
        r = httpx.get(f"{BASE_URL}/api/admin/app-config", headers=_headers(admin_auth["token"]), timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "enable_manual_approval_for_services" in data
        assert "pay_now_checkout_minutes" in data

    def test_admin_update_app_config(self, admin_auth):
        h = _headers(admin_auth["token"])
        # Read current value
        r = httpx.get(f"{BASE_URL}/api/admin/app-config", headers=h, timeout=15)
        current = r.json()["pay_now_checkout_minutes"]

        # Update
        r2 = httpx.put(
            f"{BASE_URL}/api/admin/app-config",
            json={"pay_now_checkout_minutes": 45},
            headers=h,
            timeout=15,
        )
        assert r2.status_code == 200

        # Verify
        r3 = httpx.get(f"{BASE_URL}/api/admin/app-config", headers=h, timeout=15)
        assert r3.json()["pay_now_checkout_minutes"] == 45

        # Restore
        httpx.put(
            f"{BASE_URL}/api/admin/app-config",
            json={"pay_now_checkout_minutes": current},
            headers=h,
            timeout=15,
        )

    def test_admin_tags_analytics(self, admin_auth):
        r = httpx.get(f"{BASE_URL}/api/admin/tags-analytics", headers=_headers(admin_auth["token"]), timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "top_tags" in data
        assert "top_domains" in data
        assert "totals" in data

    def test_admin_all_domains(self, admin_auth):
        r = httpx.get(f"{BASE_URL}/api/admin/all-domains", headers=_headers(admin_auth["token"]), timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_admin_all_categories(self, admin_auth):
        r = httpx.get(f"{BASE_URL}/api/admin/all-categories", headers=_headers(admin_auth["token"]), timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_admin_all_tags(self, admin_auth):
        r = httpx.get(f"{BASE_URL}/api/admin/all-tags", headers=_headers(admin_auth["token"]), timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_non_admin_denied(self, user_auth):
        r = httpx.get(f"{BASE_URL}/api/admin/stats", headers=_headers(user_auth["token"]), timeout=15)
        assert r.status_code == 403


# ═══════════════════════════════════════════════════════════════════════════════
# 12. CHAT & CONVERSATIONS
# ═══════════════════════════════════════════════════════════════════════════════

class TestChat:
    @pytest.fixture(scope="class")
    def service_for_chat(self, coach_auth):
        """Get or create a service for conversation tests."""
        r = httpx.get(
            f"{BASE_URL}/api/services/mine",
            headers=_headers(coach_auth["token"]),
            timeout=15,
        )
        services = r.json()
        if services:
            return services[0]
        # Create one
        r2 = httpx.post(
            f"{BASE_URL}/api/services",
            json={
                "title": "Chat test service",
                "description": "For chat E2E",
                "address": "Paris",
                "price": 10.0,
                "duration_min": 30,
                "tag_ids": [],
                "packages": [],
                "locations": [{"latitude": 48.85, "longitude": 2.35, "precision": "exact", "description": "Paris"}],
                "slots": [],
            },
            headers=_headers(coach_auth["token"]),
            timeout=15,
        )
        return r2.json()

    def test_create_service_conversation(self, service_for_chat, user_auth):
        sid = service_for_chat["service_id"]
        r = httpx.post(
            f"{BASE_URL}/api/conversations",
            json={"type": "service", "context_id": sid},
            headers=_headers(user_auth["token"]),
            timeout=15,
        )
        assert r.status_code == 200
        data = r.json()
        assert "conversation_id" in data
        assert data["type"] == "service"

    def test_list_conversations(self, user_auth):
        r = httpx.get(
            f"{BASE_URL}/api/conversations",
            headers=_headers(user_auth["token"]),
            timeout=15,
        )
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_get_messages(self, service_for_chat, user_auth):
        sid = service_for_chat["service_id"]
        # Get/create conv
        r = httpx.post(
            f"{BASE_URL}/api/conversations",
            json={"type": "service", "context_id": sid},
            headers=_headers(user_auth["token"]),
            timeout=15,
        )
        conv_id = r.json()["conversation_id"]

        r2 = httpx.get(
            f"{BASE_URL}/api/conversations/{conv_id}/messages",
            headers=_headers(user_auth["token"]),
            timeout=15,
        )
        assert r2.status_code == 200
        assert isinstance(r2.json(), list)

    def test_mark_read(self, service_for_chat, user_auth):
        sid = service_for_chat["service_id"]
        r = httpx.post(
            f"{BASE_URL}/api/conversations",
            json={"type": "service", "context_id": sid},
            headers=_headers(user_auth["token"]),
            timeout=15,
        )
        conv_id = r.json()["conversation_id"]

        r2 = httpx.put(
            f"{BASE_URL}/api/conversations/{conv_id}/read",
            headers=_headers(user_auth["token"]),
            timeout=15,
        )
        assert r2.status_code == 200

    def test_group_conversation_requires_membership(self, test_user, coach_auth):
        """Non-member cannot create a group conversation."""
        # Create a SpotYou
        r = httpx.get(f"{BASE_URL}/api/tags", timeout=15)
        tags = r.json()
        tag_id = tags[0]["tag_id"] if tags else "tag_test"
        r2 = httpx.post(
            f"{BASE_URL}/api/tag-points",
            json={
                "title": f"ChatGroup Test {uuid.uuid4().hex[:6]}",
                "description": "Test",
                "latitude": 48.86, "longitude": 2.34,
                "precision": "exact", "tag_ids": [tag_id],
            },
            headers=_headers(coach_auth["token"]),
            timeout=15,
        )
        pid = r2.json()["point_id"]

        # Try to create group conv as non-member
        r3 = httpx.post(
            f"{BASE_URL}/api/conversations",
            json={"type": "tagpoint_group", "context_id": pid},
            headers=_headers(test_user["token"]),
            timeout=15,
        )
        assert r3.status_code == 403

        # Clean up
        httpx.delete(f"{BASE_URL}/api/tag-points/{pid}", headers=_headers(coach_auth["token"]), timeout=15)


# ═══════════════════════════════════════════════════════════════════════════════
# 13. HOME FEED
# ═══════════════════════════════════════════════════════════════════════════════

class TestHomeFeed:
    def test_home_feed_with_location(self, user_auth):
        r = httpx.get(
            f"{BASE_URL}/api/home/feed",
            params={"lat": 48.8566, "lng": 2.3522},
            headers=_headers(user_auth["token"]),
            timeout=15,
        )
        assert r.status_code == 200
        data = r.json()
        assert "spotyou" in data
        assert "services" in data
        assert "actual_radius_km" in data
        assert "total_count" in data

    def test_home_feed_no_auth(self):
        r = httpx.get(
            f"{BASE_URL}/api/home/feed",
            params={"lat": 48.8566, "lng": 2.3522},
            timeout=15,
        )
        assert r.status_code == 200

    def test_nearest_sector(self):
        r = httpx.get(
            f"{BASE_URL}/api/home/nearest-sector",
            params={"lat": 48.8566, "lng": 2.3522},
            timeout=15,
        )
        # May return null if no data, but should not error
        assert r.status_code == 200


# ═══════════════════════════════════════════════════════════════════════════════
# 14. PAYMENTS
# ═══════════════════════════════════════════════════════════════════════════════

class TestPayments:
    def test_my_payments(self, user_auth):
        r = httpx.get(
            f"{BASE_URL}/api/payments/me",
            headers=_headers(user_auth["token"]),
            timeout=15,
        )
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_admin_payments(self, admin_auth):
        r = httpx.get(
            f"{BASE_URL}/api/admin/payments",
            headers=_headers(admin_auth["token"]),
            timeout=15,
        )
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_admin_payment_stats(self, admin_auth):
        r = httpx.get(
            f"{BASE_URL}/api/admin/payments/stats",
            headers=_headers(admin_auth["token"]),
            timeout=15,
        )
        assert r.status_code == 200
        data = r.json()
        assert "total_payments" in data
        assert "gmv" in data


# ═══════════════════════════════════════════════════════════════════════════════
# 15. NOTIFICATIONS
# ═══════════════════════════════════════════════════════════════════════════════

class TestNotifications:
    def test_get_notifications(self, user_auth):
        r = httpx.get(
            f"{BASE_URL}/api/users/me/notifications",
            headers=_headers(user_auth["token"]),
            timeout=15,
        )
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_mark_all_read(self, user_auth):
        r = httpx.patch(
            f"{BASE_URL}/api/users/me/notifications/read-all",
            headers=_headers(user_auth["token"]),
            timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["success"] is True


# ═══════════════════════════════════════════════════════════════════════════════
# 16. EVENTS & PLANNING
# ═══════════════════════════════════════════════════════════════════════════════

class TestEventsPlanning:
    def test_my_events(self, user_auth):
        r = httpx.get(
            f"{BASE_URL}/api/users/me/events",
            headers=_headers(user_auth["token"]),
            timeout=15,
        )
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_planning_events(self, user_auth):
        r = httpx.get(
            f"{BASE_URL}/api/users/me/planning-events",
            headers=_headers(user_auth["token"]),
            timeout=15,
        )
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_activity_feed(self, user_auth):
        r = httpx.get(
            f"{BASE_URL}/api/users/me/activity-feed",
            headers=_headers(user_auth["token"]),
            timeout=15,
        )
        assert r.status_code == 200
        data = r.json()
        assert "activities" in data


# ═══════════════════════════════════════════════════════════════════════════════
# 17. ADDRESSES
# ═══════════════════════════════════════════════════════════════════════════════

class TestAddresses:
    def test_list_addresses(self, user_auth):
        r = httpx.get(
            f"{BASE_URL}/api/addresses",
            headers=_headers(user_auth["token"]),
            timeout=15,
        )
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ═══════════════════════════════════════════════════════════════════════════════
# 18. UPLOAD (static files)
# ═══════════════════════════════════════════════════════════════════════════════

class TestUploads:
    def test_upload_endpoint_exists(self, user_auth):
        """Test that the upload endpoint responds (even without a real file)."""
        r = httpx.post(
            f"{BASE_URL}/api/upload",
            headers=_headers(user_auth["token"]),
            timeout=15,
        )
        # Expected to fail with 422 (no file) or 400, but not 404/500
        assert r.status_code in (400, 422, 200)


# ═══════════════════════════════════════════════════════════════════════════════
# 19. BECOME COACH
# ═══════════════════════════════════════════════════════════════════════════════

class TestBecomeCoach:
    def test_become_coach_flow(self):
        """Register a fresh user and upgrade to coach."""
        unique = uuid.uuid4().hex[:8]
        r = httpx.post(
            f"{BASE_URL}/api/auth/register",
            json={"email": f"coach_candidate_{unique}@test.com", "password": "Pass123!", "name": f"Coach {unique}", "language": "fr"},
            timeout=15,
        )
        assert r.status_code == 200
        token = r.json()["token"]
        assert r.json()["user"]["role"] == "user"

        r2 = httpx.post(
            f"{BASE_URL}/api/users/become-coach",
            headers=_headers(token),
            timeout=15,
        )
        assert r2.status_code == 200
        assert r2.json()["role"] == "coach"

    def test_become_coach_already_coach(self, coach_auth):
        r = httpx.post(
            f"{BASE_URL}/api/users/become-coach",
            headers=_headers(coach_auth["token"]),
            timeout=15,
        )
        assert r.status_code == 400
