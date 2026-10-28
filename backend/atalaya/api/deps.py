"""Dependencies and caching for ATALAYA API."""

from __future__ import annotations

from collections import OrderedDict
import copy
import functools
import json
import logging
from typing import Any, Tuple

import pandas as pd

from atalaya.config import get_settings, reload_env
from atalaya.search_client import reset_client
from atalaya.store import DataStore, get_store, StoreError

try:
    from atalaya.model.scenarios import (
        SCENARIOS,
        default_params,
        simulate as model_simulate,
    )
except ImportError:
    SCENARIOS = [
        {"id": "base", "label": "Sin intervención", "description": "Tendencia histórica", "params": []},
        {"id": "intervencion", "label": "Con intervención", "description": "Intervención hipotética", "params": []},
        {"id": "pesimista", "label": "Escenario pesimista", "description": "Caída general", "params": []},
    ]

    def default_params(scenario: str) -> dict:
        return {}

    def model_simulate(
        units: pd.DataFrame,
        scenario: str,
        params: dict | None = None,
        level: str = "mun",
        ent: str | None = None,
    ) -> Tuple[pd.DataFrame, dict]:
        return pd.DataFrame(), {}

try:
    from atalaya.model.recommend import build_reference as model_build_reference, recommend as model_recommend
except ImportError:
    def model_build_reference(units: pd.DataFrame, level: str = "mun") -> Any:
        return None

    def model_recommend(unit: dict, drivers: list[dict], ref: Any) -> list[dict]:
        return []

logger = logging.getLogger(__name__)

# Cache containers
_UNITS_DF_CACHE: pd.DataFrame | None = None
_SIMULATE_CACHE: OrderedDict[Tuple[str, str, str, str | None], Tuple[pd.DataFrame, dict]] = OrderedDict()
_MAX_SIMULATE_CACHE = 64
_RECO_REF_CACHE: dict[str, Any] = {}


def get_units_df() -> pd.DataFrame:
    """Retrieve concatenated municipal and state units DataFrame, cached."""
    global _UNITS_DF_CACHE
    if _UNITS_DF_CACHE is None:
        store = get_store()
        mun_df = store.units(level="mun")
        state_df = store.units(level="state")
        if mun_df.empty and state_df.empty:
            _UNITS_DF_CACHE = pd.DataFrame()
        else:
            _UNITS_DF_CACHE = pd.concat([mun_df, state_df], ignore_index=True)
    return _UNITS_DF_CACHE


def cached_simulate(
    scenario: str,
    params: dict | None = None,
    level: str = "mun",
    ent: str | None = None,
) -> Tuple[pd.DataFrame, dict]:
    """Run scenario simulation with LRU caching (max 64 entries)."""
    global _SIMULATE_CACHE
    params = params or {}
    params_json = json.dumps(params, sort_keys=True)
    cache_key = (scenario, params_json, level, ent)

    if cache_key in _SIMULATE_CACHE:
        _SIMULATE_CACHE.move_to_end(cache_key)
        items_df, summary = _SIMULATE_CACHE[cache_key]
        return items_df.copy(), copy.deepcopy(summary)

    units_all = get_units_df()
    items_df, summary = model_simulate(
        units_all,
        scenario=scenario,
        params=params,
        level=level,
        ent=ent,
    )

    if len(_SIMULATE_CACHE) >= _MAX_SIMULATE_CACHE:
        _SIMULATE_CACHE.popitem(last=False)

    _SIMULATE_CACHE[cache_key] = (items_df, summary)
    return items_df.copy(), copy.deepcopy(summary)


def get_reco_reference(level: str = "mun") -> Any:
    """Retrieve recommendation reference distributions, cached by level."""
    global _RECO_REF_CACHE
    if level not in _RECO_REF_CACHE:
        units_all = get_units_df()
        level_df = units_all[units_all["level"] == level] if "level" in units_all.columns else units_all
        _RECO_REF_CACHE[level] = model_build_reference(level_df, level=level)
    return _RECO_REF_CACHE[level]


def reload_all() -> dict:
    """Clear all API and store caches, reloading env and search client, returning updated store stats."""
    global _UNITS_DF_CACHE, _SIMULATE_CACHE, _RECO_REF_CACHE
    _UNITS_DF_CACHE = None
    _SIMULATE_CACHE.clear()
    _RECO_REF_CACHE.clear()

    reload_env()
    reset_client()
    if hasattr(get_store, "cache_clear"):
        get_store.cache_clear()

    store = get_store()
    store.reload()
    return store.stats()
