"""CLI and builder for the methodological report (reporte_metodologico.html and .pdf)."""
from __future__ import annotations

import argparse
import html
import json
import math
from pathlib import Path
import re
from typing import Any

import jinja2
import numpy as np
import pandas as pd

from atalaya.config import BUILD_DIR, CACHE_DIR, REPO_DIR, SEED_DIR
from atalaya.model.scenarios import simulate
from atalaya.report.charts import (
    CATEGORY_COLORS,
    find_browser,
    html_to_pdf,
    svg_bars,
    svg_choropleth,
    svg_line,
    svg_stacked_bars,
)
from atalaya.report.facts import DEFAULT_REPO_URL, DEFAULT_TEAM, compute_facts

try:
    from atalaya.report.map_capture import MapSpec, capture_maps, png_data_uri
except ImportError:
    # CONTRACT-NOTE: W2-D provides map_capture.py in parallel
    MapSpec = None  # type: ignore[assignment,misc]
    capture_maps = None  # type: ignore[assignment]
    png_data_uri = None  # type: ignore[assignment]

DELIVERABLES_DIR = REPO_DIR / "deliverables"
GEO_DIR = REPO_DIR / "frontend" / "public" / "geo"


def _fmt_pct(val: Any, decimals: int = 1) -> str:
    if val is None or pd.isna(val):
        return "N/D"
    return f"{float(val) * 100.0:.{decimals}f}"


def _fmt_int(val: Any) -> str:
    if val is None or pd.isna(val):
        return "N/D"
    return f"{int(round(float(val))):,}"


def _fmt_float(val: Any, decimals: int = 2) -> str:
    if val is None or pd.isna(val):
        return "N/D"
    return f"{float(val):.{decimals}f}"


def _safe_float(val: Any, default: float = 0.0) -> float:
    if val is None or pd.isna(val):
        return default
    try:
        return float(val)
    except (ValueError, TypeError):
        return default


def load_state_catalog(seed_dir: Path) -> dict[str, str]:
    path = seed_dir / "states.csv"
    if path.is_file():
        df = pd.read_csv(path, dtype=str)
        col = "name" if "name" in df.columns else "nom_ent"
        return dict(zip(df["cve_ent"].str.zfill(2), df[col]))
    return {}


def count_pdf_pages(pdf_path: Path) -> int:
    """Counts pages in a generated PDF file using /Type /Page regex."""
    if not pdf_path.is_file():
        return 0
    content = pdf_path.read_bytes()
    matches = re.findall(rb"/Type\s*/Page\b", content)
    return len(matches)


def generate_report(
    build_dir: Path | None = None,
    deliverables_dir: Path | None = None,
    geo_dir: Path | None = None,
    out_dir: Path | None = None,
    *,
    team: str = DEFAULT_TEAM,
    repo_url: str = DEFAULT_REPO_URL,
    svg_maps: bool = False,
) -> dict[str, Any]:
    """Generates the methodological report in HTML and PDF formats."""
    b_dir = build_dir or BUILD_DIR
    d_dir = deliverables_dir or DELIVERABLES_DIR
    g_dir = geo_dir or GEO_DIR
    o_dir = out_dir or d_dir
    o_dir.mkdir(parents=True, exist_ok=True)

    # 1. Compute all quantitative facts (single source of truth)
    stats = compute_facts(b_dir, deliverables_dir=d_dir, team=team, repo_url=repo_url)

    # 2. Charts
    history_line_svg = svg_line(
        {
            "DIP_FED (CCPC)": stats["hist_dip_pts"],
            "PJF 2025": [(2025.0, stats["pjf_rate"])],
        },
        width=640,
        height=220,
        y_label="Participación (%)",
        y_fmt="{:.0f}%",
        markers={"PJF 2025": "square"},
    )

    age_gender_bars_svg = svg_bars(
        stats["age_gender_chart_items"],
        width=300,
        height=200,
        horizontal=True,
        value_fmt="{:.1f}%",
        colors=["#90caf9", "#f48fb1", "#90caf9", "#f48fb1", "#90caf9", "#f48fb1",
                "#1565c0", "#ad1457", "#1565c0", "#ad1457", "#1565c0", "#ad1457"],
    )

    # 3. GeoJSON maps & specifications
    state_geojson_file = d_dir / "mapa_escenarios_estatal.geojson"
    if not state_geojson_file.is_file():
        state_geojson_file = g_dir / "states.json"
    state_geojson = json.loads(state_geojson_file.read_text(encoding="utf-8")) if state_geojson_file.is_file() else {}

    mun_geojson_file = d_dir / "mapa_escenarios_municipal.geojson"
    mun_geojson = json.loads(mun_geojson_file.read_text(encoding="utf-8")) if mun_geojson_file.is_file() else {}

    # State 2024 participation choropleth
    fill_state_part: dict[str, str] = {}
    features_file = b_dir / "ccpc_features.parquet"
    if features_file.is_file():
        try:
            cf_df = pd.read_parquet(features_file)
            if not cf_df.empty and "year" in cf_df.columns:
                cf24_st = cf_df[(cf_df["year"] == 2024) & (cf_df.get("level") == "state")]
                for _, r in cf24_st.iterrows():
                    cid = str(r["cve_ent"]).zfill(2)
                    part = _safe_float(r.get("part_total"), 0.55)
                    if part >= 0.65:
                        color = "#004d40"
                    elif part >= 0.58:
                        color = "#00796b"
                    elif part >= 0.52:
                        color = "#26a69a"
                    else:
                        color = "#80cbc4"
                    fill_state_part[cid] = color
        except Exception:
            pass

    # State semáforo choropleth
    fill_state_semaforo: dict[str, str] = {}
    units_file = b_dir / "units.parquet"
    units_df = pd.read_parquet(units_file) if units_file.is_file() else pd.DataFrame()
    state_units = units_df[units_df.get("level") == "state"] if not units_df.empty and "level" in units_df.columns else pd.DataFrame()
    if not state_units.empty and "category" in state_units.columns:
        for _, r in state_units.iterrows():
            cid = str(r.get("id", "")).zfill(2)
            fill_state_semaforo[cid] = CATEGORY_COLORS.get(str(r.get("category")), "#bdbdbd")
    elif stats.get("state_table"):
        for st in stats["state_table"]:
            cid = st["cve_ent"]
            pct = st.get("_pct_rn_num", 0.0)
            cat = "rojo" if pct > 75 else ("naranja" if pct > 45 else ("amarillo" if pct > 20 else "verde"))
            fill_state_semaforo[cid] = CATEGORY_COLORS.get(cat, "#bdbdbd")

    # Municipal semáforo choropleths
    mun_df = units_df[units_df.get("level") == "mun"] if not units_df.empty and "level" in units_df.columns else units_df
    fill_mun_base: dict[str, str] = {}
    fill_mun_interv: dict[str, str] = {}
    fill_mun_diff: dict[str, str] = {}

    if not mun_df.empty and "category" in mun_df.columns:
        for _, r in mun_df.iterrows():
            mid = str(r.get("id", "")).zfill(5)
            cat = str(r.get("category", "sin_dato"))
            fill_mun_base[mid] = CATEGORY_COLORS.get(cat, "#bdbdbd")

    try:
        items_interv_full, _ = simulate(units_df, "intervencion")
        items_interv = items_interv_full[items_interv_full.get("level") == "mun"] if "level" in items_interv_full.columns else items_interv_full
    except Exception:
        items_interv = pd.DataFrame()

    if not items_interv.empty and "category" in items_interv.columns:
        base_cat_map = dict(zip(mun_df["id"], mun_df["category"])) if "id" in mun_df.columns and "category" in mun_df.columns else {}
        for _, r in items_interv.iterrows():
            mid = str(r.get("id", "")).zfill(5)
            cat = str(r.get("category", "sin_dato"))
            fill_mun_interv[mid] = CATEGORY_COLORS.get(cat, "#bdbdbd")

            cat_base = base_cat_map.get(r.get("id"), "sin_dato")
            if cat_base == "rojo" and cat != "rojo":
                fill_mun_diff[mid] = "#4caf50"  # desescaló de rojo
            elif cat_base == "naranja" and cat in ("amarillo", "verde"):
                fill_mun_diff[mid] = "#8bc34a"  # desescaló de naranja
            elif cat == "rojo":
                fill_mun_diff[mid] = "#c62828"  # rojo persistente
            else:
                fill_mun_diff[mid] = "#e0e0e0"  # sin cambio relevante

    def _add_map_figure_class(svg_str: str) -> str:
        if "<svg " in svg_str and 'class=' not in svg_str:
            return svg_str.replace("<svg ", '<svg class="map-figure" ', 1)
        return svg_str

    fallback_svgs: dict[str, str] = {
        "state_part_2024": _add_map_figure_class(
            svg_choropleth(state_geojson, fill_state_part, width=600, height=230)
        ),
        "state_semaforo": _add_map_figure_class(
            svg_choropleth(state_geojson, fill_state_semaforo, width=600, height=230)
        ),
        "mun_semaforo_base": _add_map_figure_class(
            svg_choropleth(mun_geojson, fill_mun_base, width=600, height=220) if mun_geojson else "<svg></svg>"
        ),
        "mun_semaforo_intervencion": _add_map_figure_class(
            svg_choropleth(mun_geojson, fill_mun_interv, width=600, height=220) if mun_geojson else "<svg></svg>"
        ),
        "mun_diff": _add_map_figure_class(
            svg_choropleth(mun_geojson, fill_mun_diff, width=600, height=220) if mun_geojson else "<svg></svg>"
        ),
    }

    map_alts: dict[str, str] = {
        "state_part_2024": "Participación ciudadana oficial por entidad federativa en la Elección Federal 2024",
        "state_semaforo": "Semáforo estatal de riesgo de abstención para la Elección Federal 2027 (Escenario Base)",
        "mun_semaforo_base": "Semáforo de riesgo de abstención en los 2,478 municipios de México (Escenario Base 2027)",
        "mun_semaforo_intervencion": "Semáforo municipal resultante bajo el Escenario de Intervención Preventiva Focalizada",
        "mun_diff": "Mapa de transiciones de riesgo: municipios que reducen su nivel de alerta con la intervención",
    }

    map_names = ["state_part_2024", "state_semaforo", "mun_semaforo_base", "mun_semaforo_intervencion", "mun_diff"]
    total_maps = len(map_names)
    specs: list[Any] = []
    if MapSpec is not None:
        specs = [
            MapSpec(
                name="state_part_2024",
                level="state",
                fill_by_id=fill_state_part,
                width=600,
                height=230,
            ),
            MapSpec(
                name="state_semaforo",
                level="state",
                fill_by_id=fill_state_semaforo,
                width=600,
                height=230,
            ),
            MapSpec(
                name="mun_semaforo_base",
                level="mun",
                fill_by_id=fill_mun_base,
                width=600,
                height=220,
            ),
            MapSpec(
                name="mun_semaforo_intervencion",
                level="mun",
                fill_by_id=fill_mun_interv,
                width=600,
                height=220,
            ),
            MapSpec(
                name="mun_diff",
                level="mun",
                fill_by_id=fill_mun_diff,
                width=600,
                height=220,
            ),
        ]

    # Map capture with MapLibre GL
    captured: dict[str, bytes | None] = {}
    if not svg_maps and capture_maps is not None and specs:
        try:
            captured = capture_maps(specs)
        except Exception as exc:
            print(f"Aviso: Falló la captura de mapas ({exc}), usando respaldo SVG.")
            captured = {}

    figuras_dir = d_dir / "figuras"
    rendered_maps: dict[str, str] = {}
    map_engines: dict[str, str] = {}
    maplibre_count = 0

    for name in map_names:
        png_bytes = captured.get(name)
        spec = next((s for s in specs if s.name == name), None) if specs else None
        if png_bytes is not None and spec is not None:
            figuras_dir.mkdir(parents=True, exist_ok=True)
            png_path = figuras_dir / f"{spec.name}.png"
            png_path.write_bytes(png_bytes)
            uri = png_data_uri(png_bytes) if png_data_uri else ""
            rendered_maps[name] = (
                f'<img class="map-figure" src="{uri}" width="{spec.width}" height="{spec.height}" '
                f'alt="{map_alts.get(name, name)}">'
            )
            map_engines[name] = "maplibre"
            maplibre_count += 1
        else:
            rendered_maps[name] = fallback_svgs[name]
            map_engines[name] = "svg"

    map_engines["map_part_2024"] = map_engines["state_part_2024"]
    map_engines["map_state_semaforo"] = map_engines["state_semaforo"]
    map_engines["map_mun_semaforo"] = map_engines["mun_semaforo_base"]
    map_engines["map_mun_intervencion"] = map_engines["mun_semaforo_intervencion"]
    map_engines["map_mun_diff"] = map_engines["mun_diff"]

    if maplibre_count == total_maps:
        summary_msg = f"mapas: maplibre {maplibre_count}/{total_maps}"
    else:
        svg_failed = [name for name in map_names if map_engines.get(name) == "svg"]
        summary_msg = f"mapas: maplibre {maplibre_count}/{total_maps} (svg-respaldo: {', '.join(svg_failed)})"
    print(summary_msg)

    # 4. Template render
    templates_dir = Path(__file__).resolve().parent / "templates"
    env = jinja2.Environment(loader=jinja2.FileSystemLoader(str(templates_dir)), autoescape=False)
    template = env.get_template("report.html")

    charts = {
        "history_line": history_line_svg,
        "map_part_2024": rendered_maps["state_part_2024"],
        "age_gender_bars": age_gender_bars_svg,
        "map_state_semaforo": rendered_maps["state_semaforo"],
        "map_mun_semaforo": rendered_maps["mun_semaforo_base"],
        "map_mun_intervencion": rendered_maps["mun_semaforo_intervencion"],
        "map_mun_diff": rendered_maps["mun_diff"],
    }

    rendered_html = template.render(stats=stats, charts=charts, map_engines=map_engines)
    html_out = o_dir / "reporte_metodologico.html"
    html_out.write_text(rendered_html, encoding="utf-8")

    # 5. PDF compilation
    pdf_out = o_dir / "reporte_metodologico.pdf"
    pdf_pages = 0
    try:
        html_to_pdf(html_out, pdf_out, timeout_s=180)
        pdf_pages = count_pdf_pages(pdf_out)
        print(f"Reporte metodológico generado: {pdf_out} ({pdf_pages} páginas)")
    except Exception as exc:
        print(f"Aviso: Generación de PDF no completada ({exc})")

    return {
        "html_path": html_out,
        "pdf_path": pdf_out,
        "pages": pdf_pages,
        "stats": stats,
        "maps": {
            "maplibre_count": maplibre_count,
            "total_maps": total_maps,
            "engines": map_engines,
            "summary": summary_msg,
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Genera el reporte metodológico y preventivo de ATALAYA")
    parser.add_argument("--build-dir", type=Path, default=BUILD_DIR, help="Ruta al directorio data/build")
    parser.add_argument("--deliverables", type=Path, default=DELIVERABLES_DIR, help="Ruta a deliverables")
    parser.add_argument("--geo-dir", type=Path, default=GEO_DIR, help="Ruta a GeoJSON")
    parser.add_argument("--out", type=Path, default=DELIVERABLES_DIR, help="Directorio de salida para el reporte")
    parser.add_argument("--team", "--team-name", dest="team", type=str, default=DEFAULT_TEAM, help="Nombre del equipo")
    parser.add_argument("--repo-url", type=str, default=DEFAULT_REPO_URL, help="URL del repositorio")
    parser.add_argument("--svg-maps", action="store_true", help="Forzar el respaldo SVG sin intentar la captura MapLibre")
    args = parser.parse_args()

    res = generate_report(
        build_dir=args.build_dir,
        deliverables_dir=args.deliverables,
        geo_dir=args.geo_dir,
        out_dir=args.out,
        team=args.team,
        repo_url=args.repo_url,
        svg_maps=args.svg_maps,
    )
    pages = res.get("pages", 0)
    print(f"Listo: {res['html_path']} y {res['pdf_path']} ({pages} páginas).")


if __name__ == "__main__":
    main()
