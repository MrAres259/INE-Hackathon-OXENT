"""Build pipeline for ATALAYA abstention risk model with relative deviations and candidate selection."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

import numpy as np
import pandas as pd

from atalaya import config
from atalaya.ingest.common import read_parquet, write_parquet, to_num, zpad
from atalaya.model.panel import (
    load_inputs,
    load_concurrencia,
    get_gov_concurrence_set,
    is_gubernatorial,
    compute_reliable,
    participation_matrix,
    lista_nominal_matrix,
    deviation_matrix,
    intermediate_offset,
    unit_trend,
    training_rows,
    is_presidential,
    intermediate_turnout,
    intermediate_ccpc_features,
    CCPC_FEATURE_COLUMNS,
)
from atalaya.model.forecast import (
    fit_ridge,
    fit_structural,
    predict,
    contributions,
    contributions_structural,
    backtest_candidates,
    BASE_FEATURES,
    CCPC_FEATURES,
    FEATURES,
    PREDICTORS,
    RIDGE_RELATIVE_PREDICTORS,
    CANDIDATE_NAMES,
    StructuralModel,
)

try:
    from atalaya.model.risk import compute_risk
except ImportError:
    compute_risk = None


UNITS_COLUMNS = [
    "id",
    "level",
    "cve_ent",
    "name",
    "lista_nominal",
    "last_year",
    "last_participation",
    "pred_participation",
    "pred_abstention",
    "pred_low",
    "pred_high",
    "trend_pp",
    "volatility_pp",
    "risk_score",
    "category",
    "coverage_ln",
    "nom_ent",
    "nom_mun",
    "pob_tot",
    "pob_18ymas",
    "pct_18_24",
    "pct_65ymas",
    "graproes",
    "pct_hli",
    "pct_sin_servsalud",
    "pct_internet",
    "pct_rural",
    "pct_analfabeta",
    "pct_po2sm",
    "im_2020",
    "gm_2020",
    "part_pj_2025",
    "part_18_34_last",
    "gap_youth_pp_last",
    "gap_sexo_pp_last",
    "pct_ln_rural_last",
    "imputed_census",
    "pred_dev_pp",
    "fallback_model",
    "last_reliable_year",
    "struct_pred_dev_pp",
    "vulnerability_pp",
    "r_abs",
    "r_vuln",
    "r_trend",
    "r_vol",
    "abstencion_esperada",
    "prioridad",
]

DRIVERS_COLUMNS = [
    "id",
    "level",
    "key",
    "label",
    "contribution_pp",
    "direction",
    "rank",
]


def load_seed_maps(seed_dir: Path) -> tuple[dict[str, str], dict[str, str]]:
    """Load states name mapping and variables labels."""
    states_path = seed_dir / "states.csv"
    vars_path = seed_dir / "variables.csv"

    states_map: dict[str, str] = {}
    if states_path.is_file():
        try:
            st_df = pd.read_csv(states_path, dtype=str)
            for _, r in st_df.iterrows():
                cve = zpad(r.get("cve_ent", ""), 2)
                states_map[cve] = str(r.get("name", "")).strip()
        except Exception:
            pass

    label_map: dict[str, str] = {}
    if vars_path.is_file():
        try:
            v_df = pd.read_csv(vars_path, dtype=str)
            for _, r in v_df.iterrows():
                k = str(r.get("key", "")).strip()
                lbl = str(r.get("label_es", "")).strip()
                if k:
                    label_map[k] = lbl
        except Exception:
            pass

    # Standard overrides / labels
    label_map["coverage_ln"] = "Cobertura de lista nominal"
    label_map["log_pob_18ymas"] = "Tamaño de la población adulta"
    label_map["lag1"] = "Desviación participación t-3"
    label_map["lag2"] = "Desviación participación t-6"
    label_map["gov_T"] = "Concurrencia gubernatura t"
    label_map["gov_lag1"] = "Concurrencia gubernatura t-3"
    label_map["gov_lag2"] = "Concurrencia gubernatura t-6"
    label_map["gov_mean"] = "Frecuencia de concurrencia de gubernatura"
    label_map["pres"] = "Ciclo presidencial"

    ccpc_defaults = {
        "pct_ln_18_34": "Peso de jóvenes 18–34 en la lista nominal",
        "gap_youth_pp": "Brecha de participación juvenil",
        "gap_sexo_pp": "Brecha de participación mujeres–hombres",
        "pct_ln_rural": "Lista nominal en secciones rurales",
        "ns_rate": "Registros no especificados",
    }
    for k, v in ccpc_defaults.items():
        if k not in label_map:
            label_map[k] = v

    return states_map, label_map


def build_fallback_artifacts(
    part: pd.DataFrame,
    feats: pd.DataFrame,
    build_dir: Path,
    seed_dir: Path,
    target_year: int,
    national_level: float = 51.84,
) -> int:
    """Produce base artifacts when data is insufficient for training."""
    print("Aviso: Datos insuficientes de participación DIP_FED (< 3 años). Generando artefactos base sin predicción.")

    states_map, _ = load_seed_maps(seed_dir)
    mun_rows = []

    if not feats.empty and "cvegeo" in feats.columns:
        feats_copy = feats.copy()
        for _, r in feats_copy.iterrows():
            cvegeo = str(r["cvegeo"]).strip()
            ent = zpad(r.get("cve_ent", cvegeo[:2]), 2)
            row_dict = {col: np.nan for col in UNITS_COLUMNS}
            row_dict["id"] = cvegeo
            row_dict["level"] = "mun"
            row_dict["cve_ent"] = ent
            row_dict["name"] = str(r.get("nom_mun", f"Municipio {cvegeo}"))
            row_dict["category"] = "sin_dato"
            row_dict["imputed_census"] = False
            row_dict["fallback_model"] = None
            for col in [
                "nom_ent", "nom_mun", "pob_tot", "pob_18ymas", "pct_18_24",
                "pct_65ymas", "graproes", "pct_hli", "pct_sin_servsalud",
                "pct_internet", "pct_rural", "pct_analfabeta", "pct_po2sm",
                "im_2020", "gm_2020",
            ]:
                if col in r:
                    row_dict[col] = r[col]
            mun_rows.append(row_dict)

    units_df = pd.DataFrame(mun_rows, columns=UNITS_COLUMNS) if mun_rows else pd.DataFrame(columns=UNITS_COLUMNS)

    # State rows if feats has municipalities
    if not units_df.empty:
        state_rows = []
        for ent, grp in units_df.groupby("cve_ent"):
            pob_tot = to_num(grp["pob_tot"]).sum()
            pob_18 = to_num(grp["pob_18ymas"]).sum()
            st_dict = {col: np.nan for col in UNITS_COLUMNS}
            st_dict["id"] = ent
            st_dict["level"] = "state"
            st_dict["cve_ent"] = ent
            st_dict["name"] = states_map.get(ent, f"Estado {ent}")
            st_dict["category"] = "sin_dato"
            st_dict["imputed_census"] = False
            st_dict["fallback_model"] = None
            st_dict["pob_tot"] = pob_tot
            st_dict["pob_18ymas"] = pob_18
            state_rows.append(st_dict)
        if state_rows:
            units_df = pd.concat([units_df, pd.DataFrame(state_rows, columns=UNITS_COLUMNS)], ignore_index=True)

    drivers_df = pd.DataFrame(columns=DRIVERS_COLUMNS)

    metrics_data = {
        "target_year": target_year,
        "train_years": [],
        "backtests": [],
        "coefficients": [],
        "forecast_coefficients": [],
        "structural_r2": 0.0,
        "lambda": 10.0,
        "sigma_pp": 0.0,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "data_sources": [
            {"name": "participation", "file": "participation.parquet", "rows": len(part)},
            {"name": "features", "file": "features.parquet", "rows": len(feats)},
        ],
        "candidates": [],
        "selected_model": "persist_l1",
        "national_level_assumption": round(national_level, 2),
        "calibration_pp": 0.0,
        "offset_pp": 0.0,
        "structural_r2_within_state": 0.0,
        "structural_r2_state_cv": 0.0,
        "between_state_share": 0.0,
        "reliability_rule": "reliable = (ns_rate <= 0.5) and (participacion >= 0.02)",
        "excluded_unreliable": {},
        "drivers_low_confidence": True,
    }

    model_data = {
        "features": list(FEATURES),
        "means": {},
        "stds": {},
        "medians": {},
        "coef": {},
        "intercept": 0.0,
        "lambda": 10.0,
        "sigma_pp": 0.0,
        "train_years": [],
        "target_year": target_year,
        "selected_model": "persist_l1",
        "national_level_assumption": round(national_level, 2),
        "calibration_pp": 0.0,
        "offset_pp": 0.0,
        "structural": {
            "features": list(FEATURES),
            "means": {},
            "stds": {},
            "medians": {},
            "coef": {},
            "intercept": 0.0,
            "lambda": 10.0,
            "cv_r2": 0.0,
            "structural_r2": 0.0,
            "structural_r2_within_state": 0.0,
            "structural_r2_state_cv": 0.0,
            "between_state_share": 0.0,
        },
    }

    write_parquet(units_df, build_dir / "units.parquet")
    write_parquet(drivers_df, build_dir / "drivers.parquet")
    (build_dir / "metrics.json").write_text(json.dumps(metrics_data, indent=2, ensure_ascii=False), encoding="utf-8")
    (build_dir / "model.json").write_text(json.dumps(model_data, indent=2, ensure_ascii=False), encoding="utf-8")
    return 0


def build_model(
    build_dir: Path | str | None = None,
    seed_dir: Path | str | None = None,
    target_year: int | None = None,
    national_level: float | None = None,
) -> int:
    """Run relative model training, scenario baseline predictions, and artifact exports."""
    b_dir = Path(build_dir) if build_dir is not None else config.BUILD_DIR
    s_dir = Path(seed_dir) if seed_dir is not None else config.SEED_DIR
    t_year = int(target_year) if target_year is not None else config.get_settings().target_year

    b_dir.mkdir(parents=True, exist_ok=True)
    states_map, label_map = load_seed_maps(s_dir)

    part, feats, ccpc_feats = load_inputs(b_dir, include_ccpc=True)

    # Concurrencia gubernatura
    gov_set = get_gov_concurrence_set(s_dir)

    # Assess reliability of participation data
    part = part.copy()
    part["reliable"] = compute_reliable(part)

    dip_part = part[part["election"] == "DIP_FED"] if ("election" in part.columns) else pd.DataFrame()
    distinct_years: list[int] = []
    excluded_unreliable: dict[str, int] = {}
    if not dip_part.empty and "year" in dip_part.columns:
        dip_part_clean = dip_part.copy()
        dip_part_clean["year_num"] = pd.to_numeric(dip_part_clean["year"], errors="coerce")
        for yr, grp in dip_part_clean.dropna(subset=["year_num"]).groupby("year_num"):
            yr_int = int(yr)
            distinct_years.append(yr_int)
            excluded_unreliable[str(yr_int)] = int((~grp["reliable"]).sum())
        distinct_years = sorted(list(set(distinct_years)))

    if len(distinct_years) < 3 or feats.empty:
        return build_fallback_artifacts(
            part,
            feats,
            b_dir,
            s_dir,
            t_year,
            national_level=national_level if national_level is not None else 51.84,
        )

    # 1. Pivot matrices (reliable only for participation)
    Y_rel = participation_matrix(part, election="DIP_FED", min_year=2009, value_col="participacion", reliable_only=True)
    L = lista_nominal_matrix(part, election="DIP_FED", min_year=2009)

    # Calculate relative deviations and unweighted means per year
    dev_matrix, unweighted_means = deviation_matrix(Y_rel)

    # Turnout offset between municipal unweighted mean and LN-weighted national turnout
    offset_pp = intermediate_offset(Y_rel, L, intermediate_years=(2009, 2015, 2021))

    # National level assumption (default = weighted turnout of last reliable intermediate election, 2021 = 51.84%)
    if national_level is not None:
        nat_assumption = float(national_level)
    else:
        inter_candidates = [y for y in [2021, 2015, 2009] if y in Y_rel.columns]
        last_inter_yr = inter_candidates[0] if inter_candidates else None
        nat_assumption = 51.84
        if last_inter_yr is not None and not dip_part.empty:
            inter_rows = dip_part[(dip_part["year"] == last_inter_yr) & (dip_part["reliable"])]
            vt_sum = to_num(inter_rows["votos_totales"]).sum()
            if "nv" in inter_rows.columns:
                nv_sum = to_num(inter_rows["nv"]).sum()
                denom = vt_sum + nv_sum
            else:
                denom = to_num(inter_rows["lista_nominal"]).sum()
            if denom > 0:
                nat_assumption = float(vt_sum / denom * 100.0)

    # 2. Enrich features with log_pob_18ymas and coverage_ln, and handle new_since_2020 imputation
    feats = feats.copy()
    if "cvegeo" in feats.columns:
        feats["cvegeo"] = feats["cvegeo"].astype(str).str.strip().apply(lambda v: zpad(v, 5))
    if "cve_ent" in feats.columns:
        feats["cve_ent"] = feats["cve_ent"].astype(str).str.strip().apply(lambda v: zpad(v, 2))
    elif "cvegeo" in feats.columns:
        feats["cve_ent"] = feats["cvegeo"].str[:2]

    is_new_mask = pd.Series(False, index=feats.index)
    if "new_since_2020" in feats.columns:
        is_new_mask = feats["new_since_2020"].fillna(False).astype(bool)

    CENSUS_COLS = [
        "pob_tot", "pob_18ymas", "pct_18_24", "pct_65ymas", "graproes",
        "pct_hli", "pct_sin_servsalud", "pct_internet", "pct_rural",
        "pct_analfabeta", "pct_po2sm", "im_2020",
    ]

    imputed_census_map: dict[str, bool] = {}
    for idx, r in feats.iterrows():
        cve = r["cvegeo"]
        imputed_census_map[cve] = bool(is_new_mask.loc[idx])

    if is_new_mask.any():
        non_new = feats[~is_new_mask]
        for col in CENSUS_COLS:
            if col in feats.columns:
                feats[col] = to_num(feats[col])
                st_meds = non_new.groupby("cve_ent")[col].median()
                nat_med = non_new[col].median()
                for idx in feats[is_new_mask].index:
                    ent = feats.loc[idx, "cve_ent"]
                    st_val = st_meds.get(ent, np.nan)
                    val = st_val if not np.isnan(st_val) else nat_med
                    if np.isnan(feats.loc[idx, col]):
                        feats.loc[idx, col] = val

    feats_idx = feats.set_index("cvegeo")

    # Latest nominal list per municipality
    latest_ln = pd.Series(dtype=float)
    if not L.empty:
        if 2024 in L.columns:
            latest_ln = to_num(L[2024])
        else:
            latest_ln = L.ffill(axis=1).iloc[:, -1]

    pob_18_num = to_num(feats_idx["pob_18ymas"]) if "pob_18ymas" in feats_idx.columns else pd.Series(np.nan, index=feats_idx.index)
    coverage_ln_series = (latest_ln.reindex(feats_idx.index) / pob_18_num.replace(0, np.nan)).clip(lower=0.0, upper=1.2)
    feats["coverage_ln"] = feats["cvegeo"].map(coverage_ln_series)

    log_pob_18 = np.log1p(pob_18_num.fillna(0).clip(lower=0))
    feats["log_pob_18ymas"] = feats["cvegeo"].map(log_pob_18)
    feats_idx = feats.set_index("cvegeo")

    # CCPC features availability
    has_ccpc = (
        ccpc_feats is not None
        and not ccpc_feats.empty
        and "year" in ccpc_feats.columns
        and "cvegeo" in ccpc_feats.columns
    )
    available_ccpc: list[str] = []
    ccpc_last_indexed = pd.DataFrame()
    if has_ccpc:
        available_ccpc = [c for c in CCPC_FEATURES if c in ccpc_feats.columns]
        ccpc_copy = ccpc_feats.copy()
        ccpc_copy["cvegeo"] = ccpc_copy["cvegeo"].astype(str).str.strip().apply(lambda v: zpad(v, 5))
        ccpc_copy["year"] = pd.to_numeric(ccpc_copy["year"], errors="coerce")
        valid_yrs = ccpc_copy[ccpc_copy["year"] <= 2024]["year"]
        last_ccpc_yr = int(valid_yrs.max()) if not valid_yrs.empty else None
        if last_ccpc_yr is not None:
            ccpc_last_indexed = ccpc_copy[ccpc_copy["year"] == last_ccpc_yr].drop_duplicates(subset=["cvegeo"]).set_index("cvegeo")

    active_features = list(BASE_FEATURES) + available_ccpc

    # 3. Candidate evaluation across backtest folds
    candidates, selected_model, backtests, lam = backtest_candidates(
        dev_matrix,
        feats,
        ccpc_feats=ccpc_feats,
        L=L,
        seed_dir=s_dir,
    )

    # Train final Ridge model with all available training targets <= 2024
    train_targets = [t for t in dev_matrix.columns if (t - 3 in dev_matrix.columns) and (t - 6 in dev_matrix.columns)]
    train_df = training_rows(dev_matrix, feats, train_targets, ccpc_feats=ccpc_feats, L=L, gov_set=gov_set)

    final_ridge: Any = None
    pred_cols: list[str] = []
    if len(train_df) >= 5:
        pred_cols = [c for c in RIDGE_RELATIVE_PREDICTORS if c in train_df.columns]
        if len(pred_cols) >= 3:
            final_ridge = fit_ridge(train_df[pred_cols], train_df["y"], lam, is_deviation=True)
            final_ridge.train_years = sorted(list(train_targets))
            final_ridge.target_year = t_year

    # Fit structural model explaining average intermediate deviations
    target_structural = intermediate_turnout(dev_matrix, intermediate_years=(2009, 2015, 2021))
    feats_structural = feats_idx.copy()
    if has_ccpc and available_ccpc:
        ccpc_inter = intermediate_ccpc_features(ccpc_feats, feature_cols=available_ccpc)
        if not ccpc_inter.empty:
            for c in available_ccpc:
                if c in ccpc_inter.columns:
                    feats_structural[c] = ccpc_inter[c].reindex(feats_structural.index)

    # Add gov_mean for intermediate years (2009, 2015, 2021)
    gov_means = []
    for m in feats_structural.index:
        ent = feats_structural.loc[m, "cve_ent"] if "cve_ent" in feats_structural.columns else str(m)[:2]
        gm = np.mean([is_gubernatorial(y, ent, gov_set=gov_set) for y in (2009, 2015, 2021)])
        gov_means.append(float(gm))
    feats_structural["gov_mean"] = gov_means
    structural_features = active_features + ["gov_mean"]

    structural_model = fit_structural(
        feats_structural,
        target_structural,
        folds_by=feats_structural.get("cve_ent"),
        features=structural_features,
    )
    drivers_low_conf = bool(structural_model.cv_r2 < 0.05)

    # Sigma pp estimation: std of residuals of selected model on fold 2024 (or latest fold)
    sigma_pp = 5.0
    if backtests:
        last_test_spec = backtests[-1]
        last_test_yr = last_test_spec["test_year"]
        test_df = training_rows(dev_matrix, feats, [last_test_yr], ccpc_feats=ccpc_feats, L=L, gov_set=gov_set)
        if len(test_df) >= 2:
            y_tr = test_df["y"].values.astype(float)
            l1_val = test_df["lag1"].values.astype(float)
            l2_val = test_df["lag2"].values.astype(float)
            if selected_model == "persist_l1":
                yp = l1_val
            elif selected_model == "persist_l2":
                yp = l2_val
            elif selected_model == "mean_l1_l2":
                yp = (l1_val + l2_val) / 2.0
            elif selected_model == "ridge" and final_ridge is not None and all(c in test_df.columns for c in pred_cols):
                yp = predict(final_ridge, test_df[pred_cols], clip_range=None)
            else:
                yp = (l1_val + l2_val) / 2.0
            sigma_pp = float(np.std(yp - y_tr, ddof=1))

    sigma_pp = max(0.5, round(sigma_pp, 2))
    if final_ridge is not None:
        final_ridge.sigma_pp = sigma_pp

    # 4. Predictions for target_year (2027)
    mun_ids = feats_idx.index
    lag1_year = t_year - 3
    lag2_year = t_year - 6

    lag1 = dev_matrix[lag1_year].reindex(mun_ids) if lag1_year in dev_matrix.columns else pd.Series(np.nan, index=mun_ids)
    lag2 = dev_matrix[lag2_year].reindex(mun_ids) if lag2_year in dev_matrix.columns else pd.Series(np.nan, index=mun_ids)

    # Ridge inputs for target_year
    X_target = pd.DataFrame(index=mun_ids)
    X_target["lag1"] = lag1.values
    X_target["lag2"] = lag2.values
    mun_ents = [feats_idx.loc[m, "cve_ent"] if "cve_ent" in feats_idx.columns else str(m)[:2] for m in mun_ids]
    X_target["gov_T"] = [float(is_gubernatorial(t_year, e, gov_set=gov_set)) for e in mun_ents]
    X_target["gov_lag1"] = [float(is_gubernatorial(lag1_year, e, gov_set=gov_set)) for e in mun_ents]
    X_target["gov_lag2"] = [float(is_gubernatorial(lag2_year, e, gov_set=gov_set)) for e in mun_ents]

    for col in BASE_FEATURES:
        X_target[col] = feats_idx[col].values if col in feats_idx.columns else np.nan

    if has_ccpc and available_ccpc:
        for col in available_ccpc:
            if not ccpc_last_indexed.empty and col in ccpc_last_indexed.columns:
                X_target[col] = to_num(ccpc_last_indexed[col]).reindex(mun_ids).values
            else:
                X_target[col] = np.nan

    ridge_preds = (
        predict(final_ridge, X_target[pred_cols], clip_range=None)
        if (final_ridge is not None and pred_cols and all(c in X_target.columns for c in pred_cols))
        else np.full(len(mun_ids), np.nan)
    )

    # Fallback model chain: mean_l1_l2 -> persist_l1 -> persist_l2
    pred_dev_list: list[float] = []
    fallback_model_list: list[str | None] = []

    for idx, mun in enumerate(mun_ids):
        v_l1 = lag1.iloc[idx]
        v_l2 = lag2.iloc[idx]
        has_l1 = not np.isnan(v_l1)
        has_l2 = not np.isnan(v_l2)
        has_both = has_l1 and has_l2

        if selected_model == "ridge":
            if has_both and final_ridge is not None and not np.isnan(ridge_preds[idx]):
                pred_dev_list.append(float(ridge_preds[idx]))
                fallback_model_list.append(None)
            elif has_both:
                pred_dev_list.append(float((v_l1 + v_l2) / 2.0))
                fallback_model_list.append("mean_l1_l2")
            elif has_l1:
                pred_dev_list.append(float(v_l1))
                fallback_model_list.append("persist_l1")
            elif has_l2:
                pred_dev_list.append(float(v_l2))
                fallback_model_list.append("persist_l2")
            else:
                pred_dev_list.append(np.nan)
                fallback_model_list.append(None)
        elif selected_model == "mean_l1_l2":
            if has_both:
                pred_dev_list.append(float((v_l1 + v_l2) / 2.0))
                fallback_model_list.append(None)
            elif has_l1:
                pred_dev_list.append(float(v_l1))
                fallback_model_list.append("persist_l1")
            elif has_l2:
                pred_dev_list.append(float(v_l2))
                fallback_model_list.append("persist_l2")
            else:
                pred_dev_list.append(np.nan)
                fallback_model_list.append(None)
        elif selected_model == "persist_l1":
            if has_l1:
                pred_dev_list.append(float(v_l1))
                fallback_model_list.append(None)
            elif has_l2:
                pred_dev_list.append(float(v_l2))
                fallback_model_list.append("persist_l2")
            else:
                pred_dev_list.append(np.nan)
                fallback_model_list.append(None)
        elif selected_model == "persist_l2":
            if has_l2:
                pred_dev_list.append(float(v_l2))
                fallback_model_list.append(None)
            elif has_l1:
                pred_dev_list.append(float(v_l1))
                fallback_model_list.append("persist_l1")
            else:
                pred_dev_list.append(np.nan)
                fallback_model_list.append(None)
        else:
            pred_dev_list.append(np.nan)
            fallback_model_list.append(None)

    pred_dev_arr = np.array(pred_dev_list, dtype=float)
    can_predict = ~np.isnan(pred_dev_arr)

    # Municipal trends, volatilities, and history maps
    trend_map: dict[str, float] = {}
    vol_map: dict[str, float] = {}
    last_year_map: dict[str, int] = {}
    last_reliable_year_map: dict[str, int] = {}
    last_part_map: dict[str, float] = {}
    last_ln_map: dict[str, float] = {}

    for mun in mun_ids:
        # Dev-based trend and volatility
        if mun in dev_matrix.index:
            s_dev = dev_matrix.loc[mun].dropna()
            t_val, v_val = unit_trend(s_dev)
            trend_map[mun] = t_val
            vol_map[mun] = v_val

        # Reliable participation history
        if mun in Y_rel.index:
            s_rel = Y_rel.loc[mun].dropna()
            if len(s_rel) > 0:
                lry = int(s_rel.index.max())
                last_reliable_year_map[mun] = lry
                last_part_map[mun] = float(s_rel.loc[lry])
                last_year_map[mun] = lry

        # LN history
        if mun in L.index:
            s_l = L.loc[mun].dropna()
            if len(s_l) > 0:
                last_ln_map[mun] = float(s_l.loc[int(s_l.index.max())])

    # Exact calibration for national level
    mun_ln_arr = np.array([
        float(last_ln_map.get(m, 0.0))
        if (m in last_ln_map and pd.notna(last_ln_map[m]) and last_ln_map[m] > 0)
        else 0.0
        for m in mun_ids
    ])

    if can_predict.any() and mun_ln_arr[can_predict].sum() > 0:
        w = mun_ln_arr[can_predict]
        w_sum = w.sum()
        w_norm = w / w_sum
        c = nat_assumption - float(np.sum(w_norm * pred_dev_arr[can_predict]))
        for _ in range(5):
            p_eval = np.clip((pred_dev_arr[can_predict] + c) / 100.0, 0.05, 0.98)
            current_agg = float(np.sum(w_norm * p_eval * 100.0))
            diff = nat_assumption - current_agg
            if abs(diff) < 0.005:
                break
            c += diff
    else:
        c = nat_assumption

    calibration_pp = float(round(c, 4))
    offset_pp = calibration_pp

    pred_part_pp = pred_dev_arr + c
    pred_part = np.where(can_predict, np.clip(pred_part_pp / 100.0, 0.05, 0.98), np.nan)
    pred_abst = np.where(can_predict, 1.0 - pred_part, np.nan)
    pred_low = np.where(can_predict, np.clip(pred_abst - 1.645 * sigma_pp / 100.0, 0.0, 1.0), np.nan)
    pred_high = np.where(can_predict, np.clip(pred_abst + 1.645 * sigma_pp / 100.0, 0.0, 1.0), np.nan)

    # Judicial election 2025 turnout
    pjf_part_map: dict[str, float] = {}
    st_pjf_part_map: dict[str, float] = {}
    if not part.empty and "election" in part.columns:
        pjf_rows = part[part["election"] == "PJF"].copy()
        if not pjf_rows.empty:
            if "participacion" in pjf_rows.columns:
                pjf_rows["part_clean"] = to_num(pjf_rows["participacion"])
                for _, r in pjf_rows.iterrows():
                    cid = zpad(str(r.get("cvegeo", "")).strip(), 5)
                    pval = r.get("part_clean")
                    if pd.notna(pval):
                        pjf_part_map[cid] = float(pval)
            if "cve_ent" in pjf_rows.columns and "votos_totales" in pjf_rows.columns and "lista_nominal" in pjf_rows.columns:
                pjf_rows["cve_ent"] = pjf_rows["cve_ent"].astype(str).str.strip().map(lambda v: zpad(v, 2))
                pjf_rows["vt_clean"] = to_num(pjf_rows["votos_totales"])
                pjf_rows["ln_clean"] = to_num(pjf_rows["lista_nominal"])
                for ent, grp in pjf_rows.groupby("cve_ent"):
                    vt = grp["vt_clean"].sum()
                    ln_pjf = grp["ln_clean"].sum()
                    if ln_pjf > 0:
                        st_pjf_part_map[ent] = float(vt / ln_pjf)

    mun_df = pd.DataFrame(index=mun_ids)
    mun_df["id"] = mun_ids
    mun_df["level"] = "mun"
    mun_df["cve_ent"] = feats_idx["cve_ent"].astype(str).str.zfill(2)
    mun_df["name"] = feats_idx["nom_mun"].fillna(feats_idx.index.to_series())
    mun_df["lista_nominal"] = [last_ln_map.get(m, np.nan) for m in mun_ids]
    mun_df["last_year"] = [last_year_map.get(m, np.nan) for m in mun_ids]
    mun_df["last_reliable_year"] = [last_reliable_year_map.get(m, np.nan) for m in mun_ids]
    mun_df["last_participation"] = [last_part_map.get(m, np.nan) for m in mun_ids]
    mun_df["pred_dev_pp"] = pred_dev_arr
    mun_df["fallback_model"] = fallback_model_list
    mun_df["pred_participation"] = pred_part
    mun_df["pred_abstention"] = pred_abst
    mun_df["pred_low"] = pred_low
    mun_df["pred_high"] = pred_high
    mun_df["trend_pp"] = [trend_map.get(m, np.nan) for m in mun_ids]
    mun_df["volatility_pp"] = [vol_map.get(m, np.nan) for m in mun_ids]
    mun_df["coverage_ln"] = feats_idx["coverage_ln"]

    for col in [
        "nom_ent", "nom_mun", "pob_tot", "pob_18ymas", "pct_18_24",
        "pct_65ymas", "graproes", "pct_hli", "pct_sin_servsalud",
        "pct_internet", "pct_rural", "pct_analfabeta", "pct_po2sm",
        "im_2020", "gm_2020",
    ]:
        mun_df[col] = feats_idx[col] if col in feats_idx.columns else np.nan

    mun_df["part_pj_2025"] = [pjf_part_map.get(m, np.nan) for m in mun_ids]
    if not ccpc_last_indexed.empty:
        mun_df["part_18_34_last"] = to_num(ccpc_last_indexed["part_18_34"]).reindex(mun_ids).values if "part_18_34" in ccpc_last_indexed.columns else np.nan
        mun_df["gap_youth_pp_last"] = to_num(ccpc_last_indexed["gap_youth_pp"]).reindex(mun_ids).values if "gap_youth_pp" in ccpc_last_indexed.columns else np.nan
        mun_df["gap_sexo_pp_last"] = to_num(ccpc_last_indexed["gap_sexo_pp"]).reindex(mun_ids).values if "gap_sexo_pp" in ccpc_last_indexed.columns else np.nan
        mun_df["pct_ln_rural_last"] = to_num(ccpc_last_indexed["pct_ln_rural"]).reindex(mun_ids).values if "pct_ln_rural" in ccpc_last_indexed.columns else np.nan
    else:
        mun_df["part_18_34_last"] = np.nan
        mun_df["gap_youth_pp_last"] = np.nan
        mun_df["gap_sexo_pp_last"] = np.nan
        mun_df["pct_ln_rural_last"] = np.nan

    mun_df["imputed_census"] = [imputed_census_map.get(m, False) for m in mun_ids]

    # Structural model predictions & vulnerability
    struct_pred_dev = predict(structural_model, feats_structural[structural_model.features], clip_range=None)
    mun_df["struct_pred_dev_pp"] = struct_pred_dev
    mun_df["vulnerability_pp"] = -struct_pred_dev

    # 5. State aggregation
    state_rows = []
    part_dip = part[(part["election"] == "DIP_FED") & (part["reliable"])].copy()
    part_dip["cve_ent"] = part_dip["cve_ent"].astype(str).apply(lambda v: zpad(v, 2))
    part_dip["year"] = pd.to_numeric(part_dip["year"], errors="coerce")
    part_dip["votos_totales"] = pd.to_numeric(part_dip["votos_totales"], errors="coerce")
    part_dip["lista_nominal"] = pd.to_numeric(part_dip["lista_nominal"], errors="coerce")

    for ent in sorted(mun_df["cve_ent"].unique()):
        muns_ent = mun_df[mun_df["cve_ent"] == ent]
        st_dict = {col: np.nan for col in UNITS_COLUMNS}
        st_dict["id"] = ent
        st_dict["level"] = "state"
        st_dict["cve_ent"] = ent
        st_dict["name"] = states_map.get(ent, f"Estado {ent}")
        st_dict["fallback_model"] = None

        pob_tot = to_num(muns_ent["pob_tot"]).sum()
        pob_18 = to_num(muns_ent["pob_18ymas"]).sum()
        ln_tot = to_num(muns_ent["lista_nominal"]).sum()
        st_dict["pob_tot"] = pob_tot
        st_dict["pob_18ymas"] = pob_18
        st_dict["lista_nominal"] = ln_tot

        w_pob = to_num(muns_ent["pob_18ymas"]).fillna(0)
        sum_w_pob = w_pob.sum()
        for col in [
            "pct_18_24", "pct_65ymas", "graproes", "pct_hli", "pct_sin_servsalud",
            "pct_internet", "pct_rural", "pct_analfabeta", "pct_po2sm",
        ]:
            vals = to_num(muns_ent[col])
            valid = ~vals.isna() & (w_pob > 0)
            if valid.any() and sum_w_pob > 0:
                st_dict[col] = float((vals[valid] * w_pob[valid]).sum() / w_pob[valid].sum())
            else:
                st_dict[col] = np.nan

        st_dict["coverage_ln"] = float(np.clip(ln_tot / pob_18, 0.0, 1.2)) if pob_18 > 0 else np.nan
        st_dict["im_2020"] = np.nan
        st_dict["gm_2020"] = None

        w_ln = to_num(muns_ent["lista_nominal"]).fillna(0)
        valid_preds = ~muns_ent["pred_participation"].isna() & (w_ln > 0)
        if valid_preds.any():
            sum_w_ln = w_ln[valid_preds].sum()
            st_pred_part = float((muns_ent.loc[valid_preds, "pred_participation"] * w_ln[valid_preds]).sum() / sum_w_ln)
            st_pred_dev = float((muns_ent.loc[valid_preds, "pred_dev_pp"] * w_ln[valid_preds]).sum() / sum_w_ln)
            st_dict["pred_dev_pp"] = st_pred_dev
            st_dict["pred_participation"] = st_pred_part
            st_dict["pred_abstention"] = 1.0 - st_pred_part
            st_dict["pred_low"] = float((muns_ent.loc[valid_preds, "pred_low"] * w_ln[valid_preds]).sum() / sum_w_ln)
            st_dict["pred_high"] = float((muns_ent.loc[valid_preds, "pred_high"] * w_ln[valid_preds]).sum() / sum_w_ln)

        # State structural prediction & vulnerability (weighted by LN)
        valid_struct = ~muns_ent["struct_pred_dev_pp"].isna() & (w_ln > 0)
        if valid_struct.any():
            sum_w_struct = w_ln[valid_struct].sum()
            st_struct_dev = float((to_num(muns_ent["struct_pred_dev_pp"]) * w_ln[valid_struct]).sum() / sum_w_struct)
            st_vuln = float((to_num(muns_ent["vulnerability_pp"]) * w_ln[valid_struct]).sum() / sum_w_struct)
            st_dict["struct_pred_dev_pp"] = st_struct_dev
            st_dict["vulnerability_pp"] = st_vuln
        else:
            st_dict["struct_pred_dev_pp"] = np.nan
            st_dict["vulnerability_pp"] = np.nan

        # State trend & volatility
        valid_trends = ~muns_ent["trend_pp"].isna() & (w_ln > 0)
        if valid_trends.any():
            sum_w_tr = w_ln[valid_trends].sum()
            st_dict["trend_pp"] = float((muns_ent.loc[valid_trends, "trend_pp"] * w_ln[valid_trends]).sum() / sum_w_tr)
            st_dict["volatility_pp"] = float((muns_ent.loc[valid_trends, "volatility_pp"] * w_ln[valid_trends]).sum() / sum_w_tr)

        # State turnout in latest reliable year
        ent_part = part_dip[part_dip["cve_ent"] == ent].dropna(subset=["year", "votos_totales", "lista_nominal"])
        if not ent_part.empty:
            grp = ent_part.groupby("year")[["votos_totales", "lista_nominal"]].sum()
            grp = grp[grp["lista_nominal"] > 0]
            if not grp.empty:
                st_turnout = grp["votos_totales"] / grp["lista_nominal"]
                ly = int(st_turnout.index.max())
                st_dict["last_year"] = ly
                st_dict["last_reliable_year"] = ly
                st_dict["last_participation"] = float(st_turnout.loc[ly])

        st_dict["part_pj_2025"] = st_pjf_part_map.get(ent, np.nan)
        for col in ["part_18_34_last", "gap_youth_pp_last", "gap_sexo_pp_last", "pct_ln_rural_last"]:
            vals = to_num(muns_ent[col])
            valid = ~vals.isna() & (w_ln > 0)
            if valid.any():
                st_dict[col] = float((vals[valid] * w_ln[valid]).sum() / w_ln[valid].sum())
            else:
                st_dict[col] = np.nan
        st_dict["imputed_census"] = False

        state_rows.append(st_dict)

    state_df = pd.DataFrame(state_rows, columns=UNITS_COLUMNS)
    units_df = pd.concat([mun_df, state_df], ignore_index=True)

    # 6. Risk computation
    if compute_risk is not None:
        units_df = compute_risk(units_df)
    else:
        units_df["risk_score"] = np.nan
        units_df["category"] = "sin_dato"
        units_df["r_abs"] = np.nan
        units_df["r_vuln"] = 0.5
        units_df["r_trend"] = 0.5
        units_df["r_vol"] = 0.5

    # Municipalities with missing pred_abstention must have category = 'sin_dato'
    missing_pred = units_df["pred_abstention"].isna()
    units_df.loc[missing_pred, "risk_score"] = np.nan
    units_df.loc[missing_pred, "category"] = "sin_dato"
    units_df.loc[missing_pred, "r_abs"] = np.nan

    # 6.1 Prioritization & Expected Abstention (§12.3)
    pred_abs_series = to_num(units_df["pred_abstention"])
    ln_series = to_num(units_df["lista_nominal"])
    has_abs_ln = pred_abs_series.notna() & ln_series.notna() & (ln_series > 0)
    abst_esp_vals = np.where(has_abs_ln, np.round(pred_abs_series * ln_series), np.nan)
    units_df["abstencion_esperada"] = pd.Series(abst_esp_vals, index=units_df.index, dtype="Int64")

    prioridad_series = pd.Series(pd.NA, index=units_df.index, dtype="Int64")
    for lvl in ["mun", "state"]:
        mask = (
            (units_df["level"] == lvl)
            & units_df["category"].isin(["rojo", "naranja"])
            & units_df["abstencion_esperada"].notna()
        )
        if mask.any():
            sub_indices = units_df.loc[mask].sort_values(
                by=["abstencion_esperada", "id"], ascending=[False, True]
            ).index
            prioridad_series.loc[sub_indices] = pd.Series(
                range(1, len(sub_indices) + 1), index=sub_indices, dtype="Int64"
            )
    units_df["prioridad"] = prioridad_series

    units_df = units_df[UNITS_COLUMNS]

    # 7. Feature contributions & drivers (structural model)
    mun_contribs = contributions_structural(structural_model, feats_structural, features=structural_model.features)
    # Effect on abstention is negative of effect on participation deviation
    mun_abst_effects = -mun_contribs

    drivers_records = []
    for mun in mun_ids:
        eff_series = mun_abst_effects.loc[mun]
        top_keys = eff_series.abs().sort_values(ascending=False).head(5).index
        for rank, k in enumerate(top_keys, start=1):
            val = float(eff_series[k])
            drivers_records.append({
                "id": mun,
                "level": "mun",
                "key": k,
                "label": label_map.get(k, k),
                "contribution_pp": round(val, 2),
                "direction": "sube_abstencion" if val >= 0 else "baja_abstencion",
                "rank": rank,
            })

    for ent in sorted(mun_df["cve_ent"].unique()):
        muns_ent = mun_df[mun_df["cve_ent"] == ent]
        ent_ids = muns_ent["id"].values
        weights = to_num(muns_ent["lista_nominal"]).fillna(0).values
        if weights.sum() > 0:
            eff_subset = mun_abst_effects.loc[ent_ids].values
            weighted_eff = np.sum(eff_subset * weights[:, None], axis=0) / weights.sum()
            state_eff_series = pd.Series(weighted_eff, index=structural_model.features)
            top_keys = state_eff_series.abs().sort_values(ascending=False).head(5).index
            for rank, k in enumerate(top_keys, start=1):
                val = float(state_eff_series[k])
                drivers_records.append({
                    "id": ent,
                    "level": "state",
                    "key": k,
                    "label": label_map.get(k, k),
                    "contribution_pp": round(val, 2),
                    "direction": "sube_abstencion" if val >= 0 else "baja_abstencion",
                    "rank": rank,
                })

    drivers_df = pd.DataFrame(drivers_records, columns=DRIVERS_COLUMNS)

    # 8. Save outputs
    write_parquet(units_df, b_dir / "units.parquet")
    write_parquet(drivers_df, b_dir / "drivers.parquet")

    # Serialize metrics.json
    structural_coef_list = []
    for k in structural_model.features:
        structural_coef_list.append({
            "key": k,
            "label": label_map.get(k, k),
            "coef_pp_per_sd": round(structural_model.coef.get(k, 0.0), 3),
        })

    forecast_coef_list = []
    if final_ridge is not None:
        for k in pred_cols:
            forecast_coef_list.append({
                "key": k,
                "label": label_map.get(k, k),
                "coef_pp_per_sd": round(final_ridge.coef.get(k, 0.0), 3),
            })

    data_sources_list = [
        {"name": "participation", "file": "participation.parquet", "rows": len(part)},
        {"name": "features", "file": "features.parquet", "rows": len(feats)},
    ]
    if has_ccpc:
        data_sources_list.append({"name": "ccpc_features", "file": "ccpc_features.parquet", "rows": len(ccpc_feats)})

    metrics_data = {
        "target_year": t_year,
        "train_years": final_ridge.train_years if final_ridge is not None else [],
        "backtests": backtests,
        "coefficients": structural_coef_list,
        "forecast_coefficients": forecast_coef_list,
        "structural_r2": round(structural_model.cv_r2, 4),
        "structural_r2_within_state": round(structural_model.r2_within_state, 4),
        "structural_r2_state_cv": round(structural_model.r2_state_cv, 4),
        "between_state_share": round(structural_model.between_state_share, 4),
        "lambda": float(lam),
        "sigma_pp": round(sigma_pp, 2),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "data_sources": data_sources_list,
        "candidates": candidates,
        "selected_model": selected_model,
        "national_level_assumption": round(nat_assumption, 2),
        "calibration_pp": round(calibration_pp, 4),
        "offset_pp": round(calibration_pp, 4),
        "reliability_rule": "reliable = (ns_rate <= 0.5) and (participacion >= 0.02)",
        "excluded_unreliable": excluded_unreliable,
        "drivers_low_confidence": drivers_low_conf,
    }

    (b_dir / "metrics.json").write_text(json.dumps(metrics_data, indent=2, ensure_ascii=False), encoding="utf-8")

    # Serialize model.json
    model_dict = final_ridge.to_dict() if final_ridge is not None else {}
    model_dict["selected_model"] = selected_model
    model_dict["national_level_assumption"] = round(nat_assumption, 2)
    model_dict["calibration_pp"] = round(calibration_pp, 4)
    model_dict["offset_pp"] = round(calibration_pp, 4)
    model_dict["structural"] = structural_model.to_dict()
    (b_dir / "model.json").write_text(json.dumps(model_dict, indent=2, ensure_ascii=False), encoding="utf-8")

    # 9. Print build summary
    print("\n" + "=" * 70)
    print("ATALAYA · Modelo de Participación Relativa")
    print(f"Año objetivo: {t_year} | Nivel nacional supuesto: {nat_assumption:.2f} % | Calibración: {calibration_pp:+.2f} pp")
    print("=" * 70)

    # Print candidates table
    print("\nTabla de Candidatos x Folds:")
    print(f"{'Candidato':<14} | {'Fold':<6} | {'MAE (pp)':<9} | {'RMSE (pp)':<10} | {'Spearman':<9} | {'Top20 Hit':<9}")
    print("-" * 70)
    for cand in candidates:
        c_name = cand["name"]
        for f in cand.get("folds", []):
            print(f"{c_name:<14} | {f['test_year']:<6} | {f['mae_pp']:<9.2f} | {f['rmse_pp']:<10.2f} | {f['spearman']:<9.3f} | {f['top20_hit']:<9.3f}")
    print("-" * 70)
    print(f"Modelo seleccionado (menor MAE promedio): {selected_model}")
    print(f"R² estructural: {structural_model.cv_r2:.4f} (drivers_low_confidence={drivers_low_conf})")

    cat_counts = units_df[units_df["level"] == "mun"]["category"].value_counts().to_dict()
    print(f"\nMunicipios por semáforo de riesgo: {cat_counts}")

    top_risk = units_df[units_df["level"] == "mun"].sort_values("risk_score", ascending=False).head(10)
    print("\nTop 10 municipios con mayor riesgo:")
    for _, r in top_risk.iterrows():
        p_abs = f"{r['pred_abstention']:.3f}" if pd.notna(r['pred_abstention']) else "N/D"
        dev_str = f"{r['pred_dev_pp']:+.2f} pp" if pd.notna(r['pred_dev_pp']) else "N/D"
        print(f"  {r['id']} {r['name']:<25}: score={r['risk_score']} ({r['category']}) abst={p_abs} (dev={dev_str})")
    print("=" * 70 + "\n")

    return 0


def main() -> None:
    """CLI entrypoint."""
    parser = argparse.ArgumentParser(description="ATALAYA relative risk model build")
    parser.add_argument("--build-dir", type=Path, default=config.BUILD_DIR, help="Path to build dir")
    parser.add_argument("--seed-dir", type=Path, default=config.SEED_DIR, help="Path to seed dir")
    parser.add_argument("--target-year", type=int, default=config.get_settings().target_year, help="Target year")
    parser.add_argument("--national-level", type=float, default=None, help="Explicit national turnout assumption (e.g. 51.84)")
    args = parser.parse_args()

    sys.exit(build_model(
        build_dir=args.build_dir,
        seed_dir=args.seed_dir,
        target_year=args.target_year,
        national_level=args.national_level,
    ))


if __name__ == "__main__":
    main()
