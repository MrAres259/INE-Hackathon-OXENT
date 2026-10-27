"""Main FastAPI entry point for ATALAYA API."""

from __future__ import annotations

from contextlib import asynccontextmanager
import logging
import threading
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from atalaya.api.routes import router as routes_router

logger = logging.getLogger(__name__)

WARMUP_STATUS: dict[str, str] = {"status": "loading"}


def _warmup_worker() -> None:
    """Run initial warmup tasks in background to prepare store and caches."""
    try:
        from atalaya.store import get_store
        from atalaya.api.deps import get_units_df, get_reco_reference

        store = get_store()
        _ = store.stats()
        _ = get_units_df()
        _ = get_reco_reference("mun")
        WARMUP_STATUS["status"] = "ready"
        logger.info("Warmup complete. Status set to ready.")
    except Exception as exc:
        logger.error("Warmup encountered an error: %s", exc, exc_info=True)
        WARMUP_STATUS["status"] = "ready"


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start background warmup, ensure admin token, and handle application lifecycle."""
    from atalaya.api.security import ensure_admin_token

    ensure_admin_token()
    thread = threading.Thread(target=_warmup_worker, daemon=True)
    thread.start()
    yield


app = FastAPI(title="Atalaya Electoral API", lifespan=lifespan)

# Allow CORS for Next.js frontend (default port 3000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8001",
        "http://127.0.0.1:8001",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(routes_router)

# Include chat router if implemented by W2-D
try:
    from atalaya.api.chat import router as chat_router

    app.include_router(chat_router)
    logger.info("Successfully registered chat router from atalaya.api.chat.")
except ImportError:
    logger.info("atalaya.api.chat is not available; chat endpoints skipped.")
