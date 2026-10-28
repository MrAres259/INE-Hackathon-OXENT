"""Deterministic electoral impact model for news and events on abstention."""

from __future__ import annotations

import csv
from datetime import date, datetime
import functools
import math
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from atalaya.config import SEED_DIR
from atalaya.intel.schemas import (
    GeoScope,
    Level,
    NewsImpact,
    NewsTopic,
    Persistence,
    StateImpact,
)
from atalaya.model.risk import rescore

ELECTION_DATE = date(2027, 6, 6)

DEFAULT_IMPACT_PARAMS: dict[str, dict[str, Any]] = {
    "seguridad_violencia": {
        "s_topic_pp": 2.5,
        "harm": 0.7,
        "susc_var": "r_vuln",
        "label_es": "Seguridad y violencia",
        "rationale_es": "Eventos de inseguridad en zonas específicas pueden inhibir directamente la afluencia a casillas",
    },
    "resultados_fraude": {
        "s_topic_pp": 1.5,
        "harm": 0.8,
        "susc_var": "pct_internet",
        "label_es": "Resultados y fraude",
        "rationale_es": "Cuestionamientos a la certeza de los resultados debilitan la motivación cívica para emitir el voto",
    },
    "organizacion_casillas": {
        "s_topic_pp": 1.5,
        "harm": 0.8,
        "susc_var": "pct_rural",
        "label_es": "Organización y casillas",
        "rationale_es": "Problemas logísticos o reubicación de casillas impactan la accesibilidad física del electorado",
    },
    "confianza_institucional": {
        "s_topic_pp": 1.0,
        "harm": 0.6,
        "susc_var": "pct_internet",
        "label_es": "Confianza institucional",
        "rationale_es": "Los choques de confianza suelen mover la participación electoral en el orden de décimas de punto",
    },
    "presupuesto_recortes": {
        "s_topic_pp": 1.0,
        "harm": 0.5,
        "susc_var": "pct_rural",
        "label_es": "Presupuesto y recortes",
        "rationale_es": "Limitaciones presupuestales pueden mermar capacidades operativas y de despliegue territorial",
    },
    "credencial_padron": {
        "s_topic_pp": 1.0,
        "harm": 1.0,
        "susc_var": "pct_18_24",
        "label_es": "Credencial y padrón",
        "rationale_es": "Incertidumbre sobre vigencia de credencial desmoviliza especialmente a primeros votantes",
    },
    "procedimiento_votacion": {
        "s_topic_pp": 1.0,
        "harm": 1.0,
        "susc_var": "pct_internet",
        "label_es": "Procedimiento de votación",
        "rationale_es": "Confusión sobre requisitos u horarios de votación induce desinformación operativa directa",
    },
    "conducta_funcionarios": {
        "s_topic_pp": 0.5,
        "harm": 0.4,
        "susc_var": "vulnerability_pp",
        "label_es": "Conducta de funcionarios",
        "rationale_es": "Señalamientos a funcionarios individuales tienen impacto moderado en la conducta agregada",
    },
    "otra": {
        "s_topic_pp": 0.5,
        "harm": 0.4,
        "susc_var": "vulnerability_pp",
        "label_es": "Otra temática",
        "rationale_es": "Noticias no clasificadas presentan efectos acotados sobre la participación global",
    },
}


@functools.lru_cache(maxsize=1)
def load_impact_params() -> dict[str, dict[str, Any]]:
    """Load news impact parameter catalog with cache and fallback to defaults."""
    csv_path = SEED_DIR / "news_impact_params.csv"
    if not csv_path.is_file():
        return dict(DEFAULT_IMPACT_PARAMS)

    params: dict[str, dict[str, Any]] = {}
    try:
        with open(csv_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                topic = row.get("topic", "").strip()
                if not topic:
                    continue
                try:
                    s_topic = float(row.get("s_topic_pp", 1.0))
                except ValueError:
                    s_topic = 1.0
                try:
                    harm = float(row.get("harm", 0.5))
                except ValueError:
                    harm = 0.5
                params[topic] = {
                    "s_topic_pp": s_topic,
                    "harm": harm,
                    "susc_var": row.get("susc_var", "vulnerability_pp").strip(),
                    "label_es": row.get("label_es", topic).strip(),
                    "rationale_es": row.get("rationale_es", "").strip(),
                }
        return params
    except Exception:
        return dict(DEFAULT_IMPACT_PARAMS)


def _calc_pct_rank(series: pd.Series) -> pd.Series:
    """Calculate percentile rank in [0, 1] using method='average', filling NaNs with 0.5."""
    valid = series.dropna()
    if len(valid) == 0:
        return pd.Series(0.5, index=series.index, dtype=float)
    if len(valid) == 1:
        res = pd.Series(0.5, index=series.index, dtype=float)
        return res
    ranked = series.rank(pct=True, method="average")
    return ranked.fillna(0.5)


def news_impact(
    units: pd.DataFrame,
    *,
    topic: NewsTopic,
    geo: GeoScope,
    intensity: float,
    persistence: Persistence,
    today: date | None = None,
    level: Level = "state",
    ent: str | None = None,
) -> NewsImpact:
    """Calculate realistic deterministic impact of news/events on abstention."""
    if level == "mun" and not ent:
        raise ValueError("level='mun' requiere especificar el parámetro 'ent'")

    # Load topic parameters
    all_params = load_impact_params()
    topic_data = all_params.get(topic, DEFAULT_IMPACT_PARAMS.get(topic, DEFAULT_IMPACT_PARAMS["otra"]))
    s_topic = float(topic_data["s_topic_pp"])
    susc_var = str(topic_data["susc_var"])

    # Separate municipal and state rows
    if "level" in units.columns:
        mun_df = units[units["level"] == "mun"].copy()
        state_df = units[units["level"] == "state"].copy()
    else:
        mun_df = units.copy()
        state_df = pd.DataFrame()

    if len(mun_df) == 0:
        return NewsImpact(
            level=level,
            ent=ent,
            delta_pp_national=0.0,
            votos_perdidos_total=0,
            units=[],
            max_delta_pp=0.0,
            assumptions=["No se encontraron unidades municipales para calcular el impacto."],
            params={"s_topic": s_topic, "intensity": intensity},
        )

    # 1. Temporal decay
    ref_today = today or date(2026, 10, 28)
    d = (ELECTION_DATE - ref_today).days
    if d <= 0:
        decay = 1.0
    else:
        if persistence == "coyuntural":
            decay = math.exp(-d / 60.0)
        elif persistence == "persistente":
            decay = math.exp(-d / 240.0)
        else:  # estructural
            decay = 1.0

    # 2. Exposure per municipio
    ent_col = "cve_ent" if "cve_ent" in mun_df.columns else ("ent" if "ent" in mun_df.columns else "id")
    mun_cve_ent = mun_df[ent_col].astype(str).str.zfill(2)

    if geo.level == "nacional":
        rank_internet = _calc_pct_rank(mun_df["pct_internet"] if "pct_internet" in mun_df.columns else pd.Series(0.5, index=mun_df.index))
        exposure = 0.6 + 0.4 * rank_internet
    elif geo.level == "estatal":
        target_ents = {str(e).zfill(2) for e in geo.ents}
        exposure = pd.Series(np.where(mun_cve_ent.isin(target_ents), 1.0, 0.0), index=mun_df.index)
    else:  # municipal
        target_muns = {str(m).zfill(5) for m in geo.muns}
        target_ents = {str(e).zfill(2) for e in geo.ents} | {str(m).zfill(5)[:2] for m in geo.muns}
        mun_ids = mun_df["id"].astype(str).str.zfill(5)
        is_exact_mun = mun_ids.isin(target_muns)
        is_same_state = mun_cve_ent.isin(target_ents)
        exp_vals = np.where(is_exact_mun, 1.0, np.where(is_same_state, 0.35, 0.0))
        exposure = pd.Series(exp_vals, index=mun_df.index)

    # 3. Susceptibility per municipio in [0.5, 1.5]
    vol_series = mun_df["volatility_pp"] if "volatility_pp" in mun_df.columns else pd.Series(0.5, index=mun_df.index)
    rank_vol = _calc_pct_rank(vol_series)

    topic_series = mun_df[susc_var] if susc_var in mun_df.columns else pd.Series(0.5, index=mun_df.index)
    rank_topic = _calc_pct_rank(topic_series)

    susc = (0.5 + 0.5 * rank_vol + 0.5 * rank_topic).clip(0.5, 1.5)

    # 4. Delta pp per municipio (capped at 3.0 pp)
    CAP = 3.0
    intensity_clamped = max(0.0, min(1.0, float(intensity)))
    delta_raw = s_topic * intensity_clamped * decay * exposure * susc
    delta_mun = delta_raw.clip(0.0, CAP)
    delta_low_mun = 0.5 * delta_mun
    delta_high_mun = (1.5 * delta_mun).clip(0.0, CAP)

    ln_mun = mun_df["lista_nominal"].fillna(0).astype(float)
    total_national_ln = ln_mun.sum()

    if total_national_ln > 0:
        delta_pp_national = float((delta_mun * ln_mun).sum() / total_national_ln)
        votos_perdidos_total = int(round((delta_mun / 100.0 * ln_mun).sum()))
    else:
        delta_pp_national = 0.0
        votos_perdidos_total = 0

    # Pre-compute rescored categories for municipios
    base_mun_abs = mun_df["pred_abstention"].fillna(0.4) if "pred_abstention" in mun_df.columns else pd.Series(0.4, index=mun_df.index)
    new_mun_abs = base_mun_abs + delta_mun / 100.0
    try:
        rescored_mun_df = rescore(mun_df, new_mun_abs)
        mun_cat_after = rescored_mun_df["category"]
    except Exception:
        # CONTRACT-NOTE: If rescore fails due to synthetic test columns, preserve base category
        mun_cat_after = mun_df.get("category", pd.Series("sin_dato", index=mun_df.index))

    state_impact_units: list[StateImpact] = []

    if level == "state":
        # Group by state
        ent_names = {}
        if len(state_df) > 0:
            for _, srow in state_df.iterrows():
                sid = str(srow.get("id", srow.get("cve_ent", ""))).zfill(2)
                ent_names[sid] = str(srow.get("name", f"Estado {sid}"))

        # Pre-compute state rescore if state_df exists
        state_cat_after = {}
        if len(state_df) > 0 and "pred_abstention" in state_df.columns:
            state_deltas = {}
            for sid, group_idx in mun_df.groupby(mun_cve_ent).groups.items():
                g_ln = ln_mun.loc[group_idx].sum()
                if g_ln > 0:
                    state_deltas[sid] = (delta_mun.loc[group_idx] * ln_mun.loc[group_idx]).sum() / g_ln
                else:
                    state_deltas[sid] = 0.0

            state_base_ids = state_df["id"].astype(str).str.zfill(2)
            state_delta_series = pd.Series([state_deltas.get(sid, 0.0) for sid in state_base_ids], index=state_df.index)
            new_state_abs = state_df["pred_abstention"].fillna(0.4) + state_delta_series / 100.0
            try:
                rescored_state_df = rescore(state_df, new_state_abs)
                for idx, row in rescored_state_df.iterrows():
                    sid = str(state_df.loc[idx, "id"]).zfill(2)
                    state_cat_after[sid] = row["category"]
            except Exception:
                pass

        for sid, group_idx in mun_df.groupby(mun_cve_ent).groups.items():
            g_ln = ln_mun.loc[group_idx].sum()
            if g_ln > 0:
                d_pp = float((delta_mun.loc[group_idx] * ln_mun.loc[group_idx]).sum() / g_ln)
                d_low = float((delta_low_mun.loc[group_idx] * ln_mun.loc[group_idx]).sum() / g_ln)
                d_high = float((delta_high_mun.loc[group_idx] * ln_mun.loc[group_idx]).sum() / g_ln)
                v_lost = int(round((delta_mun.loc[group_idx] / 100.0 * ln_mun.loc[group_idx]).sum()))
            else:
                d_pp = 0.0
                d_low = 0.0
                d_high = 0.0
                v_lost = 0

            # Filter units >= 0.05 pp
            if d_pp < 0.05:
                continue

            # State metadata
            s_name = ent_names.get(sid, f"Estado {sid}")
            s_rows = state_df[state_df["id"].astype(str).str.zfill(2) == sid] if len(state_df) > 0 else pd.DataFrame()
            cat_before = str(s_rows.iloc[0].get("category", "sin_dato")) if len(s_rows) > 0 else "sin_dato"
            cat_after = state_cat_after.get(sid, cat_before)

            avg_exposure = float(exposure.loc[group_idx].mean())

            state_impact_units.append(
                StateImpact(
                    id=sid,
                    name=s_name,
                    level="state",
                    delta_pp=round(d_pp, 3),
                    delta_low_pp=round(d_low, 3),
                    delta_high_pp=round(d_high, 3),
                    votos_perdidos=v_lost,
                    exposure=round(avg_exposure, 3),
                    category_before=cat_before,
                    category_after=cat_after,
                )
            )

    else:  # level == "mun"
        ent_str = ent.zfill(2)
        mun_state_mask = mun_cve_ent == ent_str
        mun_state_df = mun_df[mun_state_mask]

        for idx, mrow in mun_state_df.iterrows():
            d_pp = float(delta_mun.loc[idx])
            if d_pp < 0.05:
                continue

            d_low = float(delta_low_mun.loc[idx])
            d_high = float(delta_high_mun.loc[idx])
            v_lost = int(round(d_pp / 100.0 * float(mrow.get("lista_nominal", 0))))
            cat_before = str(mrow.get("category", "sin_dato"))
            cat_after = str(mun_cat_after.loc[idx]) if d_pp >= 0.05 else cat_before

            state_impact_units.append(
                StateImpact(
                    id=str(mrow.get("id", idx)),
                    name=str(mrow.get("name", f"Municipio {mrow.get('id', idx)}")),
                    level="mun",
                    delta_pp=round(d_pp, 3),
                    delta_low_pp=round(d_low, 3),
                    delta_high_pp=round(d_high, 3),
                    votos_perdidos=v_lost,
                    exposure=round(float(exposure.loc[idx]), 3),
                    category_before=cat_before,
                    category_after=cat_after,
                )
            )

    # Sort descending by delta_pp
    state_impact_units.sort(key=lambda u: u.delta_pp, reverse=True)
    max_delta_pp = state_impact_units[0].delta_pp if state_impact_units else 0.0

    assumptions = [
        f"Temática '{topic_data.get('label_es', topic)}' con sensibilidad base S_topic = {s_topic:.1f} pp.",
        f"Intensidad observada en medios: {intensity_clamped:.2f}.",
        f"Decaimiento coyuntural/temporal: persistencia '{persistence}' con factor {decay:.4f} a {d} días de la jornada electoral.",
        f"Exposición territorial modelada para ámbito {geo.level} (factor promedio {float(exposure.mean()):.2f}).",
        f"Susceptibilidad municipal ponderada por volatilidad electoral histórica y {susc_var} en rango [0.5, 1.5].",
        f"Tope de impacto fijado en {CAP:.1f} puntos porcentuales con banda de incertidumbre [0.5·Δ, min({CAP:.1f}, 1.5·Δ)].",
    ]

    params_dict = {
        "topic": topic,
        "s_topic_pp": s_topic,
        "intensity": intensity_clamped,
        "persistence": persistence,
        "decay": round(decay, 4),
        "days_to_election": d,
        "cap_pp": CAP,
        "susc_var": susc_var,
        "geo_level": geo.level,
    }

    return NewsImpact(
        level=level,
        ent=ent.zfill(2) if ent else None,
        delta_pp_national=round(delta_pp_national, 3),
        votos_perdidos_total=votos_perdidos_total,
        units=state_impact_units,
        max_delta_pp=round(max_delta_pp, 3),
        assumptions=assumptions,
        params=params_dict,
    )


def campaign_prefill_for(impact: NewsImpact, topic: NewsTopic) -> dict[str, Any]:
    """Build prefilled intervention scenario parameters for top affected entities."""
    # Top 5 affected state entity codes
    ents: list[str] = []
    seen = set()
    for u in impact.units:
        ent_code = u.id[:2]
        if ent_code not in seen:
            seen.add(ent_code)
            ents.append(ent_code)
        if len(ents) >= 5:
            break

    effect_pp = min(4.0, max(0.5, round(2.0 * impact.max_delta_pp, 1)))

    if topic in ("credencial_padron", "procedimiento_votacion"):
        primary_lever = "promocion_jovenes"
    elif topic in ("organizacion_casillas", "presupuesto_recortes"):
        primary_lever = "casillas_rurales"
    else:
        primary_lever = "campana_general"

    if topic == "seguridad_violencia":
        campaigns = [
            {
                "lever": "casillas_rurales",
                "targeting": "todos",
                "effect_pp": effect_pp,
                "coverage": 80.0,
                "ents": list(ents),
            },
            {
                "lever": "campana_general",
                "targeting": "todos",
                "effect_pp": effect_pp,
                "coverage": 80.0,
                "ents": list(ents),
            },
        ]
    else:
        campaigns = [
            {
                "lever": primary_lever,
                "targeting": "todos",
                "effect_pp": effect_pp,
                "coverage": 80.0,
                "ents": list(ents),
            }
        ]

    return {"campaigns": campaigns}
