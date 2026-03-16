"""
Tests E2E — Tous les endpoints API backend SpotU
=================================================
Teste chaque route HTTP en conditions réelles (pas de mocking).
"""
import pytest
import requests
import time
import os

import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from e2e_helpers import API_URL, get_token, auth_headers, CREDENTIALS

TIMEOUT = 15


# ═══════════════════════════════════════════════════════════════════════════════
#  AUTH
# ═══════════════════════════════════════════════════════════════════════════════

class TestAuth:

    def test_login_user(self):
        resp = requests.post(f"{API_URL}/api/auth/login", json=CREDENTIALS["user"], timeout=TIMEOUT)
        assert resp.status_code == 200
        data = resp.json()
        assert "token" in data
        assert "user" in data

    def test_login_coach(self):
        resp = requests.post(f"{API_URL}/api/auth/login", json=CREDENTIALS["coach"], timeout=TIMEOUT)
        assert resp.status_code == 200
        assert "token" in resp.json()

    def test_login_admin(self):
        resp = requests.post(f"{API_URL}/api/auth/login", json=CREDENTIALS["admin"], timeout=TIMEOUT)
        assert resp.status_code == 200
        assert "token" in resp.json()

    def test_login_wrong_password(self):
        resp = requests.post(
            f"{API_URL}/api/auth/login",
            json={"email": "user@winek.app", "password": "BadPass!"},
            timeout=TIMEOUT,
        )
        assert resp.status_code in (401, 400, 422)

    def test_login_nonexistent_email(self):
        resp = requests.post(
            f"{API_URL}/api/auth/login",
            json={"email": "nobody@nowhere.com", "password": "X"},
            timeout=TIMEOUT,
        )
        assert resp.status_code in (401, 400, 404, 422)

    def test_get_me_authenticated(self):
        h = auth_headers("user")
        resp = requests.get(f"{API_URL}/api/auth/me", headers=h, timeout=TIMEOUT)
        assert resp.status_code == 200
        data = resp.json()
        assert "user_id" in data
        assert data["email"] == "user@winek.app"

    def test_get_me_no_token(self):
        resp = requests.get(f"{API_URL}/api/auth/me", timeout=TIMEOUT)
        assert resp.status_code in (401, 403)

    def test_get_me_invalid_token(self):
        resp = requests.get(
            f"{API_URL}/api/auth/me",
            headers={"Authorization": "Bearer invalid_token_12345"},
            timeout=TIMEOUT,
        )
        assert resp.status_code in (401, 403)


# ═══════════════════════════════════════════════════════════════════════════════
#  USER PROFILE
# ═══════════════════════════════════════════════════════════════════════════════

class TestUserProfile:

    def test_get_own_profile(self):
        h = auth_headers("user")
        resp = requests.get(f"{API_URL}/api/users/profile", headers=h, timeout=TIMEOUT)
        assert resp.status_code == 200
        data = resp.json()
        assert "user_id" in data

    def test_get_coach_profile(self):
        h = auth_headers("coach")
        resp = requests.get(f"{API_URL}/api/users/profile", headers=h, timeout=TIMEOUT)
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("role") in ("coach", "admin")

    def test_get_public_profile(self):
        """Récupérer le profil public d'un utilisateur."""
        h = auth_headers("user")
        me = requests.get(f"{API_URL}/api/auth/me", headers=h, timeout=TIMEOUT).json()
        user_id = me["user_id"]
        resp = requests.get(f"{API_URL}/api/users/{user_id}/public", headers=h, timeout=TIMEOUT)
        assert resp.status_code == 200
        data = resp.json()
        assert "name" in data or "user_id" in data

    def test_get_user_reviews(self):
        """Récupérer les avis d'un utilisateur."""
        h = auth_headers("user")
        me = requests.get(f"{API_URL}/api/auth/me", headers=h, timeout=TIMEOUT).json()
        user_id = me["user_id"]
        resp = requests.get(f"{API_URL}/api/users/{user_id}/reviews", headers=h, timeout=TIMEOUT)
        assert resp.status_code == 200

    def test_activity_feed(self):
        h = auth_headers("user")
        resp = requests.get(f"{API_URL}/api/users/me/activity-feed", headers=h, timeout=TIMEOUT)
        assert resp.status_code == 200


# ═══════════════════════════════════════════════════════════════════════════════
#  CONFIG (PUBLIC)
# ═══════════════════════════════════════════════════════════════════════════════

class TestConfig:

    def test_booking_config(self):
        resp = requests.get(f"{API_URL}/api/config/booking", timeout=TIMEOUT)
        assert resp.status_code == 200
        data = resp.json()
        assert "pay_now_checkout_minutes" in data
        assert isinstance(data["pay_now_checkout_minutes"], int)

    def test_commission_config(self):
        resp = requests.get(f"{API_URL}/api/config/commission", timeout=TIMEOUT)
        assert resp.status_code == 200
        data = resp.json()
        assert "payer_percent_fee" in data
        assert "receiver_percent_fee" in data


# ═══════════════════════════════════════════════════════════════════════════════
#  DOMAINS & TAGS
# ═══════════════════════════════════════════════════════════════════════════════

class TestDomainsAndTags:

    def test_list_domains(self):
        h = auth_headers("user")
        resp = requests.get(f"{API_URL}/api/domains", headers=h, timeout=TIMEOUT)
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_list_tag_categories(self):
        h = auth_headers("user")
        resp = requests.get(f"{API_URL}/api/tags/categories", headers=h, timeout=TIMEOUT)
        assert resp.status_code == 200

    def test_list_tags(self):
        h = auth_headers("user")
        resp = requests.get(f"{API_URL}/api/tags", headers=h, timeout=TIMEOUT)
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)


# ═══════════════════════════════════════════════════════════════════════════════
#  HOME / FEED
# ═══════════════════════════════════════════════════════════════════════════════

class TestHomeFeed:

    def test_home_feed(self):
        h = auth_headers("user")
        resp = requests.get(
            f"{API_URL}/api/home/feed?lat=48.8566&lng=2.3522",
            headers=h, timeout=TIMEOUT,
        )
        assert resp.status_code == 200

    def test_nearest_sector(self):
        h = auth_headers("user")
        resp = requests.get(
            f"{API_URL}/api/home/nearest-sector?lat=48.8566&lng=2.3522",
            headers=h, timeout=TIMEOUT,
        )
        assert resp.status_code == 200


# ═══════════════════════════════════════════════════════════════════════════════
#  TAG POINTS (SPOTYOU)
# ═══════════════════════════════════════════════════════════════════════════════

class TestTagPoints:

    def test_list_tag_points(self):
        h = auth_headers("user")
        resp = requests.get(
            f"{API_URL}/api/tag-points?lat=48.8566&lng=2.3522&radius=50000",
            headers=h, timeout=TIMEOUT,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) > 0, "Au moins un SpotYou doit exister en seed"

    def test_list_my_tag_points(self):
        h = auth_headers("coach")
        resp = requests.get(f"{API_URL}/api/tag-points/mine", headers=h, timeout=TIMEOUT)
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_list_saved_tag_points(self):
        h = auth_headers("user")
        resp = requests.get(f"{API_URL}/api/tag-points/saved", headers=h, timeout=TIMEOUT)
        assert resp.status_code == 200

    def test_get_single_tag_point(self):
        h = auth_headers("user")
        resp = requests.get(
            f"{API_URL}/api/tag-points/pt_demo009",
            headers=h, timeout=TIMEOUT,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "point_id" in data or "title" in data

    def test_get_similar_tag_points(self):
        h = auth_headers("user")
        resp = requests.get(
            f"{API_URL}/api/tag-points/pt_demo009/similar",
            headers=h, timeout=TIMEOUT,
        )
        assert resp.status_code == 200

    def test_get_participants(self):
        h = auth_headers("user")
        resp = requests.get(
            f"{API_URL}/api/tag-points/pt_demo009/participants",
            headers=h, timeout=TIMEOUT,
        )
        assert resp.status_code == 200

    def test_get_votes(self):
        h = auth_headers("user")
        resp = requests.get(
            f"{API_URL}/api/tag-points/pt_demo009/votes",
            headers=h, timeout=TIMEOUT,
        )
        assert resp.status_code == 200

    def test_get_my_vote(self):
        h = auth_headers("user")
        resp = requests.get(
            f"{API_URL}/api/tag-points/pt_demo009/my-vote",
            headers=h, timeout=TIMEOUT,
        )
        assert resp.status_code == 200

    def test_create_and_get_tag_point(self):
        """Créer un SpotYou et vérifier qu'on peut le récupérer."""
        h = auth_headers("coach")
        ts = int(time.time())
        payload = {
            "title": f"E2E API Test {ts}",
            "description": "Test SpotYou créé par les tests E2E",
            "latitude": 48.8566,
            "longitude": 2.3522,
            "precision": "exact",
            "tag_ids": ["tag_10k"],
            "domain_id": "dom_coaching",
            "images": [],
        }
        resp = requests.post(f"{API_URL}/api/tag-points", json=payload, headers=h, timeout=TIMEOUT)
        assert resp.status_code == 200, f"Création échouée: {resp.text}"
        point_id = resp.json()["point_id"]

        # GET
        resp2 = requests.get(f"{API_URL}/api/tag-points/{point_id}", headers=h, timeout=TIMEOUT)
        assert resp2.status_code == 200
        assert resp2.json()["title"] == f"E2E API Test {ts}"

    def test_update_tag_point(self):
        """Créer puis mettre à jour un SpotYou."""
        h = auth_headers("coach")
        ts = int(time.time())
        resp = requests.post(
            f"{API_URL}/api/tag-points",
            json={
                "title": f"E2E Update {ts}",
                "description": "v1",
                "latitude": 48.85, "longitude": 2.35,
                "precision": "exact", "tag_ids": ["tag_10k"], "domain_id": "dom_coaching",
            },
            headers=h, timeout=TIMEOUT,
        )
        assert resp.status_code == 200
        pid = resp.json()["point_id"]

        resp2 = requests.put(
            f"{API_URL}/api/tag-points/{pid}",
            json={"description": "v2 updated"},
            headers=h, timeout=TIMEOUT,
        )
        assert resp2.status_code == 200

    def test_nonexistent_tag_point_404(self):
        h = auth_headers("user")
        resp = requests.get(
            f"{API_URL}/api/tag-points/pt_nonexistent_xyz",
            headers=h, timeout=TIMEOUT,
        )
        assert resp.status_code in (404, 422)


# ═══════════════════════════════════════════════════════════════════════════════
#  SPOTYOU ACTIONS (JOIN, LEAVE, GOING, VOTE, SAVE)
# ═══════════════════════════════════════════════════════════════════════════════

class TestSpotYouActions:

    def test_save_and_unsave(self):
        h = auth_headers("user")
        resp = requests.post(
            f"{API_URL}/api/tag-points/pt_demo009/save",
            headers=h, timeout=TIMEOUT,
        )
        assert resp.status_code in (200, 409), f"Save échoué: {resp.text}"

        resp2 = requests.delete(
            f"{API_URL}/api/tag-points/pt_demo009/unsave",
            headers=h, timeout=TIMEOUT,
        )
        assert resp2.status_code in (200, 404)

    def test_vote_on_spotyou(self):
        h = auth_headers("user")
        resp = requests.post(
            f"{API_URL}/api/tag-points/pt_demo009/vote",
            json={"rating": 4, "comment": "Test E2E vote"},
            headers=h, timeout=TIMEOUT,
        )
        assert resp.status_code in (200, 201, 409)

    def test_join_spotyou(self):
        """User rejoint un SpotYou récurrent."""
        h = auth_headers("user")
        resp = requests.post(
            f"{API_URL}/api/spot-you/pt_demo009/join",
            headers=h, timeout=TIMEOUT,
        )
        assert resp.status_code in (200, 409), f"Join échoué: {resp.text}"

    def test_going_spotyou(self):
        """User confirme sa participation à un événement SpotYou."""
        h = auth_headers("user")
        resp = requests.post(
            f"{API_URL}/api/spot-you/pt_demo013/going",
            headers=h, timeout=TIMEOUT,
        )
        assert resp.status_code in (200, 409), f"Going échoué: {resp.text}"

    def test_my_completion_stats(self):
        h = auth_headers("user")
        resp = requests.get(
            f"{API_URL}/api/spot-you/my-completion-stats",
            headers=h, timeout=TIMEOUT,
        )
        assert resp.status_code == 200


# ═══════════════════════════════════════════════════════════════════════════════
#  SERVICES
# ═══════════════════════════════════════════════════════════════════════════════

class TestServices:

    def test_list_services(self):
        h = auth_headers("user")
        resp = requests.get(f"{API_URL}/api/services", headers=h, timeout=TIMEOUT)
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_list_my_services(self):
        h = auth_headers("coach")
        resp = requests.get(f"{API_URL}/api/services/mine", headers=h, timeout=TIMEOUT)
        assert resp.status_code == 200

    def test_list_saved_services(self):
        h = auth_headers("user")
        resp = requests.get(f"{API_URL}/api/services/saved", headers=h, timeout=TIMEOUT)
        assert resp.status_code == 200

    def test_create_and_get_service(self):
        h = auth_headers("coach")
        ts = int(time.time())
        payload = {
            "title": f"E2E Service {ts}",
            "description": "Service test E2E",
            "address": "Paris, France",
            "price": 50.0,
            "duration_min": 60,
            "tag_ids": [],
            "domain_id": None,
            "max_participants": 5,
            "images": [],
            "locations": [{"latitude": 48.8566, "longitude": 2.3522, "precision": "exact", "description": "Paris"}],
            "slots": [],
            "packages": [],
        }
        resp = requests.post(f"{API_URL}/api/services", json=payload, headers=h, timeout=TIMEOUT)
        assert resp.status_code == 200, f"Création service échouée: {resp.text}"
        service_id = resp.json()["service_id"]

        resp2 = requests.get(f"{API_URL}/api/services/{service_id}", headers=h, timeout=TIMEOUT)
        assert resp2.status_code == 200
        assert resp2.json()["title"] == f"E2E Service {ts}"

    def test_nonexistent_service_404(self):
        h = auth_headers("user")
        resp = requests.get(f"{API_URL}/api/services/svc_nonexistent_xyz", headers=h, timeout=TIMEOUT)
        assert resp.status_code in (404, 422)


# ═══════════════════════════════════════════════════════════════════════════════
#  BOOKINGS
# ═══════════════════════════════════════════════════════════════════════════════

class TestBookings:

    def test_list_my_bookings(self):
        h = auth_headers("user")
        resp = requests.get(f"{API_URL}/api/bookings/me", headers=h, timeout=TIMEOUT)
        assert resp.status_code == 200

    def test_list_received_bookings(self):
        h = auth_headers("coach")
        resp = requests.get(f"{API_URL}/api/bookings/received", headers=h, timeout=TIMEOUT)
        assert resp.status_code == 200

    def test_price_preview(self):
        """Tester le calcul d'aperçu des prix."""
        h = auth_headers("user")
        # Récupérer un service existant
        services = requests.get(f"{API_URL}/api/services", headers=h, timeout=TIMEOUT).json()
        if not services:
            pytest.skip("Aucun service disponible pour le test de prix")
        service_id = services[0]["service_id"]
        payload = {
            "service_id": service_id,
            "quantity": 1,
        }
        resp = requests.post(
            f"{API_URL}/api/bookings/price-preview",
            json=payload, headers=h, timeout=TIMEOUT,
        )
        assert resp.status_code in (200, 422), f"Price preview: {resp.text}"
        if resp.status_code == 200:
            data = resp.json()
            assert "payer_total_amount" in data or "base_amount" in data

    def test_nonexistent_booking_404(self):
        h = auth_headers("user")
        resp = requests.get(
            f"{API_URL}/api/bookings/bk_nonexistent_xyz",
            headers=h, timeout=TIMEOUT,
        )
        assert resp.status_code in (404, 422, 403)


# ═══════════════════════════════════════════════════════════════════════════════
#  CHAT & CONVERSATIONS
# ═══════════════════════════════════════════════════════════════════════════════

class TestChat:

    def test_list_conversations(self):
        h = auth_headers("user")
        resp = requests.get(f"{API_URL}/api/conversations", headers=h, timeout=TIMEOUT)
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_coach_conversations(self):
        h = auth_headers("coach")
        resp = requests.get(f"{API_URL}/api/conversations", headers=h, timeout=TIMEOUT)
        assert resp.status_code == 200

    def test_create_conversation(self):
        """Créer une conversation (type tagpoint_private avec un context_id)."""
        h_user = auth_headers("user")
        # Use an existing tagpoint as context
        resp = requests.post(
            f"{API_URL}/api/conversations",
            json={"type": "tagpoint_private", "context_id": "pt_demo009"},
            headers=h_user, timeout=TIMEOUT,
        )
        assert resp.status_code in (200, 201, 409), f"Création conversation: {resp.status_code} {resp.text}"
        if resp.status_code in (200, 201):
            data = resp.json()
            assert "conv_id" in data or "conversation_id" in data

    def test_get_messages_for_conversation(self):
        """Récupérer les messages d'une conversation existante."""
        h = auth_headers("user")
        convs = requests.get(f"{API_URL}/api/conversations", headers=h, timeout=TIMEOUT).json()
        if not convs:
            pytest.skip("Aucune conversation disponible")
        conv_id = convs[0].get("conv_id") or convs[0].get("conversation_id")
        resp = requests.get(
            f"{API_URL}/api/conversations/{conv_id}/messages",
            headers=h, timeout=TIMEOUT,
        )
        assert resp.status_code == 200


# ═══════════════════════════════════════════════════════════════════════════════
#  NOTIFICATIONS
# ═══════════════════════════════════════════════════════════════════════════════

class TestNotifications:

    def test_list_notifications(self):
        h = auth_headers("user")
        resp = requests.get(f"{API_URL}/api/users/me/notifications", headers=h, timeout=TIMEOUT)
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_mark_all_read(self):
        h = auth_headers("user")
        resp = requests.patch(
            f"{API_URL}/api/users/me/notifications/read-all",
            headers=h, timeout=TIMEOUT,
        )
        assert resp.status_code == 200


# ═══════════════════════════════════════════════════════════════════════════════
#  EVENTS & PLANNING
# ═══════════════════════════════════════════════════════════════════════════════

class TestEventsAndPlanning:

    def test_list_events(self):
        h = auth_headers("user")
        resp = requests.get(f"{API_URL}/api/users/me/events", headers=h, timeout=TIMEOUT)
        assert resp.status_code == 200

    def test_planning_events(self):
        h = auth_headers("user")
        resp = requests.get(f"{API_URL}/api/users/me/planning-events", headers=h, timeout=TIMEOUT)
        assert resp.status_code == 200


# ═══════════════════════════════════════════════════════════════════════════════
#  UPLOAD
# ═══════════════════════════════════════════════════════════════════════════════

class TestUpload:

    # JPEG minimal valide
    JPEG_BYTES = bytes([
        0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
        0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43,
        0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
        0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12,
        0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A, 0x1C, 0x1C, 0x20,
        0x24, 0x2E, 0x27, 0x20, 0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29,
        0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27, 0x39, 0x3D, 0x38, 0x32,
        0x3C, 0x2E, 0x33, 0x34, 0x32, 0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01,
        0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xFF, 0xC4, 0x00, 0x1F, 0x00, 0x00,
        0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
        0x09, 0x0A, 0x0B, 0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F,
        0x00, 0xFB, 0xD2, 0x8A, 0x28, 0x03, 0xFF, 0xD9,
    ])

    def test_upload_requires_auth(self):
        resp = requests.post(
            f"{API_URL}/api/upload-image",
            files={"file": ("test.jpg", self.JPEG_BYTES, "image/jpeg")},
            timeout=TIMEOUT,
        )
        assert resp.status_code in (401, 403, 422)

    def test_upload_jpeg(self):
        token = get_token("user")
        resp = requests.post(
            f"{API_URL}/api/upload-image",
            headers={"Authorization": f"Bearer {token}"},
            files={"file": ("test.jpg", self.JPEG_BYTES, "image/jpeg")},
            timeout=TIMEOUT,
        )
        assert resp.status_code == 200
        assert "url" in resp.json()

    def test_upload_rejects_text_file(self):
        token = get_token("user")
        resp = requests.post(
            f"{API_URL}/api/upload-image",
            headers={"Authorization": f"Bearer {token}"},
            files={"file": ("test.txt", b"not an image", "text/plain")},
            timeout=TIMEOUT,
        )
        assert resp.status_code == 415


# ═══════════════════════════════════════════════════════════════════════════════
#  PAYMENTS
# ═══════════════════════════════════════════════════════════════════════════════

class TestPayments:

    def test_list_my_payments(self):
        h = auth_headers("user")
        resp = requests.get(f"{API_URL}/api/payments/me", headers=h, timeout=TIMEOUT)
        assert resp.status_code == 200

    def test_checkout_status_nonexistent(self):
        """Le statut d'une session inexistante retourne 404."""
        resp = requests.get(
            f"{API_URL}/api/payments/checkout/status/cs_nonexistent_xyz",
            timeout=TIMEOUT,
        )
        assert resp.status_code in (404, 422, 400)


# ═══════════════════════════════════════════════════════════════════════════════
#  SUBSCRIPTIONS
# ═══════════════════════════════════════════════════════════════════════════════

class TestSubscriptions:

    def test_list_subscription_plans(self):
        h = auth_headers("user")
        resp = requests.get(f"{API_URL}/api/subscription-plans", headers=h, timeout=TIMEOUT)
        assert resp.status_code == 200

    def test_my_subscriptions(self):
        h = auth_headers("user")
        resp = requests.get(f"{API_URL}/api/subscriptions/me", headers=h, timeout=TIMEOUT)
        assert resp.status_code == 200

    def test_subscription_history(self):
        h = auth_headers("user")
        resp = requests.get(f"{API_URL}/api/subscriptions/history", headers=h, timeout=TIMEOUT)
        assert resp.status_code == 200


# ═══════════════════════════════════════════════════════════════════════════════
#  ADMIN
# ═══════════════════════════════════════════════════════════════════════════════

class TestAdmin:

    def test_admin_stats(self):
        h = auth_headers("admin")
        resp = requests.get(f"{API_URL}/api/admin/stats", headers=h, timeout=TIMEOUT)
        assert resp.status_code == 200

    def test_admin_users_list(self):
        h = auth_headers("admin")
        resp = requests.get(f"{API_URL}/api/admin/users", headers=h, timeout=TIMEOUT)
        assert resp.status_code == 200

    def test_admin_tag_points(self):
        h = auth_headers("admin")
        resp = requests.get(f"{API_URL}/api/admin/tag-points", headers=h, timeout=TIMEOUT)
        assert resp.status_code == 200

    def test_non_admin_forbidden(self):
        """Un user normal ne doit pas accéder aux endpoints admin."""
        h = auth_headers("user")
        resp = requests.get(f"{API_URL}/api/admin/stats", headers=h, timeout=TIMEOUT)
        assert resp.status_code in (401, 403, 404)

    def test_admin_subscription_plans(self):
        h = auth_headers("admin")
        resp = requests.get(f"{API_URL}/api/admin/subscription-plans", headers=h, timeout=TIMEOUT)
        assert resp.status_code == 200


# ═══════════════════════════════════════════════════════════════════════════════
#  ADDRESSES
# ═══════════════════════════════════════════════════════════════════════════════

class TestAddresses:

    def test_list_addresses(self):
        h = auth_headers("user")
        resp = requests.get(f"{API_URL}/api/addresses", headers=h, timeout=TIMEOUT)
        assert resp.status_code == 200

    def test_crud_address(self):
        h = auth_headers("user")
        ts = int(time.time())
        # Create (API uses lat/lng, not latitude/longitude)
        payload = {
            "label": f"E2E Addr {ts}",
            "address": "10 Rue de Rivoli, Paris",
            "lat": 48.856,
            "lng": 2.352,
        }
        resp = requests.post(f"{API_URL}/api/addresses", json=payload, headers=h, timeout=TIMEOUT)
        assert resp.status_code in (200, 201), f"Création adresse: {resp.text}"
        data = resp.json()
        addr_id = data.get("address_id") or data.get("id")

        if addr_id:
            # Update
            resp2 = requests.put(
                f"{API_URL}/api/addresses/{addr_id}",
                json={"label": f"E2E Addr Updated {ts}", "address": "10 Rue de Rivoli, Paris", "lat": 48.856, "lng": 2.352},
                headers=h, timeout=TIMEOUT,
            )
            assert resp2.status_code == 200

            # Delete
            resp3 = requests.delete(f"{API_URL}/api/addresses/{addr_id}", headers=h, timeout=TIMEOUT)
            assert resp3.status_code in (200, 204)


# ═══════════════════════════════════════════════════════════════════════════════
#  FOLLOW
# ═══════════════════════════════════════════════════════════════════════════════

class TestFollow:

    def test_follow_and_unfollow(self):
        h_user = auth_headers("user")
        h_coach = auth_headers("coach")
        coach = requests.get(f"{API_URL}/api/auth/me", headers=h_coach, timeout=TIMEOUT).json()
        coach_id = coach["user_id"]

        # Follow
        resp = requests.post(f"{API_URL}/api/users/{coach_id}/follow", headers=h_user, timeout=TIMEOUT)
        assert resp.status_code in (200, 201, 409)

        # Check followers
        resp2 = requests.get(f"{API_URL}/api/users/{coach_id}/followers", headers=h_user, timeout=TIMEOUT)
        assert resp2.status_code == 200

        # Check following
        me = requests.get(f"{API_URL}/api/auth/me", headers=h_user, timeout=TIMEOUT).json()
        resp3 = requests.get(f"{API_URL}/api/users/{me['user_id']}/following", headers=h_user, timeout=TIMEOUT)
        assert resp3.status_code == 200

        # Unfollow
        resp4 = requests.delete(f"{API_URL}/api/users/{coach_id}/follow", headers=h_user, timeout=TIMEOUT)
        assert resp4.status_code in (200, 204, 404)


# ═══════════════════════════════════════════════════════════════════════════════
#  PUSH TOKEN
# ═══════════════════════════════════════════════════════════════════════════════

class TestPushToken:

    def test_register_push_token(self):
        h = auth_headers("user")
        resp = requests.post(
            f"{API_URL}/api/users/push-token",
            json={"token": "ExponentPushToken[e2e_test_token_12345]"},
            headers=h, timeout=TIMEOUT,
        )
        assert resp.status_code in (200, 201)

    def test_delete_push_token(self):
        h = auth_headers("user")
        resp = requests.delete(
            f"{API_URL}/api/users/push-token",
            json={"token": "ExponentPushToken[e2e_test_token_12345]"},
            headers=h, timeout=TIMEOUT,
        )
        assert resp.status_code in (200, 204, 404)


# ═══════════════════════════════════════════════════════════════════════════════
#  SUGGESTIONS
# ═══════════════════════════════════════════════════════════════════════════════

class TestSuggestions:

    def test_get_suggestions(self):
        h = auth_headers("user")
        me = requests.get(f"{API_URL}/api/auth/me", headers=h, timeout=TIMEOUT).json()
        resp = requests.get(
            f"{API_URL}/api/users/{me['user_id']}/suggestions",
            headers=h, timeout=TIMEOUT,
        )
        assert resp.status_code == 200


# ═══════════════════════════════════════════════════════════════════════════════
#  RESPONSE TIME
# ═══════════════════════════════════════════════════════════════════════════════

class TestPerformance:

    def test_auth_me_under_3s(self):
        h = auth_headers("user")
        start = time.time()
        resp = requests.get(f"{API_URL}/api/auth/me", headers=h, timeout=TIMEOUT)
        elapsed = time.time() - start
        assert resp.status_code == 200
        assert elapsed < 3.0, f"/auth/me trop lent: {elapsed:.2f}s"

    def test_tag_points_under_5s(self):
        h = auth_headers("user")
        start = time.time()
        resp = requests.get(
            f"{API_URL}/api/tag-points?lat=48.8566&lng=2.3522&radius=50000",
            headers=h, timeout=TIMEOUT,
        )
        elapsed = time.time() - start
        assert resp.status_code == 200
        assert elapsed < 5.0, f"/tag-points trop lent: {elapsed:.2f}s"

    def test_home_feed_under_5s(self):
        h = auth_headers("user")
        start = time.time()
        resp = requests.get(
            f"{API_URL}/api/home/feed?lat=48.8566&lng=2.3522",
            headers=h, timeout=TIMEOUT,
        )
        elapsed = time.time() - start
        assert resp.status_code == 200
        assert elapsed < 5.0, f"/home/feed trop lent: {elapsed:.2f}s"

    def test_config_endpoints_under_2s(self):
        start = time.time()
        resp = requests.get(f"{API_URL}/api/config/booking", timeout=TIMEOUT)
        elapsed = time.time() - start
        assert resp.status_code == 200
        assert elapsed < 2.0, f"/config/booking trop lent: {elapsed:.2f}s"
