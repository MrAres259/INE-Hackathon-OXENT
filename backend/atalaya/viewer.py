"""Autonomous scenario viewer generator for ATALAYA (standalone HTML)."""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path
import sys
from typing import Any

from atalaya import config

logger = logging.getLogger("atalaya.viewer")

REPO_ROOT = getattr(config, "REPO_ROOT", Path(__file__).resolve().parent.parent.parent)

DEFAULT_KEEP_PROPERTIES = {
    "id",
    "ent",
    "name",
    "lista_nominal",
    "pred_abstention_base",
    "category_base",
    "pred_abstention_intervencion",
    "category_intervencion",
    "delta_pp_intervencion",
    "pred_abstention_pesimista",
    "category_pesimista",
    "top_recommendation",
}


def round_coordinates(geom: dict[str, Any], decimals: int = 4) -> dict[str, Any]:
    """Recursively round coordinates to specified decimals to reduce GeoJSON payload size."""
    if not geom or "coordinates" not in geom:
        return geom
    coords = geom.get("coordinates")

    def _round(val: Any) -> Any:
        if isinstance(val, (list, tuple)):
            if len(val) >= 2 and isinstance(val[0], (int, float)) and isinstance(val[1], (int, float)):
                return [round(float(val[0]), decimals), round(float(val[1]), decimals)]
            return [_round(v) for v in val]
        return val

    return {
        "type": geom.get("type"),
        "coordinates": _round(coords),
    }


def prune_geojson(
    geojson_dict: dict[str, Any],
    keep_properties: set[str] | None = None,
    coord_decimals: int = 4,
) -> dict[str, Any]:
    """Prune unused properties and round coordinates to optimize standalone file size."""
    props_to_keep = keep_properties if keep_properties is not None else DEFAULT_KEEP_PROPERTIES
    features = geojson_dict.get("features", [])
    pruned_features = []

    for f in features:
        geom = round_coordinates(f.get("geometry", {}), decimals=coord_decimals)
        raw_props = f.get("properties") or {}
        pruned_props = {k: v for k, v in raw_props.items() if k in props_to_keep}
        pruned_features.append({
            "type": "Feature",
            "id": pruned_props.get("id"),
            "geometry": geom,
            "properties": pruned_props,
        })

    return {
        "type": "FeatureCollection",
        "features": pruned_features,
    }


def build_viewer(
    mun_geojson_path: Path | str,
    states_geojson_path: Path | str,
    out_path: Path | str,
    *,
    maplibre_js_path: Path | str | None = None,
    maplibre_css_path: Path | str | None = None,
    template_path: Path | str | None = None,
    keep_properties: set[str] | None = None,
    coord_decimals: int = 4,
    max_size_mb: float = 12.0,
) -> tuple[Path, float, bool]:
    """Generates a self-contained autonomous HTML scenario viewer.

    Returns:
        tuple of (out_path, size_in_mb, exceeded_max_size_flag)
    """
    mun_p = Path(mun_geojson_path)
    st_p = Path(states_geojson_path)
    out_p = Path(out_path)

    # 1. Validate GeoJSON inputs exist
    if not mun_p.is_file():
        raise FileNotFoundError(
            f"Error: No se encontró '{mun_p}'. Ejecute 'python -m atalaya.export' primero."
        )
    if not st_p.is_file():
        raise FileNotFoundError(
            f"Error: No se encontró '{st_p}'. Ejecute 'python -m atalaya.export' primero."
        )

    # 2. Locate assets
    js_p = (
        Path(maplibre_js_path)
        if maplibre_js_path is not None
        else REPO_ROOT / "frontend/node_modules/maplibre-gl/dist/maplibre-gl.js"
    )
    css_p = (
        Path(maplibre_css_path)
        if maplibre_css_path is not None
        else REPO_ROOT / "frontend/node_modules/maplibre-gl/dist/maplibre-gl.css"
    )
    tmpl_p = (
        Path(template_path)
        if template_path is not None
        else Path(__file__).resolve().parent / "viewer_template.html"
    )

    if not js_p.is_file():
        raise FileNotFoundError(f"Error: No se encontró el bundle de MapLibre en '{js_p}'.")
    if not css_p.is_file():
        raise FileNotFoundError(f"Error: No se encontró el CSS de MapLibre en '{css_p}'.")
    if not tmpl_p.is_file():
        raise FileNotFoundError(f"Error: No se encontró la plantilla del visor en '{tmpl_p}'.")

    # 3. Read template and asset contents
    template_str = tmpl_p.read_text(encoding="utf-8")
    maplibre_js = js_p.read_text(encoding="utf-8")
    maplibre_css = css_p.read_text(encoding="utf-8")

    # 4. Load, prune and serialize GeoJSON data
    mun_raw = json.loads(mun_p.read_text(encoding="utf-8"))
    st_raw = json.loads(st_p.read_text(encoding="utf-8"))

    mun_pruned = prune_geojson(mun_raw, keep_properties=keep_properties, coord_decimals=coord_decimals)
    st_pruned = prune_geojson(st_raw, keep_properties=keep_properties, coord_decimals=coord_decimals)

    mun_json = json.dumps(mun_pruned, separators=(",", ":"), ensure_ascii=False)
    st_json = json.dumps(st_pruned, separators=(",", ":"), ensure_ascii=False)

    # Escape closing script tags to avoid HTML parser interruption
    mun_json = mun_json.replace("</script>", "<\\/script>")
    st_json = st_json.replace("</script>", "<\\/script>")

    # 5. Populate template
    html = template_str.replace("/* __MAPLIBRE_CSS__ */", maplibre_css)
    html = html.replace("/* __MAPLIBRE_JS__ */", maplibre_js)
    html = html.replace("/* __DATA_STATES__ */", st_json)
    html = html.replace("/* __DATA_MUN__ */", mun_json)

    # 6. Write standalone file
    out_p.parent.mkdir(parents=True, exist_ok=True)
    out_p.write_text(html, encoding="utf-8")

    size_bytes = len(html.encode("utf-8"))
    size_mb = size_bytes / (1024 * 1024)
    exceeded = size_mb > max_size_mb

    if exceeded:
        print(f"[-] Aviso: El archivo generado ({size_mb:.2f} MB) excede el objetivo de {max_size_mb} MB.")
    else:
        print(f"[+] Visor autónomo generado exitosamente: {size_mb:.2f} MB (dentro del objetivo ≤ {max_size_mb} MB).")
        print(f"    Destino: {out_p}")

    return out_p, size_mb, exceeded


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Genera el visor autónomo de mapas de escenarios ATALAYA (HTML autocontenido)."
    )
    parser.add_argument(
        "--out",
        type=str,
        default="deliverables/visor_escenarios.html",
        help="Ruta del archivo HTML generado (default: deliverables/visor_escenarios.html)",
    )
    parser.add_argument(
        "--mun-geojson",
        type=str,
        default=None,
        help="Ruta al archivo GeoJSON municipal de escenarios",
    )
    parser.add_argument(
        "--states-geojson",
        type=str,
        default=None,
        help="Ruta al archivo GeoJSON estatal de escenarios",
    )
    parser.add_argument(
        "--maplibre-js",
        type=str,
        default=None,
        help="Ruta opcional al archivo maplibre-gl.js",
    )
    parser.add_argument(
        "--maplibre-css",
        type=str,
        default=None,
        help="Ruta opcional al archivo maplibre-gl.css",
    )
    parser.add_argument(
        "--max-size-mb",
        type=float,
        default=12.0,
        help="Límite máximo recomendado en MB (default: 12.0)",
    )

    args = parser.parse_args(argv)

    out_p = Path(args.out)
    if not out_p.is_absolute():
        out_p = REPO_ROOT / out_p

    mun_p = (
        Path(args.mun_geojson)
        if args.mun_geojson
        else REPO_ROOT / "deliverables/mapa_escenarios_municipal.geojson"
    )
    if not mun_p.is_absolute():
        mun_p = REPO_ROOT / mun_p

    st_p = (
        Path(args.states_geojson)
        if args.states_geojson
        else REPO_ROOT / "deliverables/mapa_escenarios_estatal.geojson"
    )
    if not st_p.is_absolute():
        st_p = REPO_ROOT / st_p

    js_p = Path(args.maplibre_js) if args.maplibre_js else None
    if js_p and not js_p.is_absolute():
        js_p = REPO_ROOT / js_p

    css_p = Path(args.maplibre_css) if args.maplibre_css else None
    if css_p and not css_p.is_absolute():
        css_p = REPO_ROOT / css_p

    try:
        build_viewer(
            mun_geojson_path=mun_p,
            states_geojson_path=st_p,
            out_path=out_p,
            maplibre_js_path=js_p,
            maplibre_css_path=css_p,
            max_size_mb=args.max_size_mb,
        )
        return 0
    except FileNotFoundError as e:
        print(f"[-] {e}", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"[-] Error inesperado generando visor: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
