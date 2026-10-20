"""CLI audit tool comparing PandasStore and OpenSearchStore parity."""

from __future__ import annotations

import sys
from typing import Any
import numpy as np

from atalaya.search_client import ping
from atalaya.store import OpenSearchStore, PandasStore, StoreError


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

    results: list[tuple[str, str, str]] = []
    all_ok = True

    def record(name: str, passed: bool, detail: str) -> None:
        nonlocal all_ok
        status = "OK" if passed else "FAIL"
        if not passed:
            all_ok = False
        results.append((name, status, detail))

    # Check 1: Units count by level
    try:
        p_mun = p_store.units(level="mun")
        os_mun = os_store.units(level="mun")
        p_st = p_store.units(level="state")
        os_st = os_store.units(level="state")

        mun_match = len(p_mun) == len(os_mun)
        st_match = len(p_st) == len(os_st)
        detail = f"mun: pandas={len(p_mun)}, os={len(os_mun)}; state: pandas={len(p_st)}, os={len(os_st)}"
        record("units count by level", mun_match and st_match, detail)
    except Exception as exc:
        record("units count by level", False, f"Exception: {type(exc).__name__}")

    # Check 2: unit("09015") key fields within 1e-6
    try:
        u_p = p_store.unit("09015")
        u_os = os_store.unit("09015")
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
            p_hits = p_store.search_units(q, size=5)
            os_hits = os_store.search_units(q, size=5)
            p_first = p_hits[0]["id"] if p_hits else None
            os_first = os_hits[0]["id"] if os_hits else None
            if p_first != os_first:
                mismatches.append(f"'{q}': pandas={p_first} os={os_first}")

        passed = len(mismatches) == 0
        detail = "all 3 matched first id" if passed else f"mismatches: {', '.join(mismatches)}"
        record("search_units first id", passed, detail)
    except Exception as exc:
        record("search_units first id", False, f"Exception: {type(exc).__name__}")

    # Check 4: top 3 metrics (same top-10 IDs)
    try:
        metrics_test = ["pred_abstention", "risk_score", "pob_tot"]
        top_mismatches = []
        for m in metrics_test:
            p_top = [str(x.get("id")) for x in p_store.top(m, limit=10)]
            os_top = [str(x.get("id")) for x in os_store.top(m, limit=10)]
            if p_top != os_top:
                top_mismatches.append(f"{m} top-10 differs")

        passed = len(top_mismatches) == 0
        detail = "all 3 metrics matched top-10 ids" if passed else "; ".join(top_mismatches)
        record("top 3 metrics", passed, detail)
    except Exception as exc:
        record("top 3 metrics", False, f"Exception: {type(exc).__name__}")

    # Check 5: aggregate mean (< 1e-3) and median (< 0.01) of pred_abstention by state
    try:
        p_agg_mean = {d["key"]: d["value"] for d in p_store.aggregate("pred_abstention", level="mun", group_by="cve_ent", stat="avg")}
        os_agg_mean = {d["key"]: d["value"] for d in os_store.aggregate("pred_abstention", level="mun", group_by="cve_ent", stat="avg")}
        p_agg_med = {d["key"]: d["value"] for d in p_store.aggregate("pred_abstention", level="mun", group_by="cve_ent", stat="median")}
        os_agg_med = {d["key"]: d["value"] for d in os_store.aggregate("pred_abstention", level="mun", group_by="cve_ent", stat="median")}

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
            p_corr = p_store.correlation(pair)
            os_corr = os_store.correlation(pair)
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
        p_prof = p_store.profile("09015")
        os_prof = os_store.profile("09015")
        prof_len_ok = len(p_prof) == len(os_prof)

        p_feat = p_store.ccpc_features("09015")
        os_feat = os_store.ccpc_features("09015")
        feat_match = (p_feat is None and os_feat is None) or (bool(p_feat) and bool(os_feat))

        passed = prof_len_ok and feat_match
        detail = f"profile len: pandas={len(p_prof)}, os={len(os_prof)}; features match={feat_match}"
        record("profile & ccpc_features 09015", passed, detail)
    except Exception as exc:
        record("profile & ccpc_features 09015", False, f"Exception: {type(exc).__name__}")

    # Print table
    col_w_check = 30
    col_w_status = 8
    print("-" * 80)
    print(f"{'CHECK'.ljust(col_w_check)} | {'STATUS'.ljust(col_w_status)} | DETALLE")
    print("-" * 80)
    for name, status, detail in results:
        print(f"{name.ljust(col_w_check)} | {status.ljust(col_w_status)} | {detail}")
    print("-" * 80)

    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(_run_parity_checks())
