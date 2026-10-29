"""ATALAYA Gemini client with Google Search grounding, fallback models, RSS fallback and budget management."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
import functools
import hashlib
import json
import logging
import os
from pathlib import Path
import re
import tempfile
import threading
import time
from typing import Any, Literal
import urllib.parse

import httpx

from atalaya.config import CACHE_DIR, get_settings

logger = logging.getLogger("atalaya.gemini")


# ---------------------------------------------------------------- Exceptions


class GeminiError(Exception):
    """Base exception for Gemini operations with safe Spanish message."""


class GeminiDisabled(GeminiError):
    """Raised when Gemini is disabled or no API key is configured."""


class GeminiQuotaError(GeminiError):
    """Raised when Gemini quota is exhausted (HTTP 429)."""

    def __init__(
        self,
        message: str = "Cuota de Gemini agotada temporalmente (HTTP 429).",
        retry_after_s: float | None = None,
    ) -> None:
        super().__init__(message)
        self.retry_after_s = retry_after_s


class GeminiBudgetExceeded(GeminiError):
    """Raised when the local daily query limit for Gemini has been reached."""


# ---------------------------------------------------------------- Data classes


@dataclass
class GroundedSource:
    url: str
    title: str
    domain: str


@dataclass
class GroundedResult:
    text: str
    sources: list[GroundedSource]
    queries: list[str]
    model: str
    latency_ms: int
    supports: list[dict] = field(default_factory=list)
    from_cache: bool = False
    mode: Literal["grounding", "rss_url_context", "none"] = "grounding"


# ---------------------------------------------------------------- Internal state & hooks

_client_factory: Any = None
_budget_lock = threading.Lock()
_backoff_steps: list[float] = [2.0, 5.0]


def _create_httpx_client(timeout: float, **kwargs) -> httpx.Client:
    """Create httpx.Client, allowing test factory overrides."""
    if _client_factory is not None:
        return _client_factory(timeout=timeout, **kwargs)
    return httpx.Client(timeout=timeout, **kwargs)


def _get_intel_dir() -> Path:
    """Return base intel cache directory."""
    d = CACHE_DIR / "intel"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _atomic_write_json(path: Path, data: Any) -> None:
    """Write JSON data to path atomically."""
    path.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(data, ensure_ascii=False, indent=2)
    with tempfile.NamedTemporaryFile("w", dir=str(path.parent), delete=False, encoding="utf-8") as tf:
        tf.write(serialized)
        tmp_name = tf.name
    os.replace(tmp_name, str(path))


def _is_grounding_available() -> tuple[bool, str | None]:
    """Check if grounding circuit is currently available or cooling down."""
    state_file = _get_intel_dir() / "gemini_state.json"
    if not state_file.is_file():
        return True, None
    try:
        data = json.loads(state_file.read_text(encoding="utf-8"))
        until_str = data.get("grounding_unavailable_until")
        if not until_str:
            return True, None
        until_dt = datetime.fromisoformat(until_str)
        now_dt = datetime.now(timezone.utc)
        if until_dt.tzinfo is None:
            now_dt = datetime.now()
        if now_dt < until_dt:
            return False, until_str
        return True, None
    except Exception:
        return True, None


def _trip_grounding_circuit() -> None:
    """Trip grounding circuit for GEMINI_GROUNDING_COOLDOWN_MIN minutes."""
    settings = get_settings()
    cooldown_min = settings.gemini_grounding_cooldown_min
    retry_at = datetime.now(timezone.utc) + timedelta(minutes=cooldown_min)
    retry_str = retry_at.isoformat()
    state_file = _get_intel_dir() / "gemini_state.json"
    try:
        data: dict[str, Any] = {}
        if state_file.is_file():
            try:
                data = json.loads(state_file.read_text(encoding="utf-8"))
            except Exception:
                data = {}
        data["grounding_unavailable_until"] = retry_str
        data["had_429"] = True
        _atomic_write_json(state_file, data)
        logger.warning(
            "Circuito de grounding abierto por HTTP 429. Grounding deshabilitado hasta %s (%d min cooldown)",
            retry_str,
            cooldown_min,
        )
    except Exception as exc:
        logger.warning("Fallo al escribir gemini_state.json: %s", exc)


def _save_last_mode(mode: str) -> None:
    """Save the search mode actually used ('grounding' or 'respaldo') to gemini_state.json."""
    if not mode:
        return
    canonical = "respaldo" if mode in ("rss_url_context", "respaldo") else "grounding"
    state_file = _get_intel_dir() / "gemini_state.json"
    data: dict[str, Any] = {}
    if state_file.is_file():
        try:
            data = json.loads(state_file.read_text(encoding="utf-8"))
        except Exception:
            data = {}
    data["last_mode"] = canonical
    try:
        _atomic_write_json(state_file, data)
    except Exception as exc:
        logger.warning("Fallo al escribir last_mode en gemini_state.json: %s", exc)


def get_last_mode() -> str | None:
    """Return the last mode actually used, stored in gemini_state.json."""
    state_file = _get_intel_dir() / "gemini_state.json"
    if not state_file.is_file():
        return None
    try:
        st = json.loads(state_file.read_text(encoding="utf-8"))
        return st.get("last_mode")
    except Exception:
        return None


def get_had_429() -> bool:
    """Return True if grounding circuit ever experienced a 429."""
    state_file = _get_intel_dir() / "gemini_state.json"
    if not state_file.is_file():
        return False
    try:
        st = json.loads(state_file.read_text(encoding="utf-8"))
        return bool(st.get("had_429", False))
    except Exception:
        return False


def _save_last_model(model: str) -> None:
    """Save the model that answered successfully to gemini_state.json."""
    if not model:
        return
    state_file = _get_intel_dir() / "gemini_state.json"
    data: dict[str, Any] = {}
    if state_file.is_file():
        try:
            data = json.loads(state_file.read_text(encoding="utf-8"))
        except Exception:
            data = {}
    data["last_model"] = model
    try:
        _atomic_write_json(state_file, data)
    except Exception as exc:
        logger.warning("Fallo al escribir last_model en gemini_state.json: %s", exc)


def get_last_model() -> str | None:
    """Return the last model that responded successfully, stored in gemini_state.json."""
    state_file = _get_intel_dir() / "gemini_state.json"
    if not state_file.is_file():
        return None
    try:
        st = json.loads(state_file.read_text(encoding="utf-8"))
        return st.get("last_model")
    except Exception:
        return None



# ---------------------------------------------------------------- Public helpers


def is_enabled() -> bool:
    """Return True if Gemini is enabled and GEMINI_API_KEY is present."""
    settings = get_settings()
    return bool(settings.gemini_api_key and settings.gemini_api_key.strip())


def domain_of(url: str) -> str:
    """Extract lower-case hostname without leading 'www.' from a URL."""
    if not url:
        return ""
    clean = url.strip()
    if "://" not in clean:
        clean = "https://" + clean
    try:
        parsed = urllib.parse.urlparse(clean)
        host = (parsed.hostname or "").lower().strip()
        if host.startswith("www."):
            host = host[4:]
        return host
    except Exception:
        return ""


@functools.lru_cache(maxsize=2048)
def _memo_resolve_url(url: str, timeout_s: float) -> str:
    if not url:
        return url
    host = domain_of(url)
    if "vertexaisearch" not in host and "google" not in host and "/url" not in url:
        return url

    current_url = url
    for _ in range(3):
        try:
            client = _create_httpx_client(timeout=timeout_s)
            with client:
                resp = client.get(current_url, follow_redirects=False)
                if resp.status_code in (301, 302, 303, 307, 308):
                    loc = resp.headers.get("Location")
                    if loc:
                        current_url = urllib.parse.urljoin(current_url, loc)
                        curr_host = domain_of(current_url)
                        if "vertexaisearch" not in curr_host and "google" not in curr_host:
                            return current_url
                        continue
                break
        except Exception:
            break
    return current_url


def resolve_source_url(url: str, *, timeout_s: float = 5.0) -> str:
    """Follow vertexaisearch/grounding redirects up to 3 hops, returning final destination."""
    return _memo_resolve_url(url, timeout_s)


resolve_source_url.cache_clear = _memo_resolve_url.cache_clear  # type: ignore[attr-defined]


def extract_json(text: str) -> Any:
    """Extract and parse first balanced JSON object {...} or array [...] from text.

    Tolerates markdown code fences, leading/trailing explanations, and quotes.
    Raises ValueError if no valid balanced JSON structure is found.
    """
    if not text or not text.strip():
        raise ValueError("Texto vacío; no se encontró JSON.")

    cleaned = text.strip()
    # Strip wrapping code fences if entire text is fenced
    if cleaned.startswith("```"):
        first_newline = cleaned.find("\n")
        if first_newline != -1:
            cleaned = cleaned[first_newline + 1 :]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3].strip()

    # Find first balanced {...} or [...]
    start_idx = -1
    open_char = ""
    close_char = ""
    depth = 0
    in_string = False
    escape = False

    for i, ch in enumerate(cleaned):
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
            continue

        if start_idx == -1:
            if ch == "{":
                start_idx = i
                open_char = "{"
                close_char = "}"
                depth = 1
            elif ch == "[":
                start_idx = i
                open_char = "["
                close_char = "]"
                depth = 1
        else:
            if ch == open_char:
                depth += 1
            elif ch == close_char:
                depth -= 1
                if depth == 0:
                    candidate = cleaned[start_idx : i + 1]
                    try:
                        return json.loads(candidate)
                    except json.JSONDecodeError as err:
                        raise ValueError(f"Estructura JSON inválida: {err}") from err

    raise ValueError("No se encontró ningún objeto o arreglo JSON balanceado en el texto.")


def budget_status() -> dict:
    """Return local daily budget status and grounding availability:
    {'day': 'YYYY-MM-DD', 'used': int, 'limit': int, 'grounding_available': bool, 'grounding_retry_at': str | None}
    """
    settings = get_settings()
    today = datetime.now().strftime("%Y-%m-%d")
    limit = settings.intel_gemini_daily_limit
    budget_file = _get_intel_dir() / "gemini_budget.json"

    used = 0
    with _budget_lock:
        if budget_file.is_file():
            try:
                data = json.loads(budget_file.read_text(encoding="utf-8"))
                if data.get("day") == today:
                    used = int(data.get("used", 0))
            except Exception:
                pass

    grounding_available, grounding_retry_at = _is_grounding_available()
    return {
        "day": today,
        "used": used,
        "limit": limit,
        "grounding_available": grounding_available,
        "grounding_retry_at": grounding_retry_at,
        "last_model": get_last_model(),
        "last_mode": get_last_mode(),
        "had_429": get_had_429(),
    }


def _check_and_increment_budget() -> None:
    """Verify local daily limit has not been exceeded and increment usage count."""
    settings = get_settings()
    today = datetime.now().strftime("%Y-%m-%d")
    limit = settings.intel_gemini_daily_limit
    budget_file = _get_intel_dir() / "gemini_budget.json"

    with _budget_lock:
        used = 0
        if budget_file.is_file():
            try:
                data = json.loads(budget_file.read_text(encoding="utf-8"))
                if data.get("day") == today:
                    used = int(data.get("used", 0))
            except Exception:
                used = 0

        if used >= limit:
            raise GeminiBudgetExceeded(
                f"Presupuesto diario local de consultas a Gemini alcanzado ({used}/{limit}). "
                "Intenta mañana o incrementa INTEL_GEMINI_DAILY_LIMIT."
            )

        used += 1
        _atomic_write_json(budget_file, {"day": today, "used": used})


# ---------------------------------------------------------------- Core search & JSON APIs


def _parse_candidate_response(
    data: dict,
    model_name: str,
    latency_ms: int,
    mode: Literal["grounding", "rss_url_context", "none"] = "grounding",
) -> GroundedResult:
    """Parse Gemini generateContent candidate response into GroundedResult."""
    candidates = data.get("candidates") or []
    if not candidates:
        raise GeminiError("La respuesta de Gemini no contuvo ningún candidato válido.")

    cand = candidates[0]
    content = cand.get("content") or {}
    parts = content.get("parts") or []

    # Concatenate parts that are not marked as thinking
    text_chunks = []
    for part in parts:
        if isinstance(part, dict) and not part.get("thought", False):
            t = part.get("text", "")
            if t:
                text_chunks.append(t)
    text = "".join(text_chunks)

    # Extract grounding metadata
    gm = cand.get("groundingMetadata") or cand.get("grounding_metadata") or {}
    raw_queries = gm.get("webSearchQueries") or gm.get("web_search_queries") or []
    queries = [str(q) for q in raw_queries if q]

    raw_chunks = gm.get("groundingChunks") or gm.get("grounding_chunks") or []
    sources: list[GroundedSource] = []
    for chunk in raw_chunks:
        if isinstance(chunk, dict):
            web = chunk.get("web") or {}
            uri = web.get("uri") or web.get("url") or ""
            title = web.get("title") or ""
            if uri:
                sources.append(GroundedSource(url=uri, title=title, domain=domain_of(uri)))

    raw_supports = gm.get("groundingSupports") or gm.get("grounding_supports") or []

    return GroundedResult(
        text=text,
        sources=sources,
        queries=queries,
        model=model_name,
        latency_ms=latency_ms,
        supports=raw_supports,
        from_cache=False,
        mode=mode,
    )


def _call_gemini_raw(
    prompt: str,
    *,
    system: str | None = None,
    tools: list[dict] | None = None,
    thinking_level: str | None = None,
    max_output_tokens: int = 8192,
    timeout_s: float | None = None,
    mode: Literal["grounding", "rss_url_context", "none"] = "none",
) -> GroundedResult:
    """Execute raw POST request to Gemini generateContent with fallback models and retries."""
    if not is_enabled():
        raise GeminiDisabled("Gemini está deshabilitado o no tiene GEMINI_API_KEY configurada.")

    _check_and_increment_budget()

    settings = get_settings()
    base_url = settings.gemini_base_url.rstrip("/")
    per_call_timeout = timeout_s if timeout_s is not None else settings.gemini_timeout_s
    if per_call_timeout <= 0:
        per_call_timeout = 45.0

    primary_model = settings.gemini_model
    fallback_models = [m for m in settings.gemini_fallback_models if m and m != primary_model]
    models_chain = [primary_model] + fallback_models

    is_grounding = bool(tools and any("google_search" in t for t in tools))

    headers = {
        "x-goog-api-key": settings.gemini_api_key,
        "Content-Type": "application/json",
    }

    body: dict[str, Any] = {
        "contents": [
            {
                "role": "user",
                "parts": [{"text": prompt}],
            }
        ],
    }
    if system:
        body["systemInstruction"] = {
            "parts": [{"text": system}],
        }
    if tools is not None:
        body["tools"] = tools

    gen_config: dict[str, Any] = {
        "maxOutputTokens": max_output_tokens,
    }
    level = thinking_level or settings.gemini_thinking_level
    if level in ("low", "medium", "high"):
        gen_config["thinkingConfig"] = {"thinkingLevel": level}
    body["generationConfig"] = gen_config

    start_time = time.perf_counter()
    all_429 = True
    last_err: Exception | None = None

    for model in models_chain:
        url = f"{base_url}/models/{model}:generateContent"
        try:
            client = _create_httpx_client(timeout=per_call_timeout)
            with client:
                resp = client.post(url, json=body, headers=headers)
                latency_ms = int((time.perf_counter() - start_time) * 1000)

                # Retry 400 if it mentions thinking
                if resp.status_code == 400 and "thinkingConfig" in body.get("generationConfig", {}):
                    err_text = resp.text.lower()
                    if "thinking" in err_text:
                        logger.warning("Gemini model %s HTTP 400 with thinkingConfig. Retrying once without thinkingConfig...", model)
                        saved_thinking = body["generationConfig"].pop("thinkingConfig", None)
                        resp = client.post(url, json=body, headers=headers)
                        latency_ms = int((time.perf_counter() - start_time) * 1000)
                        if resp.status_code != 200 and saved_thinking:
                            body["generationConfig"]["thinkingConfig"] = saved_thinking

                # 429 quota exhaustion: trip circuit if grounding, advance to next model
                if resp.status_code == 429:
                    if is_grounding:
                        _trip_grounding_circuit()
                    logger.warning("Gemini model %s HTTP 429 quota exhausted. Trying next model...", model)
                    last_err = GeminiQuotaError("Cuota de Gemini agotada temporalmente (HTTP 429).")
                    continue

                # Not a 429
                all_429 = False

                # 5xx server errors: advance to next model
                if resp.status_code in (500, 502, 503, 504):
                    logger.warning("Gemini model %s HTTP %d. Trying next model...", model, resp.status_code)
                    last_err = GeminiError(f"Error del servidor Gemini (HTTP {resp.status_code}) en {model}.")
                    continue

                # 400 tool / syntax error: raise GeminiError
                if resp.status_code == 400:
                    err_msg = resp.text[:200]
                    raise GeminiError(f"Error 400 de Gemini en modelo {model}: {err_msg}")

                resp.raise_for_status()
                data = resp.json()
                result = _parse_candidate_response(data, model, latency_ms, mode=mode)
                _save_last_model(model)
                if mode in ("grounding", "rss_url_context", "respaldo"):
                    _save_last_mode(mode)

                logger.info(
                    "Gemini request completed: model=%s latency_ms=%d mode=%s sources=%d queries=%d",
                    model,
                    latency_ms,
                    mode,
                    len(result.sources),
                    len(result.queries),
                )
                return result

        except (httpx.TimeoutException, httpx.NetworkError) as err:
            all_429 = False
            last_err = err
            logger.warning("Gemini model %s %s. Trying next model...", model, err.__class__.__name__)
            continue
        except GeminiError:
            raise
        except Exception as err:
            all_429 = False
            logger.error("Error inesperado en llamada a Gemini (%s): %s", model, err)
            last_err = err
            continue

    if all_429 and last_err is not None:
        raise GeminiQuotaError("Cuota de Gemini agotada temporalmente en todos los modelos (HTTP 429).")
    if last_err is not None:
        raise GeminiError(f"La llamada a Gemini falló en todos los modelos: {last_err}")
    raise GeminiError("La llamada a Gemini falló sin respuesta válida.")


def grounded_search(
    prompt: str,
    *,
    system: str | None = None,
    thinking_level: str | None = None,
    max_output_tokens: int = 8192,
    timeout_s: float = 120.0,
    cache_key: str | None = None,
    cache_ttl_s: int = 0,
) -> GroundedResult:
    """Execute search-grounded generation with Gemini, checking disk cache when requested."""
    cache_file: Path | None = None
    if cache_key and cache_ttl_s > 0:
        hashed_key = hashlib.sha1(cache_key.encode("utf-8")).hexdigest()
        cache_file = _get_intel_dir() / "gemini" / f"{hashed_key}.json"
        if cache_file.is_file():
            try:
                age_s = time.time() - cache_file.stat().st_mtime
                if age_s < cache_ttl_s:
                    data = json.loads(cache_file.read_text(encoding="utf-8"))
                    sources = [
                        GroundedSource(url=s.get("url", ""), title=s.get("title", ""), domain=s.get("domain", ""))
                        for s in data.get("sources", [])
                    ]
                    return GroundedResult(
                        text=data.get("text", ""),
                        sources=sources,
                        queries=data.get("queries", []),
                        model=data.get("model", ""),
                        latency_ms=data.get("latency_ms", 0),
                        supports=data.get("supports", []),
                        from_cache=True,
                        mode=data.get("mode", "grounding"),
                    )
            except Exception as exc:
                logger.warning("Fallo al leer caché de Gemini (%s): %s", cache_file, exc)

    # Check circuit before making network grounding request
    is_avail, retry_at = _is_grounding_available()
    if not is_avail:
        raise GeminiQuotaError(
            f"Circuito de grounding abierto tras cuota agotada (HTTP 429). Disponible a las {retry_at}."
        )

    result = _call_gemini_raw(
        prompt=prompt,
        system=system,
        tools=[{"google_search": {}}],
        thinking_level=thinking_level,
        max_output_tokens=max_output_tokens,
        timeout_s=timeout_s,
        mode="grounding",
    )

    if cache_file is not None:
        try:
            cache_data = {
                "text": result.text,
                "sources": [{"url": s.url, "title": s.title, "domain": s.domain} for s in result.sources],
                "queries": result.queries,
                "model": result.model,
                "latency_ms": result.latency_ms,
                "supports": result.supports,
                "mode": result.mode,
            }
            _atomic_write_json(cache_file, cache_data)
        except Exception as exc:
            logger.warning("Fallo al guardar caché de Gemini (%s): %s", cache_file, exc)

    return result


def _rss_fallback_json(
    prompt: str,
    *,
    system: str | None = None,
    fallback_queries: list[str],
    fallback_days: int = 30,
    fallback_max_items: int = 40,
    **kw,
) -> tuple[Any, GroundedResult]:
    """Execute Gemini in RSS fallback mode using websearch candidates and url_context."""
    from atalaya import websearch

    candidates = websearch.search_news(
        fallback_queries,
        days=fallback_days,
        max_items=fallback_max_items,
    )

    cand_lines = []
    for i, c in enumerate(candidates, start=1):
        cand_lines.append(
            f"{i}. Título: {c.title} | Medio: {c.outlet or 'Desconocido'} | Dominio: {c.domain} | "
            f"Fecha: {c.published or 'Desconocida'} | URL: {c.url}"
        )
    cand_text = "\n".join(cand_lines) if cand_lines else "No se encontraron materiales candidatos recientes."

    rss_prompt = (
        f"Materiales candidatos:\n{cand_text}\n\n"
        "Instrucciones: usa SOLO estos materiales; cita por URL exacta de la lista; "
        "puedes leer hasta 10 URLs con url_context.\n\n"
        f"{prompt}"
    )

    sources = [
        GroundedSource(url=c.url, title=c.title, domain=c.domain)
        for c in candidates
    ]
    queries = list(fallback_queries)

    try:
        res = _call_gemini_raw(
            prompt=rss_prompt,
            system=system,
            tools=[{"url_context": {}}],
            thinking_level=kw.get("thinking_level"),
            max_output_tokens=kw.get("max_output_tokens", 8192),
            timeout_s=kw.get("timeout_s"),
            mode="rss_url_context",
        )
    except Exception as exc:
        logger.warning("url_context failed (%s). Retrying without tools...", exc)
        res = _call_gemini_raw(
            prompt=rss_prompt,
            system=system,
            tools=None,
            thinking_level=kw.get("thinking_level"),
            max_output_tokens=kw.get("max_output_tokens", 8192),
            timeout_s=kw.get("timeout_s"),
            mode="rss_url_context",
        )

    res.sources = sources
    res.queries = queries
    res.mode = "rss_url_context"

    try:
        parsed = extract_json(res.text)
        return parsed, res
    except ValueError:
        logger.warning("grounded_json (RSS mode): Falló el parseo inicial de JSON. Ejecutando llamada de reparación...")
        repair_prompt = (
            f"El siguiente texto debía contener un JSON válido pero falló al parsearse:\n\n"
            f"{res.text}\n\n"
            f"Devuelve únicamente el JSON válido, sin comentarios, explicaciones ni formato markdown."
        )
        repair_res = _call_gemini_raw(
            prompt=repair_prompt,
            system="Eres un formateador de datos. Devuelve únicamente el JSON válido requerido.",
            tools=None,
            max_output_tokens=kw.get("max_output_tokens", 8192),
            timeout_s=kw.get("timeout_s"),
            mode="none",
        )
        parsed_repair = extract_json(repair_res.text)
        final_res = GroundedResult(
            text=repair_res.text,
            sources=sources,
            queries=queries,
            model=repair_res.model,
            latency_ms=res.latency_ms + repair_res.latency_ms,
            supports=res.supports,
            from_cache=False,
            mode="rss_url_context",
        )
        return parsed_repair, final_res


def grounded_json(
    prompt: str,
    *,
    system: str | None = None,
    fallback_queries: list[str] | None = None,
    fallback_days: int = 30,
    fallback_max_items: int = 40,
    **kw,
) -> tuple[Any, GroundedResult]:
    """Execute grounded search and parse result as JSON.

    If grounding is unavailable or hits 429, and fallback_queries is provided,
    falls back to RSS mode (websearch candidates + url_context).
    On validation/parsing failure, attempts a single repair retry without tools.
    """
    if fallback_queries:
        is_avail, retry_at = _is_grounding_available()
        if not is_avail:
            logger.info("Grounding circuit open (until %s). Using RSS fallback mode directly.", retry_at)
            return _rss_fallback_json(
                prompt,
                system=system,
                fallback_queries=fallback_queries,
                fallback_days=fallback_days,
                fallback_max_items=fallback_max_items,
                **kw,
            )

    try:
        res = grounded_search(prompt, system=system, **kw)
    except (GeminiQuotaError, GeminiError) as exc:
        if fallback_queries:
            logger.warning("Grounding search failed (%s). Falling back to RSS mode...", exc)
            return _rss_fallback_json(
                prompt,
                system=system,
                fallback_queries=fallback_queries,
                fallback_days=fallback_days,
                fallback_max_items=fallback_max_items,
                **kw,
            )
        raise

    try:
        parsed = extract_json(res.text)
        return parsed, res
    except ValueError:
        logger.warning("grounded_json: Falló el parseo inicial de JSON. Ejecutando llamada de reparación...")
        repair_prompt = (
            f"El siguiente texto debía contener un JSON válido pero falló al parsearse:\n\n"
            f"{res.text}\n\n"
            f"Devuelve únicamente el JSON válido, sin comentarios, explicaciones ni formato markdown."
        )
        repair_res = _call_gemini_raw(
            prompt=repair_prompt,
            system="Eres un formateador de datos. Devuelve únicamente el JSON válido requerido.",
            tools=None,
            max_output_tokens=kw.get("max_output_tokens", 8192),
            timeout_s=kw.get("timeout_s"),
            mode="none",
        )
        parsed_repair = extract_json(repair_res.text)

        # Retain sources and queries from original grounded search
        final_res = GroundedResult(
            text=repair_res.text,
            sources=res.sources,
            queries=res.queries,
            model=repair_res.model,
            latency_ms=res.latency_ms + repair_res.latency_ms,
            supports=res.supports,
            from_cache=False,
            mode=res.mode,
        )
        return parsed_repair, final_res
