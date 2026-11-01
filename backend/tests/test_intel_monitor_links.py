"""Tests for INE Monitor verified social links and Ruta B pipeline (OLA 2 - L-B).

Verifies:
1. Ruta B extracts verified posts from downloaded corpus (citado_en_fuente) and discards hallucinated/unbacked post URLs.
2. Real decoded URLs are preserved on item sources (never news.google.com).
3. Post excerpts are kept if literal (verify.quote_in_text), otherwise set to "".
4. Legacy cache loading drops unverified posts, recalculates virality/report_targets, and annotates note without writing to disk.
5. Handles author cleanly from URL, never accepting AI-invented handles.
"""

from __future__ import annotations

import json
from pathlib import Path
import sys
from typing import Any

import pytest

from atalaya import gemini, websearch
from atalaya.explain import verify
from atalaya.explain.verify import CorpusDoc
from atalaya.intel import monitor, prompts_monitor, storage
from atalaya.intel.schemas import (
    Engagement,
    MonitorScanRequest,
    MonitorSnapshot,
    NewsItem,
    Remediation,
    ReportTarget,
    Severity,
    SocialPost,
    SourceRef,
    Virality,
)
from atalaya.intel.social_links import ExtractedPost


class DummyCandidate:
    def __init__(self, url: str, title: str, domain: str, outlet: str = "Medio"):
        self.url = url
        self.title = title
        self.domain = domain
        self.outlet = outlet
        self.snippet = f"Noticia sobre {title}"
        self.published = "2026-10-30"


class DummyMeta:
    def __init__(self, model: str = "gemini-3.8-flash"):
        self.model = model


def test_ruta_b_verified_posts_and_discarded_fake_urls(monkeypatch, tmp_path):
    """Corpus cites x.com/a/status/1 as p1; model outputs p1, p9 and fake FB URL in summary.

    Item has 1 post (x.com/a/status/1, author "@a", citado_en_fuente, evidence_url = doc.url).
    The invented URL does not appear, and note accounts 1 discarded.
    """
    monkeypatch.setattr(storage, "intel_dir", lambda: tmp_path / "intel")

    monkeypatch.setattr(gemini, "is_enabled", lambda: True)
    monkeypatch.setattr(gemini, "_is_grounding_available", lambda: (False, "Quota exceeded"))

    doc_url = "https://www.eluniversal.com.mx/elecciones/casillas-reporte"
    doc_text = "En redes sociales circula el reporte de casillas. Un usuario compartió detalles del proceso electoral."
    doc1 = CorpusDoc(
        id="d1",
        url=doc_url,
        title="Reporte electoral de casillas",
        domain="eluniversal.com.mx",
        outlet="El Universal",
        published="2026-10-29",
        tier="medio_reconocido",
        text=doc_text,
        from_page=True,
        posts=[
            ExtractedPost(
                platform="x",
                url="https://x.com/a/status/1",
                handle="@a",
                source_url=doc_url,
                source_outlet="El Universal",
            )
        ],
    )

    monkeypatch.setattr(
        websearch,
        "search_news",
        lambda queries, days=14, max_items=40: [DummyCandidate(doc_url, "Reporte", "eluniversal.com.mx", "El Universal")],
    )
    monkeypatch.setattr(
        verify,
        "fetch_corpus",
        lambda candidates, zone_names=[], max_pages=12, extract_posts=True: [doc1],
    )

    def mock_generate_json(prompt, system=None, **kwargs):
        cache_key = kwargs.get("cache_key", "")
        if "noticias" in cache_key:
            return {
                "items": [
                    {
                        "headline": "Cobertura de preparativos de casillas",
                        "summary": "Medios reportan preparativos.",
                        "claim": "El INE prepara la instalación de casillas",
                        "piece_type": "hecho",
                        "published": "2026-10-29",
                        "source_ids": ["d1"],
                        "topic": "organizacion_casillas",
                        "geo": {"level": "nacional"},
                        "intensity": 0.5,
                        "persistence": "coyuntural",
                    }
                ]
            }, DummyMeta()
        elif "rumores" in cache_key:
            return {
                "items": [
                    {
                        "headline": "Rumor de boletas no foliadas",
                        "summary": "En https://facebook.com/fake_user/posts/pfbid02z3p9n5T5t3c5v7g9d1u2x4k8q6g2v2 circula rumor inventado.",
                        "claim": "Publicaciones afirman boletas no foliadas en casillas",
                        "topic": "procedimiento_votacion",
                        "geo": {"level": "nacional"},
                        "source_ids": ["d1"],
                        "post_ids": ["p1", "p9"],  # p1 exists, p9 is hallucinated by model
                    }
                ]
            }, DummyMeta()
        elif "verificacion" in cache_key:
            return {
                "verifications": [
                    {
                        "id": monitor.item_id_for_claim("Publicaciones afirman boletas no foliadas en casillas"),
                        "verdict": "falsa",
                        "confidence": "media",
                        "rationale": "El INE desmiente acusación sobre folios de boletas.",
                        "fact_check_ids": ["d1"],
                    }
                ]
            }, DummyMeta()
        return {}, DummyMeta()

    monkeypatch.setattr(gemini, "generate_json", mock_generate_json)

    req = MonitorScanRequest(window_days=14, refresh=True)
    snap = monitor.run_scan(req)

    assert snap is not None
    assert snap.search_mode == "respaldo"

    rumor_item = next(it for it in snap.items if "foliadas" in it.claim)
    assert rumor_item.virality is not None
    # Only p1 should be kept
    assert len(rumor_item.virality.posts) == 1
    post = rumor_item.virality.posts[0]
    assert post.url == "https://x.com/a/status/1"
    assert post.author == "@a"
    assert post.link_status == "citado_en_fuente"
    assert post.evidence_url == doc_url
    assert post.evidence_outlet == "El Universal"
    assert post.engagement.likes is None

    # The invented Facebook URL should NOT appear in posts
    assert not any("facebook.com" in p.url for p in rumor_item.virality.posts)

    # Note accounts 1 discarded post (from p9)
    assert snap.note is not None
    assert "1 publicación descartada" in snap.note


def test_ruta_b_sources_have_real_urls(monkeypatch, tmp_path):
    """Item sources must use the decoded real page URL, never news.google.com."""
    monkeypatch.setattr(storage, "intel_dir", lambda: tmp_path / "intel")

    monkeypatch.setattr(gemini, "is_enabled", lambda: True)
    monkeypatch.setattr(gemini, "_is_grounding_available", lambda: (False, "Quota exceeded"))

    real_news_url = "https://aristeguinoticias.com/2910/mexico/ine-reporta-avances-en-modulo/"
    doc = CorpusDoc(
        id="d1",
        url=real_news_url,
        title="INE reporta avances en módulos",
        domain="aristeguinoticias.com",
        outlet="Aristegui Noticias",
        published="2026-10-29",
        tier="medio_reconocido",
        text="Texto de la noticia.",
        from_page=True,
    )

    monkeypatch.setattr(websearch, "search_news", lambda *a, **k: [DummyCandidate(real_news_url, "Avances", "aristeguinoticias.com")])
    monkeypatch.setattr(verify, "fetch_corpus", lambda *a, **k: [doc])

    def mock_generate_json(prompt, system=None, **kwargs):
        cache_key = kwargs.get("cache_key", "")
        if "noticias" in cache_key:
            return {
                "items": [
                    {
                        "headline": "Avance en credencialización",
                        "summary": "Reporte de avance.",
                        "claim": "Módulos de atención reportan tiempos de espera normales",
                        "piece_type": "hecho",
                        "published": "2026-10-29",
                        "source_ids": ["d1"],
                        "topic": "credencial_padron",
                        "geo": {"level": "nacional"},
                        "intensity": 0.5,
                        "persistence": "coyuntural",
                    }
                ]
            }, DummyMeta()
        return {"items": []}, DummyMeta()

    monkeypatch.setattr(gemini, "generate_json", mock_generate_json)

    req = MonitorScanRequest(window_days=14, refresh=True)
    snap = monitor.run_scan(req)

    item = snap.items[0]
    assert len(item.sources) == 1
    assert item.sources[0].url == real_news_url
    assert "news.google.com" not in item.sources[0].url


def test_ruta_b_post_excerpt_literal_vs_non_literal(monkeypatch, tmp_path):
    """Post excerpt is retained if literal quote in doc text, else set to empty string."""
    monkeypatch.setattr(storage, "intel_dir", lambda: tmp_path / "intel")

    monkeypatch.setattr(gemini, "is_enabled", lambda: True)
    monkeypatch.setattr(gemini, "_is_grounding_available", lambda: (False, "Quota exceeded"))

    literal_quote = "El documento oficial contiene este texto exacto sobre la jornada de votacion en casillas."
    doc_url = "https://milenio.com/politica/elecciones-casillas"
    doc = CorpusDoc(
        id="d1",
        url=doc_url,
        title="Milenio elecciones",
        domain="milenio.com",
        outlet="Milenio",
        published="2026-10-29",
        tier="medio_reconocido",
        text=f"Primer párrafo. {literal_quote} Segundo párrafo.",
        from_page=True,
        posts=[
            ExtractedPost(platform="x", url="https://x.com/citado1/status/100", handle="@citado1", source_url=doc_url, source_outlet="Milenio"),
            ExtractedPost(platform="x", url="https://x.com/citado2/status/200", handle="@citado2", source_url=doc_url, source_outlet="Milenio"),
        ],
    )

    monkeypatch.setattr(websearch, "search_news", lambda *a, **k: [DummyCandidate(doc_url, "Milenio", "milenio.com")])
    monkeypatch.setattr(verify, "fetch_corpus", lambda *a, **k: [doc])

    def mock_generate_json(prompt, system=None, **kwargs):
        cache_key = kwargs.get("cache_key", "")
        if "rumores" in cache_key:
            return {
                "items": [
                    {
                        "headline": "Rumor con extractos",
                        "summary": "Rumor evaluado.",
                        "claim": "Publicaciones afirman problemas en casillas",
                        "topic": "organizacion_casillas",
                        "geo": {"level": "nacional"},
                        "source_ids": ["d1"],
                        "post_ids": ["p1", "p2"],
                        "posts": [
                            {"post_id": "p1", "excerpt": literal_quote},
                            {"post_id": "p2", "excerpt": "Texto inventado por el modelo que no aparece en el articulo"},
                        ],
                    }
                ]
            }, DummyMeta()
        return {"items": []}, DummyMeta()

    monkeypatch.setattr(gemini, "generate_json", mock_generate_json)

    req = MonitorScanRequest(window_days=14, refresh=True)
    snap = monitor.run_scan(req)

    item = snap.items[0]
    assert len(item.virality.posts) == 2
    post1 = next(p for p in item.virality.posts if "100" in p.url)
    post2 = next(p for p in item.virality.posts if "200" in p.url)

    # Literal quote preserved
    assert post1.excerpt == literal_quote
    # Non-literal quote reset to empty
    assert post2.excerpt == ""


def test_legacy_cache_loading_drops_unverified_posts(monkeypatch, tmp_path):
    """Loading saved scan without link_status drops posts, recalculates virality/report_targets, and annotates note."""
    monkeypatch.setattr(storage, "intel_dir", lambda: tmp_path / "intel")

    m_path = storage.monitor_result_path()
    m_path.parent.mkdir(parents=True, exist_ok=True)

    legacy_snapshot_data = {
        "generated_at": "2026-10-29T12:00:00+00:00",
        "window_days": 14,
        "search_mode": "respaldo",
        "note": "Escaneo previo guardado.",
        "items": [
            {
                "id": "item1",
                "kind": "rumor",
                "headline": "Rumor antiguo con posts de IA",
                "summary": "Resumen antiguo.",
                "claim": "Afirmación antigua",
                "published": "2026-10-29",
                "first_seen": "2026-10-29T12:00:00+00:00",
                "sources": [
                    {
                        "id": "s1",
                        "url": "https://milenio.com/nota",
                        "title": "Milenio",
                        "domain": "milenio.com",
                        "tier": "medio_reconocido",
                    }
                ],
                "verdict": "falsa",
                "verdict_confidence": "media",
                "verdict_rationale": "Desmentido institucional.",
                "fact_checks": [],
                "topic": "organizacion_casillas",
                "geo": {"level": "nacional"},
                "intensity": 0.5,
                "persistence": "coyuntural",
                "virality": {
                    "score": 45,
                    "level": "media",
                    "platforms": ["facebook", "x"],
                    "posts": [
                        # Old posts WITHOUT link_status field
                        {
                            "platform": "facebook",
                            "url": "https://facebook.com/story.php?story_fbid=pfbid02z3p9n5T5t3c5v7g9d1u2x4k8q6g2v2",
                            "author": "@Facebook_User",
                            "excerpt": "Texto antiguo",
                        },
                        {
                            "platform": "x",
                            "url": "https://x.com/fake/status/999",
                            "author": "@fake",
                            "excerpt": "Texto antiguo 2",
                        },
                    ],
                    "projected_score_7d": 50,
                },
                "severity": {"level": "media", "score": 45, "drivers": ["Virality"]},
                "remediation": {
                    "action": "reportar_plataforma",
                    "secondary_actions": [],
                    "measures": ["Reportar"],
                    "rationale": "Reporte",
                    "report_targets": [
                        {
                            "platform": "facebook",
                            "url": "https://facebook.com/story.php?story_fbid=pfbid02z3p9n5T5t3c5v7g9d1u2x4k8q6g2v2",
                            "author": "@Facebook_User",
                            "reason": "Desinformación",
                        }
                    ],
                    "deadline_hours": 72,
                },
            }
        ],
        "counts": {"falsa": 1, "pendientes": 1},
    }

    storage.write_json_atomic(m_path, legacy_snapshot_data)
    mtime_before = m_path.stat().st_mtime_ns

    # Call latest_snapshot
    snap = monitor.latest_snapshot()
    assert snap is not None

    item = snap.items[0]
    # Virality has no posts left (all were sin_verificar)
    assert item.virality is None or len(item.virality.posts) == 0

    # report_targets should be empty
    assert len(item.remediation.report_targets) == 0

    # Note accounts for removed unverified links
    assert snap.note is not None
    assert "Se retiraron 2 enlaces a redes que no pudieron verificarse." in snap.note

    # File on disk was NOT rewritten
    mtime_after = m_path.stat().st_mtime_ns
    assert mtime_before == mtime_after


def test_grounding_rejects_hallucinated_urls_and_fake_authors(monkeypatch, tmp_path):
    """Under grounding mode, posts not present in grounding metadata are dropped.

    Authors are derived only from URL handle, never accepting @Facebook_User.
    """
    monkeypatch.setattr(storage, "intel_dir", lambda: tmp_path / "intel")

    monkeypatch.setattr(gemini, "is_enabled", lambda: True)
    monkeypatch.setattr(gemini, "_is_grounding_available", lambda: (True, None))

    class DummyGroundedSource:
        def __init__(self, url, title, domain):
            self.url = url
            self.title = title
            self.domain = domain

    class DummyGroundedResult:
        def __init__(self, sources, mode="grounding"):
            self.sources = sources
            self.queries = ["consulta"]
            self.model = "gemini-3.8-flash"
            self.mode = mode

    verified_x_url = "https://x.com/INE_Guerrero/status/1234567890"

    def mock_grounded_json(prompt, system=None, **kwargs):
        cache_key = kwargs.get("cache_key", "")
        if "rumores" in cache_key:
            return {
                "items": [
                    {
                        "headline": "Rumor de módulos en Guerrero",
                        "summary": "Rumor.",
                        "claim": "Publicaciones afirman cierre de módulos",
                        "topic": "credencial_padron",
                        "geo": {"level": "estatal", "ents": ["12"]},
                        "posts": [
                            # Post 1: URL is backed by grounding source
                            {
                                "platform": "x",
                                "url": verified_x_url,
                                "author": "@Invented_Author_Name",
                                "published": "2026-10-28",
                                "engagement": {"likes": 120, "shares": 30, "comments": 5, "views": 1500},
                                "excerpt": "Texto",
                            },
                            # Post 2: Hallucinated Facebook URL NOT in grounding sources
                            {
                                "platform": "facebook",
                                "url": "https://facebook.com/story.php?story_fbid=pfbid02z3p9n5T5t3c5v7g9d1u2x4k8q6g2v2",
                                "author": "@Facebook_User",
                                "engagement": {"likes": 500},
                            },
                        ],
                    }
                ]
            }, DummyGroundedResult(sources=[
                DummyGroundedSource(verified_x_url, "X Post", "x.com"),
                DummyGroundedSource("https://suracapulco.mx/nota", "El Sur", "suracapulco.mx"),
            ])
        return {"items": []}, DummyGroundedResult(sources=[])

    monkeypatch.setattr(gemini, "grounded_json", mock_grounded_json)

    req = MonitorScanRequest(window_days=14, refresh=True)
    snap = monitor.run_scan(req)

    item = snap.items[0]
    assert len(item.virality.posts) == 1
    post = item.virality.posts[0]
    assert post.url == verified_x_url
    # Author is taken from URL handle (@INE_Guerrero), NOT the AI hallucinated "@Invented_Author_Name"
    assert post.author == "@INE_Guerrero"
    assert post.link_status == "grounding"
    assert post.engagement.likes == 120

    # Note accounts for the 1 discarded fake post
    assert "1 publicación descartada" in snap.note
