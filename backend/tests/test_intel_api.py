"""API endpoint integration tests for /api/intel."""

from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import time
import types
from fastapi.testclient import TestClient
import pandas as pd
import pytest

from atalaya.api.main import app
from atalaya.api.security import reset_intel_limiter
from atalaya.config import get_settings
from atalaya.intel.jobs import reset_jobs
from atalaya.intel.schemas import (
    CampaignPlan,
    DataSnapshot,
    ImpactAnalysis,
    MonitorSnapshot,
    NewsImpact,
    RegistryEntry,
    ResearchBundle,
    Slide,
)
from atalaya.intel import storage


# ---------------------------------------------------------------- mock fixtures & data

def make_dummy_plan(plan_id: str = "plan123", unit_id: str = "07101") -> CampaignPlan:
    snapshot = DataSnapshot(
        unit_id=unit_id,
        name="Tuxtla Gutiérrez",
        level="mun",
        ent="07",
        ent_name="Chiapas",
        lista_nominal=500000,
        pred_abstention=0.45,
        pred_low=0.40,
        pred_high=0.50,
        category="amarillo",
        risk_score=45.0,
        last_participation=0.55,
        last_year=2024,
        trend_pp=1.2,
        abstencion_esperada=225000,
    )
    research = ResearchBundle(
        unit_id=unit_id,
        unit_name="Tuxtla Gutiérrez",
        level="mun",
        generated_at=datetime.now(timezone.utc).isoformat(),
    )
    impact = ImpactAnalysis(
        campaigns=[],
        abstention_base=0.45,
        abstention_scenario=0.42,
        delta_pp=-3.0,
        votos_adicionales=15000,
        category_before="amarillo",
        category_after="verde",
    )
    slide1 = Slide(
        id="sl1",
        kind="portada",
        title="Título original",
        subtitle="Subtítulo",
        bullets=["Viñeta 1", "Viñeta 2"],
        notes="Notas originales",
    )
    return CampaignPlan(
        id=plan_id,
        unit=snapshot,
        research=research,
        objective="Objetivo de prueba",
        impact=impact,
        slides=[slide1],
        generated_at=datetime.now(timezone.utc).isoformat(),
    )


def make_dummy_monitor(generated_at: str | None = None) -> MonitorSnapshot:
    if generated_at is None:
        generated_at = datetime.now(timezone.utc).isoformat()
    return MonitorSnapshot(
        generated_at=generated_at,
        window_days=14,
        items=[],
        counts={"verdadera": 1, "falsa": 0, "critica": 0, "pendientes": 1},
    )


def make_dummy_impact(level: str = "state", ent: str | None = None) -> NewsImpact:
    return NewsImpact(
        level=level,  # type: ignore
        ent=ent,
        delta_pp_national=0.2,
        votos_perdidos_total=5000,
        units=[],
        max_delta_pp=0.5,
        assumptions=["Supuesto de prueba"],
    )


@pytest.fixture(autouse=True)
def setup_test_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    reset_jobs()
    reset_intel_limiter()
    monkeypatch.setattr(storage, "intel_dir", lambda: tmp_path / "intel")

    # Mock units dataframe in deps
    mock_units_df = pd.DataFrame({
        "unit_id": ["07", "07101"],
        "name": ["Chiapas", "Tuxtla Gutiérrez"],
        "level": ["state", "mun"],
    })
    try:
        from atalaya.api import deps
        monkeypatch.setattr(deps, "get_units_df", lambda: mock_units_df)
    except Exception:
        pass

    yield
    reset_jobs()
    reset_intel_limiter()


# ---------------------------------------------------------------- tests

def test_status_endpoint_without_external_modules():
    client = TestClient(app)
    resp = client.get("/api/intel/status")
    assert resp.status_code == 200
    data = resp.json()
    assert "gemini_enabled" in data
    assert "llm_enabled" in data
    assert "operator_configured" in data
    assert "budget_used" in data
    assert "budget_limit" in data
    assert "monitor_cooldown_min" in data


def test_operator_check_lifecycle(monkeypatch: pytest.MonkeyPatch):
    client = TestClient(app)

    # 1. No operator token configured in environment -> 401
    monkeypatch.delenv("ATALAYA_OPERATOR_TOKEN", raising=False)
    get_settings.cache_clear()
    resp = client.post("/api/intel/operator/check")
    assert resp.status_code == 401
    assert "Funciones de operador deshabilitadas" in resp.json()["detail"]

    # 2. Configured token, invalid header provided -> 401
    monkeypatch.setenv("ATALAYA_OPERATOR_TOKEN", "super-secret-token")
    get_settings.cache_clear()
    resp = client.post("/api/intel/operator/check", headers={"X-Operator-Token": "bad-token"})
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Clave de operador inválida."

    # 3. Configured token, valid header provided -> 204
    resp = client.post("/api/intel/operator/check", headers={"X-Operator-Token": "super-secret-token"})
    assert resp.status_code == 204


def test_campaign_cached_public_and_uncached_requires_operator(monkeypatch: pytest.MonkeyPatch):
    client = TestClient(app)
    monkeypatch.setenv("ATALAYA_OPERATOR_TOKEN", "valid-op-token")
    get_settings.cache_clear()

    dummy_plan = make_dummy_plan("plan-07101", "07101")

    fake_campaign = types.ModuleType("atalaya.intel.campaign")
    fake_campaign.cached_plan = lambda u, focus=None, max_age_h=None: dummy_plan if u == "07101" else None
    fake_campaign.plan_campaign = lambda req, report: dummy_plan
    monkeypatch.setitem(sys.modules, "atalaya.intel.campaign", fake_campaign)

    # 1. Cached plan is public (no operator header required) -> 200
    resp = client.post("/api/intel/campaign", json={"unit_id": "07101", "refresh": False})
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "done"
    assert data["plan"]["id"] == "plan-07101"

    # 2. Cache miss without operator token -> 401
    resp = client.post("/api/intel/campaign", json={"unit_id": "07", "refresh": False})
    assert resp.status_code == 401

    # 3. Cache miss with operator token -> 202 Job
    resp = client.post(
        "/api/intel/campaign",
        json={"unit_id": "07", "refresh": False},
        headers={"X-Operator-Token": "valid-op-token"},
    )
    assert resp.status_code == 202
    job_data = resp.json()
    assert job_data["status"] in ("queued", "running", "done")
    job_id = job_data["id"]

    # Poll job until done
    for _ in range(50):
        j_resp = client.get(f"/api/intel/jobs/{job_id}")
        if j_resp.status_code == 200 and j_resp.json()["status"] == "done":
            break
        time.sleep(0.05)

    final_job = client.get(f"/api/intel/jobs/{job_id}").json()
    assert final_job["status"] == "done"
    assert final_job["progress"] == 100

    # 4. GET /api/intel/campaign/{unit_id} public read
    resp = client.get("/api/intel/campaign/07101")
    assert resp.status_code == 200
    assert resp.json()["id"] == "plan-07101"

    resp = client.get("/api/intel/campaign/07")
    assert resp.status_code == 404


def test_campaign_invalid_unit_id_handling():
    client = TestClient(app)

    # Invalid regex format -> 422
    resp = client.post("/api/intel/campaign", json={"unit_id": "not-a-number"})
    assert resp.status_code == 422

    # Regex valid, but unknown unit -> 404
    resp = client.post("/api/intel/campaign", json={"unit_id": "99"})
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Zona no encontrada."


def test_export_pdf_and_pptx_with_override(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    client = TestClient(app)
    dummy_plan = make_dummy_plan("plan-exp", "07101")

    captured_slides = []

    fake_deck = types.ModuleType("atalaya.intel.deck")
    fake_deck.export_filename = lambda plan, fmt: f"AtalayaElectoral_PlanCampana_tuxtla_20261028.{fmt}"

    def fake_export_pdf(plan, out_path, slides=None):
        captured_slides.extend(slides or [])
        Path(out_path).write_bytes(b"%PDF-1.4 mock pdf content")
        return Path(out_path)

    def fake_export_pptx(plan, out_path, slides=None):
        captured_slides.extend(slides or [])
        Path(out_path).write_bytes(b"PK mock pptx content")
        return Path(out_path)

    fake_deck.export_pdf = fake_export_pdf
    fake_deck.export_pptx = fake_export_pptx

    fake_campaign = types.ModuleType("atalaya.intel.campaign")
    fake_campaign.find_plan = lambda pid: dummy_plan if pid == "plan-exp" else None

    monkeypatch.setitem(sys.modules, "atalaya.intel.deck", fake_deck)
    monkeypatch.setitem(sys.modules, "atalaya.intel.campaign", fake_campaign)

    # 1. 404 on nonexistent plan
    resp = client.post("/api/intel/campaign/export", json={"plan_id": "nonexistent", "format": "pdf"})
    assert resp.status_code == 404

    # 2. 422 on bullet validation (> 8 bullets or > 300 chars)
    bad_override_bullets = {
        "plan_id": "plan-exp",
        "format": "pdf",
        "slides": [{"id": "sl1", "kind": "portada", "title": "T", "bullets": [f"B{i}" for i in range(9)]}],
    }
    resp = client.post("/api/intel/campaign/export", json=bad_override_bullets)
    assert resp.status_code == 422

    bad_override_len = {
        "plan_id": "plan-exp",
        "format": "pdf",
        "slides": [{"id": "sl1", "kind": "portada", "title": "T", "bullets": ["A" * 301]}],
    }
    resp = client.post("/api/intel/campaign/export", json=bad_override_len)
    assert resp.status_code == 422

    # 3. Successful export with valid override
    good_override = {
        "plan_id": "plan-exp",
        "format": "pdf",
        "slides": [
            {
                "id": "sl1",
                "kind": "portada",
                "title": "Nuevo Título Editado",
                "subtitle": "Nuevo Subtítulo",
                "bullets": ["Viñeta editada"],
                "notes": "Notas del orador editadas",
            }
        ],
    }
    resp = client.post("/api/intel/campaign/export", json=good_override)
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert "attachment; filename=" in resp.headers["content-disposition"]
    assert b"%PDF-1.4" in resp.content
    assert any(s.title == "Nuevo Título Editado" for s in captured_slides)


def test_monitor_endpoints_lifecycle(monkeypatch: pytest.MonkeyPatch):
    client = TestClient(app)
    monkeypatch.setenv("ATALAYA_OPERATOR_TOKEN", "valid-op-token")
    get_settings.cache_clear()

    fake_monitor = types.ModuleType("atalaya.intel.monitor")
    snapshot_holder = {"snapshot": None, "cooldown": 0}

    fake_monitor.latest_snapshot = lambda public=True: snapshot_holder["snapshot"]
    fake_monitor.cooldown_remaining_s = lambda: snapshot_holder["cooldown"]
    fake_monitor.run_scan = lambda req, report: make_dummy_monitor()
    fake_monitor.item_impact = lambda item_id, level="state", ent=None: (
        make_dummy_impact(level, ent) if item_id == "item-ok" else (_ for _ in ()).throw(KeyError("not found"))
    )
    monkeypatch.setitem(sys.modules, "atalaya.intel.monitor", fake_monitor)

    # 1. GET /monitor without existing snapshot -> 404
    resp = client.get("/api/intel/monitor")
    assert resp.status_code == 404

    # 2. POST /scan requires operator token -> 401
    resp = client.post("/api/intel/monitor/scan", json={"window_days": 14, "refresh": False})
    assert resp.status_code == 401

    # 3. POST /scan with active cache & refresh=False -> 200
    snapshot_holder["snapshot"] = make_dummy_monitor()
    resp = client.post(
        "/api/intel/monitor/scan",
        json={"window_days": 14, "refresh": False},
        headers={"X-Operator-Token": "valid-op-token"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "done"

    # 4. POST /scan with refresh=True and cooldown active -> 429
    snapshot_holder["cooldown"] = 240
    resp = client.post(
        "/api/intel/monitor/scan",
        json={"window_days": 14, "refresh": True},
        headers={"X-Operator-Token": "valid-op-token"},
    )
    assert resp.status_code == 429
    assert resp.headers.get("retry-after") == "240"
    assert "Espera" in resp.json()["detail"]

    # 5. GET impact: 422 if level=mun without ent
    resp = client.get("/api/intel/monitor/items/item-ok/impact?level=mun")
    assert resp.status_code == 422

    # 6. GET impact: 200 if valid
    resp = client.get("/api/intel/monitor/items/item-ok/impact?level=mun&ent=07")
    assert resp.status_code == 200
    assert resp.json()["level"] == "mun"

    # 7. GET impact: 404 on missing item
    resp = client.get("/api/intel/monitor/items/item-bad/impact?level=state")
    assert resp.status_code == 404


def test_registry_endpoints(monkeypatch: pytest.MonkeyPatch):
    client = TestClient(app)
    monkeypatch.setenv("ATALAYA_OPERATOR_TOKEN", "valid-op-token")
    get_settings.cache_clear()

    # 1. Missing operator token -> 401
    payload = {"item_id": "news-1", "kind": "news", "status": "enterado", "note": "Nota privada"}
    resp = client.post("/api/intel/registry", json=payload)
    assert resp.status_code == 401

    resp = client.get("/api/intel/registry/news-1")
    assert resp.status_code == 401

    # 2. Operator token present -> POST saves and GET returns history
    resp = client.post(
        "/api/intel/registry",
        json=payload,
        headers={"X-Operator-Token": "valid-op-token"},
    )
    assert resp.status_code == 200
    saved = resp.json()
    assert saved["status"] == "enterado"
    assert saved["at"] != ""

    resp = client.get(
        "/api/intel/registry/news-1",
        headers={"X-Operator-Token": "valid-op-token"},
    )
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 1
    assert items[0]["note"] == "Nota privada"


def test_intel_rate_limiting(monkeypatch: pytest.MonkeyPatch):
    client = TestClient(app)
    monkeypatch.setenv("ATALAYA_OPERATOR_TOKEN", "valid-op-token")
    get_settings.cache_clear()
    reset_intel_limiter()

    # Rate limit is 10/min. Sending 10 should succeed (204).
    for _ in range(10):
        resp = client.post("/api/intel/operator/check", headers={"X-Operator-Token": "valid-op-token"})
        assert resp.status_code == 204

    # 11th request must receive 429
    resp = client.post("/api/intel/operator/check", headers={"X-Operator-Token": "valid-op-token"})
    assert resp.status_code == 429
    assert "retry-after" in resp.headers
