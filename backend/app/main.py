"""
Entry point for the FastAPI social simulation backend.

This module constructs the FastAPI application, loads the dataset at
startup and registers API and WebSocket routes. It ensures that the
dataset is validated before the server begins accepting requests.
"""

from __future__ import annotations

import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .core.dataset_loader import load_dataset
from .api import routes as simulation_routes
from .api import websocket as websocket_module


def create_app() -> FastAPI:
    app = FastAPI(title="Social Simulation Backend")
    # Allow frontend to access the backend (adjust origins as needed)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # In production, set specific origins
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Include API routes
    app.include_router(simulation_routes.router)
    app.include_router(websocket_module.router)

    @app.on_event("startup")
    async def startup_event() -> None:
        """Load dataset at application startup."""
        data_dir = os.path.join(os.path.dirname(__file__), "data")
        # Load dataset and store reference in routes
        from .api import routes  # import here to avoid circular import issues
        routes.dataset = load_dataset(data_dir)

    return app

app = create_app()
