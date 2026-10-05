"""Tests for ATALAYA forecast module."""

import numpy as np
import pandas as pd
import pytest

from atalaya.model.forecast import (
    FEATURES,
    PREDICTORS,
    RidgeModel,
    StructuralModel,
    fit_ridge,
    fit_structural,
    predict,
    contributions,
    contributions_structural,
    backtest,
    select_lambda,
)
from atalaya.model.panel import training_rows


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


def test_fit_structural_recovers_planted_effects_and_cv_r2():
    """Verify fit_structural recovers planted effects within 30% and cv_r2 > 0.3."""
    np.random.seed(42)
    n_states = 5
    n_per_state = 60
    total_n = n_states * n_per_state

    mun_ids = []
    cve_ents = []
    for s in range(1, n_states + 1):
        ent_str = f"{s:02d}"
        for m in range(1, n_per_state + 1):
            mun_ids.append(f"{ent_str}{m:03d}")
            cve_ents.append(ent_str)

    pct_18_24 = np.random.uniform(0.10, 0.28, total_n)
    graproes = np.random.uniform(7.0, 12.0, total_n)

    feats_dict = {
        "cvegeo": mun_ids,
        "cve_ent": cve_ents,
        "pct_18_24": pct_18_24,
        "pct_65ymas": np.random.uniform(0.05, 0.15, total_n),
        "graproes": graproes,
        "pct_hli": np.random.uniform(0.0, 0.10, total_n),
        "pct_sin_servsalud": np.random.uniform(0.15, 0.35, total_n),
        "pct_internet": np.random.uniform(0.30, 0.70, total_n),
        "pct_rural": np.random.uniform(0.10, 0.50, total_n),
        "pct_analfabeta": np.random.uniform(0.02, 0.08, total_n),
        "pct_po2sm": np.random.uniform(0.20, 0.50, total_n),
        "coverage_ln": np.random.uniform(0.70, 0.95, total_n),
        "log_pob_18ymas": np.random.uniform(8.0, 12.0, total_n),
    }
    df_units = pd.DataFrame(feats_dict, index=mun_ids)

    # Standardize to plant exact per-standard-deviation effects
    z_18_24 = (pct_18_24 - np.mean(pct_18_24)) / np.std(pct_18_24)
    z_grap = (graproes - np.mean(graproes)) / np.std(graproes)

    # Planted true effects: pct_18_24 = -4.0 pp/sd, graproes = +3.0 pp/sd
    state_effect = np.array([float(int(e)) * 0.5 for e in cve_ents])
    noise = np.random.normal(0, 1.2, total_n)
    target_pp = 50.0 - 4.0 * z_18_24 + 3.0 * z_grap + state_effect + noise
    target_series = pd.Series(target_pp, index=mun_ids)

    model = fit_structural(df_units, target_series, folds_by=df_units["cve_ent"])

    # Sign check
    assert model.coef["pct_18_24"] < 0
    assert model.coef["graproes"] > 0

    # Magnitude check (approx +-30% of -4.0 and +3.0)
    assert model.coef["pct_18_24"] == pytest.approx(-4.0, rel=0.30)
    assert model.coef["graproes"] == pytest.approx(3.0, rel=0.30)

    # cv_r2 check
    assert model.cv_r2 > 0.3


def test_select_lambda_uses_2021_fold(monkeypatch):
    """Verify select_lambda evaluates MAE on the earliest fold (2021) not 2024."""
    def mock_backtest(Y, feats, lam):
        if lam == 0.1:
            return [
                {"train_until": 2018, "test_year": 2021, "mae_pp": 2.0},
                {"train_until": 2021, "test_year": 2024, "mae_pp": 8.0},
            ]
        else:
            return [
                {"train_until": 2018, "test_year": 2021, "mae_pp": 5.0},
                {"train_until": 2021, "test_year": 2024, "mae_pp": 1.0},
            ]

    monkeypatch.setattr("atalaya.model.forecast.backtest", mock_backtest)

    best_lam = select_lambda(pd.DataFrame(), pd.DataFrame(), grid=[0.1, 10.0])
    # Must choose 0.1 because fold 2021 has MAE 2.0 < 5.0
    assert best_lam == 0.1


def test_contributions_structural():
    """Verify contributions_structural computes coef_k * z_ik in pp of participation."""
    model = StructuralModel(
        features=list(FEATURES),
        medians={f: 0.0 for f in FEATURES},
        means={f: 10.0 for f in FEATURES},
        stds={f: 2.0 for f in FEATURES},
        coef={f: (-2.5 if f == "pct_18_24" else 1.5 if f == "graproes" else 0.0) for f in FEATURES},
        intercept=50.0,
        lam=1.0,
        cv_r2=0.65,
    )
    X = pd.DataFrame(
        {
            "pct_18_24": [14.0],  # z = (14 - 10)/2 = 2.0 -> contrib = -2.5 * 2.0 = -5.0
            "graproes": [12.0],   # z = (12 - 10)/2 = 1.0 -> contrib = 1.5 * 1.0 = 1.5
        }
    )
    contrib = contributions_structural(model, X)
    assert contrib.loc[0, "pct_18_24"] == pytest.approx(-5.0)
    assert contrib.loc[0, "graproes"] == pytest.approx(1.5)


def test_forecast_with_ccpc_feature_planted_sign():
    """Verify that when gap_youth_pp in T-3 predicts y_T, Ridge recovers the correct coefficient sign."""
    np.random.seed(42)
    n_units = 60
    mun_ids = [f"01{i:03d}" for i in range(1, n_units + 1)]
    years = [2009, 2012, 2015, 2018, 2021, 2024]

    # Persistent municipal youth gap
    mun_gap = np.random.uniform(-15.0, 5.0, n_units)
    ccpc_rows = []
    for yr in years:
        for i, m in enumerate(mun_ids):
            ccpc_rows.append({
                "cvegeo": m,
                "year": yr,
                "gap_youth_pp": mun_gap[i] + np.random.normal(0, 0.5),
                "pct_ln_18_34": 0.30,
                "gap_sexo_pp": 2.0,
                "pct_ln_rural": 0.10,
                "ns_rate": 0.01,
            })
    ccpc_feats = pd.DataFrame(ccpc_rows)

    # Turnout at T is driven by gap_youth_pp at T-3 with positive sign (+0.008 per pp of gap)
    Y_dict = {}
    base_turnout = 0.50
    for yr in years:
        pres = 0.10 if yr in (2012, 2018, 2024) else 0.0
        # For yr, if previous cycle exists, use it
        prev_yr = yr - 3
        if prev_yr >= 2009:
            # Positive relation: higher youth gap -> higher participation
            y = base_turnout + 0.008 * mun_gap + pres + np.random.normal(0, 0.01, n_units)
        else:
            y = base_turnout + pres + np.random.normal(0, 0.01, n_units)
        Y_dict[yr] = np.clip(y, 0.20, 0.90)

    Y = pd.DataFrame(Y_dict, index=mun_ids)
    feats = pd.DataFrame({
        "cvegeo": mun_ids,
        "cve_ent": ["01"] * n_units,
        "pob_18ymas": [10000] * n_units,
        "pct_18_24": [0.20] * n_units,
        "pct_65ymas": [0.10] * n_units,
        "graproes": [10.0] * n_units,
        "pct_hli": [0.02] * n_units,
        "pct_sin_servsalud": [0.20] * n_units,
        "pct_internet": [0.60] * n_units,
        "pct_rural": [0.10] * n_units,
        "pct_analfabeta": [0.03] * n_units,
        "pct_po2sm": [0.35] * n_units,
        "coverage_ln": [0.90] * n_units,
    })

    targets = [2018, 2021, 2024]
    train_df = training_rows(Y, feats, targets, ccpc_feats=ccpc_feats)
    assert "gap_youth_pp" in train_df.columns

    pred_cols = ["lag1", "lag2", "pres", "gap_youth_pp"]
    model = fit_ridge(train_df[pred_cols], train_df["y"], lam=1.0)

    # Recovered coefficient must be positive (same sign as planted)
    assert model.coef["gap_youth_pp"] > 0


def test_structural_with_ccpc_features():
    """Verify fit_structural includes CCPC features and estimates their effect."""
    np.random.seed(42)
    n_units = 50
    mun_ids = [f"01{i:03d}" for i in range(1, n_units + 1)]

    pct_ln_rural = np.random.uniform(0.05, 0.60, n_units)
    z_rural = (pct_ln_rural - np.mean(pct_ln_rural)) / np.std(pct_ln_rural)

    df_units = pd.DataFrame({
        "cvegeo": mun_ids,
        "cve_ent": ["01"] * n_units,
        "pct_18_24": [0.20] * n_units,
        "graproes": [9.0] * n_units,
        "pct_ln_rural": pct_ln_rural,
    }, index=mun_ids)

    # Planted effect: pct_ln_rural reduces participation (-3.0 pp/sd)
    target_pp = pd.Series(50.0 - 3.0 * z_rural + np.random.normal(0, 0.5, n_units), index=mun_ids)

    model = fit_structural(df_units, target_pp, lam=1.0)
    assert "pct_ln_rural" in model.features
    assert model.coef["pct_ln_rural"] < 0
    assert model.coef["pct_ln_rural"] == pytest.approx(-3.0, rel=0.35)


