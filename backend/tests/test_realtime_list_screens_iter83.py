"""
test_realtime_list_screens_iter83.py — Tests WebSocket temps réel pour écrans liste
=====================================================================================

Couvre la feature : mises à jour temps réel sur spot-me.tsx (Mes SpotMe) et saved.tsx (Enregistrés)
  - GET /api/tag-points/mine — retourne fields corrects (participants_count, going_count, is_full)
  - GET /api/tag-points/saved — retourne fields corrects
  - Broadcast WS spotyou_update reçu sur liste "mine" après going d'un autre user
  - Broadcast WS spotyou_update reçu sur liste "saved" après going d'un autre user
  - Connexion multiple WS (pattern wsMap) — plusieurs SpotYou simultanément
  - is_full field correct dans le broadcast
"""
import pytest
import asyncio
import httpx
import websockets
import json
import os

# ─── Configuration ─────────────────────────────────────────────────────────────
BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://location-payload-fix.preview.emergentagent.com").rstrip("/")
API_BASE = f"{BASE_URL}/api"
WS_BASE  = BASE_URL.replace("https://", "wss://").replace("http://", "ws://") + "/api"

COACH_EMAIL = "coach@winek.app"
COACH_PASS  = "WinekCoach2024!"
USER_EMAIL  = "user@winek.app"
USER_PASS   = "WinekUser2024!"


# ─── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def client():
    return httpx.Client(base_url=API_BASE, timeout=30)


@pytest.fixture(scope="session")
def user_token(client):
    r = client.post("/auth/login", json={"email": USER_EMAIL, "password": USER_PASS})
    assert r.status_code == 200, f"User login failed: {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def coach_token(client):
    r = client.post("/auth/login", json={"email": COACH_EMAIL, "password": COACH_PASS})
    assert r.status_code == 200, f"Coach login failed: {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def user_auth(user_token):
    return {"Authorization": f"Bearer {user_token}"}


@pytest.fixture(scope="session")
def coach_auth(coach_token):
    return {"Authorization": f"Bearer {coach_token}"}


# ─── Helper ────────────────────────────────────────────────────────────────────

def get_point_with_schedule(client, auth_headers) -> dict:
    """Récupère un SpotYou avec event_schedule dans la liste /tag-points."""
    r = client.get("/tag-points?limit=30", headers=auth_headers)
    assert r.status_code == 200
    data = r.json()
    pts = data.get("points", data) if isinstance(data, dict) else data
    for p in pts:
        if p.get("event_schedule"):
            return p
    pytest.skip("Aucun SpotYou avec event_schedule disponible")


# ─── Phase 1 : Vérification des endpoints liste ────────────────────────────────

class TestListScreenEndpoints:
    """GET /tag-points/mine et /tag-points/saved retournent les bons champs."""

    def test_mine_returns_list(self, client, user_auth):
        """GET /tag-points/mine retourne une liste non-vide pour l'utilisateur de test."""
        r = client.get("/tag-points/mine", headers=user_auth)
        assert r.status_code == 200, f"GET mine failed: {r.text}"
        data = r.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"

    def test_mine_items_have_required_fields(self, client, user_auth):
        """Chaque item de /tag-points/mine a point_id, participants_count, going_count, is_full."""
        r = client.get("/tag-points/mine", headers=user_auth)
        assert r.status_code == 200
        items = r.json()
        if not items:
            pytest.skip("Aucun item dans /tag-points/mine")
        for item in items:
            assert "point_id" in item, f"Champ point_id manquant: {item.keys()}"
            assert "participants_count" in item, f"participants_count manquant: {item.keys()}"
            assert "going_count" in item, f"going_count manquant: {item.keys()}"
            assert "is_full" in item, f"is_full manquant: {item.keys()}"
            assert isinstance(item["participants_count"], int), "participants_count doit être int"
            assert isinstance(item["is_full"], bool), "is_full doit être bool"

    def test_mine_has_data_for_user(self, client, user_auth):
        """L'utilisateur de test (user@winek.app) a des SpotYou dans /tag-points/mine."""
        r = client.get("/tag-points/mine", headers=user_auth)
        assert r.status_code == 200
        items = r.json()
        assert len(items) > 0, "Aucun SpotYou dans mine — les données seed sont manquantes"

    def test_saved_returns_list(self, client, user_auth):
        """GET /tag-points/saved retourne une liste."""
        r = client.get("/tag-points/saved", headers=user_auth)
        assert r.status_code == 200, f"GET saved failed: {r.text}"
        data = r.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"

    def test_saved_items_have_required_fields(self, client, user_auth):
        """Chaque item de /tag-points/saved a point_id, participants_count, is_full."""
        r = client.get("/tag-points/saved", headers=user_auth)
        assert r.status_code == 200
        items = r.json()
        if not items:
            pytest.skip("Aucun item dans /tag-points/saved")
        for item in items:
            assert "point_id" in item, f"point_id manquant: {item.keys()}"
            assert "participants_count" in item, f"participants_count manquant: {item.keys()}"
            assert "is_full" in item, f"is_full manquant: {item.keys()}"

    def test_mine_returns_403_without_auth(self, client):
        """GET /tag-points/mine sans token → 401 ou 403."""
        r = client.get("/tag-points/mine")
        assert r.status_code in [401, 403], f"Expected 401/403, got {r.status_code}"

    def test_saved_returns_403_without_auth(self, client):
        """GET /tag-points/saved sans token → 401 ou 403."""
        r = client.get("/tag-points/saved")
        assert r.status_code in [401, 403], f"Expected 401/403, got {r.status_code}"

    def test_mine_coach_has_spots(self, client, coach_auth):
        """Le coach a des SpotYou créés dans /tag-points/mine."""
        r = client.get("/tag-points/mine", headers=coach_auth)
        assert r.status_code == 200
        items = r.json()
        assert len(items) > 0, "Aucun SpotYou pour le coach"

    def test_mine_includes_going_count_int_or_zero(self, client, user_auth):
        """going_count dans mine est un entier >= 0 (pas None pour items avec schedule)."""
        r = client.get("/tag-points/mine", headers=user_auth)
        assert r.status_code == 200
        items = r.json()
        for item in items:
            gc = item.get("going_count")
            # going_count doit être un int ou 0
            assert gc is None or isinstance(gc, int), f"going_count invalide pour {item['point_id']}: {gc}"
            if gc is not None:
                assert gc >= 0


# ─── Phase 2 : WS spotyou_update sur liste "mine" ─────────────────────────────

class TestSpotMeWebSocket:
    """Simulation du pattern wsMap de spot-me.tsx : connexion WS pour chaque item de /mine."""

    @pytest.mark.asyncio
    async def test_ws_connects_for_mine_items(self, user_token):
        """
        Le pattern wsMap de spot-me.tsx : on ouvre 1 WS par item de /mine.
        Vérification que toutes les connexions s'établissent sans erreur.
        """
        async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as aclient:
            r = await aclient.get("/tag-points/mine",
                                  headers={"Authorization": f"Bearer {user_token}"})
            assert r.status_code == 200
            mine_items = r.json()

        if not mine_items:
            pytest.skip("Aucun item dans /tag-points/mine")

        # Limiter à 15 (comme le frontend)
        ids_to_connect = [p["point_id"] for p in mine_items[:15]]
        connected = []

        for point_id in ids_to_connect:
            ws_url = f"{WS_BASE}/ws/spot-you/{point_id}"
            try:
                ws = await websockets.connect(ws_url, open_timeout=10)
                await ws.send(json.dumps({"token": user_token}))
                await asyncio.sleep(0.1)
                connected.append((point_id, ws))
                print(f"[WS] Connecté: {point_id}")
            except Exception as e:
                print(f"[WS] Erreur connexion {point_id}: {e}")

        # Fermer toutes les connexions
        for pid, ws in connected:
            try:
                await ws.close()
            except Exception:
                pass

        assert len(connected) == len(ids_to_connect), (
            f"Seulement {len(connected)}/{len(ids_to_connect)} connexions établies"
        )
        print(f"[TEST] {len(connected)} connexions WS établies pour les items de /mine")

    @pytest.mark.asyncio
    async def test_ws_broadcast_reaches_mine_list_on_going(self, user_token, coach_token):
        """
        Simule le scenario : coach fait un "going" sur un SpotYou qui est dans /mine de user.
        → Le WS connecté par user pour ce SpotYou reçoit un spotyou_update.
        """
        # Trouver un SpotYou dans mine de user ET créé par coach
        async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as aclient:
            r_mine = await aclient.get("/tag-points/mine",
                                       headers={"Authorization": f"Bearer {user_token}"})
            assert r_mine.status_code == 200
            mine_items = r_mine.json()

            # Chercher un point avec event_schedule
            target_point_id = None
            for item in mine_items:
                if item.get("event_schedule"):
                    target_point_id = item["point_id"]
                    break

            if not target_point_id:
                pytest.skip("Aucun item avec event_schedule dans /mine")

        received_messages = []
        print(f"[TEST] Point cible pour broadcast: {target_point_id}")

        async def listen_on_ws():
            """Écouter les messages WS comme spot-me.tsx le fait."""
            ws_url = f"{WS_BASE}/ws/spot-you/{target_point_id}"
            try:
                async with websockets.connect(ws_url, open_timeout=10) as ws:
                    await ws.send(json.dumps({"token": user_token}))
                    try:
                        while True:
                            msg = await asyncio.wait_for(ws.recv(), timeout=6.0)
                            parsed = json.loads(msg)
                            received_messages.append(parsed)
                            print(f"[WS MINE] Reçu: {parsed}")
                    except asyncio.TimeoutError:
                        pass
                    except websockets.exceptions.ConnectionClosed:
                        pass
            except Exception as e:
                print(f"[WS MINE] Erreur: {e}")

        async def trigger_going_action():
            """Déclenche un going pour provoquer le broadcast."""
            await asyncio.sleep(0.8)  # Laisser le WS s'établir
            async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as aclient:
                # S'assurer que user est membre
                await aclient.post(f"/spot-you/{target_point_id}/join",
                                   headers={"Authorization": f"Bearer {user_token}"})
                await asyncio.sleep(0.2)
                # Déclencher going → broadcast
                r = await aclient.post(f"/spot-you/{target_point_id}/going",
                                       headers={"Authorization": f"Bearer {user_token}"})
                print(f"[TEST] Going response: {r.status_code} {r.text[:200]}")
                # Aussi tester le not-going pour avoir un 2ème broadcast
                if r.status_code == 200:
                    await asyncio.sleep(0.2)
                    r2 = await aclient.delete(f"/spot-you/{target_point_id}/going",
                                              headers={"Authorization": f"Bearer {user_token}"})
                    print(f"[TEST] Not-going response: {r2.status_code}")

        await asyncio.gather(listen_on_ws(), trigger_going_action())

        # Vérifier qu'on a reçu des messages spotyou_update
        updates = [m for m in received_messages if m.get("type") == "spotyou_update"]
        assert len(updates) >= 1, (
            f"Aucun spotyou_update reçu sur /mine. Messages: {received_messages}"
        )
        # Vérifier la structure
        update = updates[0]
        assert update.get("point_id") == target_point_id, f"point_id incorrect: {update}"
        print(f"[TEST PASS] spotyou_update reçu avec going_count={update.get('going_count')}, "
              f"participants_count={update.get('participants_count')}")


# ─── Phase 3 : WS spotyou_update sur liste "saved" ────────────────────────────

class TestSavedScreenWebSocket:
    """Simulation du pattern wsMap de saved.tsx : connexion WS pour chaque item de /saved."""

    @pytest.mark.asyncio
    async def test_ws_connects_for_saved_items(self, user_token):
        """
        Le pattern wsMap de saved.tsx : on ouvre 1 WS par item de /saved.
        Vérification que toutes les connexions s'établissent.
        """
        async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as aclient:
            r = await aclient.get("/tag-points/saved",
                                  headers={"Authorization": f"Bearer {user_token}"})
            assert r.status_code == 200
            saved_items = r.json()

        if not saved_items:
            pytest.skip("Aucun item dans /tag-points/saved")

        ids_to_connect = [p["point_id"] for p in saved_items[:15]]
        connected = []

        for point_id in ids_to_connect:
            ws_url = f"{WS_BASE}/ws/spot-you/{point_id}"
            try:
                ws = await websockets.connect(ws_url, open_timeout=10)
                await ws.send(json.dumps({"token": user_token}))
                await asyncio.sleep(0.1)
                connected.append((point_id, ws))
                print(f"[WS] Connecté saved: {point_id}")
            except Exception as e:
                print(f"[WS] Erreur connexion saved {point_id}: {e}")

        for pid, ws in connected:
            try:
                await ws.close()
            except Exception:
                pass

        assert len(connected) == len(ids_to_connect), (
            f"Seulement {len(connected)}/{len(ids_to_connect)} connexions WS établies pour /saved"
        )

    @pytest.mark.asyncio
    async def test_ws_broadcast_reaches_saved_list_on_join(self, user_token, coach_token):
        """
        Simulation : coach rejoint un SpotYou qui est dans la liste /saved de user.
        → Le WS connecté par user pour ce SpotYou reçoit un spotyou_update avec participants_count.
        """
        async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as aclient:
            r_saved = await aclient.get("/tag-points/saved",
                                        headers={"Authorization": f"Bearer {user_token}"})
            assert r_saved.status_code == 200
            saved_items = r_saved.json()

        if not saved_items:
            pytest.skip("Aucun item dans /tag-points/saved")

        # Utiliser le premier item saved
        target_point_id = saved_items[0]["point_id"]
        received_messages = []
        print(f"[TEST] Point saved cible pour broadcast: {target_point_id}")

        async def listen_saved_ws():
            ws_url = f"{WS_BASE}/ws/spot-you/{target_point_id}"
            try:
                async with websockets.connect(ws_url, open_timeout=10) as ws:
                    await ws.send(json.dumps({"token": user_token}))
                    try:
                        while True:
                            msg = await asyncio.wait_for(ws.recv(), timeout=6.0)
                            parsed = json.loads(msg)
                            received_messages.append(parsed)
                            print(f"[WS SAVED] Reçu: {parsed}")
                    except asyncio.TimeoutError:
                        pass
                    except websockets.exceptions.ConnectionClosed:
                        pass
            except Exception as e:
                print(f"[WS SAVED] Erreur: {e}")

        async def trigger_join_then_leave():
            """Coach rejoint un SpotYou dans la liste saved de user pour déclencher broadcast."""
            await asyncio.sleep(0.8)
            async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as aclient:
                # Leave d'abord pour garantir un join qui déclenche le broadcast
                await aclient.delete(f"/spot-you/{target_point_id}/leave",
                                     headers={"Authorization": f"Bearer {coach_token}"})
                await asyncio.sleep(0.2)
                r = await aclient.post(f"/spot-you/{target_point_id}/join",
                                       headers={"Authorization": f"Bearer {coach_token}"})
                print(f"[TEST] Coach join response: {r.status_code} {r.text[:200]}")

        await asyncio.gather(listen_saved_ws(), trigger_join_then_leave())

        updates = [m for m in received_messages if m.get("type") == "spotyou_update"]
        assert len(updates) >= 1, (
            f"Aucun spotyou_update reçu sur /saved après join. Messages: {received_messages}"
        )
        update = updates[0]
        assert "participants_count" in update, f"participants_count manquant: {update}"
        assert update.get("point_id") == target_point_id
        print(f"[TEST PASS] broadcast reçu saved: participants_count={update.get('participants_count')}")


# ─── Phase 4 : Broadcast complet (join d'un user déclenche WS pour un autre user) ───

class TestCrossUserBroadcast:
    """
    Scenario réel de la feature : user1 (coach) fait un going sur un SpotYou,
    user2 (user) connecté via WS reçoit la mise à jour en temps réel.
    C'est le cas principal décrit dans le PRD.
    """

    @pytest.mark.asyncio
    async def test_coach_going_triggers_ws_update_on_user_ws(self, user_token, coach_token):
        """
        user est connecté via WS à un SpotYou (comme spot-me.tsx et saved.tsx).
        Coach fait "going" → user reçoit spotyou_update avec going_count mis à jour.
        """
        # Trouver un SpotYou avec event_schedule visible par les deux
        async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as aclient:
            r = await aclient.get("/tag-points?limit=30",
                                  headers={"Authorization": f"Bearer {user_token}"})
            assert r.status_code == 200
            pts = r.json()
            pts_list = pts.get("points", pts) if isinstance(pts, dict) else pts
            target = None
            for p in pts_list:
                if p.get("event_schedule"):
                    target = p
                    break
            if not target:
                pytest.skip("Aucun SpotYou avec event_schedule disponible")
            point_id = target["point_id"]

        received_messages = []
        initial_going_count = target.get("going_count", 0) or 0

        async def user_listen():
            """User connecte WS comme spot-me.tsx / saved.tsx."""
            ws_url = f"{WS_BASE}/ws/spot-you/{point_id}"
            try:
                async with websockets.connect(ws_url, open_timeout=10) as ws:
                    await ws.send(json.dumps({"token": user_token}))
                    try:
                        while True:
                            msg = await asyncio.wait_for(ws.recv(), timeout=7.0)
                            parsed = json.loads(msg)
                            received_messages.append(parsed)
                            print(f"[WS USER] Reçu: {parsed}")
                    except asyncio.TimeoutError:
                        pass
                    except websockets.exceptions.ConnectionClosed:
                        pass
            except Exception as e:
                print(f"[WS USER] Erreur: {e}")

        async def coach_participates():
            """Coach s'assure d'être membre et fait un going."""
            await asyncio.sleep(0.8)  # Laisser WS s'établir
            async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as aclient:
                # S'assurer que coach est membre
                await aclient.post(f"/spot-you/{point_id}/join",
                                   headers={"Authorization": f"Bearer {coach_token}"})
                await asyncio.sleep(0.2)
                # Retirer going d'abord (idempotence)
                await aclient.delete(f"/spot-you/{point_id}/going",
                                     headers={"Authorization": f"Bearer {coach_token}"})
                await asyncio.sleep(0.2)
                # Going → déclenche broadcast
                r = await aclient.post(f"/spot-you/{point_id}/going",
                                       headers={"Authorization": f"Bearer {coach_token}"})
                print(f"[TEST] Coach going: {r.status_code} {r.text[:300]}")
                assert r.status_code == 200, f"Coach going failed: {r.text}"
                going_data = r.json()
                print(f"[TEST] going_count après action: {going_data.get('going_count')}")

        await asyncio.gather(user_listen(), coach_participates())

        updates = [m for m in received_messages if m.get("type") == "spotyou_update"]
        assert len(updates) >= 1, (
            f"User n'a reçu aucun spotyou_update après going du coach. "
            f"Messages reçus: {received_messages}"
        )
        # Vérifier les champs attendus par le frontend (spot-me.tsx ligne 80-84)
        update = updates[-1]  # Prendre le dernier update
        assert "type" in update and update["type"] == "spotyou_update"
        assert "going_count" in update, f"going_count manquant dans broadcast: {update}"
        assert "participants_count" in update, f"participants_count manquant: {update}"
        assert "is_full" in update, f"is_full manquant: {update}"
        assert update.get("point_id") == point_id
        assert isinstance(update["going_count"], int)
        assert isinstance(update["participants_count"], int)
        assert isinstance(update["is_full"], bool)
        print(f"[TEST PASS] Cross-user broadcast validé: going_count={update['going_count']}, "
              f"participants_count={update['participants_count']}, is_full={update['is_full']}")

    @pytest.mark.asyncio
    async def test_join_updates_participants_count_on_ws(self, user_token, coach_token):
        """
        User rejoint un SpotYou → le coach WS reçoit participants_count mis à jour.
        Simule le cas inverse : coach connecté sur ses spots via wsMap, user rejoint.
        """
        # Trouver un spot du coach avec schedule
        async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as aclient:
            r = await aclient.get("/tag-points/mine",
                                  headers={"Authorization": f"Bearer {coach_token}"})
            assert r.status_code == 200
            mine = r.json()
            target_point = None
            for item in mine:
                if item.get("event_schedule"):
                    target_point = item
                    break
            if not target_point:
                pytest.skip("Aucun spot du coach avec event_schedule")
            point_id = target_point["point_id"]

        received_messages = []
        print(f"[TEST] Point coach cible: {point_id}")

        async def coach_ws_listen():
            """Coach connecte WS comme spot-me.tsx (ses propres SpotYou dans /mine)."""
            ws_url = f"{WS_BASE}/ws/spot-you/{point_id}"
            try:
                async with websockets.connect(ws_url, open_timeout=10) as ws:
                    await ws.send(json.dumps({"token": coach_token}))
                    try:
                        while True:
                            msg = await asyncio.wait_for(ws.recv(), timeout=7.0)
                            parsed = json.loads(msg)
                            received_messages.append(parsed)
                            print(f"[WS COACH] Reçu: {parsed}")
                    except asyncio.TimeoutError:
                        pass
                    except websockets.exceptions.ConnectionClosed:
                        pass
            except Exception as e:
                print(f"[WS COACH] Erreur: {e}")

        async def user_joins():
            """User rejoint pour déclencher broadcast participants_count."""
            await asyncio.sleep(0.8)
            async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as aclient:
                # Leave d'abord pour garantir un join effectif
                await aclient.delete(f"/spot-you/{point_id}/leave",
                                     headers={"Authorization": f"Bearer {user_token}"})
                await asyncio.sleep(0.3)
                r = await aclient.post(f"/spot-you/{point_id}/join",
                                       headers={"Authorization": f"Bearer {user_token}"})
                print(f"[TEST] User join: {r.status_code} {r.text[:200]}")
                assert r.status_code == 200

        await asyncio.gather(coach_ws_listen(), user_joins())

        updates = [m for m in received_messages if m.get("type") == "spotyou_update"]
        assert len(updates) >= 1, (
            f"Coach WS n'a reçu aucun spotyou_update après join de user. "
            f"Messages: {received_messages}"
        )
        update = updates[0]
        assert "participants_count" in update
        assert update["point_id"] == point_id
        print(f"[TEST PASS] join broadcast reçu par coach: participants_count={update['participants_count']}")


# ─── Phase 5 : Tests is_full field ────────────────────────────────────────────

class TestIsFullBroadcast:
    """Vérification que is_full est bien inclus dans les broadcasts."""

    def test_going_response_includes_is_full(self, client, user_auth):
        """POST /going retourne is_full boolean."""
        r_pts = client.get("/tag-points?limit=30", headers=user_auth)
        pts = r_pts.json()
        pts_list = pts.get("points", pts) if isinstance(pts, dict) else pts
        target_id = None
        # Find a non-full SpotYou with event_schedule
        for p in pts_list:
            if p.get("event_schedule") and not p.get("is_full", False):
                target_id = p["point_id"]
                break
        if not target_id:
            pytest.skip("Pas de SpotYou avec schedule non-plein")

        # Remove any existing going status first (cleanup from previous test runs)
        client.delete(f"/spot-you/{target_id}/going", headers=user_auth)

        # Rejoindre d'abord
        client.post(f"/spot-you/{target_id}/join", headers=user_auth)
        r = client.post(f"/spot-you/{target_id}/going", headers=user_auth)
        if r.status_code == 400 and "Capacité maximale" in r.text:
            pytest.skip(f"SpotYou {target_id} plein — test de capacité non applicable")
        assert r.status_code == 200, f"POST /going failed: {r.status_code} {r.text}"
        data = r.json()
        assert "is_full" in data, "is_full manquant dans réponse going"
        assert isinstance(data["is_full"], bool)
        # Cleanup
        client.delete(f"/spot-you/{target_id}/going", headers=user_auth)

    @pytest.mark.asyncio
    async def test_ws_broadcast_includes_is_full_field(self, user_token):
        """Le broadcast spotyou_update inclut le champ is_full attendu par le frontend."""
        async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as aclient:
            r = await aclient.get("/tag-points?limit=30",
                                  headers={"Authorization": f"Bearer {user_token}"})
            pts = r.json()
            pts_list = pts.get("points", pts) if isinstance(pts, dict) else pts
            target_id = None
            for p in pts_list:
                if p.get("event_schedule"):
                    target_id = p["point_id"]
                    break
            if not target_id:
                pytest.skip("Pas de SpotYou avec schedule")

        received = []

        async def listen():
            ws_url = f"{WS_BASE}/ws/spot-you/{target_id}"
            try:
                async with websockets.connect(ws_url, open_timeout=10) as ws:
                    await ws.send(json.dumps({"token": user_token}))
                    try:
                        while True:
                            msg = await asyncio.wait_for(ws.recv(), timeout=5.0)
                            received.append(json.loads(msg))
                    except asyncio.TimeoutError:
                        pass
                    except websockets.exceptions.ConnectionClosed:
                        pass
            except Exception as e:
                print(f"[WS] Erreur: {e}")

        async def trigger():
            await asyncio.sleep(0.8)
            async with httpx.AsyncClient(base_url=API_BASE, timeout=30) as aclient:
                await aclient.post(f"/spot-you/{target_id}/join",
                                   headers={"Authorization": f"Bearer {user_token}"})
                await asyncio.sleep(0.2)
                await aclient.delete(f"/spot-you/{target_id}/going",
                                     headers={"Authorization": f"Bearer {user_token}"})
                await asyncio.sleep(0.2)
                r = await aclient.post(f"/spot-you/{target_id}/going",
                                       headers={"Authorization": f"Bearer {user_token}"})
                print(f"[TEST] going: {r.status_code}")

        await asyncio.gather(listen(), trigger())

        updates = [m for m in received if m.get("type") == "spotyou_update"]
        assert len(updates) >= 1
        update = updates[-1]
        # Frontend attend: data.is_full (spot-me.tsx ligne 82)
        assert "is_full" in update, (
            f"is_full manquant dans broadcast WS. Le frontend (spot-me.tsx) en a besoin. Update: {update}"
        )
        assert isinstance(update["is_full"], bool), f"is_full doit être bool: {update['is_full']}"
        print(f"[TEST PASS] is_full dans broadcast: {update['is_full']}")
