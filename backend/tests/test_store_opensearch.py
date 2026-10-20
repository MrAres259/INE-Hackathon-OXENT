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

    # Initial state: unverified, no probe has passed yet -> kind is memory
    assert resilient.kind == "memory"
    assert resilient.degraded is False
    assert resilient.last_error is None

    # Test injectable properties at init
    injected_store = ResilientStore(
        os_store=fake_os,
        memory_store=fake_mem,
        kind="opensearch",
        degraded=True,
        last_error="custom error",
    )
    assert injected_store.kind == "opensearch"
    assert injected_store.degraded is True
    assert injected_store.last_error == "custom error"

    # 1. Call unit -> probe passes on fake_os -> unit() fails in OpenSearch -> degrades to memory
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
    fake_mem.unit.return_value = {"id": "09015", "name": "Still Memory"}

    # Trigger re-probe; current request served from memory without waiting
    doc3 = resilient.unit("09015")
    assert doc3 == {"id": "09015", "name": "Still Memory"}
    fake_mem.unit.assert_called_once_with("09015")

    # Wait for background probe thread to complete
    if resilient._probe_thread:
        resilient._probe_thread.join(timeout=2.0)

    # Next call goes to OpenSearch
    fake_os.unit.reset_mock()
    fake_mem.unit.reset_mock()
    doc4 = resilient.unit("09015")
    assert doc4 == {"id": "09015", "name": "From OpenSearch"}
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

    # 3. Mode: auto with search_urls -> ResilientStore without ping
    with patch("atalaya.store.get_settings") as mock_set, \
         patch("atalaya.store.ping") as mock_ping:
        mock_set.return_value = Settings(store_mode="auto", search_urls=["https://10.0.0.205:9200"])
        get_store.cache_clear()
        s_auto_ok = get_store()
        assert isinstance(s_auto_ok, ResilientStore)
        mock_ping.assert_not_called()

    # 4. Mode: auto without search_urls -> PandasStore without ping
    with patch("atalaya.store.get_settings") as mock_set, \
         patch("atalaya.store.ping") as mock_ping:
        mock_set.return_value = Settings(store_mode="auto", search_urls=[])
        get_store.cache_clear()
        s_auto_empty = get_store()
        assert isinstance(s_auto_empty, PandasStore)
        assert s_auto_empty.kind == "memory"
        mock_ping.assert_not_called()


def test_resilient_store_probe_fails_missing_alias():
    mock_client = MagicMock()
    mock_client.ping.return_value = True
    mock_client.indices.exists.return_value = False

    fake_os = OpenSearchStore(client=mock_client)
    fake_mem = MagicMock(spec=PandasStore)
    fake_mem.unit.return_value = {"id": "09015", "name": "From Memory"}

    resilient = ResilientStore(os_store=fake_os, memory_store=fake_mem, cooldown_s=60.0)

    # First call triggers probe, fails due to missing alias
    doc = resilient.unit("09015")
    assert doc == {"id": "09015", "name": "From Memory"}
    assert resilient.degraded is True
    assert resilient.kind == "memory"
    assert resilient.last_error == "índice no cargado"
    # Full query was never sent
    mock_client.get.assert_not_called()


def test_resilient_store_no_probe_during_cooldown():
    mock_client = MagicMock()
    mock_client.ping.return_value = True
    mock_client.indices.exists.return_value = False

    fake_os = OpenSearchStore(client=mock_client)
    fake_mem = MagicMock(spec=PandasStore)
    fake_mem.unit.return_value = {"id": "09015", "name": "From Memory"}

    t = 1000.0
    resilient = ResilientStore(
        os_store=fake_os,
        memory_store=fake_mem,
        cooldown_s=60.0,
        clock=lambda: t,
    )

    # Call 1: fails probe -> enters cooldown
    resilient.unit("09015")
    assert mock_client.indices.exists.call_count == 1

    # Call 2: inside cooldown (30s later) -> does NOT probe
    t = 1030.0
    resilient.unit("09015")
    assert mock_client.indices.exists.call_count == 1
    assert resilient.degraded is True


def test_resilient_store_single_probe_on_cooldown_expiry_concurrent():
    import threading

    mock_client = MagicMock()
    mock_client.ping.return_value = True
    mock_client.indices.exists.return_value = False

    fake_os = OpenSearchStore(client=mock_client)
    fake_mem = MagicMock(spec=PandasStore)
    fake_mem.unit.return_value = {"id": "09015", "name": "From Memory"}

    t = 1000.0
    resilient = ResilientStore(
        os_store=fake_os,
        memory_store=fake_mem,
        cooldown_s=60.0,
        clock=lambda: t,
    )

    # Initial call fails probe
    resilient.unit("09015")
    assert mock_client.indices.exists.call_count == 1

    # Advance beyond cooldown
    t = 1070.0

    probe_started = threading.Event()
    probe_proceed = threading.Event()

    def slow_exists(*args, **kwargs):
        probe_started.set()
        probe_proceed.wait(timeout=2.0)
        return False

    mock_client.indices.exists.side_effect = slow_exists

    results = []

    def worker():
        results.append(resilient.unit("09015"))

    th1 = threading.Thread(target=worker)
    th2 = threading.Thread(target=worker)

    th1.start()
    probe_started.wait(timeout=2.0)
    # While th1 is probing, th2 calls unit -> should NOT probe, go straight to memory
    th2.start()
    th2.join(timeout=2.0)

    # Allow th1 probe to finish
    probe_proceed.set()
    th1.join(timeout=2.0)

    # Exactly one recovery probe was initiated
    assert mock_client.indices.exists.call_count == 2
    assert len(results) == 2


def test_resilient_store_recovery_after_successful_probe():
    mock_client = MagicMock()
    mock_client.ping.return_value = True
    mock_client.indices.exists.return_value = False

    fake_os = OpenSearchStore(client=mock_client)
    fake_mem = MagicMock(spec=PandasStore)
    fake_mem.unit.return_value = {"id": "09015", "name": "From Memory"}

    t = 1000.0
    resilient = ResilientStore(
        os_store=fake_os,
        memory_store=fake_mem,
        cooldown_s=60.0,
        clock=lambda: t,
    )

    # Fails initial probe
    resilient.unit("09015")
    assert resilient.degraded is True
    assert resilient.kind == "memory"

    # Fix cluster, advance time
    mock_client.indices.exists.return_value = True
    mock_client.get.return_value = {"found": True, "_source": {"id": "09015", "name": "From OpenSearch"}}
    t = 1070.0

    # Call triggers background re-probe, returns from memory
    doc_mem = resilient.unit("09015")
    assert doc_mem == {"id": "09015", "name": "From Memory"}

    # Wait for probe to complete
    if resilient._probe_thread:
        resilient._probe_thread.join(timeout=2.0)

    # Next call goes to OpenSearch
    doc = resilient.unit("09015")
    assert doc == {"id": "09015", "name": "From OpenSearch"}
    assert resilient.degraded is False
    assert resilient.kind == "opensearch"
    assert resilient.last_error is None


def test_opensearch_store_enforces_request_timeout_cap():
    mock_client = MagicMock()
    mock_client.search.return_value = {"hits": {"hits": []}}
    mock_client.get.return_value = {"found": False}

    with patch("atalaya.store.get_settings") as mock_set:
        mock_set.return_value = Settings(search_timeout_s=30.0)
        store = OpenSearchStore(client=mock_client)

        store.unit("09015")
        get_kwargs = mock_client.get.call_args.kwargs
        assert get_kwargs["request_timeout"] <= 10.0

        store.search_units("test")
        search_kwargs = mock_client.search.call_args.kwargs
        assert search_kwargs["request_timeout"] <= 10.0

        store.search_catalog("test")
        cat_kwargs = mock_client.search.call_args.kwargs
        assert cat_kwargs["request_timeout"] <= 10.0

        store.top("risk_score")
        top_kwargs = mock_client.search.call_args.kwargs
        assert top_kwargs["request_timeout"] <= 10.0

        store.aggregate("pob_tot")
        agg_kwargs = mock_client.search.call_args.kwargs
        assert agg_kwargs["request_timeout"] <= 10.0


def test_reload_all_cleans_settings_client_and_store():
    from atalaya.api.deps import reload_all

    with patch("atalaya.api.deps.reload_env") as mock_reload_env, \
         patch("atalaya.api.deps.reset_client") as mock_reset_client, \
         patch("atalaya.api.deps.get_store") as mock_get_store:
        mock_store = MagicMock()
        mock_store.stats.return_value = {"units_mun": 5}
        mock_get_store.return_value = mock_store

        res = reload_all()
        mock_reload_env.assert_called_once()
        mock_reset_client.assert_called_once()
        mock_get_store.cache_clear.assert_called_once()
        mock_store.reload.assert_called_once()
        assert res == {"units_mun": 5}


def test_config_reload_env():
    from atalaya.config import BACKEND_DIR, get_settings, reload_env

    with patch("atalaya.config.load_dotenv") as mock_load, \
         patch.object(get_settings, "cache_clear") as mock_clear:
        reload_env()
        mock_load.assert_called_once_with(BACKEND_DIR / ".env", override=True)
        mock_clear.assert_called_once()


def test_top_search_sort_tie_breaking_body():
    mock_client = MagicMock()
    mock_client.search.return_value = {
        "hits": {
            "hits": [
                {
                    "_id": "20322",
                    "_source": {"id": "20322", "name": "Mun A", "risk_score": 91.9, "level": "mun", "cve_ent": "20"},
                },
                {
                    "_id": "20548",
                    "_source": {"id": "20548", "name": "Mun B", "risk_score": 91.9, "level": "mun", "cve_ent": "20"},
                },
            ]
        }
    }

    store = OpenSearchStore(client=mock_client)

    # 1. Default order="desc"
    store.top("risk_score", limit=10, order="desc")
    call_body = mock_client.search.call_args.kwargs["body"]
    assert call_body["sort"] == [
        {"risk_score": {"order": "desc", "missing": "_last"}},
        {"id": "asc"},
    ]

    # 2. order="asc"
    store.top("risk_score", limit=5, order="asc")
    call_body = mock_client.search.call_args.kwargs["body"]
    assert call_body["sort"] == [
        {"risk_score": {"order": "asc", "missing": "_last"}},
        {"id": "asc"},
    ]

    # 3. participacion mapped to wide field
    store.top("participacion", limit=10, filters={"year": 2024})
    call_body = mock_client.search.call_args.kwargs["body"]
    assert call_body["sort"] == [
        {"part_dip_2024": {"order": "desc", "missing": "_last"}},
        {"id": "asc"},
    ]


def test_resilient_store_fast_degradation_and_nonblocking_bg_probe():
    import threading

    mock_probe_client = MagicMock()
    mock_probe_client.ping.side_effect = TimeoutError("Connection timed out")

    fake_os = OpenSearchStore(client=mock_probe_client)
    fake_mem = MagicMock(spec=PandasStore)
    fake_mem.unit.return_value = {"id": "09015", "name": "From Memory"}
    fake_mem.healthy.return_value = True

    sim_time = 1000.0

    resilient = ResilientStore(
        os_store=fake_os,
        memory_store=fake_mem,
        cooldown_s=60.0,
        clock=lambda: sim_time,
    )

    # First call: single probe fails and degrades immediately to memory
    doc1 = resilient.unit("09015")
    assert doc1 == {"id": "09015", "name": "From Memory"}
    assert resilient.degraded is True
    assert resilient.kind == "memory"
    # indices.exists is NEVER called because ping failed
    mock_probe_client.indices.exists.assert_not_called()
    assert mock_probe_client.ping.call_count == 1

    # Advance beyond cooldown
    sim_time = 1070.0

    probe_started = threading.Event()
    probe_proceed = threading.Event()

    def slow_ping(*args, **kwargs):
        probe_started.set()
        probe_proceed.wait(timeout=2.0)
        return True

    mock_probe_client.ping.side_effect = slow_ping
    mock_probe_client.indices.exists.return_value = True
    mock_probe_client.get.return_value = {"found": True, "_source": {"id": "09015", "name": "From OpenSearch"}}

    # Call triggers background probe thread and does not block/wait
    doc2 = resilient.unit("09015")
    assert doc2 == {"id": "09015", "name": "From Memory"}
    assert probe_started.wait(timeout=2.0) is True

    # Subsequent call while probe is in flight also does not wait and serves from memory
    doc3 = resilient.unit("09015")
    assert doc3 == {"id": "09015", "name": "From Memory"}

    # Now allow probe to proceed and complete
    probe_proceed.set()
    if resilient._probe_thread:
        resilient._probe_thread.join(timeout=2.0)

    # Next call goes to OpenSearch
    doc4 = resilient.unit("09015")
    assert doc4 == {"id": "09015", "name": "From OpenSearch"}
    assert resilient.degraded is False
    assert resilient.kind == "opensearch"



