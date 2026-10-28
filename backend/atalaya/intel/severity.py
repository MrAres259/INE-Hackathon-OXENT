"""Deterministic severity scoring, institutional action decision, and remediation templates."""

from __future__ import annotations

from typing import Any

from atalaya.intel.impact import campaign_prefill_for
from atalaya.intel.schemas import (
    ActionType,
    NewsImpact,
    NewsTopic,
    Remediation,
    ReportTarget,
    Severity,
    SeverityLevel,
    Verdict,
    Virality,
)

# Harm weight by topic according to CONTEXT §7.5
HARM_BY_TOPIC: dict[NewsTopic, float] = {
    "procedimiento_votacion": 1.0,
    "credencial_padron": 1.0,
    "organizacion_casillas": 0.8,
    "resultados_fraude": 0.8,
    "seguridad_violencia": 0.7,
    "confianza_institucional": 0.6,
    "presupuesto_recortes": 0.5,
    "conducta_funcionarios": 0.4,
    "otra": 0.4,
}


def _severity_level(score: int) -> SeverityLevel:
    """Classify 0-100 severity score into baja, media, alta, or critica."""
    if score < 25:
        return "baja"
    if score < 50:
        return "media"
    if score < 75:
        return "alta"
    return "critica"


def severity_true(impact: NewsImpact) -> Severity:
    """Calculate severity for true or misleading news based on modeled electoral impact.

    score = min(100, round(30*max_delta_pp + 100*|delta_pp_national| + votos_perdidos_total/25_000))
    """
    raw_score = (
        30.0 * float(impact.max_delta_pp)
        + 100.0 * abs(float(impact.delta_pp_national))
        + float(impact.votos_perdidos_total) / 25000.0
    )
    score = max(0, min(100, int(round(raw_score))))
    level = _severity_level(score)

    drivers = [
        f"Máximo incremento local de abstención: {impact.max_delta_pp:.2f} pp.",
        f"Incremento promedio ponderado nacional: {impact.delta_pp_national:.3f} pp.",
        f"Pérdida agregada estimada de participación: {impact.votos_perdidos_total:,} votos.",
        f"Severidad calculada: {score}/100 ({level}).",
    ]

    return Severity(level=level, score=score, drivers=drivers)


def severity_fake(v: Virality, topic: NewsTopic, verdict: Verdict) -> Severity:
    """Calculate severity for false, unverified or misleading claims based on virality and topic harm.

    score = round(virality.score * (0.5 + 0.5 * harm)) [times 0.7 if unverified]
    """
    harm = HARM_BY_TOPIC.get(topic, 0.4)
    raw_score = float(v.score) * (0.5 + 0.5 * harm)

    is_unverified = verdict == "sin_verificar"
    if is_unverified:
        raw_score *= 0.7

    score = max(0, min(100, int(round(raw_score))))
    level = _severity_level(score)

    drivers = [
        f"Puntaje de viralidad social: {v.score}/100 ({v.level}).",
        f"Ponderación de daño temático ('{topic}'): factor {harm:.2f}.",
    ]
    if is_unverified:
        drivers.append("Ajuste por veredicto sin verificar: ponderación reducida al 70%.")
    drivers.append(f"Severidad final de desinformación: {score}/100 ({level}).")

    return Severity(level=level, score=score, drivers=drivers)


def decide_action(
    item_verdict: Verdict,
    sev: Severity,
    *,
    has_posts: bool = False,
    max_delta_pp: float | None = None,
    votos_perdidos: int | None = None,
) -> tuple[ActionType, list[ActionType], int]:
    """Decide primary action, secondary actions, and completion deadline in hours.

    Returns (action, secondary_actions, deadline_hours).
    """
    # Case A: Fact-checked true or impact-driven items without viral posts
    if item_verdict == "verdadera" or (item_verdict == "enganosa" and not has_posts):
        if max_delta_pp is not None:
            v_lost = votos_perdidos if votos_perdidos is not None else 0
            if max_delta_pp < 0.3 and v_lost < 50000:
                return ("registrar", [], 168)
            elif max_delta_pp < 1.0:
                return ("comunicado", [], 72)
            else:
                return ("campana_intervencion", ["comunicado"], 48)
        else:
            if sev.score < 25:
                return ("registrar", [], 168)
            elif sev.score < 50:
                return ("comunicado", [], 72)
            else:
                return ("campana_intervencion", ["comunicado"], 48)

    # Case B: False, unverified or viral misleading claims
    if not has_posts and item_verdict == "sin_verificar":
        return ("registrar", [], 168)

    if sev.score < 30:
        return ("registrar", [], 168)
    elif sev.score < 55:
        return ("responder_corregir", [], 48)
    elif sev.score < 75:
        return ("reportar_plataforma", ["responder_corregir"], 24)
    else:
        return ("desmentido_oficial", ["reportar_plataforma", "responder_corregir"], 12)


def template_remediation(item: dict[str, Any], action: ActionType, sev: Severity) -> Remediation:
    """Generate neutral, institutional remediation measures, message draft and reporting targets."""
    # Secondary actions and deadlines
    if action == "desmentido_oficial":
        secondary: list[ActionType] = ["reportar_plataforma", "responder_corregir"]
        deadline_h = 12
    elif action == "reportar_plataforma":
        secondary = ["responder_corregir"]
        deadline_h = 24
    elif action == "campana_intervencion":
        secondary = ["comunicado"]
        deadline_h = 48
    elif action == "responder_corregir":
        secondary = []
        deadline_h = 48
    elif action == "comunicado":
        secondary = []
        deadline_h = 72
    else:  # registrar
        secondary = []
        deadline_h = 168

    topic = item.get("topic", "otra")
    headline = item.get("headline", "Noticia o rumor monitoreado")
    claim = item.get("claim", headline)

    # 3-5 concrete institutional measures
    measures = [
        "Monitoreo continuo de saliencia y volumen de menciones en medios y plataformas.",
        "Verificación técnica de hechos con la Dirección Ejecutiva o Junta Local correspondiente.",
        "Publicación de información oficial verificada en canales institucionales del INE (ine.mx).",
        "Registro y seguimiento de la incidencia en la bitácora del Monitor Institucional.",
    ]
    if action in ("reportar_plataforma", "desmentido_oficial"):
        measures.append("Notificación formal a las plataformas digitales por violación de políticas de integridad electoral.")

    rationale = (
        f"Acción decidida ({action}) ante severidad {sev.level} ({sev.score}/100) en materia de '{topic}'. "
        "Se prioriza la certeza del proceso electoral y la imparcialidad institucional sin confrontación personal."
    )

    # Draft message (<= 180 words for comunicado/desmentido; <= 280 chars for reply)
    draft_message: str | None = None
    if action in ("comunicado", "desmentido_oficial", "campana_intervencion"):
        draft_message = (
            f"El Instituto Nacional Electoral (INE) informa a la ciudadanía sobre las publicaciones relativas a: "
            f"'{headline}'. Conforme a los principios de certeza y máxima publicidad que rigen la función electoral, "
            "se precisa que todas las etapas del proceso electoral federal se desarrollan con estricto apego a la ley "
            "y con la supervisión de representaciones partidistas y observadores acreditados. "
            "Invitamos a consultar información oficial y verificada exclusivamente en ine.mx y en nuestros canales institucionales."
        )
    elif action == "responder_corregir":
        draft_message = (
            f"El @INEMexico precisa que esta información es imprecisa. "
            f"Los procedimientos oficiales y requisitos vigentes pueden consultarse directamente en https://ine.mx. #CertezaINE"
        )

    # Extract report targets from posts
    raw_posts = item.get("posts") or []
    report_targets: list[ReportTarget] = []
    for p in raw_posts:
        if isinstance(p, dict):
            plat = p.get("platform", "otro")
            p_url = p.get("url", "")
            p_auth = p.get("author")
        else:
            plat = getattr(p, "platform", "otro")
            p_url = getattr(p, "url", "")
            p_auth = getattr(p, "author", None)

        if p_url:
            report_targets.append(
                ReportTarget(
                    platform=plat,
                    url=p_url,
                    author=p_auth,
                    reason="Desinformación sobre el proceso electoral",
                )
            )

    # Campaign prefill if action is campana_intervencion
    campaign_prefill = None
    if action == "campana_intervencion" and "impact" in item and item["impact"]:
        imp = item["impact"]
        if isinstance(imp, dict):
            imp = NewsImpact.model_validate(imp)
        campaign_prefill = campaign_prefill_for(imp, topic)

    return Remediation(
        action=action,
        secondary_actions=secondary,
        measures=measures,
        rationale=rationale,
        draft_message=draft_message,
        report_targets=report_targets,
        campaign_prefill=campaign_prefill,
        deadline_hours=deadline_h,
        degraded=True,
    )
