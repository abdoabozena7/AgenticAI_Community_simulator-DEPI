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
from .api import admin as admin_routes
from .api import health as health_routes
from .api import devlab as devlab_routes
from .api import guided_workflow as guided_workflow_routes
from .api import persona_lab as persona_lab_routes


def _allowed_origins() -> list[str]:
    configured = os.getenv("ALLOWED_ORIGINS", "").strip()
    if configured:
        return [origin.strip() for origin in configured.split(",") if origin.strip()]
    return [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8080",
        "http://127.0.0.1:8080",
    ]


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
    allowed_origins = _allowed_origins()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?$",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Register API routers
    app.include_router(simulation_routes.router)
    app.include_router(simulation_routes.society_router)
    app.include_router(websocket_module.router)
    app.include_router(llm_routes.router)
    app.include_router(search_routes.router)
    # New routers for auth, research and court
    app.include_router(auth_routes.router)
    app.include_router(research_routes.router)
    app.include_router(court_routes.router)
    app.include_router(admin_routes.router)
    app.include_router(devlab_routes.router)
    app.include_router(health_routes.router)
    app.include_router(guided_workflow_routes.router)
    app.include_router(persona_lab_routes.router)

    @app.on_event("startup")
    async def startup_event() -> None:
        """Load the dataset once at application startup.

        If the dataset is missing or invalid the server startup will
        fail, preventing requests from being served in an invalid
        state.
        """
        data_dir = os.path.join(os.path.dirname(__file__), "data")
        from .api import routes  # local import to avoid circular dependency
        await init_db()
        await auth_core.ensure_admin_user()
        await auth_core.ensure_developer_user()
        await auth_core.ensure_default_user()
        routes.configure_orchestrator(load_dataset(data_dir))

    return app


# Create a default application instance for uvicorn to discover.
app = create_app()
