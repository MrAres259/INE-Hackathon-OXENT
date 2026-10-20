"""Unit tests for atalaya.search_client."""

from __future__ import annotations

import pytest
from atalaya.config import get_settings
from atalaya.search_client import (
    auto_replicas,
    bulk_index,
    cluster_info,
    ensure_index_templates,
    get_client,
    get_probe_client,
    index_settings,
    ping,
    reset_client,
)


def test_get_client_none_without_url(monkeypatch):
    monkeypatch.delenv("OPENSEARCH_URL", raising=False)
    monkeypatch.delenv("ES_URL", raising=False)
    reset_client()
    assert get_client() is None


def test_get_client_construction_kwargs(monkeypatch):
    captured: dict = {}

    class MockOpenSearch:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    monkeypatch.setattr("atalaya.search_client.OpenSearch", MockOpenSearch)

    # Test with IP host
    monkeypatch.setenv("OPENSEARCH_URL", "https://10.0.0.205:9200")
    monkeypatch.setenv("OPENSEARCH_USERNAME", "admin")
    monkeypatch.setenv("OPENSEARCH_PASSWORD", "secret_pw")
    monkeypatch.setenv("OPENSEARCH_VERIFY_CERTS", "false")
    monkeypatch.setenv("OPENSEARCH_CA_CERTS", "/certs/ca.pem")
    monkeypatch.setenv("OPENSEARCH_TIMEOUT_S", "42.0")

    get_settings.cache_clear()
    reset_client()
    client = get_client()
    assert client is not None
    assert captured["hosts"] == ["https://10.0.0.205:9200"]
    assert captured["use_ssl"] is True
    assert captured["verify_certs"] is False
    assert captured["ca_certs"] == "/certs/ca.pem"
    assert captured["timeout"] == 42.0
    assert captured["http_auth"] == ("admin", "secret_pw")
    assert captured["ssl_assert_hostname"] is False
    assert captured["ssl_show_warn"] is False
    assert captured["max_retries"] == 2
    assert captured["retry_on_timeout"] is True
    assert captured["http_compress"] is True

    # Test with domain name (not IP)
    captured.clear()
    monkeypatch.setenv("OPENSEARCH_URL", "https://search.example.com:9200")
    get_settings.cache_clear()
    reset_client()
    client = get_client()
    assert client is not None
    assert captured["hosts"] == ["https://search.example.com:9200"]
    assert "ssl_assert_hostname" not in captured


def test_ping_never_raises(monkeypatch):
    # None client
    monkeypatch.setattr("atalaya.search_client.get_client", lambda: None)
    assert ping() is False

    # Successful ping
    class SuccessClient:
        def ping(self, **kwargs):
            return True

    monkeypatch.setattr("atalaya.search_client.get_client", lambda: SuccessClient())
    assert ping() is True

    # Exception during ping (must not raise)
    class FailingClient:
        def ping(self, **kwargs):
            raise ConnectionError("Cluster down")

    monkeypatch.setattr("atalaya.search_client.get_client", lambda: FailingClient())
    assert ping() is False


def test_cluster_info(monkeypatch):
    # None client
    monkeypatch.setattr("atalaya.search_client.get_client", lambda: None)
    assert cluster_info() == {}

    # Failing client
    class FailingClient:
        def info(self, **kwargs):
            raise RuntimeError("Cluster error")

    monkeypatch.setattr("atalaya.search_client.get_client", lambda: FailingClient())
    assert cluster_info() == {}

    # Healthy OpenSearch client
    class OSClient:
        def info(self, **kwargs):
            return {
                "cluster_name": "opensearch-cluster",
                "version": {
                    "distribution": "opensearch",
                    "number": "3.4.0",
                },
            }

        class cluster:
            @staticmethod
            def health(**kwargs):
                return {
                    "status": "green",
                    "number_of_nodes": 3,
                }

    monkeypatch.setattr("atalaya.search_client.get_client", lambda: OSClient())
    info = cluster_info()
    assert info == {
        "distribution": "opensearch",
        "version": "3.4.0",
        "cluster_name": "opensearch-cluster",
        "status": "green",
        "nodes": 3,
    }

    # Elasticsearch fallback when distribution is absent
    class ESClient:
        def info(self, **kwargs):
            return {
                "cluster_name": "es-cluster",
                "version": {
                    "number": "7.17.13",
                },
            }

        class cluster:
            @staticmethod
            def health(**kwargs):
                return {
                    "status": "yellow",
                    "number_of_nodes": 1,
                }

    monkeypatch.setattr("atalaya.search_client.get_client", lambda: ESClient())
    es_info = cluster_info()
    assert es_info["distribution"] == "elasticsearch"
    assert es_info["version"] == "7.17.13"


def test_auto_replicas(monkeypatch):
    class AnyClient:
        pass

    # With override in settings
    monkeypatch.setenv("OPENSEARCH_REPLICAS", "2")
    get_settings.cache_clear()
    assert auto_replicas(AnyClient()) == 2

    # Without override
    monkeypatch.delenv("OPENSEARCH_REPLICAS", raising=False)
    get_settings.cache_clear()

    class OneNodeClient:
        class cluster:
            @staticmethod
            def health(**kwargs):
                return {"number_of_nodes": 1}

    class ThreeNodeClient:
        class cluster:
            @staticmethod
            def health(**kwargs):
                return {"number_of_nodes": 3}

    class FailingHealthClient:
        class cluster:
            @staticmethod
            def health(**kwargs):
                raise RuntimeError("health failed")

    assert auto_replicas(OneNodeClient()) == 0
    assert auto_replicas(ThreeNodeClient()) == 1
    assert auto_replicas(FailingHealthClient()) == 0


def test_index_settings():
    class TwoNodeClient:
        class cluster:
            @staticmethod
            def health(**kwargs):
                return {"number_of_nodes": 2}

    # Explicit replicas
    s_explicit = index_settings(TwoNodeClient(), replicas=3)
    assert s_explicit == {
        "number_of_shards": 1,
        "number_of_replicas": 3,
        "refresh_interval": "1s",
        "max_result_window": 10000,
    }

    # Auto replicas
    s_auto = index_settings(TwoNodeClient())
    assert s_auto["number_of_replicas"] == 1


def test_ensure_index_templates(monkeypatch):
    deleted_legacy: list[str] = []
    put_templates: list[tuple[str, dict]] = []

    class MockIndices:
        def exists_template(self, *, name):
            # Simulate legacy template existing for units
            return name == "atalaya-units"

        def delete_template(self, *, name):
            deleted_legacy.append(name)

        def put_index_template(self, *, name, body):
            put_templates.append((name, body))

    class MockClient:
        indices = MockIndices()

        class cluster:
            @staticmethod
            def health(**kwargs):
                return {"number_of_nodes": 1}

    monkeypatch.setenv("ATALAYA_INDEX_PREFIX", "atalaya-")
    get_settings.cache_clear()

    names = ensure_index_templates(MockClient())
    assert names == [
        "atalaya-units",
        "atalaya-participation",
        "atalaya-catalog",
        "atalaya-profile",
    ]
    assert deleted_legacy == ["atalaya-units"]
    assert len(put_templates) == 4

    for name, body in put_templates:
        assert name.startswith("atalaya-")
        assert body["index_patterns"] == [f"{name}-*"]
        assert body["priority"] == 200
        assert "analysis" in body["template"]["settings"]
        assert body["_meta"]["schema_version"] == 2


def test_ensure_index_templates_prefix_guard(monkeypatch):
    monkeypatch.setenv("ATALAYA_INDEX_PREFIX", "")
    get_settings.cache_clear()

    class MockClient:
        pass

    with pytest.raises(ValueError, match="prefix"):
        ensure_index_templates(MockClient())


def test_bulk_index(monkeypatch):
    actions_captured: list[list[dict]] = []

    def mock_streaming_bulk(client, actions, chunk_size, max_retries, raise_on_error, raise_on_exception):
        act_list = list(actions)
        actions_captured.append(act_list)
        # Yield 5 successes, then 25 errors
        for i in range(5):
            yield True, {"ok": True, "id": str(i)}
        for i in range(25):
            yield False, {"error": f"error_sample_{i}"}

    monkeypatch.setattr("atalaya.search_client.helpers.streaming_bulk", mock_streaming_bulk)

    class MockClient:
        pass

    docs = [{"id": f"item_{i}", "val": i * 10} for i in range(30)]
    ok_count, errors = bulk_index(MockClient(), "test-index", docs, id_field="id", chunk=500, max_retries=2)

    assert ok_count == 5
    assert len(errors) == 20  # Truncated to at most 20 errors
    assert len(actions_captured[0]) == 30
    assert actions_captured[0][0] == {
        "_index": "test-index",
        "_source": docs[0],
        "_id": "item_0",
    }


def test_get_probe_client_configuration(monkeypatch):
    captured: dict = {}

    class MockOpenSearch:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    monkeypatch.setattr("atalaya.search_client.OpenSearch", MockOpenSearch)
    monkeypatch.setenv("OPENSEARCH_URL", "https://10.0.0.205:9200")
    monkeypatch.setenv("OPENSEARCH_USERNAME", "admin")
    monkeypatch.setenv("OPENSEARCH_PASSWORD", "secret_pw")
    monkeypatch.setenv("OPENSEARCH_VERIFY_CERTS", "false")

    get_settings.cache_clear()
    reset_client()

    probe_client = get_probe_client()
    assert probe_client is not None
    assert captured["hosts"] == ["https://10.0.0.205:9200"]
    assert captured["timeout"] == 2.0
    assert captured["max_retries"] == 0
    assert captured["retry_on_timeout"] is False
    assert captured["http_auth"] == ("admin", "secret_pw")
    assert captured["verify_certs"] is False
    assert captured["ssl_assert_hostname"] is False

    # Verify reset_client clears probe client cache
    captured.clear()
    reset_client()
    new_client = get_probe_client()
    assert new_client is not None
    assert captured["timeout"] == 2.0

    # Without URLs, returns None
    monkeypatch.delenv("OPENSEARCH_URL", raising=False)
    monkeypatch.delenv("ES_URL", raising=False)
    get_settings.cache_clear()
    reset_client()
    assert get_probe_client() is None

