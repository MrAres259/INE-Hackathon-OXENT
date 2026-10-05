"""Unit tests for atalaya.report.build_report."""
import json
from pathlib import Path
import re
import pandas as pd
import pytest

from atalaya.report.build_report import generate_report
from atalaya.report.charts import find_browser


@pytest.fixture
def synthetic_workspace(tmp_path):
    build_dir = tmp_path / "build"
    build_dir.mkdir(parents=True)
    deliv_dir = tmp_path / "deliverables"
    deliv_dir.mkdir(parents=True)
    out_dir = tmp_path / "out"
    out_dir.mkdir(parents=True)

    # 1. Synthetic units.parquet
    records = []
    # 2 states
    records.append({
        "id": "01",
        "level": "state",
        "cve_ent": "01",
        "name": "Aguascalientes",
        "lista_nominal": 1000000,
        "pred_abstention": 0.45,
        "category": "amarillo",
        "risk_score": 42.0,
        "trend_pp": 0.5,
        "volatility_pp": 2.0,
    })
    records.append({
        "id": "02",
        "level": "state",
        "cve_ent": "02",
        "name": "Baja California",
        "lista_nominal": 2500000,
        "pred_abstention": 0.58,
        "category": "naranja",
        "risk_score": 65.0,
        "trend_pp": -1.2,
        "volatility_pp": 3.5,
    })
    # 6 municipalities
    mun_cats = ["verde", "amarillo", "naranja", "rojo", "verde", "naranja"]
    for i, cat in enumerate(mun_cats, start=1):
        st = "01" if i <= 3 else "02"
        mid = f"{st}{i:03d}"
        records.append({
            "id": mid,
            "level": "mun",
            "cve_ent": st,
            "name": f"Municipio {mid}",
            "lista_nominal": 150000 + i * 10000,
            "pred_abstention": 0.35 + (0.08 * i),
            "category": cat,
            "risk_score": 25.0 + i * 12.0,
            "trend_pp": 0.2 * i,
            "volatility_pp": 1.5,
            "pob_18ymas": 140000 + i * 10000,
            "coverage_ln": 1.05,
            "pct_18_24": 0.18,
            "pct_rural": 0.20,
            "pct_hli": 0.05,
            "pct_analfabeta": 0.03,
            "graproes": 9.5,
            "pct_internet": 0.60,
            "pct_65ymas": 0.10,
            "gm_2020": "Medio",
        })

    units_df = pd.DataFrame(records)
    units_df.to_parquet(build_dir / "units.parquet", index=False)

    # 2. Synthetic participation.parquet
    part_rows = []
    for yr in [2009, 2012, 2015, 2018, 2021, 2024]:
        part_rows.append({
            "cvegeo": "01001",
            "cve_ent": "01",
            "year": yr,
            "election": "DIP_FED",
            "lista_nominal": 500000,
            "votos_totales": 250000 + (yr % 4) * 20000,
            "nv": 250000 - (yr % 4) * 20000,
            "ns": 100,
            "reliable": True,
        })
    part_rows.append({
        "cvegeo": "01001",
        "cve_ent": "01",
        "year": 2025,
        "election": "PJF",
        "lista_nominal": 500000,
        "votos_totales": 65000,
        "nv": 435000,
        "ns": 50,
        "reliable": True,
    })
    pd.DataFrame(part_rows).to_parquet(build_dir / "participation.parquet", index=False)

    # 3. Synthetic drivers.parquet
    drivers_rows = [
        {"id": "01001", "key": "graproes", "direction": "reduce_abstencion", "rank": 1},
        {"id": "01002", "key": "pct_18_24", "direction": "sube_abstencion", "rank": 1},
    ]
    pd.DataFrame(drivers_rows).to_parquet(build_dir / "drivers.parquet", index=False)

    # 4. Synthetic metrics.json
    metrics_data = {
        "selected_model": "persist_l1",
        "structural_r2": 0.30,
        "coefficients": [
            {"key": "graproes", "label": "Escolaridad promedio", "coef_pp_per_sd": 2.75},
            {"key": "pct_18_24", "label": "Jóvenes de 18 a 24 años", "coef_pp_per_sd": -3.01},
        ],
        "candidates": [
            {
                "name": "persist_l1",
                "mean_mae_pp": 6.0,
                "folds": [
                    {"test_year": 2021, "mae_pp": 5.95, "spearman": 0.84, "top20_hit": 0.68},
                    {"test_year": 2024, "mae_pp": 6.05, "spearman": 0.81, "top20_hit": 0.70},
                ],
            }
        ],
        "excluded_unreliable": {"2009": 10, "2012": 5, "2015": 20, "2018": 15, "2021": 8, "2024": 12},
    }
    (build_dir / "metrics.json").write_text(json.dumps(metrics_data), encoding="utf-8")

    # 5. Synthetic GeoJSON files
    def make_geojson(ids):
        features = []
        for i, fid in enumerate(ids):
            ring = [[-100.0 + i, 20.0], [-99.0 + i, 20.0], [-99.0 + i, 21.0], [-100.0 + i, 21.0], [-100.0 + i, 20.0]]
            features.append({
                "type": "Feature",
                "properties": {"id": fid, "name": f"Area {fid}"},
                "geometry": {"type": "Polygon", "coordinates": [ring]},
            })
        return {"type": "FeatureCollection", "features": features}

    (deliv_dir / "mapa_escenarios_estatal.geojson").write_text(
        json.dumps(make_geojson(["01", "02"])), encoding="utf-8"
    )
    (deliv_dir / "mapa_escenarios_municipal.geojson").write_text(
        json.dumps(make_geojson(["01001", "01002", "01003", "02004", "02005", "02006"])), encoding="utf-8"
    )

    return {
        "build_dir": build_dir,
        "deliverables_dir": deliv_dir,
        "out_dir": out_dir,
    }


def test_build_report_generates_html_with_10_sections_and_no_nan(synthetic_workspace):
    res = generate_report(
        build_dir=synthetic_workspace["build_dir"],
        deliverables_dir=synthetic_workspace["deliverables_dir"],
        out_dir=synthetic_workspace["out_dir"],
    )

    html_file = res["html_path"]
    assert html_file.is_file()

    content = html_file.read_text(encoding="utf-8")

    # 1. Verify all 10 sections are present
    assert "1. Resumen Ejecutivo" in content
    assert "2. Objetivo, Alcance y Principios" in content
    assert "3. Datos y Variables" in content
    assert "4. Panorama Histórico" in content
    assert "5. Modelo de Riesgo" in content
    assert "6. Semáforo de Riesgo Territorial" in content
    assert "7. Análisis de Escenarios" in content
    assert "8. Recomendaciones Preventivas y Priorización de Recursos" in content
    assert "9. Viabilidad e Implementación" in content
    assert "10. Limitaciones y Anexo" in content

    # 2. Verify no unrendered 'nan', 'NaN', 'None', or 'null' in visible content
    # Strip script/style blocks before checking text
    clean_text = re.sub(r"<(script|style).*?>.*?</\1>", "", content, flags=re.DOTALL)
    clean_text = re.sub(r"<[^>]+>", " ", clean_text)  # remove tags

    # Search for standalone nan, NaN, None, null
    bad_tokens = re.findall(r"\b(NaN|nan|None|null)\b", clean_text)
    assert not bad_tokens, f"Found unformatted tokens in visible HTML text: {bad_tokens[:10]}"


def test_build_report_pdf_generation_if_browser_available(synthetic_workspace):
    try:
        find_browser()
    except RuntimeError:
        pytest.skip("Chrome/Edge not available for PDF test")

    res = generate_report(
        build_dir=synthetic_workspace["build_dir"],
        deliverables_dir=synthetic_workspace["deliverables_dir"],
        out_dir=synthetic_workspace["out_dir"],
    )

    pdf_file = res["pdf_path"]
    assert pdf_file.is_file()
    assert pdf_file.stat().st_size > 1000

    pages = res.get("pages", 0)
    assert pages >= 10, f"Expected at least 10 pages in the generated PDF, got {pages}"
