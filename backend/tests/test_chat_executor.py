"""Tests for deterministic chat query executor."""

from __future__ import annotations

from pathlib import Path
import numpy as np
import pandas as pd
import pytest

from atalaya.chat.executor import execute, format_value, get_variable_meta
from atalaya.chat.spec import DataResult, QuerySpec
from atalaya.store import PandasStore


@pytest.fixture
def mock_store(tmp_path: Path, monkeypatch) -> PandasStore:
    """Create a fully populated synthetic PandasStore."""
    build_dir = tmp_path / "build"
    seed_dir = tmp_path / "seed"
    build_dir.mkdir(parents=True, exist_ok=True)
    seed_dir.mkdir(parents=True, exist_ok=True)

    # 1. Seed files
    states_csv = seed_dir / "states.csv"
    states_csv.write_text(
        "cve_ent,name,iso,aliases\n"
        "07,Chiapas,MX-CHP,CHIS\n"
        "09,Ciudad de México,MX-CMX,CDMX|DF\n"
        "14,Jalisco,MX-JAL,JAL\n"
        "15,México,MX-MEX,EDOMEX\n"
        "20,Oaxaca,MX-OAX,OAX\n",
        encoding="utf-8",
    )

    variables_csv = seed_dir / "variables.csv"
    variables_csv.write_text(
        "key,label_es,description,source,unit,level\n"
        "participacion,Participación ciudadana,Votos entre lista nominal,INE,proporción,mun|state\n"
        "abstencion,Abstención,1 menos participación,INE,proporción,mun|state\n"
        "risk_score,Índice de riesgo,Índice 0 a 100,ATALAYA,índice,mun|state\n"
        "pred_abstention,Abstención pronosticada 2027,Estimación 2027,ATALAYA,proporción,mun|state\n"
        "graproes,Escolaridad promedio,Grado escolaridad,INEGI,años,mun|state\n"
        "im_2020,Índice de marginación,Marginación 2020,CONAPO,índice,mun\n"
        "pct_18_24,Jóvenes de 18 a 24 años,Proporción de 18 a 24 años,INEGI,proporción,mun|state\n"
        "lista_nominal,Lista nominal,Inscritos en lista,INE,personas,mun|state\n",
        encoding="utf-8",
    )

    # 2. Units parquet
    mun_rows = []
    # 10 municipalities for Chiapas (07), using 07101..07110
    for idx, i in enumerate(range(101, 111), 1):
        uid = f"07{i:03d}"
        mun_rows.append({
            "id": uid,
            "level": "mun",
            "cve_ent": "07",
            "cve_mun": f"{i:03d}",
            "cvegeo": uid,
            "name": f"Municipio Chis {idx}",
            "pob_tot": 50000 + idx * 1000,
            "pob_18ymas": 35000 + idx * 500,
            "lista_nominal": 34000 + idx * 500,
            "last_year": 2024,
            "last_participation": 0.50 + (idx * 0.01),
            "pred_participation": 0.48 + (idx * 0.01),
            "pred_abstention": 0.52 - (idx * 0.01),
            "risk_score": 85.0 - (idx * 3.0),
            "category": "rojo" if idx <= 3 else ("naranja" if idx <= 6 else "amarillo"),
            "trend_pp": -1.0 - (idx * 0.1),
            "volatility_pp": 2.5,
            "graproes": 6.0 + (idx * 0.5),
            "im_2020": 1.5 - (idx * 0.2),
            "pct_18_24": 0.15 + (idx * 0.01),
            "part_dip_2021": 0.45 + (idx * 0.01),
            "abst_dip_2021": 0.55 - (idx * 0.01),
        })

    # One municipality with NaN risk score to test omitted handling
    mun_rows.append({
        "id": "07999",
        "level": "mun",
        "cve_ent": "07",
        "cve_mun": "999",
        "cvegeo": "07999",
        "name": "Municipio Sin Dato",
        "pob_tot": 10000,
        "pob_18ymas": 7000,
        "lista_nominal": 6500,
        "last_year": 2024,
        "last_participation": np.nan,
        "pred_participation": np.nan,
        "pred_abstention": np.nan,
        "risk_score": np.nan,
        "category": "sin_dato",
        "trend_pp": np.nan,
        "volatility_pp": np.nan,
        "graproes": np.nan,
        "im_2020": np.nan,
        "part_dip_2021": np.nan,
        "abst_dip_2021": np.nan,
    })

    # Other states municipalities
    for ent, name in [("09", "CDMX"), ("14", "Jalisco"), ("15", "Edomex"), ("20", "Oaxaca")]:
        mun_rows.append({
            "id": f"{ent}001",
            "level": "mun",
            "cve_ent": ent,
            "cve_mun": "001",
            "cvegeo": f"{ent}001",
            "name": f"Capital {name}",
            "pob_tot": 500000,
            "pob_18ymas": 350000,
            "lista_nominal": 340000,
            "last_year": 2024,
            "last_participation": 0.55,
            "pred_participation": 0.53,
            "pred_abstention": 0.47,
            "risk_score": 45.0,
            "category": "amarillo",
            "trend_pp": 0.5,
            "volatility_pp": 1.8,
            "graproes": 11.5,
            "im_2020": -1.2,
            "part_dip_2021": 0.54,
            "abst_dip_2021": 0.46,
        })

    # State level units
    state_rows = [
        {"id": "07", "level": "state", "cve_ent": "07", "cve_mun": "", "cvegeo": "07", "name": "Chiapas", "lista_nominal": 3500000, "pred_abstention": 0.50, "risk_score": 75.0, "category": "rojo", "part_dip_2021": 0.50, "abst_dip_2021": 0.50},
        {"id": "09", "level": "state", "cve_ent": "09", "cve_mun": "", "cvegeo": "09", "name": "Ciudad de México", "lista_nominal": 7500000, "pred_abstention": 0.48, "risk_score": 38.0, "category": "amarillo", "part_dip_2021": 0.52, "abst_dip_2021": 0.48},
        {"id": "14", "level": "state", "cve_ent": "14", "cve_mun": "", "cvegeo": "14", "name": "Jalisco", "lista_nominal": 6000000, "pred_abstention": 0.45, "risk_score": 42.0, "category": "amarillo", "part_dip_2021": 0.54, "abst_dip_2021": 0.46},
        {"id": "15", "level": "state", "cve_ent": "15", "cve_mun": "", "cvegeo": "15", "name": "México", "lista_nominal": 12000000, "pred_abstention": 0.51, "risk_score": 52.0, "category": "amarillo", "part_dip_2021": 0.49, "abst_dip_2021": 0.51},
        {"id": "20", "level": "state", "cve_ent": "20", "cve_mun": "", "cvegeo": "20", "name": "Oaxaca", "lista_nominal": 3000000, "pred_abstention": 0.47, "risk_score": 68.0, "category": "naranja", "part_dip_2021": 0.53, "abst_dip_2021": 0.47},
    ]

    units_df = pd.DataFrame(mun_rows + state_rows)
    units_df.to_parquet(build_dir / "units.parquet", index=False)

    # 3. Participation parquet (both state and mun)
    part_rows = []
    years = [2009, 2012, 2015, 2018, 2021, 2024]
    # State rows
    for ent in ["07", "09", "14", "15", "20"]:
        for yr in years:
            p_val = 0.45 + ((yr - 2009) * 0.01)
            part_rows.append({
                "unit_id": ent,
                "level": "state",
                "cvegeo": ent,
                "cve_ent": ent,
                "year": yr,
                "election": "DIP_FED",
                "lista_nominal": 3000000,
                "votos_totales": int(3000000 * p_val),
                "participacion": p_val,
                "abstencion": 1.0 - p_val,
            })
    # Mun rows for Chiapas (07101..07110)
    for idx, i in enumerate(range(101, 111), 1):
        uid = f"07{i:03d}"
        for yr in years:
            p_val = 0.40 + (idx * 0.02) + ((yr - 2009) * 0.005)
            part_rows.append({
                "unit_id": uid,
                "level": "mun",
                "cvegeo": uid,
                "cve_ent": "07",
                "year": yr,
                "election": "DIP_FED",
                "lista_nominal": 30000,
                "votos_totales": int(30000 * p_val),
                "participacion": p_val,
                "abstencion": 1.0 - p_val,
            })

    part_df = pd.DataFrame(part_rows)
    part_df.to_parquet(build_dir / "participation.parquet", index=False)

    # 4. Drivers parquet
    driver_rows = [
        {"id": "07101", "level": "mun", "key": "graproes", "label": "Baja escolaridad", "contribution_pp": 3.5, "direction": "sube_abstencion", "rank": 1},
        {"id": "07101", "level": "mun", "key": "pct_18_24", "label": "Población joven", "contribution_pp": 2.1, "direction": "sube_abstencion", "rank": 2},
        {"id": "07101", "level": "mun", "key": "pct_internet", "label": "Acceso a internet", "contribution_pp": -1.4, "direction": "baja_abstencion", "rank": 3},
    ]
    pd.DataFrame(driver_rows).to_parquet(build_dir / "drivers.parquet", index=False)

    store = PandasStore(build_dir=build_dir, seed_dir=seed_dir)
    monkeypatch.setattr("atalaya.chat.executor.get_store", lambda: store)
    return store


def test_format_value_helpers():
    """Verify numeric formatting conforms to specification."""
    # Proportions formatted as % with 1 decimal
    assert format_value("participacion", 0.5428) == "54.3%"
    assert format_value("abstencion", 0.4572) == "45.7%"
    assert format_value("pct_18_24", 0.1834) == "18.3%"

    # Points with sign
    assert format_value("trend_pp", -1.5) == "-1.5 pp"
    assert format_value("trend_pp", 2.3) == "+2.3 pp"

    # Counts with comma separator
    assert format_value("lista_nominal", 1234567) == "1,234,567"

    # Index with 1 decimal
    assert format_value("risk_score", 78.49) == "78.5"


def test_executor_ranking(mock_store):
    """Verify ranking intent produces expected table, format, and omits NaNs."""
    spec = QuerySpec(
        intent="ranking",
        level="mun",
        filters={"cve_ent": "07"},
        metric="risk_score",
        order="desc",
        limit=5,
    )
    result = execute(spec)
    assert not result.empty
    assert len(result.columns) == 4
    assert result.columns[:3] == ["#", "Zona", "Estado"]
    assert "riesgo" in result.columns[3].lower()
    assert len(result.rows) == 5
    assert result.rows[0][0] == 1
    assert result.rows[0][2] == "Chiapas"
    # Unit with NaN (07999) must be omitted
    omitted_present = any("Sin Dato" in str(r[1]) for r in result.rows)
    assert not omitted_present
    assert any("Top 1" in f for f in result.facts)
    assert any("Se omitieron 1 unidades sin dato" in f for f in result.facts)


def test_executor_lookup(mock_store):
    """Verify lookup returns specific unit value and cites source."""
    spec = QuerySpec(
        intent="lookup",
        level="state",
        unit_ids=["14"],
        metric="participacion",
        year=2021,
    )
    result = execute(spec)
    assert not result.empty
    assert len(result.rows) == 1
    val = result.rows[0][3]
    assert val == "54.0%"
    assert "INE" in result.source
    assert any("Jalisco" in f and "54.0%" in f for f in result.facts)


def test_executor_compare(mock_store):
    """Verify compare intent between CDMX and Edomex computes absolute difference."""
    spec = QuerySpec(
        intent="compare",
        level="state",
        unit_ids=["09", "15"],
        metric="abstencion",
    )
    result = execute(spec)
    assert not result.empty
    assert len(result.rows) == 2
    # Verify difference fact present
    diff_fact = [f for f in result.facts if "diferencia" in f.lower()]
    assert len(diff_fact) > 0


def test_executor_trend(mock_store):
    """Verify trend intent returns full historical time series sorted by year."""
    spec = QuerySpec(
        intent="trend",
        level="state",
        unit_ids=["07"],
        metric="participacion",
        election="DIP_FED",
    )
    result = execute(spec)
    assert not result.empty
    assert result.columns == ["Año", "Elección", "Participación", "Abstención", "Lista Nominal"]
    assert len(result.rows) == 6
    years = [r[0] for r in result.rows]
    assert years == sorted(years)
    assert any("Historial de 6 elecciones" in f for f in result.facts)


def test_executor_correlation(mock_store):
    """Verify correlation computes Pearson r, strength, direction and quintiles table."""
    spec = QuerySpec(
        intent="correlation",
        level="mun",
        filters={"cve_ent": "07"},
        metric="participacion",
        x_metric="graproes",
    )
    result = execute(spec)
    # Check Pearson fact and mandatory statement
    assert any("Correlación no implica causalidad." in f for f in result.facts)
    r_facts = [f for f in result.facts if "Pearson" in f]
    assert len(r_facts) > 0
    # Quintiles table
    assert len(result.columns) == 4
    assert result.columns[0] == "Quintil"
    assert len(result.rows) > 0


def test_executor_scenario(mock_store):
    """Verify scenario simulation returns delta pp and category summary."""
    spec = QuerySpec(
        intent="scenario",
        level="mun",
        filters={"cve_ent": "07"},
        scenario="intervencion",
        scenario_params={"lever": "promocion_jovenes", "targeting": "rojo", "effect_pp": 4.0},
    )
    result = execute(spec)
    assert not result.empty
    assert "Abstención Base" in result.columns
    assert "Abstención Simulada" in result.columns

    # Base != Simulada on target units (units that received intervention have negative delta)
    target_rows = [r for r in result.rows if "-" in str(r[4])]
    assert len(target_rows) > 0
    for r in target_rows:
        # Base (r[2]) should not equal Simulada (r[3])
        assert r[2] != r[3]

    # Ordered by delta_vs_base_pp ascending (mayor mejora primero)
    deltas = [float(r[4].replace(" pp", "").replace("+", "")) for r in result.rows]
    assert deltas == sorted(deltas)

    # Facts include summary: by_category vs by_category_base, votos_adicionales, mean_delta_pp
    assert any("Cambio promedio en abstención" in f for f in result.facts)
    assert any("Votos adicionales" in f for f in result.facts)
    assert any("Distribución de riesgo" in f for f in result.facts)


def test_executor_scenario_simulate_failure_returns_empty_without_figures(mock_store, monkeypatch):
    """Verify that when simulate raises an exception, executor returns empty DataResult without fabricated figures."""
    import atalaya.model.scenarios as sc_mod

    def _faulty_simulate(*a, **kw):
        raise RuntimeError("Model engine failure")

    monkeypatch.setattr(sc_mod, "simulate", _faulty_simulate)

    spec = QuerySpec(intent="scenario", scenario="intervencion")
    result = execute(spec)
    assert result.empty
    assert len(result.rows) == 0
    assert any("No fue posible simular el escenario" in f for f in result.facts)
    # Check no fabricated figures in facts
    for f in result.facts:
        digits = [c for c in f if c.isdigit()]
        assert not digits, f"Found unexpected digits {digits} in fact '{f}'"


def test_executor_source_deduplicated_with_year(mock_store):
    """Verify source is deduplicated and includes effective year in lookup, compare, correlation."""
    # 1. Lookup with explicit year: should be 'INE · Conteos Censales de Participación Ciudadana 2021', not duplicated
    spec_lookup = QuerySpec(
        intent="lookup",
        level="state",
        unit_ids=["14"],
        metric="participacion",
        year=2021,
    )
    res_lookup = execute(spec_lookup)
    assert res_lookup.source == "INE · Conteos Censales de Participación Ciudadana 2021"

    # 2. Compare without explicit year: should include year (2024 from stats)
    spec_compare = QuerySpec(
        intent="compare",
        level="state",
        unit_ids=["09", "15"],
        metric="abstencion",
    )
    res_compare = execute(spec_compare)
    assert res_compare.source == "INE · Conteos Censales de Participación Ciudadana 2024"

    # 3. Correlation with INE and INEGI variables: should include year for both
    spec_corr = QuerySpec(
        intent="correlation",
        level="mun",
        filters={"cve_ent": "07"},
        metric="participacion",
        x_metric="graproes",
    )
    res_corr = execute(spec_corr)
    assert res_corr.source == "INE · Conteos Censales de Participación Ciudadana 2024; INEGI · Censo 2020"


def test_executor_census_year_bug_fixed(mock_store):
    """Verify that when querying an INEGI/CONAPO metric with a non-2020 year (e.g. 2009),
    the year is fixed to 2020 in facts and table, and a note is added stating it corresponds to 2020."""
    spec = QuerySpec(
        intent="lookup",
        level="mun",
        unit_ids=["07101"],
        metric="pct_18_24",
        year=2009,
    )
    res = execute(spec)
    assert not res.empty
    assert res.columns == ["Zona", "Nivel", "Estado", "Año", "Jóvenes de 18 a 24 años"]
    assert res.rows[0][3] == 2020
    assert any("El dato censal corresponde a 2020." in f for f in res.facts)
    assert any("2020" in f for f in res.facts)
    assert not any("en 2009" in f for f in res.facts)


def test_executor_profile(mock_store):
    """Verify profile intent returns demographic breakdown by age group and sex from profile data."""
    build_dir = mock_store.build_dir
    prof_data = [
        {"cvegeo": "14001", "cve_ent": "14", "year": 2024, "age_group": "18-24", "sexo": "H", "ln": 1000, "sv": 550, "nv": 450, "ns": 10},
        {"cvegeo": "14001", "cve_ent": "14", "year": 2024, "age_group": "18-24", "sexo": "M", "ln": 1050, "sv": 650, "nv": 400, "ns": 10},
        {"cvegeo": "14001", "cve_ent": "14", "year": 2024, "age_group": "65+", "sexo": "H", "ln": 800, "sv": 600, "nv": 200, "ns": 5},
        {"cvegeo": "14001", "cve_ent": "14", "year": 2024, "age_group": "65+", "sexo": "M", "ln": 850, "sv": 680, "nv": 170, "ns": 5},
    ]
    pd.DataFrame(prof_data).to_parquet(build_dir / "ccpc_profile_mun.parquet", index=False)
    mock_store.reload()

    spec = QuerySpec(intent="profile", level="mun", unit_ids=["14001"], year=2024)
    res = execute(spec)
    assert not res.empty
    assert res.columns == ["Grupo de edad", "Sexo", "Lista Nominal", "Votaron (SV)", "No Votaron (NV)", "Participación"]
    assert len(res.rows) == 4
    assert any("Mayor participación" in f for f in res.facts)
    assert "INE · Conteos Censales de Participación Ciudadana 2024" in res.source


def test_no_digits_produced_when_store_empty(tmp_path: Path, monkeypatch):
    """Verify no intent produces digits in rows or facts when store is completely empty."""
    empty_build = tmp_path / "empty_build"
    empty_seed = tmp_path / "empty_seed"
    empty_build.mkdir(parents=True, exist_ok=True)
    empty_seed.mkdir(parents=True, exist_ok=True)

    # Empty store
    empty_store = PandasStore(build_dir=empty_build, seed_dir=empty_seed)
    monkeypatch.setattr("atalaya.chat.executor.get_store", lambda: empty_store)

    specs = [
        QuerySpec(intent="ranking", metric="risk_score"),
        QuerySpec(intent="lookup", metric="participacion", unit_ids=["14"]),
        QuerySpec(intent="compare", metric="abstencion", unit_ids=["09", "15"]),
        QuerySpec(intent="trend", metric="participacion", unit_ids=["07"]),
        QuerySpec(intent="correlation", metric="participacion", x_metric="im_2020"),
        QuerySpec(intent="scenario", scenario="intervencion"),
        QuerySpec(intent="explain_unit", unit_ids=["07101"]),
    ]

    for spec in specs:
        res = execute(spec)
        assert res.empty
        assert len(res.rows) == 0
        for f in res.facts:
            f_clean = f
            if spec.year:
                f_clean = f_clean.replace(str(spec.year), "")
            f_clean = f_clean.replace(str(spec.limit), "")
            digits = [c for c in f_clean if c.isdigit()]
            assert not digits, f"Found digits {digits} in fact '{f}' for intent '{spec.intent}'"


def test_executor_explain_unit(mock_store):
    """Verify explain_unit provides drivers and actionable recommendations."""
    spec = QuerySpec(
        intent="explain_unit",
        level="mun",
        unit_ids=["07101"],
    )
    result = execute(spec)
    assert not result.empty
    assert result.columns == ["Factor", "Impacto (pp)", "Efecto"]
    assert any("Factores determinantes" in f for f in result.facts)
    assert any("Recomendación" in f for f in result.facts)


def test_executor_help_and_catalog(mock_store):
    """Verify catalog table and help empty result with examples."""
    cat_result = execute(QuerySpec(intent="catalog"))
    assert not cat_result.empty
    assert cat_result.columns == ["Clave", "Variable", "Fuente", "Unidad"]

    help_result = execute(QuerySpec(intent="help"))
    assert help_result.empty
    assert len(help_result.facts) >= 4
