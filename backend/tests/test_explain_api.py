"""Unit and integration tests for explain API (/api/explain) and explain/context.py."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sys
import time
import types
from fastapi.testclient import TestClient
import pytest

from atalaya.api.main import app
from atalaya.api.security import reset_intel_limiter
from atalaya.explain import context
from atalaya.explain.schemas import (
    ContextFinding,
    ContextResult,
    ContextSource,
    Explanation,
    ExplainReason,
    ScoreComponent,
)
from atalaya.intel.jobs import reset_jobs
from atalaya.intel.schemas import Finding, Job, ResearchBundle, SourceRef
from atalaya.intel import storage


# ---------------------------------------------------------------- helpers & fixtures


def make_dummy_explanation(unit_id: str = "07") -> Explanation:
    is_state = len(unit_id) == 2
    return Explanation(
        unit_id=unit_id,
        level="state" if is_state else "mun",
        name="Chiapas" if is_state else "Tuxtla Gutiérrez",
        state_name=None if is_state else "Chiapas",
        category="verde",
        risk_score=35.5,
        pred_abstention_pct=45.9,
        headline="Chiapas tiene una participación relativamente alta.",
        in_short=["Se vota más que el promedio nacional"],
        reasons=[
            ExplainReason(
                id="r1",
                kind="semaforo",
                title="Semáforo verde",
                body="La abstención proyectada es baja.",
                strength="fuerte",
                evidence_type="calculo_del_modelo",
                direction="baja_abstencion",
                numbers=[],
                source="INE · CCPC",
            )
        ],
        score_breakdown=[
            ScoreComponent(key="abs", label="Abstención esperada", weight=0.50, rank_pct=30.0, points=15.0, plain="15 pts"),
            ScoreComponent(key="vuln", label="Perfil", weight=0.20, rank_pct=40.0, points=8.0, plain="8 pts"),
            ScoreComponent(key="trend", label="Tendencia", weight=0.15, rank_pct=40.0, points=6.0, plain="6 pts"),
            ScoreComponent(key="vol", label="Volatilidad", weight=0.15, rank_pct=43.3, points=6.5, plain="6.5 pts"),
        ],
        groups=[],
        what_we_dont_know=["Las encuestas no miden intención de voto individual."],
        confidence="alta",
        confidence_note="Datos completos de 6 elecciones.",
        recommendations=[],
        suggested_questions=[],
        sources=["INE · Conteos Censales 2009–2024"],
        data_year=2024,
        generated_at=datetime.now(timezone.utc).isoformat(),
    )


def make_dummy_bundle(
    unit_id: str = "07",
    findings: list[Finding] | None = None,
    sources: list[SourceRef] | None = None,
    degraded: bool = False,
    note: str | None = None,
) -> ResearchBundle:
    is_state = len(unit_id) == 2
    return ResearchBundle(
        unit_id=unit_id,
        unit_name="Chiapas" if is_state else "Tuxtla Gutiérrez",
        level="state" if is_state else "mun",
        findings=findings or [],
        sources=sources or [],
        generated_at=datetime.now(timezone.utc).isoformat(),
        model="gemini-3.8-flash",
        search_mode="respaldo",
        degraded=degraded,
        note=note,
    )


@pytest.fixture(autouse=True)
def setup_test_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    reset_jobs()
    reset_intel_limiter()
    # Direct intel storage to tmp_path
    monkeypatch.setattr(storage, "intel_dir", lambda: tmp_path / "intel")
    real_campaign = sys.modules.get("atalaya.intel.campaign")
    yield
    reset_jobs()
    reset_intel_limiter()
    if real_campaign is not None:
        sys.modules["atalaya.intel.campaign"] = real_campaign
        import atalaya.intel
        setattr(atalaya.intel, "campaign", real_campaign)


@pytest.fixture
def auth_client() -> TestClient:
    """Provide a TestClient with an authenticated operator session."""
    from atalaya.auth import create_test_session
    token = create_test_session("test_user")
    return TestClient(app, cookies={"atalaya_session": token})


def test_unauthenticated_requests_return_401():
    """Verify that all three /api/explain routes enforce session authentication."""
    client = TestClient(app)
    client.cookies.clear()

    # 1. GET /{unit_id}
    resp1 = client.get("/api/explain/07")
    assert resp1.status_code == 401
    assert "Sesión requerida" in resp1.json()["detail"]

    # 2. GET /{unit_id}/context
    resp2 = client.get("/api/explain/07/context")
    assert resp2.status_code == 401
    assert "Sesión requerida" in resp2.json()["detail"]

    # 3. POST /{unit_id}/context
    resp3 = client.post("/api/explain/07/context", json={"refresh": False})
    assert resp3.status_code == 401
    assert "Sesión requerida" in resp3.json()["detail"]


# ---------------------------------------------------------------- 2. GET /{unit_id}


def test_get_explanation_success_and_validations(auth_client: TestClient, monkeypatch: pytest.MonkeyPatch):
    """Verify explanation endpoint: 200 with double, 404 for unknown unit, 422 for invalid IDs."""
    fake_engine = types.ModuleType("atalaya.explain.engine")

    def mock_build_explanation(unit_id: str):
        if unit_id == "07":
            return make_dummy_explanation("07")
        if unit_id == "07101":
            return make_dummy_explanation("07101")
        if unit_id == "99":
            raise KeyError(f"Unit {unit_id} not found")
        if unit_id == "88":
            raise RuntimeError("Database connection exploded")
        raise KeyError(unit_id)

    fake_engine.build_explanation = mock_build_explanation
    monkeypatch.setitem(sys.modules, "atalaya.explain.engine", fake_engine)

    # 1. Successful GET for state
    resp = auth_client.get("/api/explain/07")
    assert resp.status_code == 200
    assert resp.headers.get("cache-control") == "private, max-age=300"
    data = resp.json()
    assert data["unit_id"] == "07"
    assert data["level"] == "state"
    assert data["name"] == "Chiapas"
    assert len(data["reasons"]) >= 1

    # 2. Successful GET for municipio
    resp_mun = auth_client.get("/api/explain/07101")
    assert resp_mun.status_code == 200
    assert resp_mun.json()["unit_id"] == "07101"

    # 3. 404 for inexistent unit
    resp_404 = auth_client.get("/api/explain/99")
    assert resp_404.status_code == 404
    assert "No encontramos esa zona" in resp_404.json()["detail"]

    # 4. 422 for invalid IDs: "7", "abc", "071", "123456"
    for bad_id in ["7", "abc", "071", "123456", ""]:
        bad_resp = auth_client.get(f"/api/explain/{bad_id}")
        assert bad_resp.status_code in (404, 422)  # empty path may 404 on routing, others 422
        if bad_id:
            assert bad_resp.status_code == 422
            assert "Clave de zona inválida" in bad_resp.json()["detail"]

    # 5. 500 on unexpected engine error (no traceback leaked)
    resp_500 = auth_client.get("/api/explain/88")
    assert resp_500.status_code == 500
    assert resp_500.json()["detail"] == "Error interno al generar la explicación."


# ---------------------------------------------------------------- 3. POST & GET /{unit_id}/context


def test_post_and_get_context_lifecycle(auth_client: TestClient, monkeypatch: pytest.MonkeyPatch):
    """Verify context lifecycle: cache hit returns 200; uncached submits job 202 and saves for GET 200."""
    dummy_bundle = make_dummy_bundle(
        unit_id="07",
        findings=[
            Finding(
                id="f1",
                title="Desplazamiento por violencia",
                summary="Habitantes de comunidades fronterizas se han desplazado.",
                category="inseguridad_violencia",
                scope="estado",
                verification="cita_verificada",
                quote="Familias enteras dejaron sus hogares tras enfrentamientos",
                evidence=["s1"],
            )
        ],
        sources=[
            SourceRef(
                id="s1",
                url="https://eluniversal.com.mx/estados/chiapas-desplazados",
                title="Desplazamiento forzado en Chiapas",
                domain="eluniversal.com.mx",
                tier="medio_reconocido",
            )
        ],
    )

    fake_campaign = types.ModuleType("atalaya.intel.campaign")
    fake_campaign.build_snapshot = lambda u: types.SimpleNamespace(unit_id=u, name="Chiapas", level="state")
    fake_campaign.research_unit = lambda snapshot, focus=None, refresh=False: dummy_bundle
    monkeypatch.setitem(sys.modules, "atalaya.intel.campaign", fake_campaign)
    import atalaya.intel
    monkeypatch.setattr(atalaya.intel, "campaign", fake_campaign, raising=False)

    # 1. Uncached GET returns 404
    resp_404 = auth_client.get("/api/explain/07/context")
    assert resp_404.status_code == 404
    assert "Aún no hay contexto investigado" in resp_404.json()["detail"]

    # 2. Mock jobs.submit to run the task synchronously and return a Job
    from atalaya.intel import jobs

    def synchronous_submit(kind: str, key: str, fn):
        result = fn(lambda stage, pct: None)
        return Job(
            id="job_test123",
            kind="explain_context",
            key=key,
            status="done",
            stage="Completado",
            progress=100,
            result=result.model_dump() if hasattr(result, "model_dump") else result,
        )

    monkeypatch.setattr(jobs, "submit", synchronous_submit)

    # 3. POST uncached triggers job and returns 202
    resp_post = auth_client.post("/api/explain/07/context", json={"refresh": False})
    assert resp_post.status_code == 202
    job_data = resp_post.json()
    assert job_data["id"] == "job_test123"
    assert job_data["kind"] == "explain_context"

    # 4. Now GET /api/explain/07/context returns 200 with the saved ContextResult
    resp_get = auth_client.get("/api/explain/07/context")
    assert resp_get.status_code == 200
    ctx_data = resp_get.json()
    assert ctx_data["unit_id"] == "07"
    assert ctx_data["from_cache"] is True
    assert len(ctx_data["findings"]) == 1
    assert ctx_data["findings"][0]["title"] == "Desplazamiento por violencia"
    assert ctx_data["findings"][0]["category_label"] == "Inseguridad y violencia"
    assert ctx_data["findings"][0]["verification"] == "cita_verificada"
    assert len(ctx_data["findings"][0]["sources"]) == 1
    assert ctx_data["findings"][0]["sources"][0]["domain"] == "eluniversal.com.mx"

    # 5. Subsequent POST with refresh=False returns 200 with cached result immediately
    resp_cached = auth_client.post("/api/explain/07/context", json={"refresh": False})
    assert resp_cached.status_code == 200
    cached_payload = resp_cached.json()
    assert cached_payload["status"] == "done"
    assert cached_payload["context"]["unit_id"] == "07"
    assert cached_payload["context"]["from_cache"] is True


# ---------------------------------------------------------------- 4. to_context_result logic


def test_to_context_result_ordering_mapping_and_notes():
    """Verify to_context_result: sorts by verification, maps sources by id, handles empty note."""
    src1 = SourceRef(
        id="s1",
        url="https://ine.mx/comunicado-1",
        title="Casillas instaladas",
        domain="ine.mx",
        tier="oficial",
    )
    src2 = SourceRef(
        id="s2",
        url="https://animalpolitico.com/sabueso",
        title="Verificación electoral",
        domain="animalpolitico.com",
        tier="verificador",
    )

    f_unverified = Finding(
        id="f1",
        title="Desánimo vecinal",
        summary="Rumores en redes sobre falta de boletas.",
        category="apatia_desafeccion",
        verification="sin_verificar",
        evidence=["s2"],
    )
    f_quote_verified = Finding(
        id="f2",
        title="Comunidades sin casilla cercana",
        summary="Caminar 4 horas para llegar a la casilla.",
        category="acceso_casillas_distancia",
        verification="cita_verificada",
        quote="La casilla más cercana queda a cuatro horas a pie",
        evidence=["s1"],
    )
    f_source_verified = Finding(
        id="f3",
        title="Falta de credencialización",
        summary="Retrasos en módulos del INE.",
        category="barreras_documentales_credencial",
        verification="fuente_verificada",
        evidence=["s1", "s2"],
    )

    bundle = ResearchBundle(
        unit_id="07001",
        unit_name="Acacoyagua",
        level="mun",
        findings=[f_unverified, f_quote_verified, f_source_verified],
        sources=[src1, src2],
        generated_at="2026-10-31T12:00:00Z",
        model="gemini-3.8-flash",
        search_mode="respaldo",
    )

    res = context.to_context_result(bundle, level="mun")
    assert res.unit_id == "07001"
    assert res.name == "Acacoyagua"
    assert res.level == "mun"

    # Order must be: cita_verificada -> fuente_verificada -> sin_verificar
    assert len(res.findings) == 3
    assert res.findings[0].id == "f2"
    assert res.findings[0].verification == "cita_verificada"
    assert res.findings[0].category_label == "Distancia o acceso a la casilla"
    assert len(res.findings[0].sources) == 1
    assert res.findings[0].sources[0].url == "https://ine.mx/comunicado-1"

    assert res.findings[1].id == "f3"
    assert res.findings[1].verification == "fuente_verificada"
    assert res.findings[1].category_label == "Credencial y trámites"
    assert len(res.findings[1].sources) == 2

    assert res.findings[2].id == "f1"
    assert res.findings[2].verification == "sin_verificar"
    assert res.findings[2].category_label == "Desinterés o desencanto"

    # Case: Empty findings and not degraded => generated note with unit name
    empty_bundle = ResearchBundle(
        unit_id="07001",
        unit_name="Acacoyagua",
        level="mun",
        findings=[],
        sources=[],
        degraded=False,
        generated_at="2026-10-31T12:00:00Z",
    )
    empty_res = context.to_context_result(empty_bundle, level="mun")
    assert "No encontramos noticias verificables recientes sobre la participación en Acacoyagua" in (empty_res.note or "")

    # Case: Degraded bundle preserves degraded note
    degraded_bundle = ResearchBundle(
        unit_id="07001",
        unit_name="Acacoyagua",
        level="mun",
        findings=[],
        sources=[],
        degraded=True,
        note="Sin conexión a internet",
        generated_at="2026-10-31T12:00:00Z",
    )
    degraded_res = context.to_context_result(degraded_bundle, level="mun")
    assert degraded_res.note == "Sin conexión a internet"
    assert degraded_res.degraded is True


# ---------------------------------------------------------------- 5. Caché vencida / corrupta


def test_cache_expiration_and_corruption_returns_none(tmp_path: Path):
    """Verify that get_cached_context returns None on old mtime, old generated_at, or corrupt files."""
    explain_cache_dir = tmp_path / "intel" / "results" / "explain"
    explain_cache_dir.mkdir(parents=True, exist_ok=True)

    # 1. Fresh cache is returned
    fresh_result = ContextResult(
        unit_id="07",
        name="Chiapas",
        level="state",
        findings=[],
        generated_at=datetime.now(timezone.utc).isoformat(),
        from_cache=False,
    )
    fresh_file = explain_cache_dir / "07.json"
    storage.write_json_atomic(fresh_file, fresh_result.model_dump())

    cached = context.get_cached_context("07")
    assert cached is not None
    assert cached.from_cache is True

    # 2. Expired by mtime (> 72 hours)
    old_mtime_file = explain_cache_dir / "08.json"
    storage.write_json_atomic(old_mtime_file, fresh_result.model_dump())
    old_time = time.time() - (73 * 3600)
    import os
    os.utime(old_mtime_file, (old_time, old_time))

    assert context.get_cached_context("08", max_age_h=72) is None

    # 3. Expired by generated_at (> 72 hours ago) even if mtime is fresh
    stale_iso = (datetime.now(timezone.utc) - timedelta(hours=75)).isoformat()
    stale_result = fresh_result.model_copy(update={"generated_at": stale_iso})
    stale_file = explain_cache_dir / "09.json"
    storage.write_json_atomic(stale_file, stale_result.model_dump())

    assert context.get_cached_context("09", max_age_h=72) is None

    # 4. Corrupt JSON file
    corrupt_file = explain_cache_dir / "10.json"
    corrupt_file.write_text("{invalid_json: 123", encoding="utf-8")
    assert context.get_cached_context("10") is None

    # 5. Empty JSON file
    empty_file = explain_cache_dir / "11.json"
    empty_file.write_text("", encoding="utf-8")
    assert context.get_cached_context("11") is None


def test_run_context_research_key_error(monkeypatch: pytest.MonkeyPatch):
    """Verify that run_context_research raises KeyError with Spanish message when unit is unknown."""
    fake_campaign = types.ModuleType("atalaya.intel.campaign")

    def fail_snapshot(uid):
        raise KeyError(f"Unknown unit {uid}")

    fake_campaign.build_snapshot = fail_snapshot
    monkeypatch.setitem(sys.modules, "atalaya.intel.campaign", fake_campaign)
    import atalaya.intel
    monkeypatch.setattr(atalaya.intel, "campaign", fake_campaign, raising=False)

    with pytest.raises(KeyError) as exc_info:
        context.run_context_research("99", lambda s, p: None)
    assert "No encontramos la zona con clave '99'" in str(exc_info.value)


def test_context_rate_limiting(auth_client: TestClient, monkeypatch: pytest.MonkeyPatch):
    """Verify that POST /api/explain/{id}/context enforces rate limiting when uncached."""
    fake_campaign = types.ModuleType("atalaya.intel.campaign")
    fake_campaign.build_snapshot = lambda u: types.SimpleNamespace(unit_id=u, name="Chiapas", level="state")
    fake_campaign.research_unit = lambda s, f=None, refresh=False: make_dummy_bundle()
    monkeypatch.setitem(sys.modules, "atalaya.intel.campaign", fake_campaign)
    import atalaya.intel
    monkeypatch.setattr(atalaya.intel, "campaign", fake_campaign, raising=False)

    from atalaya.intel import jobs
    monkeypatch.setattr(
        jobs,
        "submit",
        lambda kind, key, fn: Job(id="j1", kind="explain_context", key=key),
    )

    # Exceed the 10/min rate limit on uncached POST
    hit_429 = False
    for _ in range(15):
        resp = auth_client.post("/api/explain/07/context", json={"refresh": True})
        if resp.status_code == 429:
            hit_429 = True
            assert "Demasiadas solicitudes" in resp.json()["detail"]
            break

    assert hit_429, "Expected rate limiter to return 429 after 10 requests within a minute"

