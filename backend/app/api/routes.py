"""
REST API routes for the social simulation backend.

This module defines endpoints to start a simulation and retrieve final
metrics. The simulation runs asynchronously in the background and
emits events over WebSocket as it progresses. State is cached in
memory so clients can poll the REST API for the latest snapshot when
WebSocket connectivity is unavailable.
"""

from __future__ import annotations

import asyncio
import uuid
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, status

from ..core.dataset_loader import Dataset
from ..simulation.engine import SimulationEngine
from ..api.websocket import manager


router = APIRouter(prefix="/simulation")

# Global dictionaries to track simulation tasks, results, and live state
_simulation_tasks: Dict[str, asyncio.Task] = {}
_simulation_results: Dict[str, Dict[str, Any]] = {}
_simulation_state: Dict[str, Dict[str, Any]] = {}

# Reference to the loaded dataset (set in main module at startup)
dataset: Optional[Dataset] = None


def _init_state(simulation_id: str) -> None:
    """Initialise the in-memory state container for a new simulation."""
    _simulation_state[simulation_id] = {
        "agents": [],
        "reasoning": [],
        "metrics": None,
    }


def _store_event(simulation_id: str, event_type: str, data: Dict[str, Any]) -> None:
    """Update the cached state for the given simulation.

    Depending on the event type, the relevant portion of the state is
    updated. For reasoning steps, only the most recent 200 entries are
    retained to bound memory usage.
    """
    state = _simulation_state.setdefault(
        simulation_id,
        {"agents": [], "reasoning": [], "metrics": None},
    )
    if event_type == "agents":
        state["agents"] = data.get("agents", [])
    elif event_type == "metrics":
        state["metrics"] = data
    elif event_type == "reasoning_step":
        reasoning = state["reasoning"]
        reasoning.append(data)
        # Trim to last 200 events
        if len(reasoning) > 200:
            state["reasoning"] = reasoning[-200:]


@router.post("/start")
async def start_simulation(user_context: Dict[str, Any]) -> Dict[str, Any]:
    """Initialise a new simulation.

    Accepts user-provided context (structured data) and kicks off a
    background simulation. Returns a unique simulation identifier so
    clients can subscribe to WebSocket updates or poll the REST API.
    """
    global dataset
    if dataset is None:
        raise HTTPException(status_code=500, detail="Dataset not loaded")
    # Generate a unique ID for this simulation
    simulation_id = str(uuid.uuid4())
    _init_state(simulation_id)
    # Create a simulation engine instance
    engine = SimulationEngine(dataset=dataset)

    async def emitter(event_type: str, data: Dict[str, Any]) -> None:
        """Broadcast events and store a snapshot for polling."""
        payload = {"type": event_type, **data}
        # Broadcast to all connected WebSocket clients
        await manager.broadcast_json(payload)
        # Persist state for REST polling
        _store_event(simulation_id, event_type, data)

    # Define a coroutine that runs the simulation and stores results
    async def run_and_store() -> None:
        try:
            result = await engine.run_simulation(user_context=user_context, emitter=emitter)
            _simulation_results[simulation_id] = result
        except Exception as exc:  # noqa: BLE001
            _simulation_state.setdefault(simulation_id, {})["error"] = str(exc)
    # Launch simulation in background
    task = asyncio.create_task(run_and_store())
    _simulation_tasks[simulation_id] = task
    return {"simulation_id": simulation_id, "status": "running"}


@router.get("/result")
async def get_result(simulation_id: str) -> Dict[str, Any]:
    """Retrieve final aggregated metrics for a completed simulation.

    If the simulation is still running or unknown, returns an
    appropriate status message. The final metrics are taken from the
    result stored after the simulation coroutine completes.
    """
    # Check if we have a stored result
    if simulation_id in _simulation_results:
        return {
            "simulation_id": simulation_id,
            "status": "completed",
            "metrics": _simulation_results[simulation_id],
        }
    # If still running
    task = _simulation_tasks.get(simulation_id)
    if task is not None and not task.done():
        return {"simulation_id": simulation_id, "status": "running"}
    # Unknown simulation
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Simulation not found")


@router.get("/state")
async def get_state(simulation_id: str) -> Dict[str, Any]:
    """Retrieve latest simulation state for polling clients."""
    state = _simulation_state.get(simulation_id)
    if state is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Simulation not found")
    status_value = "running"
    if simulation_id in _simulation_results:
        status_value = "completed"
    else:
        task = _simulation_tasks.get(simulation_id)
        if task is None or task.done():
            status_value = "completed"
    return {"simulation_id": simulation_id, "status": status_value, **state}