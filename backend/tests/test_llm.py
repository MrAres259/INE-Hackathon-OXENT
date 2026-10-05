"""Unit tests for atalaya.llm client, parsing, retries, and content auditor safeguards."""

from __future__ import annotations

import json
import httpx
import pytest
from pydantic import BaseModel

from atalaya import llm
from atalaya.config import get_settings


class DemoModel(BaseModel):
    message: str
    count: int


def test_is_enabled(monkeypatch):
    monkeypatch.setenv("ATALAYA_LLM_ENABLED", "0")
    monkeypatch.setenv("MAAS_API_KEY", "")
    get_settings.cache_clear()
    assert llm.is_enabled() is False

    monkeypatch.setenv("ATALAYA_LLM_ENABLED", "1")
    monkeypatch.setenv("MAAS_API_KEY", "some_key")
    get_settings.cache_clear()
    assert llm.is_enabled() is True


def test_chat_disabled(monkeypatch):
    monkeypatch.setenv("ATALAYA_LLM_ENABLED", "0")
    get_settings.cache_clear()
    with pytest.raises(llm.LLMError, match="disabled"):
        llm.chat([{"role": "user", "content": "hi"}])


def test_extract_first_json_object():
    # Simple object
    assert llm.extract_first_json_object('{"a": 1}') == '{"a": 1}'

    # Object wrapped in text and markdown code fence
    text = (
        "Here is the parsed output:\n"
        "```json\n"
        '{"message": "hello", "count": 42}\n'
        "```\n"
        "Hope this helps!"
    )
    extracted = llm.extract_first_json_object(text)
    assert json.loads(extracted) == {"message": "hello", "count": 42}

    # Nested braces and escaped quotes
    complex_text = 'prefix {"data": {"nested": "value with \\"quotes\\""}, "list": [1, 2]} suffix'
    assert json.loads(llm.extract_first_json_object(complex_text)) == {
        "data": {"nested": 'value with "quotes"'},
        "list": [1, 2],
    }

    # No object error
    with pytest.raises(ValueError, match="No balanced JSON object"):
        llm.extract_first_json_object("no json here")


def test_chat_success(monkeypatch):
    monkeypatch.setenv("ATALAYA_LLM_ENABLED", "1")
    monkeypatch.setenv("MAAS_API_KEY", "test_key")
    monkeypatch.setenv("MAAS_BASE_URL", "https://mock.api")
    get_settings.cache_clear()

    def handler(request: httpx.Request) -> httpx.Response:
        data = {
            "choices": [
                {
                    "message": {"role": "assistant", "content": "Hola mundo"},
                    "finish_reason": "stop",
                }
            ],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
        }
        return httpx.Response(200, json=data)

    transport = httpx.MockTransport(handler)
    res = llm.chat([{"role": "user", "content": "hola"}], transport=transport)
    assert res == "Hola mundo"


def test_chat_auditor_403(monkeypatch):
    monkeypatch.setenv("ATALAYA_LLM_ENABLED", "1")
    monkeypatch.setenv("MAAS_API_KEY", "test_key")
    monkeypatch.setenv("MAAS_BASE_URL", "https://mock.api")
    get_settings.cache_clear()

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, text="Forbidden by auditor")

    transport = httpx.MockTransport(handler)
    with pytest.raises(llm.LLMBlocked, match="HTTP 403"):
        llm.chat([{"role": "user", "content": "pregunta sensible"}], transport=transport)


def test_chat_auditor_content_filter(monkeypatch):
    monkeypatch.setenv("ATALAYA_LLM_ENABLED", "1")
    monkeypatch.setenv("MAAS_API_KEY", "test_key")
    monkeypatch.setenv("MAAS_BASE_URL", "https://mock.api")
    get_settings.cache_clear()

    def handler(request: httpx.Request) -> httpx.Response:
        data = {
            "choices": [
                {
                    "message": {"role": "assistant", "content": "Respuesta parcial"},
                    "finish_reason": "content_filter",
                }
            ]
        }
        return httpx.Response(200, json=data)

    transport = httpx.MockTransport(handler)
    with pytest.raises(llm.LLMBlocked, match="content_filter"):
        llm.chat([{"role": "user", "content": "hola"}], transport=transport)


def test_chat_retries_on_500(monkeypatch):
    monkeypatch.setenv("ATALAYA_LLM_ENABLED", "1")
    monkeypatch.setenv("MAAS_API_KEY", "test_key")
    monkeypatch.setenv("MAAS_BASE_URL", "https://mock.api")
    get_settings.cache_clear()

    monkeypatch.setattr(llm, "_backoff_steps", [0.0, 0.0])

    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if calls == 1:
            return httpx.Response(500, text="Internal Error")
        data = {
            "choices": [{"message": {"role": "assistant", "content": "OK tras retry"}}]
        }
        return httpx.Response(200, json=data)

    transport = httpx.MockTransport(handler)
    res = llm.chat([{"role": "user", "content": "test"}], transport=transport)
    assert res == "OK tras retry"
    assert calls == 2


def test_chat_json_success_and_retry(monkeypatch):
    monkeypatch.setenv("ATALAYA_LLM_ENABLED", "1")
    monkeypatch.setenv("MAAS_API_KEY", "test_key")
    monkeypatch.setenv("MAAS_BASE_URL", "https://mock.api")
    get_settings.cache_clear()

    # Attempt 1: invalid json; Attempt 2: valid json matching DemoModel
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if calls == 1:
            content = "Esto no es json"
        else:
            content = '```json\n{"message": "éxito", "count": 10}\n```'
        data = {"choices": [{"message": {"role": "assistant", "content": content}}]}
        return httpx.Response(200, json=data)

    transport = httpx.MockTransport(handler)
    res = llm.chat_json(
        [{"role": "user", "content": "extrae"}],
        DemoModel,
        transport=transport,
    )
    assert isinstance(res, DemoModel)
    assert res.message == "éxito"
    assert res.count == 10
    assert calls == 2
