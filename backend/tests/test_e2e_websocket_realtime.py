"""
test_e2e_websocket_realtime.py — Tests E2E WebSocket temps réel SpotU
======================================================================
Teste les scénarios multi-utilisateurs en temps réel :
  1. SpotYou WebSocket : join → broadcast, going → broadcast
  2. Chat WebSocket : envoi message → réception temps réel
  3. Notification WebSocket : connexion + réception compteur non-lu
  4. Handshake sécurisé (auth via JSON {token})
  5. Rejet sans token valide

Utilise websockets + httpx pour orchestrer les tests.
"""

import os
import pytest
import httpx
import asyncio
import json
import uuid

try:
    import websockets
except ImportError:
    websockets = None

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
WS_URL = BASE_URL.replace("https://", "wss://").replace("http://", "ws://")

ADMIN_EMAIL = "admin@winek.app"
ADMIN_PASS = "WinekAdmin2024!"
COACH_EMAIL = "coach@winek.app"
COACH_PASS = "WinekCoach2024!"
USER_EMAIL = "user@winek.app"
USER_PASS = "WinekUser2024!"


def _login(email: str, password: str) -> dict:
    r = httpx.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": email, "password": password},
        timeout=15,
    )
    assert r.status_code == 200
    return r.json()


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ═══════════════════════════════════════════════════════════════════════════════
# Fixtures
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.fixture(scope="module")
def coach_auth():
    return _login(COACH_EMAIL, COACH_PASS)


@pytest.fixture(scope="module")
def user_auth():
    return _login(USER_EMAIL, USER_PASS)


@pytest.fixture(scope="module")
def second_user():
    """Register a second test user for multi-user scenarios."""
    unique = uuid.uuid4().hex[:8]
    email = f"ws_user2_{unique}@test.com"
    r = httpx.post(
        f"{BASE_URL}/api/auth/register",
        json={"email": email, "password": "TestPass123!", "name": f"WS User2 {unique}", "language": "fr"},
        timeout=15,
    )
    assert r.status_code == 200
    return r.json()


@pytest.fixture(scope="module")
def spotyou_for_ws(coach_auth):
    """Create a SpotYou for WebSocket testing."""
    from datetime import datetime
    r = httpx.get(f"{BASE_URL}/api/tags", timeout=15)
    tags = r.json()
    tag_id = tags[0]["tag_id"] if tags else "tag_test"

    r2 = httpx.post(
        f"{BASE_URL}/api/tag-points",
        json={
            "title": f"WS Test SpotYou {uuid.uuid4().hex[:6]}",
            "description": "For WebSocket E2E tests",
            "latitude": 48.88,
            "longitude": 2.33,
            "precision": "exact",
            "tag_ids": [tag_id],
            "event_schedule": {
                "type": "weekly",
                "schedule": {
                    str(datetime.now().weekday()): [{"start": "08:00", "end": "09:00"}],
                    str((datetime.now().weekday() + 1) % 7): [{"start": "10:00", "end": "11:00"}],
                }
            },
            "maximum_participants": 10,
        },
        headers=_headers(coach_auth["token"]),
        timeout=15,
    )
    assert r2.status_code == 200
    return r2.json()


# ═══════════════════════════════════════════════════════════════════════════════
# 1. SPOTYOU WEBSOCKET — Mises à jour temps réel
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.skipif(websockets is None, reason="websockets not installed")
class TestSpotYouWebSocket:

    @pytest.mark.asyncio
    async def test_spotyou_ws_auth_and_join_broadcast(self, spotyou_for_ws, coach_auth, user_auth):
        """
        Scénario multi-utilisateur :
        1. Coach se connecte au WS SpotYou
        2. User rejoint le SpotYou via HTTP
        3. Coach reçoit le broadcast spotyou_update via WS
        """
        point_id = spotyou_for_ws["point_id"]
        coach_token = coach_auth["token"]
        user_token = user_auth["token"]

        received_messages = []

        async def listen_ws():
            async with websockets.connect(
                f"{WS_URL}/api/ws/spot-you/{point_id}",
                additional_headers={},
                open_timeout=10,
                close_timeout=5,
            ) as ws:
                # Send auth token
                await ws.send(json.dumps({"token": coach_token}))
                # Listen for messages with timeout
                try:
                    while True:
                        msg = await asyncio.wait_for(ws.recv(), timeout=8)
                        data = json.loads(msg)
                        received_messages.append(data)
                        if data.get("type") == "spotyou_update":
                            break
                except asyncio.TimeoutError:
                    pass

        # Start WebSocket listener
        ws_task = asyncio.create_task(listen_ws())

        # Wait for WS to connect
        await asyncio.sleep(1)

        # User joins SpotYou via HTTP
        r = httpx.post(
            f"{BASE_URL}/api/spot-you/{point_id}/join",
            headers=_headers(user_token),
            timeout=15,
        )
        assert r.status_code == 200

        # Wait for WS to receive broadcast
        await asyncio.sleep(3)

        try:
            await asyncio.wait_for(ws_task, timeout=5)
        except asyncio.TimeoutError:
            pass

        # Verify broadcast received
        updates = [m for m in received_messages if m.get("type") == "spotyou_update"]
        assert len(updates) >= 1, f"Expected spotyou_update broadcast, got: {received_messages}"
        assert updates[0]["point_id"] == point_id
        assert "participants_count" in updates[0]

        # Cleanup: user leaves
        httpx.delete(
            f"{BASE_URL}/api/spot-you/{point_id}/leave",
            headers=_headers(user_token),
            timeout=15,
        )

    @pytest.mark.asyncio
    async def test_spotyou_ws_going_broadcast(self, spotyou_for_ws, coach_auth, user_auth):
        """
        Scénario :
        1. User rejoint d'abord le SpotYou
        2. Coach écoute le WS
        3. User indique sa présence (going)
        4. Coach reçoit going_count mis à jour
        """
        point_id = spotyou_for_ws["point_id"]
        coach_token = coach_auth["token"]
        user_token = user_auth["token"]

        # User joins first
        httpx.post(
            f"{BASE_URL}/api/spot-you/{point_id}/join",
            headers=_headers(user_token),
            timeout=15,
        )

        received_messages = []

        async def listen_ws():
            async with websockets.connect(
                f"{WS_URL}/api/ws/spot-you/{point_id}",
                open_timeout=10,
                close_timeout=5,
            ) as ws:
                await ws.send(json.dumps({"token": coach_token}))
                try:
                    while True:
                        msg = await asyncio.wait_for(ws.recv(), timeout=8)
                        data = json.loads(msg)
                        received_messages.append(data)
                        if data.get("type") == "spotyou_update" and "going_count" in data:
                            break
                except asyncio.TimeoutError:
                    pass

        ws_task = asyncio.create_task(listen_ws())
        await asyncio.sleep(1)

        # User marks going
        r = httpx.post(
            f"{BASE_URL}/api/spot-you/{point_id}/going",
            headers=_headers(user_token),
            timeout=15,
        )
        assert r.status_code == 200

        await asyncio.sleep(3)

        try:
            await asyncio.wait_for(ws_task, timeout=5)
        except asyncio.TimeoutError:
            pass

        updates = [m for m in received_messages if m.get("type") == "spotyou_update"]
        assert len(updates) >= 1, f"Expected going broadcast, got: {received_messages}"
        assert "going_count" in updates[0]

        # Cleanup
        httpx.delete(f"{BASE_URL}/api/spot-you/{point_id}/going", headers=_headers(user_token), timeout=15)
        httpx.delete(f"{BASE_URL}/api/spot-you/{point_id}/leave", headers=_headers(user_token), timeout=15)

    @pytest.mark.asyncio
    async def test_spotyou_ws_invalid_token(self, spotyou_for_ws):
        """Invalid token should close connection with code 4001."""
        point_id = spotyou_for_ws["point_id"]
        try:
            async with websockets.connect(
                f"{WS_URL}/api/ws/spot-you/{point_id}",
                open_timeout=10,
                close_timeout=5,
            ) as ws:
                await ws.send(json.dumps({"token": "invalid_token_xyz"}))
                # Server should close the connection
                try:
                    await asyncio.wait_for(ws.recv(), timeout=5)
                except websockets.ConnectionClosed as e:
                    assert e.code == 4001
                    return
            # If we get here, connection was closed normally
        except websockets.ConnectionClosed as e:
            assert e.code == 4001


# ═══════════════════════════════════════════════════════════════════════════════
# 2. CHAT WEBSOCKET
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.skipif(websockets is None, reason="websockets not installed")
class TestChatWebSocket:

    @pytest.mark.asyncio
    async def test_chat_ws_send_receive(self, coach_auth, user_auth):
        """
        Scénario multi-utilisateur chat :
        1. User crée une conversation service avec le coach
        2. User se connecte au WS chat
        3. Coach se connecte au WS chat
        4. User envoie un message via WS
        5. Coach reçoit le message en temps réel
        """
        # Get a service from coach
        r = httpx.get(
            f"{BASE_URL}/api/services/mine",
            headers=_headers(coach_auth["token"]),
            timeout=15,
        )
        services = r.json()
        if not services:
            pytest.skip("No services available for chat test")

        sid = services[0]["service_id"]

        # Create conversation
        r2 = httpx.post(
            f"{BASE_URL}/api/conversations",
            json={"type": "service", "context_id": sid},
            headers=_headers(user_auth["token"]),
            timeout=15,
        )
        conv_id = r2.json()["conversation_id"]

        coach_received = []
        test_content = f"E2E test message {uuid.uuid4().hex[:8]}"

        async def coach_listener():
            async with websockets.connect(
                f"{WS_URL}/api/ws/chat/{conv_id}",
                open_timeout=10,
                close_timeout=5,
            ) as ws:
                await ws.send(json.dumps({"token": coach_auth["token"]}))
                try:
                    while True:
                        msg = await asyncio.wait_for(ws.recv(), timeout=8)
                        data = json.loads(msg)
                        coach_received.append(data)
                        if data.get("content") == test_content:
                            break
                except asyncio.TimeoutError:
                    pass

        # Start coach listener
        listener_task = asyncio.create_task(coach_listener())
        await asyncio.sleep(1)

        # User sends message
        async with websockets.connect(
            f"{WS_URL}/api/ws/chat/{conv_id}",
            open_timeout=10,
            close_timeout=5,
        ) as user_ws:
            await user_ws.send(json.dumps({"token": user_auth["token"]}))
            await asyncio.sleep(0.5)
            await user_ws.send(json.dumps({"content": test_content}))

        # Wait for coach to receive
        await asyncio.sleep(3)
        try:
            await asyncio.wait_for(listener_task, timeout=5)
        except asyncio.TimeoutError:
            pass

        # Verify coach received the message
        matching = [m for m in coach_received if m.get("content") == test_content]
        assert len(matching) >= 1, f"Coach should have received the message. Got: {coach_received}"
        assert matching[0]["sender_id"] == user_auth["user"]["user_id"]

    @pytest.mark.asyncio
    async def test_chat_ws_non_member_rejected(self, coach_auth, second_user):
        """Non-participant should be rejected (code 4003)."""
        # Get a service and create conv between coach and user
        r = httpx.get(
            f"{BASE_URL}/api/services/mine",
            headers=_headers(coach_auth["token"]),
            timeout=15,
        )
        services = r.json()
        if not services:
            pytest.skip("No services available")

        sid = services[0]["service_id"]
        r2 = httpx.post(
            f"{BASE_URL}/api/conversations",
            json={"type": "service", "context_id": sid},
            headers=_headers(coach_auth["token"]),
            timeout=15,
        )
        conv_id = r2.json()["conversation_id"]

        # Second user (not a participant) tries to connect
        try:
            async with websockets.connect(
                f"{WS_URL}/api/ws/chat/{conv_id}",
                open_timeout=10,
                close_timeout=5,
            ) as ws:
                await ws.send(json.dumps({"token": second_user["token"]}))
                try:
                    await asyncio.wait_for(ws.recv(), timeout=5)
                except websockets.ConnectionClosed as e:
                    assert e.code == 4003
                    return
        except websockets.ConnectionClosed as e:
            assert e.code == 4003


# ═══════════════════════════════════════════════════════════════════════════════
# 3. NOTIFICATION WEBSOCKET
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.skipif(websockets is None, reason="websockets not installed")
class TestNotificationWebSocket:

    @pytest.mark.asyncio
    async def test_notif_ws_receives_initial_counts(self, user_auth):
        """
        After auth, the notification WS should send initial unread counts:
        - unread_total
        - unread_notif
        """
        received = []

        async with websockets.connect(
            f"{WS_URL}/api/ws/notifications",
            open_timeout=10,
            close_timeout=5,
        ) as ws:
            await ws.send(json.dumps({"token": user_auth["token"]}))
            try:
                for _ in range(3):
                    msg = await asyncio.wait_for(ws.recv(), timeout=5)
                    data = json.loads(msg)
                    received.append(data)
            except asyncio.TimeoutError:
                pass

        types = [m.get("type") for m in received]
        assert "unread_total" in types, f"Expected unread_total in initial messages, got: {types}"
        assert "unread_notif" in types, f"Expected unread_notif in initial messages, got: {types}"

    @pytest.mark.asyncio
    async def test_notif_ws_invalid_token(self):
        """Invalid token should close with 4001."""
        try:
            async with websockets.connect(
                f"{WS_URL}/api/ws/notifications",
                open_timeout=10,
                close_timeout=5,
            ) as ws:
                await ws.send(json.dumps({"token": "bad_token"}))
                try:
                    await asyncio.wait_for(ws.recv(), timeout=5)
                except websockets.ConnectionClosed as e:
                    assert e.code == 4001
                    return
        except websockets.ConnectionClosed as e:
            assert e.code == 4001


# ═══════════════════════════════════════════════════════════════════════════════
# 4. PULL-TO-REFRESH SIMULATION (API idempotency)
# ═══════════════════════════════════════════════════════════════════════════════

class TestPullToRefresh:
    """
    Simulates pull-to-refresh by calling the same GET endpoints multiple times
    and verifying consistent results (idempotent reads).
    """

    def test_refresh_home_feed(self, user_auth):
        h = _headers(user_auth["token"])
        params = {"lat": 48.8566, "lng": 2.3522}
        r1 = httpx.get(f"{BASE_URL}/api/home/feed", params=params, headers=h, timeout=15)
        r2 = httpx.get(f"{BASE_URL}/api/home/feed", params=params, headers=h, timeout=15)
        assert r1.status_code == 200
        assert r2.status_code == 200
        assert r1.json()["total_count"] == r2.json()["total_count"]

    def test_refresh_my_bookings(self, user_auth):
        h = _headers(user_auth["token"])
        r1 = httpx.get(f"{BASE_URL}/api/bookings/me", headers=h, timeout=15)
        r2 = httpx.get(f"{BASE_URL}/api/bookings/me", headers=h, timeout=15)
        assert r1.status_code == 200
        assert r2.status_code == 200
        assert len(r1.json()) == len(r2.json())

    def test_refresh_tag_points(self, user_auth):
        h = _headers(user_auth["token"])
        params = {"lat": 48.8566, "lng": 2.3522, "radius": 50000}
        r1 = httpx.get(f"{BASE_URL}/api/tag-points", params=params, headers=h, timeout=15)
        r2 = httpx.get(f"{BASE_URL}/api/tag-points", params=params, headers=h, timeout=15)
        assert r1.status_code == 200
        assert r2.status_code == 200
        assert len(r1.json()) == len(r2.json())

    def test_refresh_conversations(self, user_auth):
        h = _headers(user_auth["token"])
        r1 = httpx.get(f"{BASE_URL}/api/conversations", headers=h, timeout=15)
        r2 = httpx.get(f"{BASE_URL}/api/conversations", headers=h, timeout=15)
        assert r1.status_code == 200
        assert r2.status_code == 200
        assert len(r1.json()) == len(r2.json())

    def test_refresh_notifications(self, user_auth):
        h = _headers(user_auth["token"])
        r1 = httpx.get(f"{BASE_URL}/api/users/me/notifications", headers=h, timeout=15)
        r2 = httpx.get(f"{BASE_URL}/api/users/me/notifications", headers=h, timeout=15)
        assert r1.status_code == 200
        assert r2.status_code == 200
        assert len(r1.json()) == len(r2.json())

    def test_refresh_services(self):
        params = {"lat": 48.8566, "lng": 2.3522}
        r1 = httpx.get(f"{BASE_URL}/api/services", params=params, timeout=15)
        r2 = httpx.get(f"{BASE_URL}/api/services", params=params, timeout=15)
        assert r1.status_code == 200
        assert r2.status_code == 200
        assert len(r1.json()) == len(r2.json())
