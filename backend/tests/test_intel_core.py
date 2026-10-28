"""Tests for Atalaya intelligence core modules: storage, sources, jobs, registry."""

from __future__ import annotations

import json
from pathlib import Path
import threading
import time
import pytest
from pydantic import BaseModel

from atalaya.intel.schemas import (
    Job,
    RegistryEntry,
    SourceRef,
)
from atalaya.intel import jobs, registry, sources, storage


# ---------------------------------------------------------------- storage tests

def test_storage_atomic_and_tolerant(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(storage, "intel_dir", lambda: tmp_path / "intel")

    target_file = tmp_path / "intel" / "test_data.json"
    assert storage.read_json(target_file) is None

    # Write atomic
    data = {"hello": "world", "nested": [1, 2, 3]}
    storage.write_json_atomic(target_file, data)
    assert target_file.is_file()

    read_back = storage.read_json(target_file)
    assert read_back == data

    # Tolerant to corruption
    target_file.write_text("NOT A VALID JSON {{{", encoding="utf-8")
    assert storage.read_json(target_file) is None

    # Paths helper checks
    c_path = storage.campaign_result_path("07101", "jóvenes")
    assert "07101__" in c_path.name
    assert c_path.suffix == ".json"

    m_path = storage.monitor_result_path()
    assert m_path.name == "latest.json"

    exp_dir = storage.exports_dir()
    assert exp_dir.is_dir()
    assert exp_dir.name == "exports"


# ---------------------------------------------------------------- sources tests

def test_classify_domain_exact_and_subdomain():
    # Exact catalog match
    assert sources.classify_domain("ine.mx") == "oficial"
    assert sources.classify_domain("eluniversal.com.mx") == "medio_reconocido"
    assert sources.classify_domain("verificado.com.mx") == "verificador"
    assert sources.classify_domain("unam.mx") == "academico"
    assert sources.classify_domain("zocalo.com.mx") == "medio_regional"
    assert sources.classify_domain("x.com") == "red_social"

    # Subdomain inherits
    assert sources.classify_domain("noticias.eluniversal.com.mx") == "medio_reconocido"
    assert sources.classify_domain("sub.unam.mx") == "academico"
    assert sources.classify_domain("www.ine.mx") == "oficial"


def test_classify_domain_rules():
    # .gob.mx and ine.mx rules
    assert sources.classify_domain("salud.gob.mx") == "oficial"
    assert sources.classify_domain("elecciones.ine.mx") == "oficial"
    assert sources.classify_domain("inegi-datos.org.mx") == "oficial"

    # .edu.mx and academic rules
    assert sources.classify_domain("ciencias.edu.mx") == "academico"
    assert sources.classify_domain("investigacion.unam.mx") == "academico"
    assert sources.classify_domain("portal.cide.edu") == "academico"
    assert sources.classify_domain("revista.colmex.mx") == "academico"

    # Social platforms
    assert sources.classify_domain("tiktok.com") == "red_social"
    assert sources.classify_domain("m.facebook.com") == "red_social"
    assert sources.classify_domain("t.me") == "red_social"

    # Unknown
    assert sources.classify_domain("dominio-desconocido-123456.xyz") == "no_reconocido"


def test_outlet_name():
    assert sources.outlet_name("ine.mx") == "Instituto Nacional Electoral"
    assert sources.outlet_name("sub.milenio.com") == "Milenio"
    assert sources.outlet_name("desconocido-987.org") is None


def test_platform_of():
    assert sources.platform_of("https://x.com/INE/status/123") == "x"
    assert sources.platform_of("https://twitter.com/INE") == "x"
    assert sources.platform_of("https://www.facebook.com/watch?v=123") == "facebook"
    assert sources.platform_of("https://tiktok.com/@noticias") == "tiktok"
    assert sources.platform_of("https://instagram.com/p/123") == "instagram"
    assert sources.platform_of("https://youtu.be/abc") == "youtube"
    assert sources.platform_of("https://t.me/canal") == "telegram"
    assert sources.platform_of("https://eluniversal.com.mx/nacion") == "sitio_web"
    assert sources.platform_of("") == "otro"


def test_to_source_refs_dedupe_and_redirect(monkeypatch: pytest.MonkeyPatch):
    # Mock redirect resolution
    redirect_map = {
        "https://vertexsearch.google.com/redirect?to=real": "https://www.eluniversal.com.mx/articulo1",
        "https://short.url/ine": "https://ine.mx/comunicado-123",
    }

    def fake_resolve(u: str, *, timeout_s: float = 5.0) -> str:
        return redirect_map.get(u, u)

    import sys
    import types
    fake_gemini = types.ModuleType("atalaya.gemini")
    fake_gemini.resolve_source_url = fake_resolve
    fake_gemini.domain_of = sources._fallback_domain_of
    monkeypatch.setitem(sys.modules, "atalaya.gemini", fake_gemini)

    raw_items = [
        {"url": "https://vertexsearch.google.com/redirect?to=real", "title": "Nota El Universal", "published": "2026-10-20"},
        # Duplicate after redirect resolution
        {"url": "https://www.eluniversal.com.mx/articulo1", "title": "Nota duplicada"},
        {"url": "https://short.url/ine", "title": "Boletín INE", "published": "2026-10-21"},
    ]

    refs = sources.to_source_refs(raw_items, start=1)
    assert len(refs) == 2
    assert refs[0].id == "s1"
    assert refs[0].url == "https://www.eluniversal.com.mx/articulo1"
    assert refs[0].domain == "eluniversal.com.mx"
    assert refs[0].tier == "medio_reconocido"
    assert refs[0].published == "2026-10-20"

    assert refs[1].id == "s2"
    assert refs[1].url == "https://ine.mx/comunicado-123"
    assert refs[1].domain == "ine.mx"
    assert refs[1].tier == "oficial"


# ---------------------------------------------------------------- jobs tests

class DummyModel(BaseModel):
    plan_id: str
    message: str


def test_jobs_single_flight_and_lifecycle():
    jobs.reset_jobs()

    barrier = threading.Barrier(2)

    def slow_fn(report):
        report("Analizando datos", 25)
        barrier.wait()
        report("Generando plan", 75)
        return DummyModel(plan_id="p123", message="Exitoso")

    # Submit first job
    job1 = jobs.submit("campaign", "07101|jovenes", slow_fn)
    assert job1.status in ("queued", "running")

    # Second submit with same key must return same active job
    job2 = jobs.submit("campaign", "07101|jovenes", lambda r: DummyModel(plan_id="p999", message="No debe correr"))
    assert job1.id == job2.id

    # Release worker barrier
    barrier.wait()

    # Wait until finished
    for _ in range(50):
        current = jobs.get(job1.id)
        if current and current.status == "done":
            break
        time.sleep(0.05)

    final = jobs.get(job1.id)
    assert final is not None
    assert final.status == "done"
    assert final.progress == 100
    assert final.result == {"plan_id": "p123", "message": "Exitoso"}
    assert final.error is None
    assert final.finished_at is not None


def test_jobs_error_handling_is_safe():
    jobs.reset_jobs()

    def error_fn(report):
        report("Ejecutando", 10)
        raise RuntimeError("Traceback with sensitive details that should never leak")

    job = jobs.submit("campaign", "fail_key", error_fn)

    for _ in range(50):
        current = jobs.get(job.id)
        if current and current.status == "error":
            break
        time.sleep(0.05)

    final = jobs.get(job.id)
    assert final is not None
    assert final.status == "error"
    assert final.error == "Error interno; intenta de nuevo"
    assert "Traceback" not in (final.error or "")


# ---------------------------------------------------------------- registry tests

def test_registry_append_and_latest(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(storage, "intel_dir", lambda: tmp_path)

    e1 = RegistryEntry(
        item_id="item-1",
        status="enterado",
        note="Nota privada del operador 1",
    )
    saved1 = registry.append(e1)
    assert saved1.at != ""

    e2 = RegistryEntry(
        item_id="item-1",
        status="comunicado_emitido",
        note="Nota privada del operador 2",
    )
    registry.append(e2)

    # Public read blanks note
    pub = registry.latest("item-1", public=True)
    assert pub is not None
    assert pub.status == "comunicado_emitido"
    assert pub.note == ""

    # Operator read keeps note
    priv = registry.latest("item-1", public=False)
    assert priv is not None
    assert priv.note == "Nota privada del operador 2"

    # History returns both in order
    hist = registry.history("item-1")
    assert len(hist) == 2
    assert hist[0].status == "enterado"
    assert hist[1].status == "comunicado_emitido"


def test_registry_latest_map_and_corrupt_lines(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(storage, "intel_dir", lambda: tmp_path)

    jsonl_path = tmp_path / "registry.jsonl"
    # Write a valid line, a corrupt line, and another valid line
    e1 = RegistryEntry(item_id="item-A", status="enterado", note="Secret A")
    e2 = RegistryEntry(item_id="item-B", status="respondida", note="Secret B")

    with jsonl_path.open("w", encoding="utf-8") as f:
        f.write(json.dumps(e1.model_dump()) + "\n")
        f.write("CORRUPT JSON LINE -- @@ #$$\n")
        f.write(json.dumps(e2.model_dump()) + "\n")

    res = registry.latest_map(["item-A", "item-B", "item-C"], public=True)
    assert "item-A" in res
    assert "item-B" in res
    assert "item-C" not in res
    assert res["item-A"].status == "enterado"
    assert res["item-A"].note == ""
    assert res["item-B"].status == "respondida"


def test_registry_concurrency(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(storage, "intel_dir", lambda: tmp_path)

    threads = []
    num_threads = 8

    def worker(idx: int):
        entry = RegistryEntry(
            item_id=f"concurrent-{idx}",
            status="enterado",
            note=f"Note {idx}",
        )
        registry.append(entry)

    for i in range(num_threads):
        t = threading.Thread(target=worker, args=(i,))
        threads.append(t)
        t.start()

    for t in threads:
        t.join()

    # All 8 should be present
    for i in range(num_threads):
        item = registry.latest(f"concurrent-{i}", public=False)
        assert item is not None
        assert item.note == f"Note {i}"
