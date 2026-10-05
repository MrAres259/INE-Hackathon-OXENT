"""Unit tests for atalaya.load CLI."""

from __future__ import annotations

import sys
from pathlib import Path
import pytest

from atalaya.load import main
from atalaya.store import PandasStore


def test_dry_run_with_empty_build(monkeypatch, capsys, tmp_path: Path):
    empty_build = tmp_path / "build"
    empty_seed = tmp_path / "seed"
    empty_build.mkdir(parents=True, exist_ok=True)
    empty_seed.mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr("atalaya.load.BUILD_DIR", empty_build)
    monkeypatch.setattr("atalaya.load.SEED_DIR", empty_seed)
    monkeypatch.setattr(sys, "argv", ["load", "--dry-run"])

    main()
    out, err = capsys.readouterr()
    assert "Index document counts:" in out
    assert "units: 0" in out
    assert "participation: 0" in out
    assert "catalog: 0" in out
    assert "[dry-run] Validation complete." in out


def test_dry_run_with_sample_fixtures(monkeypatch, capsys, tmp_path: Path):
    fixtures_core = Path(__file__).resolve().parent / "fixtures" / "core"
    build_dir = tmp_path / "build"
    build_dir.mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr("atalaya.load.BUILD_DIR", build_dir)
    monkeypatch.setattr("atalaya.load.SEED_DIR", fixtures_core)
    monkeypatch.setattr(sys, "argv", ["load", "--dry-run", "--only", "catalog"])

    main()
    out, err = capsys.readouterr()
    assert "catalog: 21" in out
    assert "[dry-run] Validation complete." in out


def test_prepare_docs_with_drivers_and_wide_columns(tmp_path: Path):
    from atalaya.load import prepare_units_docs, prepare_participation_docs
    import pandas as pd

    build_dir = tmp_path / "build"
    seed_dir = tmp_path / "seed"
    build_dir.mkdir(parents=True, exist_ok=True)
    seed_dir.mkdir(parents=True, exist_ok=True)

    # Units
    units_df = pd.DataFrame({
        "id": ["07101"],
        "level": ["mun"],
        "cve_ent": ["07"],
        "cvegeo": ["07101"],
        "name": ["Tuxtla Gutiérrez"],
        "pob_18ymas": [1000],
        "lista_nominal": [800],
    })
    units_df.to_parquet(build_dir / "units.parquet", index=False)

    # Participation
    part_df = pd.DataFrame({
        "cvegeo": ["07101"],
        "cve_ent": ["07"],
        "year": [2024],
        "election": ["DIP_FED"],
        "lista_nominal": [800],
        "votos_totales": [480],
        "participacion": [0.60],
    })
    part_df.to_parquet(build_dir / "participation.parquet", index=False)

    # Drivers
    drivers_df = pd.DataFrame({
        "id": ["07101"],
        "level": ["mun"],
        "key": ["pct_18_24"],
        "label": ["Jóvenes"],
        "contribution_pp": [2.5],
        "direction": ["sube_abstencion"],
        "rank": [1],
    })
    drivers_df.to_parquet(build_dir / "drivers.parquet", index=False)

    store = PandasStore(build_dir=build_dir, seed_dir=seed_dir)
    u_docs = prepare_units_docs(store)
    assert len(u_docs) == 2  # mun + derived state
    doc = [d for d in u_docs if d["id"] == "07101"][0]
    assert doc["id"] == "07101"
    assert doc["coverage_ln"] == 0.8
    assert doc["part_dip_2024"] == 0.60
    assert doc["abst_dip_2024"] == 0.40
    assert len(doc["drivers"]) == 1
    assert doc["drivers"][0]["key"] == "pct_18_24"

    p_docs = prepare_participation_docs(store)
    assert len(p_docs) == 2
    p_mun = [p for p in p_docs if p["unit_id"] == "07101"][0]
    assert p_mun["name"] == "Tuxtla Gutiérrez"
    assert p_mun["unit_id"] == "07101"

