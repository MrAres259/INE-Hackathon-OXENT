"""Ingestion module for INEGI ITER (Censo de Población y Vivienda 2020).

Produces municipal-level sociodemographic metrics in data/build/inegi_mun.parquet.
"""

from __future__ import annotations

import argparse
import logging
from pathlib import Path
import re
import sys
import zipfile

import numpy as np
import pandas as pd

from atalaya.config import BUILD_DIR, RAW_DIR
from atalaya.ingest.common import (
    norm_col,
    pick_col,
    read_table,
    to_num,
    write_parquet,
    zpad,
)

logger = logging.getLogger(__name__)

ITER_OUTPUT_COLUMNS = [
    "cvegeo",
    "cve_ent",
    "cve_mun",
    "nom_ent",
    "nom_mun",
    "pob_tot",
    "pob_18ymas",
    "pct_18_24",
    "pct_65ymas",
    "graproes",
    "pct_hli",
    "pct_sin_servsalud",
    "pct_internet",
    "pct_rural",
]

# Field alias lists for INEGI ITER headers
COLUMN_ALIASES: dict[str, list[str]] = {
    "ENTIDAD": ["ENTIDAD", "CVE_ENT"],
    "NOM_ENT": ["NOM_ENT", "NOM_ENTIDAD"],
    "MUN": ["MUN", "CVE_MUN"],
    "NOM_MUN": ["NOM_MUN", "MUNICIPIO", "NOM_MUNICIPIO"],
    "LOC": ["LOC", "CVE_LOC"],
    "NOM_LOC": ["NOM_LOC", "LOCALIDAD"],
    "POBTOT": ["POBTOT", "POB_TOT", "POB_TOTAL"],
    "P_18YMAS": ["P_18YMAS", "POB_18YMAS", "P18YMAS", "P_18_Y_MAS"],
    "P_18A24": ["P_18A24", "P18A24", "P_18_24"],
    "POB65_MAS": ["POB65_MAS", "POB65MAS", "P_65YMAS", "P65YMAS", "P_65_MAS"],
    "GRAPROES": ["GRAPROES", "GRAPROES_2020"],
    "P_3YMAS": ["P_3YMAS", "P3YMAS", "P_3_MAS"],
    "P3YM_HLI": ["P3YM_HLI", "P3YM_HLI_2020", "P3YMAS_HLI", "P_3YM_HLI"],
    "PSINDER": ["PSINDER", "P_SINDER"],
    "VPH_INTER": ["VPH_INTER", "VPH_INTERNET"],
    "TVIVPARHAB": ["TVIVPARHAB", "TVIVPAR_HAB", "TVIVHAB"],
}


def find_iter_file(raw_dir: Path | str) -> Path | None:
    """Find the ITER 2020 source file in raw_dir."""
    raw_path = Path(raw_dir)
    if raw_path.is_file():
        return raw_path
    if not raw_path.is_dir():
        return None

    # Priority 1: starts with iter_00_cpv2020
    for pattern in ("iter_00_cpv2020*.csv", "iter_00_cpv2020*.zip"):
        matches = list(raw_path.glob(pattern))
        if matches:
            return matches[0]

    # Priority 2: ITER_NALCSV20.csv or *iter*cpv2020*
    for pattern in ("ITER_NALCSV20.csv", "*iter*cpv2020*.csv", "*iter*cpv2020*.zip", "*iter*.csv", "*iter*.zip"):
        matches = list(raw_path.glob(pattern))
        if matches:
            return matches[0]

    return None


def _detect_csv_header_and_cols(
    sample_text: str,
) -> tuple[int, str, list[str]]:
    """Detect header line index, delimiter, and needed columns from sample text."""
    lines = sample_text.splitlines()
    if not lines:
        raise ValueError("Empty CSV content")

    sample_block = "\n".join(lines[:10])
    counts = {
        ",": sample_block.count(","),
        "\t": sample_block.count("\t"),
        ";": sample_block.count(";"),
        "|": sample_block.count("|"),
    }
    delimiter = max(counts, key=counts.get)
    if counts[delimiter] == 0:
        delimiter = ","

    header_idx = -1
    raw_header_cols: list[str] = []
    expected_core = {"ENTIDAD", "MUN", "LOC", "POBTOT", "NOM_MUN"}

    for idx, line in enumerate(lines[:30]):
        tokens = [c.strip().strip('"').strip("'") for c in line.split(delimiter)]
        norm_tokens = {norm_col(t) for t in tokens if t}
        if len(norm_tokens.intersection(expected_core)) >= 2:
            header_idx = idx
            raw_header_cols = tokens
            break

    if header_idx == -1:
        all_aliases = {norm_col(a) for aliases in COLUMN_ALIASES.values() for a in aliases}
        for idx, line in enumerate(lines[:30]):
            tokens = [c.strip().strip('"').strip("'") for c in line.split(delimiter)]
            norm_tokens = {norm_col(t) for t in tokens if t}
            if len(norm_tokens.intersection(all_aliases)) >= 3:
                header_idx = idx
                raw_header_cols = tokens
                break

    if header_idx == -1:
        header_idx = 0
        raw_header_cols = [c.strip().strip('"').strip("'") for c in lines[0].split(delimiter)]

    norm_to_orig = {norm_col(c): c for c in raw_header_cols if c}
    needed_cols = []
    for canonical, aliases in COLUMN_ALIASES.items():
        for alias in aliases:
            n_alias = norm_col(alias)
            if n_alias in norm_to_orig:
                needed_cols.append(norm_to_orig[n_alias])
                break

    return header_idx, delimiter, needed_cols


def _read_iter_table(path: Path) -> pd.DataFrame:
    """Read ITER dataset with usecols to conserve memory, for both zip and csv.

    CONTRACT-NOTE: Always read with usecols from COLUMN_ALIASES to avoid loading
    unneeded columns into memory, regardless of file size.
    """
    path = Path(path)
    if not path.is_file():
        raise FileNotFoundError(f"File not found: {path}")

    logger.info("Reading ITER file %s using usecols", path)

    if path.suffix.lower() == ".zip":
        with zipfile.ZipFile(path, "r") as zf:
            candidates = [
                m for m in zf.infolist()
                if not m.filename.startswith("__MACOSX")
                and not m.filename.endswith("/")
                and m.filename.lower().endswith(".csv")
                and "catalogos" not in m.filename.lower()
            ]
            if not candidates:
                raise ValueError(f"No valid CSV found in zip: {path}")

            # In zip, pick CSV inside conjunto_de_datos/ (or the largest), never catalogos/
            conjunto_candidates = [m for m in candidates if "conjunto_de_datos" in m.filename.lower()]
            if conjunto_candidates:
                chosen = max(conjunto_candidates, key=lambda m: m.file_size)
            else:
                chosen = max(candidates, key=lambda m: m.file_size)

            with zf.open(chosen) as f:
                sample_bytes = f.read(200000)

            enc = "utf-8-sig"
            try:
                sample_text = sample_bytes.decode(enc)
            except UnicodeDecodeError:
                enc = "latin-1"
                sample_text = sample_bytes.decode(enc, errors="ignore")

            header_idx, delimiter, needed_cols = _detect_csv_header_and_cols(sample_text)

            with zf.open(chosen) as f:
                df = pd.read_csv(
                    f,
                    sep=delimiter,
                    skiprows=header_idx if header_idx > 0 else None,
                    usecols=needed_cols if needed_cols else None,
                    dtype=str,
                    low_memory=False,
                    encoding=enc,
                )
    else:
        with open(path, "rb") as f:
            sample_bytes = f.read(200000)

        enc = "utf-8-sig"
        try:
            sample_text = sample_bytes.decode(enc)
        except UnicodeDecodeError:
            enc = "latin-1"
            sample_text = sample_bytes.decode(enc, errors="ignore")

        header_idx, delimiter, needed_cols = _detect_csv_header_and_cols(sample_text)

        df = pd.read_csv(
            path,
            sep=delimiter,
            skiprows=header_idx if header_idx > 0 else None,
            usecols=needed_cols if needed_cols else None,
            dtype=str,
            low_memory=False,
            encoding=enc,
        )

    df.columns = [norm_col(c) for c in df.columns]
    return df


def process_inegi_iter(
    raw_path: Path | str | None = None,
    out_path: Path | str | None = None,
) -> pd.DataFrame:
    """Process INEGI ITER 2020 data into municipal sociodemographic metrics."""
    raw_dir = Path(raw_path) if raw_path else RAW_DIR / "inegi"
    output_path = Path(out_path) if out_path else BUILD_DIR / "inegi_mun.parquet"

    source_file = find_iter_file(raw_dir)
    if not source_file or not source_file.exists():
        logger.warning("No INEGI ITER file found at %s. Creating empty output.", raw_dir)
        empty_df = pd.DataFrame(columns=ITER_OUTPUT_COLUMNS)
        write_parquet(empty_df, output_path)
        return empty_df

    logger.info("Processing INEGI ITER from %s", source_file)
    df = _read_iter_table(source_file)

    if df.empty:
        logger.warning("INEGI ITER file %s is empty. Creating empty output.", source_file)
        empty_df = pd.DataFrame(columns=ITER_OUTPUT_COLUMNS)
        write_parquet(empty_df, output_path)
        return empty_df

    # Resolve column mappings
    resolved_cols: dict[str, str | None] = {}
    for canonical_name, aliases in COLUMN_ALIASES.items():
        matched = pick_col(df, aliases, required=False)
        resolved_cols[canonical_name] = matched
        if matched is None:
            # CONTRACT-NOTE: Canonical column not present in source ITER file; derived features will be NaN
            logger.debug("Column for %s not found in ITER file", canonical_name)

    col_ent = resolved_cols.get("ENTIDAD")
    col_mun = resolved_cols.get("MUN")
    col_loc = resolved_cols.get("LOC")

    if not col_ent or not col_mun or not col_loc:
        raise ValueError(f"Essential geographic columns ENTIDAD, MUN, LOC could not be resolved from {df.columns.tolist()}")

    # Geographic code formatting
    ent_series = df[col_ent].apply(lambda v: zpad(v, 2))
    mun_series = df[col_mun].apply(lambda v: zpad(v, 3))
    loc_series = df[col_loc].apply(lambda v: zpad(v, 4))

    # Exclude national (ENTIDAD == "00" or MUN == "000") and state totals (MUN == "000")
    is_valid_entity = ent_series != "00"
    is_valid_mun = mun_series != "000"
    is_municipal_row = is_valid_entity & is_valid_mun & (loc_series == "0000")
    is_locality_row = is_valid_entity & is_valid_mun & (loc_series != "0000")

    # 1. Compute pct_rural from locality rows
    # Localities with POBTOT < 2500 (includes 9998/9999 as instructed: < 2500 hab)
    col_pobtot = resolved_cols.get("POBTOT")
    rural_pop_by_cvegeo: dict[str, float] = {}
    has_locality_rows = is_locality_row.any()

    if has_locality_rows and col_pobtot:
        loc_df = df.loc[is_locality_row].copy()
        loc_cvegeo = ent_series.loc[is_locality_row] + mun_series.loc[is_locality_row]
        loc_pobtot = to_num(loc_df[col_pobtot])
        
        # Filter localities with population < 2500
        is_rural_loc = (loc_pobtot >= 0) & (loc_pobtot < 2500)
        rural_pobs = loc_pobtot.where(is_rural_loc, 0.0)
        rural_sum_df = pd.DataFrame({"cvegeo": loc_cvegeo, "rural_pop": rural_pobs})
        rural_pop_by_cvegeo = rural_sum_df.groupby("cvegeo")["rural_pop"].sum().to_dict()

    # 2. Extract municipal rows
    mun_df = df.loc[is_municipal_row].copy()
    if mun_df.empty:
        logger.warning("No municipal rows (LOC == 0000) found in %s", source_file)
        empty_df = pd.DataFrame(columns=ITER_OUTPUT_COLUMNS)
        write_parquet(empty_df, output_path)
        return empty_df

    mun_cve_ent = ent_series.loc[is_municipal_row].values
    mun_cve_mun = mun_series.loc[is_municipal_row].values
    cvegeo = [f"{e}{m}" for e, m in zip(mun_cve_ent, mun_cve_mun)]

    col_nom_ent = resolved_cols.get("NOM_ENT")
    col_nom_mun = resolved_cols.get("NOM_MUN")

    nom_ent = mun_df[col_nom_ent].fillna("").astype(str).str.strip().values if col_nom_ent else [""] * len(mun_df)
    nom_mun = mun_df[col_nom_mun].fillna("").astype(str).str.strip().values if col_nom_mun else [""] * len(mun_df)

    def _get_num_col(name: str) -> pd.Series:
        col = resolved_cols.get(name)
        if col and col in mun_df.columns:
            return to_num(mun_df[col]).reset_index(drop=True)
        return pd.Series(np.nan, index=range(len(mun_df)))

    pob_tot = _get_num_col("POBTOT")
    pob_18ymas = _get_num_col("P_18YMAS")
    p_18a24 = _get_num_col("P_18A24")
    pob65_mas = _get_num_col("POB65_MAS")
    graproes = _get_num_col("GRAPROES")
    p_3ymas = _get_num_col("P_3YMAS")
    p3ym_hli = _get_num_col("P3YM_HLI")
    psinder = _get_num_col("PSINDER")
    vph_inter = _get_num_col("VPH_INTER")
    tvivparhab = _get_num_col("TVIVPARHAB")

    # Safe division helper
    def safe_div(num: pd.Series, den: pd.Series, clip_one: bool = True) -> pd.Series:
        valid = (den > 0) & num.notna() & den.notna()
        res = num / den.where(valid, np.nan)
        if clip_one:
            res = res.clip(0.0, 1.0)
        return res

    pct_18_24 = safe_div(p_18a24, pob_18ymas)
    pct_65ymas = safe_div(pob65_mas, pob_18ymas)
    pct_hli = safe_div(p3ym_hli, p_3ymas)
    pct_sin_servsalud = safe_div(psinder, pob_tot)
    pct_internet = safe_div(vph_inter, tvivparhab)

    if has_locality_rows:
        rural_vals = pd.Series([rural_pop_by_cvegeo.get(cg, 0.0) for cg in cvegeo])
        pct_rural = safe_div(rural_vals, pob_tot)
    else:
        pct_rural = pd.Series(np.nan, index=range(len(mun_df)))

    res_df = pd.DataFrame({
        "cvegeo": cvegeo,
        "cve_ent": mun_cve_ent,
        "cve_mun": mun_cve_mun,
        "nom_ent": nom_ent,
        "nom_mun": nom_mun,
        "pob_tot": pob_tot.round().astype("Int64"),
        "pob_18ymas": pob_18ymas.round().astype("Int64"),
        "pct_18_24": pct_18_24.astype(float),
        "pct_65ymas": pct_65ymas.astype(float),
        "graproes": graproes.astype(float),
        "pct_hli": pct_hli.astype(float),
        "pct_sin_servsalud": pct_sin_servsalud.astype(float),
        "pct_internet": pct_internet.astype(float),
        "pct_rural": pct_rural.astype(float),
    })

    # Drop duplicates by cvegeo if any
    res_df = res_df.drop_duplicates(subset=["cvegeo"]).reset_index(drop=True)

    write_parquet(res_df, output_path)
    logger.info("Wrote %d INEGI municipal records to %s", len(res_df), output_path)
    return res_df


def main():
    parser = argparse.ArgumentParser(description="Ingest INEGI ITER 2020 municipal data.")
    parser.add_argument("--raw", default=None, help="Path to raw INEGI directory or file.")
    parser.add_argument("--out", default=None, help="Output parquet path.")
    args = parser.parse_args()

    process_inegi_iter(raw_path=args.raw, out_path=args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
