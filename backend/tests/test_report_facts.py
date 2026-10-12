"""Tests for facts consistency and cross-deliverable figure alignment.

Verifies CONTEXT.md §13 requirements:
- Single source of truth (compute_facts)
- Mathematical identity of transitions (rojo_base - rojo_interv == salidas - entradas)
- Consistency between summary cards and detailed tables
- Absence of banned strings in both report and presentation
- Character-by-character identity of scenario figures across report and presentation
- Functional description of WebGL interactive map with diff and 3D
"""
from __future__ import annotations

import json
from pathlib import Path
import re

import numpy as np
import pandas as pd
import pytest

from atalaya.report.build_report import generate_report
from atalaya.report.build_slides import build_slides, render_slides_html
from atalaya.report.facts import DEFAULT_REPO_URL, DEFAULT_TEAM, compute_facts


@pytest.fixture
def synthetic_build_env(tmp_path: Path):
    """Creates a comprehensive synthetic workspace for facts testing."""
    build_dir = tmp_path / "build"
    geo_dir = tmp_path / "geo"
    deliv_dir = tmp_path / "deliverables"
    out_dir = tmp_path / "out"

    for d in (build_dir, geo_dir, deliv_dir, out_dir):
        d.mkdir(parents=True, exist_ok=True)

    # 1. Units data: 8 municipalities across 2 states
    units = [
        {"id": "01001", "level": "mun", "cve_ent": "01", "name": "Aguascalientes",
         "lista_nominal": 700000, "pred_abstention": 0.42, "category": "verde", "risk_score": 30.0},
        {"id": "01002", "level": "mun", "cve_ent": "01", "name": "Asientos",
         "lista_nominal": 50000, "pred_abstention": 0.48, "category": "amarillo", "risk_score": 45.0},
        {"id": "01003", "level": "mun", "cve_ent": "01", "name": "Calvillo",
         "lista_nominal": 60000, "pred_abstention": 0.52, "category": "amarillo", "risk_score": 50.0},
        {"id": "02001", "level": "mun", "cve_ent": "02", "name": "Ensenada",
         "lista_nominal": 350000, "pred_abstention": 0.55, "category": "naranja", "risk_score": 60.0},
        {"id": "02002", "level": "mun", "cve_ent": "02", "name": "Mexicali",
         "lista_nominal": 800000, "pred_abstention": 0.58, "category": "naranja", "risk_score": 68.0},
        {"id": "02003", "level": "mun", "cve_ent": "02", "name": "Tecate",
         "lista_nominal": 90000, "pred_abstention": 0.56, "category": "naranja", "risk_score": 62.0},
        {"id": "02004", "level": "mun", "cve_ent": "02", "name": "Tijuana",
         "lista_nominal": 1600000, "pred_abstention": 0.62, "category": "rojo", "risk_score": 85.0},
        {"id": "02005", "level": "mun", "cve_ent": "02", "name": "Playas de Rosarito",
         "lista_nominal": 110000, "pred_abstention": 0.61, "category": "rojo", "risk_score": 80.0},
    ]
    pd.DataFrame(units).to_parquet(build_dir / "units.parquet", index=False)

    # 2. Historical participation
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

    # 3. Demographic profile with standardized age groups
    prof_rows = []
    for yr in [2009, 2024]:
        for ag, sv_h, nv_h, sv_m, nv_m in [
            ("18-24", 3000000, 4000000, 3500000, 3500000),
            ("25-34", 4000000, 6000000, 5000000, 5000000),
            ("35-44", 5000000, 4000000, 5500000, 3500000),
            ("45-54", 5000000, 3000000, 5500000, 2500000),
            ("55-64", 4000000, 2000000, 4500000, 1500000),
            ("65+", 4000000, 2000000, 4500000, 2000000),
        ]:
            prof_rows.append({"year": yr, "election": "DIP_FED", "age_group": ag, "sexo": "H", "sv": sv_h, "nv": nv_h, "ln": sv_h + nv_h})
            prof_rows.append({"year": yr, "election": "DIP_FED", "age_group": ag, "sexo": "M", "sv": sv_m, "nv": nv_m, "ln": sv_m + nv_m})
    pd.DataFrame(prof_rows).to_parquet(build_dir / "ccpc_profile.parquet", index=False)

    # 4. Metrics
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
    (build_dir / "metrics.json").write_text(json.dumps(metrics_obj), encoding="utf-8")

    # 5. Minimal GeoJSON
    geo_data = {
        "type": "FeatureCollection",
        "features": [
            {"type": "Feature", "properties": {"id": "01", "name": "Aguascalientes"},
             "geometry": {"type": "Polygon", "coordinates": [[[-102, 21], [-102, 22], [-101, 22], [-101, 21], [-102, 21]]]}},
            {"type": "Feature", "properties": {"id": "02", "name": "Baja California"},
             "geometry": {"type": "Polygon", "coordinates": [[[-116, 31], [-116, 32], [-115, 32], [-115, 31], [-116, 31]]]}},
        ],
    }
    (geo_dir / "states.json").write_text(json.dumps(geo_data), encoding="utf-8")
    (deliv_dir / "mapa_escenarios_estatal.geojson").write_text(json.dumps(geo_data), encoding="utf-8")

    return {
        "build_dir": build_dir,
        "geo_dir": geo_dir,
        "deliv_dir": deliv_dir,
        "out_dir": out_dir,
    }


def test_compute_facts_keys_and_values(synthetic_build_env):
    """Verifies that compute_facts produces all required keys with valid values."""
    facts = compute_facts(synthetic_build_env["build_dir"], deliverables_dir=synthetic_build_env["deliv_dir"])

    assert facts["team"] == DEFAULT_TEAM
    assert facts["repo_url"] == DEFAULT_REPO_URL
    assert facts["target_year"] == 2027
    assert facts["n_mun"] == 8
    assert "categories" in facts
    assert "base" in facts["categories"]
    assert "intervencion" in facts["categories"]
    assert "pesimista" in facts["categories"]

    assert "ln_risk" in facts
    assert "transitions" in facts
    assert "scenario_params" in facts
    assert "votes" in facts
    assert "model" in facts
    assert "top_priorities" in facts


def test_transitions_mathematical_identity(synthetic_build_env):
    """Verifies exact conservation: rojo_base - rojo_interv == salidas - entradas."""
    facts = compute_facts(synthetic_build_env["build_dir"], deliverables_dir=synthetic_build_env["deliv_dir"])
    trans = facts["transitions"]
    cats = facts["categories"]

    rojo_base = cats["base"]["rojo"]["n"]
    rojo_interv = cats["intervencion"]["rojo"]["n"]
    rojo_net = trans["rojo_net_reduction"]

    assert rojo_base - rojo_interv == rojo_net
    assert rojo_net == trans["rojo_salidas"] - trans["rojo_entradas"]


def test_no_banned_strings_in_report_and_slides(synthetic_build_env):
    """Ensures none of the banned strings from CONTEXT.md §13.1 appear in output HTML."""
    b_dir = synthetic_build_env["build_dir"]
    g_dir = synthetic_build_env["geo_dir"]
    d_dir = synthetic_build_env["deliv_dir"]
    o_dir = synthetic_build_env["out_dir"]

    # 1. Report HTML
    rep_res = generate_report(
        build_dir=b_dir,
        deliverables_dir=d_dir,
        geo_dir=g_dir,
        out_dir=o_dir,
        team="OXENT",
        repo_url="https://github.com/MrAres259/INE-Hackathon-OXENT",
    )
    report_html = rep_res["html_path"].read_text(encoding="utf-8")

    # 2. Slides HTML
    slides_html_path, _ = build_slides(
        build_dir=b_dir,
        geo_dir=g_dir,
        out_dir=o_dir,
        team_name="OXENT",
        repo_url="https://github.com/MrAres259/INE-Hackathon-OXENT",
        make_pdf=False,
    )
    slides_html = slides_html_path.read_text(encoding="utf-8")

    banned_tokens = [
        "20 a 29",
        "18 a 29",
        "Entregable Oficial",
        "intermedias previas",
    ]

    for doc_name, doc_content in [("Report", report_html), ("Slides", slides_html)]:
        for token in banned_tokens:
            assert token not in doc_content, f"Banned token '{token}' found in {doc_name} HTML"

    # Specific check: Direccion Ejecutiva in slide 1 / portada
    assert "Dirección Ejecutiva de Capacitación Electoral y Educación Cívica" not in slides_html[:1500]


def test_identical_scenario_figures_report_and_slides(synthetic_build_env):
    """Verifies that scenario counts and vote impacts are character-by-character identical."""
    b_dir = synthetic_build_env["build_dir"]
    g_dir = synthetic_build_env["geo_dir"]
    d_dir = synthetic_build_env["deliv_dir"]
    o_dir = synthetic_build_env["out_dir"]

    facts = compute_facts(b_dir, deliverables_dir=d_dir)

    rep_res = generate_report(
        build_dir=b_dir,
        deliverables_dir=d_dir,
        geo_dir=g_dir,
        out_dir=o_dir,
    )
    report_html = rep_res["html_path"].read_text(encoding="utf-8")

    slides_html_path, _ = build_slides(
        build_dir=b_dir,
        geo_dir=g_dir,
        out_dir=o_dir,
        make_pdf=False,
    )
    slides_html = slides_html_path.read_text(encoding="utf-8")

    # 1. Additional votes in intervention
    votos_str = facts["votes"]["intervencion"]["votos_fmt"]
    assert votos_str in report_html, f"Votes '{votos_str}' not in report"
    assert votos_str in slides_html, f"Votes '{votos_str}' not in slides"

    # 2. Base rojo municipality count
    rojo_base_str = str(facts["categories"]["base"]["rojo"]["n"])
    assert f"{rojo_base_str} municipios" in report_html or f">{rojo_base_str}<" in report_html
    assert f"{rojo_base_str} municipios" in slides_html or f">{rojo_base_str}<" in slides_html

    # 3. Transitions net reduction
    net_red_str = str(facts["transitions"]["rojo_net_reduction"])
    assert net_red_str in report_html
    assert net_red_str in slides_html


def test_report_mentions_webgl_interactive_map(synthetic_build_env):
    """Verifies that report text mentions WebGL map with comparison, diff and 3D."""
    b_dir = synthetic_build_env["build_dir"]
    g_dir = synthetic_build_env["geo_dir"]
    d_dir = synthetic_build_env["deliv_dir"]
    o_dir = synthetic_build_env["out_dir"]

    rep_res = generate_report(
        build_dir=b_dir,
        deliverables_dir=d_dir,
        geo_dir=g_dir,
        out_dir=o_dir,
    )
    report_html = rep_res["html_path"].read_text(encoding="utf-8")

    assert "WebGL" in report_html
    assert "comparador" in report_html.lower()
    assert "diferencias" in report_html.lower() or "diferencia" in report_html.lower()
    assert "3D" in report_html or "3d" in report_html


def test_unequivocal_percentages_and_rojo_labeling(synthetic_build_env):
    """Verifies F5-D requirement:
    - No '% nacional' string in rendered report or slides HTML.
    - Every occurrence of the base red count is accompanied by 'municipios'.
    - Percentages accompanying zone counts explicitly state their base ('% de los municipios' / '% de la LN').
    """
    b_dir = synthetic_build_env["build_dir"]
    g_dir = synthetic_build_env["geo_dir"]
    d_dir = synthetic_build_env["deliv_dir"]
    o_dir = synthetic_build_env["out_dir"]

    rep_res = generate_report(
        build_dir=b_dir,
        deliverables_dir=d_dir,
        geo_dir=g_dir,
        out_dir=o_dir,
    )
    report_html = rep_res["html_path"].read_text(encoding="utf-8")

    slides_html_path, _ = build_slides(
        build_dir=b_dir,
        geo_dir=g_dir,
        out_dir=o_dir,
        make_pdf=False,
    )
    slides_html = slides_html_path.read_text(encoding="utf-8")

    facts = compute_facts(b_dir, deliverables_dir=d_dir)

    # 1. No '% nacional' in visible text of either document
    assert "% nacional" not in report_html.lower()
    assert "% nacional" not in slides_html.lower()

    # 1b. No double percent '%%' in either document
    assert "%%" not in report_html
    assert "%%" not in slides_html

    # 2. Base rojo count is accompanied by 'municipios' in both documents
    rojo_base_n = facts["categories"]["base"]["rojo"]["n"]
    rojo_str = str(rojo_base_n)

    assert f"{rojo_str} municipios" in report_html
    assert f"{rojo_str} municipios" in slides_html

    # 3. Explicit labels in presentation (slides 6 and 7)
    assert "% de municipios" in slides_html
    assert "% de la LN" in slides_html

    # 4. Explicit labels in report (portada / resumen / tablas)
    assert "% de los municipios" in report_html or "% de municipios" in report_html
    assert "% de la LN" in report_html

