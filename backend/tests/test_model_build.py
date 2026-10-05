"""Tests for ATALAYA model build pipeline."""

import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from atalaya.ingest.common import write_parquet, read_parquet
from atalaya.model.build import build_model, UNITS_COLUMNS, DRIVERS_COLUMNS


def create_minimal_seeds(seed_dir: Path) -> None:
    """Create minimal states.csv and variables.csv in seed_dir."""
    seed_dir.mkdir(parents=True, exist_ok=True)
    states_content = (
        "cve_ent,name,iso,aliases\n"
        "01,Aguascalientes,MX-AGU,AGS\n"
        "02,Baja California,MX-BCN,BC\n"
    )
    (seed_dir / "states.csv").write_text(states_content, encoding="utf-8")

    variables_content = (
        "key,label_es,description,source,unit,level\n"
        'participacion,Participación ciudadana,"Votos totales entre lista",INE,proporción,mun|state\n'
        'abstencion,Abstención,"1 menos participación",INE,proporción,mun|state\n'
        'pred_abstention,Abstención pronosticada 2027,"Estimada 2027",ATALAYA,proporción,mun|state\n'
        'risk_score,Índice de riesgo,"Índice 0 a 100",ATALAYA,índice,mun|state\n'
        'pct_18_24,Jóvenes de 18 a 24 años,"Proporción 18 a 24",INEGI,proporción,mun|state\n'
        'graproes,Escolaridad promedio,"Grado de escolaridad",INEGI,años,mun|state\n'
        'pct_rural,Población rural,"Proporción rural",INEGI,proporción,mun|state\n'
    )
    (seed_dir / "variables.csv").write_text(variables_content, encoding="utf-8")


def create_synthetic_data(build_dir: Path) -> None:
    """Create 40 municipalities across 2 states with DIP_FED data 2009-2024."""
    build_dir.mkdir(parents=True, exist_ok=True)
    np.random.seed(42)

    muns = []
    # 20 municipalities in state 01, 20 in state 02
    for ent in ["01", "02"]:
        for i in range(1, 21):
            muns.append(f"{ent}{i:03d}")

    # Features
    feats_rows = []
    for m in muns:
        ent = m[:2]
        pob_tot = int(np.random.randint(15000, 80000))
        pob_18 = int(pob_tot * 0.7)
        feats_rows.append({
            "cvegeo": m,
            "cve_ent": ent,
            "cve_mun": m[2:],
            "nom_ent": "Aguascalientes" if ent == "01" else "Baja California",
            "nom_mun": f"Municipio {m}",
            "pob_tot": pob_tot,
            "pob_18ymas": pob_18,
            "pct_18_24": float(np.random.uniform(0.12, 0.22)),
            "pct_65ymas": float(np.random.uniform(0.08, 0.15)),
            "graproes": float(np.random.uniform(8.0, 11.5)),
            "pct_hli": float(np.random.uniform(0.01, 0.05)),
            "pct_sin_servsalud": float(np.random.uniform(0.18, 0.35)),
            "pct_internet": float(np.random.uniform(0.50, 0.75)),
            "pct_rural": float(np.random.uniform(0.05, 0.30)),
            "pct_analfabeta": float(np.random.uniform(0.02, 0.06)),
            "pct_po2sm": float(np.random.uniform(0.25, 0.45)),
            "im_2020": float(np.random.uniform(-1.5, 0.5)),
            "gm_2020": "Bajo",
        })
    feats_df = pd.DataFrame(feats_rows)
    write_parquet(feats_df, build_dir / "features.parquet")

    # Participation
    years = [2009, 2012, 2015, 2018, 2021, 2024]
    part_rows = []
    for m in muns:
        ent = m[:2]
        base_p = 0.48 if ent == "01" else 0.44
        for yr in years:
            pres = 1 if yr in (2012, 2018, 2024) else 0
            ln = int(np.random.randint(10000, 50000))
            turnout = base_p + 0.10 * pres + np.random.normal(0, 0.02)
            turnout = max(0.20, min(0.85, turnout))
            votos = int(round(ln * turnout))
            part_rows.append({
                "cvegeo": m,
                "cve_ent": ent,
                "year": yr,
                "election": "DIP_FED",
                "lista_nominal": ln,
                "votos_totales": votos,
                "participacion": round(votos / ln, 4),
            })
    part_df = pd.DataFrame(part_rows)
    write_parquet(part_df, build_dir / "participation.parquet")


def test_build_model_full_pipeline(tmp_path):
    """Test full build pipeline with 40 municipalities across 2 states."""
    build_dir = tmp_path / "build"
    seed_dir = tmp_path / "seed"
    create_minimal_seeds(seed_dir)
    create_synthetic_data(build_dir)

    exit_code = build_model(build_dir=build_dir, seed_dir=seed_dir, target_year=2027)
    assert exit_code == 0

    # 1. Verify units.parquet
    units_path = build_dir / "units.parquet"
    assert units_path.is_file()
    units_df = read_parquet(units_path)
    assert len(units_df) == 42  # 40 municipalities + 2 states

    # Check columns
    for col in UNITS_COLUMNS:
        assert col in units_df.columns, f"Missing column {col} in units.parquet"

    # Municipal rows
    mun_rows = units_df[units_df["level"] == "mun"]
    assert len(mun_rows) == 40
    assert (mun_rows["pred_participation"] >= 0.0).all()
    assert (mun_rows["pred_participation"] <= 1.0).all()
    assert (mun_rows["pred_abstention"] >= 0.0).all()
    assert (mun_rows["pred_abstention"] <= 1.0).all()
    assert (mun_rows["pred_low"] <= mun_rows["pred_high"]).all()

    # State rows
    state_rows = units_df[units_df["level"] == "state"]
    assert len(state_rows) == 2
    assert set(state_rows["id"]) == {"01", "02"}
    assert set(state_rows["name"]) == {"Aguascalientes", "Baja California"}
    assert (state_rows["pob_tot"] > 0).all()
    assert (state_rows["lista_nominal"] > 0).all()
    assert (state_rows["pred_participation"] > 0.0).all()

    # Risk scores and categories
    assert "risk_score" in units_df.columns
    assert "category" in units_df.columns
    valid_categories = {"verde", "amarillo", "naranja", "rojo", "sin_dato"}
    assert set(units_df["category"].unique()).issubset(valid_categories)
    assert (mun_rows["risk_score"] >= 0.0).all()
    assert (mun_rows["risk_score"] <= 100.0).all()

    # 2. Verify drivers.parquet
    drivers_path = build_dir / "drivers.parquet"
    assert drivers_path.is_file()
    drivers_df = read_parquet(drivers_path)
    for col in DRIVERS_COLUMNS:
        assert col in drivers_df.columns

    # Each municipality should have at most 5 drivers
    mun_driver_counts = drivers_df[drivers_df["level"] == "mun"]["id"].value_counts()
    assert (mun_driver_counts <= 5).all()

    # Each state should have at most 5 drivers
    state_driver_counts = drivers_df[drivers_df["level"] == "state"]["id"].value_counts()
    assert (state_driver_counts <= 5).all()

    # 3. Verify metrics.json
    metrics_path = build_dir / "metrics.json"
    assert metrics_path.is_file()
    metrics = json.loads(metrics_path.read_text(encoding="utf-8"))
    assert metrics["target_year"] == 2027
    assert len(metrics["backtests"]) == 2
    assert len(metrics["coefficients"]) > 0
    assert metrics["lambda"] > 0
    assert metrics["sigma_pp"] > 0
    assert len(metrics["data_sources"]) == 2

    # 4. Verify model.json
    model_path = build_dir / "model.json"
    assert model_path.is_file()
    model_dict = json.loads(model_path.read_text(encoding="utf-8"))
    assert "features" in model_dict
    assert "coef" in model_dict
    assert "intercept" in model_dict
    assert model_dict["target_year"] == 2027


def test_build_model_no_data_fallback(tmp_path):
    """Test build pipeline gracefully handles empty input directory."""
    build_dir = tmp_path / "empty_build"
    seed_dir = tmp_path / "seed"
    build_dir.mkdir(parents=True, exist_ok=True)
    create_minimal_seeds(seed_dir)

    exit_code = build_model(build_dir=build_dir, seed_dir=seed_dir, target_year=2027)
    assert exit_code == 0

    units_path = build_dir / "units.parquet"
    assert units_path.is_file()
    units_df = read_parquet(units_path)
    for col in UNITS_COLUMNS:
        assert col in units_df.columns

    drivers_path = build_dir / "drivers.parquet"
    assert drivers_path.is_file()
    drivers_df = read_parquet(drivers_path)
    assert len(drivers_df) == 0

    metrics_path = build_dir / "metrics.json"
    assert metrics_path.is_file()
    metrics = json.loads(metrics_path.read_text(encoding="utf-8"))
    assert metrics["backtests"] == []
