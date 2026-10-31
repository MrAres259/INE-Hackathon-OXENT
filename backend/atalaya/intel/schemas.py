"""Atalaya Electoral · Inteligencia (Gemini + GLM) — shared data contract.

THIS FILE IS THE CONTRACT. It is copied verbatim to backend/atalaya/intel/schemas.py
(owner W1-C). Any agent that starts before it exists copies it from
temp/intel/contract/schemas.py (identical bytes, so concurrent copies never conflict).
Never edit the copy in backend; if a field is impossible, leave a CONTRACT-NOTE in YOUR code.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

# ---------------------------------------------------------------- shared enums

Level = Literal["state", "mun"]
Lever = Literal["promocion_jovenes", "casillas_rurales", "materiales_lengua_indigena", "campana_general"]
Targeting = Literal["rojo", "rojo_naranja", "todos"]
SourceTier = Literal[
    "oficial",            # INE, OPLE, INEGI, CONAPO, gob.mx, DOF, TEPJF, SCJN
    "verificador",        # fact-checkers (Verificado, AFP Factual, El Sabueso, Reuters Fact Check...)
    "academico",          # universities, research centers, scholarly journals, think tanks
    "medio_reconocido",   # national / international recognized newsrooms
    "medio_regional",     # recognized state/local newsrooms
    "no_reconocido",      # unknown sites, blogs, content farms
    "red_social",         # x.com, facebook, tiktok, instagram, youtube, telegram, whatsapp channels...
]
Confidence = Literal["alta", "media", "baja"]
JobStatus = Literal["queued", "running", "done", "error"]


class SourceRef(BaseModel):
    id: str                                  # "s1", "s2"... unique inside its container
    url: str                                 # final URL (grounding redirects resolved when possible)
    title: str = ""
    domain: str = ""                         # "eluniversal.com.mx" (no www.)
    outlet: str | None = None                # human name from seed list when known
    tier: SourceTier = "no_reconocido"
    published: str | None = None             # ISO date "2026-10-21" when known


# ---------------------------------------------------------------- campaign planner (tab "Plan de campaña")

FindingCategory = Literal[
    "desconfianza_institucional",
    "inseguridad_violencia",
    "acceso_casillas_distancia",
    "desinformacion",
    "apatia_desafeccion",
    "barreras_documentales_credencial",
    "migracion_movilidad",
    "exclusion_linguistica_cultural",
    "condiciones_socioeconomicas",
    "otra",
]


class CampaignRequest(BaseModel):
    unit_id: str = Field(pattern=r"^\d{2}(\d{3})?$")       # "07" state or "07101" municipio
    focus: str | None = Field(default=None, max_length=300)  # optional user hint ("jóvenes universitarios")
    refresh: bool = False                                     # ignore cache (operator only)


class Finding(BaseModel):
    id: str                                  # "f1"...
    title: str
    summary: str                             # <= 60 words, Spanish
    category: FindingCategory = "otra"
    evidence: list[str] = []                 # SourceRef ids (only retained/verified sources)
    scope: Literal["municipio", "estado", "nacional"] = "estado"
    confidence: Confidence = "media"
    quote: str | None = None
    verification: Literal["cita_verificada", "fuente_verificada", "sin_verificar"] = "sin_verificar"


class ResearchBundle(BaseModel):
    unit_id: str
    unit_name: str
    level: Level
    findings: list[Finding] = []
    sources: list[SourceRef] = []            # retained sources only (tiers oficial/verificador/academico/medio_*)
    discarded_sources: int = 0               # sources dropped because their tier is not verifiable
    queries: list[str] = []                  # Google queries Gemini ran (groundingMetadata.webSearchQueries)
    generated_at: str                        # ISO datetime
    model: str = ""
    from_cache: bool = False
    search_mode: Literal["grounding", "respaldo", "sin_internet"] = "grounding"   # added in ola-2-fix
    degraded: bool = False                   # True when Gemini was unavailable (findings empty)
    note: str | None = None                  # Spanish explanation when degraded


class DriverBrief(BaseModel):
    label: str
    contribution_pp: float


class DataSnapshot(BaseModel):
    """Own deterministic data (Atalaya model) for the unit. Every number shown in a plan comes from here or ImpactAnalysis."""
    unit_id: str
    name: str
    level: Level
    ent: str
    ent_name: str
    lista_nominal: int
    pred_abstention: float | None            # fraction 0-1
    pred_low: float | None
    pred_high: float | None
    category: str                            # verde|amarillo|naranja|rojo|sin_dato
    risk_score: float | None
    last_participation: float | None         # fraction
    last_year: int | None
    trend_pp: float | None
    abstencion_esperada: int | None
    part_18_34_last: float | None = None     # fraction
    gap_youth_pp_last: float | None = None
    pct_18_24: float | None = None           # census 2020, percent 0-100 as stored in units.parquet
    pct_rural: float | None = None
    pct_hli: float | None = None
    pct_internet: float | None = None
    im_2020: float | None = None
    drivers: list[DriverBrief] = []          # top 5 by |contribution|
    recommendations: list[str] = []          # titles from model/recommend.py
    municipios: int | None = None            # state level only: number of municipios
    municipios_rojos: int | None = None      # state level only


class TargetGroup(BaseModel):
    name: str
    description: str
    size_estimate: int | None = None         # persons, ONLY when derivable from DataSnapshot (else None)
    size_basis: str = ""                     # how size_estimate was derived, Spanish


class Proposal(BaseModel):
    id: str                                  # "p1"...
    title: str
    description: str                         # <= 70 words
    lever: Lever                             # maps to the scenario simulator
    channels: list[str] = []                 # "brigadas en planteles", "radio comunitaria"...
    target_group: str                        # TargetGroup.name
    addresses: list[str] = []                # Finding ids
    effect_pp: float = Field(default=2.0, ge=0, le=10)
    coverage: float = Field(default=80, ge=0, le=100)
    targeting: Targeting = "todos"
    rationale: str = ""


class ProposalImpact(BaseModel):
    proposal_id: str
    lever: Lever
    votos_solo: int                          # extra votes if it were the only campaign (unit scope)


class ImpactAnalysis(BaseModel):
    """Computed with model.scenarios.simulate (deterministic). Unit scope = the requested unit."""
    campaigns: list[dict[str, Any]]          # exactly what was sent to simulate (lever,targeting,effect_pp,coverage,ents)
    abstention_base: float | None            # fraction, unit (LN-weighted for a state)
    abstention_scenario: float | None
    delta_pp: float | None                   # scenario - base, percentage points (negative = less abstention)
    votos_adicionales: int
    category_before: str
    category_after: str
    municipios_mejoran: int | None = None    # state level: municipios whose category improves
    per_proposal: list[ProposalImpact] = []
    overlap_votos: int = 0                   # sum(votos_solo) - votos_adicionales
    assumptions: list[str] = []              # Spanish, shown in the "impacto" slide


class ImplementationStep(BaseModel):
    order: int
    phase: str                               # "Diagnóstico y alianzas", "Producción de materiales"...
    start: str                               # ISO date, >= today
    end: str                                 # ISO date, <= 2027-05-31 (veda/jornada 2027-06-06)
    actions: list[str]
    responsible: str                         # generic INE area: "Junta Local Ejecutiva", "DECEyEC", "Vocalía de Capacitación"
    kpi: str


class RiskItem(BaseModel):
    risk: str
    mitigation: str


SlideKind = Literal[
    "portada", "diagnostico_datos", "problematicas", "region", "grupo_objetivo",
    "propuestas", "impacto", "implementacion", "riesgos_kpis", "fuentes",
]


class Slide(BaseModel):
    id: str                                  # "sl1"...
    kind: SlideKind
    title: str
    subtitle: str | None = None
    bullets: list[str] = []                  # <= 6 bullets, <= 160 chars each
    notes: str = ""                          # speaker notes
    data: dict[str, Any] = {}                # kind-specific payload (see 00-CONTEXT §6.4)


class LLMInfo(BaseModel):
    model: str = ""
    effort: str = ""
    degraded: bool = False                   # True when the plan text came from deterministic templates


class CampaignPlan(BaseModel):
    id: str                                  # sha1(unit_id + focus + generated_at)[:12]
    unit: DataSnapshot
    research: ResearchBundle
    focus: str | None = None
    objective: str                           # 1-2 sentences
    target_groups: list[TargetGroup] = []    # 1-3
    proposals: list[Proposal] = []           # 2-4, at most one per lever
    impact: ImpactAnalysis
    steps: list[ImplementationStep] = []     # 4-6, chronological
    risks: list[RiskItem] = []               # 2-4
    kpis: list[str] = []                     # 3-5
    slides: list[Slide] = []                 # built by intel.deck.build_slides
    generated_at: str
    llm: LLMInfo = LLMInfo()
    disclaimer: str = (
        "Borrador generado con IA a partir de datos agregados de Atalaya Electoral y fuentes públicas verificadas. "
        "Escenario hipotético, no efecto causal; requiere revisión del personal del INE."
    )


class SlidesOverride(BaseModel):
    """Edited slides sent back by the UI for export (titles/bullets/notes only; data is taken from the stored plan)."""
    plan_id: str
    format: Literal["pdf", "pptx"]
    slides: list[Slide] | None = None


# ---------------------------------------------------------------- news monitor (tab "Monitor INE")

Verdict = Literal["verdadera", "falsa", "enganosa", "sin_verificar"]
NewsTopic = Literal[
    "confianza_institucional",
    "presupuesto_recortes",
    "organizacion_casillas",
    "credencial_padron",
    "seguridad_violencia",
    "conducta_funcionarios",
    "resultados_fraude",
    "procedimiento_votacion",
    "otra",
]
Platform = Literal["x", "facebook", "tiktok", "instagram", "youtube", "whatsapp", "telegram", "sitio_web", "otro"]
Persistence = Literal["coyuntural", "persistente", "estructural"]
SeverityLevel = Literal["baja", "media", "alta", "critica"]
ActionType = Literal[
    "registrar",              # INE is aware; logged, no public action
    "comunicado",             # institutional statement / clarification
    "campana_intervencion",   # targeted participation campaign (opens the simulator prefilled)
    "responder_corregir",     # reply to the posts with a correction
    "reportar_plataforma",    # report the posts/accounts to the platform
    "desmentido_oficial",     # official public denial (#INEdesmiente style) + reply + report
]
RegistryState = Literal[
    "pendiente", "enterado", "comunicado_emitido", "campana_planeada",
    "respondida", "reportada", "descartada",
]


class GeoScope(BaseModel):
    level: Literal["nacional", "estatal", "municipal"] = "nacional"
    ents: list[str] = []                     # 2-digit keys
    muns: list[str] = []                     # 5-digit cvegeo


class Engagement(BaseModel):
    likes: int | None = None
    shares: int | None = None
    comments: int | None = None
    views: int | None = None


class SocialPost(BaseModel):
    platform: Platform = "otro"
    url: str
    author: str | None = None                # public handle / page name exactly as published
    published: str | None = None             # ISO date/datetime when known
    engagement: Engagement = Engagement()
    excerpt: str = ""                        # <= 280 chars


class StateImpact(BaseModel):
    id: str                                  # ent "07" or cvegeo "07101"
    name: str
    level: Level
    delta_pp: float                          # + = more abstention (pp)
    delta_low_pp: float
    delta_high_pp: float
    votos_perdidos: int
    exposure: float                          # 0-1
    category_before: str
    category_after: str


class NewsImpact(BaseModel):
    level: Level                             # level of `units`
    ent: str | None = None                   # set when level == "mun" (drill-down of one state)
    delta_pp_national: float                 # LN-weighted over the whole country
    votos_perdidos_total: int
    units: list[StateImpact]                 # only units with delta_pp >= 0.05, sorted desc
    max_delta_pp: float
    assumptions: list[str]                   # Spanish, explicit parameters used
    params: dict[str, Any] = {}              # s_topic, intensity, persistence, decay, days_to_election...


class Virality(BaseModel):
    score: int                               # 0-100
    level: SeverityLevel                     # baja <25 <= media <50 <= alta <75 <= critica
    platforms: list[Platform] = []
    posts: list[SocialPost] = []
    reach_estimate: int | None = None        # sum of known views (None when no metric is known)
    growth: Literal["creciente", "estable", "decreciente", "desconocido"] = "desconocido"
    projected_score_7d: int                  # if ignored
    basis: list[str] = []                    # Spanish: which signals produced the score
    ignore_risk: str = ""                    # Spanish: what happens if INE ignores it


class Severity(BaseModel):
    level: SeverityLevel
    score: int                               # 0-100
    drivers: list[str] = []                  # Spanish reasons


class ReportTarget(BaseModel):
    platform: Platform
    url: str
    author: str | None = None
    reason: str                              # Spanish, platform policy angle ("desinformación electoral")


class Remediation(BaseModel):
    action: ActionType                       # decided deterministically by intel.severity
    secondary_actions: list[ActionType] = []
    measures: list[str] = []                 # GLM: concrete steps (<= 5)
    rationale: str = ""                      # GLM (or template)
    draft_message: str | None = None         # comunicado (<= 180 words) or reply (<= 280 chars)
    report_targets: list[ReportTarget] = []
    campaign_prefill: dict[str, Any] | None = None   # {"campaigns":[{lever,targeting,effect_pp,coverage,ents}]}
    deadline_hours: int = 72
    degraded: bool = False                   # True when texts are templates (GLM unavailable)


class RegistryEntry(BaseModel):
    item_id: str
    kind: Literal["news", "campaign"] = "news"
    status: RegistryState
    note: str = Field(default="", max_length=500)
    at: str = ""                             # ISO datetime (server time)
    actor: str = "operador"


class NewsItem(BaseModel):
    id: str                                  # sha1(normalized claim)[:12]
    kind: Literal["noticia", "rumor"]        # from the recognized-media scan or the social/unrecognized scan
    headline: str
    summary: str                             # <= 60 words
    claim: str                               # the specific checkable assertion
    published: str | None = None
    first_seen: str                          # ISO datetime of the scan that found it
    sources: list[SourceRef] = []
    verdict: Verdict = "sin_verificar"
    verdict_confidence: Confidence = "baja"
    verdict_rationale: str = ""
    fact_checks: list[SourceRef] = []        # tiers verificador / oficial
    topic: NewsTopic = "otra"
    geo: GeoScope = GeoScope()
    intensity: float = Field(default=0.5, ge=0, le=1)   # media salience 0.25/0.5/0.75/1.0
    persistence: Persistence = "coyuntural"
    impact: NewsImpact | None = None         # verdadera / enganosa
    virality: Virality | None = None         # falsa / enganosa / sin_verificar (and any item with posts)
    severity: Severity
    remediation: Remediation
    status: RegistryEntry | None = None      # latest registry entry (note stripped for public reads)


class MonitorScanRequest(BaseModel):
    window_days: Literal[7, 14, 30] = 14
    refresh: bool = False


class MonitorSnapshot(BaseModel):
    generated_at: str
    window_days: int
    items: list[NewsItem] = []
    counts: dict[str, int] = {}              # verdadera/falsa/enganosa/sin_verificar/critica/pendientes
    queries: list[str] = []
    sources_scanned: int = 0
    model: str = ""
    search_mode: Literal["grounding", "respaldo", "sin_internet"] = "grounding"   # added in ola-2-fix
    degraded: bool = False
    note: str | None = None
    next_scan_allowed_at: str | None = None


# ---------------------------------------------------------------- jobs

class Job(BaseModel):
    id: str
    kind: Literal["campaign", "monitor", "explain_context"]
    key: str                                 # campaign: unit_id|focus ; monitor: "w14"
    status: JobStatus = "queued"
    stage: str = ""                          # Spanish, shown to the user ("Investigando con Gemini…")
    progress: int = 0                        # 0-100
    created_at: str = ""
    finished_at: str | None = None
    error: str | None = None                 # Spanish, safe to show
    result: dict[str, Any] | None = None     # CampaignPlan / MonitorSnapshot (model_dump) when done


class IntelStatus(BaseModel):
    gemini_enabled: bool
    gemini_model: str
    search_mode: Literal["grounding", "respaldo", "sin_internet"] = "grounding"   # added in ola-2-fix: live circuit state
    gemini_last_model: str | None = None     # added in ola-2-fix: model that actually answered last
    llm_enabled: bool
    llm_model: str
    llm_effort: str
    operator_configured: bool
    budget_used: int
    budget_limit: int
    monitor_cooldown_min: int
