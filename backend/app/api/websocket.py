"""
WebSocket endpoint and connection manager.

This module exposes a single WebSocket endpoint that clients can
subscribe to in order to receive live updates from simulations.
Connections are maintained in a simple manager that broadcasts
messages to all active subscribers. In this implementation, all
simulations broadcast on the same channel; clients should filter
events client‑side based on simulation IDs if necessary.
"""

from __future__ import annotations

from typing import List

from fastapi import WebSocket, WebSocketDisconnect, APIRouter


class ConnectionManager:
    """Manage active WebSocket connections."""

    def __init__(self) -> None:
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast_json(self, message: dict) -> None:
        """Send a JSON‑serialisable message to all active connections."""
        for connection in list(self.active_connections):
            try:
                await connection.send_json(message)
            except Exception:
                # Remove broken connections silently
                self.disconnect(connection)


router = APIRouter()
manager = ConnectionManager()


@router.websocket("/ws/simulation")
async def websocket_endpoint(websocket: WebSocket) -> None:
    """WebSocket endpoint that streams live simulation events to connected clients."""
    await manager.connect(websocket)
    try:
        while True:
            # We don't expect to receive messages from the client. However,
            # to keep the connection alive we wait for any message. If the
            # client closes the socket, an exception is raised and caught.
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)