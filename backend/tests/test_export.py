"""Tests for ATALAYA export module."""

import json
from pathlib import Path

import openpyxl
import pandas as pd
import pytest

from atalaya.export import export_deliverables
from atalaya.ingest.common import write_parquet


EXPECTED_GEOJSON_PROPS = [
    "id",
    "ent",
    "name",
    "lista_nominal",
    "last_participation",
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
]

EXPECTED_SHEETS = [
    "LEEME",
    "diccionario",
    "municipios",
    "estados",
    "participacion_historica",
    "perfil_edad_sexo",
    "drivers",
    "recomendaciones",
    "metricas_modelo",
]


def create_synthetic_build_data(build_dir: Path) -> None:
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
            "last_participation": 0.58,
            "pred_participation": 0.56,
            "pred_abstention": 0.44,
            "pred_low": 0.40,
            "pred_high": 0.48,
            "trend_pp": -1.2,
            "volatility_pp": 2.5,
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
            "last_participation": 0.52,
            "pred_participation": 0.50,
            "pred_abstention": 0.50,
            "pred_low": 0.45,
            "pred_high": 0.55,
            "trend_pp": -2.0,
            "volatility_pp": 3.0,
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
            "last_participation": 0.45,
            "pred_participation": 0.46,
            "pred_abstention": 0.54,
            "pred_low": 0.49,
            "pred_high": 0.59,
            "trend_pp": 0.5,
            "volatility_pp": 1.8,
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

    # 3. participation.parquet
    part_rows = []
    for u_id, ent in [("01001", "01"), ("01002", "01"), ("02001", "02")]:
        part_rows.append({
            "cvegeo": u_id,
            "cve_ent": ent,
            "year": 2024,
            "election": "DIP_FED",
            "lista_nominal": 50000,
            "votos_totales": 28000,
            "nv": 21000,
            "ns": 1000,
            "participacion": 0.5714,
        })
        part_rows.append({
            "cvegeo": u_id,
            "cve_ent": ent,
            "year": 2025,
            "election": "PJF",
            "lista_nominal": 50000,
            "votos_totales": 9000,
            "nv": 40000,
            "ns": 1000,
            "participacion": 0.1837,
        })
    write_parquet(pd.DataFrame(part_rows), build_dir / "participation.parquet")

    # 4. ccpc_profile_mun.parquet
    profile_rows = []
    for u_id, ent in [("01001", "01"), ("01002", "01"), ("02001", "02")]:
        profile_rows.append({
            "cvegeo": u_id,
            "cve_ent": ent,
            "year": 2024,
            "election": "DIP_FED",
            "age_group": "18-24",
            "sexo": "M",
            "ln": 5000,
            "sv": 2800,
            "nv": 2100,
            "ns": 100,
            "participacion": 0.5714,
        })
    write_parquet(pd.DataFrame(profile_rows), build_dir / "ccpc_profile_mun.parquet")

    # 5. metrics.json
    metrics = {
        "target_year": 2027,
        "train_years": [2015, 2018, 2021, 2024],
        "backtests": [
            {
                "train_until": 2018,
                "test_year": 2021,
                "mae_pp": 3.2,
                "rmse_pp": 4.1,
                "spearman": 0.75,
                "n": 3,
                "baseline_mae_pp": 4.8,
            }
        ],
        "coefficients": [
            {"key": "pct_18_24", "label": "Jóvenes de 18 a 24 años", "coef_pp_per_sd": -3.5},
            {"key": "graproes", "label": "Escolaridad promedio", "coef_pp_per_sd": 2.1},
        ],
        "forecast_coefficients": [
            {"key": "lag1", "label": "Participación t-3", "coef_pp_per_sd": 4.5},
        ],
        "structural_r2": 0.55,
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

    create_synthetic_build_data(build_dir)
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
    assert p01001["category_base"] == "verde"
    assert p01001["top_driver"] == "Jóvenes de 18 a 24 años"
    assert p01001["risk_score_base"] is not None

    # 2. Verify state GeoJSON
    st_geo_path = out_dir / "mapa_escenarios_estatal.geojson"
    assert st_geo_path.is_file()
    st_geo = json.loads(st_geo_path.read_text(encoding="utf-8"))
    assert st_geo["type"] == "FeatureCollection"
    assert len(st_geo["features"]) == 2
    for feat in st_geo["features"]:
        props = feat["properties"]
        assert "id" in props
        assert "name" in props
        assert "category_base" in props
        assert "top_driver" in props

    # 3. Verify Excel workbook (all sheets, LEEME and diccionario not empty)
    xlsx_path = out_dir / "base_datos_atalaya.xlsx"
    assert xlsx_path.is_file()
    wb = openpyxl.load_workbook(xlsx_path)
    for sh in EXPECTED_SHEETS:
        assert sh in wb.sheetnames, f"Missing sheet {sh} in Excel deliverable"

    ws_leeme = wb["LEEME"]
    assert ws_leeme.max_row > 5
    ws_dic = wb["diccionario"]
    assert ws_dic.max_row > 10

    ws_mun = wb["municipios"]
    assert ws_mun.max_row == 4  # 1 header + 3 municipal rows

    ws_st = wb["estados"]
    assert ws_st.max_row == 3  # 1 header + 2 state rows

    # 4. Verify CSV files in csv/ with UTF-8 BOM
    csv_dir = out_dir / "csv"
    assert csv_dir.is_dir()
    for sh in EXPECTED_SHEETS:
        csv_file = csv_dir / f"{sh}.csv"
        assert csv_file.is_file(), f"Missing CSV for {sh}"
        raw_bytes = csv_file.read_bytes()
        assert raw_bytes.startswith(b"\xef\xbb\xbf"), f"CSV {sh} does not have UTF-8 BOM"
        df_csv = pd.read_csv(csv_file, encoding="utf-8-sig")
        assert len(df_csv) > 0

    # 5. Verify semaforo_resumen.csv
    sem_path = out_dir / "semaforo_resumen.csv"
    assert sem_path.is_file()
    sem_raw = sem_path.read_bytes()
    assert sem_raw.startswith(b"\xef\xbb\xbf")
    sem_df = pd.read_csv(sem_path, encoding="utf-8-sig")
    assert set(sem_df["scenario"].unique()) == {"base", "intervencion", "pesimista"}
    assert set(sem_df["category"].unique()) == {"verde", "amarillo", "naranja", "rojo", "sin_dato"}


def test_export_deliverables_without_geo(tmp_path):
    """Verify export without geo directory succeeds and exports XLSX, CSVs, and semaforo_resumen."""
    build_dir = tmp_path / "build"
    empty_geo_dir = tmp_path / "empty_geo"
    out_dir = tmp_path / "deliverables_no_geo"

    create_synthetic_build_data(build_dir)

    exit_code = export_deliverables(build_dir=build_dir, geo_dir=empty_geo_dir, out_dir=out_dir)
    assert exit_code == 0

    # GeoJSON files must not be present
    assert not (out_dir / "mapa_escenarios_municipal.geojson").is_file()
    assert not (out_dir / "mapa_escenarios_estatal.geojson").is_file()

    # XLSX and CSVs must be present
    xlsx_path = out_dir / "base_datos_atalaya.xlsx"
    assert xlsx_path.is_file()
    wb = openpyxl.load_workbook(xlsx_path)
    for sh in EXPECTED_SHEETS:
        assert sh in wb.sheetnames

    sem_path = out_dir / "semaforo_resumen.csv"
    assert sem_path.is_file()
