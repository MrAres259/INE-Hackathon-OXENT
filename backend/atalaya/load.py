"""Loader CLI to index data into OpenSearch or validate via --dry-run."""

from __future__ import annotations

import argparse
from datetime import datetime
import re
import sys
from typing import Any

import numpy as np
import pandas as pd

from atalaya.config import BUILD_DIR, SEED_DIR, get_settings, index_name
from atalaya.ingest.common import zpad
from atalaya.search_client import (
    auto_replicas,
    bulk_index,
    cluster_info,
    ensure_index_templates,
    get_client,
    ping,
)
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


def assert_prefixed(name: str) -> None:
    """Raise ValueError if the given index or alias name does not start with the configured prefix."""
    prefix = get_settings().index_prefix
    if not prefix or not name.startswith(prefix):
        raise ValueError(
            f"Index or alias '{name}' does not start with configured prefix '{prefix}'"
        )


def purge_prefixed(client: Any) -> dict[str, list[str]]:
    """Purge all aliases, indices, and templates matching the configured index prefix.

    Raises ValueError if prefix is empty. Only deletes resources whose names start with the prefix.
    Never uses wildcards in index deletion calls.
    """
    prefix = get_settings().index_prefix
    if not prefix or not prefix.strip():
        raise ValueError("Configured index prefix is empty")

    deleted_aliases: set[str] = set()
    deleted_indices: list[str] = []
    deleted_templates: set[str] = set()

    # 1. Aliases: find all aliases matching {prefix}*
    try:
        alias_res = client.indices.get_alias(name=f"{prefix}*", ignore=[404])
    except Exception:
        alias_res = {}

    if isinstance(alias_res, dict) and alias_res.get("status") != 404 and "error" not in alias_res:
        for idx_name, data in alias_res.items():
            if isinstance(data, dict):
                for alias_name in data.get("aliases", {}).keys():
                    assert_prefixed(alias_name)
                    try:
                        if hasattr(client.indices, "delete_alias"):
                            client.indices.delete_alias(index=idx_name, name=alias_name, ignore=[404])
                        elif hasattr(client.indices, "update_aliases"):
                            client.indices.update_aliases(
                                body={"actions": [{"remove": {"index": idx_name, "alias": alias_name}}]}
                            )
                    except Exception:
                        pass
                    deleted_aliases.add(alias_name)

    # 2. Indices: find all indices matching {prefix}*
    try:
        idx_res = client.indices.get(index=f"{prefix}*", ignore=[404])
    except Exception:
        idx_res = {}

    if isinstance(idx_res, dict) and idx_res.get("status") != 404 and "error" not in idx_res:
        for idx_name in sorted(idx_res.keys()):
            assert_prefixed(idx_name)
            # Delete each index by exact name - NEVER with a wildcard
            try:
                client.indices.delete(index=idx_name, ignore=[404])
            except Exception:
                pass
            deleted_indices.append(idx_name)

    # 3. Composite index templates matching {prefix}*
    try:
        if hasattr(client.indices, "get_index_template"):
            tmpl_res = client.indices.get_index_template(name=f"{prefix}*", ignore=[404])
        else:
            tmpl_res = {}
    except Exception:
        tmpl_res = {}

    if isinstance(tmpl_res, dict) and tmpl_res.get("status") != 404 and "error" not in tmpl_res:
        for item in tmpl_res.get("index_templates", []):
            t_name = item.get("name")
            if t_name:
                assert_prefixed(t_name)
                try:
                    if hasattr(client.indices, "delete_index_template"):
                        client.indices.delete_index_template(name=t_name, ignore=[404])
                except Exception:
                    pass
                deleted_templates.add(t_name)

    # 4. Legacy index templates matching {prefix}*
    try:
        if hasattr(client.indices, "get_template"):
            leg_res = client.indices.get_template(name=f"{prefix}*", ignore=[404])
        else:
            leg_res = {}
    except Exception:
        leg_res = {}

    if isinstance(leg_res, dict) and leg_res.get("status") != 404 and "error" not in leg_res:
        for t_name in leg_res.keys():
            assert_prefixed(t_name)
            try:
                if hasattr(client.indices, "delete_template"):
                    client.indices.delete_template(name=t_name, ignore=[404])
            except Exception:
                pass
            deleted_templates.add(t_name)

    return {
        "aliases": sorted(deleted_aliases),
        "indices": deleted_indices,
        "templates": sorted(deleted_templates),
    }


def versioned_name(kind: str, stamp: str) -> str:
    """Generate a versioned physical index name and validate its prefix."""
    alias = index_name(kind)
    assert_prefixed(alias)
    name = f"{alias}-{stamp}"
    assert_prefixed(name)
    return name


def physical_versions(client: Any, kind: str) -> list[str]:
    """Return physical index names matching '{alias}-<14 digits>' sorted from oldest to newest."""
    alias = index_name(kind)
    assert_prefixed(alias)
    pattern = rf"^{re.escape(alias)}-\d{{14}}$"
    rx = re.compile(pattern)
    try:
        res = client.indices.get(index=f"{alias}-*", ignore=[404])
        if not isinstance(res, dict) or res.get("status") == 404 or "error" in res:
            return []
        matching = [name for name in res.keys() if rx.match(name)]
        return sorted(matching)
    except Exception:
        return []


def swap_alias(client: Any, alias: str, new_index: str) -> list[str]:
    """Atomically point alias to new_index, removing any prior index associations."""
    assert_prefixed(alias)
    assert_prefixed(new_index)

    current_indices: list[str] = []
    try:
        if hasattr(client.indices, "exists_alias") and client.indices.exists_alias(name=alias):
            alias_map = client.indices.get_alias(name=alias, ignore=[404])
            if isinstance(alias_map, dict) and not alias_map.get("error"):
                current_indices = list(alias_map.keys())
        elif hasattr(client.indices, "get_alias"):
            alias_map = client.indices.get_alias(name=alias, ignore=[404])
            if isinstance(alias_map, dict) and not alias_map.get("error"):
                current_indices = list(alias_map.keys())
    except Exception:
        current_indices = []

    actions: list[dict[str, Any]] = []
    for old_idx in current_indices:
        assert_prefixed(old_idx)
        actions.append({"remove": {"index": old_idx, "alias": alias}})
    actions.append({"add": {"index": new_index, "alias": alias}})

    client.indices.update_aliases(body={"actions": actions})
    return current_indices


def load_kind(
    client: Any,
    kind: str,
    docs: list[dict[str, Any]],
    *,
    stamp: str,
    replicas: int,
    keep: int,
) -> dict[str, Any]:
    """Load documents into a versioned index and atomically swap alias."""
    alias = index_name(kind)
    assert_prefixed(alias)
    new_index = versioned_name(kind, stamp)
    assert_prefixed(new_index)

    # 1. Create index with 0 replicas and disabled refresh for fast ingestion
    assert_prefixed(new_index)
    client.indices.create(
        index=new_index,
        body={"settings": {"number_of_replicas": 0, "refresh_interval": "-1"}},
    )

    try:
        # 2. Bulk load documents
        ok, errors = bulk_index(client, new_index, docs, id_field="id", chunk=1000)

        # 3. Restore replicas and refresh_interval
        assert_prefixed(new_index)
        client.indices.put_settings(
            index=new_index,
            body={"index": {"number_of_replicas": replicas, "refresh_interval": "1s"}},
        )
        client.indices.refresh(index=new_index)

        # 4. Count validation
        cnt_res = client.count(index=new_index)
        count = cnt_res.get("count", 0) if isinstance(cnt_res, dict) else cnt_res

        if ok != len(docs) or count != len(docs):
            raise RuntimeError(
                f"Document count mismatch for '{kind}': expected {len(docs)}, bulk_ok={ok}, count={count}"
            )
    except Exception:
        # Delete new index and keep alias intact
        try:
            assert_prefixed(new_index)
            if client.indices.exists(index=new_index):
                client.indices.delete(index=new_index)
        except Exception:
            pass
        raise

    # 5. If a concrete index exists with the name of the alias, delete it
    if client.indices.exists(index=alias) and not client.indices.exists_alias(name=alias):
        assert_prefixed(alias)
        client.indices.delete(index=alias)

    # 6. Atomic swap alias
    removed_from = swap_alias(client, alias, new_index)

    # 7. Delete older versions keeping `keep` previous versions
    versions = physical_versions(client, kind)
    older_versions = [v for v in versions if v != new_index]
    deleted: list[str] = []
    if keep == 0:
        to_delete = older_versions
    elif keep > 0:
        if len(older_versions) > keep:
            to_delete = older_versions[:-keep]
        else:
            to_delete = []
    else:
        to_delete = []

    for old_idx in to_delete:
        assert_prefixed(old_idx)
        client.indices.delete(index=old_idx)
        deleted.append(old_idx)

    return {
        "kind": kind,
        "index": new_index,
        "docs": len(docs),
        "ok": ok,
        "errors": errors,
        "removed_from": removed_from,
        "deleted": deleted,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="ATALAYA OpenSearch Loader")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate documents and print counts without connecting to OpenSearch",
    )
    parser.add_argument(
        "--only",
        type=str,
        default="units,participation,catalog,profile",
        help="Comma-separated list of indices to load",
    )
    parser.add_argument(
        "--keep",
        type=int,
        default=1,
        help="Number of previous versions to keep besides the new one (default: 1)",
    )
    parser.add_argument(
        "--replicas",
        type=int,
        default=None,
        help="Number of index replicas (default: auto)",
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Purge all existing prefixed indices, aliases, and templates before loading",
    )
    args = parser.parse_args()

    if args.keep < 0:
        parser.error("--keep must be non-negative")
    if args.replicas is not None and args.replicas < 0:
        parser.error("--replicas must be non-negative")

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
        print("[dry-run] Validation complete. No OpenSearch changes made.")
        return

    # Real indexing: ping cluster first
    if not ping(timeout_s=5.0):
        print("OpenSearch cluster unreachable (ping failed)")
        sys.exit(2)

    client = get_client()
    if client is None:
        print("OpenSearch client could not be initialized")
        sys.exit(2)

    info = cluster_info(timeout_s=5.0)
    dist = info.get("distribution", "opensearch")
    ver = info.get("version", "unknown")
    nodes = info.get("nodes", 1)
    status = info.get("status", "unknown")
    print(f"OpenSearch Cluster: distribution={dist}, version={ver}, nodes={nodes}, status={status}")

    if args.reset:
        purged = purge_prefixed(client)
        print("Purged prefixed cluster resources:")
        print(f"  Aliases: {len(purged['aliases'])} ({', '.join(purged['aliases']) or 'none'})")
        print(f"  Indices: {len(purged['indices'])} ({', '.join(purged['indices']) or 'none'})")
        print(f"  Templates: {len(purged['templates'])} ({', '.join(purged['templates']) or 'none'})")

    ensure_index_templates(client)

    if args.replicas is not None:
        replicas = args.replicas
    else:
        replicas = auto_replicas(client)

    stamp = datetime.now().strftime("%Y%m%d%H%M%S")

    results: list[dict[str, Any]] = []
    has_failure = False

    for kind in targets:
        docs = all_docs.get(kind, [])
        idx_target = versioned_name(kind, stamp)
        try:
            res = load_kind(
                client,
                kind,
                docs,
                stamp=stamp,
                replicas=replicas,
                keep=args.keep,
            )
            results.append({
                "kind": kind,
                "index": res["index"],
                "docs": len(docs),
                "status": "OK",
            })
            print(f"Indexed {res['ok']}/{len(docs)} documents into {res['index']} (alias: {index_name(kind)})")
        except Exception as e:
            has_failure = True
            results.append({
                "kind": kind,
                "index": idx_target,
                "docs": len(docs),
                "status": f"FAILED: {e}",
            })
            print(f"Failed to load {kind}: {e}", file=sys.stderr)

    # Print summary table
    print("\nSummary:")
    print(f"{'Kind':<15} {'Index':<35} {'Docs':<10} {'Status'}")
    print("-" * 75)
    for r in results:
        print(f"{r['kind']:<15} {r['index']:<35} {r['docs']:<10} {r['status']}")

    if has_failure:
        sys.exit(1)


if __name__ == "__main__":
    main()
