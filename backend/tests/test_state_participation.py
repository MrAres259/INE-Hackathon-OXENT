"""Unit and integration tests for state participation definition: SV / (SV + NV)."""

from __future__ import annotations

from pathlib import Path
import numpy as np
import pandas as pd
import pytest

from atalaya.config import BUILD_DIR
from atalaya.store import PandasStore, _turnout


def test_turnout_helper_function():
    """Verify _turnout handles Series, arrays, and scalars, falling back to SV/LN when NV is None."""
    # 1. Scalar with NV
    p1 = _turnout(sv=100, nv=50, ln=200)
    assert pytest.approx(p1, abs=1e-6) == 100 / 150

    # 2. Scalar without NV (fallback to SV/LN)
    p2 = _turnout(sv=100, nv=None, ln=200)
    assert pytest.approx(p2, abs=1e-6) == 100 / 200

    # 3. Series with NV
    sv_s = pd.Series([100, 200, 0])
    nv_s = pd.Series([50, 100, 100])
    ln_s = pd.Series([200, 400, 150])
    p_s = _turnout(sv_s, nv_s, ln_s)
    assert pytest.approx(p_s.iloc[0], abs=1e-6) == 100 / 150
    assert pytest.approx(p_s.iloc[1], abs=1e-6) == 200 / 300
    assert pytest.approx(p_s.iloc[2], abs=1e-6) == 0.0

    # 4. Series without NV (fallback to SV/LN)
    p_fallback = _turnout(sv_s, None, ln_s)
    assert pytest.approx(p_fallback.iloc[0], abs=1e-6) == 100 / 200
    assert pytest.approx(p_fallback.iloc[1], abs=1e-6) == 200 / 400


def test_synthetic_state_participation(tmp_path: Path):
    """Synthetic test with 2 states and 3 municipalities with ns > 0."""
    build_dir = tmp_path / "build"
    seed_dir = tmp_path / "seed"
    build_dir.mkdir(parents=True, exist_ok=True)
    seed_dir.mkdir(parents=True, exist_ok=True)

    # Minimal states.csv
    states_csv = "cve_ent,name\n01,Estado 01\n02,Estado 02\n"
    (seed_dir / "states.csv").write_text(states_csv, encoding="utf-8")

    # 3 municipalities across 2 states: 2 in State 01, 1 in State 02
    # Municipal rows have known SV, NV, NS, LN
    # State 01:
    #   Mun 01001: LN=1000, SV=400, NV=500, NS=100 -> turnout = 400 / 900 ≈ 0.444444, ns_rate = 100/1000 = 0.10
    #   Mun 01002: LN=2000, SV=800, NV=1000, NS=200 -> turnout = 800 / 1800 ≈ 0.444444, ns_rate = 200/2000 = 0.10
    # State 01 Total:
    #   LN = 3000, SV = 1200, NV = 1500, NS = 300
    #   Turnout = 1200 / (1200 + 1500) = 1200 / 2700 ≈ 0.444444
    #   (Notice SV/LN would have been 1200/3000 = 0.400000 != 0.444444)
    #   ns_rate = 300 / 3000 = 0.10
    # State 02:
    #   Mun 02001: LN=5000, SV=2500, NV=2000, NS=500 -> turnout = 2500 / 4500 ≈ 0.555556, ns_rate = 500/5000 = 0.10
    # State 02 Total:
    #   LN = 5000, SV = 2500, NV = 2000, NS = 500
    #   Turnout = 2500 / 4500 ≈ 0.555556
    #   (SV/LN would have been 2500/5000 = 0.500000)

    part_df = pd.DataFrame({
        "cvegeo": ["01001", "01002", "02001"],
        "cve_ent": ["01", "01", "02"],
        "year": [2024, 2024, 2024],
        "election": ["DIP_FED", "DIP_FED", "DIP_FED"],
        "lista_nominal": [1000, 2000, 5000],
        "votos_totales": [400, 800, 2500],
        "nv": [500, 1000, 2000],
        "ns": [100, 200, 500],
        "participacion": [400 / 900, 800 / 1800, 2500 / 4500],
        "ns_rate": [0.10, 0.10, 0.10],
        "reliable": [True, True, True],
        "low_confidence": [False, False, False],
    })
    part_df.to_parquet(build_dir / "participation.parquet", index=False)

    # Minimal units dataframe
    units_df = pd.DataFrame({
        "id": ["01001", "01002", "02001"],
        "level": ["mun", "mun", "mun"],
        "cve_ent": ["01", "01", "02"],
        "name": ["Mun 1", "Mun 2", "Mun 3"],
        "lista_nominal": [1000, 2000, 5000],
        "pob_tot": [1200, 2400, 6000],
        "pob_18ymas": [1000, 2000, 5000],
        "risk_score": [40.0, 50.0, 60.0],
        "category": ["amarillo", "amarillo", "naranja"],
    })
    units_df.to_parquet(build_dir / "units.parquet", index=False)

    store = PandasStore(build_dir=build_dir, seed_dir=seed_dir)

    # 1. Test store.participation(level="state")
    st_part = store.participation(level="state", election="DIP_FED", years=[2024])
    assert len(st_part) == 2

    st_01 = st_part[st_part["unit_id"] == "01"].iloc[0]
    expected_p_01 = 1200 / 2700  # SV / (SV + NV)
    assert pytest.approx(st_01["participacion"], abs=1e-5) == expected_p_01
    assert pytest.approx(st_01["abstencion"], abs=1e-5) == 1.0 - expected_p_01
    assert pytest.approx(st_01["ns_rate"], abs=1e-5) == 300 / 3000
    assert st_01["reliable"] == True

    st_02 = st_part[st_part["unit_id"] == "02"].iloc[0]
    expected_p_02 = 2500 / 4500  # SV / (SV + NV)
    assert pytest.approx(st_02["participacion"], abs=1e-5) == expected_p_02
    assert pytest.approx(st_02["abstencion"], abs=1e-5) == 1.0 - expected_p_02
    assert pytest.approx(st_02["ns_rate"], abs=1e-5) == 500 / 5000

    # 2. Test wide participation columns in store.units(level="state")
    st_units = store.units(level="state")
    assert "part_dip_2024" in st_units.columns
    assert "abst_dip_2024" in st_units.columns
    u_01 = st_units[st_units["id"] == "01"].iloc[0]
    assert pytest.approx(u_01["part_dip_2024"], abs=1e-5) == expected_p_01
    assert pytest.approx(u_01["abst_dip_2024"], abs=1e-5) == 1.0 - expected_p_01


@pytest.mark.skipif(
    not (BUILD_DIR / "participation.parquet").is_file() or not (BUILD_DIR / "units.parquet").is_file(),
    reason="Real data parquet files not found in BUILD_DIR",
)
def test_real_data_state_participation():
    """Verify state participation definition with real build data."""
    store = PandasStore(build_dir=BUILD_DIR)

    # 1. State participation in 2024 for Baja California (02) and Chiapas (07)
    st_part_2024 = store.participation(level="state", election="DIP_FED", years=[2024])
    assert not st_part_2024.empty

    bc_row = st_part_2024[st_part_2024["unit_id"] == "02"]
    assert not bc_row.empty
    bc_p_2024 = float(bc_row.iloc[0]["participacion"])
    # Baja California 2024: 47.05% ± 0.05 pp (0.4705 ± 0.0005)
    assert pytest.approx(bc_p_2024, abs=0.0005) == 0.4705

    chis_row = st_part_2024[st_part_2024["unit_id"] == "07"]
    assert not chis_row.empty
    chis_p_2024 = float(chis_row.iloc[0]["participacion"])
    # Chiapas 2024: 61.77% ± 0.05 pp (0.6177 ± 0.0005)
    assert pytest.approx(chis_p_2024, abs=0.0005) == 0.6177

    # 2. National weighted average reproduces official figures:
    # 2024: 59.67% ± 0.05 pp
    # 2021: 51.84% ± 0.05 pp
    part_real = pd.read_parquet(BUILD_DIR / "participation.parquet")
    part_dip = part_real[(part_real["election"] == "DIP_FED") & (part_real["reliable"])].copy()
    part_dip["cve_ent"] = part_dip["cve_ent"].astype(str).str.zfill(2)

    # 2024 national aggregate
    dip_2024 = part_dip[part_dip["year"] == 2024]
    nat_2024 = float(dip_2024["votos_totales"].sum() / (dip_2024["votos_totales"].sum() + dip_2024["nv"].sum()))
    assert pytest.approx(nat_2024, abs=0.0005) == 0.5967

    # 2021 national aggregate
    dip_2021 = part_dip[part_dip["year"] == 2021]
    nat_2021 = float(dip_2021["votos_totales"].sum() / (dip_2021["votos_totales"].sum() + dip_2021["nv"].sum()))
    assert pytest.approx(nat_2021, abs=0.0005) == 0.5184

    # 3. State row in units.parquet has last_participation for BC ≈ 0.4705
    units_df = pd.read_parquet(BUILD_DIR / "units.parquet")
    st_units = units_df[units_df["level"] == "state"]
    bc_unit = st_units[st_units["id"] == "02"]
    if not bc_unit.empty:
        bc_last_p = float(bc_unit.iloc[0]["last_participation"])
        # CONTRACT-NOTE: If units.parquet hasn't been regenerated yet, this will pass after build_model
        assert pytest.approx(bc_last_p, abs=0.001) == 0.4705
