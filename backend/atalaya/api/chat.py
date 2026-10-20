"""FastAPI endpoint for ATALAYA conversational assistant with SSE streaming."""

from __future__ import annotations

import json
import logging
import queue
import threading
from typing import Any, AsyncIterator, Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse
from starlette.concurrency import run_in_threadpool

from atalaya.chat.executor import execute
from atalaya.chat.guard import check as guard_check
from atalaya.chat.planner import plan
from atalaya.chat.spec import DataResult, QuerySpec
from atalaya.chat.writer import stream_answer

logger = logging.getLogger(__name__)

router = APIRouter()


class HistoryItem(BaseModel):
    """Chat message history turn."""

    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    """Payload for POST /api/chat."""

    message: str
    history: list[HistoryItem] = Field(default_factory=list)
    region_id: str | None = None


def _stream_worker(
    q: queue.Queue,
    sentinel: object,
    meta: dict[str, Any],
    message: str,
    spec: QuerySpec,
    data: DataResult,
) -> None:
    """Worker function executed in background thread to stream answer tokens."""
    try:
        for chunk in stream_answer(message, spec, data, meta=meta):
            q.put(chunk)
    except Exception as exc:
        logger.error("Error in stream_answer: %s", exc)
        q.put(exc)
    finally:
        q.put(sentinel)


async def _chat_event_stream(req: ChatRequest) -> AsyncIterator[dict[str, str]]:
    """Generate Server-Sent Events for the conversation pipeline."""
    try:
        # 1. Evaluate safeguards
        rejection = guard_check(req.message)
        if rejection:
            yield {
                "event": "token",
                "data": json.dumps({"text": rejection}, ensure_ascii=False),
            }
            yield {
                "event": "done",
                "data": json.dumps({"sources": [], "degraded": False}, ensure_ascii=False),
            }
            return

        # 2. Plan structured query
        history_dicts = [h.model_dump() for h in req.history]
        spec, method = await run_in_threadpool(plan, req.message, history_dicts, req.region_id)

        yield {
            "event": "plan",
            "data": json.dumps(
                {"intent": spec.intent, "query": spec.model_dump(), "method": method},
                ensure_ascii=False,
            ),
        }

        # 3. Execute query deterministically
        data = await run_in_threadpool(execute, spec, req.region_id)

        if not data.empty:
            yield {
                "event": "data",
                "data": json.dumps(
                    {"columns": data.columns, "rows": data.rows, "source": data.source},
                    ensure_ascii=False,
                ),
            }

        # 4. Stream response tokens in background thread
        meta: dict[str, Any] = {"degraded": False}
        q: queue.Queue = queue.Queue()
        sentinel = object()

        thread = threading.Thread(
            target=_stream_worker,
            args=(q, sentinel, meta, req.message, spec, data),
            daemon=True,
        )
        thread.start()

        while True:
            item = await run_in_threadpool(q.get)
            if item is sentinel:
                break
            if isinstance(item, Exception):
                break
            yield {
                "event": "token",
                "data": json.dumps({"text": str(item)}, ensure_ascii=False),
            }

        # 5. Emit done event
        sources = [data.source] if data.source else []
        yield {
            "event": "done",
            "data": json.dumps(
                {"sources": sources, "degraded": meta.get("degraded", False)},
                ensure_ascii=False,
            ),
        }

    except Exception as exc:
        logger.exception("Unexpected error during /api/chat execution: %s", exc)
        yield {
            "event": "error",
            "data": json.dumps(
                {"message": "Ocurrió un error inesperado al procesar la consulta."},
                ensure_ascii=False,
            ),
        }
        yield {
            "event": "done",
            "data": json.dumps({"sources": [], "degraded": True}, ensure_ascii=False),
        }


@router.post("/chat")
@router.post("/api/chat")
async def chat_endpoint(req: ChatRequest, request: Request) -> EventSourceResponse:
    """Handle chat messages with SSE streaming response."""
    if len(req.message) > 1000:
        raise HTTPException(
            status_code=413,
            detail="La pregunta es demasiado larga (máximo 1,000 caracteres).",
        )
    from atalaya.api.security import check_chat_rate_limit

    check_chat_rate_limit(request)
    return EventSourceResponse(_chat_event_stream(req))
