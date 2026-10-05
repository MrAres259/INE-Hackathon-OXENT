"""Panel data preparation and trend estimation for ATALAYA."""

from __future__ import annotations

from pathlib import Path
from typing import Sequence

import numpy as np
import pandas as pd

from atalaya import config
from atalaya.ingest.common import read_parquet, to_num


PRESIDENTIAL_YEARS = {2000, 2006, 2012, 2018, 2024}

PARTICIPATION_COLUMNS = [
    "cvegeo",
    "cve_ent",
    "year",
    "election",
    "lista_nominal",
    "votos_totales",
    "participacion",
]

FEATURES_COLUMNS = [
    "cvegeo",
    "cve_ent",
    "cve_mun",
    "nom_ent",
    "nom_mun",
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
]


def is_presidential(year: int) -> int:
    """Return 1 if year is a presidential election year, else 0."""
    return 1 if int(year) in PRESIDENTIAL_YEARS else 0


def load_inputs(
    build_dir: Path | str | None = None,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Load participation and features Parquet files.

    If files do not exist or are missing, returns empty DataFrames
    with expected columns.
    """
    b_dir = Path(build_dir) if build_dir is not None else config.BUILD_DIR
    part_path = b_dir / "participation.parquet"
    feats_path = b_dir / "features.parquet"

    if part_path.is_file():
        try:
            part = read_parquet(part_path)
        except Exception:
            part = pd.DataFrame(columns=PARTICIPATION_COLUMNS)
    else:
        part = pd.DataFrame(columns=PARTICIPATION_COLUMNS)

    if feats_path.is_file():
        try:
            feats = read_parquet(feats_path)
        except Exception:
            feats = pd.DataFrame(columns=FEATURES_COLUMNS)
    else:
        feats = pd.DataFrame(columns=FEATURES_COLUMNS)

    return part, feats


def participation_matrix(
    part: pd.DataFrame,
    election: str = "DIP_FED",
    min_year: int = 2009,
    value_col: str = "participacion",
) -> pd.DataFrame:
    """Pivot participation table to (cvegeo x year) matrix.

    Index is cvegeo, columns are integer years, values are value_col.
    """
    if part.empty or "cvegeo" not in part.columns or "year" not in part.columns:
        return pd.DataFrame()

    df = part.copy()
    if "election" in df.columns and election is not None:
        df = df[df["election"] == election]

    df["year"] = pd.to_numeric(df["year"], errors="coerce")
    df = df.dropna(subset=["year", "cvegeo"])
    df["year"] = df["year"].astype(int)

    if min_year is not None:
        df = df[df["year"] >= min_year]

    if df.empty or value_col not in df.columns:
        return pd.DataFrame()

    df[value_col] = to_num(df[value_col]) if value_col != "lista_nominal" else pd.to_numeric(df[value_col], errors="coerce")
    aggfunc = "sum" if value_col in ("lista_nominal", "votos_totales") else "mean"
    piv = df.pivot_table(index="cvegeo", columns="year", values=value_col, aggfunc=aggfunc)
    piv.columns = [int(c) for c in piv.columns]
    piv = piv.sort_index(axis=1)
    return piv


def lista_nominal_matrix(
    part: pd.DataFrame,
    election: str = "DIP_FED",
    min_year: int = 2009,
) -> pd.DataFrame:
    """Pivot nominal list to (cvegeo x year) matrix."""
    return participation_matrix(part, election=election, min_year=min_year, value_col="lista_nominal")


def unit_trend(
    series: pd.Series,
    min_year: int | None = 2009,
) -> tuple[float, float]:
    """Calculate linear trend and volatility for a municipality or state.

    OLS of participacion*100 ~ 1 + k + pres, with k = (year - min_year)/3.
    Returns (trend_pp, volatility_pp) where trend_pp is coefficient of k,
    and volatility_pp is sample standard deviation of residuals (ddof=1).
    Requires >= 4 non-NaN points; otherwise returns (NaN, NaN).
    """
    if series is None or len(series) == 0:
        return (np.nan, np.nan)

    clean = series.dropna()
    if len(clean) < 4:
        return (np.nan, np.nan)

    try:
        years = pd.to_numeric(clean.index).values.astype(float)
    except Exception:
        return (np.nan, np.nan)

    base_yr = float(min_year) if min_year is not None else float(np.min(years))
    k = (years - base_yr) / 3.0
    pres = np.array([float(is_presidential(int(round(yr)))) for yr in years])

    vals = clean.values.astype(float)
    # If values are in proportion (0..1), convert to percentage points
    if np.nanmax(vals) <= 1.05:
        y_pp = vals * 100.0
    else:
        y_pp = vals.copy()

    X = np.column_stack([np.ones_like(k), k, pres])
    try:
        coefs, _, _, _ = np.linalg.lstsq(X, y_pp, rcond=None)
        trend_pp = float(coefs[1])
        residuals = y_pp - X @ coefs
        volatility_pp = float(np.std(residuals, ddof=1))
        if np.isclose(volatility_pp, 0.0, atol=1e-8):
            volatility_pp = 0.0
        return (trend_pp, volatility_pp)
    except Exception:
        return (np.nan, np.nan)


def training_rows(
    Y: pd.DataFrame,
    feats: pd.DataFrame,
    targets: Sequence[int],
) -> pd.DataFrame:
    """Construct training panel rows for given target election years.

    For each target year T in targets with T-3 and T-6 in Y.columns:
    Creates a row per municipality with:
      y = Y[T]
      lag1 = Y[T-3]
      lag2 = Y[T-6]
      pres = is_presidential(T)
      and all feature columns from feats.
    Discards rows with y, lag1, or lag2 NaN.
    """
    if Y.empty or len(targets) == 0:
        return pd.DataFrame()

    feats_df = feats.copy()
    if "cvegeo" in feats_df.columns:
        feats_df = feats_df.set_index("cvegeo")
    feats_df.index.name = "cvegeo"
    if "cvegeo" in feats_df.columns:
        feats_df = feats_df.drop(columns=["cvegeo"])

    # Ensure log_pob_18ymas is derived if pob_18ymas is available
    if "log_pob_18ymas" not in feats_df.columns and "pob_18ymas" in feats_df.columns:
        pob = pd.to_numeric(feats_df["pob_18ymas"], errors="coerce").fillna(0).clip(lower=0)
        feats_df["log_pob_18ymas"] = np.log1p(pob)

    dfs: list[pd.DataFrame] = []
    for T in targets:
        lag1_yr = T - 3
        lag2_yr = T - 6
        if T not in Y.columns or lag1_yr not in Y.columns or lag2_yr not in Y.columns:
            continue

        y_s = Y[T]
        l1_s = Y[lag1_yr]
        l2_s = Y[lag2_yr]

        valid_idx = y_s.dropna().index.intersection(l1_s.dropna().index).intersection(l2_s.dropna().index)
        if len(valid_idx) == 0:
            continue

        df_t = pd.DataFrame(index=valid_idx)
        df_t.index.name = "cvegeo"
        df_t["cvegeo"] = valid_idx
        df_t["target_year"] = int(T)
        df_t["y"] = y_s.loc[valid_idx].astype(float)
        df_t["lag1"] = l1_s.loc[valid_idx].astype(float)
        df_t["lag2"] = l2_s.loc[valid_idx].astype(float)
        df_t["pres"] = float(is_presidential(int(T)))

        joined = df_t.join(feats_df, how="left").reset_index(drop=True)
        dfs.append(joined)

    if not dfs:
        return pd.DataFrame()

    res = pd.concat(dfs, ignore_index=True)
    return res
