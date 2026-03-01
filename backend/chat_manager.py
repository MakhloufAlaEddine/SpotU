from fastapi import WebSocket
from typing import Dict, List


class ConnectionManager:
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


manager = ConnectionManager()
