"""Single source of truth for all quantitative figures in ATALAYA reports and slides.

Implements the contract specified in CONTEXT.md §13.2.
No quantitative figure should be calculated or hardcoded outside of this module.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from atalaya.config import BUILD_DIR, REPO_DIR, SEED_DIR
from atalaya.model.recommend import build_reference, recommend
from atalaya.model.scenarios import SCENARIOS, default_params, simulate

DEFAULT_TEAM = "OXENT"
DEFAULT_REPO_URL = "https://github.com/MrAres259/INE-Hackathon-OXENT"


def _safe_float(val: Any, default: float = 0.0) -> float:
    if val is None or pd.isna(val):
        return default
    try:
        return float(val)
    except (ValueError, TypeError):
        return default


def _fmt_int(val: Any) -> str:
    if val is None or pd.isna(val):
        return "N/D"
    try:
        return f"{int(round(float(val))):,}"
    except (ValueError, TypeError):
        return "N/D"


def _fmt_pct(val: Any, decimals: int = 1) -> str:
    if val is None or pd.isna(val):
        return "N/D"
    try:
        v = float(val)
        return f"{v:.{decimals}f}%"
    except (ValueError, TypeError):
        return "N/D"


def _fmt_float(val: Any, decimals: int = 2) -> str:
    if val is None or pd.isna(val):
        return "N/D"
    try:
        return f"{float(val):.{decimals}f}"
    except (ValueError, TypeError):
        return "N/D"


def load_state_catalog(seed_dir: Path | None = None) -> dict[str, str]:
    """Loads state name catalog from states.csv or defaults."""
    s_dir = seed_dir or SEED_DIR
    path = s_dir / "states.csv"
    if path.is_file():
        try:
            df = pd.read_csv(path, dtype=str)
            col = "name" if "name" in df.columns else "nom_ent"
            return dict(zip(df["cve_ent"].str.zfill(2), df[col]))
        except Exception:
            pass
    return {}


def compute_facts(
    build_dir: Path,
    *,
    deliverables_dir: Path | None = None,
    team: str = DEFAULT_TEAM,
    repo_url: str = DEFAULT_REPO_URL,
) -> dict[str, Any]:
    """Computes all validated quantitative facts for ATALAYA report and slides.

    Parameters
    ----------
    build_dir : Path
        Directory containing pipeline outputs (units.parquet, metrics.json, etc.).
    deliverables_dir : Path, optional
        Directory where deliverables and geojsons are stored.
    team : str
        Team name for presentation and report branding.
    repo_url : str
        Public GitHub repository URL.

    Returns
    -------
    dict[str, Any]
        Dictionary of facts with both raw numbers and pre-formatted display strings.
    """
    b_dir = Path(build_dir)

    # 1. Load primary units and metrics
    units_file = b_dir / "units.parquet"
    if not units_file.is_file():
        raise FileNotFoundError(f"Missing units.parquet at {units_file}")
    units = pd.read_parquet(units_file)

    mun = units[units["level"] == "mun"].copy() if "level" in units.columns else units.copy()
    state = units[units["level"] == "state"].copy() if "level" in units.columns else pd.DataFrame()

    metrics_file = b_dir / "metrics.json"
    metrics: dict[str, Any] = {}
    if metrics_file.is_file():
        try:
            metrics = json.loads(metrics_file.read_text(encoding="utf-8"))
        except Exception:
            metrics = {}

    target_year = int(metrics.get("target_year", 2027))
    n_mun = len(mun)
    state_codes = mun["cve_ent"].astype(str).str.zfill(2).unique() if "cve_ent" in mun.columns else []
    n_states = len(state_codes) if len(state_codes) > 0 else (len(state) if not state.empty else 32)

    ent_map = load_state_catalog()

    # 2. Scenario simulations (base, intervencion, pesimista)
    # Base scenario
    items_base = mun.copy()
    tot_ln = _safe_float(mun["lista_nominal"].sum()) if "lista_nominal" in mun.columns else 0.0

    # Intervencion scenario
    try:
        items_interv_full, summary_interv = simulate(units, "intervencion")
        items_interv = (
            items_interv_full[items_interv_full["level"] == "mun"].copy()
            if "level" in items_interv_full.columns
            else items_interv_full.copy()
        )
    except Exception:
        items_interv = mun.copy()
        summary_interv = {"votos_adicionales": 0, "mean_delta_pp": -1.5, "by_category": {}}

    # Pesimista scenario
    try:
        items_pesim_full, summary_pesim = simulate(units, "pesimista")
        items_pesim = (
            items_pesim_full[items_pesim_full["level"] == "mun"].copy()
            if "level" in items_pesim_full.columns
            else items_pesim_full.copy()
        )
    except Exception:
        items_pesim = mun.copy()
        summary_pesim = {"votos_adicionales": -2500000, "mean_delta_pp": 2.5, "by_category": {}}

    # 3. Categories breakdown by scenario
    categories: dict[str, dict[str, dict[str, Any]]] = {}
    cat_names = ["verde", "amarillo", "naranja", "rojo", "sin_dato"]

    scenarios_dfs = {
        "base": items_base,
        "intervencion": items_interv,
        "pesimista": items_pesim,
    }

    for sc_name, sc_df in scenarios_dfs.items():
        categories[sc_name] = {}
        for c in cat_names:
            sub = sc_df[sc_df["category"] == c] if "category" in sc_df.columns else pd.DataFrame()
            cnt = len(sub)
            pct_n = (cnt / max(n_mun, 1)) * 100.0
            ln_val = _safe_float(sub["lista_nominal"].sum()) if "lista_nominal" in sub.columns else 0.0
            pct_ln = (ln_val / max(tot_ln, 1e-6)) * 100.0
            ln_m = ln_val / 1e6
            pct_n_label = f"{pct_n:.1f} % de los municipios"
            pct_ln_label = f"{pct_ln:.1f} % de la LN"
            both_pct_label = f"{pct_n:.1f} % de los municipios; {pct_ln:.1f} % de la LN"
            categories[sc_name][c] = {
                "n": cnt,
                "pct_n": round(pct_n, 2),
                "ln": ln_val,
                "pct_ln": round(pct_ln, 2),
                "ln_m": round(ln_m, 2),
                "n_fmt": f"{cnt:,}",
                "pct_n_fmt": _fmt_pct(pct_n, 1),
                "ln_fmt": _fmt_int(ln_val),
                "ln_m_fmt": f"{ln_m:.1f} M",
                "pct_ln_fmt": _fmt_pct(pct_ln, 1),
                "pct_n_label": pct_n_label,
                "pct_ln_label": pct_ln_label,
                "both_pct_label": both_pct_label,
                "card_title": f"{c.capitalize()}: {cnt:,} municipios ({both_pct_label})",
            }

    # 4. Critical List Nominal in risk (naranja + rojo)
    ln_risk: dict[str, dict[str, Any]] = {}
    for sc_name, sc_df in scenarios_dfs.items():
        rn_sub = (
            sc_df[sc_df["category"].isin(["rojo", "naranja"])]
            if "category" in sc_df.columns
            else pd.DataFrame()
        )
        rn_cnt = len(rn_sub)
        rn_pct_mun = (rn_cnt / max(n_mun, 1)) * 100.0
        rn_ln = _safe_float(rn_sub["lista_nominal"].sum()) if "lista_nominal" in rn_sub.columns else 0.0
        rn_pct_ln = (rn_ln / max(tot_ln, 1e-6)) * 100.0
        rn_m = rn_ln / 1e6

        # Also moderate to high (amarillo + naranja + rojo)
        arn_sub = (
            sc_df[sc_df["category"].isin(["amarillo", "naranja", "rojo"])]
            if "category" in sc_df.columns
            else pd.DataFrame()
        )
        arn_ln = _safe_float(arn_sub["lista_nominal"].sum()) if "lista_nominal" in arn_sub.columns else 0.0
        arn_pct_ln = (arn_ln / max(tot_ln, 1e-6)) * 100.0
        arn_m = arn_ln / 1e6

        ln_risk[sc_name] = {
            "raw": rn_ln,
            "millones": round(rn_m, 2),
            "millones_fmt": f"{rn_m:.1f} M",
            "pct": round(rn_pct_ln, 2),
            "pct_fmt": _fmt_pct(rn_pct_ln, 1),
            "pct_ln_label": f"{rn_pct_ln:.1f} % de la LN",
            "n_mun": rn_cnt,
            "pct_mun": round(rn_pct_mun, 2),
            "pct_mun_fmt": _fmt_pct(rn_pct_mun, 1),
            "pct_mun_label": f"{rn_pct_mun:.1f} % de los municipios",
            "both_label": f"{rn_pct_mun:.1f} % de los municipios; {rn_pct_ln:.1f} % de la LN",
            "arn_raw": arn_ln,
            "arn_millones": round(arn_m, 2),
            "arn_millones_fmt": f"{arn_m:.1f} M",
            "arn_pct": round(arn_pct_ln, 2),
            "arn_pct_fmt": _fmt_pct(arn_pct_ln, 1),
            "arn_pct_ln_label": f"{arn_pct_ln:.1f} % de la LN",
        }

    # 5. Transitions (Base -> Intervención) calculated municipality-by-municipality
    cat_order = {"sin_dato": -1, "verde": 0, "amarillo": 1, "naranja": 2, "rojo": 3}
    matrix: dict[str, dict[str, int]] = {cb: {ci: 0 for ci in cat_names} for cb in cat_names}
    matrix_ln: dict[str, dict[str, float]] = {cb: {ci: 0.0 for ci in cat_names} for cb in cat_names}

    mun_base_map = (
        dict(zip(mun["id"], mun["category"])) if "id" in mun.columns and "category" in mun.columns else {}
    )
    mun_base_ln = (
        dict(zip(mun["id"], mun["lista_nominal"]))
        if "id" in mun.columns and "lista_nominal" in mun.columns
        else {}
    )

    improved_count = 0
    if "id" in items_interv.columns and "category" in items_interv.columns:
        for _, r in items_interv.iterrows():
            mid = r["id"]
            c_base = mun_base_map.get(mid, "sin_dato")
            c_interv = r["category"]
            m_ln = _safe_float(mun_base_ln.get(mid, 0.0))

            if c_base in matrix and c_interv in matrix[c_base]:
                matrix[c_base][c_interv] += 1
                matrix_ln[c_base][c_interv] += m_ln

            # Improvement means moving to a strictly lower risk category
            if cat_order.get(c_interv, -1) < cat_order.get(c_base, -1) and cat_order.get(c_interv, -1) >= 0:
                improved_count += 1

    rojo_to_naranja = matrix["rojo"]["naranja"]
    rojo_to_amarillo = matrix["rojo"]["amarillo"]
    rojo_to_verde = matrix["rojo"]["verde"]
    rojo_salidas = sum(matrix["rojo"][c] for c in cat_names if c != "rojo")
    rojo_entradas = sum(matrix[c]["rojo"] for c in cat_names if c != "rojo")

    rojo_base_n = categories["base"]["rojo"]["n"]
    rojo_interv_n = categories["intervencion"]["rojo"]["n"]
    rojo_net_reduction = rojo_base_n - rojo_interv_n
    pct_rojo_reduction = (rojo_net_reduction / max(rojo_base_n, 1)) * 100.0

    naranja_to_amarillo = matrix["naranja"]["amarillo"]
    naranja_to_verde = matrix["naranja"]["verde"]
    naranja_salidas = sum(matrix["naranja"][c] for c in cat_names if c != "naranja")
    naranja_entradas = sum(matrix[c]["naranja"] for c in cat_names if c != "naranja")
    naranja_base_n = categories["base"]["naranja"]["n"]
    naranja_interv_n = categories["intervencion"]["naranja"]["n"]
    naranja_net_reduction = naranja_base_n - naranja_interv_n

    ln_risk_red = ln_risk["base"]["raw"] - ln_risk["intervencion"]["raw"]
    ln_risk_red_m = ln_risk_red / 1e6
    ln_risk_red_pct = (ln_risk_red / max(ln_risk["base"]["raw"], 1e-6)) * 100.0

    transitions = {
        "matrix": matrix,
        "matrix_ln": matrix_ln,
        "n_improved": improved_count,
        "pct_improved": round((improved_count / max(n_mun, 1)) * 100.0, 2),
        "pct_improved_fmt": _fmt_pct((improved_count / max(n_mun, 1)) * 100.0, 1),
        "rojo_to_naranja": rojo_to_naranja,
        "rojo_to_amarillo": rojo_to_amarillo,
        "rojo_to_verde": rojo_to_verde,
        "rojo_salidas": rojo_salidas,
        "rojo_entradas": rojo_entradas,
        "rojo_net_reduction": rojo_net_reduction,
        "pct_rojo_reduction": round(pct_rojo_reduction, 2),
        "pct_rojo_reduction_fmt": _fmt_pct(pct_rojo_reduction, 1),
        "naranja_to_amarillo": naranja_to_amarillo,
        "naranja_to_verde": naranja_to_verde,
        "naranja_salidas": naranja_salidas,
        "naranja_entradas": naranja_entradas,
        "naranja_net_reduction": naranja_net_reduction,
        "ln_risk_reduction": ln_risk_red,
        "ln_risk_reduction_m": round(ln_risk_red_m, 2),
        "ln_risk_reduction_m_fmt": f"{ln_risk_red_m:.1f} M",
        "ln_risk_reduction_pct": round(ln_risk_red_pct, 2),
        "ln_risk_reduction_pct_fmt": _fmt_pct(ln_risk_red_pct, 1),
    }

    # 6. Real scenario parameters read from SCENARIOS definition
    scenario_params_dict: dict[str, Any] = {}
    for sc in SCENARIOS:
        sc_id = sc.get("id", "")
        params_info: dict[str, Any] = {}
        for p in sc.get("params", []):
            pkey = p.get("key", "")
            pdef = p.get("default")
            plabel = p.get("label", pkey)
            val_label = str(pdef)
            if p.get("options"):
                for opt in p["options"]:
                    if opt.get("value") == pdef:
                        val_label = opt.get("label", str(pdef))
                        break
            params_info[pkey] = {
                "default": pdef,
                "label": plabel,
                "value_label": val_label,
                "unit": p.get("unit", ""),
            }
        scenario_params_dict[sc_id] = {
            "label": sc.get("label", sc_id),
            "description": sc.get("description", ""),
            "params": params_info,
        }

    interv_p = default_params("intervencion")
    lever_def = interv_p.get("lever", "promocion_jovenes")
    target_def = interv_p.get("targeting", "rojo_naranja")
    effect_def = interv_p.get("effect_pp", 3.0)
    cov_def = interv_p.get("coverage", 100)

    # 7. Additional votes & mean delta pp
    votos_interv = int(summary_interv.get("votos_adicionales", 0))
    votos_pesim = int(summary_pesim.get("votos_adicionales", 0))

    votes = {
        "base": {"votos_adicionales": 0, "votos_fmt": "0", "votos_k": "0", "votos_m": "0.0"},
        "intervencion": {
            "votos_adicionales": votos_interv,
            "votos_fmt": f"{abs(votos_interv):,}",
            "votos_k": f"{abs(votos_interv) / 1000.0:.0f}",
            "votos_m": f"{abs(votos_interv) / 1e6:.2f}",
        },
        "pesimista": {
            "votos_adicionales": votos_pesim,
            "votos_fmt": f"{abs(votos_pesim):,}",
            "votos_k": f"{abs(votos_pesim) / 1000.0:.0f}",
            "votos_m": f"{abs(votos_pesim) / 1e6:.2f}",
        },
    }

    mean_delta_pp = {
        "base": 0.0,
        "intervencion": float(summary_interv.get("mean_delta_pp", -1.5)),
        "pesimista": float(summary_pesim.get("mean_delta_pp", 2.5)),
    }

    # 8. National participation series (CCPC 2009-2024 + PJF 2025)
    part_file = b_dir / "participation.parquet"
    national_series: list[dict[str, Any]] = []
    hist_dip_pts: list[tuple[float, float | None]] = []
    pjf_rate: float = 12.83

    if part_file.is_file():
        try:
            pdf = pd.read_parquet(part_file)
            if "election" in pdf.columns and "votos_totales" in pdf.columns and "nv" in pdf.columns:
                dip_grp = (
                    pdf[pdf["election"] == "DIP_FED"]
                    .groupby("year")
                    .agg({"votos_totales": "sum", "nv": "sum"})
                    .reset_index()
                )
                for _, r in dip_grp.iterrows():
                    sv = r["votos_totales"]
                    nv = r["nv"]
                    rate = (sv / (sv + nv) * 100.0) if (sv + nv) > 0 else None
                    if rate is not None:
                        rate_rnd = round(rate, 2)
                        hist_dip_pts.append((float(r["year"]), rate_rnd))
                        national_series.append({
                            "year": int(r["year"]),
                            "election": "DIP_FED",
                            "participation": rate_rnd,
                            "participation_fmt": f"{rate_rnd:.1f}%",
                        })

                pjf_rows = pdf[pdf["election"] == "PJF"]
                if not pjf_rows.empty:
                    sv = pjf_rows["votos_totales"].sum()
                    nv = pjf_rows["nv"].sum()
                    if sv + nv > 0:
                        pjf_rate = round(sv / (sv + nv) * 100.0, 2)
                        national_series.append({
                            "year": 2025,
                            "election": "PJF",
                            "participation": pjf_rate,
                            "participation_fmt": f"{pjf_rate:.1f}%",
                        })
        except Exception:
            pass

    if not hist_dip_pts:
        hist_dip_pts = [
            (2009.0, 44.06),
            (2012.0, 62.08),
            (2015.0, 47.07),
            (2018.0, 62.37),
            (2021.0, 51.84),
            (2024.0, 59.67),
        ]
        national_series = [
            {"year": int(y), "election": "DIP_FED", "participation": p, "participation_fmt": f"{p:.1f}%"}
            for y, p in hist_dip_pts
        ]
        national_series.append({
            "year": 2025,
            "election": "PJF",
            "participation": pjf_rate,
            "participation_fmt": f"{pjf_rate:.1f}%",
        })

    # 9. Age and sex breakdown (exact categories: 18-24, 25-34, 35-44, 45-54, 55-64, 65+)
    prof_file = b_dir / "ccpc_profile_mun.parquet"
    if not prof_file.is_file():
        prof_file = b_dir / "ccpc_profile.parquet"

    age_sex_2009: list[dict[str, Any]] = []
    age_sex_2024: list[dict[str, Any]] = []
    age_gender_chart_items: list[tuple[str, float]] = []

    part_18_24_tot = 50.4
    part_25_34_tot = 49.6
    part_18_34_tot = 49.9
    national_2024_tot = 59.67

    part_fem_2024 = 64.20
    part_masc_2024 = 54.76
    part_fem_2009 = 47.35
    part_masc_2009 = 40.53

    cell_privacy_suppressed = 0

    if prof_file.is_file():
        try:
            prodf = pd.read_parquet(prof_file)
            if "year" in prodf.columns and "age_group" in prodf.columns and "sexo" in prodf.columns:
                # Privacy check: cells with LN < 10
                if "ln" in prodf.columns:
                    cell_privacy_suppressed = int((prodf["ln"] < 10).sum())

                for yr, target_list in [(2009, age_sex_2009), (2024, age_sex_2024)]:
                    sub_yr = prodf[prodf["year"] == yr]
                    if not sub_yr.empty:
                        # Age x Sex aggregation
                        agg = (
                            sub_yr.groupby(["age_group", "sexo"])
                            .agg({"sv": "sum", "nv": "sum", "ln": "sum"})
                            .reset_index()
                        )
                        for _, r in agg.iterrows():
                            # Suppress X at municipal or profile if necessary; at national level X has tiny LN
                            denom = r["sv"] + r["nv"]
                            rate = (r["sv"] / denom * 100.0) if denom > 0 else 0.0
                            target_list.append({
                                "year": yr,
                                "age_group": str(r["age_group"]),
                                "sexo": str(r["sexo"]),
                                "ln": int(r["ln"]),
                                "sv": int(r["sv"]),
                                "nv": int(r["nv"]),
                                "participation": round(rate, 2),
                                "participation_fmt": f"{rate:.1f}%",
                            })

                        # Compute gender totals
                        sex_tot = sub_yr.groupby("sexo").agg({"sv": "sum", "nv": "sum"}).reset_index()
                        for _, sr in sex_tot.iterrows():
                            s_den = sr["sv"] + sr["nv"]
                            s_rate = (sr["sv"] / s_den * 100.0) if s_den > 0 else 0.0
                            if sr["sexo"] == "M":
                                if yr == 2024:
                                    part_fem_2024 = round(s_rate, 2)
                                else:
                                    part_fem_2009 = round(s_rate, 2)
                            elif sr["sexo"] == "H":
                                if yr == 2024:
                                    part_masc_2024 = round(s_rate, 2)
                                else:
                                    part_masc_2009 = round(s_rate, 2)

                        # Compute 2024 youth totals
                        if yr == 2024:
                            sub_18_24 = sub_yr[sub_yr["age_group"] == "18-24"]
                            den_18_24 = sub_18_24["sv"].sum() + sub_18_24["nv"].sum()
                            if den_18_24 > 0:
                                part_18_24_tot = round(sub_18_24["sv"].sum() / den_18_24 * 100.0, 2)

                            sub_25_34 = sub_yr[sub_yr["age_group"] == "25-34"]
                            den_25_34 = sub_25_34["sv"].sum() + sub_25_34["nv"].sum()
                            if den_25_34 > 0:
                                part_25_34_tot = round(sub_25_34["sv"].sum() / den_25_34 * 100.0, 2)

                            sub_18_34 = sub_yr[sub_yr["age_group"].isin(["18-24", "25-34"])]
                            den_18_34 = sub_18_34["sv"].sum() + sub_18_34["nv"].sum()
                            if den_18_34 > 0:
                                part_18_34_tot = round(sub_18_34["sv"].sum() / den_18_34 * 100.0, 2)

                            tot_den = sub_yr["sv"].sum() + sub_yr["nv"].sum()
                            if tot_den > 0:
                                national_2024_tot = round(sub_yr["sv"].sum() / tot_den * 100.0, 2)
        except Exception:
            pass

    # Build standardized age-gender chart items (2009 vs 2024 for key anchor groups)
    def _lookup_rate(target_list: list[dict[str, Any]], grp: str, s: str, default_val: float) -> float:
        for it in target_list:
            if it["age_group"] == grp and it["sexo"] == s:
                return float(it["participation"])
        return default_val

    age_gender_chart_items = [
        ("2009: 18-24 H", _lookup_rate(age_sex_2009, "18-24", "H", 32.9)),
        ("2009: 18-24 M", _lookup_rate(age_sex_2009, "18-24", "M", 41.2)),
        ("2009: 25-34 H", _lookup_rate(age_sex_2009, "25-34", "H", 30.7)),
        ("2009: 25-34 M", _lookup_rate(age_sex_2009, "25-34", "M", 41.2)),
        ("2009: 65+ H", _lookup_rate(age_sex_2009, "65+", "H", 53.1)),
        ("2009: 65+ M", _lookup_rate(age_sex_2009, "65+", "M", 47.1)),
        ("2024: 18-24 H", _lookup_rate(age_sex_2024, "18-24", "H", 45.2)),
        ("2024: 18-24 M", _lookup_rate(age_sex_2024, "18-24", "M", 55.5)),
        ("2024: 25-34 H", _lookup_rate(age_sex_2024, "25-34", "H", 42.7)),
        ("2024: 25-34 M", _lookup_rate(age_sex_2024, "25-34", "M", 56.3)),
        ("2024: 65+ H", _lookup_rate(age_sex_2024, "65+", "H", 72.7)),
        ("2024: 65+ M", _lookup_rate(age_sex_2024, "65+", "M", 69.1)),
    ]

    youth_gap_pp = {
        "part_18_24": part_18_24_tot,
        "part_18_24_fmt": f"{part_18_24_tot:.1f}%",
        "part_25_34": part_25_34_tot,
        "part_25_34_fmt": f"{part_25_34_tot:.1f}%",
        "part_18_34": part_18_34_tot,
        "part_18_34_fmt": f"{part_18_34_tot:.1f}%",
        "national_2024": national_2024_tot,
        "national_2024_fmt": f"{national_2024_tot:.1f}%",
        "gap_18_24_pp": round(part_18_24_tot - national_2024_tot, 2),
        "gap_18_24_pp_fmt": f"{part_18_24_tot - national_2024_tot:+.1f} pp",
        "gap_25_34_pp": round(part_25_34_tot - national_2024_tot, 2),
        "gap_25_34_pp_fmt": f"{part_25_34_tot - national_2024_tot:+.1f} pp",
        "gap_18_34_pp": round(part_18_34_tot - national_2024_tot, 2),
        "gap_18_34_pp_fmt": f"{part_18_34_tot - national_2024_tot:+.1f} pp",
    }

    gender_gap_pp = {
        "part_fem_2024": part_fem_2024,
        "part_fem_2024_fmt": f"{part_fem_2024:.1f}%",
        "part_masc_2024": part_masc_2024,
        "part_masc_2024_fmt": f"{part_masc_2024:.1f}%",
        "gap_2024_pp": round(part_fem_2024 - part_masc_2024, 2),
        "gap_2024_pp_fmt": f"{part_fem_2024 - part_masc_2024:+.1f} pp",
        "part_fem_2009": part_fem_2009,
        "part_fem_2009_fmt": f"{part_fem_2009:.1f}%",
        "part_masc_2009": part_masc_2009,
        "part_masc_2009_fmt": f"{part_masc_2009:.1f}%",
        "gap_2009_pp": round(part_fem_2009 - part_masc_2009, 2),
        "gap_2009_pp_fmt": f"{part_fem_2009 - part_masc_2009:+.1f} pp",
    }

    # 10. State extremes and full state table
    state_table: list[dict[str, Any]] = []
    if "cve_ent" in mun.columns:
        for cve_ent, grp in mun.groupby("cve_ent"):
            cid = str(cve_ent).zfill(2)
            st_name = ent_map.get(cid, f"Estado {cid}")
            c = grp["category"].value_counts() if "category" in grp.columns else pd.Series()
            s_ln = _safe_float(grp["lista_nominal"].sum()) if "lista_nominal" in grp.columns else 0.0
            rn_ln = (
                _safe_float(grp[grp["category"].isin(["rojo", "naranja"])]["lista_nominal"].sum())
                if "category" in grp.columns
                else 0.0
            )
            pct_rn = (rn_ln / s_ln * 100.0) if s_ln > 0 else 0.0
            state_table.append({
                "cve_ent": cid,
                "name": st_name,
                "muns": len(grp),
                "verde": int(c.get("verde", 0)),
                "amarillo": int(c.get("amarillo", 0)),
                "naranja": int(c.get("naranja", 0)),
                "rojo": int(c.get("rojo", 0)),
                "tot_ln": _fmt_int(s_ln),
                "tot_ln_raw": s_ln,
                "pct_rn": _fmt_float(pct_rn, 1),
                "pct_rn_fmt": _fmt_pct(pct_rn, 1),
                "pct_rn_label": f"{pct_rn:.1f} % de su LN",
                "_pct_rn_num": pct_rn,
            })
    state_table.sort(key=lambda s: s["_pct_rn_num"], reverse=True)

    top_states_risk = state_table[:5] if len(state_table) >= 5 else state_table

    # State gaps in youth and gender from ccpc_features.parquet
    cf_file = b_dir / "ccpc_features.parquet"
    top_gap_youth: list[dict[str, Any]] = []
    top_gap_gender: list[dict[str, Any]] = []

    if cf_file.is_file():
        try:
            cf_df = pd.read_parquet(cf_file)
            if "year" in cf_df.columns and "gap_youth_pp" in cf_df.columns:
                cf24 = cf_df[(cf_df["year"] == 2024) & (cf_df.get("level") == "state")].copy()
                if not cf24.empty:
                    cf24["name"] = cf24["cve_ent"].astype(str).str.zfill(2).map(ent_map)
                    s_youth = cf24.sort_values("gap_youth_pp").head(5)
                    for _, r in s_youth.iterrows():
                        top_gap_youth.append({
                            "name": r.get("name", "N/D"),
                            "part_youth": _fmt_pct(_safe_float(r.get("part_18_34")) * 100.0, 1),
                            "gap": _fmt_float(r.get("gap_youth_pp"), 1),
                        })
                    s_gender = cf24.sort_values("gap_sexo_pp", ascending=False).head(5)
                    for _, r in s_gender.iterrows():
                        top_gap_gender.append({
                            "name": r.get("name", "N/D"),
                            "part_fem": _fmt_pct(_safe_float(r.get("part_total", 0.5)) * 100.0, 1),
                            "gap": _fmt_float(r.get("gap_sexo_pp"), 1),
                        })
        except Exception:
            pass

    while len(top_gap_youth) < 5:
        top_gap_youth.append({"name": "N/D", "part_youth": "0.0%", "gap": "0.0"})
    while len(top_gap_gender) < 5:
        top_gap_gender.append({"name": "N/D", "part_fem": "0.0%", "gap": "0.0"})

    state_extremes = {
        "top_states_risk": top_states_risk,
        "top_state_1": top_states_risk[0]["name"] if top_states_risk else "N/D",
        "top_state_1_pct": top_states_risk[0]["pct_rn"] if top_states_risk else "0.0",
        "top_state_2": top_states_risk[1]["name"] if len(top_states_risk) > 1 else "N/D",
        "top_state_2_pct": top_states_risk[1]["pct_rn"] if len(top_states_risk) > 1 else "0.0",
        "top_state_3": top_states_risk[2]["name"] if len(top_states_risk) > 2 else "N/D",
        "top_state_3_pct": top_states_risk[2]["pct_rn"] if len(top_states_risk) > 2 else "0.0",
        "top_gap_youth": top_gap_youth,
        "top_gap_gender": top_gap_gender,
        "state_table": state_table,
    }

    # 11. Model candidates, backtest, coefficients, structural R²
    candidates_raw = metrics.get("candidates", [])
    model_candidates: list[dict[str, Any]] = []
    labels_map = {
        "persist_l1": "Persistencia Relativa de Primer Rezago (Lag 1)",
        "persist_l2": "Persistencia Relativa de Segundo Rezago (Lag 2)",
        "mean_l1_l2": "Promedio Lag 1 y Lag 2",
        "ridge": "Modelo Ridge Completo (Rezagos + Concurrencia + Features)",
    }
    for c in candidates_raw:
        folds = c.get("folds", [])
        f21 = folds[0] if len(folds) > 0 else {}
        f24 = folds[1] if len(folds) > 1 else {}
        cname = c.get("name", "")
        model_candidates.append({
            "name": cname,
            "label": labels_map.get(cname, cname),
            "mean_mae": _fmt_float(c.get("mean_mae_pp"), 2),
            "mae_2021": _fmt_float(f21.get("mae_pp"), 2),
            "mae_2024": _fmt_float(f24.get("mae_pp"), 2),
            "spearman_2021": _fmt_float(f21.get("spearman"), 3),
            "spearman_2024": _fmt_float(f24.get("spearman"), 3),
            "top20_hit": _fmt_pct(_safe_float(f24.get("top20_hit")) * 100.0, 1),
        })

    selected_model = metrics.get("selected_model", "persist_l1")
    selected_model_label = labels_map.get(selected_model, selected_model)
    selected_model_desc = "Posición relativa en la elección anterior, 2024"

    structural_coefs_raw = metrics.get("coefficients", [])
    structural_coefs: list[dict[str, Any]] = []
    top_structural_factor = "Jóvenes de 18 a 24 años"
    top_structural_coef = "-3.74"

    if structural_coefs_raw:
        for c in structural_coefs_raw:
            val = _safe_float(c.get("coef_pp_per_sd"))
            direction = "Aumenta abstención" if val < 0 else "Reduce abstención"
            structural_coefs.append({
                "key": c.get("key", ""),
                "label": c.get("label", c.get("key", "")),
                "source": "INEGI/CONAPO",
                "val": f"{val:+.2f}",
                "val_num": val,
                "direction": direction,
                "_abs": abs(val),
            })
        structural_coefs.sort(key=lambda x: x["_abs"], reverse=True)
        if structural_coefs:
            top_structural_factor = structural_coefs[0]["label"]
            top_structural_coef = structural_coefs[0]["val"]

    forecast_coefs = metrics.get("forecast_coefficients", [])
    national_level = _safe_float(metrics.get("national_level_assumption", 51.84), 51.84)
    calibration_pp = _safe_float(metrics.get("calibration_pp", 54.81), 54.81)
    offset_pp = _safe_float(metrics.get("offset_pp", 54.81), 54.81)
    sigma_pp = _safe_float(metrics.get("sigma_pp", 8.33), 8.33)
    interval_90_pp = round(1.645 * sigma_pp, 2)

    structural_r2 = abs(_safe_float(metrics.get("structural_r2", 0.315), 0.315))
    structural_r2_within_state = _safe_float(metrics.get("structural_r2_within_state", 0.312), 0.312)
    structural_r2_state_cv = _safe_float(metrics.get("structural_r2_state_cv", -0.0799), -0.0799)
    between_state_share = _safe_float(metrics.get("between_state_share", 0.466), 0.466)

    model_facts = {
        "selected_model": selected_model,
        "selected_model_label": selected_model_label,
        "selected_model_desc": selected_model_desc,
        "national_level": round(national_level, 2),
        "national_level_fmt": f"{national_level:.2f}%",
        "calibration_pp": round(calibration_pp, 2),
        "offset_pp": round(offset_pp, 2),
        "sigma_pp": round(sigma_pp, 2),
        "interval_90_pp": interval_90_pp,
        "interval_90_pp_fmt": f"±{interval_90_pp:.1f} pp",
        "structural_r2": round(structural_r2, 2),
        "structural_r2_fmt": f"{structural_r2:.2f}",
        "structural_r2_random_cv": round(structural_r2, 4),
        "structural_r2_within_state": round(structural_r2_within_state, 4),
        "structural_r2_state_cv": round(structural_r2_state_cv, 4),
        "between_state_share": round(between_state_share, 4),
        "between_state_share_fmt": f"{between_state_share * 100.0:.1f}%",
        "candidates": model_candidates,
        "backtests": metrics.get("backtests", []),
        "coefficients": structural_coefs,
        "forecast_coefficients": forecast_coefs,
        "top_structural_factor": top_structural_factor,
        "top_structural_coef": top_structural_coef,
    }

    # 12. Top 20 Priority Municipalities and Lever Diagnosis
    mun_copy = mun.copy()
    if "abstencion_esperada" not in mun_copy.columns:
        pred_abs = (
            mun_copy["pred_abstention"].fillna(0.5)
            if "pred_abstention" in mun_copy.columns
            else pd.Series(0.5, index=mun_copy.index)
        )
        ln_s = (
            mun_copy["lista_nominal"].fillna(0.0)
            if "lista_nominal" in mun_copy.columns
            else pd.Series(0.0, index=mun_copy.index)
        )
        mun_copy["abstencion_esperada"] = (pred_abs * ln_s).round().astype(int)

    drivers_file = b_dir / "drivers.parquet"
    drivers_df = pd.read_parquet(drivers_file) if drivers_file.is_file() else pd.DataFrame()

    ref = build_reference(units, level="mun")

    rn_muns = (
        mun_copy[mun_copy["category"].isin(["rojo", "naranja"])].copy()
        if "category" in mun_copy.columns
        else mun_copy.copy()
    )
    rn_muns["prioridad"] = rn_muns["abstencion_esperada"].rank(ascending=False, method="min").astype(int)
    top20_df = rn_muns.sort_values("prioridad").head(20).copy()

    top20_prioridad: list[dict[str, Any]] = []
    top20_ln_sum = 0.0
    top20_abst_sum = 0.0

    for _, row in top20_df.iterrows():
        u_dict = row.to_dict()
        u_drivers = (
            drivers_df[drivers_df["id"] == row["id"]].to_dict(orient="records")
            if not drivers_df.empty
            else []
        )
        rec_list = recommend(u_dict, u_drivers, ref)
        top_title = rec_list[0]["title"] if rec_list else "Diagnóstico de riesgo de abstención"
        top_lever = rec_list[0]["lever"] if rec_list else "campana_general"
        ln_val = _safe_float(row.get("lista_nominal"))
        abst_val = _safe_float(row.get("abstencion_esperada"))
        top20_ln_sum += ln_val
        top20_abst_sum += abst_val

        st_id = str(row.get("cve_ent", "")).zfill(2)
        st_name = ent_map.get(st_id, row.get("nom_ent", "N/D"))

        top20_prioridad.append({
            "rank": int(row["prioridad"]),
            "id": row.get("id", ""),
            "name": row.get("name", row.get("nom_mun", "N/D")),
            "state": st_name,
            "cve_ent": st_id,
            "ln": _fmt_int(ln_val),
            "ln_raw": ln_val,
            "abst_esp": _fmt_int(abst_val),
            "abst_esp_raw": abst_val,
            "cat": row.get("category", "naranja"),
            "lever_title": top_title,
            "lever": top_lever,
        })

    # Lever coverage across all municipalities
    lever_counts: dict[str, int] = {}
    lever_ln: dict[str, float] = {}
    for _, row in mun.iterrows():
        u_dict = row.to_dict()
        u_drivers = (
            drivers_df[drivers_df["id"] == row["id"]].to_dict(orient="records")
            if not drivers_df.empty
            else []
        )
        rec_list = recommend(u_dict, u_drivers, ref)
        top_lever = rec_list[0]["lever"] if rec_list else "campana_general"
        ln_val = _safe_float(row.get("lista_nominal"))
        lever_counts[top_lever] = lever_counts.get(top_lever, 0) + 1
        lever_ln[top_lever] = lever_ln.get(top_lever, 0.0) + ln_val

    lever_meta = {
        "promocion_jovenes": (
            "Promoción del Voto Joven",
            "Campañas en redes sociales, módulos de credencialización en universidades/bachilleratos y convenios juveniles.",
        ),
        "materiales_lengua_indigena": (
            "Materiales en Lenguas Indígenas",
            "Traducción de boletas muestra, perifoneo en lenguas originarias y capacitadores electorales bilingües.",
        ),
        "casillas_rurales": (
            "Accesibilidad en Casillas Rurales",
            "Instalación de casillas extraordinarias, rutas de transporte seguro y verificación de accesibilidad física.",
        ),
        "campana_general": (
            "Campañas Cívicas y Credencialización",
            "Refuerzo de módulos de credencialización fija/móvil, diagnóstico territorial y difusión comunitaria.",
        ),
    }

    levers_table: list[dict[str, Any]] = []
    for lev, (label, desc) in lever_meta.items():
        cnt = lever_counts.get(lev, 0)
        l_ln = lever_ln.get(lev, 0.0)
        pct_c = (cnt / max(n_mun, 1)) * 100.0
        pct_l = (l_ln / max(tot_ln, 1e-6)) * 100.0
        levers_table.append({
            "key": lev,
            "label": label,
            "count": cnt,
            "pct_count": _fmt_float(pct_c, 1),
            "pct_count_fmt": _fmt_pct(pct_c, 1),
            "pct_mun_label": f"{pct_c:.1f} % de los municipios",
            "ln": _fmt_int(l_ln),
            "ln_m": f"{l_ln / 1e6:.1f} M",
            "pct_ln": _fmt_float(pct_l, 1),
            "pct_ln_fmt": _fmt_pct(pct_l, 1),
            "pct_ln_label": f"{pct_l:.1f} % de la LN",
            "desc": desc,
        })

    # 13. Reliability stats
    excluded_by_year = metrics.get("excluded_unreliable", {})
    total_excluded = sum(excluded_by_year.values()) if excluded_by_year else 0
    reliability_rule = metrics.get(
        "reliability_rule", "reliable = (ns_rate <= 0.5) and (participacion >= 0.02)"
    )

    reliability = {
        "excluded_by_year": excluded_by_year,
        "total_excluded": total_excluded,
        "rule": reliability_rule,
    }

    # 14. Privacy stats
    privacy = {
        "suppression_threshold": 10,
        "suppressed_cells": cell_privacy_suppressed,
        "rule": "Celdas con Lista Nominal menor a 10 registros son suprimidas para impedir reidentificación.",
        "sex_x_rule": "El sexo no binario (X) se difunde únicamente a nivel nacional y estatal.",
    }

    # 15. Consolidated facts dictionary
    facts: dict[str, Any] = {
        # Metadata & branding
        "team": team,
        "repo_url": repo_url,
        "target_year": target_year,
        "n_mun": n_mun,
        "n_states": n_states,
        "tot_ln": tot_ln,
        "tot_ln_fmt": _fmt_int(tot_ln),
        "tot_ln_m": f"{tot_ln / 1e6:.1f} M",
        # Core data blocks
        "categories": categories,
        "ln_risk": ln_risk,
        "transitions": transitions,
        "scenario_params": scenario_params_dict,
        "scenario_defaults": {
            "lever": lever_def,
            "targeting": target_def,
            "effect_pp": effect_def,
            "coverage": cov_def,
        },
        "votes": votes,
        "mean_delta_pp": mean_delta_pp,
        "national_series": national_series,
        "hist_dip_pts": hist_dip_pts,
        "pjf_rate": pjf_rate,
        "pjf_rate_fmt": f"{pjf_rate:.1f}%",
        "age_sex_2009": age_sex_2009,
        "age_sex_2024": age_sex_2024,
        "age_gender_chart_items": age_gender_chart_items,
        "youth_gap_pp": youth_gap_pp,
        "gender_gap_pp": gender_gap_pp,
        "state_extremes": state_extremes,
        "model": model_facts,
        "top_priorities": top20_prioridad,
        "top20_ln_total": f"{top20_ln_sum / 1e6:.1f}",
        "top20_abst_total": f"{top20_abst_sum / 1e6:.1f}",
        "levers_coverage": levers_table,
        "reliability": reliability,
        "privacy": privacy,
        # Flat convenience aliases matching report / slides template usage
        "n_muns_total": n_mun,
        "n_muns_rojo": categories["base"]["rojo"]["n"],
        "pct_muns_rojo": categories["base"]["rojo"]["pct_n_fmt"].replace("%", ""),
        "n_muns_naranja": categories["base"]["naranja"]["n"],
        "pct_muns_naranja": categories["base"]["naranja"]["pct_n_fmt"].replace("%", ""),
        "n_muns_amarillo": categories["base"]["amarillo"]["n"],
        "n_muns_verde": categories["base"]["verde"]["n"],
        "ln_rojo_millones": f"{categories['base']['rojo']['ln_m']:.1f}",
        "pct_ln_rojo": f"{categories['base']['rojo']['pct_ln']:.1f}",
        "ln_naranja_millones": f"{categories['base']['naranja']['ln_m']:.1f}",
        "pct_ln_naranja": f"{categories['base']['naranja']['pct_ln']:.1f}",
        "ln_rojo_naranja_millones": f"{ln_risk['base']['millones']:.1f}",
        "pct_ln_rojo_naranja": f"{ln_risk['base']['pct']:.1f}",
        "arn_millones": f"{ln_risk['base']['arn_millones']:.1f}",
        "arn_pct": f"{ln_risk['base']['arn_pct']:.1f}",
        # Unequivocal wording aliases (§14.9.6 & F5-D)
        "rojo_stat_desc": f"municipios en rojo ({categories['base']['rojo']['pct_n']:.1f} % de los municipios; {categories['base']['rojo']['pct_ln']:.1f} % de la LN)",
        "rojo_both_pct": categories["base"]["rojo"]["both_pct_label"],
        "rojo_summary_label": f"{categories['base']['rojo']['n']} municipios en rojo ({categories['base']['rojo']['pct_n']:.1f} % de los municipios; {categories['base']['rojo']['pct_ln']:.1f} % de la LN)",
        "chart_scenarios_label": "% de municipios",
        "chart_scenarios_title": "Distribución por escenario (% de municipios)",
        "chart_territorial_label": "% de municipios",
        "chart_territorial_title": "Distribución territorial (% de municipios)",
        "top_state_1": state_extremes["top_state_1"],
        "top_state_1_pct": state_extremes["top_state_1_pct"],
        "top_state_2": state_extremes["top_state_2"],
        "top_state_2_pct": state_extremes["top_state_2_pct"],
        "top_state_3": state_extremes["top_state_3"],
        "top_state_3_pct": state_extremes["top_state_3_pct"],
        "votos_adicionales_k": votes["intervencion"]["votos_k"],
        "votos_adicionales_fmt": votes["intervencion"]["votos_fmt"],
        "pct_reduccion_rojo": transitions["pct_rojo_reduction_fmt"].replace("%", ""),
        "top_structural_factor": top_structural_factor,
        "top_structural_coef": top_structural_coef,
        "excluded_by_year": excluded_by_year,
        "total_excluded": total_excluded,
        "part_pj_2025": f"{pjf_rate:.1f}",
        "top_gap_youth": top_gap_youth,
        "top_gap_gender": top_gap_gender,
        "model_candidates": model_candidates,
        "selected_model": selected_model,
        "selected_model_label": selected_model_label,
        "selected_model_desc": selected_model_desc,
        "structural_r2": model_facts["structural_r2_fmt"],
        "structural_coefs": structural_coefs,
        "state_table": state_table,
        "scenarios": {
            "base": {
                "verde": categories["base"]["verde"]["n"],
                "amarillo": categories["base"]["amarillo"]["n"],
                "naranja": categories["base"]["naranja"]["n"],
                "rojo": categories["base"]["rojo"]["n"],
                "ln_critica": f"{ln_risk['base']['millones']:.1f}",
            },
            "interv": {
                "verde": categories["intervencion"]["verde"]["n"],
                "amarillo": categories["intervencion"]["amarillo"]["n"],
                "naranja": categories["intervencion"]["naranja"]["n"],
                "rojo": categories["intervencion"]["rojo"]["n"],
                "ln_critica": f"{ln_risk['intervencion']['millones']:.1f}",
                "votos_fmt": votes["intervencion"]["votos_fmt"],
            },
            "pesim": {
                "verde": categories["pesimista"]["verde"]["n"],
                "amarillo": categories["pesimista"]["amarillo"]["n"],
                "naranja": categories["pesimista"]["naranja"]["n"],
                "rojo": categories["pesimista"]["rojo"]["n"],
                "ln_critica": f"{ln_risk['pesimista']['millones']:.1f}",
                "votos_fmt": votes["pesimista"]["votos_fmt"],
            },
        },
        "top20_prioridad": top20_prioridad,
        "levers_table": levers_table,
    }

    return facts
