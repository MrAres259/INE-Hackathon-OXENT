"""Ridge regression forecasting and backtesting using NumPy."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Sequence

import numpy as np
import pandas as pd

from atalaya.model.panel import training_rows

FEATURES: tuple[str, ...] = (
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

PREDICTORS: list[str] = ["lag1", "lag2", "pres"] + list(FEATURES)


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



def fit_ridge(
    X: pd.DataFrame,
    y: np.ndarray | pd.Series,
    lam: float,
) -> RidgeModel:
    """Fit closed-form Ridge regression on standardized features.

    Imputes NaNs with column medians, standardizes with training mean/std,
    centers y in percentage points (y*100), and solves (XᵀX + lam·I)β = Xᵀy.
    """
    feature_names = list(X.columns)
    N = len(X)
    P = len(feature_names)

    y_arr = np.asarray(y, dtype=float)
    if np.nanmax(y_arr) <= 1.05:
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
    )


def predict(model: RidgeModel, X: pd.DataFrame) -> np.ndarray:
    """Predict turnout in percentage points, clipped to [5.0, 98.0]."""
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

    return np.clip(pred, 5.0, 98.0)


def contributions(model: RidgeModel, X: pd.DataFrame) -> pd.DataFrame:
    """Compute feature contributions (coef_k * z_ik) in pp of participation.

    Computed per row and per feature in FEATURES (excluding lags and pres).
    """
    N = len(X)
    contrib_dict: dict[str, np.ndarray] = {}

    for feat in FEATURES:
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
) -> list[dict]:
    """Run temporal backtesting folds: (train <= 2018 -> 2021) and (train <= 2021 -> 2024).

    Returns list of dicts with metrics: mae_pp, rmse_pp, spearman, n, baseline_mae_pp.
    """
    fold_specs = [
        (2018, 2021),
        (2021, 2024),
    ]

    results: list[dict] = []
    for train_until, test_year in fold_specs:
        # Check if test year can form lag1 and lag2 in Y
        if test_year not in Y.columns or (test_year - 3) not in Y.columns or (test_year - 6) not in Y.columns:
            continue

        train_targets = [t for t in Y.columns if t <= train_until and (t - 3) in Y.columns and (t - 6) in Y.columns]
        if not train_targets:
            continue

        train_df = training_rows(Y, feats, train_targets)
        test_df = training_rows(Y, feats, [test_year])

        if len(train_df) < 5 or len(test_df) == 0:
            continue

        # Check predictors present
        pred_cols = [c for c in PREDICTORS if c in train_df.columns]
        if len(pred_cols) < 3:
            continue

        model = fit_ridge(train_df[pred_cols], train_df["y"], lam)

        y_true_pp = test_df["y"].values.astype(float) * 100.0
        y_pred_pp = predict(model, test_df[pred_cols])
        baseline_pred_pp = test_df["lag2"].values.astype(float) * 100.0

        diff = y_pred_pp - y_true_pp
        mae_pp = float(np.mean(np.abs(diff)))
        rmse_pp = float(np.sqrt(np.mean(diff ** 2)))
        baseline_mae_pp = float(np.mean(np.abs(baseline_pred_pp - y_true_pp)))

        r_pred = pd.Series(y_pred_pp).rank()
        r_true = pd.Series(y_true_pp).rank()
        spearman = float(r_pred.corr(r_true))
        if np.isnan(spearman):
            spearman = 0.0

        results.append({
            "train_until": int(train_until),
            "test_year": int(test_year),
            "mae_pp": round(mae_pp, 2),
            "rmse_pp": round(rmse_pp, 2),
            "spearman": round(spearman, 3),
            "n": int(len(test_df)),
            "baseline_mae_pp": round(baseline_mae_pp, 2),
        })

    return results


def select_lambda(
    Y: pd.DataFrame,
    feats: pd.DataFrame,
    grid: Sequence[float] = (0.1, 1.0, 3.0, 10.0, 30.0, 100.0),
) -> float:
    """Select ridge penalty lambda minimizing MAE on the earliest available backtest fold (test 2021).

    If no backtest fold is available, returns 10.0.
    """
    best_lam = 10.0
    best_mae = float("inf")
    found = False

    for lam in grid:
        folds = backtest(Y, feats, float(lam))
        if folds:
            found = True
            first_fold_mae = folds[0]["mae_pp"]
            if first_fold_mae < best_mae:
                best_mae = first_fold_mae
                best_lam = float(lam)

    return float(best_lam) if found else 10.0


def fit_structural(
    df_units: pd.DataFrame,
    target: pd.Series | np.ndarray,
    lam: float | None = None,
    folds_by: pd.Series | None = None,
    grid: Sequence[float] = (0.1, 1.0, 3.0, 10.0, 30.0, 100.0),
) -> StructuralModel:
    """Fit cross-sectional Ridge model explaining average intermediate turnout.

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

    if len(y_clean) > 0 and np.nanmax(y_clean.values) <= 1.05:
        y_clean = y_clean * 100.0

    feature_names = [f for f in FEATURES if f in X_clean.columns]
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
            intercept=float(np.mean(y_clean)) if len(y_clean) > 0 else 50.0,
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

            fold_ridge = fit_ridge(X_tr, y_tr, lam=cand)
            pred_val = predict(fold_ridge, X_val)
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

    full_ridge = fit_ridge(X_clean[feature_names], y_clean, lam=best_lam)
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
) -> pd.DataFrame:
    """Compute structural feature contributions (coef_k * z_ik) in pp of participation.

    Computed per row and per feature in FEATURES.
    z_ik is standardized relative to the training distribution (national mean/std).
    """
    N = len(X)
    contrib_dict: dict[str, np.ndarray] = {}

    for feat in FEATURES:
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

