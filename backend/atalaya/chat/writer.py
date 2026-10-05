"""Response writer and streaming generator for ATALAYA conversational assistant."""

from __future__ import annotations

import logging
from typing import Any, Iterator

from atalaya.chat.executor import get_variable_meta
from atalaya.chat.spec import DataResult, QuerySpec
from atalaya import llm

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "Eres ATALAYA, asistente analítico para personal del Instituto Nacional Electoral (INE).\n"
    "Responde a la consulta en español claro, profesional y breve (máximo 120 palabras).\n"
    "No repitas la tabla completa de datos (la interfaz ya la muestra): resume los 3 hallazgos principales.\n"
    "REGLAS ESTRICTAS E INQUEBRANTABLES:\n"
    "1. Usa ÚNICAMENTE las cifras presentes en los hechos (facts) y la tabla de datos proporcionada. "
    "Bajo ninguna circunstancia inventes o infieras números no presentes.\n"
    "2. Cita siempre la fuente oficial y los años correspondientes indicados en los datos.\n"
    "3. No emitas opiniones sobre partidos políticos ni candidaturas.\n"
    "4. Si se menciona una proyección para 2027, recalca que es una estimación estadística.\n"
    "5. Si se presenta una correlación, recuerda que correlación no implica causalidad."
)


def fallback_text(spec: QuerySpec, data: DataResult) -> str:
    """Generate deterministic, formatted response from DataResult facts and source.
    
    Guaranteed to run offline without calling the LLM.
    """
    if data.empty and spec.intent in ("help", "out_of_scope"):
        return "\n".join(data.facts)

    meta = get_variable_meta(spec.metric)
    label = meta.get("label_es", spec.metric)

    intent_titles = {
        "ranking": f"Ranking de {label}:",
        "lookup": f"Información sobre {label}:",
        "compare": f"Comparativa sobre {label}:",
        "trend": "Tendencia histórica de participación:",
        "correlation": "Análisis de correlación:",
        "scenario": f"Simulación de escenario '{spec.scenario or 'intervención'}':",
        "explain_unit": "Factores determinantes y recomendaciones:",
        "catalog": "Catálogo de variables disponibles:",
    }

    title = intent_titles.get(spec.intent, "Resultados analíticos:")
    facts_block = "\n".join(f"• {f}" for f in data.facts)
    source_block = f"\n\nFuente: {data.source}" if data.source else ""

    return f"{title}\n{facts_block}{source_block}"


def _format_table_text(data: DataResult, max_rows: int = 10) -> str:
    """Format tabular data into markdown table text for LLM context."""
    if data.empty or not data.columns or not data.rows:
        return ""
    header = " | ".join(str(c) for c in data.columns)
    separator = " | ".join(["---"] * len(data.columns))
    rows_lines = [" | ".join(str(c) for c in row) for row in data.rows[:max_rows]]
    return f"Tabla de datos (máximo {max_rows} filas):\n{header}\n{separator}\n" + "\n".join(rows_lines)


def stream_answer(
    message: str,
    spec: QuerySpec,
    data: DataResult,
    meta: dict[str, Any] | None = None,
) -> Iterator[str]:
    """Stream response tokens for user query.
    
    Uses LLM streaming when available. Falls back deterministically upon LLM errors or audit blocks.
    Updates meta['degraded'] = True if fallback was triggered.
    """
    if meta is None:
        meta = {}

    if not llm.is_enabled():
        meta["degraded"] = True
        yield fallback_text(spec, data)
        return

    # Build prompt context for LLM
    table_text = _format_table_text(data, max_rows=10)
    facts_text = "\n".join(f"- {f}" for f in data.facts)

    user_content = (
        f"Pregunta del usuario: {message}\n\n"
        f"Hechos clave verificados:\n{facts_text}\n\n"
    )
    if table_text:
        user_content += f"{table_text}\n\n"
    if data.source:
        user_content += f"Fuente oficial: {data.source}\n"

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]

    emitted_any = False
    try:
        token_stream = llm.chat_stream(
            messages,
            max_tokens=450,
            timeout_s=60.0,
            temperature=0.2,
        )
        for token in token_stream:
            emitted_any = True
            yield token

        meta["degraded"] = False
    except (llm.LLMBlocked, llm.LLMError, Exception) as err:
        logger.warning("LLM stream error (%s: %s). Degrading response.", err.__class__.__name__, err)
        meta["degraded"] = True
        if not emitted_any:
            yield fallback_text(spec, data)
        else:
            yield "\n\n(Respuesta completada con datos, sin IA)"
