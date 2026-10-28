"""Atalaya Electoral · Diapositivas del plan de campaña y exportación PPTX y PDF."""

from __future__ import annotations

import base64
import html
import json
import logging
import math
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unicodedata
from typing import Any

from jinja2 import Environment, FileSystemLoader
import pandas as pd
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN
from pptx.util import Inches, Pt

from atalaya.config import REPO_DIR
from atalaya.intel.schemas import CampaignPlan, Slide, SlideKind
from atalaya.intel.storage import exports_dir
from atalaya.report.charts import CATEGORY_COLORS, find_browser, html_to_pdf

logger = logging.getLogger(__name__)

TEMPLATES_DIR = Path(__file__).resolve().parent / "templates"
ASSETS_DIR = REPO_DIR / "backend" / "atalaya" / "report" / "assets"
GEO_DIR = REPO_DIR / "frontend" / "public" / "geo"

# Brand colors
COLOR_MAGENTA_HEX = "#b5186b"
COLOR_TINTA_HEX = "#4a2a48"
COLOR_MAGENTA_RGB = RGBColor(0xB5, 0x18, 0x6B)
COLOR_TINTA_RGB = RGBColor(0x4A, 0x2A, 0x48)
COLOR_DARK_RGB = RGBColor(0x2E, 0x24, 0x30)
COLOR_MUTED_RGB = RGBColor(0x72, 0x63, 0x74)
COLOR_LIGHT_BG_RGB = RGBColor(0xFA, 0xF8, 0xFA)
COLOR_WHITE_RGB = RGBColor(0xFF, 0xFF, 0xFF)

SLIDE_KINDS_ORDER: list[SlideKind] = [
    "portada",
    "diagnostico_datos",
    "problematicas",
    "region",
    "grupo_objetivo",
    "propuestas",
    "impacto",
    "implementacion",
    "riesgos_kpis",
    "fuentes",
]

LEVER_LABELS: dict[str, str] = {
    "promocion_jovenes": "Promoción del voto joven",
    "casillas_rurales": "Casillas y traslado en zonas rurales",
    "materiales_lengua_indigena": "Materiales y capacitación en lenguas indígenas",
    "campana_general": "Campaña general de promoción del voto",
}


def get_lever_label(lever: str) -> str:
    """Returns canonical institutional label for a lever from SCENARIOS."""
    if lever in LEVER_LABELS:
        return LEVER_LABELS[lever]
    try:
        from atalaya.model.scenarios import SCENARIOS
        for sc in SCENARIOS:
            for p in sc.get("params", []):
                if p.get("key") == "lever":
                    for opt in p.get("options", []):
                        if opt.get("value") == lever:
                            return opt.get("label", lever)
    except Exception:
        pass
    return lever.replace("_", " ").capitalize()


def get_level_readable(level: str) -> str:
    """Returns natural Spanish label for level: 'Municipio' / 'Estado'."""
    lvl = (level or "").lower().strip()
    if lvl in ("mun", "municipio", "municipal"):
        return "Municipio"
    if lvl in ("state", "estado", "estatal"):
        return "Estado"
    return level.capitalize()


# ---------------------------------------------------------------- formatting helpers

def fmt_int(val: Any) -> str:
    """Formats an integer with commas in Spanish (Mexico): 1,234,567."""
    if val is None:
        return "N/D"
    try:
        return f"{int(round(float(val))):,}"
    except (ValueError, TypeError):
        return "N/D"


def fmt_pct(val: Any, is_fraction: bool = True) -> str:
    """Formats a percentage with one decimal and trailing space: 48.2 %."""
    if val is None:
        return "N/D"
    try:
        v = float(val)
        if is_fraction and abs(v) <= 1.0:
            v *= 100.0
        return f"{v:.1f} %"
    except (ValueError, TypeError):
        return "N/D"


def fmt_pp(val: Any) -> str:
    """Formats percentage points with minus sign and pp: −1.3 pp / +0.8 pp."""
    if val is None:
        return "N/D"
    try:
        v = float(val)
        sign = "−" if v < 0 else ("+" if v > 0 else "")
        return f"{sign}{abs(v):.1f} pp"
    except (ValueError, TypeError):
        return "N/D"


def truncate_bullet(text: str, max_chars: int = 160) -> str:
    """Ensures a bullet does not exceed max_chars, truncating at word boundary with '…'."""
    text = " ".join(text.strip().split())
    if len(text) <= max_chars:
        return text
    cutoff = max_chars - 1
    idx = text.rfind(" ", 0, cutoff)
    if idx > 0:
        return text[:idx].rstrip() + "…"
    return text[:cutoff] + "…"


def slugify(text: str) -> str:
    """Converts a string to a clean ASCII slug without accents or spaces: 'Tuxtla Gutiérrez' -> 'tuxtla-gutierrez'."""
    norm = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    norm = re.sub(r"[^\w\s-]", "", norm).strip().lower()
    return re.sub(r"[-\s]+", "-", norm)


def export_filename(plan: CampaignPlan, fmt: str) -> str:
    """Builds filename: AtalayaElectoral_PlanCampana_<slug-unidad>_<AAAAMMDD>.<fmt>"""
    unit_slug = slugify(plan.unit.name) or "unidad"
    date_digits = re.sub(r"\D", "", plan.generated_at)[:8]
    if len(date_digits) < 8:
        date_digits = "20270606"
    clean_fmt = fmt.lstrip(".")
    return f"AtalayaElectoral_PlanCampana_{unit_slug}_{date_digits}.{clean_fmt}"


# ---------------------------------------------------------------- 1. build_slides

def build_slides(plan: CampaignPlan, reduced: bool = False) -> list[Slide]:
    """Builds the 10 deterministic slides for the campaign plan (§6.4).

    When reduced=True, cuts text budgets to 70% and limits step actions to 1 to guarantee 0 overflow.
    """
    factor = 0.7 if reduced else 1.0

    def rcut(text: str, max_chars: int) -> str:
        return truncate_bullet(text, max(10, int(round(max_chars * factor))))

    slides: list[Slide] = []
    unit = plan.unit
    date_short = plan.generated_at[:10] if plan.generated_at else ""
    level_readable = get_level_readable(unit.level)

    # Sl 1: portada
    p_bullets = [
        "Borrador generado con IA — propuesta del equipo OXENT",
        f"Unidad territorial: {unit.name} ({unit.ent_name}) · {level_readable}",
        f"Lista nominal: {fmt_int(unit.lista_nominal)} electores",
        f"Abstención estimada: {fmt_pct(unit.pred_abstention)} (Riesgo {unit.category.capitalize()})",
    ]
    if plan.focus:
        p_bullets.append(f"Enfoque prioritario: {plan.focus}")
    if date_short:
        p_bullets.append(f"Fecha de corte del análisis: {date_short}")

    portada_sub = (
        f"{unit.name}, {unit.ent_name} · {level_readable} · Enfoque: {plan.focus}"
        if plan.focus
        else f"{unit.name}, {unit.ent_name} · {level_readable}"
    )

    slides.append(
        Slide(
            id="sl1",
            kind="portada",
            title=f"Plan de Campaña Cívica: {unit.name}",
            subtitle=portada_sub,
            bullets=[rcut(b, 160) for b in p_bullets[:6]],
            notes=(
                f"Presentación ejecutiva del plan de campaña cívica focalizada para {unit.name}, {unit.ent_name}. "
                "El documento articula el modelo predictivo de participación electoral de Atalaya con evidencia documental "
                "verificada y simulaciones deterministas de impacto. Constituye un borrador de trabajo institucional "
                "orientado a la toma de decisiones del personal directivo del INE."
            ),
            data={
                "unit_id": unit.unit_id,
                "unit_name": unit.name,
                "ent_name": unit.ent_name,
                "level_readable": level_readable,
                "focus": plan.focus,
                "generated_at": plan.generated_at,
            },
        )
    )

    # Sl 2: diagnostico_datos
    intervalo = (
        f"[{fmt_pct(unit.pred_low)} - {fmt_pct(unit.pred_high)}]"
        if unit.pred_low is not None and unit.pred_high is not None
        else "N/D"
    )
    brecha_jov = (
        fmt_pp(unit.gap_youth_pp_last)
        if unit.gap_youth_pp_last is not None
        else (fmt_pct(unit.part_18_34_last) if unit.part_18_34_last is not None else "N/D")
    )
    kpis_data = [
        {"label": "Abstención pronosticada", "value": fmt_pct(unit.pred_abstention), "sub": f"Intervalo {intervalo}"},
        {"label": "Categoría de riesgo", "value": unit.category.capitalize(), "color": CATEGORY_COLORS.get(unit.category, "#bdbdbd")},
        {"label": "Tendencia histórica", "value": fmt_pp(unit.trend_pp), "sub": "Procesos federales recientes"},
        {"label": "Lista nominal", "value": f"{fmt_int(unit.lista_nominal)}", "sub": "Personas electoras"},
        {"label": "Abstención esperada", "value": f"{fmt_int(unit.abstencion_esperada)}", "sub": "Votos en riesgo"},
        {"label": "Brecha juvenil", "value": brecha_jov, "sub": "Diferencial en participación"},
    ]
    d_bullets = [
        f"Abstención estimada del {fmt_pct(unit.pred_abstention)} (intervalo {intervalo}), situando a la unidad en categoría {unit.category}.",
        f"Lista nominal de {fmt_int(unit.lista_nominal)} personas con un abstencionismo potencial de {fmt_int(unit.abstencion_esperada)} votos.",
        f"Tendencia de participación de {fmt_pp(unit.trend_pp)} respecto a elecciones federales anteriores.",
    ]
    if unit.drivers:
        d_bullets.append(f"Factores de vulnerabilidad: {', '.join(d.label for d in unit.drivers[:2])}.")
    if brecha_jov != "N/D":
        d_bullets.append(f"Brecha observada en el segmento juvenil de {brecha_jov} respecto al promedio territorial.")

    slides.append(
        Slide(
            id="sl2",
            kind="diagnostico_datos",
            title="Diagnóstico Electoral y Factores de Riesgo",
            subtitle="Línea base predictiva e indicadores demográficos de participación",
            bullets=[rcut(b, 160) for b in d_bullets[:6]],
            notes=(
                f"La línea base predictiva sitúa a {unit.name} en nivel de riesgo {unit.category}, proyectando una abstención "
                f"de {fmt_pct(unit.pred_abstention)} sobre una lista nominal de {fmt_int(unit.lista_nominal)} electores. "
                "Los principales factores determinantes señalan barreras estructurales que justifican una movilización cívica prioritaria."
            ),
            data={"kpis": kpis_data},
        )
    )

    # Sl 3: problematicas
    if plan.research.degraded:
        prob_title = "Problemáticas y Factores Asociados"
        prob_sub = "Factores asociados según el modelo (modo degradado)"
        prob_bullets = [
            "Investigación documental no disponible; se muestran los factores de riesgo predictivos del modelo Atalaya.",
        ]
        for d in unit.drivers[:4]:
            prob_bullets.append(f"Factor {d.label}: contribución estimada de {fmt_pp(d.contribution_pp)} a la abstención.")
        if unit.recommendations:
            prob_bullets.append(f"Línea de acción sugerida: {unit.recommendations[0]}.")
        prob_data = {
            "degraded": True,
            "findings": [
                {
                    "id": f"d{i+1}",
                    "title": rcut(d.label, 80),
                    "summary": rcut(f"Factor predictivo con aporte de {fmt_pp(d.contribution_pp)} a la abstención territorial.", 180),
                    "category": "condiciones_socioeconomicas",
                    "evidence": [],
                    "scope": "estado",
                }
                for i, d in enumerate(unit.drivers[:4])
            ],
        }
    else:
        prob_title = "Problemáticas y Barreras de Participación"
        prob_sub = "Causas documentadas en fuentes públicas verificadas"
        prob_bullets = []
        findings_processed = []
        for f in plan.research.findings[:6]:
            refs = f" [{', '.join(f.evidence)}]" if f.evidence else ""
            prob_bullets.append(f"{f.title}: {f.summary}{refs}")
            fd = f.model_dump()
            fd["title"] = rcut(f.title, 80)
            fd["summary"] = rcut(f.summary, 180)
            findings_processed.append(fd)
        if not prob_bullets:
            prob_bullets.append("No se detectaron problemáticas documentadas atípicas en las fuentes verificadas.")
        prob_data = {
            "degraded": False,
            "findings": findings_processed,
        }

    slides.append(
        Slide(
            id="sl3",
            kind="problematicas",
            title=prob_title,
            subtitle=prob_sub,
            bullets=[rcut(b, 160) for b in prob_bullets[:6]],
            notes=(
                "Las causas del abstencionismo local combinan factores sociodemográficos y barreras operativas de acceso. "
                "Cada problemática documentada fue contrastada contra fuentes verificables para fundamentar las intervenciones cívicas "
                "sin sesgos ni suposiciones no respaldadas."
            ),
            data=prob_data,
        )
    )

    # Sl 4: region
    svg_map = region_svg(plan)
    r_bullets = [
        f"Entidad federativa: {unit.ent_name} (clave {unit.ent}) · Ámbito {level_readable.lower()}.",
        f"Distribución demográfica: {fmt_pct(unit.pct_rural, is_fraction=False)} rural y {fmt_pct(unit.pct_internet, is_fraction=False)} cobertura internet.",
        f"Población hablante de lengua indígena (HLI): {fmt_pct(unit.pct_hli, is_fraction=False)}.",
    ]
    if unit.level == "state" and unit.municipios:
        r_bullets.append(f"Estructura municipal: {unit.municipios} municipios ({unit.municipios_rojos or 0} en riesgo crítico).")
    if unit.im_2020 is not None:
        r_bullets.append(f"Índice de marginación (CONAPO 2020): {unit.im_2020:.2f}.")

    slides.append(
        Slide(
            id="sl4",
            kind="region",
            title="Contexto Territorial y Distribución del Riesgo",
            subtitle=f"{level_readable}: {unit.name} ({unit.ent_name})",
            bullets=[rcut(b, 160) for b in r_bullets[:6]],
            notes=(
                f"El mapa territorial permite visualizar la distribución espacial del riesgo electoral en {unit.name}. "
                "La dispersión geográfica y el grado de conectividad determinan la viabilidad operativa de las rutas de difusión "
                "y la instalación de casillas especiales o extraordinarias."
            ),
            data={
                "unit_id": unit.unit_id,
                "ent": unit.ent,
                "level": unit.level,
                "svg": svg_map,
            },
        )
    )

    # Sl 5: grupo_objetivo
    tg_bullets = []
    tg_processed = []
    for tg in plan.target_groups[:5]:
        size_str = f" ({fmt_int(tg.size_estimate)} personas)" if tg.size_estimate else ""
        tg_bullets.append(f"{tg.name}{size_str}: {tg.description}")
        tg_d = tg.model_dump()
        tg_d["description"] = rcut(tg.description, 180)
        tg_processed.append(tg_d)
    if not tg_bullets:
        tg_bullets.append("Ciudadanía inscrita en la lista nominal con énfasis en jóvenes y zonas de baja concurrencia.")

    slides.append(
        Slide(
            id="sl5",
            kind="grupo_objetivo",
            title="Grupos Objetivo Prioritarios",
            subtitle="Población meta para las acciones de movilización y pedagogía electoral",
            bullets=[rcut(b, 160) for b in tg_bullets[:6]],
            notes=(
                "La focalización en segmentos específicos optimiza el despliegue territorial y la asignación de recursos cívicos. "
                "Los grupos objetivo reflejan las mayores brechas observadas en los datos del Censo y el historial de participación."
            ),
            data={"target_groups": tg_processed},
        )
    )

    # Sl 6: propuestas
    prop_bullets = []
    prop_processed = []
    for p in plan.proposals[:4]:
        lev_label = get_lever_label(p.lever)
        prop_bullets.append(f"{p.title} ({lev_label}): efecto proyectado {fmt_pp(-p.effect_pp if p.effect_pp > 0 else p.effect_pp)} con cobertura {p.coverage:.0f}%.")
        pd_item = p.model_dump()
        pd_item["lever_label"] = lev_label
        pd_item["title"] = rcut(p.title, 80)
        pd_item["description"] = rcut(p.description, 220)
        prop_processed.append(pd_item)
    if not prop_bullets:
        prop_bullets.append("Propuestas estructuradas en torno a las palancas oficiales de intervención del simulador.")

    slides.append(
        Slide(
            id="sl6",
            kind="propuestas",
            title="Propuestas de Intervención Cívica",
            subtitle="Estrategias focalizadas articuladas con las palancas institucionales del INE",
            bullets=[rcut(b, 160) for b in prop_bullets[:6]],
            notes=(
                "Cada propuesta está vinculada a una palanca de política pública del simulador y a una problemática documentada. "
                "Las metas de cobertura y efecto fueron calibradas en rangos conservadores para garantizar factibilidad técnica y presupuestal."
            ),
            data={"proposals": prop_processed},
        )
    )

    # Sl 7: impacto
    imp = plan.impact
    sum_votos_solo = sum((pi.votos_solo or 0) for pi in imp.per_proposal)
    per_prop_data = []
    for pi in imp.per_proposal:
        v_solo = pi.votos_solo or 0
        pct_solo = (v_solo / sum_votos_solo * 100.0) if sum_votos_solo > 0 else 0.0
        per_prop_data.append({
            "proposal_id": pi.proposal_id,
            "lever": pi.lever,
            "lever_label": get_lever_label(pi.lever),
            "votos_solo": v_solo,
            "votos_solo_str": f"+{fmt_int(v_solo)} votos",
            "pct_individual": f"{pct_solo:.1f} %",
        })

    imp_bullets = [
        f"Reducción estimada de abstención: {fmt_pp(imp.delta_pp)} (de {fmt_pct(imp.abstention_base)} a {fmt_pct(imp.abstention_scenario)}).",
        f"Votos adicionales proyectados: {fmt_int(imp.votos_adicionales)} electores movilizados a las urnas.",
        f"Evolución del semáforo de riesgo: de {imp.category_before.capitalize()} a {imp.category_after.capitalize()}.",
    ]
    if imp.municipios_mejoran:
        imp_bullets.append(f"Impacto territorial: {imp.municipios_mejoran} municipios mejoran su categoría de riesgo.")
    if imp.overlap_votos and imp.overlap_votos > 0:
        imp_bullets.append(f"Ajuste por rendimientos decrecientes y solapamiento: {fmt_int(imp.overlap_votos)} votos descontados.")

    slides.append(
        Slide(
            id="sl7",
            kind="impacto",
            title="Proyección de Impacto y Movilización",
            subtitle="Estimación determinista mediante el simulador de escenarios de Atalaya",
            bullets=[rcut(b, 160) for b in imp_bullets[:6]],
            notes=(
                f"La simulación estima una ganancia neta de {fmt_int(imp.votos_adicionales)} votos y una disminución "
                f"de {fmt_pp(imp.delta_pp)} en la abstención territorial. La modelación asume rendimientos decrecientes "
                "ante la combinación de palancas y debe interpretarse como escenario probabilístico condicionado a la ejecución."
            ),
            data={
                "before": fmt_pct(imp.abstention_base),
                "after": fmt_pct(imp.abstention_scenario),
                "delta_pp": fmt_pp(imp.delta_pp),
                "votos": fmt_int(imp.votos_adicionales),
                "category_before": imp.category_before,
                "category_after": imp.category_after,
                "overlap_votos": imp.overlap_votos,
                "overlap_votos_str": f"−{fmt_int(imp.overlap_votos)} votos" if imp.overlap_votos else "0 votos",
                "municipios_mejoran": imp.municipios_mejoran,
                "per_proposal": per_prop_data,
                "assumptions": imp.assumptions,
            },
        )
    )

    # Sl 8: implementacion
    step_bullets = []
    steps_processed = []
    max_acts = 1 if reduced else 2
    for s in plan.steps[:6]:
        clean_actions = [rcut(act, 90) for act in s.actions[:max_acts]]
        clean_resp = rcut(s.responsible, 110)
        clean_kpi = rcut(s.kpi, 110)
        clean_phase = rcut(s.phase, 55)

        step_bullets.append(f"Paso {s.order} ({s.start} a {s.end}): {clean_phase} — Resp: {clean_resp}. Meta: {clean_kpi}")
        steps_processed.append({
            "order": s.order,
            "phase": clean_phase,
            "start": s.start,
            "end": s.end,
            "actions": clean_actions,
            "responsible": clean_resp,
            "kpi": clean_kpi,
        })
    if not step_bullets:
        step_bullets.append("Calendario de implementación cronológico alineado al calendario electoral 2027.")

    slides.append(
        Slide(
            id="sl8",
            kind="implementacion",
            title="Ruta Crítica de Implementación",
            subtitle="Cronograma operativo de fases rumbo a la jornada electoral de 2027",
            bullets=[rcut(b, 160) for b in step_bullets[:6]],
            notes=(
                "La ruta crítica organiza las acciones operativas en fases secuenciales que concluyen antes del inicio de la veda electoral. "
                "Cada hito contempla un área responsable y una meta verificable para facilitar la fiscalización y auditoría del proceso."
            ),
            data={"steps": steps_processed},
        )
    )

    # Sl 9: riesgos_kpis
    rk_bullets = []
    risks_processed = []
    for r in plan.risks[:4]:
        r_cut = rcut(r.risk, 110)
        m_cut = rcut(r.mitigation, 180)
        rk_bullets.append(f"Riesgo: {r_cut}. Mitigación: {m_cut}")
        risks_processed.append({"risk": r_cut, "mitigation": m_cut})

    kpis_cut = [rcut(kpi, 140) for kpi in plan.kpis[:4]]
    for kpi in kpis_cut[:3]:
        rk_bullets.append(f"KPI: {kpi}")
    if not rk_bullets:
        rk_bullets.append("Monitoreo continuo de indicadores de contacto ciudadano y avance logístico en campo.")

    slides.append(
        Slide(
            id="sl9",
            kind="riesgos_kpis",
            title="Matriz de Riesgos y Métricas de Éxito",
            subtitle="Mitigaciones operativas e indicadores clave de desempeño (KPIs)",
            bullets=[rcut(b, 160) for b in rk_bullets[:6]],
            notes=(
                "Se identificaron contingencias operativas, climáticas y de seguridad, asociadas a protocolos específicos de mitigación. "
                "Los indicadores clave permitirán evaluar el cumplimiento semanal de metas y reaccionar oportunamente ante desviaciones."
            ),
            data={
                "risks": risks_processed,
                "kpis": kpis_cut,
            },
        )
    )

    # Sl 10: fuentes
    src_bullets = []
    for s in plan.research.sources[:4]:
        outl = s.outlet or s.domain
        src_bullets.append(f"[{s.id}] {outl}: {s.title} ({s.tier})")
    if not src_bullets:
        src_bullets.append("Fuentes de datos institucionales de Atalaya Electoral, CCPC, Censo INEGI y registros oficiales del INE.")
    src_bullets.append(f"Marco: {plan.disclaimer}")

    slides.append(
        Slide(
            id="sl10",
            kind="fuentes",
            title="Fuentes Consultadas y Marco Metodológico",
            subtitle="Nivel de verificación documental y principios de neutralidad institucional",
            bullets=[rcut(b, 160) for b in src_bullets[:6]],
            notes=(
                "Todas las fuentes documentales fueron filtradas conforme a los estándares de verificación institucional del INE, "
                "excluyendo redes sociales o canales no verificables. El plan se apega estrictamente a la imparcialidad y la certeza electoral."
            ),
            data={
                "sources": [s.model_dump() for s in plan.research.sources],
                "disclaimer": plan.disclaimer,
            },
        )
    )

    return slides


# ---------------------------------------------------------------- 2. region_svg

def _extract_rings(obj: Any, rings: list[Any]) -> None:
    if not isinstance(obj, (list, tuple)) or not obj:
        return
    if isinstance(obj[0], (list, tuple)) and obj[0] and isinstance(obj[0][0], (int, float)):
        rings.append(obj)
    else:
        for item in obj:
            _extract_rings(item, rings)


def region_svg(plan: CampaignPlan, *, width: int = 900, height: int = 560) -> str:
    """Renders a fragment map SVG showing only the unit and its municipal context.

    - State level: municipalities of that state colored by category, with state outline.
    - Mun level: neighbor municipalities in light gray, target municipality in its category with magenta stroke.
    - Bounding box framed with 6% padding.
    - Semaforo legend at the bottom with official palette.
    """
    ent = plan.unit.ent.zfill(2)
    level = plan.unit.level
    target_id = plan.unit.unit_id

    # 1. Load GeoJSON features for the state
    mun_file = GEO_DIR / "mun" / f"{ent}.json"
    features: list[dict[str, Any]] = []
    if mun_file.is_file():
        try:
            geo_data = json.loads(mun_file.read_text(encoding="utf-8"))
            features = geo_data.get("features", [])
        except Exception as e:
            logger.warning("Error reading %s: %s", mun_file, e)

    # Fallback to states.json if municipal file not found
    state_feature: dict[str, Any] | None = None
    states_file = GEO_DIR / "states.json"
    if states_file.is_file():
        try:
            states_data = json.loads(states_file.read_text(encoding="utf-8"))
            for feat in states_data.get("features", []):
                fid = str((feat.get("properties") or {}).get("id", ""))
                if fid.zfill(2) == ent:
                    state_feature = feat
                    break
        except Exception as e:
            logger.warning("Error reading states.json: %s", e)

    if not features and state_feature:
        features = [state_feature]

    if not features:
        # Synthetic fallback polygon if no geometry available (e.g. tests)
        features = [{
            "type": "Feature",
            "properties": {"id": target_id, "ent": ent, "name": plan.unit.name},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    [-99.2, 19.3], [-99.0, 19.3], [-99.0, 19.5], [-99.2, 19.5], [-99.2, 19.3]
                ]]
            }
        }]

    # 2. Categories mapping for municipalities
    cat_by_id: dict[str, str] = {}
    try:
        from atalaya.api.deps import get_units_df
        df = get_units_df()
        if not df.empty and "id" in df.columns and "category" in df.columns:
            mdf = df[df["id"].astype(str).str.startswith(ent)]
            for _, row in mdf.iterrows():
                cat_by_id[str(row["id"])] = str(row["category"])
    except Exception:
        pass

    # 3. Collect bounding box coordinates
    all_lons: list[float] = []
    all_lats: list[float] = []

    def _collect(coords: Any) -> None:
        if not coords:
            return
        if isinstance(coords[0], (int, float)):
            all_lons.append(float(coords[0]))
            all_lats.append(float(coords[1]))
        else:
            for sub in coords:
                _collect(sub)

    for feat in features:
        geom = feat.get("geometry") or {}
        _collect(geom.get("coordinates", []))

    if not all_lons or not all_lats:
        return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}"></svg>'

    min_lon, max_lon = min(all_lons), max(all_lons)
    min_lat, max_lat = min(all_lats), max(all_lats)

    if min_lon == max_lon:
        min_lon -= 0.1
        max_lon += 0.1
    if min_lat == max_lat:
        min_lat -= 0.1
        max_lat += 0.1

    mean_lat = (min_lat + max_lat) / 2.0
    cos_lat = math.cos(math.radians(mean_lat))

    min_x = min_lon * cos_lat
    max_x = max_lon * cos_lat
    dx = max_x - min_x
    dy = max_lat - min_lat

    # 6% margin
    margin_pct = 0.06
    pad_x = width * margin_pct
    pad_y = height * margin_pct
    legend_h = 32.0

    usable_w = max(width - 2.0 * pad_x, 10.0)
    usable_h = max(height - 2.0 * pad_y - legend_h, 10.0)

    scale = min(usable_w / max(dx, 1e-7), usable_h / max(dy, 1e-7))
    map_w = dx * scale
    map_h = dy * scale

    offset_x = pad_x + (usable_w - map_w) / 2.0 - min_x * scale
    offset_y = pad_y + (usable_h - map_h) / 2.0 + max_lat * scale

    def pt_str(pt: list[float] | tuple[float, float]) -> str:
        px = (float(pt[0]) * cos_lat) * scale + offset_x
        py = offset_y - float(pt[1]) * scale
        return f"{px:.1f} {py:.1f}"

    def ring_to_d(ring: list[Any]) -> str:
        if not ring:
            return ""
        pts = [pt_str(p) for p in ring]
        return "M " + " L ".join(pts) + " Z"

    # 4. Generate SVG paths
    paths_base: list[str] = []
    paths_target: list[str] = []

    for feat in features:
        props = feat.get("properties") or {}
        feat_id = str(props.get("id") or props.get("cvegeo") or "")

        rings: list[Any] = []
        _extract_rings((feat.get("geometry") or {}).get("coordinates", []), rings)
        d_parts = [ring_to_d(r) for r in rings if r]
        if not d_parts:
            continue
        comb_d = " ".join(d_parts)

        if level == "mun":
            if feat_id == target_id or feat_id.zfill(5) == target_id.zfill(5):
                cat = plan.unit.category
                fill = CATEGORY_COLORS.get(cat, CATEGORY_COLORS["rojo"])
                paths_target.append(
                    f'<path id="feat-{feat_id}" data-id="{feat_id}" fill="{fill}" '
                    f'stroke="{COLOR_MAGENTA_HEX}" stroke-width="2.5" fill-rule="evenodd" d="{comb_d}" />'
                )
            else:
                paths_base.append(
                    f'<path id="feat-{feat_id}" data-id="{feat_id}" fill="#e4e4e7" '
                    f'stroke="#ffffff" stroke-width="0.5" fill-rule="evenodd" d="{comb_d}" />'
                )
        else:
            # State level
            cat = cat_by_id.get(feat_id, cat_by_id.get(feat_id.zfill(5), plan.unit.category))
            fill = CATEGORY_COLORS.get(cat, CATEGORY_COLORS["sin_dato"])
            paths_base.append(
                f'<path id="feat-{feat_id}" data-id="{feat_id}" fill="{fill}" '
                f'stroke="#ffffff" stroke-width="0.5" fill-rule="evenodd" d="{comb_d}" />'
            )

    # State outline overlay if state level
    state_outline = ""
    if level == "state" and state_feature:
        s_rings: list[Any] = []
        _extract_rings((state_feature.get("geometry") or {}).get("coordinates", []), s_rings)
        s_parts = [ring_to_d(r) for r in s_rings if r]
        if s_parts:
            state_outline = f'<path id="state-outline-{ent}" data-id="{ent}" fill="none" stroke="{COLOR_TINTA_HEX}" stroke-width="1.8" fill-rule="evenodd" d="{" ".join(s_parts)}" />'

    # Legend at bottom
    legend_items = [
        ("Bajo riesgo", CATEGORY_COLORS["verde"]),
        ("Medio", CATEGORY_COLORS["amarillo"]),
        ("Alto", CATEGORY_COLORS["naranja"]),
        ("Crítico", CATEGORY_COLORS["rojo"]),
    ]
    legend_svg: list[str] = []
    leg_total_w = sum(len(lbl) * 6.5 + 24 for lbl, _ in legend_items)
    leg_x = max(pad_x, (width - leg_total_w) / 2.0)
    leg_y = height - 12.0

    for lbl, col in legend_items:
        legend_svg.append(
            f'<rect x="{leg_x:.1f}" y="{leg_y - 10.0:.1f}" width="12" height="12" rx="2" fill="{col}" stroke="#e7e1e5" stroke-width="0.5" />'
        )
        legend_svg.append(
            f'<text x="{leg_x + 16.0:.1f}" y="{leg_y - 1.0:.1f}" font-family="Montserrat, Arial, sans-serif" font-size="10" font-weight="600" fill="#4a2a48">{html.escape(lbl)}</text>'
        )
        leg_x += len(lbl) * 6.5 + 28.0

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}" role="img" aria-label="Mapa territorial de {html.escape(plan.unit.name)}">'
        f'{"".join(paths_base)}'
        f'{"".join(paths_target)}'
        f'{state_outline}'
        f'{"".join(legend_svg)}'
        f"</svg>"
    )


# ---------------------------------------------------------------- 3. render_html

def _get_logo_data_uri() -> str:
    """Returns data URI for Atalaya logo from report/assets/."""
    candidates = [
        ASSETS_DIR / "atalaya-electoral-logo.svg",
        ASSETS_DIR / "icon-512.png",
    ]
    for p in candidates:
        if p.is_file():
            try:
                raw = p.read_bytes()
                mime = "image/svg+xml" if p.suffix == ".svg" else "image/png"
                b64 = base64.b64encode(raw).decode("ascii")
                return f"data:{mime};base64,{b64}"
            except Exception:
                pass
    return ""


def _get_logo_light_data_uri() -> str:
    """Returns data URI for clear/white Atalaya logo (for dark/magenta backgrounds)."""
    p = ASSETS_DIR / "atalaya-electoral-logo-light.svg"
    if p.is_file():
        try:
            raw = p.read_bytes()
            b64 = base64.b64encode(raw).decode("ascii")
            return f"data:image/svg+xml;base64,{b64}"
        except Exception:
            pass
    return ""


def render_html(plan: CampaignPlan, slides: list[Slide] | None = None) -> str:
    """Renders 16:9 presentation HTML with embedded CSS and logo."""
    slides_to_use = slides if slides is not None else build_slides(plan)
    for s in slides_to_use:
        if s.subtitle and ("Ámbito MUN" in s.subtitle or "Ambito MUN" in s.subtitle):
            s.subtitle = s.subtitle.replace("Ámbito MUN", get_level_readable(plan.unit.level)).replace("Ambito MUN", get_level_readable(plan.unit.level))
        if s.kind == "portada" and s.subtitle and "Ámbito" in s.subtitle:
            s.subtitle = f"{plan.unit.name}, {plan.unit.ent_name} · {get_level_readable(plan.unit.level)}"

    # Read CSS content
    css_file = TEMPLATES_DIR / "deck.css"
    css_content = css_file.read_text(encoding="utf-8") if css_file.is_file() else ""

    logo_uri = _get_logo_data_uri()
    logo_light_uri = _get_logo_light_data_uri()

    env = Environment(
        loader=FileSystemLoader(str(TEMPLATES_DIR)),
        autoescape=True,
    )
    template = env.get_template("deck.html.j2")
    return template.render(
        plan=plan,
        slides=slides_to_use,
        css_content=css_content,
        logo_uri=logo_uri,
        logo_light_uri=logo_light_uri,
    )


# ---------------------------------------------------------------- 4. check_overflow & export_pdf

def check_overflow(html_path: Path, timeout_s: int = 20) -> list[str]:
    """Runs headless Chrome to detect overflows tagged with data-overflow="1".

    Returns a list of slide IDs that have overflowing cards or text.
    """
    try:
        browser = find_browser()
    except RuntimeError:
        logger.warning("No headless browser found to run overflow check.")
        return []

    file_uri = html_path.resolve().as_uri()
    cmd = [
        str(browser),
        "--headless=new",
        "--disable-gpu",
        "--virtual-time-budget=5000",
        "--dump-dom",
        file_uri,
    ]
    try:
        res = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout_s,
        )
        dom = res.stdout or ""
        if 'data-overflow="1"' not in dom:
            return []

        overflowing: list[str] = []
        for match in re.finditer(r'<section[^>]*id="([^"]+)"[\s\S]*?</section>', dom):
            slide_id = match.group(1)
            content = match.group(0)
            if 'data-overflow="1"' in content:
                overflowing.append(slide_id)

        if not overflowing and 'data-overflow="1"' in dom:
            overflowing.append("slide-unknown")

        return overflowing
    except Exception as exc:
        logger.warning("Failed running browser overflow check: %s", exc)
        return []


def export_pdf(plan: CampaignPlan, out: Path, slides: list[Slide] | None = None) -> Path:
    """Exports the 16:9 presentation to PDF via headless Chrome/Edge.

    Validates slide overflow; if detected, reduces clipping and re-renders once.
    """
    out = Path(out).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp_html = out.parent / f"_tmp_{out.stem}.html"

    try:
        # 1. Initial render
        slides_to_use = slides if slides is not None else build_slides(plan, reduced=False)
        html_content = render_html(plan, slides_to_use)
        tmp_html.write_text(html_content, encoding="utf-8")

        # 2. Check overflow
        overflows = check_overflow(tmp_html)
        if overflows:
            logger.info("Overflow detected in slide(s): %s; reducing cuts and re-rendering", ", ".join(overflows))
            # Reduce clipping: actions to 1, texts to 70%
            slides_to_use = build_slides(plan, reduced=True)
            if slides is not None:
                # If custom overrides were provided in slides, preserve overridden title/subtitle/notes
                for s_orig, s_red in zip(slides, slides_to_use):
                    if s_orig.title != s_red.title:
                        s_red.title = s_orig.title
                    if s_orig.subtitle != s_red.subtitle:
                        s_red.subtitle = s_orig.subtitle
                    if s_orig.notes != s_red.notes:
                        s_red.notes = s_orig.notes
            html_content = render_html(plan, slides_to_use)
            tmp_html.write_text(html_content, encoding="utf-8")

        # 3. Export PDF
        html_to_pdf(tmp_html, out, landscape=True)

        # Validate page count equals 10 slides
        if out.is_file():
            pdf_bytes = out.read_bytes()
            pages = len(re.findall(rb"/Type\s*/Page\b", pdf_bytes))
            if pages != 10:
                logger.warning("PDF generated at %s has %d pages (expected 10)", out, pages)
        return out
    finally:
        if tmp_html.is_file():
            try:
                tmp_html.unlink()
            except Exception:
                pass


# ---------------------------------------------------------------- 5. export_pptx

def _svg_to_png(svg_str: str, png_path: Path, width: int = 900, height: int = 560) -> bool:
    """Rasterizes an SVG to PNG using Chrome headless screenshot."""
    try:
        browser_exe = find_browser()
    except Exception:
        return False

    png_path = Path(png_path).resolve()
    png_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_html = png_path.parent / f"_tmp_svg_{png_path.stem}.html"
    try:
        html_code = (
            f'<!DOCTYPE html><html><head><meta charset="utf-8">'
            f'<style>body {{ margin: 0; padding: 0; background: transparent; overflow: hidden; }} svg {{ display: block; }}</style>'
            f'</head><body>{svg_str}</body></html>'
        )
        tmp_html.write_text(html_code, encoding="utf-8")
        file_url = f"file:///{tmp_html.as_posix()}"
        cmd = [
            str(browser_exe),
            "--headless=new",
            "--disable-gpu",
            f"--screenshot={png_path}",
            f"--window-size={width},{height}",
            file_url,
        ]
        res = subprocess.run(cmd, capture_output=True, timeout=20)
        return res.returncode == 0 and png_path.is_file()
    except Exception as e:
        logger.warning("Could not rasterize SVG with headless browser: %s", e)
        return False
    finally:
        if tmp_html.is_file():
            try:
                tmp_html.unlink()
            except Exception:
                pass


def _get_or_rasterize_logo_light() -> Path | None:
    """Returns path to cached rasterized light logo PNG, creating it if needed."""
    try:
        cached = exports_dir() / "logo_light.png"
        if cached.is_file() and cached.stat().st_size > 500:
            return cached
        svg_light = ASSETS_DIR / "atalaya-electoral-logo-light.svg"
        if svg_light.is_file():
            svg_content = svg_light.read_text(encoding="utf-8")
            cached.parent.mkdir(parents=True, exist_ok=True)
            if _svg_to_png(svg_content, cached, width=450, height=96):
                return cached
    except Exception as exc:
        logger.warning("Could not generate logo_light.png: %s", exc)

    for candidate in [ASSETS_DIR / "icon-512.png", ASSETS_DIR / "apple-icon.png"]:
        if candidate.is_file():
            return candidate
    return None


def export_pptx(plan: CampaignPlan, out: Path, slides: list[Slide] | None = None) -> Path:
    """Exports 16:9 PowerPoint presentation with editable text boxes, titles in shapes.title, and notes."""
    slides_to_use = slides if slides is not None else build_slides(plan)
    for s in slides_to_use:
        if s.subtitle and ("Ámbito MUN" in s.subtitle or "Ambito MUN" in s.subtitle):
            s.subtitle = s.subtitle.replace("Ámbito MUN", get_level_readable(plan.unit.level)).replace("Ambito MUN", get_level_readable(plan.unit.level))
        if s.kind == "portada" and s.subtitle and "Ámbito" in s.subtitle:
            s.subtitle = f"{plan.unit.name}, {plan.unit.ent_name} · {get_level_readable(plan.unit.level)}"
    out = Path(out).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)

    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    # Layout 5: Title Only (provides a native title placeholder recognized in shapes.title and outline)
    title_layout = prs.slide_layouts[5]

    logo_light_path = _get_or_rasterize_logo_light()
    date_str = plan.generated_at[:10] if plan.generated_at else ""

    # Temporary directory for map rasterization
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)

        for i, s in enumerate(slides_to_use):
            slide = prs.slides.add_slide(title_layout)

            # Ensure slide.shapes.title contains the slide title for PowerPoint navigation
            title_shape = slide.shapes.title
            if title_shape:
                title_shape.text = s.title
                title_shape.name = "Title"

            # Remove other unused placeholders from slide layout 5
            for ph in list(slide.placeholders):
                if ph != slide.shapes.title:
                    try:
                        sp = ph._element
                        sp.getparent().remove(sp)
                    except Exception:
                        pass

            # Speaker notes
            if s.notes:
                slide.notes_slide.notes_text_frame.text = s.notes

            if s.kind == "portada":
                # Cover slide banner (top magenta rectangle)
                banner = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0), Inches(0), Inches(13.333), Inches(3.2))
                banner.fill.solid()
                banner.fill.fore_color.rgb = COLOR_MAGENTA_RGB
                banner.line.color.rgb = COLOR_MAGENTA_RGB

                # Logo picture in cover banner
                if logo_light_path and logo_light_path.is_file():
                    try:
                        slide.shapes.add_picture(str(logo_light_path), Inches(0.8), Inches(0.35), height=Inches(0.65))
                    except Exception:
                        pass

                # Portada Tag / Sello
                tag_box = slide.shapes.add_textbox(Inches(4.8), Inches(0.45), Inches(7.7), Inches(0.4))
                tag_p = tag_box.text_frame.paragraphs[0]
                tag_p.text = "BORRADOR GENERADO CON IA — EQUIPO OXENT"
                tag_p.font.name = "Arial"
                tag_p.font.size = Pt(11)
                tag_p.font.bold = True
                tag_p.font.color.rgb = RGBColor(0xFA, 0xEB, 0xF3)

                # Format Title shape inside magenta banner
                if title_shape:
                    title_shape.left = Inches(0.8)
                    title_shape.top = Inches(1.2)
                    title_shape.width = Inches(11.7)
                    title_shape.height = Inches(0.9)
                    t_frame = title_shape.text_frame
                    t_frame.word_wrap = True
                    t_p = t_frame.paragraphs[0]
                    t_p.text = s.title
                    t_p.font.name = "Arial"
                    t_p.font.size = Pt(32)
                    t_p.font.bold = True
                    t_p.font.color.rgb = COLOR_WHITE_RGB

                # Subtitle in cover banner
                if s.subtitle:
                    sub_box = slide.shapes.add_textbox(Inches(0.8), Inches(2.2), Inches(11.7), Inches(0.6))
                    sub_tf = sub_box.text_frame
                    sub_tf.word_wrap = True
                    sub_p = sub_tf.paragraphs[0]
                    sub_p.text = s.subtitle
                    sub_p.font.name = "Arial"
                    sub_p.font.size = Pt(15)
                    sub_p.font.color.rgb = RGBColor(0xFD, 0xF0, 0xF7)

                # Metadata & Bullets below banner (starting at top = 3.5 in)
                b_box = slide.shapes.add_textbox(Inches(0.8), Inches(3.5), Inches(11.7), Inches(3.1))
                b_frame = b_box.text_frame
                b_frame.word_wrap = True
                for idx, b in enumerate(s.bullets):
                    p = b_frame.paragraphs[0] if idx == 0 else b_frame.add_paragraph()
                    p.text = f"▸  {b}"
                    p.font.name = "Arial"
                    p.font.size = Pt(13)
                    p.font.color.rgb = COLOR_DARK_RGB
                    p.space_after = Pt(8)

                # Footer
                ftr = slide.shapes.add_textbox(Inches(0.8), Inches(6.8), Inches(11.7), Inches(0.4))
                ftr_p = ftr.text_frame.paragraphs[0]
                ftr_p.text = f"Atalaya Electoral · Borrador generado con IA · {date_str}       |       Diapositiva 1 de {len(slides_to_use)}"
                ftr_p.font.name = "Arial"
                ftr_p.font.size = Pt(9.5)
                ftr_p.font.color.rgb = COLOR_MUTED_RGB

            else:
                # Top brand line
                top_bar = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0), Inches(0), Inches(13.333), Inches(0.08))
                top_bar.fill.solid()
                top_bar.fill.fore_color.rgb = COLOR_MAGENTA_RGB
                top_bar.line.color.rgb = COLOR_MAGENTA_RGB

                # Header box via slide.shapes.title
                if title_shape:
                    title_shape.left = Inches(0.8)
                    title_shape.top = Inches(0.28)
                    title_shape.width = Inches(10.5)
                    title_shape.height = Inches(0.55)
                    hdr_frame = title_shape.text_frame
                    hdr_frame.word_wrap = True
                    hdr_p = hdr_frame.paragraphs[0]
                    hdr_p.text = s.title
                    hdr_p.font.name = "Arial"
                    hdr_p.font.size = Pt(22)
                    hdr_p.font.bold = True
                    hdr_p.font.color.rgb = COLOR_TINTA_RGB

                if s.subtitle:
                    sub_box = slide.shapes.add_textbox(Inches(0.8), Inches(0.85), Inches(10.5), Inches(0.4))
                    sub_tf = sub_box.text_frame
                    sub_tf.word_wrap = True
                    sub_p = sub_tf.paragraphs[0]
                    sub_p.text = s.subtitle
                    sub_p.font.name = "Arial"
                    sub_p.font.size = Pt(12)
                    sub_p.font.color.rgb = COLOR_MUTED_RGB

                # Logo icon at top right
                if logo_light_path and logo_light_path.is_file():
                    try:
                        slide.shapes.add_picture(str(logo_light_path), Inches(11.4), Inches(0.35), height=Inches(0.45))
                    except Exception:
                        pass

                # Content by kind
                if s.kind == "region":
                    # Split layout: Map on left, bullets on right
                    map_png = tmp_path / "region_map.png"
                    svg_content = region_svg(plan)
                    has_png = _svg_to_png(svg_content, map_png, width=900, height=560)

                    if has_png and map_png.is_file():
                        try:
                            slide.shapes.add_picture(str(map_png), Inches(0.8), Inches(1.5), width=Inches(6.2), height=Inches(4.8))
                        except Exception:
                            has_png = False

                    if not has_png:
                        msg_box = slide.shapes.add_textbox(Inches(0.8), Inches(1.5), Inches(6.0), Inches(4.8))
                        msg_p = msg_box.text_frame.paragraphs[0]
                        msg_p.text = "Mapa disponible en la versión PDF"
                        msg_p.font.name = "Arial"
                        msg_p.font.size = Pt(14)
                        msg_p.font.italic = True
                        msg_p.font.color.rgb = COLOR_MUTED_RGB

                    # Right panel bullets
                    txt_box = slide.shapes.add_textbox(Inches(7.3), Inches(1.5), Inches(5.2), Inches(4.8))
                    tf = txt_box.text_frame
                    tf.word_wrap = True
                    for b_idx, b in enumerate(s.bullets):
                        p = tf.paragraphs[0] if b_idx == 0 else tf.add_paragraph()
                        p.text = f"▸  {b}"
                        p.font.name = "Arial"
                        p.font.size = Pt(13)
                        p.font.color.rgb = COLOR_DARK_RGB
                        p.space_after = Pt(10)

                else:
                    # General content text box
                    main_box = slide.shapes.add_textbox(Inches(0.8), Inches(1.5), Inches(11.733), Inches(5.0))
                    tf = main_box.text_frame
                    tf.word_wrap = True
                    for b_idx, b in enumerate(s.bullets):
                        p = tf.paragraphs[0] if b_idx == 0 else tf.add_paragraph()
                        p.text = f"▸  {b}"
                        p.font.name = "Arial"
                        p.font.size = Pt(13)
                        p.font.color.rgb = COLOR_DARK_RGB
                        p.space_after = Pt(8)

                # Footer
                ftr = slide.shapes.add_textbox(Inches(0.8), Inches(6.9), Inches(11.733), Inches(0.35))
                ftr_p = ftr.text_frame.paragraphs[0]
                ftr_p.text = f"Atalaya Electoral · Borrador generado con IA · {date_str}       |       Diapositiva {i + 1} de {len(slides_to_use)}"
                ftr_p.font.name = "Arial"
                ftr_p.font.size = Pt(9.5)
                ftr_p.font.color.rgb = COLOR_MUTED_RGB

    prs.save(str(out))
    return out
