"""
test_e2e_websocket_spotyou.py
=============================
Tests E2E WebSocket temps réel pour SpotYou :
  1. User A se connecte au WS d'un SpotYou
  2. User B rejoint / participe / quitte
  3. Vérifie que User A reçoit les mises à jour en temps réel via WebSocket

Tests couverts :
  - JOIN : User B rejoint → User A reçoit spotyou_update avec nouveau participants_count
  - GOING : User B participe (going) → User A reçoit spotyou_update avec going_count
  - NOT GOING : User B annule sa participation → User A reçoit mise à jour
  - LEAVE : User B quitte → User A reçoit participants_count décrémenté
"""

import asyncio
import json
import pytest
import httpx
import websockets
import os

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = BASE + "/api"
WS_BASE = BASE.replace("https://", "wss://").replace("http://", "ws://") + "/api"

COACH_CREDS = {"email": "coach@winek.app", "password": "WinekCoach2024!"}
USER_CREDS  = {"email": "user@winek.app",  "password": "WinekUser2024!"}
ADMIN_CREDS = {"email": "admin@winek.app",  "password": "WinekAdmin2024!"}

# ── Helpers ──────────────────────────────────────────────────────────────────

def login_sync(client: httpx.Client, creds: dict) -> str:
    r = client.post(f"{API}/auth/login", json=creds)
    assert r.status_code == 200, f"Login failed: {r.text}"
    return r.json()["token"]


def find_spotyou_with_owner(client: httpx.Client, token: str, owner_creds: dict) -> str:
    """Trouve un SpotYou dont le propriétaire est owner_creds, pour éviter les conflits."""
    owner_token = login_sync(client, owner_creds)
    r = client.get(f"{API}/tag-points/mine", headers={"Authorization": f"Bearer {owner_token}"})
    assert r.status_code == 200
    points = r.json()
    assert len(points) > 0, "Aucun SpotYou trouvé pour ce coach"
    return points[0]["point_id"]


async def ws_connect_and_listen(point_id: str, token: str, timeout: float = 8.0):
    """
    Se connecte au WebSocket SpotYou et écoute les messages pendant `timeout` secondes.
    Retourne la liste des messages reçus.
    """
    ws_url = f"{WS_BASE}/ws/spotyou/{point_id}?token={token}"
    messages = []
    try:
        async with websockets.connect(ws_url, close_timeout=3) as ws:
            async def reader():
                try:
                    async for raw in ws:
                        data = json.loads(raw)
                        messages.append(data)
                except websockets.exceptions.ConnectionClosed:
                    pass

            # Lancer le reader et attendre le timeout
            task = asyncio.create_task(reader())
            await asyncio.sleep(timeout)
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
    except Exception as e:
        print(f"[WS] Erreur connexion: {e}")
    return messages


# ── Fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def client():
    with httpx.Client(timeout=15) as c:
        yield c


@pytest.fixture(scope="module")
def coach_token(client):
    return login_sync(client, COACH_CREDS)


@pytest.fixture(scope="module")
def user_token(client):
    return login_sync(client, USER_CREDS)


@pytest.fixture(scope="module")
def admin_token(client):
    return login_sync(client, ADMIN_CREDS)


@pytest.fixture(scope="module")
def spotyou_id(client, coach_token):
    """Trouve un SpotYou du coach pour les tests."""
    return find_spotyou_with_owner(client, coach_token, COACH_CREDS)


# ── Cleanup : s'assurer que User B n'est pas déjà membre ────────────────────

@pytest.fixture(autouse=True)
def cleanup_user_membership(client, spotyou_id, user_token):
    """Nettoyer : User B quitte le SpotYou avant chaque test si nécessaire."""
    client.delete(
        f"{API}/spot-you/{spotyou_id}/leave",
        headers={"Authorization": f"Bearer {user_token}"},
    )
    yield
    # Cleanup après le test aussi
    client.delete(
        f"{API}/spot-you/{spotyou_id}/leave",
        headers={"Authorization": f"Bearer {user_token}"},
    )


# ══════════════════════════════════════════════════════════════════════════════
# Test 1 : JOIN — User B rejoint → User A reçoit la mise à jour WS
# ══════════════════════════════════════════════════════════════════════════════

def test_ws_join_broadcast(client, coach_token, user_token, spotyou_id):
    """
    User A (coach, propriétaire) est connecté au WS.
    User B (user) rejoint le SpotYou.
    → User A doit recevoir un message spotyou_update avec participants_count incrémenté.
    """
    async def run():
        # 1. Lancer le WS listener de User A en background
        ws_task = asyncio.create_task(ws_connect_and_listen(spotyou_id, coach_token, timeout=5))

        # 2. Attendre que la connexion WS soit établie
        await asyncio.sleep(1)

        # 3. User B rejoint le SpotYou via API
        r = client.post(
            f"{API}/spot-you/{spotyou_id}/join",
            headers={"Authorization": f"Bearer {user_token}"},
        )
        assert r.status_code == 200, f"Join failed: {r.text}"
        join_data = r.json()
        assert join_data["success"] is True
        assert join_data["is_member"] is True

        # 4. Attendre que le WS listener reçoive le broadcast
        messages = await ws_task

        # 5. Vérifier qu'on a reçu au moins un message spotyou_update
        updates = [m for m in messages if m.get("type") == "spotyou_update"]
        assert len(updates) >= 1, f"Attendu ≥1 spotyou_update, reçu {len(updates)}. Messages: {messages}"

        update = updates[-1]  # Dernier message
        assert update["point_id"] == spotyou_id
        assert "participants_count" in update
        assert update["participants_count"] >= 2  # Coach (propriétaire) + User B
        print(f"✅ JOIN broadcast reçu : participants_count={update['participants_count']}")

    asyncio.get_event_loop().run_until_complete(run())


# ══════════════════════════════════════════════════════════════════════════════
# Test 2 : GOING — User B participe à la séance → User A reçoit going_count
# ══════════════════════════════════════════════════════════════════════════════

def test_ws_going_broadcast(client, coach_token, user_token, spotyou_id):
    """
    User B doit d'abord être membre, puis indique sa présence (going).
    → User A reçoit un message avec going_count.
    """
    # D'abord rejoindre
    client.post(
        f"{API}/spot-you/{spotyou_id}/join",
        headers={"Authorization": f"Bearer {user_token}"},
    )

    async def run():
        ws_task = asyncio.create_task(ws_connect_and_listen(spotyou_id, coach_token, timeout=5))
        await asyncio.sleep(1)

        r = client.post(
            f"{API}/spot-you/{spotyou_id}/going",
            headers={"Authorization": f"Bearer {user_token}"},
        )
        assert r.status_code == 200, f"Going failed: {r.text}"
        going_data = r.json()
        assert going_data["success"] is True
        assert going_data["is_going"] is True

        messages = await ws_task

        updates = [m for m in messages if m.get("type") == "spotyou_update"]
        assert len(updates) >= 1, f"Attendu ≥1 spotyou_update pour going. Messages: {messages}"

        update = updates[-1]
        assert "going_count" in update
        assert update["going_count"] >= 1
        print(f"✅ GOING broadcast reçu : going_count={update['going_count']}")

    asyncio.get_event_loop().run_until_complete(run())


# ══════════════════════════════════════════════════════════════════════════════
# Test 3 : NOT GOING — User B annule sa participation → User A reçoit la MAJ
# ══════════════════════════════════════════════════════════════════════════════

def test_ws_not_going_broadcast(client, coach_token, user_token, spotyou_id):
    """
    User B annule sa présence (not_going).
    → User A reçoit un message avec going_count décrémenté.
    """
    # D'abord rejoindre + going
    client.post(f"{API}/spot-you/{spotyou_id}/join", headers={"Authorization": f"Bearer {user_token}"})
    client.post(f"{API}/spot-you/{spotyou_id}/going", headers={"Authorization": f"Bearer {user_token}"})

    async def run():
        ws_task = asyncio.create_task(ws_connect_and_listen(spotyou_id, coach_token, timeout=5))
        await asyncio.sleep(1)

        r = client.delete(
            f"{API}/spot-you/{spotyou_id}/going",
            headers={"Authorization": f"Bearer {user_token}"},
        )
        assert r.status_code == 200, f"Not going failed: {r.text}"

        messages = await ws_task

        updates = [m for m in messages if m.get("type") == "spotyou_update"]
        assert len(updates) >= 1, f"Attendu ≥1 spotyou_update pour not_going. Messages: {messages}"

        update = updates[-1]
        assert "going_count" in update
        print(f"✅ NOT GOING broadcast reçu : going_count={update['going_count']}")

    asyncio.get_event_loop().run_until_complete(run())


# ══════════════════════════════════════════════════════════════════════════════
# Test 4 : LEAVE — User B quitte → User A reçoit participants_count décrémenté
# ══════════════════════════════════════════════════════════════════════════════

def test_ws_leave_broadcast(client, coach_token, user_token, spotyou_id):
    """
    User B quitte le SpotYou.
    → User A reçoit un message avec participants_count décrémenté.
    """
    # D'abord rejoindre
    join_r = client.post(f"{API}/spot-you/{spotyou_id}/join", headers={"Authorization": f"Bearer {user_token}"})
    count_after_join = join_r.json().get("participants_count", 0)

    async def run():
        ws_task = asyncio.create_task(ws_connect_and_listen(spotyou_id, coach_token, timeout=5))
        await asyncio.sleep(1)

        r = client.delete(
            f"{API}/spot-you/{spotyou_id}/leave",
            headers={"Authorization": f"Bearer {user_token}"},
        )
        assert r.status_code == 200, f"Leave failed: {r.text}"
        leave_data = r.json()
        assert leave_data["is_member"] is False

        messages = await ws_task

        updates = [m for m in messages if m.get("type") == "spotyou_update"]
        assert len(updates) >= 1, f"Attendu ≥1 spotyou_update pour leave. Messages: {messages}"

        update = updates[-1]
        assert update["participants_count"] < count_after_join, \
            f"participants_count devrait diminuer : avant={count_after_join}, après={update['participants_count']}"
        print(f"✅ LEAVE broadcast reçu : participants_count={update['participants_count']} (avant: {count_after_join})")

    asyncio.get_event_loop().run_until_complete(run())


# ══════════════════════════════════════════════════════════════════════════════
# Test 5 : FULL FLOW — Join + Going + Not Going + Leave en séquence
# ══════════════════════════════════════════════════════════════════════════════

def test_ws_full_flow(client, coach_token, user_token, spotyou_id):
    """
    Test du flow complet en séquence :
    User A connecté au WS, User B fait Join → Going → Not Going → Leave.
    Chaque action doit générer un broadcast WebSocket.
    """
    async def run():
        ws_task = asyncio.create_task(ws_connect_and_listen(spotyou_id, coach_token, timeout=12))
        await asyncio.sleep(1)

        headers_b = {"Authorization": f"Bearer {user_token}"}

        # JOIN
        r = client.post(f"{API}/spot-you/{spotyou_id}/join", headers=headers_b)
        assert r.status_code == 200
        await asyncio.sleep(0.5)

        # GOING
        r = client.post(f"{API}/spot-you/{spotyou_id}/going", headers=headers_b)
        assert r.status_code == 200
        await asyncio.sleep(0.5)

        # NOT GOING
        r = client.delete(f"{API}/spot-you/{spotyou_id}/going", headers=headers_b)
        assert r.status_code == 200
        await asyncio.sleep(0.5)

        # LEAVE
        r = client.delete(f"{API}/spot-you/{spotyou_id}/leave", headers=headers_b)
        assert r.status_code == 200
        await asyncio.sleep(0.5)

        messages = await ws_task

        updates = [m for m in messages if m.get("type") == "spotyou_update"]
        print(f"\n📊 FULL FLOW : {len(updates)} messages spotyou_update reçus")
        for i, u in enumerate(updates):
            print(f"   [{i+1}] participants={u.get('participants_count')}, going={u.get('going_count')}, full={u.get('is_full')}")

        assert len(updates) >= 4, \
            f"Attendu ≥4 broadcasts (join+going+not_going+leave), reçu {len(updates)}"
        print(f"✅ FULL FLOW : {len(updates)} broadcasts WebSocket reçus comme attendu")

    asyncio.get_event_loop().run_until_complete(run())
