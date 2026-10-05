"""Unit tests for atalaya.model.risk."""
import numpy as np
import pandas as pd
import pytest

from atalaya.model.risk import WEIGHTS, THRESHOLDS, category_for, compute_risk, rescore


def test_category_for_thresholds():
    assert category_for(75.0) == "rojo"
    assert category_for(74.9) == "naranja"
    assert category_for(55.0) == "naranja"
    assert category_for(54.9) == "amarillo"
    assert category_for(35.0) == "amarillo"
    assert category_for(34.9) == "verde"
    assert category_for(0.0) == "verde"
    assert category_for(None) == "sin_dato"
    assert category_for(np.nan) == "sin_dato"


def test_compute_risk_weights_and_ranks():
    # 2 units in same level
    df = pd.DataFrame({
        "id": ["01", "02"],
        "level": ["mun", "mun"],
        "pred_abstention": [0.3, 0.7],  # ranks: 0.5, 1.0
        "trend_pp": [-1.0, 1.0],        # -trend: [1.0, -1.0] => ranks: [1.0, 0.5]
        "volatility_pp": [2.0, 4.0],    # ranks: [0.5, 1.0]
    })
    res = compute_risk(df)
    # Unit 0: r_abs=0.5, r_trend=1.0, r_vol=0.5
    # score = 100 * (0.6*0.5 + 0.25*1.0 + 0.15*0.5) = 100 * (0.30 + 0.25 + 0.075) = 62.5
    assert np.isclose(res.loc[0, "risk_score"], 62.5)
    assert res.loc[0, "category"] == "naranja"

    # Unit 1: r_abs=1.0, r_trend=0.5, r_vol=1.0
    # score = 100 * (0.6*1.0 + 0.25*0.5 + 0.15*1.0) = 100 * (0.60 + 0.125 + 0.15) = 87.5
    assert np.isclose(res.loc[1, "risk_score"], 87.5)
    assert res.loc[1, "category"] == "rojo"


def test_compute_risk_by_level():
    df = pd.DataFrame({
        "id": ["01", "02", "10"],
        "level": ["mun", "mun", "state"],
        "pred_abstention": [0.4, 0.6, 0.5],
        "trend_pp": [0.0, 0.0, 0.0],
        "volatility_pp": [1.0, 1.0, 1.0],
    })
    res = compute_risk(df)
    # state has single unit, so all ranks are 0.5
    # score = 100 * (0.6*0.5 + 0.25*0.5 + 0.15*0.5) = 50.0
    assert np.isclose(res.loc[2, "risk_score"], 50.0)
    assert res.loc[2, "category"] == "amarillo"


def test_compute_risk_missing_values():
    df = pd.DataFrame({
        "id": ["01", "02", "03"],
        "level": ["mun", "mun", "mun"],
        "pred_abstention": [0.4, np.nan, 0.6],
        "trend_pp": [np.nan, 1.0, -1.0],
        "volatility_pp": [1.0, np.nan, 2.0],
    })
    res = compute_risk(df)
    # Unit 02 has missing pred_abstention => NaN score and sin_dato
    assert pd.isna(res.loc[1, "risk_score"])
    assert res.loc[1, "category"] == "sin_dato"

    # Unit 01 has missing trend => r_trend should default to 0.5
    assert not pd.isna(res.loc[0, "risk_score"])


def test_rescore_approx_compute_risk():
    np.random.seed(42)
    n = 150
    df = pd.DataFrame({
        "id": [f"mun_{i}" for i in range(n)],
        "level": ["mun"] * n,
        "pred_abstention": np.random.uniform(0.2, 0.8, size=n),
        "trend_pp": np.random.normal(0, 2, size=n),
        "volatility_pp": np.random.uniform(0.5, 5.0, size=n),
    })
    base_res = compute_risk(df)
    # Rescore with same series
    rescored_series = rescore(df, df["pred_abstention"])
    # Difference should be <= 0.5 points
    diff = (rescored_series["risk_score"] - base_res["risk_score"]).abs().max()
    assert diff <= 0.5, f"Max diff {diff} exceeds 0.5"

    # Rescore passing DataFrame
    rescored_df = rescore(df, df)
    diff2 = (rescored_df["risk_score"] - base_res["risk_score"]).abs().max()
    assert diff2 <= 0.5, f"Max diff {diff2} exceeds 0.5"


def test_rescore_lower_abstention_monotonous():
    np.random.seed(42)
    n = 50
    df = pd.DataFrame({
        "id": [f"mun_{i}" for i in range(n)],
        "level": ["mun"] * n,
        "pred_abstention": np.random.uniform(0.3, 0.7, size=n),
        "trend_pp": np.random.normal(0, 1, size=n),
        "volatility_pp": np.random.uniform(1.0, 3.0, size=n),
    })
    r1 = rescore(df, df["pred_abstention"])
    # lower abstention
    r2 = rescore(df, df["pred_abstention"] - 0.05)
    # score must be lower or equal
    assert (r2["risk_score"] <= r1["risk_score"] + 1e-5).all()
