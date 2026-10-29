"""FastAPI router for user authentication and session management (/api/auth)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from atalaya.api.security import get_client_ip
from atalaya.auth import (
    COOKIE_NAME,
    AuthError,
    InvalidCredentialsError,
    LockedError,
    authenticate,
    create_session,
    get_session,
    revoke,
    touch,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=200)


@router.post("/login")
def login(payload: LoginRequest, request: Request) -> Response:
    """Authenticate user with username and password, setting HttpOnly session cookie on success."""
    ip = get_client_ip(request)
    try:
        user = authenticate(payload.username, payload.password, ip)
    except LockedError as exc:
        return JSONResponse(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            content={"detail": str(exc), "retry_after_s": exc.retry_after_s},
            headers={"Retry-After": str(exc.retry_after_s)},
        )
    except (InvalidCredentialsError, AuthError):
        return JSONResponse(
            status_code=status.HTTP_401_UNAUTHORIZED,
            content={"detail": "Usuario o contraseña incorrectos."},
        )

    raw_token, session = create_session(user.username)
    response = JSONResponse(
        status_code=status.HTTP_200_OK,
        content={
            "user": {"username": user.username},
            "expires_at": session.expires_at_iso,
        },
    )

    # Next.js rewrites in dev and Caddy in prod forward Set-Cookie without stripping it.
    # Secure flag is enabled only if request arrived via HTTPS (X-Forwarded-Proto).
    is_secure = (
        request.headers.get("x-forwarded-proto", "").lower() == "https"
        or request.url.scheme == "https"
    )

    response.set_cookie(
        key=COOKIE_NAME,
        value=raw_token,
        max_age=12 * 3600,
        path="/",
        httponly=True,
        samesite="strict",
        secure=is_secure,
    )
    return response


@router.get("/session")
def session_status(request: Request) -> dict:
    """Check active session validity and return user details and expiration."""
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sesión requerida.")

    sess = get_session(token)
    if not sess:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sesión requerida.")

    touch(token)
    return {
        "user": {"username": sess.username},
        "expires_at": sess.expires_at_iso,
    }


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request) -> Response:
    """Revoke active session token and clear authentication cookie."""
    token = request.cookies.get(COOKIE_NAME)
    if token:
        revoke(token)

    resp = Response(status_code=status.HTTP_204_NO_CONTENT)
    resp.delete_cookie(key=COOKIE_NAME, path="/")
    return resp
