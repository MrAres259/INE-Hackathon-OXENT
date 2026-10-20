"""Headless MapLibre GL map capture for reports and presentations.

Uses headless Chrome/Edge via CDP to render vector tiles offline and capture high-resolution PNGs.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
from collections import Counter
import concurrent.futures
from dataclasses import dataclass
import http.server
import io
import json
import logging
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from typing import Any, Literal, Mapping, Sequence
import urllib.parse
import urllib.request

from PIL import Image
import websockets

logger = logging.getLogger(__name__)

def get_repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def get_geo_root() -> Path:
    return get_repo_root() / "frontend" / "public" / "geo"


def get_maplibre_dist_dir() -> Path:
    return get_repo_root() / "frontend" / "node_modules" / "maplibre-gl" / "dist"


def get_print_dir() -> Path:
    return Path(__file__).resolve().parent / "map_print"


def get_default_bounds() -> tuple[tuple[float, float], tuple[float, float]]:
    """Loads default bounds from frontend/public/geo/tiles.json manifest."""
    try:
        tiles_json = get_geo_root() / "tiles.json"
        if tiles_json.is_file():
            data = json.loads(tiles_json.read_text(encoding="utf-8"))
            b = data.get("bounds")
            if b and len(b) == 4:
                return (
                    (float(b[0]), float(b[1])),
                    (float(b[2]), float(b[3])),
                )
    except Exception:
        pass
    return ((-118.36511, 14.5321), (-86.71069, 32.71865))


MEXICO_BOUNDS: tuple[tuple[float, float], tuple[float, float]] = get_default_bounds()

BROWSER_CANDIDATES: list[Path] = [
    Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
    Path(r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"),
    Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
    Path(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
]


@dataclass(frozen=True)
class MapSpec:
    name: str  # Slug for the output file, e.g. "mun_semaforo_base"
    level: Literal["state", "mun"]
    fill_by_id: Mapping[str, str]  # ID -> color hex (#rrggbb); unset IDs use nodata_color
    width: int = 600  # Map CSS width
    height: int = 340
    scale: float = 2.0  # deviceScaleFactor for high-res output
    nodata_color: str = "#d1d5db"
    background: str = "#ffffff"
    state_line_color: str = "#374151"
    mun_line_color: str = "#ffffff"
    bounds: tuple = MEXICO_BOUNDS
    padding: int = 6


def find_browser() -> Path | None:
    for candidate in BROWSER_CANDIDATES:
        if candidate.is_file():
            return candidate
    for name in ("chrome", "google-chrome", "msedge", "edge"):
        which = shutil.which(name)
        if which and Path(which).is_file():
            return Path(which)
    return None


def capture_available() -> tuple[bool, str]:
    browser = find_browser()
    if not browser:
        return False, "Browser not found (Chrome or Edge required)"

    geo_root = get_geo_root()
    tiles_json = geo_root / "tiles.json"
    if not tiles_json.is_file():
        return False, f"tiles.json not found at {tiles_json}"

    dist_dir = get_maplibre_dist_dir()
    maplibre_js = dist_dir / "maplibre-gl.js"
    maplibre_css = dist_dir / "maplibre-gl.css"
    if not maplibre_js.is_file() or not maplibre_css.is_file():
        return False, f"maplibre-gl distribution files not found in {dist_dir}"

    return True, "ok"


def png_data_uri(png: bytes) -> str:
    b64 = base64.b64encode(png).decode("ascii")
    return f"data:image/png;base64,{b64}"


def hex_to_rgb(hex_str: str) -> tuple[int, int, int]:
    s = hex_str.strip().lstrip("#")
    if len(s) == 3:
        s = "".join(c * 2 for c in s)
    return int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16)


def serialize_bounds(bounds: Any) -> list:
    if isinstance(bounds, (list, tuple)):
        if len(bounds) == 2 and isinstance(bounds[0], (list, tuple)):
            return [
                [float(bounds[0][0]), float(bounds[0][1])],
                [float(bounds[1][0]), float(bounds[1][1])],
            ]
        if len(bounds) == 4:
            return [
                [float(bounds[0]), float(bounds[1])],
                [float(bounds[2]), float(bounds[3])],
            ]
    def_b = get_default_bounds()
    return [[def_b[0][0], def_b[0][1]], [def_b[1][0], def_b[1][1]]]


def spec_to_render_payload(spec: MapSpec) -> dict[str, Any]:
    k = 4 if spec.level == "mun" else 2
    css_pad = max(float(spec.padding), 0.04 * float(spec.height))
    scaled_padding = int(round(css_pad * k))
    return {
        "name": spec.name,
        "level": spec.level,
        "fill_by_id": dict(spec.fill_by_id),
        "width": int(spec.width),
        "height": int(spec.height),
        "scale": float(spec.scale),
        "nodata_color": str(spec.nodata_color),
        "background": str(spec.background),
        "state_line_color": str(spec.state_line_color),
        "mun_line_color": str(spec.mun_line_color),
        "bounds": serialize_bounds(spec.bounds),
        "padding": scaled_padding,
        "oversample": k,
    }


def _image_pixels(img: Image.Image) -> list[tuple[int, int, int]]:
    if hasattr(img, "get_flattened_data"):
        return list(img.get_flattened_data())
    return list(img.getdata())  # type: ignore[no-any-return]


def validate_image(
    png_bytes: bytes,
    spec: MapSpec,
    *,
    min_distinct_colors: int = 4,
    channel_tolerance: int = 6,
) -> bool:
    try:
        img = Image.open(io.BytesIO(png_bytes)).convert("RGB")
    except Exception as exc:
        logger.warning("Failed to decode PNG image: %s", exc)
        return False

    w, h = img.size
    max_colors_probe = max(w * h, 256)
    colors = img.getcolors(maxcolors=max_colors_probe)
    num_distinct = max_colors_probe if colors is None else len(colors)

    if num_distinct < min_distinct_colors:
        logger.warning(
            "Captured image has %d distinct colors (< %d)",
            num_distinct,
            min_distinct_colors,
        )
        return False

    # Border check: outer 2 px rows and columns must be background color in >= 98%
    try:
        bg_rgb = hex_to_rgb(spec.background)
    except Exception:
        bg_rgb = (255, 255, 255)

    border_pixels: list[tuple[int, int, int]] = []
    if w >= 4 and h >= 4:
        # Top 2 rows
        border_pixels.extend(_image_pixels(img.crop((0, 0, w, 2))))
        # Bottom 2 rows
        border_pixels.extend(_image_pixels(img.crop((0, h - 2, w, h))))
        # Left 2 columns (excluding corners already collected in top and bottom)
        border_pixels.extend(_image_pixels(img.crop((0, 2, 2, h - 2))))
        # Right 2 columns (excluding corners already collected in top and bottom)
        border_pixels.extend(_image_pixels(img.crop((w - 2, 2, w, h - 2))))
    else:
        border_pixels.extend(_image_pixels(img))

    total_border = len(border_pixels)
    if total_border > 0:
        bg_matches = sum(
            1
            for p in border_pixels
            if abs(p[0] - bg_rgb[0]) <= channel_tolerance
            and abs(p[1] - bg_rgb[1]) <= channel_tolerance
            and abs(p[2] - bg_rgb[2]) <= channel_tolerance
        )
        border_bg_ratio = bg_matches / total_border
        if border_bg_ratio < 0.98:
            logger.warning(
                "Captured image border check failed for %s: background ratio %.2f%% (< 98%%)",
                spec.name,
                border_bg_ratio * 100,
            )
            return False

    if not spec.fill_by_id:
        return True

    counts = Counter(spec.fill_by_id.values())
    top_colors = [c for c, _ in counts.most_common(3)]
    target_rgbs = []
    for h_col in top_colors:
        try:
            target_rgbs.append(hex_to_rgb(h_col))
        except Exception:
            pass

    if not target_rgbs:
        return True

    unique_rgbs = (
        [c[1] for c in colors] if colors is not None else list(set(_image_pixels(img)))
    )

    found = False
    for r, g, b in unique_rgbs:
        for tr, tg, tb in target_rgbs:
            if (
                abs(r - tr) <= channel_tolerance
                and abs(g - tg) <= channel_tolerance
                and abs(b - tb) <= channel_tolerance
            ):
                found = True
                break
        if found:
            break

    if not found:
        logger.warning(
            "None of top 3 colors %s found in captured image (tolerance ±%d)",
            top_colors,
            channel_tolerance,
        )
        return False

    return True


class MapAssetRequestHandler(http.server.BaseHTTPRequestHandler):
    geo_root: Path
    temp_root: Path

    def log_message(self, format: str, *args: Any) -> None:
        pass

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        unquoted = urllib.parse.unquote(parsed.path)

        # Reject path traversal attempts with 403
        if ".." in unquoted or "/." in unquoted or "\\." in unquoted:
            self.send_error(403, "Forbidden")
            return

        if unquoted.startswith("/geo/"):
            rel = unquoted[len("/geo/") :].lstrip("/\\")
            base = self.geo_root.resolve()
            target = (base / rel).resolve()
        else:
            rel = unquoted.lstrip("/\\")
            base = self.temp_root.resolve()
            target = (base / rel).resolve()

        try:
            target.relative_to(base)
        except ValueError:
            self.send_error(403, "Forbidden")
            return

        if not target.is_file():
            self.send_error(404, "Not Found")
            return

        try:
            data = target.read_bytes()
        except Exception:
            self.send_error(500, "Internal Server Error")
            return

        suffix = target.suffix.lower()
        mime_types = {
            ".html": "text/html; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".json": "application/json; charset=utf-8",
            ".pbf": "application/x-protobuf",
            ".png": "image/png",
        }
        content_type = mime_types.get(suffix, "application/octet-stream")

        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(data)


def make_handler(
    geo_root: Path, temp_root: Path
) -> type[http.server.BaseHTTPRequestHandler]:
    class BoundHandler(MapAssetRequestHandler):
        pass

    BoundHandler.geo_root = geo_root.resolve()
    BoundHandler.temp_root = temp_root.resolve()
    return BoundHandler


async def _async_cdp_session(
    specs: Sequence[MapSpec],
    server_port: int,
    browser_path: Path,
) -> dict[str, bytes | None]:
    user_data_dir = tempfile.mkdtemp(prefix="atalaya_chrome_")
    chrome_proc = None
    results: dict[str, bytes | None] = {}
    try:
        chrome_cmd = [
            str(browser_path),
            "--headless=new",
            "--remote-debugging-port=0",
            f"--user-data-dir={user_data_dir}",
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
            "--ignore-gpu-blocklist",
            "--hide-scrollbars",
            "--no-first-run",
            "about:blank",
        ]
        chrome_proc = subprocess.Popen(
            chrome_cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        port_file = Path(user_data_dir) / "DevToolsActivePort"
        deadline = time.time() + 15.0
        port = None
        while time.time() < deadline:
            if port_file.is_file():
                try:
                    lines = port_file.read_text(encoding="utf-8").strip().splitlines()
                    if lines and lines[0].strip().isdigit():
                        port = int(lines[0].strip())
                        break
                except Exception:
                    pass
            await asyncio.sleep(0.1)

        if not port:
            raise RuntimeError("Timed out waiting for Chrome DevToolsActivePort")

        deadline = time.time() + 10.0
        ws_url = None
        while time.time() < deadline:
            try:
                with urllib.request.urlopen(
                    f"http://127.0.0.1:{port}/json", timeout=2
                ) as resp:
                    tabs = json.loads(resp.read().decode("utf-8"))
                    page_tabs = [
                        t
                        for t in tabs
                        if t.get("type") == "page" and "webSocketDebuggerUrl" in t
                    ]
                    if page_tabs:
                        ws_url = page_tabs[0]["webSocketDebuggerUrl"]
                        break
            except Exception:
                await asyncio.sleep(0.1)

        if not ws_url:
            raise RuntimeError("Could not find WebSocket debugger URL in Chrome tabs")

        async with websockets.connect(ws_url, max_size=2**27) as ws:
            msg_id = 0

            async def call(method: str, params: dict | None = None) -> dict:
                nonlocal msg_id
                msg_id += 1
                req = {"id": msg_id, "method": method, "params": params or {}}
                await ws.send(json.dumps(req))
                while True:
                    raw = await ws.recv()
                    data = json.loads(raw)
                    if data.get("id") == req["id"]:
                        return data

            await call("Page.enable")
            await call("Runtime.enable")
            await call("Network.enable")

            nav_resp = await call(
                "Page.navigate",
                {"url": f"http://127.0.0.1:{server_port}/print.html"},
            )
            if "error" in nav_resp:
                raise RuntimeError(f"Navigation error: {nav_resp['error']}")

            deadline = time.time() + 15.0
            ready = False
            while time.time() < deadline:
                eval_res = await call(
                    "Runtime.evaluate",
                    {
                        "expression": "typeof window.renderSpec === 'function'",
                        "returnByValue": True,
                    },
                )
                if eval_res.get("result", {}).get("result", {}).get("value") is True:
                    ready = True
                    break
                await asyncio.sleep(0.1)

            if not ready:
                raise RuntimeError("window.renderSpec was not defined in print.html")

            for spec in specs:
                try:
                    payload = spec_to_render_payload(spec)
                    k = payload["oversample"]
                    target_w = int(round(spec.width * k))
                    target_h = int(round(spec.height * k))
                    dsf = float(spec.scale / k)

                    await call(
                        "Emulation.setDeviceMetricsOverride",
                        {
                            "width": target_w,
                            "height": target_h,
                            "deviceScaleFactor": dsf,
                            "mobile": False,
                        },
                    )

                    render_resp = await call(
                        "Runtime.evaluate",
                        {
                            "expression": f"window.renderSpec({json.dumps(payload)})",
                            "awaitPromise": True,
                            "returnByValue": True,
                        },
                    )
                    render_val = (
                        render_resp.get("result", {}).get("result", {}).get("value")
                    )
                    if not isinstance(render_val, dict) or not render_val.get("ok"):
                        logger.warning(
                            "renderSpec failed for %s: %s", spec.name, render_val
                        )
                        results[spec.name] = None
                        continue

                    shot_resp = await call(
                        "Page.captureScreenshot",
                        {
                            "format": "png",
                            "clip": {
                                "x": 0.0,
                                "y": 0.0,
                                "width": float(target_w),
                                "height": float(target_h),
                                "scale": 1.0,
                            },
                        },
                    )
                    data_b64 = shot_resp.get("result", {}).get("data")
                    if not data_b64:
                        logger.warning("No screenshot data received for %s", spec.name)
                        results[spec.name] = None
                        continue

                    png_bytes = base64.b64decode(data_b64)
                    if validate_image(png_bytes, spec):
                        results[spec.name] = png_bytes
                    else:
                        logger.warning(
                            "Captured image validation failed for %s", spec.name
                        )
                        results[spec.name] = None
                except Exception as spec_exc:
                    logger.warning("Error capturing spec %s: %s", spec.name, spec_exc)
                    results[spec.name] = None

            return results
    finally:
        if chrome_proc is not None and chrome_proc.poll() is None:
            try:
                subprocess.run(
                    ["taskkill", "/F", "/T", "/PID", str(chrome_proc.pid)],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    check=False,
                )
            except Exception:
                chrome_proc.kill()
        shutil.rmtree(user_data_dir, ignore_errors=True)


def _run_cdp_session(
    specs: Sequence[MapSpec],
    server_port: int,
    browser_path: Path,
    timeout_s: float,
) -> dict[str, bytes | None]:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            return pool.submit(
                lambda: asyncio.run(
                    asyncio.wait_for(
                        _async_cdp_session(specs, server_port, browser_path),
                        timeout=timeout_s,
                    )
                )
            ).result()
    else:
        return asyncio.run(
            asyncio.wait_for(
                _async_cdp_session(specs, server_port, browser_path),
                timeout=timeout_s,
            )
        )


def capture_maps(
    specs: Sequence[MapSpec], *, timeout_s: float = 120
) -> dict[str, bytes | None]:
    if not specs:
        return {}

    ok, reason = capture_available()
    if not ok:
        logger.warning("Map capture unavailable: %s", reason)
        return {s.name: None for s in specs}

    browser = find_browser()
    if not browser:
        logger.warning("Browser not found")
        return {s.name: None for s in specs}

    geo_root = get_geo_root()
    print_dir = get_print_dir()
    dist_dir = get_maplibre_dist_dir()

    tmp_dir = Path(tempfile.mkdtemp(prefix="atalaya_map_"))
    server = None
    try:
        shutil.copy2(print_dir / "print.html", tmp_dir / "print.html")
        shutil.copy2(print_dir / "print.js", tmp_dir / "print.js")
        shutil.copy2(dist_dir / "maplibre-gl.js", tmp_dir / "maplibre-gl.js")
        shutil.copy2(dist_dir / "maplibre-gl.css", tmp_dir / "maplibre-gl.css")

        handler_cls = make_handler(geo_root, tmp_dir)
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler_cls)
        server_thread = threading.Thread(target=server.serve_forever, daemon=True)
        server_thread.start()
        server_port = server.server_address[1]

        results = _run_cdp_session(specs, server_port, browser, timeout_s=timeout_s)
        return results
    except Exception as exc:
        logger.warning("capture_maps failed: %s", exc)
        return {s.name: None for s in specs}
    finally:
        if server is not None:
            try:
                server.shutdown()
                server.server_close()
            except Exception:
                pass
        shutil.rmtree(tmp_dir, ignore_errors=True)


def _smoke_cli(out_dir_path: str) -> int:
    out_dir = Path(out_dir_path)
    out_dir.mkdir(parents=True, exist_ok=True)

    parquet_path = get_repo_root() / "data" / "build" / "units.parquet"
    if not parquet_path.is_file():
        print(f"ERROR: {parquet_path} not found")
        return 1

    from atalaya.report.charts import CATEGORY_COLORS
    import pandas as pd

    df = pd.read_parquet(parquet_path)
    state_df = df[df["level"] == "state"]
    mun_df = df[df["level"] == "mun"]

    state_fill = {
        str(row["id"]).zfill(2): CATEGORY_COLORS.get(
            row.get("category"), CATEGORY_COLORS["sin_dato"]
        )
        for _, row in state_df.iterrows()
    }
    mun_fill = {
        str(row["id"]).zfill(5): CATEGORY_COLORS.get(
            row.get("category"), CATEGORY_COLORS["sin_dato"]
        )
        for _, row in mun_df.iterrows()
    }

    specs = [
        MapSpec(name="smoke_state", level="state", fill_by_id=state_fill, width=600, height=330),
        MapSpec(name="smoke_mun", level="mun", fill_by_id=mun_fill, width=600, height=340),
    ]

    print(f"Running smoke capture for {len(specs)} specs...")
    results = capture_maps(specs)

    all_valid = True
    for spec in specs:
        png_bytes = results.get(spec.name)
        if not png_bytes:
            print(f"FAIL: Spec '{spec.name}' returned None")
            all_valid = False
            continue

        out_file = out_dir / f"{spec.name}.png"
        out_file.write_bytes(png_bytes)

        img = Image.open(io.BytesIO(png_bytes)).convert("RGB")
        w, h = img.size
        colors = img.getcolors(maxcolors=max(w * h, 256))
        num_distinct = max(w * h, 256) if colors is None else len(colors)
        valid = validate_image(png_bytes, spec)

        print(
            f"SPEC: {spec.name} -> Size: {w}x{h}, Distinct colors: {num_distinct}, Valid: {valid}, File: {out_file}"
        )
        if not valid:
            all_valid = False

    return 0 if all_valid else 1


def main() -> None:
    parser = argparse.ArgumentParser(description="ATALAYA Map Capture")
    parser.add_argument(
        "--smoke",
        type=str,
        metavar="OUT_DIR",
        help="Run smoke capture on real units.parquet and write PNGs to OUT_DIR",
    )
    args = parser.parse_args()

    if args.smoke:
        sys.exit(_smoke_cli(args.smoke))
    else:
        parser.print_help()
        sys.exit(0)


if __name__ == "__main__":
    main()
