"""FastAPI router for Atalaya zone explanations and public context (/api/explain)."""

from __future__ import annotations

import logging
import re
import sys
from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from atalaya.api.security import check_intel_rate_limit, verify_operator
from atalaya.explain import context
from atalaya.explain.schemas import ContextResult, Explanation

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/explain", tags=["explain"])

UNIT_ID_REGEX = re.compile(r"^\d{2}(\d{3})?$")


def _validate_unit_id(unit_id: str) -> None:
    """Validate that unit_id is a 2-digit state or 5-digit municipal code."""
    if not UNIT_ID_REGEX.match(unit_id):
        raise HTTPException(status_code=422, detail="Clave de zona inválida.")


def _get_build_explanation():
    """Retrieve build_explanation function from atalaya.explain.engine tolerantly."""
    engine = sys.modules.get("atalaya.explain.engine")
    if engine is not None and hasattr(engine, "build_explanation"):
        return engine.build_explanation
    try:
        from atalaya.explain import engine as _eng
        if hasattr(_eng, "build_explanation"):
            return _eng.build_explanation
    except (ImportError, AttributeError):
        pass
    raise HTTPException(status_code=503, detail="Motor de explicaciones no disponible.")


class ContextRequest(BaseModel):
    refresh: bool = False


@router.get("/{unit_id}", response_model=Explanation)
async def get_explanation(unit_id: str, response: Response) -> Any:
    """Return deterministic explanation for a state or municipal unit."""
    _validate_unit_id(unit_id)

    builder = _get_build_explanation()
    try:
        explanation = await run_in_threadpool(builder, unit_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="No encontramos esa zona.")
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Error generating explanation for %s: %s", unit_id, exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Error interno al generar la explicación.")

    response.headers["Cache-Control"] = "private, max-age=300"
    return explanation


@router.get("/{unit_id}/context", response_model=ContextResult)
def get_context(unit_id: str) -> ContextResult:
    """Retrieve cached public news context for a unit (max 72 hours old) or 404."""
    _validate_unit_id(unit_id)

    cached = context.get_cached_context(unit_id)
    if cached is None:
        raise HTTPException(status_code=404, detail="Aún no hay contexto investigado para esta zona.")

    return cached


@router.post("/{unit_id}/context")
def request_context(
    unit_id: str,
    request: Request,
    response: Response,
    body: ContextRequest = ContextRequest(),
) -> Any:
    """Request public context research: returns cached result (200) or accepts job (202)."""
    _validate_unit_id(unit_id)

    if not body.refresh:
        cached = context.get_cached_context(unit_id)
        if cached is not None:
            return {"status": "done", "context": cached}

    check_intel_rate_limit(request)
    verify_operator(request)

    from atalaya.intel import jobs

    job = jobs.submit(
        "explain_context",
        unit_id,
        lambda report: context.run_context_research(unit_id, report, refresh=body.refresh),
    )
    response.status_code = status.HTTP_202_ACCEPTED
    return job
