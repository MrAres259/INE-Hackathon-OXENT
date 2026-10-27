"""In-process tests for autonomous scenario viewer generator."""

from __future__ import annotations

import json
from pathlib import Path
import re

import pytest

from atalaya.viewer import build_viewer, main, prune_geojson, round_coordinates


@pytest.fixture
def synthetic_geojsons(tmp_path: Path):
    """Generates minimal synthetic GeoJSON files and dummy maplibre assets."""
    states_data = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [
                        [[-102.1234567, 21.9876543], [-102.2345678, 22.0987654], [-102.1234567, 21.9876543]]
                    ],
                },
                "properties": {
                    "id": "01",
                    "name": "Aguascalientes",
                    "lista_nominal": 1000000,
                    "pred_abstention_base": 0.4913,
                    "category_base": "naranja",
                    "pred_abstention_intervencion": 0.4641,
                    "category_intervencion": "amarillo",
                    "delta_pp_intervencion": -2.7,
                    "top_recommendation": "Promoción del voto joven",
                    "unused_extra_field": "remove_me",
                },
            }
        ],
    }

    mun_data = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [
                        [[-102.111199, 21.888899], [-102.222299, 21.999999], [-102.111199, 21.888899]]
                    ],
                },
                "properties": {
                    "id": "01001",
                    "ent": "01",
                    "name": "Aguascalientes",
                    "lista_nominal": 700000,
                    "pred_abstention_base": 0.4850,
                    "category_base": "naranja",
                    "pred_abstention_intervencion": 0.4550,
                    "category_intervencion": "amarillo",
                    "delta_pp_intervencion": -3.0,
                    "top_recommendation": "Promoción del voto joven",
                    "unused_extra_field": "remove_me",
                },
            }
        ],
    }

    states_p = tmp_path / "states.geojson"
    mun_p = tmp_path / "mun.geojson"
    states_p.write_text(json.dumps(states_data), encoding="utf-8")
    mun_p.write_text(json.dumps(mun_data), encoding="utf-8")

    dummy_js = tmp_path / "maplibre-gl.js"
    dummy_css = tmp_path / "maplibre-gl.css"
    dummy_js.write_text("/* dummy maplibre js */ window.maplibregl = {};", encoding="utf-8")
    dummy_css.write_text("/* dummy maplibre css */ .maplibregl-map { position: relative; }", encoding="utf-8")

    return {
        "states_path": states_p,
        "mun_path": mun_p,
        "js_path": dummy_js,
        "css_path": dummy_css,
    }


def test_round_coordinates():
    geom = {
        "type": "Polygon",
        "coordinates": [[[-102.12345678, 21.98765432], [-102.55555555, 22.44444444]]],
    }
    rounded = round_coordinates(geom, decimals=4)
    c0 = rounded["coordinates"][0][0]
    assert c0 == [-102.1235, 21.9877]
    c1 = rounded["coordinates"][0][1]
    assert c1 == [-102.5556, 22.4444]


def test_prune_geojson():
    fc = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [-102.1234567, 21.9876543],
                },
                "properties": {
                    "id": "01",
                    "name": "Aguascalientes",
                    "pred_abstention_base": 0.5,
                    "category_base": "naranja",
                    "pred_abstention_intervencion": 0.45,
                    "category_intervencion": "amarillo",
                    "delta_pp_intervencion": -5.0,
                    "extra_heavy_prop": "x" * 1000,
                },
            }
        ],
    }
    pruned = prune_geojson(fc, coord_decimals=3)
    p = pruned["features"][0]["properties"]
    assert "id" in p
    assert "name" in p
    assert "category_base" in p
    assert "category_intervencion" in p
    assert "extra_heavy_prop" not in p
    assert pruned["features"][0]["geometry"]["coordinates"] == [-102.123, 21.988]


def test_build_viewer_synthetic(synthetic_geojsons, tmp_path: Path):
    out_html = tmp_path / "visor_test.html"

    out_p, size_mb, exceeded = build_viewer(
        mun_geojson_path=synthetic_geojsons["mun_path"],
        states_geojson_path=synthetic_geojsons["states_path"],
        out_path=out_html,
        maplibre_js_path=synthetic_geojsons["js_path"],
        maplibre_css_path=synthetic_geojsons["css_path"],
        max_size_mb=12.0,
    )

    assert out_p.is_file()
    assert size_mb > 0
    assert not exceeded

    html_content = out_p.read_text(encoding="utf-8")

    # 1. Embedded data parses and has both scenarios
    match_st = re.search(r'<script type="application/json" id="data-states">\s*([\s\S]*?)\s*</script>', html_content)
    assert match_st is not None, "Missing data-states script tag"
    st_json = json.loads(match_st.group(1))
    assert len(st_json["features"]) == 1
    st_props = st_json["features"][0]["properties"]
    assert "category_base" in st_props
    assert "category_intervencion" in st_props
    assert "pred_abstention_base" in st_props
    assert "pred_abstention_intervencion" in st_props
    assert "delta_pp_intervencion" in st_props

    match_mun = re.search(r'<script type="application/json" id="data-mun">\s*([\s\S]*?)\s*</script>', html_content)
    assert match_mun is not None, "Missing data-mun script tag"
    mun_json = json.loads(match_mun.group(1))
    assert len(mun_json["features"]) == 1
    mun_props = mun_json["features"][0]["properties"]
    assert "category_base" in mun_props
    assert "category_intervencion" in mun_props

    # 2. Check 4 modes are present
    assert "Semáforo Base" in html_content
    assert "Con Intervención" in html_content
    assert "Cambio Δ (pp)" in html_content
    assert "Comparar" in html_content

    # 3. Check no resource URLs (no http/https in src, href, url(), or fetch)
    bad_resource_patterns = [
        re.compile(r'<(?:script|link|img|iframe)\s+[^>]*?(?:src|href)\s*=\s*["\']https?://', re.IGNORECASE),
        re.compile(r'url\s*\(\s*["\']?https?://', re.IGNORECASE),
        re.compile(r'(?:fetch|XMLHttpRequest)\s*\(\s*["\']https?://', re.IGNORECASE),
    ]
    for pattern in bad_resource_patterns:
        matches = pattern.findall(html_content)
        assert len(matches) == 0, f"Found external resource request: {matches}"

    # 4. Check branding
    assert "Atalaya Electoral" in html_content
    assert "<svg" in html_content
    assert re.search(r'>\s*ATALAYA\s*<', html_content) is None


def test_size_warning(synthetic_geojsons, tmp_path: Path, capsys):
    out_html = tmp_path / "visor_warning.html"
    _, size_mb, exceeded = build_viewer(
        mun_geojson_path=synthetic_geojsons["mun_path"],
        states_geojson_path=synthetic_geojsons["states_path"],
        out_path=out_html,
        maplibre_js_path=synthetic_geojsons["js_path"],
        maplibre_css_path=synthetic_geojsons["css_path"],
        max_size_mb=0.0001,  # Tiny threshold to trigger warning
    )
    assert exceeded is True
    captured = capsys.readouterr()
    assert "excede el objetivo" in captured.out


def test_missing_export_error(tmp_path: Path):
    with pytest.raises(FileNotFoundError) as exc_info:
        build_viewer(
            mun_geojson_path=tmp_path / "nonexistent_mun.geojson",
            states_geojson_path=tmp_path / "nonexistent_st.geojson",
            out_path=tmp_path / "out.html",
        )
    assert "python -m atalaya.export" in str(exc_info.value)


def test_cli_invocation(synthetic_geojsons, tmp_path: Path):
    out_html = tmp_path / "cli_out.html"
    code = main([
        "--mun-geojson", str(synthetic_geojsons["mun_path"]),
        "--states-geojson", str(synthetic_geojsons["states_path"]),
        "--maplibre-js", str(synthetic_geojsons["js_path"]),
        "--maplibre-css", str(synthetic_geojsons["css_path"]),
        "--out", str(out_html),
    ])
    assert code == 0
    assert out_html.is_file()

    # Test failure mode
    code_fail = main(["--mun-geojson", str(tmp_path / "does_not_exist.geojson")])
    assert code_fail != 0
