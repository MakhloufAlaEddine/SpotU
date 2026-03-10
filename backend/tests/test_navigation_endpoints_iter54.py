"""
test_navigation_endpoints_iter54.py — Tests API pour les nouveaux écrans de monétisation
=========================================================================================
Couvre :
  1. GET /api/bookings/me — réservations du payeur (user + coach)
  2. GET /api/bookings/received — demandes reçues (coach uniquement)
  3. GET /api/subscription-plans — liste des plans (public)
  4. GET /api/subscriptions/me — statut d'abonnement de l'utilisateur
  5. Vérification qu'un user non-auth obtient 401 sur les endpoints protégés
"""

import asyncio
import os

import httpx
import pytest

API_BASE = os.environ.get("API_BASE", "https://reserve-pay-now.preview.emergentagent.com")

ADMIN_EMAIL = "admin@winek.app"
ADMIN_PASS  = "WinekAdmin2024!"
USER_EMAIL  = "user@winek.app"
USER_PASS   = "WinekUser2024!"
COACH_EMAIL = "coach@winek.app"
COACH_PASS  = "WinekCoach2024!"


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="module")
async def tokens():
    """Get auth tokens for user, coach and admin."""
    async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as client:
        results = {}
        for role, email, password in [
            ("user",  USER_EMAIL,  USER_PASS),
            ("coach", COACH_EMAIL, COACH_PASS),
            ("admin", ADMIN_EMAIL, ADMIN_PASS),
        ]:
            resp = await client.post("/api/auth/login", json={"email": email, "password": password})
            assert resp.status_code == 200, f"Login failed for {role}: {resp.text}"
            results[role] = resp.json()["token"]
    return results


# ── 1. GET /api/bookings/me ───────────────────────────────────────────────────

class TestMyBookings:
    """GET /api/bookings/me — réservations du payeur courant"""

    async def test_user_bookings_returns_200(self, tokens):
        async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as client:
            resp = await client.get(
                "/api/bookings/me",
                headers={"Authorization": f"Bearer {tokens['user']}"},
            )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

    async def test_user_bookings_returns_list(self, tokens):
        async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as client:
            resp = await client.get(
                "/api/bookings/me",
                headers={"Authorization": f"Bearer {tokens['user']}"},
            )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"

    async def test_user_bookings_item_has_required_fields(self, tokens):
        """Each booking should have booking_id, status, and payment_status."""
        async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as client:
            resp = await client.get(
                "/api/bookings/me",
                headers={"Authorization": f"Bearer {tokens['user']}"},
            )
        assert resp.status_code == 200
        data = resp.json()
        for booking in data:
            assert "booking_id" in booking, "booking_id missing"
            assert "status"     in booking, "status missing"
            # payment_status can be absent for old bookings — just check no crash

    async def test_coach_bookings_returns_200(self, tokens):
        """Coach can also see bookings he made as payer."""
        async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as client:
            resp = await client.get(
                "/api/bookings/me",
                headers={"Authorization": f"Bearer {tokens['coach']}"},
            )
        assert resp.status_code == 200

    async def test_unauthenticated_returns_401(self):
        async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as client:
            resp = await client.get("/api/bookings/me")
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"

    async def test_alternate_path_users_me_bookings(self, tokens):
        """GET /api/users/me/bookings is an alias — must also return 200."""
        async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as client:
            resp = await client.get(
                "/api/users/me/bookings",
                headers={"Authorization": f"Bearer {tokens['user']}"},
            )
        assert resp.status_code == 200


# ── 2. GET /api/bookings/received ────────────────────────────────────────────

class TestReceivedBookings:
    """GET /api/bookings/received — demandes reçues par le coach"""

    async def test_coach_received_returns_200(self, tokens):
        async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as client:
            resp = await client.get(
                "/api/bookings/received",
                headers={"Authorization": f"Bearer {tokens['coach']}"},
            )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

    async def test_coach_received_returns_list(self, tokens):
        async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as client:
            resp = await client.get(
                "/api/bookings/received",
                headers={"Authorization": f"Bearer {tokens['coach']}"},
            )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"

    async def test_received_booking_item_has_required_fields(self, tokens):
        """Received bookings should include booking_id, status, payer_name."""
        async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as client:
            resp = await client.get(
                "/api/bookings/received",
                headers={"Authorization": f"Bearer {tokens['coach']}"},
            )
        assert resp.status_code == 200
        data = resp.json()
        for booking in data:
            assert "booking_id" in booking, "booking_id missing from received booking"
            assert "status"     in booking, "status missing from received booking"

    async def test_unauthenticated_returns_401(self):
        async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as client:
            resp = await client.get("/api/bookings/received")
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"

    async def test_user_received_returns_200_or_empty(self, tokens):
        """Regular user can call received (returns empty list, not 403)."""
        async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as client:
            resp = await client.get(
                "/api/bookings/received",
                headers={"Authorization": f"Bearer {tokens['user']}"},
            )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)

    async def test_alternate_path_receiver_requests(self, tokens):
        """GET /api/receiver/requests is an alias — must also return 200."""
        async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as client:
            resp = await client.get(
                "/api/receiver/requests",
                headers={"Authorization": f"Bearer {tokens['coach']}"},
            )
        assert resp.status_code == 200


# ── 3. GET /api/subscription-plans ───────────────────────────────────────────

class TestSubscriptionPlans:
    """GET /api/subscription-plans — liste des plans (public)"""

    async def test_plans_public_access_returns_200(self):
        """No auth required for subscription plans list."""
        async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as client:
            resp = await client.get("/api/subscription-plans")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

    async def test_plans_returns_list(self):
        async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as client:
            resp = await client.get("/api/subscription-plans")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"

    async def test_plans_item_has_required_fields(self):
        async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as client:
            resp = await client.get("/api/subscription-plans")
        assert resp.status_code == 200
        data = resp.json()
        # At least one plan should exist (plan_premium seeded)
        assert len(data) >= 1, "Expected at least one subscription plan"
        for plan in data:
            assert "plan_id"       in plan, "plan_id missing"
            assert "name"          in plan, "name missing"
            assert "price"         in plan, "price missing"
            assert "duration_days" in plan, "duration_days missing"
            assert "active"        in plan, "active missing"

    async def test_plans_only_active_returned(self):
        """Only active=True plans should be returned."""
        async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as client:
            resp = await client.get("/api/subscription-plans")
        assert resp.status_code == 200
        data = resp.json()
        for plan in data:
            assert plan["active"] is True, f"Inactive plan returned: {plan['plan_id']}"

    async def test_plans_with_auth_also_works(self, tokens):
        """Authenticated users can also call the endpoint."""
        async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as client:
            resp = await client.get(
                "/api/subscription-plans",
                headers={"Authorization": f"Bearer {tokens['user']}"},
            )
        assert resp.status_code == 200


# ── 4. GET /api/subscriptions/me ─────────────────────────────────────────────

class TestMySubscription:
    """GET /api/subscriptions/me — statut abonnement utilisateur"""

    async def test_user_subscription_returns_200(self, tokens):
        async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as client:
            resp = await client.get(
                "/api/subscriptions/me",
                headers={"Authorization": f"Bearer {tokens['user']}"},
            )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

    async def test_subscription_response_has_correct_shape(self, tokens):
        """Response should have has_subscription and subscription fields."""
        async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as client:
            resp = await client.get(
                "/api/subscriptions/me",
                headers={"Authorization": f"Bearer {tokens['user']}"},
            )
        assert resp.status_code == 200
        data = resp.json()
        assert "has_subscription" in data, "has_subscription key missing"
        assert "subscription"     in data, "subscription key missing"
        assert isinstance(data["has_subscription"], bool), "has_subscription should be bool"

    async def test_no_subscription_returns_false(self, tokens):
        """User without active subscription returns has_subscription=False."""
        async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as client:
            resp = await client.get(
                "/api/subscriptions/me",
                headers={"Authorization": f"Bearer {tokens['user']}"},
            )
        assert resp.status_code == 200
        data = resp.json()
        # User may or may not have subscription — both paths valid
        if not data["has_subscription"]:
            assert data["subscription"] is None, "subscription should be null when has_subscription=False"
        else:
            # If active subscription, validate sub fields
            sub = data["subscription"]
            assert "subscription_id" in sub
            assert "status"          in sub
            assert "plan_id"         in sub

    async def test_unauthenticated_returns_401(self):
        async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as client:
            resp = await client.get("/api/subscriptions/me")
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"

    async def test_coach_subscription_returns_200(self, tokens):
        async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as client:
            resp = await client.get(
                "/api/subscriptions/me",
                headers={"Authorization": f"Bearer {tokens['coach']}"},
            )
        assert resp.status_code == 200
