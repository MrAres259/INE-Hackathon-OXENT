"""Build pipeline for ATALAYA abstention risk model."""

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
    load_ccpc_features,
    participation_matrix,
    lista_nominal_matrix,
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
    backtest,
    select_lambda,
    BASE_FEATURES,
    CCPC_FEATURES,
    FEATURES,
    PREDICTORS,
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
    label_map["lag1"] = "Participación t-3"
    label_map["lag2"] = "Participación t-6 (mismo tipo)"
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
        "structural": {
            "features": list(FEATURES),
            "means": {},
            "stds": {},
            "medians": {},
            "coef": {},
            "intercept": 0.0,
            "lambda": 10.0,
            "cv_r2": 0.0,
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
) -> int:
    """Run model training, scenario baseline predictions, and artifact exports."""
    b_dir = Path(build_dir) if build_dir is not None else config.BUILD_DIR
    s_dir = Path(seed_dir) if seed_dir is not None else config.SEED_DIR
    t_year = int(target_year) if target_year is not None else config.get_settings().target_year

    b_dir.mkdir(parents=True, exist_ok=True)
    states_map, label_map = load_seed_maps(s_dir)

    part, feats, ccpc_feats = load_inputs(b_dir, include_ccpc=True)

    dip_part = part[part["election"] == "DIP_FED"] if ("election" in part.columns) else pd.DataFrame()
    distinct_years: list[int] = []
    if not dip_part.empty and "year" in dip_part.columns:
        distinct_years = sorted(pd.to_numeric(dip_part["year"], errors="coerce").dropna().astype(int).unique().tolist())

    if len(distinct_years) < 3 or feats.empty:
        return build_fallback_artifacts(part, feats, b_dir, s_dir, t_year)

    # 1. Pivot matrices
    Y = participation_matrix(part, election="DIP_FED", min_year=2009, value_col="participacion")
    L = lista_nominal_matrix(part, election="DIP_FED", min_year=2009)

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

    # Latest nominal list per municipality from CCPC/L
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

    # Check CCPC features availability
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
    active_predictors = ["lag1", "lag2", "pres"] + active_features

    # 3. Model selection & backtest
    lam = select_lambda(Y, feats, ccpc_feats=ccpc_feats, L=L)
    backtests = backtest(Y, feats, lam, ccpc_feats=ccpc_feats, L=L)

    # Train final model with all available targets
    train_targets = [t for t in Y.columns if (t - 3 in Y.columns) and (t - 6 in Y.columns)]
    train_df = training_rows(Y, feats, train_targets, ccpc_feats=ccpc_feats, L=L)
    if len(train_df) < 5:
        return build_fallback_artifacts(part, feats, b_dir, s_dir, t_year)

    pred_cols = [c for c in active_predictors if c in train_df.columns]
    final_model = fit_ridge(train_df[pred_cols], train_df["y"], lam)
    final_model.train_years = sorted(list(train_targets))
    final_model.target_year = t_year

    # Fit structural model explaining intermediate DIP_FED turnout
    target_structural = intermediate_turnout(Y)
    feats_structural = feats_idx.copy()
    if has_ccpc and available_ccpc:
        ccpc_inter = intermediate_ccpc_features(ccpc_feats, feature_cols=available_ccpc)
        if not ccpc_inter.empty:
            for c in available_ccpc:
                if c in ccpc_inter.columns:
                    feats_structural[c] = ccpc_inter[c].reindex(feats_structural.index)

    structural_model = fit_structural(
        feats_structural,
        target_structural,
        folds_by=feats_structural.get("cve_ent"),
        features=active_features,
    )

    # Sigma pp estimation
    if backtests:
        last_test_year = backtests[-1]["test_year"]
        test_df = training_rows(Y, feats, [last_test_year], ccpc_feats=ccpc_feats, L=L)
        test_diff = predict(final_model, test_df[pred_cols]) - (test_df["y"].values.astype(float) * 100.0)
        sigma_pp = float(np.std(test_diff, ddof=1)) if len(test_df) > 1 else 5.0
    else:
        train_diff = predict(final_model, train_df[pred_cols]) - (train_df["y"].values.astype(float) * 100.0)
        sigma_pp = float(np.std(train_diff, ddof=1)) if len(train_df) > 1 else 5.0
    final_model.sigma_pp = sigma_pp

    # 4. Predictions for target_year (2027)
    mun_ids = feats_idx.index
    target_pres = is_presidential(t_year)
    lag1_year = t_year - 3
    lag2_year = t_year - 6

    lag1 = Y[lag1_year].reindex(mun_ids) if lag1_year in Y.columns else pd.Series(np.nan, index=mun_ids)
    lag2 = Y[lag2_year].reindex(mun_ids) if lag2_year in Y.columns else pd.Series(np.nan, index=mun_ids)

    # Compute cycle difference delta_ciclo between presidential and intermediate elections
    cycle_diffs: list[float] = []
    for t in Y.columns:
        if is_presidential(t) == 1 and (t - 3 in Y.columns):
            diff = (Y[t] - Y[t - 3]).dropna().values
            cycle_diffs.extend(diff.tolist())
    delta_ciclo = float(np.nanmedian(cycle_diffs)) if cycle_diffs else 0.10

    # CONTRACT-NOTE: When lag2 (t-6) is missing but lag1 (t-3) exists, impute lag2 = lag1 - delta_ciclo
    lag2_imputed = lag1 - delta_ciclo
    lag2_effective = lag2.fillna(lag2_imputed)

    X_target = pd.DataFrame(index=mun_ids)
    X_target["lag1"] = lag1.values
    X_target["lag2"] = lag2_effective.values
    X_target["pres"] = float(target_pres)
    for col in BASE_FEATURES:
        X_target[col] = feats_idx[col].values if col in feats_idx.columns else np.nan

    if has_ccpc and available_ccpc:
        for col in available_ccpc:
            if not ccpc_last_indexed.empty and col in ccpc_last_indexed.columns:
                X_target[col] = to_num(ccpc_last_indexed[col]).reindex(mun_ids).values
            else:
                X_target[col] = np.nan

    can_predict = ~lag1.isna()
    pred_part_pp = predict(final_model, X_target)
    pred_part = pred_part_pp / 100.0
    pred_part = np.where(can_predict, pred_part, np.nan)
    pred_abst = np.where(can_predict, 1.0 - pred_part, np.nan)
    pred_low = np.where(can_predict, np.clip(pred_abst - 1.645 * sigma_pp / 100.0, 0.0, 1.0), np.nan)
    pred_high = np.where(can_predict, np.clip(pred_abst + 1.645 * sigma_pp / 100.0, 0.0, 1.0), np.nan)

    # Municipal trends and volatilities
    trend_map: dict[str, float] = {}
    vol_map: dict[str, float] = {}
    last_year_map: dict[str, int] = {}
    last_part_map: dict[str, float] = {}
    last_ln_map: dict[str, float] = {}

    for mun in mun_ids:
        if mun in Y.index:
            s = Y.loc[mun].dropna()
            t_val, v_val = unit_trend(s)
            trend_map[mun] = t_val
            vol_map[mun] = v_val
            if len(s) > 0:
                ly = int(s.index.max())
                last_year_map[mun] = ly
                last_part_map[mun] = float(s.loc[ly])
        if mun in L.index:
            s_l = L.loc[mun].dropna()
            if len(s_l) > 0:
                last_ln_map[mun] = float(s_l.loc[int(s_l.index.max())])

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
    mun_df["last_participation"] = [last_part_map.get(m, np.nan) for m in mun_ids]
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

    # 5. State aggregation
    state_rows = []
    # State-level turnout series from part table
    part_dip = part[part["election"] == "DIP_FED"].copy()
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

        pob_tot = to_num(muns_ent["pob_tot"]).sum()
        pob_18 = to_num(muns_ent["pob_18ymas"]).sum()
        ln_tot = to_num(muns_ent["lista_nominal"]).sum()
        st_dict["pob_tot"] = pob_tot
        st_dict["pob_18ymas"] = pob_18
        st_dict["lista_nominal"] = ln_tot

        # Weighted sociodemographics by pob_18ymas
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

        # Weighted predictions by lista_nominal
        w_ln = to_num(muns_ent["lista_nominal"]).fillna(0)
        valid_preds = ~muns_ent["pred_participation"].isna() & (w_ln > 0)
        if valid_preds.any():
            sum_w_ln = w_ln[valid_preds].sum()
            st_pred_part = float((muns_ent.loc[valid_preds, "pred_participation"] * w_ln[valid_preds]).sum() / sum_w_ln)
            st_dict["pred_participation"] = st_pred_part
            st_dict["pred_abstention"] = 1.0 - st_pred_part
            st_dict["pred_low"] = float((muns_ent.loc[valid_preds, "pred_low"] * w_ln[valid_preds]).sum() / sum_w_ln)
            st_dict["pred_high"] = float((muns_ent.loc[valid_preds, "pred_high"] * w_ln[valid_preds]).sum() / sum_w_ln)

        # State trend and volatility
        ent_part = part_dip[part_dip["cve_ent"] == ent].dropna(subset=["year", "votos_totales", "lista_nominal"])
        if not ent_part.empty:
            grp = ent_part.groupby("year")[["votos_totales", "lista_nominal"]].sum()
            grp = grp[grp["lista_nominal"] > 0]
            if not grp.empty:
                st_turnout = grp["votos_totales"] / grp["lista_nominal"]
                st_trend, st_vol = unit_trend(st_turnout)
                st_dict["trend_pp"] = st_trend
                st_dict["volatility_pp"] = st_vol
                ly = int(st_turnout.index.max())
                st_dict["last_year"] = ly
                st_dict["last_participation"] = float(st_turnout.loc[ly])

        # New state columns
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

    # 7. Feature contributions & drivers (structural model)
    mun_contribs = contributions_structural(structural_model, feats_structural, features=structural_model.features)
    # Effect on abstention is negative of effect on participation
    mun_abst_effects = -mun_contribs

    drivers_records = []
    # Municipal drivers (top 5 by absolute effect)
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

    # State drivers (weighted average by municipal lista_nominal)
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
    for k in pred_cols:
        forecast_coef_list.append({
            "key": k,
            "label": label_map.get(k, k),
            "coef_pp_per_sd": round(final_model.coef.get(k, 0.0), 3),
        })

    data_sources_list = [
        {"name": "participation", "file": "participation.parquet", "rows": len(part)},
        {"name": "features", "file": "features.parquet", "rows": len(feats)},
    ]
    if has_ccpc:
        data_sources_list.append({"name": "ccpc_features", "file": "ccpc_features.parquet", "rows": len(ccpc_feats)})

    metrics_data = {
        "target_year": t_year,
        "train_years": final_model.train_years,
        "backtests": backtests,
        "coefficients": structural_coef_list,
        "forecast_coefficients": forecast_coef_list,
        "structural_r2": round(structural_model.cv_r2, 4),
        "lambda": float(lam),
        "sigma_pp": round(sigma_pp, 2),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "data_sources": data_sources_list,
    }
    if len(backtests) == 1:
        metrics_data["lambda_selection_note"] = "lambda elegida y evaluada en el mismo fold"

    (b_dir / "metrics.json").write_text(json.dumps(metrics_data, indent=2, ensure_ascii=False), encoding="utf-8")

    # Serialize model.json
    model_dict = final_model.to_dict()
    model_dict["structural"] = structural_model.to_dict()
    (b_dir / "model.json").write_text(json.dumps(model_dict, indent=2, ensure_ascii=False), encoding="utf-8")

    # 9. Print build summary
    print(f"ATALAYA Model built successfully for target year {t_year}")
    print(f"Optimal lambda: {lam}")
    print(f"R² estructural (CV): {structural_model.cv_r2:.4f}")
    top3_coefs = sorted(
        structural_model.coef.items(),
        key=lambda item: abs(item[1]),
        reverse=True,
    )[:3]
    top3_str = ", ".join(f"{k}={v:+.3f}" for k, v in top3_coefs)
    print(f"Top 3 coeficientes estructurales: {top3_str}")
    for b in backtests:
        print(f"Fold {b['test_year']}: MAE={b['mae_pp']} pp vs baseline={b['baseline_mae_pp']} pp (Spearman={b['spearman']})")

    cat_counts = units_df[units_df["level"] == "mun"]["category"].value_counts().to_dict()
    print(f"Municipalities by risk category: {cat_counts}")

    top_risk = units_df[units_df["level"] == "mun"].sort_values("risk_score", ascending=False).head(10)
    print("Top 10 municipalities by risk_score:")
    for _, r in top_risk.iterrows():
        print(f"  {r['id']} {r['name']}: score={r['risk_score']} ({r['category']}) pred_abs={r['pred_abstention']:.3f}")

    return 0


def main() -> None:
    """CLI entrypoint."""
    parser = argparse.ArgumentParser(description="ATALAYA risk model build")
    parser.add_argument("--build-dir", type=Path, default=config.BUILD_DIR, help="Path to build dir")
    parser.add_argument("--seed-dir", type=Path, default=config.SEED_DIR, help="Path to seed dir")
    parser.add_argument("--target-year", type=int, default=config.get_settings().target_year, help="Target year")
    args = parser.parse_args()

    sys.exit(build_model(build_dir=args.build_dir, seed_dir=args.seed_dir, target_year=args.target_year))


if __name__ == "__main__":
    main()
