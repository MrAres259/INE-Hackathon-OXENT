"""Unit tests for INEGI ITER ingestion module."""

from __future__ import annotations

from pathlib import Path
import numpy as np
import pandas as pd
import pytest

from atalaya.ingest.inegi_iter import (
    ITER_OUTPUT_COLUMNS,
    process_inegi_iter,
)

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures" / "inegi"


def test_inegi_iter_mini_formulas(tmp_path: Path):
    fixture_file = FIXTURES_DIR / "iter_mini.csv"
    assert fixture_file.is_file(), f"Fixture missing at {fixture_file}"

    out_file = tmp_path / "inegi_mun.parquet"
    df = process_inegi_iter(raw_path=fixture_file, out_path=out_file)

    assert out_file.is_file()
    assert list(df.columns) == ITER_OUTPUT_COLUMNS

    # Exclusions: exactly 3 municipal rows, no national or state totals
    assert len(df) == 3
    cvegeos = set(df["cvegeo"].tolist())
    assert cvegeos == {"01001", "07101", "07102"}
    assert "00000" not in cvegeos
    assert "01000" not in cvegeos
    assert "07000" not in cvegeos

    # Test row 01001 (Aguascalientes)
    row_01001 = df[df["cvegeo"] == "01001"].iloc[0]
    assert row_01001["cve_ent"] == "01"
    assert row_01001["cve_mun"] == "001"
    assert row_01001["nom_ent"] == "Aguascalientes"
    assert row_01001["nom_mun"] == "Aguascalientes"
    assert row_01001["pob_tot"] == 100000
    assert row_01001["pob_18ymas"] == 70000
    assert row_01001["pct_18_24"] == pytest.approx(14000 / 70000, rel=1e-4)
    assert row_01001["pct_65ymas"] == pytest.approx(7000 / 70000, rel=1e-4)
    assert row_01001["graproes"] == pytest.approx(10.5, rel=1e-4)
    assert row_01001["pct_hli"] == pytest.approx(500 / 95000, rel=1e-4)
    assert row_01001["pct_sin_servsalud"] == pytest.approx(15000 / 100000, rel=1e-4)
    assert row_01001["pct_internet"] == pytest.approx(20000 / 25000, rel=1e-4)
    # pct_rural: loc 0002 (1500) + 9998 (5) + 9999 (10) = 1515 / 100000
    assert row_01001["pct_rural"] == pytest.approx(1515 / 100000, rel=1e-4)

    # Test row 07101 (Tuxtla Gutiérrez)
    row_07101 = df[df["cvegeo"] == "07101"].iloc[0]
    assert row_07101["pob_tot"] == 50000
    assert row_07101["pct_rural"] == pytest.approx(2000 / 50000, rel=1e-4)

    # Test row 07102 (Tonalá) with confidential and missing values (*, N/D)
    row_07102 = df[df["cvegeo"] == "07102"].iloc[0]
    assert row_07102["pob_tot"] == 20000
    assert row_07102["pob_18ymas"] == 14000
    assert np.isnan(row_07102["pct_18_24"])  # P_18A24 was *
    assert np.isnan(row_07102["graproes"])   # GRAPROES was *
    assert np.isnan(row_07102["pct_hli"])    # P3YM_HLI was N/D
    assert np.isnan(row_07102["pct_sin_servsalud"])  # PSINDER was *
    assert row_07102["pct_internet"] == pytest.approx(2000 / 5000, rel=1e-4)
    assert row_07102["pct_rural"] == pytest.approx(1000 / 20000, rel=1e-4)


def test_inegi_iter_missing_file(tmp_path: Path):
    empty_raw_dir = tmp_path / "empty_raw"
    empty_raw_dir.mkdir()
    out_file = tmp_path / "inegi_mun.parquet"

    df = process_inegi_iter(raw_path=empty_raw_dir, out_path=out_file)
    assert out_file.is_file()
    assert df.empty
    assert list(df.columns) == ITER_OUTPUT_COLUMNS


def test_inegi_iter_zip_and_usecols(tmp_path: Path):
    import zipfile
    zip_path = tmp_path / "iter_00_cpv2020_csv.zip"
    mini_csv = FIXTURES_DIR / "iter_mini.csv"
    with open(mini_csv, "r", encoding="utf-8") as f:
        content = f.read()

    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("iter_00_cpv2020/catalogos/tam_loc.csv", "col1,col2\n1,2\n")
        zf.writestr("iter_00_cpv2020/conjunto_de_datos/iter_00CSV20.csv", content)

    out_file = tmp_path / "inegi_mun.parquet"
    df = process_inegi_iter(raw_path=zip_path, out_path=out_file)
    assert out_file.is_file()
    assert len(df) == 3
    assert "01001" in df["cvegeo"].values

