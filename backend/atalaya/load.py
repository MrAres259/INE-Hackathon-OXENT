"""Loader CLI to index data into Elasticsearch or validate via --dry-run."""

from __future__ import annotations

import argparse
import sys
from typing import Any

import numpy as np
import pandas as pd

from atalaya.config import BUILD_DIR, SEED_DIR, get_settings, index_name
from atalaya.es_client import bulk_index, ensure_templates, get_es, ping_es
from atalaya.ingest.common import zpad
from atalaya.store import PandasStore


def _clean_doc(d: dict[str, Any]) -> dict[str, Any]:
    """Replace NaN/float('nan') and infinite values with None."""
    cleaned = {}
    for k, v in d.items():
        if v is None:
            cleaned[k] = None
        elif isinstance(v, float) and (np.isnan(v) or np.isinf(v)):
            cleaned[k] = None
        elif pd.isna(v):
            cleaned[k] = None
        else:
            cleaned[k] = v
    return cleaned


def prepare_units_docs(store: PandasStore) -> list[dict[str, Any]]:
    """Prepare unit documents (mun and state levels)."""
    df = store._get_units()
    if df.empty:
        return []

    drivers_path = store.build_dir / "drivers.parquet"
    drivers_by_id: dict[str, list[dict[str, Any]]] = {}
    if drivers_path.is_file():
        try:
            ddf = pd.read_parquet(drivers_path)
            for _, r in ddf.iterrows():
                uid = str(r.get("id") or r.get("cvegeo", "")).strip()
                if uid:
                    item = _clean_doc(r.to_dict())
                    if "rank" in item and item["rank"] is not None:
                        item["rank"] = int(item["rank"])
                    if "contribution_pp" in item and item["contribution_pp"] is not None:
                        item["contribution_pp"] = float(item["contribution_pp"])
                    drivers_by_id.setdefault(uid, []).append(item)
        except Exception:
            pass

    valid_cve_ents = {f"{i:02d}" for i in range(1, 33)}
    docs = []
    seen_ids = set()

    for _, row in df.iterrows():
        d = _clean_doc(row.to_dict())
        u_id = str(d.get("id") or d.get("cvegeo", "")).strip()
        if not u_id:
            continue
        if u_id in seen_ids:
            continue
        seen_ids.add(u_id)
        d["id"] = u_id

        # Normalize cve_ent
        if d.get("cve_ent"):
            d["cve_ent"] = zpad(d["cve_ent"], 2)

        # Name norm for fuzzy searching
        if "name" in d and d["name"]:
            from atalaya.ingest.common import norm_name
            d["name_norm"] = norm_name(d["name"])

        d["drivers"] = drivers_by_id.get(u_id, [])
        docs.append(d)

    return docs


def prepare_participation_docs(store: PandasStore) -> list[dict[str, Any]]:
    """Prepare participation documents with composite ID: {unit_id}_{election}_{year}."""
    df = store._get_participation()
    if df.empty:
        return []

    units_df = store._get_units()
    unit_name_map = {}
    if not units_df.empty and "id" in units_df.columns and "name" in units_df.columns:
        unit_name_map = dict(zip(units_df["id"].astype(str), units_df["name"]))

    docs = []
    seen_ids = set()

    for _, row in df.iterrows():
        d = _clean_doc(row.to_dict())
        u_id = str(d.get("unit_id") or d.get("cvegeo", "")).strip()
        election = str(d.get("election", "")).strip()
        year = d.get("year")
        if not u_id or not election or year is None:
            continue

        doc_id = f"{u_id}_{election}_{int(year)}"
        if doc_id in seen_ids:
            continue
        seen_ids.add(doc_id)
        d["id"] = doc_id
        d["unit_id"] = u_id
        d["name"] = unit_name_map.get(u_id, "")
        if d.get("cve_ent"):
            d["cve_ent"] = zpad(d["cve_ent"], 2)

        # Ensure participation in [0, 1] or None
        part = d.get("participacion")
        if part is not None:
            part_val = float(part)
            if not (0.0 <= part_val <= 1.0):
                d["participacion"] = None
                d["abstencion"] = None
            else:
                d["participacion"] = round(part_val, 6)
                if d.get("abstencion") is not None:
                    d["abstencion"] = round(float(d["abstencion"]), 6)

        docs.append(d)

    return docs


def prepare_catalog_docs(store: PandasStore) -> list[dict[str, Any]]:
    """Prepare catalog documents from seed/variables.csv."""
    df = store._get_catalog()
    if df.empty:
        return []

    docs = []
    seen_ids = set()

    for _, row in df.iterrows():
        d = _clean_doc(row.to_dict())
        key = str(d.get("key", "")).strip()
        if not key or key in seen_ids:
            continue
        seen_ids.add(key)
        d["id"] = key
        docs.append(d)

    return docs


def prepare_profile_docs(store: PandasStore) -> list[dict[str, Any]]:
    """Prepare profile documents for municipal and state levels."""
    profile_path = store.build_dir / "ccpc_profile_mun.parquet"
    if not profile_path.is_file():
        return []

    try:
        df = pd.read_parquet(profile_path)
    except Exception:
        return []

    if df.empty:
        return []

    docs: list[dict[str, Any]] = []
    seen_ids = set()

    for _, row in df.iterrows():
        d = _clean_doc(row.to_dict())
        u_id = str(d.get("cvegeo") or d.get("unit_id", "")).strip()
        year = d.get("year")
        age_group = str(d.get("age_group", "")).strip()
        sexo = str(d.get("sexo", "")).strip()
        if not u_id or year is None or not age_group or not sexo:
            continue

        doc_id = f"{u_id}_{int(year)}_{age_group}_{sexo}"
        if doc_id in seen_ids:
            continue
        seen_ids.add(doc_id)

        sv = float(d.get("sv") or 0)
        nv = float(d.get("nv") or 0)
        part = sv / (sv + nv) if (sv + nv) > 0 else None
        cve_ent = zpad(d.get("cve_ent", ""), 2) if d.get("cve_ent") else u_id[:2]

        doc = {
            "id": doc_id,
            "unit_id": u_id,
            "level": "mun",
            "cve_ent": cve_ent,
            "year": int(year),
            "age_group": age_group,
            "sexo": sexo,
            "ln": int(d.get("ln") or 0),
            "sv": int(sv),
            "nv": int(nv),
            "ns": int(d.get("ns") or 0),
            "participacion": round(part, 6) if part is not None else None,
        }
        docs.append(doc)

    # State docs
    if "cve_ent" in df.columns:
        sum_cols = [c for c in ["ln", "sv", "nv", "ns"] if c in df.columns]
        df_ent = df.copy()
        df_ent["cve_ent"] = df_ent["cve_ent"].apply(lambda v: zpad(v, 2))
        grouped = df_ent.groupby(["cve_ent", "year", "age_group", "sexo"], as_index=False)[sum_cols].sum()

        for _, row in grouped.iterrows():
            d = _clean_doc(row.to_dict())
            cve_ent = str(d.get("cve_ent", "")).strip()
            year = d.get("year")
            age_group = str(d.get("age_group", "")).strip()
            sexo = str(d.get("sexo", "")).strip()
            if not cve_ent or year is None or not age_group or not sexo:
                continue

            doc_id = f"{cve_ent}_{int(year)}_{age_group}_{sexo}"
            if doc_id in seen_ids:
                continue
            seen_ids.add(doc_id)

            sv = float(d.get("sv") or 0)
            nv = float(d.get("nv") or 0)
            part = sv / (sv + nv) if (sv + nv) > 0 else None

            doc = {
                "id": doc_id,
                "unit_id": cve_ent,
                "level": "state",
                "cve_ent": cve_ent,
                "year": int(year),
                "age_group": age_group,
                "sexo": sexo,
                "ln": int(d.get("ln") or 0),
                "sv": int(sv),
                "nv": int(nv),
                "ns": int(d.get("ns") or 0),
                "participacion": round(part, 6) if part is not None else None,
            }
            docs.append(doc)

    return docs


def validate_docs(
    name: str,
    docs: list[dict[str, Any]],
) -> list[str]:
    """Validate documents for consistency."""
    errors = []
    seen_ids = set()
    valid_cve_ents = {f"{i:02d}" for i in range(1, 33)}

    for i, doc in enumerate(docs):
        doc_id = doc.get("id")
        if not doc_id:
            errors.append(f"[{name}] Document at index {i} has empty 'id'")
        elif doc_id in seen_ids:
            errors.append(f"[{name}] Duplicate ID found: {doc_id}")
        else:
            seen_ids.add(doc_id)

        cve_ent = doc.get("cve_ent")
        if cve_ent is not None:
            cve_str = str(cve_ent)
            if cve_str not in valid_cve_ents:
                errors.append(f"[{name}] Invalid cve_ent '{cve_str}' in doc {doc_id}")

        if "participacion" in doc and doc["participacion"] is not None:
            val = float(doc["participacion"])
            if not (0.0 <= val <= 1.0):
                errors.append(f"[{name}] participacion out of range [0, 1] in doc {doc_id}: {val}")

    return errors


def main() -> None:
    parser = argparse.ArgumentParser(description="ATALAYA Elasticsearch Loader")
    parser.add_argument("--dry-run", action="store_true", help="Validate documents and print counts without connecting to ES")
    parser.add_argument("--only", type=str, default="units,participation,catalog,profile", help="Comma-separated list of indices to load")
    args = parser.parse_args()

    targets = [t.strip() for t in args.only.split(",") if t.strip()]

    store = PandasStore(build_dir=BUILD_DIR, seed_dir=SEED_DIR)

    all_docs: dict[str, list[dict[str, Any]]] = {}
    if "units" in targets:
        all_docs["units"] = prepare_units_docs(store)
    if "participation" in targets:
        all_docs["participation"] = prepare_participation_docs(store)
    if "catalog" in targets:
        all_docs["catalog"] = prepare_catalog_docs(store)
    if "profile" in targets:
        all_docs["profile"] = prepare_profile_docs(store)

    validation_errors = []
    for kind, docs in all_docs.items():
        errs = validate_docs(kind, docs)
        if errs:
            validation_errors.extend(errs[:10])

    if validation_errors:
        print("Validation errors encountered:")
        for err in validation_errors:
            print(f"  - {err}")
        if not args.dry_run:
            sys.exit(1)

    print("Index document counts:")
    for kind in ["units", "participation", "catalog", "profile"]:
        if kind in targets:
            count = len(all_docs.get(kind, []))
            print(f"  {kind}: {count}")

    if args.dry_run:
        print("[dry-run] Validation complete. No Elasticsearch changes made.")
        return

    # Real indexing: ping cluster first
    if not ping_es(timeout_s=5.0):
        print("cluster unreachable")
        sys.exit(2)

    es = get_es()
    if es is None:
        print("cluster unreachable")
        sys.exit(2)

    ensure_templates(es)

    for kind in targets:
        docs = all_docs.get(kind, [])
        idx = index_name(kind)

        # Delete and recreate index
        try:
            if es.indices.exists(index=idx):
                es.indices.delete(index=idx)
            es.indices.create(index=idx)
        except Exception as e:
            print(f"Failed to create index {idx}: {e}")
            sys.exit(1)

        ok_count, errors = bulk_index(es, idx, docs, id_field="id", chunk=2000)
        es.indices.refresh(index=idx)
        print(f"Indexed {ok_count}/{len(docs)} documents into {idx}")
        if errors:
            print(f"Sample errors ({len(errors)}): {errors[:2]}")


if __name__ == "__main__":
    main()
