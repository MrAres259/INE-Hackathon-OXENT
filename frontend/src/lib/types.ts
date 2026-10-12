// ATALAYA Frontend Types - Strict alignment with temp/atalaya/00-CONTEXT.md §7

export type Category = "verde" | "amarillo" | "naranja" | "rojo" | "sin_dato";
export type Level = "state" | "mun";
export type ScenarioId = "base" | "intervencion" | "pesimista";
export type MapMode = "semaforo" | "delta" | "compare";

export type RiskItem = {
  id: string;
  name: string;
  level: Level;
  ent: string; // cve_ent (2 digits)
  lista_nominal: number | null;
  last_year: number | null;
  last_participation: number | null; // 0..1, última DIP_FED
  pred_participation: number | null;
  pred_abstention: number | null; // 0..1, año objetivo, escenario aplicado
  pred_low: number | null;
  pred_high: number | null; // intervalo sobre abstención
  trend_pp: number | null;
  risk_score: number | null; // 0..100
  category: Category;
  delta_vs_base_pp?: number | null; // solo si scenario != base (negativo = menos abstención)
  // Optional prioritization and 4 risk score components (Ola 4)
  vulnerability_pp?: number | null;
  abstencion_esperada?: number | null;
  prioridad?: number | null;
  r_abs?: number | null;
  r_vuln?: number | null;
  r_trend?: number | null;
  r_vol?: number | null;
  reliable?: boolean | null;
  ns_rate?: number | null;
};

export type Feature = {
  key: string;
  label: string;
  value: number | string | null;
  unit: string;
  national_median: number | null;
};

export type Driver = {
  key: string;
  label: string;
  contribution_pp: number;
  direction: "sube_abstencion" | "baja_abstencion";
};

export type Recommendation = {
  id: string;
  title: string;
  rationale: string;
  priority: "alta" | "media" | "baja";
  lever: string;
  source: "rules" | "llm";
};

export type SeriesPoint = {
  year: number;
  election: string;
  participation: number | null;
  lista_nominal: number;
  reliable?: boolean | null;
  low_confidence?: boolean | null;
  ns_rate?: number | null;
};

export type ProfilePoint = {
  year: number;
  age_group: string;
  sexo: string; // 'H' | 'M' | 'X'
  ln: number | null;
  participation: number | null;
  suprimido?: boolean;
};

export type RegionDetail = RiskItem & {
  parent: { id: string; name: string } | null;
  series: SeriesPoint[];
  features: Feature[];
  drivers: Driver[];
  scenarios: {
    scenario: ScenarioId;
    pred_abstention: number | null;
    category: Category;
  }[];
  recommendations: Recommendation[];
  // CCPC profile, PJ 2025, CCPC features & census flags (Ola 3/4)
  profile?: ProfilePoint[];
  profile_pj?: ProfilePoint[];
  pj_2025?: { participation: number | null } | null;
  part_pj_2025?: number | null;
  ccpc?: {
    pct_ln_18_34?: number | null;
    part_18_34?: number | null;
    gap_youth_pp?: number | null;
    gap_sexo_pp?: number | null;
    pct_ln_rural?: number | null;
  } | null;
  imputed_census?: boolean | null;
};

export type ScenarioParam = {
  key: string;
  label: string;
  type: "number" | "select";
  min?: number;
  max?: number;
  step?: number;
  default: number | string;
  options?: { value: string; label: string }[];
  unit?: string;
};

export type ScenarioDef = {
  id: ScenarioId;
  label: string;
  description: string;
  params: ScenarioParam[];
};

export type MetaDataSource = {
  name: string;
  url?: string;
  file?: string;
  rows?: number;
  years?: number[];
};

export type Meta = {
  target_year: number;
  years: number[];
  states: { id: string; name: string }[];
  scenarios: ScenarioDef[];
  categories: { id: Category; label: string; color: string; rule: string }[];
  store: "es" | "memory";
  llm: boolean;
  data_sources?: MetaDataSource[];
};

export type ScenarioRequest = {
  scenario: ScenarioId;
  params?: Record<string, number | string>;
  level: Level;
  ent?: string | null;
};

export type ScenarioSummary = {
  n_units: number;
  by_category: Record<Category, number>;
  by_category_base: Record<Category, number>;
  votos_adicionales: number;
  mean_delta_pp: number;
};

export type ScenarioResult = {
  scenario: ScenarioId;
  params: Record<string, number | string>;
  level: Level;
  items: RiskItem[];
  summary: ScenarioSummary;
};

export type Backtest = {
  train_until: number;
  test_year: number;
  mae_pp: number;
  baseline_mae_pp?: number;
  rmse_pp: number;
  spearman: number;
  top20_hit?: number;
  n: number;
};

export type CandidateFold = {
  train_until: number;
  test_year: number;
  mae_pp: number;
  rmse_pp: number;
  spearman: number;
  top20_hit?: number;
  n: number;
  baseline_mae_pp?: number;
};

export type CandidateModel = {
  name: string;
  folds: CandidateFold[];
  mean_mae_pp?: number;
};

export type ModelMetrics = {
  target_year: number;
  train_years: number[];
  backtests: Backtest[];
  coefficients: { key: string; label: string; coef_pp_per_sd: number }[];
  structural_r2?: number | null;
  structural_r2_within_state?: number | null;
  between_state_share?: number | null;
  calibration_pp?: number | null;
  forecast_coefficients?: { key: string; label: string; coef_pp_per_sd: number }[] | null;
  generated_at: string;
  data_sources: { name: string; file?: string; url?: string; rows?: number; years?: number[] }[];
  candidates?: CandidateModel[];
  selected_model?: string;
  national_level_assumption?: number | null;
  offset_pp?: number | null;
  reliability_rule?: string | null;
  excluded_unreliable?: Record<string, number> | null;
  drivers_low_confidence?: boolean | null;
};

export type HealthResponse = {
  status: string;
  store: "es" | "memory";
  llm: boolean;
  warmup: "ready" | "loading";
  data: {
    units_mun: number;
    units_state: number;
    participation_rows: number;
    years: number[];
  };
};

export type GeoIndexState = {
  name: string;
  bbox: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  centroid: [number, number]; // [lon, lat]
};

export type GeoIndexMun = {
  name: string;
  ent: string;
  centroid: [number, number]; // [lon, lat]
};

export type GeoIndexFile = {
  states: Record<string, GeoIndexState>;
  mun: Record<string, GeoIndexMun>;
};

export type GeoIndexItem = {
  id: string;
  name: string;
  level: Level;
  ent: string;
  bbox?: [number, number, number, number];
  centroid?: [number, number];
};

export type ChatRequest = {
  message: string;
  history: { role: "user" | "assistant"; content: string }[];
  region_id?: string | null;
};

export type ChatPlan = {
  intent: string;
  query: Record<string, unknown> | string;
};

export type ChatData = {
  columns: string[];
  rows: (string | number | null)[][];
  source: string;
};

export type ChatDone = {
  sources: string[];
  degraded: boolean;
};

export type ChatStreamHandlers = {
  onPlan?: (plan: ChatPlan) => void;
  onData?: (data: ChatData) => void;
  onToken?: (token: { text: string }) => void;
  onDone?: (done: ChatDone) => void;
  onError?: (err: { message: string }) => void;
};
