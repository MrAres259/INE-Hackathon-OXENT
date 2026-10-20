"""Unit tests for headless MapLibre GL map capture (W2-D).

Runs in-process without spawning real Chrome instances or hitting external networks.
"""

from __future__ import annotations

import io
import json
from pathlib import Path
import re
import threading
import urllib.error
import urllib.request
from typing import Any

from PIL import Image
import pytest

from atalaya.report.map_capture import (
    MEXICO_BOUNDS,
    MapSpec,
    capture_available,
    capture_maps,
    hex_to_rgb,
    make_handler,
    png_data_uri,
    spec_to_render_payload,
    validate_image,
)
from atalaya.report.charts import CATEGORY_COLORS


def _make_test_png(
    width: int,
    height: int,
    colors: list[tuple[int, int, int]],
    border_px: int = 4,
) -> bytes:
    """Creates an in-memory PNG with pixel strips of the given RGB colors."""
    img = Image.new("RGB", (width, height), colors[0])
    strip_w = max(1, width // len(colors))
    for i, col in enumerate(colors):
        x0 = max(border_px, i * strip_w)
        x1 = min(width - border_px, width if i == len(colors) - 1 else (i + 1) * strip_w)
        for x in range(x0, x1):
            for y in range(border_px, height - border_px):
                img.putpixel((x, y), col)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


class TestHandlerRouteMapping:
    """Verifies that the local HTTP asset server serves assets correctly and rejects traversal."""

    def test_handler_serves_and_blocks(self, tmp_path: Path) -> None:
        import http.server

        geo_dir = tmp_path / "geo"
        geo_dir.mkdir(parents=True)
        (geo_dir / "tiles.json").write_text('{"tilejson": "3.0.0"}', encoding="utf-8")

        tile_dir = geo_dir / "tiles" / "3" / "1"
        tile_dir.mkdir(parents=True)
        (tile_dir / "2.pbf").write_bytes(b"\x1a\x02\x08\x01")

        temp_dir = tmp_path / "temp"
        temp_dir.mkdir(parents=True)
        (temp_dir / "print.html").write_text("<!DOCTYPE html><html></html>", encoding="utf-8")
        (temp_dir / "print.js").write_text("console.log('test');", encoding="utf-8")

        secret_file = tmp_path / "secret.txt"
        secret_file.write_text("TOP_SECRET", encoding="utf-8")

        handler_cls = make_handler(geo_dir, temp_dir)
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler_cls)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        port = server.server_address[1]

        base_url = f"http://127.0.0.1:{port}"
        try:
            # 1. Geo tiles.json
            with urllib.request.urlopen(f"{base_url}/geo/tiles.json") as resp:
                assert resp.status == 200
                assert "application/json" in resp.headers.get("Content-Type", "")
                data = json.loads(resp.read().decode("utf-8"))
                assert data["tilejson"] == "3.0.0"

            # 2. Vector tile (.pbf)
            with urllib.request.urlopen(f"{base_url}/geo/tiles/3/1/2.pbf") as resp:
                assert resp.status == 200
                assert resp.headers.get("Content-Type") == "application/x-protobuf"
                assert resp.read() == b"\x1a\x02\x08\x01"

            # 3. Temp HTML
            with urllib.request.urlopen(f"{base_url}/print.html") as resp:
                assert resp.status == 200
                assert "text/html" in resp.headers.get("Content-Type", "")
                assert b"<!DOCTYPE html>" in resp.read()

            # 4. Temp JS
            with urllib.request.urlopen(f"{base_url}/print.js") as resp:
                assert resp.status == 200
                assert "application/javascript" in resp.headers.get("Content-Type", "")
                assert b"console.log" in resp.read()

            # 5. Non-existent file => 404
            with pytest.raises(urllib.error.HTTPError) as exc_404:
                urllib.request.urlopen(f"{base_url}/nonexistent.xyz")
            assert exc_404.value.code == 404

            # 6. Path traversal attempt in root => 403
            with pytest.raises(urllib.error.HTTPError) as exc_403_root:
                urllib.request.urlopen(f"{base_url}/../secret.txt")
            assert exc_403_root.value.code == 403

            # 7. Path traversal attempt in geo => 403
            with pytest.raises(urllib.error.HTTPError) as exc_403_geo:
                urllib.request.urlopen(f"{base_url}/geo/../secret.txt")
            assert exc_403_geo.value.code == 403

        finally:
            server.shutdown()
            server.server_close()


class TestMapSpecSerialization:
    """Verifies MapSpec fields, oversampling, and JSON payload serialization."""

    def test_spec_to_render_payload_mun(self) -> None:
        spec = MapSpec(
            name="mun_spec",
            level="mun",
            fill_by_id={"01001": "#2e7d32", "01002": "#ef6c00"},
            width=600,
            height=340,
            scale=2.0,
            nodata_color="#e0e0e0",
            background="#ffffff",
            mun_line_color="#ffffff",
            state_line_color="#333333",
            padding=8,
        )

        payload = spec_to_render_payload(spec)
        assert payload["name"] == "mun_spec"
        assert payload["level"] == "mun"
        assert payload["oversample"] == 4  # mun must oversample with k=4
        assert payload["width"] == 600
        assert payload["height"] == 340
        assert payload["scale"] == 2.0
        assert payload["fill_by_id"] == {"01001": "#2e7d32", "01002": "#ef6c00"}
        assert payload["bounds"] == [[-118.36511, 14.5321], [-86.71069, 32.71865]]
        assert payload["padding"] == int(round(max(8.0, 0.04 * 340) * 4))

        # Valid JSON serializable
        encoded = json.dumps(payload)
        decoded = json.loads(encoded)
        assert decoded["name"] == "mun_spec"
        assert decoded["oversample"] == 4

    def test_spec_to_render_payload_state(self) -> None:
        spec = MapSpec(
            name="state_spec",
            level="state",
            fill_by_id={"01": "#2e7d32"},
            width=600,
            height=330,
        )
        payload = spec_to_render_payload(spec)
        assert payload["level"] == "state"
        assert payload["oversample"] == 2  # state must oversample with k=2
        assert payload["bounds"] == [[-118.36511, 14.5321], [-86.71069, 32.71865]]
        assert payload["padding"] == int(round(max(6.0, 0.04 * 330) * 2))

    def test_default_bounds_from_manifest(self) -> None:
        from atalaya.report.map_capture import get_default_bounds
        bounds = get_default_bounds()
        assert bounds[0][0] == pytest.approx(-118.36511, rel=1e-4)
        assert bounds[0][1] == pytest.approx(14.5321, rel=1e-4)
        assert bounds[1][0] == pytest.approx(-86.71069, rel=1e-4)
        assert bounds[1][1] == pytest.approx(32.71865, rel=1e-4)


class TestImageValidation:
    """Tests Pillow image validation against synthetic images."""

    def test_validate_image_valid(self) -> None:
        # 4 distinct colors, including #2e7d32 and #f9a825
        colors = [
            (255, 255, 255),  # background
            (75, 85, 99),     # line
            (46, 125, 50),    # #2e7d32 (verde)
            (249, 168, 37),   # #f9a825 (amarillo)
        ]
        png = _make_test_png(100, 100, colors)
        spec = MapSpec(
            name="test_valid",
            level="state",
            fill_by_id={"01": "#2e7d32", "02": "#f9a825"},
        )
        assert validate_image(png, spec) is True

    def test_validate_image_tolerance(self) -> None:
        # #2e7d32 is (46, 125, 50); test with ±5 channel drift: (50, 122, 54)
        colors = [
            (255, 255, 255),
            (75, 85, 99),
            (50, 122, 54),   # within tolerance 6 of (46, 125, 50)
            (200, 200, 200),
        ]
        png = _make_test_png(100, 100, colors)
        spec = MapSpec(
            name="test_tol",
            level="state",
            fill_by_id={"01": "#2e7d32"},
        )
        assert validate_image(png, spec, channel_tolerance=6) is True

    def test_validate_image_monocolor_fails(self) -> None:
        # Single solid color (only 1 distinct color < 4)
        colors = [(255, 255, 255)]
        png = _make_test_png(100, 100, colors)
        spec = MapSpec(
            name="test_mono",
            level="state",
            fill_by_id={"01": "#2e7d32"},
        )
        assert validate_image(png, spec) is False

    def test_validate_image_missing_expected_color_fails(self) -> None:
        # 4 distinct colors, but none matches #2e7d32
        colors = [
            (255, 255, 255),
            (10, 10, 10),
            (100, 100, 100),
            (200, 200, 200),
        ]
        png = _make_test_png(100, 100, colors)
        spec = MapSpec(
            name="test_missing_color",
            level="state",
            fill_by_id={"01": "#2e7d32"},
        )
        assert validate_image(png, spec) is False

    def test_validate_image_touching_border_fails(self) -> None:
        colors = [
            (255, 255, 255),  # background
            (75, 85, 99),     # line
            (46, 125, 50),    # #2e7d32 (verde)
            (249, 168, 37),   # #f9a825 (amarillo)
        ]
        # Create an image where non-background color touches outer 2 px border
        img = Image.new("RGB", (100, 100), colors[0])
        # Fill border rows 0 and 1 with a colored strip
        for x in range(100):
            for y in range(2):
                img.putpixel((x, y), colors[2])
        # Also put interior colors so distinct colors and top colors pass
        for x in range(20, 80):
            for y in range(20, 80):
                img.putpixel((x, y), colors[3])
            img.putpixel((x, 50), colors[1])

        buf = io.BytesIO()
        img.save(buf, format="PNG")
        png = buf.getvalue()

        spec = MapSpec(
            name="test_touch_border",
            level="state",
            fill_by_id={"01": "#2e7d32", "02": "#f9a825"},
        )
        assert validate_image(png, spec) is False


class TestCaptureAvailableAndFallbacks:
    """Tests environment checks and fallback behavior without calling Chrome."""

    def test_capture_available_missing_browser(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr("atalaya.report.map_capture.find_browser", lambda: None)
        ok, reason = capture_available()
        assert ok is False
        assert "not found" in reason.lower()

    def test_capture_available_missing_tiles_json(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        monkeypatch.setattr(
            "atalaya.report.map_capture.find_browser",
            lambda: Path("fake_browser.exe"),
        )
        monkeypatch.setattr("atalaya.report.map_capture.get_geo_root", lambda: tmp_path)
        ok, reason = capture_available()
        assert ok is False
        assert "tiles.json" in reason

    def test_capture_available_missing_maplibre_dist(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        geo_dir = tmp_path / "geo"
        geo_dir.mkdir()
        (geo_dir / "tiles.json").write_text("{}", encoding="utf-8")

        dist_dir = tmp_path / "dist"
        dist_dir.mkdir()

        monkeypatch.setattr(
            "atalaya.report.map_capture.find_browser",
            lambda: Path("fake_browser.exe"),
        )
        monkeypatch.setattr("atalaya.report.map_capture.get_geo_root", lambda: geo_dir)
        monkeypatch.setattr(
            "atalaya.report.map_capture.get_maplibre_dist_dir", lambda: dist_dir
        )

        ok, reason = capture_available()
        assert ok is False
        assert "maplibre-gl" in reason.lower()

    def test_capture_available_success(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        geo_dir = tmp_path / "geo"
        geo_dir.mkdir()
        (geo_dir / "tiles.json").write_text("{}", encoding="utf-8")

        dist_dir = tmp_path / "dist"
        dist_dir.mkdir()
        (dist_dir / "maplibre-gl.js").write_text("// js", encoding="utf-8")
        (dist_dir / "maplibre-gl.css").write_text("/* css */", encoding="utf-8")

        monkeypatch.setattr(
            "atalaya.report.map_capture.find_browser",
            lambda: Path("fake_browser.exe"),
        )
        monkeypatch.setattr("atalaya.report.map_capture.get_geo_root", lambda: geo_dir)
        monkeypatch.setattr(
            "atalaya.report.map_capture.get_maplibre_dist_dir", lambda: dist_dir
        )

        ok, reason = capture_available()
        assert ok is True
        assert reason == "ok"

    def test_capture_maps_returns_none_when_no_browser(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr("atalaya.report.map_capture.find_browser", lambda: None)
        specs = [
            MapSpec(name="m1", level="state", fill_by_id={}),
            MapSpec(name="m2", level="mun", fill_by_id={}),
        ]
        results = capture_maps(specs)
        assert results == {"m1": None, "m2": None}

    def test_capture_maps_returns_none_when_cdp_session_raises(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        geo_dir = tmp_path / "geo"
        geo_dir.mkdir()
        (geo_dir / "tiles.json").write_text("{}", encoding="utf-8")

        dist_dir = tmp_path / "dist"
        dist_dir.mkdir()
        (dist_dir / "maplibre-gl.js").write_text("// js", encoding="utf-8")
        (dist_dir / "maplibre-gl.css").write_text("/* css */", encoding="utf-8")

        print_dir = tmp_path / "print"
        print_dir.mkdir()
        (print_dir / "print.html").write_text("<html></html>", encoding="utf-8")
        (print_dir / "print.js").write_text("// js", encoding="utf-8")

        monkeypatch.setattr(
            "atalaya.report.map_capture.find_browser",
            lambda: Path("fake_browser.exe"),
        )
        monkeypatch.setattr("atalaya.report.map_capture.get_geo_root", lambda: geo_dir)
        monkeypatch.setattr(
            "atalaya.report.map_capture.get_maplibre_dist_dir", lambda: dist_dir
        )
        monkeypatch.setattr("atalaya.report.map_capture.get_print_dir", lambda: print_dir)

        def _exploding_cdp(*args: Any, **kwargs: Any) -> Any:
            raise RuntimeError("CDP crashed")

        monkeypatch.setattr(
            "atalaya.report.map_capture._run_cdp_session", _exploding_cdp
        )

        specs = [
            MapSpec(name="s1", level="state", fill_by_id={}),
            MapSpec(name="s2", level="mun", fill_by_id={}),
        ]
        # Must not raise, returns all None
        results = capture_maps(specs)
        assert results == {"s1": None, "s2": None}


class TestPaletteParityAndHelpers:
    """Verifies color palette parity between backend charts and frontend format.ts."""

    def test_palette_parity_with_frontend(self) -> None:
        repo_root = Path(__file__).resolve().parents[2]
        format_ts_path = repo_root / "frontend" / "src" / "lib" / "format.ts"
        assert format_ts_path.is_file(), f"format.ts not found at {format_ts_path}"

        content = format_ts_path.read_text(encoding="utf-8")
        # Match export const CATEGORY_COLORS: Record<Category, string> = { ... };
        match = re.search(
            r"export\s+const\s+CATEGORY_COLORS\s*:\s*Record<Category,\s*string>\s*=\s*\{([^}]+)\};",
            content,
        )
        assert match is not None, "CATEGORY_COLORS definition not found in format.ts"

        ts_colors: dict[str, str] = {}
        for line in match.group(1).splitlines():
            line = line.strip().rstrip(",")
            if not line:
                continue
            pair = line.split(":")
            if len(pair) == 2:
                key = pair[0].strip().strip('"').strip("'")
                val = pair[1].strip().strip('"').strip("'")
                ts_colors[key] = val

        for cat, hex_val in CATEGORY_COLORS.items():
            assert cat in ts_colors, f"Category '{cat}' missing in frontend format.ts"
            assert (
                hex_val.lower() == ts_colors[cat].lower()
            ), f"Color mismatch for '{cat}': backend {hex_val} != frontend {ts_colors[cat]}"

    def test_png_data_uri(self) -> None:
        data = b"\x89PNG\r\n\x1a\n"
        uri = png_data_uri(data)
        assert uri.startswith("data:image/png;base64,")
        b64_part = uri.split(",", 1)[1]
        import base64
        assert base64.b64decode(b64_part) == data

    def test_hex_to_rgb(self) -> None:
        assert hex_to_rgb("#2e7d32") == (46, 125, 50)
        assert hex_to_rgb("ffffff") == (255, 255, 255)
        assert hex_to_rgb("#000") == (0, 0, 0)
