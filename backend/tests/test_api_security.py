"""Tests for security features: admin auth, reverse-proxy IP handling, and chat rate limiting."""

from __future__ import annotations

import collections
import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

from atalaya.api.main import app
from atalaya.api.security import (
    ChatRateLimiter,
    get_client_ip,
    is_local_client,
    reset_chat_limiter,
    verify_admin_access,
)
from atalaya.config import get_settings


@pytest.fixture(autouse=True)
def clean_security_state(monkeypatch):
    """Reset security environment variables and cached settings before each test."""
    monkeypatch.delenv("ATALAYA_ADMIN_TOKEN", raising=False)
    monkeypatch.delenv("ATALAYA_CHAT_RATE_PER_MIN", raising=False)
    monkeypatch.delenv("ATALAYA_CHAT_RATE_PER_DAY", raising=False)
    get_settings.cache_clear()
    reset_chat_limiter()
    yield
    get_settings.cache_clear()
    reset_chat_limiter()


# -----------------------------------------------------------------------------
# Admin authorization tests (/api/admin/*)
# -----------------------------------------------------------------------------

def test_admin_with_correct_token(monkeypatch):
    """Admin access granted when X-Admin-Token matches configured token."""
    monkeypatch.setenv("ATALAYA_ADMIN_TOKEN", "valid-secret-token")
    get_settings.cache_clear()

    client = TestClient(app, client=("192.168.1.100", 54321))
    resp = client.post("/api/admin/reload", headers={"X-Admin-Token": "valid-secret-token"})
    assert resp.status_code == 200
    assert resp.json().get("status") == "ok"


def test_admin_with_incorrect_token(monkeypatch):
    """Admin access rejected with 403 when X-Admin-Token is wrong."""
    monkeypatch.setenv("ATALAYA_ADMIN_TOKEN", "valid-secret-token")
    get_settings.cache_clear()

    client = TestClient(app, client=("127.0.0.1", 54321))
    resp = client.post("/api/admin/reload", headers={"X-Admin-Token": "wrong-secret"})
    assert resp.status_code == 403


def test_admin_with_absent_token_when_configured(monkeypatch):
    """Admin access rejected with 403 when token is configured but omitted in request."""
    monkeypatch.setenv("ATALAYA_ADMIN_TOKEN", "valid-secret-token")
    get_settings.cache_clear()

    client = TestClient(app, client=("127.0.0.1", 54321))
    resp = client.post("/api/admin/reload")
    assert resp.status_code == 403


def test_admin_local_without_token_no_xff():
    """When no token is configured, direct loopback client without X-Forwarded-For is allowed."""
    get_settings.cache_clear()

    client = TestClient(app, client=("127.0.0.1", 54321))
    resp = client.post("/api/admin/reload")
    assert resp.status_code == 200
    assert resp.json().get("status") == "ok"


def test_admin_local_without_token_with_xff():
    """When no token is configured, loopback request carrying X-Forwarded-For (from proxy) is rejected."""
    get_settings.cache_clear()

    client = TestClient(app, client=("127.0.0.1", 54321))
    resp = client.post("/api/admin/reload", headers={"X-Forwarded-For": "203.0.113.195"})
    assert resp.status_code == 403


def test_admin_remote_without_token():
    """When no token is configured, external client is rejected with 403."""
    get_settings.cache_clear()

    client = TestClient(app, client=("192.168.1.100", 54321))
    resp = client.post("/api/admin/reload")
    assert resp.status_code == 403


# -----------------------------------------------------------------------------
# Client IP extraction tests
# -----------------------------------------------------------------------------

def test_get_client_ip_from_local_with_xff():
    """Requests from loopback proxy take the first IP from X-Forwarded-For."""
    dummy_app = FastAPI()

    @dummy_app.get("/ip")
    def read_ip(request: Request):
        return {"ip": get_client_ip(request)}

    client = TestClient(dummy_app, client=("127.0.0.1", 54321))
    resp = client.get("/ip", headers={"X-Forwarded-For": "203.0.113.195, 10.0.0.1"})
    assert resp.status_code == 200
    assert resp.json()["ip"] == "203.0.113.195"


def test_get_client_ip_from_remote_ignores_xff():
    """Requests directly from a remote socket ignore X-Forwarded-For to prevent IP spoofing."""
    dummy_app = FastAPI()

    @dummy_app.get("/ip")
    def read_ip(request: Request):
        return {"ip": get_client_ip(request)}

    client = TestClient(dummy_app, client=("198.51.100.42", 54321))
    resp = client.get("/ip", headers={"X-Forwarded-For": "203.0.113.195"})
    assert resp.status_code == 200
    assert resp.json()["ip"] == "198.51.100.42"


def test_get_client_ip_local_no_xff():
    """Direct local requests without X-Forwarded-For return the local socket IP."""
    dummy_app = FastAPI()

    @dummy_app.get("/ip")
    def read_ip(request: Request):
        return {"ip": get_client_ip(request)}

    client = TestClient(dummy_app, client=("127.0.0.1", 54321))
    resp = client.get("/ip")
    assert resp.status_code == 200
    assert resp.json()["ip"] == "127.0.0.1"


# -----------------------------------------------------------------------------
# Rate Limiter unit tests with injectable clock
# -----------------------------------------------------------------------------

def test_rate_limiter_minute_window_with_clock():
    """Minute rate limit enforces sliding window and returns proper Retry-After."""
    current_time = 1000.0

    limiter = ChatRateLimiter(rate_per_min=3, rate_per_day=10, clock=lambda: current_time)

    # 3 allowed requests
    limiter.check("user-ip")
    current_time += 10.0
    limiter.check("user-ip")
    current_time += 10.0
    limiter.check("user-ip")

    # 4th request in the same 60s window fails with 429
    current_time += 10.0  # current_time is 1030.0; oldest is 1000.0 -> retry_after is 60 - 30 = 30
    with pytest.raises(HTTPException) as exc_info:
        limiter.check("user-ip")

    assert exc_info.value.status_code == 429
    assert exc_info.value.detail == "Demasiadas preguntas seguidas. Intenta de nuevo en unos segundos."
    assert "Retry-After" in exc_info.value.headers
    assert int(exc_info.value.headers["Retry-After"]) == 30

    # Advance clock past oldest request (t = 1061.0)
    current_time = 1061.0
    # Now in [1001, 1061], only requests at 1010 and 1020 remain (count is 2 < 3)
    limiter.check("user-ip")  # Should succeed!


def test_rate_limiter_day_window_with_clock():
    """Day rate limit enforces sliding window over 86400s."""
    current_time = 10000.0

    limiter = ChatRateLimiter(rate_per_min=10, rate_per_day=3, clock=lambda: current_time)

    # Spaced requests that don't trigger the minute limit
    limiter.check("user-ip")
    current_time += 100.0
    limiter.check("user-ip")
    current_time += 100.0
    limiter.check("user-ip")

    # 4th request exceeds the daily limit of 3
    current_time += 100.0
    with pytest.raises(HTTPException) as exc_info:
        limiter.check("user-ip")

    assert exc_info.value.status_code == 429
    assert exc_info.value.detail == "Demasiadas preguntas seguidas. Intenta de nuevo en unos segundos."
    assert "Retry-After" in exc_info.value.headers
    # retry_after should be approx 86400 - 300 = 86100
    assert int(exc_info.value.headers["Retry-After"]) == 86100

    # Advance clock past 24 hours from the first request
    current_time = 10000.0 + 86401.0
    limiter.check("user-ip")  # Should succeed!


def test_rate_limiter_inactive_ip_cleanup():
    """Inactive IPs are purged from memory after 24 hours of inactivity."""
    current_time = 1000.0

    limiter = ChatRateLimiter(rate_per_min=5, rate_per_day=10, clock=lambda: current_time)
    limiter.check("stale-ip")
    assert "stale-ip" in limiter._records

    # Fast forward more than 24 hours and trigger cleanup with another check
    current_time += 86405.0
    limiter._last_cleanup = 0.0  # Force cleanup interval
    limiter.check("fresh-ip")

    assert "stale-ip" not in limiter._records
    assert "fresh-ip" in limiter._records


# -----------------------------------------------------------------------------
# Chat endpoint integration tests (/api/chat)
# -----------------------------------------------------------------------------

def test_chat_message_length_exceeded():
    """Chat message > 1,000 characters returns 413 with exact error message."""
    client = TestClient(app, client=("127.0.0.1", 54321))
    long_message = "x" * 1001

    resp = client.post("/api/chat", json={"message": long_message, "history": []})
    assert resp.status_code == 413
    assert resp.json() == {
        "detail": "La pregunta es demasiado larga (máximo 1,000 caracteres)."
    }


def test_chat_message_exact_length_allowed(monkeypatch):
    """Chat message with exactly 1,000 characters passes length check."""
    client = TestClient(app, client=("127.0.0.1", 54321))
    exact_message = "x" * 1000

    resp = client.post("/api/chat", json={"message": exact_message, "history": []})
    # Does not reject with 413
    assert resp.status_code != 413


def test_chat_rate_limit_integration(monkeypatch):
    """Repeated calls to /api/chat from the same client IP trigger HTTP 429."""
    monkeypatch.setenv("ATALAYA_CHAT_RATE_PER_MIN", "2")
    get_settings.cache_clear()
    reset_chat_limiter()

    client = TestClient(app, client=("127.0.0.1", 54321))
    headers = {"X-Forwarded-For": "198.51.100.99"}

    # 1st request
    r1 = client.post("/api/chat", json={"message": "¿Cuál fue la participación en Jalisco?"}, headers=headers)
    assert r1.status_code == 200

    # 2nd request
    r2 = client.post("/api/chat", json={"message": "¿Cuál fue la participación en Jalisco?"}, headers=headers)
    assert r2.status_code == 200

    # 3rd request exceeds limit of 2 per minute -> 429
    r3 = client.post("/api/chat", json={"message": "¿Cuál fue la participación en Jalisco?"}, headers=headers)
    assert r3.status_code == 429
    assert r3.json() == {
        "detail": "Demasiadas preguntas seguidas. Intenta de nuevo en unos segundos."
    }
    assert "Retry-After" in r3.headers
