"""Panel data preparation and trend estimation for ATALAYA."""

from __future__ import annotations

from pathlib import Path
from typing import Sequence

import numpy as np
import pandas as pd

from atalaya import config
from atalaya.ingest.common import read_parquet, to_num, zpad


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

CCPC_FEATURE_COLUMNS = [
    "pct_ln_18_34",
    "gap_youth_pp",
    "gap_sexo_pp",
    "pct_ln_rural",
    "ns_rate",
]


def is_presidential(year: int) -> int:
    """Return 1 if year is a presidential election year, else 0."""
    return 1 if int(year) in PRESIDENTIAL_YEARS else 0


def load_ccpc_features(
    build_dir: Path | str | None = None,
) -> pd.DataFrame:
    """Load ccpc_features Parquet file if available.

    Returns empty DataFrame if missing or unreadable.
    """
    b_dir = Path(build_dir) if build_dir is not None else config.BUILD_DIR
    ccpc_path = b_dir / "ccpc_features.parquet"
    if ccpc_path.is_file():
        try:
            return read_parquet(ccpc_path)
        except Exception:
            return pd.DataFrame()
    return pd.DataFrame()


def load_inputs(
    build_dir: Path | str | None = None,
    include_ccpc: bool = False,
) -> tuple[pd.DataFrame, pd.DataFrame] | tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Load participation and features Parquet files.

    If include_ccpc=True, returns (part, feats, ccpc_feats).
    Otherwise returns (part, feats).
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

    if include_ccpc:
        ccpc_feats = load_ccpc_features(b_dir)
        return part, feats, ccpc_feats

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
    ccpc_feats: pd.DataFrame | None = None,
    L: pd.DataFrame | None = None,
) -> pd.DataFrame:
    """Construct training panel rows for given target election years.

    For each target year T in targets with T-3 and T-6 in Y.columns:
    Creates a row per municipality with:
      y = Y[T]
      lag1 = Y[T-3]
      lag2 = Y[T-6]
      pres = is_presidential(T)
      CCPC features from year T-3 (if ccpc_feats provided)
      coverage_ln computed from L[T-3] / pob_18ymas (if L provided)
      and all feature columns from feats.
    Discards rows with y, lag1, or lag2 NaN.
    """
    if Y.empty or len(targets) == 0:
        return pd.DataFrame()

    feats_df = feats.copy()
    if "cvegeo" in feats_df.columns:
        feats_df["cvegeo"] = feats_df["cvegeo"].astype(str).str.strip().map(lambda v: zpad(v, 5))
        feats_df = feats_df.set_index("cvegeo")
    feats_df.index = feats_df.index.astype(str).str.strip().map(lambda v: zpad(v, 5))
    feats_df.index.name = "cvegeo"
    if "cvegeo" in feats_df.columns:
        feats_df = feats_df.drop(columns=["cvegeo"])

    # Ensure log_pob_18ymas is derived if pob_18ymas is available
    if "log_pob_18ymas" not in feats_df.columns and "pob_18ymas" in feats_df.columns:
        pob = pd.to_numeric(feats_df["pob_18ymas"], errors="coerce").fillna(0).clip(lower=0)
        feats_df["log_pob_18ymas"] = np.log1p(pob)

    # Process ccpc_feats if provided
    has_ccpc = (
        ccpc_feats is not None
        and not ccpc_feats.empty
        and "year" in ccpc_feats.columns
        and "cvegeo" in ccpc_feats.columns
    )
    ccpc_df: pd.DataFrame | None = None
    avail_ccpc_cols: list[str] = []
    if has_ccpc:
        ccpc_df = ccpc_feats.copy()
        ccpc_df["cvegeo"] = ccpc_df["cvegeo"].astype(str).str.strip().apply(lambda v: zpad(v, 5))
        ccpc_df["year"] = pd.to_numeric(ccpc_df["year"], errors="coerce")
        avail_ccpc_cols = [c for c in CCPC_FEATURE_COLUMNS if c in ccpc_df.columns]
        for c in avail_ccpc_cols:
            ccpc_df[c] = to_num(ccpc_df[c])

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
        valid_idx = pd.Index([zpad(str(v).strip(), 5) for v in valid_idx])
        if len(valid_idx) == 0:
            continue

        df_t = pd.DataFrame(index=valid_idx)
        df_t.index.name = "cvegeo"
        df_t["cvegeo"] = valid_idx
        df_t["target_year"] = int(T)
        df_t["y"] = y_s.reindex(valid_idx).astype(float).values
        df_t["lag1"] = l1_s.reindex(valid_idx).astype(float).values
        df_t["lag2"] = l2_s.reindex(valid_idx).astype(float).values
        df_t["pres"] = float(is_presidential(int(T)))

        # CCPC features from year T-3
        if has_ccpc and ccpc_df is not None and avail_ccpc_cols:
            ccpc_t = ccpc_df[ccpc_df["year"] == lag1_yr]
            if not ccpc_t.empty:
                ccpc_indexed = ccpc_t.drop_duplicates(subset=["cvegeo"]).set_index("cvegeo")
                for c in avail_ccpc_cols:
                    df_t[c] = ccpc_indexed[c].reindex(valid_idx).values
            else:
                for c in avail_ccpc_cols:
                    df_t[c] = np.nan

        # Dynamic coverage_ln from year T-3 if L provided
        if L is not None and lag1_yr in L.columns and "pob_18ymas" in feats_df.columns:
            ln_vals = pd.to_numeric(L[lag1_yr], errors="coerce").reindex(valid_idx)
            pob_vals = pd.to_numeric(feats_df["pob_18ymas"], errors="coerce").reindex(valid_idx)
            cov_s = (ln_vals / pob_vals.replace(0, np.nan)).clip(lower=0.0, upper=1.2)
            df_t["coverage_ln"] = cov_s.values

        cols_to_join = [c for c in feats_df.columns if c not in df_t.columns]
        joined = df_t.join(feats_df[cols_to_join], how="left").reset_index(drop=True)
        dfs.append(joined)

    if not dfs:
        return pd.DataFrame()

    res = pd.concat(dfs, ignore_index=True)
    return res


def intermediate_turnout(
    Y: pd.DataFrame,
) -> pd.Series:
    """Average turnout in percentage points for intermediate (non-presidential) DIP_FED years.

    Calculates mean across non-presidential election years in Y for each municipality
    with at least 1 available year. Converts to percentage points if values are proportions (<= 1.05).
    """
    if Y.empty:
        return pd.Series(dtype=float)

    inter_years = [y for y in Y.columns if not is_presidential(int(y))]
    if not inter_years:
        inter_years = list(Y.columns)

    sub = Y[inter_years].apply(pd.to_numeric, errors="coerce")
    vals_max = np.nanmax(sub.values) if len(sub) > 0 else 1.0
    mult = 100.0 if vals_max <= 1.05 else 1.0

    return (sub * mult).mean(axis=1, skipna=True).dropna()


def intermediate_ccpc_features(
    ccpc_feats: pd.DataFrame,
    feature_cols: Sequence[str] = tuple(CCPC_FEATURE_COLUMNS),
    intermediate_years: Sequence[int] = (2009, 2015, 2021),
) -> pd.DataFrame:
    """Average CCPC features over intermediate DIP_FED election years (2009, 2015, 2021).

    Returns DataFrame indexed by 5-digit cvegeo with columns in feature_cols.
    """
    if ccpc_feats.empty or "year" not in ccpc_feats.columns or "cvegeo" not in ccpc_feats.columns:
        return pd.DataFrame()

    df = ccpc_feats.copy()
    df["cvegeo"] = df["cvegeo"].astype(str).str.strip().apply(lambda v: zpad(v, 5))
    df["year"] = pd.to_numeric(df["year"], errors="coerce")
    df = df[df["year"].isin(intermediate_years)]
    if df.empty:
        return pd.DataFrame()

    avail_cols = [c for c in feature_cols if c in df.columns]
    if not avail_cols:
        return pd.DataFrame()

    for c in avail_cols:
        df[c] = to_num(df[c])

    piv = df.groupby("cvegeo")[avail_cols].mean()
    return piv

