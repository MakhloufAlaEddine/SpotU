"""
Tests WebSocket Security — SpotU
==================================
[SEC-14] Token dans l'URL supprimé — handshake JSON
[SEC-15] Anti-spam: taille max (8 Ko → 4009), fréquence (messages droppés)
[SEC-16] Cleanup: connexions mortes nettoyées, finally garanti

Tous les tests utilisent asyncio.run() dans des fonctions pytest synchrones
(pas besoin de pytest-asyncio).

Usage:
    cd /app/backend
    JWT_SECRET=<secret> python -m pytest tests/test_websocket_security.py -v
"""
import asyncio
import json
import uuid
import httpx
import pytest
import websockets
import websockets.exceptions

API_URL = "http://localhost:8001"
WS_URL  = "ws://localhost:8001"

USER_CREDS  = {"email": "user@winek.app",  "password": "WinekUser2024!"}
COACH_CREDS = {"email": "coach@winek.app", "password": "WinekCoach2024!"}


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _get_token(creds: dict) -> str:
    """Retourne un JWT valide avec IP unique (évite le rate limit)."""
    unique_ip = f"10.{uuid.uuid4().int % 254 + 1}.{uuid.uuid4().int % 254 + 1}.{uuid.uuid4().int % 254 + 1}"
    resp = httpx.post(
        f"{API_URL}/api/auth/login",
        json=creds,
        headers={"X-Forwarded-For": unique_ip},
        timeout=10,
    )
    assert resp.status_code == 200, f"Login échoué: {resp.text}"
    return resp.json()["token"]


def _get_or_create_conv(token: str) -> str:
    """Retourne l'ID d'une conversation dont l'utilisateur est membre."""
    # Récupérer la liste des conversations existantes
    resp = httpx.get(
        f"{API_URL}/api/conversations",
        headers={"Authorization": f"Bearer {token}"},
        timeout=10,
    )
    if resp.status_code == 200 and resp.json():
        return resp.json()[0]["conversation_id"]

    # Pas de conv existante : créer via le premier service disponible
    svc_resp = httpx.get(
        f"{API_URL}/api/services",
        headers={"Authorization": f"Bearer {token}"},
        timeout=10,
    )
    assert svc_resp.status_code == 200 and svc_resp.json(), "Aucun service disponible"
    service_id = svc_resp.json()[0]["service_id"]
    conv_resp = httpx.post(
        f"{API_URL}/api/conversations",
        json={"type": "service", "context_id": service_id},
        headers={"Authorization": f"Bearer {token}"},
        timeout=10,
    )
    assert conv_resp.status_code == 200, f"Création conv échouée: {conv_resp.text}"
    return conv_resp.json()["conversation_id"]


async def _ws_get_close_code(url: str, first_msg: dict, timeout: float = 3.0) -> int:
    """
    Se connecte, envoie first_msg, attend la fermeture.
    Retourne le code de fermeture reçu.
    """
    try:
        async with websockets.connect(url) as ws:
            await ws.send(json.dumps(first_msg))
            try:
                # Attendre soit un message soit la fermeture
                await asyncio.wait_for(ws.recv(), timeout=timeout)
                # Si on reçoit un message, continuer à attendre la fermeture
                await asyncio.wait_for(ws.recv(), timeout=timeout)
                return -1  # Pas fermé → pas attendu
            except asyncio.TimeoutError:
                return -2  # Timeout sans fermeture
            except websockets.exceptions.ConnectionClosed as exc:
                return exc.rcvd.code if exc.rcvd else 1000
    except websockets.exceptions.ConnectionClosed as exc:
        return exc.rcvd.code if exc.rcvd else 1000


# ═══════════════════════════════════════════════════════════════════════════════
# [SEC-14] Token dans l'URL — Notifications
# ═══════════════════════════════════════════════════════════════════════════════

class TestSEC14_TokenHandshake_Notifications:

    def test_connexion_sans_token_retourne_4001(self):
        """SEC-14: Envoi de {} (pas de clé token) → close 4001."""
        async def run():
            code = await _ws_get_close_code(
                f"{WS_URL}/api/ws/notifications",
                {"no_token": "here"},
            )
            return code
        code = asyncio.run(run())
        assert code == 4001, f"Attendu 4001, obtenu {code}"

    def test_connexion_token_invalide_retourne_4001(self):
        """SEC-14: Token forgé/invalide → close 4001."""
        async def run():
            code = await _ws_get_close_code(
                f"{WS_URL}/api/ws/notifications",
                {"token": "header.payload.invalidsignature"},
            )
            return code
        code = asyncio.run(run())
        assert code == 4001, f"Attendu 4001, obtenu {code}"

    def test_connexion_token_valide_reste_ouverte(self):
        """SEC-14: Token valide → connexion ouverte, reçoit les compteurs initiaux."""
        async def run():
            token = _get_token(USER_CREDS)
            async with websockets.connect(f"{WS_URL}/api/ws/notifications") as ws:
                # Handshake
                await ws.send(json.dumps({"token": token}))
                # Recevoir au moins un message (compteurs initiaux)
                msg_raw = await asyncio.wait_for(ws.recv(), timeout=5.0)
                msg = json.loads(msg_raw)
                return msg
        msg = asyncio.run(run())
        assert "type" in msg, f"Message inattendu: {msg}"
        assert msg["type"] in ("unread_total", "unread_notif"), f"Type inattendu: {msg['type']}"

    def test_url_ne_contient_pas_token_query_param(self):
        """SEC-14: L'URL de connexion ne doit pas contenir ?token= (vérification statique)."""
        with open("/app/frontend/lib/chat.ts", encoding="utf-8") as f:
            src = f.read()
        assert "notifications?token=" not in src, \
            "FAIL: ?token= encore présent dans l'URL WebSocket notifications"
        assert "chat/${conversationId}?token=" not in src, \
            "FAIL: ?token= encore présent dans l'URL WebSocket chat"


# ═══════════════════════════════════════════════════════════════════════════════
# [SEC-14] Token dans l'URL — Chat
# ═══════════════════════════════════════════════════════════════════════════════

class TestSEC14_TokenHandshake_Chat:

    def test_chat_sans_token_retourne_4001(self):
        """SEC-14: Chat sans token → close 4001."""
        async def run():
            code = await _ws_get_close_code(
                f"{WS_URL}/api/ws/chat/fake_conv_id",
                {"no_token": "here"},
            )
            return code
        code = asyncio.run(run())
        assert code == 4001, f"Attendu 4001, obtenu {code}"

    def test_chat_token_invalide_retourne_4001(self):
        """SEC-14: Chat avec token forgé → close 4001."""
        async def run():
            code = await _ws_get_close_code(
                f"{WS_URL}/api/ws/chat/fake_conv_id",
                {"token": "bad.token.here"},
            )
            return code
        code = asyncio.run(run())
        assert code == 4001, f"Attendu 4001, obtenu {code}"

    def test_chat_conv_inconnue_retourne_4003(self):
        """SEC-14: Token valide mais conv inexistante (pas membre) → close 4003."""
        async def run():
            token = _get_token(USER_CREDS)
            code = await _ws_get_close_code(
                f"{WS_URL}/api/ws/chat/conv_inexistante_xyz_test",
                {"token": token},
            )
            return code
        code = asyncio.run(run())
        assert code == 4003, f"Attendu 4003, obtenu {code}"

    def test_chat_token_valide_conv_valide_reste_ouvert(self):
        """SEC-14: Token valide + conv valide → connexion établie."""
        async def run():
            token = _get_token(USER_CREDS)
            conv_id = _get_or_create_conv(token)
            connected = False
            async with websockets.connect(f"{WS_URL}/api/ws/chat/{conv_id}") as ws:
                await ws.send(json.dumps({"token": token}))
                # La connexion doit rester ouverte pendant 1 seconde
                try:
                    await asyncio.wait_for(ws.recv(), timeout=1.0)
                except asyncio.TimeoutError:
                    connected = True  # Pas fermé dans le timeout = connexion active
            return connected
        connected = asyncio.run(run())
        assert connected, "La connexion chat a été fermée de façon inattendue"


# ═══════════════════════════════════════════════════════════════════════════════
# [SEC-15] Anti-spam
# ═══════════════════════════════════════════════════════════════════════════════

class TestSEC15_AntiSpam:

    def test_message_superieur_8kb_ferme_4009(self):
        """SEC-15: Message > 8 Ko → close 4009."""
        async def run():
            token = _get_token(USER_CREDS)
            conv_id = _get_or_create_conv(token)
            oversized_content = "X" * 9000  # 9 Ko > 8 Ko

            async with websockets.connect(f"{WS_URL}/api/ws/chat/{conv_id}") as ws:
                # Handshake
                await ws.send(json.dumps({"token": token}))
                await asyncio.sleep(0.3)  # Laisser le handshake se finaliser

                # Envoyer un message géant
                await ws.send(json.dumps({"content": oversized_content}))

                try:
                    await asyncio.wait_for(ws.recv(), timeout=3.0)
                    return -1
                except websockets.exceptions.ConnectionClosed as exc:
                    return exc.rcvd.code if exc.rcvd else 1000
                except asyncio.TimeoutError:
                    return -2

        code = asyncio.run(run())
        assert code == 4009, f"Attendu 4009 (msg trop grand), obtenu {code}"

    def test_spam_messages_survit_pas_de_crash(self):
        """
        SEC-15: Envoyer 20 messages en rafale ne doit pas crasher le serveur
        (les messages excédentaires sont droppés silencieusement).
        Le serveur doit rester accessible après.
        """
        async def run():
            token = _get_token(USER_CREDS)
            conv_id = _get_or_create_conv(token)
            closed_unexpectedly = False

            async with websockets.connect(f"{WS_URL}/api/ws/chat/{conv_id}") as ws:
                await ws.send(json.dumps({"token": token}))
                await asyncio.sleep(0.3)

                # Envoyer 20 messages en rafale (bien < 8 Ko chacun)
                for i in range(20):
                    try:
                        await ws.send(json.dumps({"content": f"spam message {i}"}))
                    except websockets.exceptions.ConnectionClosed:
                        closed_unexpectedly = True
                        break
                # Attendre un peu pour voir si la connexion tient
                await asyncio.sleep(0.5)

            return not closed_unexpectedly

        survived = asyncio.run(run())
        assert survived, "La connexion a été fermée pendant un spam de messages (non attendu)"

        # Le serveur doit toujours répondre
        resp = httpx.get(f"{API_URL}/api/domains", timeout=5)
        assert resp.status_code == 200, "Le serveur ne répond plus après le spam"


# ═══════════════════════════════════════════════════════════════════════════════
# [SEC-16] Cleanup — Analyse statique
# ═══════════════════════════════════════════════════════════════════════════════

class TestSEC16_Cleanup:

    @classmethod
    def _chat_src(cls) -> str:
        with open("/app/backend/routes/chat_routes.py", encoding="utf-8") as f:
            return f.read()

    @classmethod
    def _manager_src(cls) -> str:
        with open("/app/backend/chat_manager.py", encoding="utf-8") as f:
            return f.read()

    def test_ws_chat_a_finally_disconnect(self):
        """SEC-16: ws_chat doit avoir un bloc finally avec manager.disconnect."""
        src = self._chat_src()
        assert "finally:" in src, "FAIL: bloc finally absent de chat_routes.py"
        assert "manager.disconnect(conv_id, websocket)" in src, \
            "FAIL: manager.disconnect absent du finally de ws_chat"

    def test_ws_notifications_a_finally_disconnect(self):
        """SEC-16: ws_notifications doit avoir un bloc finally avec notif_manager.disconnect."""
        src = self._chat_src()
        assert "notif_manager.disconnect(user_id, websocket)" in src, \
            "FAIL: notif_manager.disconnect absent du finally de ws_notifications"

    def test_pas_d_except_silencieux_dans_ws_handlers(self):
        """SEC-16: Plus d'except vides (pass) dans les handlers WS principaux."""
        import re
        src = self._chat_src()
        # Chercher des blocs except: pass ou except Exception: pass dans les handlers WS
        silent = re.findall(r"except\s+(?:Exception|WebSocketDisconnect)?\s*:\s*\n\s*pass", src)
        assert not silent, f"FAIL: except silencieux trouvés: {silent}"

    def test_broadcast_nettoie_connexions_mortes(self):
        """SEC-16: broadcast() doit logger et nettoyer les connexions mortes."""
        src = self._manager_src()
        assert "dead" in src, "FAIL: liste 'dead' absente de broadcast()"
        assert "logger.warning" in src, "FAIL: log warning absent du manager"

    def test_notify_nettoie_connexions_mortes(self):
        """SEC-16: notify() doit logger et nettoyer les connexions mortes."""
        src = self._manager_src()
        # Les deux méthodes (broadcast et notify) doivent nettoyer
        dead_count = src.count("dead")
        assert dead_count >= 2, \
            f"FAIL: 'dead' trouvé {dead_count} fois, attendu >= 2 (broadcast + notify)"

    def test_no_token_in_ws_url_backend(self):
        """SEC-14/SEC-16: Les routes WS backend n'utilisent plus token: str = Query(...)."""
        src = self._chat_src()
        assert "token: str = Query" not in src, \
            "FAIL: token encore en Query param dans les routes WS"
        assert "token: str = Query(...)" not in src, \
            "FAIL: token encore en Query param"

    def test_handshake_timeout_present(self):
        """SEC-14: asyncio.wait_for avec timeout 5.0 présent pour le handshake."""
        src = self._chat_src()
        assert "asyncio.wait_for" in src, "FAIL: asyncio.wait_for absent"
        assert "timeout=5.0" in src, "FAIL: timeout=5.0 absent du handshake"

    def test_msg_size_limit_constant_present(self):
        """SEC-15: Constante MSG_MAX_BYTES présente."""
        src = self._chat_src()
        assert "MSG_MAX_BYTES" in src, "FAIL: MSG_MAX_BYTES absent"
        assert "8192" in src, "FAIL: valeur 8 Ko absente"

    def test_msg_frequency_limit_constant_present(self):
        """SEC-15: Constante MSG_MIN_INTERVAL présente."""
        src = self._chat_src()
        assert "MSG_MIN_INTERVAL" in src, "FAIL: MSG_MIN_INTERVAL absent"
        assert "0.5" in src, "FAIL: valeur 500ms absente"
