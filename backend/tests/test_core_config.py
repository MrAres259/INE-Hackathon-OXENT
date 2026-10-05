"""Unit tests for atalaya.config settings and helpers."""

from __future__ import annotations

import os
from atalaya.config import Settings, get_settings, index_name


def test_config_defaults(monkeypatch):
    monkeypatch.setenv("ES_URL", "http://node1:9200, http://node2:9200")
    monkeypatch.setenv("ES_USERNAME", "admin")
    monkeypatch.setenv("ES_PASSWORD", "super_secret_pw")
    monkeypatch.setenv("ES_INSECURE", "true")
    monkeypatch.setenv("ATALAYA_INDEX_PREFIX", "test-prefix-")
    monkeypatch.setenv("ATALAYA_STORE", "memory")
    monkeypatch.setenv("MAAS_API_KEY", "secret_api_key")
    monkeypatch.setenv("ATALAYA_TARGET_YEAR", "2027")

    get_settings.cache_clear()
    s = get_settings()

    assert s.es_urls == ["http://node1:9200", "http://node2:9200"]
    assert s.es_username == "admin"
    assert s.es_password == "super_secret_pw"
    assert s.es_insecure is True
    assert s.index_prefix == "test-prefix-"
    assert s.store_mode == "memory"
    assert s.maas_api_key == "secret_api_key"
    assert s.target_year == 2027
    assert s.maas_model == "glm-5.2"


def test_index_name(monkeypatch):
    monkeypatch.setenv("ATALAYA_INDEX_PREFIX", "custom-")
    get_settings.cache_clear()
    assert index_name("units") == "custom-units"
    assert index_name("participation") == "custom-participation"


def test_repr_masks_secrets():
    s = Settings(
        es_urls=["http://localhost:9200"],
        es_username="user",
        es_password="my_es_password",
        es_insecure=False,
        maas_api_key="my_maas_key",
    )
    repr_str = repr(s)
    assert "my_es_password" not in repr_str
    assert "my_maas_key" not in repr_str
    assert "es_password='***'" in repr_str
    assert "maas_api_key='***'" in repr_str
