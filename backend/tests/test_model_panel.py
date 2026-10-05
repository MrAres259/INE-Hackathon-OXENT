"""Tests for ATALAYA panel data and trend analysis."""

import numpy as np
import pandas as pd
import pytest

from atalaya.model.panel import (
    is_presidential,
    load_inputs,
    participation_matrix,
    lista_nominal_matrix,
    unit_trend,
    training_rows,
    intermediate_turnout,
)


def test_is_presidential():
    """Verify presidential election year classification."""
    assert is_presidential(2000) == 1
    assert is_presidential(2006) == 1
    assert is_presidential(2012) == 1
    assert is_presidential(2018) == 1
    assert is_presidential(2024) == 1

    assert is_presidential(2009) == 0
    assert is_presidential(2015) == 0
    assert is_presidential(2021) == 0
    assert is_presidential(2027) == 0


def test_participation_matrix_and_lista_nominal():
    """Verify pivoting participation and nominal list tables."""
    data = [
        {"cvegeo": "01001", "year": 2018, "election": "DIP_FED", "participacion": 0.62, "lista_nominal": 10000},
        {"cvegeo": "01001", "year": 2021, "election": "DIP_FED", "participacion": 0.55, "lista_nominal": 10500},
        {"cvegeo": "01002", "year": 2018, "election": "DIP_FED", "participacion": 0.58, "lista_nominal": 5000},
        {"cvegeo": "01002", "year": 2021, "election": "DIP_FED", "participacion": 0.50, "lista_nominal": 5200},
        {"cvegeo": "01001", "year": 2024, "election": "PRES", "participacion": 0.65, "lista_nominal": 11000},  # Different election
    ]
    df = pd.DataFrame(data)

    piv = participation_matrix(df, election="DIP_FED", min_year=2018)
    assert piv.shape == (2, 2)
    assert list(piv.columns) == [2018, 2021]
    assert piv.loc["01001", 2018] == pytest.approx(0.62)
    assert piv.loc["01002", 2021] == pytest.approx(0.50)

    ln_piv = lista_nominal_matrix(df, election="DIP_FED", min_year=2018)
    assert ln_piv.loc["01001", 2021] == 10500
    assert ln_piv.loc["01002", 2018] == 5000


def test_unit_trend_recovers_known_slope():
    """Verify OLS trend slope and volatility recovery without noise."""
    years = [2009, 2012, 2015, 2018, 2021, 2024]
    a = 52.0  # base intercept in pp
    b = -1.8  # trend per election cycle in pp
    c = 8.5   # presidential bump in pp

    # y = a + b * k + c * pres
    y_values = []
    for yr in years:
        k = (yr - 2009) / 3.0
        pres = is_presidential(yr)
        y_pp = a + b * k + c * pres
        y_prop = y_pp / 100.0  # input in proportion
        y_values.append(y_prop)

    series = pd.Series(y_values, index=years)
    trend_pp, volatility_pp = unit_trend(series, min_year=2009)

    assert trend_pp == pytest.approx(b, rel=1e-3)
    assert volatility_pp == pytest.approx(0.0, abs=1e-5)


def test_unit_trend_insufficient_points():
    """Verify unit_trend returns (NaN, NaN) when fewer than 4 points exist."""
    short_series = pd.Series([0.5, 0.55, 0.52], index=[2015, 2018, 2021])
    trend_pp, volatility_pp = unit_trend(short_series)
    assert np.isnan(trend_pp)
    assert np.isnan(volatility_pp)


def test_training_rows_lags_and_nan_filtering():
    """Verify training rows structure, lag alignment, and NaN row dropping."""
    # Years: 2009, 2012, 2015, 2018
    # For target 2015: lag1=2012, lag2=2009
    # For target 2018: lag1=2015, lag2=2012
    Y = pd.DataFrame(
        {
            2009: [0.45, 0.50, np.nan],
            2012: [0.55, 0.60, 0.65],
            2015: [0.48, np.nan, 0.52],
            2018: [0.62, 0.68, 0.70],
        },
        index=["01001", "01002", "01003"],
    )

    feats = pd.DataFrame(
        {
            "cvegeo": ["01001", "01002", "01003"],
            "pob_18ymas": [10000, 20000, 15000],
            "pct_18_24": [0.15, 0.18, 0.14],
        }
    )

    targets = [2015, 2018]
    train_df = training_rows(Y, feats, targets)

    # For 2015:
    # 01001: 2015=0.48, lag1=0.55, lag2=0.45 -> Valid
    # 01002: 2015=NaN -> Dropped
    # 01003: 2009=NaN -> Dropped (lag2 is NaN)

    # For 2018:
    # 01001: 2018=0.62, lag1=0.48, lag2=0.55 -> Valid
    # 01002: 2015=NaN (lag1 is NaN) -> Dropped
    # 01003: 2018=0.70, lag1=0.52, lag2=0.65 -> Valid

    assert len(train_df) == 3
    row_2015_01001 = train_df[(train_df["cvegeo"] == "01001") & (train_df["target_year"] == 2015)].iloc[0]
    assert row_2015_01001["y"] == pytest.approx(0.48)
    assert row_2015_01001["lag1"] == pytest.approx(0.55)
    assert row_2015_01001["lag2"] == pytest.approx(0.45)
    assert row_2015_01001["pres"] == 0.0
    assert row_2015_01001["pct_18_24"] == pytest.approx(0.15)
    assert "log_pob_18ymas" in row_2015_01001

    row_2018_01001 = train_df[(train_df["cvegeo"] == "01001") & (train_df["target_year"] == 2018)].iloc[0]
    assert row_2018_01001["y"] == pytest.approx(0.62)
    assert row_2018_01001["lag1"] == pytest.approx(0.48)
    assert row_2018_01001["lag2"] == pytest.approx(0.55)
    assert row_2018_01001["pres"] == 1.0


def test_load_inputs_missing(tmp_path):
    """Verify load_inputs returns empty DataFrames when files are missing."""
    part, feats = load_inputs(tmp_path)
    assert isinstance(part, pd.DataFrame)
    assert isinstance(feats, pd.DataFrame)
    assert part.empty
    assert feats.empty
    assert "cvegeo" in part.columns
    assert "nom_mun" in feats.columns


def test_intermediate_turnout():
    """Verify intermediate_turnout averages non-presidential DIP_FED years and converts to pp."""
    # 2009 (inter), 2012 (pres), 2015 (inter), 2018 (pres), 2021 (inter)
    Y = pd.DataFrame(
        {
            2009: [0.40, np.nan],
            2012: [0.60, 0.65],  # pres - excluded
            2015: [0.46, 0.50],
            2018: [0.62, 0.68],  # pres - excluded
            2021: [0.49, 0.52],
        },
        index=["01001", "01002"],
    )
    target = intermediate_turnout(Y)
    # 01001: (40 + 46 + 49) / 3 = 45.0 pp
    # 01002: (50 + 52) / 2 = 51.0 pp
    assert target.loc["01001"] == pytest.approx(45.0)
    assert target.loc["01002"] == pytest.approx(51.0)

