"""Crosswalk module for mapping INE municipalities to canonical INEGI cvegeo.

Produces data/build/crosswalk.parquet, data/build/participation.parquet,
and data/build/crosswalk_unmatched.csv.
"""

from __future__ import annotations

import argparse
import difflib
import logging
from pathlib import Path
import re
import sys

import numpy as np
import pandas as pd

from atalaya.config import BUILD_DIR, SEED_DIR
from atalaya.ingest.common import (
    norm_name,
    read_parquet,
    write_parquet,
    zpad,
)

logger = logging.getLogger(__name__)

CROSSWALK_COLUMNS = ["cve_ent", "mun_norm", "cvegeo", "method", "score"]
PARTICIPATION_COLUMNS = [
    "cvegeo",
    "cve_ent",
    "year",
    "election",
    "lista_nominal",
    "votos_totales",
    "participacion",
]
UNMATCHED_COLUMNS = ["cve_ent", "mun_norm", "mun_name", "best_candidate", "best_score", "years"]

HONORIFIC_PREFIXES = [
    "HEROICA CIUDAD DE ",
    "HEROICA VILLA DE ",
    "HEROICA ",
    "CIUDAD DE ",
    "VILLA DE ",
    "SAN JUAN BAUTISTA ",
]

TOKEN_EQUIVS = {
    "GRAL": "GENERAL",
    "STA": "SANTA",
    "STO": "SANTO",
    "DR": "DOCTOR",
}


def strip_variants(text: str) -> str:
    """Strip honorific prefixes and apply token abbreviations."""
    s = norm_name(text)
    if not s:
        return ""

    # Remove known honorific prefixes at start of string
    changed = True
    while changed:
        changed = False
        for prefix in HONORIFIC_PREFIXES:
            if s.startswith(prefix):
                s = s[len(prefix):].strip()
                changed = True
                break

    # Replace token abbreviations (whole words)
    for token, full in TOKEN_EQUIVS.items():
        s = re.sub(rf"\b{token}\b", full, s)

    return " ".join(s.split())


def load_overrides(overrides_path: Path | str | None = None) -> dict[tuple[str, str], str]:
    """Load manual crosswalk overrides from CSV."""
    path = Path(overrides_path) if overrides_path else SEED_DIR / "mun_crosswalk_overrides.csv"
    if not path.is_file():
        return {}

    try:
        df = pd.read_csv(path, dtype=str)
    except Exception as e:
        logger.warning("Could not read overrides CSV at %s: %s", path, e)
        return {}

    if df.empty or "cve_ent" not in df.columns or "mun_norm" not in df.columns or "cvegeo" not in df.columns:
        return {}

    overrides = {}
    for _, row in df.iterrows():
        ent = zpad(row.get("cve_ent", ""), 2)
        mun = norm_name(row.get("mun_norm", ""))
        geo = zpad(row.get("cvegeo", ""), 5)
        if ent and mun and geo:
            overrides[(ent, mun)] = geo
    return overrides


def process_crosswalk(
    participation_ine_path: Path | str | None = None,
    features_path: Path | str | None = None,
    overrides_path: Path | str | None = None,
    out_crosswalk: Path | str | None = None,
    out_participation: Path | str | None = None,
    out_unmatched: Path | str | None = None,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Build crosswalk mapping INE municipalities to INEGI cvegeo."""
    ine_file = Path(participation_ine_path) if participation_ine_path else BUILD_DIR / "participation_ine.parquet"
    feat_file = Path(features_path) if features_path else BUILD_DIR / "features.parquet"
    cw_out = Path(out_crosswalk) if out_crosswalk else BUILD_DIR / "crosswalk.parquet"
    part_out = Path(out_participation) if out_participation else BUILD_DIR / "participation.parquet"
    unm_out = Path(out_unmatched) if out_unmatched else BUILD_DIR / "crosswalk_unmatched.csv"

    empty_cw = pd.DataFrame(columns=CROSSWALK_COLUMNS)
    empty_part = pd.DataFrame(columns=PARTICIPATION_COLUMNS)
    empty_unm = pd.DataFrame(columns=UNMATCHED_COLUMNS)

    if not ine_file.is_file() or not feat_file.is_file():
        logger.warning(
            "Missing inputs for crosswalk (participation_ine: %s, features: %s). Writing empty outputs.",
            ine_file.is_file(),
            feat_file.is_file(),
        )
        write_parquet(empty_cw, cw_out)
        write_parquet(empty_part, part_out)
        unm_out.parent.mkdir(parents=True, exist_ok=True)
        empty_unm.to_csv(unm_out, index=False)
        return empty_cw, empty_part, empty_unm

    ine_df = read_parquet(ine_file)
    feat_df = read_parquet(feat_file)

    if ine_df.empty or feat_df.empty:
        logger.warning("Empty participation_ine or features table. Writing empty outputs.")
        write_parquet(empty_cw, cw_out)
        write_parquet(empty_part, part_out)
        unm_out.parent.mkdir(parents=True, exist_ok=True)
        empty_unm.to_csv(unm_out, index=False)
        return empty_cw, empty_part, empty_unm

    overrides = load_overrides(overrides_path)

    # Clean INE columns
    ine_df["cve_ent"] = ine_df["cve_ent"].apply(lambda v: zpad(v, 2))
    ine_df["mun_norm"] = ine_df["mun_norm"].fillna("").astype(str).str.strip()
    if "mun_name" not in ine_df.columns:
        ine_df["mun_name"] = ine_df["mun_norm"]
    else:
        ine_df["mun_name"] = ine_df["mun_name"].fillna("").astype(str).str.strip()

    # Clean INEGI features catalog
    feat_df["cvegeo"] = feat_df["cvegeo"].apply(lambda v: zpad(v, 5))
    feat_df["cve_ent"] = feat_df["cvegeo"].str[:2]
    feat_df["nom_mun"] = feat_df["nom_mun"].fillna("").astype(str).str.strip()
    feat_df["mun_norm"] = feat_df["nom_mun"].apply(norm_name)

    # Build reference mapping by state
    # cve_ent -> list of (cvegeo, nom_mun, mun_norm, variant_norm)
    inegi_by_ent: dict[str, list[dict]] = {}
    for ent, grp in feat_df.groupby("cve_ent"):
        muns = []
        for _, row in grp.iterrows():
            muns.append({
                "cvegeo": row["cvegeo"],
                "nom_mun": row["nom_mun"],
                "mun_norm": row["mun_norm"],
                "variant_norm": strip_variants(row["nom_mun"]),
            })
        inegi_by_ent[ent] = muns

    # Map unique (cve_ent, mun_norm) pairs
    # Group INE dataset by (cve_ent, mun_norm) to collect mun_name and years
    groups = ine_df.groupby(["cve_ent", "mun_norm"])

    cw_rows = []
    unmatched_rows = []

    for (cve_ent, mun_norm), group in groups:
        years_list = sorted(group["year"].dropna().unique().tolist())
        years_str = ", ".join(str(y) for y in years_list)
        # Choose most representative mun_name (longest non-empty)
        names = [n for n in group["mun_name"].unique() if n]
        mun_name = max(names, key=len) if names else mun_norm

        # Case 0: Empty mun_norm -> try matching by ine_mun
        if not mun_norm:
            matched_geo = None
            if "ine_mun" in group.columns:
                ine_mun_val = group["ine_mun"].dropna().iloc[0] if len(group["ine_mun"].dropna()) > 0 else None
                if ine_mun_val is not None and not pd.isna(ine_mun_val):
                    cand_cvegeo = f"{cve_ent}{zpad(ine_mun_val, 3)}"
                    state_geos = {m["cvegeo"] for m in inegi_by_ent.get(cve_ent, [])}
                    if cand_cvegeo in state_geos:
                        matched_geo = cand_cvegeo
                        cw_rows.append({
                            "cve_ent": cve_ent,
                            "mun_norm": mun_norm,
                            "cvegeo": matched_geo,
                            "method": "exact",
                            "score": 0.5,
                        })
            if not matched_geo:
                unmatched_rows.append({
                    "cve_ent": cve_ent,
                    "mun_norm": mun_norm,
                    "mun_name": mun_name,
                    "best_candidate": "",
                    "best_score": 0.0,
                    "years": years_str,
                })
            continue

        # 1. Override
        if (cve_ent, mun_norm) in overrides:
            cw_rows.append({
                "cve_ent": cve_ent,
                "mun_norm": mun_norm,
                "cvegeo": overrides[(cve_ent, mun_norm)],
                "method": "override",
                "score": 1.0,
            })
            continue

        cands = inegi_by_ent.get(cve_ent, [])
        if not cands:
            unmatched_rows.append({
                "cve_ent": cve_ent,
                "mun_norm": mun_norm,
                "mun_name": mun_name,
                "best_candidate": "",
                "best_score": 0.0,
                "years": years_str,
            })
            continue

        # 2. Exact match: mun_norm == cand["mun_norm"]
        exact_match = next((c for c in cands if c["mun_norm"] == mun_norm), None)
        if exact_match:
            cw_rows.append({
                "cve_ent": cve_ent,
                "mun_norm": mun_norm,
                "cvegeo": exact_match["cvegeo"],
                "method": "exact",
                "score": 1.0,
            })
            continue

        # 3. Exact variant match (honorifics stripped & token equivalences)
        input_variant = strip_variants(mun_norm)
        # Check if matching variant exists and is unique in state
        variant_matches = [c for c in cands if c["variant_norm"] == input_variant]
        if len(variant_matches) == 1:
            cw_rows.append({
                "cve_ent": cve_ent,
                "mun_norm": mun_norm,
                "cvegeo": variant_matches[0]["cvegeo"],
                "method": "exact",
                "score": 0.95,
            })
            continue

        # 4. Fuzzy match
        # Compare mun_norm against cands["mun_norm"]
        scored = []
        for c in cands:
            ratio = difflib.SequenceMatcher(None, mun_norm, c["mun_norm"]).ratio()
            # Also test variant similarity
            ratio_var = difflib.SequenceMatcher(None, input_variant, c["variant_norm"]).ratio()
            effective_ratio = max(ratio, ratio_var)
            scored.append((effective_ratio, c))

        scored.sort(key=lambda x: x[0], reverse=True)
        best_ratio, best_cand = scored[0]
        second_ratio = scored[1][0] if len(scored) > 1 else 0.0

        if best_ratio >= 0.88 and (best_ratio - second_ratio) >= 0.03:
            cw_rows.append({
                "cve_ent": cve_ent,
                "mun_norm": mun_norm,
                "cvegeo": best_cand["cvegeo"],
                "method": "fuzzy",
                "score": round(best_ratio, 4),
            })
            continue

        # 5. Unmatched
        unmatched_rows.append({
            "cve_ent": cve_ent,
            "mun_norm": mun_norm,
            "mun_name": mun_name,
            "best_candidate": best_cand["nom_mun"],
            "best_score": round(best_ratio, 4),
            "years": years_str,
        })

    cw_df = pd.DataFrame(cw_rows, columns=CROSSWALK_COLUMNS)
    # Deduplicate crosswalk
    cw_df = cw_df.drop_duplicates(subset=["cve_ent", "mun_norm"]).reset_index(drop=True)
    write_parquet(cw_df, cw_out)
    logger.info("Saved crosswalk to %s (%d rows)", cw_out, len(cw_df))

    unm_df = pd.DataFrame(unmatched_rows, columns=UNMATCHED_COLUMNS)
    unm_out.parent.mkdir(parents=True, exist_ok=True)
    unm_df.to_csv(unm_out, index=False, encoding="utf-8")
    logger.info("Saved unmatched municipalities to %s (%d rows)", unm_out, len(unm_df))

    # Inner join participation_ine ⨝ crosswalk on (cve_ent, mun_norm)
    merged_part = pd.merge(ine_df, cw_df, on=["cve_ent", "mun_norm"], how="inner")

    # Aggregate by (cvegeo, year, election)
    if not merged_part.empty:
        merged_part["lista_nominal"] = pd.to_numeric(merged_part["lista_nominal"], errors="coerce").fillna(0).astype("int64")
        merged_part["votos_totales"] = pd.to_numeric(merged_part["votos_totales"], errors="coerce").fillna(0).astype("int64")

        agg_df = (
            merged_part.groupby(["cvegeo", "year", "election"], as_index=False)[["lista_nominal", "votos_totales"]]
            .sum()
        )
        agg_df["cve_ent"] = agg_df["cvegeo"].str[:2]
        
        # Calculate participacion <= 1.0
        agg_df["participacion"] = np.where(
            agg_df["lista_nominal"] > 0,
            np.minimum(1.0, agg_df["votos_totales"] / agg_df["lista_nominal"]),
            np.nan,
        )
        part_df = agg_df[PARTICIPATION_COLUMNS].copy()
    else:
        part_df = pd.DataFrame(columns=PARTICIPATION_COLUMNS)

    write_parquet(part_df, part_out)
    logger.info("Saved canonical participation to %s (%d rows)", part_out, len(part_df))

    # Coverage metrics by year
    print("[crosswalk] Coverage report by election year:")
    years = sorted(ine_df["year"].dropna().unique().tolist())
    for yr in years:
        total_lista = ine_df.loc[ine_df["year"] == yr, "lista_nominal"]
        tot_sum = pd.to_numeric(total_lista, errors="coerce").fillna(0).sum()
        
        matched_lista = merged_part.loc[merged_part["year"] == yr, "lista_nominal"]
        mat_sum = pd.to_numeric(matched_lista, errors="coerce").fillna(0).sum()
        
        cov_pct = (mat_sum / tot_sum * 100) if tot_sum > 0 else 0.0
        print(f"  Year {yr}: {cov_pct:.2f}% coverage ({mat_sum:,} / {tot_sum:,} lista nominal)")

    return cw_df, part_df, unm_df


def main():
    parser = argparse.ArgumentParser(description="Build crosswalk and canonical participation.")
    parser.add_argument("--participation-ine", default=None, help="Path to participation_ine.parquet.")
    parser.add_argument("--features", default=None, help="Path to features.parquet.")
    parser.add_argument("--overrides", default=None, help="Path to seed/mun_crosswalk_overrides.csv.")
    parser.add_argument("--out-crosswalk", default=None, help="Path for crosswalk.parquet.")
    parser.add_argument("--out-participation", default=None, help="Path for participation.parquet.")
    parser.add_argument("--out-unmatched", default=None, help="Path for crosswalk_unmatched.csv.")
    args = parser.parse_args()

    process_crosswalk(
        participation_ine_path=args.participation_ine,
        features_path=args.features,
        overrides_path=args.overrides,
        out_crosswalk=args.out_crosswalk,
        out_participation=args.out_participation,
        out_unmatched=args.out_unmatched,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
