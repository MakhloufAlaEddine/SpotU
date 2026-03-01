from fastapi import WebSocket
from typing import Dict, List


class ConnectionManager:
    """WebSocket par conversation."""
    def __init__(self):
        self.active: Dict[str, List[WebSocket]] = {}

    async def connect(self, conv_id: str, ws: WebSocket):
        await ws.accept()
        self.active.setdefault(conv_id, []).append(ws)

    def disconnect(self, conv_id: str, ws: WebSocket):
        if conv_id in self.active:
            self.active[conv_id] = [w for w in self.active[conv_id] if w is not ws]

    async def broadcast(self, conv_id: str, payload: dict):
        for ws in list(self.active.get(conv_id, [])):
            try:
                await ws.send_json(payload)
            except Exception:
                pass


class NotificationManager:
    """WebSocket de notifications par utilisateur (unread count, etc.)."""
    def __init__(self):
        self.active: Dict[str, List[WebSocket]] = {}  # user_id → [ws, ...]

    async def connect(self, user_id: str, ws: WebSocket):
        await ws.accept()
        self.active.setdefault(user_id, []).append(ws)

    def disconnect(self, user_id: str, ws: WebSocket):
        if user_id in self.active:
            self.active[user_id] = [w for w in self.active[user_id] if w is not ws]

    async def notify(self, user_id: str, payload: dict):
        for ws in list(self.active.get(user_id, [])):
            try:
                await ws.send_json(payload)
            except Exception:
                pass


manager = ConnectionManager()
notif_manager = NotificationManager()
