"""Security helpers for ATALAYA: admin authentication, proxy IP extraction, and chat rate limiting."""

from __future__ import annotations

import collections
import hmac
import math
import threading
import time
import os
from pathlib import Path
import secrets
from typing import Callable

from fastapi import HTTPException, Request

from atalaya.config import CACHE_DIR, get_settings

LOCAL_HOSTS = frozenset({"127.0.0.1", "::1", "localhost", "testclient"})
ADMIN_TOKEN_PATH = CACHE_DIR / "admin_token"


def is_local_client(host: str | None) -> bool:
    """Check if the provided host represents a local loopback or test client."""
    if not host:
        return True
    return host in LOCAL_HOSTS


def ensure_admin_token(token_path: Path | None = None) -> str:
    """Ensure an admin token exists on disk, generating and saving one if absent.

    Creates or reuses the token file (atomic write). Never logs or prints the token.
    """
    path = Path(token_path if token_path is not None else ADMIN_TOKEN_PATH)
    if path.is_file():
        try:
            token = path.read_text(encoding="utf-8").strip()
            if token:
                return token
        except OSError:
            pass

    path.parent.mkdir(parents=True, exist_ok=True)
    token = secrets.token_urlsafe(32)
    tmp_path = path.with_name(f"{path.name}.tmp.{secrets.token_hex(4)}")
    tmp_path.write_text(token, encoding="utf-8")
    os.replace(tmp_path, path)
    return token


def get_admin_token() -> str:
    """Retrieve the active admin token: ATALAYA_ADMIN_TOKEN if set, otherwise from disk."""
    settings = get_settings()
    if settings.admin_token:
        return settings.admin_token
    return ensure_admin_token()


def verify_admin_access(request: Request) -> None:
    """Verify administrator authorization for /api/admin/* endpoints.

    Requires 'X-Admin-Token' header matching the active admin token in constant time.
    Token source is ATALAYA_ADMIN_TOKEN if configured, or the token stored
    in data/cache/admin_token. Access without a valid token is always rejected.
    Rejection raises 403 Forbidden without details.
    """
    expected_token = get_admin_token()
    provided = request.headers.get("x-admin-token", "")

    if not provided or not expected_token or not hmac.compare_digest(provided, expected_token):
        raise HTTPException(status_code=403, detail="Forbidden")


def get_client_ip(request: Request) -> str:
    """Extract client IP address.

    With uvicorn configured with --proxy-headers and --forwarded-allow-ips 127.0.0.1
    behind Caddy, request.client.host is already resolved to the real client IP.
    Proxy trust and X-Forwarded-For parsing are delegated entirely to uvicorn,
    avoiding double-interpretation vulnerabilities.
    """
    if request.client and request.client.host:
        return request.client.host
    return "127.0.0.1"


class ChatRateLimiter:
    """Thread-safe sliding-window in-memory rate limiter for chat requests."""

    def __init__(
        self,
        rate_per_min: int = 8,
        rate_per_day: int = 200,
        clock: Callable[[], float] | None = None,
    ) -> None:
        self.rate_per_min = rate_per_min
        self.rate_per_day = rate_per_day
        self.clock = clock or time.time
        self._lock = threading.Lock()
        self._records: dict[str, collections.deque[float]] = {}
        self._last_cleanup: float = 0.0

    def _cleanup_inactive(self, now: float) -> None:
        """Remove IPs that have no activity in the last 24 hours."""
        if now - self._last_cleanup < 60.0 and len(self._records) < 500:
            return
        self._last_cleanup = now
        cutoff = now - 86400.0
        dead_ips = []
        for ip, deq in self._records.items():
            while deq and deq[0] < cutoff:
                deq.popleft()
            if not deq:
                dead_ips.append(ip)
        for ip in dead_ips:
            del self._records[ip]

    def check(self, ip: str, now: float | None = None) -> None:
        """Check rate limits for given IP. Raises 429 if exceeded, otherwise records request."""
        with self._lock:
            current_time = self.clock() if now is None else now
            self._cleanup_inactive(current_time)

            deq = self._records.setdefault(ip, collections.deque())
            cutoff_day = current_time - 86400.0
            while deq and deq[0] < cutoff_day:
                deq.popleft()

            # 1. Minute sliding window
            cutoff_min = current_time - 60.0
            min_count = sum(1 for t in deq if t >= cutoff_min)
            if min_count >= self.rate_per_min:
                oldest_in_min = next(t for t in deq if t >= cutoff_min)
                retry_after = max(1, int(math.ceil(60.0 - (current_time - oldest_in_min))))
                raise HTTPException(
                    status_code=429,
                    detail="Demasiadas preguntas seguidas. Intenta de nuevo en unos segundos.",
                    headers={"Retry-After": str(retry_after)},
                )

            # 2. Day sliding window
            if len(deq) >= self.rate_per_day:
                oldest_in_day = deq[0]
                retry_after = max(1, int(math.ceil(86400.0 - (current_time - oldest_in_day))))
                raise HTTPException(
                    status_code=429,
                    detail="Demasiadas preguntas seguidas. Intenta de nuevo en unos segundos.",
                    headers={"Retry-After": str(retry_after)},
                )

            deq.append(current_time)


_limiter: ChatRateLimiter | None = None
_limiter_lock = threading.Lock()


def get_chat_limiter() -> ChatRateLimiter:
    """Retrieve or initialize global ChatRateLimiter singleton."""
    global _limiter
    if _limiter is None:
        with _limiter_lock:
            if _limiter is None:
                settings = get_settings()
                _limiter = ChatRateLimiter(
                    rate_per_min=settings.chat_rate_per_min,
                    rate_per_day=settings.chat_rate_per_day,
                )
    return _limiter


def reset_chat_limiter() -> None:
    """Reset global ChatRateLimiter singleton (useful in tests)."""
    global _limiter
    with _limiter_lock:
        _limiter = None


def check_chat_rate_limit(request: Request) -> None:
    """Extract client IP and verify rate limits for chat request."""
    ip = get_client_ip(request)
    limiter = get_chat_limiter()
    limiter.check(ip)
