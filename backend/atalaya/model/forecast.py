"""Ridge regression forecasting, relative deviation candidates, and backtesting using NumPy."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Sequence

import numpy as np
import pandas as pd

from atalaya.model.panel import training_rows

BASE_FEATURES: tuple[str, ...] = (
    "pct_18_24",
    "pct_65ymas",
    "graproes",
    "pct_hli",
    "pct_sin_servsalud",
    "pct_internet",
    "pct_rural",
    "pct_analfabeta",
    "pct_po2sm",
    "coverage_ln",
    "log_pob_18ymas",
)

CCPC_FEATURES: tuple[str, ...] = (
    "pct_ln_18_34",
    "gap_youth_pp",
    "gap_sexo_pp",
    "pct_ln_rural",
    "ns_rate",
)

FEATURES: tuple[str, ...] = BASE_FEATURES

PREDICTORS: list[str] = ["lag1", "lag2", "pres"] + list(FEATURES)

RIDGE_RELATIVE_PREDICTORS: list[str] = [
    "lag1",
    "lag2",
    "gov_T",
    "gov_lag1",
    "gov_lag2",
] + list(BASE_FEATURES) + list(CCPC_FEATURES)

CANDIDATE_NAMES: list[str] = ["persist_l1", "persist_l2", "mean_l1_l2", "ridge"]


@dataclass
class RidgeModel:
    """Closed-form Ridge regression model with preprocessing metadata."""

    features: list[str]
    medians: dict[str, float]
    means: dict[str, float]
    stds: dict[str, float]
    coef: dict[str, float]
    intercept: float
    lam: float
    sigma_pp: float = 0.0
    train_years: list[int] = field(default_factory=list)
    target_year: int = 2027
    is_deviation: bool = False

    def to_dict(self) -> dict:
        """Serialize model parameters to dictionary."""
        return {
            "features": self.features,
            "means": {k: round(v, 4) for k, v in self.means.items()},
            "stds": {k: round(v, 4) for k, v in self.stds.items()},
            "medians": {k: round(v, 4) for k, v in self.medians.items()},
            "coef": {k: round(v, 4) for k, v in self.coef.items()},
            "intercept": round(self.intercept, 4),
            "lambda": float(self.lam),
            "sigma_pp": round(self.sigma_pp, 4),
            "train_years": self.train_years,
            "target_year": self.target_year,
            "is_deviation": self.is_deviation,
        }


@dataclass
class StructuralModel:
    """Closed-form Ridge regression model for cross-sectional structural analysis."""

    features: list[str]
    medians: dict[str, float]
    means: dict[str, float]
    stds: dict[str, float]
    coef: dict[str, float]
    intercept: float
    lam: float
    cv_r2: float = 0.0

    def to_dict(self) -> dict:
        """Serialize structural model parameters to dictionary."""
        return {
            "features": self.features,
            "means": {k: round(v, 4) for k, v in self.means.items()},
            "stds": {k: round(v, 4) for k, v in self.stds.items()},
            "medians": {k: round(v, 4) for k, v in self.medians.items()},
            "coef": {k: round(v, 4) for k, v in self.coef.items()},
            "intercept": round(self.intercept, 4),
            "lambda": float(self.lam),
            "cv_r2": round(self.cv_r2, 4),
        }


def calc_top20_hit(
    y_true: np.ndarray | pd.Series,
    y_pred: np.ndarray | pd.Series,
) -> float:
    """Calculate the proportion of the true top 20% highest abstention captured in the predicted top 20%.

    Higher abstention corresponds to lower participation deviation.
    Therefore, the top 20% highest abstention is the bottom 20% lowest deviation values.
    """
    yt = np.asarray(y_true, dtype=float)
    yp = np.asarray(y_pred, dtype=float)
    valid = (~np.isnan(yt)) & (~np.isnan(yp))
    if valid.sum() < 2:
        return 0.0

    yt = yt[valid]
    yp = yp[valid]
    N = len(yt)
    k = max(1, int(round(0.20 * N)))

    # Indices of k smallest values in yt (lowest turnout dev = highest abstention)
    true_top20 = set(np.argsort(yt)[:k])
    # Indices of k smallest values in yp
    pred_top20 = set(np.argsort(yp)[:k])

    hit_count = len(true_top20.intersection(pred_top20))
    return round(float(hit_count / k), 3)


def fit_ridge(
    X: pd.DataFrame,
    y: np.ndarray | pd.Series,
    lam: float,
    is_deviation: bool = False,
) -> RidgeModel:
    """Fit closed-form Ridge regression on standardized features.

    Imputes NaNs with column medians, standardizes with training mean/std,
    centers y in percentage points, and solves (XᵀX + lam·I)β = Xᵀy.
    """
    feature_names = list(X.columns)
    N = len(X)
    P = len(feature_names)

    y_arr = np.asarray(y, dtype=float)
    # If values are strictly proportions [0, 1], convert to pp
    if np.nanmin(y_arr) >= 0.0 and np.nanmax(y_arr) <= 1.05:
        y_pp = y_arr * 100.0
    else:
        y_pp = y_arr.copy()

    y_mean = float(np.mean(y_pp))
    y_centered = y_pp - y_mean

    medians: dict[str, float] = {}
    means: dict[str, float] = {}
    stds: dict[str, float] = {}
    Z = np.zeros((N, P), dtype=float)

    for j, col in enumerate(feature_names):
        vals = pd.to_numeric(X[col], errors="coerce").values.astype(float)
        valid = vals[~np.isnan(vals)]
        med = float(np.median(valid)) if len(valid) > 0 else 0.0
        medians[col] = med

        filled = np.where(np.isnan(vals), med, vals)
        mean = float(np.mean(filled))
        std = float(np.std(filled, ddof=0))
        if std < 1e-12:
            std = 1.0
        means[col] = mean
        stds[col] = std
        Z[:, j] = (filled - mean) / std

    A = Z.T @ Z + float(lam) * np.eye(P)
    b = Z.T @ y_centered
    beta = np.linalg.solve(A, b)

    coef = {col: float(beta[j]) for j, col in enumerate(feature_names)}

    return RidgeModel(
        features=feature_names,
        medians=medians,
        means=means,
        stds=stds,
        coef=coef,
        intercept=y_mean,
        lam=float(lam),
        is_deviation=is_deviation,
    )


def predict(
    model: RidgeModel,
    X: pd.DataFrame,
    clip_range: tuple[float, float] | None = (5.0, 98.0),
) -> np.ndarray:
    """Predict turnout or deviation in percentage points.

    If clip_range is provided, clips outputs to [clip_range[0], clip_range[1]].
    For deviation models, pass clip_range=None or clip_range=(-60.0, 60.0).
    """
    N = len(X)
    pred = np.full(N, model.intercept, dtype=float)

    for col in model.features:
        if col in X.columns:
            vals = pd.to_numeric(X[col], errors="coerce").values.astype(float)
            med = model.medians.get(col, 0.0)
            filled = np.where(np.isnan(vals), med, vals)
        else:
            filled = np.full(N, model.medians.get(col, 0.0))

        mean = model.means.get(col, 0.0)
        std = model.stds.get(col, 1.0)
        if std < 1e-12:
            std = 1.0

        z = (filled - mean) / std
        pred += model.coef.get(col, 0.0) * z

    if clip_range is not None:
        return np.clip(pred, clip_range[0], clip_range[1])
    return pred


def contributions(
    model: RidgeModel,
    X: pd.DataFrame,
    features: Sequence[str] | None = None,
) -> pd.DataFrame:
    """Compute feature contributions (coef_k * z_ik) in pp of participation.

    Computed per row and per feature in model.features (excluding lags and pres/gov).
    """
    N = len(X)
    contrib_dict: dict[str, np.ndarray] = {}

    non_feature_cols = {"lag1", "lag2", "pres", "gov_T", "gov_lag1", "gov_lag2"}
    if features is not None:
        feats_to_use = list(features)
    elif model.features == list(PREDICTORS):
        feats_to_use = list(FEATURES)
    else:
        feats_to_use = [f for f in model.features if f not in non_feature_cols]

    for feat in feats_to_use:
        if feat in model.features and feat in X.columns:
            vals = pd.to_numeric(X[feat], errors="coerce").values.astype(float)
            med = model.medians.get(feat, 0.0)
            filled = np.where(np.isnan(vals), med, vals)
            mean = model.means.get(feat, 0.0)
            std = model.stds.get(feat, 1.0)
            if std < 1e-12:
                std = 1.0
            z = (filled - mean) / std
            contrib_dict[feat] = model.coef.get(feat, 0.0) * z
        else:
            contrib_dict[feat] = np.zeros(N, dtype=float)

    return pd.DataFrame(contrib_dict, index=X.index)


def backtest(
    Y: pd.DataFrame,
    feats: pd.DataFrame,
    lam: float,
    ccpc_feats: pd.DataFrame | None = None,
    L: pd.DataFrame | None = None,
) -> list[dict]:
    """Run temporal backtesting folds: (train <= 2018 -> 2021) and (train <= 2021 -> 2024).

    Returns list of dicts with metrics: mae_pp, rmse_pp, spearman, n, baseline_mae_pp.
    Maintained for backward compatibility.
    """
    fold_specs = [
        (2018, 2021),
        (2021, 2024),
    ]

    candidate_preds = ["lag1", "lag2", "pres"] + list(BASE_FEATURES) + list(CCPC_FEATURES)

    results: list[dict] = []
    for train_until, test_year in fold_specs:
        if test_year not in Y.columns or (test_year - 3) not in Y.columns or (test_year - 6) not in Y.columns:
            continue

        train_targets = [t for t in Y.columns if t <= train_until and (t - 3) in Y.columns and (t - 6) in Y.columns]
        if not train_targets:
            continue

        train_df = training_rows(Y, feats, train_targets, ccpc_feats=ccpc_feats, L=L)
        test_df = training_rows(Y, feats, [test_year], ccpc_feats=ccpc_feats, L=L)

        if len(train_df) < 5 or len(test_df) == 0:
            continue

        pred_cols = [c for c in candidate_preds if c in train_df.columns]
        if len(pred_cols) < 3:
            continue

        model = fit_ridge(train_df[pred_cols], train_df["y"], lam)

        y_true_raw = test_df["y"].values.astype(float)
        y_true_pp = y_true_raw * 100.0 if np.nanmax(y_true_raw) <= 1.05 and np.nanmin(y_true_raw) >= 0.0 else y_true_raw
        y_pred_pp = predict(model, test_df[pred_cols])
        lag2_raw = test_df["lag2"].values.astype(float)
        baseline_pred_pp = lag2_raw * 100.0 if np.nanmax(lag2_raw) <= 1.05 and np.nanmin(lag2_raw) >= 0.0 else lag2_raw

        diff = y_pred_pp - y_true_pp
        mae_pp = float(np.mean(np.abs(diff)))
        rmse_pp = float(np.sqrt(np.mean(diff ** 2)))
        baseline_mae_pp = float(np.mean(np.abs(baseline_pred_pp - y_true_pp)))

        r_pred = pd.Series(y_pred_pp).rank()
        r_true = pd.Series(y_true_pp).rank()
        spearman = float(r_pred.corr(r_true))
        if np.isnan(spearman):
            spearman = 0.0

        top20_hit = calc_top20_hit(y_true_pp, y_pred_pp)

        results.append({
            "train_until": int(train_until),
            "test_year": int(test_year),
            "mae_pp": round(mae_pp, 2),
            "rmse_pp": round(rmse_pp, 2),
            "spearman": round(spearman, 3),
            "top20_hit": top20_hit,
            "n": int(len(test_df)),
            "baseline_mae_pp": round(baseline_mae_pp, 2),
        })

    return results


def select_lambda(
    Y: pd.DataFrame,
    feats: pd.DataFrame,
    grid: Sequence[float] = (0.1, 1.0, 3.0, 10.0, 30.0, 100.0),
    ccpc_feats: pd.DataFrame | None = None,
    L: pd.DataFrame | None = None,
) -> float:
    """Select ridge penalty lambda minimizing MAE on the earliest available backtest fold (test 2021)."""
    best_lam = 10.0
    best_mae = float("inf")
    found = False

    for lam in grid:
        folds = backtest(Y, feats, float(lam), ccpc_feats=ccpc_feats, L=L)
        if folds:
            found = True
            first_fold_mae = folds[0]["mae_pp"]
            if first_fold_mae < best_mae:
                best_mae = first_fold_mae
                best_lam = float(lam)

    return float(best_lam) if found else 10.0


def backtest_candidates(
    Y_dev: pd.DataFrame,
    feats: pd.DataFrame,
    lam_grid: Sequence[float] = (0.1, 1.0, 3.0, 10.0, 30.0, 100.0),
    ccpc_feats: pd.DataFrame | None = None,
    L: pd.DataFrame | None = None,
    seed_dir: Path | str | None = None,
    fold_specs: Sequence[tuple[int, int]] = ((2018, 2021), (2021, 2024)),
) -> tuple[list[dict], str, list[dict], float]:
    """Evaluate 4 candidates on temporal folds: persist_l1, persist_l2, mean_l1_l2, ridge.

    Candidate definitions:
      1. persist_l1: dev_{T-3}
      2. persist_l2: dev_{T-6}
      3. mean_l1_l2: (dev_{T-3} + dev_{T-6}) / 2
      4. ridge: closed-form ridge with dev_{T-3}, dev_{T-6}, gov_T, gov_{T-3}, gov_{T-6} + features §4.3 + CCPC.
         lambda selected on fold 2021 minimizing MAE.

    Selects candidate with lowest mean MAE across available folds.
    Returns (candidates_report, selected_model_name, selected_backtests, selected_lambda).
    """
    # 1. Select lambda for ridge using the 2021 fold (train <= 2018, test 2021)
    best_lam = 10.0
    best_ridge_2021_mae = float("inf")
    fold_2021_spec = [spec for spec in fold_specs if spec[1] == 2021]

    if fold_2021_spec:
        tr_until, ts_yr = fold_2021_spec[0]
        train_targets = [t for t in Y_dev.columns if t <= tr_until and (t - 3 in Y_dev.columns) and (t - 6 in Y_dev.columns)]
        if train_targets and ts_yr in Y_dev.columns and (ts_yr - 3 in Y_dev.columns) and (ts_yr - 6 in Y_dev.columns):
            train_df = training_rows(Y_dev, feats, train_targets, ccpc_feats=ccpc_feats, L=L, seed_dir=seed_dir)
            test_df = training_rows(Y_dev, feats, [ts_yr], ccpc_feats=ccpc_feats, L=L, seed_dir=seed_dir)
            pred_cols = [c for c in RIDGE_RELATIVE_PREDICTORS if c in train_df.columns]

            if len(train_df) >= 5 and len(test_df) >= 2 and len(pred_cols) >= 3:
                for cand_lam in lam_grid:
                    m = fit_ridge(train_df[pred_cols], train_df["y"], cand_lam, is_deviation=True)
                    yp = predict(m, test_df[pred_cols], clip_range=None)
                    diff = yp - test_df["y"].values.astype(float)
                    fold_mae = float(np.mean(np.abs(diff)))
                    if fold_mae < best_ridge_2021_mae:
                        best_ridge_2021_mae = fold_mae
                        best_lam = float(cand_lam)

    # 2. Evaluate all 4 candidates on each fold
    raw_results: dict[str, list[dict]] = {c: [] for c in CANDIDATE_NAMES}

    for train_until, test_year in fold_specs:
        if test_year not in Y_dev.columns or (test_year - 3) not in Y_dev.columns or (test_year - 6) not in Y_dev.columns:
            continue

        train_targets = [t for t in Y_dev.columns if t <= train_until and (t - 3 in Y_dev.columns) and (t - 6 in Y_dev.columns)]
        if not train_targets:
            continue

        train_df = training_rows(Y_dev, feats, train_targets, ccpc_feats=ccpc_feats, L=L, seed_dir=seed_dir)
        test_df = training_rows(Y_dev, feats, [test_year], ccpc_feats=ccpc_feats, L=L, seed_dir=seed_dir)

        if len(train_df) < 5 or len(test_df) < 2:
            continue

        y_true = test_df["y"].values.astype(float)
        l1 = test_df["lag1"].values.astype(float)
        l2 = test_df["lag2"].values.astype(float)

        # 1. persist_l1
        pred_l1 = l1
        # 2. persist_l2
        pred_l2 = l2
        # 3. mean_l1_l2
        pred_mean = (l1 + l2) / 2.0

        # 4. ridge
        pred_cols = [c for c in RIDGE_RELATIVE_PREDICTORS if c in train_df.columns]
        if len(pred_cols) >= 3:
            ridge_m = fit_ridge(train_df[pred_cols], train_df["y"], best_lam, is_deviation=True)
            pred_ridge = predict(ridge_m, test_df[pred_cols], clip_range=None)
        else:
            pred_ridge = pred_mean.copy()

        preds_dict = {
            "persist_l1": pred_l1,
            "persist_l2": pred_l2,
            "mean_l1_l2": pred_mean,
            "ridge": pred_ridge,
        }

        # Baseline MAE for reporting is persist_l1 MAE
        baseline_mae = float(np.mean(np.abs(pred_l1 - y_true)))

        for c_name, c_pred in preds_dict.items():
            diff = c_pred - y_true
            mae = float(np.mean(np.abs(diff)))
            rmse = float(np.sqrt(np.mean(diff ** 2)))
            r_pred = pd.Series(c_pred).rank()
            r_true = pd.Series(y_true).rank()
            spearman = float(r_pred.corr(r_true))
            if np.isnan(spearman):
                spearman = 0.0
            top20 = calc_top20_hit(y_true, c_pred)

            raw_results[c_name].append({
                "train_until": int(train_until),
                "test_year": int(test_year),
                "mae_pp": round(mae, 2),
                "rmse_pp": round(rmse, 2),
                "spearman": round(spearman, 3),
                "top20_hit": top20,
                "n": int(len(test_df)),
                "baseline_mae_pp": round(baseline_mae, 2),
            })

    # 3. Compute mean MAE per candidate and select winner
    candidates_list: list[dict] = []
    best_candidate = "persist_l1"
    best_overall_mae = float("inf")

    for c_name in CANDIDATE_NAMES:
        folds = raw_results[c_name]
        mean_mae = float(np.mean([f["mae_pp"] for f in folds])) if folds else float("inf")
        candidates_list.append({
            "name": c_name,
            "folds": folds,
            "mean_mae_pp": round(mean_mae, 2) if folds else None,
        })
        if mean_mae < best_overall_mae:
            best_overall_mae = mean_mae
            best_candidate = c_name

    selected_backtests = raw_results.get(best_candidate, [])
    return candidates_list, best_candidate, selected_backtests, float(best_lam)


def fit_structural(
    df_units: pd.DataFrame,
    target: pd.Series | np.ndarray,
    lam: float | None = None,
    folds_by: pd.Series | None = None,
    grid: Sequence[float] = (0.1, 1.0, 3.0, 10.0, 30.0, 100.0),
    features: Sequence[str] | None = None,
) -> StructuralModel:
    """Fit cross-sectional Ridge model explaining average intermediate deviation or turnout.

    Uses 5-fold cross-validation grouped by cve_ent (int(cve_ent) % 5) to evaluate
    and select optimal lambda (or evaluate given lambda).
    """
    if isinstance(lam, pd.Series):
        folds_by = lam
        lam = None

    if not isinstance(target, pd.Series):
        target = pd.Series(target, index=df_units.index)

    target_vals = pd.to_numeric(target, errors="coerce")
    valid_mask = ~target_vals.isna()

    if isinstance(valid_mask, pd.Series) and valid_mask.index.equals(df_units.index):
        X_clean = df_units.loc[valid_mask].copy()
        y_clean = target_vals.loc[valid_mask].copy()
        f_series = folds_by.loc[valid_mask] if folds_by is not None else None
    elif len(target_vals) == len(df_units):
        m = valid_mask.values
        X_clean = df_units.iloc[m].copy()
        y_clean = target_vals.iloc[m].copy()
        f_series = folds_by.iloc[m] if folds_by is not None else None
    else:
        common = target_vals.dropna().index.intersection(df_units.index)
        X_clean = df_units.loc[common].copy()
        y_clean = target_vals.loc[common].copy()
        f_series = folds_by.loc[common] if folds_by is not None else None

    # Standardize target if in [0, 1] proportion
    if len(y_clean) > 0 and np.nanmin(y_clean.values) >= 0.0 and np.nanmax(y_clean.values) <= 1.05:
        y_clean = y_clean * 100.0

    if features is not None:
        feature_names = [f for f in features if f in X_clean.columns]
    else:
        candidate_feats = list(BASE_FEATURES) + [f for f in CCPC_FEATURES if f in X_clean.columns] + ["gov_mean"]
        feature_names = [f for f in candidate_feats if f in X_clean.columns]

    if not feature_names:
        feature_names = [c for c in X_clean.columns if c not in ("cvegeo", "cve_ent", "cve_mun", "nom_ent", "nom_mun", "id", "level", "name")]
    if not feature_names:
        feature_names = list(X_clean.columns)

    if len(X_clean) < 3 or len(feature_names) == 0:
        return StructuralModel(
            features=feature_names or list(FEATURES),
            medians={f: 0.0 for f in (feature_names or FEATURES)},
            means={f: 0.0 for f in (feature_names or FEATURES)},
            stds={f: 1.0 for f in (feature_names or FEATURES)},
            coef={f: 0.0 for f in (feature_names or FEATURES)},
            intercept=float(np.mean(y_clean)) if len(y_clean) > 0 else 0.0,
            lam=float(lam) if lam is not None else 10.0,
            cv_r2=0.0,
        )

    if f_series is None:
        if "cve_ent" in X_clean.columns:
            f_series = X_clean["cve_ent"]
        elif "cvegeo" in X_clean.columns:
            f_series = X_clean["cvegeo"].astype(str).str[:2]
        elif len(X_clean) > 0 and len(str(X_clean.index[0])) >= 2:
            f_series = pd.Series(X_clean.index.astype(str).str[:2], index=X_clean.index)
        else:
            f_series = pd.Series(np.arange(len(X_clean)) % 5, index=X_clean.index)

    def _fold_for_val(val: Any) -> int:
        try:
            return int(val) % 5
        except (ValueError, TypeError):
            try:
                return int(str(val)[:2]) % 5
            except (ValueError, TypeError):
                return hash(str(val)) % 5

    fold_ids = np.array([_fold_for_val(v) for v in f_series.values])
    unique_folds = np.unique(fold_ids)
    if len(unique_folds) < 2 and len(X_clean) >= 5:
        fold_ids = np.arange(len(X_clean)) % 5
        unique_folds = np.unique(fold_ids)

    candidates = [float(lam)] if lam is not None else [float(g) for g in grid]
    best_lam = candidates[0]
    best_r2 = -float("inf")

    for cand in candidates:
        oof_preds = np.full(len(X_clean), np.nan, dtype=float)
        for k in unique_folds:
            val_idx = np.where(fold_ids == k)[0]
            train_idx = np.where(fold_ids != k)[0]
            if len(val_idx) == 0 or len(train_idx) < 3:
                continue
            X_tr = X_clean.iloc[train_idx][feature_names]
            y_tr = y_clean.iloc[train_idx]
            X_val = X_clean.iloc[val_idx][feature_names]

            fold_ridge = fit_ridge(X_tr, y_tr, lam=cand, is_deviation=True)
            pred_val = predict(fold_ridge, X_val, clip_range=None)
            oof_preds[val_idx] = pred_val

        evaluated = ~np.isnan(oof_preds)
        if evaluated.sum() >= 5:
            y_eval = y_clean.iloc[evaluated].values.astype(float)
            ss_res = float(np.sum((y_eval - oof_preds[evaluated]) ** 2))
            ss_tot = float(np.sum((y_eval - np.mean(y_eval)) ** 2))
            r2 = 1.0 - (ss_res / ss_tot) if ss_tot > 1e-12 else 0.0
        else:
            r2 = 0.0

        if r2 > best_r2:
            best_r2 = r2
            best_lam = cand

    if best_r2 == -float("inf"):
        best_r2 = 0.0

    full_ridge = fit_ridge(X_clean[feature_names], y_clean, lam=best_lam, is_deviation=True)
    return StructuralModel(
        features=full_ridge.features,
        medians=full_ridge.medians,
        means=full_ridge.means,
        stds=full_ridge.stds,
        coef=full_ridge.coef,
        intercept=full_ridge.intercept,
        lam=best_lam,
        cv_r2=float(best_r2),
    )


def contributions_structural(
    model: StructuralModel | RidgeModel,
    X: pd.DataFrame,
    features: Sequence[str] | None = None,
) -> pd.DataFrame:
    """Compute structural feature contributions (coef_k * z_ik) in pp of participation.

    Computed per row and per feature.
    z_ik is standardized relative to the training distribution (national mean/std).
    """
    N = len(X)
    contrib_dict: dict[str, np.ndarray] = {}

    non_feature_cols = {"lag1", "lag2", "pres", "gov_T", "gov_lag1", "gov_lag2"}
    if features is not None:
        feats_to_use = list(features)
    elif model.features == list(FEATURES):
        feats_to_use = list(FEATURES)
    else:
        feats_to_use = [f for f in model.features if f not in non_feature_cols]

    for feat in feats_to_use:
        if feat in model.features and feat in X.columns:
            vals = pd.to_numeric(X[feat], errors="coerce").values.astype(float)
            med = model.medians.get(feat, 0.0)
            filled = np.where(np.isnan(vals), med, vals)
            mean = model.means.get(feat, 0.0)
            std = model.stds.get(feat, 1.0)
            if std < 1e-12:
                std = 1.0
            z = (filled - mean) / std
            contrib_dict[feat] = model.coef.get(feat, 0.0) * z
        else:
            contrib_dict[feat] = np.zeros(N, dtype=float)

    return pd.DataFrame(contrib_dict, index=X.index)
