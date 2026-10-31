"""Tests for explain reference data module (reference.py)."""

from __future__ import annotations

import os
from pathlib import Path
import time

import numpy as np
import pandas as pd
import pytest

from atalaya.config import BUILD_DIR
from atalaya.explain.reference import (
    ASSOC_VARS,
    AssocStat,
    Reference,
    clear_reference_cache,
    get_reference,
    percentile_of,
)


@pytest.fixture(autouse=True)
def reset_cache():
    """Ensure clean reference cache before and after every test."""
    clear_reference_cache()
    yield
    clear_reference_cache()


def test_synthetic_reference(tmp_path: Path) -> None:
    """Test Reference computation, associations, participation baselines, and percentiles."""
    # 1. Units parquet
    mun_units = pd.DataFrame({
        "id": ["01001", "01002", "01003", "01004"],
        "level": ["mun", "mun", "mun", "mun"],
        "cve_ent": ["01", "01", "01", "01"],
        # graproes increases as pred_abstention decreases -> negative rho
        "graproes": [6.0, 8.0, 10.0, 12.0],
        # pct_sin_servsalud increases as pred_abstention increases -> positive rho
        "pct_sin_servsalud": [0.40, 0.30, 0.20, 0.10],
        "pred_abstention": [0.50, 0.40, 0.30, 0.20],
    })
    state_units = pd.DataFrame({
        "id": ["01", "02"],
        "level": ["state", "state"],
        "cve_ent": ["01", "02"],
        "graproes": [8.0, 10.0],
        "pred_abstention": [0.45, 0.25],
    })
    units_df = pd.concat([mun_units, state_units], ignore_index=True)
    units_df.to_parquet(tmp_path / "units.parquet", index=False)

    # 2. Participation parquet
    part_df = pd.DataFrame({
        "cvegeo": ["01001", "01002", "01001", "01002"],
        "cve_ent": ["01", "01", "01", "01"],
        "year": [2021, 2021, 2024, 2024],
        "election": ["DIP_FED", "DIP_FED", "DIP_FED", "DIP_FED"],
        "lista_nominal": [1000, 1000, 1000, 1000],
        "votos_totales": [400, 600, 500, 700],
        "nv": [600, 400, 500, 300],  # 2021: sv=1000, nv=1000 => 50%; 2024: sv=1200, nv=800 => 60%
        "participacion": [0.40, 0.60, 0.50, 0.70],
        "reliable": [True, True, True, True],
    })
    part_df.to_parquet(tmp_path / "participation.parquet", index=False)

    # 3. Context parquet
    ctx_df = pd.DataFrame({
        "id": ["01001", "01002", "01", "02"],
        "level": ["mun", "mun", "state", "state"],
        "cve_ent": ["01", "01", "01", "02"],
        "pct_nacido_otra_ent": [25.0, 35.0, 30.0, 45.0],
        "pct_llego_2015_2020": [5.0, 10.0, 7.5, 12.0],
    })
    ctx_df.to_parquet(tmp_path / "context.parquet", index=False)

    # Load reference
    ref = get_reference(build_dir=tmp_path)

    # Verify national participation
    assert ref.national_participation[2021] == 0.50
    assert ref.national_participation[2024] == 0.60

    # Verify state participation
    assert ref.state_participation[("01", 2021)] == 0.50
    assert ref.state_participation[("01", 2024)] == 0.60

    # Verify mean municipal participation (unweighted mean)
    assert pytest.approx(ref.mean_mun_participation[2021], 0.001) == 0.50
    assert pytest.approx(ref.mean_mun_participation[2024], 0.001) == 0.60

    # Verify associations: graproes should be negative rho
    stat_graproes = ref.associations["mun"]["graproes"]
    assert stat_graproes.rho < -0.9
    assert not stat_graproes.unfavorable_high
    assert stat_graproes.n == 4
    assert stat_graproes.p50 == 9.0

    # pct_sin_servsalud should be positive rho
    stat_salud = ref.associations["mun"]["pct_sin_servsalud"]
    assert stat_salud.rho > 0.9
    assert stat_salud.unfavorable_high

    # Verify percentiles (percentage strictly smaller)
    # graproes mun values: [6.0, 8.0, 10.0, 12.0]
    assert percentile_of(ref, "mun", "graproes", 5.0) == 0.0
    assert percentile_of(ref, "mun", "graproes", 6.0) == 0.0
    assert percentile_of(ref, "mun", "graproes", 7.0) == 25.0
    assert percentile_of(ref, "mun", "graproes", 9.0) == 50.0
    assert percentile_of(ref, "mun", "graproes", 11.0) == 75.0
    assert percentile_of(ref, "mun", "graproes", 13.0) == 100.0
    assert percentile_of(ref, "mun", "graproes", None) is None
    assert percentile_of(ref, "mun", "non_existent_var", 5.0) is None

    # Verify context percentile
    assert percentile_of(ref, "state", "pct_nacido_otra_ent", 40.0) == 50.0

    # Verify context dictionary
    assert ref.context["01001"]["pct_nacido_otra_ent"] == 25.0
    assert ref.context["01001"]["pct_llego_2015_2020"] == 5.0


def test_context_empty_when_file_missing(tmp_path: Path) -> None:
    """Test that missing context.parquet results in empty context dict and warning without crash."""
    units_df = pd.DataFrame({
        "id": ["01001"],
        "level": ["mun"],
        "cve_ent": ["01"],
        "graproes": [8.0],
        "pred_abstention": [0.4],
    })
    units_df.to_parquet(tmp_path / "units.parquet", index=False)

    ref = get_reference(build_dir=tmp_path)
    assert ref.context == {}
    assert percentile_of(ref, "mun", "pct_nacido_otra_ent", 50.0) is None


def test_cache_invalidation_on_mtime_change(tmp_path: Path) -> None:
    """Test that updating parquet mtime invalidates and recalculates reference."""
    units_file = tmp_path / "units.parquet"
    df1 = pd.DataFrame({
        "id": ["01001", "01002"],
        "level": ["mun", "mun"],
        "cve_ent": ["01", "01"],
        "graproes": [5.0, 10.0],
        "pred_abstention": [0.3, 0.4],
    })
    df1.to_parquet(units_file, index=False)

    ref1 = get_reference(build_dir=tmp_path)
    assert ref1.associations["mun"]["graproes"].p50 == 7.5

    # Same call returns cached reference
    ref1_cached = get_reference(build_dir=tmp_path)
    assert ref1 is ref1_cached

    # Update units.parquet with different values and adjust mtime
    df2 = pd.DataFrame({
        "id": ["01001", "01002"],
        "level": ["mun", "mun"],
        "cve_ent": ["01", "01"],
        "graproes": [20.0, 30.0],
        "pred_abstention": [0.3, 0.4],
    })
    df2.to_parquet(units_file, index=False)
    new_mtime = time.time() + 10
    os.utime(units_file, (new_mtime, new_mtime))

    ref2 = get_reference(build_dir=tmp_path)
    assert ref2 is not ref1
    assert ref2.associations["mun"]["graproes"].p50 == 25.0


@pytest.mark.skipif(
    not (BUILD_DIR / "units.parquet").is_file()
    or not (BUILD_DIR / "participation.parquet").is_file()
    or not (BUILD_DIR / "context.parquet").is_file(),
    reason="Real build files not present in data/build",
)
def test_real_reference_official_numbers() -> None:
    """Test against real parquets: official 2009-2024 turnout and graproes rho ≈ -0.105."""
    ref = get_reference(build_dir=BUILD_DIR)

    # Official federal turnout (DIP_FED):
    # 2009: 44.06 %, 2012: 62.08 %, 2015: 47.07 %, 2018: 62.37 %, 2021: 51.84 %, 2024: 59.67 %
    expected = {
        2009: 0.4406,
        2012: 0.6208,
        2015: 0.4707,
        2018: 0.6237,
        2021: 0.5184,
        2024: 0.5967,
    }
    for yr, exp_val in expected.items():
        actual = ref.national_participation.get(yr)
        assert actual is not None, f"Year {yr} missing from national_participation"
        assert pytest.approx(actual, abs=0.005) == exp_val, f"Year {yr} expected {exp_val}, got {actual}"

    # Municipal correlation with graproes: rho ≈ -0.105 (± 0.03)
    graproes_stat = ref.associations["mun"]["graproes"]
    assert pytest.approx(graproes_stat.rho, abs=0.03) == -0.105
    assert not graproes_stat.unfavorable_high

    # Context contains Quintana Roo ("23") with ~50.9%
    assert "23" in ref.context
    assert pytest.approx(ref.context["23"]["pct_nacido_otra_ent"], abs=0.5) == 50.9
