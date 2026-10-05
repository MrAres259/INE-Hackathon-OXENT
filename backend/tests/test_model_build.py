"""Tests for ATALAYA model build pipeline with relative deviations and candidate selection."""

import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from atalaya.ingest.common import write_parquet, read_parquet
from atalaya.model.build import build_model, UNITS_COLUMNS, DRIVERS_COLUMNS


def create_minimal_seeds(seed_dir: Path) -> None:
    """Create minimal states.csv, variables.csv, and concurrencia_gubernatura.csv in seed_dir."""
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

    gov_content = (
        "year,cve_ent,note\n"
        "2009,01,\n"
        "2015,01,\n"
        "2021,01,\n"
        "2027,01,\n"
    )
    (seed_dir / "concurrencia_gubernatura.csv").write_text(gov_content, encoding="utf-8")


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
    mun_pct: dict[str, float] = {}
    for m in muns:
        ent = m[:2]
        pob_tot = int(np.random.randint(15000, 80000))
        pob_18 = int(pob_tot * 0.7)
        # Mun 01001 has high youth population
        p_18_24 = 0.28 if m == "01001" else float(np.random.uniform(0.12, 0.22))
        mun_pct[m] = p_18_24
        feats_rows.append({
            "cvegeo": m,
            "cve_ent": ent,
            "cve_mun": m[2:],
            "nom_ent": "Aguascalientes" if ent == "01" else "Baja California",
            "nom_mun": f"Municipio {m}",
            "pob_tot": pob_tot,
            "pob_18ymas": pob_18,
            "pct_18_24": p_18_24,
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

    # Participation: pct_18_24 reduces participation
    years = [2009, 2012, 2015, 2018, 2021, 2024]
    part_rows = []
    for m in muns:
        ent = m[:2]
        base_p = 0.48
        m_pct = mun_pct[m]
        for yr in years:
            pres = 1 if yr in (2012, 2018, 2024) else 0
            ln = int(np.random.randint(10000, 50000))
            turnout = base_p - 1.20 * (m_pct - 0.17) + 0.10 * pres + np.random.normal(0, 0.008)
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
                "ns": 5,
            })
    part_df = pd.DataFrame(part_rows)
    write_parquet(part_df, build_dir / "participation.parquet")


def test_build_model_full_pipeline(tmp_path):
    """Test full build pipeline with relative deviations and candidate selection."""
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

    # New relative columns
    assert "pred_dev_pp" in units_df.columns
    assert "fallback_model" in units_df.columns
    assert "last_reliable_year" in units_df.columns
    assert not mun_rows["pred_dev_pp"].isna().any()
    assert (mun_rows["last_reliable_year"] == 2024).all()

    # State rows
    state_rows = units_df[units_df["level"] == "state"]
    assert len(state_rows) == 2
    assert set(state_rows["id"]) == {"01", "02"}
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

    mun_driver_counts = drivers_df[drivers_df["level"] == "mun"]["id"].value_counts()
    assert (mun_driver_counts <= 5).all()

    # 3. Verify metrics.json
    metrics_path = build_dir / "metrics.json"
    assert metrics_path.is_file()
    metrics = json.loads(metrics_path.read_text(encoding="utf-8"))
    assert metrics["target_year"] == 2027
    assert "coefficients" in metrics
    assert "forecast_coefficients" in metrics
    assert "structural_r2" in metrics
    assert metrics["lambda"] > 0
    assert metrics["sigma_pp"] > 0
    assert len(metrics["data_sources"]) == 2

    # Required relative keys in metrics.json
    assert "candidates" in metrics
    assert len(metrics["candidates"]) == 4  # persist_l1, persist_l2, mean_l1_l2, ridge
    assert "selected_model" in metrics
    assert metrics["selected_model"] in ["persist_l1", "persist_l2", "mean_l1_l2", "ridge"]
    assert "national_level_assumption" in metrics
    assert metrics["national_level_assumption"] > 0
    assert "calibration_pp" in metrics
    assert "offset_pp" in metrics
    assert metrics["calibration_pp"] == metrics["offset_pp"]
    assert "structural_r2_within_state" in metrics
    assert "structural_r2_state_cv" in metrics
    assert "between_state_share" in metrics
    assert "reliability_rule" in metrics
    assert "excluded_unreliable" in metrics
    assert "drivers_low_confidence" in metrics

    # 4. Verify exact calibration: municipal weighted participation = national_level_assumption ± 0.01 pp
    mun_preds = mun_rows.dropna(subset=["pred_participation", "lista_nominal"])
    assert len(mun_preds) > 0
    weighted_part = np.average(mun_preds["pred_participation"], weights=mun_preds["lista_nominal"])
    target_part = metrics["national_level_assumption"] / 100.0
    assert abs(weighted_part - target_part) <= 0.0001, f"Weighted participation {weighted_part*100:.4f}% deviates from assumption {target_part*100:.4f}%"

    # 5. Verify vulnerability_pp, abstencion_esperada, prioridad, and risk components
    for _, r in mun_rows.iterrows():
        if pd.notna(r["struct_pred_dev_pp"]):
            assert r["vulnerability_pp"] == pytest.approx(-r["struct_pred_dev_pp"], abs=1e-5)
        if pd.notna(r["pred_abstention"]) and pd.notna(r["lista_nominal"]):
            assert r["abstencion_esperada"] == int(round(r["pred_abstention"] * r["lista_nominal"]))
        if r["category"] in ["rojo", "naranja"]:
            assert pd.notna(r["prioridad"]) and r["prioridad"] >= 1
        else:
            assert pd.isna(r["prioridad"])
        assert 0.0 <= r["r_abs"] <= 1.0
        assert 0.0 <= r["r_vuln"] <= 1.0
        assert 0.0 <= r["r_trend"] <= 1.0
        assert 0.0 <= r["r_vol"] <= 1.0


def test_build_model_fallback_model_when_missing_lags(tmp_path):
    """Verify that a municipality missing lag2 falls back to persist_l1 and sets fallback_model."""
    build_dir = tmp_path / "build"
    seed_dir = tmp_path / "seed"
    create_minimal_seeds(seed_dir)
    create_synthetic_data(build_dir)

    # Modify participation so that municipality 01002 has data for 2024, but NOT 2021 (missing lag2)
    part_df = read_parquet(build_dir / "participation.parquet")
    part_df = part_df[~((part_df["cvegeo"] == "01002") & (part_df["year"] == 2021))]
    write_parquet(part_df, build_dir / "participation.parquet")

    exit_code = build_model(build_dir=build_dir, seed_dir=seed_dir, target_year=2027)
    assert exit_code == 0

    units_df = read_parquet(build_dir / "units.parquet")
    row_01002 = units_df[units_df["id"] == "01002"].iloc[0]

    # Selected model requires both lags, so 01002 must have fallen back to persist_l1
    assert row_01002["fallback_model"] == "persist_l1"
    assert not np.isnan(row_01002["pred_dev_pp"])
    assert not np.isnan(row_01002["pred_participation"])


def test_build_model_unreliable_municipality_sin_dato(tmp_path):
    """Verify that a municipality with all non-reliable records gets category 'sin_dato' and NaN predictions."""
    build_dir = tmp_path / "build"
    seed_dir = tmp_path / "seed"
    create_minimal_seeds(seed_dir)
    create_synthetic_data(build_dir)

    # For 01003, set ns = lista_nominal (ns_rate = 1.0 -> completely unreliable) across all years
    part_df = read_parquet(build_dir / "participation.parquet")
    mask_01003 = part_df["cvegeo"] == "01003"
    part_df.loc[mask_01003, "ns"] = part_df.loc[mask_01003, "lista_nominal"]
    write_parquet(part_df, build_dir / "participation.parquet")

    exit_code = build_model(build_dir=build_dir, seed_dir=seed_dir, target_year=2027)
    assert exit_code == 0

    units_df = read_parquet(build_dir / "units.parquet")
    row_01003 = units_df[units_df["id"] == "01003"].iloc[0]

    assert row_01003["category"] == "sin_dato"
    assert np.isnan(row_01003["pred_dev_pp"])
    assert np.isnan(row_01003["pred_participation"])
    assert np.isnan(row_01003["pred_abstention"])
    assert np.isnan(row_01003["last_reliable_year"])
    assert np.isnan(row_01003["last_participation"])


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

    metrics_path = build_dir / "metrics.json"
    assert metrics_path.is_file()
    metrics = json.loads(metrics_path.read_text(encoding="utf-8"))
    assert metrics["candidates"] == []
    assert "national_level_assumption" in metrics


def test_build_model_with_ccpc_features(tmp_path):
    """Verify build_model with ccpc_features.parquet integrates CCPC variables."""
    build_dir = tmp_path / "build"
    seed_dir = tmp_path / "seed"
    create_minimal_seeds(seed_dir)
    create_synthetic_data(build_dir)

    muns = [f"{ent}{i:03d}" for ent in ["01", "02"] for i in range(1, 21)]
    years = [2009, 2012, 2015, 2018, 2021, 2024]
    ccpc_rows = []
    for m in muns:
        for yr in years:
            ccpc_rows.append({
                "cvegeo": m,
                "cve_ent": m[:2],
                "year": yr,
                "pct_ln_18_34": 0.32,
                "part_18_34": 0.45,
                "part_total": 0.52,
                "gap_youth_pp": -7.0,
                "gap_sexo_pp": 3.5,
                "pct_ln_rural": 0.15,
                "pct_ln_urbana": 0.85,
                "ns_rate": 0.005,
            })
    write_parquet(pd.DataFrame(ccpc_rows), build_dir / "ccpc_features.parquet")

    exit_code = build_model(build_dir=build_dir, seed_dir=seed_dir, target_year=2027)
    assert exit_code == 0

    units_df = read_parquet(build_dir / "units.parquet")
    mun_rows = units_df[units_df["level"] == "mun"]
    assert len(mun_rows) == 40
    assert mun_rows["gap_youth_pp_last"].iloc[0] == pytest.approx(-7.0)

    metrics = json.loads((build_dir / "metrics.json").read_text(encoding="utf-8"))
    source_names = [s["name"] for s in metrics["data_sources"]]
    assert "ccpc_features" in source_names
