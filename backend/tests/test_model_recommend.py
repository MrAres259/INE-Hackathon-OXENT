"""Unit tests for atalaya.model.recommend."""
import numpy as np
import pandas as pd
import pytest

from atalaya.model.recommend import RecoReference, build_reference, recommend


@pytest.fixture
def sample_reference():
    # Synthetic distribution of 100 municipalities
    np.random.seed(42)
    n = 100
    df = pd.DataFrame({
        "level": ["mun"] * n,
        "pct_18_24": np.linspace(0.05, 0.30, n),
        "pct_rural": np.linspace(0.0, 0.80, n),
        "pct_hli": np.linspace(0.0, 0.60, n),
        "pct_analfabeta": np.linspace(0.01, 0.20, n),
        "graproes": np.linspace(4.0, 12.0, n),
        "pct_internet": np.linspace(0.10, 0.90, n),
        "trend_pp": np.linspace(-4.0, 4.0, n),
        "volatility_pp": np.linspace(0.5, 6.0, n),
        "pct_65ymas": np.linspace(0.04, 0.25, n),
        "coverage_ln": np.linspace(0.50, 1.10, n),
    })
    return build_reference(df, level="mun")


def test_each_rule_triggers(sample_reference):
    # R01: pct_18_24 >= p75
    unit = {"name": "Mun R01", "category": "verde", "pct_18_24": 0.28}
    recos = recommend(unit, [], sample_reference)
    assert any(r["id"] == "R01" for r in recos)

    # R02: pct_rural >= p75
    unit = {"name": "Mun R02", "category": "verde", "pct_rural": 0.75}
    recos = recommend(unit, [], sample_reference)
    assert any(r["id"] == "R02" for r in recos)

    # R03: pct_hli >= 0.30
    unit = {"name": "Mun R03", "category": "verde", "pct_hli": 0.35}
    recos = recommend(unit, [], sample_reference)
    assert any(r["id"] == "R03" for r in recos)

    # R04: pct_analfabeta >= p75
    unit = {"name": "Mun R04", "category": "verde", "pct_analfabeta": 0.18, "graproes": 9.0}
    recos = recommend(unit, [], sample_reference)
    assert any(r["id"] == "R04" for r in recos)

    # R05: pct_internet <= p25
    unit = {"name": "Mun R05", "category": "verde", "pct_internet": 0.15}
    recos = recommend(unit, [], sample_reference)
    assert any(r["id"] == "R05" for r in recos)

    # R06: trend_pp <= -2
    unit = {"name": "Mun R06", "category": "verde", "trend_pp": -2.5}
    recos = recommend(unit, [], sample_reference)
    assert any(r["id"] == "R06" for r in recos)

    # R07: volatility_pp >= p75
    unit = {"name": "Mun R07", "category": "verde", "volatility_pp": 5.5}
    recos = recommend(unit, [], sample_reference)
    assert any(r["id"] == "R07" for r in recos)

    # R08: pct_65ymas >= p75
    unit = {"name": "Mun R08", "category": "verde", "pct_65ymas": 0.24}
    recos = recommend(unit, [], sample_reference)
    assert any(r["id"] == "R08" for r in recos)

    # R09: coverage_ln <= p25
    unit = {"name": "Mun R09", "category": "verde", "coverage_ln": 0.55}
    recos = recommend(unit, [], sample_reference)
    assert any(r["id"] == "R09" for r in recos)

    # R10: gm_2020 in Alto;Muy alto
    unit = {"name": "Mun R10", "category": "verde", "gm_2020": "Muy alto"}
    recos = recommend(unit, [], sample_reference)
    assert any(r["id"] == "R10" for r in recos)


def test_driver_trigger(sample_reference):
    # Unit doesn't meet numeric threshold for R01, but driver:pct_18_24 triggers it
    unit = {"name": "Mun Driver", "category": "verde", "pct_18_24": 0.10}
    drivers = [{"key": "pct_18_24", "direction": "sube_abstencion"}]
    recos = recommend(unit, drivers, sample_reference)
    assert any(r["id"] == "R01" for r in recos)


def test_text_formatting(sample_reference):
    unit = {
        "name": "San Pedro",
        "category": "amarillo",
        "pct_18_24": 0.285,
        "graproes": 8.42,
        "pct_analfabeta": 0.123,
    }
    recos = recommend(unit, [], sample_reference)
    r01 = next(r for r in recos if r["id"] == "R01")
    assert "San Pedro: 28.5 % de su población adulta" in r01["rationale"]
    assert "percentil" in r01["rationale"]


def test_max_four_recommendations(sample_reference):
    # A unit that triggers many rules
    unit = {
        "name": "Mun Multi",
        "category": "rojo",
        "pct_18_24": 0.30,
        "pct_rural": 0.80,
        "pct_hli": 0.50,
        "pct_analfabeta": 0.20,
        "graproes": 4.0,
        "pct_internet": 0.10,
        "trend_pp": -3.0,
        "volatility_pp": 5.5,
    }
    recos = recommend(unit, [], sample_reference)
    assert len(recos) <= 4
    for r in recos:
        assert r["source"] == "rules"
        assert r["priority"] in ["alta", "media", "baja"]


def test_priority_and_driver_ordering(sample_reference):
    # Rojo upgrades priorities to alta
    unit = {
        "name": "Mun Rojo",
        "category": "rojo",
        "pct_18_24": 0.30,
        "pct_rural": 0.80,
    }
    recos = recommend(unit, [], sample_reference)
    assert all(r["priority"] == "alta" for r in recos)

    # Driver #1 ranking
    # Make unit verde so base priorities apply:
    # R03 has base_priority alta
    # R01 has base_priority media
    # R02 has base_priority media
    unit_v = {
        "name": "Mun Verde",
        "category": "verde",
        "pct_18_24": 0.30,   # R01 (media)
        "pct_rural": 0.80,   # R02 (media)
        "pct_hli": 0.35,     # R03 (alta)
    }
    # If pct_rural is driver #1, R02 should come before R01 among media priority
    drivers = [{"key": "pct_rural", "direction": "sube_abstencion"}]
    recos_v = recommend(unit_v, drivers, sample_reference)
    ids = [r["id"] for r in recos_v]
    assert ids[0] == "R03"  # alta first
    assert ids.index("R02") < ids.index("R01")  # R02 has driver #1, comes before R01


def test_fallback_for_rojo_without_triggers(sample_reference):
    # Unit in rojo with neutral values that trigger nothing
    unit = {
        "name": "Mun Clean Red",
        "category": "rojo",
        "pct_18_24": 0.15,
        "pct_rural": 0.10,
        "pct_hli": 0.01,
        "pct_analfabeta": 0.02,
        "graproes": 10.0,
        "pct_internet": 0.80,
        "trend_pp": 0.0,
        "volatility_pp": 1.0,
        "pct_65ymas": 0.05,
        "coverage_ln": 0.90,
        "gm_2020": "Muy bajo",
    }
    recos = recommend(unit, [], sample_reference)
    assert len(recos) == 1
    assert recos[0]["id"] == "R06"
    assert recos[0]["title"] == "Diagnóstico de riesgo de abstención"
    assert recos[0]["priority"] == "alta"

    # Unit in naranja -> fallback with priority media
    unit_orange = dict(unit, category="naranja")
    recos_org = recommend(unit_orange, [], sample_reference)
    assert len(recos_org) == 1
    assert recos_org[0]["priority"] == "media"

    # Unit in verde -> no fallback
    unit_green = dict(unit, category="verde")
    assert recommend(unit_green, [], sample_reference) == []
