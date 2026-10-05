"""Planner module: converts user queries into structured QuerySpec using rules first, with LLM fallback."""

from __future__ import annotations

import logging
import re
from typing import Any

import pandas as pd

from atalaya.chat.spec import CORE_CATALOG_KEYS, QuerySpec, get_catalog_keys
from atalaya.config import SEED_DIR
from atalaya.ingest.common import norm_name, zpad
from atalaya import llm

# Ensure W4-A final metric keys are recognized by QuerySpec validator
CORE_CATALOG_KEYS.update({"prioridad", "abstencion_esperada", "vulnerability_pp"})
get_catalog_keys.cache_clear()

logger = logging.getLogger(__name__)

# State aliases dictionary: maps normalized alias -> cve_ent (2 digits)
_STATE_MAP: dict[str, str] = {}
_STATE_NAMES: dict[str, str] = {}


class PlanResult(tuple):
    """Result of query planning: (spec, method) tuple with optional followup_hint attribute."""

    def __new__(cls, spec: QuerySpec, method: str, followup_hint: str | None = None):
        instance = super().__new__(cls, (spec, method))
        instance.spec = spec
        instance.method = method
        instance.followup_hint = followup_hint
        return instance


def _extract_metric_candidate(text: str, target_future: bool = False) -> str | None:
    """Extract candidate catalog metric key from text snippet."""
    t = text.lower()
    if re.search(r"priorizar|prioridad|priorizaci[oó]n", t):
        return "prioridad"
    if re.search(r"abstencionistas?\s+esperad[oa]s?|abstenci[oó]n\s+esperada", t):
        return "abstencion_esperada"
    if re.search(r"vulnerabilidad(?:\s+estructural)?", t):
        return "vulnerability_pp"
    if re.search(r"riesgo|sem[aá]foro", t):
        return "risk_score"
    if re.search(r"brecha\s+(?:de\s+)?participaci[oó]n\s+juvenil", t):
        return "gap_youth_pp"
    if re.search(r"brecha\s+(?:de\s+)?g[eé]nero|mujeres\s+(?:vs\.?|contra|y|frente\s+a)\s+hombres|hombres\s+(?:vs\.?|contra|y|frente\s+a)\s+mujeres", t):
        return "gap_sexo_pp"
    if re.search(r"participaci[oó]n\s+(?:de\s+)?j[oó]venes|participaci[oó]n\s+juvenil|voto\s+juvenil", t):
        return "part_18_34"
    if re.search(r"elecci[oó]n\s+judicial|poder\s+judicial|judicial\s+2025", t):
        return "part_pj_2025"
    if re.search(r"abstenci[oó]n", t):
        return "pred_abstention" if target_future else "abstencion"
    if re.search(r"j[oó]venes\s+en\s+la\s+lista|lista\s+nominal\s+18|18\s+a\s+34", t):
        return "pct_ln_18_34"
    if re.search(r"j[oó]venes|juventud|18\s+a\s+24|voto\s+joven", t):
        return "pct_18_24"
    if re.search(r"adultos\s+mayores|65\s+y\s+m[aá]s", t):
        return "pct_65ymas"
    if re.search(r"escolaridad|educaci[oó]n|estudios|graproes", t):
        return "graproes"
    if re.search(r"ind[ií]gena|lengua\s+ind[ií]gena|hli", t):
        return "pct_hli"
    if re.search(r"salud|servicios\s+de\s+salud|sin\s+seguro", t):
        return "pct_sin_servsalud"
    if re.search(r"internet|conectividad", t):
        return "pct_internet"
    if re.search(r"marginaci[oó]n", t):
        return "im_2020"
    if re.search(r"rural|campo", t):
        return "pct_rural"
    if re.search(r"analfabeta|analfabetismo", t):
        return "pct_analfabeta"
    if re.search(r"ingresos\s+bajos|salarios\s+m[ií]nimos", t):
        return "pct_po2sm"
    if re.search(r"participaci[oó]n", t):
        return "pred_participation" if target_future else "participacion"
    if re.search(r"lista\s+nominal|padr[oó]n", t):
        return "lista_nominal"
    if re.search(r"votos\s+totales", t):
        return "votos_totales"
    if re.search(r"poblaci[oó]n\s+total|habitantes", t):
        return "pob_tot"
    if re.search(r"poblaci[oó]n\s+de\s+18|poblaci[oó]n\s+18|edad\s+de\s+votar", t):
        return "pob_18ymas"
    return None


def _init_states() -> None:
    """Load states.csv once to initialize entity name and alias mappings."""
    global _STATE_MAP, _STATE_NAMES
    if _STATE_MAP:
        return

    states_path = SEED_DIR / "states.csv"
    if not states_path.is_file():
        return

    try:
        df = pd.read_csv(states_path, dtype=str)
        for _, row in df.iterrows():
            cve = zpad(row.get("cve_ent", ""), 2)
            name = str(row.get("name", "")).strip()
            _STATE_NAMES[cve] = name
            
            # Map canonical name
            _STATE_MAP[norm_name(name)] = cve
            
            # Map ISO
            if pd.notna(row.get("iso")):
                _STATE_MAP[norm_name(row["iso"])] = cve
                
            # Map aliases
            if pd.notna(row.get("aliases")):
                for alias in str(row["aliases"]).split("|"):
                    a_clean = norm_name(alias)
                    if a_clean:
                        _STATE_MAP[a_clean] = cve
    except Exception as e:
        logger.warning("Error reading states.csv in planner: %s", e)


_init_states()


def _find_states_in_text(text: str) -> list[str]:
    """Find state cve_ent identifiers mentioned in normalized text."""
    _init_states()
    t_norm = norm_name(text)
    if not t_norm:
        return []

    found = []
    # Sort aliases by length descending so multi-word aliases match before substrings
    sorted_aliases = sorted(_STATE_MAP.keys(), key=len, reverse=True)
    
    # Avoid bare 'MEXICO' matching when it could mean the country, unless 'EDOMEX' or 'ESTADO DE MEXICO'
    for alias in sorted_aliases:
        if alias == "MEXICO":
            # Only match MEXICO if preceded by ESTADO DE
            continue
        pattern = r"\b" + re.escape(alias) + r"\b"
        if re.search(pattern, t_norm):
            cve = _STATE_MAP[alias]
            if cve not in found:
                found.append(cve)

    return found


def _build_llm_system_prompt() -> str:
    """Construct system prompt for LLM query planning."""
    _init_states()
    states_list = ", ".join(f"{cve}: {_STATE_NAMES.get(cve, cve)}" for cve in sorted(_STATE_NAMES.keys()))
    
    return (
        "Eres el planificador estructurado de consultas de ATALAYA, plataforma de analítica sobre "
        "participación ciudadana y riesgo de abstención electoral en México (INE).\n"
        "Tu tarea es convertir la pregunta del usuario en un objeto JSON `QuerySpec`.\n"
        "REGLAS OBLIGATORIAS:\n"
        "1. No respondas la pregunta ni des explicaciones, SOLO genera la especificación JSON `QuerySpec`.\n"
        "2. Usa ÚNICAMENTE claves de métricas válidas del catálogo: participacion, abstencion, lista_nominal, "
        "votos_totales, pred_abstention, risk_score, category, trend_pp, pob_tot, pob_18ymas, pct_18_24, "
        "pct_65ymas, graproes, pct_hli, pct_sin_servsalud, pct_internet, pct_rural, pct_analfabeta, "
        "pct_po2sm, im_2020, gm_2020, pct_ln_18_34, part_18_34, gap_youth_pp, gap_sexo_pp, pct_ln_rural, ns_rate, part_pj_2025, "
        "prioridad, abstencion_esperada, vulnerability_pp "
        "(o columnas anchas part_dip_<año>/abst_dip_<año>).\n"
        "3. Claves de entidad (cve_ent):\n"
        f"{states_list}\n"
        "4. Intents permitidos: ranking, lookup, compare, correlation, trend, scenario, explain_unit, "
        "catalog, help, out_of_scope, profile.\n"
        "5. Si la pregunta está fuera de los temas de participación electoral o sociodemografía de ATALAYA, "
        "asigna intent='out_of_scope'.\n"
        "6. La elección por defecto es DIP_FED. Si preguntan por 2027 o el futuro, usa pred_abstention o risk_score."
    )


def _plan_rules(
    message: str,
    history: list[dict] | None = None,
    region_id: str | None = None,
) -> tuple[QuerySpec, bool, str | None]:
    """Execute rule-based planning.
    
    Returns (spec, high_confidence, followup_hint).
    """
    _init_states()
    text_lower = message.lower()

    # 1. Check Year
    year_match = re.findall(r"\b(19\d{2}|20\d{2})\b", message)
    target_future = bool(re.search(r"\b(2027|futuro|pr[oó]xima|pron[oó]stico)\b", text_lower))
    explicit_year: int | None = None
    if year_match:
        for y_str in year_match:
            y = int(y_str)
            if y == 2027:
                target_future = True
            elif y in (2009, 2012, 2015, 2018, 2021, 2024, 2025):
                explicit_year = y

    is_judicial = bool(re.search(r"\bjudicial\b|\bpoder\s+judicial\b", text_lower))
    if is_judicial or explicit_year == 2025:
        election = "PJF"
        if explicit_year is None:
            explicit_year = 2025
    else:
        election = "DIP_FED"

    followup_hint: str | None = None

    # Check for multipart questions joined by " y " with two distinct metrics
    # e.g. "¿Cuántos jóvenes hay en Nuevo León y cómo ha evolucionado su participación?"
    split_pattern = r"(?<!18)(?<!65)\s+[ye]\s+(?:¿)?(?!(?:m[aá]s|naranjas?)\b)"
    parts = re.split(split_pattern, message, maxsplit=1, flags=re.IGNORECASE)
    if len(parts) == 2:
        m1 = _extract_metric_candidate(parts[0], target_future)
        m2 = _extract_metric_candidate(parts[1], target_future)
        if m1 and m2 and m1 != m2:
            followup_hint = "Puedo responder la otra parte si la preguntas por separado."
            st_list = _find_states_in_text(message)
            mentions_mun_first = bool(re.search(r"\bmunicipio(?:s)?\b|\balcald[ií]a(?:s)?\b", message.lower()))
            
            lvl = "mun" if mentions_mun_first else "state"
            u_ids = [st_list[0]] if st_list else ([region_id] if region_id else [])
            flts = {"cve_ent": st_list[0]} if st_list else {}

            spec = QuerySpec(
                intent="lookup",
                level=lvl,  # type: ignore
                metric=m1,
                filters=flts,
                year=explicit_year,
                election=election,
                order="desc",
                limit=10,
                unit_ids=u_ids,
            )
            object.__setattr__(spec, "followup_hint", followup_hint)
            return spec, True, followup_hint

    # 2. Check Places (states)
    states = _find_states_in_text(message)
    mentions_mun = bool(re.search(r"\bmunicipio(?:s)?\b|\balcald[ií]a(?:s)?\b", text_lower))
    mentions_state = bool(re.search(r"\bestado(?:s)?\b|\bentidad(?:es)?\b", text_lower))

    # 3. Intent detection
    intent: str | None = None
    explicit_intent_found = False
    metric: str | None = None
    explicit_metric_found = False

    if re.search(r"qu[eé]\s+pasa\s+si|escenario|intervenci[oó]n|si\s+hacemos|pesimista|simula(?:r)?", text_lower):
        intent = "scenario"
        explicit_intent_found = True
    elif re.search(r"d[oó]nde\s+(?:conviene\s+)?priorizar|priorizar\s+(?:los\s+)?recursos|prioridad\s+de\s+recursos|mayor\s+prioridad", text_lower):
        intent = "ranking"
        metric = "prioridad"
        explicit_intent_found = True
        explicit_metric_found = True
    elif re.search(r"abstencionistas?\s+esperad[oa]s?|m[aá]s\s+abstencionistas|mayor\s+abstenci[oó]n\s+esperada", text_lower):
        intent = "ranking"
        metric = "abstencion_esperada"
        explicit_intent_found = True
        explicit_metric_found = True
    elif re.search(r"por\s+qu[eé]|factores|recomendaci[oó]n|recomendaciones|qu[eé]\s+recomiendas?", text_lower):
        intent = "explain_unit"
        explicit_intent_found = True
    elif re.search(r"por\s+edad|grupos?\s+de\s+edad|rangos?\s+de\s+edad|desglose\s+por\s+edad", text_lower):
        intent = "profile"
        explicit_intent_found = True
    elif re.search(r"relaci[oó]n|correlaci[oó]n|se\s+relaciona|influye|asociaci[oó]n|v[ií]nculo", text_lower):
        intent = "correlation"
        explicit_intent_found = True
    elif re.search(r"compara(?:r)?|versus|\bvs\.?\b|diferencia\s+entre", text_lower):
        intent = "compare"
        explicit_intent_found = True
    elif re.search(r"tendencia|evoluci[oó]n|hist[oó]rico|ha\s+cambiado|a\s+lo\s+largo\s+del\s+tiempo", text_lower):
        intent = "trend"
        explicit_intent_found = True
    elif re.search(r"qu[eé]\s+variables|qu[eé]\s+datos|fuentes|variables\s+disponibles|cat[aá]logo|diccionario", text_lower):
        intent = "catalog"
        explicit_intent_found = True
    elif re.search(r"ayuda|qu[eé]\s+puedes\s+hacer|instrucciones|c[oó]mo\s+funciona", text_lower):
        intent = "help"
        explicit_intent_found = True
    elif not re.search(r"\bcu[aá]nt[oa]s?\b", text_lower) and (
        re.search(r"(?<!\by\s)(?<!\bo\s)\bm[aá]s\b|\bmayor\b|\bmenor\b|\btop\b|\bcu[aá]les\b|\branking\b|\bpeores\b|\bmejores\b|\bprimeros\b|\b[uú]ltimos\b", text_lower)
    ):
        intent = "ranking"
        explicit_intent_found = True

    # 4. Metric detection
    if not explicit_metric_found:
        metric = "risk_score" if target_future else "participacion"
    x_metric: str | None = None

    if not explicit_metric_found:
        if re.search(r"priorizar|prioridad|priorizaci[oó]n", text_lower):
            metric = "prioridad"
            explicit_metric_found = True
        elif re.search(r"abstencionistas?\s+esperad[oa]s?|abstenci[oó]n\s+esperada", text_lower):
            metric = "abstencion_esperada"
            explicit_metric_found = True
        elif re.search(r"vulnerabilidad(?:\s+estructural)?", text_lower):
            metric = "vulnerability_pp"
            explicit_metric_found = True
        elif re.search(r"brecha\s+(?:de\s+)?participaci[oó]n\s+juvenil", text_lower):
            metric = "gap_youth_pp"
            explicit_metric_found = True
        elif re.search(r"brecha\s+(?:de\s+)?g[eé]nero|mujeres\s+(?:vs\.?|contra|y|frente\s+a)\s+hombres|hombres\s+(?:vs\.?|contra|y|frente\s+a)\s+mujeres", text_lower):
            metric = "gap_sexo_pp"
            explicit_metric_found = True
        elif re.search(r"participaci[oó]n\s+(?:de\s+)?j[oó]venes|participaci[oó]n\s+juvenil|voto\s+juvenil", text_lower):
            metric = "part_18_34"
            explicit_metric_found = True
        elif re.search(r"elecci[oó]n\s+judicial|poder\s+judicial|judicial\s+2025", text_lower):
            metric = "part_pj_2025"
            explicit_metric_found = True
        elif re.search(r"riesgo|sem[aá]foro", text_lower):
            metric = "risk_score"
            explicit_metric_found = True
        elif re.search(r"abstenci[oó]n", text_lower):
            metric = "pred_abstention" if target_future else "abstencion"
            explicit_metric_found = True
        elif re.search(r"participaci[oó]n", text_lower):
            metric = "pred_participation" if target_future else "participacion"
            explicit_metric_found = True
        elif re.search(r"j[oó]venes|juventud|18\s+a\s+24|voto\s+joven", text_lower):
            metric = "pct_18_24"
            explicit_metric_found = True
        elif re.search(r"adultos\s+mayores|65\s+y\s+m[aá]s", text_lower):
            metric = "pct_65ymas"
            explicit_metric_found = True
        elif re.search(r"escolaridad|educaci[oó]n|estudios|graproes", text_lower):
            metric = "graproes"
            explicit_metric_found = True
        elif re.search(r"ind[ií]gena|lengua\s+ind[ií]gena|hli", text_lower):
            metric = "pct_hli"
            explicit_metric_found = True
        elif re.search(r"salud|servicios\s+de\s+salud|sin\s+seguro", text_lower):
            metric = "pct_sin_servsalud"
            explicit_metric_found = True
        elif re.search(r"internet|conectividad", text_lower):
            metric = "pct_internet"
            explicit_metric_found = True
        elif re.search(r"marginaci[oó]n", text_lower):
            metric = "im_2020"
            explicit_metric_found = True
        elif re.search(r"rural|campo", text_lower):
            metric = "pct_rural"
            explicit_metric_found = True
        elif re.search(r"analfabeta|analfabetismo", text_lower):
            metric = "pct_analfabeta"
            explicit_metric_found = True
        elif re.search(r"ingresos\s+bajos|salarios\s+m[ií]nimos", text_lower):
            metric = "pct_po2sm"
            explicit_metric_found = True
        elif re.search(r"lista\s+nominal|padr[oó]n", text_lower):
            metric = "lista_nominal"
            explicit_metric_found = True
        elif re.search(r"votos\s+totales", text_lower):
            metric = "votos_totales"
            explicit_metric_found = True
        elif re.search(r"poblaci[oó]n\s+total|habitantes", text_lower):
            metric = "pob_tot"
            explicit_metric_found = True
        elif re.search(r"poblaci[oó]n\s+de\s+18|poblaci[oó]n\s+18|edad\s+de\s+votar", text_lower):
            metric = "pob_18ymas"
            explicit_metric_found = True

    # Specific handling for correlation intent
    if intent == "correlation":
        primary = "abstencion" if "abstenci" in text_lower else "participacion"
        secondary = None
        if re.search(r"escolaridad|educaci[oó]n|estudios", text_lower):
            secondary = "graproes"
        elif re.search(r"ind[ií]gena|lengua", text_lower):
            secondary = "pct_hli"
        elif re.search(r"marginaci[oó]n", text_lower):
            secondary = "im_2020"
        elif re.search(r"internet|conectividad", text_lower):
            secondary = "pct_internet"
        elif re.search(r"j[oó]venes|juventud", text_lower):
            secondary = "pct_18_24"
        elif re.search(r"rural", text_lower):
            secondary = "pct_rural"
        elif re.search(r"analfabeta|analfabetismo", text_lower):
            secondary = "pct_analfabeta"
        elif re.search(r"ingresos\s+bajos|salarios", text_lower):
            secondary = "pct_po2sm"

        metric = primary
        x_metric = secondary or "im_2020"

    # 5. History resolution for follow-ups (e.g. "¿y en Oaxaca?")
    if not explicit_intent_found and history:
        if re.search(r"^\s*¿?\s*y\s+en\b", text_lower) or (states and len(text_lower.split()) <= 5):
            for turn in reversed(history):
                if turn.get("role") == "user":
                    prev_text = turn.get("content", "")
                    prev_spec, _, _ = _plan_rules(prev_text, history=None, region_id=region_id)
                    intent = prev_spec.intent
                    metric = prev_spec.metric
                    explicit_year = prev_spec.year
                    explicit_intent_found = True
                    explicit_metric_found = True
                    break

    if not intent:
        intent = "lookup"

    # 6. Level & Units / Filters
    level: str = "mun"
    filters: dict[str, Any] = {}
    unit_ids: list[str] = []

    if intent == "compare":
        if len(states) >= 2:
            level = "state"
            unit_ids = states[:2]
        elif states:
            level = "state"
            unit_ids = [states[0]]
            if region_id and region_id != states[0]:
                unit_ids.append(region_id)
    elif intent == "ranking":
        if mentions_state or (states and not mentions_mun):
            if mentions_state:
                level = "state"
            else:
                level = "mun"
                filters["cve_ent"] = states[0]
        elif states:
            level = "mun"
            filters["cve_ent"] = states[0]
        else:
            level = "mun"
    elif intent in ("explain_unit", "lookup", "trend", "profile"):
        use_region = (
            region_id is not None
            and (
                bool(re.search(r"aqu[ií]|este\s+municipio|este\s+estado|esta\s+zona|seleccionad[oa]", text_lower))
                or not states
            )
        )
        if use_region and region_id:
            if len(region_id) == 5:
                level = "mun"
                unit_ids = [region_id]
            else:
                level = "state"
                unit_ids = [region_id]
        elif states:
            if mentions_mun:
                level = "mun"
                filters["cve_ent"] = states[0]
            else:
                level = "state"
                unit_ids = [states[0]]
                filters["cve_ent"] = states[0]
    elif intent == "correlation":
        level = "mun"
        if states:
            filters["cve_ent"] = states[0]
    elif intent == "scenario":
        if states:
            filters["cve_ent"] = states[0]

    # 7. Scenario parameters
    scenario_name: str | None = None
    scenario_params: dict[str, Any] = {}
    if intent == "scenario":
        if "pesimista" in text_lower:
            scenario_name = "pesimista"
        else:
            scenario_name = "intervencion"

        lever = "campana_general"
        if re.search(r"j[oó]venes|juventud|juvenil", text_lower):
            lever = "promocion_jovenes"
        elif re.search(r"casillas|rural", text_lower):
            lever = "casillas_rurales"
        elif re.search(r"ind[ií]gena|lengua", text_lower):
            lever = "materiales_lengua_indigena"

        targeting = "todos"
        if re.search(r"zonas?\s+rojas?\s+y\s+naranjas?", text_lower):
            targeting = "rojo_naranja"
        elif re.search(r"zonas?\s+rojas?|rojo", text_lower):
            targeting = "rojo"

        effect_pp = 2.0
        eff_match = re.search(r"(\d+(?:\.\d+)?)\s*(?:pp|puntos|pto)", text_lower)
        if eff_match:
            try:
                effect_pp = float(eff_match.group(1))
            except ValueError:
                pass

        scenario_params = {
            "lever": lever,
            "targeting": targeting,
            "effect_pp": effect_pp,
        }

    # 8. Limit and Order
    limit = 10
    limit_match = re.search(r"(?:top|primeros|[uú]ltimos|\b)\s*(\d{1,2})\s*(?:municipios|estados|entidades|zonas|\b)", text_lower)
    if limit_match:
        try:
            val = int(limit_match.group(1))
            if 1 <= val <= 50:
                limit = val
        except ValueError:
            pass

    order: str = "desc"
    if metric == "prioridad":
        order = "asc"
    elif re.search(r"menor|m[aá]s\s+baja?|peores|bajo", text_lower):
        order = "asc"

    # Evaluate confidence
    high_confidence = True
    if not explicit_intent_found and not states and not unit_ids and not region_id:
        high_confidence = False
    elif intent == "lookup" and not explicit_intent_found and not states and not unit_ids and not region_id:
        high_confidence = False
    elif intent == "correlation" and not x_metric:
        high_confidence = False
    elif intent in ("explain_unit", "trend") and not unit_ids and not filters:
        high_confidence = False

    if election == "PJF" and metric in ("participacion", "pred_participation"):
        metric = "part_pj_2025"

    spec = QuerySpec(
        intent=intent,  # type: ignore
        level=level,  # type: ignore
        metric=metric,
        x_metric=x_metric,
        filters=filters,
        year=explicit_year,
        election=election,
        order=order,  # type: ignore
        limit=limit,
        unit_ids=unit_ids,
        scenario=scenario_name,
        scenario_params=scenario_params,
    )

    object.__setattr__(spec, "followup_hint", followup_hint)
    return spec, high_confidence, followup_hint


def plan(
    message: str,
    history: list[dict] | None = None,
    region_id: str | None = None,
) -> PlanResult:
    """Plan query specification from user message.
    
    Tries rules first. Uses LLM if rules confidence is low and LLM is enabled.
    Returns PlanResult (spec, method) with optional followup_hint attribute.
    """
    spec_rules, high_conf, followup_hint = _plan_rules(message, history=history, region_id=region_id)

    if high_conf or not llm.is_enabled():
        return PlanResult(spec_rules, "rules", followup_hint=followup_hint)

    # Call LLM for planning
    try:
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": _build_llm_system_prompt()}
        ]
        
        # Include up to last 4 turns of history
        if history:
            for turn in history[-4:]:
                messages.append({"role": turn.get("role", "user"), "content": turn.get("content", "")})
                
        user_msg = message
        if region_id:
            user_msg = f"{user_msg}\n[Contexto UI: region_id='{region_id}']"
        messages.append({"role": "user", "content": user_msg})

        llm_spec = llm.chat_json(
            messages,
            schema=QuerySpec,
            max_tokens=400,
            timeout_s=30.0,
            temperature=0.0,
        )
        object.__setattr__(llm_spec, "followup_hint", followup_hint)
        return PlanResult(llm_spec, "llm", followup_hint=followup_hint)
    except (llm.LLMBlocked, llm.LLMError, Exception) as err:
        logger.warning("LLM planning failed (%s: %s). Falling back to rules.", err.__class__.__name__, err)
        return PlanResult(spec_rules, "rules", followup_hint=followup_hint)
