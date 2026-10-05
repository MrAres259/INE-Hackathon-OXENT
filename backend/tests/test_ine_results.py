"""Tests for INE election results ingestion module (atalaya.ingest.ine_results)."""

from __future__ import annotations

from pathlib import Path
import zipfile

import numpy as np
import openpyxl
import pandas as pd
import pytest

from atalaya.ingest.common import read_parquet
from atalaya.ingest.ine_results import (
    COLUMNS_ORDER,
    create_empty_df,
    discover_files,
    ingest_ine_results,
    main,
    process_file,
)

FIXTURES_INE = Path(__file__).resolve().parent / "fixtures" / "ine"


def test_empty_df_structure():
    """Verify create_empty_df has exact §4.2 columns and expected dtypes."""
    df = create_empty_df()
    assert list(df.columns) == COLUMNS_ORDER
    assert len(df) == 0
    assert df["cve_ent"].dtype == object
    assert str(df["ine_mun"].dtype) == "Int64"
    assert df["mun_name"].dtype == object
    assert df["mun_norm"].dtype == object
    assert df["year"].dtype == np.int64
    assert df["election"].dtype == object
    assert df["lista_nominal"].dtype == np.int64
    assert df["votos_totales"].dtype == np.int64
    assert df["participacion"].dtype == np.float64
    assert df["source_file"].dtype == object


def test_process_fixture_2021_casilla():
    """Test 1: DIP_FED_2021.csv casilla level, UTF-8 with BOM, title lines, exclusions, clipping."""
    csv_file = FIXTURES_INE / "DIP_FED_2021.csv"
    assert csv_file.is_file(), "DIP_FED_2021.csv fixture must exist"

    df = process_file(csv_file, election="DIP_FED", year=2021)
    assert list(df.columns) == COLUMNS_ORDER
    # Exactly 3 valid municipalities: Tuxtla (101), San Cristóbal (102), Tapachula (103)
    assert len(df) == 3

    # Check Tuxtla Gutiérrez (101): casillas B (300/500), C1 (220/500), S1 (50/0)
    tuxtla = df[df["ine_mun"] == 101].iloc[0]
    assert tuxtla["cve_ent"] == "07"
    assert tuxtla["mun_name"] == "TUXTLA GUTIERREZ"
    assert tuxtla["mun_norm"] == "TUXTLA GUTIERREZ"
    assert tuxtla["year"] == 2021
    assert tuxtla["election"] == "DIP_FED"
    assert tuxtla["lista_nominal"] == 1000
    assert tuxtla["votos_totales"] == 570
    assert pytest.approx(tuxtla["participacion"], rel=1e-4) == 0.5700
    assert tuxtla["source_file"] == "DIP_FED_2021.csv"

    # Check San Cristóbal (102): casillas B (400/600), C1 (250/500)
    sancris = df[df["ine_mun"] == 102].iloc[0]
    assert sancris["cve_ent"] == "07"
    assert sancris["lista_nominal"] == 1100
    assert sancris["votos_totales"] == 650
    assert pytest.approx(sancris["participacion"], rel=1e-4) == (650 / 1100)

    # Check Tapachula (103): casilla B (850 votos / 700 lista) -> clipped to 1.0
    tapa = df[df["ine_mun"] == 103].iloc[0]
    assert tapa["cve_ent"] == "07"
    assert tapa["lista_nominal"] == 700
    assert tapa["votos_totales"] == 850
    assert tapa["participacion"] == 1.0

    # Verify exclusions: no foreign vote (cve_ent 0 or "EXTRANJERO") and no "TOTAL MUNICIPIO"
    assert not (df["cve_ent"] == "00").any()
    assert not df["mun_norm"].str.contains("EXTRANJERO").any()
    assert not df["mun_norm"].str.contains("TOTAL").any()


def test_process_fixture_2018_pipe():
    """Test 2: DIP_FED_2018.txt municipality level, CP1252, pipe delimited, numeric MUNICIPIO column."""
    txt_file = FIXTURES_INE / "DIP_FED_2018.txt"
    assert txt_file.is_file(), "DIP_FED_2018.txt fixture must exist"

    df = process_file(txt_file, election="DIP_FED", year=2018)
    assert list(df.columns) == COLUMNS_ORDER
    # Exactly 3 municipalities: Amecameca (10), Atlacomulco (20), Toluca (30); TOTAL ESTADO excluded
    assert len(df) == 3

    ame = df[df["ine_mun"] == 10].iloc[0]
    assert ame["cve_ent"] == "15"
    assert ame["mun_name"] == "AMECAMECA"
    assert ame["mun_norm"] == "AMECAMECA"
    assert ame["lista_nominal"] == 40000
    assert ame["votos_totales"] == 25000
    assert pytest.approx(ame["participacion"], rel=1e-4) == (25000 / 40000)

    atla = df[df["ine_mun"] == 20].iloc[0]
    assert atla["cve_ent"] == "15"
    assert atla["lista_nominal"] == 60000
    assert atla["votos_totales"] == 39000

    tol = df[df["ine_mun"] == 30].iloc[0]
    assert tol["cve_ent"] == "15"
    assert tol["lista_nominal"] == 120000
    assert tol["votos_totales"] == 75000

    assert not df["mun_norm"].str.contains("TOTAL").any()


def test_process_fixture_2015_xlsx(tmp_path: Path):
    """Test 3: Excel .xlsx with ENTIDAD as state text (no id) and MUNICIPIO with accents."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Resultados"

    # Header
    ws.append(["ENTIDAD", "MUNICIPIO", "LISTA NOMINAL", "VOTACIÓN TOTAL"])
    # Rows with accented names and text entities
    ws.append(["Chiapas", "Tuxtla Gutiérrez", 10000, 5200])
    ws.append(["Estado de México", "Toluca de Lerdo", 50000, 31000])
    ws.append(["Ciudad de México", "Coyoacán", 30000, 18000])
    ws.append(["VOTO EXTRANJERO", "EXTRANJERO", 500, 200])
    ws.append(["Chiapas", "SUBTOTAL CHIAPAS", 10000, 5200])

    xlsx_path = tmp_path / "DIP_FED_2015.xlsx"
    wb.save(xlsx_path)

    df = process_file(xlsx_path, election="DIP_FED", year=2015)
    assert list(df.columns) == COLUMNS_ORDER
    assert len(df) == 3

    # Check state resolution and name normalization
    tuxtla = df[df["cve_ent"] == "07"].iloc[0]
    assert tuxtla["mun_name"] == "Tuxtla Gutiérrez"
    assert tuxtla["mun_norm"] == "TUXTLA GUTIERREZ"
    assert pd.isna(tuxtla["ine_mun"])  # Nullable Int64 <NA> since no id column
    assert tuxtla["lista_nominal"] == 10000
    assert tuxtla["votos_totales"] == 5200
    assert pytest.approx(tuxtla["participacion"], rel=1e-4) == 0.52

    edomex = df[df["cve_ent"] == "15"].iloc[0]
    assert edomex["mun_name"] == "Toluca de Lerdo"
    assert edomex["mun_norm"] == "TOLUCA DE LERDO"

    cdmx = df[df["cve_ent"] == "09"].iloc[0]
    assert cdmx["mun_name"] == "Coyoacán"
    assert cdmx["mun_norm"] == "COYOACAN"


def test_process_fixture_zip(tmp_path: Path):
    """Test 4: PRES_2018.zip with CSV inside."""
    csv_content = (
        "CVE_ENT,CVE_MUN,MUNICIPIO,LISTA_NOMINAL,TOTAL_VOTOS\n"
        "01,001,AGUASCALIENTES,100000,65000\n"
        "01,002,ASIENTOS,20000,12000\n"
    )
    csv_file = tmp_path / "PRES_2018.csv"
    csv_file.write_text(csv_content, encoding="utf-8")

    zip_path = tmp_path / "PRES_2018.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.write(csv_file, arcname="PRES_2018.csv")

    df = process_file(zip_path, election="PRES", year=2018)
    assert len(df) == 2
    assert (df["election"] == "PRES").all()
    assert (df["year"] == 2018).all()
    assert df.iloc[0]["cve_ent"] == "01"
    assert df.iloc[0]["ine_mun"] == 1
    assert df.iloc[0]["lista_nominal"] == 100000
    assert df.iloc[0]["votos_totales"] == 65000


def test_ignored_and_district_files(tmp_path: Path):
    """Test 5: Unrecognized filename is ignored; district-level file raises ValueError and is skipped."""
    raw_dir = tmp_path / "raw_ine"
    raw_dir.mkdir()

    # 1. Unrecognized filename: notas.csv
    (raw_dir / "notas.csv").write_text("nota1,nota2\n1,2\n", encoding="utf-8")

    # 2. District level without municipality: DIP_FED_2012.csv
    (raw_dir / "DIP_FED_2012.csv").write_text(
        "ID_ESTADO,NOMBRE_ESTADO,ID_DISTRITO,TOTAL_VOTOS,LISTA_NOMINAL\n"
        "7,CHIAPAS,1,20000,30000\n",
        encoding="utf-8",
    )

    # 3. Valid file: DIP_FED_2024.csv
    (raw_dir / "DIP_FED_2024.csv").write_text(
        "CVE_ENT,CVE_MUN,MUNICIPIO,LISTA_NOMINAL,TOTAL_VOTOS\n"
        "07,101,TUXTLA GUTIERREZ,1000,600\n",
        encoding="utf-8",
    )

    # Verify discover_files ignores notas.csv
    discovered = discover_files(raw_dir)
    assert ("DIP_FED", 2012) in discovered
    assert ("DIP_FED", 2024) in discovered
    assert len(discovered) == 2

    # Verify process_file on district-only file raises explicit ValueError
    with pytest.raises(ValueError, match="no trae columna de municipio"):
        process_file(raw_dir / "DIP_FED_2012.csv", election="DIP_FED", year=2012)

    # Verify ingest_ine_results continues and processes valid DIP_FED_2024.csv without crashing
    out_file = tmp_path / "participation_ine.parquet"
    res = ingest_ine_results(raw_dir=raw_dir, out_path=out_file)
    assert len(res) == 1
    assert res.iloc[0]["year"] == 2024
    assert res.iloc[0]["mun_norm"] == "TUXTLA GUTIERREZ"


def test_empty_or_missing_raw_dir(tmp_path: Path):
    """Verify empty or non-existent raw_dir generates empty parquet with §4.2 schema."""
    # 1. Non-existent dir
    out_missing = tmp_path / "out_missing.parquet"
    df_missing = ingest_ine_results(raw_dir=tmp_path / "does_not_exist", out_path=out_missing)
    assert len(df_missing) == 0
    assert list(df_missing.columns) == COLUMNS_ORDER
    assert out_missing.is_file()
    read_missing = read_parquet(out_missing)
    assert len(read_missing) == 0
    assert list(read_missing.columns) == COLUMNS_ORDER

    # 2. Empty dir
    empty_dir = tmp_path / "empty_raw"
    empty_dir.mkdir()
    out_empty = tmp_path / "out_empty.parquet"
    df_empty = ingest_ine_results(raw_dir=empty_dir, out_path=out_empty)
    assert len(df_empty) == 0
    assert list(df_empty.columns) == COLUMNS_ORDER
    assert out_empty.is_file()


def test_duplicate_election_year_picks_largest(tmp_path: Path):
    """Verify that when multiple files exist for the same election/year, largest is picked."""
    raw_dir = tmp_path / "duplicates"
    raw_dir.mkdir()

    small_file = raw_dir / "DIP_FED_2021_small.csv"
    small_file.write_text("CVE_ENT,CVE_MUN,MUNICIPIO,LISTA_NOMINAL,TOTAL_VOTOS\n01,1,AGS,10,5\n")

    large_file = raw_dir / "DIP_FED_2021_large.csv"
    content = "CVE_ENT,CVE_MUN,MUNICIPIO,LISTA_NOMINAL,TOTAL_VOTOS\n" + ("01,1,AGS,10,5\n" * 50)
    large_file.write_text(content)

    discovered = discover_files(raw_dir)
    assert len(discovered) == 1
    assert discovered[("DIP_FED", 2021)].name == "DIP_FED_2021_large.csv"


def test_missing_votos_column_raises_error(tmp_path: Path):
    """Verify file with party columns but no total votos raises ValueError instead of summing."""
    bad_file = tmp_path / "DIP_FED_2021.csv"
    bad_file.write_text(
        "CVE_ENT,CVE_MUN,MUNICIPIO,PAN,PRI,PRD,LISTA_NOMINAL\n"
        "01,1,AGUASCALIENTES,100,200,50,500\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="no trae columna de votos totales"):
        process_file(bad_file, election="DIP_FED", year=2021)


def test_cli_execution(tmp_path: Path):
    """Test CLI main() with arguments --raw-dir and --out."""
    raw_dir = tmp_path / "cli_raw"
    raw_dir.mkdir()

    csv_content = (
        "CVE_ENT,CVE_MUN,MUNICIPIO,LISTA_NOMINAL,TOTAL_VOTOS\n"
        "07,101,TUXTLA GUTIERREZ,10000,5500\n"
    )
    (raw_dir / "DIP_FED_2024.csv").write_text(csv_content, encoding="utf-8")
    out_parquet = tmp_path / "out_cli.parquet"

    exit_code = main(["--raw-dir", str(raw_dir), "--out", str(out_parquet)])
    assert exit_code == 0
    assert out_parquet.is_file()

    df = read_parquet(out_parquet)
    assert len(df) == 1
    assert df.iloc[0]["mun_norm"] == "TUXTLA GUTIERREZ"
    assert pytest.approx(df.iloc[0]["participacion"], rel=1e-4) == 0.55
