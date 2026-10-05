"""Deterministic query executor for ATALAYA conversational assistant."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from atalaya.chat.spec import DataResult, QuerySpec
from atalaya.config import BUILD_DIR, SEED_DIR
from atalaya.ingest.common import zpad
from atalaya.store import get_store

logger = logging.getLogger(__name__)

# Cache for state names and catalog variables
_STATE_NAMES: dict[str, str] = {}
_CATALOG_VARS: dict[str, dict[str, str]] = {}
_CURRENT_SEED_DIR: Path | None = None


def _init_metadata(seed_dir: Path | None = None) -> None:
    """Initialize state and variable metadata from seed CSV files."""
    global _STATE_NAMES, _CATALOG_VARS, _CURRENT_SEED_DIR
    target_dir = Path(seed_dir) if seed_dir is not None else SEED_DIR

    if _CURRENT_SEED_DIR == target_dir and _STATE_NAMES and _CATALOG_VARS:
        return

    _CURRENT_SEED_DIR = target_dir
    _STATE_NAMES = {}
    _CATALOG_VARS = {}

    states_file = target_dir / "states.csv"
    if states_file.is_file():
        try:
            df_st = pd.read_csv(states_file, dtype=str)
            for _, r in df_st.iterrows():
                cve = zpad(r.get("cve_ent", ""), 2)
                _STATE_NAMES[cve] = str(r.get("name", "")).strip()
        except Exception as e:
            logger.warning("Error reading states.csv in executor: %s", e)

    var_file = target_dir / "variables.csv"
    if var_file.is_file():
        try:
            df_var = pd.read_csv(var_file, dtype=str)
            for _, r in df_var.iterrows():
                k = str(r.get("key", "")).strip()
                _CATALOG_VARS[k] = {
                    "label_es": str(r.get("label_es", k)),
                    "description": str(r.get("description", "")),
                    "source": str(r.get("source", "")),
                    "unit": str(r.get("unit", "")),
                    "level": str(r.get("level", "")),
                }
        except Exception as e:
            logger.warning("Error reading variables.csv in executor: %s", e)


def get_state_name(cve_ent: str | None) -> str:
    """Return entity name for 2-digit cve_ent code."""
    if not cve_ent:
        return ""
    return _STATE_NAMES.get(zpad(cve_ent, 2), f"Estado {cve_ent}")


def get_variable_meta(key: str) -> dict[str, str]:
    """Return metadata dict for variable key."""
    if key in _CATALOG_VARS:
        return _CATALOG_VARS[key]

    # Handle wide columns like part_dip_2021 or abst_dip_2021
    if key.startswith("part_dip_"):
        year = key.replace("part_dip_", "")
        return {
            "label_es": f"Participación DIP_FED {year}",
            "description": f"Participación ciudadana en diputaciones federales {year}",
            "source": f"INE · Conteos Censales de Participación Ciudadana {year}",
            "unit": "proporción",
            "level": "mun|state",
        }
    elif key.startswith("abst_dip_"):
        year = key.replace("abst_dip_", "")
        return {
            "label_es": f"Abstención DIP_FED {year}",
            "description": f"Abstención en diputaciones federales {year}",
            "source": f"INE · Conteos Censales de Participación Ciudadana {year}",
            "unit": "proporción",
            "level": "mun|state",
        }

    return {
        "label_es": key.replace("_", " ").title(),
        "description": "",
        "source": "ATALAYA",
        "unit": "",
        "level": "mun|state",
    }


def format_value(key: str, val: Any) -> str:
    """Format numerical or text value based on metric type."""
    if val is None or pd.isna(val):
        return "N/D"

    if isinstance(val, (int, float, np.number)):
        # Proportions 0..1
        if (
            key in ("participacion", "abstencion", "pred_abstention", "pred_participation", "pred_low", "pred_high")
            or key.startswith("pct_")
            or key.startswith("part_")
            or key.startswith("abst_")
        ):
            return f"{float(val) * 100:.1f}%"
        # Points / change
        elif key in ("trend_pp", "delta_vs_base_pp", "gap_youth_pp", "gap_sexo_pp"):
            return f"{float(val):+.1f} pp"
        elif key == "volatility_pp":
            return f"{float(val):.1f} pp"
        # Counts
        elif key in ("lista_nominal", "votos_totales", "pob_tot", "pob_18ymas", "votos_adicionales", "ln", "sv", "nv", "ns"):
            return f"{int(round(float(val))):,}"
        # Indices and grades
        elif key in ("risk_score", "im_2020", "graproes"):
            return f"{float(val):.1f}"
        else:
            return f"{float(val):.2f}"

    return str(val)


def _resolve_sources(keys: list[str], spec: QuerySpec | None = None, store: Any = None) -> str:
    """Build unified, deduplicated source citation string with effective year."""
    eff_election = "CCPC"
    if spec and spec.election:
        if spec.election == "PRES":
            eff_election = "Presidencia"
        elif spec.election == "SEN":
            eff_election = "Senadurías"
        elif spec.election == "PJF":
            eff_election = "Poder Judicial"

    eff_year = None
    if spec and spec.year:
        eff_year = spec.year
    else:
        if spec and (spec.election == "PJF" or spec.metric == "part_pj_2025"):
            eff_year = 2025
        elif store is not None:
            try:
                part_df = store.participation(level="mun", election="DIP_FED")
                if not part_df.empty and "year" in part_df.columns:
                    eff_year = int(part_df["year"].max())
                else:
                    st = store.stats()
                    years = [y for y in st.get("years", []) if y <= 2024]
                    if years:
                        eff_year = max(years)
            except Exception:
                pass
        if not eff_year:
            eff_year = 2024

    sources: list[str] = []

    def _add_source(s: str) -> None:
        if s and s not in sources:
            sources.append(s)

    for k in keys:
        if not k:
            continue
        meta = get_variable_meta(k)
        raw_src = meta.get("source", "").strip()

        # Check for wide columns like part_dip_2021 or abst_dip_2021
        if k.startswith("part_dip_") or k.startswith("abst_dip_"):
            yr = k.split("_")[-1]
            _add_source(f"INE · Conteos Censales de Participación Ciudadana {yr}")
            continue

        if raw_src.startswith("INE ·") or raw_src.startswith("INEGI ·") or raw_src.startswith("CONAPO ·") or raw_src.startswith("ATALAYA ·"):
            _add_source(raw_src)
        elif raw_src in ("INE", "INE CCPC"):
            _add_source(f"INE · Conteos Censales de Participación Ciudadana {eff_year}")
        elif raw_src == "INEGI":
            _add_source("INEGI · Censo 2020")
        elif raw_src == "CONAPO":
            _add_source("CONAPO · Marginación 2020")
        elif raw_src == "ATALAYA":
            _add_source("ATALAYA · Pronóstico 2027 (con datos INE e INEGI)")
        elif raw_src:
            _add_source(raw_src)

    if not sources:
        return f"INE · Conteos Censales de Participación Ciudadana {eff_year}"

    return "; ".join(sources)


def _execute_ranking(spec: QuerySpec, store: Any) -> DataResult:
    results = store.top(
        metric=spec.metric,
        level=spec.level,
        filters=spec.filters,
        order=spec.order,
        limit=spec.limit,
    )
    valid_results = [r for r in results if r.get("value") is not None and not pd.isna(r.get("value"))]

    omitted = 0
    if valid_results:
        try:
            ent = spec.filters.get("cve_ent") if spec.filters else None
            scope_units = store.units(level=spec.level, ent=ent)
            if not scope_units.empty and spec.metric in scope_units.columns:
                total_in_scope = len(scope_units)
                valid_in_scope = int(pd.to_numeric(scope_units[spec.metric], errors="coerce").notna().sum())
                omitted = max(0, total_in_scope - valid_in_scope)
        except Exception:
            omitted = 0

    meta = get_variable_meta(spec.metric)
    label = meta.get("label_es", spec.metric)
    columns = ["#", "Zona", "Estado", label]

    rows = []
    for idx, r in enumerate(valid_results, 1):
        zona = r.get("name") or r.get("id")
        estado = get_state_name(r.get("cve_ent"))
        val_str = format_value(spec.metric, r.get("value"))
        rows.append([idx, zona, estado, val_str])

    facts = []
    if valid_results:
        top1 = valid_results[0]
        top1_name = top1.get("name") or top1.get("id")
        top1_ent = get_state_name(top1.get("cve_ent"))
        facts.append(
            f"Top 1: {top1_name} ({top1_ent}) con {label.lower()} de {format_value(spec.metric, top1.get('value'))}."
        )
        vals = [float(r["value"]) for r in valid_results if r.get("value") is not None]
        mean_v = sum(vals) / len(vals)
        facts.append(
            f"Promedio del grupo ({len(valid_results)} unidades): {format_value(spec.metric, mean_v)}."
        )
        facts.append(
            f"Rango de valores: de {format_value(spec.metric, min(vals))} a {format_value(spec.metric, max(vals))}."
        )
        if omitted > 0:
            facts.append(f"Se omitieron {omitted} unidades sin dato.")
    else:
        facts.append("No se encontraron registros para los filtros seleccionados.")

    return DataResult(
        columns=columns,
        rows=rows,
        source=_resolve_sources([spec.metric], spec, store),
        facts=facts,
        empty=len(rows) == 0,
    )


def _execute_lookup(spec: QuerySpec, store: Any, region_id: str | None = None) -> DataResult:
    target_ids = list(spec.unit_ids)
    if not target_ids and region_id:
        target_ids = [region_id]
    elif not target_ids and spec.filters.get("cve_ent") and spec.level == "state":
        target_ids = [spec.filters["cve_ent"]]

    meta = get_variable_meta(spec.metric)
    label = meta.get("label_es", spec.metric)
    raw_source = meta.get("source", "")
    is_census = (
        raw_source.startswith("INEGI")
        or raw_source.startswith("CONAPO")
        or spec.metric in (
            "pob_tot", "pob_18ymas", "pct_18_24", "pct_65ymas", "graproes",
            "pct_hli", "pct_sin_servsalud", "pct_internet", "pct_rural",
            "pct_analfabeta", "pct_po2sm", "im_2020", "gm_2020"
        )
    )

    if is_census:
        columns = ["Zona", "Nivel", "Estado", "Año", label]
    else:
        columns = ["Zona", "Nivel", "Estado", label]

    rows = []
    facts = []
    sources = [spec.metric]

    if target_ids:
        for uid in target_ids:
            u = store.unit(uid)
            val = None
            if u:
                zona = u.get("name") or uid
                nivel = "Estado" if u.get("level") == "state" else "Municipio"
                estado = get_state_name(u.get("cve_ent"))

                # Check CCPC metrics from ccpc_features
                if spec.metric in (
                    "pct_ln_18_34", "part_18_34", "gap_youth_pp", "gap_sexo_pp",
                    "pct_ln_rural", "pct_ln_urbana", "ns_rate", "part_pj_2025"
                ):
                    eff_yr = spec.year or (2025 if spec.metric == "part_pj_2025" else 2024)
                    ccpc_data = None
                    if hasattr(store, "ccpc_features"):
                        try:
                            ccpc_data = store.ccpc_features(uid, year=spec.year)
                        except Exception:
                            pass
                    if ccpc_data and spec.metric in ccpc_data and ccpc_data[spec.metric] is not None:
                        val = ccpc_data[spec.metric]
                        eff_yr = ccpc_data.get("year", eff_yr)
                    elif u:
                        val = u.get(spec.metric)
                        if val is None or pd.isna(val):
                            val = u.get(f"{spec.metric}_last")
                    sources.append(f"part_dip_{eff_yr}")
                # Check participation or wide columns
                elif not is_census and spec.year and spec.metric in ("participacion", "abstencion", "lista_nominal", "votos_totales"):
                    wide_col = f"part_dip_{spec.year}" if spec.metric == "participacion" else (
                        f"abst_dip_{spec.year}" if spec.metric == "abstencion" else None
                    )
                    if wide_col and wide_col in u and pd.notna(u[wide_col]):
                        val = u[wide_col]
                    else:
                        pdf = store.participation([uid], level=u.get("level", spec.level), election=spec.election, years=[spec.year])
                        if not pdf.empty and spec.metric in pdf.columns:
                            val = pdf.iloc[0][spec.metric]
                    sources.append(f"part_dip_{spec.year}")
                else:
                    val = u.get(spec.metric)
                    if val is None or pd.isna(val):
                        if not is_census and spec.metric in ("participacion", "abstencion", "lista_nominal", "votos_totales"):
                            pdf = store.participation([uid], level=u.get("level", spec.level), election=spec.election)
                            if not pdf.empty:
                                latest = pdf.sort_values(by="year").iloc[-1]
                                val = latest.get(spec.metric)
                        elif f"pred_{spec.metric}" in u and pd.notna(u[f"pred_{spec.metric}"]):
                            val = u[f"pred_{spec.metric}"]

                if val is not None and not pd.isna(val):
                    val_str = format_value(spec.metric, val)
                    if is_census:
                        rows.append([zona, nivel, estado, 2020, val_str])
                        facts.append(
                            f"La {label.lower()} en {zona} ({estado}) en 2020 fue de {val_str}."
                        )
                        if spec.year and spec.year != 2020:
                            facts.append("El dato censal corresponde a 2020.")
                    elif spec.metric in (
                        "pct_ln_18_34", "part_18_34", "gap_youth_pp", "gap_sexo_pp",
                        "pct_ln_rural", "pct_ln_urbana", "ns_rate", "part_pj_2025"
                    ):
                        rows.append([zona, nivel, estado, val_str])
                        eff_yr_val = spec.year or (2025 if spec.metric == "part_pj_2025" else 2024)
                        facts.append(
                            f"La {label.lower()} en {zona} ({estado}) en {eff_yr_val} fue de {val_str}."
                        )
                    else:
                        rows.append([zona, nivel, estado, val_str])
                        yr_text = f" en {spec.year}" if spec.year else ""
                        facts.append(
                            f"La {label.lower()} en {zona} ({estado}){yr_text} fue de {val_str}."
                        )
    else:
        ent = spec.filters.get("cve_ent")
        agg = store.aggregate(spec.metric, level=spec.level, filters=spec.filters, stat="avg")
        if agg and agg[0].get("value") is not None and not pd.isna(agg[0].get("value")):
            val = agg[0].get("value")
            zona = get_state_name(ent) if ent else "Nacional"
            nivel = "Estado" if spec.level == "state" else "Municipal"
            val_str = format_value(spec.metric, val)
            if is_census:
                rows.append([zona, nivel, zona, 2020, val_str])
                facts.append(f"El promedio de {label.lower()} para {zona} ({nivel.lower()}) en 2020 es de {val_str}.")
                if spec.year and spec.year != 2020:
                    facts.append("El dato censal corresponde a 2020.")
            elif spec.metric in (
                "pct_ln_18_34", "part_18_34", "gap_youth_pp", "gap_sexo_pp",
                "pct_ln_rural", "pct_ln_urbana", "ns_rate", "part_pj_2025"
            ):
                rows.append([zona, nivel, zona, val_str])
                eff_yr_val = spec.year or (2025 if spec.metric == "part_pj_2025" else 2024)
                facts.append(f"El promedio de {label.lower()} para {zona} ({nivel.lower()}) en {eff_yr_val} es de {val_str}.")
            else:
                rows.append([zona, nivel, zona, val_str])
                facts.append(f"El promedio de {label.lower()} para {zona} ({nivel.lower()}) es de {val_str}.")

    if not rows:
        facts.append("No se encontraron registros para la consulta solicitada.")

    return DataResult(
        columns=columns,
        rows=rows,
        source=_resolve_sources(sources, spec, store),
        facts=facts,
        empty=len(rows) == 0,
    )


def _execute_profile(spec: QuerySpec, store: Any, region_id: str | None = None) -> DataResult:
    target_ids = list(spec.unit_ids)
    if not target_ids and region_id:
        target_ids = [region_id]
    elif not target_ids and spec.filters.get("cve_ent"):
        target_ids = [spec.filters["cve_ent"]]

    target_id = target_ids[0] if target_ids else ("01" if spec.level == "state" else "01001")
    unit = store.unit(str(target_id)) if hasattr(store, "unit") else None
    zona = unit.get("name") if unit else str(target_id)
    estado = get_state_name(unit.get("cve_ent")) if unit else ""

    raw_profile = []
    if hasattr(store, "profile"):
        try:
            raw_profile = store.profile(str(target_id), year=spec.year)
        except Exception as e:
            logger.warning("Error fetching profile from store: %s", e)

    columns = ["Grupo de edad", "Sexo", "Lista Nominal", "Votaron (SV)", "No Votaron (NV)", "Participación"]
    rows = []
    facts = []

    if raw_profile:
        eff_year = spec.year
        if eff_year is None:
            if spec.election == "PJF" or spec.metric == "part_pj_2025":
                eff_year = 2025
            else:
                dip_years = [int(r["year"]) for r in raw_profile if "year" in r and r["year"] is not None and int(r["year"]) <= 2024]
                eff_year = max(dip_years) if dip_years else 2024
        filtered = [r for r in raw_profile if int(r.get("year", 0)) == int(eff_year)]
        filtered.sort(key=lambda r: (str(r.get("age_group", "")), str(r.get("sexo", ""))))

        for r in filtered:
            ag = str(r.get("age_group", ""))
            sx = str(r.get("sexo", ""))
            ln_str = format_value("lista_nominal", r.get("ln"))
            sv_str = format_value("votos_totales", r.get("sv"))
            nv_str = format_value("votos_totales", r.get("nv"))
            part_str = format_value("participacion", r.get("participacion"))
            rows.append([ag, sx, ln_str, sv_str, nv_str, part_str])

        location_desc = f"{zona} ({estado})" if estado and estado != zona else zona
        facts.append(
            f"Perfil de participación ciudadana por grupo de edad y sexo en {location_desc} para {eff_year} (CCPC)."
        )
        valid_parts = [r for r in filtered if r.get("participacion") is not None and pd.notna(r.get("participacion"))]
        if valid_parts:
            top_g = max(valid_parts, key=lambda x: float(x["participacion"]))
            bot_g = min(valid_parts, key=lambda x: float(x["participacion"]))
            facts.append(
                f"Mayor participación: {top_g.get('age_group')} ({top_g.get('sexo')}) con {format_value('participacion', top_g.get('participacion'))}."
            )
            facts.append(
                f"Menor participación: {bot_g.get('age_group')} ({bot_g.get('sexo')}) con {format_value('participacion', bot_g.get('participacion'))}."
            )
    else:
        eff_year = spec.year or (2025 if (spec and (spec.election == "PJF" or spec.metric == "part_pj_2025")) else 2024)
        facts.append("No se encontró información de perfil demográfico (CCPC) para la zona solicitada.")

    source = f"INE · Conteos Censales de Participación Ciudadana {eff_year}"

    return DataResult(
        columns=columns,
        rows=rows,
        source=source,
        facts=facts,
        empty=len(rows) == 0,
    )


def _execute_compare(spec: QuerySpec, store: Any) -> DataResult:
    target_ids = list(spec.unit_ids)
    if len(target_ids) < 2 and spec.filters.get("cve_ent"):
        ent = spec.filters["cve_ent"]
        if ent not in target_ids:
            target_ids.append(ent)

    meta = get_variable_meta(spec.metric)
    label = meta.get("label_es", spec.metric)
    has_category = spec.metric in ("risk_score", "pred_abstention")
    columns = ["Zona", "Estado", label] + (["Semáforo"] if has_category else [])

    rows = []
    units_data = []
    for uid in target_ids:
        u = store.unit(uid)
        if u:
            val = u.get(spec.metric)
            if val is None or pd.isna(val):
                # Try from participation table
                if spec.metric in ("participacion", "abstencion", "lista_nominal", "votos_totales"):
                    pdf = store.participation([uid], level=u.get("level", spec.level), election=spec.election)
                    if not pdf.empty:
                        if spec.year:
                            pdf = pdf[pdf["year"] == spec.year]
                        if not pdf.empty:
                            latest = pdf.sort_values(by="year").iloc[-1]
                            val = latest.get(spec.metric)
                if val is None and f"pred_{spec.metric}" in u and pd.notna(u[f"pred_{spec.metric}"]):
                    val = u[f"pred_{spec.metric}"]

            if val is not None and not pd.isna(val):
                zona = u.get("name") or uid
                estado = get_state_name(u.get("cve_ent"))
                val_str = format_value(spec.metric, val)
                cat = str(u.get("category", "sin_dato")).capitalize()
                row = [zona, estado, val_str]
                if has_category:
                    row.append(cat)
                rows.append(row)
                units_data.append({"name": zona, "val": val, "val_str": val_str, "ent": estado, "cat": cat})

    facts = []
    if len(units_data) >= 2:
        u1, u2 = units_data[0], units_data[1]
        v1, v2 = u1["val"], u2["val"]
        facts.append(
            f"{u1['name']} ({u1['ent']}) registra {u1['val_str']} frente a {u2['val_str']} en {u2['name']} ({u2['ent']})."
        )
        if isinstance(v1, (int, float, np.number)) and isinstance(v2, (int, float, np.number)) and pd.notna(v1) and pd.notna(v2):
            diff = abs(float(v1) - float(v2))
            diff_str = format_value("trend_pp", diff)
            facts.append(f"La diferencia absoluta es de {diff_str}.")
    elif len(units_data) == 1:
        facts.append(f"Se localizó solo una unidad ({units_data[0]['name']}) para comparación.")
    else:
        facts.append("No se encontraron unidades para realizar la comparación.")

    return DataResult(
        columns=columns,
        rows=rows,
        source=_resolve_sources([spec.metric], spec, store),
        facts=facts,
        empty=len(rows) == 0,
    )


def _execute_trend(spec: QuerySpec, store: Any, region_id: str | None = None) -> DataResult:
    target_ids = list(spec.unit_ids)
    if not target_ids and region_id:
        target_ids = [region_id]
    elif not target_ids and spec.filters.get("cve_ent"):
        target_ids = [spec.filters["cve_ent"]]

    pdf = store.participation(target_ids, level=spec.level, election=spec.election)
    if pdf.empty and target_ids:
        pdf = store.participation(target_ids, level="state", election=spec.election)

    if not pdf.empty and "year" in pdf.columns:
        pdf = pdf.sort_values(by="year", ascending=True)

    columns = ["Año", "Elección", "Participación", "Abstención", "Lista Nominal"]
    rows = []
    for _, r in pdf.iterrows():
        yr = int(r["year"])
        elec = str(r["election"])
        part = format_value("participacion", r.get("participacion"))
        abst = format_value("abstencion", r.get("abstencion"))
        ln = format_value("lista_nominal", r.get("lista_nominal"))
        rows.append([yr, elec, part, abst, ln])

    facts = []
    if not pdf.empty:
        min_yr = int(pdf["year"].min())
        max_yr = int(pdf["year"].max())
        p_start = float(pdf.iloc[0].get("participacion", 0))
        p_end = float(pdf.iloc[-1].get("participacion", 0))
        delta_pp = (p_end - p_start) * 100.0
        unit_name = target_ids[0] if target_ids else "la zona"
        facts.append(
            f"Historial de {len(pdf)} elecciones ({min_yr} a {max_yr}) para {unit_name}."
        )
        facts.append(
            f"Participación en {min_yr}: {format_value('participacion', p_start)}; en {max_yr}: {format_value('participacion', p_end)}."
        )
        facts.append(f"Variación total en el periodo: {delta_pp:+.1f} pp.")
    else:
        facts.append("No se encontraron registros históricos de participación para la zona solicitada.")

    return DataResult(
        columns=columns,
        rows=rows,
        source="INE · Participación electoral histórica (DIP_FED)",
        facts=facts,
        empty=len(rows) == 0,
    )


def _execute_correlation(spec: QuerySpec, store: Any) -> DataResult:
    x_var = spec.x_metric or "im_2020"
    fields = [spec.metric, x_var]
    corr_dict = store.correlation(fields, level=spec.level, filters=spec.filters)

    matrix = corr_dict.get("matrix", {})
    r = matrix.get(spec.metric, {}).get(x_var)
    n = corr_dict.get("n", 0)

    fuerza = "débil"
    direccion = "nula"
    if r is not None and pd.notna(r):
        abs_r = abs(r)
        if abs_r >= 0.6:
            fuerza = "fuerte"
        elif abs_r >= 0.3:
            fuerza = "moderada"
        else:
            fuerza = "débil"
        direccion = "positiva" if r > 0 else "negativa"

    m_meta = get_variable_meta(spec.metric)
    x_meta = get_variable_meta(x_var)
    m_label = m_meta.get("label_es", spec.metric)
    x_label = x_meta.get("label_es", x_var)

    # Quintiles table using store.units
    ent = spec.filters.get("cve_ent") if spec.filters else None
    units_df = store.units(level=spec.level, ent=ent).copy()

    q_columns = ["Quintil", f"Rango {x_label}", f"Promedio {m_label}", "Unidades"]
    q_rows = []

    if not units_df.empty:
        # Check if participation metric
        if spec.metric not in units_df.columns:
            for cand in [f"part_dip_2021", f"part_dip_2024", "last_participation"]:
                if cand in units_df.columns:
                    units_df[spec.metric] = units_df[cand]
                    break

        if spec.metric in units_df.columns and x_var in units_df.columns:
            units_df[spec.metric] = pd.to_numeric(units_df[spec.metric], errors="coerce")
            units_df[x_var] = pd.to_numeric(units_df[x_var], errors="coerce")
            sub = units_df[[spec.metric, x_var]].dropna()

            if len(sub) >= 5:
                try:
                    sub["_q"] = pd.qcut(sub[x_var], q=5, duplicates="drop")
                    for q_idx, (cat, grp) in enumerate(sub.groupby("_q", observed=False), 1):
                        x_min = grp[x_var].min()
                        x_max = grp[x_var].max()
                        y_avg = grp[spec.metric].mean()
                        count = len(grp)
                        q_rows.append([
                            f"Q{q_idx}",
                            f"{format_value(x_var, x_min)} - {format_value(x_var, x_max)}",
                            format_value(spec.metric, y_avg),
                            count,
                        ])
                except Exception as e:
                    logger.debug("Quintiles calculation error: %s", e)

    facts = []
    if r is not None and pd.notna(r) and n > 0:
        facts.append(
            f"El coeficiente de correlación de Pearson es r = {r:.2f} (fuerza {fuerza}, dirección {direccion}), "
            f"calculado sobre n = {n} unidades."
        )
        facts.append("Correlación no implica causalidad.")
        facts.append(f"Se analizó la relación entre {m_label.lower()} y {x_label.lower()}.")
    else:
        facts.append("No fue posible estimar la correlación: sin datos suficientes disponibles.")
        facts.append("Correlación no implica causalidad.")

    return DataResult(
        columns=q_columns,
        rows=q_rows,
        source=_resolve_sources([spec.metric, x_var], spec, store),
        facts=facts,
        empty=len(q_rows) == 0,
    )


def _execute_scenario(spec: QuerySpec, store: Any) -> DataResult:
    scenario = spec.scenario or "intervencion"
    params = spec.scenario_params or {}
    level = spec.level
    ent = spec.filters.get("cve_ent") if spec.filters else None

    sim_func = None
    try:
        from atalaya.model.scenarios import simulate
        sim_func = simulate
    except ImportError:
        pass

    if sim_func is None:
        return DataResult(
            columns=[],
            rows=[],
            source="ATALAYA · Simulación de escenarios 2027 (con datos INE e INEGI)",
            facts=["No fue posible simular el escenario: módulo de escenarios no disponible."],
            empty=True,
        )

    all_units = store.units(level=None)
    if all_units.empty:
        return DataResult(
            columns=[],
            rows=[],
            source="ATALAYA · Simulación de escenarios 2027 (con datos INE e INEGI)",
            facts=["No fue posible simular el escenario: sin datos disponibles."],
            empty=True,
        )

    try:
        items_df, summary = sim_func(all_units, scenario=scenario, params=params, level=level, ent=ent)
    except Exception as e:
        logger.warning("Error calling model.scenarios.simulate: %s", e)
        return DataResult(
            columns=[],
            rows=[],
            source="ATALAYA · Simulación de escenarios 2027 (con datos INE e INEGI)",
            facts=[f"No fue posible simular el escenario: {e}"],
            empty=True,
        )

    if items_df.empty:
        return DataResult(
            columns=[],
            rows=[],
            source="ATALAYA · Simulación de escenarios 2027 (con datos INE e INEGI)",
            facts=["No fue posible simular el escenario: sin unidades coincidentes."],
            empty=True,
        )

    columns = ["Zona", "Estado", "Abstención Base", "Abstención Simulada", "Cambio (pp)", "Semáforo"]
    rows = []

    # Sort by delta_vs_base_pp ascending (mayor mejora primero)
    if "delta_vs_base_pp" in items_df.columns:
        items_sorted = items_df.sort_values(by="delta_vs_base_pp", ascending=True, na_position="last")
    else:
        items_sorted = items_df

    top_items = items_sorted.head(10)

    for _, r in top_items.iterrows():
        zona = r.get("name") or r.get("id")
        estado = get_state_name(r.get("cve_ent") or r.get("ent"))
        
        simulada_val = r.get("pred_abstention")
        delta_val = r.get("delta_vs_base_pp")

        if pd.notna(simulada_val) and pd.notna(delta_val):
            base_val = float(simulada_val) - float(delta_val) / 100.0
            base_abst = format_value("abstencion", base_val)
            sim_abst = format_value("abstencion", simulada_val)
            delta = format_value("delta_vs_base_pp", delta_val)
        elif pd.notna(simulada_val):
            base_abst = format_value("abstencion", simulada_val)
            sim_abst = format_value("abstencion", simulada_val)
            delta = "0.0 pp"
        else:
            base_abst = "N/D"
            sim_abst = "N/D"
            delta = "N/D"

        cat = str(r.get("category", "sin_dato")).capitalize()
        rows.append([zona, estado, base_abst, sim_abst, delta, cat])

    mean_delta = summary.get("mean_delta_pp", 0.0)
    votos_add = summary.get("votos_adicionales", 0)
    by_cat = summary.get("by_category", {})
    by_cat_base = summary.get("by_category_base", {})

    facts = [
        f"Escenario simulado: '{scenario}'.",
        f"Cambio promedio en abstención: {mean_delta:+.2f} pp.",
        f"Votos adicionales proyectados: {votos_add:,} votos.",
    ]
    if by_cat and by_cat_base:
        facts.append(
            f"Distribución de riesgo (base → simulada): "
            f"Verde {by_cat_base.get('verde', 0)} → {by_cat.get('verde', 0)}, "
            f"Amarillo {by_cat_base.get('amarillo', 0)} → {by_cat.get('amarillo', 0)}, "
            f"Naranja {by_cat_base.get('naranja', 0)} → {by_cat.get('naranja', 0)}, "
            f"Rojo {by_cat_base.get('rojo', 0)} → {by_cat.get('rojo', 0)}."
        )

    return DataResult(
        columns=columns,
        rows=rows,
        source="ATALAYA · Simulación de escenarios 2027 (con datos INE e INEGI)",
        facts=facts,
        empty=len(rows) == 0,
    )


def _execute_explain_unit(spec: QuerySpec, store: Any, region_id: str | None = None) -> DataResult:
    target_id = spec.unit_ids[0] if spec.unit_ids else (region_id or spec.filters.get("cve_ent"))
    unit = store.unit(str(target_id)) if target_id else None

    if not unit:
        return DataResult(
            columns=["Factor", "Impacto (pp)", "Efecto"],
            rows=[],
            source="ATALAYA · Diagnóstico predictivo y factores clave 2027",
            facts=["No se encontró la información de la unidad solicitada."],
            empty=True,
        )

    drivers = []
    if hasattr(store, "drivers"):
        try:
            drivers = store.drivers(str(target_id))
        except Exception:
            pass

    if not drivers:
        drivers_file = getattr(store, "build_dir", BUILD_DIR) / "drivers.parquet"
        if drivers_file.is_file():
            try:
                df_d = pd.read_parquet(drivers_file)
                match = df_d[df_d["id"] == str(target_id)]
                if not match.empty:
                    drivers = match.sort_values(by="rank").to_dict(orient="records")
            except Exception:
                pass

    recs = []
    if drivers:
        try:
            from atalaya.model.recommend import build_reference, recommend
            ref = build_reference(store.units("mun"))
            recs = recommend(unit, drivers, ref)
        except Exception:
            recs = [
                {
                    "title": "Campaña de credencialización y activación",
                    "rationale": "Focalizar incentivos y brigadeo en sectores prioritarios.",
                    "priority": "alta",
                },
                {
                    "title": "Módulos itinerantes y casillas en zonas rurales",
                    "rationale": "Acercar puntos de votación para mitigar barreras de distancia y transporte.",
                    "priority": "media",
                },
            ]

    columns = ["Factor", "Impacto (pp)", "Efecto"]
    rows = []
    for d in drivers[:5]:
        rows.append([
            d.get("label", d.get("key", "")),
            format_value("trend_pp", d.get("contribution_pp", 0.0)),
            "Incrementa abstención" if d.get("direction") == "sube_abstencion" else "Reduce abstención",
        ])

    zona = unit.get("name") or target_id
    estado = get_state_name(unit.get("cve_ent"))
    rs = format_value("risk_score", unit.get("risk_score"))
    cat = str(unit.get("category", "sin_dato")).capitalize()

    facts = [
        f"Unidad: {zona} ({estado}) | Categoría: {cat} (Índice de riesgo: {rs}).",
    ]
    if rows:
        facts.append(f"Factores determinantes identificados: {len(rows)}.")
    else:
        facts.append("No se identificaron factores determinantes para esta unidad.")

    for r in recs[:2]:
        facts.append(f"Recomendación ({r.get('priority', 'alta').upper()}): {r.get('title')} — {r.get('rationale')}")

    return DataResult(
        columns=columns,
        rows=rows,
        source="ATALAYA · Diagnóstico predictivo y factores clave 2027",
        facts=facts,
        empty=len(rows) == 0,
    )


def _execute_catalog(spec: QuerySpec) -> DataResult:
    columns = ["Clave", "Variable", "Fuente", "Unidad"]
    rows = []
    for k, info in sorted(_CATALOG_VARS.items()):
        rows.append([k, info["label_es"], info["source"], info["unit"]])

    facts = [
        f"El catálogo de ATALAYA cuenta con {len(rows)} variables analíticas registradas.",
        "Fuentes oficiales: INE (resultados electorales), INEGI (Censo 2020), CONAPO (Marginación 2020) y ATALAYA (modelos predictivos).",
    ]

    return DataResult(
        columns=columns,
        rows=rows,
        source="ATALAYA · Diccionario y catálogo de variables",
        facts=facts,
        empty=len(rows) == 0,
    )


def _execute_help() -> DataResult:
    facts = [
        "ATALAYA es el asistente de analítica del INE para explorar la participación ciudadana y predecir el riesgo de abstención.",
        "Puedes consultar:",
        "1. Ranking: '¿Qué 10 municipios de Chiapas tienen mayor riesgo en 2027?'",
        "2. Consulta puntual: '¿Cuál fue la participación en Jalisco en 2021?'",
        "3. Correlación: '¿Cómo se relaciona la escolaridad con la participación en Oaxaca?'",
        "4. Escenarios: '¿Qué pasa si hacemos promoción del voto juvenil en zonas rojas con 4 puntos?'",
    ]
    return DataResult(
        columns=[],
        rows=[],
        source="ATALAYA",
        facts=facts,
        empty=True,
    )


def execute(
    spec: QuerySpec,
    region_id: str | None = None,
    followup_hint: str | None = None,
) -> DataResult:
    """Execute analytical query against DataStore according to spec.
    
    Deterministic, offline-capable, and never calls LLM.
    """
    store = get_store()
    seed_dir = getattr(store, "seed_dir", None)
    _init_metadata(seed_dir)

    if spec.intent == "ranking":
        res = _execute_ranking(spec, store)
    elif spec.intent == "lookup":
        res = _execute_lookup(spec, store, region_id)
    elif spec.intent == "compare":
        res = _execute_compare(spec, store)
    elif spec.intent == "trend":
        res = _execute_trend(spec, store, region_id)
    elif spec.intent == "correlation":
        res = _execute_correlation(spec, store)
    elif spec.intent == "scenario":
        res = _execute_scenario(spec, store)
    elif spec.intent == "explain_unit":
        res = _execute_explain_unit(spec, store, region_id)
    elif spec.intent == "catalog":
        res = _execute_catalog(spec)
    elif spec.intent == "profile":
        res = _execute_profile(spec, store, region_id)
    elif spec.intent in ("help", "out_of_scope"):
        res = _execute_help()
    else:
        res = _execute_help()

    hint = followup_hint or getattr(spec, "followup_hint", None)
    if hint and hint not in res.facts:
        res.facts.append(hint)

    # 2027 forecast assumption fact
    if not res.empty:
        is_forecast_2027 = (
            spec.year == 2027
            or spec.metric in ("risk_score", "pred_abstention", "pred_participation", "pred_low", "pred_high")
            or spec.intent in ("scenario", "explain_unit")
            or (spec.scenario is not None)
        )
        if is_forecast_2027:
            m_info = {}
            if hasattr(store, "metrics"):
                try:
                    m_info = store.metrics() or {}
                except Exception:
                    pass
            val = m_info.get("national_level_assumption")
            if val is not None:
                n_val = float(val) * 100 if float(val) <= 1.0 else float(val)
                x_str = f"{n_val:.2f}".rstrip("0").rstrip(".")
            else:
                x_str = "51.84"
            fact_2027 = (
                f"El nivel nacional de 2027 es un supuesto (último nivel de elección intermedia: {x_str} %); "
                f"el semáforo compara zonas entre sí."
            )
            if fact_2027 not in res.facts:
                res.facts.append(fact_2027)

    return res
