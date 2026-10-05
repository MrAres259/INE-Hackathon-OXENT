"""Unit tests for crosswalk, features integration, and seeds validation."""

from __future__ import annotations

from pathlib import Path
import pandas as pd
import pytest

from atalaya.config import SEED_DIR
from atalaya.ingest.crosswalk import (
    CROSSWALK_COLUMNS,
    PARTICIPATION_COLUMNS,
    UNMATCHED_COLUMNS,
    process_crosswalk,
    strip_variants,
)
from atalaya.ingest.features import (
    FEATURES_COLUMNS,
    process_features,
)

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures" / "crosswalk"


def test_strip_variants_helper():
    assert strip_variants("HEROICA CIUDAD DE HUAMANTLA") == "HUAMANTLA"
    assert strip_variants("HEROICA VILLA DE TEZOATLAN") == "TEZOATLAN"
    assert strip_variants("CIUDAD DE MEXICO") == "MEXICO"
    assert strip_variants("GRAL ESCOBEDO") == "GENERAL ESCOBEDO"
    assert strip_variants("STA MARIA DEL ORO") == "SANTA MARIA DEL ORO"
    assert strip_variants("STO DOMINGO") == "SANTO DOMINGO"
    assert strip_variants("DR ARROYO") == "DOCTOR ARROYO"


def test_crosswalk_pipeline_and_cases(tmp_path: Path):
    feat_csv = FIXTURES_DIR / "sample_features.csv"
    ine_csv = FIXTURES_DIR / "sample_participation_ine.csv"
    overrides_csv = FIXTURES_DIR / "sample_overrides.csv"

    # Convert features and ine fixtures to parquet for the function
    feat_df = pd.read_csv(feat_csv, dtype=str)
    # Add dummy sociodemographic columns for features.parquet
    for c in ["pob_tot", "pob_18ymas", "pct_18_24", "pct_65ymas", "graproes", "pct_hli", "pct_sin_servsalud", "pct_internet", "pct_rural", "pct_analfabeta", "pct_po2sm", "im_2020", "gm_2020"]:
        if c not in feat_df.columns:
            feat_df[c] = 0.0
    feat_pq = tmp_path / "features.parquet"
    feat_df.to_parquet(feat_pq, index=False)

    ine_df = pd.read_csv(ine_csv, dtype=str)
    ine_pq = tmp_path / "participation_ine.parquet"
    ine_df.to_parquet(ine_pq, index=False)

    out_cw = tmp_path / "crosswalk.parquet"
    out_part = tmp_path / "participation.parquet"
    out_unm = tmp_path / "crosswalk_unmatched.csv"
    out_prof = tmp_path / "ccpc_profile_mun.parquet"
    out_sec = tmp_path / "ccpc_seccion_mun.parquet"
    prof_pq = tmp_path / "ccpc_profile.parquet"
    sec_pq = tmp_path / "ccpc_seccion.parquet"

    cw_df, part_df, unm_df = process_crosswalk(
        participation_ine_path=ine_pq,
        features_path=feat_pq,
        overrides_path=overrides_csv,
        ccpc_profile_path=prof_pq,
        ccpc_seccion_path=sec_pq,
        out_crosswalk=out_cw,
        out_participation=out_part,
        out_unmatched=out_unm,
        out_profile_mun=out_prof,
        out_seccion_mun=out_sec,
    )

    assert out_cw.is_file()
    assert out_part.is_file()
    assert out_unm.is_file()

    assert list(cw_df.columns) == CROSSWALK_COLUMNS
    assert list(part_df.columns) == PARTICIPATION_COLUMNS
    assert list(unm_df.columns) == UNMATCHED_COLUMNS

    cw_map = {row["mun_norm"]: (row["cvegeo"], row["method"], row["score"]) for _, row in cw_df.iterrows()}

    # 1. Exact match
    assert "AGUASCALIENTES" in cw_map
    assert cw_map["AGUASCALIENTES"][0] == "01001"
    assert cw_map["AGUASCALIENTES"][1] == "exact"
    assert cw_map["AGUASCALIENTES"][2] == 1.0

    # 2. Accents / N (Tuxtla Gutiérrez and Tonalá in INEGI have accents, INE has normalized uppercase)
    assert "TUXTLA GUTIERREZ" in cw_map
    assert cw_map["TUXTLA GUTIERREZ"][0] == "07101"
    assert cw_map["TUXTLA GUTIERREZ"][1] == "exact"

    assert "TONALA" in cw_map
    assert cw_map["TONALA"][0] == "07102"
    assert cw_map["TONALA"][1] == "exact"

    # 3. Honorific prefix stripped ("HEROICA CIUDAD DE HUAMANTLA" -> "29012" Huamantla)
    assert "HEROICA CIUDAD DE HUAMANTLA" in cw_map
    assert cw_map["HEROICA CIUDAD DE HUAMANTLA"][0] == "29012"
    assert cw_map["HEROICA CIUDAD DE HUAMANTLA"][1] == "exact"
    assert cw_map["HEROICA CIUDAD DE HUAMANTLA"][2] == 0.95

    # 4. Token abbreviation ("GRAL ESCOBEDO" -> "19021" General Escobedo)
    assert "GRAL ESCOBEDO" in cw_map
    assert cw_map["GRAL ESCOBEDO"][0] == "19021"
    assert cw_map["GRAL ESCOBEDO"][1] == "exact"
    assert cw_map["GRAL ESCOBEDO"][2] == 0.95

    # 5. Fuzzy / variant match accepted ("AMATENANGO DE EL VALLE" -> "07010" Amatenango del Valle)
    assert "AMATENANGO DE EL VALLE" in cw_map
    assert cw_map["AMATENANGO DE EL VALLE"][0] == "07010"
    assert cw_map["AMATENANGO DE EL VALLE"][1] in ("exact", "fuzzy")
    assert cw_map["AMATENANGO DE EL VALLE"][2] >= 0.88

    # 6. Override applied ("NUEVO MUNICIPIO 2022" -> "07103" Ocosingo)
    assert "NUEVO MUNICIPIO 2022" in cw_map
    assert cw_map["NUEVO MUNICIPIO 2022"][0] == "07103"
    assert cw_map["NUEVO MUNICIPIO 2022"][1] == "override"
    assert cw_map["NUEVO MUNICIPIO 2022"][2] == 1.0

    # 7. Fuzzy ambiguous rejected ("SAN FERNANDO SUR" between San Fernando and San Fernando Chico)
    assert "SAN FERNANDO SUR" not in cw_map
    unm_norms = set(unm_df["mun_norm"].tolist())
    assert "SAN FERNANDO SUR" in unm_norms

    # 8. Unmapped appears in CSV
    assert "MUNICIPIO INEXISTENTE TOTAL" in unm_norms
    row_unm = unm_df[unm_df["mun_norm"] == "MUNICIPIO INEXISTENTE TOTAL"].iloc[0]
    assert row_unm["years"] == "2021"

    # 9. Two mun_norm mapped to the same cvegeo (07103) are summed in participation.parquet
    # OCOSINGO (lista 800, votos 400) + NUEVO MUNICIPIO 2022 (lista 200, votos 100) -> lista 1000, votos 500
    part_07103 = part_df[part_df["cvegeo"] == "07103"]
    assert len(part_07103) == 1
    assert part_07103.iloc[0]["lista_nominal"] == 1000
    assert part_07103.iloc[0]["votos_totales"] == 500
    assert part_07103.iloc[0]["participacion"] == pytest.approx(0.5, rel=1e-4)
    assert part_07103.iloc[0]["cve_ent"] == "07"


def test_features_pipeline(tmp_path: Path):
    inegi_df = pd.DataFrame({
        "cvegeo": ["01001", "07101"],
        "cve_ent": ["01", "07"],
        "cve_mun": ["001", "101"],
        "nom_ent": ["Aguascalientes", "Chiapas"],
        "nom_mun": ["Aguascalientes", "Tuxtla Gutiérrez"],
        "pob_tot": [100000, 50000],
        "pob_18ymas": [70000, 35000],
        "pct_18_24": [0.20, 0.20],
        "pct_65ymas": [0.10, 0.10],
        "graproes": [10.5, 9.8],
        "pct_hli": [0.01, 0.15],
        "pct_sin_servsalud": [0.15, 0.20],
        "pct_internet": [0.80, 0.60],
        "pct_rural": [0.015, 0.04],
    })
    inegi_pq = tmp_path / "inegi_mun.parquet"
    inegi_df.to_parquet(inegi_pq, index=False)

    # CONAPO with one additional municipality (07102) missing in ITER
    conapo_df = pd.DataFrame({
        "cvegeo": ["01001", "07101", "07102"],
        "nom_mun_conapo": ["Aguascalientes", "Tuxtla Gutiérrez", "Tonalá"],
        "pob_tot_conapo": [100000, 50000, 20000],
        "pct_analfabeta": [0.025, 0.048, 0.125],
        "pct_po2sm": [0.25, 0.382, 0.605],
        "im_2020": [-1.52, -0.95, 0.45],
        "gm_2020": ["Muy bajo", "Bajo", "Muy alto"],
    })
    conapo_pq = tmp_path / "conapo_mun.parquet"
    conapo_df.to_parquet(conapo_pq, index=False)

    out_feat = tmp_path / "features.parquet"
    feat_res = process_features(
        inegi_path=inegi_pq,
        conapo_path=conapo_pq,
        geo_catalog_path=tmp_path / "no_geo.csv",
        states_path=SEED_DIR / "states.csv",
        out_path=out_feat,
    )

    assert out_feat.is_file()
    assert list(feat_res.columns) == FEATURES_COLUMNS
    assert len(feat_res) == 3

    # Check that 07102 (missing from ITER) gets filled from conapo and states.csv
    row_07102 = feat_res[feat_res["cvegeo"] == "07102"].iloc[0]
    assert row_07102["cve_ent"] == "07"
    assert row_07102["cve_mun"] == "102"
    assert row_07102["nom_mun"] == "Tonalá"
    assert row_07102["nom_ent"] == "Chiapas"
    assert row_07102["pob_tot"] == 20000
    assert row_07102["im_2020"] == pytest.approx(0.45, rel=1e-4)


def test_seeds_structure():
    states_path = SEED_DIR / "states.csv"
    assert states_path.is_file()
    states_df = pd.read_csv(states_path, dtype=str)
    assert len(states_df) == 32
    assert set(states_df.columns) == {"cve_ent", "name", "iso", "aliases"}
    expected_ents = {f"{i:02d}" for i in range(1, 33)}
    assert set(states_df["cve_ent"].tolist()) == expected_ents

    vars_path = SEED_DIR / "variables.csv"
    assert vars_path.is_file()
    vars_df = pd.read_csv(vars_path, dtype=str)
    assert len(vars_df) >= 21
    assert set(vars_df.columns) == {"key", "label_es", "description", "source", "unit", "level"}
    expected_keys = {
        "participacion", "abstencion", "lista_nominal", "votos_totales", "pred_abstention",
        "risk_score", "category", "trend_pp", "pob_tot", "pob_18ymas", "pct_18_24",
        "pct_65ymas", "graproes", "pct_hli", "pct_sin_servsalud", "pct_internet",
        "pct_rural", "pct_analfabeta", "pct_po2sm", "im_2020", "gm_2020"
    }
    assert expected_keys.issubset(set(vars_df["key"].tolist()))


def test_crosswalk_ccpc_profile_and_seccion(tmp_path: Path):
    # Geo catalog
    geo_csv = tmp_path / "geo_mun_catalog.csv"
    pd.DataFrame({
        "cvegeo": ["01001", "07101"],
        "cve_ent": ["01", "07"],
        "cve_mun": ["001", "101"],
        "name": ["Aguascalientes", "Tuxtla Gutiérrez"],
    }).to_csv(geo_csv, index=False)

    # Participation INE with nv and ns
    ine_df = pd.DataFrame({
        "cve_ent": ["01", "07"],
        "ine_mun": [1, 101],
        "mun_name": ["Aguascalientes", "Tuxtla Gutiérrez"],
        "mun_norm": ["AGUASCALIENTES", "TUXTLA GUTIERREZ"],
        "year": [2024, 2024],
        "election": ["DIP_FED", "DIP_FED"],
        "lista_nominal": [1000, 2000],
        "votos_totales": [600, 1100],
        "participacion": [0.60, 0.55],
        "nv": [400, 900],
        "ns": [10, 20],
        "source_file": ["test.zip", "test.zip"],
    })
    ine_pq = tmp_path / "participation_ine.parquet"
    ine_df.to_parquet(ine_pq, index=False)

    # CCPC profile
    profile_df = pd.DataFrame({
        "cve_ent": ["01", "01", "07"],
        "ine_mun": [1, 1, 101],
        "mun_norm": ["AGUASCALIENTES", "AGUASCALIENTES", "TUXTLA GUTIERREZ"],
        "year": [2024, 2024, 2024],
        "election": ["DIP_FED", "DIP_FED", "DIP_FED"],
        "age_group": ["18-24", "25-34", "18-24"],
        "sexo": ["H", "M", "H"],
        "ln": [300, 400, 500],
        "sv": [180, 250, 300],
        "nv": [120, 150, 200],
        "ns": [2, 3, 5],
    })
    prof_pq = tmp_path / "ccpc_profile.parquet"
    profile_df.to_parquet(prof_pq, index=False)

    # CCPC seccion
    seccion_df = pd.DataFrame({
        "cve_ent": ["01", "07"],
        "ine_mun": [1, 101],
        "mun_norm": ["AGUASCALIENTES", "TUXTLA GUTIERREZ"],
        "seccion": [101, 201],
        "tiposec": ["U", "R"],
        "def": [1, 2],
        "year": [2024, 2024],
        "election": ["DIP_FED", "DIP_FED"],
        "ln": [500, 1000],
        "sv": [300, 600],
        "nv": [200, 400],
        "ns": [5, 10],
        "participacion": [0.60, 0.60],
    })
    sec_pq = tmp_path / "ccpc_seccion.parquet"
    seccion_df.to_parquet(sec_pq, index=False)

    out_cw = tmp_path / "crosswalk.parquet"
    out_part = tmp_path / "participation.parquet"
    out_unm = tmp_path / "crosswalk_unmatched.csv"
    out_prof = tmp_path / "ccpc_profile_mun.parquet"
    out_sec = tmp_path / "ccpc_seccion_mun.parquet"

    cw_df, part_df, unm_df = process_crosswalk(
        participation_ine_path=ine_pq,
        geo_catalog_path=geo_csv,
        ccpc_profile_path=prof_pq,
        ccpc_seccion_path=sec_pq,
        out_crosswalk=out_cw,
        out_participation=out_part,
        out_unmatched=out_unm,
        out_profile_mun=out_prof,
        out_seccion_mun=out_sec,
    )

    assert out_prof.is_file()
    assert out_sec.is_file()
    assert out_part.is_file()

    # Verify participation table contains nv and ns
    assert "nv" in part_df.columns
    assert "ns" in part_df.columns
    assert part_df.loc[part_df["cvegeo"] == "01001", "nv"].iloc[0] == 400
    assert part_df.loc[part_df["cvegeo"] == "01001", "ns"].iloc[0] == 10

    # Verify profile_mun table has cvegeo and aggregated rows
    res_prof = pd.read_parquet(out_prof)
    assert "cvegeo" in res_prof.columns
    assert set(res_prof["cvegeo"].unique()) == {"01001", "07101"}
    assert res_prof["ln"].sum() == 1200

    # Verify seccion_mun table has cvegeo
    res_sec = pd.read_parquet(out_sec)
    assert "cvegeo" in res_sec.columns
    assert set(res_sec["cvegeo"].unique()) == {"01001", "07101"}


def test_crosswalk_path_resolution_rule(tmp_path: Path):
    """Verify that when out_participation is given, all unspecified paths resolve to its parent."""
    custom_dir = tmp_path / "sub_build"
    custom_dir.mkdir(parents=True, exist_ok=True)
    out_part = custom_dir / "participation.parquet"

    # Create dummy input files
    ine_df = pd.DataFrame([{
        "cve_ent": "01",
        "ine_mun": 1,
        "mun_name": "Aguascalientes",
        "mun_norm": "AGUASCALIENTES",
        "year": 2024,
        "election": "DIP_FED",
        "lista_nominal": 1000,
        "votos_totales": 600,
        "participacion": 0.60,
        "nv": 400,
        "ns": 10,
        "source_file": "test.zip",
    }])
    ine_pq = tmp_path / "participation_ine.parquet"
    ine_df.to_parquet(ine_pq, index=False)

    feat_df = pd.DataFrame([{
        "cvegeo": "01001",
        "cve_ent": "01",
        "cve_mun": "001",
        "nom_ent": "Aguascalientes",
        "nom_mun": "Aguascalientes",
    }])
    feat_pq = tmp_path / "features.parquet"
    feat_df.to_parquet(feat_pq, index=False)

    # Call with only out_participation specified among output paths
    cw_df, part_df, unm_df = process_crosswalk(
        participation_ine_path=ine_pq,
        features_path=feat_pq,
        out_participation=out_part,
    )

    # Verify defaults resolved inside custom_dir, not BUILD_DIR
    assert (custom_dir / "crosswalk.parquet").is_file()
    assert (custom_dir / "participation.parquet").is_file()
    assert (custom_dir / "crosswalk_unmatched.csv").is_file()
    assert not cw_df.empty
    assert not part_df.empty


def test_participation_reliability_edge_cases(tmp_path: Path):
    """Verify ns_rate, reliable, and low_confidence edge cases (§11.1).

    Rules:
    - reliable = ns_rate <= 0.5 and participacion >= 0.02
    - low_confidence = 0.3 < ns_rate <= 0.5
    Edge cases:
    - ns_rate 0.5 exact -> reliable: True, low_confidence: True
    - ns_rate 0.51 -> reliable: False, low_confidence: False
    - participacion 0.01 -> reliable: False
    - participacion 0.02 exact -> reliable: True (if ns_rate <= 0.5)
    - ns_rate 0.30 exact -> low_confidence: False (must be > 0.3)
    - ns_rate 0.31 -> low_confidence: True
    """
    ine_records = [
        # 1. ns_rate = 50/100 = 0.50 exact, part = 40/(40+10) = 0.80 -> reliable=True, low_conf=True
        {"cve_ent": "01", "ine_mun": 1, "mun_name": "M1", "mun_norm": "M1", "year": 2024, "election": "DIP_FED",
         "lista_nominal": 100, "votos_totales": 40, "nv": 10, "ns": 50},
        # 2. ns_rate = 51/100 = 0.51, part = 40/(40+9) = 0.816 -> reliable=False, low_conf=False
        {"cve_ent": "01", "ine_mun": 2, "mun_name": "M2", "mun_norm": "M2", "year": 2024, "election": "DIP_FED",
         "lista_nominal": 100, "votos_totales": 40, "nv": 9, "ns": 51},
        # 3. ns_rate = 10/100 = 0.10, part = 1/(1+99) = 0.01 -> reliable=False (part < 0.02), low_conf=False
        {"cve_ent": "01", "ine_mun": 3, "mun_name": "M3", "mun_norm": "M3", "year": 2024, "election": "DIP_FED",
         "lista_nominal": 100, "votos_totales": 1, "nv": 99, "ns": 10},
        # 4. ns_rate = 10/100 = 0.10, part = 2/(2+98) = 0.02 exact -> reliable=True, low_conf=False
        {"cve_ent": "01", "ine_mun": 4, "mun_name": "M4", "mun_norm": "M4", "year": 2024, "election": "DIP_FED",
         "lista_nominal": 100, "votos_totales": 2, "nv": 98, "ns": 10},
        # 5. ns_rate = 30/100 = 0.30 exact, part = 50/(50+20) = 0.714 -> reliable=True, low_conf=False
        {"cve_ent": "01", "ine_mun": 5, "mun_name": "M5", "mun_norm": "M5", "year": 2024, "election": "DIP_FED",
         "lista_nominal": 100, "votos_totales": 50, "nv": 20, "ns": 30},
        # 6. ns_rate = 31/100 = 0.31, part = 50/(50+19) = 0.724 -> reliable=True, low_conf=True
        {"cve_ent": "01", "ine_mun": 6, "mun_name": "M6", "mun_norm": "M6", "year": 2024, "election": "DIP_FED",
         "lista_nominal": 100, "votos_totales": 50, "nv": 19, "ns": 31},
        # 7. lista_nominal = 0 -> ns_rate=NaN, part=NaN -> reliable=False, low_conf=False
        {"cve_ent": "01", "ine_mun": 7, "mun_name": "M7", "mun_norm": "M7", "year": 2024, "election": "DIP_FED",
         "lista_nominal": 0, "votos_totales": 0, "nv": 0, "ns": 0},
    ]
    ine_df = pd.DataFrame(ine_records)
    ine_pq = tmp_path / "part_ine.parquet"
    ine_df.to_parquet(ine_pq, index=False)

    feat_records = [
        {"cvegeo": f"0100{i}", "cve_ent": "01", "cve_mun": f"00{i}", "nom_ent": "Aguascalientes", "nom_mun": f"M{i}"}
        for i in range(1, 8)
    ]
    feat_pq = tmp_path / "feat.parquet"
    pd.DataFrame(feat_records).to_parquet(feat_pq, index=False)

    out_cw = tmp_path / "cw.parquet"
    out_part = tmp_path / "part.parquet"
    out_unm = tmp_path / "unm.csv"

    _, part_df, _ = process_crosswalk(
        participation_ine_path=ine_pq,
        features_path=feat_pq,
        out_crosswalk=out_cw,
        out_participation=out_part,
        out_unmatched=out_unm,
    )

    p_map = part_df.set_index("cvegeo")

    # 1. ns_rate 0.50 exact
    assert p_map.loc["01001", "ns_rate"] == pytest.approx(0.50)
    assert bool(p_map.loc["01001", "reliable"]) is True
    assert bool(p_map.loc["01001", "low_confidence"]) is True

    # 2. ns_rate 0.51
    assert p_map.loc["01002", "ns_rate"] == pytest.approx(0.51)
    assert bool(p_map.loc["01002", "reliable"]) is False
    assert bool(p_map.loc["01002", "low_confidence"]) is False

    # 3. participacion 0.01 (< 0.02)
    assert p_map.loc["01003", "participacion"] == pytest.approx(0.01)
    assert bool(p_map.loc["01003", "reliable"]) is False
    assert bool(p_map.loc["01003", "low_confidence"]) is False

    # 4. participacion 0.02 exact
    assert p_map.loc["01004", "participacion"] == pytest.approx(0.02)
    assert bool(p_map.loc["01004", "reliable"]) is True
    assert bool(p_map.loc["01004", "low_confidence"]) is False

    # 5. ns_rate 0.30 exact (not > 0.3)
    assert p_map.loc["01005", "ns_rate"] == pytest.approx(0.30)
    assert bool(p_map.loc["01005", "reliable"]) is True
    assert bool(p_map.loc["01005", "low_confidence"]) is False

    # 6. ns_rate 0.31 (> 0.3 and <= 0.5)
    assert p_map.loc["01006", "ns_rate"] == pytest.approx(0.31)
    assert bool(p_map.loc["01006", "reliable"]) is True
    assert bool(p_map.loc["01006", "low_confidence"]) is True

    # 7. lista_nominal 0
    assert pd.isna(p_map.loc["01007", "ns_rate"])
    assert bool(p_map.loc["01007", "reliable"]) is False
    assert bool(p_map.loc["01007", "low_confidence"]) is False


