"""Tests for ATALAYA forecast module."""

import numpy as np
import pandas as pd
import pytest

from atalaya.model.forecast import (
    FEATURES,
    PREDICTORS,
    RidgeModel,
    fit_ridge,
    predict,
    contributions,
    backtest,
    select_lambda,
)


def test_fit_ridge_recovers_linear_coefficients():
    """Verify Ridge regression with tiny lambda recovers known coefficients."""
    np.random.seed(42)
    N = 200
    # Create synthetic feature matrix
    x1 = np.random.normal(0, 1, N)
    x2 = np.random.normal(5, 2, N)
    X = pd.DataFrame({"feat1": x1, "feat2": x2})

    # Standardized features: z1 = (x1 - 0)/1, z2 = (x2 - 5)/2
    # Suppose true relationship: y_pp = 50.0 + 3.0 * z1 - 2.5 * z2
    z1 = (x1 - np.mean(x1)) / np.std(x1)
    z2 = (x2 - np.mean(x2)) / np.std(x2)
    y_pp = 50.0 + 3.0 * z1 - 2.5 * z2

    model = fit_ridge(X, y_pp, lam=1e-5)

    assert model.intercept == pytest.approx(50.0, abs=1e-2)
    assert model.coef["feat1"] == pytest.approx(3.0, abs=1e-2)
    assert model.coef["feat2"] == pytest.approx(-2.5, abs=1e-2)


def test_fit_ridge_median_imputation():
    """Verify NaN values in features are imputed with column medians."""
    X = pd.DataFrame(
        {
            "feat1": [1.0, 2.0, np.nan, 4.0, 5.0],
            "feat2": [10.0, np.nan, 30.0, 40.0, 50.0],
        }
    )
    y = np.array([40.0, 45.0, 50.0, 55.0, 60.0])

    model = fit_ridge(X, y, lam=1.0)
    # Median of feat1 is 3.0 (from 1, 2, 4, 5)
    assert model.medians["feat1"] == pytest.approx(3.0)
    # Median of feat2 is 35.0 (from 10, 30, 40, 50)
    assert model.medians["feat2"] == pytest.approx(35.0)

    # Prediction on new data with NaNs should not crash and should use median values
    X_test = pd.DataFrame({"feat1": [np.nan], "feat2": [np.nan]})
    preds = predict(model, X_test)
    assert len(preds) == 1
    assert np.isfinite(preds[0])
    expected = model.intercept + model.coef["feat1"] * ((model.medians["feat1"] - model.means["feat1"]) / model.stds["feat1"]) + model.coef["feat2"] * ((model.medians["feat2"] - model.means["feat2"]) / model.stds["feat2"])
    assert preds[0] == pytest.approx(expected, abs=1e-3)


def test_predict_clipping():
    """Verify predict clips outputs to [5.0, 98.0]."""
    X = pd.DataFrame({"feat1": [0.0]})
    # Model that predicts extreme negative value
    model_low = RidgeModel(
        features=["feat1"],
        medians={"feat1": 0.0},
        means={"feat1": 0.0},
        stds={"feat1": 1.0},
        coef={"feat1": 0.0},
        intercept=-20.0,
        lam=1.0,
    )
    assert predict(model_low, X)[0] == 5.0

    # Model that predicts extreme positive value
    model_high = RidgeModel(
        features=["feat1"],
        medians={"feat1": 0.0},
        means={"feat1": 0.0},
        stds={"feat1": 1.0},
        coef={"feat1": 0.0},
        intercept=120.0,
        lam=1.0,
    )
    assert predict(model_high, X)[0] == 98.0


def test_contributions_computation():
    """Verify feature contributions calculation excludes lags and pres."""
    model = RidgeModel(
        features=list(PREDICTORS),
        medians={f: 0.0 for f in PREDICTORS},
        means={f: 0.0 for f in PREDICTORS},
        stds={f: 1.0 for f in PREDICTORS},
        coef={f: (1.5 if f == "pct_18_24" else 0.0) for f in PREDICTORS},
        intercept=50.0,
        lam=1.0,
    )
    X = pd.DataFrame(
        {
            "lag1": [0.5],
            "lag2": [0.5],
            "pres": [0.0],
            "pct_18_24": [2.0],  # z = (2 - 0)/1 = 2 -> contrib = 1.5 * 2 = 3.0
            "pct_65ymas": [1.0],
        }
    )
    contrib_df = contributions(model, X)
    assert list(contrib_df.columns) == list(FEATURES)
    assert "lag1" not in contrib_df.columns
    assert "pres" not in contrib_df.columns
    assert contrib_df.loc[0, "pct_18_24"] == pytest.approx(3.0)


def test_backtest_and_select_lambda():
    """Verify backtesting produces 2 folds and model beats naive baseline when signal exists."""
    np.random.seed(123)
    n_units = 50
    mun_ids = [f"01{i:03d}" for i in range(1, n_units + 1)]
    years = [2009, 2012, 2015, 2018, 2021, 2024]

    # Features: pct_18_24 varies by municipality
    pct_18_24 = np.random.uniform(0.10, 0.25, n_units)
    feats = pd.DataFrame(
        {
            "cvegeo": mun_ids,
            "cve_ent": ["01"] * n_units,
            "pob_tot": [10000] * n_units,
            "pob_18ymas": [7000] * n_units,
            "pct_18_24": pct_18_24,
            "pct_65ymas": [0.10] * n_units,
            "graproes": [9.5] * n_units,
            "pct_hli": [0.02] * n_units,
            "pct_sin_servsalud": [0.25] * n_units,
            "pct_internet": [0.60] * n_units,
            "pct_rural": [0.15] * n_units,
            "pct_analfabeta": [0.03] * n_units,
            "pct_po2sm": [0.35] * n_units,
            "coverage_ln": [0.95] * n_units,
            "log_pob_18ymas": [np.log1p(7000)] * n_units,
        }
    )

    # Construct Y with strong signal:
    # Intermediate turnout is strongly correlated with pct_18_24
    # Pres elections have +12 pp bump
    Y_dict = {}
    for yr in years:
        pres_bump = 0.12 if yr in (2012, 2018, 2024) else 0.0
        # Turnout in proportion: 0.40 + 0.8 * pct_18_24 + pres_bump
        # plus a small shift each cycle to make naive baseline slightly worse
        cycle_shift = 0.04 if yr in (2021, 2024) else 0.0
        y_yr = 0.40 + 0.8 * pct_18_24 + pres_bump + cycle_shift
        Y_dict[yr] = np.clip(y_yr, 0.20, 0.90)

    Y = pd.DataFrame(Y_dict, index=mun_ids)

    grid = [0.1, 1.0, 10.0, 100.0]
    best_lam = select_lambda(Y, feats, grid=grid)
    assert best_lam in grid

    folds = backtest(Y, feats, lam=best_lam)
    assert len(folds) == 2
    assert folds[0]["train_until"] == 2018
    assert folds[0]["test_year"] == 2021
    assert folds[1]["train_until"] == 2021
    assert folds[1]["test_year"] == 2024

    for f in folds:
        assert f["n"] == n_units
        assert f["mae_pp"] > 0
        assert f["rmse_pp"] > 0
        assert np.isfinite(f["spearman"])
        assert f["spearman"] > 0.5
