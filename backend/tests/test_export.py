"""Tests for ATALAYA export module."""

import json
from pathlib import Path

import openpyxl
import pandas as pd
import pytest

from atalaya.export import (
    create_dictionary_dataframe,
    create_leeme_dataframe,
    export_deliverables,
)
from atalaya.ingest.common import write_parquet


EXPECTED_GEOJSON_PROPS = [
    "id",
    "ent",
    "name",
    "lista_nominal",
    "last_year",
    "last_reliable_year",
    "last_participation",
    "pred_dev_pp",
    "fallback_model",
    "gov_2027",
    "pred_abstention_base",
    "category_base",
    "pred_abstention_intervencion",
    "category_intervencion",
    "delta_pp_intervencion",
    "pred_abstention_pesimista",
    "category_pesimista",
    "risk_score_base",
    "trend_pp",
    "top_driver",
    "top_recommendation",
    "imputed_census",
    "part_pj_2025",
    "pct_ln_18_34",
    "part_18_34",
    "gap_youth_pp",
    "gap_sexo_pp",
    "pct_ln_rural",
]

EXPECTED_SHEETS = [
    "LEEME",
    "diccionario",
    "semaforo_ponderado",
    "priorizacion",
    "municipios",
    "estados",
    "participacion_historica",
    "perfil_edad_sexo",
    "drivers",
    "recomendaciones",
    "metricas_modelo",
]


def create_synthetic_build_data(build_dir: Path, n_profile_rows: int = 50005) -> None:
    """Create minimal valid build artifacts for 3 municipalities and 2 states."""
    build_dir.mkdir(parents=True, exist_ok=True)

    # 1. units.parquet
    mun_rows = [
        {
            "id": "01001",
            "level": "mun",
            "cve_ent": "01",
            "name": "Aguascalientes",
            "lista_nominal": 50000,
            "last_year": 2024,
            "last_reliable_year": 2024,
            "last_participation": 0.58,
            "pred_participation": 0.56,
            "pred_abstention": 0.44,
            "pred_dev_pp": 4.16,
            "fallback_model": None,
            "pred_low": 0.40,
            "pred_high": 0.48,
            "trend_pp": -1.2,
            "volatility_pp": 2.5,
            "vulnerability_pp": -1.2,
            "r_abs": 0.6,
            "r_vuln": 0.4,
            "r_trend": 0.5,
            "r_vol": 0.3,
            "abstencion_esperada": 22000,
            "prioridad": 1,
            "risk_score": 62.5,
            "category": "naranja",
            "coverage_ln": 0.95,
            "nom_ent": "Aguascalientes",
            "nom_mun": "Aguascalientes",
            "pob_tot": 80000,
            "pob_18ymas": 55000,
            "pct_18_24": 0.22,
            "pct_65ymas": 0.10,
            "graproes": 10.2,
            "pct_hli": 0.02,
            "pct_sin_servsalud": 0.20,
            "pct_internet": 0.70,
            "pct_rural": 0.08,
            "pct_analfabeta": 0.02,
            "pct_po2sm": 0.30,
            "im_2020": -1.2,
            "gm_2020": "Muy bajo",
            "part_pj_2025": 0.18,
            "pct_ln_18_34": 0.35,
            "part_18_34": 0.48,
            "gap_youth_pp": -10.0,
            "gap_sexo_pp": 4.5,
            "pct_ln_rural": 0.05,
            "part_18_34_last": 0.48,
            "gap_youth_pp_last": -10.0,
            "gap_sexo_pp_last": 4.5,
            "pct_ln_rural_last": 0.05,
            "imputed_census": False,
        },
        {
            "id": "01002",
            "level": "mun",
            "cve_ent": "01",
            "name": "Asientos",
            "lista_nominal": 30000,
            "last_year": 2024,
            "last_reliable_year": 2024,
            "last_participation": 0.52,
            "pred_participation": 0.50,
            "pred_abstention": 0.50,
            "pred_dev_pp": -1.84,
            "fallback_model": "mean_l1_l2",
            "pred_low": 0.45,
            "pred_high": 0.55,
            "trend_pp": -2.0,
            "volatility_pp": 3.0,
            "vulnerability_pp": 1.5,
            "r_abs": 0.8,
            "r_vuln": 0.7,
            "r_trend": 0.6,
            "r_vol": 0.4,
            "abstencion_esperada": 15000,
            "prioridad": 2,
            "risk_score": 78.0,
            "category": "rojo",
            "coverage_ln": 0.92,
            "nom_ent": "Aguascalientes",
            "nom_mun": "Asientos",
            "pob_tot": 45000,
            "pob_18ymas": 31000,
            "pct_18_24": 0.25,
            "pct_65ymas": 0.09,
            "graproes": 8.5,
            "pct_hli": 0.01,
            "pct_sin_servsalud": 0.25,
            "pct_internet": 0.50,
            "pct_rural": 0.60,
            "pct_analfabeta": 0.05,
            "pct_po2sm": 0.45,
            "im_2020": -0.3,
            "gm_2020": "Medio",
            "part_pj_2025": 0.15,
            "pct_ln_18_34": 0.32,
            "part_18_34": 0.42,
            "gap_youth_pp": -12.0,
            "gap_sexo_pp": 3.0,
            "pct_ln_rural": 0.55,
            "part_18_34_last": 0.42,
            "gap_youth_pp_last": -12.0,
            "gap_sexo_pp_last": 3.0,
            "pct_ln_rural_last": 0.55,
            "imputed_census": False,
        },
        {
            "id": "02001",
            "level": "mun",
            "cve_ent": "02",
            "name": "Ensenada",
            "lista_nominal": 40000,
            "last_year": 2024,
            "last_reliable_year": 2021,
            "last_participation": 0.45,
            "pred_participation": 0.46,
            "pred_abstention": 0.54,
            "pred_dev_pp": -5.84,
            "fallback_model": "persist_l1",
            "pred_low": 0.49,
            "pred_high": 0.59,
            "trend_pp": 0.5,
            "volatility_pp": 1.8,
            "vulnerability_pp": -0.8,
            "r_abs": 0.4,
            "r_vuln": 0.3,
            "r_trend": 0.2,
            "r_vol": 0.2,
            "abstencion_esperada": 21600,
            "prioridad": None,
            "risk_score": 42.0,
            "category": "amarillo",
            "coverage_ln": 0.90,
            "nom_ent": "Baja California",
            "nom_mun": "Ensenada",
            "pob_tot": 60000,
            "pob_18ymas": 42000,
            "pct_18_24": 0.20,
            "pct_65ymas": 0.12,
            "graproes": 9.8,
            "pct_hli": 0.03,
            "pct_sin_servsalud": 0.22,
            "pct_internet": 0.65,
            "pct_rural": 0.15,
            "pct_analfabeta": 0.03,
            "pct_po2sm": 0.35,
            "im_2020": -1.0,
            "gm_2020": "Bajo",
            "part_pj_2025": 0.12,
            "pct_ln_18_34": 0.29,
            "part_18_34": 0.40,
            "gap_youth_pp": -8.0,
            "gap_sexo_pp": 2.5,
            "pct_ln_rural": 0.12,
            "part_18_34_last": 0.40,
            "gap_youth_pp_last": -8.0,
            "gap_sexo_pp_last": 2.5,
            "pct_ln_rural_last": 0.12,
            "imputed_census": True,
        },
    ]

    st_rows = [
        {
            "id": "01",
            "level": "state",
            "cve_ent": "01",
            "name": "Aguascalientes",
            "lista_nominal": 80000,
            "last_year": 2024,
            "last_participation": 0.5575,
            "pred_participation": 0.5375,
            "pred_abstention": 0.4625,
            "pred_low": 0.4187,
            "pred_high": 0.5063,
            "trend_pp": -1.5,
            "volatility_pp": 2.7,
            "vulnerability_pp": -0.2,
            "r_abs": 0.65,
            "r_vuln": 0.45,
            "r_trend": 0.5,
            "r_vol": 0.35,
            "abstencion_esperada": 37000,
            "prioridad": 1,
            "risk_score": 68.3,
            "category": "naranja",
            "coverage_ln": 0.94,
            "nom_ent": "Aguascalientes",
            "nom_mun": None,
            "pob_tot": 125000,
            "pob_18ymas": 86000,
            "pct_18_24": 0.23,
            "pct_65ymas": 0.096,
            "graproes": 9.58,
            "pct_hli": 0.016,
            "pct_sin_servsalud": 0.218,
            "pct_internet": 0.628,
            "pct_rural": 0.267,
            "pct_analfabeta": 0.031,
            "pct_po2sm": 0.354,
            "im_2020": None,
            "gm_2020": None,
            "part_pj_2025": 0.1687,
            "pct_ln_18_34": 0.33,
            "part_18_34": 0.4575,
            "gap_youth_pp": -10.75,
            "gap_sexo_pp": 3.94,
            "pct_ln_rural": 0.2375,
            "part_18_34_last": 0.4575,
            "gap_youth_pp_last": -10.75,
            "gap_sexo_pp_last": 3.94,
            "pct_ln_rural_last": 0.2375,
            "imputed_census": False,
        },
        {
            "id": "02",
            "level": "state",
            "cve_ent": "02",
            "name": "Baja California",
            "lista_nominal": 40000,
            "last_year": 2024,
            "last_participation": 0.45,
            "pred_participation": 0.46,
            "pred_abstention": 0.54,
            "pred_low": 0.49,
            "pred_high": 0.59,
            "trend_pp": 0.5,
            "volatility_pp": 1.8,
            "vulnerability_pp": -0.8,
            "r_abs": 0.4,
            "r_vuln": 0.3,
            "r_trend": 0.2,
            "r_vol": 0.2,
            "abstencion_esperada": 21600,
            "prioridad": None,
            "risk_score": 42.0,
            "category": "amarillo",
            "coverage_ln": 0.90,
            "nom_ent": "Baja California",
            "nom_mun": None,
            "pob_tot": 60000,
            "pob_18ymas": 42000,
            "pct_18_24": 0.20,
            "pct_65ymas": 0.12,
            "graproes": 9.8,
            "pct_hli": 0.03,
            "pct_sin_servsalud": 0.22,
            "pct_internet": 0.65,
            "pct_rural": 0.15,
            "pct_analfabeta": 0.03,
            "pct_po2sm": 0.35,
            "im_2020": None,
            "gm_2020": None,
            "part_pj_2025": 0.12,
            "pct_ln_18_34": 0.29,
            "part_18_34": 0.40,
            "gap_youth_pp": -8.0,
            "gap_sexo_pp": 2.5,
            "pct_ln_rural": 0.12,
            "part_18_34_last": 0.40,
            "gap_youth_pp_last": -8.0,
            "gap_sexo_pp_last": 2.5,
            "pct_ln_rural_last": 0.12,
            "imputed_census": False,
        },
    ]

    units_df = pd.DataFrame(mun_rows + st_rows)
    write_parquet(units_df, build_dir / "units.parquet")

    # 2. drivers.parquet
    driver_rows = []
    for u_id, lvl in [("01001", "mun"), ("01002", "mun"), ("02001", "mun"), ("01", "state"), ("02", "state")]:
        driver_rows.append({
            "id": u_id,
            "level": lvl,
            "rank": 1,
            "key": "pct_18_24",
            "label": "Jóvenes de 18 a 24 años",
            "contribution_pp": 3.5,
            "direction": "sube_abstencion",
        })
        driver_rows.append({
            "id": u_id,
            "level": lvl,
            "rank": 2,
            "key": "graproes",
            "label": "Escolaridad promedio",
            "contribution_pp": -2.1,
            "direction": "baja_abstencion",
        })
    write_parquet(pd.DataFrame(driver_rows), build_dir / "drivers.parquet")

    # 3. participation.parquet (with reliable, ns_rate, low_confidence)
    part_rows = [
        # Reliable rows
        {
            "cvegeo": "01001",
            "cve_ent": "01",
            "year": 2024,
            "election": "DIP_FED",
            "lista_nominal": 50000,
            "votos_totales": 28000,
            "nv": 21000,
            "ns": 1000,
            "ns_rate": 0.02,
            "reliable": True,
            "low_confidence": False,
            "participacion": 0.5714,
        },
        {
            "cvegeo": "01002",
            "cve_ent": "01",
            "year": 2024,
            "election": "DIP_FED",
            "lista_nominal": 30000,
            "votos_totales": 15000,
            "nv": 14000,
            "ns": 1000,
            "ns_rate": 0.033,
            "reliable": True,
            "low_confidence": False,
            "participacion": 0.5172,
        },
        # Unreliable row: high NS rate, must be exported with empty participacion
        {
            "cvegeo": "02001",
            "cve_ent": "02",
            "year": 2024,
            "election": "DIP_FED",
            "lista_nominal": 40000,
            "votos_totales": 5000,
            "nv": 3000,
            "ns": 32000,
            "ns_rate": 0.80,
            "reliable": False,
            "low_confidence": False,
            "participacion": 0.625,
        },
        # PJF row
        {
            "cvegeo": "01001",
            "cve_ent": "01",
            "year": 2025,
            "election": "PJF",
            "lista_nominal": 50000,
            "votos_totales": 9000,
            "nv": 40000,
            "ns": 1000,
            "ns_rate": 0.02,
            "reliable": True,
            "low_confidence": False,
            "participacion": 0.1837,
        },
    ]
    write_parquet(pd.DataFrame(part_rows), build_dir / "participation.parquet")

    # 4. ccpc_features.parquet
    cf_rows = [
        {
            "cvegeo": "01001",
            "cve_ent": "01",
            "year": 2024,
            "election": "DIP_FED",
            "level": "mun",
            "pct_ln_18_34": 0.35,
            "part_18_34": 0.48,
            "gap_youth_pp": -10.0,
            "gap_sexo_pp": 4.5,
            "pct_ln_rural": 0.05,
            "pct_ln_urbana": 0.95,
            "ns_rate": 0.02,
        },
        {
            "cvegeo": "01002",
            "cve_ent": "01",
            "year": 2024,
            "election": "DIP_FED",
            "level": "mun",
            "pct_ln_18_34": 0.32,
            "part_18_34": 0.42,
            "gap_youth_pp": -12.0,
            "gap_sexo_pp": 3.0,
            "pct_ln_rural": 0.55,
            "pct_ln_urbana": 0.45,
            "ns_rate": 0.033,
        },
        {
            "cvegeo": "02001",
            "cve_ent": "02",
            "year": 2024,
            "election": "DIP_FED",
            "level": "mun",
            "pct_ln_18_34": 0.29,
            "part_18_34": 0.40,
            "gap_youth_pp": -8.0,
            "gap_sexo_pp": 2.5,
            "pct_ln_rural": 0.12,
            "pct_ln_urbana": 0.88,
            "ns_rate": 0.80,
        },
    ]
    write_parquet(pd.DataFrame(cf_rows), build_dir / "ccpc_features.parquet")

    # 5. ccpc_profile_mun.parquet (synthetic rows >= 50,000)
    base_profile_row = {
        "cvegeo": "01001",
        "cve_ent": "01",
        "year": 2024,
        "election": "DIP_FED",
        "age_group": "18-24",
        "sexo": "M",
        "ln": 5000,
        "sv": 2800,
        "nv": 2100,
        "ns": 100,
    }
    # Add an X gender row (should be dropped at municipal level)
    x_row = {
        "cvegeo": "01001",
        "cve_ent": "01",
        "year": 2024,
        "election": "DIP_FED",
        "age_group": "65+",
        "sexo": "X",
        "ln": 15,
        "sv": 8,
        "nv": 7,
        "ns": 0,
    }
    # Add a small cell row (ln < 10, should be suppressed)
    small_cell_row = {
        "cvegeo": "01002",
        "cve_ent": "01",
        "year": 2024,
        "election": "DIP_FED",
        "age_group": "18-24",
        "sexo": "H",
        "ln": 8,
        "sv": 4,
        "nv": 4,
        "ns": 0,
    }
    profile_df = pd.DataFrame([base_profile_row] * (n_profile_rows - 2) + [x_row, small_cell_row])
    write_parquet(profile_df, build_dir / "ccpc_profile_mun.parquet")

    # 6. metrics.json
    metrics = {
        "target_year": 2027,
        "train_years": [2015, 2018, 2021, 2024],
        "selected_model": "persist_l1",
        "national_level_assumption": 51.84,
        "offset_pp": 0.85,
        "calibration_pp": 0.85,
        "structural_r2": 0.55,
        "structural_r2_within_state": 0.27,
        "structural_r2_state_cv": -0.04,
        "between_state_share": 0.47,
        "candidates": [
            {"name": "persist_l1", "mae_avg": 4.12, "spearman_avg": 0.82, "top20_hit_avg": 0.65},
            {"name": "mean_l1_l2", "mae_avg": 4.35, "spearman_avg": 0.80, "top20_hit_avg": 0.62},
        ],
        "backtests": [
            {
                "train_until": 2018,
                "test_year": 2021,
                "mae_pp": 3.2,
                "rmse_pp": 4.1,
                "spearman": 0.75,
                "n": 3,
                "baseline_mae_pp": 4.8,
            },
            {
                "train_until": 2021,
                "test_year": 2024,
                "mae_pp": 4.4,
                "rmse_pp": 5.2,
                "spearman": 0.84,
                "n": 3,
                "baseline_mae_pp": 5.7,
            },
        ],
        "coefficients": [
            {"key": "pct_18_24", "label": "Jóvenes de 18 a 24 años", "coef_pp_per_sd": -3.5},
            {"key": "graproes", "label": "Escolaridad promedio", "coef_pp_per_sd": 2.1},
        ],
        "lambda": 10.0,
        "sigma_pp": 3.8,
        "generated_at": "2026-10-05T09:00:00Z",
    }
    (build_dir / "metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")


def create_synthetic_geo_data(geo_dir: Path) -> None:
    """Create minimal valid geojson files: 2 states in states.json, 2 mun files in mun/."""
    mun_dir = geo_dir / "mun"
    mun_dir.mkdir(parents=True, exist_ok=True)

    dummy_poly = {
        "type": "Polygon",
        "coordinates": [[[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0], [0.0, 0.0]]],
    }

    # states.json
    states_fc = {
        "type": "FeatureCollection",
        "features": [
            {"type": "Feature", "properties": {"id": "01", "name": "Aguascalientes"}, "geometry": dummy_poly},
            {"type": "Feature", "properties": {"id": "02", "name": "Baja California"}, "geometry": dummy_poly},
        ],
    }
    (geo_dir / "states.json").write_text(json.dumps(states_fc), encoding="utf-8")

    # mun/01.json (2 municipalities)
    mun_01_fc = {
        "type": "FeatureCollection",
        "features": [
            {"type": "Feature", "properties": {"id": "01001", "ent": "01", "name": "Aguascalientes"}, "geometry": dummy_poly},
            {"type": "Feature", "properties": {"id": "01002", "ent": "01", "name": "Asientos"}, "geometry": dummy_poly},
        ],
    }
    (mun_dir / "01.json").write_text(json.dumps(mun_01_fc), encoding="utf-8")

    # mun/02.json (1 municipality)
    mun_02_fc = {
        "type": "FeatureCollection",
        "features": [
            {"type": "Feature", "properties": {"id": "02001", "ent": "02", "name": "Ensenada"}, "geometry": dummy_poly},
        ],
    }
    (mun_dir / "02.json").write_text(json.dumps(mun_02_fc), encoding="utf-8")


def test_export_deliverables_with_geo(tmp_path):
    """Verify export with synthetic build and geo data produces all artifacts with expected properties."""
    build_dir = tmp_path / "build"
    geo_dir = tmp_path / "geo"
    out_dir = tmp_path / "deliverables"

    create_synthetic_build_data(build_dir, n_profile_rows=50005)
    create_synthetic_geo_data(geo_dir)

    exit_code = export_deliverables(build_dir=build_dir, geo_dir=geo_dir, out_dir=out_dir)
    assert exit_code == 0

    # 1. Verify municipal GeoJSON
    mun_geo_path = out_dir / "mapa_escenarios_municipal.geojson"
    assert mun_geo_path.is_file()
    mun_geo = json.loads(mun_geo_path.read_text(encoding="utf-8"))
    assert mun_geo["type"] == "FeatureCollection"
    assert len(mun_geo["features"]) == 3

    for feat in mun_geo["features"]:
        props = feat["properties"]
        for p in EXPECTED_GEOJSON_PROPS:
            assert p in props, f"Missing property {p} in municipal GeoJSON"
        assert props["category_base"] in ["verde", "amarillo", "naranja", "rojo", "sin_dato"]
        assert props["top_driver"] != ""

    # Verify specific municipality properties
    feat_01001 = next(f for f in mun_geo["features"] if f["properties"]["id"] == "01001")
    p01001 = feat_01001["properties"]
    assert p01001["category_base"] in ["verde", "amarillo", "naranja", "rojo", "sin_dato"]
    assert p01001["pred_dev_pp"] == 4.16
    assert p01001["last_reliable_year"] == 2024
    assert p01001["gov_2027"] == 1  # 01 has gubernatorial election in 2027
    assert p01001["pct_ln_18_34"] == 0.35
    assert p01001["part_18_34"] == 0.48
    assert p01001["top_driver"] == "Jóvenes de 18 a 24 años"

    # Verify fallback_model in 01002
    feat_01002 = next(f for f in mun_geo["features"] if f["properties"]["id"] == "01002")
    assert feat_01002["properties"]["fallback_model"] == "mean_l1_l2"

    # 2. Verify state GeoJSON
    st_geo_path = out_dir / "mapa_escenarios_estatal.geojson"
    assert st_geo_path.is_file()
    st_geo = json.loads(st_geo_path.read_text(encoding="utf-8"))
    assert len(st_geo["features"]) == 2

    # 3. Verify Excel workbook (all sheets, LEEME and diccionario not empty)
    xlsx_path = out_dir / "base_datos_atalaya.xlsx"
    assert xlsx_path.is_file()
    wb = openpyxl.load_workbook(xlsx_path)
    for sh in EXPECTED_SHEETS:
        assert sh in wb.sheetnames, f"Missing sheet {sh} in Excel deliverable"

    # 4. Verify CSV files in csv/ with UTF-8 BOM
    csv_dir = out_dir / "csv"
    assert csv_dir.is_dir()
    for sh in EXPECTED_SHEETS:
        csv_file = csv_dir / f"{sh}.csv"
        assert csv_file.is_file(), f"Missing CSV for {sh}"
        raw_bytes = csv_file.read_bytes()
        assert raw_bytes.startswith(b"\xef\xbb\xbf"), f"CSV {sh} does not have UTF-8 BOM"


def test_unreliable_participation_exported_empty(tmp_path):
    """Verify participation with reliable=False is exported empty/null, never 0."""
    build_dir = tmp_path / "build"
    out_dir = tmp_path / "deliverables"

    create_synthetic_build_data(build_dir, n_profile_rows=50005)
    exit_code = export_deliverables(build_dir=build_dir, out_dir=out_dir)
    assert exit_code == 0

    # Read participacion_historica CSV
    part_csv = out_dir / "csv/participacion_historica.csv"
    assert part_csv.is_file()
    df_part = pd.read_csv(part_csv, dtype={"id": str, "cve_ent": str}, encoding="utf-8-sig")

    assert "ns_rate" in df_part.columns
    assert "reliable" in df_part.columns
    assert "low_confidence" in df_part.columns
    assert "participacion" in df_part.columns

    # Check 02001 (unreliable)
    unrel_rows = df_part[df_part["id"].astype(str).str.zfill(5) == "02001"]
    assert len(unrel_rows) > 0
    for _, r in unrel_rows.iterrows():
        assert bool(r["reliable"]) is False
        # Must be NaN / empty, NEVER 0.0 or 0
        assert pd.isna(r["participacion"]) or str(r["participacion"]).strip() == ""

    # Check 01001 (reliable)
    rel_rows = df_part[df_part["id"].astype(str).str.zfill(5) == "01001"]
    dip_rel = rel_rows[rel_rows["election"] == "DIP_FED"]
    assert len(dip_rel) > 0
    for _, r in dip_rel.iterrows():
        assert bool(r["reliable"]) is True
        assert pd.notna(r["participacion"])
        assert float(r["participacion"]) > 0.5


def test_semaforo_ponderado_sheet_and_csv(tmp_path):
    """Verify semaforo_ponderado sheet and CSV are created with n_municipios and lista_nominal."""
    build_dir = tmp_path / "build"
    out_dir = tmp_path / "deliverables"

    create_synthetic_build_data(build_dir, n_profile_rows=50005)
    exit_code = export_deliverables(build_dir=build_dir, out_dir=out_dir)
    assert exit_code == 0

    # 1. In Excel
    wb = openpyxl.load_workbook(out_dir / "base_datos_atalaya.xlsx")
    assert "semaforo_ponderado" in wb.sheetnames
    ws = wb["semaforo_ponderado"]
    headers = [cell.value for cell in ws[1]]
    expected_cols = ["scenario", "category", "n_municipios", "pct_municipios", "lista_nominal", "pct_lista_nominal"]
    for ec in expected_cols:
        assert ec in headers

    # 2. In CSV
    csv_path = out_dir / "csv/semaforo_ponderado.csv"
    assert csv_path.is_file()
    df_sem = pd.read_csv(csv_path, encoding="utf-8-sig")
    assert set(df_sem["scenario"].unique()) == {"base", "intervencion", "pesimista"}
    assert set(df_sem["category"].unique()) == {"verde", "amarillo", "naranja", "rojo", "sin_dato"}

    # Base scenario totals
    base_sem = df_sem[df_sem["scenario"] == "base"]
    assert base_sem["n_municipios"].sum() == 3
    assert base_sem["lista_nominal"].sum() == 120000


def test_validation_aborts_on_small_profile(tmp_path):
    """Verify pre-validation aborts with code 2 if ccpc_profile_mun has < 50,000 rows."""
    build_dir = tmp_path / "build"
    out_dir = tmp_path / "deliverables"

    # Create synthetic build data with only 369 profile rows
    create_synthetic_build_data(build_dir, n_profile_rows=369)

    exit_code = export_deliverables(build_dir=build_dir, out_dir=out_dir, min_profile_rows=50000)
    assert exit_code == 2

    # Deliverables should NOT have been generated
    assert not (out_dir / "base_datos_atalaya.xlsx").is_file()


def test_validation_aborts_on_missing_reliable(tmp_path):
    """Verify pre-validation aborts with code 2 if participation.parquet lacks 'reliable' column."""
    build_dir = tmp_path / "build"
    out_dir = tmp_path / "deliverables"

    create_synthetic_build_data(build_dir, n_profile_rows=50005)

    # Overwrite participation.parquet removing 'reliable' column
    part_path = build_dir / "participation.parquet"
    df_part = pd.read_parquet(part_path)
    df_part_bad = df_part.drop(columns=["reliable"])
    write_parquet(df_part_bad, part_path)

    exit_code = export_deliverables(build_dir=build_dir, out_dir=out_dir)
    assert exit_code == 2

    assert not (out_dir / "base_datos_atalaya.xlsx").is_file()


def test_leeme_contents(tmp_path):
    """Verify LEEME sheet contains reliability rule, selected model, 2027 assumption, and warning."""
    build_dir = tmp_path / "build"
    out_dir = tmp_path / "deliverables"

    create_synthetic_build_data(build_dir, n_profile_rows=50005)
    exit_code = export_deliverables(build_dir=build_dir, out_dir=out_dir)
    assert exit_code == 0

    leeme_csv = out_dir / "csv/LEEME.csv"
    assert leeme_csv.is_file()
    df_leeme = pd.read_csv(leeme_csv, encoding="utf-8-sig")
    content_text = " ".join([str(x) for x in df_leeme["contenido"].dropna().tolist()])
    section_text = " ".join([str(x) for x in df_leeme["seccion"].dropna().tolist()])

    # Reliability rule
    assert "ns_rate <= 0.50" in content_text
    assert "participacion >= 0.02" in content_text

    # Selected model
    assert "persist_l1" in content_text

    # National level assumption
    assert "51.84%" in content_text

    # Comparative warning
    assert "El semáforo compara zonas entre sí; las cifras absolutas dependen del supuesto nacional." in content_text

    # Privacy and calibration
    assert "Calibración exacta de nivel" in content_text
    assert "0.85" in content_text
    assert "suprimido=True" in content_text


def test_priorizacion_sheet_and_csv(tmp_path):
    """Verify priorizacion sheet and CSV are created with top municipalities by prioridad."""
    build_dir = tmp_path / "build"
    out_dir = tmp_path / "deliverables"

    create_synthetic_build_data(build_dir, n_profile_rows=50005)
    exit_code = export_deliverables(build_dir=build_dir, out_dir=out_dir)
    assert exit_code == 0

    # 1. In Excel
    wb = openpyxl.load_workbook(out_dir / "base_datos_atalaya.xlsx")
    assert "priorizacion" in wb.sheetnames
    ws = wb["priorizacion"]
    headers = [cell.value for cell in ws[1]]
    expected_cols = [
        "prioridad", "id", "name", "cve_ent", "nom_ent",
        "lista_nominal", "abstencion_esperada", "category_base",
        "category_intervencion", "palanca_recomendada",
    ]
    for ec in expected_cols:
        assert ec in headers

    # 2. In CSV
    csv_path = out_dir / "csv/priorizacion.csv"
    assert csv_path.is_file()
    df_prio = pd.read_csv(csv_path, dtype={"id": str, "cve_ent": str}, encoding="utf-8-sig")
    assert len(df_prio) == 2  # Only 01001 and 01002 had prioridad (rojo/naranja)
    assert list(df_prio["prioridad"]) == [1, 2]
    assert df_prio["id"].tolist() == ["01001", "01002"]
    assert "palanca_recomendada" in df_prio.columns


def test_perfil_privacy_rules(tmp_path):
    """Verify privacy rules in perfil_edad_sexo: municipal 'X' dropped, small cells (ln < 10) suppressed."""
    build_dir = tmp_path / "build"
    out_dir = tmp_path / "deliverables"

    create_synthetic_build_data(build_dir, n_profile_rows=50005)
    exit_code = export_deliverables(build_dir=build_dir, out_dir=out_dir)
    assert exit_code == 0

    csv_path = out_dir / "csv/perfil_edad_sexo.csv"
    assert csv_path.is_file()
    df_perfil = pd.read_csv(csv_path, dtype={"cvegeo": str, "cve_ent": str}, encoding="utf-8-sig")

    assert "suprimido" in df_perfil.columns

    # Check nonbinary 'X' was dropped (all rows are municipal)
    x_rows = df_perfil[df_perfil["sexo"].astype(str).str.upper() == "X"]
    assert len(x_rows) == 0

    # Check small cell row (cvegeo 01002 had ln = 8)
    small_rows = df_perfil[df_perfil["cvegeo"] == "01002"]
    assert len(small_rows) > 0
    for _, r in small_rows.iterrows():
        assert bool(r["suprimido"]) is True
        assert pd.isna(r["ln"])
        assert pd.isna(r["sv"])
        assert pd.isna(r["participacion"])


def test_export_new_model_columns(tmp_path):
    """Verify vulnerability_pp, abstencion_esperada, prioridad, and r_* in municipios and estados."""
    build_dir = tmp_path / "build"
    out_dir = tmp_path / "deliverables"

    create_synthetic_build_data(build_dir, n_profile_rows=50005)
    exit_code = export_deliverables(build_dir=build_dir, out_dir=out_dir)
    assert exit_code == 0

    df_mun = pd.read_csv(out_dir / "csv/municipios.csv", dtype={"id": str, "cve_ent": str}, encoding="utf-8-sig")
    df_st = pd.read_csv(out_dir / "csv/estados.csv", dtype={"id": str}, encoding="utf-8-sig")

    for col in ["vulnerability_pp", "abstencion_esperada", "prioridad", "r_abs", "r_vuln", "r_trend", "r_vol"]:
        assert col in df_mun.columns, f"Missing {col} in municipios.csv"
        assert col in df_st.columns, f"Missing {col} in estados.csv"

    # Check values for 01001
    r_01001 = df_mun[df_mun["id"] == "01001"].iloc[0]
    assert r_01001["abstencion_esperada"] == 22000
    assert r_01001["prioridad"] == 1
    assert r_01001["vulnerability_pp"] == -1.2
    assert r_01001["r_abs"] == 0.6


def test_export_dictionary_and_leeme_branding():
    """Verify Atalaya Electoral branding in LEEME and dictionary dataframes."""
    df_leeme = create_leeme_dataframe({})
    proj_row = df_leeme[df_leeme["seccion"] == "PROYECTO"]
    assert len(proj_row) == 1
    assert "Atalaya Electoral" in proj_row.iloc[0]["contenido"]

    df_dic = create_dictionary_dataframe()
    fuentes = df_dic["fuente"].tolist()
    assert "Atalaya Electoral · Modelo" in fuentes
    assert "Atalaya Electoral · Priorización" in fuentes
    assert "Atalaya Electoral · Reglas" in fuentes
    # Old bare ATALAYA prefixes should not be present
    assert "ATALAYA" not in fuentes
    assert "ATALAYA Modelo" not in fuentes
    assert "ATALAYA Priorización" not in fuentes

