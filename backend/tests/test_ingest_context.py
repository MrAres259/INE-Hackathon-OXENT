"""Tests for INEGI Censo 2020 migration context ingestion."""

from __future__ import annotations

import io
from pathlib import Path
import zipfile

import numpy as np
import pandas as pd
import pytest

from atalaya.config import BUILD_DIR
from atalaya.ingest.context import (
    CONTEXT_OUTPUT_COLUMNS,
    TARGET_COLS,
    process_context,
)


def _create_synthetic_iter_zip(zip_path: Path) -> None:
    """Create a minimal synthetic ITER 2020 zip file."""
    csv_content = (
        "ENTIDAD,MUN,LOC,POBTOT,PNACOE,PRES2015,PRESOE15,EXTRA_COL1,EXTRA_COL2\n"
        "00,000,0000,1000,200,800,100,ignore,ignore\n"  # National total (should be excluded)
        "01,001,0001,50,10,40,5,ignore,ignore\n"  # Locality row (LOC != 0000, excluded)
        "01,001,0000,100,20,80,10,ignore,ignore\n"  # Mun 01001: 20% nacido, 10/(80+10)=11.11% llego
        "01,002,0000,200,*,160,20,ignore,ignore\n"  # Mun 01002: * in PNACOE -> NaN
        "02,001,0000,300,150,200,50,ignore,ignore\n"  # Mun 02001: 50% nacido, 50/(200+50)=20.0% llego
    )

    zip_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("conjunto_de_datos/conjunto_de_datos_iter_00CSV20.csv", csv_content)


def test_synthetic_ingest_context(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Test context ingestion with synthetic zip, catalog alignment, and usecols verification."""
    raw_dir = tmp_path / "raw"
    build_dir = tmp_path / "build"
    raw_dir.mkdir()
    build_dir.mkdir()

    zip_file = raw_dir / "iter_00_cpv2020_csv.zip"
    _create_synthetic_iter_zip(zip_file)

    # Synthetic catalog with 4 municipalities (02002 is new, not in ITER)
    cat_df = pd.DataFrame({
        "cvegeo": ["01001", "01002", "02001", "02002"],
        "cve_ent": ["01", "01", "02", "02"],
        "cve_mun": ["001", "002", "001", "002"],
        "name": ["Mun 1", "Mun 2", "Mun 3", "Mun Nuevo"],
    })
    cat_df.to_csv(build_dir / "geo_mun_catalog.csv", index=False)

    # Monkeypatch pd.read_csv to assert usecols
    read_csv_calls = []
    original_read_csv = pd.read_csv

    def spy_read_csv(*args, **kwargs):
        read_csv_calls.append(kwargs)
        return original_read_csv(*args, **kwargs)

    monkeypatch.setattr(pd, "read_csv", spy_read_csv)

    # Execute ingestion
    df = process_context(raw_dir=raw_dir, build_dir=build_dir)

    # Verify pd.read_csv was called with usecols=TARGET_COLS
    iter_calls = [c for c in read_csv_calls if "usecols" in c]
    assert len(iter_calls) >= 1
    assert set(iter_calls[0]["usecols"]) == set(TARGET_COLS)

    # Verify output columns
    assert list(df.columns) == CONTEXT_OUTPUT_COLUMNS

    # Municipal rows
    muns = df[df["level"] == "mun"].set_index("id")
    assert len(muns) == 4  # All 4 from catalog

    # Mun 01001: 100 pobtot, 20 pnacoe => 20.0%
    assert muns.loc["01001", "pob_tot"] == 100.0
    assert muns.loc["01001", "pnacoe"] == 20.0
    assert pytest.approx(muns.loc["01001", "pct_nacido_otra_ent"], 0.01) == 20.0
    assert pytest.approx(muns.loc["01001", "pct_llego_2015_2020"], 0.01) == 100.0 * 10 / 90

    # Mun 01002: * in PNACOE => NaN
    assert np.isnan(muns.loc["01002", "pnacoe"])
    assert np.isnan(muns.loc["01002", "pct_nacido_otra_ent"])
    assert pytest.approx(muns.loc["01002", "pct_llego_2015_2020"], 0.01) == 100.0 * 20 / 180

    # Mun 02001: 300 pobtot, 150 pnacoe => 50.0%
    assert pytest.approx(muns.loc["02001", "pct_nacido_otra_ent"], 0.01) == 50.0
    assert pytest.approx(muns.loc["02001", "pct_llego_2015_2020"], 0.01) == 100.0 * 50 / 250

    # Mun 02002 (catalog only, not in ITER): all NaN
    assert np.isnan(muns.loc["02002", "pob_tot"])
    assert np.isnan(muns.loc["02002", "pct_nacido_otra_ent"])

    # State rows: sum of municipalities
    states = df[df["level"] == "state"].set_index("id")
    assert len(states) == 2  # State 01 and State 02

    # State 02: sum from 02001 (300 pobtot, 150 pnacoe) => 50.0%
    assert states.loc["02", "pob_tot"] == 300.0
    assert states.loc["02", "pnacoe"] == 150.0
    assert pytest.approx(states.loc["02", "pct_nacido_otra_ent"], 0.01) == 50.0

    # Verify parquet file was written and matches returned df
    out_file = build_dir / "context.parquet"
    assert out_file.is_file()
    read_back = pd.read_parquet(out_file)
    assert len(read_back) == len(df)


@pytest.mark.skipif(
    not (BUILD_DIR / "context.parquet").is_file(),
    reason="data/build/context.parquet does not exist yet",
)
def test_real_context_parquet() -> None:
    """Verify real context.parquet has 2,478 municipalities and 32 states."""
    ctx_path = BUILD_DIR / "context.parquet"
    df = pd.read_parquet(ctx_path)

    muns = df[df["level"] == "mun"]
    states = df[df["level"] == "state"]

    assert len(muns) == 2478, f"Expected 2478 municipalities, got {len(muns)}"
    assert len(states) == 32, f"Expected 32 states, got {len(states)}"

    # Check top migration states: Quintana Roo (23) ≈ 50.9%, BCS (03) ≈ 39%, BC (02) ≈ 39%
    st_idx = states.set_index("id")
    qr_val = st_idx.loc["23", "pct_nacido_otra_ent"]
    bcs_val = st_idx.loc["03", "pct_nacido_otra_ent"]
    bc_val = st_idx.loc["02", "pct_nacido_otra_ent"]

    assert pytest.approx(qr_val, abs=0.5) == 50.9
    assert pytest.approx(bcs_val, abs=1.0) == 39.2
    assert pytest.approx(bc_val, abs=1.0) == 38.8
    assert qr_val > bcs_val > bc_val
