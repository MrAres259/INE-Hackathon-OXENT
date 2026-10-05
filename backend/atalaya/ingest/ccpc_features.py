"""Compute CCPC municipal features for ATALAYA models and dashboards.

Produces data/build/ccpc_features.parquet from ccpc_profile_mun.parquet
and ccpc_seccion_mun.parquet (§10.3).
"""

from __future__ import annotations

import argparse
import logging
from pathlib import Path
import sys

import numpy as np
import pandas as pd

from atalaya.config import BUILD_DIR
from atalaya.ingest.common import read_parquet, write_parquet, zpad

logger = logging.getLogger(__name__)

CCPC_FEATURES_COLUMNS = [
    "cvegeo",
    "cve_ent",
    "year",
    "pct_ln_18_34",
    "part_18_34",
    "part_total",
    "gap_youth_pp",
    "gap_sexo_pp",
    "pct_ln_rural",
    "pct_ln_urbana",
    "ns_rate",
]


def create_empty_ccpc_features_df() -> pd.DataFrame:
    """Create empty DataFrame matching ccpc_features schema (§10.3)."""
    return pd.DataFrame({
        "cvegeo": pd.Series(dtype=object),
        "cve_ent": pd.Series(dtype=object),
        "year": pd.Series(dtype=np.int64),
        "pct_ln_18_34": pd.Series(dtype=np.float64),
        "part_18_34": pd.Series(dtype=np.float64),
        "part_total": pd.Series(dtype=np.float64),
        "gap_youth_pp": pd.Series(dtype=np.float64),
        "gap_sexo_pp": pd.Series(dtype=np.float64),
        "pct_ln_rural": pd.Series(dtype=np.float64),
        "pct_ln_urbana": pd.Series(dtype=np.float64),
        "ns_rate": pd.Series(dtype=np.float64),
    })


def compute_profile_indicators(df_prof: pd.DataFrame) -> pd.DataFrame:
    """Compute municipal indicators derived from ccpc_profile_mun (§10.3)."""
    if df_prof.empty:
        return pd.DataFrame(
            columns=[
                "cvegeo",
                "year",
                "cve_ent",
                "pct_ln_18_34",
                "part_18_34",
                "part_total",
                "gap_youth_pp",
                "gap_sexo_pp",
                "ns_rate",
            ]
        )

    # Filter to DIP_FED elections only
    if "election" in df_prof.columns:
        df = df_prof[df_prof["election"] == "DIP_FED"].copy()
    else:
        df = df_prof.copy()

    if df.empty:
        return pd.DataFrame(
            columns=[
                "cvegeo",
                "year",
                "cve_ent",
                "pct_ln_18_34",
                "part_18_34",
                "part_total",
                "gap_youth_pp",
                "gap_sexo_pp",
                "ns_rate",
            ]
        )

    # Ensure required columns
    df["cvegeo"] = df["cvegeo"].astype(str).str.zfill(5)
    df["year"] = df["year"].astype(int)
    for col in ["ln", "sv", "nv", "ns"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
        else:
            df[col] = 0

    # Overall totals by (cvegeo, year)
    totals = (
        df.groupby(["cvegeo", "year"], as_index=False, observed=False)[["ln", "sv", "nv", "ns"]]
        .sum()
        .rename(columns={"ln": "ln_tot", "sv": "sv_tot", "nv": "nv_tot", "ns": "ns_tot"})
    )

    # part_total and ns_rate
    denom_tot = totals["sv_tot"] + totals["nv_tot"]
    totals["part_total"] = np.where(denom_tot > 0, totals["sv_tot"] / denom_tot, np.nan)
    totals["ns_rate"] = np.where(totals["ln_tot"] > 0, totals["ns_tot"] / totals["ln_tot"], np.nan)

    # Youth (18-24 and 25-34)
    youth_mask = df["age_group"].isin(["18-24", "25-34"])
    youth = (
        df[youth_mask]
        .groupby(["cvegeo", "year"], as_index=False, observed=False)[["ln", "sv", "nv"]]
        .sum()
        .rename(columns={"ln": "ln_youth", "sv": "sv_youth", "nv": "nv_youth"})
    )

    merged = pd.merge(totals, youth, on=["cvegeo", "year"], how="left")
    merged["ln_youth"] = merged["ln_youth"].fillna(0)
    merged["sv_youth"] = merged["sv_youth"].fillna(0)
    merged["nv_youth"] = merged["nv_youth"].fillna(0)

    merged["pct_ln_18_34"] = np.where(
        merged["ln_tot"] > 0,
        merged["ln_youth"] / merged["ln_tot"],
        np.nan,
    )
    denom_youth = merged["sv_youth"] + merged["nv_youth"]
    merged["part_18_34"] = np.where(
        denom_youth > 0,
        merged["sv_youth"] / denom_youth,
        np.nan,
    )
    merged["gap_youth_pp"] = np.where(
        merged["part_18_34"].notna() & merged["part_total"].notna(),
        (merged["part_18_34"] - merged["part_total"]) * 100.0,
        np.nan,
    )

    # Sex breakdown (H and M, ignoring X)
    fem = (
        df[df["sexo"] == "M"]
        .groupby(["cvegeo", "year"], as_index=False, observed=False)[["sv", "nv"]]
        .sum()
        .rename(columns={"sv": "sv_m", "nv": "nv_m"})
    )
    denom_m = fem["sv_m"] + fem["nv_m"]
    fem["part_m"] = np.where(denom_m > 0, fem["sv_m"] / denom_m, np.nan)

    masc = (
        df[df["sexo"] == "H"]
        .groupby(["cvegeo", "year"], as_index=False, observed=False)[["sv", "nv"]]
        .sum()
        .rename(columns={"sv": "sv_h", "nv": "nv_h"})
    )
    denom_h = masc["sv_h"] + masc["nv_h"]
    masc["part_h"] = np.where(denom_h > 0, masc["sv_h"] / denom_h, np.nan)

    merged = pd.merge(merged, fem[["cvegeo", "year", "part_m"]], on=["cvegeo", "year"], how="left")
    merged = pd.merge(merged, masc[["cvegeo", "year", "part_h"]], on=["cvegeo", "year"], how="left")

    merged["gap_sexo_pp"] = np.where(
        merged["part_m"].notna() & merged["part_h"].notna(),
        (merged["part_m"] - merged["part_h"]) * 100.0,
        np.nan,
    )

    # Add cve_ent from cvegeo
    merged["cve_ent"] = merged["cvegeo"].apply(lambda g: zpad(g[:2], 2))

    keep_cols = [
        "cvegeo",
        "cve_ent",
        "year",
        "pct_ln_18_34",
        "part_18_34",
        "part_total",
        "gap_youth_pp",
        "gap_sexo_pp",
        "ns_rate",
    ]
    return merged[keep_cols]


def compute_seccion_indicators(df_sec: pd.DataFrame) -> pd.DataFrame:
    """Compute municipal indicators derived from ccpc_seccion_mun (§10.3)."""
    if df_sec.empty:
        return pd.DataFrame(columns=["cvegeo", "year", "pct_ln_rural", "pct_ln_urbana"])

    if "election" in df_sec.columns:
        df = df_sec[df_sec["election"] == "DIP_FED"].copy()
    else:
        df = df_sec.copy()

    if df.empty:
        return pd.DataFrame(columns=["cvegeo", "year", "pct_ln_rural", "pct_ln_urbana"])

    df["cvegeo"] = df["cvegeo"].astype(str).str.zfill(5)
    df["year"] = df["year"].astype(int)
    df["ln"] = pd.to_numeric(df["ln"], errors="coerce").fillna(0)
    df["tiposec_clean"] = df["tiposec"].astype(str).str.strip().str.upper()

    # Total LN from sections
    totals = (
        df.groupby(["cvegeo", "year"], as_index=False, observed=False)["ln"]
        .sum()
        .rename(columns={"ln": "sec_ln_tot"})
    )

    # Rural LN (TIPOSEC == 'R')
    rural = (
        df[df["tiposec_clean"] == "R"]
        .groupby(["cvegeo", "year"], as_index=False, observed=False)["ln"]
        .sum()
        .rename(columns={"ln": "rural_ln"})
    )

    # Urban LN (TIPOSEC == 'U')
    urbana = (
        df[df["tiposec_clean"] == "U"]
        .groupby(["cvegeo", "year"], as_index=False, observed=False)["ln"]
        .sum()
        .rename(columns={"ln": "urbana_ln"})
    )

    merged = pd.merge(totals, rural, on=["cvegeo", "year"], how="left")
    merged = pd.merge(merged, urbana, on=["cvegeo", "year"], how="left")

    merged["rural_ln"] = merged["rural_ln"].fillna(0)
    merged["urbana_ln"] = merged["urbana_ln"].fillna(0)

    merged["pct_ln_rural"] = np.where(
        merged["sec_ln_tot"] > 0,
        merged["rural_ln"] / merged["sec_ln_tot"],
        np.nan,
    )
    merged["pct_ln_urbana"] = np.where(
        merged["sec_ln_tot"] > 0,
        merged["urbana_ln"] / merged["sec_ln_tot"],
        np.nan,
    )

    return merged[["cvegeo", "year", "pct_ln_rural", "pct_ln_urbana"]]


def compute_ccpc_features(
    df_prof_mun: pd.DataFrame | None,
    df_sec_mun: pd.DataFrame | None,
) -> pd.DataFrame:
    """Compute CCPC municipal features by combining profile and section indicators."""
    has_prof = df_prof_mun is not None and not df_prof_mun.empty
    has_sec = df_sec_mun is not None and not df_sec_mun.empty

    if not has_prof and not has_sec:
        return create_empty_ccpc_features_df()

    prof_ind = compute_profile_indicators(df_prof_mun) if has_prof else pd.DataFrame()
    sec_ind = compute_seccion_indicators(df_sec_mun) if has_sec else pd.DataFrame()

    if prof_ind.empty and sec_ind.empty:
        return create_empty_ccpc_features_df()

    if prof_ind.empty:
        res = sec_ind.copy()
        res["cve_ent"] = res["cvegeo"].apply(lambda g: zpad(g[:2], 2))
        for c in ["pct_ln_18_34", "part_18_34", "part_total", "gap_youth_pp", "gap_sexo_pp", "ns_rate"]:
            res[c] = np.nan
    elif sec_ind.empty:
        res = prof_ind.copy()
        res["pct_ln_rural"] = np.nan
        res["pct_ln_urbana"] = np.nan
    else:
        res = pd.merge(prof_ind, sec_ind, on=["cvegeo", "year"], how="outer")
        if "cve_ent" not in res.columns or res["cve_ent"].isna().any():
            res["cve_ent"] = res["cvegeo"].apply(lambda g: zpad(g[:2], 2))

    # Ensure all columns exist and are ordered
    for col in CCPC_FEATURES_COLUMNS:
        if col not in res.columns:
            res[col] = np.nan

    res = (
        res[CCPC_FEATURES_COLUMNS]
        .sort_values(by=["year", "cvegeo"])
        .reset_index(drop=True)
    )
    return res


def ingest_ccpc_features(
    build_dir: Path | str | None = None,
    out_path: Path | str | None = None,
) -> pd.DataFrame:
    """Execute computation of CCPC municipal features and save ccpc_features.parquet."""
    build_dir = Path(build_dir) if build_dir else BUILD_DIR
    out_path = Path(out_path) if out_path else (build_dir / "ccpc_features.parquet")

    prof_path = build_dir / "ccpc_profile_mun.parquet"
    sec_path = build_dir / "ccpc_seccion_mun.parquet"

    df_prof = None
    if prof_path.is_file():
        try:
            df_prof = read_parquet(prof_path)
        except Exception as exc:
            logger.warning("Error reading %s: %s", prof_path, exc)

    df_sec = None
    if sec_path.is_file():
        try:
            df_sec = read_parquet(sec_path)
        except Exception as exc:
            logger.warning("Error reading %s: %s", sec_path, exc)

    if (df_prof is None or df_prof.empty) and (df_sec is None or df_sec.empty):
        print("Insumos ccpc_profile_mun / ccpc_seccion_mun no encontrados. Generando ccpc_features.parquet vacío.")
        empty_df = create_empty_ccpc_features_df()
        write_parquet(empty_df, out_path)
        return empty_df

    features_df = compute_ccpc_features(df_prof, df_sec)
    write_parquet(features_df, out_path)
    print(f"Guardados {len(features_df):,d} registros en {out_path.name}")
    return features_df


def main() -> int:
    """CLI entrypoint for CCPC features generation."""
    parser = argparse.ArgumentParser(description="Cálculo de features municipales CCPC")
    parser.add_argument("--build-dir", type=str, default=None, help="Ruta a data/build")

    args = parser.parse_args()
    ingest_ccpc_features(build_dir=args.build_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
