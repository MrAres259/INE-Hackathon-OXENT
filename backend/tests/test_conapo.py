"""Unit tests for CONAPO IMM 2020 ingestion module."""

from __future__ import annotations

from pathlib import Path
import pytest

from atalaya.ingest.conapo import (
    CONAPO_OUTPUT_COLUMNS,
    normalize_gm,
    process_conapo,
)

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures" / "conapo"


def test_conapo_5digit_fixture(tmp_path: Path):
    fixture_file = FIXTURES_DIR / "imm_5digit.csv"
    assert fixture_file.is_file()

    out_file = tmp_path / "conapo_mun.parquet"
    df = process_conapo(raw_path=fixture_file, out_path=out_file)

    assert out_file.is_file()
    assert list(df.columns) == CONAPO_OUTPUT_COLUMNS
    assert len(df) == 3

    # Check 5-digit cvegeos
    cvegeos = df["cvegeo"].tolist()
    assert cvegeos == ["01001", "07101", "07102"]

    # Check calculations: ANALF 12.5 -> 0.125
    row_07102 = df[df["cvegeo"] == "07102"].iloc[0]
    assert row_07102["pct_analfabeta"] == pytest.approx(0.125, rel=1e-4)
    assert row_07102["pct_po2sm"] == pytest.approx(0.605, rel=1e-4)
    assert row_07102["im_2020"] == pytest.approx(0.45, rel=1e-4)
    assert row_07102["gm_2020"] == "Muy alto"

    # Check GM normalization
    assert df.loc[df["cvegeo"] == "01001", "gm_2020"].iloc[0] == "Muy bajo"
    assert df.loc[df["cvegeo"] == "07101", "gm_2020"].iloc[0] == "Bajo"


def test_conapo_3digit_fixture(tmp_path: Path):
    fixture_file = FIXTURES_DIR / "imm_3digit.csv"
    assert fixture_file.is_file()

    out_file = tmp_path / "conapo_mun.parquet"
    df = process_conapo(raw_path=fixture_file, out_path=out_file)

    assert out_file.is_file()
    assert list(df.columns) == CONAPO_OUTPUT_COLUMNS
    assert len(df) == 3

    # Check 5-digit cvegeos combined from CVE_ENT and CVE_MUN
    cvegeos = df["cvegeo"].tolist()
    assert cvegeos == ["01001", "07101", "07102"]

    assert df.loc[df["cvegeo"] == "01001", "gm_2020"].iloc[0] == "Muy bajo"
    assert df.loc[df["cvegeo"] == "07101", "gm_2020"].iloc[0] == "Medio"
    assert df.loc[df["cvegeo"] == "07102", "gm_2020"].iloc[0] == "Alto"


def test_normalize_gm_helper():
    assert normalize_gm("Muy bajo") == "Muy bajo"
    assert normalize_gm("MUY BAJO") == "Muy bajo"
    assert normalize_gm("muy alto") == "Muy alto"
    assert normalize_gm("ALTO") == "Alto"
    assert normalize_gm("Medio") == "Medio"
    assert normalize_gm("bajo") == "Bajo"


def test_conapo_missing_file(tmp_path: Path):
    empty_dir = tmp_path / "empty_conapo"
    empty_dir.mkdir()
    out_file = tmp_path / "conapo_mun.parquet"

    df = process_conapo(raw_path=empty_dir, out_path=out_file)
    assert out_file.is_file()
    assert df.empty
    assert list(df.columns) == CONAPO_OUTPUT_COLUMNS
