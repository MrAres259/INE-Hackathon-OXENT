"""Unit and integration tests for ATALAYA FastAPI endpoints."""

from __future__ import annotations

import json
from pathlib import Path
import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from atalaya.api.deps import reload_all
from atalaya.api.main import app
from atalaya.store import PandasStore


@pytest.fixture
def api_test_env(tmp_path: Path, monkeypatch):
    build_dir = tmp_path / "build"
    seed_dir = tmp_path / "seed"
    build_dir.mkdir(parents=True, exist_ok=True)
    seed_dir.mkdir(parents=True, exist_ok=True)

    # 1. States seed
    states_csv = (
        "cve_ent,name,iso,aliases\n"
        "07,Chiapas,MX-CHP,CHIS\n"
        "09,Ciudad de México,MX-CMX,CDMX|DISTRITO FEDERAL|DF|CIUDAD DE MEXICO\n"
    )
    (seed_dir / "states.csv").write_text(states_csv, encoding="utf-8")

    # 2. Variables seed
    vars_csv = (
        'key,label_es,description,source,unit,level\n'
        'pct_18_24,Jóvenes de 18 a 24 años,"Proporción de 18 a 24",INEGI,proporción,mun|state\n'
        'graproes,Escolaridad promedio,"Grado promedio de escolaridad",INEGI,años,mun|state\n'
        'pob_tot,Población total,"Población total",INEGI,personas,mun|state\n'
        'coverage_ln,Cobertura de lista nominal,"Lista entre pob 18+",ATALAYA,proporción,mun|state\n'
    )
    (seed_dir / "variables.csv").write_text(vars_csv, encoding="utf-8")

    # 3. Units parquet (mun and state)
    units_data = {
        "id": ["07101", "07102", "09001", "07", "09"],
        "level": ["mun", "mun", "mun", "state", "state"],
        "cve_ent": ["07", "07", "09", "07", "09"],
        "cve_mun": ["101", "102", "001", "", ""],
        "cvegeo": ["07101", "07102", "09001", "07", "09"],
        "name": [
            "Tuxtla Gutiérrez",
            "San Cristóbal de las Casas",
            "Cuauhtémoc",
            "Chiapas",
            "Ciudad de México",
        ],
        "pob_tot": [500000, 200000, 500000, 700000, 500000],
        "pob_18ymas": [350000, 150000, 400000, 500000, 400000],
        "pct_18_24": [0.20, 0.25, 0.14, 0.215, 0.14],
        "graproes": [10.0, 8.0, 13.0, 9.4, 13.0],
        "lista_nominal": [280000, 120000, 320000, 400000, 320000],
        "coverage_ln": [0.80, 0.80, 0.80, 0.80, 0.80],
        "last_year": [2024, 2024, 2024, 2024, 2024],
        "last_participation": [0.55, 0.60, 0.68, 0.565, 0.68],
        "pred_participation": [0.50, 0.58, 0.65, 0.524, 0.65],
        "pred_abstention": [0.50, 0.42, 0.35, 0.476, 0.35],
        "pred_low": [0.45, 0.37, 0.30, 0.426, 0.30],
        "pred_high": [0.55, 0.47, 0.40, 0.526, 0.40],
        "trend_pp": [-2.0, 1.0, 3.0, -1.1, 3.0],
        "volatility_pp": [4.0, 3.0, 2.0, 3.7, 2.0],
        "risk_score": [78.0, 58.0, np.nan, 72.0, 30.0],
        "category": ["rojo", "naranja", "sin_dato", "naranja", "verde"],
    }
    pd.DataFrame(units_data).to_parquet(build_dir / "units.parquet", index=False)

    # 4. Participation parquet
    part_data = {
        "cvegeo": ["07101", "07102", "09001", "07101", "07102", "09001"],
        "cve_ent": ["07", "07", "09", "07", "07", "09"],
        "year": [2021, 2021, 2021, 2024, 2024, 2024],
        "election": ["DIP_FED", "DIP_FED", "DIP_FED", "DIP_FED", "DIP_FED", "DIP_FED"],
        "lista_nominal": [260000, 110000, 300000, 280000, 120000, 320000],
        "votos_totales": [130000, 66000, 195000, 154000, 72000, 217600],
        "participacion": [0.50, 0.60, 0.65, 0.55, 0.60, 0.68],
    }
    pd.DataFrame(part_data).to_parquet(build_dir / "participation.parquet", index=False)

    # 5. Drivers parquet
    drivers_data = {
        "id": ["07101", "07101", "07102"],
        "level": ["mun", "mun", "mun"],
        "key": ["pct_18_24", "graproes", "graproes"],
        "label": ["Jóvenes", "Escolaridad", "Escolaridad"],
        "contribution_pp": [2.5, -1.8, 3.1],
        "direction": ["sube_abstencion", "baja_abstencion", "sube_abstencion"],
        "rank": [1, 2, 1],
    }
    pd.DataFrame(drivers_data).to_parquet(build_dir / "drivers.parquet", index=False)

    # 6. Metrics json
    metrics_info = {
        "target_year": 2027,
        "train_years": [2009, 2012, 2015, 2018, 2021, 2024],
        "backtests": [
            {"train_until": 2018, "test_year": 2021, "mae_pp": 3.2, "rmse_pp": 4.1, "spearman": 0.85, "n": 2450}
        ],
        "coefficients": [
            {"key": "graproes", "label": "Escolaridad", "coef_pp_per_sd": -2.1}
        ],
        "generated_at": "2026-10-04T12:00:00Z",
        "data_sources": [
            {"name": "INE SICEE", "file": "participation.parquet", "rows": 6}
        ],
    }
    (build_dir / "metrics.json").write_text(json.dumps(metrics_info), encoding="utf-8")

    test_store = PandasStore(build_dir=build_dir, seed_dir=seed_dir)
    monkeypatch.setattr("atalaya.api.routes.get_store", lambda: test_store)
    monkeypatch.setattr("atalaya.api.deps.get_store", lambda: test_store)
    monkeypatch.setattr("atalaya.api.routes.SEED_DIR", seed_dir)
    monkeypatch.setattr("atalaya.config.BUILD_DIR", build_dir)
    monkeypatch.setattr("atalaya.config.SEED_DIR", seed_dir)

    reload_all()
    return test_store


@pytest.fixture
def client(api_test_env):
    with TestClient(app) as tc:
        yield tc


def test_health(client: TestClient):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["store"] in ("memory", "es")
    assert "warmup" in data
    assert "data" in data
    assert data["data"]["units_mun"] == 3
    assert data["data"]["units_state"] == 2


def test_meta(client: TestClient):
    resp = client.get("/api/meta")
    assert resp.status_code == 200
    meta = resp.json()
    assert meta["target_year"] == 2027
    assert len(meta["scenarios"]) == 3
    sc_ids = [s["id"] for s in meta["scenarios"]]
    assert "base" in sc_ids
    assert "intervencion" in sc_ids
    assert "pesimista" in sc_ids

    assert len(meta["categories"]) == 5
    cat_ids = [c["id"] for c in meta["categories"]]
    assert set(cat_ids) == {"verde", "amarillo", "naranja", "rojo", "sin_dato"}

    assert len(meta["states"]) == 2
    assert meta["states"][0]["id"] == "07"

    assert "data_sources" in meta
    src_names = [s["name"] for s in meta["data_sources"]]
    assert "CCPC" in src_names
    assert "INEGI ITER 2020" in src_names
    assert "CONAPO IMM 2020" in src_names
    assert "INEGI MG 2024" in src_names


def test_risk_base_mun_and_state(client: TestClient):
    # Municipal risk
    resp_mun = client.get("/api/risk?level=mun&scenario=base")
    assert resp_mun.status_code == 200
    mun_data = resp_mun.json()
    assert mun_data["level"] == "mun"
    assert mun_data["scenario"] == "base"
    assert len(mun_data["items"]) == 3
    ids = {item["id"] for item in mun_data["items"]}
    assert "07101" in ids

    # Filtered by ent=07
    resp_ent = client.get("/api/risk?level=mun&ent=07&scenario=base")
    assert resp_ent.status_code == 200
    ent_data = resp_ent.json()
    assert len(ent_data["items"]) == 2
    for item in ent_data["items"]:
        assert item["ent"] == "07"

    # State level
    resp_state = client.get("/api/risk?level=state&scenario=base")
    assert resp_state.status_code == 200
    state_data = resp_state.json()
    assert state_data["level"] == "state"
    assert len(state_data["items"]) == 2


def test_risk_intervention(client: TestClient):
    resp = client.get("/api/risk?level=mun&scenario=intervencion")
    assert resp.status_code == 200
    data = resp.json()
    assert data["scenario"] == "intervencion"
    assert len(data["items"]) > 0
    first = data["items"][0]
    assert "delta_vs_base_pp" in first


def test_simulate_endpoint(client: TestClient):
    # Valid call
    body = {
        "scenario": "intervencion",
        "params": {
            "lever": "promocion_jovenes",
            "targeting": "rojo_naranja",
            "effect_pp": 3.0,
            "coverage": 50,
        },
        "level": "mun",
        "ent": "07",
    }
    resp = client.post("/api/scenario/simulate", json=body)
    assert resp.status_code == 200
    res = resp.json()
    assert res["scenario"] == "intervencion"
    assert "summary" in res
    assert "items" in res
    assert len(res["items"]) == 2

    # Invalid effect_pp (> 10)
    bad_body = {
        "scenario": "intervencion",
        "params": {"effect_pp": 99.0},
        "level": "mun",
    }
    bad_resp = client.post("/api/scenario/simulate", json=bad_body)
    assert bad_resp.status_code == 422
    assert "efecto" in bad_resp.json()["detail"].lower()


def test_region_detail_mun(client: TestClient):
    resp = client.get("/api/region/07101?scenario=base")
    assert resp.status_code == 200
    data = resp.json()

    assert data["id"] == "07101"
    assert data["name"] == "Tuxtla Gutiérrez"
    assert data["level"] == "mun"
    assert data["category"] == "rojo"

    # Parent
    assert data["parent"] is not None
    assert data["parent"]["id"] == "07"
    assert data["parent"]["name"] == "Chiapas"

    # Series
    assert len(data["series"]) == 2
    assert data["series"][0]["year"] == 2021

    # Features
    assert len(data["features"]) > 0
    f_map = {f["key"]: f for f in data["features"]}
    assert "graproes" in f_map
    assert f_map["graproes"]["value"] == 10.0
    assert f_map["graproes"]["national_median"] is not None

    # Drivers
    assert len(data["drivers"]) == 2
    assert data["drivers"][0]["key"] == "pct_18_24"

    # Scenarios
    assert len(data["scenarios"]) == 3

    # Recommendations
    assert isinstance(data["recommendations"], list)

    # CCPC and profile fields (tolerated when empty)
    assert "profile" in data
    assert isinstance(data["profile"], list)
    assert "pj_2025" in data
    assert "participation" in data["pj_2025"]
    assert "ccpc" in data
    assert set(data["ccpc"].keys()) == {"pct_ln_18_34", "part_18_34", "gap_youth_pp", "gap_sexo_pp", "pct_ln_rural"}
    assert "imputed_census" in data
    assert isinstance(data["imputed_census"], bool)


def test_region_detail_with_profile_and_pj2025(client: TestClient, api_test_env):
    store = api_test_env
    # Add profile parquet to build dir
    prof_df = pd.DataFrame([
        {"cvegeo": "07101", "cve_ent": "07", "year": 2009, "age_group": "18-24", "sexo": "H", "ln": 500, "sv": 250, "nv": 250, "ns": 0},
        {"cvegeo": "07101", "cve_ent": "07", "year": 2024, "age_group": "18-24", "sexo": "H", "ln": 600, "sv": 360, "nv": 240, "ns": 0},
    ])
    prof_df.to_parquet(store.build_dir / "ccpc_profile_mun.parquet", index=False)

    # Add PJF 2025 row to participation parquet
    part_df = pd.read_parquet(store.build_dir / "participation.parquet")
    pjf_row = pd.DataFrame([{
        "cvegeo": "07101", "cve_ent": "07", "year": 2025, "election": "PJF",
        "lista_nominal": 280000, "votos_totales": 70000, "participacion": 0.25
    }])
    pd.concat([part_df, pjf_row], ignore_index=True).to_parquet(store.build_dir / "participation.parquet", index=False)
    reload_all()

    resp = client.get("/api/region/07101?scenario=base")
    assert resp.status_code == 200
    data = resp.json()

    assert len(data["profile"]) == 2
    assert {p["year"] for p in data["profile"]} == {2009, 2024}
    assert data["pj_2025"]["participation"] == 0.25
    assert any(s["year"] == 2025 and s["election"] == "PJF" for s in data["series"])


def test_region_detail_state(client: TestClient):
    resp = client.get("/api/region/07?scenario=base")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == "07"
    assert data["level"] == "state"
    assert data["parent"] is None


def test_region_detail_not_found(client: TestClient):
    resp = client.get("/api/region/99999")
    assert resp.status_code == 404
    assert "no encontrada" in resp.json()["detail"]


def test_ranking(client: TestClient):
    resp = client.get("/api/ranking?level=mun&limit=10")
    assert resp.status_code == 200
    items = resp.json()["items"]

    # Only 2 units (07101: 78.0, 07102: 58.0), 09001 has sin_dato so excluded
    assert len(items) == 2
    assert items[0]["id"] == "07101"
    assert items[0]["risk_score"] == 78.0
    assert items[1]["id"] == "07102"
    assert items[1]["risk_score"] == 58.0
    for it in items:
        assert it["category"] != "sin_dato"


def test_metrics(client: TestClient):
    resp = client.get("/api/metrics")
    assert resp.status_code == 200
    data = resp.json()
    assert data["target_year"] == 2027
    assert len(data["backtests"]) == 1


def test_admin_reload(client: TestClient):
    resp = client.post("/api/admin/reload")
    assert resp.status_code == 200
    stats = resp.json()
    assert "units_mun" in stats
    assert stats["units_mun"] == 3


def test_empty_build_starts_cleanly(tmp_path: Path, monkeypatch):
    empty_build = tmp_path / "empty_build"
    empty_seed = tmp_path / "empty_seed"
    empty_build.mkdir()
    empty_seed.mkdir()

    empty_store = PandasStore(build_dir=empty_build, seed_dir=empty_seed)
    monkeypatch.setattr("atalaya.api.routes.get_store", lambda: empty_store)
    monkeypatch.setattr("atalaya.api.deps.get_store", lambda: empty_store)
    monkeypatch.setattr("atalaya.api.routes.SEED_DIR", empty_seed)
    monkeypatch.setattr("atalaya.config.BUILD_DIR", empty_build)
    monkeypatch.setattr("atalaya.config.SEED_DIR", empty_seed)

    reload_all()

    with TestClient(app) as tc:
        resp_health = tc.get("/api/health")
        assert resp_health.status_code == 200
        assert resp_health.json()["data"]["units_mun"] == 0

        resp_risk = tc.get("/api/risk?level=mun&scenario=base")
        assert resp_risk.status_code == 200
        assert resp_risk.json()["items"] == []

        resp_metrics = tc.get("/api/metrics")
        assert resp_metrics.status_code == 200
        assert resp_metrics.json()["train_years"] == []

        resp_meta = tc.get("/api/meta")
        assert resp_meta.status_code == 200
        assert "data_sources" in resp_meta.json()

        resp_ranking = tc.get("/api/ranking?level=mun")
        assert resp_ranking.status_code == 200
        assert resp_ranking.json()["items"] == []

        resp_region = tc.get("/api/region/07")
        assert resp_region.status_code == 404

