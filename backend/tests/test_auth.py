"""Comprehensive tests for ATALAYA backend authentication, sessions, and brute-force protection."""

from __future__ import annotations

import base64
import json
import math
from pathlib import Path
import pytest
from starlette.testclient import TestClient

from atalaya.api.main import app
import atalaya.auth as auth
from atalaya.auth import (
    AUTH_LOG_FILE,
    COOKIE_NAME,
    InvalidCredentialsError,
    LockedError,
    authenticate,
    create_session,
    create_user,
    get_scrypt_call_count,
    get_session,
    hash_password,
    main_cli,
    reset_scrypt_call_count,
    set_clock,
    touch,
    unlock,
    verify_password,
)


@pytest.fixture(autouse=True)
def clean_auth_state():
    """Ensure clock and scrypt counters are reset before and after each test."""
    set_clock(None)
    reset_scrypt_call_count()
    yield
    set_clock(None)
    reset_scrypt_call_count()


# -----------------------------------------------------------------------------
# 1. Password Hashing, Verification, Format & Length >= 14
# -----------------------------------------------------------------------------


def test_hash_and_verify_password():
    """Test scrypt format, verification, and >= 14 character requirement."""
    # Under 14 chars must be rejected
    with pytest.raises(ValueError, match="al menos 14 caracteres"):
        hash_password("short_pwd_123")

    # 14 chars exactly is accepted
    valid_pwd = "ValidPass14!_#"
    hashed = hash_password(valid_pwd)

    # Format check: scrypt$n$r$p$salt_b64$hash_b64
    parts = hashed.split("$")
    assert len(parts) == 6
    assert parts[0] == "scrypt"
    assert parts[1] == "32768"  # n
    assert parts[2] == "8"      # r
    assert parts[3] == "1"      # p

    # Salt and hash must be valid base64
    salt = base64.b64decode(parts[4])
    assert len(salt) == 16
    dk = base64.b64decode(parts[5])
    assert len(dk) == 64

    # Verify matching password
    assert verify_password(valid_pwd, hashed) is True

    # Verify wrong password
    assert verify_password("WrongPassword14!_#", hashed) is False

    # Verify malformed hash string
    assert verify_password(valid_pwd, "invalid_hash_string") is False
    assert verify_password(valid_pwd, "scrypt$invalid$format") is False


# -----------------------------------------------------------------------------
# 2. Login OK sets HttpOnly Cookie with appropriate flags
# -----------------------------------------------------------------------------


def test_login_sets_cookie_with_flags():
    """Successful login returns user info and sets HttpOnly, SameSite=Strict cookie."""
    create_user("user_flags", "Password123456!_#")
    client = TestClient(app)

    # Test with HTTPS forwarded header
    resp_https = client.post(
        "/api/auth/login",
        json={"username": "user_flags", "password": "Password123456!_#"},
        headers={"X-Forwarded-Proto": "https"},
    )
    assert resp_https.status_code == 200
    data = resp_https.json()
    assert data["user"]["username"] == "user_flags"
    assert "expires_at" in data

    set_cookie_https = resp_https.headers.get("set-cookie", "").lower()
    assert COOKIE_NAME in set_cookie_https
    assert "httponly" in set_cookie_https
    assert "samesite=strict" in set_cookie_https
    assert "path=/" in set_cookie_https
    assert "secure" in set_cookie_https
    assert "max-age=43200" in set_cookie_https

    # Test without HTTPS: Secure flag must not be set
    resp_http = client.post(
        "/api/auth/login",
        json={"username": "user_flags", "password": "Password123456!_#"},
    )
    assert resp_http.status_code == 200
    set_cookie_http = resp_http.headers.get("set-cookie", "").lower()
    assert COOKIE_NAME in set_cookie_http
    assert "httponly" in set_cookie_http
    assert "samesite=strict" in set_cookie_http
    assert "secure" not in set_cookie_http


# -----------------------------------------------------------------------------
# 3. Generic 401 for nonexistent user & wrong password with identical scrypt calls
# -----------------------------------------------------------------------------


def test_generic_401_and_scrypt_call_count():
    """Both nonexistent user and bad password return identical 401 and execute scrypt."""
    create_user("user_timing", "CorrectPassword14!_#")
    client = TestClient(app)

    # 1. Nonexistent user
    reset_scrypt_call_count()
    resp_nonexistent = client.post(
        "/api/auth/login",
        json={"username": "nonexistent_user", "password": "SomePassword14!_#"},
    )
    assert resp_nonexistent.status_code == 401
    assert resp_nonexistent.json() == {"detail": "Usuario o contraseña incorrectos."}
    assert get_scrypt_call_count() == 1  # Executed dummy scrypt

    # 2. Existing user with wrong password
    reset_scrypt_call_count()
    resp_wrong_pw = client.post(
        "/api/auth/login",
        json={"username": "user_timing", "password": "WrongPassword14!_#"},
    )
    assert resp_wrong_pw.status_code == 401
    assert resp_wrong_pw.json() == {"detail": "Usuario o contraseña incorrectos."}
    assert get_scrypt_call_count() == 1  # Executed real scrypt


# -----------------------------------------------------------------------------
# 4. User lockout at 5th failure, 429 with Retry-After, escalation 15 -> 30 -> 60
# -----------------------------------------------------------------------------


def test_user_lockout_and_escalation():
    """5 failures in 15 min lock user, escalating 15 -> 30 -> 60 min."""
    create_user("victim_user", "CorrectPassword14!_#")
    client = TestClient(app)

    current_time = 1000.0
    set_clock(lambda: current_time)

    # First 4 failures return 401
    for _ in range(4):
        r = client.post(
            "/api/auth/login",
            json={"username": "victim_user", "password": "WrongPassword14!_#"},
        )
        assert r.status_code == 401

    # 5th failure triggers 1st lockout (15 min = 900s)
    r5 = client.post(
        "/api/auth/login",
        json={"username": "victim_user", "password": "WrongPassword14!_#"},
    )
    assert r5.status_code == 429
    assert r5.headers.get("Retry-After") == "900"
    assert r5.json() == {
        "detail": "Demasiados intentos. Intenta de nuevo en 15 minutos.",
        "retry_after_s": 900,
    }

    # Attempt while locked out is rejected with 429 and remaining time
    current_time += 120.0  # 2 min later
    r_locked = client.post(
        "/api/auth/login",
        json={"username": "victim_user", "password": "WrongPassword14!_#"},
    )
    assert r_locked.status_code == 429
    assert r_locked.headers.get("Retry-After") == "780"
    assert r_locked.json()["retry_after_s"] == 780

    # Advance clock past 15 min lockout
    current_time += 781.0

    # Next 4 failures return 401
    for _ in range(4):
        r = client.post(
            "/api/auth/login",
            json={"username": "victim_user", "password": "WrongPassword14!_#"},
        )
        assert r.status_code == 401

    # 5th failure triggers 2nd lockout (escalated to 30 min = 1800s)
    r10 = client.post(
        "/api/auth/login",
        json={"username": "victim_user", "password": "WrongPassword14!_#"},
    )
    assert r10.status_code == 429
    assert r10.headers.get("Retry-After") == "1800"
    assert r10.json() == {
        "detail": "Demasiados intentos. Intenta de nuevo en 30 minutos.",
        "retry_after_s": 1800,
    }

    # Advance clock past 30 min lockout
    current_time += 1801.0
    for _ in range(4):
        client.post(
            "/api/auth/login",
            json={"username": "victim_user", "password": "WrongPassword14!_#"},
        )

    # 5th failure triggers 3rd lockout (escalated to 60 min = 3600s, max cap)
    r15 = client.post(
        "/api/auth/login",
        json={"username": "victim_user", "password": "WrongPassword14!_#"},
    )
    assert r15.status_code == 429
    assert r15.headers.get("Retry-After") == "3600"
    assert r15.json() == {
        "detail": "Demasiados intentos. Intenta de nuevo en 60 minutos.",
        "retry_after_s": 3600,
    }

    # Advance clock past 60 min lockout
    current_time += 3601.0
    for _ in range(4):
        client.post(
            "/api/auth/login",
            json={"username": "victim_user", "password": "WrongPassword14!_#"},
        )

    # 4th block remains capped at 60 min
    r20 = client.post(
        "/api/auth/login",
        json={"username": "victim_user", "password": "WrongPassword14!_#"},
    )
    assert r20.status_code == 429
    assert r20.headers.get("Retry-After") == "3600"
    assert r20.json()["detail"] == "Demasiados intentos. Intenta de nuevo en 60 minutos."


# -----------------------------------------------------------------------------
# 5. IP lockout at 20 failures/hour & 10 attempts/min rate limit
# -----------------------------------------------------------------------------


def test_ip_lockout_and_rate_limit():
    """IP rate limit enforces 10/min, and 20 failures in 1h lock the IP for 1h."""
    current_time = 10000.0
    set_clock(lambda: current_time)

    # 1. Minute rate limit: 10 attempts within 60s
    for i in range(10):
        try:
            authenticate(f"user_{i}", "WrongPassword14!_#", ip="198.51.100.1")
        except InvalidCredentialsError:
            pass

    # 11th attempt from same IP within the minute is rate-limited
    with pytest.raises(LockedError) as exc:
        authenticate("user_overflow", "WrongPassword14!_#", ip="198.51.100.1")
    assert exc.value.retry_after_s > 0

    # 2. 20 failures/hour lockout
    # Reset attempts for cleaner count across different minutes
    unlock("198.51.100.2")
    current_time = 20000.0

    # Spread 19 failures across 19 minutes (under 10/min limit)
    for i in range(19):
        current_time += 61.0
        try:
            authenticate(f"target_{i}", "WrongPassword14!_#", ip="198.51.100.2")
        except InvalidCredentialsError:
            pass

    # 20th failure triggers 1h IP lockout
    current_time += 61.0
    with pytest.raises(LockedError) as exc:
        authenticate("target_20", "WrongPassword14!_#", ip="198.51.100.2")

    assert exc.value.retry_after_s == 3600
    assert "60 minutos" in str(exc.value)


# -----------------------------------------------------------------------------
# 6. Unlock via CLI
# -----------------------------------------------------------------------------


def test_unlock_cli(capsys):
    """Running CLI unlock clears user and IP lockouts."""
    create_user("locked_cli_user", "ValidPassword14!_#")
    current_time = 50000.0
    set_clock(lambda: current_time)

    # Lock user with 5 failures
    for _ in range(5):
        try:
            authenticate("locked_cli_user", "WrongPassword14!_#", ip="127.0.0.1")
        except (InvalidCredentialsError, LockedError):
            pass

    # User is locked
    with pytest.raises(LockedError):
        authenticate("locked_cli_user", "ValidPassword14!_#", ip="127.0.0.1")

    # Run in-process CLI unlock
    res = main_cli(["unlock", "locked_cli_user"])
    assert res == 0
    out = capsys.readouterr().out
    assert "desbloqueado" in out

    # Authenticate successfully immediately after unlock
    user = authenticate("locked_cli_user", "ValidPassword14!_#", ip="127.0.0.1")
    assert user.username == "locked_cli_user"


# -----------------------------------------------------------------------------
# 7. Session Expiration (Idle 12h & Absolute 7d) with Injectable Clock
# -----------------------------------------------------------------------------


def test_session_expiration_idle_and_absolute():
    """Sessions expire after 12h of inactivity or 7 days absolute."""
    current_time = 100000.0

    # Create session at t=100000.0
    raw_token, session = create_session("test_sess", clock=lambda: current_time)
    assert get_session(raw_token, clock=lambda: current_time) is not None

    # Touch after 2 hours (t=107200.0)
    current_time += 7200.0
    touched = touch(raw_token, clock=lambda: current_time)
    assert touched is not None
    assert touched.last_seen == current_time

    # Advance 12 hours + 10s without touch: session must expire
    current_time += (12 * 3600) + 10.0
    assert get_session(raw_token, clock=lambda: current_time) is None

    # Test absolute 7-day expiration even when continuously touched
    current_time = 200000.0
    token_abs, _ = create_session("test_abs", clock=lambda: current_time)

    # Touch every 6 hours for 7 days
    for _ in range(27):  # 27 * 6h = 162h < 168h (7 days)
        current_time += 6 * 3600
        assert touch(token_abs, clock=lambda: current_time) is not None

    # Now advance past 7 days (168h + 10s from creation)
    current_time = 200000.0 + (7 * 86400) + 10.0
    assert get_session(token_abs, clock=lambda: current_time) is None


# -----------------------------------------------------------------------------
# 8. Logout Revokes Session
# -----------------------------------------------------------------------------


def test_logout_revokes_session():
    """Logout invalidates session token and deletes cookie."""
    create_user("user_logout", "ValidPassword14!_#")
    client = TestClient(app)

    login_resp = client.post(
        "/api/auth/login",
        json={"username": "user_logout", "password": "ValidPassword14!_#"},
    )
    assert login_resp.status_code == 200
    token = client.cookies.get(COOKIE_NAME)
    assert token is not None

    # Active session check returns 200
    sess_resp = client.get("/api/auth/session")
    assert sess_resp.status_code == 200
    assert sess_resp.json()["user"]["username"] == "user_logout"

    # Logout
    logout_resp = client.post("/api/auth/logout")
    assert logout_resp.status_code == 204

    # Subsequent session check returns 401
    after_logout = client.get("/api/auth/session")
    assert after_logout.status_code == 401


# -----------------------------------------------------------------------------
# 9. Middleware: /api/risk requires session, /api/health is open
# -----------------------------------------------------------------------------


def test_middleware_session_enforcement():
    """Protected endpoints require session cookie, /api/health does not."""
    create_user("regular_user", "ValidPassword14!_#")

    # Unauthenticated client
    unauth_client = TestClient(app)
    unauth_client.cookies.clear()

    # /api/health is open
    health_resp = unauth_client.get("/api/health")
    assert health_resp.status_code == 200

    # /api/risk requires session
    risk_unauth = unauth_client.get("/api/risk")
    assert risk_unauth.status_code == 401
    assert risk_unauth.json() == {"detail": "Sesión requerida."}

    # Authenticated client
    login_resp = unauth_client.post(
        "/api/auth/login",
        json={"username": "regular_user", "password": "ValidPassword14!_#"},
    )
    assert login_resp.status_code == 200

    # /api/risk succeeds with active session
    risk_auth = unauth_client.get("/api/risk")
    assert risk_auth.status_code == 200


# -----------------------------------------------------------------------------
# 10. CSRF: Origin Header Validation on State-Changing Methods
# -----------------------------------------------------------------------------


def test_csrf_origin_check():
    """State-changing requests with external/untrusted Origin return 403."""
    client = TestClient(app)
    client.cookies.clear()

    # POST with malicious Origin returns 403
    evil_resp = client.post(
        "/api/auth/login",
        json={"username": "any", "password": "any"},
        headers={"Origin": "https://malicious-site.attacker.com"},
    )
    assert evil_resp.status_code == 403
    assert evil_resp.json() == {"detail": "Origen no permitido."}

    # POST with legitimate Next.js origin is allowed through
    good_resp = client.post(
        "/api/auth/login",
        json={"username": "nonexistent", "password": "WrongPassword14!_#"},
        headers={"Origin": "http://localhost:3000"},
    )
    assert good_resp.status_code == 401  # Passes CSRF, fails credentials


# -----------------------------------------------------------------------------
# 11. verify_operator accepts user session
# -----------------------------------------------------------------------------


def test_verify_operator_with_session(monkeypatch):
    """Endpoints guarded by verify_operator accept active session without operator token."""
    monkeypatch.setenv("ATALAYA_OPERATOR_TOKEN", "local-operator-secret")
    create_user("operator_user", "ValidPassword14!_#")

    client = TestClient(app)
    client.cookies.clear()

    # Log in as operator_user
    login_resp = client.post(
        "/api/auth/login",
        json={"username": "operator_user", "password": "ValidPassword14!_#"},
    )
    assert login_resp.status_code == 200

    # Call operator check endpoint without X-Operator-Token
    resp = client.post("/api/intel/operator/check")
    assert resp.status_code == 204


# -----------------------------------------------------------------------------
# 12. Security Audit Log contains NO passwords
# -----------------------------------------------------------------------------


def test_auth_log_no_passwords():
    """Audit log records attempts without printing or saving passwords."""
    secret_pass = "SuperSecretPassword14!_#"
    create_user("audit_user", secret_pass)

    client = TestClient(app)
    client.post("/api/auth/login", json={"username": "audit_user", "password": secret_pass})
    client.post("/api/auth/login", json={"username": "audit_user", "password": "WrongPassword14!_#"})

    assert auth.AUTH_LOG_FILE.is_file()
    lines = auth.AUTH_LOG_FILE.read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) >= 2

    for line in lines:
        data = json.loads(line)
        assert "username" in data
        assert "result" in data
        assert "at" in data
        assert secret_pass not in line
        assert "SuperSecret" not in line
        assert "password" not in data


# -----------------------------------------------------------------------------
# 13. CLI create-user --generate prints secure password and stores only hash
# -----------------------------------------------------------------------------


def test_cli_create_user_generate(capsys):
    """CLI create-user --generate prints 24-char password once and stores hash in users.json."""
    exit_code = main_cli(["create-user", "generated_user", "--generate"])
    assert exit_code == 0

    captured = capsys.readouterr()
    generated_pwd = captured.out.strip()

    # Check generated password strength
    assert len(generated_pwd) == 24
    assert any(c.isupper() for c in generated_pwd)
    assert any(c.islower() for c in generated_pwd)
    assert any(c.isdigit() for c in generated_pwd)
    assert any(c in "!@#$%^&*()-_=+" for c in generated_pwd)

    # Verify users.json contains only the hash
    users = auth._read_json(auth.USERS_FILE)
    assert "generated_user" in users
    stored_hash = users["generated_user"]["hash"]
    assert generated_pwd not in stored_hash
    assert stored_hash.startswith("scrypt$32768$8$1$")

    # Authenticate with the generated password
    authenticated = authenticate("generated_user", generated_pwd, ip="127.0.0.1")
    assert authenticated.username == "generated_user"


# -----------------------------------------------------------------------------
# 14. /api/intel/* session enforcement and exact method/route exemptions
# -----------------------------------------------------------------------------


def test_intel_endpoints_require_session():
    """Endpoints under /api/intel/* require valid session or operator token."""
    client = TestClient(app)
    client.cookies.clear()

    endpoints = [
        ("GET", "/api/intel/status", None),
        ("GET", "/api/intel/monitor", None),
        ("GET", "/api/intel/campaign/32", None),
        ("POST", "/api/intel/campaign/export", {"plan_id": "32", "format": "pdf"}),
        ("GET", "/api/intel/jobs/x", None),
        ("GET", "/api/intel/monitor/items/x/impact", None),
    ]

    # 1. Without session -> 401 on all endpoints
    for method, path, payload in endpoints:
        if method == "GET":
            resp = client.get(path)
        else:
            resp = client.post(path, json=payload)
        assert resp.status_code == 401, f"{method} {path} should return 401 without session"
        assert resp.json() == {"detail": "Sesión requerida."}


def test_intel_endpoints_allow_session():
    """Active session cookie allows access (no 401) on /api/intel/* endpoints."""
    create_user("intel_user", "ValidPassword14!_#")
    client = TestClient(app)
    client.cookies.clear()

    login_resp = client.post(
        "/api/auth/login",
        json={"username": "intel_user", "password": "ValidPassword14!_#"},
    )
    assert login_resp.status_code == 200

    endpoints = [
        ("GET", "/api/intel/status", None),
        ("GET", "/api/intel/monitor", None),
        ("GET", "/api/intel/campaign/32", None),
        ("POST", "/api/intel/campaign/export", {"plan_id": "32", "format": "pdf"}),
        ("GET", "/api/intel/jobs/x", None),
        ("GET", "/api/intel/monitor/items/x/impact", None),
    ]

    for method, path, payload in endpoints:
        if method == "GET":
            resp = client.get(path)
        else:
            resp = client.post(path, json=payload)
        assert resp.status_code != 401, f"{method} {path} should not return 401 with active session"


def test_intel_endpoints_allow_operator_token(monkeypatch: pytest.MonkeyPatch):
    """Valid X-Operator-Token allows access (no 401) on /api/intel/* without session."""
    from atalaya.config import get_settings

    monkeypatch.setenv("ATALAYA_OPERATOR_TOKEN", "valid-op-token-123")
    get_settings.cache_clear()

    client = TestClient(app)
    client.cookies.clear()

    endpoints = [
        ("GET", "/api/intel/status", None),
        ("GET", "/api/intel/monitor", None),
        ("GET", "/api/intel/campaign/32", None),
        ("POST", "/api/intel/campaign/export", {"plan_id": "32", "format": "pdf"}),
        ("GET", "/api/intel/jobs/x", None),
        ("GET", "/api/intel/monitor/items/x/impact", None),
    ]

    for method, path, payload in endpoints:
        headers = {"X-Operator-Token": "valid-op-token-123"}
        if method == "GET":
            resp = client.get(path, headers=headers)
        else:
            resp = client.post(path, json=payload, headers=headers)
        assert resp.status_code != 401, f"{method} {path} should not return 401 with valid operator token"


def test_exact_method_and_path_exemptions():
    """Exemptions require exact method and path; distinct methods without session return 401 or 405, not 200."""
    client = TestClient(app)
    client.cookies.clear()

    # GET /api/auth/login without session -> not exempt, rejected with 401 or 405 (not 200)
    resp = client.get("/api/auth/login")
    assert resp.status_code in (401, 405)
    assert resp.status_code != 200

    # POST /api/auth/login is exempt -> returns 401 due to missing body/creds, not session required
    resp_login = client.post("/api/auth/login", json={"username": "nobody", "password": "WrongPassword14!_#"})
    assert resp_login.status_code == 401
    assert resp_login.json()["detail"] == "Usuario o contraseña incorrectos."

    # POST /api/health without session -> not exempt, rejected with 401 or 405 (not 200)
    resp_health_post = client.post("/api/health")
    assert resp_health_post.status_code in (401, 405)
    assert resp_health_post.status_code != 200
