"""Unit tests for deterministic intelligence models: impact, virality, and severity."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from pathlib import Path
import pytest
import pandas as pd
import numpy as np

from atalaya.config import DATA_DIR
from atalaya.intel.impact import campaign_prefill_for, news_impact
from atalaya.intel.schemas import (
    Engagement,
    GeoScope,
    NewsImpact,
    NewsTopic,
    Severity,
    SocialPost,
    StateImpact,
    Virality,
)
from atalaya.intel.severity import (
    decide_action,
    severity_fake,
    severity_true,
    template_remediation,
)
from atalaya.intel.virality import virality
from atalaya.model.scenarios import SCENARIOS


@pytest.fixture
def synthetic_units() -> pd.DataFrame:
    """Create a synthetic dataset of 3 states x 4 municipios with controlled values."""
    rows = []
    # States: 01, 02, 03
    for s_idx in range(1, 4):
        s_id = f"{s_idx:02d}"
        # 4 municipios per state
        for m_idx in range(1, 5):
            m_id = f"{s_id}{m_idx:03d}"
            rows.append({
                "id": m_id,
                "level": "mun",
                "cve_ent": s_id,
                "name": f"Municipio {m_id}",
                "lista_nominal": 10000 * m_idx,
                "pred_abstention": 0.35 + 0.05 * m_idx,
                "volatility_pp": 2.0 + 1.0 * m_idx,
                "pct_internet": 20.0 + 15.0 * m_idx,
                "pct_18_24": 10.0 + 2.0 * m_idx,
                "pct_rural": 80.0 - 15.0 * m_idx,
                "r_vuln": 0.2 + 0.1 * m_idx,
                "vulnerability_pp": 3.0 + 0.5 * m_idx,
                "category": "amarillo",
            })
        # State aggregate row
        rows.append({
            "id": s_id,
            "level": "state",
            "cve_ent": s_id,
            "name": f"Estado {s_id}",
            "lista_nominal": 100000 * s_idx,
            "pred_abstention": 0.45,
            "volatility_pp": 3.5,
            "pct_internet": 50.0,
            "pct_18_24": 15.0,
            "pct_rural": 40.0,
            "r_vuln": 0.4,
            "vulnerability_pp": 4.0,
            "category": "amarillo",
        })
    return pd.DataFrame(rows)


# ---------------------------------------------------------------- Impact tests


def test_decay_and_capping(synthetic_units):
    """Temporal decay: coyuntural (today 2026-10-28) << estructural; delta <= 3 pp; low <= delta <= high."""
    today = date(2026, 10, 28)
    geo = GeoScope(level="nacional")

    impact_coyuntural = news_impact(
        synthetic_units,
        topic="confianza_institucional",
        geo=geo,
        intensity=1.0,
        persistence="coyuntural",
        today=today,
    )
    impact_estructural = news_impact(
        synthetic_units,
        topic="confianza_institucional",
        geo=geo,
        intensity=1.0,
        persistence="estructural",
        today=today,
    )

    # Decaimiento coyuntural a 220+ días de la elección debe ser drásticamente menor que estructural
    assert impact_coyuntural.delta_pp_national < impact_estructural.delta_pp_national
    assert impact_coyuntural.params["decay"] < 0.05
    assert impact_estructural.params["decay"] == 1.0

    # Test capping at 3.0 pp and uncertainty band
    impact_max = news_impact(
        synthetic_units,
        topic="seguridad_violencia",
        geo=geo,
        intensity=1.0,
        persistence="estructural",
        today=today,
    )
    for u in impact_max.units:
        assert u.delta_pp <= 3.0
        assert u.delta_low_pp <= u.delta_pp
        assert u.delta_pp <= u.delta_high_pp
        assert u.delta_high_pp <= 3.0


def test_geographic_scopes(synthetic_units):
    """Estatal affects only requested ents; municipal affects muns (1.0) and same state (0.35); nacional all > 0."""
    today = date(2027, 5, 1)  # Close to election to avoid decay attenuation

    # 1. Estatal: only entity '01'
    geo_state = GeoScope(level="estatal", ents=["01"])
    imp_state = news_impact(
        synthetic_units,
        topic="seguridad_violencia",
        geo=geo_state,
        intensity=1.0,
        persistence="estructural",
        today=today,
    )
    affected_ids = [u.id for u in imp_state.units]
    assert "01" in affected_ids
    assert "02" not in affected_ids
    assert "03" not in affected_ids

    # 2. Municipal drill-down: specific mun in state '01'
    geo_mun = GeoScope(level="municipal", muns=["01001"])
    imp_mun = news_impact(
        synthetic_units,
        topic="seguridad_violencia",
        geo=geo_mun,
        intensity=1.0,
        persistence="estructural",
        today=today,
        level="mun",
        ent="01",
    )
    mun_dict = {u.id: u for u in imp_mun.units}
    assert mun_dict["01001"].exposure == 1.0
    # Other municipios in the same state get 0.35
    assert mun_dict["01002"].exposure == 0.35
    assert mun_dict["01001"].delta_pp > mun_dict["01002"].delta_pp

    # 3. Nacional scope: all states have exposure > 0
    geo_nac = GeoScope(level="nacional")
    imp_nac = news_impact(
        synthetic_units,
        topic="confianza_institucional",
        geo=geo_nac,
        intensity=1.0,
        persistence="estructural",
        today=today,
    )
    assert len(imp_nac.units) == 3
    for u in imp_nac.units:
        assert u.exposure > 0.5


def test_state_aggregation_and_ordering(synthetic_units):
    """State aggregation is LN-weighted, votes are consistent integers, sorted desc, filtered >= 0.05."""
    today = date(2027, 5, 1)
    geo = GeoScope(level="estatal", ents=["01", "02"])
    impact = news_impact(
        synthetic_units,
        topic="organizacion_casillas",
        geo=geo,
        intensity=0.8,
        persistence="estructural",
        today=today,
    )
    # Descending order
    deltas = [u.delta_pp for u in impact.units]
    assert deltas == sorted(deltas, reverse=True)
    # Filter >= 0.05
    for u in impact.units:
        assert u.delta_pp >= 0.05
        assert isinstance(u.votos_perdidos, int)
        assert u.votos_perdidos > 0


def test_real_data_smoke():
    """Smoke test with data/build/units.parquet if available: realistic magnitudes for national & state topics."""
    parquet_path = DATA_DIR / "build" / "units.parquet"
    if not parquet_path.is_file():
        pytest.skip("data/build/units.parquet not found")

    real_df = pd.read_parquet(parquet_path)
    today = date(2026, 10, 28)

    # 1. National institutional confidence shock, intensity 1.0, persistente -> national delta between 0.05 and 1.0 pp
    imp_nac = news_impact(
        real_df,
        topic="confianza_institucional",
        geo=GeoScope(level="nacional"),
        intensity=1.0,
        persistence="persistente",
        today=today,
    )
    assert 0.05 <= imp_nac.delta_pp_national <= 1.0

    # 2. State-level violence shock in Chiapas ('07'), estructural, intensity 1.0 -> Chiapas delta between 1.0 and 3.0 pp
    imp_chiapas = news_impact(
        real_df,
        topic="seguridad_violencia",
        geo=GeoScope(level="estatal", ents=["07"]),
        intensity=1.0,
        persistence="estructural",
        today=today,
    )
    chiapas_unit = next((u for u in imp_chiapas.units if u.id == "07"), None)
    assert chiapas_unit is not None
    assert 1.0 <= chiapas_unit.delta_pp <= 3.0


# ---------------------------------------------------------------- Virality tests


def test_virality_formula_cases():
    """Test virality score calculation across 4 distinct cases: empty, views, multi-platform, recent."""
    now = datetime(2026, 10, 28, 12, 0, 0)

    # Case 1: 1 post sin métricas (fallback e = 50, R = 0) -> baja (≈ 14)
    p1 = SocialPost(platform="x", url="https://x.com/post1")
    v1 = virality([p1], topic="otra", today=now)
    # 15*log10(51) + 0 + 3*1 + 0 - 15 = 25.61 + 3 - 15 = 13.61 -> round = 14
    assert v1.score == 14
    assert v1.level == "baja"

    # Case 2: 1 post con 5 mil vistas reciente (views=5000 -> e=250, R=8) -> media (32)
    p2 = SocialPost(
        platform="facebook",
        url="https://fb.com/post2",
        published=(now - timedelta(hours=12)).isoformat(),
        engagement=Engagement(views=5000),
    )
    v2 = virality([p2], topic="otra", today=now)
    # 15*log10(251) + 0 + 3*1 + 8 - 15 = 35.995 + 3 + 8 - 15 = 31.995 -> round = 32
    assert v2.score == 32
    assert v2.level == "media"
    assert v2.reach_estimate == 5000

    # Case 3: 3 posts en 3 plataformas con ~340 mil vistas -> alta (75–85)
    posts_340k = [
        SocialPost(platform="x", url="https://x.com/p1", engagement=Engagement(views=110000), published=(now - timedelta(hours=10)).isoformat()),
        SocialPost(platform="facebook", url="https://fb.com/p2", engagement=Engagement(views=110000), published=(now - timedelta(hours=20)).isoformat()),
        SocialPost(platform="tiktok", url="https://tiktok.com/p3", engagement=Engagement(views=120000), published=(now - timedelta(hours=30)).isoformat()),
    ]
    v3 = virality(posts_340k, topic="otra", today=now)
    assert 75 <= v3.score <= 85
    assert len(v3.platforms) == 3
    assert v3.reach_estimate == 340000

    # Case 4: >= 2.5 M vistas en 3 plataformas -> crítica
    posts_2_5m = [
        SocialPost(platform="x", url="https://x.com/p1", engagement=Engagement(views=1000000), published=(now - timedelta(hours=10)).isoformat()),
        SocialPost(platform="facebook", url="https://fb.com/p2", engagement=Engagement(views=1000000), published=(now - timedelta(hours=20)).isoformat()),
        SocialPost(platform="tiktok", url="https://tiktok.com/p3", engagement=Engagement(views=500000), published=(now - timedelta(hours=30)).isoformat()),
    ]
    v4 = virality(posts_2_5m, topic="otra", today=now)
    assert v4.score >= 85
    assert v4.level == "critica"


def test_virality_growth_and_projection():
    """Verify growth classification (creciente, estable, decreciente, desconocido) and 7d projection."""
    now = datetime(2026, 10, 28, 12, 0, 0)

    # Creciente: more posts in last 48h (e.g. 2) than in 48-168h (e.g. 0)
    p_growing = [
        SocialPost(platform="x", url="https://x.com/1", published=(now - timedelta(hours=10)).isoformat()),
        SocialPost(platform="x", url="https://x.com/2", published=(now - timedelta(hours=20)).isoformat()),
    ]
    v_growing = virality(p_growing, topic="credencial_padron", today=now)
    assert v_growing.growth == "creciente"
    assert v_growing.projected_score_7d == min(100, v_growing.score + 15)
    assert "desmovilizar" in v_growing.ignore_risk


# ---------------------------------------------------------------- Severity & Action tests


def test_severity_true_and_action_thresholds():
    """Verify exact thresholds for true news: bordes < 0.3 pp, < 1.0 pp, >= 1.0 pp."""
    # 1. max_delta_pp < 0.3 and votes < 50k -> registrar (168h)
    imp_low = NewsImpact(
        level="state",
        delta_pp_national=0.01,
        votos_perdidos_total=5000,
        units=[],
        max_delta_pp=0.20,
        assumptions=[],
        params={},
    )
    sev_low = severity_true(imp_low)
    act1, sec1, d1 = decide_action("verdadera", sev_low, max_delta_pp=0.20, votos_perdidos=5000)
    assert act1 == "registrar"
    assert d1 == 168

    # 2. max_delta_pp < 1.0 -> comunicado (72h)
    imp_mid = NewsImpact(
        level="state",
        delta_pp_national=0.08,
        votos_perdidos_total=60000,
        units=[],
        max_delta_pp=0.75,
        assumptions=[],
        params={},
    )
    sev_mid = severity_true(imp_mid)
    act2, sec2, d2 = decide_action("verdadera", sev_mid, max_delta_pp=0.75, votos_perdidos=60000)
    assert act2 == "comunicado"
    assert d2 == 72

    # 3. max_delta_pp >= 1.0 -> campana_intervencion (48h) + comunicado secundaria
    imp_high = NewsImpact(
        level="state",
        delta_pp_national=0.25,
        votos_perdidos_total=150000,
        units=[],
        max_delta_pp=1.80,
        assumptions=[],
        params={},
    )
    sev_high = severity_true(imp_high)
    act3, sec3, d3 = decide_action("verdadera", sev_high, max_delta_pp=1.80, votos_perdidos=150000)
    assert act3 == "campana_intervencion"
    assert "comunicado" in sec3
    assert d3 == 48


def test_severity_fake_and_action_thresholds():
    """Verify thresholds for fake news: bordes 30, 55, 75, plazos, and sin_verificar discount (x0.7)."""
    # Test unverified discount
    v_base = Virality(
        score=70,
        level="alta",
        platforms=["x"],
        posts=[],
        growth="estable",
        projected_score_7d=75,
    )
    # For falsa with harm=1.0 (credencial_padron): 70 * (0.5 + 0.5*1.0) = 70
    sev_falsa = severity_fake(v_base, topic="credencial_padron", verdict="falsa")
    assert sev_falsa.score == 70

    # For sin_verificar: 70 * 0.7 = 49
    sev_sin_verificar = severity_fake(v_base, topic="credencial_padron", verdict="sin_verificar")
    assert sev_sin_verificar.score == 49

    # Action thresholds for false items with posts:
    # < 30: registrar (168h)
    act1, _, d1 = decide_action("falsa", Severity(level="baja", score=25), has_posts=True)
    assert act1 == "registrar"
    assert d1 == 168

    # < 55: responder_corregir (48h)
    act2, _, d2 = decide_action("falsa", Severity(level="media", score=50), has_posts=True)
    assert act2 == "responder_corregir"
    assert d2 == 48

    # < 75: reportar_plataforma (24h) + responder_corregir
    act3, sec3, d3 = decide_action("falsa", Severity(level="alta", score=65), has_posts=True)
    assert act3 == "reportar_plataforma"
    assert "responder_corregir" in sec3
    assert d3 == 24

    # >= 75: desmentido_oficial (12h) + reportar + responder
    act4, sec4, d4 = decide_action("falsa", Severity(level="critica", score=85), has_posts=True)
    assert act4 == "desmentido_oficial"
    assert "reportar_plataforma" in sec4
    assert "responder_corregir" in sec4
    assert d4 == 12


def test_template_remediation():
    """template_remediation produces valid text lengths and report targets."""
    item = {
        "verdict": "falsa",
        "topic": "credencial_padron",
        "headline": "Afirman falsamente que la credencial 2026 ya no es válida",
        "posts": [
            {"platform": "x", "url": "https://x.com/desinfo1", "author": "@rumorero"},
            {"platform": "facebook", "url": "https://fb.com/desinfo2", "author": "PaginaViral"},
        ],
    }
    sev = Severity(level="critica", score=85)
    rem = template_remediation(item, "desmentido_oficial", sev)

    assert rem.action == "desmentido_oficial"
    assert rem.deadline_hours == 12
    assert rem.degraded is True
    assert len(rem.measures) >= 3
    assert len(rem.report_targets) == 2
    assert rem.draft_message is not None
    # Word count check: <= 180 words
    assert len(rem.draft_message.split()) <= 180


def test_campaign_prefill_ranges():
    """campaign_prefill_for is valid against model.scenarios.SCENARIOS ranges (existing levers, <= 4, effect <= 10)."""
    impact = NewsImpact(
        level="state",
        delta_pp_national=0.20,
        votos_perdidos_total=80000,
        units=[
            StateImpact(
                id="07", name="Chiapas", level="state", delta_pp=2.4, delta_low_pp=1.2, delta_high_pp=3.0,
                votos_perdidos=50000, exposure=1.0, category_before="naranja", category_after="rojo"
            ),
            StateImpact(
                id="12", name="Guerrero", level="state", delta_pp=1.8, delta_low_pp=0.9, delta_high_pp=2.7,
                votos_perdidos=30000, exposure=1.0, category_before="amarillo", category_after="naranja"
            ),
        ],
        max_delta_pp=2.4,
        assumptions=[],
        params={},
    )

    intervencion_spec = next(s for s in SCENARIOS if s.get("id") == "intervencion")
    lever_param = next(p for p in intervencion_spec.get("params", []) if p.get("key") == "lever")
    valid_levers = {opt["value"] for opt in lever_param.get("options", [])}

    # 1. Normal topic: single campaign
    prefill1 = campaign_prefill_for(impact, topic="credencial_padron")
    assert len(prefill1["campaigns"]) <= 4
    for c in prefill1["campaigns"]:
        assert c["lever"] in valid_levers
        assert 0.0 <= c["effect_pp"] <= 10.0
        assert c["targeting"] == "todos"
        assert c["coverage"] == 80.0
        assert "07" in c["ents"]

    # 2. Seguridad topic: 2 campaigns
    prefill_seg = campaign_prefill_for(impact, topic="seguridad_violencia")
    assert len(prefill_seg["campaigns"]) == 2
    levers_used = [c["lever"] for c in prefill_seg["campaigns"]]
    assert len(set(levers_used)) == 2  # Levers must be distinct
    for c in prefill_seg["campaigns"]:
        assert c["lever"] in valid_levers
        assert c["effect_pp"] <= 10.0
