"""Deterministic recommendation engine for electoral abstention prevention."""
from __future__ import annotations

import csv
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from atalaya.config import SEED_DIR


@dataclass
class RecoReference:
    """National or state reference distributions for recommendation variables."""
    level: str
    p25: dict[str, float] = field(default_factory=dict)
    p50: dict[str, float] = field(default_factory=dict)
    p75: dict[str, float] = field(default_factory=dict)
    distributions: dict[str, np.ndarray] = field(default_factory=dict)

    def percentile_of(self, col: str, val: float | None) -> int:
        """Returns integer percentile (0..100) of val in distribution."""
        if val is None or pd.isna(val):
            return 50
        dist = self.distributions.get(col)
        if dist is None or len(dist) == 0:
            return 50
        pos = np.searchsorted(dist, float(val), side="right")
        pct = int(round(100.0 * pos / len(dist)))
        return min(max(pct, 0), 100)


def build_reference(units: pd.DataFrame, level: str = "mun") -> RecoReference:
    """Builds reference percentiles and distributions for numeric variables.

    Parameters
    ----------
    units : pd.DataFrame
        Complete units DataFrame.
    level : str
        'mun' (default) or 'state'.

    Returns
    -------
    RecoReference
    """
    if "level" in units.columns:
        df = units[units["level"] == level].copy()
    else:
        df = units.copy()

    ref = RecoReference(level=level)

    numeric_cols = [
        "pct_18_24", "pct_rural", "pct_hli", "pct_analfabeta",
        "graproes", "pct_internet", "trend_pp", "volatility_pp",
        "pct_65ymas", "coverage_ln",
    ]

    for col in numeric_cols:
        if col in df.columns:
            valid = df[col].dropna().values.astype(float)
            if len(valid) > 0:
                sorted_vals = np.sort(valid)
                ref.distributions[col] = sorted_vals
                ref.p25[col] = float(np.percentile(valid, 25))
                ref.p50[col] = float(np.percentile(valid, 50))
                ref.p75[col] = float(np.percentile(valid, 75))
            else:
                ref.distributions[col] = np.array([])
                ref.p25[col] = 0.0
                ref.p50[col] = 0.0
                ref.p75[col] = 0.0

    return ref


def load_rules(csv_path: Path | None = None) -> list[dict[str, str]]:
    """Loads recommendation rule definitions from recommendations.csv."""
    path = csv_path or (SEED_DIR / "recommendations.csv")
    rules = []
    if path.is_file():
        with open(path, mode="r", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for row in reader:
                rules.append(row)
    return rules


VAR_DIRECTIONS: dict[str, str] = {
    "pct_internet": "low",
    "graproes": "low",
    "coverage_ln": "low",
    "pct_18_24": "high",
    "pct_rural": "high",
    "pct_hli": "high",
    "pct_analfabeta": "high",
    "pct_65ymas": "high",
    "trend_pp": "low",
    "volatility_pp": "high",
}


def _eval_single_condition(
    cond: str,
    unit: dict,
    drivers: list[dict],
    ref: RecoReference,
    rule: dict | None = None,
) -> bool:
    """Evaluates a single condition string."""
    cond = cond.strip()

    # 1. Driver condition: driver:<col>
    if cond.startswith("driver:"):
        col = cond.split(":", 1)[1].strip()
        has_driver = any(d.get("key") == col and d.get("direction") == "sube_abstencion" for d in drivers)
        if not has_driver:
            return False

        # Driver trigger also requires unit value to be on the unfavorable side of the national median
        unit_val = unit.get(col)
        if unit_val is None or pd.isna(unit_val):
            return False
        try:
            val_float = float(unit_val)
        except (ValueError, TypeError):
            return False

        median = ref.p50.get(col)
        if median is None:
            return False

        rule_dir = (rule.get("direction") or "").strip().lower() if rule else ""
        if rule_dir in ("low", "high"):
            direction = rule_dir
        elif col in VAR_DIRECTIONS:
            direction = VAR_DIRECTIONS[col]
        else:
            direction = "high"

        if direction == "low":
            return val_float < median
        else:
            return val_float > median

    # 2. In condition: col in A;B
    if " in " in cond:
        col, targets = cond.split(" in ", 1)
        col = col.strip()
        allowed = [t.strip().lower() for t in targets.split(";")]
        unit_val = str(unit.get(col, "")).strip().lower()
        return unit_val in allowed

    # 3. Numeric comparisons
    m = re.match(r"^([a-zA-Z0-9_]+)\s*(>=|<=|>|<)\s*([a-zA-Z0-9_.-]+)$", cond)
    if m:
        col, op, rhs = m.group(1), m.group(2), m.group(3)
        unit_val = unit.get(col)
        if unit_val is None or pd.isna(unit_val):
            return False
        unit_val = float(unit_val)

        # Threshold value from ref or literal
        if rhs == "p75":
            thresh = ref.p75.get(col)
            if thresh is None:
                return False
        elif rhs == "p25":
            thresh = ref.p25.get(col)
            if thresh is None:
                return False
        elif rhs == "p50":
            thresh = ref.p50.get(col)
            if thresh is None:
                return False
        else:
            try:
                thresh = float(rhs)
            except ValueError:
                return False

        if op == ">=":
            return unit_val >= thresh
        elif op == "<=":
            return unit_val <= thresh
        elif op == ">":
            return unit_val > thresh
        elif op == "<":
            return unit_val < thresh

    return False


def _eval_trigger(
    trigger: str,
    unit: dict,
    drivers: list[dict],
    ref: RecoReference,
    rule: dict | None = None,
) -> bool:
    """Evaluates an OR-separated trigger string."""
    conditions = trigger.split("|")
    return any(_eval_single_condition(c, unit, drivers, ref, rule=rule) for c in conditions)


def _format_rationale(template: str, unit: dict, ref: RecoReference) -> str:
    """Fills the rationale template with formatted unit variables."""
    def replacer(match):
        token = match.group(1)
        if token == "name":
            return str(unit.get("name", "Esta zona"))
        if token == "gm_2020":
            return str(unit.get("gm_2020", "N/D"))
        if token.startswith("p_"):
            col = token[2:]
            return str(ref.percentile_of(col, unit.get(col)))

        val = unit.get(token)
        if val is None or pd.isna(val):
            return "N/D"

        try:
            val_float = float(val)
        except (ValueError, TypeError):
            return str(val)

        if token.startswith("pct_") or token == "coverage_ln":
            return f"{val_float * 100:.1f} %"
        if token in ["graproes", "trend_pp", "volatility_pp"]:
            return f"{val_float:.1f}"
        return f"{val_float:.1f}"

    return re.sub(r"\{([a-zA-Z0-9_]+)\}", replacer, template)


RULE_VARS: dict[str, list[str]] = {
    "R01": ["pct_18_24"],
    "R02": ["pct_rural"],
    "R03": ["pct_hli"],
    "R04": ["pct_analfabeta", "graproes"],
    "R05": ["pct_internet"],
    "R06": ["trend_pp"],
    "R07": ["volatility_pp"],
    "R08": ["pct_65ymas"],
    "R09": ["coverage_ln"],
    "R10": ["gm_2020"],
}


def recommend(
    unit: dict,
    drivers: list[dict],
    ref: RecoReference,
    rules: list[dict] | None = None,
) -> list[dict]:
    """Generates up to 4 preventive recommendations for a geographic unit.

    Parameters
    ----------
    unit : dict
        Attributes of the unit (columns from units.parquet).
    drivers : list[dict]
        Top drivers of abstention (from drivers.parquet).
    ref : RecoReference
        Reference percentiles for formatting and triggers.
    rules : list[dict] | None
        Optional override for recommendation rules.

    Returns
    -------
    list[dict]
        List of Recommendation dicts conforming to §7.
    """
    rule_defs = rules if rules is not None else load_rules()
    cat = str(unit.get("category", "")).lower()

    # Determine driver #1
    driver_1_key = drivers[0].get("key") if drivers and len(drivers) > 0 else None

    triggered: list[dict] = []

    for idx, r in enumerate(rule_defs):
        trigger = r.get("trigger", "")
        if not _eval_trigger(trigger, unit, drivers, ref, rule=r):
            continue

        base_prio = r.get("base_priority", "baja")

        # Priority calculation
        if base_prio == "alta" or cat == "rojo":
            priority = "alta"
        elif cat == "naranja" or base_prio == "media":
            priority = "media"
        else:
            priority = "baja"

        rationale = _format_rationale(r.get("rationale", ""), unit, ref)

        r_id = r.get("id", f"R{idx:02d}")
        vars_for_rule = RULE_VARS.get(r_id, [])
        is_driver_1 = 0 if (driver_1_key and driver_1_key in vars_for_rule) else 1

        prio_order = {"alta": 0, "media": 1, "baja": 2}
        prio_rank = prio_order.get(priority, 3)

        item = {
            "id": r_id,
            "title": r.get("title", ""),
            "rationale": rationale,
            "priority": priority,
            "lever": r.get("lever", "campana_general"),
            "source": "rules",
            "_sort_key": (prio_rank, is_driver_1, idx),
        }
        triggered.append(item)

    if triggered:
        triggered.sort(key=lambda x: x["_sort_key"])
        selected = triggered[:4]
        for item in selected:
            item.pop("_sort_key", None)
        return selected

    # Fallback if nothing triggered and unit is red or orange
    if cat in ["rojo", "naranja"]:
        name = unit.get("name", "Esta zona")
        fallback_prio = "alta" if cat == "rojo" else "media"
        return [
            {
                "id": "R06",
                "title": "Diagnóstico de riesgo de abstención",
                "rationale": f"{name}: clasificada en riesgo {cat} de abstención. Levantar diagnóstico de causas con órganos locales y sociedad civil antes del proceso.",
                "priority": fallback_prio,
                "lever": "campana_general",
                "source": "rules",
            }
        ]

    return []
