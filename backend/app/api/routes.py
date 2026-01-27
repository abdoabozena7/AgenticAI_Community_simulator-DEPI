"""
REST API routes for the social simulation backend.

This module defines endpoints to start a simulation and retrieve final
metrics. The simulation runs asynchronously in the background and
emits events over WebSocket as it progresses.
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

# Global dictionaries to track simulation tasks and results
_simulation_tasks: Dict[str, asyncio.Task] = {}
_simulation_results: Dict[str, Dict[str, Any]] = {}

# Reference to the loaded dataset (set in main module)
dataset: Optional[Dataset] = None


async def _emitter(event_type: str, data: Dict[str, Any]) -> None:
    """Wrapper around the WebSocket manager to broadcast events.

    Each emitted event includes a type field so the frontend can route
    updates appropriately.
    """
    payload = {"type": event_type, **data}
    await manager.broadcast_json(payload)


@router.post("/start")
async def start_simulation(user_context: Dict[str, Any]) -> Dict[str, Any]:
    """Initialize a new simulation.

    Accepts user-provided context (structured data) and kicks off a
    background simulation. Returns a unique simulation identifier.
    """
    global dataset
    if dataset is None:
        raise HTTPException(status_code=500, detail="Dataset not loaded")
    # Generate a unique ID for this simulation
    simulation_id = str(uuid.uuid4())
    # Create a simulation engine instance
    engine = SimulationEngine(dataset=dataset)
    # Define a coroutine that runs the simulation and stores results
    async def run_and_store() -> None:
        result = await engine.run_simulation(user_context=user_context, emitter=_emitter)
        _simulation_results[simulation_id] = result
    # Launch simulation in background
    task = asyncio.create_task(run_and_store())
    _simulation_tasks[simulation_id] = task
    return {"simulation_id": simulation_id, "status": "running"}


@router.get("/result")
async def get_result(simulation_id: str) -> Dict[str, Any]:
    """Retrieve final aggregated metrics for a completed simulation.

    If the simulation is still running or unknown, returns an
    appropriate status message.
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
