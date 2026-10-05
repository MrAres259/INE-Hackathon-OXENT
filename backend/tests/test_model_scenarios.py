"""Unit tests for atalaya.model.scenarios."""
import numpy as np
import pandas as pd
import pytest

from atalaya.model.scenarios import SCENARIOS, default_params, simulate


@pytest.fixture
def sample_units():
    # 4 municipalities across 2 states
    # mun 01001 (state 01): category rojo, pct_18_24=0.25, lista_nominal=1000, pred_part=0.40, pred_low=0.55, pred_high=0.65
    # mun 01002 (state 01): category naranja, pct_18_24=0.20, lista_nominal=2000, pred_part=0.50, pred_low=0.45, pred_high=0.55
    # mun 02001 (state 02): category amarillo, pct_18_24=0.15, lista_nominal=1000, pred_part=0.60, pred_low=0.35, pred_high=0.45
    # mun 02002 (state 02): category verde, pct_18_24=0.10, lista_nominal=1000, pred_part=0.70, pred_low=0.25, pred_high=0.35
    mun_data = pd.DataFrame({
        "id": ["01001", "01002", "02001", "02002"],
        "name": ["Mun 1", "Mun 2", "Mun 3", "Mun 4"],
        "level": ["mun"] * 4,
        "cve_ent": ["01", "01", "02", "02"],
        "lista_nominal": [1000, 2000, 1000, 1000],
        "last_year": [2024] * 4,
        "last_participation": [0.42, 0.49, 0.58, 0.71],
        "pred_participation": [0.40, 0.50, 0.60, 0.70],
        "pred_abstention": [0.60, 0.50, 0.40, 0.30],
        "pred_low": [0.55, 0.45, 0.35, 0.25],
        "pred_high": [0.65, 0.55, 0.45, 0.35],
        "trend_pp": [-2.0, -1.0, 0.5, 1.0],
        "volatility_pp": [3.0, 2.0, 1.5, 1.0],
        "risk_score": [85.0, 60.0, 45.0, 20.0],
        "category": ["rojo", "naranja", "amarillo", "verde"],
        "pct_18_24": [0.25, 0.20, 0.15, 0.10],
        "pct_rural": [0.50, 0.10, 0.05, 0.0],
        "pct_hli": [0.40, 0.05, 0.0, 0.0],
    })

    # 2 state rows
    state_data = pd.DataFrame({
        "id": ["01", "02"],
        "name": ["Estado 01", "Estado 02"],
        "level": ["state"] * 2,
        "cve_ent": ["01", "02"],
        "lista_nominal": [3000, 2000],
        "last_year": [2024, 2024],
        "last_participation": [0.467, 0.645],
        "pred_participation": [0.4667, 0.6500],
        "pred_abstention": [0.5333, 0.3500],
        "pred_low": [0.4833, 0.3000],
        "pred_high": [0.5833, 0.4000],
        "trend_pp": [-1.33, 0.75],
        "volatility_pp": [2.33, 1.25],
        "risk_score": [70.0, 30.0],
        "category": ["naranja", "verde"],
    })

    return pd.concat([mun_data, state_data], ignore_index=True)


def test_scenarios_contract_structure():
    assert len(SCENARIOS) == 3
    ids = [s["id"] for s in SCENARIOS]
    assert ids == ["base", "intervencion", "pesimista"]

    for sc in SCENARIOS:
        assert "label" in sc
        assert "description" in sc
        assert "params" in sc
        for p in sc["params"]:
            assert "key" in p
            assert "label" in p
            assert "type" in p
            assert "default" in p

    base_def = default_params("base")
    assert base_def == {}

    interv_def = default_params("intervencion")
    assert interv_def["lever"] == "promocion_jovenes"
    assert interv_def["targeting"] == "rojo_naranja"
    assert interv_def["effect_pp"] == 3.0
    assert interv_def["coverage"] == 100


def test_simulate_base_scenario(sample_units):
    items, summary = simulate(sample_units, "base", level="mun")
    assert len(items) == 4
    # All base items should match pred_participation
    assert (items["pred_participation"] == [0.40, 0.50, 0.60, 0.70]).all()
    assert items["delta_vs_base_pp"].isna().all()
    assert summary["votos_adicionales"] == 0
    assert summary["mean_delta_pp"] == 0.0
    assert summary["n_units"] == 4
    assert set(summary["by_category"].keys()) == {"verde", "amarillo", "naranja", "rojo", "sin_dato"}


def test_simulate_intervencion_focalizada(sample_units):
    # Intervencion targeting rojo_naranja: mun1 (rojo) and mun2 (naranja) change; mun3 and mun4 do NOT change.
    items, summary = simulate(sample_units, "intervencion", {"targeting": "rojo_naranja", "effect_pp": 3.0}, level="mun")
    
    # mun 1 and 2 should have improved participation (higher pred_participation, negative delta_vs_base_pp)
    assert items.loc[0, "pred_participation"] > 0.40
    assert items.loc[1, "pred_participation"] > 0.50
    assert items.loc[0, "delta_vs_base_pp"] < 0
    assert items.loc[1, "delta_vs_base_pp"] < 0

    # mun 3 (amarillo) and mun 4 (verde) should be untouched
    assert items.loc[2, "pred_participation"] == 0.60
    assert items.loc[3, "pred_participation"] == 0.70
    assert items.loc[2, "delta_vs_base_pp"] == 0.0
    assert items.loc[3, "delta_vs_base_pp"] == 0.0

    # Votos adicionales must be positive
    assert summary["votos_adicionales"] > 0


def test_simulate_intervencion_lever_weights(sample_units):
    # mun 1 has pct_18_24=0.25 (higher), mun 2 has pct_18_24=0.20
    # Both in target. mun 1 should have larger delta_part than mun 2 relative to effect
    items, _ = simulate(sample_units, "intervencion", {"lever": "promocion_jovenes", "targeting": "rojo_naranja", "effect_pp": 4.0}, level="mun")
    delta_1 = items.loc[0, "pred_participation"] - 0.40
    delta_2 = items.loc[1, "pred_participation"] - 0.50
    assert delta_1 > delta_2


def test_simulate_coverage_zero(sample_units):
    items, summary = simulate(sample_units, "intervencion", {"coverage": 0}, level="mun")
    assert np.allclose(items["pred_participation"], [0.40, 0.50, 0.60, 0.70])
    assert summary["votos_adicionales"] == 0


def test_simulate_pesimista(sample_units):
    items, summary = simulate(sample_units, "pesimista", {"shock_pp": 2.0, "trend_amplifier": 50}, level="mun")
    # All participation should drop
    assert (items["pred_participation"] < [0.40, 0.50, 0.60, 0.70]).all()
    # mun 1 has trend_pp = -2.0 (negative trend amplified), so drops by 2 pp + 0.5*2 pp = 3 pp => 0.37
    assert np.isclose(items.loc[0, "pred_participation"], 0.37)
    # delta_vs_base_pp should be positive (more abstention)
    assert (items["delta_vs_base_pp"] > 0).all()
    assert summary["votos_adicionales"] < 0


def test_simulate_state_level(sample_units):
    items, summary = simulate(sample_units, "base", level="state")
    assert len(items) == 2
    # State 01 has muns with 1000 ln (part 0.4) and 2000 ln (part 0.5)
    # Weighted avg = (1000*0.4 + 2000*0.5) / 3000 = 1400 / 3000 = 0.4667
    assert np.isclose(items.loc[0, "pred_participation"], 0.4667, atol=1e-3)
    assert items.loc[0, "level"] == "state"


def test_simulate_hand_calculated_votos_adicionales(sample_units):
    # Campaña general (w=1 everywhere), effect_pp=2, coverage=50 => delta = 2% * 0.5 = 1 pp (+0.01)
    # targeting="todos"
    items, summary = simulate(sample_units, "intervencion", {
        "lever": "campana_general",
        "targeting": "todos",
        "effect_pp": 2.0,
        "coverage": 50.0,
    }, level="mun")
    # Total nominal = 1000 + 2000 + 1000 + 1000 = 5000
    # Additional votes = 0.01 * 5000 = 50
    assert summary["votos_adicionales"] == 50


def test_simulate_invalid_params(sample_units):
    with pytest.raises(ValueError, match="Escenario desconocido"):
        simulate(sample_units, "invalid_scenario")

    with pytest.raises(ValueError, match="Palanca inválida"):
        simulate(sample_units, "intervencion", {"lever": "non_existent"})

    with pytest.raises(ValueError, match="Focalización inválida"):
        simulate(sample_units, "intervencion", {"targeting": "invalid_target"})

    with pytest.raises(ValueError, match="El efecto debe estar entre"):
        simulate(sample_units, "intervencion", {"effect_pp": 15.0})

    with pytest.raises(ValueError, match="La cobertura debe estar entre"):
        simulate(sample_units, "intervencion", {"coverage": 150.0})

    with pytest.raises(ValueError, match="La caída general debe estar entre"):
        simulate(sample_units, "pesimista", {"shock_pp": 10.0})
