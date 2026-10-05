"""Ridge regression forecasting and backtesting using NumPy."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Sequence

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
    """Select ridge penalty lambda minimizing MAE on the latest available backtest fold.

    If no backtest fold is available, returns 10.0.
    """
    best_lam = 10.0
    best_mae = float("inf")
    found = False

    for lam in grid:
        folds = backtest(Y, feats, float(lam))
        if folds:
            found = True
            last_fold_mae = folds[-1]["mae_pp"]
            if last_fold_mae < best_mae:
                best_mae = last_fold_mae
                best_lam = float(lam)

    return float(best_lam) if found else 10.0
