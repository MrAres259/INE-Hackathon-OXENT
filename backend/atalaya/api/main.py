"""Main FastAPI entry point for ATALAYA API."""

from __future__ import annotations

from contextlib import asynccontextmanager
import logging
import threading
from typing import Any

from fastapi import FastAPI, Request
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

# NOTE: In development, Next.js rewrites in next.config.mjs proxy /api/* to localhost:8001
# and preserve Set-Cookie / Cookie headers transparently. In production, Caddy forwards
# requests and headers intact. Secure cookies are conditioned on X-Forwarded-Proto: https.

@app.middleware("http")
async def auth_and_csrf_middleware(request: Request, call_next):
    """Enforce session authentication on /api/* and CSRF Origin check on state-changing methods."""
    from atalaya.auth import COOKIE_NAME, get_session, touch
    from atalaya.api.security import get_operator_token
    import hmac
    import urllib.parse
    from fastapi.responses import JSONResponse

    if request.method == "OPTIONS":
        return await call_next(request)

    # 1. CSRF protection: Origin / Referer validation for state-changing methods
    method = request.method.upper()
    if method in ("POST", "PUT", "PATCH", "DELETE"):
        origin = request.headers.get("origin")
        referer = request.headers.get("referer")
        if origin or referer:
            host_header = (
                request.headers.get("x-forwarded-host") or request.headers.get("host") or ""
            ).lower().strip()
            allowed_hosts = {host_header, "localhost", "127.0.0.1", "testclient"}
            if ":" in host_header:
                allowed_hosts.add(host_header.split(":")[0])

            allowed_origins = {
                "http://localhost:3000",
                "http://127.0.0.1:3000",
                "http://localhost:8001",
                "http://127.0.0.1:8001",
                "http://localhost:8080",
                "http://127.0.0.1:8080",
                "https://localhost:3000",
                "https://127.0.0.1:3000",
                "https://localhost:8001",
                "https://127.0.0.1:8001",
                "https://localhost:8080",
                "https://127.0.0.1:8080",
            }

            valid = False
            if origin:
                parsed = urllib.parse.urlsplit(origin)
                origin_netloc = parsed.netloc.lower()
                origin_base = f"{parsed.scheme}://{parsed.netloc}".rstrip("/")
                if (
                    origin_netloc in allowed_hosts
                    or origin_base in allowed_origins
                    or (parsed.hostname and parsed.hostname.lower() in allowed_hosts)
                ):
                    valid = True
            elif referer:
                parsed = urllib.parse.urlsplit(referer)
                referer_netloc = parsed.netloc.lower()
                referer_base = f"{parsed.scheme}://{parsed.netloc}".rstrip("/")
                if (
                    referer_netloc in allowed_hosts
                    or referer_base in allowed_origins
                    or (parsed.hostname and parsed.hostname.lower() in allowed_hosts)
                ):
                    valid = True

            if not valid:
                return JSONResponse(
                    status_code=403,
                    content={"detail": "Origen no permitido."},
                )

    # 2. Session authentication for /api/*
    path = request.url.path
    if not path.startswith("/api/"):
        return await call_next(request)

    # Exempted paths:
    # GET /api/health, POST /api/auth/login, GET /api/auth/session, POST /api/auth/logout, /api/admin/*, and /api/intel/* (which manages operator auth via verify_operator)
    is_exempt = (
        path == "/api/health"
        or path == "/api/auth/login"
        or path == "/api/auth/session"
        or path == "/api/auth/logout"
        or path.startswith("/api/admin")
        or path.startswith("/api/intel")
    )

    token = request.cookies.get(COOKIE_NAME)
    user = None
    if token:
        sess = get_session(token)
        if sess:
            touch(token)
            user = sess.username
            request.state.user = user

    if is_exempt:
        return await call_next(request)

    # Support X-Operator-Token for local scripts on operator endpoints
    if not user:
        op_token = request.headers.get("x-operator-token")
        expected_op = get_operator_token()
        if op_token and expected_op and hmac.compare_digest(op_token.encode("utf-8"), expected_op.encode("utf-8")):
            request.state.user = "operator"
            return await call_next(request)

    if not user:
        return JSONResponse(
            status_code=401,
            content={"detail": "Sesión requerida."},
        )

    return await call_next(request)


# Include auth router
from atalaya.api.auth import router as auth_router

app.include_router(auth_router)
app.include_router(routes_router)

# Include chat router if implemented by W2-D
try:
    from atalaya.api.chat import router as chat_router

    app.include_router(chat_router)
    logger.info("Successfully registered chat router from atalaya.api.chat.")
except ImportError:
    logger.info("atalaya.api.chat is not available; chat endpoints skipped.")

# Include intel router
try:
    from atalaya.api.intel import router as intel_router

    app.include_router(intel_router)
    logger.info("Successfully registered intel router from atalaya.api.intel.")
except ImportError:
    logger.info("atalaya.api.intel is not available; intel endpoints skipped.")

