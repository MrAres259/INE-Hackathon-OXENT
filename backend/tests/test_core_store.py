"""Unit tests for PandasStore and DataStore operations."""

from __future__ import annotations

import json
from pathlib import Path
import numpy as np
import pandas as pd
import pytest

from atalaya.store import PandasStore, get_store


@pytest.fixture
def store_env(tmp_path: Path):
    build_dir = tmp_path / "build"
    seed_dir = tmp_path / "seed"
    build_dir.mkdir(parents=True, exist_ok=True)
    seed_dir.mkdir(parents=True, exist_ok=True)

    # 1. Seed states.csv
    states_csv = (
        "cve_ent,name,iso,aliases\n"
        "07,Chiapas,MX-CHP,CHIS\n"
        "09,Ciudad de México,MX-CMX,CDMX|DISTRITO FEDERAL|DF|CIUDAD DE MEXICO\n"
    )
    (seed_dir / "states.csv").write_text(states_csv, encoding="utf-8")

    # 2. Seed variables.csv
    vars_csv = (
        'key,label_es,description,source,unit,level\n'
        'pct_18_24,Jóvenes de 18 a 24 años,"Proporción de la población de 18 y más que tiene 18 a 24 años",INEGI,proporción,mun|state\n'
        'pob_tot,Población total,"Población total, Censo 2020",INEGI,personas,mun|state\n'
        'participacion,Participación ciudadana,"Votos totales entre lista nominal",INE,proporción,mun|state\n'
    )
    (seed_dir / "variables.csv").write_text(vars_csv, encoding="utf-8")

    # 3. Units parquet (5 municipalities across 2 states)
    units_data = {
        "id": ["07101", "07102", "07103", "09001", "09002"],
        "level": ["mun", "mun", "mun", "mun", "mun"],
        "cve_ent": ["07", "07", "07", "09", "09"],
        "cve_mun": ["101", "102", "103", "001", "002"],
        "cvegeo": ["07101", "07102", "07103", "09001", "09002"],
        "name": [
            "Tuxtla Gutiérrez",
            "San Cristóbal de las Casas",
            "Tapachula",
            "Benito Juárez",
            "Cuauhtémoc",
        ],
        "pob_tot": [500000, 200000, 300000, 400000, 500000],
        "pob_18ymas": [350000, 150000, 200000, 300000, 400000],
        "pct_18_24": [0.20, 0.25, 0.15, 0.12, 0.14],
        "graproes": [10.0, 8.0, 9.0, 14.0, 13.0],
        "risk_score": [40.0, 60.0, 80.0, 20.0, 30.0],
        "category": ["amarillo", "naranja", "rojo", "verde", "verde"],
    }
    pd.DataFrame(units_data).to_parquet(build_dir / "units.parquet", index=False)

    # 4. Participation parquet (2 years)
    part_data = {
        "cvegeo": ["07101", "07102", "07103", "09001", "09002"] * 2,
        "cve_ent": ["07", "07", "07", "09", "09"] * 2,
        "year": [2021] * 5 + [2024] * 5,
        "election": ["DIP_FED"] * 10,
        "lista_nominal": [
            300000, 100000, 180000, 280000, 380000,
            320000, 110000, 190000, 290000, 390000,
        ],
        "votos_totales": [
            150000, 60000, 90000, 196000, 228000,
            192000, 77000, 95000, 217500, 253500,
        ],
        "participacion": [
            0.50, 0.60, 0.50, 0.70, 0.60,
            0.60, 0.70, 0.50, 0.75, 0.65,
        ],
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
            {"name": "INE SICEE", "file": "participation.parquet", "rows": 10}
        ],
    }
    (build_dir / "metrics.json").write_text(json.dumps(metrics_info), encoding="utf-8")

    return PandasStore(build_dir=build_dir, seed_dir=seed_dir)


def test_units_levels_and_weighted_derivation(store_env: PandasStore):
    store = store_env

    # 1. Municipal units
    mun_df = store.units(level="mun")
    assert len(mun_df) == 5

    # 2. State units (derived)
    state_df = store.units(level="state")
    assert len(state_df) == 2

    chis = state_df[state_df["cve_ent"] == "07"].iloc[0]
    assert chis["name"] == "Chiapas"
    assert chis["pob_tot"] == 1000000
    assert chis["pob_18ymas"] == 700000
    # Weighted graproes: (10.0*350000 + 8.0*150000 + 9.0*200000) / 700000 = 6500000 / 700000 ≈ 9.2857
    assert pytest.approx(chis["graproes"], 0.001) == 9.2857


def test_participation_state_derivation(store_env: PandasStore):
    store = store_env

    # State level participation
    state_part = store.participation(level="state", election="DIP_FED", years=[2021])
    assert len(state_part) == 2

    chis_2021 = state_part[state_part["cve_ent"] == "07"].iloc[0]
    # Sum of lista_nominal: 300000 + 100000 + 180000 = 580000
    assert chis_2021["lista_nominal"] == 580000
    # Sum of votos: 150000 + 60000 + 90000 = 300000
    assert chis_2021["votos_totales"] == 300000
    assert pytest.approx(chis_2021["participacion"], 0.001) == 300000 / 580000
    assert pytest.approx(chis_2021["abstencion"], 0.001) == 1.0 - (300000 / 580000)


def test_top_and_aggregate(store_env: PandasStore):
    store = store_env

    # Top risk score
    top_items = store.top("risk_score", level="mun", limit=2)
    assert len(top_items) == 2
    assert top_items[0]["id"] == "07103"
    assert top_items[0]["value"] == 80.0
    assert top_items[1]["id"] == "07102"
    assert top_items[1]["value"] == 60.0

    # Aggregate pob_tot grouped by cve_ent
    agg = store.aggregate("pob_tot", level="mun", group_by="cve_ent", stat="sum")
    agg_map = {item["key"]: item["value"] for item in agg}
    assert agg_map["07"] == 1000000
    assert agg_map["09"] == 900000


def test_correlation(store_env: PandasStore):
    store = store_env
    res = store.correlation(["pob_tot", "pob_18ymas"], level="mun")
    assert res["n"] == 5
    matrix = res["matrix"]
    assert matrix["pob_tot"]["pob_tot"] == 1.0
    assert matrix["pob_tot"]["pob_18ymas"] is not None
    assert matrix["pob_tot"]["pob_18ymas"] > 0.9


def test_search_units(store_env: PandasStore):
    store = store_env

    # Fuzzy municipality match
    hits = store.search_units("tuxtla gutierez")
    assert len(hits) > 0
    assert hits[0]["id"] == "07101"
    assert hits[0]["name"] == "Tuxtla Gutiérrez"

    # State alias match: CDMX -> 09
    hits_alias = store.search_units("CDMX")
    assert len(hits_alias) > 0
    assert any(h["id"] == "09" for h in hits_alias)


def test_search_catalog(store_env: PandasStore):
    store = store_env
    hits = store.search_catalog("jóvenes")
    assert len(hits) > 0
    assert hits[0]["key"] == "pct_18_24"


def test_get_store_returns_pandas_store():
    store = get_store()
    assert isinstance(store, PandasStore)
    assert store.kind == "memory"


def test_wide_participation_columns_in_units(store_env: PandasStore):
    store = store_env
    mun_df = store.units(level="mun")
    assert "part_dip_2021" in mun_df.columns
    assert "part_dip_2024" in mun_df.columns
    assert "abst_dip_2021" in mun_df.columns
    assert "abst_dip_2024" in mun_df.columns

    tux = mun_df[mun_df["id"] == "07101"].iloc[0]
    assert tux["part_dip_2021"] == 0.50
    assert tux["part_dip_2024"] == 0.60
    assert tux["abst_dip_2021"] == 0.50
    assert tux["abst_dip_2024"] == 0.40

    state_df = store.units(level="state")
    assert "part_dip_2021" in state_df.columns
    assert "part_dip_2024" in state_df.columns
    chis = state_df[state_df["id"] == "07"].iloc[0]
    assert pytest.approx(chis["part_dip_2021"], 0.001) == 300000 / 580000


def test_correlation_participacion_graproes_with_year(store_env: PandasStore):
    store = store_env

    # Correlate participacion and graproes for 2021
    res_2021 = store.correlation(["participacion", "graproes"], level="mun", filters={"year": 2021})
    assert res_2021["n"] == 5
    assert "participacion" in res_2021["matrix"]
    assert "graproes" in res_2021["matrix"]["participacion"]
    corr_2021 = res_2021["matrix"]["participacion"]["graproes"]
    assert corr_2021 is not None

    # Correlate participacion and graproes for 2024
    res_2024 = store.correlation(["participacion", "graproes"], level="mun", filters={"year": 2024})
    assert res_2024["n"] == 5
    corr_2024 = res_2024["matrix"]["participacion"]["graproes"]
    assert corr_2024 is not None

    # Top participacion using resolved wide column
    top_p = store.top("participacion", level="mun", filters={"year": 2024}, limit=2)
    assert len(top_p) == 2
    assert top_p[0]["id"] == "09001"
    assert top_p[0]["value"] == 0.75


def test_drivers(store_env: PandasStore):
    store = store_env
    d1 = store.drivers("07101")
    assert len(d1) == 2
    assert d1[0]["key"] == "pct_18_24"
    assert d1[0]["rank"] == 1

    d2 = store.drivers("99999")
    assert d2 == []


def test_metrics(store_env: PandasStore):
    store = store_env
    m = store.metrics()
    assert m.get("target_year") == 2027
    assert len(m.get("coefficients", [])) == 1


def test_reload(store_env: PandasStore):
    store = store_env
    _ = store.units()
    assert store._units_df is not None
    store.reload()
    assert store._units_df is None


def test_store_profile_mun_and_state(tmp_path: Path):
    build_dir = tmp_path / "build"
    seed_dir = tmp_path / "seed"
    build_dir.mkdir(parents=True, exist_ok=True)
    seed_dir.mkdir(parents=True, exist_ok=True)

    # Empty store profile returns empty list
    empty_store = PandasStore(build_dir=build_dir, seed_dir=seed_dir)
    assert empty_store.profile("07101") == []

    # Create synthetic ccpc_profile_mun.parquet
    prof_records = [
        {"cvegeo": "07101", "cve_ent": "07", "year": 2009, "age_group": "18-24", "sexo": "H", "ln": 100, "sv": 40, "nv": 60, "ns": 2},
        {"cvegeo": "07101", "cve_ent": "07", "year": 2009, "age_group": "18-24", "sexo": "M", "ln": 100, "sv": 50, "nv": 50, "ns": 1},
        {"cvegeo": "07101", "cve_ent": "07", "year": 2024, "age_group": "18-24", "sexo": "H", "ln": 120, "sv": 60, "nv": 60, "ns": 3},
        {"cvegeo": "07101", "cve_ent": "07", "year": 2024, "age_group": "18-24", "sexo": "M", "ln": 130, "sv": 78, "nv": 52, "ns": 2},
        # Second municipality in 07
        {"cvegeo": "07102", "cve_ent": "07", "year": 2024, "age_group": "18-24", "sexo": "H", "ln": 80, "sv": 40, "nv": 40, "ns": 1},
        {"cvegeo": "07102", "cve_ent": "07", "year": 2024, "age_group": "18-24", "sexo": "M", "ln": 90, "sv": 54, "nv": 36, "ns": 1},
    ]
    pd.DataFrame(prof_records).to_parquet(build_dir / "ccpc_profile_mun.parquet", index=False)

    store = PandasStore(build_dir=build_dir, seed_dir=seed_dir)

    # 1. Municipal profile for all years
    p_mun_all = store.profile("07101")
    assert len(p_mun_all) == 4
    years = {p["year"] for p in p_mun_all}
    assert years == {2009, 2024}

    # 2. Municipal profile filtered by year
    p_mun_2024 = store.profile("07101", year=2024)
    assert len(p_mun_2024) == 2
    for r in p_mun_2024:
        assert r["year"] == 2024
        assert r["participacion"] is not None
        assert 0.0 <= r["participacion"] <= 1.0

    # 3. State level profile (aggregates 07101 and 07102)
    p_state_2024 = store.profile("07", year=2024)
    assert len(p_state_2024) == 2  # 18-24 H and 18-24 M
    h_doc = next(d for d in p_state_2024 if d["sexo"] == "H")
    # ln: 120 + 80 = 200, sv: 60 + 40 = 100, nv: 60 + 40 = 100, ns: 3 + 1 = 4
    assert h_doc["ln"] == 200
    assert h_doc["sv"] == 100
    assert h_doc["nv"] == 100
    assert h_doc["ns"] == 4
    assert pytest.approx(h_doc["participacion"], 0.001) == 0.50

    # 4. Unknown unit
    assert store.profile("99999") == []


def test_store_ccpc_features_resolution(tmp_path: Path):
    build_dir = tmp_path / "build"
    seed_dir = tmp_path / "seed"
    build_dir.mkdir(parents=True, exist_ok=True)
    seed_dir.mkdir(parents=True, exist_ok=True)

    # Units
    units_df = pd.DataFrame([
        {"id": "07101", "level": "mun", "cve_ent": "07", "cvegeo": "07101", "name": "Tuxtla", "pob_tot": 500000, "pob_18ymas": 350000, "part_pj_2025": 0.22, "imputed_census": False},
        {"id": "07102", "level": "mun", "cve_ent": "07", "cvegeo": "07102", "name": "San Cristobal", "pob_tot": 200000, "pob_18ymas": 150000, "part_pj_2025": 0.18, "imputed_census": False},
        {"id": "09001", "level": "mun", "cve_ent": "09", "cvegeo": "09001", "name": "Cuauhtemoc", "pob_tot": 400000, "pob_18ymas": 300000, "part_pj_2025": 0.30, "imputed_census": False},
    ])
    units_df.to_parquet(build_dir / "units.parquet", index=False)

    # Participation
    part_df = pd.DataFrame([
        {"cvegeo": "07101", "cve_ent": "07", "year": 2024, "election": "DIP_FED", "lista_nominal": 300000, "votos_totales": 150000, "participacion": 0.50},
        {"cvegeo": "07102", "cve_ent": "07", "year": 2024, "election": "DIP_FED", "lista_nominal": 100000, "votos_totales": 60000, "participacion": 0.60},
        {"cvegeo": "09001", "cve_ent": "09", "year": 2024, "election": "DIP_FED", "lista_nominal": 250000, "votos_totales": 175000, "participacion": 0.70},
    ])
    part_df.to_parquet(build_dir / "participation.parquet", index=False)

    # CCPC Features
    features_df = pd.DataFrame([
        {"cvegeo": "07101", "cve_ent": "07", "year": 2024, "pct_ln_18_34": 0.35, "part_18_34": 0.42, "part_total": 0.50, "gap_youth_pp": -8.0, "gap_sexo_pp": 4.5, "pct_ln_rural": 0.10, "pct_ln_urbana": 0.90, "ns_rate": 0.01},
        {"cvegeo": "07102", "cve_ent": "07", "year": 2024, "pct_ln_18_34": 0.40, "part_18_34": 0.55, "part_total": 0.60, "gap_youth_pp": -5.0, "gap_sexo_pp": 3.0, "pct_ln_rural": 0.40, "pct_ln_urbana": 0.60, "ns_rate": 0.02},
        {"cvegeo": "09001", "cve_ent": "09", "year": 2024, "pct_ln_18_34": 0.28, "part_18_34": 0.65, "part_total": 0.70, "gap_youth_pp": -5.0, "gap_sexo_pp": 2.0, "pct_ln_rural": 0.00, "pct_ln_urbana": 1.00, "ns_rate": 0.005},
    ])
    features_df.to_parquet(build_dir / "ccpc_features.parquet", index=False)

    store = PandasStore(build_dir=build_dir, seed_dir=seed_dir)

    # Top CCPC feature: part_18_34
    top_items = store.top("part_18_34", level="mun", filters={"year": 2024}, limit=2)
    assert len(top_items) == 2
    assert top_items[0]["id"] == "09001"
    assert top_items[0]["value"] == 0.65
    assert top_items[1]["id"] == "07102"
    assert top_items[1]["value"] == 0.55

    # Aggregate gap_youth_pp by state
    agg = store.aggregate("gap_youth_pp", level="mun", group_by="cve_ent", filters={"year": 2024}, stat="mean")
    agg_map = {item["key"]: item["value"] for item in agg}
    assert pytest.approx(agg_map["07"], 0.01) == -6.5
    assert pytest.approx(agg_map["09"], 0.01) == -5.0

    # Correlation between CCPC features
    corr = store.correlation(["part_18_34", "gap_youth_pp"], level="mun", filters={"year": 2024})
    assert corr["n"] == 3
    assert "part_18_34" in corr["matrix"]
    assert "gap_youth_pp" in corr["matrix"]["part_18_34"]

    # Verify units expose part_pj_2025 and imputed_census
    mun_units = store.units(level="mun")
    assert "part_pj_2025" in mun_units.columns
    assert "imputed_census" in mun_units.columns
    assert mun_units[mun_units["id"] == "07101"].iloc[0]["part_pj_2025"] == 0.22


def test_store_ccpc_features_state_and_mun(tmp_path: Path):
    """Verify store.ccpc_features and state-level resolution of CCPC metrics."""
    build_dir = tmp_path / "build"
    seed_dir = tmp_path / "seed"
    build_dir.mkdir(parents=True, exist_ok=True)
    seed_dir.mkdir(parents=True, exist_ok=True)

    states_df = pd.DataFrame([
        {"cve_ent": "07", "name": "Chiapas", "iso": "MX-CHP", "aliases": "CHIS"},
        {"cve_ent": "14", "name": "Jalisco", "iso": "MX-JAL", "aliases": "JAL"},
    ])
    states_df.to_csv(seed_dir / "states.csv", index=False)

    units_df = pd.DataFrame([
        {"id": "07101", "level": "mun", "cve_ent": "07", "cve_mun": "101", "cvegeo": "07101", "name": "Tuxtla", "pob_tot": 500000, "lista_nominal": 350000},
        {"id": "07", "level": "state", "cve_ent": "07", "cve_mun": "", "cvegeo": "07", "name": "Chiapas", "pob_tot": 5000000, "lista_nominal": 3500000},
        {"id": "14", "level": "state", "cve_ent": "14", "cve_mun": "", "cvegeo": "14", "name": "Jalisco", "pob_tot": 8000000, "lista_nominal": 6000000},
    ])
    units_df.to_parquet(build_dir / "units.parquet", index=False)

    feat_df = pd.DataFrame([
        {"cvegeo": "07101", "cve_ent": "07", "level": "mun", "year": 2024, "pct_ln_18_34": 0.30, "part_18_34": 0.45},
        {"cvegeo": "07", "cve_ent": "07", "level": "state", "year": 2024, "pct_ln_18_34": 0.32, "part_18_34": 0.50},
        {"cvegeo": "14", "cve_ent": "14", "level": "state", "year": 2024, "pct_ln_18_34": 0.28, "part_18_34": 0.55},
        # Judicial election 2025
        {"cvegeo": "07", "cve_ent": "07", "level": "state", "year": 2025, "pct_ln_18_34": 0.32, "part_18_34": 0.15},
    ])
    feat_df.to_parquet(build_dir / "ccpc_features.parquet", index=False)

    store = PandasStore(build_dir=build_dir, seed_dir=seed_dir)

    # 1. Mun ccpc_features
    mun_feat = store.ccpc_features("07101")
    assert mun_feat is not None
    assert mun_feat["pct_ln_18_34"] == 0.30
    assert mun_feat["part_18_34"] == 0.45
    assert mun_feat["year"] == 2024

    # 2. State ccpc_features defaults to DIP_FED year (2024), NOT 2025
    st_feat = store.ccpc_features("07")
    assert st_feat is not None
    assert st_feat["year"] == 2024
    assert st_feat["part_18_34"] == 0.50

    # 3. State top for CCPC metric
    top_states = store.top("part_18_34", level="state")
    assert len(top_states) == 2
    assert top_states[0]["id"] == "14"
    assert top_states[0]["value"] == 0.55
    assert top_states[1]["id"] == "07"
    assert top_states[1]["value"] == 0.50

    # 4. State aggregate for CCPC metric
    agg = store.aggregate("part_18_34", level="state", filters={"cve_ent": "07"})
    assert len(agg) == 1
    assert agg[0]["value"] == 0.50


def test_store_profile_privacy_and_suppression(tmp_path: Path):
    """Verify PandasStore.profile drops nonbinary 'X' for municipal queries and suppresses cells with LN < 10."""
    build_dir = tmp_path / "build"
    seed_dir = tmp_path / "seed"
    build_dir.mkdir(parents=True, exist_ok=True)
    seed_dir.mkdir(parents=True, exist_ok=True)

    states_df = pd.DataFrame([
        {"cve_ent": "07", "name": "Chiapas", "iso": "MX-CHP", "aliases": "CHIS"},
    ])
    states_df.to_csv(seed_dir / "states.csv", index=False)

    prof_df = pd.DataFrame([
        # Mun 07101
        {"cvegeo": "07101", "cve_ent": "07", "year": 2024, "age_group": "18-24", "sexo": "H", "ln": 100, "sv": 60, "nv": 40, "ns": 0, "participacion": 0.60},
        {"cvegeo": "07101", "cve_ent": "07", "year": 2024, "age_group": "18-24", "sexo": "M", "ln": 7, "sv": 4, "nv": 3, "ns": 0, "participacion": 0.57},
        {"cvegeo": "07101", "cve_ent": "07", "year": 2024, "age_group": "18-24", "sexo": "X", "ln": 2, "sv": 1, "nv": 1, "ns": 0, "participacion": 0.50},
        # Mun 07102 (adds to state Chiapas 07)
        {"cvegeo": "07102", "cve_ent": "07", "year": 2024, "age_group": "18-24", "sexo": "X", "ln": 15, "sv": 8, "nv": 7, "ns": 0, "participacion": 0.53},
        {"cvegeo": "07102", "cve_ent": "07", "year": 2024, "age_group": "65+", "sexo": "X", "ln": 4, "sv": 2, "nv": 2, "ns": 0, "participacion": 0.50},
    ])
    prof_df.to_parquet(build_dir / "ccpc_profile_mun.parquet", index=False)

    store = PandasStore(build_dir=build_dir, seed_dir=seed_dir)

    # 1. Municipal query
    mun_prof = store.profile("07101", year=2024)
    # sexo="X" dropped
    sexes = [r["sexo"] for r in mun_prof]
    assert "X" not in sexes

    # LN < 10 suppressed
    m_cell = next(r for r in mun_prof if r["sexo"] == "M")
    assert m_cell["suprimido"] is True
    assert m_cell["ln"] is None
    assert m_cell["sv"] is None
    assert m_cell["nv"] is None
    assert m_cell["participacion"] is None

    # Normal cell intact
    h_cell = next(r for r in mun_prof if r["sexo"] == "H")
    assert h_cell["suprimido"] is False
    assert h_cell["ln"] == 100
    assert h_cell["participacion"] == 0.60

    # 2. State query
    state_prof = store.profile("07", year=2024)
    # State retains sexo="X"
    state_sexes = [r["sexo"] for r in state_prof]
    assert "X" in state_sexes

    # 18-24 X cell: sum LN = 17 >= 10 -> not suppressed
    x_18 = next(r for r in state_prof if r["sexo"] == "X" and r["age_group"] == "18-24")
    assert x_18["suprimido"] is False
    assert x_18["ln"] == 17

    # 65+ X cell: sum LN = 4 < 10 -> suppressed
    x_65 = next(r for r in state_prof if r["sexo"] == "X" and r["age_group"] == "65+")
    assert x_65["suprimido"] is True
    assert x_65["ln"] is None
    assert x_65["participacion"] is None



