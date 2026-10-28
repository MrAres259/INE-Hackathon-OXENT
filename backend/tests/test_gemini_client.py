"""Unit tests for atalaya.gemini client, grounding, JSON extraction, budget and redirects."""

from __future__ import annotations

import json
from pathlib import Path
import httpx
import pytest

from atalaya import gemini
from atalaya.config import get_settings


@pytest.fixture(autouse=True)
def setup_gemini_env(monkeypatch, tmp_path):
    """Set up sandbox cache dir and clean settings for each test."""
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(gemini, "CACHE_DIR", cache_dir)
    monkeypatch.setenv("GEMINI_API_KEY", "test_gemini_api_key_456")
    monkeypatch.setenv("GEMINI_MODEL", "gemini-3.8-flash")
    monkeypatch.setenv("GEMINI_BASE_URL", "https://mock.gemini.api/v1beta")
    monkeypatch.setenv("GEMINI_THINKING_LEVEL", "medium")
    monkeypatch.setenv("INTEL_GEMINI_DAILY_LIMIT", "5")
    get_settings.cache_clear()
    gemini.resolve_source_url.cache_clear()
    yield
    gemini.resolve_source_url.cache_clear()
    get_settings.cache_clear()


def test_is_enabled(monkeypatch):
    """is_enabled returns True only when GEMINI_API_KEY is present and non-empty."""
    monkeypatch.setenv("GEMINI_API_KEY", "")
    get_settings.cache_clear()
    assert gemini.is_enabled() is False

    monkeypatch.setenv("GEMINI_API_KEY", "  ")
    get_settings.cache_clear()
    assert gemini.is_enabled() is False

    monkeypatch.setenv("GEMINI_API_KEY", "valid_key")
    get_settings.cache_clear()
    assert gemini.is_enabled() is True


def test_grounded_search_request_structure(monkeypatch):
    """Verify request headers, body tools, thinkingConfig, and absence of temperature."""
    captured_request = None
    captured_body = None

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal captured_request, captured_body
        captured_request = request
        captured_body = json.loads(request.content)
        mock_resp = {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {"text": "Pensamiento preliminar", "thought": True},
                            {"text": "Texto informativo relevante sobre el INE."},
                        ]
                    },
                    "groundingMetadata": {
                        "webSearchQueries": ["elecciones mexico 2027", "participacion ine"],
                        "groundingChunks": [
                            {
                                "web": {
                                    "uri": "https://www.eluniversal.com.mx/elecciones",
                                    "title": "Noticia Electoral",
                                }
                            }
                        ],
                        "groundingSupports": [{"segment": {"text": "Texto informativo"}}],
                    },
                }
            ]
        }
        return httpx.Response(200, json=mock_resp)

    monkeypatch.setattr(gemini, "_client_factory", lambda timeout, **kw: httpx.Client(transport=httpx.MockTransport(handler), timeout=timeout))

    result = gemini.grounded_search("Investiga sobre el INE", system="Eres investigador")

    assert captured_request.headers.get("x-goog-api-key") == "test_gemini_api_key_456"
    assert "temperature" not in captured_body.get("generationConfig", {})
    assert captured_body["generationConfig"]["thinkingConfig"]["thinkingLevel"] == "medium"
    assert captured_body["tools"] == [{"google_search": {}}]
    assert captured_body["systemInstruction"]["parts"][0]["text"] == "Eres investigador"

    # Verify thoughts are ignored and content parsed
    assert "Pensamiento preliminar" not in result.text
    assert "Texto informativo relevante sobre el INE." in result.text
    assert len(result.queries) == 2
    assert result.queries[0] == "elecciones mexico 2027"
    assert len(result.sources) == 1
    assert result.sources[0].domain == "eluniversal.com.mx"
    assert result.sources[0].title == "Noticia Electoral"
    assert result.from_cache is False


def test_400_thinking_retry(monkeypatch):
    """When a 400 error mentions 'thinking', retry once without thinkingConfig."""
    attempts = 0
    bodies = []

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        b = json.loads(request.content)
        bodies.append(b)
        if attempts == 1:
            return httpx.Response(400, text="thinkingConfig is not supported for this model")
        mock_resp = {
            "candidates": [
                {"content": {"parts": [{"text": "Respuesta tras reintento"}]}}
            ]
        }
        return httpx.Response(200, json=mock_resp)

    monkeypatch.setattr(gemini, "_client_factory", lambda timeout, **kw: httpx.Client(transport=httpx.MockTransport(handler), timeout=timeout))

    result = gemini.grounded_search("prueba")
    assert result.text == "Respuesta tras reintento"
    assert attempts == 2
    assert "thinkingConfig" in bodies[0].get("generationConfig", {})
    assert "thinkingConfig" not in bodies[1].get("generationConfig", {})


def test_429_quota_error(monkeypatch):
    """HTTP 429 raises GeminiQuotaError with retry_after_s attribute."""
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, headers={"Retry-After": "3.5"}, text="Resource exhausted")

    monkeypatch.setattr(gemini, "_client_factory", lambda timeout, **kw: httpx.Client(transport=httpx.MockTransport(handler), timeout=timeout))
    monkeypatch.setattr(gemini.time, "sleep", lambda s: None)

    with pytest.raises(gemini.GeminiQuotaError) as exc_info:
        gemini.grounded_search("test quota")
    assert exc_info.value.retry_after_s == 3.5


def test_budget_exceeded(monkeypatch):
    """Exceeding INTEL_GEMINI_DAILY_LIMIT raises GeminiBudgetExceeded without HTTP calls."""
    monkeypatch.setenv("INTEL_GEMINI_DAILY_LIMIT", "2")
    get_settings.cache_clear()

    http_calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal http_calls
        http_calls += 1
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": "OK"}]}}]})

    monkeypatch.setattr(gemini, "_client_factory", lambda timeout, **kw: httpx.Client(transport=httpx.MockTransport(handler), timeout=timeout))

    # Call 1 & 2 succeed
    gemini.grounded_search("call 1")
    gemini.grounded_search("call 2")
    assert http_calls == 2

    # Call 3 exceeds limit
    with pytest.raises(gemini.GeminiBudgetExceeded, match="Presupuesto diario local"):
        gemini.grounded_search("call 3")
    assert http_calls == 2

    status = gemini.budget_status()
    assert status["used"] == 2
    assert status["limit"] == 2


def test_disk_cache_ttl(monkeypatch):
    """A search with cache_key and TTL returns from cache on second call without HTTP."""
    http_calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal http_calls
        http_calls += 1
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": "Respuesta cacheadable"}]}}]})

    monkeypatch.setattr(gemini, "_client_factory", lambda timeout, **kw: httpx.Client(transport=httpx.MockTransport(handler), timeout=timeout))

    # First call - cache miss
    res1 = gemini.grounded_search("pregunta", cache_key="key1", cache_ttl_s=3600)
    assert res1.from_cache is False
    assert http_calls == 1

    # Second call - cache hit
    res2 = gemini.grounded_search("pregunta", cache_key="key1", cache_ttl_s=3600)
    assert res2.from_cache is True
    assert res2.text == "Respuesta cacheadable"
    assert http_calls == 1


def test_extract_json_diverse_cases():
    """extract_json handles simple dict, array, nested structures, fences, and text before/after."""
    # 1. Plain dictionary
    assert gemini.extract_json('{"key": "value"}') == {"key": "value"}

    # 2. Plain array
    assert gemini.extract_json('["a", "b", "c"]') == ["a", "b", "c"]

    # 3. Code fence wrapped
    fenced = "```json\n{\"count\": 42, \"items\": [1, 2]}\n```"
    assert gemini.extract_json(fenced) == {"count": 42, "items": [1, 2]}

    # 4. Text before and after
    mixed = "Por supuesto, aquí tienes el resultado solicitado:\n{\"estado\": \"07\", \"nombre\": \"Chiapas\"}\nEspero te sirva."
    assert gemini.extract_json(mixed) == {"estado": "07", "nombre": "Chiapas"}

    # 5. Nested object with escaped quotes
    escaped = '{"title": "Texto con \\"comillas\\" anidadas", "nested": {"list": [{"id": 1}]}}'
    assert gemini.extract_json(escaped)["title"] == 'Texto con "comillas" anidadas'

    # 6. Array of objects with text
    arr_text = "Lista de hallazgos:\n[{\"id\": \"f1\", \"score\": 0.95}, {\"id\": \"f2\", \"score\": 0.80}]"
    assert gemini.extract_json(arr_text) == [{"id": "f1", "score": 0.95}, {"id": "f2", "score": 0.80}]

    # 7. Invalid text raises ValueError
    with pytest.raises(ValueError, match="No se encontró"):
        gemini.extract_json("Esto no tiene nada de json")


def test_grounded_json_repair_retry(monkeypatch):
    """When initial extract_json fails, grounded_json executes a repair call without tools."""
    call_count = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal call_count
        call_count += 1
        body = json.loads(request.content)
        if call_count == 1:
            # First response with bad JSON and grounding metadata
            resp_data = {
                "candidates": [
                    {
                        "content": {"parts": [{"text": "Aquí no puse json válido sino texto libre"}]},
                        "groundingMetadata": {
                            "webSearchQueries": ["noticias ine"],
                            "groundingChunks": [{"web": {"uri": "https://reforma.com/ine", "title": "Reforma"}}],
                        },
                    }
                ]
            }
            return httpx.Response(200, json=resp_data)
        else:
            # Repair call should have no tools
            assert "tools" not in body
            resp_data = {
                "candidates": [
                    {"content": {"parts": [{"text": '{"corregido": true, "total": 100}'}]}}
                ]
            }
            return httpx.Response(200, json=resp_data)

    monkeypatch.setattr(gemini, "_client_factory", lambda timeout, **kw: httpx.Client(transport=httpx.MockTransport(handler), timeout=timeout))

    parsed, result = gemini.grounded_json("Dame datos en JSON")
    assert call_count == 2
    assert parsed == {"corregido": True, "total": 100}
    # Sources and queries preserved from call 1
    assert len(result.sources) == 1
    assert result.sources[0].domain == "reforma.com"
    assert result.queries == ["noticias ine"]


def test_resolve_source_url_redirect(monkeypatch):
    """resolve_source_url follows grounding redirect up to target host."""
    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "vertexaisearch" in url:
            return httpx.Response(302, headers={"Location": "https://www.jornada.com.mx/noticia-electoral"})
        return httpx.Response(200)

    monkeypatch.setattr(gemini, "_client_factory", lambda timeout, **kw: httpx.Client(transport=httpx.MockTransport(handler), timeout=timeout))

    initial_url = "https://vertexaisearch.cloud.google.com/grounding-redirect/XYZ123"
    resolved = gemini.resolve_source_url(initial_url)
    assert resolved == "https://www.jornada.com.mx/noticia-electoral"

    # Non-redirect URL returns as is
    plain_url = "https://aristeguinoticias.com/articulo"
    assert gemini.resolve_source_url(plain_url) == plain_url


def test_domain_of():
    """domain_of cleans URLs to lowercase domain without www."""
    assert gemini.domain_of("https://www.eluniversal.com.mx/nacion/articulo") == "eluniversal.com.mx"
    assert gemini.domain_of("http://INE.MX/transparencia") == "ine.mx"
    assert gemini.domain_of("subdomain.example.org") == "subdomain.example.org"
    assert gemini.domain_of("") == ""
