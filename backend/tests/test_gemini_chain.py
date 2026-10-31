"""Unit tests for Gemini fallback chain, timeouts, retries, repair model, and research unit Ruta B."""

from __future__ import annotations

import json
from pathlib import Path
import httpx
import pytest

from atalaya import gemini, websearch
from atalaya.config import get_settings
from atalaya.explain import verify
from atalaya.intel.campaign import research_unit
from atalaya.intel.schemas import DataSnapshot


@pytest.fixture(autouse=True)
def setup_chain_env(monkeypatch, tmp_path):
    """Set up sandbox cache dir and clean settings for each test."""
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(gemini, "CACHE_DIR", cache_dir)
    monkeypatch.setattr(websearch, "CACHE_DIR", cache_dir)
    monkeypatch.setenv("GEMINI_API_KEY", "test_gemini_key_789")
    monkeypatch.setenv("GEMINI_MODEL", "gemini-3.8-flash")
    monkeypatch.setenv("GEMINI_FALLBACK_MODELS", "gemini-3.6-flash,gemini-3.5-flash")
    monkeypatch.setenv("GEMINI_RESEARCH_MODELS", "gemini-3.8-flash,gemini-3.6-flash,gemini-3.5-flash")
    monkeypatch.setenv("GEMINI_MODEL_TIMEOUTS", "gemini-3.8-flash=180,gemini-3.7-flash=180,*=60")
    monkeypatch.setenv("GEMINI_REPAIR_MODEL", "gemini-3.1-flash-lite")
    monkeypatch.setenv("GEMINI_BASE_URL", "https://mock.gemini.api/v1beta")
    monkeypatch.setenv("INTEL_GEMINI_DAILY_LIMIT", "20")
    get_settings.cache_clear()
    gemini.resolve_source_url.cache_clear()
    yield
    gemini.resolve_source_url.cache_clear()
    get_settings.cache_clear()


def test_primary_timeout_advances_to_fallback_without_retry(monkeypatch):
    """When primary model times out, it does not retry (already waited 180s) and passes to next model."""
    models_called = []
    sleeps = []
    monkeypatch.setattr(gemini, "_sleep", lambda s: sleeps.append(s))

    def handler(request: httpx.Request) -> httpx.Response:
        url_str = str(request.url)
        for m in ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash"]:
            if m in url_str:
                models_called.append(m)
                if m == "gemini-3.8-flash":
                    raise httpx.ReadTimeout("Timeout waiting for 3.8", request=request)
                elif m == "gemini-3.6-flash":
                    return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": "Respuesta 3.6"}]}}]})
        return httpx.Response(404)

    monkeypatch.setattr(
        gemini,
        "_client_factory",
        lambda timeout, **kw: httpx.Client(transport=httpx.MockTransport(handler), timeout=timeout),
    )

    res = gemini._call_gemini_raw("test prompt", tools=None)
    assert res.text == "Respuesta 3.6"
    assert res.model == "gemini-3.6-flash"
    # Primary timed out and passed immediately to 3.6 with 0 retries
    assert models_called == ["gemini-3.8-flash", "gemini-3.6-flash"]
    assert sleeps == []


def test_fallback_503_retries_twice_then_advances(monkeypatch):
    """When fallback model returns 503, it retries up to 2 times (5s and 15s) before advancing."""
    models_called = []
    sleeps = []
    monkeypatch.setattr(gemini, "_sleep", lambda s: sleeps.append(s))

    def handler(request: httpx.Request) -> httpx.Response:
        url_str = str(request.url)
        for m in ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash"]:
            if m in url_str:
                models_called.append(m)
                if m == "gemini-3.8-flash":
                    return httpx.Response(503, text="High demand")
                elif m == "gemini-3.6-flash":
                    return httpx.Response(503, text="High demand fallback")
                elif m == "gemini-3.5-flash":
                    return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": "Respuesta 3.5"}]}}]})
        return httpx.Response(404)

    monkeypatch.setattr(
        gemini,
        "_client_factory",
        lambda timeout, **kw: httpx.Client(transport=httpx.MockTransport(handler), timeout=timeout),
    )

    res = gemini._call_gemini_raw("test retries", tools=None)
    assert res.text == "Respuesta 3.5"
    assert res.model == "gemini-3.5-flash"
    # Primary tried once; fallback 3.6 tried 3 times (1 initial + 2 retries); then 3.5 tried once
    assert models_called == [
        "gemini-3.8-flash",
        "gemini-3.6-flash",
        "gemini-3.6-flash",
        "gemini-3.6-flash",
        "gemini-3.5-flash",
    ]
    # Retries wait 5s then 15s
    assert sleeps == [5.0, 15.0]


def test_lite_model_filtered_from_chains(monkeypatch):
    """Any model with 'lite' in its name is filtered out from fallback and research chains."""
    monkeypatch.setenv("GEMINI_FALLBACK_MODELS", "gemini-3.6-flash,gemini-3.1-flash-lite,gemini-3.5-flash")
    monkeypatch.setenv("GEMINI_RESEARCH_MODELS", "gemini-3.8-flash,gemini-3.1-flash-lite,gemini-3.6-flash")
    get_settings.cache_clear()

    settings = get_settings()
    assert "gemini-3.1-flash-lite" not in settings.gemini_fallback_models
    assert "gemini-3.1-flash-lite" not in settings.gemini_research_models
    assert settings.gemini_fallback_models == ["gemini-3.6-flash", "gemini-3.5-flash"]
    assert settings.gemini_research_models == ["gemini-3.8-flash", "gemini-3.6-flash"]

    # Even if someone manually passed a chain with lite to _call_gemini_raw
    models_requested = []

    def handler(request: httpx.Request) -> httpx.Response:
        models_requested.append(str(request.url))
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": "OK"}]}}]})

    monkeypatch.setattr(
        gemini,
        "_client_factory",
        lambda timeout, **kw: httpx.Client(transport=httpx.MockTransport(handler), timeout=timeout),
    )

    gemini._call_gemini_raw("test", models=["gemini-3.1-flash-lite", "gemini-3.6-flash"])
    assert len(models_requested) == 1
    assert "gemini-3.6-flash" in models_requested[0]
    assert "lite" not in models_requested[0]


def test_model_timeouts_from_config(monkeypatch):
    """Timeouts per model are read from GEMINI_MODEL_TIMEOUTS."""
    monkeypatch.setenv("GEMINI_MODEL_TIMEOUTS", "gemini-3.8-flash=180,gemini-3.6-flash=60,*=45")
    get_settings.cache_clear()

    captured_timeouts = {}

    def handler(request: httpx.Request) -> httpx.Response:
        url_str = str(request.url)
        for m in ["gemini-3.8-flash", "gemini-3.6-flash"]:
            if m in url_str:
                if m == "gemini-3.8-flash":
                    return httpx.Response(503)
                return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": "{}"}]}}]})
        return httpx.Response(404)

    def custom_factory(timeout: float, **kw):
        # We check which model will be called next based on current calls
        return httpx.Client(transport=httpx.MockTransport(handler), timeout=timeout)

    # Wrap to capture timeouts passed to client
    real_create = gemini._create_httpx_client

    def spy_client(timeout: float, **kw):
        captured_timeouts[len(captured_timeouts)] = timeout
        return httpx.Client(transport=httpx.MockTransport(handler), timeout=timeout)

    monkeypatch.setattr(gemini, "_client_factory", spy_client)

    gemini._call_gemini_raw("test timeout")
    # First model (3.8) timeout is 180s
    assert captured_timeouts[0] == 180.0
    # Second model (3.6) timeout is 60s
    assert captured_timeouts[1] == 60.0


def test_generate_json_records_last_model_and_respects_deadline(monkeypatch):
    """generate_json records last_model, checks budget, and skips attempts that exceed deadline."""
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"candidates": [{"content": {"parts": [{"text": '{"analisis": "valido"}'}]}}]},
        )

    monkeypatch.setattr(
        gemini,
        "_client_factory",
        lambda timeout, **kw: httpx.Client(transport=httpx.MockTransport(handler), timeout=timeout),
    )

    parsed, meta = gemini.generate_json("dame json", deadline_s=300.0)
    assert parsed == {"analisis": "valido"}
    assert meta.model == "gemini-3.8-flash"
    assert meta.from_cache is False
    assert gemini.get_last_model() == "gemini-3.8-flash"

    # Now with a tight deadline that cannot accommodate the 180s model or 60s model
    with pytest.raises(gemini.GeminiError, match="falló en todos los modelos|sin respuesta válida"):
        gemini.generate_json("dame json", deadline_s=5.0)


def test_json_repair_uses_repair_model(monkeypatch):
    """When initial extract_json fails, repair call explicitly uses GEMINI_REPAIR_MODEL."""
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        if len(calls) == 1:
            # First call returns malformed JSON
            return httpx.Response(
                200,
                json={"candidates": [{"content": {"parts": [{"text": "Aquí no hay json {incompleto"}]}}]},
            )
        # Second call is the repair call
        return httpx.Response(
            200,
            json={"candidates": [{"content": {"parts": [{"text": '{"reparado": true}'}]}}]},
        )

    monkeypatch.setattr(
        gemini,
        "_client_factory",
        lambda timeout, **kw: httpx.Client(transport=httpx.MockTransport(handler), timeout=timeout),
    )

    parsed, meta = gemini.generate_json("genera")
    assert parsed == {"reparado": True}
    assert len(calls) == 2
    # Verify second call used gemini_repair_model (gemini-3.1-flash-lite)
    assert "gemini-3.1-flash-lite" in calls[1]


def test_research_unit_ruta_b_end_to_end(monkeypatch):
    """research_unit Ruta B (no grounding) searches news, fetches corpus, generates inline JSON, and verifies quotes."""
    # 1. Trip grounding circuit to force Ruta B
    gemini._trip_grounding_circuit()
    assert gemini._is_grounding_available()[0] is False

    # 2. Mock websearch
    mock_candidates = [
        websearch.NewsCandidate(
            title="Elecciones en Chetumal",
            url="https://eluniversal.com.mx/chetumal",
            domain="eluniversal.com.mx",
            outlet="El Universal",
            published="2024-06-01",
            snippet="Snippet Chetumal",
            provider="google_news",
        ),
    ]
    monkeypatch.setattr(websearch, "search_news", lambda *a, **kw: mock_candidates)

    # 3. Mock HTTP client for corpus fetching
    quote_text = "en chetumal quintana roo la abstencion fue alta debido a la dispersion comunitaria"
    article_html = f"<html><body><p>{quote_text} y falta de transporte.</p></body></html>"

    def http_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, headers={"Content-Type": "text/html; charset=utf-8"}, text=article_html)

    client = httpx.Client(transport=httpx.MockTransport(http_handler))
    real_fetch = verify.fetch_corpus

    def fake_fetch(cands, **kw):
        kw.pop("client", None)
        return real_fetch(cands, client=client, **kw)

    monkeypatch.setattr(verify, "fetch_corpus", fake_fetch)

    # 4. Mock generate_json returning a finding backed by the quote
    def mock_generate_json(prompt, system=None, **kw):
        raw_json = {
            "findings": [
                {
                    "title": "Dispersión comunitaria en Chetumal",
                    "summary": "Reporte documenta alta abstención por dispersión comunitaria.",
                    "category": "acceso_casillas_distancia",
                    "scope": "municipio",
                    "confidence": "alta",
                    "evidence": ["s1"],
                    "quote": quote_text,
                }
            ]
        }
        meta = gemini.GenerationMeta(
            model="gemini-3.8-flash",
            from_cache=False,
            elapsed_s=1.2,
            attempts=[("gemini-3.8-flash", "ok")],
        )
        return raw_json, meta

    monkeypatch.setattr(gemini, "generate_json", mock_generate_json)

    snap = DataSnapshot(
        unit_id="23004",
        name="Chetumal",
        level="mun",
        ent="23",
        ent_name="Quintana Roo",
        lista_nominal=200000,
        pred_abstention=0.55,
        pred_low=0.50,
        pred_high=0.60,
        category="rojo",
        risk_score=68.0,
        last_participation=0.45,
        last_year=2024,
        trend_pp=-2.0,
        abstencion_esperada=110000,
    )

    bundle = research_unit(snap, focus="participación")

    assert bundle.degraded is False
    assert bundle.search_mode == "respaldo"
    assert bundle.model == "gemini-3.8-flash"
    assert len(bundle.findings) == 1
    f = bundle.findings[0]
    assert f.verification == "cita_verificada"
    assert f.quote == quote_text
    assert len(bundle.sources) == 1
    assert bundle.sources[0].domain == "eluniversal.com.mx"
