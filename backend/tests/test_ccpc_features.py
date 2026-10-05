"""Tests for CCPC features module (atalaya.ingest.ccpc_features)."""

from __future__ import annotations

from pathlib import Path
import numpy as np
import pandas as pd
import pytest

from atalaya.ingest.ccpc_features import (
    CCPC_FEATURES_COLUMNS,
    compute_ccpc_features,
    create_empty_ccpc_features_df,
    ingest_ccpc_features,
)
from atalaya.ingest.common import read_parquet, write_parquet


def test_empty_inputs_handling(tmp_path: Path):
    """Test behavior when input parquet files do not exist or are empty."""
    empty_build = tmp_path / "empty_build"
    empty_build.mkdir()

    # Neither file exists
    df_empty = ingest_ccpc_features(build_dir=empty_build)
    assert df_empty.empty
    assert list(df_empty.columns) == CCPC_FEATURES_COLUMNS
    assert (empty_build / "ccpc_features.parquet").is_file()

    # Empty files written to disk
    write_parquet(pd.DataFrame(), empty_build / "ccpc_profile_mun.parquet")
    write_parquet(pd.DataFrame(), empty_build / "ccpc_seccion_mun.parquet")
    df_empty2 = ingest_ccpc_features(build_dir=empty_build)
    assert df_empty2.empty
    assert list(df_empty2.columns) == CCPC_FEATURES_COLUMNS


def test_hand_calculated_indicators():
    """Verify exact values of all 8 indicators against manual calculation (§10.3)."""
    # Create profile input with known counts for municipality 01001, year 2024, DIP_FED
    # Rows:
    # 1. 18-24, H: ln=100, sv=40, nv=50, ns=10  (sv+nv=90)
    # 2. 18-24, M: ln=100, sv=50, nv=45, ns=5   (sv+nv=95)
    # 3. 25-34, H: ln=100, sv=60, nv=35, ns=5   (sv+nv=95)
    # 4. 25-34, M: ln=100, sv=70, nv=25, ns=5   (sv+nv=95)
    # 5. 35-44, H: ln=100, sv=70, nv=30, ns=0   (sv+nv=100)
    # 6. 35-44, M: ln=100, sv=80, nv=20, ns=0   (sv+nv=100)
    # 7. 65+,   X: ln=10,  sv=5,  nv=5,  ns=0   (sv+nv=10)
    #
    # Totals:
    # ln_tot = 100*6 + 10 = 610
    # sv_tot = 40+50+60+70+70+80+5 = 375
    # nv_tot = 50+45+35+25+30+20+5 = 210
    # ns_tot = 10+5+5+5+0+0+0 = 25
    # sv_tot + nv_tot = 585
    # part_total = 375 / 585 = 0.64102564...
    # ns_rate = 25 / 610 = 0.0409836...
    #
    # Youth (18-24 & 25-34):
    # ln_youth = 400 -> pct_ln_18_34 = 400 / 610 = 0.6557377...
    # sv_youth = 40 + 50 + 60 + 70 = 220
    # nv_youth = 50 + 45 + 35 + 25 = 155
    # part_18_34 = 220 / 375 = 0.5866666...
    # gap_youth_pp = (part_18_34 - part_total) * 100 = (220/375 - 375/585) * 100 = -5.435897... pp
    #
    # Sex gap:
    # H: sv_h = 40 + 60 + 70 = 170, nv_h = 50 + 35 + 30 = 115
    #    part_h = 170 / (170 + 115) = 170 / 285 = 0.5964912...
    # M: sv_m = 50 + 70 + 80 = 200, nv_m = 45 + 25 + 20 = 90
    #    part_m = 200 / (200 + 90) = 200 / 290 = 0.6896551...
    # gap_sexo_pp = (part_m - part_h) * 100 = (200/290 - 170/285) * 100 = +9.316395... pp
    prof_df = pd.DataFrame([
        {"cvegeo": "01001", "cve_ent": "01", "year": 2024, "election": "DIP_FED", "age_group": "18-24", "sexo": "H", "ln": 100, "sv": 40, "nv": 50, "ns": 10},
        {"cvegeo": "01001", "cve_ent": "01", "year": 2024, "election": "DIP_FED", "age_group": "18-24", "sexo": "M", "ln": 100, "sv": 50, "nv": 45, "ns": 5},
        {"cvegeo": "01001", "cve_ent": "01", "year": 2024, "election": "DIP_FED", "age_group": "25-34", "sexo": "H", "ln": 100, "sv": 60, "nv": 35, "ns": 5},
        {"cvegeo": "01001", "cve_ent": "01", "year": 2024, "election": "DIP_FED", "age_group": "25-34", "sexo": "M", "ln": 100, "sv": 70, "nv": 25, "ns": 5},
        {"cvegeo": "01001", "cve_ent": "01", "year": 2024, "election": "DIP_FED", "age_group": "35-44", "sexo": "H", "ln": 100, "sv": 70, "nv": 30, "ns": 0},
        {"cvegeo": "01001", "cve_ent": "01", "year": 2024, "election": "DIP_FED", "age_group": "35-44", "sexo": "M", "ln": 100, "sv": 80, "nv": 20, "ns": 0},
        {"cvegeo": "01001", "cve_ent": "01", "year": 2024, "election": "DIP_FED", "age_group": "65+",   "sexo": "X", "ln": 10,  "sv": 5,  "nv": 5,  "ns": 0},
    ])

    # Sections:
    # 1. Section 1 (U): ln=300
    # 2. Section 2 (R): ln=200
    # 3. Section 3 (M): ln=110
    # Total section ln = 610
    # pct_ln_rural = 200 / 610 = 0.3278688...
    # pct_ln_urbana = 300 / 610 = 0.4918032...
    sec_df = pd.DataFrame([
        {"cvegeo": "01001", "cve_ent": "01", "year": 2024, "election": "DIP_FED", "seccion": 1, "tiposec": "U", "def": 1, "ln": 300, "sv": 180, "nv": 120, "ns": 0},
        {"cvegeo": "01001", "cve_ent": "01", "year": 2024, "election": "DIP_FED", "seccion": 2, "tiposec": "R", "def": 1, "ln": 200, "sv": 120, "nv": 80, "ns": 0},
        {"cvegeo": "01001", "cve_ent": "01", "year": 2024, "election": "DIP_FED", "seccion": 3, "tiposec": "M", "def": 1, "ln": 110, "sv": 75, "nv": 35, "ns": 0},
    ])

    res = compute_ccpc_features(prof_df, sec_df)
    assert len(res) == 2  # 1 mun row + 1 state row
    assert set(res["level"].unique()) == {"mun", "state"}

    # Check municipal row
    row_mun = res[res["level"] == "mun"].iloc[0]
    assert row_mun["cvegeo"] == "01001"
    assert row_mun["cve_ent"] == "01"
    assert row_mun["year"] == 2024
    assert row_mun["election"] == "DIP_FED"

    assert pytest.approx(row_mun["part_total"], rel=1e-5) == (375.0 / 585.0)
    assert pytest.approx(row_mun["ns_rate"], rel=1e-5) == (25.0 / 610.0)
    assert pytest.approx(row_mun["pct_ln_18_34"], rel=1e-5) == (400.0 / 610.0)
    assert pytest.approx(row_mun["part_18_34"], rel=1e-5) == (220.0 / 375.0)
    assert pytest.approx(row_mun["gap_youth_pp"], rel=1e-5) == (220.0 / 375.0 - 375.0 / 585.0) * 100.0
    assert pytest.approx(row_mun["gap_sexo_pp"], rel=1e-5) == (200.0 / 290.0 - 170.0 / 285.0) * 100.0
    assert pytest.approx(row_mun["pct_ln_rural"], rel=1e-5) == (200.0 / 610.0)
    assert pytest.approx(row_mun["pct_ln_urbana"], rel=1e-5) == (300.0 / 610.0)

    # Check state row (identical values because single municipality in state)
    row_state = res[res["level"] == "state"].iloc[0]
    assert row_state["cvegeo"] == "01"
    assert row_state["cve_ent"] == "01"
    assert row_state["year"] == 2024
    assert row_state["election"] == "DIP_FED"
    assert pytest.approx(row_state["part_total"], rel=1e-5) == (375.0 / 585.0)
    assert pytest.approx(row_state["pct_ln_rural"], rel=1e-5) == (200.0 / 610.0)


def test_division_by_zero_and_edge_cases():
    """Verify safe handling of zero denominators, missing sexes, and PJF election support."""
    # Mun 02001: All zeros (LN=0, SV=0, NV=0, NS=0)
    # Mun 02002: Only men (no women), no rural sections (only urban)
    # Mun 02003: Election == 'PJF' (must be included with election='PJF')
    prof_df = pd.DataFrame([
        # Mun 02001: All zero
        {"cvegeo": "02001", "cve_ent": "02", "year": 2024, "election": "DIP_FED", "age_group": "18-24", "sexo": "H", "ln": 0, "sv": 0, "nv": 0, "ns": 0},
        # Mun 02002: Only men, no women
        {"cvegeo": "02002", "cve_ent": "02", "year": 2024, "election": "DIP_FED", "age_group": "35-44", "sexo": "H", "ln": 100, "sv": 60, "nv": 40, "ns": 0},
        # Mun 02003: PJF election in 2025
        {"cvegeo": "02003", "cve_ent": "02", "year": 2025, "election": "PJF", "age_group": "35-44", "sexo": "M", "ln": 100, "sv": 20, "nv": 80, "ns": 0},
    ])

    sec_df = pd.DataFrame([
        # Mun 02001: All zero
        {"cvegeo": "02001", "cve_ent": "02", "year": 2024, "election": "DIP_FED", "seccion": 1, "tiposec": "U", "ln": 0},
        # Mun 02002: Only urban sections
        {"cvegeo": "02002", "cve_ent": "02", "year": 2024, "election": "DIP_FED", "seccion": 1, "tiposec": "U", "ln": 100},
        # Mun 02003: PJF
        {"cvegeo": "02003", "cve_ent": "02", "year": 2025, "election": "PJF", "seccion": 1, "tiposec": "U", "ln": 100},
    ])

    res = compute_ccpc_features(prof_df, sec_df)

    # 1. Mun 02003 (PJF) MUST be present in output
    assert "02003" in res["cvegeo"].values
    row_03 = res[(res["cvegeo"] == "02003") & (res["level"] == "mun")].iloc[0]
    assert row_03["election"] == "PJF"
    assert row_03["year"] == 2025
    assert pytest.approx(row_03["part_total"], rel=1e-5) == 0.20

    # 2. Mun 02001: All zero denominators -> all rates/gaps must be NaN
    row_01 = res[(res["cvegeo"] == "02001") & (res["level"] == "mun")].iloc[0]
    assert pd.isna(row_01["part_total"])
    assert pd.isna(row_01["pct_ln_18_34"])
    assert pd.isna(row_01["part_18_34"])
    assert pd.isna(row_01["gap_youth_pp"])
    assert pd.isna(row_01["gap_sexo_pp"])
    assert pd.isna(row_01["pct_ln_rural"])
    assert pd.isna(row_01["pct_ln_urbana"])
    assert pd.isna(row_01["ns_rate"])

    # 3. Mun 02002:
    row_02 = res[(res["cvegeo"] == "02002") & (res["level"] == "mun")].iloc[0]
    assert pd.isna(row_02["gap_sexo_pp"])
    assert row_02["pct_ln_18_34"] == 0.0
    assert pd.isna(row_02["part_18_34"])
    assert pd.isna(row_02["gap_youth_pp"])
    assert row_02["pct_ln_rural"] == 0.0
    assert row_02["pct_ln_urbana"] == 1.0

    # 4. State rows present for both DIP_FED (2024) and PJF (2025)
    st_rows = res[res["level"] == "state"]
    assert len(st_rows) == 2
    assert set(st_rows["election"].unique()) == {"DIP_FED", "PJF"}


def test_state_indicators_calculated_from_sums():
    """Verify state indicators are calculated from sums and NOT by unweighted average of municipalities (§10.3)."""
    # State 03 with 2 municipalities of very different sizes:
    # Mun 03001 (small, high participation):
    #   LN=100, SV=80, NV=20 -> part_total = 80/100 = 0.80
    #   Youth: LN=50, SV=40, NV=10 -> part_18_34 = 40/50 = 0.80
    #   Sections: Rural LN=20, Urban LN=80 -> pct_rural = 0.20, pct_urban = 0.80
    # Mun 03002 (large, low participation):
    #   LN=900, SV=180, NV=720 -> part_total = 180/900 = 0.20
    #   Youth: LN=450, SV=90, NV=360 -> part_18_34 = 90/450 = 0.20
    #   Sections: Rural LN=900, Urban LN=0 -> pct_rural = 1.00, pct_urban = 0.00
    #
    # Unweighted municipal averages:
    #   avg part_total = (0.80 + 0.20) / 2 = 0.50
    #   avg part_18_34 = (0.80 + 0.20) / 2 = 0.50
    #   avg pct_ln_rural = (0.20 + 1.00) / 2 = 0.60
    #
    # True state aggregation from sums:
    #   total LN = 1000, SV = 260, NV = 740 -> part_total = 260/1000 = 0.26
    #   youth LN = 500, youth SV = 130, youth NV = 370 -> part_18_34 = 130/500 = 0.26
    #   rural LN = 20 + 900 = 920 -> pct_ln_rural = 920/1000 = 0.92
    #   urban LN = 80 + 0 = 80 -> pct_ln_urbana = 80/1000 = 0.08
    prof_df = pd.DataFrame([
        # Mun 03001
        {"cvegeo": "03001", "cve_ent": "03", "year": 2024, "election": "DIP_FED", "age_group": "18-24", "sexo": "H", "ln": 50, "sv": 40, "nv": 10, "ns": 0},
        {"cvegeo": "03001", "cve_ent": "03", "year": 2024, "election": "DIP_FED", "age_group": "35-44", "sexo": "H", "ln": 50, "sv": 40, "nv": 10, "ns": 0},
        # Mun 03002
        {"cvegeo": "03002", "cve_ent": "03", "year": 2024, "election": "DIP_FED", "age_group": "18-24", "sexo": "H", "ln": 450, "sv": 90, "nv": 360, "ns": 0},
        {"cvegeo": "03002", "cve_ent": "03", "year": 2024, "election": "DIP_FED", "age_group": "35-44", "sexo": "H", "ln": 450, "sv": 90, "nv": 360, "ns": 0},
    ])

    sec_df = pd.DataFrame([
        # Mun 03001
        {"cvegeo": "03001", "cve_ent": "03", "year": 2024, "election": "DIP_FED", "seccion": 1, "tiposec": "R", "ln": 20},
        {"cvegeo": "03001", "cve_ent": "03", "year": 2024, "election": "DIP_FED", "seccion": 2, "tiposec": "U", "ln": 80},
        # Mun 03002
        {"cvegeo": "03002", "cve_ent": "03", "year": 2024, "election": "DIP_FED", "seccion": 3, "tiposec": "R", "ln": 900},
    ])

    res = compute_ccpc_features(prof_df, sec_df)

    st_row = res[(res["cvegeo"] == "03") & (res["level"] == "state")].iloc[0]
    mun_rows = res[res["level"] == "mun"]

    # Verify municipal values
    assert pytest.approx(mun_rows[mun_rows["cvegeo"] == "03001"]["part_total"].iloc[0]) == 0.80
    assert pytest.approx(mun_rows[mun_rows["cvegeo"] == "03002"]["part_total"].iloc[0]) == 0.20

    # Verify state matches sum (0.26) and strictly differs from unweighted average (0.50)
    assert pytest.approx(st_row["part_total"], rel=1e-5) == 0.26
    assert abs(st_row["part_total"] - 0.50) > 0.15

    # Verify youth participation matches sum (0.26) and strictly differs from unweighted average (0.50)
    assert pytest.approx(st_row["part_18_34"], rel=1e-5) == 0.26
    assert abs(st_row["part_18_34"] - 0.50) > 0.15

    # Verify rural percentage matches sum (0.92) and strictly differs from unweighted average (0.60)
    assert pytest.approx(st_row["pct_ln_rural"], rel=1e-5) == 0.92
    assert abs(st_row["pct_ln_rural"] - 0.60) > 0.20

    # Verify urban percentage matches sum (0.08) and strictly differs from unweighted average (0.40)
    assert pytest.approx(st_row["pct_ln_urbana"], rel=1e-5) == 0.08
    assert abs(st_row["pct_ln_urbana"] - 0.40) > 0.20
