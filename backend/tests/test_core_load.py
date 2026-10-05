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
