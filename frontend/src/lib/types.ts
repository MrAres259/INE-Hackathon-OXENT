// ATALAYA Frontend Types - Strict alignment with temp/atalaya/00-CONTEXT.md §7

export type Category = "verde" | "amarillo" | "naranja" | "rojo" | "sin_dato";
export type Level = "state" | "mun";
export type ScenarioId = "base" | "intervencion" | "pesimista";

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
  participation: number;
  lista_nominal: number;
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

export type Meta = {
  target_year: number;
  years: number[];
  states: { id: string; name: string }[];
  scenarios: ScenarioDef[];
  categories: { id: Category; label: string; color: string; rule: string }[];
  store: "es" | "memory";
  llm: boolean;
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
  n: number;
};

export type ModelMetrics = {
  target_year: number;
  train_years: number[];
  backtests: Backtest[];
  coefficients: { key: string; label: string; coef_pp_per_sd: number }[];
  structural_r2?: number | null;
  forecast_coefficients?: { key: string; label: string; coef_pp_per_sd: number }[] | null;
  generated_at: string;
  data_sources: { name: string; file: string; rows: number }[];
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
