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
    check_overflow,
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
from atalaya.report.facts import compute_facts


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


def test_slides_banned_strings_absence(synthetic_workspace):
    """Verifies that banned strings from §13.1 are not present in rendered presentation HTML."""
    b_dir = synthetic_workspace["build_dir"]
    g_dir = synthetic_workspace["geo_dir"]
    o_dir = synthetic_workspace["out_dir"]

    html_p, _ = build_slides(
        build_dir=b_dir,
        geo_dir=g_dir,
        out_dir=o_dir,
        team_name="OXENT",
        repo_url="https://github.com/MrAres259/INE-Hackathon-OXENT",
        make_pdf=False,
    )
    content = html_p.read_text(encoding="utf-8")

    assert "20 a 29" not in content
    assert "18 a 29" not in content
    assert "Entregable Oficial" not in content
    assert "intermedias previas" not in content

    facts = compute_facts(b_dir)
    rojo_n = facts.get("categories", {}).get("base", {}).get("rojo", {}).get("n", 0)
    if rojo_n != 359:
        assert "359" not in content

    # Direccion Ejecutiva should not appear in slide 1 header / portada
    assert "Dirección Ejecutiva de Capacitación Electoral y Educación Cívica" not in content[:1500]


def test_slides_scenario_figures_in_facts(synthetic_workspace):
    """Verifies that all figures in slide 7 match facts.py exactly."""
    b_dir = synthetic_workspace["build_dir"]
    g_dir = synthetic_workspace["geo_dir"]
    o_dir = synthetic_workspace["out_dir"]

    html_p, _ = build_slides(
        build_dir=b_dir,
        geo_dir=g_dir,
        out_dir=o_dir,
        make_pdf=False,
    )
    content = html_p.read_text(encoding="utf-8")
    facts = compute_facts(b_dir)

    votos_interv = facts["votes"]["intervencion"]["votos_fmt"]
    assert votos_interv in content

    rojo_red = str(facts["transitions"]["rojo_net_reduction"])
    assert rojo_red in content

    votos_pesim = facts["votes"]["pesimista"]["votos_fmt"]
    assert votos_pesim in content


def test_overflow_detector_marks_overloaded_card(tmp_path: Path):
    """Verifies that check_overflow accurately detects a card that overflows its bounding box."""
    try:
        find_browser()
    except RuntimeError:
        pytest.skip("No headless browser installed to test overflow detector")

    test_html = tmp_path / "overflow_test.html"
    test_html.write_text(
        """<!DOCTYPE html>
<html>
<head>
  <style>
    .slide { width: 1920px; height: 1080px; position: relative; }
    .card { width: 300px; height: 80px; overflow: hidden; padding: 10px; }
  </style>
</head>
<body>
  <section class="slide" id="slide-overflow-fixture">
    <div class="card">
      <p>""" + "Texto largo de prueba que desborda forzadamente el contenedor para validar el detector. " * 30 + """</p>
    </div>
  </section>
  <script>
    window.addEventListener("DOMContentLoaded", function() {
      var cards = document.querySelectorAll(".card");
      for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        if (card.scrollHeight > card.clientHeight + 1) {
          card.setAttribute("data-overflow", "1");
          var slide = card.closest(".slide");
          if (slide) {
            slide.setAttribute("data-overflow", "1");
          }
        }
      }
    });
  </script>
</body>
</html>
""",
        encoding="utf-8",
    )

    overflowing = check_overflow(test_html)
    assert "slide-overflow-fixture" in overflowing


def test_slides_unequivocal_percentages_and_chart_labels(synthetic_workspace):
    """Verifies that presentation HTML has no ambiguous '% nacional', has bar charts labeled with '% de municipios',
    and has explicit bases for zone percentages."""
    b_dir = synthetic_workspace["build_dir"]
    g_dir = synthetic_workspace["geo_dir"]
    o_dir = synthetic_workspace["out_dir"]

    html_p, _ = build_slides(
        build_dir=b_dir,
        geo_dir=g_dir,
        out_dir=o_dir,
        team_name="OXENT",
        repo_url="https://github.com/MrAres259/INE-Hackathon-OXENT",
        make_pdf=False,
    )
    content = html_p.read_text(encoding="utf-8")

    # 1. No '% nacional' in visible text
    assert "% nacional" not in content.lower()
    assert "%%" not in content

    # 2. Slide 6 and 7 bar / cards labeled '% de municipios'
    assert "% de municipios" in content

    # 3. Explicit '% de la LN'
    assert "% de la LN" in content

    # 4. Red municipality count accompanied by 'municipios'
    facts = compute_facts(b_dir)
    rojo_n = facts["categories"]["base"]["rojo"]["n"]
    assert f"{rojo_n} municipios" in content

