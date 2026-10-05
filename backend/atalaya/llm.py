"""ATALAYA LLM client for Huawei ModelArts MaaS (glm-5.2) with content audit safeguards."""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
import time
from typing import Any, Iterator, TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from atalaya.config import CACHE_DIR, get_settings

logger = logging.getLogger("atalaya.llm")

T = TypeVar("T", bound=BaseModel)


class LLMError(Exception):
    """Base exception for LLM operations."""


class LLMBlocked(LLMError):
    """Exception raised when content is blocked by the MaaS content auditor."""


AUDIT_NOTICES: tuple[str, ...] = (
    "The current content involves sensitive information. Please try a new topic.",
    "当前内容涉及敏感信息，请更换话题重试。",
    "当前内容涉及敏感信息，请更换话题后重试。",
)

MAX_NOTICE_LEN: int = max(len(n) for n in AUDIT_NOTICES)

# Measured benchmarks against Huawei ModelArts MaaS (glm-5.2) on 2026-10-04:
# - Variant (a) None:                                                  HTTP 200, 14291.7 ms, 541 tokens (active reasoning)
# - Variant (b) {"thinking": {"type": "disabled"}}:                    HTTP 200,  4678.2 ms,  42 tokens (fastest valid, reasoning disabled)
# - Variant (c) {"chat_template_kwargs": {"enable_thinking": false}}: HTTP 200, 13203.8 ms, 501 tokens
# - Variant (d) {"enable_thinking": false}:                            HTTP 200, 13170.5 ms, 507 tokens
DEFAULT_EXTRA_BODY: dict[str, Any] = {"thinking": {"type": "disabled"}}

_extra_body_disabled: bool = False


def _resolve_extra_body() -> dict[str, Any]:
    """Resolve extra body payload parameters, respecting env override or failure memory."""
    global _extra_body_disabled
    if _extra_body_disabled:
        return {}
    raw_env = os.getenv("MAAS_EXTRA_BODY")
    if raw_env is not None:
        trimmed = raw_env.strip()
        if not trimmed or trimmed == "{}":
            return {}
        try:
            parsed = json.loads(trimmed)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass
    return dict(DEFAULT_EXTRA_BODY)

# Internal hooks for testability
_client_factory: Any = None
_backoff_steps: list[float] = [1.0, 3.0]


def _get_chat_url(base_url: str) -> str:
    """Format completions endpoint URL from base URL."""
    base = base_url.strip().rstrip("/")
    if base.endswith("/chat/completions"):
        return base
    return f"{base}/chat/completions"


def _create_httpx_client(timeout: float, **kwargs) -> httpx.Client:
    """Create httpx.Client, allowing test factory overrides."""
    if _client_factory is not None:
        return _client_factory(timeout=timeout, **kwargs)
    return httpx.Client(timeout=timeout, **kwargs)


def _trim_audit_notice(text: str) -> tuple[str, bool]:
    """
    Check if text ends with any of AUDIT_NOTICES (ignoring trailing whitespace).
    Returns (cleaned_text, was_blocked).
    """
    stripped = text.rstrip()
    for notice in AUDIT_NOTICES:
        if stripped.endswith(notice):
            clean = stripped[:-len(notice)].rstrip()
            return clean, True
        idx = stripped.rfind(notice)
        if idx != -1 and idx + len(notice) == len(stripped):
            clean = stripped[:idx].rstrip()
            return clean, True
    return text, False


def is_enabled() -> bool:
    """Return True if LLM is enabled in config and API key is present."""
    settings = get_settings()
    return bool(settings.llm_enabled and settings.maas_api_key and settings.maas_api_key.strip())


def chat(
    messages: list[dict],
    *,
    temperature: float = 0.2,
    max_tokens: int = 1500,
    timeout_s: float = 90.0,
    meta: dict[str, Any] | None = None,
    **kw,
) -> str:
    """
    Execute chat completion against MaaS.
    Retries up to 2 times on 429/5xx/timeout with backoff (1s, 3s).
    Raises LLMBlocked on 403, finish_reason=content_filter, or audit notice.
    Raises LLMError on disabled or permanent failure.
    """
    if not is_enabled():
        raise LLMError("disabled")

    settings = get_settings()
    url = _get_chat_url(settings.maas_base_url)
    headers = {
        "Authorization": f"Bearer {settings.maas_api_key}",
        "Content-Type": "application/json",
    }

    # Extract transport/client if passed via kw
    transport = kw.pop("transport", None)
    client_arg = kw.pop("client", None)

    extra_body = _resolve_extra_body()
    payload = {
        "model": settings.maas_model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        **extra_body,
        **kw,
    }

    start_time = time.perf_counter()
    attempts = 1 + len(_backoff_steps)
    last_exception: Exception | None = None

    for attempt in range(attempts):
        try:
            client = client_arg or _create_httpx_client(timeout=timeout_s, transport=transport)
            close_client = client_arg is None
            try:
                resp = client.post(url, json=payload, headers=headers)
                latency_ms = (time.perf_counter() - start_time) * 1000.0

                if resp.status_code == 400 and extra_body:
                    global _extra_body_disabled
                    _extra_body_disabled = True
                    logger.warning("LLM HTTP 400 with extra body parameters. Retrying once without extra body...")
                    for k in list(extra_body.keys()):
                        payload.pop(k, None)
                    extra_body = {}
                    resp = client.post(url, json=payload, headers=headers)
                    latency_ms = (time.perf_counter() - start_time) * 1000.0
            finally:
                if close_client:
                    client.close()

            if resp.status_code == 403:
                logger.warning(
                    "LLM request blocked by auditor (HTTP 403): model=%s latency_ms=%.1f",
                    payload.get("model"),
                    latency_ms,
                )
                if meta is not None:
                    meta["finish_reason"] = "content_filter"
                    meta["usage"] = {}
                    meta["latency_ms"] = latency_ms
                raise LLMBlocked("MaaS content auditor blocked the request (HTTP 403)")

            if resp.status_code in (429, 500, 502, 503, 504):
                if attempt < len(_backoff_steps):
                    sleep_s = _backoff_steps[attempt]
                    logger.warning(
                        "LLM HTTP %d (attempt %d/%d), retrying in %.1fs",
                        resp.status_code,
                        attempt + 1,
                        attempts,
                        sleep_s,
                    )
                    time.sleep(sleep_s)
                    continue
                raise LLMError(f"LLM request failed with status {resp.status_code} after retries")

            resp.raise_for_status()
            data = resp.json()

            choices = data.get("choices") or []
            if not choices:
                raise LLMError("LLM response contained no choices")

            choice = choices[0]
            finish_reason = choice.get("finish_reason")
            raw_content = choice.get("message", {}).get("content") or ""
            usage = data.get("usage") or {}

            logger.info(
                "LLM chat completed: model=%s latency_ms=%.1f finish_reason=%s prompt_tokens=%s completion_tokens=%s total_tokens=%s",
                payload.get("model"),
                latency_ms,
                finish_reason,
                usage.get("prompt_tokens"),
                usage.get("completion_tokens"),
                usage.get("total_tokens"),
            )

            if meta is not None:
                meta["finish_reason"] = finish_reason
                meta["usage"] = usage
                meta["latency_ms"] = latency_ms

            if finish_reason == "content_filter":
                raise LLMBlocked("MaaS content auditor flagged response (finish_reason=content_filter)")

            clean_content, has_notice = _trim_audit_notice(raw_content)
            if has_notice:
                if meta is not None:
                    meta["finish_reason"] = "content_filter"
                raise LLMBlocked(f"MaaS content auditor notice detected in response: {raw_content}")

            return clean_content

        except (httpx.TimeoutException, httpx.NetworkError) as err:
            last_exception = err
            latency_ms = (time.perf_counter() - start_time) * 1000.0
            if attempt < len(_backoff_steps):
                sleep_s = _backoff_steps[attempt]
                logger.warning(
                    "LLM %s (attempt %d/%d), retrying in %.1fs",
                    err.__class__.__name__,
                    attempt + 1,
                    attempts,
                    sleep_s,
                )
                time.sleep(sleep_s)
                continue
            raise LLMError(f"LLM request timed out or network error after retries: {err.__class__.__name__}") from err
        except (LLMError, LLMBlocked):
            raise
        except Exception as err:
            logger.error("LLM request failed with unexpected error: %s", err.__class__.__name__)
            raise LLMError(f"LLM request failed: {err}") from err

    raise LLMError(f"LLM request failed: {last_exception}")


def chat_stream(
    messages: list[dict],
    *,
    temperature: float = 0.2,
    max_tokens: int = 1500,
    timeout_s: float = 90.0,
    meta: dict[str, Any] | None = None,
    **kw,
) -> Iterator[str]:
    """
    Stream chat completion against MaaS.
    Yields clean text deltas. Buffers trailing characters to ensure auditor notices are never emitted.
    Raises LLMBlocked after yielding clean text if finish_reason=content_filter or audit notice found.
    """
    if not is_enabled():
        raise LLMError("disabled")

    settings = get_settings()
    url = _get_chat_url(settings.maas_base_url)
    headers = {
        "Authorization": f"Bearer {settings.maas_api_key}",
        "Content-Type": "application/json",
    }

    transport = kw.pop("transport", None)
    client_arg = kw.pop("client", None)

    extra_body = _resolve_extra_body()
    payload = {
        "model": settings.maas_model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": True,
        **extra_body,
        **kw,
    }

    start_time = time.perf_counter()
    buffer = ""
    last_finish_reason: str | None = None
    usage: dict | None = None

    client = client_arg or _create_httpx_client(timeout=timeout_s, transport=transport)
    close_client = client_arg is None

    try:
        def _open_stream(p):
            return client.stream("POST", url, json=p, headers=headers)

        stream_cm = _open_stream(payload)
        resp = stream_cm.__enter__()

        if resp.status_code == 400 and extra_body:
            global _extra_body_disabled
            _extra_body_disabled = True
            logger.warning("LLM stream HTTP 400 with extra body parameters. Retrying once without extra body...")
            stream_cm.__exit__(None, None, None)
            for k in list(extra_body.keys()):
                payload.pop(k, None)
            extra_body = {}
            stream_cm = _open_stream(payload)
            resp = stream_cm.__enter__()

        try:
            if resp.status_code == 403:
                latency_ms = (time.perf_counter() - start_time) * 1000.0
                logger.warning(
                    "LLM stream blocked by auditor (HTTP 403): model=%s latency_ms=%.1f",
                    payload.get("model"),
                    latency_ms,
                )
                if meta is not None:
                    meta["finish_reason"] = "content_filter"
                    meta["usage"] = {}
                    meta["latency_ms"] = latency_ms
                raise LLMBlocked("MaaS content auditor blocked the stream request (HTTP 403)")

            if resp.status_code != 200:
                resp.read()
                raise LLMError(f"LLM stream failed with HTTP status {resp.status_code}")

            for line in resp.iter_lines():
                line = line.strip()
                if not line:
                    continue
                if line.startswith("data:"):
                    payload_str = line[len("data:"):].strip()
                    if payload_str == "[DONE]":
                        break
                    try:
                        data = json.loads(payload_str)
                    except json.JSONDecodeError:
                        continue

                    if "usage" in data and data["usage"]:
                        usage = data["usage"]

                    choices = data.get("choices") or []
                    if not choices:
                        continue
                    choice = choices[0]
                    finish_reason = choice.get("finish_reason")
                    if finish_reason:
                        last_finish_reason = finish_reason

                    delta = choice.get("delta") or {}
                    delta_text = delta.get("content") or delta.get("text") or ""
                    if delta_text:
                        buffer += delta_text
                        if len(buffer) > MAX_NOTICE_LEN:
                            to_emit = buffer[:-MAX_NOTICE_LEN]
                            buffer = buffer[-MAX_NOTICE_LEN:]
                            yield to_emit
        finally:
            stream_cm.__exit__(None, None, None)

        latency_ms = (time.perf_counter() - start_time) * 1000.0
        prompt_tokens = usage.get("prompt_tokens") if usage else None
        completion_tokens = usage.get("completion_tokens") if usage else None
        total_tokens = usage.get("total_tokens") if usage else None

        logger.info(
            "LLM stream completed: model=%s latency_ms=%.1f finish_reason=%s prompt_tokens=%s completion_tokens=%s total_tokens=%s",
            payload.get("model"),
            latency_ms,
            last_finish_reason,
            prompt_tokens,
            completion_tokens,
            total_tokens,
        )

        clean_buffer, has_notice = _trim_audit_notice(buffer)
        if clean_buffer:
            yield clean_buffer

        if meta is not None:
            meta["finish_reason"] = "content_filter" if (has_notice or last_finish_reason == "content_filter") else last_finish_reason
            meta["usage"] = usage or {}
            meta["latency_ms"] = latency_ms

        if has_notice or last_finish_reason == "content_filter":
            raise LLMBlocked("MaaS content auditor blocked the stream (finish_reason=content_filter)")

    except (LLMError, LLMBlocked):
        raise
    except httpx.HTTPError as err:
        raise LLMError(f"LLM stream HTTP error: {err}") from err
    finally:
        if close_client:
            client.close()


def extract_first_json_object(text: str) -> str:
    """
    Extract the first balanced JSON object {...} from text.
    Handles nested braces and quotes, and tolerates markdown code fences.
    """
    start_idx = -1
    depth = 0
    in_string = False
    escape = False

    for i, ch in enumerate(text):
        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            continue

        if ch == '"':
            in_string = True
        elif ch == "{":
            if depth == 0:
                start_idx = i
            depth += 1
        elif ch == "}":
            if depth > 0:
                depth -= 1
                if depth == 0 and start_idx != -1:
                    return text[start_idx : i + 1]

    raise ValueError("No balanced JSON object {...} found in response")


def _inject_json_instruction(messages: list[dict], schema: type[BaseModel]) -> list[dict]:
    """Append system instruction demanding strict JSON matching the given schema."""
    schema_str = json.dumps(schema.model_json_schema(), ensure_ascii=False)
    instruction = (
        "Responde SOLO con un objeto JSON válido que cumpla estrictamente con el siguiente esquema JSON. "
        "No incluyas explicaciones, encabezados, markdown fences adicionales ni texto fuera del objeto JSON.\n"
        f"Esquema JSON requerido:\n{schema_str}"
    )

    result = [dict(m) for m in messages]
    if result and result[0].get("role") == "system":
        result[0]["content"] = f"{result[0]['content']}\n\n{instruction}"
    else:
        result.insert(0, {"role": "system", "content": instruction})
    return result


def chat_json(
    messages: list[dict],
    schema: type[T],
    *,
    temperature: float = 0.2,
    max_tokens: int = 1500,
    timeout_s: float = 90.0,
    meta: dict[str, Any] | None = None,
    **kw,
) -> T:
    """
    Prompt model for JSON matching schema. Extract first balanced object and validate.
    Performs exactly one retry if validation fails, passing the error back to the model.
    """
    if not is_enabled():
        raise LLMError("disabled")

    prompt_messages = _inject_json_instruction(messages, schema)

    # First attempt
    raw_response = chat(
        prompt_messages,
        temperature=temperature,
        max_tokens=max_tokens,
        timeout_s=timeout_s,
        meta=meta,
        **kw,
    )

    try:
        json_str = extract_first_json_object(raw_response)
        parsed = json.loads(json_str)
        return schema.model_validate(parsed)
    except Exception as err1:
        logger.warning(
            "chat_json: first attempt failed validation (%s: %s). Retrying once...",
            err1.__class__.__name__,
            err1,
        )

        retry_messages = list(prompt_messages) + [
            {"role": "assistant", "content": raw_response},
            {
                "role": "user",
                "content": (
                    f"El JSON devuelto no es válido o no cumple con el esquema requerido.\n"
                    f"Error de validación: {err1}\n\n"
                    f"Por favor responde ÚNICAMENTE con el objeto JSON válido corregido."
                ),
            },
        ]

        raw_retry_response = chat(
            retry_messages,
            temperature=temperature,
            max_tokens=max_tokens,
            timeout_s=timeout_s,
            meta=meta,
            **kw,
        )

        try:
            json_retry_str = extract_first_json_object(raw_retry_response)
            parsed_retry = json.loads(json_retry_str)
            return schema.model_validate(parsed_retry)
        except Exception as err2:
            logger.error(
                "chat_json: retry also failed validation (%s: %s).",
                err2.__class__.__name__,
                err2,
            )
            raise LLMError(f"Failed to produce valid JSON adhering to schema after retry: {err2}") from err2


def cached_chat_json(
    key: str,
    messages: list[dict],
    schema: type[T],
    **kw,
) -> T:
    """
    Cached version of chat_json storing results at CACHE_DIR/llm/<key>.json.
    Returns cached model without network call if cache exists.
    """
    cache_dir = CACHE_DIR / "llm"
    filename = key if key.endswith(".json") else f"{key}.json"
    cache_path = cache_dir / filename

    if cache_path.is_file():
        logger.debug("cached_chat_json: cache hit for %s", key)
        content = cache_path.read_text(encoding="utf-8")
        parsed = json.loads(content)
        return schema.model_validate(parsed)

    result = chat_json(messages, schema, **kw)

    try:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(result.model_dump_json(indent=2), encoding="utf-8")
        logger.debug("cached_chat_json: cached result to %s", cache_path)
    except Exception as err:
        logger.warning("cached_chat_json: failed to write cache file %s: %s", cache_path, err)

    return result
