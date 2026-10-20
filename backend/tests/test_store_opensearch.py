"""Unit tests for OpenSearchStore and ResilientStore."""

from __future__ import annotations

from unittest.mock import MagicMock, patch
import numpy as np
import pandas as pd
import pytest

from atalaya.config import Settings
from atalaya.store import (
    OpenSearchStore,
    PandasStore,
    ResilientStore,
    StoreError,
    _clean_error_message,
    get_store,
)


def test_clean_error_message_strips_secrets_and_urls():
    raw_error = "Connection failed to https://admin:SuperSecret123@10.0.0.205:9200/atalaya-units/_search: timeout"
    cleaned = _clean_error_message(Exception(raw_error))
    assert "SuperSecret123" not in cleaned
    assert "10.0.0.205:9200" not in cleaned
    assert "cluster-url" in cleaned or "ip:port" in cleaned or "***" in cleaned


def test_search_units_query_body_and_parsing():
    mock_client = MagicMock()
    mock_client.search.return_value = {
        "hits": {
            "hits": [
                {
                    "_id": "09015",
                    "_score": 8.7654,
                    "_source": {
                        "id": "09015",
                        "name": "Cuauhtémoc",
                        "level": "mun",
                        "cve_ent": "09",
                    },
                }
            ]
        }
    }

    store = OpenSearchStore(client=mock_client)
    hits = store.search_units("Cuauhtémoc", level="mun", size=5)

    assert len(hits) == 1
    assert hits[0] == {
        "id": "09015",
        "name": "Cuauhtémoc",
        "level": "mun",
        "cve_ent": "09",
        "score": 8.7654,
    }

    # Verify search call body
    mock_client.search.assert_called_once()
    call_kwargs = mock_client.search.call_args.kwargs
    assert call_kwargs["index"] == "atalaya-units"
    body = call_kwargs["body"]
    assert body["size"] == 5

    query = body["query"]["bool"]
    should_clauses = query["should"]
    assert len(should_clauses) == 3

    # 1. multi_match bool_prefix
    bool_prefix = next(c for c in should_clauses if "multi_match" in c)
    assert bool_prefix["multi_match"]["type"] == "bool_prefix"
    assert "name.sayt" in bool_prefix["multi_match"]["fields"]
    assert "name.sayt._2gram" in bool_prefix["multi_match"]["fields"]
    assert "name.sayt._3gram" in bool_prefix["multi_match"]["fields"]

    # 2. match fuzziness AUTO
    match_clause = next(c for c in should_clauses if "match" in c)
    assert match_clause["match"]["name"]["fuzziness"] == "AUTO"

    # 3. term name.kw with lowercase unaccented value and boost 10
    term_clause = next(c for c in should_clauses if "term" in c)
    assert term_clause["term"]["name.kw"]["boost"] == 10
    assert term_clause["term"]["name.kw"]["value"] == "cuauhtemoc"

    # Filter by level
    assert query["filter"] == [{"term": {"level": "mun"}}]
    assert query["minimum_should_match"] == 1


def test_search_catalog_query_body():
    mock_client = MagicMock()
    mock_client.search.return_value = {
        "hits": {
            "hits": [
                {
                    "_id": "pct_18_24",
                    "_score": 5.4321,
                    "_source": {
                        "key": "pct_18_24",
                        "label_es": "Jóvenes de 18 a 24 años",
                        "description": "Proporción de 18 a 24",
                    },
                }
            ]
        }
    }

    store = OpenSearchStore(client=mock_client)
    hits = store.search_catalog("jóvenes", size=3)

    assert len(hits) == 1
    assert hits[0]["key"] == "pct_18_24"
    assert hits[0]["score"] == 5.4321

    call_kwargs = mock_client.search.call_args.kwargs
    body = call_kwargs["body"]
    assert body["size"] == 3
    multi = body["query"]["multi_match"]
    assert multi["query"] == "jóvenes"
    assert multi["fuzziness"] == "AUTO"
    assert multi["fields"] == ["label_es^3", "description", "key^2"]


def test_unit_get_and_404():
    mock_client = MagicMock()
    # 404 response
    mock_client.get.return_value = {"found": False}

    store = OpenSearchStore(client=mock_client)
    assert store.unit("99999") is None

    get_kwargs = mock_client.get.call_args.kwargs
    assert get_kwargs["id"] == "99999"
    assert get_kwargs["ignore"] == [404]

    # Success response
    mock_client.get.return_value = {
        "found": True,
        "_source": {"id": "09015", "name": "Cuauhtémoc"},
    }
    unit = store.unit("09015")
    assert unit == {"id": "09015", "name": "Cuauhtémoc"}


def test_correlation_matrix_stats_route():
    mock_client = MagicMock()
    mock_client.search.return_value = {
        "aggregations": {
            "matrix": {
                "doc_count": 50,
                "fields": [
                    {"name": "pob_tot", "correlation": {"pob_tot": 1.0, "pob_18ymas": 0.95}},
                    {"name": "pob_18ymas", "correlation": {"pob_tot": 0.95, "pob_18ymas": 1.0}},
                ],
            }
        }
    }

    store = OpenSearchStore(client=mock_client)
    res = store.correlation(["pob_tot", "pob_18ymas"])

    assert res["method"] == "matrix_stats"
    assert res["n"] == 50
    assert res["matrix"]["pob_tot"]["pob_18ymas"] == 0.95
    assert res["matrix"]["pob_18ymas"]["pob_tot"] == 0.95
    assert res["matrix"]["pob_tot"]["pob_tot"] == 1.0


def test_correlation_client_route_when_agg_fails():
    mock_client = MagicMock()
    # matrix_stats search fails with exception
    mock_client.search.side_effect = Exception("matrix_stats aggregation unsupported")

    mock_hits = [
        {"_source": {"pob_tot": 1000.0, "pob_18ymas": 700.0}},
        {"_source": {"pob_tot": 2000.0, "pob_18ymas": 1400.0}},
        {"_source": {"pob_tot": 3000.0, "pob_18ymas": 2100.0}},
        {"_source": {"pob_tot": 4000.0, "pob_18ymas": 2800.0}},
    ]

    with patch("atalaya.store.helpers.scan", return_value=mock_hits):
        store = OpenSearchStore(client=mock_client)
        res = store.correlation(["pob_tot", "pob_18ymas"])

        assert res["method"] == "client"
        assert res["n"] == 4
        assert pytest.approx(res["matrix"]["pob_tot"]["pob_18ymas"], 0.001) == 1.0
        assert res["matrix"]["pob_tot"]["pob_tot"] == 1.0


def test_resilient_store_fallback_cooldown_and_recovery():
    fake_os = MagicMock(spec=OpenSearchStore)
    fake_os.unit.side_effect = StoreError("OpenSearch cluster unreachable")

    fake_mem = MagicMock(spec=PandasStore)
    fake_mem.unit.return_value = {"id": "09015", "name": "From Memory"}
    fake_mem.healthy.return_value = True

    simulated_time = 1000.0

    def fake_clock():
        return simulated_time

    resilient = ResilientStore(
        os_store=fake_os,
        memory_store=fake_mem,
        cooldown_s=60.0,
        clock=fake_clock,
    )

    # Initial state
    assert resilient.kind == "opensearch"
    assert resilient.degraded is False
    assert resilient.last_error is None

    # 1. Call unit -> fails in OpenSearch -> degrades to memory
    doc1 = resilient.unit("09015")
    assert doc1 == {"id": "09015", "name": "From Memory"}
    assert resilient.degraded is True
    assert resilient.kind == "memory"
    assert resilient.last_error is not None
    assert "OpenSearch cluster unreachable" in resilient.last_error

    # 2. Call inside cooldown (30s later) -> does NOT call OpenSearch
    simulated_time = 1030.0
    fake_os.unit.reset_mock()
    fake_mem.unit.reset_mock()
    fake_mem.unit.return_value = {"id": "09015", "name": "Still Memory"}

    doc2 = resilient.unit("09015")
    assert doc2 == {"id": "09015", "name": "Still Memory"}
    fake_os.unit.assert_not_called()
    fake_mem.unit.assert_called_once_with("09015")
    assert resilient.degraded is True
    assert resilient.kind == "memory"

    # 3. Call after cooldown expires (70s after initial failure)
    simulated_time = 1070.0
    fake_os.unit.side_effect = None
    fake_os.unit.return_value = {"id": "09015", "name": "From OpenSearch"}
    fake_os.unit.reset_mock()
    fake_mem.unit.reset_mock()

    doc3 = resilient.unit("09015")
    assert doc3 == {"id": "09015", "name": "From OpenSearch"}
    fake_os.unit.assert_called_once_with("09015")
    fake_mem.unit.assert_not_called()
    assert resilient.degraded is False
    assert resilient.kind == "opensearch"
    assert resilient.last_error is None


def test_get_store_modes():
    # 1. Mode: memory
    with patch("atalaya.store.get_settings") as mock_set:
        mock_set.return_value = Settings(store_mode="memory")
        get_store.cache_clear()
        s_mem = get_store()
        assert isinstance(s_mem, PandasStore)
        assert s_mem.kind == "memory"

    # 2. Mode: opensearch
    with patch("atalaya.store.get_settings") as mock_set:
        mock_set.return_value = Settings(store_mode="opensearch")
        get_store.cache_clear()
        s_os = get_store()
        assert isinstance(s_os, ResilientStore)

    # 3. Mode: auto with ping=True and index exists
    mock_client = MagicMock()
    mock_client.indices.exists.return_value = True
    with patch("atalaya.store.get_settings") as mock_set, \
         patch("atalaya.store.ping", return_value=True), \
         patch("atalaya.store.get_client", return_value=mock_client):
        mock_set.return_value = Settings(store_mode="auto")
        get_store.cache_clear()
        s_auto_ok = get_store()
        assert isinstance(s_auto_ok, ResilientStore)

    # 4. Mode: auto with ping=False
    with patch("atalaya.store.get_settings") as mock_set, \
         patch("atalaya.store.ping", return_value=False):
        mock_set.return_value = Settings(store_mode="auto")
        get_store.cache_clear()
        s_auto_fail = get_store()
        assert isinstance(s_auto_fail, PandasStore)
