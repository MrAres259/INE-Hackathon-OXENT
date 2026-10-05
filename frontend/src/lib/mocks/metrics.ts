// MOCK DATA: Model metrics, backtest evaluations, candidates, and coefficients
import type { ModelMetrics } from "../types";

export const MOCK_METRICS: ModelMetrics = {
  target_year: 2027,
  train_years: [2009, 2012, 2015, 2018, 2021, 2024],
  backtests: [
    {
      train_until: 2018,
      test_year: 2021,
      mae_pp: 5.95,
      baseline_mae_pp: 6.50,
      rmse_pp: 7.97,
      spearman: 0.84,
      top20_hit: 0.676,
      n: 2314,
    },
    {
      train_until: 2021,
      test_year: 2024,
      mae_pp: 6.05,
      baseline_mae_pp: 6.80,
      rmse_pp: 8.32,
      spearman: 0.805,
      top20_hit: 0.696,
      n: 2349,
    },
  ],
  candidates: [
    {
      name: "persist_l1",
      mean_mae_pp: 6.0,
      folds: [
        { train_until: 2018, test_year: 2021, mae_pp: 5.95, rmse_pp: 7.97, spearman: 0.84, top20_hit: 0.676, n: 2314, baseline_mae_pp: 5.95 },
        { train_until: 2021, test_year: 2024, mae_pp: 6.05, rmse_pp: 8.32, spearman: 0.805, top20_hit: 0.696, n: 2349, baseline_mae_pp: 6.05 },
      ],
    },
    {
      name: "persist_l2",
      mean_mae_pp: 8.12,
      folds: [
        { train_until: 2018, test_year: 2021, mae_pp: 11.91, rmse_pp: 14.2, spearman: 0.496, top20_hit: 0.419, n: 2314, baseline_mae_pp: 5.95 },
        { train_until: 2021, test_year: 2024, mae_pp: 4.32, rmse_pp: 5.92, spearman: 0.843, top20_hit: 0.685, n: 2349, baseline_mae_pp: 6.05 },
      ],
    },
    {
      name: "mean_l1_l2",
      mean_mae_pp: 6.11,
      folds: [
        { train_until: 2018, test_year: 2021, mae_pp: 7.73, rmse_pp: 9.64, spearman: 0.726, top20_hit: 0.611, n: 2314, baseline_mae_pp: 5.95 },
        { train_until: 2021, test_year: 2024, mae_pp: 4.49, rmse_pp: 6.05, spearman: 0.847, top20_hit: 0.749, n: 2349, baseline_mae_pp: 6.05 },
      ],
    },
    {
      name: "ridge",
      mean_mae_pp: 6.72,
      folds: [
        { train_until: 2018, test_year: 2021, mae_pp: 8.42, rmse_pp: 10.47, spearman: 0.679, top20_hit: 0.577, n: 2314, baseline_mae_pp: 5.95 },
        { train_until: 2021, test_year: 2024, mae_pp: 5.03, rmse_pp: 6.54, spearman: 0.812, top20_hit: 0.672, n: 2349, baseline_mae_pp: 6.05 },
      ],
    },
  ],
  selected_model: "persist_l1",
  national_level_assumption: 51.84,
  offset_pp: 5.81,
  structural_r2: 0.30,
  structural_r2_within_state: 0.27,
  between_state_share: 0.47,
  reliability_rule: "reliable = (ns_rate <= 0.5) and (participacion >= 0.02)",
  excluded_unreliable: {
    "2009": 16,
    "2012": 7,
    "2015": 67,
    "2018": 56,
    "2021": 26,
    "2024": 38,
  },
  drivers_low_confidence: false,
  coefficients: [
    { key: "graproes", label: "Grado de escolaridad promedio (INEGI)", coef_pp_per_sd: 2.15 },
    { key: "pct_internet", label: "Viviendas con disponibilidad de internet (INEGI)", coef_pp_per_sd: 1.35 },
    { key: "pct_rural", label: "Porcentaje de población rural (INEGI)", coef_pp_per_sd: -0.85 },
    { key: "im_2020", label: "Índice de marginación municipal (CONAPO)", coef_pp_per_sd: -1.25 },
    { key: "pct_18_24", label: "Proporción de población joven 18-24 años (INEGI)", coef_pp_per_sd: -1.80 },
    { key: "pct_sin_servsalud", label: "Población sin afiliación a salud (INEGI)", coef_pp_per_sd: -0.65 },
  ],
  forecast_coefficients: [
    { key: "lag1", label: "Desviación participación en t-3", coef_pp_per_sd: 4.85 },
    { key: "lag2", label: "Desviación participación en t-6", coef_pp_per_sd: 2.92 },
    { key: "pres", label: "Efecto año de elección presidencial", coef_pp_per_sd: 8.40 },
    { key: "trend_pp", label: "Tendencia histórica municipal (pp/elección)", coef_pp_per_sd: 1.45 },
    { key: "graproes", label: "Grado de escolaridad promedio (INEGI)", coef_pp_per_sd: 0.15 },
    { key: "pct_18_24", label: "Proporción de jóvenes 18-24 años (INEGI)", coef_pp_per_sd: -0.09 },
  ],
  generated_at: "2026-10-05T12:00:00Z",
  data_sources: [
    { name: "Plataforma CCPC 2009–2024 (INE)", file: "data/build/participation.parquet", rows: 17222 },
    { name: "INEGI Censo de Población y Vivienda 2020 (ITER)", file: "data/build/features.parquet", rows: 2478 },
    { name: "CONAPO Índice de Marginación Municipal 2020", file: "data/raw/conapo/IMM_2020.csv", rows: 2469 },
    { name: "Marco Geoestadístico 2024 (INEGI)", file: "data/seed/states.csv", rows: 32 },
  ],
};
