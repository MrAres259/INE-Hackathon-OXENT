"""Unit tests for atalaya.ingest.common shared helpers."""

from __future__ import annotations

from pathlib import Path
import zipfile
import numpy as np
import openpyxl
import pandas as pd
import pytest

from atalaya.ingest.common import (
    norm_col,
    norm_name,
    pick_col,
    read_parquet,
    read_table,
    to_num,
    write_parquet,
    zpad,
)


def test_norm_name():
    assert norm_name("Tuxtla Gutiérrez ") == "TUXTLA GUTIERREZ"
    assert norm_name("Muñoz") == "MUNOZ"
    assert norm_name("A. Obregón / Benito Juárez") == "A OBREGON BENITO JUAREZ"
    assert norm_name("Coyoacán (Distrito 10)") == "COYOACAN DISTRITO 10"
    assert norm_name(None) == ""
    assert norm_name(np.nan) == ""
    assert norm_name("") == ""
    assert norm_name("   ") == ""


def test_norm_col():
    assert norm_col("Lista Nominal") == "LISTA_NOMINAL"
    assert norm_col("\ufeffCVE_ENT") == "CVE_ENT"
    assert norm_col("VOTOS TOTALES (DIP_FED)") == "VOTOS_TOTALES_DIP_FED"
    assert norm_col("Año de Elección") == "ANO_DE_ELECCION"
    assert norm_col("POB-TOT / 2020") == "POB_TOT_2020"
    assert norm_col(None) == ""


def test_zpad():
    assert zpad(7, 2) == "07"
    assert zpad("7", 2) == "07"
    assert zpad("7.0", 2) == "07"
    assert zpad("07101", 5) == "07101"
    assert zpad(101, 3) == "101"
    assert zpad(101, 5) == "00101"
    assert zpad(None, 2) == "00"
    assert zpad(np.nan, 3) == "000"


def test_to_num():
    s = pd.Series(["1,234", " 567 ", "12.5%", "*", "N/D", "-", "", "100.5"])
    res = to_num(s)
    assert res.iloc[0] == 1234.0
    assert res.iloc[1] == 567.0
    assert res.iloc[2] == 12.5
    assert np.isnan(res.iloc[3])
    assert np.isnan(res.iloc[4])
    assert np.isnan(res.iloc[5])
    assert np.isnan(res.iloc[6])
    assert res.iloc[7] == 100.5


def test_pick_col():
    df = pd.DataFrame(columns=["CVE_ENT", "LISTA_NOMINAL", "VOTOS_TOTALES"])
    col = pick_col(df, ["entidad", "cve_ent", "id_entidad"])
    assert col == "CVE_ENT"

    col2 = pick_col(df, ["lista_nominal", "nominal"])
    assert col2 == "LISTA_NOMINAL"

    assert pick_col(df, ["no_existe"], required=False) is None

    with pytest.raises(ValueError, match="None of the aliases"):
        pick_col(df, ["inexistente", "otra"], required=True)


def test_read_table_utf8_bom():
    fixtures_dir = Path(__file__).resolve().parent / "fixtures" / "core"
    bom_file = fixtures_dir / "sample_utf8_bom.csv"
    assert bom_file.is_file()

    df = read_table(bom_file, expect_any=["CVE_ENT", "NOM_ENT"])
    assert list(df.columns) == ["CVE_ENT", "NOM_ENT", "POB_TOT"]
    assert len(df) == 2
    assert df.iloc[0]["CVE_ENT"] == "07"
    assert df.iloc[1]["NOM_ENT"] == "Ciudad de México"


def test_read_table_cp1252_pipe():
    fixtures_dir = Path(__file__).resolve().parent / "fixtures" / "core"
    pipe_file = fixtures_dir / "sample_cp1252_pipe.csv"
    assert pipe_file.is_file()

    df = read_table(pipe_file, expect_any=["CVE_ENT", "MUN_NAME"])
    assert list(df.columns) == ["CVE_ENT", "MUN_NAME", "VOTOS"]
    assert len(df) == 2
    assert df.iloc[0]["MUN_NAME"] == "Tuxtla Gutiérrez"
    assert df.iloc[1]["MUN_NAME"] == "Benito Juárez"


def test_read_table_xlsx(tmp_path: Path):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["Reporte de prueba", ""])
    ws.append(["Fecha:", "2024"])
    ws.append(["CVEGEO", "NOMBRE_MUN", "VALOR"])
    ws.append(["07101", "Tuxtla Gutiérrez", "1500"])
    ws.append(["09001", "Benito Juárez", "2500"])

    xlsx_path = tmp_path / "test_data.xlsx"
    wb.save(xlsx_path)

    df = read_table(xlsx_path, expect_any=["CVEGEO", "NOMBRE_MUN"])
    assert list(df.columns) == ["CVEGEO", "NOMBRE_MUN", "VALOR"]
    assert len(df) == 2
    assert df.iloc[0]["CVEGEO"] == "07101"
    assert df.iloc[1]["NOMBRE_MUN"] == "Benito Juárez"


def test_read_table_zip(tmp_path: Path):
    csv_content = "ID,MUNICIPIO,TASA\n1,San Cristóbal,45.2\n2,Tapachula,51.8\n"
    zip_path = tmp_path / "archive.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("subfolder/data_file.csv", csv_content.encode("utf-8"))

    df = read_table(zip_path, expect_any=["ID", "MUNICIPIO"])
    assert list(df.columns) == ["ID", "MUNICIPIO", "TASA"]
    assert len(df) == 2
    assert df.iloc[0]["MUNICIPIO"] == "San Cristóbal"


def test_write_and_read_parquet(tmp_path: Path):
    df = pd.DataFrame({"cvegeo": ["07101", "07102"], "val": [10, 20]})
    target = tmp_path / "output" / "test.parquet"
    count = write_parquet(df, target)
    assert count == 2
    assert target.is_file()

    read_back = read_parquet(target)
    assert len(read_back) == 2
    assert list(read_back["cvegeo"]) == ["07101", "07102"]
