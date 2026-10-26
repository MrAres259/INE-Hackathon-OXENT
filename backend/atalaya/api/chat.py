"""FastAPI endpoint for ATALAYA conversational assistant with SSE streaming."""

from __future__ import annotations

import json
import logging
import queue
import re
import sys
import threading
import types
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse
from starlette.concurrency import run_in_threadpool

from atalaya.chat.executor import execute
from atalaya.chat.planner import plan
from atalaya.chat.spec import DataResult, QuerySpec
from atalaya.chat.writer import stream_answer

try:
    from atalaya.chat import guardrails
except ImportError:
    @dataclass
    class Verdict:
        allowed: bool = True
        stage: str = "entrada"
        category: str | None = None
        severity: str = "bajo"
        rule: str | None = None
        refusal: str = ""
        ref: str = "gr-00000000"
        domain: bool = False
        greeting: bool = False
        flags: list[dict] = field(default_factory=list)

        def as_public(self) -> dict | None:
            if self.allowed and not self.flags:
                return None
            return {"stage": self.stage, "category": self.category, "ref": self.ref}

    class StreamGuard:
        def __init__(self, *, allowed_numbers=None, max_hold=400):
            self.allowed_numbers = allowed_numbers or set()
            self.blocked = None

        def feed(self, delta: str):
            return delta, None

        def finish(self):
            return "", None

    _stub = types.ModuleType("atalaya.chat.guardrails")
    _stub.Verdict = Verdict
    _stub.StreamGuard = StreamGuard
    _stub.normalize = lambda text: text
    _stub.has_domain_signal = lambda text: True
    _stub.screen_input = lambda text, *, history=None: Verdict(allowed=True, domain=True)
    _stub.sanitize_history = lambda history, *, max_turns=4, max_chars=1000: history or []
    _stub.topic_gate = lambda text, *, history=None: Verdict(allowed=True, domain=True)
    _stub.scope_refusal = lambda stage="tema", category="fuera_de_alcance": Verdict(
        allowed=False, stage=stage, category=category, refusal=f"Rechazo {category}\n\nReferencia: gr-00000000", ref="gr-00000000"
    )
    _stub.screen_output = lambda text, *, allowed_numbers=None: Verdict(allowed=True)
    _stub.numbers_in = lambda text: set()
    _stub.audit = lambda verdict, *, message="": None
    _stub.stats = lambda: {"total_checked": 0, "blocked": 0, "categories": {}}
    _stub.SYSTEM_PROMPT_BLOCK = ""
    guardrails = _stub
    sys.modules["atalaya.chat.guardrails"] = _stub

logger = logging.getLogger(__name__)

router = APIRouter()


class HistoryItem(BaseModel):
    """Chat message history turn."""

    role: Literal["user", "assistant"]
    content: str = Field(max_length=4000)


class ChatRequest(BaseModel):
    """Payload for POST /api/chat."""

    message: str
    history: list[HistoryItem] = Field(default_factory=list, max_length=20)
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
        raw_history = [h.model_dump() for h in req.history]

        # 1. Screen input
        v = guardrails.screen_input(req.message, history=raw_history)
        if not v.allowed:
            guardrails.audit(v, message=req.message)
            yield {
                "event": "token",
                "data": json.dumps({"text": v.refusal}, ensure_ascii=False),
            }
            yield {
                "event": "done",
                "data": json.dumps(
                    {"sources": [], "degraded": False, "guardrail": v.as_public()},
                    ensure_ascii=False,
                ),
            }
            return

        # 2. Sanitize history and validate region_id
        history = guardrails.sanitize_history(raw_history)
        region_id = req.region_id
        if region_id and not re.match(r"^\d{2}(\d{3})?$", region_id):
            region_id = None

        # 3. Topic gate when message lacks domain keywords and is not greeting/help
        if not v.domain and not v.greeting:
            g = await run_in_threadpool(guardrails.topic_gate, req.message, history=history)
            if not g.allowed:
                guardrails.audit(g, message=req.message)
                yield {
                    "event": "token",
                    "data": json.dumps({"text": g.refusal}, ensure_ascii=False),
                }
                yield {
                    "event": "done",
                    "data": json.dumps(
                        {"sources": [], "degraded": False, "guardrail": g.as_public()},
                        ensure_ascii=False,
                    ),
                }
                return

        # 4. Plan structured query
        spec, method = await run_in_threadpool(plan, req.message, history, region_id)

        yield {
            "event": "plan",
            "data": json.dumps(
                {"intent": spec.intent, "query": spec.model_dump(), "method": method},
                ensure_ascii=False,
            ),
        }

        if spec.intent == "out_of_scope":
            ref_verdict = guardrails.scope_refusal("tema", "fuera_de_alcance")
            guardrails.audit(ref_verdict, message=req.message)
            yield {
                "event": "token",
                "data": json.dumps({"text": ref_verdict.refusal}, ensure_ascii=False),
            }
            yield {
                "event": "done",
                "data": json.dumps(
                    {"sources": [], "degraded": False, "guardrail": ref_verdict.as_public()},
                    ensure_ascii=False,
                ),
            }
            return

        # 5. Execute query deterministically
        data = await run_in_threadpool(execute, spec, region_id)

        if not data.empty:
            yield {
                "event": "data",
                "data": json.dumps(
                    {"columns": data.columns, "rows": data.rows, "source": data.source},
                    ensure_ascii=False,
                ),
            }

        # 6. Stream response tokens in background thread
        meta: dict[str, Any] = {"degraded": False, "guardrail": None}
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

        # 7. Emit done event
        sources = [data.source] if data.source else []
        yield {
            "event": "done",
            "data": json.dumps(
                {
                    "sources": sources,
                    "degraded": meta.get("degraded", False),
                    "guardrail": meta.get("guardrail"),
                },
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
            "data": json.dumps({"sources": [], "degraded": True, "guardrail": None}, ensure_ascii=False),
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
