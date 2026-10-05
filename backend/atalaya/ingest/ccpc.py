"""CCPC (Conteos Censales de Participación Ciudadana) ingestion module.

Primary electoral participation data source for ATALAYA (2009-2024 DIP_FED, 2025 PJF).
Produces:
- data/build/participation_ine.parquet
- data/build/ccpc_profile.parquet
- data/build/ccpc_seccion.parquet
"""

from __future__ import annotations

import argparse
import logging
from pathlib import Path
import re
import sys
import time
import zipfile

import numpy as np
import pandas as pd

from atalaya.config import BUILD_DIR, RAW_DIR
from atalaya.ingest.common import norm_col, norm_name, write_parquet, zpad

logger = logging.getLogger(__name__)

# File patterns
FEDERAL_ZIP_RE = re.compile(
    r"^(?:DatosAbiertos_DECEyEC_)?ConteosCensales(\d{4})\.zip$",
    re.IGNORECASE,
)
PJ_ZIP_RE = re.compile(
    r"^(?:DatosAbiertos_DECEyEC_)?ConteosCensalesPJ(\d{4})\.zip$",
    re.IGNORECASE,
)

# Output column schemas (§10.3)
PARTICIPATION_INE_COLUMNS = [
    "cve_ent",
    "ine_mun",
    "mun_name",
    "mun_norm",
    "year",
    "election",
    "lista_nominal",
    "votos_totales",
    "participacion",
    "source_file",
    "nv",
    "ns",
]

CCPC_PROFILE_COLUMNS = [
    "cve_ent",
    "ine_mun",
    "mun_norm",
    "year",
    "election",
    "age_group",
    "sexo",
    "ln",
    "sv",
    "nv",
    "ns",
]

CCPC_SECCION_COLUMNS = [
    "cve_ent",
    "ine_mun",
    "mun_norm",
    "seccion",
    "tiposec",
    "def",
    "year",
    "election",
    "ln",
    "sv",
    "nv",
    "ns",
    "participacion",
]

AGE_BINS = [17, 24, 34, 44, 54, 64, 200]
AGE_LABELS = ["18-24", "25-34", "35-44", "45-54", "55-64", "65+"]
SEXO_MAP = {
    0: "H",
    1: "M",
    2: "X",
    "0": "H",
    "1": "M",
    "2": "X",
    "H": "H",
    "M": "M",
    "X": "X",
    "h": "H",
    "m": "M",
    "x": "X",
}


def create_empty_participation_ine_df() -> pd.DataFrame:
    """Create empty DataFrame matching participation_ine schema (§10.3)."""
    return pd.DataFrame({
        "cve_ent": pd.Series(dtype=object),
        "ine_mun": pd.Series(dtype="Int64"),
        "mun_name": pd.Series(dtype=object),
        "mun_norm": pd.Series(dtype=object),
        "year": pd.Series(dtype=np.int64),
        "election": pd.Series(dtype=object),
        "lista_nominal": pd.Series(dtype=np.int64),
        "votos_totales": pd.Series(dtype=np.int64),
        "participacion": pd.Series(dtype=np.float64),
        "source_file": pd.Series(dtype=object),
        "nv": pd.Series(dtype=np.int64),
        "ns": pd.Series(dtype=np.int64),
    })


def create_empty_ccpc_profile_df() -> pd.DataFrame:
    """Create empty DataFrame matching ccpc_profile schema (§10.3)."""
    return pd.DataFrame({
        "cve_ent": pd.Series(dtype=object),
        "ine_mun": pd.Series(dtype="Int64"),
        "mun_norm": pd.Series(dtype=object),
        "year": pd.Series(dtype=np.int64),
        "election": pd.Series(dtype=object),
        "age_group": pd.Series(dtype=object),
        "sexo": pd.Series(dtype=object),
        "ln": pd.Series(dtype=np.int64),
        "sv": pd.Series(dtype=np.int64),
        "nv": pd.Series(dtype=np.int64),
        "ns": pd.Series(dtype=np.int64),
    })


def create_empty_ccpc_seccion_df() -> pd.DataFrame:
    """Create empty DataFrame matching ccpc_seccion schema (§10.3)."""
    return pd.DataFrame({
        "cve_ent": pd.Series(dtype=object),
        "ine_mun": pd.Series(dtype="Int64"),
        "mun_norm": pd.Series(dtype=object),
        "seccion": pd.Series(dtype=np.int64),
        "tiposec": pd.Series(dtype=object),
        "def": pd.Series(dtype="Int64"),
        "year": pd.Series(dtype=np.int64),
        "election": pd.Series(dtype=object),
        "ln": pd.Series(dtype=np.int64),
        "sv": pd.Series(dtype=np.int64),
        "nv": pd.Series(dtype=np.int64),
        "ns": pd.Series(dtype=np.int64),
        "participacion": pd.Series(dtype=np.float64),
    })


def discover_zips(raw_dir: Path, requested_years: set[int] | None = None) -> list[tuple[int, str, Path]]:
    """Discover CCPC zip files in raw_dir, returning sorted (year, election, path)."""
    if not raw_dir.is_dir():
        return []

    found = []
    for f in raw_dir.iterdir():
        if not f.is_file() or not f.name.lower().endswith(".zip"):
            continue

        m_fed = FEDERAL_ZIP_RE.match(f.name)
        if m_fed:
            y = int(m_fed.group(1))
            if requested_years is None or y in requested_years:
                found.append((y, "DIP_FED", f))
            continue

        m_pj = PJ_ZIP_RE.match(f.name)
        if m_pj:
            y = int(m_pj.group(1))
            if requested_years is None or y in requested_years:
                found.append((y, "PJF", f))
            continue

    return sorted(found, key=lambda x: (x[0], x[1]))


def process_ccpc_csv(
    file_obj,
    election: str,
    year: int,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Process a single state CSV inside a CCPC zip and return (mun_agg, prof_agg, sec_agg)."""
    # Read first line to detect exact column names
    first_line = file_obj.readline().decode("utf-8-sig", errors="ignore").strip()
    raw_cols = [c.strip() for c in first_line.split(",") if c.strip()]
    col_norm_map = {norm_col(c): c for c in raw_cols}

    def _get_col(name: str) -> str | None:
        return col_norm_map.get(norm_col(name))

    col_edocve = _get_col("EDOCVE")
    col_mpiocve = _get_col("MPIOCVE")
    col_mpionom = _get_col("MPIONOM")
    col_seccion = _get_col("SECCION")
    col_sexo = _get_col("SEXO")
    col_edad = _get_col("EDAD")
    col_ln = _get_col("LN")
    col_sv = _get_col("SV")
    col_nv = _get_col("NV")
    col_ns = _get_col("NS")
    col_tiposec = _get_col("TIPOSEC")
    col_def = _get_col("DEF")

    required = [
        col_edocve,
        col_mpiocve,
        col_mpionom,
        col_seccion,
        col_sexo,
        col_edad,
        col_ln,
        col_sv,
        col_nv,
        col_ns,
    ]
    if any(c is None for c in required):
        raise ValueError(
            f"Missing required CCPC columns in CSV. Available: {raw_cols}"
        )

    usecols = [c for c in [
        col_edocve,
        col_mpiocve,
        col_mpionom,
        col_seccion,
        col_sexo,
        col_edad,
        col_ln,
        col_sv,
        col_nv,
        col_ns,
        col_tiposec,
        col_def,
    ] if c is not None]

    dtypes: dict[str, str] = {
        col_edocve: "int16",
        col_mpiocve: "int32",
        col_seccion: "int32",
        col_sexo: "int8",
        col_edad: "int16",
        col_ln: "Int64",
        col_sv: "Int64",
        col_nv: "Int64",
        col_ns: "Int64",
        col_mpionom: "str",
    }

    # Reset position and read
    file_obj.seek(0)
    df = pd.read_csv(
        file_obj,
        usecols=usecols,
        dtype=dtypes,
        na_values=[" ", ""],
        encoding="utf-8-sig",
    )

    if df.empty:
        empty_mun = pd.DataFrame(columns=["EDOCVE", "MPIOCVE", "MPIONOM", "LN", "SV", "NV", "NS"])
        empty_prof = pd.DataFrame(columns=["EDOCVE", "MPIOCVE", "MPIONOM", "age_group", "sexo", "LN", "SV", "NV", "NS"])
        empty_sec = pd.DataFrame(columns=["EDOCVE", "MPIOCVE", "MPIONOM", "SECCION", "TIPOSEC", "DEF", "LN", "SV", "NV", "NS"])
        return empty_mun, empty_prof, empty_sec

    # Standardize column names internally
    rename_dict = {
        col_edocve: "EDOCVE",
        col_mpiocve: "MPIOCVE",
        col_mpionom: "MPIONOM",
        col_seccion: "SECCION",
        col_sexo: "SEXO",
        col_edad: "EDAD",
        col_ln: "LN",
        col_sv: "SV",
        col_nv: "NV",
        col_ns: "NS",
    }
    if col_tiposec:
        rename_dict[col_tiposec] = "TIPOSEC"
    if col_def:
        rename_dict[col_def] = "DEF"

    df = df.rename(columns=rename_dict)

    for c in ["LN", "SV", "NV", "NS"]:
        df[c] = df[c].fillna(0).astype("int64")

    if "TIPOSEC" not in df.columns:
        df["TIPOSEC"] = pd.Series([pd.NA] * len(df), dtype="string")
    else:
        df["TIPOSEC"] = df["TIPOSEC"].astype("string")

    if "DEF" not in df.columns:
        df["DEF"] = pd.Series([pd.NA] * len(df), dtype="Int64")
    else:
        df["DEF"] = pd.to_numeric(df["DEF"], errors="coerce").astype("Int64")

    # Name normalization: most frequent MPIONOM for each (EDOCVE, MPIOCVE)
    name_counts = (
        df.groupby(["EDOCVE", "MPIOCVE", "MPIONOM"], observed=False)
        .size()
        .reset_index(name="_cnt")
    )
    best_names = (
        name_counts.sort_values(by="_cnt", ascending=False)
        .drop_duplicates(subset=["EDOCVE", "MPIOCVE"])
    )
    name_map = dict(
        zip(
            zip(best_names["EDOCVE"], best_names["MPIOCVE"]),
            best_names["MPIONOM"],
        )
    )
    df["MPIONOM"] = [name_map[(e, m)] for e, m in zip(df["EDOCVE"], df["MPIOCVE"])]

    # 1. Municipality aggregation
    mun_agg = (
        df.groupby(["EDOCVE", "MPIOCVE", "MPIONOM"], as_index=False, observed=False)[
            ["LN", "SV", "NV", "NS"]
        ].sum()
    )

    # 2. Profile aggregation (age_group & sexo)
    df["age_group"] = pd.cut(
        df["EDAD"], bins=AGE_BINS, labels=AGE_LABELS, right=True
    ).astype(str)
    df["sexo"] = df["SEXO"].map(SEXO_MAP).fillna("H")

    prof_agg = (
        df.groupby(
            ["EDOCVE", "MPIOCVE", "MPIONOM", "age_group", "sexo"],
            as_index=False,
            observed=False,
        )[["LN", "SV", "NV", "NS"]].sum()
    )

    # 3. Section aggregation
    sec_agg = (
        df.groupby(
            ["EDOCVE", "MPIOCVE", "MPIONOM", "SECCION", "TIPOSEC", "DEF"],
            as_index=False,
            observed=False,
            dropna=False,
        )[["LN", "SV", "NV", "NS"]].sum()
    )

    return mun_agg, prof_agg, sec_agg


def process_zip(
    zip_path: Path,
    year: int,
    election: str,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Process a single CCPC zip file and return (df_mun, df_prof, df_sec)."""
    t0 = time.time()
    mun_chunks = []
    prof_chunks = []
    sec_chunks = []

    with zipfile.ZipFile(zip_path, "r") as z:
        csv_members = sorted([
            m for m in z.namelist()
            if m.lower().endswith(".csv") and "descripcion" not in m.lower()
        ])

        for member in csv_members:
            with z.open(member) as f:
                m_agg, p_agg, s_agg = process_ccpc_csv(f, election=election, year=year)
                if not m_agg.empty:
                    mun_chunks.append(m_agg)
                if not p_agg.empty:
                    prof_chunks.append(p_agg)
                if not s_agg.empty:
                    sec_chunks.append(s_agg)

    if not mun_chunks:
        return (
            create_empty_participation_ine_df(),
            create_empty_ccpc_profile_df(),
            create_empty_ccpc_seccion_df(),
        )

    # Combine chunk aggregations
    raw_mun = pd.concat(mun_chunks, ignore_index=True)
    raw_prof = pd.concat(prof_chunks, ignore_index=True)
    raw_sec = pd.concat(sec_chunks, ignore_index=True)

    # 1. Format participation_ine
    raw_mun["cve_ent"] = raw_mun["EDOCVE"].apply(lambda x: zpad(x, 2))
    raw_mun["ine_mun"] = raw_mun["MPIOCVE"].astype("Int64")
    raw_mun["mun_name"] = raw_mun["MPIONOM"].astype(str)
    raw_mun["mun_norm"] = raw_mun["mun_name"].apply(norm_name)
    raw_mun["year"] = int(year)
    raw_mun["election"] = election
    raw_mun["lista_nominal"] = raw_mun["LN"].astype(np.int64)
    raw_mun["votos_totales"] = raw_mun["SV"].astype(np.int64)
    raw_mun["nv"] = raw_mun["NV"].astype(np.int64)
    raw_mun["ns"] = raw_mun["NS"].astype(np.int64)
    raw_mun["source_file"] = zip_path.name

    # In case the same (cve_ent, ine_mun) was split across CSVs, re-aggregate
    df_mun = (
        raw_mun.groupby(
            ["cve_ent", "ine_mun", "mun_name", "mun_norm", "year", "election", "source_file"],
            as_index=False,
            observed=False,
        )[["lista_nominal", "votos_totales", "nv", "ns"]].sum()
    )
    denom = df_mun["votos_totales"] + df_mun["nv"]
    df_mun["participacion"] = np.where(
        denom > 0,
        np.minimum(1.0, df_mun["votos_totales"] / denom),
        np.nan,
    )
    df_mun = df_mun[PARTICIPATION_INE_COLUMNS]

    # 2. Format ccpc_profile
    raw_prof["cve_ent"] = raw_prof["EDOCVE"].apply(lambda x: zpad(x, 2))
    raw_prof["ine_mun"] = raw_prof["MPIOCVE"].astype("Int64")
    raw_prof["mun_norm"] = raw_prof["MPIONOM"].apply(norm_name)
    raw_prof["year"] = int(year)
    raw_prof["election"] = election
    raw_prof["age_group"] = raw_prof["age_group"].astype(str)
    raw_prof["sexo"] = raw_prof["sexo"].astype(str)
    raw_prof["ln"] = raw_prof["LN"].astype(np.int64)
    raw_prof["sv"] = raw_prof["SV"].astype(np.int64)
    raw_prof["nv"] = raw_prof["NV"].astype(np.int64)
    raw_prof["ns"] = raw_prof["NS"].astype(np.int64)

    df_prof = (
        raw_prof.groupby(
            ["cve_ent", "ine_mun", "mun_norm", "year", "election", "age_group", "sexo"],
            as_index=False,
            observed=False,
        )[["ln", "sv", "nv", "ns"]].sum()
    )
    df_prof = df_prof[CCPC_PROFILE_COLUMNS]

    # 3. Format ccpc_seccion
    raw_sec["cve_ent"] = raw_sec["EDOCVE"].apply(lambda x: zpad(x, 2))
    raw_sec["ine_mun"] = raw_sec["MPIOCVE"].astype("Int64")
    raw_sec["mun_norm"] = raw_sec["MPIONOM"].apply(norm_name)
    raw_sec["seccion"] = raw_sec["SECCION"].astype(np.int64)
    raw_sec["tiposec"] = raw_sec["TIPOSEC"]
    raw_sec["def"] = raw_sec["DEF"].astype("Int64")
    raw_sec["year"] = int(year)
    raw_sec["election"] = election
    raw_sec["ln"] = raw_sec["LN"].astype(np.int64)
    raw_sec["sv"] = raw_sec["SV"].astype(np.int64)
    raw_sec["nv"] = raw_sec["NV"].astype(np.int64)
    raw_sec["ns"] = raw_sec["NS"].astype(np.int64)

    df_sec = (
        raw_sec.groupby(
            ["cve_ent", "ine_mun", "mun_norm", "seccion", "tiposec", "def", "year", "election"],
            as_index=False,
            observed=False,
            dropna=False,
        )[["ln", "sv", "nv", "ns"]].sum()
    )
    denom_sec = df_sec["sv"] + df_sec["nv"]
    df_sec["participacion"] = np.where(
        denom_sec > 0,
        np.minimum(1.0, df_sec["sv"] / denom_sec),
        np.nan,
    )
    df_sec = df_sec[CCPC_SECCION_COLUMNS]

    elapsed = time.time() - t0
    n_mun = len(df_mun)
    tot_ln = df_mun["lista_nominal"].sum()
    tot_sv = df_mun["votos_totales"].sum()
    tot_nv = df_mun["nv"].sum()
    denom_nat = tot_sv + tot_nv
    part_nat = (tot_sv / denom_nat * 100) if denom_nat > 0 else 0.0

    print(
        f"[{election} {year}] {n_mun:,d} municipios | "
        f"LN: {tot_ln:,d} | Participación: {part_nat:.2f}% | {elapsed:.1f}s"
    )

    # Required sanity check for 2024 national DIP_FED
    if year == 2024 and election == "DIP_FED" and n_mun > 1000:
        if tot_ln != 98330348:
            logger.warning(
                "Sanity check 2024 LN mismatch: expected 98,330,348, got %d",
                tot_ln,
            )
        if abs(part_nat - 59.67) > 0.05:
            logger.warning(
                "Sanity check 2024 participation mismatch: expected ~59.67%%, got %.4f%%",
                part_nat,
            )

    return df_mun, df_prof, df_sec


def ingest_ccpc(
    raw_dir: Path | str | None = None,
    out_dir: Path | str | None = None,
    years: Sequence[int] | set[int] | None = None,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Execute CCPC ingestion and write participation_ine, ccpc_profile, and ccpc_seccion parquets."""
    raw_dir = Path(raw_dir) if raw_dir else (RAW_DIR / "ccpc")
    out_dir = Path(out_dir) if out_dir else BUILD_DIR

    req_years = set(years) if years is not None else None
    discovered = discover_zips(raw_dir, req_years)

    out_part = out_dir / "participation_ine.parquet"
    out_prof = out_dir / "ccpc_profile.parquet"
    out_sec = out_dir / "ccpc_seccion.parquet"

    if not discovered:
        print(f"Carpeta vacía o sin zips CCPC válidos en {raw_dir}. Escribiendo parquets vacíos.")
        empty_mun = create_empty_participation_ine_df()
        empty_prof = create_empty_ccpc_profile_df()
        empty_sec = create_empty_ccpc_seccion_df()
        write_parquet(empty_mun, out_part)
        write_parquet(empty_prof, out_prof)
        write_parquet(empty_sec, out_sec)
        return empty_mun, empty_prof, empty_sec

    all_mun = []
    all_prof = []
    all_sec = []

    for year, election, zip_path in discovered:
        df_mun, df_prof, df_sec = process_zip(zip_path, year=year, election=election)
        if not df_mun.empty:
            all_mun.append(df_mun)
        if not df_prof.empty:
            all_prof.append(df_prof)
        if not df_sec.empty:
            all_sec.append(df_sec)

    if not all_mun:
        empty_mun = create_empty_participation_ine_df()
        empty_prof = create_empty_ccpc_profile_df()
        empty_sec = create_empty_ccpc_seccion_df()
        write_parquet(empty_mun, out_part)
        write_parquet(empty_prof, out_prof)
        write_parquet(empty_sec, out_sec)
        return empty_mun, empty_prof, empty_sec

    final_mun = (
        pd.concat(all_mun, ignore_index=True)
        .sort_values(by=["year", "election", "cve_ent", "ine_mun"])
        .reset_index(drop=True)
    )
    final_prof = (
        pd.concat(all_prof, ignore_index=True)
        .sort_values(by=["year", "election", "cve_ent", "ine_mun", "age_group", "sexo"])
        .reset_index(drop=True)
    )
    final_sec = (
        pd.concat(all_sec, ignore_index=True)
        .sort_values(by=["year", "election", "cve_ent", "ine_mun", "seccion"])
        .reset_index(drop=True)
    )

    write_parquet(final_mun, out_part)
    write_parquet(final_prof, out_prof)
    write_parquet(final_sec, out_sec)

    print(
        f"Guardados {len(final_mun):,d} registros en {out_part.name}, "
        f"{len(final_prof):,d} en {out_prof.name}, {len(final_sec):,d} en {out_sec.name}"
    )

    return final_mun, final_prof, final_sec


def main() -> int:
    """CLI entrypoint for CCPC ingestion."""
    parser = argparse.ArgumentParser(description="Ingesta de Plataforma CCPC (INE)")
    parser.add_argument("--raw-dir", type=str, default=None, help="Ruta a data/raw/ccpc")
    parser.add_argument("--out-dir", type=str, default=None, help="Ruta a data/build")
    parser.add_argument("--years", type=str, default=None, help="Años a procesar (ej. 2009,2024)")

    args = parser.parse_args()

    years = None
    if args.years:
        years = []
        for piece in args.years.split(","):
            piece = piece.strip()
            if piece.isdigit():
                years.append(int(piece))

    ingest_ccpc(raw_dir=args.raw_dir, out_dir=args.out_dir, years=years)
    return 0


if __name__ == "__main__":
    sys.exit(main())
