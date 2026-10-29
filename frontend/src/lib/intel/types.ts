// Atalaya Electoral · Inteligencia — TS mirror of temp/intel/contract/schemas.py.
// Copied verbatim to frontend/src/lib/intel/types.ts (owner W1-H). Same field names as the API (snake_case).

export type Level = "state" | "mun";
export type Lever = "promocion_jovenes" | "casillas_rurales" | "materiales_lengua_indigena" | "campana_general";
export type Targeting = "rojo" | "rojo_naranja" | "todos";
export type SourceTier =
  | "oficial" | "verificador" | "academico" | "medio_reconocido" | "medio_regional" | "no_reconocido" | "red_social";
export type Confidence = "alta" | "media" | "baja";
export type JobStatus = "queued" | "running" | "done" | "error";
export type SearchMode = "grounding" | "respaldo" | "sin_internet";

export interface SourceRef {
  id: string; url: string; title: string; domain: string;
  outlet?: string | null; tier: SourceTier; published?: string | null;
}

// ---------------------------------------------------------------- campaign planner
export type FindingCategory =
  | "desconfianza_institucional" | "inseguridad_violencia" | "acceso_casillas_distancia" | "desinformacion"
  | "apatia_desafeccion" | "barreras_documentales_credencial" | "migracion_movilidad"
  | "exclusion_linguistica_cultural" | "condiciones_socioeconomicas" | "otra";

export interface CampaignRequest { unit_id: string; focus?: string | null; refresh?: boolean }

export interface Finding {
  id: string; title: string; summary: string; category: FindingCategory; evidence: string[];
  scope: "municipio" | "estado" | "nacional"; confidence: Confidence;
}

export interface ResearchBundle {
  unit_id: string; unit_name: string; level: Level; findings: Finding[]; sources: SourceRef[];
  discarded_sources: number; queries: string[]; generated_at: string; model: string;
  from_cache: boolean; search_mode?: SearchMode; degraded: boolean; note?: string | null;
}

export interface DriverBrief { label: string; contribution_pp: number }

export interface DataSnapshot {
  unit_id: string; name: string; level: Level; ent: string; ent_name: string; lista_nominal: number;
  pred_abstention: number | null; pred_low: number | null; pred_high: number | null;
  category: string; risk_score: number | null; last_participation: number | null; last_year: number | null;
  trend_pp: number | null; abstencion_esperada: number | null;
  part_18_34_last?: number | null; gap_youth_pp_last?: number | null; pct_18_24?: number | null;
  pct_rural?: number | null; pct_hli?: number | null; pct_internet?: number | null; im_2020?: number | null;
  drivers: DriverBrief[]; recommendations: string[]; municipios?: number | null; municipios_rojos?: number | null;
}

export interface TargetGroup { name: string; description: string; size_estimate?: number | null; size_basis: string }

export interface Proposal {
  id: string; title: string; description: string; lever: Lever; channels: string[]; target_group: string;
  addresses: string[]; effect_pp: number; coverage: number; targeting: Targeting; rationale: string;
}

export interface ProposalImpact { proposal_id: string; lever: Lever; votos_solo: number }

export interface ImpactAnalysis {
  campaigns: Array<{ lever: Lever; targeting: Targeting; effect_pp: number; coverage: number; ents: string[] }>;
  abstention_base: number | null; abstention_scenario: number | null; delta_pp: number | null;
  votos_adicionales: number; category_before: string; category_after: string;
  municipios_mejoran?: number | null; per_proposal: ProposalImpact[]; overlap_votos: number; assumptions: string[];
}

export interface ImplementationStep {
  order: number; phase: string; start: string; end: string; actions: string[]; responsible: string; kpi: string;
}

export interface RiskItem { risk: string; mitigation: string }

export type SlideKind =
  | "portada" | "diagnostico_datos" | "problematicas" | "region" | "grupo_objetivo"
  | "propuestas" | "impacto" | "implementacion" | "riesgos_kpis" | "fuentes";

export interface Slide {
  id: string; kind: SlideKind; title: string; subtitle?: string | null;
  bullets: string[]; notes: string; data: Record<string, unknown>;
}

export interface LLMInfo { model: string; effort: string; degraded: boolean }

export interface CampaignPlan {
  id: string; unit: DataSnapshot; research: ResearchBundle; focus?: string | null; objective: string;
  target_groups: TargetGroup[]; proposals: Proposal[]; impact: ImpactAnalysis; steps: ImplementationStep[];
  risks: RiskItem[]; kpis: string[]; slides: Slide[]; generated_at: string; llm: LLMInfo; disclaimer: string;
}

export interface SlidesOverride { plan_id: string; format: "pdf" | "pptx"; slides?: Slide[] | null }

// ---------------------------------------------------------------- news monitor
export type Verdict = "verdadera" | "falsa" | "enganosa" | "sin_verificar";
export type NewsTopic =
  | "confianza_institucional" | "presupuesto_recortes" | "organizacion_casillas" | "credencial_padron"
  | "seguridad_violencia" | "conducta_funcionarios" | "resultados_fraude" | "procedimiento_votacion" | "otra";
export type Platform = "x" | "facebook" | "tiktok" | "instagram" | "youtube" | "whatsapp" | "telegram" | "sitio_web" | "otro";
export type Persistence = "coyuntural" | "persistente" | "estructural";
export type SeverityLevel = "baja" | "media" | "alta" | "critica";
export type ActionType =
  | "registrar" | "comunicado" | "campana_intervencion" | "responder_corregir" | "reportar_plataforma" | "desmentido_oficial";
export type RegistryState =
  | "pendiente" | "enterado" | "comunicado_emitido" | "campana_planeada" | "respondida" | "reportada" | "descartada";

export interface GeoScope { level: "nacional" | "estatal" | "municipal"; ents: string[]; muns: string[] }
export interface Engagement { likes?: number | null; shares?: number | null; comments?: number | null; views?: number | null }
export interface SocialPost {
  platform: Platform; url: string; author?: string | null; published?: string | null; engagement: Engagement; excerpt: string;
}

export interface StateImpact {
  id: string; name: string; level: Level; delta_pp: number; delta_low_pp: number; delta_high_pp: number;
  votos_perdidos: number; exposure: number; category_before: string; category_after: string;
}

export interface NewsImpact {
  level: Level; ent?: string | null; delta_pp_national: number; votos_perdidos_total: number;
  units: StateImpact[]; max_delta_pp: number; assumptions: string[]; params: Record<string, unknown>;
}

export interface Virality {
  score: number; level: SeverityLevel; platforms: Platform[]; posts: SocialPost[]; reach_estimate?: number | null;
  growth: "creciente" | "estable" | "decreciente" | "desconocido"; projected_score_7d: number;
  basis: string[]; ignore_risk: string;
}

export interface Severity { level: SeverityLevel; score: number; drivers: string[] }
export interface ReportTarget { platform: Platform; url: string; author?: string | null; reason: string }

export interface Remediation {
  action: ActionType; secondary_actions: ActionType[]; measures: string[]; rationale: string;
  draft_message?: string | null; report_targets: ReportTarget[];
  campaign_prefill?: { campaigns: ImpactAnalysis["campaigns"] } | null; deadline_hours: number; degraded: boolean;
}

export interface RegistryEntry {
  item_id: string; kind: "news" | "campaign"; status: RegistryState; note: string; at: string; actor: string;
}

export interface NewsItem {
  id: string; kind: "noticia" | "rumor"; headline: string; summary: string; claim: string;
  published?: string | null; first_seen: string; sources: SourceRef[]; verdict: Verdict;
  verdict_confidence: Confidence; verdict_rationale: string; fact_checks: SourceRef[]; topic: NewsTopic;
  geo: GeoScope; intensity: number; persistence: Persistence; impact?: NewsImpact | null;
  virality?: Virality | null; severity: Severity; remediation: Remediation; status?: RegistryEntry | null;
}

export interface MonitorScanRequest { window_days?: 7 | 14 | 30; refresh?: boolean }

export interface MonitorSnapshot {
  generated_at: string; window_days: number; items: NewsItem[]; counts: Record<string, number>;
  queries: string[]; sources_scanned: number; model: string; search_mode?: SearchMode; degraded: boolean; note?: string | null;
  next_scan_allowed_at?: string | null;
}

// ---------------------------------------------------------------- jobs / status
export interface Job<T = unknown> {
  id: string; kind: "campaign" | "monitor"; key: string; status: JobStatus; stage: string; progress: number;
  created_at: string; finished_at?: string | null; error?: string | null; result?: T | null;
}

export interface IntelStatus {
  gemini_enabled: boolean; gemini_model: string; search_mode?: SearchMode; gemini_last_model?: string | null; llm_enabled: boolean; llm_model: string; llm_effort: string;
  operator_configured: boolean; budget_used: number; budget_limit: number; monitor_cooldown_min: number;
}
