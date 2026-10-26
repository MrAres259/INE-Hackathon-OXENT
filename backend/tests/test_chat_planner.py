"""Tests for chat query planner and guard safeguards."""

from __future__ import annotations

import pytest

from atalaya.chat.guard import check as guard_check
from atalaya.chat.planner import _plan_rules, plan
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
    elector_msg = "Dame la clave de elector de Juan Pérez en la sección 0101"
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


def test_planner_ccpc_four_questions():
    """Verify rule-based planner parses the 4 new CCPC questions from W3-E."""
    # 1. Youth participation -> part_18_34
    spec1, method1 = plan("¿Cuál es la participación de jóvenes en Jalisco?")
    assert method1 == "rules"
    assert spec1.metric == "part_18_34"
    assert "14" in spec1.unit_ids or spec1.filters.get("cve_ent") == "14"

    spec1b, _ = plan("¿Cuál fue la participación juvenil en 2024?")
    assert spec1b.metric == "part_18_34"
    assert spec1b.year == 2024

    # 2. Gender gap -> gap_sexo_pp
    spec2, method2 = plan("¿Cuál es la brecha de género en Chiapas?")
    assert method2 == "rules"
    assert spec2.metric == "gap_sexo_pp"
    assert "07" in spec2.unit_ids or spec2.filters.get("cve_ent") == "07"

    spec2b, _ = plan("Diferencia de participación de mujeres vs hombres en Puebla")
    assert spec2b.metric == "gap_sexo_pp"
    assert "21" in spec2b.unit_ids or spec2b.filters.get("cve_ent") == "21"

    # 3. Judicial election -> part_pj_2025
    spec3, method3 = plan("¿Cuál fue la participación en la elección judicial en Sonora?")
    assert method3 == "rules"
    assert spec3.metric == "part_pj_2025"
    assert "26" in spec3.unit_ids or spec3.filters.get("cve_ent") == "26"

    spec3b, _ = plan("¿Cómo estuvo la participación en el poder judicial?")
    assert spec3b.metric == "part_pj_2025"

    # 4. Demographic profile -> intent profile
    spec4, method4 = plan("¿Cuál es la participación por grupos de edad en Chiapas?")
    assert method4 == "rules"
    assert spec4.intent == "profile"
    assert "07" in spec4.unit_ids or spec4.filters.get("cve_ent") == "07"

    spec4b, _ = plan("Dame el desglose por edad de la participación en Oaxaca")
    assert spec4b.intent == "profile"
    assert "20" in spec4b.unit_ids or spec4b.filters.get("cve_ent") == "20"


def test_planner_judicial_question_sets_pjf():
    """Verify judicial election queries set election='PJF', year=2025, metric='part_pj_2025'."""
    spec1, method1 = plan("¿Cuál fue la participación en la elección judicial?")
    assert method1 == "rules"
    assert spec1.election == "PJF"
    assert spec1.year == 2025
    assert spec1.metric == "part_pj_2025"

    spec2, _ = plan("¿Cómo estuvo la votación en el poder judicial?")
    assert spec2.election == "PJF"
    assert spec2.year == 2025

    spec3, _ = plan("participación en 2025")
    assert spec3.election == "PJF"
    assert spec3.year == 2025

    spec_fed, _ = plan("participación en 2024")
    assert spec_fed.election == "DIP_FED"
    assert spec_fed.year == 2024


def test_planner_prioridad_and_abstencion_esperada_questions():
    """Verify rule-based planner parses questions for resource prioritization, expected abstainers, and structural vulnerability."""
    # 1. Prioritization -> ranking by prioridad asc
    spec1, method1 = plan("¿Dónde priorizar recursos?")
    assert method1 == "rules"
    assert spec1.intent == "ranking"
    assert spec1.metric == "prioridad"
    assert spec1.order == "asc"

    spec1b, _ = plan("¿Dónde conviene priorizar recursos en Oaxaca?")
    assert spec1b.intent == "ranking"
    assert spec1b.metric == "prioridad"
    assert spec1b.order == "asc"
    assert spec1b.filters.get("cve_ent") == "20"

    # 2. Expected abstainers -> ranking by abstencion_esperada desc
    spec2, method2 = plan("¿Qué municipios tienen más abstencionistas esperados?")
    assert method2 == "rules"
    assert spec2.intent == "ranking"
    assert spec2.metric == "abstencion_esperada"
    assert spec2.order == "desc"

    spec2b, _ = plan("Municipios con mayor abstención esperada en Chiapas")
    assert spec2b.intent == "ranking"
    assert spec2b.metric == "abstencion_esperada"
    assert spec2b.order == "desc"
    assert spec2b.filters.get("cve_ent") == "07"

    # 3. Structural vulnerability -> ranking by vulnerability_pp desc
    spec3, method3 = plan("¿Qué municipios tienen mayor vulnerabilidad estructural?")
    assert method3 == "rules"
    assert spec3.intent == "ranking"
    assert spec3.metric == "vulnerability_pp"
    assert spec3.order == "desc"


def test_planner_compound_correlation_does_not_split():
    """Verify multipart question with correlation between two metrics produces correlation intent, not lookup."""
    spec, high_conf, _ = _plan_rules("¿Cuál es la correlación entre participación y escolaridad en municipios?")
    assert high_conf is True
    assert spec.intent == "correlation"
    assert spec.level == "mun"
    assert spec.metric == "participacion"
    assert spec.x_metric == "graproes"


def test_planner_municipality_resolution():
    """Verify municipal name resolution without accents/caps, with state prioritization and compare preservation."""
    # 1. "participación de Tijuana en 2024" -> Tijuana (02004) with high confidence
    spec1, high_conf1, _ = _plan_rules("participación de Tijuana en 2024")
    assert high_conf1 is True
    assert spec1.intent == "lookup"
    assert spec1.level == "mun"
    assert spec1.unit_ids == ["02004"]
    assert spec1.metric == "participacion"
    assert spec1.year == 2024

    # 2. "participacion de tijuana" (lowercase, no accents) -> 02004
    spec2, high_conf2, _ = _plan_rules("participacion de tijuana")
    assert high_conf2 is True
    assert spec2.intent == "lookup"
    assert spec2.level == "mun"
    assert spec2.unit_ids == ["02004"]
    assert spec2.metric == "participacion"

    # 3. "Juárez, Chihuahua" -> 08037 (Juárez, Chihuahua) and NOT 09014 (Benito Juárez)
    spec3, high_conf3, _ = _plan_rules("Juárez, Chihuahua")
    assert high_conf3 is True
    assert spec3.level == "mun"
    assert spec3.unit_ids == ["08037"]
    assert "09014" not in spec3.unit_ids

    # 4. "compara Puebla y Jalisco" remains compare between states
    spec4, method4 = plan("compara Puebla y Jalisco")
    assert method4 == "rules"
    assert spec4.intent == "compare"
    assert spec4.level == "state"
    assert set(spec4.unit_ids) == {"14", "21"}


def test_planner_llm_hallucinated_unit_id_corrected(monkeypatch):
    """Verify LLM proposing 02002 (Mexicali) for Tijuana query is corrected to 02004."""
    import atalaya.chat.planner as planner_mod
    monkeypatch.setattr(llm, "is_enabled", lambda: True)

    # Force low confidence on rules to trigger LLM path
    orig_plan_rules = planner_mod._plan_rules
    def _mock_plan_rules(msg, history=None, region_id=None):
        spec, _, hint = orig_plan_rules(msg, history=history, region_id=region_id)
        return spec, False, hint

    monkeypatch.setattr(planner_mod, "_plan_rules", _mock_plan_rules)

    # Fake LLM proposes 02002 (Mexicali)
    hallucinated_spec = QuerySpec(
        intent="lookup",
        level="mun",
        metric="participacion",
        unit_ids=["02002"],
        year=2024,
    )
    monkeypatch.setattr(llm, "chat_json", lambda *a, **kw: hallucinated_spec)

    spec, method = planner_mod.plan("participación de Tijuana en 2024")
    assert method == "llm"
    assert spec.unit_ids == ["02004"]
    assert spec.level == "mun"


def test_planner_llm_hallucinated_invalid_id_discarded(monkeypatch):
    """Verify LLM proposing non-existent unit_id with no mention in message is discarded."""
    import atalaya.chat.planner as planner_mod
    monkeypatch.setattr(llm, "is_enabled", lambda: True)

    orig_plan_rules = planner_mod._plan_rules
    def _mock_plan_rules(msg, history=None, region_id=None):
        spec, _, hint = orig_plan_rules(msg, history=history, region_id=region_id)
        return spec, False, hint

    monkeypatch.setattr(planner_mod, "_plan_rules", _mock_plan_rules)

    fake_spec = QuerySpec(
        intent="lookup",
        level="mun",
        metric="risk_score",
        unit_ids=["99999"],
    )
    monkeypatch.setattr(llm, "chat_json", lambda *a, **kw: fake_spec)

    spec, method = planner_mod.plan("consulta general de riesgo")
    assert method == "llm"
    assert spec.unit_ids == []


def test_planner_system_prompt_out_of_scope_rule():
    """Verify system prompt of planner LLM instructs intent='out_of_scope' for code or general assistance."""
    from atalaya.chat.planner import _build_llm_system_prompt
    prompt = _build_llm_system_prompt()
    assert "Si la pregunta pide código, asistencia general o temas ajenos, intent='out_of_scope'" in prompt


def test_planner_user_query_fenced(monkeypatch):
    """Verify user query sent to LLM planner is fenced with <<<PREGUNTA_USUARIO>>> delimiters."""
    import atalaya.chat.planner as planner_mod
    monkeypatch.setattr(llm, "is_enabled", lambda: True)

    orig_plan_rules = planner_mod._plan_rules
    def _mock_plan_rules(msg, history=None, region_id=None):
        spec, _, hint = orig_plan_rules(msg, history=history, region_id=region_id)
        return spec, False, hint

    monkeypatch.setattr(planner_mod, "_plan_rules", _mock_plan_rules)

    captured_messages = []
    def _mock_chat_json(messages, **kwargs):
        captured_messages.extend(messages)
        return QuerySpec(intent="catalog", metric="risk_score")

    monkeypatch.setattr(llm, "chat_json", _mock_chat_json)

    planner_mod.plan("consulta ambigua no resuelta por reglas")
    user_msgs = [m for m in captured_messages if m.get("role") == "user"]
    assert len(user_msgs) == 1
    assert "<<<PREGUNTA_USUARIO>>>\nconsulta ambigua no resuelta por reglas\n<<<FIN_PREGUNTA_USUARIO>>>" in user_msgs[0]["content"]


def test_planner_greetings_and_help():
    """Verify 'hola' and 'gracias' resolve directly to intent='help' with rules method and no LLM."""
    for phrase in ["hola", "buenos días", "gracias", "muchas gracias", "gracias por la información"]:
        spec, method = plan(phrase)
        assert method == "rules"
        assert spec.intent == "help"


def test_planner_privacy_queries():
    """Verify privacy questions resolve to intent='help' with filters.topic='privacidad'."""
    for phrase in ["¿usan datos personales?", "¿cómo protegen la privacidad?", "privacidad"]:
        spec, method = plan(phrase)
        assert method == "rules"
        assert spec.intent == "help"
        assert spec.filters.get("topic") == "privacidad"


def test_planner_app_orientation_queries():
    """Verify app orientation questions resolve to intent='help'."""
    for phrase in ["¿qué es ATALAYA?", "¿de dónde salen los datos?", "¿qué puedes hacer?"]:
        spec, method = plan(phrase)
        assert method == "rules"
        assert spec.intent == "help"


def test_planner_llm_out_of_scope_domain_override(monkeypatch):
    """When LLM returns out_of_scope for a question with domain signals ('participación en Jalisco 2021'), rules plan is used."""
    import atalaya.chat.planner as planner_mod
    monkeypatch.setattr(llm, "is_enabled", lambda: True)

    orig_plan_rules = planner_mod._plan_rules
    def _mock_plan_rules(msg, history=None, region_id=None):
        spec, _, hint = orig_plan_rules(msg, history=history, region_id=region_id)
        # Force low confidence to trigger LLM path
        return spec, False, hint

    monkeypatch.setattr(planner_mod, "_plan_rules", _mock_plan_rules)

    # LLM proposes out_of_scope
    monkeypatch.setattr(llm, "chat_json", lambda *a, **kw: QuerySpec(intent="out_of_scope"))

    spec, method = planner_mod.plan("¿Cuál fue la participación en Jalisco en 2021?")
    # Must override LLM out_of_scope and use rules plan
    assert method == "rules"
    assert spec.intent != "out_of_scope"
    assert spec.intent == "lookup"
    assert "14" in spec.unit_ids or spec.filters.get("cve_ent") == "14"




