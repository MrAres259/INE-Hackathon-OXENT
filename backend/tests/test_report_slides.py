"""Tests for executive presentation slides builder (W4-D)."""
from __future__ import annotations

import json
from pathlib import Path
import re
import shutil

import numpy as np
import pandas as pd
import pytest

from atalaya.report.build_slides import (
    _fmt_int,
    _fmt_pct,
    _safe_float,
    build_slides,
    compute_category_counts,
    compute_scenarios,
    compute_top_priorities,
    load_age_profile,
    load_historical_series,
    load_metrics,
    load_units,
    render_slides_html,
)
from atalaya.report.charts import find_browser


@pytest.fixture
def synthetic_workspace(tmp_path: Path):
    """Creates a minimal synthetic build environment with mock data."""
    build_dir = tmp_path / "build"
    geo_dir = tmp_path / "geo"
    out_dir = tmp_path / "out"

    build_dir.mkdir(parents=True)
    geo_dir.mkdir(parents=True)
    out_dir.mkdir(parents=True)

    # 1. Synthetic units.parquet
    units_data = [
        {
            "id": "01001",
            "level": "mun",
            "cve_ent": "01",
            "name": "Aguascalientes",
            "lista_nominal": 700000,
            "pred_participation": 0.58,
            "pred_abstention": 0.42,
            "category": "verde",
            "risk_score": 30.0,
            "trend_pp": 0.5,
            "volatility_pp": 1.2,
            "last_year": 2024,
            "last_participation": 0.58,
            "pred_low": 0.38,
            "pred_high": 0.46,
        },
        {
            "id": "02001",
            "level": "mun",
            "cve_ent": "02",
            "name": "Ensenada",
            "lista_nominal": 350000,
            "pred_participation": 0.45,
            "pred_abstention": 0.55,
            "category": "naranja",
            "risk_score": 60.0,
            "trend_pp": -0.8,
            "volatility_pp": 2.1,
            "last_year": 2024,
            "last_participation": 0.45,
            "pred_low": 0.51,
            "pred_high": 0.59,
        },
        {
            "id": "02004",
            "level": "mun",
            "cve_ent": "02",
            "name": "Tijuana",
            "lista_nominal": 1600000,
            "pred_participation": 0.39,
            "pred_abstention": 0.61,
            "category": "rojo",
            "risk_score": 85.0,
            "trend_pp": -1.5,
            "volatility_pp": 2.5,
            "last_year": 2024,
            "last_participation": 0.39,
            "pred_low": 0.57,
            "pred_high": 0.65,
        },
        {
            "id": "14039",
            "level": "mun",
            "cve_ent": "14",
            "name": "Guadalajara",
            "lista_nominal": 1200000,
            "pred_participation": 0.52,
            "pred_abstention": 0.48,
            "category": "amarillo",
            "risk_score": 45.0,
            "trend_pp": -0.2,
            "volatility_pp": 1.8,
            "last_year": 2024,
            "last_participation": 0.52,
            "pred_low": 0.44,
            "pred_high": 0.52,
        },
    ]
    pd.DataFrame(units_data).to_parquet(build_dir / "units.parquet", index=False)

    # 2. Synthetic participation.parquet
    part_rows = []
    for yr, sv, nv, ln in [
        (2009, 33000000, 42000000, 75000000),
        (2012, 47000000, 28000000, 75000000),
        (2015, 36000000, 41000000, 80000000),
        (2018, 51000000, 31000000, 85000000),
        (2021, 46000000, 43000000, 90000000),
        (2024, 54000000, 37000000, 95000000),
    ]:
        part_rows.append({
            "cvegeo": "01001",
            "cve_ent": "01",
            "year": yr,
            "election": "DIP_FED",
            "lista_nominal": ln,
            "votos_totales": sv,
            "nv": nv,
            "participacion": sv / (sv + nv),
        })
    pd.DataFrame(part_rows).to_parquet(build_dir / "participation.parquet", index=False)

    # 3. Synthetic ccpc_profile.parquet
    profile_rows = []
    for ag, sv, nv in [
        ("18-24", 7000000, 7000000),
        ("25-34", 10000000, 10000000),
        ("35-44", 10000000, 7000000),
        ("45-54", 10000000, 5000000),
        ("55-64", 8000000, 3000000),
        ("65+", 8000000, 3000000),
    ]:
        profile_rows.append({
            "cve_ent": "01",
            "ine_mun": 1,
            "mun_norm": "AGUASCALIENTES",
            "year": 2024,
            "election": "DIP_FED",
            "age_group": ag,
            "sexo": "H",
            "ln": sv + nv,
            "sv": sv,
            "nv": nv,
        })
    pd.DataFrame(profile_rows).to_parquet(build_dir / "ccpc_profile.parquet", index=False)

    # 4. Synthetic metrics.json
    metrics_obj = {
        "target_year": 2027,
        "selected_model": "persist_l1",
        "backtests": [
            {"train_until": 2018, "test_year": 2021, "mae_pp": 5.95, "spearman": 0.84, "top20_hit": 0.676},
            {"train_until": 2021, "test_year": 2024, "mae_pp": 6.05, "spearman": 0.81, "top20_hit": 0.696},
        ],
        "structural_r2": 0.30,
        "calibration_pp": 51.84,
    }
    with open(build_dir / "metrics.json", "w", encoding="utf-8") as f:
        json.dump(metrics_obj, f)

    # 5. Synthetic GeoJSON in geo_dir
    states_geojson = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"id": "01", "name": "Aguascalientes"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[-102.0, 21.0], [-102.0, 22.0], [-101.0, 22.0], [-101.0, 21.0], [-102.0, 21.0]]],
                },
            },
            {
                "type": "Feature",
                "properties": {"id": "02", "name": "Baja California"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[-116.0, 31.0], [-116.0, 32.0], [-115.0, 32.0], [-115.0, 31.0], [-116.0, 31.0]]],
                },
            },
        ],
    }
    with open(geo_dir / "states.json", "w", encoding="utf-8") as f:
        json.dump(states_geojson, f)

    return {
        "build_dir": build_dir,
        "geo_dir": geo_dir,
        "out_dir": out_dir,
    }


def test_format_helpers_no_nan_or_none():
    """Ensures formatting helpers safely handle None, NaN, and irregular values."""
    assert _safe_float(None, 1.5) == 1.5
    assert _safe_float(np.nan, 2.0) == 2.0
    assert _safe_float("invalid", 3.0) == 3.0
    assert _safe_float(4.5) == 4.5

    assert _fmt_int(None) == "0"
    assert _fmt_int(float("nan")) == "0"
    assert _fmt_int(1234567) == "1,234,567"

    assert _fmt_pct(None) == "0.0%"
    assert _fmt_pct(float("nan")) == "0.0%"
    assert _fmt_pct(0.5184) == "51.8%"
    assert _fmt_pct(51.84) == "51.8%"


def test_render_slides_html_structure(synthetic_workspace):
    """Verifies that the generated HTML has exactly 10 sections, valid titles, and no nan/None."""
    b_dir = synthetic_workspace["build_dir"]
    g_dir = synthetic_workspace["geo_dir"]
    o_dir = synthetic_workspace["out_dir"]

    html_p, pdf_p = build_slides(
        build_dir=b_dir,
        geo_dir=g_dir,
        out_dir=o_dir,
        team_name="Equipo Demo INE",
        repo_url="https://github.com/ine/atalaya",
        make_pdf=False,
    )

    assert html_p.is_file()
    assert o_dir / "presentacion_ejecutiva.html" == html_p

    content = html_p.read_text(encoding="utf-8")

    # 1. Exactly 10 <section> tags
    sections = re.findall(r'<section\b', content)
    assert len(sections) == 10, f"Expected exactly 10 sections, got {len(sections)}"

    # 2. Check all 10 slide titles are present
    titles = re.findall(r'<h1[^>]*>(.*?)</h1>', content, flags=re.DOTALL)
    assert len(titles) == 10, f"Expected 10 h1 titles, found {len(titles)}"

    expected_keywords = [
        "ATALAYA",
        "Problema",
        "Datos",
        "Hallazgos",
        "Modelo",
        "Semáforo",
        "Escenarios",
        "Priorización",
        "Implementación",
        "Cierre",
    ]
    for idx, (title, keyword) in enumerate(zip(titles, expected_keywords), start=1):
        clean_title = title.strip()
        assert clean_title != "", f"Slide {idx} title is empty"
        assert keyword.lower() in clean_title.lower(), f"Slide {idx} title '{clean_title}' missing '{keyword}'"

    # 3. Check placeholders or custom text
    assert "Equipo Demo INE" in content
    assert "https://github.com/ine/atalaya" in content

    # 4. Check that no visible "nan" or "None" appears outside tags/CSS
    clean = re.sub(r'<style[^>]*>.*?</style>', '', content, flags=re.DOTALL)
    clean = re.sub(r'<script[^>]*>.*?</script>', '', clean, flags=re.DOTALL)
    text = re.sub(r'<[^>]+>', ' ', clean)
    visible_nan_or_none = re.findall(r'\b(?:nan|none)\b', text, flags=re.IGNORECASE)
    assert not visible_nan_or_none, f"Found visible nan/none in HTML content: {visible_nan_or_none}"


def test_slides_pdf_generation(synthetic_workspace):
    """Verifies that PDF generation compiles 10 pages when a headless browser is available."""
    try:
        find_browser()
    except RuntimeError:
        pytest.skip("No headless Chrome or Edge browser installed on this environment")

    b_dir = synthetic_workspace["build_dir"]
    g_dir = synthetic_workspace["geo_dir"]
    o_dir = synthetic_workspace["out_dir"]

    html_p, pdf_p = build_slides(
        build_dir=b_dir,
        geo_dir=g_dir,
        out_dir=o_dir,
        make_pdf=True,
    )

    assert pdf_p is not None
    assert pdf_p.is_file()
    assert pdf_p.stat().st_size > 5000

    # Count pages in PDF binary: /Type /Page (excluding /Type /Pages)
    pdf_bytes = pdf_p.read_bytes()
    page_matches = re.findall(rb'/Type\s*/Page[^s]', pdf_bytes)
    assert len(page_matches) == 10, f"Expected PDF with exactly 10 pages, found {len(page_matches)}"


def test_compute_functions(synthetic_workspace):
    """Tests helper calculation functions with synthetic DataFrames."""
    b_dir = synthetic_workspace["build_dir"]
    units = load_units(b_dir)

    counts = compute_category_counts(units)
    assert "rojo_count" in counts
    assert "naranja_count" in counts
    assert "amarillo_count" in counts
    assert "verde_count" in counts

    priorities = compute_top_priorities(units, {"01": "Aguascalientes", "02": "Baja California"})
    assert len(priorities) > 0
    assert priorities[0]["rank"] == 1
    assert "name" in priorities[0]
    assert "abs_esp_fmt" in priorities[0]

    series = load_historical_series(b_dir)
    assert len(series) >= 6
    assert all(yr in [2009, 2012, 2015, 2018, 2021, 2024] for yr, _ in series)

    age_rates = load_age_profile(b_dir)
    assert len(age_rates) >= 5
