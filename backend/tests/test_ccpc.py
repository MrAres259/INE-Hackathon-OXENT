"""Tests for CCPC ingestion module (atalaya.ingest.ccpc)."""

from __future__ import annotations

import io
from pathlib import Path
import zipfile

import numpy as np
import pandas as pd
import pytest

from atalaya.ingest.ccpc import (
    CCPC_PROFILE_COLUMNS,
    CCPC_SECCION_COLUMNS,
    PARTICIPATION_INE_COLUMNS,
    create_empty_ccpc_profile_df,
    create_empty_ccpc_seccion_df,
    create_empty_participation_ine_df,
    discover_zips,
    ingest_ccpc,
)
from atalaya.ingest.common import read_parquet


def create_synthetic_ccpc_zips(raw_dir: Path) -> tuple[Path, Path]:
    """Helper to create two synthetic CCPC zips in raw_dir for testing."""
    raw_dir.mkdir(parents=True, exist_ok=True)

    # 1. Federal 2024 zip with 2 state CSVs and BOM
    zip_2024_path = raw_dir / "DatosAbiertos_DECEyEC_ConteosCensales2024.zip"
    with zipfile.ZipFile(zip_2024_path, "w", compression=zipfile.ZIP_DEFLATED) as z:
        # Description text file
        z.writestr(
            "DatosAbiertos_DECEyEC_ConteosCensales2024/01_descripcioncampos_conteoscensales2024.txt",
            "Descripcion de campos CCPC 2024\nAELEC,FELECCION,EDOCVE,...",
        )

        # State 1 CSV: Aguascalientes (EDOCVE=1)
        # Includes:
        # - age boundary rows (24, 25, 65)
        # - sex 0 (H), 1 (M), 2 (X)
        # - a row with NS > 0
        # - Mun 5 with 2 rows 'Jesús María' and 1 row 'JESUS MARIA'
        csv_ags = (
            "\ufeffAELEC,FELECCION,EDOCVE,EDONOM,MPIOCVE,MPIONOM,SECCION,TIPOSEC,DEF,DEL,SEXO,EDAD,LN,SV,NV,NS\r\n"
            "2024,02/06/2024,1,AGUASCALIENTES,1,Aguascalientes,101,U,1,,0,24,100,60,40,0\r\n"
            "2024,02/06/2024,1,AGUASCALIENTES,1,Aguascalientes,101,U,1,,1,25,100,70,25,5\r\n"
            "2024,02/06/2024,1,AGUASCALIENTES,1,Aguascalientes,102,R,1,,2,65,50,20,30,0\r\n"
            "2024,02/06/2024,1,AGUASCALIENTES,5,Jesús María,201,M,2,,0,30,80,40,40,0\r\n"
            "2024,02/06/2024,1,AGUASCALIENTES,5,Jesús María,201,M,2,,1,40,60,30,30,0\r\n"
            "2024,02/06/2024,1,AGUASCALIENTES,5,JESUS MARIA,202,M,2,,0,50,40,20,20,0\r\n"
        )
        z.writestr(
            "DatosAbiertos_DECEyEC_ConteosCensales2024/datosabiertos_deceyec_conteoscensales2024_ags.csv",
            csv_ags.encode("utf-8"),
        )

        # State 2 CSV: Baja California (EDOCVE=2)
        csv_bc = (
            "\ufeffAELEC,FELECCION,EDOCVE,EDONOM,MPIOCVE,MPIONOM,SECCION,TIPOSEC,DEF,DEL,SEXO,EDAD,LN,SV,NV,NS\r\n"
            "2024,02/06/2024,2,BAJA CALIFORNIA,1,Mexicali,301,U,1,,0,70,200,100,100,0\r\n"
        )
        z.writestr(
            "DatosAbiertos_DECEyEC_ConteosCensales2024/datosabiertos_deceyec_conteoscensales2024_bc.csv",
            csv_bc.encode("utf-8"),
        )

    # 2. Judicial PJ 2025 zip with missing DEF and TIPOSEC columns
    zip_pj_path = raw_dir / "DatosAbiertos_DECEyEC_ConteosCensalesPJ2025.zip"
    with zipfile.ZipFile(zip_pj_path, "w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr(
            "DatosAbiertos_DECEyEC_ConteosCensalesPJ2025/01_descripcioncampos_conteoscensalespj2025.txt",
            "Descripcion de campos CCPC PJ 2025\nAELEC,EDOCVE,...",
        )
        # Note: DEF and TIPOSEC are omitted to test fallback behavior
        csv_pj = (
            "\ufeffAELEC,EDOCVE,EDONOM,MPIOCVE,MPIONOM,SECCION,CJ,DEJ,SEXO,EDAD,LN,SV,NV,NS\r\n"
            "2025,1,Aguascalientes,1,Aguascalientes,101,30,1,0,30,100,20,80,0\r\n"
        )
        z.writestr(
            "DatosAbiertos_DECEyEC_ConteosCensalesPJ2025/datosabiertos_deceyec_conteoscensalespj2025_ags.csv",
            csv_pj.encode("utf-8"),
        )

    return zip_2024_path, zip_pj_path


def test_empty_directory(tmp_path: Path):
    """Test ingestion when input folder is empty."""
    empty_raw = tmp_path / "raw_empty"
    empty_raw.mkdir()
    out_dir = tmp_path / "build"

    df_part, df_prof, df_sec = ingest_ccpc(raw_dir=empty_raw, out_dir=out_dir)

    assert df_part.empty
    assert list(df_part.columns) == PARTICIPATION_INE_COLUMNS
    assert (out_dir / "participation_ine.parquet").is_file()

    assert df_prof.empty
    assert list(df_prof.columns) == CCPC_PROFILE_COLUMNS
    assert (out_dir / "ccpc_profile.parquet").is_file()

    assert df_sec.empty
    assert list(df_sec.columns) == CCPC_SECCION_COLUMNS
    assert (out_dir / "ccpc_seccion.parquet").is_file()


def test_empty_schemas_dtypes():
    """Verify empty schemas have exact dtypes and columns."""
    df_part = create_empty_participation_ine_df()
    assert list(df_part.columns) == PARTICIPATION_INE_COLUMNS
    assert str(df_part["ine_mun"].dtype) == "Int64"
    assert df_part["cve_ent"].dtype == object
    assert df_part["participacion"].dtype == np.float64

    df_prof = create_empty_ccpc_profile_df()
    assert list(df_prof.columns) == CCPC_PROFILE_COLUMNS
    assert str(df_prof["ine_mun"].dtype) == "Int64"

    df_sec = create_empty_ccpc_seccion_df()
    assert list(df_sec.columns) == CCPC_SECCION_COLUMNS
    assert str(df_sec["def"].dtype) == "Int64"


def test_ccpc_ingestion_full_flow(tmp_path: Path):
    """Test full CCPC processing on synthetic zip files."""
    raw_dir = tmp_path / "raw"
    out_dir = tmp_path / "build"
    create_synthetic_ccpc_zips(raw_dir)

    # Run ingestion
    df_part, df_prof, df_sec = ingest_ccpc(raw_dir=raw_dir, out_dir=out_dir)

    # 1. Verify files exist on disk
    part_parquet = read_parquet(out_dir / "participation_ine.parquet")
    prof_parquet = read_parquet(out_dir / "ccpc_profile.parquet")
    sec_parquet = read_parquet(out_dir / "ccpc_seccion.parquet")

    assert len(part_parquet) == len(df_part)
    assert len(prof_parquet) == len(df_prof)
    assert len(sec_parquet) == len(df_sec)

    # 2. Verify municipality level (df_part)
    # Expected rows:
    # 2024: (01, 1), (01, 5), (02, 1) -> 3 rows
    # 2025: (01, 1) -> 1 row
    # Total = 4 rows
    assert len(df_part) == 4

    # Check Aguascalientes Mun 1 (2024)
    row_ags_1 = df_part[(df_part["cve_ent"] == "01") & (df_part["ine_mun"] == 1) & (df_part["year"] == 2024)].iloc[0]
    assert row_ags_1["mun_name"] == "Aguascalientes"
    assert row_ags_1["mun_norm"] == "AGUASCALIENTES"
    assert row_ags_1["election"] == "DIP_FED"
    assert row_ags_1["lista_nominal"] == 250  # 100 + 100 + 50
    assert row_ags_1["votos_totales"] == 150  # 60 + 70 + 20
    assert row_ags_1["nv"] == 95  # 40 + 25 + 30
    assert row_ags_1["ns"] == 5   # 0 + 5 + 0
    # Participation excludes NS: SV / (SV + NV) = 150 / 245
    expected_part = 150.0 / (150.0 + 95.0)
    assert pytest.approx(row_ags_1["participacion"], rel=1e-5) == expected_part

    # Check name variant frequency selection for Mun 5:
    # 2 rows with 'Jesús María', 1 with 'JESUS MARIA' -> most frequent is 'Jesús María'
    row_ags_5 = df_part[(df_part["cve_ent"] == "01") & (df_part["ine_mun"] == 5) & (df_part["year"] == 2024)].iloc[0]
    assert row_ags_5["mun_name"] == "Jesús María"
    assert row_ags_5["mun_norm"] == "JESUS MARIA"
    assert row_ags_5["lista_nominal"] == 180  # 80 + 60 + 40
    assert row_ags_5["votos_totales"] == 90   # 40 + 30 + 20
    assert row_ags_5["nv"] == 90
    assert row_ags_5["ns"] == 0
    assert pytest.approx(row_ags_5["participacion"], rel=1e-5) == 0.5

    # Check PJ2025 row:
    row_pj = df_part[df_part["election"] == "PJF"].iloc[0]
    assert row_pj["year"] == 2025
    assert row_pj["cve_ent"] == "01"
    assert row_pj["ine_mun"] == 1
    assert row_pj["lista_nominal"] == 100
    assert row_pj["votos_totales"] == 20
    assert row_pj["nv"] == 80
    assert pytest.approx(row_pj["participacion"], rel=1e-5) == 0.2

    # 3. Verify profile table (df_prof)
    # Check age group boundary values:
    # - age 24 must be in '18-24'
    prof_24 = df_prof[
        (df_prof["cve_ent"] == "01")
        & (df_prof["ine_mun"] == 1)
        & (df_prof["year"] == 2024)
        & (df_prof["age_group"] == "18-24")
    ]
    assert len(prof_24) == 1
    assert prof_24.iloc[0]["sexo"] == "H"
    assert prof_24.iloc[0]["ln"] == 100
    assert prof_24.iloc[0]["sv"] == 60

    # - age 25 must be in '25-34'
    prof_25 = df_prof[
        (df_prof["cve_ent"] == "01")
        & (df_prof["ine_mun"] == 1)
        & (df_prof["year"] == 2024)
        & (df_prof["age_group"] == "25-34")
    ]
    assert len(prof_25) == 1
    assert prof_25.iloc[0]["sexo"] == "M"
    assert prof_25.iloc[0]["ln"] == 100
    assert prof_25.iloc[0]["sv"] == 70
    assert prof_25.iloc[0]["ns"] == 5

    # - age 65 must be in '65+' with sexo 'X'
    prof_65 = df_prof[
        (df_prof["cve_ent"] == "01")
        & (df_prof["ine_mun"] == 1)
        & (df_prof["year"] == 2024)
        & (df_prof["age_group"] == "65+")
    ]
    assert len(prof_65) == 1
    assert prof_65.iloc[0]["sexo"] == "X"
    assert prof_65.iloc[0]["ln"] == 50
    assert prof_65.iloc[0]["sv"] == 20

    # 4. Verify section table (df_sec)
    # Sections in AGS Mun 1: seccion 101 (U, DEF 1) and seccion 102 (R, DEF 1)
    sec_101 = df_sec[
        (df_sec["cve_ent"] == "01")
        & (df_sec["ine_mun"] == 1)
        & (df_sec["year"] == 2024)
        & (df_sec["seccion"] == 101)
    ].iloc[0]
    assert sec_101["tiposec"] == "U"
    assert sec_101["def"] == 1
    assert sec_101["ln"] == 200  # 100 + 100
    assert sec_101["sv"] == 130  # 60 + 70
    assert sec_101["nv"] == 65   # 40 + 25
    assert sec_101["ns"] == 5
    assert pytest.approx(sec_101["participacion"], rel=1e-5) == 130.0 / (130.0 + 65.0)

    sec_102 = df_sec[
        (df_sec["cve_ent"] == "01")
        & (df_sec["ine_mun"] == 1)
        & (df_sec["year"] == 2024)
        & (df_sec["seccion"] == 102)
    ].iloc[0]
    assert sec_102["tiposec"] == "R"
    assert sec_102["def"] == 1
    assert sec_102["ln"] == 50
    assert sec_102["sv"] == 20
    assert sec_102["nv"] == 30
    assert pytest.approx(sec_102["participacion"], rel=1e-5) == 20.0 / 50.0

    # PJ 2025 section where DEF and TIPOSEC were missing in input:
    sec_pj = df_sec[df_sec["year"] == 2025].iloc[0]
    assert sec_pj["election"] == "PJF"
    assert sec_pj["seccion"] == 101
    assert pd.isna(sec_pj["def"])
    assert pd.isna(sec_pj["tiposec"])
    assert sec_pj["ln"] == 100
    assert sec_pj["sv"] == 20
    assert pytest.approx(sec_pj["participacion"], rel=1e-5) == 0.2
