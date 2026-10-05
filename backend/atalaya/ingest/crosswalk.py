"""Crosswalk module for mapping INE municipalities to canonical INEGI cvegeo.

Produces:
- data/build/crosswalk.parquet
- data/build/participation.parquet
- data/build/ccpc_profile_mun.parquet (if ccpc_profile exists)
- data/build/ccpc_seccion_mun.parquet (if ccpc_seccion exists)
- data/build/crosswalk_unmatched.csv
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
    "nv",
    "ns",
    "ns_rate",
    "reliable",
    "low_confidence",
]
UNMATCHED_COLUMNS = ["cve_ent", "mun_norm", "mun_name", "best_candidate", "best_score", "years"]

HONORIFIC_PREFIXES = [
    "HEROICA CIUDAD DE ",
    "HEROICA VILLA DE ",
    "HEROICA CIUDAD ",
    "HEROICA ",
    "HEROICO ",
    "CIUDAD DE ",
    "VILLA DE ",
    "SAN JUAN BAUTISTA ",
    "PUEBLO DE ",
    "MUNICIPIO DE ",
]

TOKEN_EQUIVS = {
    "GRAL": "GENERAL",
    "STA": "SANTA",
    "STO": "SANTO",
    "DR": "DOCTOR",
    "DRA": "DOCTORA",
    "LIC": "LICENCIADO",
    "PROFR": "PROFESOR",
    "PROF": "PROFESOR",
    "ING": "INGENIERO",
    "CORL": "CORONEL",
    "CNEL": "CORONEL",
    "TTE": "TENIENTE",
    "CD": "CIUDAD",
    "SN": "SAN",
    "PTO": "PUERTO",
    "NTRA": "NUESTRA",
    "NTR": "NUESTRA",
    "SRA": "SENORA",
    "FNCISCO": "FRANCISCO",
    "MA": "MARIA",
}

NUMERAL_MAP = {
    "1": "I",
    "2": "II",
    "3": "III",
    "4": "IV",
    "5": "V",
    "6": "VI",
}


def strip_variants(text: str) -> str:
    """Strip honorific prefixes, standardize abbreviations, articles, and numerals."""
    s = norm_name(text)
    if not s:
        return ""

    # Normalize DE EL -> DEL, A EL -> AL
    s = re.sub(r"\bDE EL\b", "DEL", s)
    s = re.sub(r"\bA EL\b", "AL", s)

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

    # Standardize numbers to Roman numerals
    for num, roman in NUMERAL_MAP.items():
        s = re.sub(rf"\b{num}\b", roman, s)

    return " ".join(s.split())


def strip_connecting_words(text: str) -> str:
    """Strip connecting prepositions and articles (DE, DEL, LA, EL, LOS, LAS, Y)."""
    tokens = [t for t in text.split() if t not in ("DE", "DEL", "LA", "LAS", "EL", "LOS", "Y")]
    return " ".join(tokens)


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
    geo_catalog_path: Path | str | None = None,
    overrides_path: Path | str | None = None,
    ccpc_profile_path: Path | str | None = None,
    ccpc_seccion_path: Path | str | None = None,
    out_crosswalk: Path | str | None = None,
    out_participation: Path | str | None = None,
    out_unmatched: Path | str | None = None,
    out_profile_mun: Path | str | None = None,
    out_seccion_mun: Path | str | None = None,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Build crosswalk mapping INE municipalities to canonical INEGI cvegeo and attach to CCPC tables."""
    if out_participation is not None:
        base_dir = Path(out_participation).parent
    elif out_crosswalk is not None:
        base_dir = Path(out_crosswalk).parent
    else:
        base_dir = BUILD_DIR

    ine_file = Path(participation_ine_path) if participation_ine_path else base_dir / "participation_ine.parquet"
    feat_file = Path(features_path) if features_path else base_dir / "features.parquet"
    cw_out = Path(out_crosswalk) if out_crosswalk else base_dir / "crosswalk.parquet"
    part_out = Path(out_participation) if out_participation else base_dir / "participation.parquet"
    unm_out = Path(out_unmatched) if out_unmatched else base_dir / "crosswalk_unmatched.csv"
    profile_out = Path(out_profile_mun) if out_profile_mun else base_dir / "ccpc_profile_mun.parquet"
    seccion_out = Path(out_seccion_mun) if out_seccion_mun else base_dir / "ccpc_seccion_mun.parquet"
    profile_file = Path(ccpc_profile_path) if ccpc_profile_path else base_dir / "ccpc_profile.parquet"
    seccion_file = Path(ccpc_seccion_path) if ccpc_seccion_path else base_dir / "ccpc_seccion.parquet"

    empty_cw = pd.DataFrame(columns=CROSSWALK_COLUMNS)
    empty_part = pd.DataFrame(columns=PARTICIPATION_COLUMNS)
    empty_unm = pd.DataFrame(columns=UNMATCHED_COLUMNS)

    # Determine destination catalog:
    # 1. geo_catalog_path if explicitly provided and exists
    # 2. features_path if explicitly provided (and not default BUILD_DIR/features.parquet) and exists
    # 3. base_dir / geo_mun_catalog.csv or BUILD_DIR / geo_mun_catalog.csv (MG 2024 catalog from W3-D)
    # 4. feat_file (BUILD_DIR / features.parquet)
    cat_df = None
    if geo_catalog_path and Path(geo_catalog_path).is_file():
        logger.info("Using destination catalog from geo_catalog_path: %s", geo_catalog_path)
        cat_df = pd.read_csv(Path(geo_catalog_path), dtype=str)
    elif features_path and Path(features_path) != BUILD_DIR / "features.parquet" and Path(features_path).is_file():
        logger.info("Using destination catalog from explicit features_path: %s", features_path)
        cat_df = read_parquet(Path(features_path))
    elif (base_dir / "geo_mun_catalog.csv").is_file():
        logger.info("Using destination catalog from %s", base_dir / "geo_mun_catalog.csv")
        cat_df = pd.read_csv(base_dir / "geo_mun_catalog.csv", dtype=str)
    elif (BUILD_DIR / "geo_mun_catalog.csv").is_file():
        logger.info("Using destination catalog from BUILD_DIR/geo_mun_catalog.csv")
        cat_df = pd.read_csv(BUILD_DIR / "geo_mun_catalog.csv", dtype=str)
    elif feat_file.is_file():
        logger.info("Using destination catalog from feat_file: %s", feat_file)
        cat_df = read_parquet(feat_file)
    elif (BUILD_DIR / "features.parquet").is_file():
        logger.info("Using destination catalog from BUILD_DIR/features.parquet")
        cat_df = read_parquet(BUILD_DIR / "features.parquet")

    if not ine_file.is_file() or cat_df is None or cat_df.empty:
        logger.warning(
            "Missing inputs for crosswalk (participation_ine: %s, catalog: %s). Writing empty outputs.",
            ine_file.is_file(),
            cat_df is not None and not cat_df.empty,
        )
        write_parquet(empty_cw, cw_out)
        write_parquet(empty_part, part_out)
        unm_out.parent.mkdir(parents=True, exist_ok=True)
        empty_unm.to_csv(unm_out, index=False)
        return empty_cw, empty_part, empty_unm

    ine_df = read_parquet(ine_file)
    if ine_df.empty:
        logger.warning("Empty participation_ine table. Writing empty outputs.")
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

    # Clean destination catalog
    cat_df["cvegeo"] = cat_df["cvegeo"].apply(lambda v: zpad(v, 5))
    cat_df["cve_ent"] = cat_df["cvegeo"].str[:2]
    nom_mun_series = (
        cat_df["name"] if "name" in cat_df.columns
        else (cat_df["nom_mun"] if "nom_mun" in cat_df.columns else cat_df["cvegeo"])
    )
    cat_df["nom_mun"] = nom_mun_series.fillna("").astype(str).str.strip()
    cat_df["mun_norm"] = cat_df["nom_mun"].apply(norm_name)
    cat_df = cat_df.drop_duplicates(subset=["cvegeo"]).reset_index(drop=True)

    # Build reference mapping by state
    # cve_ent -> list of candidate dicts
    inegi_by_ent: dict[str, list[dict]] = {}
    for ent, grp in cat_df.groupby("cve_ent"):
        muns = []
        for _, row in grp.iterrows():
            muns.append({
                "cvegeo": row["cvegeo"],
                "nom_mun": row["nom_mun"],
                "mun_norm": row["mun_norm"],
                "variant_norm": strip_variants(row["nom_mun"]),
                "clean_norm": strip_connecting_words(strip_variants(row["nom_mun"])),
            })
        inegi_by_ent[ent] = muns

    # Map unique (cve_ent, mun_norm) pairs
    groups = ine_df.groupby(["cve_ent", "mun_norm"])

    cw_rows = []
    unmatched_rows = []

    for (cve_ent, mun_norm), group in groups:
        years_list = sorted(group["year"].dropna().unique().tolist())
        years_str = ", ".join(str(y) for y in years_list)
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

        # 2. Exact match
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

        # 3. Exact variant match (honorifics, token abbreviations, numerals)
        input_variant = strip_variants(mun_norm)
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

        # 3b. Connecting words stripped match
        input_clean = strip_connecting_words(input_variant)
        clean_matches = [c for c in cands if c["clean_norm"] == input_clean]
        if len(clean_matches) == 1:
            cw_rows.append({
                "cve_ent": cve_ent,
                "mun_norm": mun_norm,
                "cvegeo": clean_matches[0]["cvegeo"],
                "method": "exact",
                "score": 0.92,
            })
            continue

        # 4. Fuzzy match
        scored = []
        for c in cands:
            ratio = difflib.SequenceMatcher(None, mun_norm, c["mun_norm"]).ratio()
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

        has_nv = "nv" in merged_part.columns
        has_ns = "ns" in merged_part.columns
        if has_nv:
            merged_part["nv"] = pd.to_numeric(merged_part["nv"], errors="coerce").fillna(0).astype("int64")
        else:
            merged_part["nv"] = 0
        if has_ns:
            merged_part["ns"] = pd.to_numeric(merged_part["ns"], errors="coerce").fillna(0).astype("int64")
        else:
            merged_part["ns"] = 0

        agg_df = (
            merged_part.groupby(["cvegeo", "year", "election"], as_index=False)[["lista_nominal", "votos_totales", "nv", "ns"]]
            .sum()
        )
        agg_df["cve_ent"] = agg_df["cvegeo"].str[:2]

        if has_nv and (agg_df["votos_totales"] + agg_df["nv"]).sum() > 0:
            denom = agg_df["votos_totales"] + agg_df["nv"]
            agg_df["participacion"] = np.where(denom > 0, np.minimum(1.0, agg_df["votos_totales"] / denom), np.nan)
        else:
            agg_df["participacion"] = np.where(
                agg_df["lista_nominal"] > 0,
                np.minimum(1.0, agg_df["votos_totales"] / agg_df["lista_nominal"]),
                np.nan,
            )
        agg_df["ns_rate"] = np.where(
            agg_df["lista_nominal"] > 0,
            agg_df["ns"] / agg_df["lista_nominal"],
            np.nan,
        )
        agg_df["reliable"] = (
            agg_df["ns_rate"].notna()
            & (agg_df["ns_rate"] <= 0.5)
            & agg_df["participacion"].notna()
            & (agg_df["participacion"] >= 0.02)
        )
        agg_df["low_confidence"] = (
            agg_df["ns_rate"].notna()
            & (agg_df["ns_rate"] > 0.3)
            & (agg_df["ns_rate"] <= 0.5)
        )
        part_df = agg_df[PARTICIPATION_COLUMNS].copy()
    else:
        part_df = pd.DataFrame(columns=PARTICIPATION_COLUMNS)

    write_parquet(part_df, part_out)
    logger.info("Saved canonical participation to %s (%d rows)", part_out, len(part_df))

    # Map ccpc_profile if available
    if profile_file.is_file():
        prof_df = read_parquet(profile_file)
        if not prof_df.empty:
            prof_df["cve_ent"] = prof_df["cve_ent"].apply(lambda v: zpad(v, 2))
            prof_df["mun_norm"] = prof_df["mun_norm"].fillna("").astype(str).str.strip()
            merged_prof = pd.merge(prof_df, cw_df[["cve_ent", "mun_norm", "cvegeo"]], on=["cve_ent", "mun_norm"], how="inner")
            if not merged_prof.empty:
                for col in ["ln", "sv", "nv", "ns"]:
                    if col in merged_prof.columns:
                        merged_prof[col] = pd.to_numeric(merged_prof[col], errors="coerce").fillna(0).astype("int64")
                    else:
                        merged_prof[col] = 0
                group_cols = [c for c in ["cvegeo", "cve_ent", "year", "election", "age_group", "sexo"] if c in merged_prof.columns]
                agg_prof = merged_prof.groupby(group_cols, as_index=False)[["ln", "sv", "nv", "ns"]].sum()
                write_parquet(agg_prof, profile_out)
                logger.info("Saved ccpc_profile_mun to %s (%d rows)", profile_out, len(agg_prof))

    # Map ccpc_seccion if available
    if seccion_file.is_file():
        sec_df = read_parquet(seccion_file)
        if not sec_df.empty:
            sec_df["cve_ent"] = sec_df["cve_ent"].apply(lambda v: zpad(v, 2))
            sec_df["mun_norm"] = sec_df["mun_norm"].fillna("").astype(str).str.strip()
            merged_sec = pd.merge(sec_df, cw_df[["cve_ent", "mun_norm", "cvegeo"]], on=["cve_ent", "mun_norm"], how="inner")
            if not merged_sec.empty:
                write_parquet(merged_sec, seccion_out)
                logger.info("Saved ccpc_seccion_mun to %s (%d rows)", seccion_out, len(merged_sec))

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
    parser.add_argument("--geo-catalog", default=None, help="Path to geo_mun_catalog.csv.")
    parser.add_argument("--overrides", default=None, help="Path to seed/mun_crosswalk_overrides.csv.")
    parser.add_argument("--profile", default=None, help="Path to ccpc_profile.parquet.")
    parser.add_argument("--seccion", default=None, help="Path to ccpc_seccion.parquet.")
    parser.add_argument("--out-crosswalk", default=None, help="Path for crosswalk.parquet.")
    parser.add_argument("--out-participation", default=None, help="Path for participation.parquet.")
    parser.add_argument("--out-unmatched", default=None, help="Path for crosswalk_unmatched.csv.")
    parser.add_argument("--out-profile", default=None, help="Path for ccpc_profile_mun.parquet.")
    parser.add_argument("--out-seccion", default=None, help="Path for ccpc_seccion_mun.parquet.")
    args = parser.parse_args()

    process_crosswalk(
        participation_ine_path=args.participation_ine,
        features_path=args.features,
        geo_catalog_path=args.geo_catalog,
        overrides_path=args.overrides,
        ccpc_profile_path=args.profile,
        ccpc_seccion_path=args.seccion,
        out_crosswalk=args.out_crosswalk,
        out_participation=args.out_participation,
        out_unmatched=args.out_unmatched,
        out_profile_mun=args.out_profile,
        out_seccion_mun=args.out_seccion,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
