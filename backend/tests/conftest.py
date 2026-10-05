"""Pytest test configuration, fixtures, and offline enforcement for ATALAYA."""

from __future__ import annotations

import os
from pathlib import Path
import shutil
import pytest
import elasticsearch

# Force offline and memory settings before any atalaya imports
os.environ["ES_URL"] = ""
os.environ["ATALAYA_STORE"] = "memory"
os.environ["ATALAYA_LLM_ENABLED"] = "0"
os.environ["MAAS_API_KEY"] = ""
os.environ["MAAS_BASE_URL"] = ""

# Ensure pytest temp directory exists on Windows
(Path(__file__).resolve().parents[1] / ".pytest_tmp").mkdir(parents=True, exist_ok=True)


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
