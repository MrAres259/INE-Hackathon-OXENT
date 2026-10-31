"""Reference data for deterministic explanations.

Computes national and state historical turnout baselines, variable associations
with abstention (Spearman rho), percentiles, and migration context.
"""

from __future__ import annotations

import bisect
from dataclasses import dataclass
import logging
from pathlib import Path
import threading
from typing import Any

import numpy as np
import pandas as pd

from atalaya.config import BUILD_DIR
from atalaya.ingest.common import zpad

logger = logging.getLogger(__name__)

ASSOC_VARS: tuple[str, ...] = (
    "graproes",
    "pct_internet",
    "pct_rural",
    "pct_hli",
    "pct_analfabeta",
    "pct_po2sm",
    "pct_sin_servsalud",
    "pct_18_24",
    "pct_65ymas",
    "im_2020",
)


@dataclass(frozen=True)
class AssocStat:
    var: str
    level: str  # "mun" | "state"
    rho: float  # Spearman nacional var vs pred_abstention (rangos de pandas)
    n: int
    unfavorable_high: bool  # True si valores ALTOS de la variable van con MÁS abstención (rho > 0)
    p25: float
    p50: float
    p75: float


@dataclass(frozen=True)
class Reference:
    national_participation: dict[int, float]  # año federal -> participación LN-ponderada 0–1 (DIP_FED, filas reliable)
    state_participation: dict[tuple[str, int], float]  # (cve_ent, año) -> 0–1, igual ponderación
    mean_mun_participation: dict[int, float]  # año -> media simple de municipios confiables (la del modelo)
    associations: dict[str, dict[str, AssocStat]]  # level -> var -> stat
    level_values: dict[str, dict[str, list[float]]]  # level -> var -> valores ordenados (para percentiles)
    context: dict[str, dict[str, float]]  # unit_id -> {"pct_nacido_otra_ent", "pct_llego_2015_2020"} (0–100)


_cached_reference: Reference | None = None
_cached_fingerprint: tuple | None = None
_cache_lock = threading.Lock()
_context_warning_emitted = False


def clear_reference_cache() -> None:
    """Clear in-memory cached Reference and reset one-time warnings."""
    global _cached_reference, _cached_fingerprint, _context_warning_emitted
    with _cache_lock:
        _cached_reference = None
        _cached_fingerprint = None
        _context_warning_emitted = False


def percentile_of(ref: Reference, level: str, var: str, value: float | None) -> float | None:
    """Return percentage of units in level with value strictly smaller (0-100, 1 decimal).
    
    Returns None if value is None, NaN, or if variable/level has no data.
    """
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return None
    if level not in ref.level_values or var not in ref.level_values[level]:
        return None
    vals = ref.level_values[level][var]
    if not vals:
        return None
    try:
        val_float = float(value)
    except (ValueError, TypeError):
        return None
    k = bisect.bisect_left(vals, val_float)
    return round((k / len(vals)) * 100.0, 1)


def _compute_reference(store: Any, b_dir: Path) -> Reference:
    """Compute Reference object from store and parquet files on disk."""
    global _context_warning_emitted

    # If store is None, initialize store from b_dir or get_store
    if store is None:
        if b_dir != BUILD_DIR:
            from atalaya.store import PandasStore
            store = PandasStore(build_dir=b_dir)
        else:
            from atalaya.store import get_store
            store = get_store()

    # Load units from store
    try:
        mun_df = store.units("mun")
    except Exception as exc:
        logger.warning("Failed to load municipal units from store: %s", exc)
        mun_df = pd.DataFrame()

    if (mun_df is None or mun_df.empty) and units_file.is_file():
        try:
            raw_units = pd.read_parquet(units_file)
            if "level" in raw_units.columns:
                mun_df = raw_units[raw_units["level"] == "mun"]
            else:
                mun_df = raw_units
        except Exception:
            pass

    try:
        state_df = store.units("state")
    except Exception as exc:
        logger.warning("Failed to load state units from store: %s", exc)
        state_df = pd.DataFrame()

    if (state_df is None or state_df.empty) and units_file.is_file():
        try:
            raw_units = pd.read_parquet(units_file)
            if "level" in raw_units.columns:
                state_df = raw_units[raw_units["level"] == "state"]
        except Exception:
            pass

    # 1. Associations (Spearman rank correlation var vs pred_abstention)
    associations: dict[str, dict[str, AssocStat]] = {"mun": {}, "state": {}}
    for level, u_df in [("mun", mun_df), ("state", state_df)]:
        if u_df is not None and not u_df.empty and "pred_abstention" in u_df.columns:
            pred_abs = pd.to_numeric(u_df["pred_abstention"], errors="coerce")
            for var in ASSOC_VARS:
                if var not in u_df.columns:
                    continue
                val_s = pd.to_numeric(u_df[var], errors="coerce")
                valid = pd.DataFrame({"x": val_s, "y": pred_abs}).dropna()
                n = len(valid)
                if n < 2 or valid["x"].nunique() <= 1 or valid["y"].nunique() <= 1:
                    rho = 0.0
                    unfavorable_high = False
                    p25 = float(valid["x"].quantile(0.25)) if n > 0 else 0.0
                    p50 = float(valid["x"].quantile(0.50)) if n > 0 else 0.0
                    p75 = float(valid["x"].quantile(0.75)) if n > 0 else 0.0
                else:
                    rho = float(valid["x"].rank().corr(valid["y"].rank()))
                    if np.isnan(rho):
                        rho = 0.0
                    unfavorable_high = bool(rho > 0)
                    p25 = float(valid["x"].quantile(0.25))
                    p50 = float(valid["x"].quantile(0.50))
                    p75 = float(valid["x"].quantile(0.75))
                associations[level][var] = AssocStat(
                    var=var,
                    level=level,
                    rho=rho,
                    n=n,
                    unfavorable_high=unfavorable_high,
                    p25=p25,
                    p50=p50,
                    p75=p75,
                )

    # 2. Participation baselines
    part_file = b_dir / "participation.parquet"
    national_participation: dict[int, float] = {}
    state_participation: dict[tuple[str, int], float] = {}
    mean_mun_participation: dict[int, float] = {}

    if part_file.is_file():
        try:
            part_df = pd.read_parquet(part_file)
            if "level" in part_df.columns:
                mun_part = part_df[part_df["level"] == "mun"]
            elif "cvegeo" in part_df.columns:
                mun_part = part_df[part_df["cvegeo"].astype(str).str.len() == 5]
            else:
                mun_part = part_df

            if "election" in mun_part.columns:
                dip = mun_part[mun_part["election"] == "DIP_FED"]
            else:
                dip = mun_part

            # National participation: Σsv / Σ(sv+nv) over all municipal rows
            if not dip.empty and "year" in dip.columns and "votos_totales" in dip.columns and "nv" in dip.columns:
                dip_yr = dip.copy()
                dip_yr["year_int"] = pd.to_numeric(dip_yr["year"], errors="coerce")
                dip_yr = dip_yr.dropna(subset=["year_int"])
                dip_yr["year_int"] = dip_yr["year_int"].astype(int)
                for yr, grp in dip_yr.groupby("year_int"):
                    sv = pd.to_numeric(grp["votos_totales"], errors="coerce").fillna(0).sum()
                    nv = pd.to_numeric(grp["nv"], errors="coerce").fillna(0).sum()
                    denom = sv + nv
                    national_participation[int(yr)] = float(sv / denom) if denom > 0 else 0.0

            # State participation: equal weighting (Σsv / Σ(sv+nv) per state-year)
            if (
                not dip.empty
                and "cve_ent" in dip.columns
                and "year" in dip.columns
                and "votos_totales" in dip.columns
                and "nv" in dip.columns
            ):
                dip_st = dip.copy()
                dip_st["ent_code"] = dip_st["cve_ent"].apply(lambda v: zpad(v, 2))
                dip_st["year_int"] = pd.to_numeric(dip_st["year"], errors="coerce")
                dip_st = dip_st.dropna(subset=["year_int"])
                dip_st["year_int"] = dip_st["year_int"].astype(int)
                for (ent, yr), grp in dip_st.groupby(["ent_code", "year_int"]):
                    sv = pd.to_numeric(grp["votos_totales"], errors="coerce").fillna(0).sum()
                    nv = pd.to_numeric(grp["nv"], errors="coerce").fillna(0).sum()
                    denom = sv + nv
                    state_participation[(str(ent), int(yr))] = float(sv / denom) if denom > 0 else 0.0

            # Mean municipal participation: unweighted mean of reliable municipalities
            if not dip.empty and "year" in dip.columns and "participacion" in dip.columns:
                dip_rel = dip.copy()
                dip_rel["year_int"] = pd.to_numeric(dip_rel["year"], errors="coerce")
                dip_rel = dip_rel.dropna(subset=["year_int"])
                dip_rel["year_int"] = dip_rel["year_int"].astype(int)

                if "reliable" in dip_rel.columns:
                    rel_mask = dip_rel["reliable"].fillna(False).astype(bool)
                else:
                    from atalaya.model.panel import compute_reliable
                    rel_mask = compute_reliable(dip_rel)

                reliable_dip = dip_rel[rel_mask]
                for yr, grp in reliable_dip.groupby("year_int"):
                    vals = pd.to_numeric(grp["participacion"], errors="coerce").dropna()
                    mean_mun_participation[int(yr)] = float(vals.mean()) if not vals.empty else 0.0

        except Exception as exc:
            logger.warning("Failed to load participation baselines from %s: %s", part_file, exc)

    # 3. Context (migration from context.parquet)
    ctx_file = b_dir / "context.parquet"
    context: dict[str, dict[str, float]] = {}
    if not ctx_file.is_file():
        if not _context_warning_emitted:
            logger.warning("context.parquet not found at %s. Migration context will be empty.", ctx_file)
            _context_warning_emitted = True
    else:
        try:
            ctx_df = pd.read_parquet(ctx_file)
            for _, r in ctx_df.iterrows():
                uid = str(r["id"])
                p_nac = float(r["pct_nacido_otra_ent"]) if pd.notna(r.get("pct_nacido_otra_ent")) else None
                p_lle = float(r["pct_llego_2015_2020"]) if pd.notna(r.get("pct_llego_2015_2020")) else None
                if p_nac is not None and p_lle is not None:
                    context[uid] = {
                        "pct_nacido_otra_ent": p_nac,
                        "pct_llego_2015_2020": p_lle,
                    }
        except Exception as exc:
            logger.warning("Failed to read context.parquet from %s: %s", ctx_file, exc)

    # 4. Level values (sorted non-null lists for percentile_of)
    level_values: dict[str, dict[str, list[float]]] = {"mun": {}, "state": {}}
    for level, u_df in [("mun", mun_df), ("state", state_df)]:
        if u_df is not None and not u_df.empty:
            for col in u_df.columns:
                try:
                    s = pd.to_numeric(u_df[col], errors="coerce").dropna()
                    if not s.empty:
                        level_values[level][col] = s.astype(float).sort_values().tolist()
                except Exception:
                    pass

    # Include pct_nacido_otra_ent and pct_llego_2015_2020 from context.parquet
    if ctx_file.is_file():
        try:
            ctx_df = pd.read_parquet(ctx_file)
            for level in ("mun", "state"):
                sub_ctx = ctx_df[ctx_df["level"] == level] if "level" in ctx_df.columns else ctx_df
                for col in ("pct_nacido_otra_ent", "pct_llego_2015_2020"):
                    if col in sub_ctx.columns:
                        s = pd.to_numeric(sub_ctx[col], errors="coerce").dropna()
                        if not s.empty:
                            level_values[level][col] = s.astype(float).sort_values().tolist()
        except Exception:
            pass

    return Reference(
        national_participation=national_participation,
        state_participation=state_participation,
        mean_mun_participation=mean_mun_participation,
        associations=associations,
        level_values=level_values,
        context=context,
    )


def get_reference(store: Any = None, build_dir: Path | None = None) -> Reference:
    """Get Reference statistics, cached in memory until source parquet files change."""
    global _cached_reference, _cached_fingerprint

    if build_dir is not None:
        b_dir = Path(build_dir)
    elif store is not None and hasattr(store, "build_dir"):
        b_dir = Path(store.build_dir)
    else:
        b_dir = Path(BUILD_DIR)

    units_file = b_dir / "units.parquet"
    part_file = b_dir / "participation.parquet"
    ctx_file = b_dir / "context.parquet"

    def _get_mtime(p: Path) -> float | None:
        try:
            return p.stat().st_mtime if p.is_file() else None
        except OSError:
            return None

    fingerprint = (
        str(b_dir.resolve()),
        _get_mtime(units_file),
        _get_mtime(part_file),
        _get_mtime(ctx_file),
        id(store) if store is not None else None,
    )

    with _cache_lock:
        if _cached_reference is not None and fingerprint == _cached_fingerprint:
            return _cached_reference

        ref = _compute_reference(store=store, b_dir=b_dir)
        _cached_reference = ref
        _cached_fingerprint = fingerprint
        return ref
