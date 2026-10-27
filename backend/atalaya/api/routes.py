"""API routes implementing the ATALAYA HTTP contract."""

from __future__ import annotations

import csv
import logging
import time
from typing import Any, Literal

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from atalaya.api.deps import (
    cached_simulate,
    default_params,
    get_reco_reference,
    get_units_df,
    model_recommend,
    reload_all,
    SCENARIOS,
)
from atalaya.config import SEED_DIR, get_settings
from atalaya.ingest.common import zpad
from atalaya.llm import is_enabled as is_llm_enabled
from atalaya.store import StoreError, get_store, _clean_error_message

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["Atalaya Electoral"])

CATEGORIES = [
    {"id": "verde", "label": "Riesgo bajo", "color": "#3f9a5b", "rule": "verde: < 35"},
    {"id": "amarillo", "label": "Riesgo medio", "color": "#f2bf3a", "rule": "amarillo: 35–54.9"},
    {"id": "naranja", "label": "Riesgo alto", "color": "#ec7a2c", "rule": "naranja: 55–74.9"},
    {"id": "rojo", "label": "Riesgo muy alto", "color": "#c8352f", "rule": "rojo: índice ≥ 75"},
    {"id": "sin_dato", "label": "Sin dato", "color": "#bdbdbd", "rule": "sin_dato: sin información suficiente"},
]

FEATURE_KEYS = [
    "pob_tot",
    "pob_18ymas",
    "pct_18_24",
    "pct_65ymas",
    "graproes",
    "pct_hli",
    "pct_sin_servsalud",
    "pct_internet",
    "pct_rural",
    "pct_analfabeta",
    "pct_po2sm",
    "im_2020",
    "gm_2020",
    "coverage_ln",
]


class ScenarioRequest(BaseModel):
    scenario: Literal["base", "intervencion", "pesimista"]
    params: dict[str, Any] = Field(default_factory=dict)
    level: Literal["state", "mun"] = "mun"
    ent: str | None = None


def _clean_float(val: Any) -> float | None:
    if val is None or pd.isna(val):
        return None
    try:
        f = float(val)
        return None if (np.isnan(f) or np.isinf(f)) else round(f, 6)
    except (ValueError, TypeError):
        return None


def _clean_int(val: Any) -> int | None:
    if val is None or pd.isna(val):
        return None
    try:
        return int(float(val))
    except (ValueError, TypeError):
        return None


def _format_risk_item(d: dict, is_delta_allowed: bool = False) -> dict:
    ent_val = d.get("ent") or d.get("cve_ent") or ""

    risk_comp = None
    if isinstance(d.get("risk_components"), dict):
        rc = d["risk_components"]
        risk_comp = {
            "r_abs": _clean_float(rc.get("r_abs")),
            "r_vuln": _clean_float(rc.get("r_vuln")),
            "r_trend": _clean_float(rc.get("r_trend")),
            "r_vol": _clean_float(rc.get("r_vol")),
        }
    elif any(c in d and d[c] is not None and pd.notna(d[c]) for c in ("r_abs", "r_vuln", "r_trend", "r_vol")):
        risk_comp = {
            "r_abs": _clean_float(d.get("r_abs")),
            "r_vuln": _clean_float(d.get("r_vuln")),
            "r_trend": _clean_float(d.get("r_trend")),
            "r_vol": _clean_float(d.get("r_vol")),
        }

    item: dict[str, Any] = {
        "id": str(d.get("id", "")),
        "name": str(d.get("name", "")),
        "level": str(d.get("level", "mun")),
        "ent": zpad(ent_val, 2) if ent_val else "",
        "lista_nominal": _clean_int(d.get("lista_nominal")),
        "last_year": _clean_int(d.get("last_year")),
        "last_participation": _clean_float(d.get("last_participation")),
        "pred_participation": _clean_float(d.get("pred_participation")),
        "pred_abstention": _clean_float(d.get("pred_abstention")),
        "pred_low": _clean_float(d.get("pred_low")),
        "pred_high": _clean_float(d.get("pred_high")),
        "trend_pp": _clean_float(d.get("trend_pp")),
        "risk_score": _clean_float(d.get("risk_score")),
        "category": str(d.get("category", "sin_dato")),
        "vulnerability_pp": _clean_float(d.get("vulnerability_pp")),
        "abstencion_esperada": _clean_int(d.get("abstencion_esperada")),
        "prioridad": _clean_int(d.get("prioridad")),
        "risk_components": risk_comp,
    }
    if is_delta_allowed and "delta_vs_base_pp" in d:
        item["delta_vs_base_pp"] = _clean_float(d.get("delta_vs_base_pp"))
    return item


def _load_catalog_metadata() -> dict[str, dict[str, str]]:
    meta: dict[str, dict[str, str]] = {}
    var_file = SEED_DIR / "variables.csv"
    if var_file.is_file():
        try:
            with open(var_file, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    key = row.get("key", "").strip()
                    if key:
                        meta[key] = {
                            "label": row.get("label_es", key).strip(),
                            "unit": row.get("unit", "").strip(),
                        }
        except Exception:
            pass
    return meta


def _load_seed_states() -> list[dict[str, str]]:
    states: list[dict[str, str]] = []
    st_file = SEED_DIR / "states.csv"
    if st_file.is_file():
        try:
            with open(st_file, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    cve = row.get("cve_ent", "").strip()
                    name = row.get("name", "").strip()
                    if cve:
                        states.append({"id": zpad(cve, 2), "name": name})
        except Exception:
            pass
    return states


_CLUSTER_INFO_CACHE: dict[str, Any] = {"info": None, "expires_at": 0.0}


def _get_cached_cluster_info() -> dict[str, Any] | None:
    now = time.monotonic()
    if _CLUSTER_INFO_CACHE["info"] is not None and now < _CLUSTER_INFO_CACHE["expires_at"]:
        return _CLUSTER_INFO_CACHE["info"]

    try:
        from atalaya.search_client import cluster_info
        raw = cluster_info(timeout_s=5.0)
        if raw and "distribution" in raw and "version" in raw:
            se: dict[str, Any] | None = {
                "distribution": raw.get("distribution"),
                "version": raw.get("version"),
            }
        else:
            se = None
    except Exception as exc:
        logger.debug("Failed to retrieve cluster_info: %s", exc)
        se = None

    _CLUSTER_INFO_CACHE["info"] = se
    _CLUSTER_INFO_CACHE["expires_at"] = now + 60.0
    return se


@router.get("/health")
def get_health() -> dict[str, Any]:
    try:
        from atalaya.api.main import WARMUP_STATUS
        warmup_state = WARMUP_STATUS.get("status", "ready")
    except Exception:
        warmup_state = "ready"

    try:
        store = get_store()
        stats = store.stats()
        store_kind = store.kind
        store_degraded = getattr(store, "degraded", False)
        data = {
            "units_mun": stats.get("units_mun", 0),
            "units_state": stats.get("units_state", 0),
            "participation_rows": stats.get("participation_rows", 0),
            "years": stats.get("years", []),
        }
    except Exception as exc:
        logger.warning("Error fetching store stats in health: %s", exc)
        store_kind = "memory"
        store_degraded = False
        data = {
            "units_mun": 0,
            "units_state": 0,
            "participation_rows": 0,
            "years": [],
        }

    search_engine = None
    if store_kind == "opensearch":
        search_engine = _get_cached_cluster_info()

    return {
        "status": "ok",
        "store": store_kind,
        "store_degraded": store_degraded,
        "search_engine": search_engine,
        "llm": is_llm_enabled(),
        "warmup": warmup_state,
        "data": data,
    }


@router.get("/meta")
def get_meta() -> dict[str, Any]:
    settings = get_settings()
    store = get_store()
    try:
        stats = store.stats()
        years = stats.get("years", [])
    except Exception:
        years = []

    return {
        "target_year": settings.target_year,
        "years": years,
        "states": _load_seed_states(),
        "scenarios": SCENARIOS,
        "categories": CATEGORIES,
        "store": store.kind,
        "llm": is_llm_enabled(),
        "data_sources": [
            {
                "name": "CCPC",
                "url": "https://ine.mx/transparencia/datos-abiertos/visualizacion-datos/conteos-censales-participacion/",
                "years": [2009, 2012, 2015, 2018, 2021, 2024],
            },
            {
                "name": "INEGI ITER 2020",
                "url": "https://www.inegi.org.mx/programas/ccpv/2020/",
                "years": [2020],
            },
            {
                "name": "CONAPO IMM 2020",
                "url": "https://www.gob.mx/conapo/documentos/indices-de-marginacion-2020-284372",
                "years": [2020],
            },
            {
                "name": "INEGI MG 2024",
                "url": "https://www.inegi.org.mx/temas/mg/",
                "years": [2024],
            },
        ],
    }


@router.get("/risk")
def get_risk(
    level: str = Query("mun", pattern="^(mun|state)$"),
    ent: str | None = None,
    scenario: str = "base",
) -> dict[str, Any]:
    try:
        store = get_store()
        ent_str = zpad(ent, 2) if ent else None

        if scenario == "base":
            df = store.units(level=level, ent=ent_str)
            if ent_str and level == "mun" and not df.empty and "cve_ent" in df.columns:
                df = df[df["cve_ent"] == ent_str]
            items = [_format_risk_item(r.to_dict(), is_delta_allowed=False) for _, r in df.iterrows()]
        else:
            params = default_params(scenario)
            sim_df, _ = cached_simulate(scenario=scenario, params=params, level=level, ent=ent_str)
            items = [_format_risk_item(r.to_dict(), is_delta_allowed=True) for _, r in sim_df.iterrows()]

        return {
            "level": level,
            "scenario": scenario,
            "items": items,
        }
    except StoreError as se:
        raise HTTPException(status_code=503, detail=f"Error en almacén de datos: {se}")
    except ValueError as ve:
        raise HTTPException(status_code=422, detail=str(ve))


@router.post("/scenario/simulate")
def post_simulate(req: ScenarioRequest) -> dict[str, Any]:
    try:
        ent_str = zpad(req.ent, 2) if req.ent else None
        sim_df, summary = cached_simulate(
            scenario=req.scenario,
            params=req.params,
            level=req.level,
            ent=ent_str,
        )
        is_delta = req.scenario != "base"
        items = [_format_risk_item(r.to_dict(), is_delta_allowed=is_delta) for _, r in sim_df.iterrows()]
        return {
            "scenario": req.scenario,
            "params": req.params,
            "level": req.level,
            "items": items,
            "summary": summary,
        }
    except ValueError as ve:
        raise HTTPException(status_code=422, detail=str(ve))
    except StoreError as se:
        raise HTTPException(status_code=503, detail=f"Error en almacén de datos: {se}")


@router.get("/region/{id}")
def get_region(id: str, scenario: str = "base") -> dict[str, Any]:
    store = get_store()
    try:
        unit = store.unit(id)
    except StoreError as se:
        raise HTTPException(status_code=503, detail=f"Error en almacén de datos: {se}")

    if not unit:
        raise HTTPException(status_code=404, detail=f"Región '{id}' no encontrada")

    level = unit.get("level", "mun")
    cve_ent = unit.get("cve_ent", "")
    if cve_ent:
        cve_ent = zpad(cve_ent, 2)

    # 1. Parent
    parent = None
    if level == "mun" and cve_ent:
        parent_unit = store.unit(cve_ent)
        if parent_unit:
            parent = {"id": cve_ent, "name": parent_unit.get("name", "")}

    # 2. Historical series
    try:
        part_df = store.participation([id], level=level, election=None)
        if not part_df.empty:
            part_df = part_df.sort_values(by="year", ascending=True)
            series = []
            for _, r in part_df.iterrows():
                part_val = _clean_float(r.get("participacion"))
                ns_rate = _clean_float(r.get("ns_rate"))
                if ns_rate is None:
                    ns_val = _clean_float(r.get("ns"))
                    ln_val = _clean_float(r.get("lista_nominal"))
                    if ns_val is not None and ln_val is not None and ln_val > 0:
                        ns_rate = round(ns_val / ln_val, 6)

                if "reliable" in r and pd.notna(r["reliable"]):
                    reliable = bool(r["reliable"])
                elif part_val is None:
                    reliable = False
                elif ns_rate is not None:
                    reliable = bool(ns_rate <= 0.5 and part_val >= 0.02)
                else:
                    reliable = bool(part_val >= 0.02)

                if "low_confidence" in r and pd.notna(r["low_confidence"]):
                    low_conf = bool(r["low_confidence"])
                elif ns_rate is not None:
                    low_conf = bool(0.3 < ns_rate <= 0.5)
                else:
                    low_conf = False

                series.append({
                    "year": int(r["year"]),
                    "election": str(r.get("election", "")),
                    "participation": part_val,
                    "lista_nominal": _clean_int(r.get("lista_nominal")) or 0,
                    "reliable": reliable,
                    "low_confidence": low_conf,
                    "ns_rate": ns_rate,
                })
            # Ensure PJF 2025 is included in series
            has_pjf = any(s.get("election") == "PJF" or s.get("year") == 2025 for s in series)
            if not has_pjf:
                pj_val = _clean_float(unit.get("part_pj_2025"))
                if pj_val is not None:
                    series.append({
                        "year": 2025,
                        "election": "PJF",
                        "participation": pj_val,
                        "lista_nominal": _clean_int(unit.get("lista_nominal")) or 0,
                        "reliable": bool(pj_val >= 0.02),
                        "low_confidence": False,
                        "ns_rate": None,
                    })
        else:
            pj_val = _clean_float(unit.get("part_pj_2025"))
            if pj_val is not None:
                series = [{
                    "year": 2025,
                    "election": "PJF",
                    "participation": pj_val,
                    "lista_nominal": _clean_int(unit.get("lista_nominal")) or 0,
                    "reliable": bool(pj_val >= 0.02),
                    "low_confidence": False,
                    "ns_rate": None,
                }]
            else:
                series = []
    except Exception:
        series = []

    # 3. Features with national median
    catalog_meta = _load_catalog_metadata()
    level_units = store.units(level=level)
    features = []
    for k in FEATURE_KEYS:
        val = unit.get(k)
        if val is None or pd.isna(val):
            val_clean = None
        elif isinstance(val, (int, float)):
            val_clean = _clean_float(val)
        else:
            val_clean = str(val)

        nat_med = None
        if not level_units.empty and k in level_units.columns:
            s = pd.to_numeric(level_units[k], errors="coerce").dropna()
            if not s.empty:
                nat_med = _clean_float(s.median())

        meta_info = catalog_meta.get(k, {})
        features.append({
            "key": k,
            "label": meta_info.get("label", k),
            "value": val_clean,
            "unit": meta_info.get("unit", ""),
            "national_median": nat_med,
        })

    # 4. Drivers
    raw_drivers = store.drivers(id)
    drivers = []
    for d in raw_drivers:
        drivers.append({
            "key": str(d.get("key", "")),
            "label": str(d.get("label", d.get("key", ""))),
            "contribution_pp": _clean_float(d.get("contribution_pp")) or 0.0,
            "direction": str(d.get("direction", "sube_abstencion")),
        })

    # 5. Scenarios (base, intervencion, pesimista)
    scenarios_res = []
    for s_id in ["base", "intervencion", "pesimista"]:
        if s_id == "base":
            scenarios_res.append({
                "scenario": s_id,
                "pred_abstention": _clean_float(unit.get("pred_abstention")),
                "category": str(unit.get("category", "sin_dato")),
            })
        else:
            try:
                sim_df, _ = cached_simulate(
                    scenario=s_id,
                    params=default_params(s_id),
                    level=level,
                    ent=cve_ent,
                )
                match = sim_df[sim_df["id"] == id]
                if not match.empty:
                    m_row = match.iloc[0]
                    scenarios_res.append({
                        "scenario": s_id,
                        "pred_abstention": _clean_float(m_row.get("pred_abstention")),
                        "category": str(m_row.get("category", "sin_dato")),
                    })
                else:
                    scenarios_res.append({
                        "scenario": s_id,
                        "pred_abstention": _clean_float(unit.get("pred_abstention")),
                        "category": str(unit.get("category", "sin_dato")),
                    })
            except Exception:
                scenarios_res.append({
                    "scenario": s_id,
                    "pred_abstention": _clean_float(unit.get("pred_abstention")),
                    "category": str(unit.get("category", "sin_dato")),
                })

    # 6. Recommendations
    ref = get_reco_reference(level)
    recos = model_recommend(unit, raw_drivers, ref)
    recommendations = []
    for r in recos:
        recommendations.append({
            "id": str(r.get("id", "")),
            "title": str(r.get("title", "")),
            "rationale": str(r.get("rationale", "")),
            "priority": str(r.get("priority", "baja")),
            "lever": str(r.get("lever", "")),
            "source": str(r.get("source", "rules")),
        })

    # Format base unit risk fields or active scenario overrides
    unit_data = dict(unit)
    if scenario != "base":
        for s in scenarios_res:
            if s["scenario"] == scenario:
                unit_data["pred_abstention"] = s["pred_abstention"]
                unit_data["category"] = s["category"]
                if s["pred_abstention"] is not None:
                    unit_data["pred_participation"] = round(1.0 - s["pred_abstention"], 6)

    raw_profile: list[dict] = []
    try:
        raw_profile = store.profile(id)
        if raw_profile:
            dip_years = sorted(list({int(r["year"]) for r in raw_profile if "year" in r and r["year"] is not None and int(r["year"]) <= 2024}))
            if dip_years:
                target_years = {dip_years[0], dip_years[-1]}
                prof_items = []
                for r in raw_profile:
                    yr = int(r.get("year", 0))
                    if yr in target_years:
                        if level == "mun" and str(r.get("sexo", "")).upper() == "X":
                            continue
                        raw_ln = _clean_int(r.get("ln"))
                        is_sup = bool(r.get("suprimido", False)) or (raw_ln is not None and raw_ln < 10)
                        ln_val = None if is_sup else raw_ln
                        part_val = None if is_sup else _clean_float(r.get("participacion"))
                        prof_items.append({
                            "year": yr,
                            "age_group": str(r.get("age_group", "")),
                            "sexo": str(r.get("sexo", "")),
                            "ln": ln_val,
                            "participation": part_val,
                            "suprimido": is_sup,
                        })
                profile_res = prof_items
            else:
                profile_res = []
        else:
            profile_res = []
    except Exception as exc:
        logger.debug("Error getting profile for %s: %s", id, exc)
        profile_res = []

    # profile_pj (2025 judicial election)
    profile_pj_res = []
    if raw_profile:
        for r in raw_profile:
            yr = int(r.get("year", 0))
            if yr == 2025 or str(r.get("election", "")).upper() == "PJF":
                if level == "mun" and str(r.get("sexo", "")).upper() == "X":
                    continue
                raw_ln = _clean_int(r.get("ln"))
                is_sup = bool(r.get("suprimido", False)) or (raw_ln is not None and raw_ln < 10)
                ln_val = None if is_sup else raw_ln
                part_val = None if is_sup else _clean_float(r.get("participacion"))
                profile_pj_res.append({
                    "year": yr,
                    "age_group": str(r.get("age_group", "")),
                    "sexo": str(r.get("sexo", "")),
                    "ln": ln_val,
                    "participation": part_val,
                    "suprimido": is_sup,
                })

    # pj_2025
    pj_part = _clean_float(unit.get("part_pj_2025"))
    if pj_part is None:
        pjf_pt = next((s for s in series if s.get("election") == "PJF" or s.get("year") == 2025), None)
        if pjf_pt:
            pj_part = pjf_pt.get("participation")
    pj_2025 = {"participation": pj_part}

    # ccpc summary for latest DIP_FED year directly from ccpc_features
    ccpc_data = None
    if hasattr(store, "ccpc_features"):
        try:
            ccpc_data = store.ccpc_features(id)
        except Exception as e:
            logger.debug("Error fetching ccpc_features for %s: %s", id, e)

    if ccpc_data:
        ccpc_res = {
            "pct_ln_18_34": _clean_float(ccpc_data.get("pct_ln_18_34")),
            "part_18_34": _clean_float(ccpc_data.get("part_18_34")),
            "gap_youth_pp": _clean_float(ccpc_data.get("gap_youth_pp")),
            "gap_sexo_pp": _clean_float(ccpc_data.get("gap_sexo_pp")),
            "pct_ln_rural": _clean_float(ccpc_data.get("pct_ln_rural")),
        }
    else:
        ccpc_res = {
            "pct_ln_18_34": _clean_float(unit.get("pct_ln_18_34_last") if unit.get("pct_ln_18_34_last") is not None else unit.get("pct_ln_18_34")),
            "part_18_34": _clean_float(unit.get("part_18_34_last") if unit.get("part_18_34_last") is not None else unit.get("part_18_34")),
            "gap_youth_pp": _clean_float(unit.get("gap_youth_pp_last") if unit.get("gap_youth_pp_last") is not None else unit.get("gap_youth_pp")),
            "gap_sexo_pp": _clean_float(unit.get("gap_sexo_pp_last") if unit.get("gap_sexo_pp_last") is not None else unit.get("gap_sexo_pp")),
            "pct_ln_rural": _clean_float(unit.get("pct_ln_rural_last") if unit.get("pct_ln_rural_last") is not None else unit.get("pct_ln_rural")),
        }

    # imputed_census
    imputed_census = bool(unit.get("imputed_census", False)) if pd.notna(unit.get("imputed_census")) else False

    detail = _format_risk_item(unit_data, is_delta_allowed=(scenario != "base"))
    detail.update({
        "parent": parent,
        "series": series,
        "features": features,
        "drivers": drivers,
        "scenarios": scenarios_res,
        "recommendations": recommendations,
        "profile": profile_res,
        "profile_pj": profile_pj_res,
        "pj_2025": pj_2025,
        "ccpc": ccpc_res,
        "imputed_census": imputed_census,
    })
    return detail


@router.get("/ranking")
def get_ranking(
    level: str = Query("mun", pattern="^(mun|state)$"),
    ent: str | None = None,
    scenario: str = "base",
    limit: int = Query(20, ge=1, le=100),
    sort: str = Query("risk", pattern="^(risk|abstencion_esperada|prioridad)$"),
) -> dict[str, Any]:
    store = get_store()
    ent_str = zpad(ent, 2) if ent else None

    try:
        if scenario == "base":
            df = store.units(level=level, ent=ent_str)
            if ent_str and level == "mun" and not df.empty and "cve_ent" in df.columns:
                df = df[df["cve_ent"] == ent_str]
            is_delta = False
        else:
            sim_df, _ = cached_simulate(
                scenario=scenario,
                params=default_params(scenario),
                level=level,
                ent=ent_str,
            )
            df = sim_df
            is_delta = True

        if df.empty:
            return {"items": []}

        if sort == "abstencion_esperada":
            valid = df.copy()
            if "abstencion_esperada" in valid.columns:
                valid["_sort_val"] = pd.to_numeric(valid["abstencion_esperada"], errors="coerce")
            elif "pred_abstention" in valid.columns and "lista_nominal" in valid.columns:
                valid["_sort_val"] = pd.to_numeric(valid["pred_abstention"], errors="coerce") * pd.to_numeric(valid["lista_nominal"], errors="coerce")
            else:
                valid["_sort_val"] = np.nan
            valid = valid[valid["_sort_val"].notna()]
            valid = valid.sort_values(by="_sort_val", ascending=False).head(limit)
        elif sort == "prioridad":
            valid = df.copy()
            if "prioridad" in valid.columns and valid["prioridad"].notna().any():
                valid["_sort_val"] = pd.to_numeric(valid["prioridad"], errors="coerce")
                valid = valid[valid["_sort_val"].notna()]
                valid = valid.sort_values(by="_sort_val", ascending=True).head(limit)
            else:
                valid = valid[valid["category"].isin(["rojo", "naranja"])].copy()
                if "abstencion_esperada" in valid.columns:
                    valid["_sort_val"] = pd.to_numeric(valid["abstencion_esperada"], errors="coerce")
                elif "pred_abstention" in valid.columns and "lista_nominal" in valid.columns:
                    valid["_sort_val"] = pd.to_numeric(valid["pred_abstention"], errors="coerce") * pd.to_numeric(valid["lista_nominal"], errors="coerce")
                else:
                    valid["_sort_val"] = np.nan
                valid = valid[valid["_sort_val"].notna()]
                valid = valid.sort_values(by="_sort_val", ascending=False).head(limit)
                valid["prioridad"] = range(1, len(valid) + 1)
        else:
            if "risk_score" not in df.columns:
                return {"items": []}
            valid = df[df["category"] != "sin_dato"].copy()
            valid["_score_num"] = pd.to_numeric(valid["risk_score"], errors="coerce")
            valid = valid[valid["_score_num"].notna()]
            valid = valid.sort_values(by="_score_num", ascending=False).head(limit)

        items = [_format_risk_item(r.to_dict(), is_delta_allowed=is_delta) for _, r in valid.iterrows()]
        return {"items": items}
    except StoreError as se:
        raise HTTPException(status_code=503, detail=f"Error en almacén de datos: {se}")


@router.get("/metrics")
def get_metrics() -> dict[str, Any]:
    store = get_store()
    try:
        m = store.metrics()
        if m:
            return m
    except Exception as exc:
        logger.warning("Error fetching metrics: %s", exc)

    settings = get_settings()
    return {
        "target_year": settings.target_year,
        "train_years": [],
        "backtests": [],
        "coefficients": [],
        "structural_r2_within_state": None,
        "structural_r2_state_cv": None,
        "between_state_share": None,
        "calibration_pp": None,
        "generated_at": "",
        "data_sources": [],
    }


@router.post("/admin/reload")
def post_reload(request: Request) -> dict[str, Any]:
    from atalaya.api.security import verify_admin_access

    verify_admin_access(request)
    try:
        _CLUSTER_INFO_CACHE["info"] = None
        _CLUSTER_INFO_CACHE["expires_at"] = 0.0

        stats = reload_all()
        store = get_store()
        store_kind = store.kind
        store_degraded = getattr(store, "degraded", False)

        search_engine = None
        if store_kind == "opensearch":
            search_engine = _get_cached_cluster_info()

        return {
            "status": "ok",
            "store": store_kind,
            "store_degraded": store_degraded,
            "search_engine": search_engine,
            "stats": stats,
        }
    except Exception as exc:
        msg = _clean_error_message(exc)
        logger.error("Error during reload: %s", msg)
        raise HTTPException(status_code=500, detail=f"Error durante reload: {msg}")


@router.get("/admin/guardrails")
def get_admin_guardrails(request: Request) -> dict[str, Any]:
    from atalaya.api.security import verify_admin_access

    verify_admin_access(request)
    from atalaya.chat import guardrails

    return guardrails.stats()


