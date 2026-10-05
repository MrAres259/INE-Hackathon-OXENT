"""Unit tests for municipal features assembly module."""

from __future__ import annotations

from pathlib import Path
import numpy as np
import pandas as pd
import pytest

from atalaya.config import SEED_DIR
from atalaya.ingest.features import (
    FEATURES_COLUMNS,
    process_features,
)


def test_features_with_geo_catalog_new_municipality(tmp_path: Path):
    # Setup mock geo catalog with 2 existing municipalities and 1 new post-2020 municipality
    geo_catalog_csv = tmp_path / "geo_mun_catalog.csv"
    geo_df = pd.DataFrame({
        "cvegeo": ["01001", "07101", "02007"],
        "cve_ent": ["01", "07", "02"],
        "cve_mun": ["001", "101", "007"],
        "name": ["Aguascalientes", "Tuxtla Gutiérrez", "San Felipe"],
    })
    geo_df.to_csv(geo_catalog_csv, index=False, encoding="utf-8")

    # Inegi table without 02007
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

    # Conapo table without 02007
    conapo_df = pd.DataFrame({
        "cvegeo": ["01001", "07101"],
        "nom_mun_conapo": ["Aguascalientes", "Tuxtla Gutiérrez"],
        "pob_tot_conapo": [100000, 50000],
        "pct_analfabeta": [0.025, 0.048],
        "pct_po2sm": [0.25, 0.382],
        "im_2020": [-1.52, -0.95],
        "gm_2020": ["Muy bajo", "Bajo"],
    })
    conapo_pq = tmp_path / "conapo_mun.parquet"
    conapo_df.to_parquet(conapo_pq, index=False)

    out_feat = tmp_path / "features.parquet"
    feat_res = process_features(
        inegi_path=inegi_pq,
        conapo_path=conapo_pq,
        geo_catalog_path=geo_catalog_csv,
        states_path=SEED_DIR / "states.csv",
        out_path=out_feat,
    )

    assert out_feat.is_file()
    assert list(feat_res.columns) == FEATURES_COLUMNS
    assert len(feat_res) == 3

    # Check new_since_2020 flag
    row_01001 = feat_res[feat_res["cvegeo"] == "01001"].iloc[0]
    assert row_01001["new_since_2020"] is False or row_01001["new_since_2020"] == False
    assert row_01001["pob_tot"] == 100000

    row_02007 = feat_res[feat_res["cvegeo"] == "02007"].iloc[0]
    assert row_02007["new_since_2020"] is True or row_02007["new_since_2020"] == True
    assert row_02007["nom_mun"] == "San Felipe"
    assert row_02007["nom_ent"] == "Baja California"
    assert pd.isna(row_02007["pob_tot"])
    assert np.isnan(row_02007["pct_18_24"])
    assert np.isnan(row_02007["pct_internet"])
    assert np.isnan(row_02007["pct_analfabeta"])
    assert pd.isna(row_02007["gm_2020"])


def test_features_fallback_without_geo_catalog(tmp_path: Path):
    inegi_df = pd.DataFrame({
        "cvegeo": ["01001"],
        "cve_ent": ["01"],
        "cve_mun": ["001"],
        "nom_ent": ["Aguascalientes"],
        "nom_mun": ["Aguascalientes"],
        "pob_tot": [100000],
        "pob_18ymas": [70000],
        "pct_18_24": [0.20],
        "pct_65ymas": [0.10],
        "graproes": [10.5],
        "pct_hli": [0.01],
        "pct_sin_servsalud": [0.15],
        "pct_internet": [0.80],
        "pct_rural": [0.015],
    })
    inegi_pq = tmp_path / "inegi_mun.parquet"
    inegi_df.to_parquet(inegi_pq, index=False)

    out_feat = tmp_path / "features.parquet"
    feat_res = process_features(
        inegi_path=inegi_pq,
        conapo_path=tmp_path / "missing_conapo.parquet",
        geo_catalog_path=tmp_path / "missing_geo_catalog.csv",
        states_path=SEED_DIR / "states.csv",
        out_path=out_feat,
    )

    assert out_feat.is_file()
    assert len(feat_res) == 1
    assert feat_res.iloc[0]["cvegeo"] == "01001"
    assert feat_res.iloc[0]["new_since_2020"] is False or feat_res.iloc[0]["new_since_2020"] == False
