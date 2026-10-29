"""ATALAYA authentication, sessions, anti-brute-force rate limiting, and administrative CLI.

Implements scrypt password hashing, session tokens, progressive account/IP locking,
and append-only security auditing without secrets.
"""

from __future__ import annotations

import argparse
import base64
from dataclasses import dataclass
from datetime import datetime, timezone
import getpass
import hashlib
import hmac
import json
import logging
import math
import os
from pathlib import Path
import secrets
import string
import sys
import tempfile
import threading
import time
from typing import Any, Callable

from atalaya.config import CACHE_DIR

logger = logging.getLogger("atalaya.auth")

# Monkeypatchable storage locations
AUTH_DIR = CACHE_DIR / "auth"
AUTH_LOG_DIR = CACHE_DIR / "logs"
USERS_FILE = AUTH_DIR / "users.json"
ATTEMPTS_FILE = AUTH_DIR / "attempts.json"
SESSIONS_FILE = AUTH_DIR / "sessions.json"
AUTH_LOG_FILE = AUTH_LOG_DIR / "auth.jsonl"

# Security & algorithm parameters
MIN_PASSWORD_LENGTH = 14
SCRYPT_N = 32768  # 2**15
SCRYPT_R = 8
SCRYPT_P = 1
SCRYPT_DKLEN = 64
SCRYPT_MAXMEM = 64 * 1024 * 1024  # 64 MB

SESSION_IDLE_TIMEOUT_S = 12 * 3600  # 12 hours without use
SESSION_MAX_LIFETIME_S = 7 * 86400  # 7 days absolute
COOKIE_NAME = "atalaya_session"

# Clock hook for deterministic time testing
_clock: Callable[[], float] = time.time
_auth_lock = threading.Lock()
_scrypt_calls_count = 0


def set_clock(clock_fn: Callable[[], float] | None = None) -> None:
    """Set custom clock function for deterministic testing."""
    global _clock
    _clock = clock_fn or time.time


def get_now() -> float:
    """Return current timestamp using active clock."""
    return _clock()


def get_scrypt_call_count() -> int:
    """Return number of scrypt operations performed (useful for timing tests)."""
    return _scrypt_calls_count


def reset_scrypt_call_count() -> None:
    """Reset scrypt operations counter."""
    global _scrypt_calls_count
    _scrypt_calls_count = 0


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class AuthError(Exception):
    """Base exception for authentication errors."""


class InvalidCredentialsError(AuthError):
    """Raised when credentials are invalid."""


class LockedError(AuthError):
    """Raised when an account or IP is temporarily locked."""

    def __init__(self, message: str, retry_after_s: int) -> None:
        super().__init__(message)
        self.retry_after_s = retry_after_s


# ---------------------------------------------------------------------------
# Data Models
# ---------------------------------------------------------------------------


@dataclass
class User:
    username: str
    created_at: str = ""
    disabled: bool = False

    def __str__(self) -> str:
        return self.username


@dataclass
class Session:
    token_hash: str
    username: str
    created_at: float
    last_seen: float
    expires_at: float

    @property
    def expires_at_iso(self) -> str:
        return datetime.fromtimestamp(self.expires_at, tz=timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Atomic Storage & Logging Helpers
# ---------------------------------------------------------------------------


def _atomic_write_json(path: Path, data: Any) -> None:
    """Write JSON data atomically using a temporary file in the destination folder."""
    path.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(data, ensure_ascii=False, indent=2)
    with tempfile.NamedTemporaryFile("w", dir=str(path.parent), delete=False, encoding="utf-8") as tf:
        tf.write(serialized)
        tmp_name = tf.name
    os.replace(tmp_name, str(path))


def _read_json(path: Path) -> Any | None:
    """Read JSON file safely, returning None if missing or invalid."""
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _append_auth_log(ip: str, username: str, result: str) -> None:
    """Append authentication attempt entry to JSONL log without storing secrets."""
    AUTH_LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    entry = {
        "at": datetime.now(timezone.utc).isoformat(),
        "ip": ip,
        "username": username,
        "result": result,
    }
    line = json.dumps(entry, ensure_ascii=False) + "\n"
    try:
        with open(AUTH_LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line)
    except Exception as exc:
        logger.warning("No se pudo escribir en la bitácora de auth: %s", exc)


# ---------------------------------------------------------------------------
# Password Hashing & Verification (scrypt)
# ---------------------------------------------------------------------------


def hash_password(password: str) -> str:
    """Hash a password using hashlib.scrypt with minimum length check.

    Format: scrypt$n$r$p$salt_hex_or_b64$hash_b64
    """
    if len(password) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"La contraseña debe tener al menos {MIN_PASSWORD_LENGTH} caracteres.")

    global _scrypt_calls_count
    _scrypt_calls_count += 1

    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=SCRYPT_N,
        r=SCRYPT_R,
        p=SCRYPT_P,
        dklen=SCRYPT_DKLEN,
        maxmem=SCRYPT_MAXMEM,
    )
    salt_b64 = base64.b64encode(salt).decode("ascii")
    hash_b64 = base64.b64encode(dk).decode("ascii")
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${salt_b64}${hash_b64}"


def verify_password(password: str, hashed: str) -> bool:
    """Verify password against scrypt hash in constant time. Returns False on mismatch."""
    global _scrypt_calls_count
    _scrypt_calls_count += 1

    try:
        parts = hashed.split("$")
        if len(parts) != 6 or parts[0] != "scrypt":
            return False
        n = int(parts[1])
        r = int(parts[2])
        p = int(parts[3])
        salt = base64.b64decode(parts[4].encode("ascii"))
        expected_dk = base64.b64decode(parts[5].encode("ascii"))

        computed_dk = hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt,
            n=n,
            r=r,
            p=p,
            dklen=len(expected_dk),
            maxmem=SCRYPT_MAXMEM,
        )
        return hmac.compare_digest(computed_dk, expected_dk)
    except Exception:
        return False


# Pre-computed dummy hash so nonexistent user verification runs identical scrypt timing
_DUMMY_SALT = b"\x00" * 16
_DUMMY_DK = hashlib.scrypt(
    b"dummy-timing-mitigation-pass-14",
    salt=_DUMMY_SALT,
    n=SCRYPT_N,
    r=SCRYPT_R,
    p=SCRYPT_P,
    dklen=SCRYPT_DKLEN,
    maxmem=SCRYPT_MAXMEM,
)
_DUMMY_HASH = (
    f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}$"
    f"{base64.b64encode(_DUMMY_SALT).decode('ascii')}$"
    f"{base64.b64encode(_DUMMY_DK).decode('ascii')}"
)


# ---------------------------------------------------------------------------
# User Management
# ---------------------------------------------------------------------------


def create_user(username: str, password: str) -> User:
    """Create a new user entry in USERS_FILE. Raises ValueError if exists or invalid."""
    uname = username.strip().lower()
    if not uname:
        raise ValueError("El nombre de usuario no puede estar vacío.")

    with _auth_lock:
        users = _read_json(USERS_FILE) or {}
        if uname in users:
            raise ValueError(f"El usuario '{uname}' ya existe.")

        h = hash_password(password)
        created_at = datetime.now(timezone.utc).isoformat()
        users[uname] = {
            "hash": h,
            "created_at": created_at,
            "disabled": False,
        }
        _atomic_write_json(USERS_FILE, users)
        return User(username=uname, created_at=created_at, disabled=False)


def reset_password(username: str, new_password: str) -> User:
    """Reset an existing user's password."""
    uname = username.strip().lower()
    with _auth_lock:
        users = _read_json(USERS_FILE) or {}
        if uname not in users:
            raise ValueError(f"El usuario '{uname}' no existe.")

        h = hash_password(new_password)
        users[uname]["hash"] = h
        _atomic_write_json(USERS_FILE, users)
        return User(
            username=uname,
            created_at=users[uname].get("created_at", ""),
            disabled=users[uname].get("disabled", False),
        )


def disable_user(username: str) -> User:
    """Disable a user account."""
    uname = username.strip().lower()
    with _auth_lock:
        users = _read_json(USERS_FILE) or {}
        if uname not in users:
            raise ValueError(f"El usuario '{uname}' no existe.")
        users[uname]["disabled"] = True
        _atomic_write_json(USERS_FILE, users)
        return User(
            username=uname,
            created_at=users[uname].get("created_at", ""),
            disabled=True,
        )


def enable_user(username: str) -> User:
    """Enable a user account."""
    uname = username.strip().lower()
    with _auth_lock:
        users = _read_json(USERS_FILE) or {}
        if uname not in users:
            raise ValueError(f"El usuario '{uname}' no existe.")
        users[uname]["disabled"] = False
        _atomic_write_json(USERS_FILE, users)
        return User(
            username=uname,
            created_at=users[uname].get("created_at", ""),
            disabled=False,
        )


def list_users() -> list[dict[str, Any]]:
    """Return list of all registered users without hashes."""
    users = _read_json(USERS_FILE) or {}
    return [
        {
            "username": uname,
            "created_at": d.get("created_at", ""),
            "disabled": bool(d.get("disabled", False)),
        }
        for uname, d in sorted(users.items())
    ]


# ---------------------------------------------------------------------------
# Brute-Force Rate Limiting & Authentication
# ---------------------------------------------------------------------------


def authenticate(
    username: str,
    password: str,
    ip: str,
    clock: Callable[[], float] | None = None,
) -> User:
    """Authenticate username and password against anti-brute-force controls.

    Enforces:
    - IP lock: 20 failures/h -> 1 h lockout.
    - IP rate limit: 10 attempts/min.
    - User lock: 5 failures in 15 min -> 15 min, escalates 15 -> 30 -> 60 min.
    - Dummy scrypt execution for nonexistent/disabled users (timing attack prevention).
    - Returns User on success; raises LockedError(retry_after_s) or InvalidCredentialsError.
    """
    now = clock() if clock else get_now()
    uname = username.strip().lower() if username else ""

    with _auth_lock:
        attempts = _read_json(ATTEMPTS_FILE) or {}
        users_att = attempts.setdefault("users", {})
        ips_att = attempts.setdefault("ips", {})

        ip_data = ips_att.setdefault(ip, {"failures": [], "attempts": [], "lock_until": 0.0})
        user_data = users_att.setdefault(uname, {"failures": [], "lock_until": 0.0, "consecutive_blocks": 0})

        # 1. Check IP lockout (20 failures in 1h window -> 1h lockout)
        if ip_data.get("lock_until", 0.0) > now:
            rem_s = int(math.ceil(ip_data["lock_until"] - now))
            mins = max(1, math.ceil(rem_s / 60))
            _append_auth_log(ip, uname, "locked_ip")
            raise LockedError(f"Demasiados intentos. Intenta de nuevo en {mins} minutos.", retry_after_s=rem_s)

        # 2. Check IP rate limit (10 attempts / 60s sliding window)
        ip_attempts = [t for t in ip_data.get("attempts", []) if now - t < 60.0]
        if len(ip_attempts) >= 10:
            oldest = ip_attempts[0]
            rem_s = max(1, int(math.ceil(60.0 - (now - oldest))))
            mins = max(1, math.ceil(rem_s / 60))
            _append_auth_log(ip, uname, "rate_limited_ip")
            raise LockedError(f"Demasiados intentos. Intenta de nuevo en {mins} minutos.", retry_after_s=rem_s)

        ip_attempts.append(now)
        ip_data["attempts"] = ip_attempts

        # 3. Check User lockout
        if user_data.get("lock_until", 0.0) > now:
            rem_s = int(math.ceil(user_data["lock_until"] - now))
            mins = max(1, math.ceil(rem_s / 60))
            _append_auth_log(ip, uname, "locked_user")
            raise LockedError(f"Demasiados intentos. Intenta de nuevo en {mins} minutos.", retry_after_s=rem_s)

        # 4. Verify credentials
        users = _read_json(USERS_FILE) or {}
        user_record = users.get(uname)

        if not user_record or user_record.get("disabled", False):
            # Run dummy scrypt verification to prevent timing leaks
            verify_password(password, _DUMMY_HASH)
            is_valid = False
        else:
            is_valid = verify_password(password, user_record["hash"])

        # 5. Successful authentication
        if is_valid:
            user_data["failures"] = []
            user_data["consecutive_blocks"] = 0
            user_data["lock_until"] = 0.0
            _atomic_write_json(ATTEMPTS_FILE, attempts)
            _append_auth_log(ip, uname, "success")
            return User(
                username=uname,
                created_at=user_record["created_at"],
                disabled=user_record.get("disabled", False),
            )

        # 6. Failed authentication: update failures and calculate lockouts
        user_failures = [t for t in user_data.get("failures", []) if now - t < 900.0]
        user_failures.append(now)
        user_data["failures"] = user_failures

        ip_failures = [t for t in ip_data.get("failures", []) if now - t < 3600.0]
        ip_failures.append(now)
        ip_data["failures"] = ip_failures

        # Check user threshold: 5 failures in 15 min
        user_locked = False
        user_lock_duration_s = 0
        if len(user_failures) >= 5:
            user_locked = True
            blocks = user_data.get("consecutive_blocks", 0) + 1
            user_data["consecutive_blocks"] = blocks
            # Escalation: 1st block 15m, 2nd 30m, 3rd+ 60m
            mins = min(60, 15 * (2 ** (blocks - 1)))
            user_lock_duration_s = mins * 60
            user_data["lock_until"] = now + user_lock_duration_s
            user_data["failures"] = []

        # Check IP threshold: 20 failures in 1 hour
        ip_locked = False
        ip_lock_duration_s = 0
        if len(ip_failures) >= 20:
            ip_locked = True
            ip_lock_duration_s = 3600
            ip_data["lock_until"] = now + 3600
            ip_data["failures"] = []

        _atomic_write_json(ATTEMPTS_FILE, attempts)

        if user_locked:
            mins = max(1, math.ceil(user_lock_duration_s / 60))
            _append_auth_log(ip, uname, "failed_and_locked_user")
            raise LockedError(f"Demasiados intentos. Intenta de nuevo en {mins} minutos.", retry_after_s=user_lock_duration_s)

        if ip_locked:
            mins = max(1, math.ceil(ip_lock_duration_s / 60))
            _append_auth_log(ip, uname, "failed_and_locked_ip")
            raise LockedError(f"Demasiados intentos. Intenta de nuevo en {mins} minutos.", retry_after_s=ip_lock_duration_s)

        _append_auth_log(ip, uname, "failed")
        raise InvalidCredentialsError("Usuario o contraseña incorrectos.")


def unlock(target: str) -> bool:
    """Clear lockout and failure history for a username or IP address."""
    norm = target.strip().lower()
    with _auth_lock:
        attempts = _read_json(ATTEMPTS_FILE) or {}
        users = attempts.get("users", {})
        ips = attempts.get("ips", {})

        users.pop(norm, None)
        users.pop(target, None)
        ips.pop(target, None)
        ips.pop(norm, None)

        _atomic_write_json(ATTEMPTS_FILE, attempts)
    return True


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------


def create_session(username: str, clock: Callable[[], float] | None = None) -> tuple[str, Session]:
    """Generate a 32-byte secure random session token, store sha256(token), and return (raw_token, Session)."""
    raw_token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
    now = clock() if clock else get_now()

    created_at = now
    last_seen = now
    expires_at = min(now + SESSION_IDLE_TIMEOUT_S, created_at + SESSION_MAX_LIFETIME_S)

    session = Session(
        token_hash=token_hash,
        username=username.strip().lower(),
        created_at=created_at,
        last_seen=last_seen,
        expires_at=expires_at,
    )

    with _auth_lock:
        sessions = _read_json(SESSIONS_FILE) or {}
        sessions[token_hash] = {
            "username": session.username,
            "created_at": session.created_at,
            "last_seen": session.last_seen,
            "expires_at": session.expires_at,
        }
        _atomic_write_json(SESSIONS_FILE, sessions)

    return raw_token, session


def get_session(token: str, clock: Callable[[], float] | None = None) -> Session | None:
    """Retrieve and validate session by raw token. Cleans up expired sessions."""
    if not token or not token.strip():
        return None

    now = clock() if clock else get_now()
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()

    with _auth_lock:
        sessions = _read_json(SESSIONS_FILE) or {}
        data = sessions.get(token_hash)
        if not data:
            return None

        # Check idle timeout (12h) and absolute max lifetime (7d)
        if (now - data["last_seen"] > SESSION_IDLE_TIMEOUT_S) or (now - data["created_at"] > SESSION_MAX_LIFETIME_S):
            sessions.pop(token_hash, None)
            _atomic_write_json(SESSIONS_FILE, sessions)
            return None

        return Session(
            token_hash=token_hash,
            username=data["username"],
            created_at=data["created_at"],
            last_seen=data["last_seen"],
            expires_at=data["expires_at"],
        )


def touch(token: str, clock: Callable[[], float] | None = None) -> Session | None:
    """Update last_seen timestamp and extend idle expiration for a valid session."""
    if not token or not token.strip():
        return None

    now = clock() if clock else get_now()
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()

    with _auth_lock:
        sessions = _read_json(SESSIONS_FILE) or {}
        data = sessions.get(token_hash)
        if not data:
            return None

        if (now - data["last_seen"] > SESSION_IDLE_TIMEOUT_S) or (now - data["created_at"] > SESSION_MAX_LIFETIME_S):
            sessions.pop(token_hash, None)
            _atomic_write_json(SESSIONS_FILE, sessions)
            return None

        data["last_seen"] = now
        data["expires_at"] = min(now + SESSION_IDLE_TIMEOUT_S, data["created_at"] + SESSION_MAX_LIFETIME_S)
        _atomic_write_json(SESSIONS_FILE, sessions)

        return Session(
            token_hash=token_hash,
            username=data["username"],
            created_at=data["created_at"],
            last_seen=data["last_seen"],
            expires_at=data["expires_at"],
        )


def revoke(token: str) -> bool:
    """Revoke a session token permanently."""
    if not token or not token.strip():
        return False

    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    with _auth_lock:
        sessions = _read_json(SESSIONS_FILE) or {}
        if token_hash in sessions:
            sessions.pop(token_hash, None)
            _atomic_write_json(SESSIONS_FILE, sessions)
            return True
    return False


def create_test_session(username: str = "test_user") -> str:
    """Convenience helper to create an active test session token."""
    raw_token, _ = create_session(username)
    return raw_token


# ---------------------------------------------------------------------------
# CLI Implementation (python -m atalaya.auth ...)
# ---------------------------------------------------------------------------


def generate_secure_password(length: int = 24) -> str:
    """Generate a high-entropy random password with letters, digits, and safe symbols."""
    symbols = "!@#$%^&*()-_=+"
    alphabet = string.ascii_letters + string.digits + symbols
    while True:
        pwd = "".join(secrets.choice(alphabet) for _ in range(length))
        if (
            any(c in string.ascii_lowercase for c in pwd)
            and any(c in string.ascii_uppercase for c in pwd)
            and any(c in string.digits for c in pwd)
            and any(c in symbols for c in pwd)
        ):
            return pwd


def main_cli(args: list[str] | None = None) -> int:
    """Command-line interface entry point for user and lockout management."""
    parser = argparse.ArgumentParser(
        prog="python -m atalaya.auth",
        description="ATALAYA authentication and user management CLI",
    )
    subparsers = parser.add_subparsers(dest="subcommand", required=True)

    # create-user
    create_p = subparsers.add_parser("create-user", help="Crear nuevo usuario")
    create_p.add_argument("username", help="Nombre de usuario")
    create_group = create_p.add_mutually_exclusive_group()
    create_group.add_argument("--generate", action="store_true", help="Generar contraseña de 24 caracteres e imprimirla una sola vez")
    create_group.add_argument("--password-stdin", action="store_true", help="Leer contraseña desde stdin")

    # reset-password
    reset_p = subparsers.add_parser("reset-password", help="Restablecer contraseña de usuario existente")
    reset_p.add_argument("username", help="Nombre de usuario")
    reset_group = reset_p.add_mutually_exclusive_group()
    reset_group.add_argument("--generate", action="store_true", help="Generar contraseña de 24 caracteres e imprimirla una sola vez")
    reset_group.add_argument("--password-stdin", action="store_true", help="Leer contraseña desde stdin")

    # disable
    dis_p = subparsers.add_parser("disable", help="Deshabilitar usuario")
    dis_p.add_argument("username", help="Nombre de usuario")

    # enable
    en_p = subparsers.add_parser("enable", help="Habilitar usuario")
    en_p.add_argument("username", help="Nombre de usuario")

    # list
    subparsers.add_parser("list", help="Listar usuarios registrados")

    # unlock
    un_p = subparsers.add_parser("unlock", help="Desbloquear usuario o dirección IP")
    un_p.add_argument("target", help="Nombre de usuario o dirección IP")

    parsed = parser.parse_args(args)

    try:
        if parsed.subcommand == "create-user":
            if parsed.generate:
                pwd = generate_secure_password(24)
                create_user(parsed.username, pwd)
                sys.stdout.write(f"{pwd}\n")
                sys.stdout.flush()
                return 0
            elif parsed.password_stdin:
                pwd = sys.stdin.read().strip()
            else:
                pwd = getpass.getpass("Contraseña: ").strip()

            create_user(parsed.username, pwd)
            sys.stdout.write(f"Usuario '{parsed.username}' creado exitosamente.\n")
            return 0

        elif parsed.subcommand == "reset-password":
            if parsed.generate:
                pwd = generate_secure_password(24)
                reset_password(parsed.username, pwd)
                sys.stdout.write(f"{pwd}\n")
                sys.stdout.flush()
                return 0
            elif parsed.password_stdin:
                pwd = sys.stdin.read().strip()
            else:
                pwd = getpass.getpass("Nueva contraseña: ").strip()

            reset_password(parsed.username, pwd)
            sys.stdout.write(f"Contraseña de '{parsed.username}' restablecida exitosamente.\n")
            return 0

        elif parsed.subcommand == "disable":
            disable_user(parsed.username)
            sys.stdout.write(f"Usuario '{parsed.username}' deshabilitado.\n")
            return 0

        elif parsed.subcommand == "enable":
            enable_user(parsed.username)
            sys.stdout.write(f"Usuario '{parsed.username}' habilitado.\n")
            return 0

        elif parsed.subcommand == "list":
            users = list_users()
            if not users:
                sys.stdout.write("No hay usuarios registrados.\n")
                return 0
            for u in users:
                st = "deshabilitado" if u["disabled"] else "activo"
                sys.stdout.write(f"{u['username']}\t{st}\tcreado: {u['created_at']}\n")
            return 0

        elif parsed.subcommand == "unlock":
            unlock(parsed.target)
            sys.stdout.write(f"'{parsed.target}' desbloqueado exitosamente.\n")
            return 0

    except Exception as exc:
        sys.stderr.write(f"Error: {exc}\n")
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main_cli())
