"""Tests for Campaign Planning Pipeline (atalaya.intel.campaign).

All tests run in-process, without network access, with tmp_path for storage,
and monkeypatched Gemini and LLM dependencies.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
import json
from pathlib import Path
import sys
import time
import types
from typing import Any
from unittest.mock import MagicMock

import pandas as pd
import pytest

# Import real modules or fallback to stubs if unavailable
try:
    import atalaya.gemini
except ImportError:
    mock_gemini_mod = types.ModuleType("atalaya.gemini")
    mock_gemini_mod.is_enabled = lambda: False
    mock_gemini_mod.grounded_json = None
    mock_gemini_mod.GeminiError = type("GeminiError", (Exception,), {})
    mock_gemini_mod.GeminiDisabled = type("GeminiDisabled", (mock_gemini_mod.GeminiError,), {})
    mock_gemini_mod.GeminiQuotaError = type("GeminiQuotaError", (mock_gemini_mod.GeminiError,), {})
    mock_gemini_mod.GeminiBudgetExceeded = type("GeminiBudgetExceeded", (mock_gemini_mod.GeminiError,), {})
    import urllib.parse
    def _dom(u: str) -> str:
        nl = urllib.parse.urlparse(u).netloc.lower()
        return nl[4:] if nl.startswith("www.") else nl
    mock_gemini_mod.domain_of = _dom
    mock_gemini_mod.resolve_source_url = lambda url, **kw: url
    sys.modules["atalaya.gemini"] = mock_gemini_mod

try:
    import atalaya.intel.sources
except ImportError:
    mock_sources_mod = types.ModuleType("atalaya.intel.sources")
    mock_sources_mod.VERIFIABLE_TIERS = {"oficial", "verificador", "academico", "medio_reconocido", "medio_regional"}
    def _cls_dom(domain: str) -> str:
        d = domain.lower()
        if "ine.mx" in d or "gob.mx" in d:
            return "oficial"
        if "eluniversal" in d or "reforma" in d:
            return "medio_reconocido"
        if "x.com" in d or "facebook" in d:
            return "red_social"
        return "no_reconocido"
    mock_sources_mod.classify_domain = _cls_dom
    mock_sources_mod.outlet_name = lambda d: "INE" if "ine.mx" in d else ("El Universal" if "eluniversal" in d else None)
    mock_sources_mod.domain_of = lambda u: "ine.mx" if "ine.mx" in u else ("eluniversal.com.mx" if "eluniversal" in u else "example.com")
    sys.modules["atalaya.intel.sources"] = mock_sources_mod

try:
    import atalaya.intel.deck
except ImportError:
    mock_deck_mod = types.ModuleType("atalaya.intel.deck")
    mock_deck_mod.build_slides = lambda plan: []
    sys.modules["atalaya.intel.deck"] = mock_deck_mod

try:
    import atalaya.intel.storage
except ImportError:
    mock_storage_mod = types.ModuleType("atalaya.intel.storage")
    sys.modules["atalaya.intel.storage"] = mock_storage_mod

from atalaya.api import deps
from atalaya.intel.campaign import (
    _PlanDraft,
    _ProposalDraft,
    _RiskDraft,
    _StepDraft,
    _TargetGroupDraft,
    build_snapshot,
    cached_plan,
    compute_impact,
    find_plan,
    plan_campaign,
    research_unit,
)
from atalaya.intel.schemas import (
    CampaignPlan,
    CampaignRequest,
    DataSnapshot,
    Finding,
    ImpactAnalysis,
    Proposal,
    ResearchBundle,
    SourceRef,
)


@dataclass
class DummyGroundedSource:
    url: str
    title: str = ""
    domain: str = ""


@dataclass
class DummyGroundedResult:
    text: str = ""
    sources: list[DummyGroundedSource] = None  # type: ignore
    queries: list[str] = None  # type: ignore
    model: str = "gemini-3.8-flash"
    latency_ms: int = 150
    supports: list[dict] = None  # type: ignore
    from_cache: bool = False
    mode: str = "grounding"

    def __post_init__(self):
        if self.sources is None:
            self.sources = []
        if self.queries is None:
            self.queries = ["participacion electoral zacatecas"]
        if self.supports is None:
            self.supports = []


@pytest.fixture
def mock_storage(tmp_path, monkeypatch):
    """Configures storage module to write and read exclusively inside tmp_path."""
    intel_cache = tmp_path / "intel"
    camp_dir = intel_cache / "results" / "campaign"
    camp_dir.mkdir(parents=True, exist_ok=True)

    def _intel_dir() -> Path:
        return intel_cache

    def _campaign_result_path(unit_id: str, focus: str | None) -> Path:
        import hashlib
        h = hashlib.sha1((focus or "").encode("utf-8")).hexdigest()[:8]
        return camp_dir / f"{unit_id}__{h}.json"

    def _read_json(path: Path) -> Any | None:
        if path.is_file():
            return json.loads(path.read_text(encoding="utf-8"))
        return None

    def _write_json_atomic(path: Path, obj: Any) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")
        tmp.replace(path)

    storage_mod = sys.modules["atalaya.intel.storage"]
    monkeypatch.setattr(storage_mod, "intel_dir", _intel_dir, raising=False)
    monkeypatch.setattr(storage_mod, "campaign_result_path", _campaign_result_path, raising=False)
    monkeypatch.setattr(storage_mod, "read_json", _read_json, raising=False)
    monkeypatch.setattr(storage_mod, "write_json_atomic", _write_json_atomic, raising=False)
    return camp_dir


@pytest.fixture(autouse=True)
def isolate_campaign_grounding(monkeypatch, tmp_path: Path):
    """Isolate campaign tests from real cache and default to Ruta B (grounding circuit open)."""
    intel_dir = tmp_path / "intel"
    intel_dir.mkdir(parents=True, exist_ok=True)
    gemini_mod = sys.modules.get("atalaya.gemini")
    if gemini_mod is not None:
        if hasattr(gemini_mod, "_get_intel_dir"):
            monkeypatch.setattr(gemini_mod, "_get_intel_dir", lambda: intel_dir)
        if hasattr(gemini_mod, "_is_grounding_available"):
            monkeypatch.setattr(gemini_mod, "_is_grounding_available", lambda: (False, None))


# ---------------------------------------------------------------- tests: build_snapshot


def test_build_snapshot_real_units():
    """Build snapshot from real data/build/units.parquet if available."""
    from atalaya.config import BUILD_DIR
    parquet_path = BUILD_DIR / "units.parquet"
    if not parquet_path.is_file():
        pytest.skip("units.parquet not present; skipping real unit snapshot test")

    # State test: Zacatecas (32)
    st_snap = build_snapshot("32")
    assert st_snap.unit_id == "32"
    assert st_snap.level == "state"
    assert st_snap.ent == "32"
    assert st_snap.name != ""
    assert st_snap.lista_nominal > 0
    assert st_snap.pred_abstention is not None and 0.0 <= st_snap.pred_abstention <= 1.0
    assert st_snap.municipios is not None and st_snap.municipios > 0
    assert st_snap.municipios_rojos is not None and st_snap.municipios_rojos >= 0
    assert len(st_snap.drivers) <= 5
    assert isinstance(st_snap.recommendations, list)

    # Municipality test: Guachochi (08037) or first municipal unit
    units_df = deps.get_units_df()
    mun_rows = units_df[units_df.get("level") == "mun"]
    if not mun_rows.empty:
        sample_id = str(mun_rows.iloc[0]["id"])
        m_snap = build_snapshot(sample_id)
        assert m_snap.unit_id == sample_id
        assert m_snap.level == "mun"
        assert m_snap.municipios is None
        assert m_snap.municipios_rojos is None
        assert m_snap.category in {"verde", "amarillo", "naranja", "rojo", "sin_dato"}


def test_build_snapshot_synthetic(monkeypatch):
    """Build snapshot with a synthetic DataFrame verifying NaN to None conversion and KeyError."""
    synthetic_df = pd.DataFrame([
        {
            "id": "99",
            "level": "state",
            "cve_ent": "99",
            "name": "Estado Prueba",
            "lista_nominal": 500000,
            "pred_abstention": 0.45,
            "pred_low": 0.40,
            "pred_high": 0.50,
            "category": "amarillo",
            "risk_score": 45.0,
            "last_participation": float("nan"),  # NaN should become None
            "last_year": None,
            "trend_pp": float("nan"),
            "abstencion_esperada": 225000,
            "part_18_34_last": float("nan"),
            "gap_youth_pp_last": float("nan"),
            "pct_18_24": 0.18,
            "pct_rural": 0.35,
            "pct_hli": float("nan"),
            "pct_internet": 0.60,
            "im_2020": float("nan"),
            "pob_18ymas": 480000.0,
        },
        {
            "id": "99001",
            "level": "mun",
            "cve_ent": "99",
            "name": "Municipio Prueba",
            "lista_nominal": 50000,
            "pred_abstention": 0.55,
            "pred_low": 0.50,
            "pred_high": 0.60,
            "category": "rojo",
            "risk_score": 78.0,
            "last_participation": None,
            "last_year": None,
            "trend_pp": None,
            "abstencion_esperada": None,
            "part_18_34_last": None,
            "gap_youth_pp_last": None,
            "pct_18_24": 18.0,
            "pct_rural": 50.0,
            "pct_hli": None,
            "pct_internet": None,
            "im_2020": None,
            "pob_18ymas": 48000.0,
        },
    ])

    monkeypatch.setattr(deps, "get_units_df", lambda: synthetic_df)

    snap = build_snapshot("99")
    assert snap.unit_id == "99"
    assert snap.name == "Estado Prueba"
    assert snap.last_participation is None
    assert snap.trend_pp is None
    assert snap.part_18_34_last is None
    assert snap.pct_hli is None
    assert snap.im_2020 is None
    # 0.18 should be cleaned to 18.0%
    assert snap.pct_18_24 == 18.0
    assert snap.municipios == 1
    assert snap.municipios_rojos == 1

    # KeyError on unknown unit
    with pytest.raises(KeyError):
        build_snapshot("00000")


# ---------------------------------------------------------------- tests: research_unit


def test_research_unit_filters(monkeypatch):
    """Test source tier filtering, anti-hallucination cross-checking, and drop of findings without sources."""
    from atalaya import gemini, websearch
    from atalaya.explain import verify as explain_verify
    from atalaya.explain.verify import CorpusDoc

    monkeypatch.setattr(gemini, "is_enabled", lambda: True)

    docs = [
        CorpusDoc(
            id="s1",
            url="https://www.ine.mx/diagnostico-participacion",
            title="Diagnóstico electoral en Zacatecas",
            domain="ine.mx",
            outlet="INE",
            published="2024-01-15",
            tier="oficial",
            text=(
                "En el estado de Zacatecas la desconfianza ciudadana en las casillas electorales aumento "
                "notablemente en diversos municipios de Zacatecas tras los comicios pasados."
            ),
            from_page=True,
        ),
        CorpusDoc(
            id="s2",
            url="https://www.eluniversal.com.mx/estados/traslado-casillas",
            title="Casillas en la sierra de Zacatecas",
            domain="eluniversal.com.mx",
            outlet="El Universal",
            published="2024-03-10",
            tier="medio_reconocido",
            text=(
                "Reporte periodistico en Zacatecas documenta caminos intransitables hacia casillas electorales "
                "en comunidades rurales de Zacatecas donde los votantes deben caminar horas."
            ),
            from_page=True,
        ),
    ]

    monkeypatch.setattr(explain_verify, "fetch_corpus", lambda *a, **kw: list(docs))
    monkeypatch.setattr(websearch, "search_news", lambda *a, **kw: [
        websearch.NewsCandidate(
            title="Diagnóstico electoral en Zacatecas",
            url="https://www.ine.mx/diagnostico-participacion",
            domain="ine.mx",
            outlet="INE",
            published="2024-01-15",
            snippet="Snippet",
            provider="google_news",
        ),
        websearch.NewsCandidate(
            title="Casillas en Zacatecas",
            url="https://www.eluniversal.com.mx/estados/traslado-casillas",
            domain="eluniversal.com.mx",
            outlet="El Universal",
            published="2024-03-10",
            snippet="Snippet",
            provider="google_news",
        ),
    ])

    raw_gemini_json = {
        "findings": [
            {
                "title": "Desconfianza en casillas de Zacatecas",
                "summary": "Estudio documenta desconfianza ciudadana en casillas electorales.",
                "category": "desconfianza_institucional",
                "scope": "estado",
                "confidence": "alta",
                "evidence": ["s1"],
                "quote": "la desconfianza ciudadana en las casillas electorales aumento notablemente",
            },
            {
                "title": "Hallazgo alucinado sin fuente verificable",
                "summary": "Causa sin evidencia verificable en fuentes oficiales ni grounding.",
                "category": "otra",
                "scope": "municipio",
                "confidence": "baja",
                "evidence": ["s99"],
                "quote": "cita inventada que no existe en ningun documento provisto",
            },
            {
                "title": "Barreras de traslado y casillas",
                "summary": "Reporte documenta caminos intransitables hacia casillas electorales en Zacatecas.",
                "category": "acceso_casillas_distancia",
                "scope": "municipio",
                "confidence": "media",
                "evidence": ["s2"],
                "quote": "caminos intransitables hacia casillas electorales en comunidades rurales",
            },
        ]
    }

    meta = types.SimpleNamespace(model="gemini-3.6-flash", from_cache=False)
    monkeypatch.setattr(gemini, "generate_json", lambda *a, **kw: (raw_gemini_json, meta))

    snap = DataSnapshot(
        unit_id="32",
        name="Zacatecas",
        level="state",
        ent="32",
        ent_name="Zacatecas",
        lista_nominal=1200000,
        pred_abstention=0.48,
        pred_low=0.44,
        pred_high=0.52,
        category="amarillo",
        risk_score=48.0,
        last_participation=0.52,
        last_year=2024,
        trend_pp=-1.2,
        abstencion_esperada=576000,
    )

    bundle = research_unit(snap, focus="jóvenes")

    assert bundle.degraded is False
    assert bundle.discarded_sources >= 1  # finding 2 with invalid quote/source discarded
    assert len(bundle.findings) == 2
    assert bundle.findings[0].id == "f1"
    assert bundle.findings[1].id == "f2"
    assert bundle.findings[0].category == "desconfianza_institucional"
    assert bundle.findings[1].category == "acceso_casillas_distancia"
    assert len(bundle.sources) == 2
    assert bundle.sources[0].id == "s1"
    assert bundle.sources[1].id == "s2"
    assert bundle.findings[0].evidence == ["s1"]
    assert bundle.findings[1].evidence == ["s2"]
    assert bundle.findings[0].quote == "la desconfianza ciudadana en las casillas electorales aumento notablemente"


def test_research_unit_degraded_when_gemini_unavailable(monkeypatch):
    """Test graceful degraded ResearchBundle when Gemini is disabled or raises error."""
    gemini_mod = sys.modules["atalaya.gemini"]
    monkeypatch.setattr(gemini_mod, "is_enabled", lambda: False)

    snap = DataSnapshot(
        unit_id="08037",
        name="Guachochi",
        level="mun",
        ent="08",
        ent_name="Chihuahua",
        lista_nominal=45000,
        pred_abstention=0.52,
        pred_low=0.48,
        pred_high=0.56,
        category="rojo",
        risk_score=72.0,
        last_participation=0.48,
        last_year=2024,
        trend_pp=-2.0,
        abstencion_esperada=23400,
    )

    bundle = research_unit(snap)
    assert bundle.degraded is True
    assert len(bundle.findings) == 0
    assert len(bundle.sources) == 0
    assert bundle.note is not None
    assert "No se pudo investigar en internet" in bundle.note


def test_research_unit_rss_fallback_mode(monkeypatch):
    """Test fallback_queries generation, fallback_days, and ResearchBundle in Ruta B respaldo mode."""
    from atalaya import gemini, websearch
    from atalaya.explain import verify as explain_verify
    from atalaya.explain.verify import CorpusDoc

    monkeypatch.setattr(gemini, "is_enabled", lambda: True)

    captured_search_args = {}

    def fake_search_news(queries, days=1460, max_items=40):
        captured_search_args["queries"] = queries
        captured_search_args["days"] = days
        captured_search_args["max_items"] = max_items
        return [
            websearch.NewsCandidate(
                title="Casillas rurales en Zacatecas",
                url="https://www.ine.mx/casillas-rurales",
                domain="ine.mx",
                outlet="INE",
                published="2024-01-10",
                snippet="Casillas INE en zonas rurales",
                provider="google_news",
            ),
            websearch.NewsCandidate(
                title="Votación en Zacatecas",
                url="https://eluniversal.com.mx/zacatecas-voto",
                domain="eluniversal.com.mx",
                outlet="El Universal",
                published="2024-01-12",
                snippet="Participación electoral",
                provider="google_news",
            ),
            websearch.NewsCandidate(
                title="Abstención juvenil en Zacatecas",
                url="https://reforma.com/zacatecas-jovenes",
                domain="reforma.com",
                outlet="Reforma",
                published="2024-01-15",
                snippet="Jóvenes en casillas",
                provider="google_news",
            ),
        ]

    monkeypatch.setattr(websearch, "search_news", fake_search_news)

    docs = [
        CorpusDoc(
            id="s1",
            url="https://www.ine.mx/casillas-rurales",
            title="Casillas rurales en Zacatecas",
            domain="ine.mx",
            outlet="INE",
            published="2024-01-10",
            tier="oficial",
            text=(
                "El informe oficial en Zacatecas documenta la instalacion de casillas electorales en zonas rurales "
                "del estado de Zacatecas donde se busca reducir el abstencionismo de votantes."
            ),
            from_page=True,
        )
    ]
    monkeypatch.setattr(explain_verify, "fetch_corpus", lambda *a, **kw: list(docs))

    raw_json = {
        "findings": [
            {
                "title": "Participación cívica y casillas",
                "summary": "Estudio documenta ubicación de casillas electorales en zonas rurales.",
                "category": "acceso_casillas_distancia",
                "scope": "estado",
                "confidence": "alta",
                "evidence": ["s1"],
                "quote": "documenta la instalacion de casillas electorales en zonas rurales",
            }
        ]
    }
    meta = types.SimpleNamespace(model="gemini-3.6-flash", from_cache=False)
    monkeypatch.setattr(gemini, "generate_json", lambda *a, **kw: (raw_json, meta))

    snap = DataSnapshot(
        unit_id="32",
        name="Zacatecas",
        level="state",
        ent="32",
        ent_name="Zacatecas",
        lista_nominal=1200000,
        pred_abstention=0.48,
        pred_low=0.44,
        pred_high=0.52,
        category="amarillo",
        risk_score=48.0,
        last_participation=0.52,
        last_year=2024,
        trend_pp=-1.2,
        abstencion_esperada=576000,
    )

    bundle = research_unit(snap, focus="jóvenes universitarios")

    assert "queries" in captured_search_args
    fb_q = captured_search_args["queries"]
    assert len(fb_q) >= 5
    assert any("Zacatecas" in q and "participación electoral" in q for q in fb_q)
    assert any("Zacatecas" in q and "abstención" in q for q in fb_q)
    assert any("jóvenes universitarios" in q for q in fb_q)
    assert captured_search_args.get("days") == 1460

    assert bundle.degraded is False
    assert bundle.search_mode == "respaldo"
    assert len(bundle.findings) == 1
    assert bundle.findings[0].category == "acceso_casillas_distancia"
    assert bundle.findings[0].quote == "documenta la instalacion de casillas electorales en zonas rurales"


def test_verify_operator_non_ascii_header(monkeypatch):
    """Test verify_operator handles non-ASCII characters without raising TypeError and returns 401."""
    from fastapi import HTTPException
    from starlette.requests import Request
    from atalaya.api.security import verify_operator
    from atalaya.config import get_settings

    monkeypatch.setenv("ATALAYA_OPERATOR_TOKEN", "token-secreto-123")
    get_settings.cache_clear()

    # Valid token works
    valid_req = Request({"type": "http", "headers": [(b"x-operator-token", b"token-secreto-123")]})
    verify_operator(valid_req)  # does not raise

    # Non-ASCII header raises 401 HTTPException, NOT 500 TypeError
    non_ascii_req = Request({"type": "http", "headers": [(b"x-operator-token", "clave-inválida-ñ".encode("utf-8"))]})
    with pytest.raises(HTTPException) as exc_info:
        verify_operator(non_ascii_req)
    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == "Clave de operador inválida."


# ---------------------------------------------------------------- tests: plan_campaign


def test_plan_campaign_normalization(monkeypatch, mock_storage):
    """Test GLM plan normalization: deduplicate levers, clamp dates, validate addresses, municipal targeting."""
    # Mock LLM returning duplicate levers and invalid step dates
    from atalaya import llm
    monkeypatch.setattr(llm, "is_enabled", lambda: True)
    monkeypatch.setattr(llm, "describe", lambda: {"model": "glm-5.3", "reasoning_effort": "high"})

    today = date.today().isoformat()
    mock_draft = _PlanDraft(
        objective="Plan institucional de prueba.",
        target_groups=[_TargetGroupDraft(name="Jóvenes 18-24", description="Estudiantes universitarios")],
        proposals=[
            _ProposalDraft(
                title="Brigadas juveniles menores",
                lever="promocion_jovenes",
                effect_pp=1.5,
                coverage=50.0,
                targeting="rojo",
                addresses=["f1", "f999"],  # f999 does not exist
            ),
            _ProposalDraft(
                title="Brigadas juveniles intensivas",
                lever="promocion_jovenes",  # Duplicate lever with higher effect_pp -> must be chosen
                effect_pp=3.2,
                coverage=90.0,
                targeting="rojo",  # In mun, must be coerced to 'todos'
                addresses=["f1"],
            ),
            _ProposalDraft(
                title="Transporte rural",
                lever="casillas_rurales",
                effect_pp=2.0,
                coverage=70.0,
                targeting="rojo",
                addresses=["f1"],
            ),
        ],
        steps=[
            _StepDraft(order=1, phase="Paso pasado", start="2020-01-01", end="2020-02-01"),  # < today -> clamp
            _StepDraft(order=2, phase="Paso futuro", start=today, end="2035-12-31"),  # > 2027-05-31 -> clamp
            _StepDraft(order=3, phase="Paso intermedio", start=today, end=today),
            _StepDraft(order=4, phase="Paso final", start=today, end="2027-05-31"),
        ],
        risks=[_RiskDraft(risk="Apatía", mitigation="Talleres"), _RiskDraft(risk="Clima", mitigation="Rutas")],
        kpis=["KPI 1", "KPI 2", "KPI 3"],
    )

    monkeypatch.setattr(llm, "chat_json", lambda *a, **kw: mock_draft)

    # Synthetic municipal data
    synthetic_df = pd.DataFrame([{
        "id": "08037",
        "level": "mun",
        "cve_ent": "08",
        "name": "Guachochi",
        "lista_nominal": 50000,
        "pred_abstention": 0.50,
        "pred_participation": 0.50,
        "pred_low": 0.45,
        "pred_high": 0.55,
        "category": "rojo",
        "risk_score": 75.0,
        "last_participation": 0.50,
        "last_year": 2024,
        "trend_pp": -1.5,
        "abstencion_esperada": 25000,
        "pct_18_24": 18.5,
        "pct_rural": 60.0,
        "pct_hli": 45.0,
        "pct_internet": 20.0,
        "pob_18ymas": 45000.0,
    }])
    monkeypatch.setattr(deps, "get_units_df", lambda: synthetic_df)

    # Synthetic research bundle
    from atalaya.intel import campaign
    monkeypatch.setattr(campaign, "research_unit", lambda *a, **kw: ResearchBundle(
        unit_id="08037",
        unit_name="Guachochi",
        level="mun",
        findings=[Finding(id="f1", title="F1", summary="Summ", category="otra", evidence=["s1"])],
        sources=[SourceRef(id="s1", url="https://ine.mx", title="INE", tier="oficial")],
        discarded_sources=0,
        queries=[],
        generated_at=datetime.now(timezone.utc).isoformat(),
    ))

    req = CampaignRequest(unit_id="08037")
    plan = plan_campaign(req)

    # Check deduplicated levers
    levers = [p.lever for p in plan.proposals]
    assert len(levers) == len(set(levers))
    youth_p = next(p for p in plan.proposals if p.lever == "promocion_jovenes")
    assert youth_p.effect_pp == 3.2  # Kept higher effect
    assert youth_p.targeting == "todos"  # Mun targeting coerced to 'todos'
    assert youth_p.addresses == ["f1"]  # f999 removed

    # Check dates clamped
    for st in plan.steps:
        assert st.start >= today
        assert st.end <= "2027-05-31"

    # Check target groups size_estimate
    tg_youth = next(tg for tg in plan.target_groups if "18-24" in tg.name)
    assert tg_youth.size_estimate is not None
    assert tg_youth.size_estimate > 0
    assert "Censo 2020" in tg_youth.size_basis


def test_plan_campaign_deterministic_fallback(monkeypatch, mock_storage):
    """Test full deterministic fallback when LLM is completely disabled or errors out."""
    from atalaya import llm
    monkeypatch.setattr(llm, "is_enabled", lambda: False)

    synthetic_df = pd.DataFrame([{
        "id": "32",
        "level": "state",
        "cve_ent": "32",
        "name": "Zacatecas",
        "lista_nominal": 1200000,
        "pred_abstention": 0.48,
        "pred_participation": 0.52,
        "pred_low": 0.44,
        "pred_high": 0.52,
        "category": "amarillo",
        "risk_score": 48.0,
        "last_participation": 0.52,
        "last_year": 2024,
        "trend_pp": -1.0,
        "abstencion_esperada": 576000,
        "pct_18_24": 18.0,
        "pct_rural": 30.0,
        "pct_hli": 2.0,
        "pct_internet": 65.0,
        "pob_18ymas": 1100000.0,
    }])
    monkeypatch.setattr(deps, "get_units_df", lambda: synthetic_df)

    from atalaya.intel import campaign
    monkeypatch.setattr(campaign, "research_unit", lambda *a, **kw: ResearchBundle(
        unit_id="32",
        unit_name="Zacatecas",
        level="state",
        findings=[],
        sources=[],
        discarded_sources=0,
        queries=[],
        generated_at=datetime.now(timezone.utc).isoformat(),
        degraded=True,
    ))

    req = CampaignRequest(unit_id="32")
    plan = plan_campaign(req)

    assert plan.llm.degraded is True
    assert 2 <= len(plan.proposals) <= 4
    # All levers unique
    levers = [p.lever for p in plan.proposals]
    assert len(levers) == len(set(levers))
    assert 4 <= len(plan.steps) <= 6
    assert 2 <= len(plan.risks) <= 4
    assert 3 <= len(plan.kpis) <= 5
    assert plan.impact.votos_adicionales >= 0


# ---------------------------------------------------------------- tests: compute_impact


def test_compute_impact(monkeypatch):
    """Test compute_impact: positive votes with effect > 0, overlap_votos >= 0, and single proposal overlap == 0."""
    synthetic_df = pd.DataFrame([
        {
            "id": "32001",
            "level": "mun",
            "cve_ent": "32",
            "name": "Apozol",
            "lista_nominal": 10000,
            "pred_abstention": 0.50,
            "pred_participation": 0.50,
            "category": "rojo",
            "risk_score": 80.0,
            "pct_18_24": 0.18,
            "pct_rural": 0.50,
            "pct_hli": 0.05,
            "pct_internet": 0.40,
        },
        {
            "id": "32002",
            "level": "mun",
            "cve_ent": "32",
            "name": "Apulco",
            "lista_nominal": 8000,
            "pred_abstention": 0.45,
            "pred_participation": 0.55,
            "category": "naranja",
            "risk_score": 60.0,
            "pct_18_24": 0.18,
            "pct_rural": 0.40,
            "pct_hli": 0.02,
            "pct_internet": 0.50,
        },
        {
            "id": "32",
            "level": "state",
            "cve_ent": "32",
            "name": "Zacatecas",
            "lista_nominal": 18000,
            "pred_abstention": 0.4778,
            "pred_participation": 0.5222,
            "category": "naranja",
            "risk_score": 68.0,
            "pct_18_24": 0.18,
            "pct_rural": 0.45,
            "pct_hli": 0.03,
            "pct_internet": 0.45,
        },
    ])
    monkeypatch.setattr(deps, "get_units_df", lambda: synthetic_df)

    snap = DataSnapshot(
        unit_id="32001",
        name="Apozol",
        level="mun",
        ent="32",
        ent_name="Zacatecas",
        lista_nominal=10000,
        pred_abstention=0.50,
        pred_low=0.45,
        pred_high=0.55,
        category="rojo",
        risk_score=80.0,
        last_participation=0.50,
        last_year=2024,
        trend_pp=-1.0,
        abstencion_esperada=5000,
    )

    # 1. Single proposal -> overlap_votos must be strictly 0
    p1 = Proposal(
        id="p1",
        title="Jóvenes",
        description="Desc",
        lever="promocion_jovenes",
        target_group="Jóvenes",
        effect_pp=3.0,
        coverage=80.0,
        targeting="todos",
    )
    single_impact = compute_impact(snap, [p1])
    assert single_impact.votos_adicionales >= 0
    assert single_impact.overlap_votos == 0
    assert len(single_impact.per_proposal) == 1
    assert single_impact.municipios_mejoran is None

    # 2. Multiple proposals -> overlap_votos >= 0
    p2 = Proposal(
        id="p2",
        title="Casillas",
        description="Desc",
        lever="casillas_rurales",
        target_group="Rural",
        effect_pp=2.0,
        coverage=70.0,
        targeting="todos",
    )
    multi_impact = compute_impact(snap, [p1, p2])
    assert multi_impact.votos_adicionales >= 0
    assert multi_impact.overlap_votos >= 0
    assert len(multi_impact.per_proposal) == 2


# ---------------------------------------------------------------- tests: report & caching


def test_report_stages_in_order(monkeypatch, mock_storage):
    """Test that plan_campaign invokes report callback in strictly monotonic progression."""
    from atalaya import llm
    monkeypatch.setattr(llm, "is_enabled", lambda: False)

    synthetic_df = pd.DataFrame([{
        "id": "32",
        "level": "state",
        "cve_ent": "32",
        "name": "Zacatecas",
        "lista_nominal": 1000000,
        "pred_abstention": 0.50,
        "pred_participation": 0.50,
        "category": "amarillo",
        "risk_score": 50.0,
        "pob_18ymas": 950000.0,
    }])
    monkeypatch.setattr(deps, "get_units_df", lambda: synthetic_df)

    from atalaya.intel import campaign
    monkeypatch.setattr(campaign, "research_unit", lambda *a, **kw: ResearchBundle(
        unit_id="32",
        unit_name="Zacatecas",
        level="state",
        findings=[],
        sources=[],
        discarded_sources=0,
        queries=[],
        generated_at=datetime.now(timezone.utc).isoformat(),
        degraded=True,
    ))

    captured: list[tuple[str, int]] = []
    def _cb(stage: str, pct: int):
        captured.append((stage, pct))

    plan = plan_campaign(CampaignRequest(unit_id="32"), report=_cb)
    assert plan is not None

    percentages = [pct for _, pct in captured]
    assert percentages == sorted(percentages)
    assert 5 in percentages
    assert 15 in percentages
    assert 55 in percentages
    assert 60 in percentages
    assert 85 in percentages
    assert 90 in percentages
    assert 95 in percentages
    assert 100 in percentages


def test_cached_plan_and_find_plan(mock_storage):
    """Test caching, retrieval, expiration, and corruption handling."""
    plan_data = {
        "id": "testplan1234",
        "unit": {
            "unit_id": "32",
            "name": "Zacatecas",
            "level": "state",
            "ent": "32",
            "ent_name": "Zacatecas",
            "lista_nominal": 1000000,
            "pred_abstention": 0.5,
            "pred_low": 0.45,
            "pred_high": 0.55,
            "category": "amarillo",
            "risk_score": 50.0,
            "last_participation": 0.5,
            "last_year": 2024,
            "trend_pp": 0.0,
            "abstencion_esperada": 500000,
            "drivers": [],
            "recommendations": [],
        },
        "research": {
            "unit_id": "32",
            "unit_name": "Zacatecas",
            "level": "state",
            "findings": [],
            "sources": [],
            "discarded_sources": 0,
            "queries": [],
            "generated_at": datetime.now(timezone.utc).isoformat(),
        },
        "focus": None,
        "objective": "Objetivo de prueba",
        "target_groups": [],
        "proposals": [],
        "impact": {
            "campaigns": [],
            "abstention_base": 0.5,
            "abstention_scenario": 0.48,
            "delta_pp": -2.0,
            "votos_adicionales": 20000,
            "category_before": "amarillo",
            "category_after": "amarillo",
            "per_proposal": [],
            "overlap_votos": 0,
            "assumptions": [],
        },
        "steps": [],
        "risks": [],
        "kpis": [],
        "slides": [],
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "llm": {"model": "test", "effort": "high", "degraded": False},
        "disclaimer": "Disclaimer",
    }

    storage_mod = sys.modules["atalaya.intel.storage"]
    target_path = storage_mod.campaign_result_path("32", None)
    storage_mod.write_json_atomic(target_path, plan_data)

    # 1. cached_plan found
    retrieved = cached_plan("32", None)
    assert retrieved is not None
    assert retrieved.id == "testplan1234"

    # 2. find_plan found
    found = find_plan("testplan1234")
    assert found is not None
    assert found.id == "testplan1234"

    # 3. find_plan not found
    assert find_plan("non-existent-id") is None

    # 4. cached_plan expired with max_age_h
    # Fake mtime in the past
    import os
    past_time = time.time() - 3600 * 100
    os.utime(target_path, (past_time, past_time))
    assert cached_plan("32", None, max_age_h=1.0) is None

    # 5. Corrupted cache
    target_path.write_text("NOT A VALID JSON", encoding="utf-8")
    assert cached_plan("32", None) is None


def test_build_campaign_fallback_queries():
    from atalaya.intel.prompts_campaign import build_campaign_fallback_queries

    snap_mun = DataSnapshot(
        unit_id="08037",
        name="Juárez",
        level="mun",
        ent="08",
        ent_name="Chihuahua",
        lista_nominal=1100000,
        pred_abstention=0.48,
        pred_low=0.44,
        pred_high=0.52,
        category="amarillo",
        risk_score=48.0,
        last_participation=0.52,
        last_year=2024,
        trend_pp=-1.2,
        abstencion_esperada=528000,
    )
    q_mun = build_campaign_fallback_queries(snap_mun, focus="jóvenes universitarios")
    assert any('"Juárez"' in q for q in q_mun)
    assert any("participación electoral" in q for q in q_mun)
    assert any("abstención" in q for q in q_mun)
    assert any("casillas" in q for q in q_mun)
    assert any("votar" in q for q in q_mun)
    assert any("jóvenes universitarios" in q for q in q_mun)

    snap_state = DataSnapshot(
        unit_id="32",
        name="Zacatecas",
        level="state",
        ent="32",
        ent_name="Zacatecas",
        lista_nominal=1200000,
        pred_abstention=0.48,
        pred_low=0.44,
        pred_high=0.52,
        category="amarillo",
        risk_score=48.0,
        last_participation=0.52,
        last_year=2024,
        trend_pp=-1.2,
        abstencion_esperada=576000,
    )
    q_st = build_campaign_fallback_queries(snap_state)
    assert any('"Zacatecas"' in q for q in q_st)
    assert any("participación electoral" in q for q in q_st)
    assert any("abstención" in q for q in q_st)
    assert any("casillas" in q for q in q_st)
    assert any("votar" in q for q in q_st)


def test_research_unit_prioritizes_local_and_caps_national(monkeypatch):
    """Test that research_unit admits at most 1 national finding and prioritizes local ones."""
    from atalaya import gemini, websearch
    from atalaya.explain import verify as explain_verify
    from atalaya.explain.verify import CorpusDoc

    monkeypatch.setattr(gemini, "is_enabled", lambda: True)

    docs = [
        CorpusDoc(
            id="s1",
            url="https://www.ine.mx/nacional-1",
            title="Abstención nacional en elecciones",
            domain="ine.mx",
            outlet="INE",
            published="2024-01-01",
            tier="oficial",
            text="En Zacatecas y a nivel nacional se documento abstencion electoral generalizada en elecciones y casillas de Zacatecas.",
            from_page=True,
        ),
        CorpusDoc(
            id="s2",
            url="https://www.ine.mx/nacional-2",
            title="Desafección en comicios",
            domain="ine.mx",
            outlet="INE",
            published="2024-01-02",
            tier="oficial",
            text="En Zacatecas y el pais hubo desafeccion de votantes y abstencion ciudadana en los comicios electorales de Zacatecas.",
            from_page=True,
        ),
        CorpusDoc(
            id="s3",
            url="https://www.ine.mx/nacional-3",
            title="Desinformación en casillas",
            domain="ine.mx",
            outlet="INE",
            published="2024-01-03",
            tier="oficial",
            text="En Zacatecas se detecto desinformacion en elecciones y casillas electorales en el territorio de Zacatecas.",
            from_page=True,
        ),
        CorpusDoc(
            id="s4",
            url="https://www.eluniversal.com.mx/zacatecas/casillas",
            title="Casillas en la sierra de Zacatecas",
            domain="eluniversal.com.mx",
            outlet="El Universal",
            published="2024-01-04",
            tier="medio_reconocido",
            text="En Zacatecas votantes acuden a casillas en Zacatecas tras largas horas de camino hacia las urnas.",
            from_page=True,
        ),
        CorpusDoc(
            id="s5",
            url="https://www.eluniversal.com.mx/zacatecas/migracion",
            title="Migración en Zacatecas",
            domain="eluniversal.com.mx",
            outlet="El Universal",
            published="2024-01-05",
            tier="medio_reconocido",
            text="En Zacatecas la migracion afecta el padron y la lista nominal de votantes en comunidades de Zacatecas.",
            from_page=True,
        ),
    ]

    monkeypatch.setattr(explain_verify, "fetch_corpus", lambda *a, **kw: list(docs))
    monkeypatch.setattr(websearch, "search_news", lambda *a, **kw: [
        websearch.NewsCandidate(title=d.title, url=d.url, domain=d.domain, outlet=d.outlet, published=d.published, snippet="s", provider="google_news")
        for d in docs
    ])

    raw_gemini_json = {
        "findings": [
            {
                "title": "Causa nacional genérica A",
                "summary": "Abstencionismo general en todo el país sin datos locales.",
                "category": "desconfianza_institucional",
                "scope": "nacional",
                "evidence": ["s1"],
                "quote": "Abstencion electoral generalizada en elecciones y casillas",
            },
            {
                "title": "Causa nacional genérica B",
                "summary": "Otro factor nacional abstracto de votantes en elecciones.",
                "category": "apatia_desafeccion",
                "scope": "nacional",
                "evidence": ["s2"],
                "quote": "Desafeccion de votantes y abstencion ciudadana en los comicios",
            },
            {
                "title": "Causa nacional genérica C",
                "summary": "Tercer factor nacional en elecciones y casillas.",
                "category": "desinformacion",
                "scope": "nacional",
                "evidence": ["s3"],
                "quote": "Desinformacion en elecciones y casillas electorales",
            },
            {
                "title": "Falta de casillas en la sierra de Zacatecas",
                "summary": "En comunidades de Zacatecas el traslado toma horas hacia las urnas.",
                "category": "acceso_casillas_distancia",
                "scope": "estado",
                "evidence": ["s4"],
                "quote": "votantes acuden a casillas en Zacatecas tras largas horas de camino",
            },
            {
                "title": "Migración temporal en municipios zacatecanos",
                "summary": "Alta tasa de migración de retorno afecta listas de casilla en Zacatecas.",
                "category": "migracion_movilidad",
                "scope": "nacional",  # Will be promoted to 'estado' because mentions Zacatecas
                "evidence": ["s5"],
                "quote": "la migracion afecta el padron y la lista nominal de votantes",
            },
        ]
    }

    meta = types.SimpleNamespace(model="gemini-3.6-flash", from_cache=False)
    monkeypatch.setattr(gemini, "generate_json", lambda *a, **kw: (raw_gemini_json, meta))

    snap = DataSnapshot(
        unit_id="32",
        name="Zacatecas",
        level="state",
        ent="32",
        ent_name="Zacatecas",
        lista_nominal=1200000,
        pred_abstention=0.48,
        pred_low=0.44,
        pred_high=0.52,
        category="amarillo",
        risk_score=48.0,
        last_participation=0.52,
        last_year=2024,
        trend_pp=-1.2,
        abstencion_esperada=576000,
    )

    bundle = research_unit(snap)
    assert len(bundle.findings) == 3

    # Count national findings
    national_count = sum(1 for f in bundle.findings if f.scope == "nacional")
    assert national_count <= 1
    # Local findings (estado/municipio) should be >= 2
    local_count = sum(1 for f in bundle.findings if f.scope in ("estado", "municipio"))
    assert local_count >= 2
    assert bundle.search_mode == "respaldo"


def test_research_unit_search_modes(monkeypatch):
    """Test search_mode values in ResearchBundle across grounding, respaldo, and sin_internet."""
    gemini_mod = sys.modules["atalaya.gemini"]
    snap = DataSnapshot(
        unit_id="32",
        name="Zacatecas",
        level="state",
        ent="32",
        ent_name="Zacatecas",
        lista_nominal=1200000,
        pred_abstention=0.48,
        pred_low=0.44,
        pred_high=0.52,
        category="amarillo",
        risk_score=48.0,
        last_participation=0.52,
        last_year=2024,
        trend_pp=-1.2,
        abstencion_esperada=576000,
    )

    # 1. sin_internet when Gemini disabled
    monkeypatch.setattr(gemini_mod, "is_enabled", lambda: False)
    b_disabled = research_unit(snap)
    assert b_disabled.search_mode == "sin_internet"
    assert b_disabled.degraded is True

    # 2. respaldo when mode is rss_url_context (Ruta A)
    monkeypatch.setattr(gemini_mod, "is_enabled", lambda: True)
    monkeypatch.setattr(gemini_mod, "_is_grounding_available", lambda: (True, None))
    res_rss = DummyGroundedResult(
        sources=[DummyGroundedSource(url="https://elpais.com/noticia", title="Nota", domain="elpais.com")],
        mode="rss_url_context",
    )
    raw_json = {
        "findings": [
            {
                "title": "Abstención rural",
                "summary": "Falta de transporte en zonas rurales",
                "category": "acceso_casillas_distancia",
                "sources": [{"url": "https://elpais.com/noticia", "title": "Nota"}],
                "scope": "estado",
                "confidence": "alta",
            }
        ]
    }
    monkeypatch.setattr(gemini_mod, "grounded_json", lambda *a, **kw: (raw_json, res_rss))
    b_rss = research_unit(snap)
    assert b_rss.search_mode == "respaldo"


def test_research_unit_circuit_states(monkeypatch):
    """Test research_unit explicitly under both circuit open (Ruta B) and closed (Ruta A) states."""
    from atalaya import websearch

    gemini_mod = sys.modules["atalaya.gemini"]
    monkeypatch.setattr(gemini_mod, "is_enabled", lambda: True)

    snap = DataSnapshot(
        unit_id="32",
        name="Zacatecas",
        level="state",
        ent="32",
        ent_name="Zacatecas",
        lista_nominal=1200000,
        pred_abstention=0.48,
        pred_low=0.44,
        pred_high=0.52,
        category="amarillo",
        risk_score=48.0,
        last_participation=0.52,
        last_year=2024,
        trend_pp=-1.2,
        abstencion_esperada=576000,
    )

    # State 1: Circuit open (grounding unavailable -> Ruta B)
    monkeypatch.setattr(gemini_mod, "_is_grounding_available", lambda: (False, "2026-11-01T00:00:00"))
    monkeypatch.setattr(websearch, "search_news", lambda *a, **kw: [])
    b_open = research_unit(snap)
    assert b_open.search_mode == "respaldo"

    # State 2: Circuit closed (grounding available -> Ruta A)
    monkeypatch.setattr(gemini_mod, "_is_grounding_available", lambda: (True, None))
    res_grounding = DummyGroundedResult(
        sources=[DummyGroundedSource(url="https://ine.mx/doc", title="INE", domain="ine.mx")],
        mode="grounding",
    )
    raw_json = {
        "findings": [
            {
                "title": "Participación Zacatecas",
                "summary": "Estudio de participación en Zacatecas",
                "category": "desconfianza_institucional",
                "sources": [{"url": "https://ine.mx/doc", "title": "INE"}],
                "scope": "estado",
                "confidence": "alta",
            }
        ]
    }
    monkeypatch.setattr(gemini_mod, "grounded_json", lambda *a, **kw: (raw_json, res_grounding))
    b_closed = research_unit(snap)
    assert b_closed.search_mode == "grounding"


def test_cached_plan_and_find_plan_legacy_search_mode(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Test that cached_plan and find_plan deduce search_mode on legacy cache files missing the field."""
    from atalaya.intel import storage
    monkeypatch.setattr(storage, "intel_dir", lambda: tmp_path / "intel")

    camp_dir = tmp_path / "intel" / "results" / "campaign"
    camp_dir.mkdir(parents=True, exist_ok=True)

    real_path = Path("data/cache/intel/results/campaign/32__da39a3ee.json")
    if real_path.is_file():
        base_plan_dict = json.loads(real_path.read_text(encoding="utf-8"))
    else:
        # Fallback minimal schema
        base_plan_dict = {
            "id": "legacy_plan_32",
            "unit": {
                "unit_id": "32",
                "name": "Zacatecas",
                "level": "state",
                "ent": "32",
                "ent_name": "Zacatecas",
                "lista_nominal": 1265939,
                "pred_abstention": 0.4885,
                "pred_low": 0.35,
                "pred_high": 0.62,
                "category": "verde",
                "risk_score": 34.2,
                "last_participation": 0.56,
                "last_year": 2024,
                "trend_pp": -0.08,
                "abstencion_esperada": 618374,
            },
            "research": {
                "unit_id": "32",
                "unit_name": "Zacatecas",
                "level": "state",
                "findings": [],
                "sources": [],
                "queries": ["Zacatecas INE", "Zacatecas voto"],
                "generated_at": "2026-10-28T20:15:15.193224+00:00",
                "model": "gemini-3.1-flash-lite",
                "degraded": False,
                "note": "Búsqueda de respaldo: noticias indexadas (Google News/Bing) leídas por Gemini; sin búsqueda web completa.",
            },
            "focus": None,
            "objective": "Objetivo de prueba",
            "target_groups": [],
            "proposals": [],
            "impact": {
                "campaigns": [],
                "abstention_base": 0.4885,
                "abstention_scenario": 0.4633,
                "delta_pp": -2.52,
                "votos_adicionales": 31902,
                "category_before": "verde",
                "category_after": "verde",
                "per_proposal": [],
                "overlap_votos": 0,
                "assumptions": [],
            },
            "steps": [],
            "risks": [],
            "kpis": ["KPI 1", "KPI 2", "KPI 3"],
            "slides": [],
            "generated_at": "2026-10-28T20:15:15.193224+00:00",
            "llm": {"model": "glm-5.3", "reasoning_effort": "high", "extra_body_mode": "glm-5.3"},
        }

    # Ensure search_mode is missing from the test dictionary
    if "search_mode" in base_plan_dict.get("research", {}):
        del base_plan_dict["research"]["search_mode"]

    # 1. Plan with "respaldo" in note -> deduces "respaldo"
    base_plan_dict["id"] = "legacy_plan_32"
    base_plan_dict["research"]["note"] = "Búsqueda de respaldo: noticias indexadas"
    base_plan_dict["research"]["degraded"] = False
    file_path = storage.campaign_result_path("32", None)
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text(json.dumps(base_plan_dict, ensure_ascii=False), encoding="utf-8")

    plan = cached_plan("32")
    assert plan is not None
    assert plan.research.search_mode == "respaldo"

    plan_by_id = find_plan("legacy_plan_32")
    assert plan_by_id is not None
    assert plan_by_id.research.search_mode == "respaldo"

    # 2. Plan with degraded=True -> deduces "sin_internet"
    degraded_dict = dict(base_plan_dict)
    degraded_dict["id"] = "degraded_plan_32"
    degraded_dict["research"] = dict(base_plan_dict["research"])
    degraded_dict["research"]["note"] = ""
    degraded_dict["research"]["degraded"] = True
    file_path.write_text(json.dumps(degraded_dict, ensure_ascii=False), encoding="utf-8")

    plan_deg = cached_plan("32")
    assert plan_deg is not None
    assert plan_deg.research.search_mode == "sin_internet"

    # 3. Plan with queries and no respaldo note -> deduces "grounding"
    grounding_dict = dict(base_plan_dict)
    grounding_dict["id"] = "grounding_plan_32"
    grounding_dict["research"] = dict(base_plan_dict["research"])
    grounding_dict["research"]["note"] = "Búsqueda exitosa"
    grounding_dict["research"]["degraded"] = False
    grounding_dict["research"]["queries"] = ["INE Zacatecas"]
    file_path.write_text(json.dumps(grounding_dict, ensure_ascii=False), encoding="utf-8")

    plan_gro = cached_plan("32")
    assert plan_gro is not None
    assert plan_gro.research.search_mode == "grounding"


def test_research_unit_ruta_b_ranking_and_corpus_limit(monkeypatch):
    """Ruta B with 20 candidates downloads at most 12 and sends <= 10 docs to Gemini, ordered by score."""
    from atalaya import gemini, websearch
    from atalaya.explain import verify as explain_verify
    from atalaya.explain.verify import CorpusDoc

    # 20 candidates: 15 local with varying causal scores, 5 national with no zone
    local_candidates = [
        websearch.NewsCandidate(
            title=f"Noticia QR {i} sobre Quintana Roo y casillas",
            url=f"https://eluniversal.com.mx/qr-{i}",
            domain="eluniversal.com.mx",
            outlet="El Universal",
            published=f"2024-06-{i+1:02d}",
            snippet="Reporte con abstención, participación y votantes en casillas" if i == 0 else "Reporte de casillas y voto",
            provider="google_news",
        )
        for i in range(15)
    ]
    national_candidates = [
        websearch.NewsCandidate(
            title=f"Nota nacional genérica {i}",
            url=f"https://reforma.com/nac-{i}",
            domain="reforma.com",
            outlet="Reforma",
            published=f"2024-05-{i+1:02d}",
            snippet="Consejeros debaten conteo rápido y presupuesto nacional",
            provider="google_news",
        )
        for i in range(5)
    ]
    all_20_candidates = national_candidates[:2] + local_candidates + national_candidates[2:]
    assert len(all_20_candidates) == 20

    monkeypatch.setattr(websearch, "search_news", lambda *a, **kw: list(all_20_candidates))

    captured_fetch = {}
    def fake_fetch_corpus(cands, **kw):
        captured_fetch["cands_received"] = list(cands)
        captured_fetch["max_pages"] = kw.get("max_pages")
        # Simulate returning 12 docs (first 8 from_page=True, last 4 from_page=False)
        selected = cands[:kw.get("max_pages", 12)]
        return [
            CorpusDoc(
                id=f"s{idx+1}",
                url=c.url,
                title=c.title,
                domain=c.domain,
                outlet=c.outlet,
                published=c.published,
                tier="medio_reconocido",
                text=f"En Quintana Roo la noticia {c.title} documenta casillas electorales en Quintana Roo.",
                from_page=(idx < 8),
            )
            for idx, c in enumerate(selected)
        ]

    monkeypatch.setattr(explain_verify, "fetch_corpus", fake_fetch_corpus)

    captured_gemini = {}
    def fake_generate_json(prompt, system=None, **kw):
        captured_gemini["prompt"] = prompt
        return {"findings": []}, types.SimpleNamespace(model="gemini-3.6-flash", from_cache=False)

    monkeypatch.setattr(gemini, "generate_json", fake_generate_json)

    captured_prompt_docs = []
    import atalaya.intel.campaign as camp_mod
    original_build_prompt = camp_mod.build_research_prompt_inline
    def spy_build_prompt(snapshot, focus, docs):
        captured_prompt_docs.extend(docs)
        return original_build_prompt(snapshot, focus, docs)

    monkeypatch.setattr(camp_mod, "build_research_prompt_inline", spy_build_prompt)

    snap = DataSnapshot(
        unit_id="23",
        name="Quintana Roo",
        level="state",
        ent="23",
        ent_name="Quintana Roo",
        lista_nominal=1400000,
        pred_abstention=0.55,
        pred_low=0.50,
        pred_high=0.60,
        category="rojo",
        risk_score=60.0,
        last_participation=0.45,
        last_year=2024,
        trend_pp=-2.0,
        abstencion_esperada=770000,
    )

    bundle = research_unit(snap, focus=None, refresh=True)

    # 1. fetch_corpus was called with max_pages=12
    assert captured_fetch["max_pages"] == 12

    # 2. Ranked candidates only contained local candidates (national with score <= 0 discarded)
    assert all("Quintana Roo" in c.title for c in captured_fetch["cands_received"])
    # First candidate is local_candidates[0] which had the highest causal score (10 pts)
    assert captured_fetch["cands_received"][0].title == local_candidates[0].title

    # 3. Gemini received <= 10 docs (exactly 10)
    assert len(captured_prompt_docs) == 10

    # 4. First 8 docs have from_page=True, remaining 2 have from_page=False
    assert all(d.from_page for d in captured_prompt_docs[:8])
    assert all(not d.from_page for d in captured_prompt_docs[8:10])

    # 5. First doc in Gemini prompt is local_candidates[0] (highest score)
    assert captured_prompt_docs[0].title == local_candidates[0].title


