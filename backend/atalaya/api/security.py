"""Security helpers for ATALAYA: admin authentication, proxy IP extraction, and chat rate limiting."""

from __future__ import annotations

import collections
import hmac
import math
import threading
import time
from typing import Callable

from fastapi import HTTPException, Request

from atalaya.config import get_settings

LOCAL_HOSTS = frozenset({"127.0.0.1", "::1", "localhost", "testclient"})


def is_local_client(host: str | None) -> bool:
    """Check if the provided host represents a local loopback or test client."""
    if not host:
        return True
    return host in LOCAL_HOSTS


def verify_admin_access(request: Request) -> None:
    """Verify administrator authorization for /api/admin/* endpoints.

    If ATALAYA_ADMIN_TOKEN is configured:
        Requires 'X-Admin-Token' header matching ATALAYA_ADMIN_TOKEN in constant time.
    If ATALAYA_ADMIN_TOKEN is not configured:
        Only allows local clients (127.0.0.1, ::1) with NO X-Forwarded-For header.
    Rejection raises 403 Forbidden without details.
    """
    settings = get_settings()
    configured_token = settings.admin_token

    if configured_token:
        provided = request.headers.get("x-admin-token", "")
        if not provided or not hmac.compare_digest(provided, configured_token):
            raise HTTPException(status_code=403, detail="Forbidden")
        return

    # No token configured: allow only local direct access (not via reverse proxy)
    client_host = request.client.host if request.client else ""
    if not is_local_client(client_host):
        raise HTTPException(status_code=403, detail="Forbidden")

    if "x-forwarded-for" in request.headers:
        raise HTTPException(status_code=403, detail="Forbidden")


def get_client_ip(request: Request) -> str:
    """Extract real client IP address.

    If request originates from a local loopback client (e.g. Next.js reverse proxy on 127.0.0.1),
    uses the first IP in the X-Forwarded-For header. Otherwise uses the socket client host.
    """
    socket_ip = request.client.host if request.client else "127.0.0.1"
    if is_local_client(socket_ip):
        xff = request.headers.get("x-forwarded-for")
        if xff:
            first_ip = xff.split(",")[0].strip()
            if first_ip:
                return first_ip
    return socket_ip


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
