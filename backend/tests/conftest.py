"""Pytest test configuration, fixtures, and offline enforcement for ATALAYA."""

from __future__ import annotations

import builtins
import os
from pathlib import Path
import shutil
from typing import Any
import pytest
import elasticsearch
import opensearchpy
import pandas as pd

import atalaya.ingest.common as _ingest_common

# Force offline and memory settings before any atalaya imports
os.environ["ES_URL"] = ""
os.environ["OPENSEARCH_URL"] = ""
os.environ["ATALAYA_STORE"] = "memory"
os.environ["ATALAYA_LLM_ENABLED"] = "0"
os.environ["MAAS_API_KEY"] = ""
os.environ["MAAS_BASE_URL"] = ""

# Ensure pytest temp directory exists on Windows
(Path(__file__).resolve().parents[1] / ".pytest_tmp").mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Global test guard preventing tests from writing to real data directories
# ---------------------------------------------------------------------------
_REPO_ROOT = Path(__file__).resolve().parents[2]
_PROTECTED_DIRS = [
    (_REPO_ROOT / "data" / "build").resolve(),
    (_REPO_ROOT / "data" / "seed").resolve(),
    (_REPO_ROOT / "data" / "cache" / "logs").resolve(),
    (_REPO_ROOT / "deliverables").resolve(),
    (_REPO_ROOT / "frontend" / "public" / "geo").resolve(),
]


def _is_path_inside(p: Path, parent: Path) -> bool:
    try:
        if p == parent or p.is_relative_to(parent):
            return True
    except (ValueError, TypeError):
        pass
    try:
        p_str = str(p.resolve()).lower()
        parent_str = str(parent.resolve()).lower()
        if p_str == parent_str or p_str.startswith(parent_str + os.sep) or p_str.startswith(parent_str + "/"):
            return True
    except Exception:
        pass
    return False


def _check_protected_path(target: Any) -> None:
    if target is None:
        return
    if isinstance(target, (str, Path, os.PathLike)):
        p = Path(target).resolve()
        for p_dir in _PROTECTED_DIRS:
            if _is_path_inside(p, p_dir):
                raise RuntimeError(f"test intentó escribir en datos reales: {p}")


_orig_to_parquet = pd.DataFrame.to_parquet
_orig_to_csv = pd.DataFrame.to_csv
_orig_to_excel = pd.DataFrame.to_excel
_orig_write_text = Path.write_text
_orig_write_bytes = Path.write_bytes
_orig_open = builtins.open
_orig_write_parquet = _ingest_common.write_parquet


def _guarded_to_parquet(self, *args, **kwargs):
    target = args[0] if args else kwargs.get("path")
    _check_protected_path(target)
    return _orig_to_parquet(self, *args, **kwargs)


def _guarded_to_csv(self, *args, **kwargs):
    target = args[0] if args else kwargs.get("path_or_buf")
    _check_protected_path(target)
    return _orig_to_csv(self, *args, **kwargs)


def _guarded_to_excel(self, *args, **kwargs):
    target = args[0] if args else kwargs.get("excel_writer")
    _check_protected_path(target)
    return _orig_to_excel(self, *args, **kwargs)


def _guarded_write_text(self, *args, **kwargs):
    _check_protected_path(self)
    return _orig_write_text(self, *args, **kwargs)


def _guarded_write_bytes(self, *args, **kwargs):
    _check_protected_path(self)
    return _orig_write_bytes(self, *args, **kwargs)


def _guarded_write_parquet(df, path, *args, **kwargs):
    _check_protected_path(path)
    return _orig_write_parquet(df, path, *args, **kwargs)


def _guarded_open(file, *args, **kwargs):
    mode = "r"
    if len(args) > 0:
        mode = args[0]
    elif "mode" in kwargs:
        mode = kwargs["mode"]

    if any(c in mode for c in ("w", "a", "x", "+")):
        _check_protected_path(file)
    return _orig_open(file, *args, **kwargs)


# Apply monkeypatches immediately at module import
pd.DataFrame.to_parquet = _guarded_to_parquet
pd.DataFrame.to_csv = _guarded_to_csv
pd.DataFrame.to_excel = _guarded_to_excel
Path.write_text = _guarded_write_text
Path.write_bytes = _guarded_write_bytes
builtins.open = _guarded_open
_ingest_common.write_parquet = _guarded_write_parquet


@pytest.fixture(scope="session", autouse=True)
def _restore_guarded_write_operations():
    yield
    pd.DataFrame.to_parquet = _orig_to_parquet
    pd.DataFrame.to_csv = _orig_to_csv
    pd.DataFrame.to_excel = _orig_to_excel
    Path.write_text = _orig_write_text
    Path.write_bytes = _orig_write_bytes
    builtins.open = _orig_open
    _ingest_common.write_parquet = _orig_write_parquet


@pytest.fixture(autouse=True)
def block_opensearch_init(monkeypatch):
    """Enforce offline execution: forbid instantiating OpenSearch or Elasticsearch during tests."""
    def _forbid_opensearch_init(*args, **kwargs):
        raise RuntimeError("Network/OpenSearch client instantiation is blocked in tests.")

    def _forbid_es_init(*args, **kwargs):
        raise RuntimeError("Network/Elasticsearch client instantiation is blocked in tests.")

    monkeypatch.setattr(opensearchpy.OpenSearch, "__init__", _forbid_opensearch_init)
    monkeypatch.setattr(elasticsearch.Elasticsearch, "__init__", _forbid_es_init)


@pytest.fixture(autouse=True)
def isolate_test_environment(monkeypatch, tmp_path: Path, request):
    """Isolate tests from real .env, preserve os.environ, and redirect admin token path."""
    import sys
    from unittest.mock import Mock
    from atalaya.config import get_settings
    import atalaya.config

    old_env = os.environ.copy()

    # Patch reload_env to only clear settings cache without reading .env,
    # except when test_config_reload_env explicitly tests reload_env with a mock load_dotenv.
    _orig_reload_env = atalaya.config.reload_env

    def _safe_reload_env() -> None:
        if isinstance(atalaya.config.load_dotenv, Mock):
            return _orig_reload_env()
        get_settings.cache_clear()

    if "test_config_reload_env" not in request.node.nodeid:
        monkeypatch.setattr("atalaya.config.reload_env", _safe_reload_env)
        try:
            import atalaya.api.deps
            monkeypatch.setattr("atalaya.api.deps.reload_env", _safe_reload_env)
        except Exception:
            pass

    # Redirect admin token path to tmp_path
    token_path = tmp_path / "admin_token"
    monkeypatch.setattr("atalaya.api.security.ADMIN_TOKEN_PATH", token_path)

    # Isolate auth paths to tmp_path
    auth_dir = tmp_path / "auth"
    auth_dir.mkdir(parents=True, exist_ok=True)
    logs_dir = tmp_path / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)

    import atalaya.auth as _auth
    monkeypatch.setattr(_auth, "AUTH_DIR", auth_dir)
    monkeypatch.setattr(_auth, "AUTH_LOG_DIR", logs_dir)
    monkeypatch.setattr(_auth, "USERS_FILE", auth_dir / "users.json")
    monkeypatch.setattr(_auth, "ATTEMPTS_FILE", auth_dir / "attempts.json")
    monkeypatch.setattr(_auth, "SESSIONS_FILE", auth_dir / "sessions.json")
    monkeypatch.setattr(_auth, "AUTH_LOG_FILE", logs_dir / "auth.jsonl")

    # In test_api.py, legacy tests call /api/admin/reload without headers.
    # Also inject session cookie for all tests except test_auth.py for whole-suite compatibility.
    from starlette.testclient import TestClient
    from atalaya.api.security import get_admin_token
    orig_init = TestClient.__init__

    def _patched_init(self, *args, **kwargs):
        if "test_api.py" in request.node.nodeid:
            headers = dict(kwargs.get("headers") or {})
            headers.setdefault("X-Admin-Token", get_admin_token())
            kwargs["headers"] = headers

        if "test_auth.py" not in request.node.nodeid and "test_intel_api.py" not in request.node.nodeid:
            cookies = dict(kwargs.get("cookies") or {})
            if "atalaya_session" not in cookies:
                token = _auth.create_test_session("test_operator")
                cookies["atalaya_session"] = token
            kwargs["cookies"] = cookies

        orig_init(self, *args, **kwargs)

    monkeypatch.setattr(TestClient, "__init__", _patched_init)

    try:
        from atalaya.intel.jobs import reset_jobs
        reset_jobs()
    except Exception:
        pass

    try:
        yield
    finally:
        try:
            from atalaya.intel.jobs import reset_jobs
            reset_jobs()
        except Exception:
            pass
        os.environ.clear()
        os.environ.update(old_env)
        get_settings.cache_clear()


@pytest.fixture(autouse=True)
def reset_lru_caches():
    """Clear settings, search client, and store caches between test runs."""
    from atalaya.config import get_settings
    from atalaya.search_client import reset_client

    get_settings.cache_clear()
    reset_client()
    try:
        from atalaya.store import get_store
        get_store.cache_clear()
    except (ImportError, AttributeError):
        pass
    yield
    get_settings.cache_clear()
    reset_client()
    try:
        from atalaya.store import get_store
        get_store.cache_clear()
    except (ImportError, AttributeError):
        pass


@pytest.fixture
def tmp_build(tmp_path: Path):
    """Create minimal build/ and seed/ directories populated from tests/fixtures/core/."""
    build_dir = tmp_path / "build"
    seed_dir = tmp_path / "seed"
    build_dir.mkdir(parents=True, exist_ok=True)
    seed_dir.mkdir(parents=True, exist_ok=True)

    fixtures_core = Path(__file__).resolve().parent / "fixtures" / "core"
    if fixtures_core.is_dir():
        for f in fixtures_core.iterdir():
            if f.is_file():
                if f.suffix == ".parquet":
                    shutil.copy(f, build_dir / f.name)
                elif f.suffix == ".csv":
                    shutil.copy(f, seed_dir / f.name)

    return {"build_dir": build_dir, "seed_dir": seed_dir}


@pytest.fixture(autouse=True)
def isolate_guardrails_audit(monkeypatch, tmp_path: Path):
    """Isolate guardrail audit log path from real cache/logs directory."""
    try:
        import atalaya.chat.guardrails as gr
        monkeypatch.setattr(gr, "AUDIT_PATH", tmp_path / "guardrails.jsonl")
    except (ImportError, AttributeError):
        pass
