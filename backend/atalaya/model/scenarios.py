"""Scenario definitions and simulation engine for participation risk."""
from __future__ import annotations

import numpy as np
import pandas as pd

from atalaya.model.risk import category_for, rescore

CATEGORIES = ["verde", "amarillo", "naranja", "rojo", "sin_dato"]

SCENARIOS: list[dict] = [
    {
        "id": "base",
        "label": "Sin intervención",
        "description": "Tendencia histórica + perfil sociodemográfico",
        "params": [],
    },
    {
        "id": "intervencion",
        "label": "Con intervención hipotética",
        "description": "Intervención hipotética focalizada según palanca",
        "params": [
            {
                "key": "lever",
                "label": "Palanca de intervención",
                "type": "select",
                "default": "promocion_jovenes",
                "options": [
                    {"value": "promocion_jovenes", "label": "Promoción del voto joven"},
                    {"value": "casillas_rurales", "label": "Casillas y traslado en zonas rurales"},
                    {"value": "materiales_lengua_indigena", "label": "Materiales y capacitación en lenguas indígenas"},
                    {"value": "campana_general", "label": "Campaña general de promoción del voto"},
                ],
            },
            {
                "key": "targeting",
                "label": "Focalización",
                "type": "select",
                "default": "rojo_naranja",
                "options": [
                    {"value": "rojo", "label": "Solo zonas rojas"},
                    {"value": "rojo_naranja", "label": "Zonas rojas y naranjas"},
                    {"value": "todos", "label": "Todo el país"},
                ],
            },
            {
                "key": "effect_pp",
                "label": "Efecto máximo esperado",
                "type": "number",
                "min": 0.0,
                "max": 10.0,
                "step": 0.5,
                "default": 3.0,
                "unit": "pp",
            },
            {
                "key": "coverage",
                "label": "Cobertura de la intervención",
                "type": "number",
                "min": 0,
                "max": 100,
                "step": 5,
                "default": 100,
                "unit": "%",
            },
        ],
    },
    {
        "id": "pesimista",
        "label": "Escenario pesimista",
        "description": "Caída general de participación y acentuación de tendencias negativas",
        "params": [
            {
                "key": "shock_pp",
                "label": "Caída general de participación",
                "type": "number",
                "min": 0.0,
                "max": 5.0,
                "step": 0.5,
                "default": 2.0,
                "unit": "pp",
            },
            {
                "key": "trend_amplifier",
                "label": "Acentuación de tendencias negativas",
                "type": "number",
                "min": 0,
                "max": 100,
                "step": 10,
                "default": 50,
                "unit": "%",
            },
        ],
    },
]


def default_params(scenario: str) -> dict:
    """Returns default parameters dictionary for the given scenario ID."""
    for sc in SCENARIOS:
        if sc["id"] == scenario:
            return {p["key"]: p["default"] for p in sc["params"]}
    valid_ids = [sc["id"] for sc in SCENARIOS]
    raise ValueError(f"Escenario desconocido: '{scenario}'. Opciones válidas: {', '.join(valid_ids)}")


def _validate_and_merge_params(scenario: str, params: dict | None) -> dict:
    merged = default_params(scenario)
    if params:
        merged.update(params)

    if scenario == "intervencion":
        lever = merged.get("lever")
        valid_levers = ["promocion_jovenes", "casillas_rurales", "materiales_lengua_indigena", "campana_general"]
        if lever not in valid_levers:
            raise ValueError(f"Palanca inválida: '{lever}'. Opciones válidas: {', '.join(valid_levers)}")

        targeting = merged.get("targeting")
        valid_targetings = ["rojo", "rojo_naranja", "todos"]
        if targeting not in valid_targetings:
            raise ValueError(f"Focalización inválida: '{targeting}'. Opciones válidas: {', '.join(valid_targetings)}")

        try:
            effect_pp = float(merged.get("effect_pp", 0))
        except (ValueError, TypeError):
            raise ValueError("El parámetro 'effect_pp' debe ser numérico")
        if not (0.0 <= effect_pp <= 10.0):
            raise ValueError(f"El efecto debe estar entre 0 y 10 pp (recibido: {effect_pp})")
        merged["effect_pp"] = effect_pp

        try:
            coverage = float(merged.get("coverage", 0))
        except (ValueError, TypeError):
            raise ValueError("El parámetro 'coverage' debe ser numérico")
        if not (0.0 <= coverage <= 100.0):
            raise ValueError(f"La cobertura debe estar entre 0% y 100% (recibido: {coverage})")
        merged["coverage"] = coverage

    elif scenario == "pesimista":
        try:
            shock_pp = float(merged.get("shock_pp", 0))
        except (ValueError, TypeError):
            raise ValueError("El parámetro 'shock_pp' debe ser numérico")
        if not (0.0 <= shock_pp <= 5.0):
            raise ValueError(f"La caída general debe estar entre 0 y 5 pp (recibido: {shock_pp})")
        merged["shock_pp"] = shock_pp

        try:
            trend_amp = float(merged.get("trend_amplifier", 0))
        except (ValueError, TypeError):
            raise ValueError("El parámetro 'trend_amplifier' debe ser numérico")
        if not (0.0 <= trend_amp <= 100.0):
            raise ValueError(f"El amplificador de tendencia debe estar entre 0% y 100% (recibido: {trend_amp})")
        merged["trend_amplifier"] = trend_amp

    return merged


def simulate(
    units: pd.DataFrame,
    scenario: str,
    params: dict | None = None,
    level: str = "mun",
    ent: str | None = None,
) -> tuple[pd.DataFrame, dict]:
    """Simulates an electoral participation scenario.

    Parameters
    ----------
    units : pd.DataFrame
        Complete units DataFrame containing level=='mun' and optionally level=='state'.
    scenario : str
        'base', 'intervencion', or 'pesimista'.
    params : dict | None
        Scenario parameter overrides.
    level : str
        'mun' or 'state'.
    ent : str | None
        Optional state code ('cve_ent') to filter results.

    Returns
    -------
    tuple[pd.DataFrame, dict]
        (items, summary) where items conforms to RiskItem specification and summary to ScenarioSummary.
    """
    if level not in ["mun", "state"]:
        raise ValueError(f"Nivel geográfico inválido: '{level}'. Opciones: 'mun', 'state'")

    cfg = _validate_and_merge_params(scenario, params)

    # 1. Base municipal data
    if "level" in units.columns:
        mun_df = units[units["level"] == "mun"].copy()
    else:
        mun_df = units.copy()

    ent_col = "cve_ent" if "cve_ent" in mun_df.columns else ("ent" if "ent" in mun_df.columns else "id")

    base_part = mun_df["pred_participation"].copy()
    base_abs = 1.0 - base_part
    has_part = base_part.notna()

    # 2. Compute new participation
    new_part = base_part.copy()

    if scenario == "base":
        pass

    elif scenario == "intervencion":
        targeting = cfg["targeting"]
        lever = cfg["lever"]
        effect_pp = cfg["effect_pp"]
        coverage = cfg["coverage"]

        # Objective set by base category
        if targeting == "rojo":
            in_target = (mun_df["category"] == "rojo") & has_part
        elif targeting == "rojo_naranja":
            in_target = mun_df["category"].isin(["rojo", "naranja"]) & has_part
        else:  # todos
            in_target = mun_df["category"].ne("sin_dato") & has_part

        # Weight w_i
        if lever == "campana_general":
            w = pd.Series(1.0, index=mun_df.index)
        else:
            lever_col_map = {
                "promocion_jovenes": "pct_18_24",
                "casillas_rurales": "pct_rural",
                "materiales_lengua_indigena": "pct_hli",
            }
            col = lever_col_map.get(lever)
            if col and col in mun_df.columns:
                x = mun_df[col].dropna()
                if len(x) > 0:
                    p75 = float(np.percentile(x, 75))
                    if p75 == 0.0:
                        max_x = float(x.max())
                        p75 = max_x if max_x > 0.0 else 1.0
                else:
                    p75 = 1.0
                w_raw = mun_df[col] / p75
                w = w_raw.fillna(0.0).clip(0.0, 1.5)
            else:
                w = pd.Series(0.0, index=mun_df.index)

        delta = (effect_pp / 100.0) * (coverage / 100.0) * w
        new_part_target = np.minimum(base_part[in_target] + delta[in_target], 0.98)
        new_part.loc[in_target] = new_part_target

    elif scenario == "pesimista":
        shock_pp = cfg["shock_pp"]
        trend_amp = cfg["trend_amplifier"]
        if "trend_pp" in mun_df.columns:
            neg_trend = np.maximum(0.0, -mun_df["trend_pp"].fillna(0.0))
        else:
            neg_trend = pd.Series(0.0, index=mun_df.index)

        penalty = (shock_pp / 100.0) + (trend_amp / 100.0) * (neg_trend / 100.0)
        new_part_calc = np.maximum(base_part[has_part] - penalty[has_part], 0.05)
        new_part.loc[has_part] = new_part_calc

    # 3. New abstention and low/high bounds
    new_abs = pd.Series(np.nan, index=mun_df.index, dtype=float)
    new_abs.loc[has_part] = 1.0 - new_part.loc[has_part]
    diff_abs = new_abs - base_abs

    if "pred_low" in mun_df.columns:
        new_pred_low = (mun_df["pred_low"] + diff_abs).clip(0.0, 1.0)
    else:
        new_pred_low = pd.Series(np.nan, index=mun_df.index, dtype=float)

    if "pred_high" in mun_df.columns:
        new_pred_high = (mun_df["pred_high"] + diff_abs).clip(0.0, 1.0)
    else:
        new_pred_high = pd.Series(np.nan, index=mun_df.index, dtype=float)

    rescored_mun = rescore(mun_df, new_abs)
    new_score_mun = rescored_mun["risk_score"]
    new_cat_mun = rescored_mun["category"]

    # 4. delta_vs_base_pp
    if scenario == "base":
        delta_vs_base_pp_mun = pd.Series(None, index=mun_df.index, dtype=object)
    else:
        delta_vs_base_pp_mun = ((new_abs - base_abs) * 100.0).round(1)

    # 5. Handle aggregation if level == 'state'
    if level == "state":
        if "level" in units.columns:
            units_state = units[units["level"] == "state"].copy()
        else:
            units_state = pd.DataFrame()

        state_rows = []
        state_ids = units_state["id"].unique() if len(units_state) > 0 else mun_df[ent_col].unique()

        for s_id in state_ids:
            s_match = units_state[units_state["id"] == s_id] if len(units_state) > 0 else pd.DataFrame()
            muns_in_state = mun_df[mun_df[ent_col] == s_id]

            name = s_match["name"].iloc[0] if len(s_match) > 0 and "name" in s_match.columns else str(s_id)
            last_yr = s_match["last_year"].iloc[0] if len(s_match) > 0 and "last_year" in s_match.columns else None
            last_part = s_match["last_participation"].iloc[0] if len(s_match) > 0 and "last_participation" in s_match.columns else None
            trend = s_match["trend_pp"].iloc[0] if len(s_match) > 0 and "trend_pp" in s_match.columns else None

            ln = muns_in_state["lista_nominal"].fillna(0.0) if "lista_nominal" in muns_in_state.columns else pd.Series(0.0, index=muns_in_state.index)
            sum_ln = ln.sum()

            valid_muns = muns_in_state[muns_in_state.index.isin(has_part[has_part].index)]
            ln_valid = valid_muns["lista_nominal"].fillna(0.0) if "lista_nominal" in valid_muns.columns else pd.Series(0.0, index=valid_muns.index)
            sum_ln_valid = ln_valid.sum()

            if sum_ln_valid > 0:
                weights = ln_valid / sum_ln_valid
                s_part = float((new_part.loc[valid_muns.index] * weights).sum())
                s_abs = 1.0 - s_part
                s_low = float((new_pred_low.loc[valid_muns.index] * weights).sum()) if new_pred_low.loc[valid_muns.index].notna().any() else None
                s_high = float((new_pred_high.loc[valid_muns.index] * weights).sum()) if new_pred_high.loc[valid_muns.index].notna().any() else None
                s_delta = float((delta_vs_base_pp_mun.loc[valid_muns.index].astype(float) * weights).sum()) if scenario != "base" else None
            else:
                s_part, s_abs, s_low, s_high, s_delta = None, None, None, None, None

            state_rows.append({
                "id": str(s_id),
                "name": name,
                "level": "state",
                "ent": str(s_id),
                "lista_nominal": int(sum_ln) if sum_ln > 0 else (s_match["lista_nominal"].iloc[0] if len(s_match) > 0 and "lista_nominal" in s_match.columns else None),
                "last_year": last_yr,
                "last_participation": last_part,
                "pred_participation": round(s_part, 4) if s_part is not None else None,
                "pred_abstention": round(s_abs, 4) if s_abs is not None else None,
                "pred_low": round(s_low, 4) if s_low is not None else None,
                "pred_high": round(s_high, 4) if s_high is not None else None,
                "trend_pp": trend,
                "delta_vs_base_pp": round(s_delta, 1) if s_delta is not None else None,
            })

        items = pd.DataFrame(state_rows)
        if len(units_state) > 0:
            units_state_aligned = units_state.set_index("id").reindex(items["id"]).reset_index()
            state_abs_series = pd.Series(items["pred_abstention"].values, index=units_state_aligned.index)
            rescored_state = rescore(units_state_aligned, state_abs_series)
            items["risk_score"] = rescored_state["risk_score"].values
            items["category"] = rescored_state["category"].values
        else:
            items["risk_score"] = [None] * len(items)
            items["category"] = ["sin_dato"] * len(items)

        # Base category for states
        if len(units_state) > 0 and "category" in units_state.columns:
            base_cat_map = dict(zip(units_state["id"], units_state["category"]))
            items_base_cat = items["id"].map(base_cat_map).fillna("sin_dato")
        else:
            items_base_cat = items["category"]

    else:  # level == 'mun'
        items = pd.DataFrame({
            "id": mun_df["id"],
            "name": mun_df["name"],
            "level": "mun",
            "ent": mun_df[ent_col],
            "lista_nominal": mun_df["lista_nominal"] if "lista_nominal" in mun_df.columns else None,
            "last_year": mun_df["last_year"] if "last_year" in mun_df.columns else None,
            "last_participation": mun_df["last_participation"] if "last_participation" in mun_df.columns else None,
            "pred_participation": new_part.round(4),
            "pred_abstention": new_abs.round(4),
            "pred_low": new_pred_low.round(4),
            "pred_high": new_pred_high.round(4),
            "trend_pp": mun_df["trend_pp"] if "trend_pp" in mun_df.columns else None,
            "risk_score": new_score_mun,
            "category": new_cat_mun,
            "delta_vs_base_pp": delta_vs_base_pp_mun,
        })
        items_base_cat = mun_df["category"]

    # 6. Filter by ent if provided
    mun_filtered_mask = (mun_df[ent_col] == ent) if (ent is not None and ent != "") else pd.Series(True, index=mun_df.index)
    if ent is not None and ent != "":
        mask = items["ent"] == ent
        items = items.loc[mask].copy()
        items_base_cat = items_base_cat.loc[mask]

    # Column ordering to match RiskItem exactly
    cols_order = [
        "id", "name", "level", "ent", "lista_nominal",
        "last_year", "last_participation", "pred_participation",
        "pred_abstention", "pred_low", "pred_high", "trend_pp",
        "risk_score", "category", "delta_vs_base_pp",
    ]
    items = items[cols_order].reset_index(drop=True)

    # 7. Summary
    n_units = len(items)
    by_category = {cat: int((items["category"] == cat).sum()) for cat in CATEGORIES}
    by_category_base = {cat: int((items_base_cat == cat).sum()) for cat in CATEGORIES}

    # votos_adicionales: always over municipalities filtered by ent
    mun_sub = mun_df.loc[mun_filtered_mask]
    diff_part = (new_part.loc[mun_sub.index] - base_part.loc[mun_sub.index]).fillna(0.0)
    ln_sub = mun_sub["lista_nominal"].fillna(0.0) if "lista_nominal" in mun_sub.columns else pd.Series(0.0, index=mun_sub.index)
    votos_adicionales = int(round(float((diff_part * ln_sub).sum())))

    # mean_delta_pp: weighted by lista_nominal
    if scenario == "base":
        mean_delta_pp = 0.0
    else:
        valid_deltas = items["delta_vs_base_pp"].dropna()
        if len(valid_deltas) > 0:
            ln_items = items.loc[valid_deltas.index, "lista_nominal"].fillna(0.0)
            sum_ln_items = ln_items.sum()
            if sum_ln_items > 0:
                mean_delta_pp = round(float((valid_deltas.astype(float) * ln_items).sum() / sum_ln_items), 2)
            else:
                mean_delta_pp = round(float(valid_deltas.astype(float).mean()), 2)
        else:
            mean_delta_pp = 0.0

    summary = {
        "n_units": n_units,
        "by_category": by_category,
        "by_category_base": by_category_base,
        "votos_adicionales": votos_adicionales,
        "mean_delta_pp": mean_delta_pp,
    }

    return items, summary
