"""Tests for multi-campaign simulation, diminishing returns, and API contracts."""
from __future__ import annotations

import json
from pathlib import Path
import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from atalaya.api.deps import cached_simulate, reload_all
from atalaya.api.main import app
from atalaya.model.scenarios import (
    SCENARIOS,
    default_params,
    simulate,
    _campaigns_from_params,
)
from atalaya.store import PandasStore


@pytest.fixture(autouse=True)
def mock_reload_env(monkeypatch):
    """Prevent reload_all from loading the real backend/.env during API tests."""
    monkeypatch.setattr("atalaya.api.deps.reload_env", lambda: None)


@pytest.fixture
def multi_state_units():
    """Synthetic dataset with 6 municipalities across 3 states: 01, 07 (Chiapas), 02."""
    mun_data = pd.DataFrame({
        "id": ["01001", "01002", "07001", "07002", "02001", "02002"],
        "name": ["Ags 1", "Ags 2", "Chis 1", "Chis 2", "BC 1", "BC 2"],
        "level": ["mun"] * 6,
        "cve_ent": ["01", "01", "07", "07", "02", "02"],
        "lista_nominal": [10000, 20000, 15000, 25000, 12000, 18000],
        "last_year": [2024] * 6,
        "last_participation": [0.45, 0.50, 0.40, 0.42, 0.60, 0.70],
        "pred_participation": [0.45, 0.50, 0.40, 0.42, 0.60, 0.70],
        "pred_abstention": [0.55, 0.50, 0.60, 0.58, 0.40, 0.30],
        "pred_low": [0.50, 0.45, 0.55, 0.53, 0.35, 0.25],
        "pred_high": [0.60, 0.55, 0.65, 0.63, 0.45, 0.35],
        "trend_pp": [-1.5, -1.0, -2.0, -1.8, 0.5, 1.0],
        "volatility_pp": [2.5, 2.0, 3.0, 2.8, 1.5, 1.0],
        "risk_score": [80.0, 65.0, 88.0, 82.0, 45.0, 25.0],
        "category": ["rojo", "naranja", "rojo", "rojo", "amarillo", "verde"],
        "pct_18_24": [0.22, 0.18, 0.25, 0.24, 0.15, 0.12],
        "pct_rural": [0.10, 0.20, 0.65, 0.70, 0.05, 0.02],
        "pct_hli": [0.02, 0.01, 0.45, 0.50, 0.01, 0.00],
    })

    state_data = pd.DataFrame({
        "id": ["01", "07", "02"],
        "name": ["Aguascalientes", "Chiapas", "Baja California"],
        "level": ["state"] * 3,
        "cve_ent": ["01", "07", "02"],
        "lista_nominal": [30000, 40000, 30000],
        "last_year": [2024, 2024, 2024],
        "last_participation": [0.4833, 0.4125, 0.6600],
        "pred_participation": [0.4833, 0.4125, 0.6600],
        "pred_abstention": [0.5167, 0.5875, 0.3400],
        "pred_low": [0.4667, 0.5375, 0.2900],
        "pred_high": [0.5667, 0.6375, 0.3900],
        "trend_pp": [-1.17, -1.88, 0.80],
        "volatility_pp": [2.17, 2.88, 1.20],
        "risk_score": [70.0, 84.0, 33.0],
        "category": ["naranja", "rojo", "verde"],
    })

    return pd.concat([mun_data, state_data], ignore_index=True)


def test_regression_single_campaign_identity(multi_state_units):
    """Verifies that 1 campaign produces identical results with and without campaigns."""
    # 1. Defaults
    items_legacy, summary_legacy = simulate(multi_state_units, "intervencion")
    items_explicit, summary_explicit = simulate(
        multi_state_units,
        "intervencion",
        {"campaigns": [{
            "lever": "promocion_jovenes",
            "targeting": "rojo_naranja",
            "effect_pp": 3.0,
            "coverage": 100,
            "ents": [],
        }]},
    )

    # Identical predictions and metrics
    np.testing.assert_allclose(
        items_legacy["pred_participation"].values,
        items_explicit["pred_participation"].values,
        atol=1e-9,
    )
    np.testing.assert_allclose(
        items_legacy["pred_abstention"].values,
        items_explicit["pred_abstention"].values,
        atol=1e-9,
    )
    assert items_legacy["category"].tolist() == items_explicit["category"].tolist()
    assert summary_legacy["votos_adicionales"] == summary_explicit["votos_adicionales"]
    assert np.isclose(summary_legacy["mean_delta_pp"], summary_explicit["mean_delta_pp"], atol=1e-6)

    # Single campaign summary equality
    assert summary_explicit["votos_suma_individual"] == summary_explicit["votos_adicionales"]
    assert summary_explicit["votos_traslape"] == 0
    assert len(summary_explicit["campaigns"]) == 1
    assert summary_explicit["campaigns"][0]["votos_solo"] == summary_explicit["votos_adicionales"]

    # 2. Parameter combination: casillas_rurales, effect 4.5, coverage 75
    params_leg = {"lever": "casillas_rurales", "targeting": "todos", "effect_pp": 4.5, "coverage": 75}
    params_camp = {"campaigns": [{
        "lever": "casillas_rurales",
        "targeting": "todos",
        "effect_pp": 4.5,
        "coverage": 75,
        "ents": [],
    }]}
    it_leg2, sm_leg2 = simulate(multi_state_units, "intervencion", params_leg)
    it_cmp2, sm_cmp2 = simulate(multi_state_units, "intervencion", params_camp)
    np.testing.assert_allclose(it_leg2["pred_participation"].values, it_cmp2["pred_participation"].values, atol=1e-9)
    assert sm_leg2["votos_adicionales"] == sm_cmp2["votos_adicionales"]


def test_diminishing_returns_combination_formula(multi_state_units):
    """Verifies a' = a·(1 - r1)(1 - r2) diminishing returns and non-negative overlap."""
    campaigns = [
        {"lever": "promocion_jovenes", "targeting": "rojo_naranja", "effect_pp": 3.0, "coverage": 100, "ents": []},
        {"lever": "casillas_rurales", "targeting": "rojo_naranja", "effect_pp": 4.0, "coverage": 100, "ents": []},
    ]

    items_comb, summary_comb = simulate(multi_state_units, "intervencion", {"campaigns": campaigns})
    it_c1, sm_c1 = simulate(multi_state_units, "intervencion", {"campaigns": [campaigns[0]]})
    it_c2, sm_c2 = simulate(multi_state_units, "intervencion", {"campaigns": [campaigns[1]]})

    muns = multi_state_units[multi_state_units["level"] == "mun"].copy()
    base_abs = 1.0 - muns["pred_participation"].values

    # Check that in target units, comb abstention equals a * (1 - r1) * (1 - r2)
    p75_jov = np.percentile(muns["pct_18_24"].dropna(), 75)
    w1 = np.clip(muns["pct_18_24"].values / p75_jov, 0.0, 1.5)
    delta1 = 0.03 * 1.0 * w1

    p75_rur = np.percentile(muns["pct_rural"].dropna(), 75)
    w2 = np.clip(muns["pct_rural"].values / p75_rur, 0.0, 1.5)
    delta2 = 0.04 * 1.0 * w2

    in_target = muns["category"].isin(["rojo", "naranja"]).values
    r1 = np.where(in_target, np.minimum(delta1 / base_abs, 1.0), 0.0)
    r2 = np.where(in_target, np.minimum(delta2 / base_abs, 1.0), 0.0)

    expected_abs = base_abs * (1.0 - r1) * (1.0 - r2)
    expected_part = np.minimum(1.0 - expected_abs, 0.98)

    np.testing.assert_allclose(items_comb["pred_participation"].values, expected_part.round(4), atol=1e-4)

    # Votos adicionales with combination <= sum of solo votes
    votos_c1 = sm_c1["votos_adicionales"]
    votos_c2 = sm_c2["votos_adicionales"]
    votos_comb = summary_comb["votos_adicionales"]

    assert votos_comb <= (votos_c1 + votos_c2)
    assert summary_comb["votos_suma_individual"] == (votos_c1 + votos_c2)
    assert summary_comb["votos_traslape"] >= 0
    assert summary_comb["votos_traslape"] == (votos_c1 + votos_c2) - votos_comb


def test_territorial_targeting_ents(multi_state_units):
    """Verifies that ents=['07'] only affects Chiapas, while ents=[] affects all states."""
    # Chiapas only
    params_chis = {
        "campaigns": [
            {
                "lever": "materiales_lengua_indigena",
                "targeting": "todos",
                "effect_pp": 5.0,
                "coverage": 100,
                "ents": ["07"],
            }
        ]
    }
    items_chis, summary_chis = simulate(multi_state_units, "intervencion", params_chis)

    # Municipalities in Chiapas (07001, 07002) should have delta_vs_base_pp < 0
    chis_items = items_chis[items_chis["ent"] == "07"]
    assert (chis_items["delta_vs_base_pp"] < 0).all()

    # Municipalities in other states (01, 02) must be completely untouched
    other_items = items_chis[items_chis["ent"].isin(["01", "02"])]
    assert (other_items["delta_vs_base_pp"] == 0.0).all()

    # Country-wide
    params_all = {
        "campaigns": [
            {
                "lever": "materiales_lengua_indigena",
                "targeting": "todos",
                "effect_pp": 5.0,
                "coverage": 100,
                "ents": [],
            }
        ]
    }
    items_all, summary_all = simulate(multi_state_units, "intervencion", params_all)
    # Target units in other states with pct_hli > 0 should also have improvements
    assert summary_all["votos_adicionales"] > summary_chis["votos_adicionales"]


def test_validation_errors_naming_campaign(multi_state_units):
    """Verifies that validation errors format messages in Spanish with 'Campaña N'."""
    # 1. Repeated lever in campaign 2
    with pytest.raises(ValueError, match="Campaña 2: Palanca repetida"):
        simulate(
            multi_state_units,
            "intervencion",
            {"campaigns": [
                {"lever": "promocion_jovenes", "targeting": "todos", "effect_pp": 2.0, "coverage": 50},
                {"lever": "promocion_jovenes", "targeting": "rojo", "effect_pp": 1.0, "coverage": 50},
            ]},
        )

    # 2. More than 4 campaigns
    with pytest.raises(ValueError, match="Campaña 5: Se permite un máximo de 4 campañas"):
        simulate(
            multi_state_units,
            "intervencion",
            {"campaigns": [
                {"lever": "promocion_jovenes", "targeting": "todos", "effect_pp": 2.0, "coverage": 50},
                {"lever": "casillas_rurales", "targeting": "todos", "effect_pp": 2.0, "coverage": 50},
                {"lever": "materiales_lengua_indigena", "targeting": "todos", "effect_pp": 2.0, "coverage": 50},
                {"lever": "campana_general", "targeting": "todos", "effect_pp": 2.0, "coverage": 50},
                {"lever": "promocion_jovenes", "targeting": "todos", "effect_pp": 2.0, "coverage": 50},
            ]},
        )

    # 3. Invalid entity code not in data in campaign 1
    with pytest.raises(ValueError, match="Campaña 1: Clave de entidad '99' no existe"):
        simulate(
            multi_state_units,
            "intervencion",
            {"campaigns": [
                {"lever": "promocion_jovenes", "targeting": "todos", "effect_pp": 2.0, "coverage": 50, "ents": ["99"]},
            ]},
        )

    # 4. Invalid entity format (single digit or invalid length)
    with pytest.raises(ValueError, match="Campaña 1: Clave de entidad inválida: '7'"):
        simulate(
            multi_state_units,
            "intervencion",
            {"campaigns": [
                {"lever": "promocion_jovenes", "targeting": "todos", "effect_pp": 2.0, "coverage": 50, "ents": ["7"]},
            ]},
        )

    # 5. Out of bounds effect_pp in campaign 2
    with pytest.raises(ValueError, match="Campaña 2: El efecto debe estar entre 0 y 10 pp"):
        simulate(
            multi_state_units,
            "intervencion",
            {"campaigns": [
                {"lever": "promocion_jovenes", "targeting": "todos", "effect_pp": 2.0, "coverage": 50},
                {"lever": "casillas_rurales", "targeting": "todos", "effect_pp": 15.0, "coverage": 50},
            ]},
        )

    # 6. Out of bounds coverage in campaign 1
    with pytest.raises(ValueError, match="Campaña 1: La cobertura debe estar entre 0% y 100%"):
        simulate(
            multi_state_units,
            "intervencion",
            {"campaigns": [
                {"lever": "promocion_jovenes", "targeting": "todos", "effect_pp": 2.0, "coverage": 150},
            ]},
        )


def test_participation_cap_and_monotonicity(multi_state_units):
    """Verifies participation never exceeds 0.98 and campaigns never increase abstention."""
    # 4 strong campaigns targeting todos
    campaigns = [
        {"lever": "promocion_jovenes", "targeting": "todos", "effect_pp": 10.0, "coverage": 100, "ents": []},
        {"lever": "casillas_rurales", "targeting": "todos", "effect_pp": 10.0, "coverage": 100, "ents": []},
        {"lever": "materiales_lengua_indigena", "targeting": "todos", "effect_pp": 10.0, "coverage": 100, "ents": []},
        {"lever": "campana_general", "targeting": "todos", "effect_pp": 10.0, "coverage": 100, "ents": []},
    ]

    items, _ = simulate(multi_state_units, "intervencion", {"campaigns": campaigns})
    base_part = multi_state_units[multi_state_units["level"] == "mun"]["pred_participation"].values

    # Never exceeds 0.98
    assert (items["pred_participation"].values <= 0.98).all()
    # Monotonic improvement: participation >= base
    assert (items["pred_participation"].values >= base_part).all()
    # Abstention <= base abstention
    base_abs = 1.0 - base_part
    assert (items["pred_abstention"].values <= (base_abs + 1e-9)).all()


@pytest.fixture
def api_client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Sets up an API TestClient with multi-state store."""
    build_dir = tmp_path / "build"
    seed_dir = tmp_path / "seed"
    build_dir.mkdir(parents=True, exist_ok=True)
    seed_dir.mkdir(parents=True, exist_ok=True)

    # States seed
    states_csv = "cve_ent,name,nom_ent\n01,Aguascalientes,Aguascalientes\n07,Chiapas,Chiapas\n"
    (seed_dir / "states.csv").write_text(states_csv, encoding="utf-8")

    units_data = [
        {"id": "01001", "level": "mun", "cve_ent": "01", "name": "Ags Mun", "lista_nominal": 50000, "pred_participation": 0.50, "pred_abstention": 0.50, "category": "rojo", "risk_score": 80.0, "pct_18_24": 0.20, "pct_rural": 0.10, "pct_hli": 0.05},
        {"id": "07001", "level": "mun", "cve_ent": "07", "name": "Tuxtla", "lista_nominal": 60000, "pred_participation": 0.45, "pred_abstention": 0.55, "category": "rojo", "risk_score": 85.0, "pct_18_24": 0.22, "pct_rural": 0.50, "pct_hli": 0.30},
        {"id": "01", "level": "state", "cve_ent": "01", "name": "Aguascalientes", "lista_nominal": 50000, "pred_participation": 0.50, "pred_abstention": 0.50, "category": "rojo", "risk_score": 80.0},
        {"id": "07", "level": "state", "cve_ent": "07", "name": "Chiapas", "lista_nominal": 60000, "pred_participation": 0.45, "pred_abstention": 0.55, "category": "rojo", "risk_score": 85.0},
    ]
    pd.DataFrame(units_data).to_parquet(build_dir / "units.parquet", index=False)

    test_store = PandasStore(build_dir=build_dir, seed_dir=seed_dir)
    monkeypatch.setattr("atalaya.api.routes.get_store", lambda: test_store)
    monkeypatch.setattr("atalaya.api.deps.get_store", lambda: test_store)
    monkeypatch.setattr("atalaya.api.routes.SEED_DIR", seed_dir)
    monkeypatch.setattr("atalaya.config.BUILD_DIR", build_dir)
    monkeypatch.setattr("atalaya.config.SEED_DIR", seed_dir)

    reload_all()
    with TestClient(app) as tc:
        yield tc


def test_api_meta_publishes_campaign_rules(api_client: TestClient):
    """GET /api/meta returns intervencion scenario with campaigns specification and campaign_rules."""
    resp = api_client.get("/api/meta")
    assert resp.status_code == 200
    meta = resp.json()

    interv = next((s for s in meta["scenarios"] if s["id"] == "intervencion"), None)
    assert interv is not None
    assert "campaign_rules" in interv
    assert interv["campaign_rules"]["combination"] == "rendimientos_decrecientes"
    assert interv["campaign_rules"]["max_participation"] == 0.98

    # Verify campaigns parameter is present in params
    campaigns_param = next((p for p in interv["params"] if p["key"] == "campaigns"), None)
    assert campaigns_param is not None
    assert campaigns_param["type"] == "campaigns"
    assert campaigns_param["max"] == 4
    assert len(campaigns_param["default"]) == 1
    assert campaigns_param["default"][0]["lever"] == "promocion_jovenes"


def test_api_simulate_with_campaigns(api_client: TestClient):
    """POST /api/scenario/simulate accepts multiple campaigns and returns required summary breakdown."""
    body = {
        "scenario": "intervencion",
        "params": {
            "campaigns": [
                {"lever": "promocion_jovenes", "targeting": "rojo", "effect_pp": 3.0, "coverage": 100, "ents": ["07"]},
                {"lever": "casillas_rurales", "targeting": "rojo", "effect_pp": 2.0, "coverage": 80, "ents": []},
            ]
        },
        "level": "mun",
    }
    resp = api_client.post("/api/scenario/simulate", json=body)
    assert resp.status_code == 200
    data = resp.json()

    assert "summary" in data
    summary = data["summary"]
    assert "campaigns" in summary
    assert len(summary["campaigns"]) == 2
    assert "votos_suma_individual" in summary
    assert "votos_traslape" in summary
    assert summary["votos_traslape"] >= 0

    c0 = summary["campaigns"][0]
    assert c0["lever"] == "promocion_jovenes"
    assert "label" in c0
    assert c0["ents"] == ["07"]
    assert "votos_solo" in c0
    assert "mean_delta_pp_solo" in c0


def test_api_simulate_validation_error_422(api_client: TestClient):
    """POST /api/scenario/simulate returns 422 with Spanish message naming campaign."""
    bad_body = {
        "scenario": "intervencion",
        "params": {
            "campaigns": [
                {"lever": "promocion_jovenes", "targeting": "rojo", "effect_pp": 3.0, "coverage": 100},
                {"lever": "promocion_jovenes", "targeting": "todos", "effect_pp": 2.0, "coverage": 50},
            ]
        },
    }
    resp = api_client.post("/api/scenario/simulate", json=bad_body)
    assert resp.status_code == 422
    err_msg = resp.json()["detail"]
    assert "Campaña 2" in err_msg
    assert "Palanca repetida" in err_msg
