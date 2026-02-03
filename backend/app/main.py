"""
Entry point for the FastAPI social simulation backend.

This module constructs the FastAPI application, loads the dataset at
startup and registers API, WebSocket and LLM routes. It ensures that
the dataset is validated before the server begins accepting requests.

The application is organised around a simple hybrid multi‑agent
simulation engine. A JSON dataset defines persona categories,
templates and interaction rules. On startup the dataset is loaded
exactly once and stored globally. Each simulation run spawns a small
population of agents from the templates and executes several
iterations of pairwise influence. Results are streamed to the
frontend via WebSockets and summarised via REST endpoints.
"""

from __future__ import annotations

import os
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .core.dataset_loader import load_dataset
from .core.db import init_db
from .core import auth as auth_core
from .api import routes as simulation_routes
from .api import websocket as websocket_module
from .api import llm as llm_routes
from .api import search as search_routes
from .api import auth as auth_routes
from .api import research as research_routes
from .api import court as court_routes


def create_app() -> FastAPI:
    """Create and configure the FastAPI application instance.

    The app mounts REST routes under the ``/simulation`` prefix for
    simulation management and exposes a WebSocket endpoint at
    ``/ws/simulation`` for streaming live updates. LLM routes are
    grouped under ``/llm``. CORS is configured to allow the
    accompanying frontend to communicate with this backend in a
    development environment. In production you should restrict the
    allowed origins.

    Returns:
        FastAPI: Configured application instance.
    """
    env_path = Path(__file__).resolve().parents[1] / ".env"
    load_dotenv(env_path)

    app = FastAPI(title="Social Simulation Backend")
    # Allow all origins in development. For production, set
    # appropriate allowed origins.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Register API routers
    app.include_router(simulation_routes.router)
    app.include_router(websocket_module.router)
    app.include_router(llm_routes.router)
    app.include_router(search_routes.router)
    # New routers for auth, research and court
    app.include_router(auth_routes.router)
    app.include_router(research_routes.router)
    app.include_router(court_routes.router)

    @app.on_event("startup")
    async def startup_event() -> None:
        """Load the dataset once at application startup.

        If the dataset is missing or invalid the server startup will
        fail, preventing requests from being served in an invalid
        state.
        """
        data_dir = os.path.join(os.path.dirname(__file__), "data")
        # Load dataset and store reference in routes module. Importing
        # here avoids circular import issues.
        from .api import routes  # local import to avoid circular dependency
        await init_db()
        await auth_core.ensure_admin_user()
        routes.dataset = load_dataset(data_dir)

    return app


# Create a default application instance for uvicorn to discover.
app = create_app()
