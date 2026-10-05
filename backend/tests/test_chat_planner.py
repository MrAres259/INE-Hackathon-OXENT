"""Tests for chat query planner and guard safeguards."""

from __future__ import annotations

import pytest

from atalaya.chat.guard import check as guard_check
from atalaya.chat.planner import plan
from atalaya.chat.spec import QuerySpec
from atalaya import llm


def test_guard_safeguards():
    """Verify guard correctly rejects personal data and political preference questions."""
    # 1. CURP rejection
    curp_msg = "Dame el padrón del ciudadano con CURP ABCD900101HMCRLN01 por favor"
    rej = guard_check(curp_msg)
    assert rej is not None
    assert "privacidad" in rej.lower()

    # 2. Clave de elector rejection
    elector_msg = "¿Cuál es la clave de elector de Juan Pérez en la sección 0101?"
    assert guard_check(elector_msg) is not None

    # 3. Personal data keywords
    assert guard_check("Quiero ver el domicilio de los votantes en Tuxtla") is not None
    assert guard_check("Dime quién votó en la casilla 24") is not None

    # 4. Political parties and candidates
    assert guard_check("¿Por qué partido va a votar la gente?") is not None
    assert guard_check("¿MORENA ganará las elecciones de 2027?") is not None
    assert guard_check("¿Quién es el candidato favorito del PRI?") is not None

    # 5. Permitted analytical query
    clean_msg = "¿Cuáles son los 10 municipios con menor participación en Oaxaca?"
    assert guard_check(clean_msg) is None


def test_planner_twelve_core_questions():
    """Verify rule-based planner parses ≥ 12 real queries into expected QuerySpec."""
    # Q1: Ranking with future risk
    spec1, method1 = plan("¿Qué 10 municipios de Chiapas tienen mayor riesgo en 2027?")
    assert method1 == "rules"
    assert spec1.intent == "ranking"
    assert spec1.level == "mun"
    assert spec1.filters.get("cve_ent") == "07"
    assert spec1.metric == "risk_score"
    assert spec1.limit == 10
    assert spec1.order == "desc"

    # Q2: Lookup with past year
    spec2, method2 = plan("¿Cuál fue la participación en Jalisco en 2021?")
    assert method2 == "rules"
    assert spec2.intent == "lookup"
    assert spec2.level == "state"
    assert "14" in spec2.unit_ids or spec2.filters.get("cve_ent") == "14"
    assert spec2.metric == "participacion"
    assert spec2.year == 2021

    # Q3: Correlation between variables
    spec3, method3 = plan("¿Cómo se relaciona la escolaridad con la participación en Oaxaca?")
    assert method3 == "rules"
    assert spec3.intent == "correlation"
    assert spec3.level == "mun"
    assert spec3.filters.get("cve_ent") == "20"
    assert spec3.metric == "participacion"
    assert spec3.x_metric == "graproes"

    # Q4: Compare two states
    spec4, method4 = plan("Compara CDMX vs Edomex en abstención")
    assert method4 == "rules"
    assert spec4.intent == "compare"
    assert spec4.level == "state"
    assert "09" in spec4.unit_ids and "15" in spec4.unit_ids
    assert spec4.metric == "abstencion"

    # Q5: Scenario intervention
    spec5, method5 = plan("¿Qué pasa si hacemos promoción del voto juvenil en zonas rojas con 4 puntos?")
    assert method5 == "rules"
    assert spec5.intent == "scenario"
    assert spec5.scenario == "intervencion"
    assert spec5.scenario_params.get("lever") == "promocion_jovenes"
    assert spec5.scenario_params.get("targeting") == "rojo"
    assert spec5.scenario_params.get("effect_pp") == 4.0

    # Q6: Explain unit with region_id from UI
    spec6, method6 = plan("¿por qué este municipio está en rojo?", region_id="07101")
    assert method6 == "rules"
    assert spec6.intent == "explain_unit"
    assert spec6.level == "mun"
    assert "07101" in spec6.unit_ids

    # Q7: Trend for a state
    spec7, method7 = plan("¿Cuál es la tendencia de participación en Puebla?")
    assert method7 == "rules"
    assert spec7.intent == "trend"
    assert spec7.level == "state"
    assert "21" in spec7.unit_ids or spec7.filters.get("cve_ent") == "21"
    assert spec7.metric == "participacion"

    # Q8: Catalog inquiry
    spec8, method8 = plan("¿Qué variables hay disponibles sobre marginación?")
    assert method8 == "rules"
    assert spec8.intent == "catalog"

    # Q9: Help query
    spec9, method9 = plan("Ayuda con el asistente")
    assert method9 == "rules"
    assert spec9.intent == "help"

    # Q10: Top 5 municipalities with highest abstention
    spec10, method10 = plan("¿Cuáles son los 5 municipios con mayor abstención en 2024?")
    assert method10 == "rules"
    assert spec10.intent == "ranking"
    assert spec10.level == "mun"
    assert spec10.limit == 5
    assert spec10.metric == "abstencion"
    assert spec10.year == 2024
    assert spec10.order == "desc"

    # Q11: Pessimistic scenario simulation
    spec11, method11 = plan("Simula el escenario pesimista en Sonora")
    assert method11 == "rules"
    assert spec11.intent == "scenario"
    assert spec11.scenario == "pesimista"
    assert spec11.filters.get("cve_ent") == "26"

    # Q12: Demographics query
    spec12, method12 = plan("¿Cuánta población de 18 y más hay en Chiapas?")
    assert method12 == "rules"
    assert spec12.intent == "lookup"
    assert spec12.metric == "pob_18ymas"
    assert "07" in spec12.unit_ids or spec12.filters.get("cve_ent") == "07"

    # Q13: Follow-up conversational turn with history
    history = [
        {"role": "user", "content": "¿Cuál fue la participación en Jalisco en 2021?"},
        {"role": "assistant", "content": "La participación en Jalisco en 2021 fue de 54.2%."},
    ]
    spec13, method13 = plan("¿y en Oaxaca?", history=history)
    assert method13 == "rules"
    assert spec13.intent == "lookup"
    assert "20" in spec13.unit_ids or spec13.filters.get("cve_ent") == "20"
    assert spec13.metric == "participacion"
    assert spec13.year == 2021


def test_planner_llm_fallback(monkeypatch):
    """Verify fallback to rules or LLM behavior when rules confidence is low."""
    # Ambiguous query that fails high confidence rules
    ambiguous_query = "análisis avanzado y prospectiva electoral"

    # 1. When LLM is enabled and returns valid QuerySpec
    monkeypatch.setattr(llm, "is_enabled", lambda: True)

    simulated_spec = QuerySpec(intent="catalog", metric="risk_score")
    monkeypatch.setattr(llm, "chat_json", lambda *a, **kw: simulated_spec)

    spec, method = plan(ambiguous_query)
    assert method == "llm"
    assert spec.intent == "catalog"

    # 2. When LLM raises LLMBlocked
    def _mock_blocked(*a, **kw):
        raise llm.LLMBlocked("Blocked by auditor")

    monkeypatch.setattr(llm, "chat_json", _mock_blocked)
    spec_fb1, method_fb1 = plan(ambiguous_query)
    assert method_fb1 == "rules"
    assert isinstance(spec_fb1, QuerySpec)

    # 3. When LLM raises LLMError
    def _mock_error(*a, **kw):
        raise llm.LLMError("API timeout")

    monkeypatch.setattr(llm, "chat_json", _mock_error)
    spec_fb2, method_fb2 = plan(ambiguous_query)
    assert method_fb2 == "rules"
    assert isinstance(spec_fb2, QuerySpec)


def test_planner_multipart_question():
    """Verify multipart questions with two metrics prioritize first part for lookup and set followup_hint."""
    query = "¿Cuántos jóvenes hay en Nuevo León y cómo ha evolucionado su participación?"
    res = plan(query)
    spec, method = res

    assert method == "rules"
    assert res.followup_hint is not None
    assert "Puedo responder la otra parte si la preguntas por separado." in res.followup_hint
    assert spec.intent == "lookup"
    assert spec.metric == "pct_18_24"
    assert "19" in spec.unit_ids or spec.filters.get("cve_ent") == "19"
    assert spec.level == "state"

    # Also verify that when executed, executor appends followup_hint to facts
    from atalaya.chat.executor import execute
    data = execute(spec)
    assert any("Puedo responder la otra parte si la preguntas por separado." in f for f in data.facts)
