"""Storage helpers for Atalaya intelligence cache and artifacts."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import secrets
from typing import Any

from atalaya.config import CACHE_DIR


def intel_dir() -> Path:
    """Return the root cache directory for intelligence features, ensuring it exists."""
    p = CACHE_DIR / "intel"
    p.mkdir(parents=True, exist_ok=True)
    return p


def read_json(path: Path) -> Any | None:
    """Read and parse a JSON file, returning None if absent or corrupt."""
    try:
        if not path.is_file():
            return None
        text = path.read_text(encoding="utf-8")
        if not text.strip():
            return None
        return json.loads(text)
    except Exception:
        return None


def write_json_atomic(path: Path, obj: Any) -> None:
    """Write an object to a file as JSON atomically using a temporary file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(f"{path.name}.tmp.{secrets.token_hex(4)}")
    try:
        content = json.dumps(obj, indent=2, ensure_ascii=False)
        temp_path.write_text(content, encoding="utf-8")
        os.replace(temp_path, path)
    finally:
        if temp_path.exists():
            try:
                temp_path.unlink()
            except OSError:
                pass


def campaign_result_path(unit_id: str, focus: str | None) -> Path:
    """Return the destination path for a campaign plan result JSON."""
    raw_focus = (focus or "").strip()
    focus_hash = hashlib.sha1(raw_focus.encode("utf-8")).hexdigest()[:8]
    return intel_dir() / "results" / "campaign" / f"{unit_id}__{focus_hash}.json"


def monitor_result_path() -> Path:
    """Return the destination path for the latest monitor snapshot JSON."""
    return intel_dir() / "results" / "monitor" / "latest.json"


def exports_dir() -> Path:
    """Return the directory for exported campaign slide decks (PDF/PPTX), ensuring it exists."""
    p = intel_dir() / "exports"
    p.mkdir(parents=True, exist_ok=True)
    return p
