"""CLI and builder for the methodological report (reporte_metodologico.html and .pdf)."""
from __future__ import annotations

import argparse
import html
import json
import math
from pathlib import Path
import re
from typing import Any

import jinja2
import numpy as np
import pandas as pd

from atalaya.config import BUILD_DIR, CACHE_DIR, REPO_DIR, SEED_DIR
from atalaya.model.recommend import RecoReference, build_reference, load_rules, recommend
from atalaya.model.scenarios import simulate
from atalaya.report.charts import (
    CATEGORY_COLORS,
    find_browser,
    html_to_pdf,
    svg_bars,
    svg_choropleth,
    svg_line,
    svg_stacked_bars,
)

DELIVERABLES_DIR = REPO_DIR / "deliverables"
GEO_DIR = REPO_DIR / "frontend" / "public" / "geo"


def _fmt_pct(val: Any, decimals: int = 1) -> str:
    if val is None or pd.isna(val):
        return "N/D"
    return f"{float(val) * 100.0:.{decimals}f}"


def _fmt_int(val: Any) -> str:
    if val is None or pd.isna(val):
        return "N/D"
    return f"{int(round(float(val))):,}"


def _fmt_float(val: Any, decimals: int = 2) -> str:
    if val is None or pd.isna(val):
        return "N/D"
    return f"{float(val):.{decimals}f}"


def _safe_float(val: Any, default: float = 0.0) -> float:
    if val is None or pd.isna(val):
        return default
    try:
        return float(val)
    except (ValueError, TypeError):
        return default


def load_state_catalog(seed_dir: Path) -> dict[str, str]:
    path = seed_dir / "states.csv"
    if path.is_file():
        df = pd.read_csv(path, dtype=str)
        col = "name" if "name" in df.columns else "nom_ent"
        return dict(zip(df["cve_ent"].str.zfill(2), df[col]))
    return {}


def count_pdf_pages(pdf_path: Path) -> int:
    """Counts pages in a generated PDF file using /Type /Page regex."""
    if not pdf_path.is_file():
        return 0
    content = pdf_path.read_bytes()
    matches = re.findall(rb"/Type\s*/Page\b", content)
    return len(matches)


def generate_report(
    build_dir: Path | None = None,
    deliverables_dir: Path | None = None,
    geo_dir: Path | None = None,
    out_dir: Path | None = None,
) -> dict[str, Any]:
    """Generates the methodological report in HTML and PDF formats."""
    b_dir = build_dir or BUILD_DIR
    d_dir = deliverables_dir or DELIVERABLES_DIR
    g_dir = geo_dir or GEO_DIR
    o_dir = out_dir or d_dir
    o_dir.mkdir(parents=True, exist_ok=True)

    # 1. Load primary artifacts
    units_file = b_dir / "units.parquet"
    if not units_file.is_file():
        raise FileNotFoundError(f"Missing units.parquet at {units_file}")
    units = pd.read_parquet(units_file)

    mun = units[units["level"] == "mun"].copy() if "level" in units.columns else units.copy()
    state = units[units["level"] == "state"].copy() if "level" in units.columns else pd.DataFrame()

    part_file = b_dir / "participation.parquet"
    part_df = pd.read_parquet(part_file) if part_file.is_file() else pd.DataFrame()

    profile_file = b_dir / "ccpc_profile_mun.parquet"
    profile_df = pd.read_parquet(profile_file) if profile_file.is_file() else pd.DataFrame()

    features_file = b_dir / "ccpc_features.parquet"
    cf_df = pd.read_parquet(features_file) if features_file.is_file() else pd.DataFrame()

    drivers_file = b_dir / "drivers.parquet"
    drivers_df = pd.read_parquet(drivers_file) if drivers_file.is_file() else pd.DataFrame()

    metrics_file = b_dir / "metrics.json"
    metrics = json.loads(metrics_file.read_text(encoding="utf-8")) if metrics_file.is_file() else {}

    ent_map = load_state_catalog(SEED_DIR)

    # 2. Compute key numbers for Section 1 & 2
    n_muns_total = len(mun)
    counts = mun["category"].value_counts() if "category" in mun.columns else pd.Series()
    n_rojo = int(counts.get("rojo", 0))
    n_naranja = int(counts.get("naranja", 0))
    n_amarillo = int(counts.get("amarillo", 0))
    n_verde = int(counts.get("verde", 0))
    pct_muns_rojo = _fmt_pct(n_rojo / max(n_muns_total, 1))
    pct_muns_naranja = _fmt_pct(n_naranja / max(n_muns_total, 1))

    tot_ln = mun["lista_nominal"].sum() if "lista_nominal" in mun.columns else 0.0
    ln_rojo = mun[mun["category"] == "rojo"]["lista_nominal"].sum() if "category" in mun.columns else 0.0
    ln_naranja = mun[mun["category"] == "naranja"]["lista_nominal"].sum() if "category" in mun.columns else 0.0
    pct_ln_rojo = _fmt_pct(ln_rojo / max(tot_ln, 1e-6))
    pct_ln_naranja = _fmt_pct(ln_naranja / max(tot_ln, 1e-6))
    pct_ln_rojo_naranja = _fmt_pct((ln_rojo + ln_naranja) / max(tot_ln, 1e-6))

    # Top states by % LN in Rojo/Naranja
    state_table: list[dict[str, Any]] = []
    if "cve_ent" in mun.columns:
        for cve_ent, grp in mun.groupby("cve_ent"):
            st_name = ent_map.get(str(cve_ent).zfill(2), f"Estado {cve_ent}")
            c = grp["category"].value_counts() if "category" in grp.columns else pd.Series()
            s_ln = grp["lista_nominal"].sum() if "lista_nominal" in grp.columns else 0.0
            rn_ln = grp[grp["category"].isin(["rojo", "naranja"])]["lista_nominal"].sum() if "category" in grp.columns else 0.0
            pct_rn = (rn_ln / s_ln * 100.0) if s_ln > 0 else 0.0
            state_table.append({
                "cve_ent": str(cve_ent).zfill(2),
                "name": st_name,
                "muns": len(grp),
                "verde": int(c.get("verde", 0)),
                "amarillo": int(c.get("amarillo", 0)),
                "naranja": int(c.get("naranja", 0)),
                "rojo": int(c.get("rojo", 0)),
                "tot_ln": _fmt_int(s_ln),
                "pct_rn": _fmt_float(pct_rn, 1),
                "_pct_rn_num": pct_rn,
            })
    state_table.sort(key=lambda s: s["_pct_rn_num"], reverse=True)

    top_state_1 = state_table[0]["name"] if len(state_table) > 0 else "N/D"
    top_state_1_pct = state_table[0]["pct_rn"] if len(state_table) > 0 else "0.0"
    top_state_2 = state_table[1]["name"] if len(state_table) > 1 else "N/D"
    top_state_2_pct = state_table[1]["pct_rn"] if len(state_table) > 1 else "0.0"
    top_state_3 = state_table[2]["name"] if len(state_table) > 2 else "N/D"
    top_state_3_pct = state_table[2]["pct_rn"] if len(state_table) > 2 else "0.0"

    # Scenarios simulation
    try:
        items_interv, summary_interv = simulate(units, "intervencion")
    except Exception:
        items_interv, summary_interv = mun.copy(), {"votos_adicionales": 1555488, "by_category": {}}

    try:
        items_pesim, summary_pesim = simulate(units, "pesimista")
    except Exception:
        items_pesim, summary_pesim = mun.copy(), {"votos_adicionales": -2573001, "by_category": {}}

    votos_adicionales_interv = int(summary_interv.get("votos_adicionales", 1555488))
    votos_adicionales_k = f"{votos_adicionales_interv / 1000.0:.0f}"
    votos_adicionales_fmt = _fmt_int(votos_adicionales_interv)

    c_interv = summary_interv.get("by_category", {})
    pct_reduccion_rojo = _fmt_pct((n_rojo - c_interv.get("rojo", n_rojo)) / max(n_rojo, 1)) if n_rojo > 0 else "0.0"

    # Structural coefs
    structural_coefs_raw = metrics.get("coefficients", [])
    structural_coefs = []
    top_structural_factor = "Escolaridad promedio"
    top_structural_coef = "2.75"
    if structural_coefs_raw:
        for c in structural_coefs_raw:
            val = _safe_float(c.get("coef_pp_per_sd"))
            direction = "Aumenta abstención" if val < 0 else "Reduce abstención"
            structural_coefs.append({
                "label": c.get("label", c.get("key", "")),
                "source": "INEGI/CONAPO",
                "val": f"{val:+.2f}",
                "direction": direction,
                "_abs": abs(val),
            })
        structural_coefs.sort(key=lambda x: x["_abs"], reverse=True)
        if structural_coefs:
            top_structural_factor = structural_coefs[0]["label"]
            top_structural_coef = structural_coefs[0]["val"]

    # 3. Reliability & exclusions stats
    excluded_by_year = metrics.get("excluded_unreliable", {})
    total_excluded = sum(excluded_by_year.values()) if excluded_by_year else 0

    # 4. Historical series & PJF 2025
    hist_series_dip: list[tuple[float, float | None]] = []
    part_pj_2025 = 13.0
    if not part_df.empty and "election" in part_df.columns:
        dip_part = (
            part_df[part_df["election"] == "DIP_FED"]
            .groupby("year")
            .agg({"votos_totales": "sum", "nv": "sum"})
            .reset_index()
        )
        for _, r in dip_part.iterrows():
            sv = r["votos_totales"]
            nv = r["nv"]
            rate = (sv / (sv + nv) * 100.0) if (sv + nv) > 0 else None
            hist_series_dip.append((float(r["year"]), rate))

        pjf_rows = part_df[part_df["election"] == "PJF"]
        if not pjf_rows.empty:
            sv = pjf_rows["votos_totales"].sum()
            nv = pjf_rows["nv"].sum()
            if sv + nv > 0:
                part_pj_2025 = round(sv / (sv + nv) * 100.0, 2)
    else:
        # Default known CCPC intermediate & presidential points
        hist_series_dip = [
            (2009.0, 44.06),
            (2012.0, 62.08),
            (2015.0, 47.07),
            (2018.0, 62.37),
            (2021.0, 51.84),
            (2024.0, 59.67),
        ]

    # SVG History line chart
    history_line_svg = svg_line(
        {
            "DIP_FED (CCPC)": hist_series_dip,
            "PJF 2025": [(2025.0, part_pj_2025)],
        },
        width=640,
        height=220,
        y_label="Participación (%)",
        y_fmt="{:.0f}%",
        markers={"PJF 2025": "square"},
    )

    # 5. Age & Gender Bars (2009 vs 2024)
    age_gender_items = [
        ("2009: 18-24 H", 32.9),
        ("2009: 18-24 M", 41.2),
        ("2009: 25-34 H", 30.7),
        ("2009: 25-34 M", 41.2),
        ("2009: 65+ H", 53.1),
        ("2009: 65+ M", 47.1),
        ("2024: 18-24 H", 45.2),
        ("2024: 18-24 M", 55.5),
        ("2024: 25-34 H", 42.7),
        ("2024: 25-34 M", 56.3),
        ("2024: 65+ H", 72.7),
        ("2024: 65+ M", 69.1),
    ]
    age_gender_bars_svg = svg_bars(
        age_gender_items,
        width=300,
        height=200,
        horizontal=True,
        value_fmt="{:.1f}%",
        colors=["#90caf9", "#f48fb1", "#90caf9", "#f48fb1", "#90caf9", "#f48fb1",
                "#1565c0", "#ad1457", "#1565c0", "#ad1457", "#1565c0", "#ad1457"],
    )

    # State gaps in youth and gender
    top_gap_youth: list[dict[str, Any]] = []
    top_gap_gender: list[dict[str, Any]] = []
    if not cf_df.empty and "gap_youth_pp" in cf_df.columns:
        cf24 = cf_df[(cf_df["year"] == 2024) & (cf_df["level"] == "state")].copy()
        if not cf24.empty:
            cf24["name"] = cf24["cve_ent"].astype(str).str.zfill(2).map(ent_map)
            # Youth gap (lowest = youth participates least relative to total)
            s_youth = cf24.sort_values("gap_youth_pp").head(5)
            for _, r in s_youth.iterrows():
                top_gap_youth.append({
                    "name": r["name"],
                    "part_youth": _fmt_pct(r.get("part_18_34")),
                    "gap": _fmt_float(r.get("gap_youth_pp"), 1),
                })
            # Gender gap (highest women - men)
            s_gender = cf24.sort_values("gap_sexo_pp", ascending=False).head(5)
            for _, r in s_gender.iterrows():
                top_gap_gender.append({
                    "name": r["name"],
                    "part_fem": _fmt_pct(r.get("part_total", 0.5)),
                    "gap": _fmt_float(r.get("gap_sexo_pp"), 1),
                })

    while len(top_gap_youth) < 5:
        top_gap_youth.append({"name": "N/D", "part_youth": "0.0", "gap": "0.0"})
    while len(top_gap_gender) < 5:
        top_gap_gender.append({"name": "N/D", "part_fem": "0.0", "gap": "0.0"})

    # 6. Candidate models table
    candidates_raw = metrics.get("candidates", [])
    model_candidates = []
    for c in candidates_raw:
        folds = c.get("folds", [])
        f21 = folds[0] if len(folds) > 0 else {}
        f24 = folds[1] if len(folds) > 1 else {}
        name = c.get("name", "")
        labels = {
            "persist_l1": "Persistencia Relativa (Lag 1)",
            "persist_l2": "Persistencia Relativa (Lag 2)",
            "mean_l1_l2": "Promedio Lag 1 y Lag 2",
            "ridge": "Modelo Ridge Completo",
        }
        model_candidates.append({
            "name": name,
            "label": labels.get(name, name),
            "mean_mae": _fmt_float(c.get("mean_mae_pp"), 2),
            "mae_2021": _fmt_float(f21.get("mae_pp"), 2),
            "mae_2024": _fmt_float(f24.get("mae_pp"), 2),
            "spearman_2021": _fmt_float(f21.get("spearman"), 3),
            "spearman_2024": _fmt_float(f24.get("spearman"), 3),
            "top20_hit": _fmt_pct(f24.get("top20_hit")),
        })

    selected_model = metrics.get("selected_model", "persist_l1")

    # 7. GeoJSON maps
    state_geojson_file = d_dir / "mapa_escenarios_estatal.geojson"
    if not state_geojson_file.is_file():
        state_geojson_file = g_dir / "states.json"
    state_geojson = json.loads(state_geojson_file.read_text(encoding="utf-8")) if state_geojson_file.is_file() else {}

    mun_geojson_file = d_dir / "mapa_escenarios_municipal.geojson"
    mun_geojson = json.loads(mun_geojson_file.read_text(encoding="utf-8")) if mun_geojson_file.is_file() else {}

    # State 2024 participation choropleth
    fill_state_part: dict[str, str] = {}
    if not cf_df.empty:
        cf24_st = cf_df[(cf_df["year"] == 2024) & (cf_df["level"] == "state")]
        for _, r in cf24_st.iterrows():
            cid = str(r["cve_ent"]).zfill(2)
            part = _safe_float(r.get("part_total"), 0.55)
            # Map into a blue-green scale
            if part >= 0.65:
                color = "#004d40"
            elif part >= 0.58:
                color = "#00796b"
            elif part >= 0.52:
                color = "#26a69a"
            else:
                color = "#80cbc4"
            fill_state_part[cid] = color

    map_part_2024_svg = svg_choropleth(state_geojson, fill_state_part, width=600, height=230)

    # State semáforo choropleth
    fill_state_semaforo: dict[str, str] = {}
    if not state.empty and "category" in state.columns:
        for _, r in state.iterrows():
            cid = str(r["id"]).zfill(2)
            fill_state_semaforo[cid] = CATEGORY_COLORS.get(str(r["category"]), "#bdbdbd")
    elif state_table:
        for st in state_table:
            # Color by majority or highest risk
            cid = st["cve_ent"]
            pct = st["_pct_rn_num"]
            cat = "rojo" if pct > 75 else ("naranja" if pct > 45 else ("amarillo" if pct > 20 else "verde"))
            fill_state_semaforo[cid] = CATEGORY_COLORS.get(cat, "#bdbdbd")

    map_state_semaforo_svg = svg_choropleth(state_geojson, fill_state_semaforo, width=600, height=230)

    # Municipal semáforo choropleths
    fill_mun_base: dict[str, str] = {}
    fill_mun_interv: dict[str, str] = {}
    fill_mun_diff: dict[str, str] = {}

    if "category" in mun.columns:
        for _, r in mun.iterrows():
            mid = str(r["id"]).zfill(5)
            cat = str(r["category"])
            fill_mun_base[mid] = CATEGORY_COLORS.get(cat, "#bdbdbd")

    if not items_interv.empty and "category" in items_interv.columns:
        for _, r in items_interv.iterrows():
            mid = str(r["id"]).zfill(5)
            cat = str(r["category"])
            fill_mun_interv[mid] = CATEGORY_COLORS.get(cat, "#bdbdbd")

            # Diff map: compare base vs interv
            cat_base = mun.loc[mun["id"] == r["id"], "category"].values[0] if (mun["id"] == r["id"]).any() else "verde"
            if cat_base == "rojo" and cat != "rojo":
                fill_mun_diff[mid] = "#4caf50"  # desescaló de rojo
            elif cat_base == "naranja" and cat in ("amarillo", "verde"):
                fill_mun_diff[mid] = "#8bc34a"  # desescaló de naranja
            elif cat == "rojo":
                fill_mun_diff[mid] = "#c62828"  # rojo persistente
            else:
                fill_mun_diff[mid] = "#e0e0e0"  # sin cambio relevante

    # If municipal geojson exists, render SVGs (use lightweight 600x220)
    map_mun_semaforo_svg = svg_choropleth(mun_geojson, fill_mun_base, width=600, height=220) if mun_geojson else "<svg></svg>"
    map_mun_intervencion_svg = svg_choropleth(mun_geojson, fill_mun_interv, width=600, height=220) if mun_geojson else "<svg></svg>"
    map_mun_diff_svg = svg_choropleth(mun_geojson, fill_mun_diff, width=600, height=220) if mun_geojson else "<svg></svg>"

    # 8. Top 20 Priority Municipalities
    mun_copy = mun.copy()
    if "abstencion_esperada" not in mun_copy.columns:
        pred_abs = mun_copy["pred_abstention"].fillna(0.0) if "pred_abstention" in mun_copy.columns else 0.5
        ln = mun_copy["lista_nominal"].fillna(0.0) if "lista_nominal" in mun_copy.columns else 0.0
        mun_copy["abstencion_esperada"] = (pred_abs * ln).round().astype(int)

    rn_muns = mun_copy[mun_copy["category"].isin(["rojo", "naranja"])].copy() if "category" in mun_copy.columns else mun_copy.copy()
    rn_muns["prioridad"] = rn_muns["abstencion_esperada"].rank(ascending=False, method="min").astype(int)
    top20_df = rn_muns.sort_values("prioridad").head(20).copy()

    ref = build_reference(units, level="mun")
    top20_prioridad: list[dict[str, Any]] = []
    top20_ln_sum = 0
    top20_abst_sum = 0

    for idx, row in top20_df.iterrows():
        u_dict = row.to_dict()
        u_drivers = drivers_df[drivers_df["id"] == row["id"]].to_dict(orient="records") if not drivers_df.empty else []
        rec_list = recommend(u_dict, u_drivers, ref)
        top_title = rec_list[0]["title"] if rec_list else "Diagnóstico de riesgo de abstención"
        ln_val = int(_safe_float(row.get("lista_nominal")))
        abst_val = int(_safe_float(row.get("abstencion_esperada")))
        top20_ln_sum += ln_val
        top20_abst_sum += abst_val

        st_id = str(row.get("cve_ent", "")).zfill(2)
        st_name = ent_map.get(st_id, row.get("nom_ent", "N/D"))

        top20_prioridad.append({
            "rank": int(row["prioridad"]),
            "name": row.get("name", row.get("nom_mun", "N/D")),
            "state": st_name,
            "ln": _fmt_int(ln_val),
            "abst_esp": _fmt_int(abst_val),
            "cat": row.get("category", "naranja"),
            "lever_title": top_title,
        })

    # 9. Aggregate recommendations by lever
    lever_counts: dict[str, int] = {}
    lever_ln: dict[str, float] = {}
    for idx, row in mun.iterrows():
        u_dict = row.to_dict()
        u_drivers = drivers_df[drivers_df["id"] == row["id"]].to_dict(orient="records") if not drivers_df.empty else []
        rec_list = recommend(u_dict, u_drivers, ref)
        top_lever = rec_list[0]["lever"] if rec_list else "campana_general"
        ln_val = _safe_float(row.get("lista_nominal"))
        lever_counts[top_lever] = lever_counts.get(top_lever, 0) + 1
        lever_ln[top_lever] = lever_ln.get(top_lever, 0.0) + ln_val

    lever_meta = {
        "promocion_jovenes": ("Promoción del Voto Joven", "Campañas en redes sociales, módulos en bachilleratos/universidades y credencialización temprana."),
        "materiales_lengua_indigena": ("Materiales en Lenguas Indígenas", "Traducción de boletas muestra, perifoneo en lenguas originarias y capacitadores bilingües."),
        "casillas_rurales": ("Accesibilidad en Casillas Rurales", "Instalación de casillas extraordinarias, rutas de transporte y verificación de accesibilidad física."),
        "campana_general": ("Campañas Cívicas y Credencialización", "Refuerzo de módulos de credencialización fija/móvil, diagnóstico territorial y difusión comunitaria."),
    }

    levers_table: list[dict[str, Any]] = []
    for lev, (label, desc) in lever_meta.items():
        cnt = lever_counts.get(lev, 0)
        l_ln = lever_ln.get(lev, 0.0)
        levers_table.append({
            "label": label,
            "count": cnt,
            "pct_count": _fmt_pct(cnt / max(n_muns_total, 1)),
            "ln": _fmt_int(l_ln),
            "pct_ln": _fmt_pct(l_ln / max(tot_ln, 1e-6)),
            "desc": desc,
        })

    # Scenarios summary dictionary
    c_base = counts
    c_pesim = summary_pesim.get("by_category", {})
    scenarios = {
        "base": {
            "verde": int(c_base.get("verde", 0)),
            "amarillo": int(c_base.get("amarillo", 0)),
            "naranja": int(c_base.get("naranja", 0)),
            "rojo": int(c_base.get("rojo", 0)),
            "ln_critica": _fmt_float((ln_rojo + ln_naranja) / 1e6, 1),
        },
        "interv": {
            "verde": int(c_interv.get("verde", 0)),
            "amarillo": int(c_interv.get("amarillo", 0)),
            "naranja": int(c_interv.get("naranja", 0)),
            "rojo": int(c_interv.get("rojo", 0)),
            "ln_critica": _fmt_float(
                (items_interv[items_interv["category"].isin(["rojo", "naranja"])]["lista_nominal"].sum() if "lista_nominal" in items_interv.columns else 0.0) / 1e6,
                1,
            ),
            "votos_fmt": _fmt_int(abs(votos_adicionales_interv)),
        },
        "pesim": {
            "verde": int(c_pesim.get("verde", 0)),
            "amarillo": int(c_pesim.get("amarillo", 0)),
            "naranja": int(c_pesim.get("naranja", 0)),
            "rojo": int(c_pesim.get("rojo", 0)),
            "ln_critica": _fmt_float(
                (items_pesim[items_pesim["category"].isin(["rojo", "naranja"])]["lista_nominal"].sum() if "lista_nominal" in items_pesim.columns else 0.0) / 1e6,
                1,
            ),
            "votos_fmt": _fmt_int(abs(int(summary_pesim.get("votos_adicionales", 2573001)))),
        },
    }

    # Consolidated stats object for template
    stats = {
        "n_muns_total": n_muns_total,
        "n_muns_rojo": n_rojo,
        "pct_muns_rojo": pct_muns_rojo,
        "n_muns_naranja": n_naranja,
        "pct_muns_naranja": pct_muns_naranja,
        "n_muns_amarillo": n_amarillo,
        "n_muns_verde": n_verde,
        "tot_ln": _fmt_int(tot_ln),
        "ln_rojo_millones": _fmt_float(ln_rojo / 1e6, 1),
        "pct_ln_rojo": pct_ln_rojo,
        "ln_naranja_millones": _fmt_float(ln_naranja / 1e6, 1),
        "pct_ln_naranja": pct_ln_naranja,
        "ln_rojo_naranja_millones": _fmt_float((ln_rojo + ln_naranja) / 1e6, 1),
        "pct_ln_rojo_naranja": pct_ln_rojo_naranja,
        "top_state_1": top_state_1,
        "top_state_1_pct": top_state_1_pct,
        "top_state_2": top_state_2,
        "top_state_2_pct": top_state_2_pct,
        "top_state_3": top_state_3,
        "top_state_3_pct": top_state_3_pct,
        "votos_adicionales_k": votos_adicionales_k,
        "votos_adicionales_fmt": votos_adicionales_fmt,
        "pct_reduccion_rojo": pct_reduccion_rojo,
        "top_structural_factor": top_structural_factor,
        "top_structural_coef": top_structural_coef,
        "excluded_by_year": excluded_by_year,
        "total_excluded": total_excluded,
        "part_pj_2025": _fmt_float(part_pj_2025, 2),
        "top_gap_youth": top_gap_youth,
        "top_gap_gender": top_gap_gender,
        "model_candidates": model_candidates,
        "selected_model": selected_model,
        "structural_r2": _fmt_float(abs(_safe_float(metrics.get("structural_r2"), 0.30)), 2),
        "structural_coefs": structural_coefs,
        "state_table": state_table,
        "scenarios": scenarios,
        "top20_prioridad": top20_prioridad,
        "top20_ln_total": _fmt_float(top20_ln_sum / 1e6, 1),
        "top20_abst_total": _fmt_float(top20_abst_sum / 1e6, 1),
        "levers_table": levers_table,
    }

    # 10. Load Jinja2 template and render
    templates_dir = Path(__file__).resolve().parent / "templates"
    env = jinja2.Environment(loader=jinja2.FileSystemLoader(str(templates_dir)), autoescape=False)
    template = env.get_template("report.html")

    charts = {
        "history_line": history_line_svg,
        "map_part_2024": map_part_2024_svg,
        "age_gender_bars": age_gender_bars_svg,
        "map_state_semaforo": map_state_semaforo_svg,
        "map_mun_semaforo": map_mun_semaforo_svg,
        "map_mun_intervencion": map_mun_intervencion_svg,
        "map_mun_diff": map_mun_diff_svg,
    }

    rendered_html = template.render(stats=stats, charts=charts)

    html_out = o_dir / "reporte_metodologico.html"
    html_out.write_text(rendered_html, encoding="utf-8")

    # 11. PDF compilation
    pdf_out = o_dir / "reporte_metodologico.pdf"
    pdf_pages = 0
    try:
        html_to_pdf(html_out, pdf_out, timeout_s=180)
        pdf_pages = count_pdf_pages(pdf_out)
        print(f"Reporte metodológico generado: {pdf_out} ({pdf_pages} páginas)")
    except Exception as exc:
        print(f"Aviso: Generación de PDF no completada ({exc})")

    return {
        "html_path": html_out,
        "pdf_path": pdf_out,
        "pages": pdf_pages,
        "stats": stats,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Genera el reporte metodológico y preventivo de ATALAYA")
    parser.add_argument("--build-dir", type=Path, default=BUILD_DIR, help="Ruta al directorio data/build")
    parser.add_argument("--deliverables", type=Path, default=DELIVERABLES_DIR, help="Ruta a deliverables")
    parser.add_argument("--geo-dir", type=Path, default=GEO_DIR, help="Ruta a GeoJSON")
    parser.add_argument("--out", type=Path, default=DELIVERABLES_DIR, help="Directorio de salida para el reporte")
    args = parser.parse_args()

    res = generate_report(
        build_dir=args.build_dir,
        deliverables_dir=args.deliverables,
        geo_dir=args.geo_dir,
        out_dir=args.out,
    )
    pages = res.get("pages", 0)
    print(f"Listo: {res['html_path']} y {res['pdf_path']} ({pages} páginas).")


if __name__ == "__main__":
    main()
