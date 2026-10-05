"""Tests for ATALAYA forecast module with relative candidates and selection."""

import numpy as np
import pandas as pd
import pytest

from atalaya.model.forecast import (
    FEATURES,
    PREDICTORS,
    RIDGE_RELATIVE_PREDICTORS,
    RidgeModel,
    StructuralModel,
    calc_top20_hit,
    fit_ridge,
    fit_structural,
    predict,
    contributions,
    contributions_structural,
    backtest,
    backtest_candidates,
    select_lambda,
)
from atalaya.model.panel import (
    training_rows,
    deviation_matrix,
    is_presidential,
)


def test_top20_hit_hand_calculated():
    """Verify top20_hit matches an exact manual calculation in a small case.

    Higher abstention = lower participation deviation.
    10 units: N=10, k = round(0.20 * 10) = 2.
    True dev: [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0]
    True top 20% abstention (lowest 2 values) = indices {0, 1}.

    Case A: Pred top 2 lowest values are at indices {0, 2} -> 1 overlap / 2 = 0.50
    """
    yt = np.array([1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0])
    yp_a = np.array([2.0, 5.0, 1.0, 8.0, 9.0, 7.0, 6.0, 10.0, 4.0, 3.0])
    # Lowest in yp_a are 1.0 (idx 2) and 2.0 (idx 0) -> pred {0, 2}
    # Intersection with true {0, 1} is {0} -> 1/2 = 0.5
    assert calc_top20_hit(yt, yp_a) == pytest.approx(0.50)

    # Case B: Perfect overlap
    yp_b = np.array([0.5, 1.5, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0])
    assert calc_top20_hit(yt, yp_b) == pytest.approx(1.0)

    # Case C: Zero overlap
    yp_c = np.array([10.0, 9.0, 8.0, 7.0, 6.0, 5.0, 4.0, 3.0, 2.0, 1.0])
    assert calc_top20_hit(yt, yp_c) == pytest.approx(0.0)


def test_candidate_selector_picks_lowest_mean_mae():
    """Verify backtest_candidates selects the model with lowest average MAE across folds."""
    np.random.seed(42)
    n_units = 30
    mun_ids = [f"01{i:03d}" for i in range(1, n_units + 1)]
    years = [2009, 2012, 2015, 2018, 2021, 2024]

    # Persistent deviations: dev_i remains relatively constant across cycles
    mun_dev = np.random.uniform(-10.0, 10.0, n_units)
    mun_dev -= np.mean(mun_dev)

    # Data where persist_l1 is nearly perfect (tiny noise on dev), while lag2 has a shift
    dev_dict = {}
    for yr in years:
        noise = np.random.normal(0, 0.2, n_units)
        dev_dict[yr] = mun_dev + noise
    dev_df = pd.DataFrame(dev_dict, index=mun_ids)

    feats = pd.DataFrame({
        "cvegeo": mun_ids,
        "cve_ent": ["01"] * n_units,
        "pob_18ymas": [10000] * n_units,
        "pct_18_24": [0.20] * n_units,
    })

    candidates, selected, backtests, lam = backtest_candidates(dev_df, feats)

    assert selected in ["persist_l1", "mean_l1_l2", "ridge"]
    # Check that selected candidate has lowest mean MAE
    cand_maes = {c["name"]: c["mean_mae_pp"] for c in candidates if c["mean_mae_pp"] is not None}
    assert cand_maes[selected] == min(cand_maes.values())


def test_relative_model_outperforms_absolute_under_national_shocks():
    """Verify that when national level has large unpredictable shocks, relative model has lower MAE than naive level model."""
    np.random.seed(42)
    n_units = 40
    mun_ids = [f"01{i:03d}" for i in range(1, n_units + 1)]
    years = [2009, 2012, 2015, 2018, 2021, 2024]

    # Large national swings between presidential and intermediate elections
    national_mean = {2009: 44.0, 2012: 62.0, 2015: 47.0, 2018: 63.0, 2021: 52.0, 2024: 60.0}

    # Persistent municipal deviations (-12 to +12 pp)
    mun_dev = np.random.uniform(-12.0, 12.0, n_units)
    mun_dev -= np.mean(mun_dev)

    Y_dict = {}
    for yr in years:
        # Turnout = national shock + municipal deviation + tiny noise
        y_pp = national_mean[yr] + mun_dev + np.random.normal(0, 0.8, n_units)
        Y_dict[yr] = y_pp / 100.0

    Y = pd.DataFrame(Y_dict, index=mun_ids)
    dev_matrix, _ = deviation_matrix(Y)

    # In 2024 (presidential, ~60%), absolute lag1 is 2021 (intermediate, ~52%), gap ~ 8 pp!
    y_true_2024_pp = Y[2024].values * 100.0
    abs_lag1_pred_pp = Y[2021].values * 100.0
    mae_absolute_lag1 = float(np.mean(np.abs(abs_lag1_pred_pp - y_true_2024_pp)))

    # Relative deviation model: dev_2024 predicted by dev_2021
    dev_true_2024 = dev_matrix[2024].values
    dev_pred_2021 = dev_matrix[2021].values
    mae_relative_dev = float(np.mean(np.abs(dev_pred_2021 - dev_true_2024)))

    # Relative deviation error should be much smaller than the absolute level lag error
    assert mae_relative_dev < 2.5
    assert mae_absolute_lag1 > 6.0
    assert mae_relative_dev < mae_absolute_lag1


def test_fit_ridge_recovers_linear_coefficients():
    """Verify Ridge regression with tiny lambda recovers known coefficients."""
    np.random.seed(42)
    N = 200
    x1 = np.random.normal(0, 1, N)
    x2 = np.random.normal(5, 2, N)
    X = pd.DataFrame({"feat1": x1, "feat2": x2})

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
    assert model.medians["feat1"] == pytest.approx(3.0)
    assert model.medians["feat2"] == pytest.approx(35.0)

    X_test = pd.DataFrame({"feat1": [np.nan], "feat2": [np.nan]})
    preds = predict(model, X_test)
    assert len(preds) == 1
    assert np.isfinite(preds[0])


def test_predict_clipping():
    """Verify predict clips outputs to [5.0, 98.0] by default."""
    X = pd.DataFrame({"feat1": [0.0]})
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
    """Verify feature contributions calculation excludes lags and pres/gov."""
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
            "pct_18_24": [2.0],
            "pct_65ymas": [1.0],
        }
    )
    contrib_df = contributions(model, X)
    assert list(contrib_df.columns) == list(FEATURES)
    assert "lag1" not in contrib_df.columns
    assert "pres" not in contrib_df.columns
    assert contrib_df.loc[0, "pct_18_24"] == pytest.approx(3.0)


def test_backtest_and_select_lambda():
    """Verify backtesting produces 2 folds."""
    np.random.seed(123)
    n_units = 50
    mun_ids = [f"01{i:03d}" for i in range(1, n_units + 1)]
    years = [2009, 2012, 2015, 2018, 2021, 2024]

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

    Y_dict = {}
    for yr in years:
        pres_bump = 0.12 if yr in (2012, 2018, 2024) else 0.0
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


def test_fit_structural_recovers_planted_effects():
    """Verify fit_structural recovers planted effects and cv_r2 > 0.3."""
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

    z_18_24 = (pct_18_24 - np.mean(pct_18_24)) / np.std(pct_18_24)
    z_grap = (graproes - np.mean(graproes)) / np.std(graproes)

    state_effect = np.array([float(int(e)) * 0.5 for e in cve_ents])
    noise = np.random.normal(0, 1.2, total_n)
    target_pp = 50.0 - 4.0 * z_18_24 + 3.0 * z_grap + state_effect + noise
    target_series = pd.Series(target_pp, index=mun_ids)

    model = fit_structural(df_units, target_series, folds_by=df_units["cve_ent"])

    assert model.coef["pct_18_24"] < 0
    assert model.coef["graproes"] > 0
    assert model.coef["pct_18_24"] == pytest.approx(-4.0, rel=0.30)
    assert model.coef["graproes"] == pytest.approx(3.0, rel=0.30)
    assert model.cv_r2 > 0.3


def test_select_lambda_uses_2021_fold(monkeypatch):
    """Verify select_lambda evaluates MAE on the earliest fold (2021) not 2024."""
    def mock_backtest(Y, feats, lam, **kwargs):
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
    assert best_lam == 0.1
