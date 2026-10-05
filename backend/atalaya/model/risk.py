"""Risk score calculation and category assignment for units."""
from __future__ import annotations

import numpy as np
import pandas as pd

WEIGHTS = {"pred_abstention": 0.60, "trend": 0.25, "volatility": 0.15}
THRESHOLDS = [("rojo", 75.0), ("naranja", 55.0), ("amarillo", 35.0)]  # else "verde"


def category_for(score: float | None) -> str:
    """Maps a risk score (0..100) to its semaphore category. None/NaN -> 'sin_dato'."""
    if score is None or pd.isna(score):
        return "sin_dato"
    for cat, threshold in THRESHOLDS:
        if score >= threshold:
            return cat
    return "verde"


def _calc_rank(series: pd.Series) -> pd.Series:
    """Computes percentile rank in [0, 1] using method='average'.

    If single valid value -> 0.5. Missing values remain NaN.
    """
    valid = series.dropna()
    res = pd.Series(np.nan, index=series.index, dtype=float)
    if len(valid) == 1:
        res.loc[valid.index] = 0.5
    elif len(valid) > 1:
        res.loc[valid.index] = valid.rank(pct=True, method="average")
    return res


def compute_risk(df: pd.DataFrame) -> pd.DataFrame:
    """Computes risk_score (0..100, 1 decimal) and category for each unit.

    Operates within each geographic level (e.g. 'mun', 'state').
    Trend uses -trend_pp (decline in participation => higher risk).
    Missing trend or volatility defaults that component to 0.5.
    Missing pred_abstention results in NaN risk_score and 'sin_dato' category.
    """
    out = df.copy()
    if len(out) == 0:
        out["risk_score"] = pd.Series(dtype=float)
        out["category"] = pd.Series(dtype=object)
        return out

    risk_scores = pd.Series(np.nan, index=out.index, dtype=float)
    categories = pd.Series("sin_dato", index=out.index, dtype=object)

    levels = out["level"].unique() if "level" in out.columns else [None]

    for level in levels:
        mask = out["level"] == level if level is not None else pd.Series(True, index=out.index)
        group = out.loc[mask]
        if len(group) == 0:
            continue

        # 1. pred_abstention rank
        r_abs = _calc_rank(group["pred_abstention"])

        # 2. trend rank (-trend_pp), missing -> 0.5
        if "trend_pp" in group.columns:
            r_trend = _calc_rank(-group["trend_pp"]).fillna(0.5)
        else:
            r_trend = pd.Series(0.5, index=group.index, dtype=float)

        # 3. volatility rank, missing -> 0.5
        if "volatility_pp" in group.columns:
            r_vol = _calc_rank(group["volatility_pp"]).fillna(0.5)
        else:
            r_vol = pd.Series(0.5, index=group.index, dtype=float)

        # Calculate scores for valid pred_abstention
        valid_mask = r_abs.notna()
        if valid_mask.any():
            raw_scores = 100.0 * (
                WEIGHTS["pred_abstention"] * r_abs[valid_mask]
                + WEIGHTS["trend"] * r_trend[valid_mask]
                + WEIGHTS["volatility"] * r_vol[valid_mask]
            )
            rounded = raw_scores.round(1)
            risk_scores.loc[rounded.index] = rounded
            for idx, sc in rounded.items():
                categories.loc[idx] = category_for(sc)

    out["risk_score"] = risk_scores
    out["category"] = categories
    return out


def rescore(base: pd.DataFrame, new_pred_abstention: pd.Series | pd.DataFrame) -> pd.DataFrame:
    """Recalculates risk_score and category for new_pred_abstention ranked against base distribution.

    Preserves trend and volatility ranks from base.
    """
    if isinstance(new_pred_abstention, pd.DataFrame):
        new_series = new_pred_abstention["pred_abstention"]
    else:
        new_series = new_pred_abstention

    new_series = new_series.reindex(base.index)
    risk_scores = pd.Series(np.nan, index=base.index, dtype=float)
    categories = pd.Series("sin_dato", index=base.index, dtype=object)

    levels = base["level"].unique() if "level" in base.columns else [None]

    for level in levels:
        mask = base["level"] == level if level is not None else pd.Series(True, index=base.index)
        group = base.loc[mask]
        if len(group) == 0:
            continue

        base_abs = group["pred_abstention"].dropna().values
        sorted_base = np.sort(base_abs)
        n = len(sorted_base)

        new_vals = new_series.loc[group.index]
        r_abs = pd.Series(np.nan, index=group.index, dtype=float)

        if n == 1:
            valid_new = new_vals.dropna()
            r_abs.loc[valid_new.index] = 0.5
        elif n > 1:
            valid_new = new_vals.dropna()
            if len(valid_new) > 0:
                left = np.searchsorted(sorted_base, valid_new.values, side="left")
                right = np.searchsorted(sorted_base, valid_new.values, side="right")
                r_abs.loc[valid_new.index] = (left + right) / (2.0 * n)

        # Trend and volatility from base
        if "trend_pp" in group.columns:
            r_trend = _calc_rank(-group["trend_pp"]).fillna(0.5)
        else:
            r_trend = pd.Series(0.5, index=group.index, dtype=float)

        if "volatility_pp" in group.columns:
            r_vol = _calc_rank(group["volatility_pp"]).fillna(0.5)
        else:
            r_vol = pd.Series(0.5, index=group.index, dtype=float)

        valid_mask = r_abs.notna()
        if valid_mask.any():
            raw_scores = 100.0 * (
                WEIGHTS["pred_abstention"] * r_abs[valid_mask]
                + WEIGHTS["trend"] * r_trend[valid_mask]
                + WEIGHTS["volatility"] * r_vol[valid_mask]
            )
            rounded = raw_scores.round(1)
            risk_scores.loc[rounded.index] = rounded
            for idx, sc in rounded.items():
                categories.loc[idx] = category_for(sc)

    return pd.DataFrame({"risk_score": risk_scores, "category": categories}, index=base.index)
