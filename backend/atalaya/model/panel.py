"""Panel data preparation, relative deviations, and trend estimation for ATALAYA."""

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


def load_concurrencia(seed_dir: Path | str | None = None) -> pd.DataFrame:
    """Load concurrencia_gubernatura.csv seed table.

    Returns DataFrame with columns [year, cve_ent, note].
    """
    s_dir = Path(seed_dir) if seed_dir is not None else config.SEED_DIR
    path = s_dir / "concurrencia_gubernatura.csv"
    if not path.is_file():
        return pd.DataFrame(columns=["year", "cve_ent", "note"])
    try:
        df = pd.read_csv(path, dtype=str)
        df["year"] = pd.to_numeric(df["year"], errors="coerce")
        df = df.dropna(subset=["year"])
        df["year"] = df["year"].astype(int)
        df["cve_ent"] = df["cve_ent"].astype(str).str.strip().map(lambda v: zpad(v, 2))
        return df
    except Exception:
        return pd.DataFrame(columns=["year", "cve_ent", "note"])


def get_gov_concurrence_set(seed_dir: Path | str | None = None) -> set[tuple[int, str]]:
    """Return a set of (year, cve_ent) with concurrent gubernatorial elections."""
    df = load_concurrencia(seed_dir)
    if df.empty:
        return set()
    return set(zip(df["year"], df["cve_ent"]))


def is_gubernatorial(
    year: int,
    cve_ent: str,
    gov_set: set[tuple[int, str]] | None = None,
    seed_dir: Path | str | None = None,
) -> int:
    """Return 1 if the given state and year had a concurrent gubernatorial election, else 0."""
    if gov_set is None:
        gov_set = get_gov_concurrence_set(seed_dir)
    ent = zpad(str(cve_ent).strip(), 2)
    return 1 if (int(year), ent) in gov_set else 0


def compute_reliable(part: pd.DataFrame) -> pd.Series:
    """Determine whether participation records are reliable according to §11.1.

    Rule:
      ns_rate = ns / lista_nominal
      reliable = (ns_rate <= 0.5) and (participacion >= 0.02)
    Uses the existing 'reliable' column if present.
    """
    if part.empty:
        return pd.Series(dtype=bool)

    if "reliable" in part.columns:
        return part["reliable"].fillna(False).astype(bool)

    part_s = to_num(part["participacion"]) if "participacion" in part.columns else pd.Series(np.nan, index=part.index)

    if "ns" in part.columns and "lista_nominal" in part.columns:
        ns_s = to_num(part["ns"]).fillna(0.0)
        ln_s = to_num(part["lista_nominal"]).replace(0, np.nan)
        ns_rate = (ns_s / ln_s).fillna(0.0)
    elif "ns_rate" in part.columns:
        ns_rate = to_num(part["ns_rate"]).fillna(0.0)
    else:
        ns_rate = pd.Series(0.0, index=part.index)

    rel = (ns_rate <= 0.5) & (part_s >= 0.02) & part_s.notna()
    return rel


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
    reliable_only: bool = False,
) -> pd.DataFrame:
    """Pivot participation table to (cvegeo x year) matrix.

    Index is 5-digit cvegeo, columns are integer years, values are value_col.
    If reliable_only=True and value_col=='participacion', non-reliable municipality-years
    are treated as NaN.
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

    if reliable_only and value_col == "participacion":
        rel_mask = compute_reliable(df)
        df.loc[~rel_mask, value_col] = np.nan

    df[value_col] = (
        to_num(df[value_col])
        if value_col != "lista_nominal"
        else pd.to_numeric(df[value_col], errors="coerce")
    )
    df["cvegeo"] = df["cvegeo"].astype(str).str.strip().map(lambda v: zpad(v, 5))
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


def deviation_matrix(Y: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series]:
    """Compute relative participation deviation matrix dev_{i, T} and unweighted means.

    dev_{i, T} = 100 * Y_{i, T} - media_no_ponderada_T
    Only reliable municipality-years in Y are used; non-reliable entries (NaN in Y)
    remain NaN in dev.
    Returns (dev_matrix, unweighted_means_pp).
    """
    if Y.empty:
        return pd.DataFrame(), pd.Series(dtype=float)

    vals_max = np.nanmax(Y.values) if len(Y) > 0 else 1.0
    mult = 100.0 if vals_max <= 1.05 else 1.0

    Y_pp = Y * mult
    means = Y_pp.mean(axis=0, skipna=True)
    dev = Y_pp.subtract(means, axis=1)
    return dev, means


def intermediate_offset(
    Y: pd.DataFrame,
    L: pd.DataFrame,
    intermediate_years: Sequence[int] = (2009, 2015, 2021),
) -> float:
    """Calculate turnout offset between unweighted municipal mean and LN-weighted national turnout.

    Offset = average across intermediate years of:
      (media municipal no ponderada - nacional ponderado por LN)
    Returns offset in percentage points.
    """
    if Y.empty or L.empty:
        return 0.0

    diffs: list[float] = []
    for yr in intermediate_years:
        if yr not in Y.columns or yr not in L.columns:
            continue
        y_s = Y[yr].dropna()
        l_s = L[yr].dropna()
        common = y_s.index.intersection(l_s.index)
        if len(common) == 0:
            continue
        y_vals = y_s.loc[common].values.astype(float)
        l_vals = l_s.loc[common].values.astype(float)
        if np.nanmax(y_vals) <= 1.05:
            y_vals = y_vals * 100.0
        valid = (l_vals > 0) & (~np.isnan(y_vals))
        if not valid.any():
            continue
        unweighted_mean = float(np.mean(y_vals[valid]))
        weighted_mean = float(np.sum(y_vals[valid] * l_vals[valid]) / np.sum(l_vals[valid]))
        diffs.append(unweighted_mean - weighted_mean)

    return float(np.mean(diffs)) if diffs else 0.0


def unit_trend(
    series: pd.Series,
    min_year: int | None = 2009,
) -> tuple[float, float]:
    """Calculate linear trend and volatility for a municipality or state.

    OLS of participacion or deviation (in pp) ~ 1 + k + pres, with k = (year - min_year)/3.
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
    # If values are in proportion (0..1), convert to percentage points.
    # Note: relative deviations can be negative, so only convert if all values >= 0 and max <= 1.05
    if np.nanmin(vals) >= 0.0 and np.nanmax(vals) <= 1.05:
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
    gov_set: set[tuple[int, str]] | None = None,
    seed_dir: Path | str | None = None,
) -> pd.DataFrame:
    """Construct training panel rows for given target election years.

    For each target year T in targets with T-3 and T-6 in Y.columns:
    Creates a row per municipality with:
      y = Y[T]
      lag1 = Y[T-3]
      lag2 = Y[T-6]
      pres = is_presidential(T)
      gov_T = is_gubernatorial(T, cve_ent)
      gov_lag1 = is_gubernatorial(T-3, cve_ent)
      gov_lag2 = is_gubernatorial(T-6, cve_ent)
      CCPC features from year T-3 (if ccpc_feats provided)
      coverage_ln computed from L[T-3] / pob_18ymas (if L provided)
      and all feature columns from feats.
    Discards rows with y, lag1, or lag2 NaN.
    """
    if Y.empty or len(targets) == 0:
        return pd.DataFrame()

    if gov_set is None:
        gov_set = get_gov_concurrence_set(seed_dir)

    feats_df = feats.copy()
    if "cvegeo" in feats_df.columns:
        feats_df["cvegeo"] = feats_df["cvegeo"].astype(str).str.strip().map(lambda v: zpad(v, 5))
        feats_df = feats_df.set_index("cvegeo")
    feats_df.index = feats_df.index.astype(str).str.strip().map(lambda v: zpad(v, 5))
    feats_df.index.name = "cvegeo"
    if "cvegeo" in feats_df.columns:
        feats_df = feats_df.drop(columns=["cvegeo"])

    if "log_pob_18ymas" not in feats_df.columns and "pob_18ymas" in feats_df.columns:
        pob = pd.to_numeric(feats_df["pob_18ymas"], errors="coerce").fillna(0).clip(lower=0)
        feats_df["log_pob_18ymas"] = np.log1p(pob)

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

        # Concurrencia gubernatura
        ents = [str(c)[:2] for c in valid_idx]
        df_t["gov_T"] = [float(is_gubernatorial(T, e, gov_set=gov_set)) for e in ents]
        df_t["gov_lag1"] = [float(is_gubernatorial(lag1_yr, e, gov_set=gov_set)) for e in ents]
        df_t["gov_lag2"] = [float(is_gubernatorial(lag2_yr, e, gov_set=gov_set)) for e in ents]

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
    intermediate_years: Sequence[int] = (2009, 2015, 2021),
) -> pd.Series:
    """Average turnout or deviation in percentage points for intermediate DIP_FED years.

    Calculates mean across intermediate election years in Y for each municipality
    with at least 1 available year. Converts to percentage points if values are proportions (<= 1.05).
    """
    if Y.empty:
        return pd.Series(dtype=float)

    inter_years = [y for y in intermediate_years if y in Y.columns]
    if not inter_years:
        inter_years = [y for y in Y.columns if not is_presidential(int(y))]
    if not inter_years:
        inter_years = list(Y.columns)

    sub = Y[inter_years].apply(pd.to_numeric, errors="coerce")
    vals_min = np.nanmin(sub.values) if len(sub) > 0 else 0.0
    vals_max = np.nanmax(sub.values) if len(sub) > 0 else 1.0
    mult = 100.0 if (vals_min >= 0.0 and vals_max <= 1.05) else 1.0

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
