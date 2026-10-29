"""Tests for INE Monitor pipeline (atalaya.intel.monitor).

Runs in-process without network access. All Gemini/LLM interactions and storage paths
are strictly mocked/monkeypatched using temporary paths and realistic fixtures.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sys
import types
from typing import Any

import pandas as pd
import pytest

from atalaya.intel.schemas import (
    ActionType,
    Engagement,
    GeoScope,
    Level,
    MonitorScanRequest,
    MonitorSnapshot,
    NewsImpact,
    NewsItem,
    NewsTopic,
    Platform,
    RegistryEntry,
    Remediation,
    Severity,
    SocialPost,
    SourceRef,
    StateImpact,
    Verdict,
    Virality,
)
from atalaya.intel import monitor
from atalaya.intel.monitor import _GLMItemRemediation, _GLMRemediationResponse


# ---------------------------------------------------------------- Mock classes & module setup


@dataclass
class DummyGroundedSource:
    url: str
    title: str = ""
    domain: str = ""


@dataclass
class DummyGroundedResult:
    text: str = ""
    sources: list[DummyGroundedSource] = None
    queries: list[str] = None
    model: str = "gemini-3.8-flash"
    latency_ms: int = 250
    supports: list[dict] = None
    from_cache: bool = False
    mode: str = "grounding"

    def __post_init__(self):
        if self.sources is None:
            self.sources = []
        if self.queries is None:
            self.queries = []
        if self.supports is None:
            self.supports = []


# Ensure stub modules exist in sys.modules so monitor imports them cleanly
def _ensure_stub_modules():
    for mod_name in ["atalaya.gemini", "atalaya.intel.impact", "atalaya.intel.virality", "atalaya.intel.severity"]:
        if mod_name not in sys.modules:
            try:
                __import__(mod_name)
            except ImportError:
                sys.modules[mod_name] = types.ModuleType(mod_name)


_ensure_stub_modules()


# ---------------------------------------------------------------- Mock contract implementations


def mock_news_impact(
    units: pd.DataFrame,
    *,
    topic: NewsTopic = "otra",
    geo: GeoScope = None,
    intensity: float = 0.5,
    persistence: str = "coyuntural",
    today: Any = None,
    level: Level = "state",
    ent: str | None = None,
) -> NewsImpact:
    unit_id = ent or (geo.ents[0] if geo and geo.ents else "07")
    return NewsImpact(
        level=level,
        ent=ent,
        delta_pp_national=0.25,
        votos_perdidos_total=12500,
        units=[
            StateImpact(
                id=unit_id,
                name="Chiapas" if not ent else "Tuxtla Gutiérrez",
                level=level,
                delta_pp=0.45,
                delta_low_pp=0.22,
                delta_high_pp=0.68,
                votos_perdidos=12500,
                exposure=1.0,
                category_before="amarillo",
                category_after="naranja",
            )
        ],
        max_delta_pp=0.45,
        assumptions=["Impacto estimado en abstención"],
        params={"s_topic": 1.5, "intensity": intensity},
    )


def mock_campaign_prefill_for(impact_obj: NewsImpact, topic: NewsTopic) -> dict:
    return {
        "campaigns": [
            {
                "lever": "campana_general",
                "targeting": "todos",
                "effect_pp": 1.5,
                "coverage": 80.0,
                "ents": [u.id for u in impact_obj.units[:2]],
            }
        ]
    }


def mock_virality(posts: list[SocialPost], *, topic: NewsTopic, today: Any = None) -> Virality:
    platforms = list({p.platform for p in posts})
    return Virality(
        score=65,
        level="alta",
        platforms=platforms,
        posts=posts,
        reach_estimate=5400,
        growth="creciente",
        projected_score_7d=75,
        basis=["Alta difusión en redes"],
        ignore_risk="Riesgo de desinformación electoral",
    )


def mock_severity_true(impact_obj: NewsImpact) -> Severity:
    return Severity(level="alta", score=65, drivers=["Impacto territorial en casillas"])


def mock_severity_fake(v: Virality, topic: NewsTopic, verdict: Verdict) -> Severity:
    return Severity(level="alta", score=60, drivers=["Viralidad en redes sociales"])


def mock_decide_action(verdict: Verdict, sev: Severity, *, has_posts: bool) -> tuple[ActionType, list[ActionType], int]:
    if verdict == "verdadera":
        return ("campana_intervencion", ["comunicado"], 48)
    if verdict == "falsa":
        return ("desmentido_oficial", ["reportar_plataforma", "responder_corregir"], 12)
    if verdict == "enganosa":
        return ("responder_corregir", [], 24)
    return ("registrar", [], 168)


def mock_template_remediation(item: dict, action: ActionType, sev: Severity) -> Remediation:
    return Remediation(
        action=action,
        secondary_actions=[],
        measures=["Monitorear evolución del tema en medios y redes."],
        rationale="Medidas generadas por plantilla determinista institucional.",
        draft_message="El INE informa que continúa con los preparativos electorales conforme a la ley.",
        deadline_hours=72,
        degraded=True,
    )


# ---------------------------------------------------------------- Pytest Fixtures


@pytest.fixture(autouse=True)
def setup_environment(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Isolate storage and registry directories and hook stub modules."""
    _ensure_stub_modules()

    # Isolate storage directories
    tmp_intel = tmp_path / "intel"
    tmp_intel.mkdir(parents=True, exist_ok=True)

    from atalaya.intel import storage
    monkeypatch.setattr(storage, "intel_dir", lambda: tmp_intel)
    monkeypatch.setattr(storage, "monitor_result_path", lambda: tmp_intel / "results" / "monitor" / "latest.json")

    from atalaya.intel import registry
    monkeypatch.setattr(registry, "_registry_path", lambda: tmp_intel / "registry.jsonl")

    # Wire default mocks for W1-D deterministic models
    impact_mod = sys.modules["atalaya.intel.impact"]
    virality_mod = sys.modules["atalaya.intel.virality"]
    severity_mod = sys.modules["atalaya.intel.severity"]

    monkeypatch.setattr(impact_mod, "news_impact", mock_news_impact, raising=False)
    monkeypatch.setattr(impact_mod, "campaign_prefill_for", mock_campaign_prefill_for, raising=False)
    monkeypatch.setattr(virality_mod, "virality", mock_virality, raising=False)
    monkeypatch.setattr(severity_mod, "severity_true", mock_severity_true, raising=False)
    monkeypatch.setattr(severity_mod, "severity_fake", mock_severity_fake, raising=False)
    monkeypatch.setattr(severity_mod, "decide_action", mock_decide_action, raising=False)
    monkeypatch.setattr(severity_mod, "template_remediation", mock_template_remediation, raising=False)

    # Wire default mocks for LLM
    from atalaya import llm
    monkeypatch.setattr(llm, "is_enabled", lambda: True)

    # Wire default mocks for Gemini
    gemini_mod = sys.modules["atalaya.gemini"]
    monkeypatch.setattr(gemini_mod, "is_enabled", lambda: True, raising=False)
    monkeypatch.setattr(gemini_mod, "resolve_source_url", lambda u, **kw: u, raising=False)
    monkeypatch.setattr(gemini_mod, "domain_of", lambda u: u.split("/")[2].replace("www.", ""), raising=False)

    # Mock units_df in deps
    from atalaya.api import deps
    dummy_units = pd.DataFrame([
        {"id": "07", "name": "Chiapas", "level": "state", "cve_ent": "07", "ln": 3800000},
        {"id": "07101", "name": "Tuxtla Gutiérrez", "level": "mun", "cve_ent": "07", "ln": 450000},
    ])
    monkeypatch.setattr(deps, "get_units_df", lambda: dummy_units)


# ---------------------------------------------------------------- Test cases


def test_full_scan_pipeline_rules(monkeypatch: pytest.MonkeyPatch):
    """Test full scan with 3 mock stages covering deduplication, degradation, stability, and rules."""
    from atalaya.intel import monitor
    gemini_mod = sys.modules["atalaya.gemini"]

    # Stage 1: Recognized media response (includes 1 valid recognized news and 1 unrecognized news domain)
    news_payload = {
        "items": [
            {
                "headline": "INE reporta retrasos de instalación en casillas de Chiapas",
                "summary": "Reportan retraso de funcionarios en casillas de Tuxtla Gutiérrez Chiapas.",
                "claim": "El INE canceló casillas de votación en Chiapas",
                "published": "2026-10-20",
                "sources": [
                    {"url": "https://www.eluniversal.com.mx/elecciones/retrasos-chiapas", "title": "Retrasos Chiapas"}
                ],
                "topic": "organizacion_casillas",
                "geo": {"level": "estatal", "ents": ["Chiapas"], "muns": ["Tuxtla Gutiérrez"]},
                "intensity": 0.8,
                "persistence": "persistente",
            },
            {
                "headline": "Blog anónimo afirma que se robaron boletas",
                "summary": "Publicación en blog no verificado.",
                "claim": "Robo masivo de boletas en almacén electoral",
                "published": "2026-10-21",
                "sources": [
                    {"url": "https://sitio-desconocido-fake.xyz/nota1", "title": "Robo masivo"}
                ],
                "topic": "resultados_fraude",
                "geo": {"level": "nacional"},
                "intensity": 0.4,
            },
        ]
    }

    # Stage 2: Social media & rumors response (includes duplicate of claim 1 with Jaccard > 0.6, and a viral rumor)
    rumors_payload = {
        "items": [
            {
                "headline": "Rumor en X sobre cancelación de casillas",
                "summary": "Usuarios en X aseguran que cancelaron casillas en Chiapas.",
                "claim": "El INE canceló casillas de votación en Chiapas para la elección",  # Jaccard overlap > 0.6 with claim 1
                "topic": "organizacion_casillas",
                "geo": {"level": "estatal", "ents": ["07"]},
                "posts": [
                    {
                        "platform": "x",
                        "url": "https://x.com/elector_alerta/status/123456",
                        "author": "@elector_alerta",
                        "published": "2026-10-21T10:00:00",
                        "engagement": {"likes": 200, "shares": 50, "comments": 30, "views": 1500},
                        "excerpt": "Están cancelando casillas en Chiapas!",
                    }
                ],
            },
            {
                "headline": "Afirman que los marcadores de boleta se borran con calor",
                "summary": "Video viral en TikTok afirma que la tinta se borra.",
                "claim": "Los marcadores de boletas del INE se borran con encendedor",
                "topic": "procedimiento_votacion",
                "geo": {"level": "nacional"},
                "posts": [
                    {
                        "platform": "tiktok",
                        "url": "https://www.tiktok.com/@voto_mexico/video/987654321",
                        "author": "@voto_mexico",
                        "published": "2026-10-22T14:30:00",
                        "engagement": {"likes": 5000, "shares": 1200, "comments": 800, "views": 45000},
                        "excerpt": "Cuidado con los lápices del INE, la tinta se borra con calor",
                    }
                ],
            },
        ]
    }

    # Wire mock Gemini calls
    def mock_grounded_json(prompt, system=None, **kwargs):
        if "noticias en medios" in prompt or ("Ventana de análisis" in prompt and "medios de comunicación" in prompt):
            res = DummyGroundedResult(
                sources=[
                    DummyGroundedSource("https://www.eluniversal.com.mx/elecciones/retrasos-chiapas", "Retrasos", "eluniversal.com.mx"),
                    DummyGroundedSource("https://sitio-desconocido-fake.xyz/nota1", "Robo", "sitio-desconocido-fake.xyz"),
                ],
                queries=["noticias INE casillas Chiapas"],
            )
            return news_payload, res

        elif "publicaciones virales" in prompt:
            res = DummyGroundedResult(
                sources=[
                    DummyGroundedSource("https://x.com/elector_alerta/status/123456", "Post", "x.com"),
                    DummyGroundedSource("https://www.tiktok.com/@voto_mexico/video/987654321", "Video", "tiktok.com"),
                ],
                queries=["rumores INE boletas"],
            )
            return rumors_payload, res

        elif "Verifica las siguientes afirmaciones" in prompt:
            res = DummyGroundedResult(
                sources=[
                    DummyGroundedSource("https://centralelectoral.ine.mx/boletin-123", "Boletin", "centralelectoral.ine.mx"),
                    DummyGroundedSource("https://verificado.com.mx/tinta-boletas-ine-indeleble", "Factcheck", "verificado.com.mx"),
                ],
                queries=["INE desmiente tinta boletas"],
            )
            return {
                "verifications": [
                    {
                        "id": monitor.item_id_for_claim("El INE canceló casillas de votación en Chiapas"),
                        "verdict": "verdadera",
                        "confidence": "alta",
                        "rationale": "El INE emitió boletín confirmando ajuste en 5 casillas.",
                        "fact_checks": [
                            {"url": "https://centralelectoral.ine.mx/boletin-123", "title": "Aclaración casillas Chiapas"}
                        ],
                    },
                    {
                        "id": monitor.item_id_for_claim("Los marcadores de boletas del INE se borran con encendedor"),
                        "verdict": "falsa",
                        "confidence": "alta",
                        "rationale": "Verificado.mx y el INE comprobaron que la tinta es indeleble y resistente al calor.",
                        "fact_checks": [
                            {"url": "https://verificado.com.mx/tinta-boletas-ine-indeleble", "title": "Tinta es indeleble"}
                        ],
                    },
                    {
                        "id": monitor.item_id_for_claim("Robo masivo de boletas en almacén electoral"),
                        "verdict": "sin_verificar",
                        "confidence": "baja",
                        "rationale": "Sin pronunciamientos ni notas de verificación encontradas.",
                        "fact_checks": [],
                    },
                ]
            }, res

        return {}, DummyGroundedResult()

    monkeypatch.setattr(gemini_mod, "grounded_json", mock_grounded_json)

    # Wire mock GLM chat_json with draft message length tests
    from atalaya import llm

    def mock_chat_json(messages, schema, **kwargs):
        return _GLMRemediationResponse(
            items=[
                _GLMItemRemediation(
                    id=monitor.item_id_for_claim("El INE canceló casillas de votación en Chiapas"),
                    measures=["Coordinar con Junta Local de Chiapas", "Emitir boletín informativo a medios"],
                    rationale="Atención operativa inmediata en el estado.",
                    draft_message="El INE informa que las casillas en Chiapas han sido reubicadas conforme al protocolo oficial de la Junta Local.",
                ),
                _GLMItemRemediation(
                    id=monitor.item_id_for_claim("Los marcadores de boletas del INE se borran con encendedor"),
                    measures=["Publicar video demostrativo de tinta indeleble", "Reportar publicaciones fraudulentas"],
                    rationale="Desmentido técnico inmediato para evitar desconfianza en el sufragio.",
                    draft_message=(
                        "FALSO: La tinta de los marcadores del INE no se borra con calor ni solventes. "
                        "El Instituto utiliza tinta indeleble certificada por el IPN y la UAM. "
                        "Consulta toda la información verificada en centralelectoral.ine.mx "
                        "y evita compartir contenido no comprobado sobre el proceso electoral mexicano."
                    ),
                ),
            ]
        )

    monkeypatch.setattr(llm, "chat_json", mock_chat_json)

    # Run scan
    stages_reported = []

    def report_progress(stage, pct):
        stages_reported.append((stage, pct))

    req = MonitorScanRequest(window_days=14, refresh=True)
    snapshot = monitor.run_scan(req, report=report_progress)

    # 1. Deduplication check: claim 1 from news and rumor should be merged into 1 item
    items_claims = [it.claim for it in snapshot.items]
    assert len(snapshot.items) == 3  # (1: Chiapas, 2: Blog anónimo, 3: Marcadores)

    chiapas_item = next(it for it in snapshot.items if "Chiapas" in it.claim)
    assert len(chiapas_item.sources) >= 1
    assert chiapas_item.virality is not None
    assert len(chiapas_item.virality.posts) >= 1  # Merged post from rumors
    assert chiapas_item.verdict == "verdadera"
    assert chiapas_item.impact is not None  # True news has impact
    assert chiapas_item.remediation.action == "campana_intervencion"
    assert chiapas_item.remediation.campaign_prefill is not None

    # 2. Degradation check: blog anónimo with unrecognized domain must be degraded to rumor
    fake_blog_item = next(it for it in snapshot.items if "Robo masivo" in it.claim)
    assert fake_blog_item.kind == "rumor"  # Degraded from noticia to rumor
    assert fake_blog_item.verdict == "sin_verificar"  # Unverified rumor

    # 3. Geo by name/alias check
    assert "07" in chiapas_item.geo.ents
    assert chiapas_item.geo.level in ("estatal", "municipal")

    # 4. Social post platform and engagement check
    marker_item = next(it for it in snapshot.items if "marcadores" in it.claim)
    assert marker_item.virality is not None  # Virality computed for items with posts
    assert marker_item.virality.posts[0].platform == "tiktok"
    assert marker_item.virality.posts[0].engagement.likes == 5000
    assert marker_item.impact is None  # False news does not have electoral impact

    # 5. ID stability between two scans
    second_id = monitor.item_id_for_claim("El INE canceló casillas de votación en Chiapas")
    assert chiapas_item.id == second_id

    # 6. Stages progress checking
    assert any("Buscando noticias en medios reconocidos" in s[0] for s in stages_reported)
    assert any("Buscando publicaciones virales en redes" in s[0] for s in stages_reported)
    assert any("Verificando afirmaciones" in s[0] for s in stages_reported)
    assert any("Redactando medidas con GLM-5.3" in s[0] for s in stages_reported)
    assert stages_reported[-1] == ("Listo", 100)


def test_glm_partial_and_down_fallback(monkeypatch: pytest.MonkeyPatch):
    """Test partial GLM response (missing ids fallback to template) and total failure."""
    from atalaya.intel import monitor
    gemini_mod = sys.modules["atalaya.gemini"]
    from atalaya import llm

    # Setup 1 item in scan
    news_payload = {
        "items": [
            {
                "headline": "Ajuste presupuestal en casillas",
                "summary": "INE revisa presupuesto de casillas.",
                "claim": "Ajuste al presupuesto electoral",
                "sources": [{"url": "https://www.reforma.com/ajuste-presupuesto", "title": "Reforma"}],
                "topic": "presupuesto_recortes",
                "intensity": 0.5,
            }
        ]
    }

    def mock_grounded_json(prompt, **kwargs):
        if "noticias en medios" in prompt:
            return news_payload, DummyGroundedResult(sources=[DummyGroundedSource("https://www.reforma.com/ajuste-presupuesto", "R", "reforma.com")])
        elif "Verifica" in prompt:
            return {"verifications": [{"id": monitor.item_id_for_claim("Ajuste al presupuesto electoral"), "verdict": "verdadera", "confidence": "media", "rationale": "Oficial", "fact_checks": []}]}, DummyGroundedResult()
        return {"items": []}, DummyGroundedResult()

    monkeypatch.setattr(gemini_mod, "grounded_json", mock_grounded_json)

    # 1. Partial GLM response (empty items list in GLM response)
    monkeypatch.setattr(llm, "chat_json", lambda *a, **kw: _GLMRemediationResponse(items=[]))
    req = MonitorScanRequest(window_days=7, refresh=True)
    snap = monitor.run_scan(req)

    assert len(snap.items) == 1
    assert snap.items[0].remediation.degraded is True
    assert "Monitorear" in snap.items[0].remediation.measures[0]

    # 2. Total failure of GLM (raises exception)
    def _raise_llm_error(*a, **kw):
        raise RuntimeError("GLM timeout")

    monkeypatch.setattr(llm, "chat_json", _raise_llm_error)
    snap2 = monitor.run_scan(req)
    assert len(snap2.items) == 1
    assert snap2.items[0].remediation.degraded is True


def test_gemini_down_and_partial_stage_failure(monkeypatch: pytest.MonkeyPatch):
    """Test behavior when Gemini is disabled or when a single stage fails."""
    from atalaya.intel import monitor
    gemini_mod = sys.modules["atalaya.gemini"]

    # 1. Gemini totally disabled
    monkeypatch.setattr(gemini_mod, "is_enabled", lambda: False)
    req = MonitorScanRequest(window_days=14, refresh=True)
    snap = monitor.run_scan(req)

    assert snap.degraded is True
    assert len(snap.items) == 0
    assert "no está habilitado" in snap.note

    # 2. Gemini enabled, but stage 1 throws while stage 2 succeeds
    monkeypatch.setattr(gemini_mod, "is_enabled", lambda: True)

    def mock_failing_stage1(prompt, **kwargs):
        if "noticias en medios" in prompt:
            raise RuntimeError("API quota exhausted on news search")
        elif "publicaciones virales" in prompt:
            return {
                "items": [
                    {
                        "headline": "Rumor viral de fraude",
                        "summary": "Rumor en telegram.",
                        "claim": "Rumor de algoritmo en PREP",
                        "topic": "resultados_fraude",
                        "posts": [{"platform": "telegram", "url": "https://t.me/elecciones/1", "excerpt": "Algoritmo"}],
                    }
                ]
            }, DummyGroundedResult(sources=[DummyGroundedSource("https://t.me/elecciones/1", "T", "t.me")])
        return {"verifications": []}, DummyGroundedResult()

    monkeypatch.setattr(gemini_mod, "grounded_json", mock_failing_stage1)
    snap2 = monitor.run_scan(req)

    assert snap2.degraded is True
    assert "Escaneo parcial" in snap2.note
    assert len(snap2.items) == 1
    assert snap2.items[0].claim == "Rumor de algoritmo en PREP"


def test_latest_snapshot_registry_masking():
    """Test registry merging and public note blanking in latest_snapshot."""
    from atalaya.intel import monitor, storage, registry

    item_id = "test_item_123"
    fake_item = NewsItem(
        id=item_id,
        kind="noticia",
        headline="Noticia de prueba",
        summary="Resumen",
        claim="Afirmación de prueba",
        first_seen=datetime.now(timezone.utc).isoformat(),
        severity=Severity(level="media", score=40),
        remediation=Remediation(action="comunicado"),
    )
    fake_snap = MonitorSnapshot(
        generated_at=datetime.now(timezone.utc).isoformat(),
        window_days=14,
        items=[fake_item],
        counts={"pendientes": 1},
    )
    storage.write_json_atomic(storage.monitor_result_path(), fake_snap.model_dump())

    # Initial check: pending = 1, no status
    s1 = monitor.latest_snapshot(public=True)
    assert s1.counts["pendientes"] == 1
    assert s1.items[0].status is None

    # Operator logs a decision with confidential note
    reg_entry = RegistryEntry(
        item_id=item_id,
        status="comunicado_emitido",
        note="Nota interna confidencial del operador.",
    )
    registry.append(reg_entry)

    # Public read: note stripped
    s_public = monitor.latest_snapshot(public=True)
    assert s_public.counts["pendientes"] == 0
    assert s_public.items[0].status is not None
    assert s_public.items[0].status.status == "comunicado_emitido"
    assert s_public.items[0].status.note == ""

    # Private read (operator): note preserved
    s_private = monitor.latest_snapshot(public=False)
    assert s_private.items[0].status.note == "Nota interna confidencial del operador."


def test_item_impact_and_cooldown():
    """Test item_impact recalculation and cooldown calculation."""
    from atalaya.intel import monitor, storage

    item_id = "test_impact_77"
    fake_item = NewsItem(
        id=item_id,
        kind="noticia",
        headline="Afectación en Chiapas",
        summary="Resumen",
        claim="Afectación",
        first_seen=datetime.now(timezone.utc).isoformat(),
        geo=GeoScope(level="estatal", ents=["07"]),
        verdict="verdadera",
        severity=Severity(level="media", score=45),
        remediation=Remediation(action="comunicado"),
    )

    gen_time = datetime.now(timezone.utc) - timedelta(minutes=5)
    fake_snap = MonitorSnapshot(
        generated_at=gen_time.isoformat(),
        window_days=14,
        items=[fake_item],
    )
    storage.write_json_atomic(storage.monitor_result_path(), fake_snap.model_dump())

    # State impact recalculation
    impact_state = monitor.item_impact(item_id, level="state")
    assert impact_state.level == "state"
    assert impact_state.delta_pp_national > 0

    # Mun impact recalculation
    impact_mun = monitor.item_impact(item_id, level="mun", ent="07")
    assert impact_mun.level == "mun"
    assert impact_mun.ent == "07"

    # Missing ent on municipal level raises ValueError
    with pytest.raises(ValueError, match="parámetro 'ent'"):
        monitor.item_impact(item_id, level="mun")

    # Nonexistent item raises KeyError
    with pytest.raises(KeyError):
        monitor.item_impact("inexistente")

    # Cooldown remaining (15 min cooldown - 5 min elapsed ≈ 600 s)
    rem_s = monitor.cooldown_remaining_s()
    assert 500 <= rem_s <= 700

    # Old snapshot has 0 cooldown
    old_snap = MonitorSnapshot(
        generated_at=(datetime.now(timezone.utc) - timedelta(minutes=30)).isoformat(),
        window_days=14,
        items=[],
    )
    storage.write_json_atomic(storage.monitor_result_path(), old_snap.model_dump())
    assert monitor.cooldown_remaining_s() == 0


def test_history_retention_max_20():
    """Test that at most 20 historical scan snapshots are retained."""
    from atalaya.intel import monitor, storage

    history_dir = storage.intel_dir() / "results" / "monitor"
    history_dir.mkdir(parents=True, exist_ok=True)

    base_time = datetime(2026, 10, 1, 12, 0, 0, tzinfo=timezone.utc)
    for i in range(25):
        scan_time = base_time + timedelta(hours=i)
        snap = MonitorSnapshot(
            generated_at=scan_time.isoformat(),
            window_days=14,
            items=[],
        )
        monitor._persist_snapshot(snap, scan_time)

    history_files = [p for p in history_dir.glob("*.json") if p.name != "latest.json"]
    assert len(history_files) == 20


def test_message_length_trimmings(monkeypatch: pytest.MonkeyPatch):
    """Test that replies are trimmed to <= 280 chars at word boundaries and comunicados to <= 180 words."""
    from atalaya.intel import monitor
    gemini_mod = sys.modules["atalaya.gemini"]
    from atalaya import llm

    # Setup 2 items: 1 reply and 1 comunicado
    news_payload = {
        "items": [
            {
                "headline": "Aviso oficial",
                "summary": "Resumen",
                "claim": "Claim de comunicado largo",
                "sources": [{"url": "https://www.eluniversal.com.mx/noticia-comunicado", "title": "Nota"}],
                "topic": "confianza_institucional",
            }
        ]
    }
    rumors_payload = {
        "items": [
            {
                "headline": "Rumor para responder",
                "summary": "Resumen rumor",
                "claim": "Claim de respuesta larga",
                "topic": "seguridad_violencia",
                "posts": [{"platform": "x", "url": "https://x.com/post/1", "excerpt": "Texto"}],
            }
        ]
    }

    def mock_grounded(prompt, **kwargs):
        if "noticias en medios" in prompt:
            return news_payload, DummyGroundedResult(sources=[DummyGroundedSource("https://www.eluniversal.com.mx/noticia-comunicado", "T", "eluniversal.com.mx")])
        elif "publicaciones virales" in prompt:
            return rumors_payload, DummyGroundedResult(sources=[DummyGroundedSource("https://x.com/post/1", "T", "x.com")])
        elif "Verifica" in prompt:
            return {
                "verifications": [
                    {
                        "id": monitor.item_id_for_claim("Claim de comunicado largo"),
                        "verdict": "verdadera",
                        "confidence": "alta",
                        "rationale": "Confirmado",
                        "fact_checks": [{"url": "https://centralelectoral.ine.mx/doc", "title": "Doc"}],
                    },
                    {
                        "id": monitor.item_id_for_claim("Claim de respuesta larga"),
                        "verdict": "enganosa",
                        "confidence": "alta",
                        "rationale": "Enganosa",
                        "fact_checks": [{"url": "https://verificado.com.mx/aclaracion", "title": "Verificado"}],
                    },
                ]
            }, DummyGroundedResult(
                sources=[
                    DummyGroundedSource("https://centralelectoral.ine.mx/doc", "Doc", "centralelectoral.ine.mx"),
                    DummyGroundedSource("https://verificado.com.mx/aclaracion", "Verificado", "verificado.com.mx"),
                ]
            )
        return {}, DummyGroundedResult()

    monkeypatch.setattr(gemini_mod, "grounded_json", mock_grounded)

    # GLM provides an overly long comunicado (> 180 words) and an overly long reply (> 280 chars)
    long_comunicado = " ".join(["palabra"] * 250)
    long_reply = "Texto de respuesta institucional que busca explicar los procedimientos electorales con suficiente detalle para que la ciudadanía comprenda los mecanismos de verificación " * 3

    def mock_chat_json(messages, schema, **kwargs):
        return _GLMRemediationResponse(
            items=[
                _GLMItemRemediation(
                    id=monitor.item_id_for_claim("Claim de comunicado largo"),
                    measures=["Medida 1"],
                    rationale="Justificacion",
                    draft_message=long_comunicado,
                ),
                _GLMItemRemediation(
                    id=monitor.item_id_for_claim("Claim de respuesta larga"),
                    measures=["Medida 1"],
                    rationale="Justificacion",
                    draft_message=long_reply,
                ),
            ]
        )

    # Mock decide_action to assign "comunicado" and "responder_corregir"
    severity_mod = sys.modules["atalaya.intel.severity"]
    def mock_decide_custom(verdict, sev, **kwargs):
        if verdict == "verdadera":
            return ("comunicado", [], 48)
        return ("responder_corregir", [], 24)

    monkeypatch.setattr(severity_mod, "decide_action", mock_decide_custom)
    monkeypatch.setattr(llm, "chat_json", mock_chat_json)

    req = MonitorScanRequest(window_days=14, refresh=True)
    snap = monitor.run_scan(req)

    comunicado_item = next(it for it in snap.items if "comunicado" in it.claim)
    assert len(comunicado_item.remediation.draft_message.split()) <= 180

    reply_item = next(it for it in snap.items if "respuesta" in it.claim)
    assert len(reply_item.remediation.draft_message) <= 280
    assert not reply_item.remediation.draft_message.endswith(" ")


def test_monitor_run_scan_fallback_queries_and_rss_mode(monkeypatch):
    """Verify fallback_queries passed to all 3 stages, mode tracking per stage, and snapshot note."""
    from atalaya.intel import monitor, prompts_monitor

    gemini_mod = sys.modules["atalaya.gemini"]
    monkeypatch.setattr(gemini_mod, "is_enabled", lambda: True)

    captured_stages: dict[str, dict[str, Any]] = {}

    def mock_grounded_json(prompt, system=None, **kwargs):
        cache_key = kwargs.get("cache_key", "")
        if "noticias" in cache_key:
            captured_stages["stage1"] = kwargs
            data = {
                "items": [
                    {
                        "headline": "Ajuste presupuestal en casillas",
                        "summary": "Se analizan ajustes presupuestales operativos.",
                        "claim": "El INE ajusta presupuesto en instalación de casillas",
                        "published": "2026-10-25",
                        "sources": [{"url": "https://www.eluniversal.com.mx/nota1", "title": "Nota 1"}],
                        "topic": "presupuesto_recortes",
                        "geo": {"level": "nacional"},
                        "intensity": 0.5,
                        "persistence": "coyuntural",
                    }
                ]
            }
            res = DummyGroundedResult(
                sources=[DummyGroundedSource(url="https://www.eluniversal.com.mx/nota1", title="Nota 1", domain="eluniversal.com.mx")],
                queries=["INE presupuesto"],
                mode="rss_url_context",
            )
            return data, res
        elif "rumores" in cache_key:
            captured_stages["stage2"] = kwargs
            data = {
                "items": [
                    {
                        "headline": "Afirman que boletas vienen marcadas",
                        "summary": "Circula rumor sobre marcas previas en boletas.",
                        "claim": "Las boletas electorales tienen marcas previas",
                        "topic": "procedimiento_votacion",
                        "geo": {"level": "nacional"},
                        "posts": [
                            {
                                "platform": "x",
                                "url": "https://x.com/post_viral/1",
                                "author": "@usuario1",
                                "published": "2026-10-26T12:00:00",
                                "engagement": {"likes": 50, "shares": None, "comments": None, "views": None},
                                "excerpt": "Cuidado con las boletas",
                            },
                            {
                                "platform": "tiktok",
                                "url": "",  # Empty URL -> must be ignored in posts
                                "author": "@anon",
                            },
                        ],
                    }
                ]
            }
            res = DummyGroundedResult(
                sources=[DummyGroundedSource(url="https://verificado.com.mx/desmentido-boletas", title="Verificado", domain="verificado.com.mx")],
                queries=["INE falso"],
                mode="rss_url_context",
            )
            return data, res
        elif "verificacion" in cache_key:
            captured_stages["stage3"] = kwargs
            data = {
                "verifications": [
                    {
                        "id": monitor.item_id_for_claim("Las boletas electorales tienen marcas previas"),
                        "verdict": "falsa",
                        "confidence": "alta",
                        "rationale": "El INE desmintió formalmente marcas en boletas con folio de seguridad.",
                        "fact_checks": [
                            {"url": "https://verificado.com.mx/desmentido-boletas", "title": "Verificado MX: Falso rumor de boletas"}
                        ],
                    }
                ]
            }
            res = DummyGroundedResult(
                sources=[DummyGroundedSource(url="https://verificado.com.mx/desmentido-boletas", title="Verificado", domain="verificado.com.mx")],
                queries=["boletas verificación"],
                mode="rss_url_context",
            )
            return data, res
        return {}, DummyGroundedResult()

    monkeypatch.setattr(gemini_mod, "grounded_json", mock_grounded_json)

    req = MonitorScanRequest(window_days=14, refresh=True)
    snap = monitor.run_scan(req)

    # 1. Verify stage 1 queries & days
    assert "stage1" in captured_stages
    assert captured_stages["stage1"].get("fallback_days") == 14
    assert captured_stages["stage1"].get("fallback_queries") == prompts_monitor.STAGE1_FALLBACK_QUERIES

    # 2. Verify stage 2 queries & days
    assert "stage2" in captured_stages
    assert captured_stages["stage2"].get("fallback_days") == 14
    assert captured_stages["stage2"].get("fallback_queries") == prompts_monitor.STAGE2_FALLBACK_QUERIES

    # 3. Verify stage 3 queries & days
    assert "stage3" in captured_stages
    assert captured_stages["stage3"].get("fallback_days") == 14
    st3_q = captured_stages["stage3"].get("fallback_queries", [])
    assert any("verificación" in q for q in st3_q)

    # 4. Verify snapshot note documents RSS fallback and per-stage modes
    assert snap.note is not None
    assert "Búsqueda de respaldo activa: noticias indexadas" in snap.note
    assert "noticias=rss_url_context" in snap.note
    assert "rumores=rss_url_context" in snap.note
    assert "verificación=rss_url_context" in snap.note

    # 5. Verify posts filtering: only post with valid URL is kept
    rumor_item = next(it for it in snap.items if "marcas" in it.claim)
    assert rumor_item.virality is not None
    assert len(rumor_item.virality.posts) == 1
    assert rumor_item.virality.posts[0].url == "https://x.com/post_viral/1"
    assert rumor_item.virality.posts[0].engagement.likes == 50
    assert rumor_item.virality.posts[0].engagement.shares is None


def test_monitor_discard_unbacked_items(monkeypatch, tmp_path):
    """Test that items without retained sources and without platform posts are discarded."""
    from atalaya.intel import storage
    monkeypatch.setattr(storage, "intel_dir", lambda: tmp_path / "intel")
    gemini_mod = sys.modules["atalaya.gemini"]
    monkeypatch.setattr(gemini_mod, "is_enabled", lambda: True)

    def mock_grounded_json(prompt, *, system=None, cache_key=None, **kwargs):
        if "noticias" in cache_key:
            data = {
                "items": [
                    {
                        "headline": "Afirmación sin respaldo documental",
                        "summary": "Rumor sin fuentes ni posts.",
                        "claim": "Presuntos vínculos del INE sin ninguna fuente",
                        "topic": "confianza_institucional",
                        "geo": {"level": "nacional"},
                        "sources": [],
                        "posts": [],
                    },
                    {
                        "headline": "INE aprueba presupuesto",
                        "summary": "Consejo General aprueba anteproyecto.",
                        "claim": "El Consejo General del INE aprueba presupuesto",
                        "topic": "presupuesto_recortes",
                        "geo": {"level": "nacional"},
                        "sources": [
                            {"url": "https://www.eluniversal.com.mx/nacion/presupuesto", "title": "Nota El Universal"}
                        ],
                    },
                ]
            }
            res = DummyGroundedResult(
                sources=[DummyGroundedSource(url="https://www.eluniversal.com.mx/nacion/presupuesto", domain="eluniversal.com.mx")],
                queries=["INE presupuesto"],
                mode="rss_url_context",
            )
            return data, res
        elif "rumores" in cache_key:
            return {"items": []}, DummyGroundedResult()
        elif "verificacion" in cache_key:
            return {"verifications": []}, DummyGroundedResult()
        return {}, DummyGroundedResult()

    monkeypatch.setattr(gemini_mod, "grounded_json", mock_grounded_json)

    req = MonitorScanRequest(window_days=14, refresh=True)
    snap = monitor.run_scan(req)

    # The unsupported item must be discarded
    assert len(snap.items) == 1
    assert "presupuesto" in snap.items[0].headline.lower()
    # Note must record the discarded count
    assert snap.note is not None
    assert "1 afirmaciones descartadas por no tener fuente verificable" in snap.note


def test_monitor_rss_verdict_rules_and_accusation(monkeypatch, tmp_path):
    """Test that news with >= 2 verifiable media becomes 'verdadera' and accusation maintains verdadera with note."""
    from atalaya.intel import storage
    monkeypatch.setattr(storage, "intel_dir", lambda: tmp_path / "intel")
    gemini_mod = sys.modules["atalaya.gemini"]
    monkeypatch.setattr(gemini_mod, "is_enabled", lambda: True)

    def mock_grounded_json(prompt, *, system=None, cache_key=None, **kwargs):
        if "noticias" in cache_key:
            data = {
                "items": [
                    {
                        "headline": "Diputados señalan presuntas irregularidades en contratos del INE",
                        "summary": "Comisión legislativa cita a declarar a funcionarios del INE por contratos.",
                        "claim": "Diputados señalan presuntas irregularidades en contratos del INE",
                        "topic": "conducta_funcionarios",
                        "geo": {"level": "nacional"},
                        "sources": [
                            {"url": "https://www.reforma.com/contratos-ine", "title": "Nota Reforma"},
                            {"url": "https://www.eluniversal.com.mx/contratos-ine", "title": "Nota El Universal"},
                        ],
                    }
                ]
            }
            res = DummyGroundedResult(
                sources=[
                    DummyGroundedSource(url="https://www.reforma.com/contratos-ine", domain="reforma.com"),
                    DummyGroundedSource(url="https://www.eluniversal.com.mx/contratos-ine", domain="eluniversal.com.mx"),
                ],
                queries=["INE contratos"],
                mode="rss_url_context",
            )
            return data, res
        elif "rumores" in cache_key:
            return {"items": []}, DummyGroundedResult()
        elif "verificacion" in cache_key:
            # Fact check has no contradiction
            return {"verifications": []}, DummyGroundedResult()
        return {}, DummyGroundedResult()

    monkeypatch.setattr(gemini_mod, "grounded_json", mock_grounded_json)

    req = MonitorScanRequest(window_days=14, refresh=True)
    snap = monitor.run_scan(req)

    assert len(snap.items) == 1
    item = snap.items[0]

    # Rule: >= 2 verifiable media without contradiction => verdadera
    assert item.verdict == "verdadera"
    assert item.verdict_confidence in ("alta", "media")
    # Accusation disclaimer present
    assert "Veredicto respecto a la existencia de la denuncia o señalamiento" in item.verdict_rationale
    # Realistic impact computed for verdadera
    assert item.impact is not None


def test_monitor_candidate_mapping_aggregator(monkeypatch, tmp_path):
    """Test that Google News aggregator candidate maps to real domain and outlet in monitor."""
    from atalaya.intel import storage
    monkeypatch.setattr(storage, "intel_dir", lambda: tmp_path / "intel")
    gemini_mod = sys.modules["atalaya.gemini"]
    monkeypatch.setattr(gemini_mod, "is_enabled", lambda: True)

    def mock_grounded_json(prompt, *, system=None, cache_key=None, **kwargs):
        if "noticias" in cache_key:
            data = {
                "items": [
                    {
                        "headline": "INE inicia preparativos para comicios 2027",
                        "summary": "Cobertura en medios nacionales.",
                        "claim": "El INE inicia formalmente los preparativos de la elección 2027",
                        "topic": "organizacion_casillas",
                        "geo": {"level": "nacional"},
                        "sources": [
                            {"url": "https://news.google.com/rss/articles/CBMiABC123", "title": "Nota Google News"},
                        ],
                    }
                ]
            }
            # Candidate has real domain elpais.com
            res = DummyGroundedResult(
                sources=[
                    DummyGroundedSource(
                        url="https://news.google.com/rss/articles/CBMiABC123",
                        title="Nota Google News",
                        domain="elpais.com",
                    )
                ],
                queries=["INE preparativos 2027"],
                mode="rss_url_context",
            )
            return data, res
        elif "rumores" in cache_key:
            return {"items": []}, DummyGroundedResult()
        elif "verificacion" in cache_key:
            return {"verifications": []}, DummyGroundedResult()
        return {}, DummyGroundedResult()

    monkeypatch.setattr(gemini_mod, "grounded_json", mock_grounded_json)

    req = MonitorScanRequest(window_days=14, refresh=True)
    snap = monitor.run_scan(req)

    assert len(snap.items) == 1
    src = snap.items[0].sources[0]
    # Google News URL preserved, domain is elpais.com, tier is medio_reconocido
    assert src.url == "https://news.google.com/rss/articles/CBMiABC123"
    assert src.domain == "elpais.com"
    assert src.tier == "medio_reconocido"
    # F2-B verdict rule: 1 medio_reconocido -> verdadera baja
    assert snap.items[0].verdict == "verdadera"
    assert snap.items[0].verdict_confidence == "baja"
    assert "Publicada por El País (medio reconocido); sin confirmación independiente ni desmentido." in snap.items[0].verdict_rationale


def test_verdict_rules_f2b(monkeypatch, tmp_path):
    """Test all verdict rules:
    - 1 oficial -> verdadera baja
    - 1 medio_reconocido -> verdadera baja
    - 1 medio_regional (not dudosa) -> verdadera baja
    - 1 medio_regional (dudosa in stage 3) -> sin_verificar baja
    - >= 2 distinct media -> verdadera media
    - >= 3 distinct media -> verdadera alta
    - oficial + medio -> verdadera alta
    """
    from atalaya.intel import storage
    monkeypatch.setattr(storage, "intel_dir", lambda: tmp_path / "intel")
    gemini_mod = sys.modules["atalaya.gemini"]
    monkeypatch.setattr(gemini_mod, "is_enabled", lambda: True)

    # 7 news items covering each verdict rule
    news_items = [
        # 1. 1 oficial
        {
            "headline": "Boletín oficial del INE sobre padrón",
            "claim": "El INE actualiza el padrón electoral nacional con 98 millones",
            "sources": [{"url": "https://centralelectoral.ine.mx/boletin-padron", "title": "Boletín"}],
        },
        # 2. 1 medio reconocido
        {
            "headline": "Reporte de El País sobre casillas",
            "claim": "El País reporta diagnóstico de casillas especiales para 2027",
            "sources": [{"url": "https://elpais.com/casillas-especiales", "title": "Nota El País"}],
        },
        # 3. 1 medio regional no dudosa
        {
            "headline": "El Norte reporta ajuste en módulos de Monterrey",
            "claim": "Módulos de credencialización en Monterrey ajustan horario de invierno",
            "sources": [{"url": "https://www.elnorte.com/modulos-monterrey", "title": "Nota El Norte"}],
        },
        # 4. 1 medio regional marcada dudosa en etapa 3
        {
            "headline": "Medio regional reporta presunta falta de boletas",
            "claim": "Diario de Chiapas reporta presunta falta de boletas en Chenalhó",
            "sources": [{"url": "https://www.diariodechiapas.com/falta-boletas", "title": "Nota Chiapas"}],
        },
        # 5. 2 medios distintos
        {
            "headline": "Cobertura coincidente de Reforma y El Universal",
            "claim": "Reforma y El Universal reportan recorte presupuestal operativo del INE",
            "sources": [
                {"url": "https://www.reforma.com/presupuesto-ine", "title": "Nota Reforma"},
                {"url": "https://www.eluniversal.com.mx/presupuesto-ine", "title": "Nota El Universal"},
            ],
        },
        # 6. 3 medios distintos
        {
            "headline": "Cobertura en 3 medios nacionales",
            "claim": "Tres diarios nacionales confirman calendario de credencialización en el extranjero",
            "sources": [
                {"url": "https://www.jornada.com.mx/voto-extranjero", "title": "Nota Jornada"},
                {"url": "https://www.milenio.com/voto-extranjero", "title": "Nota Milenio"},
                {"url": "https://www.elfinanciero.com.mx/voto-extranjero", "title": "Nota Financiero"},
            ],
        },
        # 7. 1 oficial + 1 medio
        {
            "headline": "Comunicado del INE y reporte de Aristegui Noticias",
            "claim": "El INE y Aristegui Noticias informan sobre nuevo protocolo de casillas rurales",
            "sources": [
                {"url": "https://centralelectoral.ine.mx/protocolo-rural", "title": "Boletín INE"},
                {"url": "https://aristeguinoticias.com/protocolo-rural", "title": "Nota Aristegui"},
            ],
        },
    ]

    def mock_grounded_json(prompt, *, system=None, cache_key=None, **kwargs):
        if "noticias" in cache_key:
            res_sources = [
                DummyGroundedSource("https://centralelectoral.ine.mx/boletin-padron", domain="centralelectoral.ine.mx"),
                DummyGroundedSource("https://elpais.com/casillas-especiales", domain="elpais.com"),
                DummyGroundedSource("https://www.elnorte.com/modulos-monterrey", domain="elnorte.com"),
                DummyGroundedSource("https://www.diariodechiapas.com/falta-boletas", domain="diariodechiapas.com"),
                DummyGroundedSource("https://www.reforma.com/presupuesto-ine", domain="reforma.com"),
                DummyGroundedSource("https://www.eluniversal.com.mx/presupuesto-ine", domain="eluniversal.com.mx"),
                DummyGroundedSource("https://www.jornada.com.mx/voto-extranjero", domain="jornada.com.mx"),
                DummyGroundedSource("https://www.milenio.com/voto-extranjero", domain="milenio.com"),
                DummyGroundedSource("https://www.elfinanciero.com.mx/voto-extranjero", domain="elfinanciero.com.mx"),
                DummyGroundedSource("https://centralelectoral.ine.mx/protocolo-rural", domain="centralelectoral.ine.mx"),
                DummyGroundedSource("https://aristeguinoticias.com/protocolo-rural", domain="aristeguinoticias.com"),
            ]
            return {"items": news_items}, DummyGroundedResult(sources=res_sources, mode="rss_url_context")
        elif "rumores" in cache_key:
            return {"items": []}, DummyGroundedResult(mode="rss_url_context")
        elif "verificacion" in cache_key:
            # Mark item 4 as dudosa
            c4_id = monitor.item_id_for_claim("Diario de Chiapas reporta presunta falta de boletas en Chenalhó")
            return {
                "verifications": [
                    {
                        "id": c4_id,
                        "verdict": "dudosa",
                        "confidence": "baja",
                        "rationale": "Nota local cuestionada sin respaldo documental.",
                        "fact_checks": [],
                    }
                ]
            }, DummyGroundedResult(mode="rss_url_context")
        return {}, DummyGroundedResult()

    monkeypatch.setattr(gemini_mod, "grounded_json", mock_grounded_json)

    req = MonitorScanRequest(window_days=14, refresh=True)
    snap = monitor.run_scan(req)

    assert len(snap.items) == 7
    items_by_claim = {it.claim: it for it in snap.items}

    # 1. 1 oficial -> verdadera baja
    it1 = items_by_claim["El INE actualiza el padrón electoral nacional con 98 millones"]
    assert it1.verdict == "verdadera"
    assert it1.verdict_confidence == "baja"
    assert "fuente oficial" in it1.verdict_rationale

    # 2. 1 medio reconocido -> verdadera baja
    it2 = items_by_claim["El País reporta diagnóstico de casillas especiales para 2027"]
    assert it2.verdict == "verdadera"
    assert it2.verdict_confidence == "baja"
    assert "El País" in it2.verdict_rationale
    assert "medio reconocido" in it2.verdict_rationale

    # 3. 1 medio regional no dudosa -> verdadera baja
    it3 = items_by_claim["Módulos de credencialización en Monterrey ajustan horario de invierno"]
    assert it3.verdict == "verdadera"
    assert it3.verdict_confidence == "baja"
    assert "El Norte" in it3.verdict_rationale

    # 4. 1 medio regional dudosa -> sin_verificar baja
    it4 = items_by_claim["Diario de Chiapas reporta presunta falta de boletas en Chenalhó"]
    assert it4.verdict == "sin_verificar"
    assert it4.verdict_confidence == "baja"

    # 5. 2 medios distintos -> verdadera media
    it5 = items_by_claim["Reforma y El Universal reportan recorte presupuestal operativo del INE"]
    assert it5.verdict == "verdadera"
    assert it5.verdict_confidence == "media"
    assert "2 medios distintos" in it5.verdict_rationale

    # 6. 3 medios distintos -> verdadera alta
    it6 = items_by_claim["Tres diarios nacionales confirman calendario de credencialización en el extranjero"]
    assert it6.verdict == "verdadera"
    assert it6.verdict_confidence == "alta"
    assert "3 medios de comunicación verificables" in it6.verdict_rationale

    # 7. Oficial + medio -> verdadera alta
    it7 = items_by_claim["El INE y Aristegui Noticias informan sobre nuevo protocolo de casillas rurales"]
    assert it7.verdict == "verdadera"
    assert it7.verdict_confidence == "alta"
    assert "Respaldada por" in it7.verdict_rationale


def test_monitor_jaccard_dedupe_and_search_mode(monkeypatch, tmp_path):
    """Test that Jaccard threshold is 0.7 (distinct items with similarity 0.65 are not merged),
    and MonitorSnapshot.search_mode correctly selects the worst stage mode."""
    from atalaya.intel import storage
    monkeypatch.setattr(storage, "intel_dir", lambda: tmp_path / "intel")
    gemini_mod = sys.modules["atalaya.gemini"]
    monkeypatch.setattr(gemini_mod, "is_enabled", lambda: True)

    # Two items with token Jaccard similarity ≈ 0.62 (< 0.7 threshold)
    # A: "INE reporta retrasos en instalación de casillas especiales en Veracruz"
    # B: "INE confirma retrasos en módulos de credencialización en casillas de Veracruz"
    items = [
        {
            "headline": "A",
            "claim": "INE reporta retrasos en instalación de casillas especiales en Veracruz",
            "sources": [{"url": "https://elpais.com/a", "title": "A"}],
        },
        {
            "headline": "B",
            "claim": "INE confirma retrasos en módulos de credencialización en casillas de Veracruz",
            "sources": [{"url": "https://elpais.com/b", "title": "B"}],
        },
    ]

    def mock_grounded_json(prompt, *, system=None, cache_key=None, **kwargs):
        if "noticias" in cache_key:
            res = DummyGroundedResult(
                sources=[
                    DummyGroundedSource("https://elpais.com/a", domain="elpais.com"),
                    DummyGroundedSource("https://elpais.com/b", domain="elpais.com"),
                ],
                mode="grounding",
            )
            return {"items": items}, res
        elif "rumores" in cache_key:
            return {"items": []}, DummyGroundedResult(mode="rss_url_context")
        elif "verificacion" in cache_key:
            return {"verifications": []}, DummyGroundedResult(mode="grounding")
        return {}, DummyGroundedResult()

    monkeypatch.setattr(gemini_mod, "grounded_json", mock_grounded_json)

    req = MonitorScanRequest(window_days=14, refresh=True)
    snap = monitor.run_scan(req)

    # 1. Jaccard 0.7 prevents merging these 2 distinct items
    assert len(snap.items) == 2

    # 2. search_mode: stage1=grounding, stage2=rss_url_context (respaldo), stage3=grounding -> worst is "respaldo"
    assert snap.search_mode == "respaldo"


def test_opinion_analysis_item_realism(monkeypatch, tmp_path):
    """Test realism constraints for opinion/analysis pieces:
    - intensity x0.5 (0.25 * 0.5 = 0.125 for 1 outlet)
    - persistence capped at coyuntural
    - action max comunicado (never campana_intervencion)
    - verdict_rationale notes opinion piece
    - impact.params stores piece_type and gemini_intensity
    """
    from atalaya.intel import storage
    monkeypatch.setattr(storage, "intel_dir", lambda: tmp_path / "intel")
    gemini_mod = sys.modules["atalaya.gemini"]
    monkeypatch.setattr(gemini_mod, "is_enabled", lambda: True)

    opinion_item = {
        "headline": "Crisis de confianza pone a prueba al INE: Académico IBERO",
        "claim": "Académico IBERO señala presunta crisis de confianza en el INE",
        "summary": "En entrevista, especialista de la IBERO analiza la percepción pública del instituto.",
        "piece_type": "analisis",
        "sources": [
            {"url": "https://ibero.mx/prensa/crisis-confianza-ine", "title": "Crisis de confianza", "domain": "ibero.mx"}
        ],
        "intensity": 1.0,
        "persistence": "estructural",
        "topic": "confianza_institucional",
        "geo": {"level": "nacional", "ents": []},
    }

    def mock_grounded_json(prompt, *, system=None, cache_key=None, **kwargs):
        if "noticias" in cache_key:
            res = DummyGroundedResult(
                sources=[DummyGroundedSource("https://ibero.mx/prensa/crisis-confianza-ine", domain="ibero.mx")],
                mode="grounding",
            )
            return {"items": [opinion_item]}, res
        elif "rumores" in cache_key:
            return {"items": []}, DummyGroundedResult(mode="grounding")
        elif "verificacion" in cache_key:
            return {"verifications": []}, DummyGroundedResult(mode="grounding")
        return {}, DummyGroundedResult()

    monkeypatch.setattr(gemini_mod, "grounded_json", mock_grounded_json)

    req = MonitorScanRequest(window_days=14, refresh=True)
    snap = monitor.run_scan(req)

    assert len(snap.items) == 1
    it = snap.items[0]

    # 1. Intensity is scaled down for opinion/analysis: 1 outlet (0.25) * 0.5 = 0.125
    assert it.intensity == 0.125

    # 2. Persistence is capped at coyuntural even though Gemini proposed estructural
    assert it.persistence == "coyuntural"

    # 3. Action is at most comunicado (never campana_intervencion)
    assert it.remediation.action in ("comunicado", "registrar")
    assert it.remediation.action != "campana_intervencion"
    assert "campana_intervencion" not in it.remediation.secondary_actions
    assert it.remediation.campaign_prefill is None

    # 4. Rationale announces opinion piece
    assert "Pieza de opinión: se registra la existencia del señalamiento" in it.verdict_rationale

    # 5. Impact params store piece_type and gemini_intensity
    assert it.impact is not None
    assert it.impact.params.get("piece_type") == "analisis"
    assert it.impact.params.get("gemini_intensity") == 1.0


def test_deterministic_intensity_and_persistence_scaling(monkeypatch, tmp_path):
    """Test scaling of base intensity and persistence caps with outlet count and official sources."""
    from atalaya.intel import storage
    monkeypatch.setattr(storage, "intel_dir", lambda: tmp_path / "intel")
    gemini_mod = sys.modules["atalaya.gemini"]
    monkeypatch.setattr(gemini_mod, "is_enabled", lambda: True)

    # Item with 2 outlets, Gemini proposes estructural
    items = [
        {
            "headline": "Reforma y Milenio reportan ajuste de módulos",
            "claim": "Medios reportan ajuste de módulos en el Estado de México",
            "piece_type": "hecho",
            "sources": [
                {"url": "https://reforma.com/modulos", "title": "Reforma", "domain": "reforma.com"},
                {"url": "https://milenio.com/modulos", "title": "Milenio", "domain": "milenio.com"},
            ],
            "intensity": 0.9,
            "persistence": "estructural",
            "topic": "credencial_padron",
            "geo": {"level": "estatal", "ents": ["15"]},
        }
    ]

    def mock_grounded_json(prompt, *, system=None, cache_key=None, **kwargs):
        if "noticias" in cache_key:
            res = DummyGroundedResult(
                sources=[
                    DummyGroundedSource("https://reforma.com/modulos", domain="reforma.com"),
                    DummyGroundedSource("https://milenio.com/modulos", domain="milenio.com"),
                ],
                mode="grounding",
            )
            return {"items": items}, res
        elif "rumores" in cache_key:
            return {"items": []}, DummyGroundedResult(mode="grounding")
        elif "verificacion" in cache_key:
            return {"verifications": []}, DummyGroundedResult(mode="grounding")
        return {}, DummyGroundedResult()

    monkeypatch.setattr(gemini_mod, "grounded_json", mock_grounded_json)

    req = MonitorScanRequest(window_days=14, refresh=True)
    snap = monitor.run_scan(req)

    assert len(snap.items) == 1
    it = snap.items[0]

    # 2 outlets => base intensity = 0.5 (hecho)
    assert it.intensity == 0.5
    # 2 outlets => persistence capped at persistente
    assert it.persistence == "persistente"
    # Less than 3 outlets => cannot be critica
    assert it.severity.level != "critica"
    assert it.severity.score < 75


def test_latest_snapshot_legacy_search_mode_deduction(tmp_path, monkeypatch):
    """Test that latest_snapshot correctly deduces search_mode for legacy monitor caches."""
    from atalaya.intel import storage
    monkeypatch.setattr(storage, "intel_dir", lambda: tmp_path / "intel")

    m_path = storage.monitor_result_path()
    m_path.parent.mkdir(parents=True, exist_ok=True)

    base_snapshot_dict = {
        "generated_at": "2026-10-28T23:59:59.393550+00:00",
        "window_days": 14,
        "items": [],
        "counts": {
            "verdadera": 0,
            "falsa": 0,
            "enganosa": 0,
            "sin_verificar": 0,
            "critica": 0,
            "pendientes": 0,
        },
        "queries": ["INE casillas", "INE credencial"],
        "sources_scanned": 12,
        "model": "gemini-3.8-flash",
        "degraded": False,
        "note": "Búsqueda de respaldo activa: noticias indexadas.",
        # search_mode omitted (legacy cache)
    }

    # 1. With "respaldo" in note -> deduces "respaldo"
    m_path.write_text(json.dumps(base_snapshot_dict, ensure_ascii=False), encoding="utf-8")
    snap1 = monitor.latest_snapshot()
    assert snap1 is not None
    assert snap1.search_mode == "respaldo"

    # 2. With degraded=True -> deduces "sin_internet"
    deg_dict = dict(base_snapshot_dict)
    deg_dict["note"] = ""
    deg_dict["degraded"] = True
    m_path.write_text(json.dumps(deg_dict, ensure_ascii=False), encoding="utf-8")
    snap2 = monitor.latest_snapshot()
    assert snap2 is not None
    assert snap2.search_mode == "sin_internet"

    # 3. With queries and no respaldo note -> deduces "grounding"
    gro_dict = dict(base_snapshot_dict)
    gro_dict["note"] = "Búsqueda completa realizada con éxito."
    gro_dict["degraded"] = False
    m_path.write_text(json.dumps(gro_dict, ensure_ascii=False), encoding="utf-8")
    snap3 = monitor.latest_snapshot()
    assert snap3 is not None
    assert snap3.search_mode == "grounding"


def test_rumor_factcheck_no_reconocido_sin_verificar(monkeypatch, tmp_path):
    """Test that a rumor with fact_check from an unrecognized tier stays sin_verificar baja."""
    from atalaya.intel import storage
    monkeypatch.setattr(storage, "intel_dir", lambda: tmp_path / "intel")
    gemini_mod = sys.modules["atalaya.gemini"]
    monkeypatch.setattr(gemini_mod, "is_enabled", lambda: True)

    claim = "PAN en el Senado presenta iniciativa para restar superpoderes"
    rumor_item = {
        "headline": "PAN en el Senado presenta iniciativa",
        "claim": claim,
        "summary": "Iniciativa sobre facultades de la presidencia del INE.",
        "sources": [{"url": "https://pan.senado.gob.mx/nota", "title": "PAN", "domain": "pan.senado.gob.mx"}],
        "posts": [],
        "topic": "confianza_institucional",
    }

    def mock_grounded_json(prompt, *, system=None, cache_key=None, **kwargs):
        if "noticias" in cache_key:
            return {"items": []}, DummyGroundedResult(mode="rss_url_context")
        elif "rumores" in cache_key:
            res = DummyGroundedResult(
                sources=[DummyGroundedSource("https://pan.senado.gob.mx/nota", domain="pan.senado.gob.mx")],
                mode="rss_url_context",
            )
            return {"items": [rumor_item]}, res
        elif "verificacion" in cache_key:
            # Fact check from unrecognized domain larevista.com.mx
            res = DummyGroundedResult(
                sources=[DummyGroundedSource("https://larevista.com.mx/nota", domain="larevista.com.mx")],
                mode="rss_url_context",
            )
            return {
                "verifications": [
                    {
                        "id": monitor.item_id_for_claim(claim),
                        "verdict": "verdadera",
                        "confidence": "alta",
                        "rationale": "Nota periodística sobre iniciativa.",
                        "fact_checks": [{"url": "https://larevista.com.mx/nota", "title": "La Revista"}],
                    }
                ]
            }, res
        return {}, DummyGroundedResult()

    monkeypatch.setattr(gemini_mod, "grounded_json", mock_grounded_json)

    req = MonitorScanRequest(window_days=14, refresh=True)
    snap = monitor.run_scan(req)

    assert len(snap.items) == 1
    it = snap.items[0]
    # Unrecognized fact_check => sin_verificar, baja
    assert it.kind == "rumor"
    assert it.verdict == "sin_verificar"
    assert it.verdict_confidence == "baja"
    assert "Sin dictamen formal disponible en verificadores reconocidos o canales oficiales." in it.verdict_rationale
    assert it.impact is None
    assert it.severity.level == "baja"
    assert it.remediation.action == "registrar"


def test_rumor_factcheck_verificador_caps_confidence(monkeypatch, tmp_path):
    """Test that 1 valid fact-check from a 'verificador' tier accepts verdict but caps confidence to max 'media'."""
    from atalaya.intel import storage
    monkeypatch.setattr(storage, "intel_dir", lambda: tmp_path / "intel")
    gemini_mod = sys.modules["atalaya.gemini"]
    monkeypatch.setattr(gemini_mod, "is_enabled", lambda: True)

    claim = "Los marcadores de boleta se borran con calor"
    rumor_item = {
        "headline": "Afirman que marcadores se borran",
        "claim": claim,
        "summary": "Rumor viral.",
        "posts": [{"platform": "x", "url": "https://x.com/post/1", "excerpt": "Texto"}],
        "topic": "procedimiento_votacion",
    }

    def mock_grounded_json(prompt, *, system=None, cache_key=None, **kwargs):
        if "noticias" in cache_key:
            return {"items": []}, DummyGroundedResult(mode="rss_url_context")
        elif "rumores" in cache_key:
            res = DummyGroundedResult(
                sources=[DummyGroundedSource("https://x.com/post/1", domain="x.com")],
                mode="rss_url_context",
            )
            return {"items": [rumor_item]}, res
        elif "verificacion" in cache_key:
            # 1 fact-check from 'verificador' tier (verificado.com.mx)
            res = DummyGroundedResult(
                sources=[DummyGroundedSource("https://verificado.com.mx/tinta-boletas", domain="verificado.com.mx")],
                mode="rss_url_context",
            )
            return {
                "verifications": [
                    {
                        "id": monitor.item_id_for_claim(claim),
                        "verdict": "falsa",
                        "confidence": "alta",  # Gemini proposes 'alta'
                        "rationale": "Verificado MX demostró que la tinta es indeleble.",
                        "fact_checks": [{"url": "https://verificado.com.mx/tinta-boletas", "title": "Verificado MX"}],
                    }
                ]
            }, res
        return {}, DummyGroundedResult()

    monkeypatch.setattr(gemini_mod, "grounded_json", mock_grounded_json)

    req = MonitorScanRequest(window_days=14, refresh=True)
    snap = monitor.run_scan(req)

    assert len(snap.items) == 1
    it = snap.items[0]
    assert it.verdict == "falsa"
    # Capped at media because exactly 1 verificador (no oficial)
    assert it.verdict_confidence == "media"


def test_rumor_factcheck_two_verificadores_allows_alta(monkeypatch, tmp_path):
    """Test that >= 2 valid fact-checks from 'verificador' tier allows confidence 'alta'."""
    from atalaya.intel import storage
    monkeypatch.setattr(storage, "intel_dir", lambda: tmp_path / "intel")
    gemini_mod = sys.modules["atalaya.gemini"]
    monkeypatch.setattr(gemini_mod, "is_enabled", lambda: True)

    claim = "Los marcadores de boleta se borran con calor doble"
    rumor_item = {
        "headline": "Afirman que marcadores se borran",
        "claim": claim,
        "summary": "Rumor viral.",
        "posts": [{"platform": "x", "url": "https://x.com/post/2", "excerpt": "Texto"}],
        "topic": "procedimiento_votacion",
    }

    def mock_grounded_json(prompt, *, system=None, cache_key=None, **kwargs):
        if "noticias" in cache_key:
            return {"items": []}, DummyGroundedResult(mode="rss_url_context")
        elif "rumores" in cache_key:
            res = DummyGroundedResult(
                sources=[DummyGroundedSource("https://x.com/post/2", domain="x.com")],
                mode="rss_url_context",
            )
            return {"items": [rumor_item]}, res
        elif "verificacion" in cache_key:
            # 2 fact-checks from 'verificador' tier (verificado.com.mx and animalpolitico.com)
            res = DummyGroundedResult(
                sources=[
                    DummyGroundedSource("https://verificado.com.mx/tinta-boletas", domain="verificado.com.mx"),
                    DummyGroundedSource("https://animalpolitico.com/sabueso/tinta", domain="animalpolitico.com"),
                ],
                mode="rss_url_context",
            )
            return {
                "verifications": [
                    {
                        "id": monitor.item_id_for_claim(claim),
                        "verdict": "falsa",
                        "confidence": "alta",
                        "rationale": "Dos verificadores independientes comprobaron la falsedad.",
                        "fact_checks": [
                            {"url": "https://verificado.com.mx/tinta-boletas", "title": "Verificado MX"},
                            {"url": "https://animalpolitico.com/sabueso/tinta", "title": "El Sabueso"},
                        ],
                    }
                ]
            }, res
        return {}, DummyGroundedResult()

    monkeypatch.setattr(gemini_mod, "grounded_json", mock_grounded_json)

    req = MonitorScanRequest(window_days=14, refresh=True)
    snap = monitor.run_scan(req)

    assert len(snap.items) == 1
    it = snap.items[0]
    assert it.verdict == "falsa"
    # >= 2 valid dictámenes allows alta
    assert it.verdict_confidence == "alta"


def test_rumor_factcheck_oficial_allows_alta(monkeypatch, tmp_path):
    """Test that 1 valid fact-check from 'oficial' tier allows confidence 'alta'."""
    from atalaya.intel import storage
    monkeypatch.setattr(storage, "intel_dir", lambda: tmp_path / "intel")
    gemini_mod = sys.modules["atalaya.gemini"]
    monkeypatch.setattr(gemini_mod, "is_enabled", lambda: True)

    claim = "Desmentido oficial del INE sobre casillas canceladas"
    rumor_item = {
        "headline": "Rumor de casillas",
        "claim": claim,
        "summary": "Rumor en redes.",
        "posts": [{"platform": "x", "url": "https://x.com/post/3", "excerpt": "Texto"}],
        "topic": "organizacion_casillas",
    }

    def mock_grounded_json(prompt, *, system=None, cache_key=None, **kwargs):
        if "noticias" in cache_key:
            return {"items": []}, DummyGroundedResult(mode="rss_url_context")
        elif "rumores" in cache_key:
            res = DummyGroundedResult(
                sources=[DummyGroundedSource("https://x.com/post/3", domain="x.com")],
                mode="rss_url_context",
            )
            return {"items": [rumor_item]}, res
        elif "verificacion" in cache_key:
            # 1 fact-check from 'oficial' tier (centralelectoral.ine.mx)
            res = DummyGroundedResult(
                sources=[DummyGroundedSource("https://centralelectoral.ine.mx/desmentido-123", domain="centralelectoral.ine.mx")],
                mode="rss_url_context",
            )
            return {
                "verifications": [
                    {
                        "id": monitor.item_id_for_claim(claim),
                        "verdict": "falsa",
                        "confidence": "alta",
                        "rationale": "El INE emitió comunicado oficial desmintiendo la cancelación.",
                        "fact_checks": [{"url": "https://centralelectoral.ine.mx/desmentido-123", "title": "INE Boletín"}],
                    }
                ]
            }, res
        return {}, DummyGroundedResult()

    monkeypatch.setattr(gemini_mod, "grounded_json", mock_grounded_json)

    req = MonitorScanRequest(window_days=14, refresh=True)
    snap = monitor.run_scan(req)

    assert len(snap.items) == 1
    it = snap.items[0]
    assert it.verdict == "falsa"
    # 1 oficial allows alta
    assert it.verdict_confidence == "alta"


def test_contradiction_only_by_valid_tiers(monkeypatch, tmp_path):
    """Test that a news item is contradicted only by fact_checks with 'verificador' or 'oficial' tier."""
    from atalaya.intel import storage
    monkeypatch.setattr(storage, "intel_dir", lambda: tmp_path / "intel")
    gemini_mod = sys.modules["atalaya.gemini"]
    monkeypatch.setattr(gemini_mod, "is_enabled", lambda: True)

    claim = "Reforma y El Universal reportan recorte presupuestal operativo"
    news_item = {
        "headline": "Recorte presupuestal",
        "claim": claim,
        "summary": "Reporte conjunto.",
        "sources": [
            {"url": "https://reforma.com/recorte", "title": "Reforma", "domain": "reforma.com"},
            {"url": "https://eluniversal.com.mx/recorte", "title": "El Universal", "domain": "eluniversal.com.mx"},
        ],
        "topic": "presupuesto_recortes",
    }

    # Case A: Verification has fact check with unrecognized tier -> NOT contradicted
    def mock_grounded_a(prompt, *, system=None, cache_key=None, **kwargs):
        if "noticias" in cache_key:
            res = DummyGroundedResult(
                sources=[
                    DummyGroundedSource("https://reforma.com/recorte", domain="reforma.com"),
                    DummyGroundedSource("https://eluniversal.com.mx/recorte", domain="eluniversal.com.mx"),
                ],
                mode="rss_url_context",
            )
            return {"items": [news_item]}, res
        elif "rumores" in cache_key:
            return {"items": []}, DummyGroundedResult(mode="rss_url_context")
        elif "verificacion" in cache_key:
            res = DummyGroundedResult(
                sources=[DummyGroundedSource("https://sitio-desconocido.xyz/fake", domain="sitio-desconocido.xyz")],
                mode="rss_url_context",
            )
            return {
                "verifications": [
                    {
                        "id": monitor.item_id_for_claim(claim),
                        "verdict": "falsa",
                        "confidence": "alta",
                        "rationale": "Blog alega falsedad.",
                        "fact_checks": [{"url": "https://sitio-desconocido.xyz/fake", "title": "Fake"}],
                    }
                ]
            }, res
        return {}, DummyGroundedResult()

    monkeypatch.setattr(gemini_mod, "grounded_json", mock_grounded_a)
    req = MonitorScanRequest(window_days=14, refresh=True)
    snap_a = monitor.run_scan(req)
    assert len(snap_a.items) == 1
    # Not contradicted: 2 media => verdadera, media
    assert snap_a.items[0].verdict == "verdadera"
    assert snap_a.items[0].verdict_confidence == "media"

    # Case B: Verification has fact check with official tier -> Contradicted!
    def mock_grounded_b(prompt, *, system=None, cache_key=None, **kwargs):
        if "noticias" in cache_key:
            res = DummyGroundedResult(
                sources=[
                    DummyGroundedSource("https://reforma.com/recorte", domain="reforma.com"),
                    DummyGroundedSource("https://eluniversal.com.mx/recorte", domain="eluniversal.com.mx"),
                ],
                mode="rss_url_context",
            )
            return {"items": [news_item]}, res
        elif "rumores" in cache_key:
            return {"items": []}, DummyGroundedResult(mode="rss_url_context")
        elif "verificacion" in cache_key:
            res = DummyGroundedResult(
                sources=[DummyGroundedSource("https://centralelectoral.ine.mx/desmentido-recorte", domain="centralelectoral.ine.mx")],
                mode="rss_url_context",
            )
            return {
                "verifications": [
                    {
                        "id": monitor.item_id_for_claim(claim),
                        "verdict": "falsa",
                        "confidence": "alta",
                        "rationale": "El INE desmintió formalmente dicho recorte presupuestal.",
                        "fact_checks": [{"url": "https://centralelectoral.ine.mx/desmentido-recorte", "title": "INE Boletín"}],
                    }
                ]
            }, res
        return {}, DummyGroundedResult()

    monkeypatch.setattr(gemini_mod, "grounded_json", mock_grounded_b)
    snap_b = monitor.run_scan(req)
    assert len(snap_b.items) == 1
    # Contradicted by official channel -> falsa, alta
    assert snap_b.items[0].verdict == "falsa"
    assert snap_b.items[0].verdict_confidence == "alta"


def test_reclassify_cached_snapshot(monkeypatch, tmp_path):
    """Test reclassify_cached_snapshot() without network.

    Reclassifies an unrecognized-tier rumor from verdadera to sin_verificar,
    updates impact, virality, severity, and template remediation, while preserving
    unchanged items' remediation.
    """
    from atalaya.intel import storage
    monkeypatch.setattr(storage, "intel_dir", lambda: tmp_path / "intel")
    m_path = storage.monitor_result_path()
    m_path.parent.mkdir(parents=True, exist_ok=True)

    pan_claim = "Legisladores presentan iniciativa formal para reformar facultades"
    pan_id = monitor.item_id_for_claim(pan_claim)
    elpais_claim = "Investigación periodística reporta el inicio de procesos internos"
    elpais_id = monitor.item_id_for_claim(elpais_claim)

    initial_snapshot_dict = {
        "generated_at": "2026-10-28T12:00:00+00:00",
        "window_days": 14,
        "items": [
            # Item 1: PAN rumor previously classified as verdadera alta with no_reconocido fact check
            {
                "id": pan_id,
                "kind": "rumor",
                "headline": "PAN en el Senado presenta iniciativa para restar superpoderes",
                "summary": "Actores políticos proponen limitar atribuciones.",
                "claim": pan_claim,
                "published": "2026-10-28",
                "first_seen": "2026-10-28T12:00:00+00:00",
                "sources": [
                    {
                        "id": "s1",
                        "url": "https://pan.senado.gob.mx/nota",
                        "title": "PAN Nota",
                        "domain": "pan.senado.gob.mx",
                        "tier": "no_reconocido",
                    }
                ],
                "verdict": "verdadera",
                "verdict_confidence": "alta",
                "verdict_rationale": "Existen registros periodísticos.",
                "fact_checks": [
                    {
                        "id": "s2",
                        "url": "https://larevista.com.mx/iniciativa",
                        "title": "La Revista",
                        "domain": "larevista.com.mx",
                        "tier": "no_reconocido",
                    }
                ],
                "topic": "confianza_institucional",
                "geo": {"level": "nacional", "ents": [], "muns": []},
                "intensity": 0.25,
                "persistence": "coyuntural",
                "impact": {
                    "level": "state",
                    "delta_pp_national": 0.006,
                    "votos_perdidos_total": 6356,
                    "units": [],
                    "max_delta_pp": 0.0,
                    "assumptions": [],
                    "params": {},
                },
                "virality": None,
                "severity": {"level": "baja", "score": 1, "drivers": ["Impacto"]},
                "remediation": {
                    "action": "registrar",
                    "secondary_actions": [],
                    "measures": ["Medida previa de GLM"],
                    "rationale": "Justificación previa de GLM",
                    "draft_message": "Mensaje previo de GLM",
                    "deadline_hours": 168,
                    "degraded": False,
                },
            },
            # Item 2: Recognized news (El País) that should NOT change verdict or remediation
            {
                "id": elpais_id,
                "kind": "noticia",
                "headline": "El INE comienza auditoría de licitaciones",
                "summary": "Reportan auditorías internas.",
                "claim": elpais_claim,
                "published": "2026-10-28",
                "first_seen": "2026-10-28T12:00:00+00:00",
                "sources": [
                    {
                        "id": "s3",
                        "url": "https://elpais.com/auditoria",
                        "title": "El País",
                        "domain": "elpais.com",
                        "tier": "medio_reconocido",
                    }
                ],
                "verdict": "verdadera",
                "verdict_confidence": "baja",
                "verdict_rationale": "Publicada por El País (medio reconocido); sin confirmación independiente ni desmentido.",
                "fact_checks": [],
                "topic": "conducta_funcionarios",
                "geo": {"level": "nacional", "ents": [], "muns": []},
                "intensity": 0.25,
                "persistence": "coyuntural",
                "impact": None,
                "virality": None,
                "severity": {"level": "baja", "score": 0, "drivers": []},
                "remediation": {
                    "action": "registrar",
                    "secondary_actions": [],
                    "measures": ["Medida original GLM para El País"],
                    "rationale": "Justificación original GLM",
                    "draft_message": "Mensaje original GLM para El País",
                    "deadline_hours": 168,
                    "degraded": False,
                },
            },
        ],
        "counts": {
            "verdadera": 2,
            "falsa": 0,
            "enganosa": 0,
            "sin_verificar": 0,
            "critica": 0,
            "pendientes": 2,
        },
        "queries": ["INE iniciativa"],
        "sources_scanned": 4,
        "model": "gemini-3.8-flash",
        "search_mode": "respaldo",
        "degraded": False,
        "note": "Escaneo inicial",
    }

    m_path.write_text(json.dumps(initial_snapshot_dict, ensure_ascii=False), encoding="utf-8")

    # Run reclassify_cached_snapshot
    res = monitor.reclassify_cached_snapshot()
    assert res is not None

    pan_reclassified = next(it for it in res.items if it.id == pan_id)
    elpais_reclassified = next(it for it in res.items if it.id == elpais_id)

    # 1. PAN rumor verdict changed to sin_verificar, baja
    assert pan_reclassified.verdict == "sin_verificar"
    assert pan_reclassified.verdict_confidence == "baja"
    assert pan_reclassified.impact is None
    assert pan_reclassified.severity.score == 15
    assert pan_reclassified.remediation.action == "registrar"
    assert pan_reclassified.remediation.degraded is True  # Template fallback applied
    assert pan_reclassified.remediation.measures != ["Medida previa de GLM"]

    # 2. El País noticia kept its verdict and GLM-generated remediation
    assert elpais_reclassified.verdict == "verdadera"
    assert elpais_reclassified.verdict_confidence == "baja"
    assert elpais_reclassified.remediation.measures == ["Medida original GLM para El País"]
    assert elpais_reclassified.remediation.draft_message == "Mensaje original GLM para El País"
    assert elpais_reclassified.remediation.degraded is False

    # 3. Counts updated
    assert res.counts["verdadera"] == 1
    assert res.counts["sin_verificar"] == 1

    # 4. Verifying disk write
    disk_data = json.loads(m_path.read_text(encoding="utf-8"))
    assert disk_data["counts"]["verdadera"] == 1
    assert disk_data["counts"]["sin_verificar"] == 1




