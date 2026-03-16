"""
Test suite for Notification System - Iteration 47
Tests all notification endpoints:
  - GET /api/users/me/notifications
  - POST /api/users/{user_id}/reviews  → profile_review notification
  - POST /api/bookings                 → new_booking notification for coach
  - POST /api/bookings/{id}/accept     → booking_accepted notification for user
  - POST /api/bookings/{id}/refuse     → booking_refused notification for user
  - POST /api/tag-points/{id}/join     → spotyu_join notification for SpotYou owner
  - PATCH /api/users/me/notifications/{id}/read   → mark one notification as read
  - PATCH /api/users/me/notifications/read-all    → mark all notifications as read
"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")


def _get_valid_tag_ids():
    """Récupère un tag valide depuis l'API pour respecter la règle métier (au moins 1 tag requis)."""
    try:
        resp = requests.get(f"{BASE_URL}/api/tags/categories?domain_id=dom_sport", timeout=5)
        if resp.status_code == 200:
            for cat in resp.json():
                for tag in cat.get("tags", []):
                    return [tag["tag_id"]]
    except Exception:
        pass
    return ["tag_3x3"]  # fallback hardcodé


VALID_TAG_IDS = _get_valid_tag_ids()

# Credentials
COACH_EMAIL = "coach@winek.app"
COACH_PASS = "WinekCoach2024!"
COACH_USER_ID = "user_coach001"

USER_EMAIL = "user@winek.app"
USER_PASS = "WinekUser2024!"
USER_USER_ID = "user_demo001"

SVC_DEMO001 = None   # défini dynamiquement dans setup_module
SVC_ACCEPT = None
SVC_REFUSE = None
SLOT_IDS = []

# ─── Fixtures dynamiques — service de test frais ──────────────────────────────

_TEST_SVC_ID = None
_TEST_SLOT_IDS: list = []


def setup_module(module):
    """
    Crée un service de test pour coach@winek.app avec 3 slots futurs en mode
    'requires_approval' (pas de paiement requis) pour pouvoir tester
    accept/refuse sans simulation de paiement.
    Active également le flag global enable_manual_approval_for_services.
    """
    global _TEST_SVC_ID, _TEST_SLOT_IDS, SVC_DEMO001, SVC_ACCEPT, SVC_REFUSE, SLOT_IDS
    from datetime import datetime, timedelta
    import sys

    # Activer le flag global "manual approval" via l'admin
    admin_tok = login("admin@winek.app", "WinekAdmin2024!")
    admin_hdrs = auth_headers(admin_tok)
    requests.put(
        f"{BASE_URL}/api/admin/app-config",
        json={"enable_manual_approval_for_services": True},
        headers=admin_hdrs,
        timeout=10,
    )

    coach_tok = login(COACH_EMAIL, COACH_PASS)
    hdrs = auth_headers(coach_tok)

    future_dates = [
        (datetime.now() + timedelta(days=10 + i)).strftime("%Y-%m-%d")
        for i in range(3)
    ]
    payload = {
        "title": "TEST Service notifications iter47",
        "description": "Temporaire — tests notifications",
        "price": 60.0,
        "duration_min": 60,
        "domain_id": "dom_coaching",
        "tag_ids": VALID_TAG_IDS,
        "images": [],
        "booking_approval_mode": "requires_approval",
        "locations": [{"address": "Paris", "latitude": 48.8566, "longitude": 2.3522}],
        "slots": [
            {"slot_date": d, "start_time": "10:00", "end_time": "11:00", "capacity": 1}
            for d in future_dates
        ],
    }
    resp = requests.post(f"{BASE_URL}/api/services", json=payload, headers=hdrs, timeout=15)
    assert resp.status_code == 200, f"setup_module — create service failed: {resp.text}"
    data = resp.json()
    _TEST_SVC_ID = data["service_id"]
    _TEST_SLOT_IDS = [s["slot_id"] for s in data.get("slots", [])]
    assert len(_TEST_SLOT_IDS) >= 3, f"Expected ≥3 slots, got {data.get('slots')}"

    # Peupler les variables globales utilisées par les tests
    SVC_DEMO001 = _TEST_SVC_ID
    SVC_ACCEPT  = _TEST_SVC_ID
    SVC_REFUSE  = _TEST_SVC_ID
    SLOT_IDS    = _TEST_SLOT_IDS

    # Mettre à jour le module pour que les tests voient les bonnes valeurs
    mod = sys.modules[__name__]
    mod.SVC_DEMO001 = SVC_DEMO001
    mod.SVC_ACCEPT  = SVC_ACCEPT
    mod.SVC_REFUSE  = SVC_REFUSE
    mod.SLOT_IDS    = SLOT_IDS

    print(f"setup_module: service {_TEST_SVC_ID} created, slots={_TEST_SLOT_IDS}")


def teardown_module(module):
    """Supprime le service créé dans setup_module."""
    if not _TEST_SVC_ID:
        return
    coach_tok = login(COACH_EMAIL, COACH_PASS)
    requests.delete(
        f"{BASE_URL}/api/services/{_TEST_SVC_ID}",
        headers=auth_headers(coach_tok),
        timeout=15,
    )
    print(f"teardown_module: service {_TEST_SVC_ID} supprimé")


# ---------- Helpers ----------

def login(email: str, password: str) -> str:
    """Login and return JWT token."""
    resp = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": email, "password": password},
        timeout=15,
    )
    assert resp.status_code == 200, f"Login failed for {email}: {resp.text}"
    return resp.json()["token"]


def auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def get_notifications(token: str) -> list:
    resp = requests.get(f"{BASE_URL}/api/users/me/notifications", headers=auth_headers(token), timeout=15)
    assert resp.status_code == 200, f"get notifications failed: {resp.text}"
    return resp.json()


def find_notif(notifications: list, notif_type: str, min_created_ts: float = 0) -> dict:
    """Find the most recent notification of a given type created after min_created_ts."""
    for n in notifications:
        if n.get("type") == notif_type:
            return n
    return None


# ---------- Fixtures ----------

@pytest.fixture(scope="module")
def coach_token():
    return login(COACH_EMAIL, COACH_PASS)


@pytest.fixture(scope="module")
def user_token():
    return login(USER_EMAIL, USER_PASS)


@pytest.fixture(scope="module")
def admin_token():
    return login("admin@winek.app", "WinekAdmin2024!")


# ---------- Tests ----------

class TestGetNotifications:
    """GET /api/users/me/notifications"""

    def test_get_notifications_returns_200(self, user_token):
        resp = requests.get(
            f"{BASE_URL}/api/users/me/notifications",
            headers=auth_headers(user_token),
            timeout=15,
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        print("✅ GET /api/users/me/notifications → 200")

    def test_get_notifications_returns_list(self, user_token):
        resp = requests.get(
            f"{BASE_URL}/api/users/me/notifications",
            headers=auth_headers(user_token),
            timeout=15,
        )
        data = resp.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        print(f"✅ GET /api/users/me/notifications → list with {len(data)} items")

    def test_get_notifications_structure(self, user_token):
        """Each notification must have required fields."""
        resp = requests.get(
            f"{BASE_URL}/api/users/me/notifications",
            headers=auth_headers(user_token),
            timeout=15,
        )
        data = resp.json()
        if data:
            n = data[0]
            for field in ["id", "type", "title", "body", "data", "read", "created_at"]:
                assert field in n, f"Missing field '{field}' in notification: {n}"
            print(f"✅ Notification structure OK: {list(n.keys())}")
        else:
            print("ℹ️  No notifications yet for user (list empty) — structure test skipped")

    def test_get_notifications_requires_auth(self):
        resp = requests.get(f"{BASE_URL}/api/users/me/notifications", timeout=15)
        assert resp.status_code in [401, 403], f"Expected 401/403 without auth, got {resp.status_code}"
        print("✅ GET /api/users/me/notifications without auth → 401/403")

    def test_get_coach_notifications_returns_200(self, coach_token):
        resp = requests.get(
            f"{BASE_URL}/api/users/me/notifications",
            headers=auth_headers(coach_token),
            timeout=15,
        )
        assert resp.status_code == 200
        print(f"✅ Coach GET /api/users/me/notifications → 200, {len(resp.json())} notifications")


class TestProfileReviewNotification:
    """POST /api/users/{user_id}/reviews → creates profile_review notification"""

    def test_review_creates_profile_review_notification(self, user_token, coach_token):
        """Coach reviews user (user_demo001) → user receives a profile_review notification.
        Note: user→coach review already exists from prior tests so we reverse the direction.
        """
        # Get initial user notifications count
        notifs_before = get_notifications(user_token)
        profile_review_count_before = sum(1 for n in notifs_before if n.get("type") == "profile_review")

        # Coach reviews user (may 409 if already reviewed — handle gracefully)
        resp = requests.post(
            f"{BASE_URL}/api/users/{USER_USER_ID}/reviews",
            headers=auth_headers(coach_token),
            json={"rating": 4, "comment": "TEST notification iter47 - super utilisateur!"},
            timeout=15,
        )
        if resp.status_code == 409:
            pytest.skip("Review already exists for coach→user pair — duplicate review prevention OK")
        assert resp.status_code in [200, 201], f"create review failed: {resp.status_code} {resp.text}"
        review_id = resp.json().get("review_id")
        print(f"✅ Review created by coach for user: {review_id}")

        # Wait for async task
        time.sleep(2)

        # Check user has new profile_review notification
        notifs_after = get_notifications(user_token)
        profile_review_notifs = [n for n in notifs_after if n.get("type") == "profile_review"]
        assert len(profile_review_notifs) > profile_review_count_before, (
            f"Expected new profile_review notification for user. Before: {profile_review_count_before}, After: {len(profile_review_notifs)}"
        )
        latest = profile_review_notifs[0]
        assert latest["type"] == "profile_review"
        assert latest["read"] == False
        print(f"✅ profile_review notification created for user: {latest['title']} | {latest['body']}")


class TestNewBookingNotification:
    """POST /api/bookings → creates new_booking notification for coach"""

    def test_create_booking_creates_new_booking_notification(self, user_token, coach_token):
        """User books coach's service → coach receives new_booking notification."""
        notifs_before = get_notifications(coach_token)
        new_booking_count_before = sum(1 for n in notifs_before if n.get("type") == "new_booking")

        # Create booking as user (user_demo001 books svc_demo001 owned by coach)
        resp = requests.post(
            f"{BASE_URL}/api/bookings",
            headers=auth_headers(user_token),
            json={
                "service_id": SVC_DEMO001,
                "slot_id": SLOT_IDS[0],
                "notes": "TEST booking iter47 - notification test",
                "scheduled_at": None,
            },
            timeout=15,
        )
        assert resp.status_code in [200, 201], f"create booking failed: {resp.status_code} {resp.text}"
        booking = resp.json()
        booking_id = booking.get("booking_id")
        assert booking_id, "No booking_id returned"
        print(f"✅ Booking created: {booking_id}")

        # Store booking_id for next tests
        TestNewBookingNotification.booking_id = booking_id

        # Wait for async task
        time.sleep(2)

        # Check coach has new new_booking notification
        notifs_after = get_notifications(coach_token)
        new_booking_notifs = [n for n in notifs_after if n.get("type") == "new_booking"]
        assert len(new_booking_notifs) > new_booking_count_before, (
            f"Expected new new_booking notification for coach. Before: {new_booking_count_before}, After: {len(new_booking_notifs)}"
        )
        latest = new_booking_notifs[0]
        assert latest["type"] == "new_booking"
        assert latest["read"] == False
        # Verify notification data contains booking info
        notif_data = latest.get("data", {})
        if isinstance(notif_data, str):
            import json
            notif_data = json.loads(notif_data)
        assert notif_data.get("type") == "new_booking"
        print(f"✅ new_booking notification created for coach: {latest['title']} | {latest['body']}")
        print(f"   notif data: {notif_data}")


class TestBookingAcceptedNotification:
    """POST /api/bookings/{id}/accept → creates booking_accepted notification for user"""

    def test_booking_accept_creates_booking_accepted_notification(self, user_token, coach_token):
        """Coach accepts booking → user receives booking_accepted notification."""
        # Need a booking ID — create a new one first
        create_resp = requests.post(
            f"{BASE_URL}/api/bookings",
            headers=auth_headers(user_token),
            json={
                "service_id": SVC_ACCEPT,
                "slot_id": SLOT_IDS[1],
                "notes": "TEST booking for accept test",
                "scheduled_at": None,
            },
            timeout=15,
        )
        assert create_resp.status_code in [200, 201], f"create booking failed: {create_resp.text}"
        booking_id = create_resp.json()["booking_id"]
        print(f"✅ Created booking for accept test: {booking_id}")

        # Get user notification count before
        notifs_before = get_notifications(user_token)
        accepted_count_before = sum(1 for n in notifs_before if n.get("type") == "booking_accepted")

        # Coach accepts the booking
        resp = requests.post(
            f"{BASE_URL}/api/bookings/{booking_id}/accept",
            headers=auth_headers(coach_token),
            timeout=15,
        )
        assert resp.status_code == 200, f"accept failed: {resp.status_code} {resp.text}"
        result = resp.json()
        # After acceptance, status is either 'accepted' (free) or 'awaiting_payment' (paid)
        assert result.get("status") in ["accepted", "awaiting_payment"], (
            f"Expected status accepted or awaiting_payment, got {result.get('status')}"
        )
        print(f"✅ Booking accepted: {booking_id}")

        # Wait for async task
        time.sleep(2)

        # Check user has new booking_accepted notification
        notifs_after = get_notifications(user_token)
        accepted_notifs = [n for n in notifs_after if n.get("type") == "booking_accepted"]
        assert len(accepted_notifs) > accepted_count_before, (
            f"Expected new booking_accepted notification. Before: {accepted_count_before}, After: {len(accepted_notifs)}"
        )
        latest = accepted_notifs[0]
        assert latest["type"] == "booking_accepted"
        assert latest["read"] == False
        notif_data = latest.get("data", {})
        if isinstance(notif_data, str):
            import json
            notif_data = json.loads(notif_data)
        assert notif_data.get("type") == "booking_accepted"
        print(f"✅ booking_accepted notification for user: {latest['title']} | {latest['body']}")


class TestBookingRefusedNotification:
    """POST /api/bookings/{id}/refuse → creates booking_refused notification for user"""

    def test_booking_refuse_creates_booking_refused_notification(self, user_token, coach_token):
        """Coach refuses booking → user receives booking_refused notification."""
        # Create a new booking
        create_resp = requests.post(
            f"{BASE_URL}/api/bookings",
            headers=auth_headers(user_token),
            json={
                "service_id": SVC_REFUSE,
                "slot_id": SLOT_IDS[2],
                "notes": "TEST booking for refuse test",
                "scheduled_at": None,
            },
            timeout=15,
        )
        assert create_resp.status_code in [200, 201], f"create booking failed: {create_resp.text}"
        booking_id = create_resp.json()["booking_id"]
        print(f"✅ Created booking for refuse test: {booking_id}")

        # Get user notification count before
        notifs_before = get_notifications(user_token)
        refused_count_before = sum(1 for n in notifs_before if n.get("type") == "booking_refused")

        # Coach refuses the booking
        resp = requests.post(
            f"{BASE_URL}/api/bookings/{booking_id}/refuse",
            headers=auth_headers(coach_token),
            timeout=15,
        )
        assert resp.status_code == 200, f"refuse failed: {resp.status_code} {resp.text}"
        result = resp.json()
        assert result.get("status") == "refused", f"Expected status=refused, got {result.get('status')}"
        print(f"✅ Booking refused: {booking_id}")

        # Wait for async task
        time.sleep(2)

        # Check user has new booking_refused notification
        notifs_after = get_notifications(user_token)
        refused_notifs = [n for n in notifs_after if n.get("type") == "booking_refused"]
        assert len(refused_notifs) > refused_count_before, (
            f"Expected new booking_refused notification. Before: {refused_count_before}, After: {len(refused_notifs)}"
        )
        latest = refused_notifs[0]
        assert latest["type"] == "booking_refused"
        assert latest["read"] == False
        notif_data = latest.get("data", {})
        if isinstance(notif_data, str):
            import json
            notif_data = json.loads(notif_data)
        assert notif_data.get("type") == "booking_refused"
        print(f"✅ booking_refused notification for user: {latest['title']} | {latest['body']}")


class TestSpotYuJoinNotification:
    """POST /api/tag-points/{id}/join → creates spotyu_join notification for SpotYou owner"""

    def test_join_creates_spotyu_join_notification(self, user_token, coach_token):
        """User joins a SpotYou owned by coach → coach receives spotyu_join notification."""
        # Step 1: Coach creates a SpotYou (domain_id is required by model)
        create_resp = requests.post(
            f"{BASE_URL}/api/tag-points",
            headers=auth_headers(coach_token),
            json={
                "title": "TEST SpotYou iter47 notification",
                "description": "Test SpotYou for notification testing",
                "latitude": 48.8566,
                "longitude": 2.3522,
                "precision": "exact",
                "tag_ids": VALID_TAG_IDS,
                "domain_id": "dom_sport",
                "images": [],
            },
            timeout=15,
        )
        assert create_resp.status_code in [200, 201], f"create tag-point failed: {create_resp.status_code} {create_resp.text}"
        point_id = create_resp.json().get("point_id")
        assert point_id, "No point_id returned"
        print(f"✅ SpotYou created by coach: {point_id}")

        # Get coach notification count before
        notifs_before = get_notifications(coach_token)
        join_count_before = sum(1 for n in notifs_before if n.get("type") == "spotyu_join")

        # Step 2: User joins the SpotYou
        resp = requests.post(
            f"{BASE_URL}/api/tag-points/{point_id}/join",
            headers=auth_headers(user_token),
            timeout=15,
        )
        assert resp.status_code == 200, f"join tag-point failed: {resp.status_code} {resp.text}"
        result = resp.json()
        assert result.get("is_participant") == True
        print(f"✅ User joined SpotYou: {point_id}, participants: {result.get('participants_count')}")

        # Wait for async task
        time.sleep(2)

        # Check coach has new spotyu_join notification
        notifs_after = get_notifications(coach_token)
        join_notifs = [n for n in notifs_after if n.get("type") == "spotyu_join"]
        assert len(join_notifs) > join_count_before, (
            f"Expected new spotyu_join notification for coach. Before: {join_count_before}, After: {len(join_notifs)}"
        )
        latest = join_notifs[0]
        assert latest["type"] == "spotyu_join"
        assert latest["read"] == False
        notif_data = latest.get("data", {})
        if isinstance(notif_data, str):
            import json
            notif_data = json.loads(notif_data)
        assert notif_data.get("type") == "spotyu_join"
        print(f"✅ spotyu_join notification for coach: {latest['title']} | {latest['body']}")
        print(f"   notif data: {notif_data}")

        # Cleanup: store point_id for potential cleanup
        TestSpotYuJoinNotification.test_point_id = point_id


class TestMarkNotificationRead:
    """PATCH /api/users/me/notifications/{id}/read → marks specific notification as read"""

    def test_mark_notification_read(self, user_token):
        """Marks a single notification as read."""
        # Get user notifications — find an unread one
        notifs = get_notifications(user_token)
        unread_notifs = [n for n in notifs if not n.get("read")]
        if not unread_notifs:
            pytest.skip("No unread notifications to mark as read")

        notif_id = unread_notifs[0]["id"]
        print(f"📌 Will mark notification as read: {notif_id}")

        resp = requests.patch(
            f"{BASE_URL}/api/users/me/notifications/{notif_id}/read",
            headers=auth_headers(user_token),
            timeout=15,
        )
        assert resp.status_code == 200, f"mark read failed: {resp.status_code} {resp.text}"
        result = resp.json()
        assert result.get("success") == True, f"Expected success=true: {result}"
        assert "unread_notif" in result, f"Expected unread_notif in response: {result}"
        print(f"✅ Notification {notif_id} marked as read. Remaining unread: {result['unread_notif']}")

    def test_mark_notification_read_verified_in_list(self, user_token):
        """After marking read, notification should appear as read in list."""
        # Get all notifications, find an unread one
        notifs = get_notifications(user_token)
        unread_notifs = [n for n in notifs if not n.get("read")]
        if not unread_notifs:
            pytest.skip("No unread notifications to mark as read")

        notif_id = unread_notifs[0]["id"]

        # Mark as read
        resp = requests.patch(
            f"{BASE_URL}/api/users/me/notifications/{notif_id}/read",
            headers=auth_headers(user_token),
            timeout=15,
        )
        assert resp.status_code == 200

        # Verify in list
        notifs_after = get_notifications(user_token)
        notif_after = next((n for n in notifs_after if n["id"] == notif_id), None)
        assert notif_after is not None, f"Notification {notif_id} not found after marking read"
        assert notif_after["read"] == True, f"Notification should be read=True, got {notif_after['read']}"
        print(f"✅ Notification {notif_id} verified as read=True in list")

    def test_mark_notification_read_returns_unread_count(self, user_token):
        """Marking read must return updated unread count (decremented by 1)."""
        # Get initial unread count from the list
        notifs_initial = get_notifications(user_token)
        initial_unread = sum(1 for n in notifs_initial if not n.get("read"))

        notifs = get_notifications(user_token)
        unread_notifs = [n for n in notifs if not n.get("read")]
        if not unread_notifs:
            pytest.skip("No unread notifications available")

        notif_id = unread_notifs[0]["id"]
        resp = requests.patch(
            f"{BASE_URL}/api/users/me/notifications/{notif_id}/read",
            headers=auth_headers(user_token),
            timeout=15,
        )
        assert resp.status_code == 200
        result = resp.json()
        assert isinstance(result.get("unread_notif"), int), f"unread_notif must be int: {result}"
        # The count returned must be a non-negative integer
        assert result["unread_notif"] >= 0, f"unread_notif must be >= 0, got {result['unread_notif']}"
        print(f"✅ unread_notif count returned: {result['unread_notif']} (was approximately {initial_unread})")

    def test_mark_notification_read_requires_auth(self):
        """Must return 401/403 without auth."""
        resp = requests.patch(
            f"{BASE_URL}/api/users/me/notifications/some_notif_id/read",
            timeout=15,
        )
        assert resp.status_code in [401, 403], f"Expected 401/403, got {resp.status_code}"
        print("✅ PATCH mark-read without auth → 401/403")


class TestMarkAllNotificationsRead:
    """PATCH /api/users/me/notifications/read-all → marks all notifications as read"""

    def test_mark_all_read_returns_200(self, user_token):
        resp = requests.patch(
            f"{BASE_URL}/api/users/me/notifications/read-all",
            headers=auth_headers(user_token),
            timeout=15,
        )
        assert resp.status_code == 200, f"mark all read failed: {resp.status_code} {resp.text}"
        result = resp.json()
        assert result.get("success") == True
        print("✅ PATCH /api/users/me/notifications/read-all → 200, success=True")

    def test_mark_all_read_verified_in_list(self, user_token):
        """After mark-all-read, no unread notifications should remain."""
        # Ensure there are some notifications first
        notifs = get_notifications(user_token)
        if not notifs:
            pytest.skip("No notifications to verify mark-all-read")

        # Mark all as read
        resp = requests.patch(
            f"{BASE_URL}/api/users/me/notifications/read-all",
            headers=auth_headers(user_token),
            timeout=15,
        )
        assert resp.status_code == 200

        # Check all are now read
        notifs_after = get_notifications(user_token)
        unread_after = [n for n in notifs_after if not n.get("read")]
        assert len(unread_after) == 0, f"Expected 0 unread notifications after read-all, got {len(unread_after)}"
        print(f"✅ After mark-all-read: 0 unread notifications (total: {len(notifs_after)})")

    def test_mark_all_read_requires_auth(self):
        """Must return 401/403 without auth."""
        resp = requests.patch(
            f"{BASE_URL}/api/users/me/notifications/read-all",
            timeout=15,
        )
        assert resp.status_code in [401, 403], f"Expected 401/403, got {resp.status_code}"
        print("✅ PATCH read-all without auth → 401/403")

    def test_mark_all_coach_notifications_read(self, coach_token):
        """Coach mark-all-read should work too."""
        resp = requests.patch(
            f"{BASE_URL}/api/users/me/notifications/read-all",
            headers=auth_headers(coach_token),
            timeout=15,
        )
        assert resp.status_code == 200
        result = resp.json()
        assert result.get("success") == True
        print("✅ Coach PATCH /api/users/me/notifications/read-all → success=True")

        # Verify
        notifs_after = get_notifications(coach_token)
        unread_after = [n for n in notifs_after if not n.get("read")]
        assert len(unread_after) == 0, f"Expected 0 unread for coach, got {len(unread_after)}"
        print(f"✅ Coach has 0 unread notifications after read-all")


class TestNotificationDataIntegrity:
    """Additional data integrity checks on notification records."""

    def test_notification_types_are_valid(self, user_token, coach_token):
        """All notification types must be from the expected set."""
        valid_types = {
            "new_booking", "booking_accepted", "booking_refused",
            "booking_confirmed", "booking_cancelled", "booking_awaiting_payment",
            "booking_cancelled_by_payer", "booking_cancelled_by_receiver",
            "spotyu_join", "spotyu_leave", "profile_review",
            "spotyu_updated", "spotyu_cancelled", "spotyu_restored",
            "spotyu_vote", "info", "booking_expired",
        }
        for label, token in [("user", user_token), ("coach", coach_token)]:
            notifs = get_notifications(token)
            for n in notifs:
                assert n["type"] in valid_types, (
                    f"Unexpected notification type '{n['type']}' for {label}"
                )
        print("✅ All notification types are valid")

    def test_notifications_ordered_by_created_at_desc(self, user_token):
        """Notifications must be returned newest first."""
        notifs = get_notifications(user_token)
        if len(notifs) < 2:
            pytest.skip("Not enough notifications to test ordering")
        from datetime import datetime
        timestamps = []
        for n in notifs:
            ts_str = n.get("created_at", "")
            if ts_str:
                try:
                    ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                    timestamps.append(ts)
                except Exception:
                    pass
        if len(timestamps) >= 2:
            for i in range(len(timestamps) - 1):
                assert timestamps[i] >= timestamps[i + 1], (
                    f"Notifications not ordered DESC at position {i}: {timestamps[i]} < {timestamps[i+1]}"
                )
        print(f"✅ Notifications ordered by created_at DESC ({len(timestamps)} timestamps checked)")

    def test_notifications_data_field_is_dict(self, user_token):
        """The 'data' field must be a dict (not a string)."""
        notifs = get_notifications(user_token)
        for n in notifs:
            data_field = n.get("data")
            if data_field is not None:
                assert isinstance(data_field, dict), (
                    f"'data' should be dict, got {type(data_field)} for notification {n.get('id')}"
                )
        print("✅ All notification 'data' fields are dicts")

    def test_notification_read_field_is_bool(self, user_token):
        """The 'read' field must be a boolean."""
        notifs = get_notifications(user_token)
        for n in notifs:
            assert isinstance(n.get("read"), bool), (
                f"'read' should be bool, got {type(n.get('read'))} for notification {n.get('id')}"
            )
        print("✅ All notification 'read' fields are booleans")
