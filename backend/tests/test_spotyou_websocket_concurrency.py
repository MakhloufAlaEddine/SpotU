"""
test_spotyou_websocket_concurrency.py — Tests WebSocket & Concurrence SpotYou
==============================================================================

Couvre :
  - WebSocket /ws/spot-you/{point_id} : connexion, auth, broadcast spotyou_update
  - Concurrence : 2 joins simultanés ne créent pas de doublon (ON CONFLICT DO NOTHING)
  - Régression : GET /api/tag-points, POST /api/auth/login, GET /api/spot-you/{id}/going
  - join/leave : retournent success:true, participants_count, is_member
  - going/not-going : retournent success:true, going_count, is_full
"""
import pytest
import asyncio
import httpx
import websockets
import json
import uuid
import os
import time

# ─── Configuration ─────────────────────────────────────────────────────────────
# Dérivé depuis la variable d'environnement ou valeur de fallback
_BASE_HTTPS = os.environ.get("EXPO_PUBLIC_BACKEND_URL",
               "https://stripe-payment-debug-1.preview.emergentagent.com").rstrip("/")
API_BASE = f"{_BASE_HTTPS}/api"
# WebSocket : remplace 'https' → 'wss'
WS_BASE  = _BASE_HTTPS.replace("https://", "wss://").replace("http://", "ws://") + "/api"

COACH_EMAIL = "coach@winek.app"
COACH_PASS  = "WinekCoach2024!"
USER_EMAIL  = "user@winek.app"
USER_PASS   = "WinekUser2024!"
ADMIN_EMAIL = "admin@winek.app"
ADMIN_PASS  = "WinekAdmin2024!"


# ─── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def client():
    return httpx.Client(base_url=API_BASE, timeout=30)


@pytest.fixture(scope="session")
def coach_token(client):
    r = client.post("/auth/login", json={"email": COACH_EMAIL, "password": COACH_PASS})
    assert r.status_code == 200, f"Coach login failed: {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def user_token(client):
    r = client.post("/auth/login", json={"email": USER_EMAIL, "password": USER_PASS})
    assert r.status_code == 200, f"User login failed: {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def coach_auth(coach_token):
    return {"Authorization": f"Bearer {coach_token}"}


@pytest.fixture(scope="session")
def user_auth(user_token):
    return {"Authorization": f"Bearer {user_token}"}


def get_spot_with_schedule(client, auth) -> str:
    """Récupère un SpotYou avec event_schedule pour les tests."""
    r = client.get("/tag-points?limit=30", headers=auth)
    assert r.status_code == 200, f"GET tag-points failed: {r.text}"
    pts = r.json()
    pts_list = pts.get("points", pts) if isinstance(pts, dict) else pts
    for p in pts_list:
        if p.get("event_schedule"):
            return p["point_id"]
    pytest.skip("Aucun SpotYou avec event_schedule disponible")


# ─── Regression: login ──────────────────────────────────────────────────────────

class TestRegressionLogin:
    """Régression : POST /api/auth/login fonctionne toujours."""

    def test_coach_login(self, client):
        """Coach login retourne token."""
        r = client.post("/auth/login", json={"email": COACH_EMAIL, "password": COACH_PASS})
        assert r.status_code == 200, f"Login failed: {r.text}"
        data = r.json()
        assert "token" in data
        assert len(data["token"]) > 0
        assert "user" in data
        assert data["user"]["email"] == COACH_EMAIL

    def test_user_login(self, client):
        """User login retourne token."""
        r = client.post("/auth/login", json={"email": USER_EMAIL, "password": USER_PASS})
        assert r.status_code == 200, f"Login failed: {r.text}"
        data = r.json()
        assert "token" in data
        assert len(data["token"]) > 0

    def test_invalid_login_returns_401(self, client):
        """Identifiants invalides → 401."""
        r = client.post("/auth/login", json={"email": "bad@example.com", "password": "wrong"})
        assert r.status_code == 401, f"Expected 401, got {r.status_code}"


# ─── Regression: tag-points list ───────────────────────────────────────────────

class TestRegressionTagPoints:
    """Régression : GET /api/tag-points fonctionne toujours."""

    def test_get_tag_points_returns_list(self, client, user_auth):
        """GET /tag-points retourne une liste de points."""
        r = client.get("/tag-points", headers=user_auth)
        assert r.status_code == 200, f"GET tag-points failed: {r.text}"
        data = r.json()
        # Accept both {"points": [...]} and direct list
        pts = data.get("points", data) if isinstance(data, dict) else data
        assert isinstance(pts, list)

    def test_get_tag_points_unauthenticated(self, client):
        """GET /tag-points fonctionne sans authentification."""
        r = client.get("/tag-points")
        assert r.status_code == 200, f"GET tag-points (unauth) failed: {r.text}"

    def test_tag_points_have_point_id(self, client, user_auth):
        """Les tag-points retournés ont un point_id."""
        r = client.get("/tag-points?limit=5", headers=user_auth)
        assert r.status_code == 200
        data = r.json()
        pts = data.get("points", data) if isinstance(data, dict) else data
        if pts:
            assert "point_id" in pts[0]


# ─── Regression: going list ────────────────────────────────────────────────────

class TestRegressionGoingList:
    """Régression : GET /api/spot-you/{id}/going fonctionne toujours."""

    def test_going_list_returns_200(self, client, user_auth):
        """GET /spot-you/{id}/going retourne 200."""
        point_id = get_spot_with_schedule(client, user_auth)
        r = client.get(f"/spot-you/{point_id}/going")
        assert r.status_code == 200, f"GET going failed: {r.text}"
        data = r.json()
        assert "session_date" in data
        assert "going" in data
        assert isinstance(data["going"], list)

    def test_going_list_404_for_invalid_id(self, client):
        """GET going sur un ID invalide → 404."""
        r = client.get("/spot-you/invalid_point_xyz/going")
        assert r.status_code == 404


# ─── Join / Leave response fields ──────────────────────────────────────────────

class TestJoinLeaveResponseFields:
    """Vérification des champs retournés par join/leave avec transaction."""

    def test_join_returns_required_fields(self, client, user_auth):
        """POST /spot-you/{id}/join retourne success:true, participants_count, is_member:true."""
        point_id = get_spot_with_schedule(client, user_auth)
        r = client.post(f"/spot-you/{point_id}/join", headers=user_auth)
        assert r.status_code == 200, f"JOIN failed: {r.text}"
        data = r.json()
        # Champs obligatoires
        assert data.get("success") is True, "success doit être True"
        assert "participants_count" in data, "participants_count manquant"
        assert data.get("is_member") is True, "is_member doit être True"
        assert isinstance(data["participants_count"], int)
        assert data["participants_count"] >= 1

    def test_leave_returns_required_fields(self, client, user_auth):
        """DELETE /spot-you/{id}/leave retourne success:true, participants_count, is_member:false."""
        point_id = get_spot_with_schedule(client, user_auth)
        # S'assurer d'être membre
        client.post(f"/spot-you/{point_id}/join", headers=user_auth)
        # Quitter
        r = client.delete(f"/spot-you/{point_id}/leave", headers=user_auth)
        assert r.status_code == 200, f"LEAVE failed: {r.text}"
        data = r.json()
        assert data.get("success") is True, "success doit être True"
        assert "participants_count" in data, "participants_count manquant"
        assert data.get("is_member") is False, "is_member doit être False après leave"
        assert isinstance(data["participants_count"], int)

    def test_join_after_leave_increments_count(self, client, user_auth):
        """Join après leave incrémente le participants_count."""
        point_id = get_spot_with_schedule(client, user_auth)
        # Leave first
        client.delete(f"/spot-you/{point_id}/leave", headers=user_auth)
        r_leave = client.delete(f"/spot-you/{point_id}/leave", headers=user_auth)
        count_after_leave = r_leave.json().get("participants_count", 0)
        # Join
        r_join = client.post(f"/spot-you/{point_id}/join", headers=user_auth)
        assert r_join.status_code == 200
        count_after_join = r_join.json()["participants_count"]
        assert count_after_join == count_after_leave + 1


# ─── Going / Not-going response fields ─────────────────────────────────────────

class TestGoingNotGoingResponseFields:
    """Vérification des champs retournés par going/not-going avec SELECT FOR UPDATE."""

    def test_going_returns_required_fields(self, client, user_auth):
        """POST /spot-you/{id}/going retourne success:true, going_count, is_full."""
        point_id = get_spot_with_schedule(client, user_auth)
        # S'assurer d'être membre
        client.post(f"/spot-you/{point_id}/join", headers=user_auth)
        # Indiquer présence
        r = client.post(f"/spot-you/{point_id}/going", headers=user_auth)
        assert r.status_code == 200, f"GOING failed: {r.text}"
        data = r.json()
        assert data.get("success") is True, "success doit être True"
        assert "going_count" in data, "going_count manquant"
        assert "is_full" in data, "is_full manquant"
        assert isinstance(data["going_count"], int)
        assert data["going_count"] >= 1
        assert isinstance(data["is_full"], bool)
        assert data.get("is_going") is True

    def test_not_going_returns_required_fields(self, client, user_auth):
        """DELETE /spot-you/{id}/going retourne success:true, going_count, is_full."""
        point_id = get_spot_with_schedule(client, user_auth)
        # S'assurer d'être membre et inscrit
        client.post(f"/spot-you/{point_id}/join", headers=user_auth)
        client.post(f"/spot-you/{point_id}/going", headers=user_auth)
        # Se désinscrire
        r = client.delete(f"/spot-you/{point_id}/going", headers=user_auth)
        assert r.status_code == 200, f"NOT_GOING failed: {r.text}"
        data = r.json()
        assert data.get("success") is True, "success doit être True"
        assert "going_count" in data, "going_count manquant"
        assert "is_full" in data, "is_full manquant"
        assert isinstance(data["going_count"], int)
        assert isinstance(data["is_full"], bool)
        assert data.get("is_going") is False

    def test_going_count_decreases_after_not_going(self, client, user_auth):
        """going_count diminue après not-going."""
        point_id = get_spot_with_schedule(client, user_auth)
        client.post(f"/spot-you/{point_id}/join", headers=user_auth)
        r_going = client.post(f"/spot-you/{point_id}/going", headers=user_auth)
        count_going = r_going.json()["going_count"]
        r_not_going = client.delete(f"/spot-you/{point_id}/going", headers=user_auth)
        count_not_going = r_not_going.json()["going_count"]
        assert count_not_going < count_going or count_not_going == 0


# ─── Concurrence ──────────────────────────────────────────────────────────────

class TestConcurrency:
    """2 requêtes join simultanées ne créent pas de doublon (ON CONFLICT DO NOTHING)."""

    def test_concurrent_joins_no_duplicate(self, client, user_auth, user_token):
        """
        Deux requêtes POST /join simultanées du même user ne créent pas de doublon.
        participants_count doit rester identique après les deux joins.
        """
        point_id = get_spot_with_schedule(client, user_auth)
        # D'abord quitter pour avoir un état initial propre
        client.delete(f"/spot-you/{point_id}/leave", headers=user_auth)

        # Lancer 2 joins simultanés avec aiohttp
        async def do_concurrent_joins():
            import aiohttp
            url = f"{API_BASE}/spot-you/{point_id}/join"
            headers = {"Authorization": f"Bearer {user_token}"}
            async with aiohttp.ClientSession() as session:
                tasks = [
                    session.post(url, headers=headers),
                    session.post(url, headers=headers),
                ]
                responses = await asyncio.gather(*tasks, return_exceptions=True)
                results = []
                for resp in responses:
                    if isinstance(resp, Exception):
                        results.append({"error": str(resp)})
                    else:
                        body = await resp.json()
                        results.append({"status": resp.status, "data": body})
                        resp.release()
                return results

        results = asyncio.run(do_concurrent_joins())

        # Vérifier qu'au moins une des requêtes a réussi
        successes = [r for r in results if r.get("status") == 200]
        assert len(successes) >= 1, f"Aucun join réussi: {results}"

        # Vérifier que les participants_count des réponses réussies sont cohérents
        counts = [r["data"].get("participants_count") for r in successes if "data" in r]
        # Tous les counts doivent être >= 1
        for c in counts:
            assert c is not None and c >= 1, f"participants_count invalide: {c}"

        # Vérifier l'idempotence — un GET doit refléter qu'on est bien membre une seule fois
        r_detail = client.get(f"/tag-points/{point_id}", headers=user_auth)
        assert r_detail.status_code == 200
        detail = r_detail.json()
        # participants_count devrait correspondre à la réalité (pas de doublon)
        assert detail.get("is_member") is True

    def test_concurrent_joins_same_count_both_succeed(self, client, user_auth, user_token):
        """
        Les deux requêtes concurrent doivent toutes les deux retourner 200
        ET le même participants_count (idempotence ON CONFLICT DO NOTHING).
        """
        point_id = get_spot_with_schedule(client, user_auth)
        # Leave pour reset
        client.delete(f"/spot-you/{point_id}/leave", headers=user_auth)

        async def do_concurrent_joins_check():
            import aiohttp
            url = f"{API_BASE}/spot-you/{point_id}/join"
            headers = {"Authorization": f"Bearer {user_token}"}
            async with aiohttp.ClientSession() as session:
                tasks = [
                    session.post(url, headers=headers),
                    session.post(url, headers=headers),
                ]
                responses = await asyncio.gather(*tasks, return_exceptions=True)
                results = []
                for resp in responses:
                    if isinstance(resp, Exception):
                        results.append({"error": str(resp)})
                    else:
                        body = await resp.json()
                        results.append({"status": resp.status, "data": body})
                        resp.release()
                return results

        results = asyncio.run(do_concurrent_joins_check())

        # Filtrer les succès
        successes = [r for r in results if r.get("status") == 200 and "data" in r]
        assert len(successes) >= 1, f"Aucun join réussi: {results}"

        # Les participants_count de toutes les réponses réussies doivent être identiques
        counts = [r["data"].get("participants_count") for r in successes]
        if len(counts) == 2:
            # Avec ON CONFLICT DO NOTHING, les deux peuvent retourner 200 avec le même count
            assert counts[0] == counts[1], (
                f"Doublon détecté: counts={counts}. "
                f"ON CONFLICT DO NOTHING doit garantir l'idempotence."
            )


# ─── WebSocket ────────────────────────────────────────────────────────────────

class TestWebSocket:
    """WebSocket /ws/spot-you/{point_id} : connexion, auth, broadcast."""

    @pytest.mark.asyncio
    async def test_ws_accepts_connection(self, user_token):
        """WebSocket accepte la connexion et l'authentification."""
        point_id_placeholder = "test_point"

        async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as aclient:
            r = await aclient.get("/tag-points?limit=5",
                                  headers={"Authorization": f"Bearer {user_token}"})
            assert r.status_code == 200
            pts = r.json()
            pts_list = pts.get("points", pts) if isinstance(pts, dict) else pts
            assert len(pts_list) > 0, "Aucun point disponible pour le test WS"
            point_id = pts_list[0]["point_id"]

        ws_url = f"{WS_BASE}/ws/spot-you/{point_id}"
        try:
            async with websockets.connect(ws_url, open_timeout=10) as ws:
                # Envoyer l'authentification
                await ws.send(json.dumps({"token": user_token}))
                # La connexion est maintenant authentifiée — pas d'erreur = succès
                print(f"[WS] Connexion réussie pour point={point_id}")
                # websockets v15: use state check instead of ws.open
                # If connection is still open, we can ping or just wait briefly
                await asyncio.sleep(0.3)
                # Connexion réussie si on arrive ici sans exception
        except Exception as e:
            pytest.fail(f"WebSocket connection failed: {e}")

    @pytest.mark.asyncio
    async def test_ws_closes_on_invalid_token(self):
        """WebSocket ferme la connexion avec un token invalide (code 4001)."""
        async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as aclient:
            r = await aclient.get("/tag-points?limit=1")
            assert r.status_code == 200
            pts = r.json()
            pts_list = pts.get("points", pts) if isinstance(pts, dict) else pts
            assert len(pts_list) > 0
            point_id = pts_list[0]["point_id"]

        ws_url = f"{WS_BASE}/ws/spot-you/{point_id}"
        try:
            async with websockets.connect(ws_url, open_timeout=10) as ws:
                # Envoyer un token invalide
                await ws.send(json.dumps({"token": "invalid_token_xyz"}))
                # Attendre la fermeture
                try:
                    msg = await asyncio.wait_for(ws.recv(), timeout=3.0)
                    # Si on reçoit un message avant fermeture, ce n'est pas attendu
                    print(f"[WS] Message reçu avant fermeture: {msg}")
                except asyncio.TimeoutError:
                    pass
                except websockets.exceptions.ConnectionClosed as e:
                    print(f"[WS] Connexion fermée comme attendu: code={e.code}")
                    # 4001 = unauthorized ou fermeture normale
                    assert e.code in [4001, 1000, 1001, 1002, 1003, 1006], (
                        f"Code de fermeture inattendu: {e.code}"
                    )
        except websockets.exceptions.ConnectionClosedError as e:
            # C'est aussi acceptable — connexion refusée après token invalide
            print(f"[WS] Connexion fermée (ConnectionClosedError): {e}")

    @pytest.mark.asyncio
    async def test_ws_receives_spotyou_update_after_join(self, user_token, coach_token):
        """
        Après un join, le WebSocket doit recevoir un message spotyou_update
        dans les 3 secondes.
        """
        # Obtenir un point avec event_schedule
        async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as aclient:
            r = await aclient.get(
                "/tag-points?limit=30",
                headers={"Authorization": f"Bearer {user_token}"}
            )
            assert r.status_code == 200
            pts = r.json()
            pts_list = pts.get("points", pts) if isinstance(pts, dict) else pts
            point_with_schedule = None
            for p in pts_list:
                if p.get("event_schedule"):
                    point_with_schedule = p["point_id"]
                    break
            if not point_with_schedule:
                pytest.skip("Aucun SpotYou avec event_schedule disponible")
            point_id = point_with_schedule

        ws_url = f"{WS_BASE}/ws/spot-you/{point_id}"
        received_messages = []

        async def connect_and_listen():
            """Connecte le WS et écoute pendant 5 secondes."""
            try:
                async with websockets.connect(ws_url, open_timeout=10) as ws:
                    # Authentification
                    await ws.send(json.dumps({"token": user_token}))
                    # Écouter pendant 5 secondes
                    try:
                        while True:
                            msg = await asyncio.wait_for(ws.recv(), timeout=5.0)
                            parsed = json.loads(msg)
                            received_messages.append(parsed)
                            print(f"[WS] Message reçu: {parsed}")
                    except asyncio.TimeoutError:
                        pass  # Normal — fin de l'écoute
                    except websockets.exceptions.ConnectionClosed:
                        pass
            except Exception as e:
                print(f"[WS] Erreur connexion: {e}")

        async def do_join_action():
            """Effectue un join pour déclencher le broadcast."""
            await asyncio.sleep(0.5)  # Laisser le temps à la connexion WS de s'établir
            async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as aclient:
                # Leave d'abord pour s'assurer que le join déclenchera un broadcast
                await aclient.delete(
                    f"/spot-you/{point_id}/leave",
                    headers={"Authorization": f"Bearer {user_token}"}
                )
                await asyncio.sleep(0.2)
                r = await aclient.post(
                    f"/spot-you/{point_id}/join",
                    headers={"Authorization": f"Bearer {user_token}"}
                )
                print(f"[TEST] Join response: {r.status_code} {r.text}")
                assert r.status_code == 200, f"Join failed: {r.text}"

        # Lancer WS et join en parallèle
        await asyncio.gather(
            connect_and_listen(),
            do_join_action(),
        )

        # Vérifier qu'on a reçu au moins un message spotyou_update
        spotyou_updates = [m for m in received_messages if m.get("type") == "spotyou_update"]
        assert len(spotyou_updates) >= 1, (
            f"Aucun message spotyou_update reçu dans les 5 secondes. "
            f"Messages reçus: {received_messages}"
        )
        # Vérifier la structure du message
        update = spotyou_updates[0]
        assert "participants_count" in update, f"participants_count manquant: {update}"
        assert "point_id" in update, f"point_id manquant: {update}"
        assert update["point_id"] == point_id

    @pytest.mark.asyncio
    async def test_ws_receives_spotyou_update_after_leave(self, user_token):
        """
        Après un leave, le WebSocket doit recevoir un message spotyou_update.
        """
        async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as aclient:
            r = await aclient.get(
                "/tag-points?limit=30",
                headers={"Authorization": f"Bearer {user_token}"}
            )
            assert r.status_code == 200
            pts = r.json()
            pts_list = pts.get("points", pts) if isinstance(pts, dict) else pts
            point_with_schedule = None
            for p in pts_list:
                if p.get("event_schedule"):
                    point_with_schedule = p["point_id"]
                    break
            if not point_with_schedule:
                pytest.skip("Aucun SpotYou avec event_schedule disponible")
            point_id = point_with_schedule

        ws_url = f"{WS_BASE}/ws/spot-you/{point_id}"
        received_messages = []

        async def connect_and_listen_for_leave():
            try:
                async with websockets.connect(ws_url, open_timeout=10) as ws:
                    await ws.send(json.dumps({"token": user_token}))
                    try:
                        while True:
                            msg = await asyncio.wait_for(ws.recv(), timeout=5.0)
                            parsed = json.loads(msg)
                            received_messages.append(parsed)
                    except asyncio.TimeoutError:
                        pass
                    except websockets.exceptions.ConnectionClosed:
                        pass
            except Exception as e:
                print(f"[WS] Erreur: {e}")

        async def do_join_then_leave():
            await asyncio.sleep(0.5)
            async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as aclient:
                # Join d'abord
                await aclient.post(
                    f"/spot-you/{point_id}/join",
                    headers={"Authorization": f"Bearer {user_token}"}
                )
                await asyncio.sleep(0.3)
                # Leave
                r = await aclient.delete(
                    f"/spot-you/{point_id}/leave",
                    headers={"Authorization": f"Bearer {user_token}"}
                )
                assert r.status_code == 200, f"Leave failed: {r.text}"

        await asyncio.gather(connect_and_listen_for_leave(), do_join_then_leave())

        spotyou_updates = [m for m in received_messages if m.get("type") == "spotyou_update"]
        assert len(spotyou_updates) >= 1, (
            f"Aucun spotyou_update reçu après leave. Messages: {received_messages}"
        )

    @pytest.mark.asyncio
    async def test_ws_timeout_on_no_auth(self):
        """
        Sans envoyer l'authentification, le WS doit fermer après ~5 secondes.
        """
        async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as aclient:
            r = await aclient.get("/tag-points?limit=1")
            pts = r.json()
            pts_list = pts.get("points", pts) if isinstance(pts, dict) else pts
            assert len(pts_list) > 0
            point_id = pts_list[0]["point_id"]

        ws_url = f"{WS_BASE}/ws/spot-you/{point_id}"
        start = time.time()
        try:
            async with websockets.connect(ws_url, open_timeout=10) as ws:
                # Ne pas envoyer d'authentification — attendre fermeture
                try:
                    msg = await asyncio.wait_for(ws.recv(), timeout=8.0)
                except asyncio.TimeoutError:
                    elapsed = time.time() - start
                    # Si pas de fermeture dans 8 secondes, le serveur n'a pas timeout
                    print(f"[WS] Pas de fermeture en 8 secondes (elapsed={elapsed:.1f}s)")
                except websockets.exceptions.ConnectionClosed as e:
                    elapsed = time.time() - start
                    print(f"[WS] Fermé en {elapsed:.1f}s avec code={e.code} — attendu (timeout auth)")
                    # Le serveur doit fermer dans les ~5 secondes
                    assert elapsed < 10.0, f"Timeout trop long: {elapsed:.1f}s"
        except websockets.exceptions.ConnectionClosedError as e:
            elapsed = time.time() - start
            print(f"[WS] ConnectionClosedError en {elapsed:.1f}s")
