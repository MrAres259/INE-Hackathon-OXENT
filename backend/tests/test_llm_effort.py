"""Tests for MaaS GLM reasoning effort, extra_body resolution, headroom, 400 fallback and memory."""

from __future__ import annotations

import json
import httpx
import pytest

from atalaya import llm
from atalaya.config import get_settings


@pytest.fixture(autouse=True)
def reset_llm_state(monkeypatch):
    """Ensure clean LLM configuration and fallback memory for each test."""
    llm.reset_fallback_memory()
    monkeypatch.setenv("ATALAYA_LLM_ENABLED", "1")
    monkeypatch.setenv("MAAS_API_KEY", "test_key_secret_123")
    monkeypatch.setenv("MAAS_BASE_URL", "https://mock.maas.api/v1")
    monkeypatch.delenv("MAAS_EXTRA_BODY", raising=False)
    get_settings.cache_clear()
    yield
    llm.reset_fallback_memory()
    get_settings.cache_clear()


def test_glm53_defaults_to_thinking_enabled_high(monkeypatch):
    """glm-5.3 should send thinking: {type: enabled} and reasoning_effort: high."""
    monkeypatch.setenv("MAAS_MODEL", "glm-5.3")
    monkeypatch.setenv("MAAS_REASONING_EFFORT", "high")
    get_settings.cache_clear()

    captured_payload = None

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal captured_payload
        captured_payload = json.loads(request.content)
        data = {
            "choices": [{"message": {"role": "assistant", "content": "Hola"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
        }
        return httpx.Response(200, json=data)

    transport = httpx.MockTransport(handler)
    res = llm.chat([{"role": "user", "content": "test"}], max_tokens=100, transport=transport)
    assert res == "Hola"
    assert captured_payload is not None
    assert captured_payload["model"] == "glm-5.3"
    assert captured_payload["thinking"] == {"type": "enabled"}
    assert captured_payload["reasoning_effort"] == "high"
    # Headroom for high = 1024; max_tokens sent should be 100 + 1024 = 1124
    assert captured_payload["max_tokens"] == 1124


def test_glm52_defaults_to_thinking_disabled(monkeypatch):
    """glm-5.2 should send thinking: {type: disabled} and no headroom."""
    monkeypatch.setenv("MAAS_MODEL", "glm-5.2")
    get_settings.cache_clear()

    captured_payload = None

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal captured_payload
        captured_payload = json.loads(request.content)
        data = {
            "choices": [{"message": {"role": "assistant", "content": "Hola 5.2"}, "finish_reason": "stop"}],
        }
        return httpx.Response(200, json=data)

    transport = httpx.MockTransport(handler)
    res = llm.chat([{"role": "user", "content": "test"}], max_tokens=200, transport=transport)
    assert res == "Hola 5.2"
    assert captured_payload["thinking"] == {"type": "disabled"}
    assert "reasoning_effort" not in captured_payload
    # No headroom added for disabled thinking
    assert captured_payload["max_tokens"] == 200


def test_maas_extra_body_env_takes_precedence(monkeypatch):
    """MAAS_EXTRA_BODY in environment takes precedence over model defaults."""
    monkeypatch.setenv("MAAS_MODEL", "glm-5.3")
    monkeypatch.setenv("MAAS_EXTRA_BODY", json.dumps({"custom_field": "val123"}))
    get_settings.cache_clear()

    captured_payload = None

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal captured_payload
        captured_payload = json.loads(request.content)
        data = {"choices": [{"message": {"role": "assistant", "content": "ok"}}]}
        return httpx.Response(200, json=data)

    transport = httpx.MockTransport(handler)
    llm.chat([{"role": "user", "content": "test"}], transport=transport)
    assert captured_payload["custom_field"] == "val123"
    assert "thinking" not in captured_payload


def test_reasoning_effort_per_call_override(monkeypatch):
    """Calling chat with reasoning_effort override takes precedence over config."""
    monkeypatch.setenv("MAAS_MODEL", "glm-5.3")
    monkeypatch.setenv("MAAS_REASONING_EFFORT", "high")
    get_settings.cache_clear()

    captured_payload = None

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal captured_payload
        captured_payload = json.loads(request.content)
        return httpx.Response(200, json={"choices": [{"message": {"role": "assistant", "content": "low"}}]})

    transport = httpx.MockTransport(handler)
    llm.chat([{"role": "user", "content": "test"}], reasoning_effort="low", max_tokens=50, transport=transport)
    assert captured_payload["reasoning_effort"] == "low"
    # Headroom for low = 256; 50 + 256 = 306
    assert captured_payload["max_tokens"] == 306


def test_headroom_levels(monkeypatch):
    """Verify headroom values for low (256), high (1024), and max (4096)."""
    monkeypatch.setenv("MAAS_MODEL", "glm-5.3")
    get_settings.cache_clear()

    payloads = []

    def handler(request: httpx.Request) -> httpx.Response:
        payloads.append(json.loads(request.content))
        return httpx.Response(200, json={"choices": [{"message": {"role": "assistant", "content": "ok"}}]})

    transport = httpx.MockTransport(handler)
    llm.chat([{"role": "user", "content": "1"}], reasoning_effort="low", max_tokens=10, transport=transport)
    llm.chat([{"role": "user", "content": "2"}], reasoning_effort="high", max_tokens=10, transport=transport)
    llm.chat([{"role": "user", "content": "3"}], reasoning_effort="max", max_tokens=10, transport=transport)

    assert payloads[0]["max_tokens"] == 10 + 256
    assert payloads[1]["max_tokens"] == 10 + 1024
    assert payloads[2]["max_tokens"] == 10 + 4096


def test_400_messages_too_long_raises_without_retry(monkeypatch):
    """A 400 error not related to reasoning/thinking raises LLMError without retry or memory."""
    monkeypatch.setenv("MAAS_MODEL", "glm-5.3")
    monkeypatch.setenv("MAAS_REASONING_EFFORT", "high")
    get_settings.cache_clear()

    call_count = 0
    received_payloads = []

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal call_count
        call_count += 1
        p = json.loads(request.content)
        received_payloads.append(p)
        if call_count == 1:
            return httpx.Response(400, json={"error": {"message": "messages too long: maximum context exceeded"}})
        return httpx.Response(200, json={"choices": [{"message": {"role": "assistant", "content": "ok"}}]})

    transport = httpx.MockTransport(handler)

    # First request fails with LLMError
    with pytest.raises(llm.LLMError, match="messages too long"):
        llm.chat([{"role": "user", "content": "huge prompt"}], transport=transport)

    assert call_count == 1

    # Second request still sends reasoning_effort: high (no memory of failure)
    res = llm.chat([{"role": "user", "content": "normal prompt"}], transport=transport)
    assert res == "ok"
    assert call_count == 2
    assert received_payloads[1]["reasoning_effort"] == "high"


def test_400_reasoning_high_to_low_and_memory(monkeypatch):
    """A 400 mentioning reasoning/thinking triggers retry with low effort and remembers it."""
    monkeypatch.setenv("MAAS_MODEL", "glm-5.3")
    monkeypatch.setenv("MAAS_REASONING_EFFORT", "high")
    get_settings.cache_clear()

    call_count = 0
    received_payloads = []

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal call_count
        call_count += 1
        p = json.loads(request.content)
        received_payloads.append(p)
        if call_count == 1:
            return httpx.Response(400, json={"error": {"message": "reasoning_effort high is not supported"}})
        return httpx.Response(200, json={"choices": [{"message": {"role": "assistant", "content": "low success"}}]})

    transport = httpx.MockTransport(handler)

    res1 = llm.chat([{"role": "user", "content": "attempt1"}], max_tokens=100, transport=transport)
    assert res1 == "low success"
    assert call_count == 2
    # First attempt was high (headroom 1024)
    assert received_payloads[0]["reasoning_effort"] == "high"
    assert received_payloads[0]["max_tokens"] == 100 + 1024
    # Retry was low (headroom 256)
    assert received_payloads[1]["reasoning_effort"] == "low"
    assert received_payloads[1]["max_tokens"] == 100 + 256

    # Subsequent request uses remembered "low" directly
    res2 = llm.chat([{"role": "user", "content": "attempt2"}], max_tokens=50, transport=transport)
    assert res2 == "low success"
    assert call_count == 3
    assert received_payloads[2]["reasoning_effort"] == "low"
    assert received_payloads[2]["max_tokens"] == 50 + 256


def test_400_legacy_fallback_to_empty(monkeypatch):
    """Legacy model (glm-5.2) with thinking:disabled receiving 400 falls back to empty {} and remembers it."""
    monkeypatch.setenv("MAAS_MODEL", "glm-5.2")
    get_settings.cache_clear()

    call_count = 0
    received_payloads = []

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal call_count
        call_count += 1
        p = json.loads(request.content)
        received_payloads.append(p)
        if call_count == 1:
            return httpx.Response(400, json={"error": {"message": "thinking type disabled not supported"}})
        return httpx.Response(200, json={"choices": [{"message": {"role": "assistant", "content": "legacy ok"}}]})

    transport = httpx.MockTransport(handler)
    res = llm.chat([{"role": "user", "content": "test"}], transport=transport)
    assert res == "legacy ok"
    assert call_count == 2
    assert "thinking" in received_payloads[0]
    assert "thinking" not in received_payloads[1]

    # Subsequent request uses remembered empty mode
    llm.chat([{"role": "user", "content": "test2"}], transport=transport)
    assert call_count == 3
    assert "thinking" not in received_payloads[2]


def test_stream_400_no_response_not_read(monkeypatch):
    """Streaming with 400 reads response safely and handles reasoning fallback without ResponseNotRead."""
    monkeypatch.setenv("MAAS_MODEL", "glm-5.3")
    monkeypatch.setenv("MAAS_REASONING_EFFORT", "high")
    get_settings.cache_clear()

    call_count = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return httpx.Response(400, json={"error": {"message": "unsupported reasoning_effort: high"}})
        content = b'data: {"choices": [{"delta": {"content": "streamed success"}}]}\ndata: [DONE]\n'
        return httpx.Response(200, content=content)

    transport = httpx.MockTransport(handler)
    stream = llm.chat_stream([{"role": "user", "content": "hello"}], transport=transport)
    result = "".join(list(stream))
    assert result == "streamed success"
    assert call_count == 2


def test_stream_400_non_reasoning_error(monkeypatch):
    """Streaming with non-reasoning 400 raises LLMError cleanly without ResponseNotRead."""
    monkeypatch.setenv("MAAS_MODEL", "glm-5.3")
    get_settings.cache_clear()

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"error": {"message": "messages too long"}})

    transport = httpx.MockTransport(handler)
    with pytest.raises(llm.LLMError, match="messages too long"):
        list(llm.chat_stream([{"role": "user", "content": "hello"}], transport=transport))


def test_describe_without_secrets(monkeypatch):
    """describe() returns model, reasoning_effort, and extra_body_mode without secrets."""
    monkeypatch.setenv("MAAS_MODEL", "glm-5.3")
    monkeypatch.setenv("MAAS_REASONING_EFFORT", "high")
    monkeypatch.setenv("MAAS_API_KEY", "super_secret_token_abc")
    get_settings.cache_clear()

    info = llm.describe()
    assert info == {
        "model": "glm-5.3",
        "reasoning_effort": "high",
        "extra_body_mode": "enabled",
    }
    assert "super_secret" not in str(info)


def test_streaming_ignores_reasoning_content(monkeypatch):
    """Streaming does not yield reasoning_content deltas to the consumer."""
    monkeypatch.setenv("MAAS_MODEL", "glm-5.3")
    get_settings.cache_clear()

    lines = [
        b'data: {"choices": [{"delta": {"reasoning_content": "Pensando profundamente...", "content": null}}]}\n',
        b'data: {"choices": [{"delta": {"content": "Resultado visible"}}]}\n',
        b'data: [DONE]\n',
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"".join(lines))

    transport = httpx.MockTransport(handler)
    collected = list(llm.chat_stream([{"role": "user", "content": "hola"}], transport=transport))
    full_text = "".join(collected)
    assert "Resultado visible" in full_text
    assert "Pensando profundamente" not in full_text
