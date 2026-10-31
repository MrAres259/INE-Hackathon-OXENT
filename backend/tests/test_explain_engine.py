"""Tests for the deterministic explanation engine (atalaya.explain.engine)."""
from __future__ import annotations

from pathlib import Path
import re
import time
from typing import Any

import pandas as pd
import pytest

from atalaya.config import BUILD_DIR
from atalaya.explain.engine import (
    AssocStat,
    Reference,
    build_explanation,
    clear_explain_cache,
    explanation_facts,
)
from atalaya.explain.schemas import Explanation
from atalaya.explain.texts import FORBIDDEN_WORDS_PATTERN


class StubStore:
    """In-memory stub store for unit testing the explanation engine."""

    def __init__(
        self,
        units_dict: dict[str, dict[str, Any]] | None = None,
        participation_df: pd.DataFrame | None = None,
        profile_list: list[dict[str, Any]] | None = None,
        drivers_list: list[dict[str, Any]] | None = None,
        metrics_dict: dict[str, Any] | None = None,
    ):
        self._units = units_dict or {}
        self._part_df = participation_df if participation_df is not None else pd.DataFrame()
        self._profile = profile_list or []
        self._drivers = drivers_list or []
        self._metrics = metrics_dict or {"backtests": [{"mae_pp": 5.95}, {"mae_pp": 6.05}]}

    def unit(self, unit_id: str) -> dict[str, Any] | None:
        return self._units.get(str(unit_id))

    def units(self, level: str = "mun", ent: str | None = None) -> pd.DataFrame:
        rows = [u for u in self._units.values() if u.get("level") == level]
        if not rows:
            rows = list(self._units.values())
        return pd.DataFrame(rows)

    def participation(
        self,
        unit_ids: list[str] | None = None,
        *,
        level: str = "mun",
        election: str | None = None,
        years: list[int] | None = None,
    ) -> pd.DataFrame:
        if self._part_df.empty:
            return pd.DataFrame()
        df = self._part_df.copy()
        if unit_ids:
            u_strs = [str(x) for x in unit_ids]
            df = df[df["cvegeo"].astype(str).isin(u_strs) | df["id"].astype(str).isin(u_strs)]
        if election:
            df = df[df["election"] == election]
        return df

    def profile(self, unit_id: str, year: int | None = None) -> list[dict[str, Any]]:
        return self._profile

    def drivers(self, unit_id: str) -> list[dict[str, Any]]:
        return self._drivers

    def metrics(self) -> dict[str, Any]:
        return self._metrics


def _make_mock_reference(
    nat_part: dict[int, float] | None = None,
    st_part: dict[tuple[str, int], float] | None = None,
    assocs: dict[str, dict[str, AssocStat]] | None = None,
    level_vals: dict[str, dict[str, list[float]]] | None = None,
    context: dict[str, dict[str, float]] | None = None,
) -> Reference:
    return Reference(
        national_participation=nat_part or {
            2009: 0.4406,
            2012: 0.6208,
            2015: 0.4707,
            2018: 0.6237,
            2021: 0.5184,
            2024: 0.5967,
        },
        state_participation=st_part or {},
        mean_mun_participation={},
        associations=assocs or {"mun": {}, "state": {}},
        level_values=level_vals or {"mun": {}, "state": {}},
        context=context or {},
    )


@pytest.fixture(autouse=True)
def clean_cache():
    clear_explain_cache()
    yield
    clear_explain_cache()


def test_score_breakdown_and_semaforo():
    """1. score_breakdown suma risk_score (+- 0.2) y la razon #1 es semaforo."""
    mock_units = {
        "23": {
            "id": "23",
            "cvegeo": "23",
            "name": "Quintana Roo",
            "level": "state",
            "category": "naranja",
            "risk_score": 59.5,
            "pred_abstention": 0.521,
            "r_abs": 0.78,
            "r_vuln": 0.53,
            "r_trend": 0.47,
            "r_vol": 0.19,
            "trend_pp": -1.2,
            "volatility_pp": 3.5,
        }
    }
    store = StubStore(units_dict=mock_units)
    ref = _make_mock_reference()

    expl = build_explanation("23", store=store, ref=ref)
    assert isinstance(expl, Explanation)
    assert len(expl.score_breakdown) == 4

    sum_points = sum(sc.points for sc in expl.score_breakdown)
    assert expl.risk_score is not None
    assert abs(sum_points - expl.risk_score) <= 0.2

    assert len(expl.reasons) >= 1
    r1 = expl.reasons[0]
    assert r1.kind == "semaforo"
    assert r1.strength == "fuerte"
    assert r1.evidence_type == "calculo_del_modelo"
    assert "naranja (riesgo alto, 59.5 de 100)" in r1.title
    assert "59.5 de 100" in r1.title
    assert "((" not in r1.title and ") (" not in r1.title


def test_historial_below_and_above():
    """2. Historial: zona sintetica 5/6 por debajo => fuerte, 'casi siempre se vota menos'; zona por arriba => 'vota mas'."""
    years = [2009, 2012, 2015, 2018, 2021, 2024]
    nat_p = {y: 0.50 for y in years}

    # Unit 1: 5 elections below, 1 above
    part_rows_1 = [
        {"id": "01", "cvegeo": "01", "year": y, "election": "DIP_FED", "reliable": True, "participacion": 0.40 if y != 2024 else 0.55}
        for y in years
    ]
    # Unit 2: 5 elections above, 1 below
    part_rows_2 = [
        {"id": "02", "cvegeo": "02", "year": y, "election": "DIP_FED", "reliable": True, "participacion": 0.60 if y != 2024 else 0.45}
        for y in years
    ]

    all_part = pd.DataFrame(part_rows_1 + part_rows_2)
    mock_units = {
        "01": {"id": "01", "cvegeo": "01", "name": "Zona Baja", "level": "state", "category": "rojo", "risk_score": 80.0, "pred_abstention": 0.60, "r_abs": 0.9, "r_vuln": 0.8, "r_trend": 0.5, "r_vol": 0.3},
        "02": {"id": "02", "cvegeo": "02", "name": "Zona Alta", "level": "state", "category": "verde", "risk_score": 25.0, "pred_abstention": 0.35, "r_abs": 0.1, "r_vuln": 0.2, "r_trend": 0.2, "r_vol": 0.1},
    }
    store = StubStore(units_dict=mock_units, participation_df=all_part)
    ref = _make_mock_reference(nat_part=nat_p)

    # Check Zone 1 (below)
    expl_1 = build_explanation("01", store=store, ref=ref)
    hist_1 = next((r for r in expl_1.reasons if r.kind == "historial"), None)
    assert hist_1 is not None
    assert hist_1.strength == "fuerte"
    assert "casi siempre se vota menos" in hist_1.title.lower()
    assert hist_1.evidence_type == "dato_medido"

    # Check Zone 2 (above)
    expl_2 = build_explanation("02", store=store, ref=ref)
    hist_2 = next((r for r in expl_2.reasons if r.kind == "historial"), None)
    assert hist_2 is not None
    assert hist_2.strength == "fuerte"
    assert "vota más" in hist_2.title.lower()
    assert hist_2.evidence_type == "dato_medido"


def test_quien_no_vota_overrepresented_and_suppressed():
    """3. Quien no vota elige el grupo sobre-representado y respeta celdas suprimidas (LN < 10 => excluido, suppressed=True)."""
    mock_profile = [
        # 18-24 has low participation (over-represented among abstainers)
        {"year": 2024, "age_group": "18-24", "sexo": "H", "ln": 500, "sv": 150, "nv": 350, "suprimido": False},
        {"year": 2024, "age_group": "18-24", "sexo": "M", "ln": 500, "sv": 150, "nv": 350, "suprimido": False},
        # 30-34 has high participation
        {"year": 2024, "age_group": "30-34", "sexo": "H", "ln": 1000, "sv": 700, "nv": 300, "suprimido": False},
        {"year": 2024, "age_group": "30-34", "sexo": "M", "ln": 1000, "sv": 700, "nv": 300, "suprimido": False},
        # 65+ has cell with ln < 10
        {"year": 2024, "age_group": "65+", "sexo": "H", "ln": 6, "sv": 2, "nv": 4, "suprimido": True},
        {"year": 2024, "age_group": "65+", "sexo": "M", "ln": 8, "sv": 3, "nv": 5, "suprimido": True},
    ]

    mock_units = {
        "01": {"id": "01", "name": "Aguascalientes", "level": "state", "category": "amarillo", "risk_score": 45.0, "pred_abstention": 0.45, "r_abs": 0.5, "r_vuln": 0.5, "r_trend": 0.5, "r_vol": 0.5}
    }
    store = StubStore(units_dict=mock_units, profile_list=mock_profile)
    ref = _make_mock_reference()

    expl = build_explanation("01", store=store, ref=ref)
    qnv = next((r for r in expl.reasons if r.kind == "quien_no_vota"), None)
    assert qnv is not None
    assert "18 a 24 años" in qnv.title

    # Requirement 2: Do not list protected groups unless none with data remain
    assert not any("65" in g.group for g in expl.groups)
    assert len(expl.groups) > 0
    for g in expl.groups:
        assert g.suppressed is False
        assert g.participation_pct is not None

    # When all groups are suppressed, list suppressed groups
    store_all_sup = StubStore(
        units_dict=mock_units,
        profile_list=[
            {"year": 2024, "age_group": "65+", "sexo": "H", "ln": 6, "sv": 2, "nv": 4, "suprimido": True},
            {"year": 2024, "age_group": "65+", "sexo": "M", "ln": 8, "sv": 3, "nv": 5, "suprimido": True},
        ],
    )
    expl_sup = build_explanation("01", store=store_all_sup, ref=ref)
    assert len(expl_sup.groups) > 0
    assert expl_sup.groups[0].suppressed is True
    assert expl_sup.groups[0].participation_pct is None


def test_asociacion_thresholds():
    """4. Asociacion: con |rho| 0.10 (mun) no aparece; con 0.20 y zona en p80 aparece como debil y el body contiene 'no prueba'."""
    # Variable 1: rho = 0.10 (below 0.15 threshold for mun)
    stat_weak = AssocStat(var="graproes", level="mun", rho=-0.10, n=2000, unfavorable_high=False, p25=8.0, p50=9.0, p75=10.0)
    # Variable 2: rho = 0.20 (above 0.15, below 0.30 => debil), unfavorable_high=True
    stat_mod = AssocStat(var="pct_sin_servsalud", level="mun", rho=0.20, n=2000, unfavorable_high=True, p25=15.0, p50=22.0, p75=30.0)

    assocs = {"mun": {"graproes": stat_weak, "pct_sin_servsalud": stat_mod}}
    level_vals = {
        "mun": {
            "graproes": list(range(1, 100)),
            "pct_sin_servsalud": list(range(1, 100)),
        }
    }
    ref = _make_mock_reference(assocs=assocs, level_vals=level_vals)

    mock_units = {
        "01001": {
            "id": "01001",
            "name": "Aguascalientes Mun",
            "level": "mun",
            "cve_ent": "01",
            "category": "amarillo",
            "risk_score": 40.0,
            "pred_abstention": 0.45,
            "r_abs": 0.5,
            "r_vuln": 0.5,
            "r_trend": 0.5,
            "r_vol": 0.5,
            "graproes": 7.0,  # <= p25 (unfavorable), but rho = -0.10 is below threshold
            "pct_sin_servsalud": 80.0,  # >= p75 (unfavorable) and rho = 0.20
        }
    }
    store = StubStore(units_dict=mock_units)

    expl = build_explanation("01001", store=store, ref=ref)
    assoc_reasons = [r for r in expl.reasons if r.kind == "perfil_territorial"]

    # graproes should NOT appear
    assert not any("escolaridad" in r.title.lower() for r in assoc_reasons)

    # pct_sin_servsalud should appear
    salud_r = next((r for r in assoc_reasons if "salud" in r.title.lower()), None)
    assert salud_r is not None
    assert salud_r.strength == "debil"
    assert "no prueba" in salud_r.body.lower()


def test_migracion_and_confiabilidad():
    """5. Migracion solo en el 10% superior; confiabilidad con ns_rate 0.35 => confidence == 'baja' y va al final."""
    level_vals = {
        "mun": {
            "pct_nacido_otra_ent": [float(i) for i in range(1, 101)],
        }
    }
    # Zone 1: 95.0 => in top 10%
    # Zone 2: 50.0 => not in top 10%
    ctx = {
        "01001": {"pct_nacido_otra_ent": 95.0, "pct_llego_2015_2020": 20.0},
        "01002": {"pct_nacido_otra_ent": 50.0, "pct_llego_2015_2020": 10.0},
    }
    ref = _make_mock_reference(level_vals=level_vals, context=ctx)

    mock_units = {
        "01001": {
            "id": "01001",
            "name": "Mun Migrante",
            "level": "mun",
            "category": "verde",
            "risk_score": 30.0,
            "pred_abstention": 0.35,
            "r_abs": 0.3,
            "r_vuln": 0.3,
            "r_trend": 0.3,
            "r_vol": 0.3,
        },
        "01002": {
            "id": "01002",
            "name": "Mun Confiable",
            "level": "mun",
            "category": "verde",
            "risk_score": 30.0,
            "pred_abstention": 0.35,
            "r_abs": 0.3,
            "r_vuln": 0.3,
            "r_trend": 0.3,
            "r_vol": 0.3,
        },
        "01003": {
            "id": "01003",
            "name": "Mun Incierto",
            "level": "mun",
            "category": "rojo",
            "risk_score": 78.0,
            "pred_abstention": 0.65,
            "r_abs": 0.8,
            "r_vuln": 0.8,
            "r_trend": 0.5,
            "r_vol": 0.5,
            "ns_rate": 0.35,  # High ns_rate => confiabilidad reason and confidence baja
        },
    }
    store = StubStore(units_dict=mock_units)

    # Zone 1: migration appears
    expl_1 = build_explanation("01001", store=store, ref=ref)
    assert any(r.kind == "contexto" for r in expl_1.reasons)

    # Zone 2: migration does NOT appear
    expl_2 = build_explanation("01002", store=store, ref=ref)
    assert not any(r.kind == "contexto" for r in expl_2.reasons)

    # Zone 3: confiabilidad reason present at the end, confidence baja
    expl_3 = build_explanation("01003", store=store, ref=ref)
    assert expl_3.confidence == "baja"
    assert expl_3.reasons[-1].kind == "confiabilidad"
    assert "incompletos" in expl_3.reasons[-1].title.lower()


def test_no_forbidden_words():
    """6. Ningun title/body/headline/in_short/plain contiene las palabras prohibidas (regex con limites de palabra para 'pp')."""
    mock_units = {
        "23": {
            "id": "23",
            "name": "Quintana Roo",
            "level": "state",
            "category": "naranja",
            "risk_score": 59.5,
            "pred_abstention": 0.521,
            "r_abs": 0.78,
            "r_vuln": 0.53,
            "r_trend": 0.47,
            "r_vol": 0.19,
            "trend_pp": -1.2,
            "volatility_pp": 3.5,
            "graproes": 8.5,
            "pct_sin_servsalud": 25.0,
        }
    }
    stat = AssocStat(var="pct_sin_servsalud", level="state", rho=0.40, n=32, unfavorable_high=True, p25=15.0, p50=22.0, p75=24.0)
    level_vals = {"state": {"pct_sin_servsalud": [float(i) for i in range(1, 33)]}}
    ctx = {"23": {"pct_nacido_otra_ent": 50.9, "pct_llego_2015_2020": 15.0}}
    level_vals["state"]["pct_nacido_otra_ent"] = [float(i) for i in range(1, 33)]

    store = StubStore(units_dict=mock_units)
    ref = _make_mock_reference(assocs={"state": {"pct_sin_servsalud": stat}}, level_vals=level_vals, context=ctx)

    expl = build_explanation("23", store=store, ref=ref)

    # Check headline
    assert not FORBIDDEN_WORDS_PATTERN.search(expl.headline), f"Forbidden word in headline: {expl.headline}"

    # Check in_short
    for s in expl.in_short:
        assert not FORBIDDEN_WORDS_PATTERN.search(s), f"Forbidden word in in_short: {s}"

    # Check reasons
    for r in expl.reasons:
        assert not FORBIDDEN_WORDS_PATTERN.search(r.title), f"Forbidden word in reason title: {r.title}"
        assert not FORBIDDEN_WORDS_PATTERN.search(r.body), f"Forbidden word in reason body: {r.body}"

    # Check score_breakdown
    for sc in expl.score_breakdown:
        assert not FORBIDDEN_WORDS_PATTERN.search(sc.plain), f"Forbidden word in score plain: {sc.plain}"


def test_explanation_facts_numbers():
    """7. Todas las cifras de explanation_facts aparecen en algun display o plain (extrae numeros con regex)."""
    mock_units = {
        "23": {
            "id": "23",
            "name": "Quintana Roo",
            "level": "state",
            "category": "naranja",
            "risk_score": 59.5,
            "pred_abstention": 0.521,
            "r_abs": 0.78,
            "r_vuln": 0.53,
            "r_trend": 0.47,
            "r_vol": 0.19,
            "trend_pp": -1.2,
            "volatility_pp": 3.5,
        }
    }
    part_df = pd.DataFrame([
        {"id": "23", "cvegeo": "23", "year": 2009, "election": "DIP_FED", "reliable": True, "participacion": 0.40},
        {"id": "23", "cvegeo": "23", "year": 2012, "election": "DIP_FED", "reliable": True, "participacion": 0.50},
        {"id": "23", "cvegeo": "23", "year": 2015, "election": "DIP_FED", "reliable": True, "participacion": 0.40},
        {"id": "23", "cvegeo": "23", "year": 2018, "election": "DIP_FED", "reliable": True, "participacion": 0.50},
        {"id": "23", "cvegeo": "23", "year": 2021, "election": "DIP_FED", "reliable": True, "participacion": 0.45},
        {"id": "23", "cvegeo": "23", "year": 2024, "election": "DIP_FED", "reliable": True, "participacion": 0.50},
    ])
    store = StubStore(units_dict=mock_units, participation_df=part_df)
    ref = _make_mock_reference()

    expl = build_explanation("23", store=store, ref=ref)
    facts = explanation_facts(expl)

    # Extract all numbers from facts (excluding isolated single hyphens/punctuation)
    fact_text = " ".join(facts)
    fact_numbers = set(re.findall(r"\b\d+(?:\.\d+)?\b", fact_text))

    # Extract all numbers from displays and plains
    display_text = " ".join(
        [num.display for r in expl.reasons for num in r.numbers]
        + [sc.plain for sc in expl.score_breakdown]
    )
    display_numbers = set(re.findall(r"\b\d+(?:\.\d+)?\b", display_text))

    # All numbers in facts must appear in display_numbers
    unbacked = fact_numbers - display_numbers
    assert not unbacked, f"Facts contain numbers not present in display/plain: {unbacked}"


@pytest.mark.skipif(not (BUILD_DIR / "units.parquet").is_file(), reason="data/build/units.parquet does not exist")
def test_real_parquet_smoke():
    """8. Con datos reales: Chiapas titular coherente con verde, Quintana Roo grupos sin None en '35 a 44 años',
    historial estatal de Baja California calculado con SV/(SV+NV)."""
    from atalaya.store import get_store

    store = get_store()

    # Quintana Roo test: grupos sin None en '35 a 44 años'
    t0 = time.time()
    expl_23 = build_explanation("23", store=store)
    t_23 = time.time() - t0
    assert t_23 < 1.0, f"build_explanation('23') took {t_23:.3f} s, expected < 1 s"
    assert isinstance(expl_23, Explanation)
    assert expl_23.category in ("rojo", "naranja", "amarillo", "verde")

    g35 = next((g for g in expl_23.groups if "35" in g.group and "44" in g.group), None)
    assert g35 is not None, "35 a 44 años should be present in Quintana Roo groups"
    assert g35.participation_pct is not None, "35 a 44 años should have valid participation"
    assert g35.suppressed is False, "35 a 44 años should not be suppressed"
    for g in expl_23.groups:
        assert g.participation_pct is not None
        assert g.suppressed is False

    # Chiapas test: titular coherente con verde
    t0 = time.time()
    expl_07 = build_explanation("07", store=store)
    t_07 = time.time() - t0
    assert t_07 < 1.0, f"build_explanation('07') took {t_07:.3f} s, expected < 1 s"
    assert isinstance(expl_07, Explanation)
    assert "vote más gente" in expl_07.headline.lower()
    assert "años" not in expl_07.headline.lower()
    assert "personas de" not in expl_07.headline.lower()

    # Baja California: historial estatal calculado con SV/(SV+NV)
    expl_02 = build_explanation("02", store=store)
    hist_02 = next((r for r in expl_02.reasons if r.kind == "historial"), None)
    assert hist_02 is not None
    avg_gap_num = next((n for n in hist_02.numbers if n.key == "avg_gap"), None)
    assert avg_gap_num is not None
    assert abs(avg_gap_num.value - 13.1) < 0.2
    assert "13.1 puntos" in avg_gap_num.display


def test_green_zone_headline_no_age_groups():
    """Zona verde => titular con 'vote más gente' y sin mencionar grupos de edad."""
    mock_units = {
        "07": {
            "id": "07",
            "name": "Chiapas",
            "level": "state",
            "category": "verde",
            "risk_score": 30.8,
            "pred_abstention": 0.459,
            "r_abs": 0.28,
            "r_vuln": 0.35,
            "r_trend": 0.30,
            "r_vol": 0.20,
        }
    }
    mock_profile = [
        {"year": 2024, "age_group": "25-34", "sexo": "H", "ln": 1000, "sv": 400, "nv": 600, "suprimido": False},
        {"year": 2024, "age_group": "25-34", "sexo": "M", "ln": 1000, "sv": 450, "nv": 550, "suprimido": False},
    ]
    store = StubStore(units_dict=mock_units, profile_list=mock_profile)
    ref = _make_mock_reference()

    expl = build_explanation("07", store=store, ref=ref)
    assert "vote más gente" in expl.headline.lower()
    assert "años" not in expl.headline.lower()
    assert "personas de" not in expl.headline.lower()
    assert "verde (riesgo bajo)" in expl.headline


def test_red_zone_with_history_headline():
    """Zona roja con historial => 'casi siempre se vota menos'."""
    years = [2009, 2012, 2015, 2018, 2021, 2024]
    nat_p = {y: 0.50 for y in years}
    part_rows = [
        {"id": "23", "cvegeo": "23", "year": y, "election": "DIP_FED", "reliable": True, "participacion": 0.40}
        for y in years
    ]
    mock_units = {
        "23": {
            "id": "23",
            "name": "Zona Roja",
            "level": "state",
            "category": "rojo",
            "risk_score": 75.0,
            "pred_abstention": 0.60,
            "r_abs": 0.85,
            "r_vuln": 0.80,
            "r_trend": 0.50,
            "r_vol": 0.30,
        }
    }
    store = StubStore(units_dict=mock_units, participation_df=pd.DataFrame(part_rows))
    ref = _make_mock_reference(nat_part=nat_p)

    expl = build_explanation("23", store=store, ref=ref)
    assert "casi siempre se vota menos" in expl.headline.lower()
    assert "rojo (riesgo muy alto)" in expl.headline


def test_nonbinary_cell_suppressed_group_retains_hm():
    """Grupo con celda no binaria LN < 10 conserva cifras H+M y no queda suppressed."""
    mock_profile = [
        {"year": 2024, "age_group": "35-44", "sexo": "H", "ln": 500, "sv": 250, "nv": 250, "suprimido": False},
        {"year": 2024, "age_group": "35-44", "sexo": "M", "ln": 500, "sv": 300, "nv": 200, "suprimido": False},
        {"year": 2024, "age_group": "35-44", "sexo": "X", "ln": None, "sv": None, "nv": None, "suprimido": True},
    ]
    mock_units = {
        "23": {
            "id": "23",
            "name": "Quintana Roo",
            "level": "state",
            "category": "naranja",
            "risk_score": 59.5,
            "pred_abstention": 0.52,
            "r_abs": 0.7,
            "r_vuln": 0.5,
            "r_trend": 0.5,
            "r_vol": 0.2,
        }
    }
    store = StubStore(units_dict=mock_units, profile_list=mock_profile)
    ref = _make_mock_reference()

    expl = build_explanation("23", store=store, ref=ref)
    g35 = next((g for g in expl.groups if "35" in g.group and "44" in g.group), None)
    assert g35 is not None
    assert g35.suppressed is False
    assert g35.participation_pct is not None
    assert g35.participation_pct == 55.0


def test_volatility_rank_4_de_las_mas_estables():
    """Volatilidad con rank 4 => 'de las más estables'."""
    mock_units = {
        "01": {
            "id": "01",
            "name": "Zona Estable",
            "level": "mun",
            "category": "verde",
            "risk_score": 25.0,
            "pred_abstention": 0.35,
            "r_abs": 0.2,
            "r_vuln": 0.2,
            "r_trend": 0.2,
            "r_vol": 0.04,  # rank 4 %
            "volatility_pp": 0.8,
        }
    }
    store = StubStore(units_dict=mock_units)
    ref = _make_mock_reference()

    expl = build_explanation("01", store=store, ref=ref)
    vol_comp = next((sc for sc in expl.score_breakdown if sc.key == "vol"), None)
    assert vol_comp is not None
    assert "de las más estables" in vol_comp.plain
    assert "más que en el 4 %" not in vol_comp.plain
    assert "cambia menos que en el 96 %" in vol_comp.plain


def test_no_double_parentheses_in_titles():
    """Ningún título con '((' o ') ('."""
    categories = ["rojo", "naranja", "amarillo", "verde"]
    for cat in categories:
        mock_units = {
            "01": {
                "id": "01",
                "name": "Zona Test",
                "level": "state",
                "category": cat,
                "risk_score": 50.0,
                "pred_abstention": 0.45,
                "r_abs": 0.5,
                "r_vuln": 0.5,
                "r_trend": 0.5,
                "r_vol": 0.5,
            }
        }
        store = StubStore(units_dict=mock_units)
        ref = _make_mock_reference()
        expl = build_explanation("01", store=store, ref=ref)
        for r in expl.reasons:
            assert "((" not in r.title, f"Double open paren in {r.title}"
            assert ") (" not in r.title, f"Adjacent parens in {r.title}"


def test_missing_risk_score_confiabilidad():
    """Zone with no risk_score has no semaforo reason and includes confiabilidad."""
    mock_units = {
        "99": {
            "id": "99",
            "name": "Zona Sin Score",
            "level": "state",
            "category": "sin_dato",
            "risk_score": None,
            "pred_abstention": None,
        }
    }
    store = StubStore(units_dict=mock_units)
    ref = _make_mock_reference()

    expl = build_explanation("99", store=store, ref=ref)
    assert expl.risk_score is None
    assert len(expl.score_breakdown) == 0
    assert not any(r.kind == "semaforo" for r in expl.reasons)
    assert any(r.kind == "confiabilidad" for r in expl.reasons)


def test_unit_not_found_raises_key_error():
    """Requesting an unknown unit raises KeyError."""
    store = StubStore(units_dict={})
    ref = _make_mock_reference()

    with pytest.raises(KeyError):
        build_explanation("99999", store=store, ref=ref)


def test_cache_and_clear():
    """Explanation cache stores results and clear_explain_cache empties it."""
    mock_units = {
        "23": {
            "id": "23",
            "name": "Quintana Roo",
            "level": "state",
            "category": "naranja",
            "risk_score": 59.5,
        }
    }
    store = StubStore(units_dict=mock_units)
    ref = _make_mock_reference()

    expl1 = build_explanation("23", store=store, ref=ref)
    assert expl1 is not None

    clear_explain_cache()
    expl2 = build_explanation("23", store=store, ref=ref)
    assert expl2 is not None

