// CONTRATO — ola "Cambios mayores". Copiar TAL CUAL a frontend/src/lib/explain/types.ts (solo W1-F lo crea).
// Espejo exacto de temp/cambios-mayores/contract/explain_schemas.py. Nadie lo modifica salvo el arquitecto.

export type ExplainLevel = "state" | "mun";
export type Strength = "fuerte" | "moderada" | "debil";
export type EvidenceType = "dato_medido" | "calculo_del_modelo" | "asociacion" | "contexto_descriptivo";
export type ReasonKind =
  | "semaforo"
  | "historial"
  | "quien_no_vota"
  | "urbano_rural"
  | "tendencia"
  | "volatilidad"
  | "perfil_territorial"
  | "contexto"
  | "confiabilidad";
export type Direction = "sube_abstencion" | "baja_abstencion" | "neutral";

export interface ExplainNumber {
  key: string;
  label: string;
  value: number | null;
  unit: "pct" | "pp" | "personas" | "elecciones" | "indice" | "ratio";
  display: string;
}

export interface ExplainReason {
  id: string;
  kind: ReasonKind;
  title: string;
  body: string;
  strength: Strength;
  evidence_type: EvidenceType;
  direction: Direction;
  numbers: ExplainNumber[];
  source: string;
}

export interface ScoreComponent {
  key: "abs" | "vuln" | "trend" | "vol";
  label: string;
  weight: number;
  rank_pct: number;
  points: number;
  plain: string;
}

export interface GroupGap {
  group: string;
  participation_pct: number | null;
  share_ln_pct: number | null;
  share_abstainers_pct: number | null;
  suppressed: boolean;
}

export interface ExplainRecommendation {
  title: string;
  rationale: string;
  priority: "alta" | "media" | "baja";
}

export type SuggestedIntent = "explain_unit" | "profile" | "trend" | "compare" | "context_news" | "recommend";

export interface SuggestedQuestion {
  id: string;
  text: string;
  intent_hint: SuggestedIntent;
}

export interface Explanation {
  unit_id: string;
  level: ExplainLevel;
  name: string;
  state_name: string | null;
  category: string;
  risk_score: number | null;
  pred_abstention_pct: number | null;
  headline: string;
  in_short: string[];
  reasons: ExplainReason[];
  score_breakdown: ScoreComponent[];
  groups: GroupGap[];
  what_we_dont_know: string[];
  confidence: "alta" | "media" | "baja";
  confidence_note: string;
  recommendations: ExplainRecommendation[];
  suggested_questions: SuggestedQuestion[];
  sources: string[];
  data_year: number | null;
  scenario_note: string;
  generated_at: string;
}

export type Verification = "cita_verificada" | "fuente_verificada" | "sin_verificar";

export interface ContextSource {
  url: string;
  title: string;
  domain: string;
  outlet: string | null;
  tier: string;
  published: string | null;
}

export interface ContextFinding {
  id: string;
  title: string;
  summary: string;
  category: string;
  category_label: string;
  scope: "municipio" | "estado" | "nacional";
  verification: Verification;
  quote: string | null;
  sources: ContextSource[];
}

export interface ContextResult {
  unit_id: string;
  name: string;
  level: ExplainLevel;
  findings: ContextFinding[];
  search_mode: "grounding" | "respaldo" | "sin_internet";
  model: string;
  generated_at: string;
  from_cache: boolean;
  degraded: boolean;
  note: string | null;
  disclaimer: string;
}

// POST /api/explain/{id}/context responde:
//   200 { status: "done", context: ContextResult }   (había resultado en caché ≤ 72 h)
//   202 Job                                           (el Job de lib/intel/types, kind "explain_context";
//                                                      se sigue con pollJob de lib/intel/api; job.result = ContextResult)
// GET /api/explain/{id}/context -> 200 ContextResult en caché o 404 si no hay.
export interface ContextCached {
  status: "done";
  context: ContextResult;
}

// Extensiones del SSE de /api/chat (opcionales; el backend viejo no las manda).
export interface ChatAction {
  type: "context_research";
  unit_id: string;
  label: string; // "Buscar noticias y hechos recientes (≈ 1–3 min)"
}

// Se agregan a ChatData (evento `data`) y ChatDone (evento `done`) en src/lib/types.ts:
//   ChatData.explanation?: Explanation | null
//   ChatData.context?: ContextResult | null
//   ChatDone.suggestions?: SuggestedQuestion[]
//   ChatDone.action?: ChatAction | null
