"""Deterministic explanation engine for geographic units (states and municipalities).

Translates predictive and diagnostic models into plain-language explanations
structured strictly by evidence hierarchy and scientific strength.
"""
from __future__ import annotations

import bisect
from dataclasses import dataclass
from datetime import datetime, timezone
import logging
from pathlib import Path
import threading
import time
from typing import Any

import numpy as np
import pandas as pd

from atalaya.config import BUILD_DIR
from atalaya.explain.schemas import (
    EvidenceType,
    ExplainNumber,
    ExplainReason,
    Explanation,
    GroupGap,
    Level,
    Recommendation,
    ScoreComponent,
    Strength,
    SuggestedQuestion,
)
from atalaya.explain.texts import (
    ASSOC_META,
    EVIDENCE_TYPE_WORDS,
    STRENGTH_WORDS,
    age_label,
    clean_recommendation_rationale,
    color_and_risk,
    color_words,
    component_title_word,
    fmt_fraction,
    fmt_int,
    fmt_pct,
    fmt_pts,
    plain_abstention,
    plain_trend,
    plain_volatility,
    plain_vulnerability,
    semaforo_title,
    zone_noun,
)
from atalaya.model.risk import WEIGHTS, category_for

try:
    from atalaya.privacy import drop_nonbinary_below_state, suppress_small_cells
except ImportError:
    def suppress_small_cells(df: pd.DataFrame, **kwargs) -> pd.DataFrame:
        out = df.copy()
        if "ln" in out.columns:
            mask = pd.to_numeric(out["ln"], errors="coerce").fillna(0) < 10
            out["suprimido"] = mask
            for c in ["sv", "nv", "ns", "participacion"]:
                if c in out.columns:
                    out.loc[mask, c] = np.nan
        return out

    def drop_nonbinary_below_state(df: pd.DataFrame, **kwargs) -> pd.DataFrame:
        if df.empty or "sexo" not in df.columns:
            return df
        return df[df["sexo"].astype(str).str.upper() != "X"].copy()


logger = logging.getLogger(__name__)

# Fallback dataclasses for Reference when reference.py is missing or being built
@dataclass(frozen=True)
class AssocStat:
    var: str
    level: str
    rho: float
    n: int
    unfavorable_high: bool
    p25: float
    p50: float
    p75: float


@dataclass(frozen=True)
class Reference:
    national_participation: dict[int, float]
    state_participation: dict[tuple[str, int], float]
    mean_mun_participation: dict[int, float]
    associations: dict[str, dict[str, AssocStat]]
    level_values: dict[str, dict[str, list[float]]]
    context: dict[str, dict[str, float]]


# In-memory cache for explanations: unit_id -> (timestamp, Explanation)
_EXPLAIN_CACHE: dict[str, tuple[float, Explanation]] = {}
_CACHE_LOCK = threading.Lock()
_CACHE_TTL_SECONDS = 600.0  # 10 minutes

# Cached sections dataframe: (mtime, DataFrame)
_SECCIONES_CACHE: tuple[float, pd.DataFrame] | None = None
_SECCIONES_LOCK = threading.Lock()


def clear_explain_cache() -> None:
    """Clear in-memory explanation cache."""
    with _CACHE_LOCK:
        _EXPLAIN_CACHE.clear()


def percentile_of(ref: Any, level: str, var: str, value: float | None) -> float | None:
    """Return percentage of zones strictly below value (0..100, 1 decimal). None if missing."""
    if value is None or pd.isna(value) or ref is None:
        return None
    try:
        from atalaya.explain.reference import percentile_of as mod_percentile_of
        return mod_percentile_of(ref, level, var, value)
    except Exception:
        pass

    lvl_dict = getattr(ref, "level_values", {})
    if not isinstance(lvl_dict, dict):
        return None
    var_dict = lvl_dict.get(level, {})
    vals = var_dict.get(var)
    if not vals:
        return None
    val_float = float(value)
    count_less = bisect.bisect_left(vals, val_float)
    return round(100.0 * count_less / len(vals), 1)


def _get_default_reference(store: Any) -> Any:
    """Retrieve or compute reference stats."""
    try:
        from atalaya.explain.reference import get_reference
        return get_reference(store)
    except Exception as exc:
        logger.debug("Could not import or call get_reference: %s", exc)
        return Reference(
            national_participation={},
            state_participation={},
            mean_mun_participation={},
            associations={"mun": {}, "state": {}},
            level_values={"mun": {}, "state": {}},
            context={},
        )


def _load_secciones(build_dir: Path | None = None) -> pd.DataFrame:
    """Load ccpc_seccion_mun.parquet with in-memory caching."""
    global _SECCIONES_CACHE
    path = (build_dir or BUILD_DIR) / "ccpc_seccion_mun.parquet"
    if not path.is_file():
        return pd.DataFrame()

    try:
        mtime = path.stat().st_mtime
    except Exception:
        return pd.DataFrame()

    with _SECCIONES_LOCK:
        if _SECCIONES_CACHE is not None and _SECCIONES_CACHE[0] == mtime:
            return _SECCIONES_CACHE[1]
        try:
            df = pd.read_parquet(path)
            _SECCIONES_CACHE = (mtime, df)
            return df
        except Exception as exc:
            logger.warning("Error reading %s: %s", path, exc)
            return pd.DataFrame()


def build_explanation(
    unit_id: str,
    *,
    store: Any = None,
    ref: Any | None = None,
) -> Explanation:
    """Build a deterministic explanation for a state or municipality.

    Parameters
    ----------
    unit_id : str
        2-digit state code or 5-digit municipality cvegeo.
    store : DataStore | None
        DataStore instance (defaults to atalaya.store.get_store()).
    ref : Reference | None
        National reference statistics (defaults to reference.get_reference(store)).

    Returns
    -------
    Explanation
        Pydantic model conforming to contract schemas.
    """
    uid = str(unit_id).strip()

    # Check cache if store and ref are defaults
    if store is None and ref is None:
        with _CACHE_LOCK:
            if uid in _EXPLAIN_CACHE:
                cached_time, cached_expl = _EXPLAIN_CACHE[uid]
                if time.time() - cached_time < _CACHE_TTL_SECONDS:
                    return cached_expl

    if store is None:
        from atalaya.store import get_store
        store = get_store()

    if ref is None:
        ref = _get_default_reference(store)

    u = store.unit(uid)
    if u is None:
        raise KeyError(f"Zona '{unit_id}' no encontrada en el almacén de datos.")

    level: Level = "mun" if len(uid) > 2 or str(u.get("level", "")).lower() == "mun" else "state"
    name = str(u.get("name", uid))
    cve_ent = str(u.get("cve_ent", uid[:2])).zfill(2)

    # State name lookup for municipalities
    state_name: str | None = None
    if level == "mun":
        st_unit = store.unit(cve_ent) if hasattr(store, "unit") else None
        if st_unit:
            state_name = str(st_unit.get("name", ""))
        if not state_name:
            state_name = f"Estado {cve_ent}"

    # Model metrics & values
    risk_score_raw = u.get("risk_score")
    risk_score = round(float(risk_score_raw), 1) if (risk_score_raw is not None and pd.notna(risk_score_raw)) else None
    category = str(u.get("category", category_for(risk_score)))
    pred_abs_raw = u.get("pred_abstention")
    pred_abs = float(pred_abs_raw) if (pred_abs_raw is not None and pd.notna(pred_abs_raw)) else None
    pred_abs_pct = round(pred_abs * 100.0, 1) if pred_abs is not None else None

    trend_pp_raw = u.get("trend_pp")
    trend_pp = float(trend_pp_raw) if (trend_pp_raw is not None and pd.notna(trend_pp_raw)) else 0.0

    vol_raw = u.get("volatility_pp")
    volatility_pp = abs(float(vol_raw)) if (vol_raw is not None and pd.notna(vol_raw)) else 0.0

    r_abs = float(u.get("r_abs", 0.5) if pd.notna(u.get("r_abs")) else 0.5)
    r_vuln = float(u.get("r_vuln", 0.5) if pd.notna(u.get("r_vuln")) else 0.5)
    r_trend = float(u.get("r_trend", 0.5) if pd.notna(u.get("r_trend")) else 0.5)
    r_vol = float(u.get("r_vol", 0.5) if pd.notna(u.get("r_vol")) else 0.5)

    pred_low_disp = fmt_pct(u.get("pred_low"))
    pred_high_disp = fmt_pct(u.get("pred_high"))

    # Historical federal participation
    part_df = pd.DataFrame()
    if hasattr(store, "participation"):
        try:
            part_df = store.participation([uid], level=level, election=None)
        except Exception as exc:
            logger.debug("Error fetching participation: %s", exc)

    reliable_df = pd.DataFrame()
    if not part_df.empty and "election" in part_df.columns:
        dip_part = part_df[part_df["election"] == "DIP_FED"].copy()
        if not dip_part.empty:
            if "reliable" in dip_part.columns and dip_part["reliable"].any():
                reliable_df = dip_part[dip_part["reliable"].astype(bool)].sort_values(by="year")
            else:
                reliable_df = dip_part.sort_values(by="year")

    # Metrics MAE
    store_metrics = store.metrics() if hasattr(store, "metrics") else {}
    bts = store_metrics.get("backtests", [])
    maes = [bt.get("mae_pp", bt.get("mae")) for bt in bts if bt.get("mae_pp") is not None or bt.get("mae") is not None]
    mae = round(float(sum(maes) / len(maes)), 1) if maes else 6.0

    # Demographic profile
    target_year = 2024
    if not reliable_df.empty and "year" in reliable_df.columns:
        y_max = int(reliable_df["year"].max())
        if y_max <= 2024:
            target_year = y_max

    raw_profile = []
    if hasattr(store, "profile"):
        try:
            raw_profile = store.profile(uid, year=target_year)
            if not raw_profile and target_year != 2024:
                raw_profile = store.profile(uid, year=2024)
                if raw_profile:
                    target_year = 2024
        except Exception as exc:
            logger.debug("Error fetching profile: %s", exc)

    # Clean profile with privacy rules
    profile_df = pd.DataFrame(raw_profile)
    if not profile_df.empty:
        if "year" in profile_df.columns:
            profile_df = profile_df[profile_df["year"] == target_year]
        profile_df = drop_nonbinary_below_state(profile_df)
        profile_df = suppress_small_cells(profile_df)

    reasons: list[ExplainReason] = []
    score_breakdown: list[ScoreComponent] = []

    # -------------------------------------------------------------
    # 1. SEMAFORO REASON
    # -------------------------------------------------------------
    if risk_score is not None:
        w_abs = float(WEIGHTS.get("pred_abstention", 0.50))
        w_vuln = float(WEIGHTS.get("vulnerability", 0.20))
        w_trend = float(WEIGHTS.get("trend", 0.15))
        w_vol = float(WEIGHTS.get("volatility", 0.15))

        pts_abs = round(w_abs * r_abs * 100.0, 1)
        pts_vuln = round(w_vuln * r_vuln * 100.0, 1)
        pts_trend = round(w_trend * r_trend * 100.0, 1)
        pts_vol = round(w_vol * r_vol * 100.0, 1)

        zonas_plural = zone_noun(level, plural=True)
        pred_abs_disp = fmt_pct(pred_abs)

        plain_abs = plain_abstention(pts_abs, risk_score, pred_abs_disp, r_abs * 100.0, zonas_plural)
        plain_vuln = plain_vulnerability(pts_vuln, r_vuln * 100.0, zonas_plural)
        plain_trend_text = plain_trend(pts_trend, trend_pp)
        plain_vol = plain_volatility(pts_vol, volatility_pp, r_vol * 100.0, zonas_plural)

        score_breakdown = [
            ScoreComponent(
                key="abs",
                label="Abstención esperada",
                weight=w_abs,
                rank_pct=round(r_abs * 100.0, 1),
                points=pts_abs,
                plain=plain_abs,
            ),
            ScoreComponent(
                key="vuln",
                label="Perfil de la zona",
                weight=w_vuln,
                rank_pct=round(r_vuln * 100.0, 1),
                points=pts_vuln,
                plain=plain_vuln,
            ),
            ScoreComponent(
                key="trend",
                label="Tendencia",
                weight=w_trend,
                rank_pct=round(r_trend * 100.0, 1),
                points=pts_trend,
                plain=plain_trend_text,
            ),
            ScoreComponent(
                key="vol",
                label="Volatilidad",
                weight=w_vol,
                rank_pct=round(r_vol * 100.0, 1),
                points=pts_vol,
                plain=plain_vol,
            ),
        ]

        comps_by_points = sorted(score_breakdown, key=lambda c: c.points, reverse=True)
        top1 = comps_by_points[0]
        top2 = comps_by_points[1]

        sem_title = semaforo_title(category, risk_score, component_title_word(top1.key))
        sem_body = f"{top1.plain} {top2.plain}"

        sem_numbers = [
            ExplainNumber(
                key="risk_score",
                label="Índice de riesgo",
                value=risk_score,
                unit="indice",
                display=f"{risk_score:.1f} de 100",
            ),
            ExplainNumber(
                key="pred_abstention",
                label="Abstención esperada 2027",
                value=pred_abs_pct,
                unit="pct",
                display=pred_abs_disp,
            ),
            ExplainNumber(
                key="rank_abs",
                label="Posición relativa de abstención",
                value=round(r_abs * 100.0, 1),
                unit="pct",
                display=f"{round(r_abs * 100)} %",
            ),
        ]

        reasons.append(
            ExplainReason(
                id="r1",
                kind="semaforo",
                title=sem_title,
                body=sem_body,
                strength="fuerte",
                evidence_type="calculo_del_modelo",
                direction="sube_abstencion" if category in ("rojo", "naranja") else "neutral",
                numbers=sem_numbers,
                source="Atalaya Electoral · Pronóstico 2027",
            )
        )

    # -------------------------------------------------------------
    # 2. HISTORIAL REASON
    # -------------------------------------------------------------
    gaps: list[float] = []
    years_list: list[int] = []
    zone_parts: dict[int, float] = {}

    if not reliable_df.empty:
        for _, row in reliable_df.iterrows():
            yr = int(row["year"])
            p_zona = None
            if level == "state" and ref and hasattr(ref, "state_participation"):
                st_p = ref.state_participation.get((cve_ent, yr))
                if st_p is None:
                    st_p = ref.state_participation.get((uid, yr))
                if st_p is not None and pd.notna(st_p):
                    p_zona = float(st_p)

            if p_zona is None:
                raw_part = row.get("participacion")
                if raw_part is None or pd.isna(raw_part):
                    vt = row.get("votos_totales")
                    nv = row.get("nv")
                    if vt is not None and nv is not None and (float(vt) + float(nv)) > 0:
                        raw_part = float(vt) / (float(vt) + float(nv))
                if raw_part is not None and pd.notna(raw_part):
                    p_zona = float(raw_part)

            if p_zona is not None and ref and hasattr(ref, "national_participation") and yr in ref.national_participation:
                nat_p = float(ref.national_participation[yr])
                gap_val = 100.0 * (p_zona - nat_p)
                gaps.append(gap_val)
                years_list.append(yr)
                zone_parts[yr] = p_zona
    elif level == "state" and ref and hasattr(ref, "state_participation") and hasattr(ref, "national_participation"):
        for (st_id, yr), st_p in sorted(ref.state_participation.items(), key=lambda x: x[0][1]):
            if (st_id == cve_ent or st_id == uid) and yr in ref.national_participation and pd.notna(st_p):
                nat_p = float(ref.national_participation[yr])
                gap_val = 100.0 * (float(st_p) - nat_p)
                gaps.append(gap_val)
                years_list.append(yr)
                zone_parts[yr] = float(st_p)

    if gaps:
        n_elec = len(gaps)
        years_below = sum(1 for g in gaps if g < 0)
        years_above = n_elec - years_below
        avg_gap = sum(gaps) / n_elec
        first_year = min(years_list)

        # State comparison for municipalities
        k_st = 0
        n_st = 0
        if level == "mun" and state_name:
            for yr in years_list:
                st_key = (cve_ent, yr)
                if st_key in ref.state_participation:
                    n_st += 1
                    st_p = float(ref.state_participation[st_key])
                    if years_below > n_elec / 2:
                        if zone_parts[yr] < st_p:
                            k_st += 1
                    else:
                        if zone_parts[yr] > st_p:
                            k_st += 1

        state_phrase = ""
        st_num_display = ""
        if level == "mun" and n_st > 0:
            st_comp_word = "menos" if years_below > n_elec / 2 else "más"
            state_phrase = f", y {st_comp_word} que el promedio de {state_name} en {k_st} de {n_st}"
            st_num_display = f"{k_st} de {n_st}"

        hist_numbers = [
            ExplainNumber(
                key="years_count",
                label="Elecciones analizadas",
                value=float(n_elec),
                unit="elecciones",
                display=f"{n_elec}",
            ),
            ExplainNumber(
                key="first_year",
                label="Primer año de la serie",
                value=float(first_year),
                unit="elecciones",
                display=str(first_year),
            ),
            ExplainNumber(
                key="avg_gap",
                label="Diferencia promedio con el país",
                value=round(abs(avg_gap), 1),
                unit="pp",
                display=f"{abs(avg_gap):.1f} puntos",
            ),
            ExplainNumber(
                key="model_mae",
                label="Error típico del modelo",
                value=mae,
                unit="pp",
                display=f"±{mae:.1f} puntos",
            ),
            ExplainNumber(
                key="test_years",
                label="Años de validación",
                value=None,
                unit="elecciones",
                display="2021 y 2024",
            ),
            ExplainNumber(
                key="proj_year",
                label="Año proyectado",
                value=2027,
                unit="elecciones",
                display="2027",
            ),
        ]

        if st_num_display:
            hist_numbers.append(
                ExplainNumber(
                    key="state_contrast",
                    label="Contraste con su estado",
                    value=float(k_st),
                    unit="elecciones",
                    display=st_num_display,
                )
            )

        if years_below > n_elec / 2:
            hist_numbers.append(
                ExplainNumber(
                    key="years_below",
                    label="Elecciones bajo el promedio",
                    value=float(years_below),
                    unit="elecciones",
                    display=f"{years_below} de {n_elec}",
                )
            )
            if years_below >= 5 or (n_elec in (4, 5) and years_below == n_elec):
                hist_strength: Strength = "fuerte"
                hist_title = "Aquí casi siempre se vota menos que en el resto del país"
            elif years_below >= 4:
                hist_strength = "moderada"
                hist_title = "En la mayoría de las elecciones se vota menos que en el resto del país"
            else:
                hist_strength = "debil"
                hist_title = "En la mayoría de las elecciones se vota menos que en el resto del país"

            hist_body = (
                f"En {years_below} de {n_elec} elecciones federales desde {first_year} votó menos que el promedio nacional, "
                f"en promedio {abs(avg_gap):.1f} puntos menos{state_phrase}. El pronóstico 2027 se apoya sobre todo en este patrón; "
                f"en las pruebas con 2021 y 2024 se equivocó en promedio ±{mae:.1f} puntos."
            )
            hist_dir = "sube_abstencion"
        elif years_above > n_elec / 2:
            hist_numbers.append(
                ExplainNumber(
                    key="years_above",
                    label="Elecciones sobre el promedio",
                    value=float(years_above),
                    unit="elecciones",
                    display=f"{years_above} de {n_elec}",
                )
            )
            if years_above >= 5 or (n_elec in (4, 5) and years_above == n_elec):
                hist_strength = "fuerte"
                hist_title = "Aquí casi siempre se vota más que en el resto del país"
            elif years_above >= 4:
                hist_strength = "moderada"
                hist_title = "En la mayoría de las elecciones se vota más que en el resto del país"
            else:
                hist_strength = "debil"
                hist_title = "En la mayoría de las elecciones se vota más que en el resto del país"

            hist_body = (
                f"En {years_above} de {n_elec} elecciones federales desde {first_year} votó más que el promedio nacional, "
                f"en promedio {abs(avg_gap):.1f} puntos más{state_phrase}. El pronóstico 2027 se apoya sobre todo en este patrón; "
                f"en las pruebas con 2021 y 2024 se equivocó en promedio ±{mae:.1f} puntos."
            )
            hist_dir = "baja_abstencion"
        else:
            hist_strength = "debil"
            hist_title = "Su participación es similar al promedio nacional"
            hist_body = (
                f"En {years_below} de {n_elec} elecciones federales desde {first_year} votó menos que el promedio nacional, "
                f"en promedio {abs(avg_gap):.1f} puntos de diferencia{state_phrase}. El pronóstico 2027 se apoya sobre todo en este patrón; "
                f"en las pruebas con 2021 y 2024 se equivocó en promedio ±{mae:.1f} puntos."
            )
            hist_dir = "neutral"

        reasons.append(
            ExplainReason(
                id="historial",
                kind="historial",
                title=hist_title,
                body=hist_body,
                strength=hist_strength,
                evidence_type="dato_medido",
                direction=hist_dir,
                numbers=hist_numbers,
                source="INE · Conteos Censales de Participación 2009–2024",
            )
        )

    # -------------------------------------------------------------
    # 3. QUIEN NO VOTA REASON & GROUPS
    # -------------------------------------------------------------
    groups_list: list[GroupGap] = []
    if not profile_df.empty:
        df_p = profile_df.copy()
        for col in ["ln", "sv", "nv", "ns"]:
            if col in df_p.columns:
                df_p[col] = pd.to_numeric(df_p[col], errors="coerce")

        if "suprimido" not in df_p.columns:
            df_p["suprimido"] = df_p["ln"].fillna(0) < 10

        # Requirement 2: Use only sexo H and M for age groups
        if "sexo" in df_p.columns:
            df_hm = df_p[df_p["sexo"].astype(str).str.upper().isin(["H", "M"])].copy()
        else:
            df_hm = df_p.copy()

        # Cell is protected if suprimido==True, ln < 10 or ln is NaN
        is_cell_prot = (
            df_hm["suprimido"].fillna(False).astype(bool)
            | (df_hm["ln"].fillna(0) < 10)
            | df_hm["ln"].isna()
        )
        valid_cells = df_hm[~is_cell_prot].copy()

        tot_ln = float(valid_cells["ln"].sum()) if not valid_cells.empty else 0.0
        tot_nv = float(valid_cells["nv"].sum()) if not valid_cells.empty else 0.0
        tot_sv = float(valid_cells["sv"].sum()) if not valid_cells.empty else 0.0
        tot_part = (tot_sv / (tot_sv + tot_nv)) if (tot_sv + tot_nv) > 0 else 0.0

        age_stats = []
        suppressed_groups: list[GroupGap] = []

        for ag, grp in df_hm.groupby("age_group", observed=False):
            ag_str = str(ag)
            # A group is suppressed ONLY if all its H/M cells are protected
            grp_valid = grp[
                ~grp["suprimido"].fillna(False).astype(bool)
                & (grp["ln"].fillna(0) >= 10)
                & grp["ln"].notna()
            ]
            if grp_valid.empty or tot_ln <= 0 or tot_nv <= 0:
                suppressed_groups.append(
                    GroupGap(
                        group=age_label(ag_str),
                        participation_pct=None,
                        share_ln_pct=None,
                        share_abstainers_pct=None,
                        suppressed=True,
                    )
                )
            else:
                ln_g = float(grp_valid["ln"].sum())
                nv_g = float(grp_valid["nv"].sum())
                sv_g = float(grp_valid["sv"].sum())
                part_g = (sv_g / (sv_g + nv_g)) if (sv_g + nv_g) > 0 else 0.0
                sh_ln = ln_g / tot_ln
                sh_nv = nv_g / tot_nv
                overrep = sh_nv - sh_ln
                age_stats.append({
                    "age_group": ag_str,
                    "part": part_g,
                    "share_ln": sh_ln,
                    "share_abst": sh_nv,
                    "overrep": overrep,
                    "ln": ln_g,
                })

        # Gender calculation on valid_cells
        m_cells = valid_cells[valid_cells["sexo"].astype(str).str.upper() == "M"]
        h_cells = valid_cells[valid_cells["sexo"].astype(str).str.upper() == "H"]
        part_m = None
        part_h = None
        if not m_cells.empty and (m_cells["sv"].sum() + m_cells["nv"].sum()) > 0 and m_cells["ln"].sum() >= 10:
            part_m = float(m_cells["sv"].sum()) / (float(m_cells["sv"].sum()) + float(m_cells["nv"].sum()))
        if not h_cells.empty and (h_cells["sv"].sum() + h_cells["nv"].sum()) > 0 and h_cells["ln"].sum() >= 10:
            part_h = float(h_cells["sv"].sum()) / (float(h_cells["sv"].sum()) + float(h_cells["nv"].sum()))

        # Build GroupGap objects (top 3 lowest age groups + lowest gender)
        sorted_age_stats = sorted(age_stats, key=lambda x: x["part"])
        for stat in sorted_age_stats[:3]:
            groups_list.append(
                GroupGap(
                    group=age_label(stat["age_group"]),
                    participation_pct=round(stat["part"] * 100.0, 1),
                    share_ln_pct=round(stat["share_ln"] * 100.0, 1),
                    share_abstainers_pct=round(stat["share_abst"] * 100.0, 1),
                    suppressed=False,
                )
            )

        if part_m is not None and part_h is not None:
            if part_m < part_h:
                sh_m_ln = float(m_cells["ln"].sum()) / tot_ln if tot_ln > 0 else 0.5
                sh_m_nv = float(m_cells["nv"].sum()) / tot_nv if tot_nv > 0 else 0.5
                groups_list.append(
                    GroupGap(
                        group="Mujeres",
                        participation_pct=round(part_m * 100.0, 1),
                        share_ln_pct=round(sh_m_ln * 100.0, 1),
                        share_abstainers_pct=round(sh_m_nv * 100.0, 1),
                        suppressed=False,
                    )
                )
            else:
                sh_h_ln = float(h_cells["ln"].sum()) / tot_ln if tot_ln > 0 else 0.5
                sh_h_nv = float(h_cells["nv"].sum()) / tot_nv if tot_nv > 0 else 0.5
                groups_list.append(
                    GroupGap(
                        group="Hombres",
                        participation_pct=round(part_h * 100.0, 1),
                        share_ln_pct=round(sh_h_ln * 100.0, 1),
                        share_abstainers_pct=round(sh_h_nv * 100.0, 1),
                        suppressed=False,
                    )
                )

        # Do not list protected groups unless none with data remain
        if not groups_list and suppressed_groups:
            groups_list = suppressed_groups

        # Build ExplainReason for quien_no_vota
        if age_stats:
            best_group = max(age_stats, key=lambda x: x["overrep"])
            bg_label = age_label(best_group["age_group"])
            qnv_title = f"Quienes menos votan aquí son las personas de {bg_label}"

            sh_ln_disp = fmt_pct(best_group["share_ln"])
            sh_abst_disp = fmt_pct(best_group["share_abst"])
            part_disp = fmt_pct(best_group["part"])
            part_tot_disp = fmt_pct(tot_part)

            sex_phrase = ""
            sex_numbers: list[ExplainNumber] = []
            if part_m is not None and part_h is not None and abs(part_m - part_h) >= 0.03:
                pm_disp = fmt_pct(part_m)
                ph_disp = fmt_pct(part_h)
                if part_m < part_h:
                    sex_phrase = f" Además, las mujeres votaron menos que los hombres ({pm_disp} contra {ph_disp})."
                else:
                    sex_phrase = f" Además, los hombres votaron menos que las mujeres ({ph_disp} contra {pm_disp})."
                sex_numbers.extend([
                    ExplainNumber(key="part_m", label="Participación mujeres", value=round(part_m * 100, 1), unit="pct", display=pm_disp),
                    ExplainNumber(key="part_h", label="Participación hombres", value=round(part_h * 100, 1), unit="pct", display=ph_disp),
                ])

            qnv_body = (
                f"Son el {sh_ln_disp} de la lista nominal pero el {sh_abst_disp} de quienes no votaron en {target_year}: "
                f"votó el {part_disp} de ellas, contra el {part_tot_disp} del total.{sex_phrase}"
            )

            qnv_strength: Strength = "fuerte" if tot_ln >= 1000 else "moderada"

            qnv_numbers = [
                ExplainNumber(key="target_year", label="Año censal", value=float(target_year), unit="elecciones", display=str(target_year)),
                ExplainNumber(key="share_ln", label="Porcentaje de lista nominal", value=round(best_group["share_ln"] * 100, 1), unit="pct", display=sh_ln_disp),
                ExplainNumber(key="share_abst", label="Porcentaje de abstencionistas", value=round(best_group["share_abst"] * 100, 1), unit="pct", display=sh_abst_disp),
                ExplainNumber(key="part_group", label=f"Participación {bg_label}", value=round(best_group["part"] * 100, 1), unit="pct", display=part_disp),
                ExplainNumber(key="part_total", label="Participación total", value=round(tot_part * 100, 1), unit="pct", display=part_tot_disp),
            ] + sex_numbers

            reasons.append(
                ExplainReason(
                    id="quien_no_vota",
                    kind="quien_no_vota",
                    title=qnv_title,
                    body=qnv_body,
                    strength=qnv_strength,
                    evidence_type="dato_medido",
                    direction="sube_abstencion",
                    numbers=qnv_numbers,
                    source=f"INE · Conteos Censales de Participación Ciudadana {target_year}",
                )
            )

    # -------------------------------------------------------------
    # 4. URBANO RURAL REASON
    # -------------------------------------------------------------
    has_urbano_rural = False
    sec_df = _load_secciones()
    if not sec_df.empty:
        id_filter = sec_df["cvegeo"].astype(str) == uid if level == "mun" else sec_df["cve_ent"].astype(str).str.zfill(2) == cve_ent
        sec_sub = sec_df[id_filter].copy()
        if not sec_sub.empty and "election" in sec_sub.columns:
            sec_dip = sec_sub[sec_sub["election"] == "DIP_FED"]
            if not sec_dip.empty:
                max_sec_year = int(sec_dip["year"].max())
                sec_dip_latest = sec_dip[sec_dip["year"] == max_sec_year]

                r_sec = sec_dip_latest[sec_dip_latest["tiposec"].astype(str).str.upper() == "R"]
                u_sec = sec_dip_latest[sec_dip_latest["tiposec"].astype(str).str.upper() == "U"]

                ln_r = float(r_sec["ln"].sum()) if not r_sec.empty else 0.0
                ln_u = float(u_sec["ln"].sum()) if not u_sec.empty else 0.0
                tot_sec_ln = float(sec_dip_latest["ln"].sum()) if not sec_dip_latest.empty else 1.0

                if ln_r >= 500 and ln_u >= 500:
                    sv_r = float(r_sec["sv"].sum())
                    nv_r = float(r_sec["nv"].sum())
                    sv_u = float(u_sec["sv"].sum())
                    nv_u = float(u_sec["nv"].sum())

                    part_r = sv_r / (sv_r + nv_r) if (sv_r + nv_r) > 0 else 0.0
                    part_u = sv_u / (sv_u + nv_u) if (sv_u + nv_u) > 0 else 0.0
                    diff_ur = abs(part_r - part_u) * 100.0

                    if diff_ur >= 3.0:
                        has_urbano_rural = True
                        sh_r_ln = ln_r / tot_sec_ln if tot_sec_ln > 0 else 0.0
                        pr_disp = fmt_pct(part_r)
                        pu_disp = fmt_pct(part_u)
                        diff_disp = fmt_pts(diff_ur)
                        sh_r_disp = fmt_pct(sh_r_ln)

                        if part_r < part_u:
                            ur_title = "En las secciones rurales se vota menos"
                            ur_body = (
                                f"En {max_sec_year} votó el {pr_disp} en secciones rurales y el {pu_disp} en urbanas "
                                f"({diff_disp} de diferencia); en las rurales vive el {sh_r_disp} de la lista nominal."
                            )
                        else:
                            ur_title = "En las secciones urbanas se vota menos"
                            ur_body = (
                                f"En {max_sec_year} votó el {pu_disp} en secciones urbanas y el {pr_disp} en rurales "
                                f"({diff_disp} de diferencia); en las rurales vive el {sh_r_disp} de la lista nominal."
                            )

                        ur_strength: Strength = "fuerte" if (ln_r + ln_u) >= 1000 else "moderada"
                        ur_numbers = [
                            ExplainNumber(key="year", label="Año federal", value=float(max_sec_year), unit="elecciones", display=str(max_sec_year)),
                            ExplainNumber(key="part_rural", label="Participación en secciones rurales", value=round(part_r * 100, 1), unit="pct", display=pr_disp),
                            ExplainNumber(key="part_urban", label="Participación en secciones urbanas", value=round(part_u * 100, 1), unit="pct", display=pu_disp),
                            ExplainNumber(key="diff_ur", label="Diferencia rural-urbana", value=round(diff_ur, 1), unit="pp", display=diff_disp),
                            ExplainNumber(key="share_r_ln", label="Población en secciones rurales", value=round(sh_r_ln * 100, 1), unit="pct", display=sh_r_disp),
                        ]

                        reasons.append(
                            ExplainReason(
                                id="urbano_rural",
                                kind="urbano_rural",
                                title=ur_title,
                                body=ur_body,
                                strength=ur_strength,
                                evidence_type="dato_medido",
                                direction="sube_abstencion",
                                numbers=ur_numbers,
                                source=f"INE · Conteos Censales de Participación Ciudadana {max_sec_year}",
                            )
                        )

    # -------------------------------------------------------------
    # 5. TENDENCIA REASON
    # -------------------------------------------------------------
    if abs(trend_pp) >= 1.0:
        abs_trend = abs(trend_pp)
        trend_disp = fmt_pts(abs_trend)
        if trend_pp < 0:
            t_title = f"Su participación viene bajando ({trend_disp} por elección)"
            t_body = f"En las últimas elecciones su participación ha disminuido en promedio {trend_disp} por elección."
            t_dir = "sube_abstencion"
        else:
            t_title = f"Su participación viene subiendo ({trend_disp} por elección)"
            t_body = f"En las últimas elecciones su participación ha aumentado en promedio {trend_disp} por elección."
            t_dir = "baja_abstencion"

        t_numbers = [
            ExplainNumber(key="trend_pp", label="Cambio por elección", value=trend_pp, unit="pp", display=trend_disp),
        ]
        reasons.append(
            ExplainReason(
                id="tendencia",
                kind="tendencia",
                title=t_title,
                body=t_body,
                strength="moderada",
                evidence_type="calculo_del_modelo",
                direction=t_dir,
                numbers=t_numbers,
                source="Atalaya Electoral · Modelo de Tendencia 2027",
            )
        )

    # -------------------------------------------------------------
    # 6. VOLATILIDAD REASON
    # -------------------------------------------------------------
    if r_vol >= 0.75:
        vol_disp = fmt_pts(volatility_pp)
        r_vol_pct = round(r_vol * 100)
        v_title = "Es una zona difícil de anticipar"
        v_body = (
            f"Su participación cambia de una elección a otra (±{volatility_pp:.1f} puntos), "
            f"más que en el {r_vol_pct} % de los {zonas_plural}; "
            f"por eso su pronóstico tiene un margen amplio ({pred_low_disp} a {pred_high_disp} de abstención)."
        )
        v_numbers = [
            ExplainNumber(key="volatility_pp", label="Volatilidad entre elecciones", value=volatility_pp, unit="pp", display=f"±{volatility_pp:.1f} puntos"),
            ExplainNumber(key="pred_low", label="Cota inferior abstención", value=None, unit="pct", display=pred_low_disp),
            ExplainNumber(key="pred_high", label="Cota superior abstención", value=None, unit="pct", display=pred_high_disp),
        ]
        reasons.append(
            ExplainReason(
                id="volatilidad",
                kind="volatilidad",
                title=v_title,
                body=v_body,
                strength="moderada",
                evidence_type="calculo_del_modelo",
                direction="neutral",
                numbers=v_numbers,
                source="Atalaya Electoral · Modelo de Volatilidad 2027",
            )
        )

    # -------------------------------------------------------------
    # 7. PERFIL TERRITORIAL (ASOCIACION)
    # -------------------------------------------------------------
    assoc_candidates = []
    lvl_assocs = getattr(ref, "associations", {}).get(level, {})
    min_rho = 0.15 if level == "mun" else 0.35
    mod_rho = 0.30 if level == "mun" else 0.50

    for var, stat in lvl_assocs.items():
        if abs(stat.rho) < min_rho:
            continue
        val = u.get(var)
        if val is None or pd.isna(val):
            continue
        val_float = float(val)

        # Unfavorable quartile check
        in_unfavorable = (val_float >= stat.p75) if stat.unfavorable_high else (val_float <= stat.p25)
        if in_unfavorable:
            assoc_candidates.append((abs(stat.rho), var, stat, val_float))

    assoc_candidates.sort(key=lambda x: x[0], reverse=True)
    for _, var, stat, val_float in assoc_candidates[:2]:
        pct_rank = percentile_of(ref, level, var, val_float)
        if pct_rank is None:
            pct_rank = 75.0 if stat.unfavorable_high else 25.0

        meta = ASSOC_META.get(var, {})
        if stat.unfavorable_high:
            cond_text = meta.get("condition_high", f"mayor {var}")
            pct_num = round(pct_rank)
            pct_disp = f"{pct_num} %"
        else:
            cond_text = meta.get("condition_low", f"menor {var}")
            pct_num = round(100.0 - pct_rank)
            pct_disp = f"{pct_num} %"

        zonas_p = zone_noun(level, plural=True)
        pt_title = f"Tiene {cond_text} que el {pct_disp} de los {zonas_p}"

        val_label = meta.get("value_label", "")
        if var == "graproes":
            val_disp = f"{val_float:.1f}"
            dato_zona = f"{val_disp} {val_label}"
        elif var == "im_2020":
            val_disp = f"{val_float:.2f}"
            dato_zona = f"Tiene un {val_label} de {val_disp}"
        else:
            val_disp = fmt_pct(val_float, is_ratio=(val_float <= 1.0))
            dato_zona = f"El {val_disp} {val_label}"

        pt_strength: Strength = "moderada" if abs(stat.rho) >= mod_rho else "debil"
        pt_body = (
            f"{dato_zona}. En el país, {zonas_p} con {cond_text} tienden a votar menos, "
            f"pero es una relación {pt_strength}: no prueba que sea la causa."
        )

        pt_numbers = [
            ExplainNumber(key="rank_pct", label="Posición nacional", value=float(pct_num), unit="pct", display=pct_disp),
            ExplainNumber(key=var, label=f"Valor de {var}", value=val_float, unit="ratio", display=val_disp),
        ]

        reasons.append(
            ExplainReason(
                id=f"perfil_{var}",
                kind="perfil_territorial",
                title=pt_title,
                body=pt_body,
                strength=pt_strength,
                evidence_type="asociacion",
                direction="sube_abstencion",
                numbers=pt_numbers,
                source="INEGI · Censo de Población y Vivienda 2020",
            )
        )

    # -------------------------------------------------------------
    # 8. CONTEXTO REASON (MIGRACION)
    # -------------------------------------------------------------
    ctx_dict = getattr(ref, "context", {}).get(uid)
    if ctx_dict:
        pct_nac = ctx_dict.get("pct_nacido_otra_ent")
        pct_llego = ctx_dict.get("pct_llego_2015_2020")
        if pct_nac is not None and pd.notna(pct_nac):
            pct_rank_mig = percentile_of(ref, level, "pct_nacido_otra_ent", float(pct_nac))
            if pct_rank_mig is not None and pct_rank_mig >= 90.0:
                nac_disp = fmt_pct(pct_nac, is_ratio=False)
                llego_disp = fmt_pct(pct_llego, is_ratio=False)
                rank_disp = f"{round(pct_rank_mig)} %"
                zonas_p = zone_noun(level, plural=True)

                ctx_title = "Mucha de su población viene de otros estados"
                ctx_body = (
                    f"El {nac_disp} de sus habitantes nació en otra entidad (más que en el {rank_disp} de los {zonas_p}) "
                    f"y el {llego_disp} llegó entre 2015 y 2020. Cuando mucha gente se muda, parte de la lista nominal "
                    f"ya no vive ahí o no ha actualizado su credencial; los estudios lo asocian con menor participación, "
                    f"aunque en nuestros datos municipales la relación es débil."
                )

                ctx_numbers = [
                    ExplainNumber(key="pct_nacido_otra_ent", label="Nacidos en otra entidad", value=float(pct_nac), unit="pct", display=nac_disp),
                    ExplainNumber(key="mig_rank", label="Posición en migración", value=round(pct_rank_mig, 1), unit="pct", display=rank_disp),
                    ExplainNumber(key="pct_llego_2015_2020", label="Llegaron entre 2015 y 2020", value=float(pct_llego) if pct_llego else None, unit="pct", display=llego_disp),
                    ExplainNumber(key="census_period", label="Periodo intercensal", value=None, unit="elecciones", display="2015 y 2020"),
                ]

                reasons.append(
                    ExplainReason(
                        id="contexto_migracion",
                        kind="contexto",
                        title=ctx_title,
                        body=ctx_body,
                        strength="debil",
                        evidence_type="contexto_descriptivo",
                        direction="neutral",
                        numbers=ctx_numbers,
                        source="INEGI · Censo 2020 (ITER)",
                    )
                )

    # -------------------------------------------------------------
    # 9. CONFIABILIDAD REASON
    # -------------------------------------------------------------
    ns_rate_raw = u.get("ns_rate")
    if ns_rate_raw is None or pd.isna(ns_rate_raw):
        ns_rate_raw = u.get("ns_rate_last", 0.0)
    ns_rate = float(ns_rate_raw) if (ns_rate_raw is not None and pd.notna(ns_rate_raw)) else 0.0

    low_conf = bool(u.get("low_confidence", False))
    imputed_census = bool(u.get("imputed_census", False))
    fallback_model = u.get("fallback_model")
    has_fallback = bool(fallback_model and str(fallback_model).lower() not in ("none", "", "nan"))
    reliable_count = len(reliable_df) if not reliable_df.empty else 0

    has_confiabilidad = (
        (risk_score is None)
        or (ns_rate > 0.10)
        or low_conf
        or (reliable_count < 4)
        or imputed_census
        or has_fallback
    )

    conf_reason: ExplainReason | None = None
    if has_confiabilidad:
        conf_phrases = []
        conf_numbers: list[ExplainNumber] = []

        if risk_score is None:
            conf_phrases.append("No se calculó el índice de riesgo por limitaciones en los datos disponibles.")
        if ns_rate > 0.10:
            ns_disp = fmt_pct(ns_rate, is_ratio=(ns_rate <= 1.0))
            conf_phrases.append(f"En {target_year} no hubo información del {ns_disp} de los registros.")
            conf_numbers.append(ExplainNumber(key="ns_rate", label="Registros sin clasificar", value=round(ns_rate * 100, 1), unit="pct", display=ns_disp))
            conf_numbers.append(ExplainNumber(key="target_year", label="Año observado", value=float(target_year), unit="elecciones", display=str(target_year)))
        if reliable_count < 4:
            k_disp = str(reliable_count)
            conf_phrases.append(f"Solo hay {k_disp} elecciones con información confiable.")
            conf_numbers.append(ExplainNumber(key="reliable_count", label="Elecciones confiables", value=float(reliable_count), unit="elecciones", display=k_disp))
        if imputed_census:
            conf_phrases.append("Es un municipio creado después de 2020 y sus datos censales se estimaron.")
        if has_fallback:
            conf_phrases.append("Se utilizó un modelo alternativo por falta de serie histórica completa.")
        elif low_conf and not conf_phrases:
            conf_phrases.append("La estimación tiene un grado de incertidumbre mayor al promedio.")

        conf_body = " ".join(conf_phrases)
        conf_reason = ExplainReason(
            id="confiabilidad",
            kind="confiabilidad",
            title="Ojo: los datos de esta zona son incompletos",
            body=conf_body,
            strength="debil",
            evidence_type="calculo_del_modelo",
            direction="neutral",
            numbers=conf_numbers,
            source="Atalaya Electoral · Control de Calidad de Datos",
        )

    # -------------------------------------------------------------
    # SORTING AND ORDERING OF REASONS
    # -------------------------------------------------------------
    sem_reason = [r for r in reasons if r.kind == "semaforo"]
    other_reasons = [r for r in reasons if r.kind != "semaforo" and r.kind != "confiabilidad"]

    ev_order = {"dato_medido": 1, "calculo_del_modelo": 2, "asociacion": 3, "contexto_descriptivo": 4}
    st_order = {"fuerte": 1, "moderada": 2, "debil": 3}

    other_reasons.sort(key=lambda r: (ev_order.get(r.evidence_type, 9), st_order.get(r.strength, 9)))

    final_reasons: list[ExplainReason] = []
    if sem_reason:
        final_reasons.append(sem_reason[0])
    final_reasons.extend(other_reasons)
    if conf_reason is not None:
        final_reasons.append(conf_reason)

    # Trim to at most 7 reasons
    final_reasons = final_reasons[:7]
    for idx, r in enumerate(final_reasons, start=1):
        r.id = f"r{idx}"

    # -------------------------------------------------------------
    # HEADLINE & IN_SHORT
    # -------------------------------------------------------------
    color_cat = str(category).lower() if category else ""
    zonas_plural = zone_noun(level, plural=True)

    # Historical voting pattern
    hist_r = next((r for r in final_reasons if r.kind == "historial"), None)
    hist_voted_less_majority = bool(gaps and len(gaps) > 0 and years_below > len(gaps) / 2)

    # Component with most points
    top_comp = comps_by_points[0] if score_breakdown else None
    top_comp_key = top_comp.key if top_comp else "abs"

    def _comp_words(key: str, cat: str) -> str:
        if key == "abs":
            if "verde" in cat or (cat == "amarillo" and r_abs < 0.5):
                return f"se espera que aquí vote más gente que en la mayoría de los {zonas_plural}"
            return f"se espera más abstención que en la mayoría de los {zonas_plural}"
        elif key == "trend":
            if trend_pp < -0.5:
                return "su participación viene bajando"
            elif trend_pp > 0.5:
                return "su participación viene subiendo"
            else:
                return "su participación se ha mantenido estable"
        elif key == "vol":
            if r_vol >= 0.5:
                return "su participación cambia mucho entre elecciones"
            else:
                return "su participación es de las más estables"
        elif key == "vuln":
            if r_vuln >= 0.5:
                return "su perfil se parece al de las zonas que votan menos"
            else:
                return "su perfil se parece al de las zonas que votan más"
        return f"se espera más abstención que en la mayoría de los {zonas_plural}"

    top_phrase = _comp_words(top_comp_key, color_cat)

    if "rojo" in color_cat or "naranja" in color_cat:
        col_label = "rojo (riesgo muy alto)" if "rojo" in color_cat else "naranja (riesgo alto)"
        motivo = "aquí casi siempre se vota menos que en el resto del país" if hist_voted_less_majority else top_phrase
        headline = f"{name} está en {col_label} sobre todo porque {motivo}."
    elif "amarillo" in color_cat:
        headline = f"{name} está en amarillo (riesgo medio): {top_phrase}."
    elif "verde" in color_cat:
        extra_hist = ""
        if len(gaps) >= 4 and years_below >= 4:
            extra_hist = f", aunque en {years_below} de {len(gaps)} elecciones votó un poco menos que el promedio nacional"
        headline = f"{name} está en verde (riesgo bajo) porque se espera que aquí vote más gente que en la mayoría de los {zonas_plural}{extra_hist}."
    else:
        headline = f"{name} está en {color_words(category)}."

    if len(headline) > 260:
        headline = headline[:257].rstrip() + "..."

    # in_short: primero frase del historial (o componente principal), luego quién vota menos, luego urbano/rural
    short_items: list[str] = []

    # 1. Historial o componente principal (que nunca contradiga al titular)
    use_hist = False
    if hist_r is not None:
        if "verde" in color_cat and hist_voted_less_majority:
            use_hist = False
        else:
            use_hist = True

    if use_hist and hist_r is not None:
        short_items.append(f"{hist_r.title.rstrip('.')}.")
    elif top_phrase:
        cap_phrase = top_phrase[0].upper() + top_phrase[1:].rstrip(".") + "."
        short_items.append(cap_phrase)

    # 2. Quién vota menos
    qnv_r = next((r for r in final_reasons if r.kind == "quien_no_vota"), None)
    if qnv_r is not None:
        short_items.append(f"{qnv_r.title.rstrip('.')}.")

    # 3. Urbano / rural
    ur_r = next((r for r in final_reasons if r.kind == "urbano_rural"), None)
    if ur_r is not None:
        short_items.append(f"{ur_r.title.rstrip('.')}.")

    # Llenar hasta 3 con otras razones si faltan
    for r in final_reasons:
        if len(short_items) >= 3:
            break
        if r.kind not in ("semaforo", "confiabilidad", "historial", "quien_no_vota", "urbano_rural"):
            formatted = f"{r.title.rstrip('.')}."
            if formatted not in short_items:
                short_items.append(formatted)

    in_short = short_items[:3]

    # -------------------------------------------------------------
    # WHAT WE DON'T KNOW
    # -------------------------------------------------------------
    mae_disp = f"±{mae:.1f} puntos"
    what_we_dont_know = [
        "Estos datos muestran dónde y quién vota menos, no prueban por qué: las causas locales (inseguridad, migración, distancia a la casilla, desconfianza) no están en los datos del INE.",
        f"El pronóstico tiene un error típico de {mae_disp}.",
    ]
    if any(r.kind == "perfil_territorial" for r in final_reasons):
        what_we_dont_know.append(
            "Las relaciones con características sociodemográficas son asociaciones estadísticas a nivel territorial y no prueban una relación de causa."
        )
    if conf_reason is not None:
        what_we_dont_know.append(
            "La información histórica de esta zona tiene limitaciones de cobertura o calidad que amplían el margen de incertidumbre."
        )

    # -------------------------------------------------------------
    # CONFIDENCE & CONFIDENCE NOTE
    # -------------------------------------------------------------
    has_strong_hist = any(r.kind == "historial" and r.strength == "fuerte" for r in final_reasons)
    if conf_reason is not None and (ns_rate > 0.3 or low_conf or reliable_count < 3):
        confidence = "baja"
        confidence_note = "Confianza baja por limitaciones en la calidad o cobertura de los datos históricos de la zona."
    elif has_strong_hist and conf_reason is None:
        confidence = "alta"
        confidence_note = "Confianza alta respaldada por un historial consistente en elecciones federales previas."
    else:
        confidence = "media"
        confidence_note = "Confianza media con base en las tendencias observadas y la información disponible."

    # -------------------------------------------------------------
    # RECOMMENDATIONS
    # -------------------------------------------------------------
    recommendations: list[Recommendation] = []
    try:
        from atalaya.model.recommend import build_reference, recommend
        reco_ref = build_reference(store.units(level), level=level)
        unit_drivers = store.drivers(uid) if hasattr(store, "drivers") else []
        reco_list = recommend(u, unit_drivers, reco_ref)
        for r_item in reco_list[:3]:
            prio = str(r_item.get("priority", "media")).lower()
            if prio not in ("alta", "media", "baja"):
                prio = "media"
            clean_rat = clean_recommendation_rationale(r_item.get("rationale", ""))
            recommendations.append(
                Recommendation(
                    title=str(r_item.get("title", "Recomendación preventiva")),
                    rationale=clean_rat,
                    priority=prio,  # type: ignore[arg-type]
                )
            )
    except Exception as exc:
        logger.debug("Error computing recommendations: %s", exc)

    # -------------------------------------------------------------
    # SUGGESTED QUESTIONS
    # -------------------------------------------------------------
    suggested_questions = [
        SuggestedQuestion(
            id="q1",
            text=f"¿Qué grupos de edad votan menos en {name}?",
            intent_hint="profile",
        ),
        SuggestedQuestion(
            id="q2",
            text=f"¿Cómo ha cambiado la participación en {name} desde 2009?",
            intent_hint="trend",
        ),
        SuggestedQuestion(
            id="q3",
            text=f"¿Hay noticias o hechos recientes que expliquen la abstención en {name}?",
            intent_hint="context_news",
        ),
        SuggestedQuestion(
            id="q4",
            text=f"¿Qué podría hacer el INE para que se vote más en {name}?",
            intent_hint="recommend",
        ),
    ]

    if level == "mun" and state_name:
        suggested_questions.append(
            SuggestedQuestion(
                id=f"q{len(suggested_questions)+1}",
                text=f"¿Cómo se compara {name} con el resto de {state_name}?",
                intent_hint="compare",
            )
        )
    else:
        suggested_questions.append(
            SuggestedQuestion(
                id=f"q{len(suggested_questions)+1}",
                text=f"¿Cómo se compara {name} con el promedio nacional?",
                intent_hint="compare",
            )
        )

    if has_urbano_rural:
        ur_reasons = [r for r in final_reasons if r.kind == "urbano_rural"]
        kind_sec = "rurales" if ur_reasons and "rurales" in ur_reasons[0].title else "urbanas"
        suggested_questions.append(
            SuggestedQuestion(
                id=f"q{len(suggested_questions)+1}",
                text=f"¿Por qué en las secciones {kind_sec} de {name} se vota menos?",
                intent_hint="explain_unit",
            )
        )

    # -------------------------------------------------------------
    # SOURCES
    # -------------------------------------------------------------
    sources: list[str] = []
    seen_src = set()
    for r in final_reasons:
        if r.source not in seen_src:
            seen_src.add(r.source)
            sources.append(r.source)

    if "Atalaya Electoral · Pronóstico 2027" not in seen_src:
        sources.append("Atalaya Electoral · Pronóstico 2027")

    now_iso = datetime.now(timezone.utc).isoformat()

    explanation = Explanation(
        unit_id=uid,
        level=level,
        name=name,
        state_name=state_name,
        category=category,
        risk_score=risk_score,
        pred_abstention_pct=pred_abs_pct,
        headline=headline,
        in_short=in_short,
        reasons=final_reasons,
        score_breakdown=score_breakdown,
        groups=groups_list[:4],
        what_we_dont_know=what_we_dont_know,
        confidence=confidence,  # type: ignore[arg-type]
        confidence_note=confidence_note,
        recommendations=recommendations,
        suggested_questions=suggested_questions,
        sources=sources,
        data_year=target_year,
        generated_at=now_iso,
    )

    # Cache result
    with _CACHE_LOCK:
        _EXPLAIN_CACHE[uid] = (time.time(), explanation)

    return explanation


def explanation_facts(expl: Explanation) -> list[str]:
    """Extract ordered factual statements for conversational generation.

    All figures are strictly derived from verified display or plain representations.
    """
    facts: list[str] = [expl.headline]

    for short_item in expl.in_short:
        facts.append(short_item)

    for r in expl.reasons:
        ev_label = EVIDENCE_TYPE_WORDS.get(str(r.evidence_type), str(r.evidence_type).replace("_", " ").title())
        st_label = STRENGTH_WORDS.get(str(r.strength), str(r.strength).title())
        facts.append(f"[{ev_label} · {st_label}] {r.title}: {r.body}")

    for sc in expl.score_breakdown:
        facts.append(f"[Cálculo del modelo] {sc.plain}")

    for dont_know in expl.what_we_dont_know:
        facts.append(dont_know)

    for rec in expl.recommendations:
        facts.append(f"Recomendación ({rec.priority}): {rec.title} — {rec.rationale}")

    return facts
