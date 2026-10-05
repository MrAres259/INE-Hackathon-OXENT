"""Tests for ATALAYA panel data, relative deviations, and trend analysis."""

from pathlib import Path
import numpy as np
import pandas as pd
import pytest

from atalaya.model.panel import (
    is_presidential,
    load_concurrencia,
    is_gubernatorial,
    compute_reliable,
    deviation_matrix,
    intermediate_offset,
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


def test_compute_reliable_rule():
    """Verify §11.1 reliability rule: reliable = (ns_rate <= 0.5) and (participacion >= 0.02)."""
    df = pd.DataFrame([
        # Case 1: normal reliable
        {"cvegeo": "01001", "participacion": 0.55, "ns": 10, "lista_nominal": 1000},
        # Case 2: high NS rate (> 0.5) -> unreliable
        {"cvegeo": "01002", "participacion": 0.55, "ns": 600, "lista_nominal": 1000},
        # Case 3: very low participation (< 0.02) -> unreliable
        {"cvegeo": "01003", "participacion": 0.01, "ns": 10, "lista_nominal": 1000},
        # Case 4: NaN participation -> unreliable
        {"cvegeo": "01004", "participacion": np.nan, "ns": 10, "lista_nominal": 1000},
    ])

    rel = compute_reliable(df)
    assert bool(rel.iloc[0]) is True
    assert bool(rel.iloc[1]) is False
    assert bool(rel.iloc[2]) is False
    assert bool(rel.iloc[3]) is False

    # Case 5: explicit reliable column present -> uses it directly
    df_explicit = pd.DataFrame([
        {"cvegeo": "01001", "participacion": 0.55, "ns": 10, "lista_nominal": 1000, "reliable": False},
        {"cvegeo": "01002", "participacion": 0.01, "ns": 10, "lista_nominal": 1000, "reliable": True},
    ])
    rel_exp = compute_reliable(df_explicit)
    assert bool(rel_exp.iloc[0]) is False
    assert bool(rel_exp.iloc[1]) is True


def test_participation_matrix_reliable_only():
    """Verify participation_matrix filters out non-reliable municipality-years when reliable_only=True."""
    df = pd.DataFrame([
        {"cvegeo": "01001", "year": 2021, "election": "DIP_FED", "participacion": 0.55, "ns": 10, "lista_nominal": 1000},
        # 01002 is unreliable in 2021
        {"cvegeo": "01002", "year": 2021, "election": "DIP_FED", "participacion": 0.55, "ns": 800, "lista_nominal": 1000},
        {"cvegeo": "01001", "year": 2024, "election": "DIP_FED", "participacion": 0.60, "ns": 10, "lista_nominal": 1000},
        {"cvegeo": "01002", "year": 2024, "election": "DIP_FED", "participacion": 0.62, "ns": 10, "lista_nominal": 1000},
    ])

    piv = participation_matrix(df, reliable_only=True)
    assert piv.loc["01001", 2021] == pytest.approx(0.55)
    assert np.isnan(piv.loc["01002", 2021])  # Filtered out because unreliable
    assert piv.loc["01002", 2024] == pytest.approx(0.62)  # Kept because reliable in 2024


def test_deviation_matrix_and_unweighted_means():
    """Verify relative deviations: dev_{i, T} = 100 * Y_{i, T} - unweighted_mean_T."""
    Y = pd.DataFrame(
        {
            2021: [0.40, 0.60, 0.50],
            2024: [0.55, 0.65, np.nan],
        },
        index=["01001", "01002", "01003"],
    )

    dev, means = deviation_matrix(Y)

    # 2021: unweighted mean = 50.0 pp
    # dev for 01001: 40 - 50 = -10.0 pp
    # dev for 01002: 60 - 50 = +10.0 pp
    # dev for 01003: 50 - 50 = 0.0 pp
    assert means[2021] == pytest.approx(50.0)
    assert dev.loc["01001", 2021] == pytest.approx(-10.0)
    assert dev.loc["01002", 2021] == pytest.approx(10.0)
    assert dev.loc["01003", 2021] == pytest.approx(0.0)
    assert dev[2021].mean() == pytest.approx(0.0)

    # 2024: unweighted mean = (55 + 65) / 2 = 60.0 pp
    # dev for 01001: 55 - 60 = -5.0 pp
    # dev for 01002: 65 - 60 = +5.0 pp
    # 01003: NaN
    assert means[2024] == pytest.approx(60.0)
    assert dev.loc["01001", 2024] == pytest.approx(-5.0)
    assert dev.loc["01002", 2024] == pytest.approx(5.0)
    assert np.isnan(dev.loc["01003", 2024])


def test_intermediate_offset():
    """Verify offset between unweighted municipal mean and LN-weighted national turnout."""
    # 2 municipalities: 01001 (large, turnout 40%), 01002 (small, turnout 60%)
    # unweighted mean = 50.0%
    # weighted mean: (40*9000 + 60*1000) / 10000 = (360000 + 60000) / 10000 = 42.0%
    # diff = 50.0 - 42.0 = +8.0 pp
    Y = pd.DataFrame(
        {
            2009: [0.40, 0.60],
            2015: [0.40, 0.60],
            2021: [0.40, 0.60],
        },
        index=["01001", "01002"],
    )
    L = pd.DataFrame(
        {
            2009: [9000, 1000],
            2015: [9000, 1000],
            2021: [9000, 1000],
        },
        index=["01001", "01002"],
    )

    offset = intermediate_offset(Y, L, intermediate_years=[2009, 2015, 2021])
    assert offset == pytest.approx(8.0)


def test_load_concurrencia_seed():
    """Verify loading concurrencia_gubernatura.csv seed table."""
    df = load_concurrencia()
    assert not df.empty
    assert "year" in df.columns
    assert "cve_ent" in df.columns
    # Check 2027 17 states
    gov_2027 = df[df["year"] == 2027]
    assert len(gov_2027) == 17
    assert "01" in gov_2027["cve_ent"].values


def test_is_gubernatorial():
    """Verify gubernatorial concurrence indicator by state and year."""
    # From seed §11.2:
    # 2024 has Chiapas (07), CDMX (09), Guanajuato (11), Jalisco (14), Morelos (17), Puebla (21), Tabasco (27), Veracruz (30), Yucatán (31)
    assert is_gubernatorial(2024, "07") == 1
    assert is_gubernatorial(2024, "09") == 1
    assert is_gubernatorial(2024, "01") == 0  # Aguascalientes had no gubernatorial election in 2024

    # 2027 has Aguascalientes (01)
    assert is_gubernatorial(2027, "01") == 1
    assert is_gubernatorial(2027, "09") == 0


def test_training_rows_with_gov_indicators():
    """Verify training rows include gov_T, gov_lag1, gov_lag2."""
    Y = pd.DataFrame(
        {
            2012: [0.55],
            2015: [0.48],
            2018: [0.62],
            2021: [0.51],
            2024: [0.65],
        },
        index=["07101"],  # Chiapas: had gov election in 2012, 2018, 2024; none in 2015, 2021
    )
    feats = pd.DataFrame(
        {
            "cvegeo": ["07101"],
            "cve_ent": ["07"],
            "pob_18ymas": [10000],
        }
    )

    train_df = training_rows(Y, feats, [2024])
    assert len(train_df) == 1
    row = train_df.iloc[0]
    # For T=2024: gov_T=1 (2024), gov_lag1=0 (2021), gov_lag2=1 (2018)
    assert row["gov_T"] == 1.0
    assert row["gov_lag1"] == 0.0
    assert row["gov_lag2"] == 1.0


def test_participation_matrix_and_lista_nominal():
    """Verify pivoting participation and nominal list tables."""
    data = [
        {"cvegeo": "01001", "year": 2018, "election": "DIP_FED", "participacion": 0.62, "lista_nominal": 10000},
        {"cvegeo": "01001", "year": 2021, "election": "DIP_FED", "participacion": 0.55, "lista_nominal": 10500},
        {"cvegeo": "01002", "year": 2018, "election": "DIP_FED", "participacion": 0.58, "lista_nominal": 5000},
        {"cvegeo": "01002", "year": 2021, "election": "DIP_FED", "participacion": 0.50, "lista_nominal": 5200},
        {"cvegeo": "01001", "year": 2024, "election": "PRES", "participacion": 0.65, "lista_nominal": 11000},
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

    y_values = []
    for yr in years:
        k = (yr - 2009) / 3.0
        pres = is_presidential(yr)
        y_pp = a + b * k + c * pres
        y_prop = y_pp / 100.0
        y_values.append(y_prop)

    series = pd.Series(y_values, index=years)
    trend_pp, volatility_pp = unit_trend(series, min_year=2009)

    assert trend_pp == pytest.approx(b, rel=1e-3)
    assert volatility_pp == pytest.approx(0.0, abs=1e-5)


def test_unit_trend_with_negative_deviations():
    """Verify unit_trend operates correctly when input is negative/positive deviation in pp."""
    years = [2009, 2012, 2015, 2018, 2021, 2024]
    b = -1.2  # slope in pp per cycle
    dev_values = [b * ((yr - 2009) / 3.0) for yr in years]

    series = pd.Series(dev_values, index=years)
    trend_pp, volatility_pp = unit_trend(series, min_year=2009)
    assert trend_pp == pytest.approx(b, rel=1e-3)
    assert volatility_pp == pytest.approx(0.0, abs=1e-5)


def test_unit_trend_insufficient_points():
    """Verify unit_trend returns (NaN, NaN) when fewer than 4 points exist."""
    short_series = pd.Series([0.5, 0.55, 0.52], index=[2015, 2018, 2021])
    trend_pp, volatility_pp = unit_trend(short_series)
    assert np.isnan(trend_pp)
    assert np.isnan(volatility_pp)


def test_load_inputs_missing(tmp_path):
    """Verify load_inputs returns empty DataFrames when files are missing."""
    part, feats = load_inputs(tmp_path)
    assert isinstance(part, pd.DataFrame)
    assert isinstance(feats, pd.DataFrame)
    assert part.empty
    assert feats.empty
    assert "cvegeo" in part.columns
    assert "nom_mun" in feats.columns
