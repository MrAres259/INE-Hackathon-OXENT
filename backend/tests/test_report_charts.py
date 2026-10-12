"""Unit tests for atalaya.report.charts."""
import xml.etree.ElementTree as ET
from pathlib import Path
import pytest

from atalaya.report.charts import (
    CATEGORY_COLORS,
    svg_choropleth,
    svg_line,
    svg_bars,
    svg_stacked_bars,
    html_to_pdf,
    find_browser,
)


def test_svg_choropleth_valid_xml_and_coloring():
    geojson = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"id": "01", "name": "Zone A"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [
                        [[-100.0, 20.0], [-99.0, 20.0], [-99.0, 21.0], [-100.0, 21.0], [-100.0, 20.0]]
                    ],
                },
            },
            {
                "type": "Feature",
                "properties": {"id": "02", "name": "Zone B"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [
                        [[-98.0, 20.0], [-97.0, 20.0], [-97.0, 21.0], [-98.0, 21.0], [-98.0, 20.0]]
                    ],
                },
            },
        ],
    }

    fill_map = {"01": "rojo", "02": "#123456"}
    svg_str = svg_choropleth(geojson, fill_map, title="Test Choropleth")

    # 1. Produces valid SVG (parses with xml.etree)
    root = ET.fromstring(svg_str)
    assert root.tag.endswith("svg")

    # 2. Choropleth with known ids colors the correct path
    paths = {elem.attrib.get("data-id"): elem.attrib.get("fill") for elem in root.iter() if elem.tag.endswith("path")}
    assert paths.get("01") == CATEGORY_COLORS["rojo"]
    assert paths.get("02") == "#123456"


def test_svg_line_cuts_on_none_and_valid_xml():
    series = {
        "Serie 1": [
            (2009.0, 40.0),
            (2012.0, 50.0),
            (2015.0, None),
            (2018.0, 60.0),
            (2021.0, 70.0),
        ]
    }

    svg_str = svg_line(series, y_label="Participación", markers={"Serie 1": "square"})
    root = ET.fromstring(svg_str)
    assert root.tag.endswith("svg")

    # Verify path segmentation: two separate lines because of None cut
    paths = [elem for elem in root.iter() if elem.tag.endswith("path")]
    assert len(paths) == 2, "Expected 2 distinct path elements for the 2 segments split by None"

    # Verify square markers were created
    rects = [elem for elem in root.iter() if elem.tag.endswith("rect")]
    assert len(rects) >= 4  # 4 valid points with square markers


def test_svg_bars_valid_xml_horizontal_and_vertical():
    items = [("Municipio A", 45.2), ("Municipio B", -12.4), ("Municipio C", 78.9)]
    svg_h = svg_bars(items, horizontal=True)
    root_h = ET.fromstring(svg_h)
    assert root_h.tag.endswith("svg")

    svg_v = svg_bars(items, horizontal=False)
    root_v = ET.fromstring(svg_v)
    assert root_v.tag.endswith("svg")


def test_svg_stacked_bars_valid_xml():
    rows = [
        ("Base", {"verde": 100, "amarillo": 50, "naranja": 30, "rojo": 20}),
        ("Intervencion", {"verde": 130, "amarillo": 40, "naranja": 20, "rojo": 10}),
    ]
    order = ["verde", "amarillo", "naranja", "rojo"]
    colors = CATEGORY_COLORS

    svg_str = svg_stacked_bars(rows, order=order, colors=colors)
    root = ET.fromstring(svg_str)
    assert root.tag.endswith("svg")


def test_html_to_pdf_browser_not_found(monkeypatch, tmp_path):
    monkeypatch.setattr("atalaya.report.charts.BROWSER_CANDIDATES", [Path("C:/non_existent/chrome.exe")])
    monkeypatch.setattr("shutil.which", lambda _: None)

    with pytest.raises(RuntimeError, match="No headless browser found"):
        find_browser()

    fake_html = tmp_path / "test.html"
    fake_html.write_text("<p>Hello</p>", encoding="utf-8")
    out_pdf = tmp_path / "out.pdf"

    with pytest.raises(RuntimeError, match="No headless browser found"):
        html_to_pdf(fake_html, out_pdf)


def test_html_to_pdf_real_execution(tmp_path):
    # Verify real browser conversion if available
    try:
        find_browser()
    except RuntimeError:
        pytest.skip("No Chrome or Edge browser installed on system")

    html_file = tmp_path / "document.html"
    html_file.write_text("<!DOCTYPE html><html><body><h1>Reporte</h1></body></html>", encoding="utf-8")
    pdf_file = tmp_path / "document.pdf"

    result = html_to_pdf(html_file, pdf_file)
    assert result.is_file()
    assert result.stat().st_size > 0


def test_svg_choropleth_with_legend():
    geojson = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"id": "01"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[-100.0, 20.0], [-99.0, 20.0], [-99.0, 21.0], [-100.0, 21.0], [-100.0, 20.0]]],
                },
            }
        ],
    }
    legend = [("Mejora", "#4caf50"), ("Sin cambio", "#e0e0e0")]
    svg_str = svg_choropleth(geojson, {"01": "#4caf50"}, legend=legend)
    root = ET.fromstring(svg_str)
    assert root.tag.endswith("svg")
    # Check that legend text elements are present
    texts = [elem.text for elem in root.iter() if elem.tag.endswith("text")]
    assert "Mejora" in texts
    assert "Sin cambio" in texts

