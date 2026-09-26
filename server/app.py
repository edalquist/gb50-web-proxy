"""FastAPI application factory for the Mitsubishi GB-50 REST Proxy & Web UI."""

from __future__ import annotations

import os
import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from gb50.client import GB50Client
from gb50.state_manager import StateManager
from .routes import router, get_state_mgr
from .schedule_db import schedule_db

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")


def create_app(
    controller_host: str = "192.0.2.90",
    controller_port: int = 80,
    poll_interval: float = 3.0,
) -> FastAPI:
    """Create and configure the FastAPI proxy application."""
    
    client = GB50Client(host=controller_host, port=controller_port)
    state_manager = StateManager(client=client, poll_interval_sec=poll_interval)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
        schedule_db.seed_mock_defaults_if_empty()
        await state_manager.start()
        yield
        await state_manager.stop()
        await client.close()

    app = FastAPI(
        title="Mitsubishi GB-50 HVAC REST Proxy & Web UI",
        description=(
            "Modern REST API proxy and real-time WebSocket state bridge "
            "for the Mitsubishi GB-50 / AG-150 / G-50 Central Controller."
        ),
        version="1.0.0",
        lifespan=lifespan,
    )
    app.state.client = client
    app.state.state_manager = state_manager

    # Enable CORS for web UI clients with explicit origins
    cors_origins_env = os.getenv("GB50_CORS_ORIGINS")
    if cors_origins_env:
        allow_origins = [o.strip() for o in cors_origins_env.split(",") if o.strip()]
    else:
        allow_origins = [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:8080",
            "http://127.0.0.1:8080",
            "http://0.0.0.0:8080",
        ]

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allow_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Dependency override for route handler
    def _get_mgr(request: Request) -> StateManager:
        return request.app.state.state_manager

    app.dependency_overrides[get_state_mgr] = _get_mgr
    app.include_router(router)

    # Mount static Web UI assets if built
    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    dist_dir = os.path.join(root_dir, "web", "dist")
    assets_dir = os.path.join(dist_dir, "assets")

    if os.path.isdir(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str):
        if full_path.startswith("api") or full_path.startswith("docs") or full_path.startswith("openapi.json"):
            return None
        if os.path.isdir(dist_dir):
            file_path = os.path.join(dist_dir, full_path)
            if os.path.isfile(file_path):
                return FileResponse(file_path)
            index_path = os.path.join(dist_dir, "index.html")
            if os.path.isfile(index_path):
                return FileResponse(index_path)
        return {"message": "GB-50 REST API is running. Web UI not built yet (build 'web' directory with npm run build)."}

    return app
