"""Chart and map generation in clean SVG, plus HTML to PDF conversion."""
from __future__ import annotations

import html
import math
import os
from pathlib import Path
import shutil
import subprocess
from typing import Any

CATEGORY_COLORS: dict[str, str] = {
    "verde": "#2e7d32",
    "amarillo": "#f9a825",
    "naranja": "#ef6c00",
    "rojo": "#c62828",
    "sin_dato": "#bdbdbd",
}

BROWSER_CANDIDATES: list[Path] = [
    Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
    Path(r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"),
    Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
    Path(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
]


def find_browser() -> Path:
    """Finds an available headless browser (Chrome or Edge)."""
    for candidate in BROWSER_CANDIDATES:
        if candidate.is_file():
            return candidate
    for name in ("chrome", "google-chrome", "msedge", "edge"):
        which = shutil.which(name)
        if which and Path(which).is_file():
            return Path(which)
    raise RuntimeError("No headless browser found (Chrome or Edge required for PDF export)")


def _extract_feature_id(feature: dict[str, Any]) -> str:
    props = feature.get("properties") or {}
    for key in ("id", "cvegeo", "CVEGEO", "cve_ent", "CVE_ENT"):
        if key in props and props[key] is not None:
            return str(props[key])
    if "id" in feature and feature["id"] is not None:
        return str(feature["id"])
    return ""


def svg_choropleth(
    geojson: dict[str, Any],
    fill_by_id: dict[str, str],
    *,
    width: int = 800,
    height: int = 520,
    stroke: str = "#ffffff",
    stroke_width: float = 0.3,
    title: str | None = None,
    legend: list[tuple[str, str]] | None = None,
) -> str:
    """Renders a choropleth map in SVG using equirectangular projection with cos(mean_lat) correction.

    Matches bounding box to the specified dimensions.
    """
    features = geojson.get("features", []) if isinstance(geojson, dict) else []
    if not features and isinstance(geojson, dict) and geojson.get("type") == "Feature":
        features = [geojson]

    all_lons: list[float] = []
    all_lats: list[float] = []

    def collect_coords(coords: Any) -> None:
        if not coords:
            return
        if isinstance(coords[0], (int, float)):
            all_lons.append(float(coords[0]))
            all_lats.append(float(coords[1]))
        else:
            for sub in coords:
                collect_coords(sub)

    for feat in features:
        geom = feat.get("geometry") or {}
        collect_coords(geom.get("coordinates", []))

    if not all_lons or not all_lats:
        title_tag = (
            f'<text x="{width / 2:.1f}" y="25" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" font-weight="bold" fill="#212121">{html.escape(title)}</text>'
            if title
            else ""
        )
        return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}">{title_tag}</svg>'

    min_lon = min(all_lons)
    max_lon = max(all_lons)
    min_lat = min(all_lats)
    max_lat = max(all_lats)

    if min_lon == max_lon:
        min_lon -= 0.1
        max_lon += 0.1
    if min_lat == max_lat:
        min_lat -= 0.1
        max_lat += 0.1

    mean_lat = (min_lat + max_lat) / 2.0
    cos_lat = math.cos(math.radians(mean_lat))

    min_x = min_lon * cos_lat
    max_x = max_lon * cos_lat
    dx = max_x - min_x
    dy = max_lat - min_lat

    padding = 12.0
    title_height = 30.0 if title else 0.0
    legend_height = 22.0 if legend else 0.0

    usable_w = max(width - 2.0 * padding, 10.0)
    usable_h = max(height - 2.0 * padding - title_height - legend_height, 10.0)

    scale = min(usable_w / max(dx, 1e-7), usable_h / max(dy, 1e-7))

    map_w = dx * scale
    map_h = dy * scale

    offset_x = padding + (usable_w - map_w) / 2.0 - min_x * scale
    offset_y = padding + title_height + (usable_h - map_h) / 2.0 + max_lat * scale

    def pt_str(pt: list[float] | tuple[float, float]) -> str:
        px = (float(pt[0]) * cos_lat) * scale + offset_x
        py = offset_y - float(pt[1]) * scale
        return f"{px:.1f} {py:.1f}"

    def ring_to_d(ring: list[Any]) -> str:
        if not ring:
            return ""
        pts = [pt_str(p) for p in ring]
        return "M " + " L ".join(pts) + " Z"

    paths: list[str] = []
    default_fill = CATEGORY_COLORS.get("sin_dato", "#bdbdbd")

    for feat in features:
        feat_id = _extract_feature_id(feat)
        raw_fill = fill_by_id.get(
            feat_id,
            fill_by_id.get(
                feat_id.zfill(2),
                fill_by_id.get(feat_id.zfill(5), default_fill),
            ),
        )
        fill = CATEGORY_COLORS.get(raw_fill, raw_fill)

        geom = feat.get("geometry") or {}
        g_type = geom.get("type", "")
        coords = geom.get("coordinates", [])

        d_parts: list[str] = []
        rings: list[Any] = []

        def extract_rings(obj: Any) -> None:
            if not isinstance(obj, (list, tuple)) or not obj:
                return
            if isinstance(obj[0], (list, tuple)) and obj[0] and isinstance(obj[0][0], (int, float)):
                rings.append(obj)
            else:
                for item in obj:
                    extract_rings(item)

        extract_rings(coords)

        for ring in rings:
            d = ring_to_d(ring)
            if d:
                d_parts.append(d)

        if d_parts:
            combined_d = " ".join(d_parts)
            id_attr = f' id="feat-{feat_id}"' if feat_id else ""
            data_id_attr = f' data-id="{feat_id}"' if feat_id else ""
            paths.append(
                f'<path{id_attr}{data_id_attr} fill="{fill}" stroke="{stroke}" stroke-width="{stroke_width}" fill-rule="evenodd" d="{combined_d}" />'
            )

    title_elem = (
        f'<text x="{width / 2:.1f}" y="22" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" font-weight="bold" fill="#212121">{html.escape(title)}</text>'
        if title
        else ""
    )

    legend_elems: list[str] = []
    if legend:
        item_widths = [len(lbl) * 5.6 + 22.0 for lbl, _ in legend]
        gap = 12.0
        tot_legend_w = sum(item_widths) + max(0, len(legend) - 1) * gap
        cur_x = max(padding, (width - tot_legend_w) / 2.0)
        leg_y = height - 8.0
        for (lbl, col), iw in zip(legend, item_widths):
            legend_elems.append(
                f'<rect x="{cur_x:.1f}" y="{leg_y - 9.0:.1f}" width="10" height="10" rx="2" fill="{col}" stroke="#757575" stroke-width="0.5" />'
            )
            legend_elems.append(
                f'<text x="{cur_x + 14.0:.1f}" y="{leg_y - 1.0:.1f}" font-family="Arial, sans-serif" font-size="8.5" fill="#37474f">{html.escape(lbl)}</text>'
            )
            cur_x += iw + gap

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}" style="background-color: transparent;">'
        f"{title_elem}"
        f'{"".join(paths)}'
        f'{"".join(legend_elems)}'
        f"</svg>"
    )


def svg_line(
    series: dict[str, list[tuple[float, float | None]]],
    *,
    width: int = 720,
    height: int = 300,
    y_label: str = "",
    y_fmt: str = "{:.0f}%",
    markers: dict[str, str] | None = None,
) -> str:
    """Renders line chart in SVG. None values create breaks in the line.

    Supports multiple series with legend and axis formatting.
    """
    markers = markers or {}
    all_xs: list[float] = []
    all_ys: list[float] = []

    for pts in series.values():
        for x, y in pts:
            if x is not None:
                all_xs.append(float(x))
            if y is not None:
                all_ys.append(float(y))

    if not all_xs or not all_ys:
        return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}"></svg>'

    min_x, max_x = min(all_xs), max(all_xs)
    if min_x == max_x:
        min_x -= 1.0
        max_x += 1.0

    min_y, max_y = min(all_ys), max(all_ys)
    # Give pleasant round bounds for y axis
    if min_y >= 0 and max_y <= 100:
        y_min_bound = max(0.0, math.floor(min_y / 10.0) * 10.0 - (5.0 if min_y > 10 else 0.0))
        y_max_bound = min(100.0, math.ceil(max_y / 10.0) * 10.0 + (5.0 if max_y < 95 else 0.0))
        if y_min_bound == y_max_bound:
            y_min_bound = max(0.0, y_min_bound - 10.0)
            y_max_bound = min(100.0, y_max_bound + 10.0)
    else:
        y_min_bound = math.floor(min_y / 10.0) * 10.0
        y_max_bound = math.ceil(max_y / 10.0) * 10.0
        if y_min_bound == y_max_bound:
            y_min_bound -= 5.0
            y_max_bound += 5.0

    margin_top = 40.0
    margin_bottom = 40.0
    margin_left = 65.0
    margin_right = 30.0

    plot_w = width - margin_left - margin_right
    plot_h = height - margin_top - margin_bottom

    def scale_x(val: float) -> float:
        return margin_left + (val - min_x) / (max_x - min_x) * plot_w

    def scale_y(val: float) -> float:
        return margin_top + (y_max_bound - val) / (y_max_bound - y_min_bound) * plot_h

    # Grid and Y axis
    elements: list[str] = []
    n_ticks = 5
    for i in range(n_ticks + 1):
        tick_val = y_min_bound + (y_max_bound - y_min_bound) * (i / n_ticks)
        py = scale_y(tick_val)
        elements.append(
            f'<line x1="{margin_left:.1f}" y1="{py:.1f}" x2="{margin_left + plot_w:.1f}" y2="{py:.1f}" stroke="#e0e0e0" stroke-width="1" stroke-dasharray="3,3" />'
        )
        elements.append(
            f'<text x="{margin_left - 8:.1f}" y="{py + 4:.1f}" text-anchor="end" font-family="Arial, sans-serif" font-size="11" fill="#616161">{html.escape(y_fmt.format(tick_val))}</text>'
        )

    if y_label:
        elements.append(
            f'<text x="{margin_left:.1f}" y="{margin_top - 12:.1f}" text-anchor="start" font-family="Arial, sans-serif" font-size="11" font-weight="bold" fill="#37474f">{html.escape(y_label)}</text>'
        )

    # X axis ticks
    unique_xs = sorted(list(set(all_xs)))
    for x_val in unique_xs:
        px = scale_x(x_val)
        elements.append(
            f'<line x1="{px:.1f}" y1="{margin_top + plot_h:.1f}" x2="{px:.1f}" y2="{margin_top + plot_h + 5:.1f}" stroke="#9e9e9e" stroke-width="1" />'
        )
        x_lbl = f"{int(x_val)}" if x_val.is_integer() else f"{x_val:.1f}"
        elements.append(
            f'<text x="{px:.1f}" y="{margin_top + plot_h + 18:.1f}" text-anchor="middle" font-family="Arial, sans-serif" font-size="11" fill="#616161">{x_lbl}</text>'
        )

    palette = ["#1565c0", "#c62828", "#2e7d32", "#f57c00", "#6a1b9a", "#00838f", "#4e342e"]

    # Series lines & markers
    legend_items: list[tuple[str, str]] = []
    for s_idx, (s_name, pts) in enumerate(series.items()):
        color = palette[s_idx % len(palette)]
        legend_items.append((s_name, color))

        # Build segments breaking at None
        segments: list[list[tuple[float, float]]] = []
        cur_segment: list[tuple[float, float]] = []
        for x, y in pts:
            if y is None or x is None:
                if cur_segment:
                    segments.append(cur_segment)
                    cur_segment = []
            else:
                cur_segment.append((float(x), float(y)))
        if cur_segment:
            segments.append(cur_segment)

        # Render paths for each continuous segment
        for seg in segments:
            if len(seg) >= 2:
                d_cmds = [f"M {scale_x(seg[0][0]):.1f} {scale_y(seg[0][1]):.1f}"]
                for pt in seg[1:]:
                    d_cmds.append(f"L {scale_x(pt[0]):.1f} {scale_y(pt[1]):.1f}")
                d = " ".join(d_cmds)
                elements.append(
                    f'<path d="{d}" fill="none" stroke="{color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />'
                )

        # Render markers for every valid point
        for seg in segments:
            for x, y in seg:
                px = scale_x(x)
                py = scale_y(y)
                marker_style = markers.get(s_name, "circle")
                if marker_style == "square":
                    elements.append(
                        f'<rect x="{px - 3.5:.1f}" y="{py - 3.5:.1f}" width="7" height="7" fill="{color}" stroke="#ffffff" stroke-width="1.5" />'
                    )
                else:
                    elements.append(
                        f'<circle cx="{px:.1f}" cy="{py:.1f}" r="4" fill="{color}" stroke="#ffffff" stroke-width="1.5" />'
                    )

    # Legend at top right or spread horizontally
    cur_leg_x = margin_left + 150.0
    for s_name, color in legend_items:
        elements.append(
            f'<circle cx="{cur_leg_x:.1f}" cy="{margin_top - 14:.1f}" r="4.5" fill="{color}" />'
        )
        elements.append(
            f'<text x="{cur_leg_x + 8:.1f}" y="{margin_top - 10:.1f}" font-family="Arial, sans-serif" font-size="11" fill="#424242">{html.escape(s_name)}</text>'
        )
        cur_leg_x += len(s_name) * 7.5 + 30.0

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}" style="background-color: transparent;">'
        f'{"".join(elements)}'
        f"</svg>"
    )


def svg_bars(
    items: list[tuple[str, float]],
    *,
    width: int = 720,
    height: int | None = None,
    horizontal: bool = True,
    value_fmt: str = "{:.1f}",
    color: str = "#455a64",
    colors: list[str] | None = None,
) -> str:
    """Renders a simple bar chart (horizontal or vertical) in SVG."""
    if not items:
        h = height or 180
        return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {h}" width="{width}" height="{h}"></svg>'

    vals = [float(v) for _, v in items if v is not None and not (isinstance(v, float) and math.isnan(v))]
    if not vals:
        vals = [0.0]

    min_val = min(vals)
    max_val = max(vals)

    elements: list[str] = []

    if horizontal:
        h = height if height is not None else max(180, len(items) * 30 + 50)
        margin_left = min(220.0, max(120.0, max((len(str(lbl)) for lbl, _ in items), default=10) * 7.5))
        margin_right = 70.0
        margin_top = 20.0
        margin_bottom = 20.0

        plot_w = width - margin_left - margin_right
        plot_h = h - margin_top - margin_bottom
        n = len(items)
        row_h = plot_h / max(n, 1)
        bar_h = min(18.0, row_h * 0.72)

        if min_val >= 0:
            val_span = max(max_val, 1e-6)
            x_base = margin_left
            for i, (lbl, val) in enumerate(items):
                v = float(val) if val is not None and not (isinstance(val, float) and math.isnan(val)) else 0.0
                bar_y = margin_top + i * row_h + (row_h - bar_h) / 2.0
                bar_w = (v / val_span) * plot_w
                item_color = colors[i % len(colors)] if colors else color
                elements.append(
                    f'<rect x="{x_base:.1f}" y="{bar_y:.1f}" width="{max(bar_w, 0.0):.1f}" height="{bar_h:.1f}" fill="{item_color}" rx="2" />'
                )
                elements.append(
                    f'<text x="{x_base - 8:.1f}" y="{bar_y + bar_h / 2.0 + 4:.1f}" text-anchor="end" font-family="Arial, sans-serif" font-size="11" fill="#333333">{html.escape(str(lbl))}</text>'
                )
                formatted_val = value_fmt.format(v)
                elements.append(
                    f'<text x="{x_base + bar_w + 6:.1f}" y="{bar_y + bar_h / 2.0 + 4:.1f}" text-anchor="start" font-family="Arial, sans-serif" font-size="11" font-weight="bold" fill="#333333">{html.escape(formatted_val)}</text>'
                )
            elements.append(
                f'<line x1="{x_base:.1f}" y1="{margin_top:.1f}" x2="{x_base:.1f}" y2="{margin_top + plot_h:.1f}" stroke="#9e9e9e" stroke-width="1" />'
            )
        else:
            val_span = max(max_val - min_val, 1e-6)
            x_base = margin_left + (-min_val / val_span) * plot_w
            for i, (lbl, val) in enumerate(items):
                v = float(val) if val is not None and not (isinstance(val, float) and math.isnan(val)) else 0.0
                bar_y = margin_top + i * row_h + (row_h - bar_h) / 2.0
                item_color = colors[i % len(colors)] if colors else color
                bar_w = abs(v) / val_span * plot_w
                if v >= 0:
                    bx = x_base
                    tx = x_base + bar_w + 6
                    anchor = "start"
                else:
                    bx = x_base - bar_w
                    tx = bx - 6
                    anchor = "end"
                elements.append(
                    f'<rect x="{bx:.1f}" y="{bar_y:.1f}" width="{bar_w:.1f}" height="{bar_h:.1f}" fill="{item_color}" rx="2" />'
                )
                elements.append(
                    f'<text x="{margin_left - 8:.1f}" y="{bar_y + bar_h / 2.0 + 4:.1f}" text-anchor="end" font-family="Arial, sans-serif" font-size="11" fill="#333333">{html.escape(str(lbl))}</text>'
                )
                formatted_val = value_fmt.format(v)
                elements.append(
                    f'<text x="{tx:.1f}" y="{bar_y + bar_h / 2.0 + 4:.1f}" text-anchor="{anchor}" font-family="Arial, sans-serif" font-size="11" font-weight="bold" fill="#333333">{html.escape(formatted_val)}</text>'
                )
            elements.append(
                f'<line x1="{x_base:.1f}" y1="{margin_top:.1f}" x2="{x_base:.1f}" y2="{margin_top + plot_h:.1f}" stroke="#757575" stroke-width="1.5" />'
            )
    else:
        h = height if height is not None else 300
        margin_left = 60.0
        margin_right = 30.0
        margin_top = 30.0
        margin_bottom = 60.0

        plot_w = width - margin_left - margin_right
        plot_h = h - margin_top - margin_bottom
        n = len(items)
        col_w = plot_w / max(n, 1)
        bar_w = min(36.0, col_w * 0.65)
        val_span = max(max_val, 1e-6)

        y_base = margin_top + plot_h
        for i, (lbl, val) in enumerate(items):
            v = float(val) if val is not None and not (isinstance(val, float) and math.isnan(val)) else 0.0
            bx = margin_left + i * col_w + (col_w - bar_w) / 2.0
            bh = (v / val_span) * plot_h
            by = y_base - bh
            item_color = colors[i % len(colors)] if colors else color
            elements.append(
                f'<rect x="{bx:.1f}" y="{by:.1f}" width="{bar_w:.1f}" height="{max(bh, 0.0):.1f}" fill="{item_color}" rx="2" />'
            )
            formatted_val = value_fmt.format(v)
            elements.append(
                f'<text x="{bx + bar_w / 2.0:.1f}" y="{by - 6:.1f}" text-anchor="middle" font-family="Arial, sans-serif" font-size="11" font-weight="bold" fill="#333333">{html.escape(formatted_val)}</text>'
            )
            elements.append(
                f'<text x="{bx + bar_w / 2.0:.1f}" y="{y_base + 16:.1f}" text-anchor="middle" font-family="Arial, sans-serif" font-size="11" fill="#333333">{html.escape(str(lbl))}</text>'
            )
        elements.append(
            f'<line x1="{margin_left:.1f}" y1="{y_base:.1f}" x2="{margin_left + plot_w:.1f}" y2="{y_base:.1f}" stroke="#9e9e9e" stroke-width="1" />'
        )

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {h}" width="{width}" height="{h}" style="background-color: transparent;">'
        f'{"".join(elements)}'
        f"</svg>"
    )


def svg_stacked_bars(
    rows: list[tuple[str, dict[str, float]]],
    *,
    order: list[str],
    colors: dict[str, str],
    width: int = 720,
    height: int | None = None,
) -> str:
    """Renders a 100% stacked horizontal bar chart with legend."""
    h = height if height is not None else max(180, len(rows) * 45 + 70)
    if not rows or not order:
        return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {h}" width="{width}" height="{h}"></svg>'

    margin_left = min(220.0, max(120.0, max((len(str(lbl)) for lbl, _ in rows), default=10) * 7.5))
    margin_right = 40.0
    margin_top = 45.0
    margin_bottom = 25.0

    plot_w = width - margin_left - margin_right
    plot_h = h - margin_top - margin_bottom

    elements: list[str] = []

    # Legend at top
    leg_x = margin_left
    for cat in order:
        cat_color = colors.get(cat, CATEGORY_COLORS.get(cat, "#9e9e9e"))
        cat_label = cat.capitalize()
        elements.append(
            f'<rect x="{leg_x:.1f}" y="12" width="12" height="12" fill="{cat_color}" rx="2" />'
        )
        elements.append(
            f'<text x="{leg_x + 16:.1f}" y="22" font-family="Arial, sans-serif" font-size="11" fill="#424242">{html.escape(cat_label)}</text>'
        )
        leg_x += len(cat_label) * 7.5 + 32.0

    n = len(rows)
    row_h = plot_h / max(n, 1)
    bar_h = min(26.0, row_h * 0.7)

    for i, (lbl, vals) in enumerate(rows):
        total = sum(vals.get(cat, 0.0) for cat in order)
        if total <= 0:
            total = 1.0

        bar_y = margin_top + i * row_h + (row_h - bar_h) / 2.0
        elements.append(
            f'<text x="{margin_left - 8:.1f}" y="{bar_y + bar_h / 2.0 + 4:.1f}" text-anchor="end" font-family="Arial, sans-serif" font-size="11" fill="#333333">{html.escape(str(lbl))}</text>'
        )

        cur_x = margin_left
        for cat in order:
            val = vals.get(cat, 0.0)
            seg_w = (val / total) * plot_w
            cat_color = colors.get(cat, CATEGORY_COLORS.get(cat, "#9e9e9e"))
            elements.append(
                f'<rect x="{cur_x:.1f}" y="{bar_y:.1f}" width="{seg_w:.1f}" height="{bar_h:.1f}" fill="{cat_color}" />'
            )
            pct = (val / total) * 100.0
            if seg_w > 38.0 and pct >= 4.0:
                txt_color = "#ffffff" if cat in ("rojo", "naranja", "verde") else "#212121"
                elements.append(
                    f'<text x="{cur_x + seg_w / 2.0:.1f}" y="{bar_y + bar_h / 2.0 + 4:.1f}" text-anchor="middle" font-family="Arial, sans-serif" font-size="10" font-weight="bold" fill="{txt_color}">{pct:.0f}%</text>'
                )
            cur_x += seg_w

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {h}" width="{width}" height="{h}" style="background-color: transparent;">'
        f'{"".join(elements)}'
        f"</svg>"
    )


def html_to_pdf(
    html_path: Path,
    pdf_path: Path,
    *,
    landscape: bool = False,
    timeout_s: int = 120,
) -> Path:
    """Converts an HTML file to PDF using headless Chrome or Edge."""
    browser_exe = find_browser()

    html_abs = html_path.resolve()
    pdf_abs = pdf_path.resolve()
    pdf_abs.parent.mkdir(parents=True, exist_ok=True)

    file_url = f"file:///{html_abs.as_posix()}"

    cmd = [
        str(browser_exe),
        "--headless=new",
        "--disable-gpu",
        "--no-pdf-header-footer",
        f"--print-to-pdf={pdf_abs}",
        file_url,
    ]

    res = subprocess.run(cmd, capture_output=True, timeout=timeout_s)
    if res.returncode != 0 or not pdf_abs.is_file():
        err_msg = res.stderr.decode("utf-8", errors="replace")
        raise RuntimeError(f"Browser failed to generate PDF (exit code {res.returncode}): {err_msg}")

    return pdf_abs
