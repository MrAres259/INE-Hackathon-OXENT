"""In-memory single-flight background job executor for intelligence tasks."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import logging
import secrets
import threading
import time
from typing import Any, Callable

from pydantic import BaseModel

from atalaya.intel.schemas import Job

logger = logging.getLogger(__name__)

_LOCK = threading.Lock()
_JOBS: dict[str, Job] = {}
_ACTIVE_KEYS: dict[tuple[str, str], str] = {}  # (kind, key) -> job_id
_EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="intel-job-")
_JOB_TTL_SECONDS = 7200.0  # 2 hours


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _is_safe_llm_error(exc: Exception) -> bool:
    """Determine if the exception is a known LLM/Gemini domain error with a user-facing Spanish message."""
    try:
        from atalaya.gemini import GeminiError
        if isinstance(exc, GeminiError):
            return True
    except ImportError:
        pass

    try:
        from atalaya.llm import LLMError
        if isinstance(exc, LLMError):
            return True
    except ImportError:
        pass

    cls_name = exc.__class__.__name__
    if "Gemini" in cls_name or "LLM" in cls_name:
        return True
    return False


def _cleanup_old_jobs(now_ts: float) -> None:
    """Remove completed or expired jobs older than 2 hours."""
    to_delete: list[str] = []
    for jid, job in _JOBS.items():
        if job.status in ("done", "error") and job.finished_at:
            try:
                finished_dt = datetime.fromisoformat(job.finished_at)
                age = now_ts - finished_dt.timestamp()
                if age > _JOB_TTL_SECONDS:
                    to_delete.append(jid)
            except Exception:
                to_delete.append(jid)

    for jid in to_delete:
        del _JOBS[jid]
        # remove from active keys if still mapped
        for k, v in list(_ACTIVE_KEYS.items()):
            if v == jid:
                del _ACTIVE_KEYS[k]


def submit(
    kind: str,
    key: str,
    fn: Callable[[Callable[[str, int], None]], BaseModel],
) -> Job:
    """Submit a background job with single-flight semantics.

    If a job with the same (kind, key) is already queued or running, it is returned.
    """
    now_ts = time.time()

    with _LOCK:
        _cleanup_old_jobs(now_ts)

        active_id = _ACTIVE_KEYS.get((kind, key))
        if active_id and active_id in _JOBS:
            existing = _JOBS[active_id]
            if existing.status in ("queued", "running"):
                return existing.model_copy()

        job_id = f"job_{secrets.token_hex(6)}"
        job = Job(
            id=job_id,
            kind=kind,  # type: ignore[arg-type]
            key=key,
            status="queued",
            stage="En cola",
            progress=0,
            created_at=_now_iso(),
        )
        _JOBS[job_id] = job
        _ACTIVE_KEYS[(kind, key)] = job_id

    def _worker() -> None:
        def report(stage: str, pct: int) -> None:
            with _LOCK:
                if job_id in _JOBS:
                    _JOBS[job_id].stage = stage
                    _JOBS[job_id].progress = max(0, min(100, pct))
                    _JOBS[job_id].status = "running"

        with _LOCK:
            if job_id in _JOBS:
                _JOBS[job_id].status = "running"
                _JOBS[job_id].stage = "Iniciando tarea"
                _JOBS[job_id].progress = 5

        try:
            result = fn(report)
            with _LOCK:
                if job_id in _JOBS:
                    _JOBS[job_id].status = "done"
                    _JOBS[job_id].stage = "Completado"
                    _JOBS[job_id].progress = 100
                    _JOBS[job_id].finished_at = _now_iso()
                    if hasattr(result, "model_dump"):
                        _JOBS[job_id].result = result.model_dump()
                    elif isinstance(result, dict):
                        _JOBS[job_id].result = result
                    else:
                        _JOBS[job_id].result = dict(result)
        except Exception as exc:
            logger.error("Job %s (%s, %s) failed: %s", job_id, kind, key, exc, exc_info=False)
            with _LOCK:
                if job_id in _JOBS:
                    _JOBS[job_id].status = "error"
                    _JOBS[job_id].stage = "Error"
                    _JOBS[job_id].finished_at = _now_iso()
                    if _is_safe_llm_error(exc):
                        _JOBS[job_id].error = str(exc)
                    else:
                        _JOBS[job_id].error = "Error interno; intenta de nuevo"
        finally:
            with _LOCK:
                if _ACTIVE_KEYS.get((kind, key)) == job_id:
                    del _ACTIVE_KEYS[(kind, key)]

    _EXECUTOR.submit(_worker)
    with _LOCK:
        return _JOBS[job_id].model_copy()


def get(job_id: str) -> Job | None:
    """Retrieve current state of a background job by ID."""
    with _LOCK:
        job = _JOBS.get(job_id)
        return job.model_copy() if job is not None else None


def reset_jobs() -> None:
    """Clear all in-memory jobs (useful for test isolation)."""
    with _LOCK:
        _JOBS.clear()
        _ACTIVE_KEYS.clear()
