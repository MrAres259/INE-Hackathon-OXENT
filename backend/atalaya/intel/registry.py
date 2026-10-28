"""Append-only audit registry for intelligence decisions and operator actions."""

from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
import threading
from typing import Iterable

from atalaya.intel.schemas import RegistryEntry
from atalaya.intel import storage

_LOCK = threading.Lock()


def _registry_path() -> Path:
    return storage.intel_dir() / "registry.jsonl"



def _read_all_entries() -> list[RegistryEntry]:
    """Read all valid RegistryEntry records from the append-only JSONL file."""
    path = _registry_path()
    if not path.is_file():
        return []

    entries: list[RegistryEntry] = []
    try:
        with path.open("r", encoding="utf-8") as f:
            for line in f:
                raw = line.strip()
                if not raw:
                    continue
                try:
                    payload = json.loads(raw)
                    entries.append(RegistryEntry(**payload))
                except Exception:
                    # Ignore corrupted lines
                    continue
    except Exception:
        return []
    return entries


def append(entry: RegistryEntry) -> RegistryEntry:
    """Append a new decision record to the JSONL registry with server timestamp."""
    with _LOCK:
        if not entry.at:
            entry.at = datetime.now(timezone.utc).isoformat()

        path = _registry_path()
        path.parent.mkdir(parents=True, exist_ok=True)

        line = json.dumps(entry.model_dump(), ensure_ascii=False)
        with path.open("a", encoding="utf-8") as f:
            f.write(line + "\n")
            f.flush()

        return entry.model_copy()


def latest(item_id: str, *, public: bool = True) -> RegistryEntry | None:
    """Return the most recent registry entry for a given item_id."""
    with _LOCK:
        entries = _read_all_entries()

    for item in reversed(entries):
        if item.item_id == item_id:
            res = item.model_copy()
            if public:
                res.note = ""
            return res
    return None


def history(item_id: str) -> list[RegistryEntry]:
    """Return the complete audit history for a given item_id."""
    with _LOCK:
        entries = _read_all_entries()

    return [item.model_copy() for item in entries if item.item_id == item_id]


def latest_map(ids: Iterable[str], *, public: bool = True) -> dict[str, RegistryEntry]:
    """Return a mapping of item_id -> latest RegistryEntry for the provided IDs."""
    target_ids = set(ids)
    if not target_ids:
        return {}

    with _LOCK:
        entries = _read_all_entries()

    res: dict[str, RegistryEntry] = {}
    for item in entries:
        if item.item_id in target_ids:
            res[item.item_id] = item

    out: dict[str, RegistryEntry] = {}
    for iid, ent in res.items():
        copy_ent = ent.model_copy()
        if public:
            copy_ent.note = ""
        out[iid] = copy_ent
    return out
