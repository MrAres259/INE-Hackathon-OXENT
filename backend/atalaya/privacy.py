"""Privacy and statistical disclosure control utilities for ATALAYA."""

from __future__ import annotations

import numpy as np
import pandas as pd

MIN_CELL: int = 10


def suppress_small_cells(
    df: pd.DataFrame,
    *,
    count_cols: tuple[str, ...] = ("ln", "sv", "nv", "ns"),
    rate_cols: tuple[str, ...] = ("participacion",),
    base_col: str = "ln",
    threshold: int = MIN_CELL,
) -> pd.DataFrame:
    """Suppress counts and rates for small cells below threshold to prevent re-identification.

    Parameters
    ----------
    df : pd.DataFrame
        Input DataFrame.
    count_cols : tuple[str, ...]
        Count columns to set to NaN if base < threshold.
    rate_cols : tuple[str, ...]
        Rate/proportion columns to set to NaN if base < threshold.
    base_col : str
        Base population/nominal list column name used for thresholding.
    threshold : int
        Minimum cell size (default 10). Cells with base < threshold are suppressed.

    Returns
    -------
    pd.DataFrame
        Copy of DataFrame with suppressed values replaced by NaN and boolean 'suprimido' column.
    """
    out = df.copy()
    if base_col not in out.columns or len(out) == 0:
        out["suprimido"] = False
        return out

    base_vals = pd.to_numeric(out[base_col], errors="coerce")
    suppress_mask = base_vals.isna() | (base_vals < threshold)

    for col in count_cols:
        if col in out.columns:
            out[col] = out[col].astype(float)
            out.loc[suppress_mask, col] = np.nan

    for col in rate_cols:
        if col in out.columns:
            out[col] = out[col].astype(float)
            out.loc[suppress_mask, col] = np.nan

    out["suprimido"] = suppress_mask.astype(bool)
    return out


def drop_nonbinary_below_state(
    df: pd.DataFrame,
    *,
    level_col: str = "level",
    sexo_col: str = "sexo",
) -> pd.DataFrame:
    """Drop nonbinary gender records ('X') below state level to preserve confidentiality.

    Parameters
    ----------
    df : pd.DataFrame
        Input DataFrame containing demographic profile data.
    level_col : str
        Column designating the aggregation level ('mun' or 'state').
    sexo_col : str
        Column containing gender code ('H', 'M', 'X').

    Returns
    -------
    pd.DataFrame
        Filtered DataFrame without municipal nonbinary records.
    """
    if df.empty or sexo_col not in df.columns:
        return df.copy()

    out = df.copy()
    is_x = out[sexo_col].astype(str).str.strip().str.upper() == "X"

    if level_col in out.columns:
        is_mun = out[level_col].astype(str).str.strip().str.lower() == "mun"
        drop_mask = is_mun & is_x
        return out.loc[~drop_mask].copy()

    if "cvegeo" in out.columns:
        is_mun = out["cvegeo"].astype(str).str.strip().str.len() == 5
        drop_mask = is_mun & is_x
        return out.loc[~drop_mask].copy()

    if "ine_mun" in out.columns:
        is_mun = out["ine_mun"].notna()
        drop_mask = is_mun & is_x
        return out.loc[~drop_mask].copy()

    return out
