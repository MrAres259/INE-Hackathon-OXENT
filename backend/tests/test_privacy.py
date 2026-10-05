"""Tests for atalaya.privacy statistical disclosure control and privacy rules."""

import numpy as np
import pandas as pd
import pytest

from atalaya.privacy import MIN_CELL, suppress_small_cells, drop_nonbinary_below_state


def test_suppress_small_cells_boundaries():
    """Verify suppression boundary: 9 is suppressed, 10 is preserved."""
    df = pd.DataFrame({
        "cvegeo": ["01001", "01002", "01003", "01004", "01005", "01006"],
        "ln": [0, 5, 9, 10, 11, 100],
        "sv": [0, 3, 5, 6, 7, 60],
        "nv": [0, 2, 4, 4, 4, 40],
        "ns": [0, 0, 0, 0, 0, 0],
        "participacion": [np.nan, 0.60, 0.5556, 0.60, 0.6364, 0.60],
    })

    res = suppress_small_cells(df, threshold=MIN_CELL)

    # First 3 rows (ln = 0, 5, 9) must be suppressed
    assert res.loc[0, "suprimido"] == True
    assert res.loc[1, "suprimido"] == True
    assert res.loc[2, "suprimido"] == True
    assert pd.isna(res.loc[2, "ln"])
    assert pd.isna(res.loc[2, "sv"])
    assert pd.isna(res.loc[2, "nv"])
    assert pd.isna(res.loc[2, "participacion"])

    # Last 3 rows (ln = 10, 11, 100) must NOT be suppressed
    assert res.loc[3, "suprimido"] == False
    assert res.loc[4, "suprimido"] == False
    assert res.loc[5, "suprimido"] == False
    assert res.loc[3, "ln"] == 10.0
    assert res.loc[3, "sv"] == 6.0
    assert res.loc[3, "participacion"] == pytest.approx(0.60)


def test_drop_nonbinary_below_state():
    """Verify nonbinary 'X' records are dropped for municipal level but kept for state."""
    # Case with level_col
    df_level = pd.DataFrame({
        "id": ["01001", "01001", "01001", "01", "01", "01"],
        "level": ["mun", "mun", "mun", "state", "state", "state"],
        "sexo": ["H", "M", "X", "H", "M", "X"],
        "ln": [1000, 1000, 5, 50000, 50000, 15],
    })
    res_level = drop_nonbinary_below_state(df_level, level_col="level", sexo_col="sexo")
    # Municipal X must be dropped
    assert len(res_level[res_level["level"] == "mun"]) == 2
    assert "X" not in res_level[res_level["level"] == "mun"]["sexo"].values
    # State X must be preserved
    assert len(res_level[res_level["level"] == "state"]) == 3
    assert "X" in res_level[res_level["level"] == "state"]["sexo"].values

    # Case with cvegeo (5-digit = municipal, 2-digit = state)
    df_geo = pd.DataFrame({
        "cvegeo": ["01001", "01001", "01", "01"],
        "sexo": ["M", "X", "M", "X"],
        "ln": [100, 2, 2000, 50],
    })
    res_geo = drop_nonbinary_below_state(df_geo)
    assert len(res_geo) == 3
    assert not ((res_geo["cvegeo"] == "01001") & (res_geo["sexo"] == "X")).any()
    assert ((res_geo["cvegeo"] == "01") & (res_geo["sexo"] == "X")).any()
