"""Ingestion module for INEGI Censo 2020 migration / mobility context.

Produces municipal- and state-level migration metrics in data/build/context.parquet.
"""

from __future__ import annotations

import argparse
import logging
from pathlib import Path
import sys
import zipfile

import numpy as np
import pandas as pd

from atalaya.config import BUILD_DIR, RAW_DIR, SEED_DIR
from atalaya.ingest.common import to_num, write_parquet, zpad
from atalaya.ingest.inegi_iter import find_iter_file

logger = logging.getLogger(__name__)

CONTEXT_OUTPUT_COLUMNS = [
    "id",
    "level",
    "cve_ent",
    "pob_tot",
    "pnacoe",
    "pres2015",
    "presoe15",
    "pct_nacido_otra_ent",
    "pct_llego_2015_2020",
]

TARGET_COLS = ["ENTIDAD", "MUN", "LOC", "POBTOT", "PNACOE", "PRES2015", "PRESOE15"]


def _find_source_file(raw_dir: Path) -> Path | None:
    """Locate the ITER 2020 zip or csv file."""
    # Check directly or under inegi subdirectory
    candidates = [
        raw_dir,
        raw_dir / "inegi",
    ]
    for d in candidates:
        if d.is_file():
            return d
        if d.is_dir():
            found = find_iter_file(d)
            if found:
                return found
    return None


def _read_iter_context_csv(source_path: Path) -> pd.DataFrame:
    """Read only the 7 needed columns from the ITER 2020 CSV (inside zip or directly)."""
    source_path = Path(source_path)
    if not source_path.is_file():
        raise FileNotFoundError(f"Source ITER file not found: {source_path}")

    logger.info("Reading context columns from %s", source_path)

    if source_path.suffix.lower() == ".zip":
        with zipfile.ZipFile(source_path, "r") as zf:
            candidates = [
                m
                for m in zf.infolist()
                if not m.filename.startswith("__MACOSX")
                and not m.filename.endswith("/")
                and m.filename.lower().endswith(".csv")
                and "catalogos" not in m.filename.lower()
            ]
            if not candidates:
                raise ValueError(f"No valid CSV found in zip: {source_path}")

            conjunto = [m for m in candidates if "conjunto_de_datos" in m.filename.lower()]
            chosen = max(conjunto if conjunto else candidates, key=lambda m: m.file_size)

            with zf.open(chosen) as f:
                df = pd.read_csv(
                    f,
                    usecols=TARGET_COLS,
                    dtype=str,
                    encoding="utf-8-sig",
                )
    else:
        df = pd.read_csv(
            source_path,
            usecols=TARGET_COLS,
            dtype=str,
            encoding="utf-8-sig",
        )

    return df


def _compute_percentages(df: pd.DataFrame) -> pd.DataFrame:
    """Calculate pct_nacido_otra_ent and pct_llego_2015_2020 with safe division."""
    pob = df["pob_tot"]
    pna = df["pnacoe"]
    p15 = df["pres2015"]
    poe = df["presoe15"]

    valid_pob = (pob > 0) & pob.notna() & pna.notna()
    df["pct_nacido_otra_ent"] = np.where(valid_pob, 100.0 * pna / pob, np.nan)

    denom_pres = p15 + poe
    valid_pres = (denom_pres > 0) & denom_pres.notna() & poe.notna()
    df["pct_llego_2015_2020"] = np.where(valid_pres, 100.0 * poe / denom_pres, np.nan)

    return df


def process_context(
    raw_dir: Path | str | None = None,
    build_dir: Path | str | None = None,
) -> pd.DataFrame:
    """Process ITER 2020 migration data into municipal and state context.parquet."""
    raw_path = Path(raw_dir) if raw_dir is not None else RAW_DIR
    b_dir = Path(build_dir) if build_dir is not None else BUILD_DIR
    out_path = b_dir / "context.parquet"

    source_file = _find_source_file(raw_path)
    if not source_file or not source_file.exists():
        logger.warning("No INEGI ITER file found in %s. Creating empty context output.", raw_path)
        empty_df = pd.DataFrame(columns=CONTEXT_OUTPUT_COLUMNS)
        write_parquet(empty_df, out_path)
        return empty_df

    raw_df = _read_iter_context_csv(source_file)
    if raw_df.empty:
        logger.warning("INEGI ITER file %s is empty. Creating empty context output.", source_file)
        empty_df = pd.DataFrame(columns=CONTEXT_OUTPUT_COLUMNS)
        write_parquet(empty_df, out_path)
        return empty_df

    # Normalize geographic codes
    ent_series = raw_df["ENTIDAD"].apply(lambda v: zpad(v, 2))
    mun_series = raw_df["MUN"].apply(lambda v: zpad(v, 3))
    loc_series = raw_df["LOC"].apply(lambda v: zpad(v, 4))

    # Municipal rows: LOC == "0000" and MUN != "000" (excluding national ENTIDAD == "00")
    is_valid_ent = ent_series != "00"
    is_valid_mun = mun_series != "000"
    is_mun_row = is_valid_ent & is_valid_mun & (loc_series == "0000")

    mun_raw = raw_df.loc[is_mun_row].copy()
    mun_cve_ent = ent_series.loc[is_mun_row].values
    mun_cve_mun = mun_series.loc[is_mun_row].values
    mun_ids = [f"{e}{m}" for e, m in zip(mun_cve_ent, mun_cve_mun)]

    mun_df = pd.DataFrame({
        "id": mun_ids,
        "level": "mun",
        "cve_ent": mun_cve_ent,
        "pob_tot": to_num(mun_raw["POBTOT"]).values,
        "pnacoe": to_num(mun_raw["PNACOE"]).values,
        "pres2015": to_num(mun_raw["PRES2015"]).values,
        "presoe15": to_num(mun_raw["PRESOE15"]).values,
    })

    # Drop potential duplicates by id if any
    mun_df = mun_df.drop_duplicates(subset=["id"]).reset_index(drop=True)

    # Align municipal rows to MG 2024 catalog if present
    cat_path = b_dir / "geo_mun_catalog.csv"
    if cat_path.is_file():
        cat = pd.read_csv(cat_path, dtype=str)
        cat_ids = cat["cvegeo"].astype(str).str.strip().map(lambda v: zpad(v, 5))
        if "cve_ent" in cat.columns:
            cat_ents = cat["cve_ent"].astype(str).str.strip().map(lambda v: zpad(v, 2))
        else:
            cat_ents = cat_ids.str[:2]

        base_mun = pd.DataFrame({
            "id": cat_ids,
            "level": "mun",
            "cve_ent": cat_ents,
        }).drop_duplicates(subset=["id"]).reset_index(drop=True)

        mun_df = pd.merge(
            base_mun,
            mun_df[["id", "pob_tot", "pnacoe", "pres2015", "presoe15"]],
            on="id",
            how="left",
        )

    # Compute percentages for municipalities
    mun_df = _compute_percentages(mun_df)

    # States: sum of their municipalities.
    # CONTRACT-NOTE: We do not use the raw MUN == "000" row from ITER because ATALAYA
    # aggregates bottom-up from municipalities across all models and features, ensuring
    # mathematical consistency and exact municipal-to-state parity.
    state_grouped = (
        mun_df.groupby("cve_ent")[["pob_tot", "pnacoe", "pres2015", "presoe15"]]
        .sum(min_count=1)
        .reset_index()
    )
    state_grouped["id"] = state_grouped["cve_ent"]
    state_grouped["level"] = "state"
    state_df = _compute_percentages(state_grouped)

    # Combine municipal and state rows
    result_df = pd.concat([mun_df, state_df], ignore_index=True)
    result_df = result_df[CONTEXT_OUTPUT_COLUMNS]

    # Save to parquet
    write_parquet(result_df, out_path)
    logger.info("Wrote %d context records to %s", len(result_df), out_path)

    # Resolve state names for nice logging if states.csv exists
    state_names: dict[str, str] = {}
    states_seed = SEED_DIR / "states.csv"
    if states_seed.is_file():
        try:
            s_df = pd.read_csv(states_seed, dtype=str)
            for _, r in s_df.iterrows():
                state_names[zpad(r["cve_ent"], 2)] = r["name"]
        except Exception:
            pass

    # Print 3 lines as required by task specification
    mun_count = len(mun_df)
    state_count = len(state_df)
    top3 = state_df.sort_values("pct_nacido_otra_ent", ascending=False).head(3)
    top3_items = []
    for _, r in top3.iterrows():
        st_code = r["cve_ent"]
        st_name = state_names.get(st_code, f"Estado {st_code}")
        val = r["pct_nacido_otra_ent"]
        top3_items.append(f"{st_name} ({st_code}): {val:.1f}%")
    top3_line = ", ".join(top3_items)

    print(f"Municipios: {mun_count} filas")
    print(f"Estados: {state_count} filas")
    print(f"Top 3 migración estatal (pct_nacido_otra_ent): {top3_line}")

    return result_df


def main() -> int:
    parser = argparse.ArgumentParser(description="Ingest INEGI ITER 2020 migration context.")
    parser.add_argument("--raw-dir", "--raw", dest="raw_dir", default=None, help="Raw data directory.")
    parser.add_argument("--build-dir", "--build", "--out", dest="build_dir", default=None, help="Build directory.")
    args = parser.parse_args()

    process_context(raw_dir=args.raw_dir, build_dir=args.build_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
