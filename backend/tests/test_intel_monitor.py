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
from atalaya.intel.monitor import _GLMItemRemediation, _GLMRemediationResponse


# ---------------------------------------------------------------- Mock classes & module setup


@dataclass
class DummyGroundedSource:
    url: str
    title: str
    domain: str


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
                        "fact_checks": [],
                    },
                ]
            }, DummyGroundedResult()
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

