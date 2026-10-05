"""Ingestion module for CONAPO Índice de Marginación Municipal 2020.

Produces municipal-level marginalization metrics in data/build/conapo_mun.parquet.
"""

from __future__ import annotations

import argparse
import logging
from pathlib import Path
import sys

import numpy as np
import pandas as pd

from atalaya.config import BUILD_DIR, RAW_DIR
from atalaya.ingest.common import (
    norm_name,
    pick_col,
    read_table,
    to_num,
    write_parquet,
    zpad,
)

logger = logging.getLogger(__name__)

CONAPO_OUTPUT_COLUMNS = [
    "cvegeo",
    "nom_mun_conapo",
    "pob_tot_conapo",
    "pct_analfabeta",
    "pct_po2sm",
    "im_2020",
    "gm_2020",
]

COLUMN_ALIASES: dict[str, list[str]] = {
    "CVE_MUN": ["CVE_MUN", "CVEGEO", "CLAVE_MUNICIPIO", "CVE_MUNICIPIO", "ID_MUNICIPIO"],
    "CVE_ENT": ["CVE_ENT", "ENTIDAD", "CLAVE_ENTIDAD", "ID_ENTIDAD"],
    "NOM_MUN": ["NOM_MUN", "NOM_MUNICIPIO", "MUNICIPIO", "NOMBRE_MUNICIPIO"],
    "POB_TOT": ["POB_TOT", "POBTOT", "POBLACION_TOTAL", "POB_2020", "POB_TOT_2020"],
    "ANALF": ["ANALF", "PCT_ANALF", "ANALFABETA", "P_ANALF"],
    "PO2SM": ["PO2SM", "PCT_PO2SM", "PO_2SM", "P_PO2SM"],
    "IM_2020": ["IM_2020", "INDICE_MARGINACION_2020", "IM2020", "IM", "INDICE_DE_MARGINACION"],
    "GM_2020": ["GM_2020", "GRADO_MARGINACION_2020", "GM2020", "GM", "GRADO_DE_MARGINACION"],
}


def find_conapo_file(raw_dir: Path | str) -> Path | None:
    """Find CONAPO IMM 2020 file in raw_dir."""
    raw_path = Path(raw_dir)
    if raw_path.is_file():
        return raw_path
    if not raw_path.is_dir():
        return None

    # Priority 1: starts with IMM_2020
    for ext in ("csv", "xlsx", "xls", "zip"):
        matches = list(raw_path.glob(f"IMM_2020*.{ext}")) + list(raw_path.glob(f"imm_2020*.{ext}"))
        if matches:
            return matches[0]

    # Priority 2: contains IMM and 2020
    for f in raw_path.iterdir():
        if f.is_file() and "imm" in f.name.lower() and "2020" in f.name.lower():
            if f.suffix.lower() in (".csv", ".xlsx", ".xls", ".zip"):
                return f

    # Priority 3: any IMM file
    for f in raw_path.iterdir():
        if f.is_file() and "imm" in f.name.lower() and f.suffix.lower() in (".csv", ".xlsx", ".xls", ".zip"):
            return f

    return None


def normalize_gm(val: any) -> str | float:
    """Normalize Grado de Marginación to canonical category."""
    if val is None or pd.isna(val):
        return np.nan
    s = norm_name(str(val))
    if not s:
        return np.nan
    if "MUY BAJO" in s:
        return "Muy bajo"
    elif "MUY ALTO" in s:
        return "Muy alto"
    elif "BAJO" in s:
        return "Bajo"
    elif "MEDIO" in s:
        return "Medio"
    elif "ALTO" in s:
        return "Alto"
    return str(val).strip().capitalize()


def process_conapo(
    raw_path: Path | str | None = None,
    out_path: Path | str | None = None,
) -> pd.DataFrame:
    """Process CONAPO IMM 2020 data into municipal marginalization metrics."""
    raw_dir = Path(raw_path) if raw_path else RAW_DIR / "conapo"
    output_path = Path(out_path) if out_path else BUILD_DIR / "conapo_mun.parquet"

    source_file = find_conapo_file(raw_dir)
    if not source_file or not source_file.exists():
        logger.warning("No CONAPO file found at %s. Creating empty output.", raw_dir)
        empty_df = pd.DataFrame(columns=CONAPO_OUTPUT_COLUMNS)
        write_parquet(empty_df, output_path)
        return empty_df

    logger.info("Processing CONAPO IMM 2020 from %s", source_file)
    df = read_table(
        source_file,
        expect_any=["CVE_MUN", "IM_2020", "GM_2020", "ANALF", "CVE_ENT"],
    )

    if df.empty:
        logger.warning("CONAPO file %s is empty. Creating empty output.", source_file)
        empty_df = pd.DataFrame(columns=CONAPO_OUTPUT_COLUMNS)
        write_parquet(empty_df, output_path)
        return empty_df

    # Resolve column mappings
    resolved_cols: dict[str, str | None] = {}
    for canonical_name, aliases in COLUMN_ALIASES.items():
        matched = pick_col(df, aliases, required=False)
        resolved_cols[canonical_name] = matched

    col_cve_mun = resolved_cols.get("CVE_MUN")
    if not col_cve_mun:
        raise ValueError(f"Could not find CVE_MUN column in CONAPO file. Available columns: {df.columns.tolist()}")

    col_cve_ent = resolved_cols.get("CVE_ENT")
    col_nom_mun = resolved_cols.get("NOM_MUN")
    col_pob_tot = resolved_cols.get("POB_TOT")
    col_analf = resolved_cols.get("ANALF")
    col_po2sm = resolved_cols.get("PO2SM")
    col_im_2020 = resolved_cols.get("IM_2020")
    col_gm_2020 = resolved_cols.get("GM_2020")

    # Format 5-digit cvegeo
    cvegeo_list: list[str] = []
    for _, row in df.iterrows():
        val_mun = str(row[col_cve_mun]).strip()
        if "." in val_mun:
            try:
                f = float(val_mun)
                if f.is_integer():
                    val_mun = str(int(f))
            except ValueError:
                pass

        if len(val_mun) <= 3 and col_cve_ent and col_cve_ent in row:
            val_ent = str(row[col_cve_ent]).strip()
            cvegeo_list.append(f"{zpad(val_ent, 2)}{zpad(val_mun, 3)}")
        else:
            cvegeo_list.append(zpad(val_mun, 5))

    # Metrics
    nom_mun_conapo = (
        df[col_nom_mun].fillna("").astype(str).str.strip().values
        if col_nom_mun
        else [""] * len(df)
    )

    pob_tot_conapo = (
        to_num(df[col_pob_tot]).round().astype("Int64")
        if col_pob_tot
        else pd.Series(pd.NA, index=range(len(df)), dtype="Int64")
    )

    pct_analfabeta = (
        (to_num(df[col_analf]) / 100.0).clip(0.0, 1.0)
        if col_analf
        else pd.Series(np.nan, index=range(len(df)))
    )

    pct_po2sm = (
        (to_num(df[col_po2sm]) / 100.0).clip(0.0, 1.0)
        if col_po2sm
        else pd.Series(np.nan, index=range(len(df)))
    )

    im_2020 = (
        to_num(df[col_im_2020])
        if col_im_2020
        else pd.Series(np.nan, index=range(len(df)))
    )

    gm_2020 = (
        df[col_gm_2020].apply(normalize_gm)
        if col_gm_2020
        else pd.Series(np.nan, index=range(len(df)))
    )

    res_df = pd.DataFrame({
        "cvegeo": cvegeo_list,
        "nom_mun_conapo": nom_mun_conapo,
        "pob_tot_conapo": pob_tot_conapo,
        "pct_analfabeta": pct_analfabeta.astype(float),
        "pct_po2sm": pct_po2sm.astype(float),
        "im_2020": im_2020.astype(float),
        "gm_2020": gm_2020.astype(object),
    })

    # Filter out state/national summary rows if any (cvegeo ending in 000 or invalid)
    res_df = res_df[res_df["cvegeo"].str.len() == 5].copy()
    res_df = res_df[~res_df["cvegeo"].str.endswith("000")].copy()
    res_df = res_df.drop_duplicates(subset=["cvegeo"]).reset_index(drop=True)

    write_parquet(res_df, output_path)
    logger.info("Wrote %d CONAPO municipal records to %s", len(res_df), output_path)
    return res_df


def main():
    parser = argparse.ArgumentParser(description="Ingest CONAPO IMM 2020 data.")
    parser.add_argument("--raw", default=None, help="Path to raw CONAPO directory or file.")
    parser.add_argument("--out", default=None, help="Output parquet path.")
    args = parser.parse_args()

    process_conapo(raw_path=args.raw, out_path=args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
