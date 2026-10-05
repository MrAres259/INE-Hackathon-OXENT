"""Pytest test configuration, fixtures, and offline enforcement for ATALAYA."""

from __future__ import annotations

import builtins
import os
from pathlib import Path
import shutil
from typing import Any
import pytest
import elasticsearch
import pandas as pd

import atalaya.ingest.common as _ingest_common

# Force offline and memory settings before any atalaya imports
os.environ["ES_URL"] = ""
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
def block_elasticsearch_init(monkeypatch):
    """Enforce offline execution: forbid instantiating Elasticsearch during tests."""
    def _forbid_init(*args, **kwargs):
        raise RuntimeError("Network/Elasticsearch client instantiation is blocked in tests.")

    monkeypatch.setattr(elasticsearch.Elasticsearch, "__init__", _forbid_init)


@pytest.fixture(autouse=True)
def reset_lru_caches():
    """Clear settings, es client, and store caches between test runs."""
    from atalaya.config import get_settings
    from atalaya.es_client import get_es
    from atalaya.store import get_store

    get_settings.cache_clear()
    get_es.cache_clear()
    get_store.cache_clear()
    yield
    get_settings.cache_clear()
    get_es.cache_clear()
    get_store.cache_clear()


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
