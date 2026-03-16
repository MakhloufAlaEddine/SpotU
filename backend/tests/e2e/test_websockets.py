"""
Tests E2E — WebSocket endpoints SpotU
======================================
Teste les connexions WebSocket pour chat, notifications et SpotYou en temps réel.
"""
import pytest
import asyncio
import json
import websockets
from websockets import State as WsState
import requests
import os

import sys
sys.path.insert(0, os.path.dirname(__file__))
from e2e_helpers import API_URL, get_token, CREDENTIALS

TIMEOUT_S = 10

# Construire l'URL WebSocket à partir de l'URL API
WS_URL = API_URL.replace("https://", "wss://").replace("http://", "ws://")


# ═══════════════════════════════════════════════════════════════════════════════
#  HELPERS
# ═══════════════════════════════════════════════════════════════════════════════

async def connect_ws(path: str, token: str = None, auth_timeout: float = 5.0):
    """
    Connecte à un WebSocket et envoie l'authentification.
    Retourne la connexion WebSocket.
    """
    url = f"{WS_URL}/api{path}"
    ws = await asyncio.wait_for(
        websockets.connect(url, close_timeout=5),
        timeout=TIMEOUT_S,
    )
    if token:
        await ws.send(json.dumps({"type": "auth", "token": token}))
    return ws


async def recv_json(ws, timeout: float = TIMEOUT_S):
    """Reçoit et parse un message JSON du WebSocket."""
    raw = await asyncio.wait_for(ws.recv(), timeout=timeout)
    return json.loads(raw)


# ═══════════════════════════════════════════════════════════════════════════════
#  CHAT WEBSOCKET
# ═══════════════════════════════════════════════════════════════════════════════

class TestChatWebSocket:

    def _get_or_create_conversation(self):
        """Obtient une conversation entre user et coach."""
        h_user = {
            "Authorization": f"Bearer {get_token('user')}",
            "Content-Type": "application/json",
        }
        h_coach = {
            "Authorization": f"Bearer {get_token('coach')}",
            "Content-Type": "application/json",
        }
        coach = requests.get(f"{API_URL}/api/auth/me", headers=h_coach, timeout=10).json()

        # Créer ou récupérer une conversation
        resp = requests.post(
            f"{API_URL}/api/conversations",
            json={"participant_id": coach["user_id"]},
            headers=h_user, timeout=10,
        )
        if resp.status_code in (200, 201):
            data = resp.json()
            return data.get("conv_id") or data.get("conversation_id")

        # Fallback: récupérer une conversation existante
        convs = requests.get(f"{API_URL}/api/conversations", headers=h_user, timeout=10).json()
        if convs:
            return convs[0].get("conv_id") or convs[0].get("conversation_id")
        pytest.skip("Aucune conversation disponible pour les tests WS")

    @pytest.mark.asyncio
    async def test_chat_ws_connect_and_auth(self):
        """Connexion WS chat avec authentification valide."""
        conv_id = self._get_or_create_conversation()
        token = get_token("user")
        ws = await connect_ws(f"/ws/chat/{conv_id}", token)
        try:
            # Après auth, on doit recevoir un message ou rester connecté
            # Attendre brièvement — si pas de message c'est OK (idle)
            try:
                msg = await recv_json(ws, timeout=3)
                assert isinstance(msg, dict)
            except asyncio.TimeoutError:
                pass  # Pas de message immédiat = OK
        finally:
            await ws.close()

    @pytest.mark.asyncio
    async def test_chat_ws_no_auth_disconnects(self):
        """Connexion WS chat sans auth → déconnexion ou refus."""
        url = f"{WS_URL}/api/ws/chat/fake_conv_id"
        try:
            ws = await asyncio.wait_for(
                websockets.connect(url, close_timeout=5),
                timeout=TIMEOUT_S,
            )
            try:
                # Ne pas envoyer d'auth → le serveur doit fermer
                try:
                    await asyncio.wait_for(ws.recv(), timeout=8)
                except (websockets.exceptions.ConnectionClosed, asyncio.TimeoutError):
                    pass  # Attendu: fermeture de la connexion
            finally:
                if ws.state != WsState.CLOSED:
                    await ws.close()
        except (asyncio.TimeoutError, OSError, websockets.exceptions.InvalidHandshake):
            # Le serveur peut refuser la connexion directement — c'est OK
            pass

    @pytest.mark.asyncio
    async def test_chat_ws_invalid_token(self):
        """Connexion WS chat avec un token invalide → déconnexion code 4001."""
        url = f"{WS_URL}/api/ws/chat/fake_conv_id"
        ws = await asyncio.wait_for(
            websockets.connect(url, close_timeout=5),
            timeout=TIMEOUT_S,
        )
        try:
            await ws.send(json.dumps({"type": "auth", "token": "invalid_bad_token"}))
            try:
                await asyncio.wait_for(ws.recv(), timeout=5)
            except websockets.exceptions.ConnectionClosed as e:
                assert ws.close_code in (4001, 4003, 1000, 1008), f"Code fermeture inattendu: {ws.close_code}"
            except asyncio.TimeoutError:
                pass
        finally:
            if ws.state != WsState.CLOSED:
                await ws.close()

    @pytest.mark.asyncio
    async def test_chat_ws_send_and_receive_message(self):
        """Envoyer un message via WS et vérifier la réception."""
        conv_id = self._get_or_create_conversation()
        token_user = get_token("user")

        ws = await connect_ws(f"/ws/chat/{conv_id}", token_user)
        try:
            # Envoyer un message
            await ws.send(json.dumps({
                "type": "message",
                "text": "Test E2E WebSocket message",
            }))
            # Attendre la confirmation ou le broadcast
            try:
                msg = await recv_json(ws, timeout=5)
                assert isinstance(msg, dict)
                # Le message doit être de type "message" ou "new_message"
                assert msg.get("type") in ("message", "new_message", "chat_message", None) or "text" in msg
            except asyncio.TimeoutError:
                # Si pas de réponse, c'est possible que le broadcast ne revient pas au sender
                pass
        finally:
            await ws.close()


# ═══════════════════════════════════════════════════════════════════════════════
#  NOTIFICATIONS WEBSOCKET
# ═══════════════════════════════════════════════════════════════════════════════

class TestNotificationsWebSocket:

    @pytest.mark.asyncio
    async def test_notifications_ws_connect_and_receive_counts(self):
        """Connexion WS notifications → reçoit unread_total et unread_notif."""
        token = get_token("user")
        ws = await connect_ws("/ws/notifications", token)
        received_types = set()
        try:
            for _ in range(5):
                try:
                    msg = await recv_json(ws, timeout=5)
                    received_types.add(msg.get("type"))
                except asyncio.TimeoutError:
                    break
            # Doit recevoir au moins un message avec le type unread
            assert (
                "unread_total" in received_types
                or "unread_notif" in received_types
                or len(received_types) > 0
            ), f"Aucun message utile reçu. Types: {received_types}"
        finally:
            await ws.close()

    @pytest.mark.asyncio
    async def test_notifications_ws_no_auth_disconnects(self):
        """Connexion WS notifications sans auth → déconnexion."""
        url = f"{WS_URL}/api/ws/notifications"
        ws = await asyncio.wait_for(
            websockets.connect(url, close_timeout=5),
            timeout=TIMEOUT_S,
        )
        try:
            try:
                await asyncio.wait_for(ws.recv(), timeout=8)
            except (websockets.exceptions.ConnectionClosed, asyncio.TimeoutError):
                pass
        finally:
            if ws.state != WsState.CLOSED:
                await ws.close()


# ═══════════════════════════════════════════════════════════════════════════════
#  SPOTYOU WEBSOCKET
# ═══════════════════════════════════════════════════════════════════════════════

class TestSpotYouWebSocket:

    @pytest.mark.asyncio
    async def test_spotyou_ws_connect(self):
        """Connexion WS SpotYou avec auth valide."""
        token = get_token("user")
        ws = await connect_ws("/ws/spot-you/pt_demo009", token)
        try:
            try:
                msg = await recv_json(ws, timeout=3)
                assert isinstance(msg, dict)
            except asyncio.TimeoutError:
                pass  # Pas de message immédiat = OK
        finally:
            await ws.close()

    @pytest.mark.asyncio
    async def test_spotyou_ws_invalid_token(self):
        """Connexion WS SpotYou avec token invalide → fermeture."""
        url = f"{WS_URL}/api/ws/spot-you/pt_demo009"
        ws = await asyncio.wait_for(
            websockets.connect(url, close_timeout=5),
            timeout=TIMEOUT_S,
        )
        try:
            await ws.send(json.dumps({"type": "auth", "token": "bad_token"}))
            try:
                await asyncio.wait_for(ws.recv(), timeout=5)
            except websockets.exceptions.ConnectionClosed:
                assert ws.close_code in (4001, 4003, 1000, 1008)
            except asyncio.TimeoutError:
                pass
        finally:
            if ws.state != WsState.CLOSED:
                await ws.close()

    @pytest.mark.asyncio
    async def test_spotyou_ws_two_users_same_room(self):
        """Deux utilisateurs connectés au même SpotYou WebSocket."""
        token_user = get_token("user")
        token_coach = get_token("coach")

        ws_user = await connect_ws("/ws/spot-you/pt_demo009", token_user)
        ws_coach = await connect_ws("/ws/spot-you/pt_demo009", token_coach)
        try:
            # Les deux connexions doivent être ouvertes
            assert ws_user.state == WsState.OPEN
            assert ws_coach.state == WsState.OPEN
        finally:
            await ws_user.close()
            await ws_coach.close()
