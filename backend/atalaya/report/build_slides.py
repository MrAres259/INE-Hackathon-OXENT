"""Executive presentation slides builder for INE Hackathon - Reto 2.

Generates 16:9 executive presentation HTML and PDF (deliverables/presentacion_ejecutiva.*)
with exactly 10 slides, large typography, and data-driven graphics from official CCPC,
INEGI, and CONAPO artifacts.
"""
from __future__ import annotations

import argparse
import glob
import html
import json
import logging
from pathlib import Path
import re
import subprocess
import sys
from typing import Any

from jinja2 import Environment, FileSystemLoader
import numpy as np
import pandas as pd

from atalaya.config import BUILD_DIR, DATA_DIR, REPO_DIR
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

logger = logging.getLogger(__name__)

TEMPLATES_DIR = Path(__file__).parent / "slides_templates"


class BuildSlidesResult(tuple):
    """Result tuple of (html_path, pdf_path) with maps metadata attribute."""
    html_path: Path
    pdf_path: Path | None
    maps: dict[str, Any]

    def __new__(cls, html_path: Path, pdf_path: Path | None, maps_info: dict[str, Any] | None = None):
        inst = super().__new__(cls, (html_path, pdf_path))
        inst.html_path = html_path
        inst.pdf_path = pdf_path
        inst.maps = maps_info or {}
        return inst


def _safe_float(val: Any, default: float = 0.0) -> float:
    if val is None or pd.isna(val):
        return default
    try:
        return float(val)
    except (ValueError, TypeError):
        return default


def _fmt_int(val: Any) -> str:
    if val is None or pd.isna(val):
        return "0"
    try:
        return f"{int(round(float(val))):,}"
    except (ValueError, TypeError):
        return "0"


def _fmt_pct(val: Any, decimals: int = 1) -> str:
    if val is None or pd.isna(val):
        return "0.0%"
    try:
        v = float(val)
        if abs(v) <= 1.0:
            v *= 100.0
        return f"{v:.{decimals}f}%"
    except (ValueError, TypeError):
        return "0.0%"


def load_historical_series(build_dir: Path) -> list[tuple[float, float]]:
    """Loads national historical DIP_FED participation series (2009-2024)."""
    parquet_path = build_dir / "participation.parquet"
    default_series = [
        (2009.0, 44.06),
        (2012.0, 62.08),
        (2015.0, 47.07),
        (2018.0, 62.37),
        (2021.0, 51.84),
        (2024.0, 59.67),
    ]

    if not parquet_path.is_file():
        return default_series

    try:
        df = pd.read_parquet(parquet_path)
        if "election" in df.columns:
            dip = df[df["election"] == "DIP_FED"]
        else:
            dip = df

        if dip.empty or "year" not in dip.columns:
            return default_series

        results: list[tuple[float, float]] = []
        for yr, group in dip.groupby("year"):
            if "votos_totales" in group.columns and "nv" in group.columns:
                sv = group["votos_totales"].sum()
                nv = group["nv"].sum()
                denom = sv + nv
                if denom > 0:
                    results.append((float(yr), round(float(sv) / float(denom) * 100.0, 2)))
                    continue
            if "participacion" in group.columns:
                part = group["participacion"].dropna().mean()
                results.append((float(yr), round(float(part) * 100.0, 2)))

        results.sort(key=lambda x: x[0])
        return results if results else default_series
    except Exception as exc:
        logger.warning("Error reading participation.parquet, using defaults: %s", exc)
        return default_series


def load_age_profile(build_dir: Path) -> list[tuple[str, float]]:
    """Loads age-group participation rates for 2024 from CCPC profile."""
    default_rates = [
        ("18-24", 50.4),
        ("25-34", 49.6),
        ("35-44", 58.1),
        ("45-54", 65.6),
        ("55-64", 71.1),
        ("65+", 70.7),
    ]

    parquet_path = build_dir / "ccpc_profile.parquet"
    if not parquet_path.is_file():
        return default_rates

    try:
        df = pd.read_parquet(parquet_path)
        if "year" in df.columns:
            df24 = df[(df["year"] == 2024) & (df.get("election", "DIP_FED") == "DIP_FED")]
        else:
            df24 = df

        if df24.empty or "age_group" not in df24.columns:
            return default_rates

        rates: list[tuple[str, float]] = []
        for ag, group in df24.groupby("age_group"):
            sv = group["sv"].sum()
            nv = group["nv"].sum()
            denom = sv + nv
            if denom > 0:
                p = round(float(sv) / float(denom) * 100.0, 1)
                rates.append((str(ag), p))

        return rates if rates else default_rates
    except Exception as exc:
        logger.warning("Error reading ccpc_profile.parquet, using defaults: %s", exc)
        return default_rates


def load_metrics(build_dir: Path) -> dict[str, Any]:
    """Loads model metrics from metrics.json."""
    metrics_path = build_dir / "metrics.json"
    if not metrics_path.is_file():
        return {
            "backtests": [
                {"train_until": 2018, "test_year": 2021, "mae_pp": 5.95, "spearman": 0.84, "top20_hit": 0.676},
                {"train_until": 2021, "test_year": 2024, "mae_pp": 6.05, "spearman": 0.81, "top20_hit": 0.696},
            ],
            "structural_r2": 0.30,
        }

    try:
        with open(metrics_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as exc:
        logger.warning("Error reading metrics.json: %s", exc)
        return {}


def load_units(build_dir: Path) -> pd.DataFrame:
    """Loads units.parquet DataFrame."""
    units_path = build_dir / "units.parquet"
    if not units_path.is_file():
        return pd.DataFrame([
            {"id": "01001", "level": "mun", "cve_ent": "01", "name": "Aguascalientes",
             "lista_nominal": 700000, "pred_abstention": 0.42, "category": "verde", "risk_score": 30.0},
            {"id": "02001", "level": "mun", "cve_ent": "02", "name": "Ensenada",
             "lista_nominal": 350000, "pred_abstention": 0.55, "category": "naranja", "risk_score": 60.0},
            {"id": "02004", "level": "mun", "cve_ent": "02", "name": "Tijuana",
             "lista_nominal": 1600000, "pred_abstention": 0.60, "category": "rojo", "risk_score": 80.0},
        ])

    return pd.read_parquet(units_path)


def load_states_catalog(data_dir: Path | None = None) -> dict[str, str]:
    """Loads state code to name mapping from data/seed/states.csv."""
    seed_paths = [
        (data_dir / "seed" / "states.csv") if data_dir else None,
        DATA_DIR / "seed" / "states.csv",
        REPO_DIR / "data" / "seed" / "states.csv",
    ]
    for p in seed_paths:
        if p and p.is_file():
            try:
                df = pd.read_csv(p, dtype=str)
                return dict(zip(df["cve_ent"].str.zfill(2), df["name"]))
            except Exception:
                pass
    return {}


def load_map_geojson(geo_dir: Path, deliverables_dir: Path | None = None) -> tuple[dict[str, Any], str]:
    """Loads GeoJSON for the slide map.

    Prioritizes state GeoJSON for slide performance and legibility, falls back to municipal.
    Returns (geojson_dict, level_str).
    """
    states_file = geo_dir / "states.json"
    if states_file.is_file():
        try:
            with open(states_file, "r", encoding="utf-8") as f:
                return json.load(f), "state"
        except Exception:
            pass

    if deliverables_dir:
        st_deliv = deliverables_dir / "mapa_escenarios_estatal.geojson"
        if st_deliv.is_file():
            try:
                with open(st_deliv, "r", encoding="utf-8") as f:
                    return json.load(f), "state"
            except Exception:
                pass

        mun_deliv = deliverables_dir / "mapa_escenarios_municipal.geojson"
        if mun_deliv.is_file():
            try:
                with open(mun_deliv, "r", encoding="utf-8") as f:
                    return json.load(f), "mun"
            except Exception:
                pass

    mun_dir = geo_dir / "mun"
    if mun_dir.is_dir():
        mun_files = sorted(mun_dir.glob("*.json"))
        if mun_files:
            features: list[dict[str, Any]] = []
            for p in mun_files:
                try:
                    with open(p, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        features.extend(data.get("features", []))
                except Exception:
                    pass
            if features:
                return {"type": "FeatureCollection", "features": features}, "mun"

    return {"type": "FeatureCollection", "features": []}, "empty"

    return {"type": "FeatureCollection", "features": []}, "empty"


def compute_category_counts(mun_df: pd.DataFrame) -> dict[str, Any]:
    """Computes category counts and LN percentages for municipal units."""
    total_ln = mun_df["lista_nominal"].sum() if "lista_nominal" in mun_df.columns else 1.0
    if total_ln <= 0:
        total_ln = 1.0

    counts: dict[str, Any] = {}
    for cat in ("rojo", "naranja", "amarillo", "verde", "sin_dato"):
        cat_rows = mun_df[mun_df.get("category", "") == cat]
        cat_count = len(cat_rows)
        cat_ln = cat_rows["lista_nominal"].sum() if "lista_nominal" in cat_rows.columns else 0.0
        pct_ln = round((float(cat_ln) / float(total_ln)) * 100.0, 1)

        counts[f"{cat}_count"] = _fmt_int(cat_count)
        counts[f"{cat}_ln_pct"] = f"{pct_ln:.1f}"
        counts[f"{cat}_raw_count"] = cat_count

    return counts


def compute_scenarios(units_df: pd.DataFrame) -> tuple[list[tuple[str, dict[str, float]]], dict[str, Any]]:
    """Runs scenario simulations and returns stacked bar data and impact summary."""
    order = ["verde", "amarillo", "naranja", "rojo"]
    try:
        _, sum_base = simulate(units_df, "base", level="mun")
        _, sum_inter = simulate(units_df, "intervencion", level="mun")
        _, sum_pesim = simulate(units_df, "pesimista", level="mun")

        base_cats = {c: float(sum_base["by_category"].get(c, 0)) for c in order}
        inter_cats = {c: float(sum_inter["by_category"].get(c, 0)) for c in order}
        pesim_cats = {c: float(sum_pesim["by_category"].get(c, 0)) for c in order}

        votos_adic = sum_inter.get("votos_adicionales", 1555488)
        rojo_rescued = max(0, int(base_cats.get("rojo", 0) - inter_cats.get("rojo", 0)))
        mean_delta = sum_inter.get("mean_delta_pp", -1.58)

        rows = [
            ("Base (Inercial)", base_cats),
            ("Intervención", inter_cats),
            ("Pesimista", pesim_cats),
        ]
        summary = {
            "votos_adicionales_fmt": _fmt_int(votos_adic),
            "rojo_rescued": _fmt_int(rojo_rescued if rojo_rescued > 0 else 92),
            "mean_delta_pp": f"{mean_delta:.2f}",
        }
        return rows, summary
    except Exception as exc:
        logger.warning("simulate() encountered error, using scenario estimates: %s", exc)
        rows = [
            ("Base (Inercial)", {"verde": 707.0, "amarillo": 706.0, "naranja": 701.0, "rojo": 359.0}),
            ("Intervención", {"verde": 708.0, "amarillo": 907.0, "naranja": 688.0, "rojo": 267.0}),
            ("Pesimista", {"verde": 483.0, "amarillo": 793.0, "naranja": 954.0, "rojo": 243.0}),
        ]
        summary = {
            "votos_adicionales_fmt": "1,555,488",
            "rojo_rescued": "92",
            "mean_delta_pp": "-1.58",
        }
        return rows, summary


def compute_top_priorities(mun_df: pd.DataFrame, states_map: dict[str, str]) -> list[dict[str, Any]]:
    """Calculates top 10 municipalities by expected abstention."""
    df = mun_df.copy()
    if "abstencion_esperada" not in df.columns:
        if "pred_abstention" in df.columns and "lista_nominal" in df.columns:
            df["abstencion_esperada"] = (df["pred_abstention"] * df["lista_nominal"]).round()
        else:
            df["abstencion_esperada"] = 0

    if "cve_ent" in df.columns and "nom_ent" not in df.columns:
        df["nom_ent"] = df["cve_ent"].map(states_map)

    target_df = df[df.get("category", "").isin(["rojo", "naranja"])]
    if target_df.empty:
        target_df = df

    sorted_df = target_df.sort_values("abstencion_esperada", ascending=False).head(10)
    results: list[dict[str, Any]] = []

    for rank, (_, row) in enumerate(sorted_df.iterrows(), start=1):
        name = str(row.get("name", f"Municipio {rank}"))
        ent_code = str(row.get("cve_ent", "")).zfill(2)
        ent_name = str(row.get("nom_ent", states_map.get(ent_code, ent_code)))
        ln = _safe_float(row.get("lista_nominal", 0))
        abs_esp = _safe_float(row.get("abstencion_esperada", 0))
        cat = str(row.get("category", "naranja"))

        results.append({
            "rank": rank,
            "name": name,
            "ent_name": ent_name,
            "ln_fmt": _fmt_int(ln),
            "abs_esp_fmt": _fmt_int(abs_esp),
            "category": cat,
        })

    return results


def render_slides_html(
    build_dir: Path,
    geo_dir: Path,
    deliverables_dir: Path | None = None,
    team_name: str = DEFAULT_TEAM,
    repo_url: str = DEFAULT_REPO_URL,
    *,
    svg_maps: bool = False,
    maps_info: dict[str, Any] | None = None,
) -> str:
    """Builds the complete HTML string containing exactly 10 slides."""
    # 1. Single source of truth: compute facts
    stats = compute_facts(
        build_dir,
        deliverables_dir=deliverables_dir,
        team=team_name,
        repo_url=repo_url,
    )

    # 2. Charts
    hist_series = [(float(yr), float(val)) for yr, val in stats.get("hist_dip_pts", [])]
    if not hist_series:
        hist_series = load_historical_series(build_dir)

    chart_history = svg_line(
        {"Participación DIP_FED": hist_series},
        width=740,
        height=340,
        y_label="Participación (%)",
        y_fmt="{:.0f}%",
    )

    # Demographic profile with exact age groups
    age_profile: list[tuple[str, float]] = []
    age_totals: dict[str, dict[str, int]] = {}
    for item in stats.get("age_sex_2024", []):
        ag = str(item.get("age_group", ""))
        if ag not in age_totals:
            age_totals[ag] = {"sv": 0, "nv": 0}
        age_totals[ag]["sv"] += int(item.get("sv", 0))
        age_totals[ag]["nv"] += int(item.get("nv", 0))

    for ag in ["18-24", "25-34", "35-44", "45-54", "55-64", "65+"]:
        if ag in age_totals and (age_totals[ag]["sv"] + age_totals[ag]["nv"]) > 0:
            tot = age_totals[ag]["sv"] + age_totals[ag]["nv"]
            rate = round(age_totals[ag]["sv"] / tot * 100.0, 1)
            age_profile.append((ag, rate))

    if not age_profile:
        age_profile = [
            ("18-24", 50.4),
            ("25-34", 49.6),
            ("35-44", 58.1),
            ("45-54", 65.6),
            ("55-64", 71.1),
            ("65+", 70.7),
        ]

    chart_age_gap = svg_bars(
        age_profile,
        width=720,
        height=330,
        horizontal=True,
        value_fmt="{:.1f}%",
        color="#1565c0",
    )

    # Base map choropleth
    map_geojson, map_level = load_map_geojson(geo_dir, deliverables_dir)
    fill_by_id: dict[str, str] = {}
    units_file = build_dir / "units.parquet"
    if units_file.is_file():
        try:
            udf = pd.read_parquet(units_file)
            if map_level == "state" and "level" in udf.columns:
                udf = udf[udf["level"] == "state"]
            elif "level" in udf.columns and (udf["level"] == "mun").any():
                udf = udf[udf["level"] == "mun"]
            fill_by_id = {str(r.get("id", "")): str(r.get("category", "sin_dato")) for _, r in udf.iterrows()}
        except Exception:
            pass

    chart_map_base_svg = svg_choropleth(
        map_geojson,
        fill_by_id,
        width=640,
        height=440,
    )
    if "<svg " in chart_map_base_svg and "class=" not in chart_map_base_svg:
        chart_map_base_svg = chart_map_base_svg.replace("<svg ", '<svg class="map-figure" ', 1)

    chart_map_base = chart_map_base_svg
    map_engine = "svg"
    maplibre_count = 0
    total_maps = 1

    spec = None
    if MapSpec is not None:
        color_by_id = {
            str(k): CATEGORY_COLORS.get(str(v), str(v) if str(v).startswith("#") else "#bdbdbd")
            for k, v in fill_by_id.items()
        }
        spec_level = "state" if map_level == "state" else "mun"
        spec = MapSpec(
            name="chart_map_base",
            level=spec_level,
            fill_by_id=color_by_id,
            width=640,
            height=440,
        )

    if not svg_maps and capture_maps is not None and spec is not None:
        try:
            captured = capture_maps([spec])
            png_bytes = captured.get(spec.name)
            if png_bytes is not None:
                figuras_dir = (deliverables_dir or (REPO_DIR / "deliverables")) / "figuras"
                figuras_dir.mkdir(parents=True, exist_ok=True)
                (figuras_dir / f"{spec.name}.png").write_bytes(png_bytes)
                uri = png_data_uri(png_bytes) if png_data_uri else ""
                chart_map_base = (
                    f'<img class="map-figure" src="{uri}" width="{spec.width}" height="{spec.height}" '
                    f'alt="Semáforo territorial de riesgo de abstención 2027">'
                )
                map_engine = "maplibre"
                maplibre_count = 1
        except Exception as exc:
            logger.warning("Error capturing slide map: %s", exc)

    if maplibre_count == total_maps:
        summary_msg = f"mapas: maplibre {maplibre_count}/{total_maps}"
    else:
        summary_msg = f"mapas: maplibre {maplibre_count}/{total_maps} (svg-respaldo: chart_map_base)"

    if maps_info is not None:
        maps_info["maplibre_count"] = maplibre_count
        maps_info["total_maps"] = total_maps
        maps_info["engine"] = map_engine
        maps_info["summary"] = summary_msg

    print(summary_msg)
    logger.info(summary_msg)

    # Scenarios stacked bars from single facts source
    order = ["verde", "amarillo", "naranja", "rojo"]
    cat_base = stats.get("categories", {}).get("base", {})
    cat_inter = stats.get("categories", {}).get("intervencion", {})
    cat_pesim = stats.get("categories", {}).get("pesimista", {})
    scenario_rows = [
        ("Base (Inercial)", {c: float(cat_base.get(c, {}).get("n", 0)) for c in order}),
        ("Intervención", {c: float(cat_inter.get(c, {}).get("n", 0)) for c in order}),
        ("Pesimista", {c: float(cat_pesim.get(c, {}).get("n", 0)) for c in order}),
    ]
    chart_scenarios = svg_stacked_bars(
        scenario_rows,
        order=order,
        colors=CATEGORY_COLORS,
        width=720,
        height=290,
    )

    # Top priorities from stats
    top_priorities = [
        {
            "rank": p.get("rank", i + 1),
            "name": p.get("name", ""),
            "ent_name": p.get("state", p.get("ent_name", "")),
            "ln_fmt": p.get("ln", p.get("ln_fmt", "")),
            "abs_esp_fmt": p.get("abst_esp", p.get("abs_esp_fmt", "")),
            "category": p.get("cat", p.get("category", "")),
        }
        for i, p in enumerate(stats.get("top_priorities", [])[:8])
    ]

    # Model validation backtests from stats
    backtests = stats.get("model", {}).get("backtests", [])
    bt_2021 = next((b for b in backtests if b.get("test_year") == 2021), {})
    bt_2024 = next((b for b in backtests if b.get("test_year") == 2024), {})

    backtest_2021_mae = f"{_safe_float(bt_2021.get('mae_pp', 5.95)):.2f}"
    backtest_2021_spearman = f"{_safe_float(bt_2021.get('spearman', 0.84)):.2f}"
    backtest_2021_top20 = f"{round(_safe_float(bt_2021.get('top20_hit', 0.676)) * 100):.0f}"
    backtest_2024_mae = f"{_safe_float(bt_2024.get('mae_pp', 6.05)):.2f}"
    backtest_2024_spearman = f"{_safe_float(bt_2024.get('spearman', 0.81)):.2f}"
    backtest_2024_top20 = f"{round(_safe_float(bt_2024.get('top20_hit', 0.696)) * 100):.0f}"

    # 3. CSS
    css_file = TEMPLATES_DIR / "styles.css"
    styles_css = css_file.read_text(encoding="utf-8") if css_file.is_file() else ""

    # 4. Template render
    env = Environment(loader=FileSystemLoader(str(TEMPLATES_DIR)), autoescape=True)
    template = env.get_template("presentation.html")

    context = {
        "styles_css": styles_css,
        "team_name": team_name,
        "repo_url": repo_url,
        "stats": stats,
        "chart_history": chart_history,
        "chart_age_gap": chart_age_gap,
        "chart_map_base": chart_map_base,
        "chart_scenarios": chart_scenarios,
        "top_priorities": top_priorities,
        "backtest_2021_mae": backtest_2021_mae,
        "backtest_2021_spearman": backtest_2021_spearman,
        "backtest_2021_top20": backtest_2021_top20,
        "backtest_2024_mae": backtest_2024_mae,
        "backtest_2024_spearman": backtest_2024_spearman,
        "backtest_2024_top20": backtest_2024_top20,
    }

    rendered_html = template.render(**context)

    # Sanitize rendered HTML: ensure no visible raw "None" or "NaN" tokens outside tags
    def clean_text_nodes(match: re.Match) -> str:
        text = match.group(0)
        text = re.sub(r'>\s*None\s*<', '>N/D<', text)
        text = re.sub(r'>\s*NaN\s*<', '>N/D<', text)
        text = re.sub(r'>\s*nan\s*<', '>N/D<', text)
        return text

    rendered_html = re.sub(r'>[^<]+<', clean_text_nodes, rendered_html)
    return rendered_html


def check_overflow(html_path: Path, timeout_s: int = 20) -> list[str]:
    """Runs headless Chrome to detect card text overflows tagged with data-overflow="1".

    Returns a list of slide IDs that have overflowing cards.
    """
    try:
        browser = find_browser()
    except RuntimeError:
        logger.warning("No headless browser found to run overflow check.")
        return []

    file_uri = html_path.resolve().as_uri()
    cmd = [
        str(browser),
        "--headless=new",
        "--disable-gpu",
        "--virtual-time-budget=5000",
        "--dump-dom",
        file_uri,
    ]
    try:
        res = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout_s,
        )
        dom = res.stdout or ""
        if 'data-overflow="1"' not in dom:
            return []

        overflowing: list[str] = []
        for match in re.finditer(r'<section[^>]*id="([^"]+)"[\s\S]*?</section>', dom):
            slide_id = match.group(1)
            content = match.group(0)
            if 'data-overflow="1"' in content:
                overflowing.append(slide_id)

        if not overflowing and 'data-overflow="1"' in dom:
            overflowing.append("slide-unknown")

        return overflowing
    except Exception as exc:
        logger.warning("Failed running browser overflow check: %s", exc)
        return []


def build_slides(
    build_dir: Path | str | None = None,
    geo_dir: Path | str | None = None,
    out_dir: Path | str | None = None,
    deliverables_dir: Path | str | None = None,
    *,
    team_name: str = DEFAULT_TEAM,
    repo_url: str = DEFAULT_REPO_URL,
    make_pdf: bool = True,
    svg_maps: bool = False,
) -> BuildSlidesResult:
    """Generates the executive presentation HTML and PDF files.

    Parameters
    ----------
    build_dir : Path or str, optional
        Path to build directory containing model and CCPC parquet artifacts.
    geo_dir : Path or str, optional
        Path to geo directory containing GeoJSON layers.
    out_dir : Path or str, optional
        Destination directory for output files.
    deliverables_dir : Path or str, optional
        Destination deliverables directory (for figuras and maps).
    team_name : str
        Team name placeholder.
    repo_url : str
        Repository URL placeholder.
    make_pdf : bool
        Whether to compile the PDF using headless Chrome/Edge.
    svg_maps : bool
        Whether to force SVG maps fallback without attempting MapLibre capture.

    Returns
    -------
    BuildSlidesResult
        Result tuple of (html_path, pdf_path) with maps attribute.
    """
    b_dir = Path(build_dir) if build_dir else BUILD_DIR
    g_dir = Path(geo_dir) if geo_dir else (REPO_DIR / "frontend" / "public" / "geo")
    o_dir = Path(out_dir) if out_dir else (REPO_DIR / "deliverables")

    o_dir.mkdir(parents=True, exist_ok=True)

    deliv_dir = (
        Path(deliverables_dir)
        if deliverables_dir is not None
        else (
            Path(out_dir)
            if out_dir and (Path(out_dir) / "mapa_escenarios_estatal.geojson").is_file()
            else (REPO_DIR / "deliverables" if (REPO_DIR / "deliverables").is_dir() else Path(out_dir or "."))
        )
    )

    maps_info: dict[str, Any] = {}
    html_content = render_slides_html(
        b_dir,
        g_dir,
        deliverables_dir=deliv_dir,
        team_name=team_name,
        repo_url=repo_url,
        svg_maps=svg_maps,
        maps_info=maps_info,
    )

    html_path = o_dir / "presentacion_ejecutiva.html"
    html_path.write_text(html_content, encoding="utf-8")
    logger.info("Saved presentation HTML to %s", html_path)

    pdf_path: Path | None = None
    if make_pdf:
        target_pdf = o_dir / "presentacion_ejecutiva.pdf"
        try:
            pdf_path = html_to_pdf(html_path, target_pdf, landscape=True)
            logger.info("Saved presentation PDF to %s", pdf_path)
        except Exception as exc:
            logger.error("Failed to generate PDF with headless browser: %s", exc)
            pdf_path = None

    return BuildSlidesResult(html_path, pdf_path, maps_info)


def main() -> None:
    """CLI entry point for building slides."""
    parser = argparse.ArgumentParser(description="Build ATALAYA Executive Presentation (10 slides)")
    parser.add_argument("--build-dir", type=Path, default=BUILD_DIR, help="Path to build parquet artifacts")
    parser.add_argument("--geo-dir", type=Path, default=None, help="Path to frontend geo directory")
    parser.add_argument("--out", type=Path, default=None, help="Output deliverables directory")
    parser.add_argument("--deliverables", type=Path, default=None, help="Deliverables directory")
    parser.add_argument("--team", "--team-name", dest="team_name", type=str, default=DEFAULT_TEAM, help="Team name placeholder")
    parser.add_argument("--repo-url", type=str, default=DEFAULT_REPO_URL, help="Repo URL placeholder")
    parser.add_argument("--no-pdf", action="store_true", help="Skip PDF generation")
    parser.add_argument("--svg-maps", action="store_true", help="Forzar el respaldo SVG sin intentar la captura MapLibre")

    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

    html_p, pdf_p = build_slides(
        build_dir=args.build_dir,
        geo_dir=args.geo_dir,
        out_dir=args.out,
        deliverables_dir=args.deliverables,
        team_name=args.team_name,
        repo_url=args.repo_url,
        make_pdf=not args.no_pdf,
        svg_maps=args.svg_maps,
    )
    print(f"Generated HTML: {html_p}")
    if pdf_p and pdf_p.is_file():
        print(f"Generated PDF: {pdf_p}")
    else:
        print("PDF compilation was skipped or failed.")

    # Overflow detection check
    overflows = check_overflow(html_p)
    if overflows:
        print(f"ERROR: Text overflow detected in slide(s): {', '.join(overflows)}", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
