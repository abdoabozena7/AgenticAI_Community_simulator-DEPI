"""
WebSocket endpoint and connection manager.

This module exposes a single WebSocket endpoint that clients can
subscribe to in order to receive live updates from simulations.
Connections are maintained in a simple manager that broadcasts
messages only to subscribed clients. Clients must authenticate with
an access token when AUTH_REQUIRED is enabled.
"""

from __future__ import annotations

import asyncio
from typing import Dict, Optional, Set
import json
import os

from fastapi import WebSocket, WebSocketDisconnect, APIRouter

from ..core import auth as auth_core
from ..core import db as db_core


class ConnectionInfo:
    def __init__(self, websocket: WebSocket, user_id: Optional[int], is_admin: bool) -> None:
        self.websocket = websocket
        self.user_id = user_id
        self.is_admin = is_admin
        self.subscriptions: Set[str] = set()
        self.send_lock = asyncio.Lock()


class ConnectionManager:
    """Manage active WebSocket connections."""

    def __init__(self) -> None:
        self.active_connections: Dict[WebSocket, ConnectionInfo] = {}

    async def connect(self, websocket: WebSocket, user_id: Optional[int], is_admin: bool) -> None:
        await websocket.accept()
        self.active_connections[websocket] = ConnectionInfo(websocket, user_id, is_admin)

    def disconnect(self, websocket: WebSocket) -> None:
        if websocket in self.active_connections:
            self.active_connections.pop(websocket, None)

    def subscribe(self, websocket: WebSocket, simulation_id: str, replace: bool = False) -> None:
        info = self.active_connections.get(websocket)
        if not info:
            return
        if replace:
            info.subscriptions = {simulation_id}
        else:
            info.subscriptions.add(simulation_id)

    async def broadcast_json(self, message: dict) -> None:
        """Send a JSON-serialisable message to subscribed connections."""
        simulation_id = message.get("simulation_id")
        try:
            send_timeout = float(os.getenv("WS_SEND_TIMEOUT_SEC", "1.5") or 1.5)
        except Exception:
            send_timeout = 1.5
        send_timeout = max(0.25, send_timeout)

        targets: list[tuple[WebSocket, ConnectionInfo]] = []
        for connection, info in list(self.active_connections.items()):
            if simulation_id and not info.is_admin and simulation_id not in info.subscriptions:
                continue
            targets.append((connection, info))

        async def _send_one(connection: WebSocket, info: ConnectionInfo) -> bool:
            try:
                async with info.send_lock:
                    await asyncio.wait_for(connection.send_json(message), timeout=send_timeout)
                return True
            except Exception:
                return False

        if not targets:
            return

        results = await asyncio.gather(*[_send_one(connection, info) for connection, info in targets], return_exceptions=False)
        for idx, ok in enumerate(results):
            if not ok:
                self.disconnect(targets[idx][0])


router = APIRouter()
manager = ConnectionManager()


@router.websocket("/ws/simulation")
async def websocket_endpoint(websocket: WebSocket) -> None:
    """WebSocket endpoint that streams live simulation events to connected clients."""
    auth_required = os.getenv("AUTH_REQUIRED", "false").lower() in {"1", "true", "yes"}
    token = websocket.query_params.get("token")
    user = await auth_core.get_user_by_token(token) if token else None
    if auth_required and not user:
        await websocket.close(code=1008)
        return
    user_id = int(user.get("id")) if user else None
    is_admin = bool(user and (user.get("role") or "").lower() == "admin")

    await manager.connect(websocket, user_id, is_admin)
    try:
        while True:
            raw = await websocket.receive_text()
            if not raw:
                continue
            try:
                data = json.loads(raw)
            except Exception:
                continue
            if not isinstance(data, dict):
                continue
            if data.get("type") == "subscribe":
                sim_id = str(data.get("simulation_id") or "").strip()
                replace = bool(data.get("replace"))
                if not sim_id:
                    continue
                if not user and auth_required:
                    continue
                if not user and not auth_required:
                    manager.subscribe(websocket, sim_id, replace=replace)
                    continue
                if is_admin:
                    manager.subscribe(websocket, sim_id, replace=replace)
                    continue
                owner_id = await db_core.get_simulation_owner(sim_id)
                if owner_id is not None and int(owner_id) == int(user_id or 0):
                    manager.subscribe(websocket, sim_id, replace=replace)
                else:
                    await websocket.send_json({"type": "error", "message": "Not authorized"})
    except WebSocketDisconnect:
        manager.disconnect(websocket)

