"""Unit tests for atalaya.config settings and OpenSearch configuration."""

from __future__ import annotations

import os
import pytest
from atalaya.config import Settings, get_settings, index_name


def test_config_opensearch_defaults(monkeypatch):
    monkeypatch.setenv("OPENSEARCH_URL", "https://node1:9200, https://node2:9200")
    monkeypatch.setenv("OPENSEARCH_USERNAME", "admin")
    monkeypatch.setenv("OPENSEARCH_PASSWORD", "super_secret_pw")
    monkeypatch.setenv("OPENSEARCH_VERIFY_CERTS", "false")
    monkeypatch.setenv("OPENSEARCH_CA_CERTS", "/path/to/ca.pem")
    monkeypatch.setenv("OPENSEARCH_TIMEOUT_S", "45.0")
    monkeypatch.setenv("OPENSEARCH_REPLICAS", "2")
    monkeypatch.setenv("ATALAYA_INDEX_PREFIX", "test-prefix-")
    monkeypatch.setenv("ATALAYA_STORE", "memory")
    monkeypatch.setenv("MAAS_API_KEY", "secret_api_key")
    monkeypatch.setenv("MAAS_MODEL", "glm-5.2")
    monkeypatch.setenv("ATALAYA_TARGET_YEAR", "2027")

    get_settings.cache_clear()
    s = get_settings()

    assert s.search_urls == ["https://node1:9200", "https://node2:9200"]
    assert s.search_username == "admin"
    assert s.search_password == "super_secret_pw"
    assert s.search_verify_certs is False
    assert s.search_ca_certs == "/path/to/ca.pem"
    assert s.search_timeout_s == 45.0
    assert s.search_replicas == 2
    assert s.index_prefix == "test-prefix-"
    assert s.store_mode == "memory"
    assert s.maas_api_key == "secret_api_key"
    assert s.target_year == 2027
    assert s.maas_model == "glm-5.2"


def test_config_legacy_es_fallback(monkeypatch):
    monkeypatch.delenv("OPENSEARCH_URL", raising=False)
    monkeypatch.delenv("OPENSEARCH_USERNAME", raising=False)
    monkeypatch.delenv("OPENSEARCH_PASSWORD", raising=False)
    monkeypatch.delenv("OPENSEARCH_VERIFY_CERTS", raising=False)
    monkeypatch.delenv("OPENSEARCH_TIMEOUT_S", raising=False)
    monkeypatch.delenv("OPENSEARCH_REPLICAS", raising=False)

    monkeypatch.setenv("ES_URL", "http://legacy1:9200, http://legacy2:9200")
    monkeypatch.setenv("ES_USERNAME", "legacy_user")
    monkeypatch.setenv("ES_PASSWORD", "legacy_pw")
    monkeypatch.setenv("ES_INSECURE", "true")
    monkeypatch.setenv("ES_TIMEOUT_S", "20.0")

    get_settings.cache_clear()
    s = get_settings()

    assert s.search_urls == ["http://legacy1:9200", "http://legacy2:9200"]
    assert s.search_username == "legacy_user"
    assert s.search_password == "legacy_pw"
    assert s.search_verify_certs is False
    assert s.search_timeout_s == 20.0
    assert s.search_replicas is None


def test_config_precedence(monkeypatch):
    monkeypatch.setenv("OPENSEARCH_URL", "https://new:9200")
    monkeypatch.setenv("ES_URL", "http://old:9200")
    monkeypatch.setenv("OPENSEARCH_USERNAME", "new_user")
    monkeypatch.setenv("ES_USERNAME", "old_user")
    monkeypatch.setenv("OPENSEARCH_PASSWORD", "new_pw")
    monkeypatch.setenv("ES_PASSWORD", "old_pw")
    monkeypatch.setenv("OPENSEARCH_TIMEOUT_S", "50.0")
    monkeypatch.setenv("ES_TIMEOUT_S", "10.0")
    monkeypatch.setenv("OPENSEARCH_VERIFY_CERTS", "true")
    monkeypatch.setenv("ES_INSECURE", "true")

    get_settings.cache_clear()
    s = get_settings()

    assert s.search_urls == ["https://new:9200"]
    assert s.search_username == "new_user"
    assert s.search_password == "new_pw"
    assert s.search_timeout_s == 50.0
    assert s.search_verify_certs is True


def test_config_es_insecure_mapping(monkeypatch):
    monkeypatch.delenv("OPENSEARCH_VERIFY_CERTS", raising=False)

    monkeypatch.setenv("ES_INSECURE", "true")
    get_settings.cache_clear()
    assert get_settings().search_verify_certs is False

    monkeypatch.setenv("ES_INSECURE", "false")
    get_settings.cache_clear()
    assert get_settings().search_verify_certs is True


def test_config_store_mode_normalization(monkeypatch):
    # 'es' normalizes to 'opensearch'
    monkeypatch.setenv("ATALAYA_STORE", "es")
    get_settings.cache_clear()
    assert get_settings().store_mode == "opensearch"

    monkeypatch.setenv("ATALAYA_STORE", "ES")
    get_settings.cache_clear()
    assert get_settings().store_mode == "opensearch"

    # Known modes
    monkeypatch.setenv("ATALAYA_STORE", "opensearch")
    get_settings.cache_clear()
    assert get_settings().store_mode == "opensearch"

    monkeypatch.setenv("ATALAYA_STORE", "memory")
    get_settings.cache_clear()
    assert get_settings().store_mode == "memory"

    monkeypatch.setenv("ATALAYA_STORE", "auto")
    get_settings.cache_clear()
    assert get_settings().store_mode == "auto"

    # Unknown mode normalizes to 'auto'
    monkeypatch.setenv("ATALAYA_STORE", "unknown_backend")
    get_settings.cache_clear()
    assert get_settings().store_mode == "auto"


def test_config_search_replicas(monkeypatch):
    monkeypatch.setenv("OPENSEARCH_REPLICAS", "")
    get_settings.cache_clear()
    assert get_settings().search_replicas is None

    monkeypatch.setenv("OPENSEARCH_REPLICAS", "not_a_number")
    get_settings.cache_clear()
    assert get_settings().search_replicas is None

    monkeypatch.setenv("OPENSEARCH_REPLICAS", "-1")
    get_settings.cache_clear()
    assert get_settings().search_replicas is None

    monkeypatch.setenv("OPENSEARCH_REPLICAS", "0")
    get_settings.cache_clear()
    assert get_settings().search_replicas == 0

    monkeypatch.setenv("OPENSEARCH_REPLICAS", "3")
    get_settings.cache_clear()
    assert get_settings().search_replicas == 3


def test_index_name(monkeypatch):
    monkeypatch.setenv("ATALAYA_INDEX_PREFIX", "custom-")
    get_settings.cache_clear()
    assert index_name("units") == "custom-units"
    assert index_name("participation") == "custom-participation"


def test_repr_masks_secrets():
    s = Settings(
        search_urls=["https://localhost:9200"],
        search_username="user",
        search_password="my_search_password",
        search_verify_certs=False,
        maas_api_key="my_maas_key",
    )
    repr_str = repr(s)
    assert "my_search_password" not in repr_str
    assert "my_maas_key" not in repr_str
    assert "search_password='***'" in repr_str
    assert "maas_api_key='***'" in repr_str
