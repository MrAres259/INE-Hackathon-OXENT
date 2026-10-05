"""Tests for response writer and streaming generator."""

from __future__ import annotations

import pytest

from atalaya.chat.spec import DataResult, QuerySpec
from atalaya.chat.writer import fallback_text, stream_answer
from atalaya import llm


def test_fallback_text_mentions_facts_and_source():
    """Verify deterministic fallback includes facts and cites source."""
    spec = QuerySpec(
        intent="ranking",
        metric="risk_score",
        level="mun",
    )
    data = DataResult(
        columns=["#", "Zona", "Estado", "Índice de riesgo"],
        rows=[[1, "Municipio A", "Chiapas", "82.5%"]],
        source="INE · Resultados 2024; ATALAYA",
        facts=[
            "Top 1: Municipio A (Chiapas) con índice de riesgo de 82.5%.",
            "Promedio del grupo: 74.0%.",
        ],
        empty=False,
    )

    text = fallback_text(spec, data)
    assert "Ranking" in text
    assert "Municipio A" in text
    assert "82.5%" in text
    assert "Fuente: INE · Resultados 2024; ATALAYA" in text


def test_stream_answer_without_llm(monkeypatch):
    """When LLM is disabled, stream_answer yields fallback_text and sets degraded=True."""
    monkeypatch.setattr(llm, "is_enabled", lambda: False)

    spec = QuerySpec(intent="lookup", metric="participacion")
    data = DataResult(
        columns=["Zona", "Nivel", "Estado", "Participación"],
        rows=[["Jalisco", "Estado", "Jalisco", "54.2%"]],
        source="INE · Diputaciones federales 2021",
        facts=["La participación en Jalisco fue de 54.2%."],
        empty=False,
    )

    meta = {}
    tokens = list(stream_answer("¿Cuál fue la participación en Jalisco?", spec, data, meta=meta))
    assert meta.get("degraded") is True
    full_text = "".join(tokens)
    assert "54.2%" in full_text
    assert "INE" in full_text


def test_stream_answer_llm_success(monkeypatch):
    """When LLM streams normally, tokens are yielded and degraded=False."""
    monkeypatch.setattr(llm, "is_enabled", lambda: True)

    def _mock_stream(*a, **kw):
        yield "La "
        yield "participación "
        yield "fue del 54.2%."

    monkeypatch.setattr(llm, "chat_stream", _mock_stream)

    spec = QuerySpec(intent="lookup", metric="participacion")
    data = DataResult(
        columns=["Zona", "Participación"],
        rows=[["Jalisco", "54.2%"]],
        source="INE 2021",
        facts=["Participación 54.2%"],
        empty=False,
    )

    meta = {}
    tokens = list(stream_answer("Consulta", spec, data, meta=meta))
    assert meta.get("degraded") is False
    assert "".join(tokens) == "La participación fue del 54.2%."


def test_stream_answer_llm_blocked_before(monkeypatch):
    """When LLM is blocked before emitting any token, falls back to fallback_text with degraded=True."""
    monkeypatch.setattr(llm, "is_enabled", lambda: True)

    def _mock_blocked(*a, **kw):
        raise llm.LLMBlocked("Audit block before streaming")
        yield "never"

    monkeypatch.setattr(llm, "chat_stream", _mock_blocked)

    spec = QuerySpec(intent="ranking", metric="risk_score")
    data = DataResult(
        columns=["Zona", "Riesgo"],
        rows=[["Zona X", "75.0%"]],
        source="ATALAYA 2027",
        facts=["Top 1: Zona X con 75.0%."],
        empty=False,
    )

    meta = {}
    tokens = list(stream_answer("Top riesgo", spec, data, meta=meta))
    assert meta.get("degraded") is True
    full_text = "".join(tokens)
    assert "Top 1: Zona X con 75.0%." in full_text
    assert "ATALAYA 2027" in full_text


def test_stream_answer_llm_blocked_midway(monkeypatch):
    """When LLM is blocked midway, yields emitted tokens, appends completion note, and marks degraded=True."""
    monkeypatch.setattr(llm, "is_enabled", lambda: True)

    def _mock_blocked_midway(*a, **kw):
        yield "Primer fragmento emitido. "
        raise llm.LLMBlocked("Audit block midway")

    monkeypatch.setattr(llm, "chat_stream", _mock_blocked_midway)

    spec = QuerySpec(intent="lookup", metric="participacion")
    data = DataResult(
        columns=["Zona", "Participación"],
        rows=[["Puebla", "50.0%"]],
        source="INE 2024",
        facts=["Participación 50.0%"],
        empty=False,
    )

    meta = {}
    tokens = list(stream_answer("Consulta", spec, data, meta=meta))
    assert meta.get("degraded") is True
    full_text = "".join(tokens)
    assert "Primer fragmento emitido. " in full_text
    assert "(Respuesta completada con datos, sin IA)" in full_text


def test_writer_prompt_and_max_tokens(monkeypatch):
    """Verify writer enforces max_tokens=450 and system prompt requests <= 120 words."""
    from atalaya.chat.writer import SYSTEM_PROMPT, _format_table_text

    assert "120 palabras" in SYSTEM_PROMPT
    assert "3 hallazgos principales" in SYSTEM_PROMPT

    monkeypatch.setattr(llm, "is_enabled", lambda: True)

    captured_kwargs = {}

    def _mock_stream(messages, **kwargs):
        captured_kwargs.update(kwargs)
        captured_kwargs["messages"] = messages
        yield "Respuesta concisa."

    monkeypatch.setattr(llm, "chat_stream", _mock_stream)

    spec = QuerySpec(intent="lookup", metric="participacion")
    data = DataResult(
        columns=["Zona", "Participación"],
        rows=[[f"Municipio {i}", f"{50+i}%"] for i in range(25)],
        source="INE · Diputaciones federales 2024",
        facts=["Participación promedio: 55.0%"],
        empty=False,
    )

    tokens = list(stream_answer("Consulta", spec, data))
    assert "".join(tokens) == "Respuesta concisa."

    # max_tokens must be 450
    assert captured_kwargs.get("max_tokens") == 450

    # table text formatted for LLM must have at most 10 rows
    table_text = _format_table_text(data, max_rows=10)
    table_lines = [l for l in table_text.splitlines() if "|" in l]
    assert len(table_lines) == 12
