"""
Gestionnaires de connexions WebSocket — SpotU
================================================
[SEC-16] Corrections :
  - broadcast/notify logguent et nettoient les connexions mortes
  - add() sépare "accepter" (fait dans la route) de "enregistrer"
  - Pas de leak : les connexions mortes sont retirées de active
"""
from fastapi import WebSocket
from typing import Dict, List
import logging

logger = logging.getLogger(__name__)


class ConnectionManager:
    """WebSocket par conversation."""

    def __init__(self):
        self.active: Dict[str, List[WebSocket]] = {}

    def add(self, conv_id: str, ws: WebSocket):
        """
        Enregistre une connexion déjà acceptée.
        L'appel à ws.accept() est fait dans la route, pas ici.
        """
        self.active.setdefault(conv_id, []).append(ws)

    def disconnect(self, conv_id: str, ws: WebSocket):
        if conv_id in self.active:
            self.active[conv_id] = [w for w in self.active[conv_id] if w is not ws]

    async def broadcast(self, conv_id: str, payload: dict):
        """
        Diffuse à tous les membres d'une conversation.
        [SEC-16] Nettoie silencieusement les connexions mortes après chaque diffusion.
        """
        dead: List[WebSocket] = []
        for ws in list(self.active.get(conv_id, [])):
            try:
                await ws.send_json(payload)
            except Exception as exc:
                logger.warning(
                    "[WS] broadcast: connexion morte (conv=%s) — %s", conv_id, exc
                )
                dead.append(ws)
        for ws in dead:
            self.disconnect(conv_id, ws)


class NotificationManager:
    """WebSocket de notifications par utilisateur."""

    def __init__(self):
        self.active: Dict[str, List[WebSocket]] = {}

    def add(self, user_id: str, ws: WebSocket):
        """
        Enregistre une connexion déjà acceptée.
        L'appel à ws.accept() est fait dans la route, pas ici.
        """
        self.active.setdefault(user_id, []).append(ws)

    def disconnect(self, user_id: str, ws: WebSocket):
        if user_id in self.active:
            self.active[user_id] = [w for w in self.active[user_id] if w is not ws]

    async def notify(self, user_id: str, payload: dict):
        """
        Notifie un utilisateur.
        [SEC-16] Nettoie silencieusement les connexions mortes.
        """
        dead: List[WebSocket] = []
        for ws in list(self.active.get(user_id, [])):
            try:
                await ws.send_json(payload)
            except Exception as exc:
                logger.warning(
                    "[WS] notify: connexion morte (user=%s) — %s", user_id, exc
                )
                dead.append(ws)
        for ws in dead:
            self.disconnect(user_id, ws)


manager = ConnectionManager()
notif_manager = NotificationManager()
