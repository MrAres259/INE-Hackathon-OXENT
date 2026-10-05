// MOCK DATA: Model metrics, backtest evaluations, and coefficients
import type { ModelMetrics } from "../types";

export const MOCK_METRICS: ModelMetrics = {
  target_year: 2027,
  train_years: [2009, 2012, 2015, 2018, 2021],
  backtests: [
    {
      train_until: 2018,
      test_year: 2021,
      mae_pp: 3.42,
      baseline_mae_pp: 4.85,
      rmse_pp: 4.65,
      spearman: 0.812,
      n: 2469,
    },
    {
      train_until: 2021,
      test_year: 2024,
      mae_pp: 3.18,
      baseline_mae_pp: 4.50,
      rmse_pp: 4.29,
      spearman: 0.846,
      n: 2475,
    },
  ],
  coefficients: [
    { key: "part_lag1", label: "Participación en elección intermedia anterior (T-6)", coef_pp_per_sd: 4.85 },
    { key: "part_lag2", label: "Participación en elección federal previa (T-3)", coef_pp_per_sd: 2.92 },
    { key: "trend_pp", label: "Tendencia histórica municipal (pp/elección)", coef_pp_per_sd: 2.45 },
    { key: "graproes", label: "Grado de escolaridad promedio (INEGI)", coef_pp_per_sd: 1.84 },
    { key: "pct_internet", label: "Viviendas con disponibilidad de internet (INEGI)", coef_pp_per_sd: 1.15 },
    { key: "pct_rural", label: "Porcentaje de población rural (INEGI)", coef_pp_per_sd: -0.95 },
    { key: "pct_18_24", label: "Proporción de población joven 18-24 años (INEGI)", coef_pp_per_sd: -1.72 },
    { key: "pct_sin_servsalud", label: "Población sin afiliación a salud (INEGI)", coef_pp_per_sd: -0.68 },
    { key: "im_2020", label: "Índice de marginación municipal (CONAPO)", coef_pp_per_sd: -1.34 },
  ],
  generated_at: "2026-10-04T12:00:00Z",
  data_sources: [
    { name: "INE Resultados Electorales DIP_FED", file: "data/build/participation_ine.parquet", rows: 14820 },
    { name: "INEGI Censo de Población y Vivienda 2020 (ITER)", file: "data/build/features.parquet", rows: 2475 },
    { name: "CONAPO Índice de Marginación Municipal 2020", file: "data/raw/conapo/IMM_2020.xlsx", rows: 2475 },
    { name: "Catálogo y Geometría Canónica Marco Geoestadístico", file: "data/seed/states.csv", rows: 32 },
  ],
};
