"""CLI audit tool comparing PandasStore and OpenSearchStore parity."""

from __future__ import annotations

from pathlib import Path
import sys
from typing import Any
import numpy as np

# Ensure backend root is on sys.path
_BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from atalaya.search_client import ping
from atalaya.store import OpenSearchStore, PandasStore, StoreError


def run_checks(mem: PandasStore, osd: OpenSearchStore) -> list[tuple[str, bool, str]]:
    """Execute parity checks between memory and OpenSearch stores without printing.

    Returns a list of (check_name, passed, detail) tuples.
    """
    results: list[tuple[str, bool, str]] = []

    def record(name: str, passed: bool, detail: str) -> None:
        results.append((name, passed, detail))

    # Check 1: Units count by level
    try:
        p_mun = mem.units(level="mun")
        os_mun = osd.units(level="mun")
        p_st = mem.units(level="state")
        os_st = osd.units(level="state")

        mun_match = len(p_mun) == len(os_mun)
        st_match = len(p_st) == len(os_st)
        detail = f"mun: pandas={len(p_mun)}, os={len(os_mun)}; state: pandas={len(p_st)}, os={len(os_st)}"
        record("units count by level", mun_match and st_match, detail)
    except Exception as exc:
        record("units count by level", False, f"Exception: {type(exc).__name__}")

    # Check 2: unit("09015") key fields within 1e-6
    try:
        u_p = mem.unit("09015")
        u_os = osd.unit("09015")
        if not u_p or not u_os:
            record("unit('09015')", False, f"Not found (pandas={bool(u_p)}, os={bool(u_os)})")
        else:
            key_cols = [
                "pred_abstention", "pred_participation", "risk_score",
                "lista_nominal", "pob_tot", "graproes"
            ]
            max_diff = 0.0
            diff_fields = []
            for col in key_cols:
                vp = u_p.get(col)
                vos = u_os.get(col)
                if vp is None and vos is None:
                    continue
                if vp is None or vos is None:
                    diff_fields.append(f"{col} (None mismatch)")
                    continue
                try:
                    fp = float(vp)
                    fos = float(vos)
                    d = abs(fp - fos)
                    if d > max_diff:
                        max_diff = d
                    if d > 1e-6:
                        diff_fields.append(f"{col}: Δ={d:.2e}")
                except (ValueError, TypeError):
                    if str(vp) != str(vos):
                        diff_fields.append(f"{col}: '{vp}' != '{vos}'")

            passed = len(diff_fields) == 0
            detail = f"max diff={max_diff:.2e}" if passed else f"mismatches: {', '.join(diff_fields)}"
            record("unit('09015')", passed, detail)
    except Exception as exc:
        record("unit('09015')", False, f"Exception: {type(exc).__name__}")

    # Check 3: search_units first ID match
    try:
        queries = ["tijuana", "ciudad de mexico", "Juarez"]
        mismatches = []
        for q in queries:
            p_hits = mem.search_units(q, size=5)
            os_hits = osd.search_units(q, size=5)
            p_first = p_hits[0]["id"] if p_hits else None
            os_first = os_hits[0]["id"] if os_hits else None
            if p_first != os_first:
                mismatches.append(f"'{q}': pandas={p_first} os={os_first}")

        passed = len(mismatches) == 0
        detail = "all 3 matched first id" if passed else f"mismatches: {', '.join(mismatches)}"
        record("search_units first id", passed, detail)
    except Exception as exc:
        record("search_units first id", False, f"Exception: {type(exc).__name__}")

    # Check 4: top 3 metrics (same top-10 IDs and values |Δ| < 1e-4)
    try:
        metrics_test = ["pred_abstention", "risk_score", "pob_tot"]
        top_mismatches = []
        for m in metrics_test:
            p_items = mem.top(m, limit=10)
            os_items = osd.top(m, limit=10)
            p_top = [str(x.get("id")) for x in p_items]
            os_top = [str(x.get("id")) for x in os_items]
            if p_top != os_top:
                top_mismatches.append(f"{m} ids differ: {p_top} vs {os_top}")
                continue

            for idx, (p_item, os_item) in enumerate(zip(p_items, os_items)):
                vp = p_item.get("value") if p_item.get("value") is not None else p_item.get(m)
                vos = os_item.get("value") if os_item.get("value") is not None else os_item.get(m)
                if vp is None or vos is None:
                    if vp != vos:
                        top_mismatches.append(f"{m} item {idx} ({p_top[idx]}) None mismatch")
                    continue
                try:
                    diff = abs(float(vp) - float(vos))
                    if diff >= 1e-4:
                        top_mismatches.append(f"{m} item {idx} ({p_top[idx]}) Δ={diff:.2e}")
                except (ValueError, TypeError):
                    if str(vp) != str(vos):
                        top_mismatches.append(f"{m} item {idx} ({p_top[idx]}) '{vp}' != '{vos}'")

        passed = len(top_mismatches) == 0
        detail = "all 3 metrics matched top-10 ids and values (|Δ| < 1e-4)" if passed else "; ".join(top_mismatches)
        record("top 3 metrics", passed, detail)
    except Exception as exc:
        record("top 3 metrics", False, f"Exception: {type(exc).__name__}")

    # Check 5: aggregate mean (< 1e-3) and median (< 0.01) of pred_abstention by state
    try:
        p_agg_mean = {d["key"]: d["value"] for d in mem.aggregate("pred_abstention", level="mun", group_by="cve_ent", stat="avg")}
        os_agg_mean = {d["key"]: d["value"] for d in osd.aggregate("pred_abstention", level="mun", group_by="cve_ent", stat="avg")}
        p_agg_med = {d["key"]: d["value"] for d in mem.aggregate("pred_abstention", level="mun", group_by="cve_ent", stat="median")}
        os_agg_med = {d["key"]: d["value"] for d in osd.aggregate("pred_abstention", level="mun", group_by="cve_ent", stat="median")}

        max_mean_diff = 0.0
        max_med_diff = 0.0
        for k in p_agg_mean:
            if k in os_agg_mean and p_agg_mean[k] is not None and os_agg_mean[k] is not None:
                max_mean_diff = max(max_mean_diff, abs(float(p_agg_mean[k]) - float(os_agg_mean[k])))
        for k in p_agg_med:
            if k in os_agg_med and p_agg_med[k] is not None and os_agg_med[k] is not None:
                max_med_diff = max(max_med_diff, abs(float(p_agg_med[k]) - float(os_agg_med[k])))

        passed = (max_mean_diff < 1e-3) and (max_med_diff < 0.01)
        detail = f"mean max diff={max_mean_diff:.2e} (<1e-3), med max diff={max_med_diff:.2e} (<0.01)"
        record("aggregate mean/med by state", passed, detail)
    except Exception as exc:
        record("aggregate mean/med by state", False, f"Exception: {type(exc).__name__}")

    # Check 6: correlation of 2 pairs (|Δr| < 1e-3)
    try:
        pairs = [["pob_tot", "pob_18ymas"], ["pred_abstention", "graproes"]]
        corr_mismatches = []
        for pair in pairs:
            f1, f2 = pair
            p_corr = mem.correlation(pair)
            os_corr = osd.correlation(pair)
            rp = p_corr.get("matrix", {}).get(f1, {}).get(f2)
            ros = os_corr.get("matrix", {}).get(f1, {}).get(f2)
            if rp is not None and ros is not None:
                diff = abs(float(rp) - float(ros))
                if diff >= 1e-3:
                    corr_mismatches.append(f"{pair}: Δr={diff:.2e}")
            elif rp != ros:
                corr_mismatches.append(f"{pair}: None mismatch")

        passed = len(corr_mismatches) == 0
        detail = "all pairs within |Δr| < 1e-3" if passed else "; ".join(corr_mismatches)
        record("correlation 2 pairs", passed, detail)
    except Exception as exc:
        record("correlation 2 pairs", False, f"Exception: {type(exc).__name__}")

    # Check 7: profile and ccpc_features of a municipality (09015)
    try:
        p_prof = mem.profile("09015")
        os_prof = osd.profile("09015")
        prof_len_ok = len(p_prof) == len(os_prof)

        p_feat = mem.ccpc_features("09015")
        os_feat = osd.ccpc_features("09015")
        feat_match = (p_feat is None and os_feat is None) or (bool(p_feat) and bool(os_feat))

        passed = prof_len_ok and feat_match
        detail = f"profile len: pandas={len(p_prof)}, os={len(os_prof)}; features match={feat_match}"
        record("profile & ccpc_features 09015", passed, detail)
    except Exception as exc:
        record("profile & ccpc_features 09015", False, f"Exception: {type(exc).__name__}")

    return results


def _run_parity_checks() -> int:
    # 1. Connection check
    try:
        if not ping(timeout_s=5.0):
            print("ERROR: Cannot connect to OpenSearch cluster (ping returned False).", file=sys.stderr)
            return 2
    except Exception as exc:
        print(f"ERROR: Cannot connect to OpenSearch cluster: {type(exc).__name__}", file=sys.stderr)
        return 2

    # 2. Instantiate both stores
    try:
        p_store = PandasStore()
        os_store = OpenSearchStore()
    except Exception as exc:
        print(f"ERROR initializing stores: {type(exc).__name__}", file=sys.stderr)
        return 2

    results = run_checks(p_store, os_store)
    all_ok = all(passed for _, passed, _ in results)

    # Print table
    col_w_check = 30
    col_w_status = 8
    print("-" * 80)
    print(f"{'CHECK'.ljust(col_w_check)} | {'STATUS'.ljust(col_w_status)} | DETALLE")
    print("-" * 80)
    for name, passed, detail in results:
        status = "OK" if passed else "FAIL"
        print(f"{name.ljust(col_w_check)} | {status.ljust(col_w_status)} | {detail}")
    print("-" * 80)

    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(_run_parity_checks())
