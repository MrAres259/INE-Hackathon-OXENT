"""Features assembly module: merges INEGI ITER and CONAPO metrics.

Produces data/build/features.parquet (§4.3).
"""

from __future__ import annotations

import argparse
import logging
from pathlib import Path
import sys

import numpy as np
import pandas as pd

from atalaya.config import BUILD_DIR, SEED_DIR
from atalaya.ingest.common import (
    read_parquet,
    write_parquet,
    zpad,
)

logger = logging.getLogger(__name__)

FEATURES_COLUMNS = [
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
    "pct_analfabeta",
    "pct_po2sm",
    "im_2020",
    "gm_2020",
    "new_since_2020",
]


def load_states_map(states_csv_path: Path | str | None = None) -> dict[str, str]:
    """Load cve_ent -> state name mapping from seed/states.csv."""
    path = Path(states_csv_path) if states_csv_path else SEED_DIR / "states.csv"
    if not path.is_file():
        return {}
    df = pd.read_csv(path, dtype=str)
    res = {}
    for _, row in df.iterrows():
        ent = zpad(row.get("cve_ent", ""), 2)
        name = str(row.get("name", "")).strip()
        if ent and name:
            res[ent] = name
    return res


def process_features(
    inegi_path: Path | str | None = None,
    conapo_path: Path | str | None = None,
    states_path: Path | str | None = None,
    geo_catalog_path: Path | str | None = None,
    out_path: Path | str | None = None,
) -> pd.DataFrame:
    """Merge INEGI ITER and CONAPO datasets into canonical features.parquet."""
    inegi_file = Path(inegi_path) if inegi_path else BUILD_DIR / "inegi_mun.parquet"
    conapo_file = Path(conapo_path) if conapo_path else BUILD_DIR / "conapo_mun.parquet"
    geo_file = Path(geo_catalog_path) if geo_catalog_path else BUILD_DIR / "geo_mun_catalog.csv"
    output_file = Path(out_path) if out_path else BUILD_DIR / "features.parquet"

    states_map = load_states_map(states_path)

    inegi_df = (
        read_parquet(inegi_file)
        if inegi_file.is_file()
        else pd.DataFrame()
    )
    conapo_df = (
        read_parquet(conapo_file)
        if conapo_file.is_file()
        else pd.DataFrame()
    )

    if inegi_df.empty and conapo_df.empty and not geo_file.is_file():
        logger.warning("Both inegi_mun and conapo_mun are empty, no geo catalog. Writing empty features.parquet.")
        empty_df = pd.DataFrame(columns=FEATURES_COLUMNS)
        write_parquet(empty_df, output_file)
        return empty_df

    if geo_file.is_file():
        # Universe = geo_mun_catalog.csv (MG 2024: 2,478 municipalities)
        logger.info("Using MG 2024 catalog from %s as universe", geo_file)
        geo_df = pd.read_csv(geo_file, dtype=str)
        geo_df["cvegeo"] = geo_df["cvegeo"].apply(lambda v: zpad(v, 5))
        geo_df["cve_ent"] = geo_df["cvegeo"].str[:2]
        geo_df["cve_mun"] = geo_df["cvegeo"].str[2:]

        name_col = "name" if "name" in geo_df.columns else ("nom_mun" if "nom_mun" in geo_df.columns else None)
        if name_col:
            geo_df["nom_mun"] = geo_df[name_col].fillna("").astype(str).str.strip()
        else:
            geo_df["nom_mun"] = ""

        geo_df["nom_ent"] = geo_df["cve_ent"].map(states_map).fillna("")
        merged = geo_df[["cvegeo", "cve_ent", "cve_mun", "nom_ent", "nom_mun"]].drop_duplicates(subset=["cvegeo"]).copy()

        iter_cvegeos = set(inegi_df["cvegeo"].dropna().astype(str)) if not inegi_df.empty else set()
        conapo_cvegeos = set(conapo_df["cvegeo"].dropna().astype(str)) if not conapo_df.empty else set()
        merged["new_since_2020"] = ~merged["cvegeo"].isin(iter_cvegeos | conapo_cvegeos)

        # Left join with ITER
        if not inegi_df.empty:
            inegi_df["cvegeo"] = inegi_df["cvegeo"].astype(str)
            inegi_cols = [c for c in inegi_df.columns if c not in ["cve_ent", "cve_mun", "nom_ent", "nom_mun"]]
            merged = pd.merge(merged, inegi_df[inegi_cols], on="cvegeo", how="left")

        # Left join with CONAPO
        if not conapo_df.empty:
            conapo_df["cvegeo"] = conapo_df["cvegeo"].astype(str)
            conapo_cols = [c for c in conapo_df.columns if c not in ["cve_ent", "cve_mun", "nom_ent", "nom_mun", "nom_mun_conapo", "pob_tot_conapo"]]
            merged = pd.merge(merged, conapo_df[conapo_cols], on="cvegeo", how="left")
            if "pob_tot_conapo" in conapo_df.columns and "pob_tot" in merged.columns:
                pob_map = conapo_df.set_index("cvegeo")["pob_tot_conapo"].to_dict()
                merged["pob_tot"] = merged["pob_tot"].fillna(merged["cvegeo"].map(pob_map))
    else:
        # Fallback: Outer join on cvegeo
        if not inegi_df.empty and not conapo_df.empty:
            inegi_df["cvegeo"] = inegi_df["cvegeo"].astype(str)
            conapo_df["cvegeo"] = conapo_df["cvegeo"].astype(str)
            merged = pd.merge(inegi_df, conapo_df, on="cvegeo", how="outer")
        elif not inegi_df.empty:
            merged = inegi_df.copy()
            for col in ["nom_mun_conapo", "pob_tot_conapo", "pct_analfabeta", "pct_po2sm", "im_2020", "gm_2020"]:
                merged[col] = np.nan
        else:
            merged = conapo_df.copy()
            for col in [
                "cve_ent", "cve_mun", "nom_ent", "nom_mun", "pob_tot", "pob_18ymas",
                "pct_18_24", "pct_65ymas", "graproes", "pct_hli", "pct_sin_servsalud",
                "pct_internet", "pct_rural"
            ]:
                merged[col] = np.nan

        # Validate and clean cvegeo
        merged["cvegeo"] = merged["cvegeo"].astype(str).str.strip()
        merged = merged[merged["cvegeo"].str.len() == 5].copy()
        merged = merged[~merged["cvegeo"].str.endswith("000")].copy()

        # Reconcile geographic identifiers
        cve_ent = merged["cvegeo"].str[:2]
        cve_mun = merged["cvegeo"].str[2:]

        merged["cve_ent"] = merged["cve_ent"].fillna(cve_ent)
        merged["cve_mun"] = merged["cve_mun"].fillna(cve_mun)

        # Reconcile names
        merged["nom_ent"] = merged["nom_ent"].fillna("")
        missing_ent_mask = merged["nom_ent"].str.strip() == ""
        merged.loc[missing_ent_mask, "nom_ent"] = merged.loc[missing_ent_mask, "cve_ent"].map(states_map).fillna("")

        merged["nom_mun"] = merged["nom_mun"].fillna("")
        missing_mun_mask = merged["nom_mun"].str.strip() == ""
        if "nom_mun_conapo" in merged.columns:
            conapo_names = merged["nom_mun_conapo"].fillna("").astype(str).str.strip()
            merged.loc[missing_mun_mask, "nom_mun"] = conapo_names[missing_mun_mask]

        if "pob_tot_conapo" in merged.columns:
            merged["pob_tot"] = merged["pob_tot"].fillna(merged["pob_tot_conapo"])

        merged["new_since_2020"] = False

    # Ensure all target columns exist and are ordered
    for col in FEATURES_COLUMNS:
        if col not in merged.columns:
            merged[col] = np.nan

    res_df = merged[FEATURES_COLUMNS].copy()

    # Validation
    dup_count = res_df["cvegeo"].duplicated().sum()
    if dup_count > 0:
        logger.warning("Found %d duplicate cvegeo records in features. Deduplicating.", dup_count)
        res_df = res_df.drop_duplicates(subset=["cvegeo"]).reset_index(drop=True)

    total_muns = len(res_df)
    logger.info("Features assembled: %d municipalities", total_muns)
    nan_summary = res_df.isna().sum().to_dict()
    logger.info("NaN count per column: %s", nan_summary)
    print(f"[features] Total municipalities: {total_muns}")
    for col, n_nan in nan_summary.items():
        if n_nan > 0:
            print(f"  {col}: {n_nan} NaNs ({n_nan/total_muns*100:.1f}%)" if total_muns > 0 else f"  {col}: 0")

    write_parquet(res_df, output_file)
    logger.info("Saved features to %s", output_file)
    return res_df


def main():
    parser = argparse.ArgumentParser(description="Assemble municipal features.")
    parser.add_argument("--inegi", default=None, help="Path to inegi_mun.parquet.")
    parser.add_argument("--conapo", default=None, help="Path to conapo_mun.parquet.")
    parser.add_argument("--geo-catalog", default=None, help="Path to geo_mun_catalog.csv.")
    parser.add_argument("--states", default=None, help="Path to seed/states.csv.")
    parser.add_argument("--out", default=None, help="Output features.parquet path.")
    args = parser.parse_args()

    process_features(
        inegi_path=args.inegi,
        conapo_path=args.conapo,
        geo_catalog_path=args.geo_catalog,
        states_path=args.states,
        out_path=args.out,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)

