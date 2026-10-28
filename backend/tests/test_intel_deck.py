"""Tests for atalaya.intel.deck (Campaign Plan slides, PPTX and PDF export)."""

from __future__ import annotations

from pathlib import Path
import re
import pytest

from pptx import Presentation

from atalaya.intel.deck import (
    SLIDE_KINDS_ORDER,
    build_slides,
    export_filename,
    export_pdf,
    export_pptx,
    region_svg,
    render_html,
)
from atalaya.intel.schemas import (
    CampaignPlan,
    DataSnapshot,
    DriverBrief,
    Finding,
    ImpactAnalysis,
    ImplementationStep,
    LLMInfo,
    Proposal,
    ProposalImpact,
    ResearchBundle,
    RiskItem,
    Slide,
    SourceRef,
    TargetGroup,
)
from atalaya.report.charts import CATEGORY_COLORS, find_browser


def _make_synthetic_plan(
    *,
    unit_id: str = "07",
    unit_name: str = "Chiapas",
    level: str = "state",
    ent: str = "07",
    degraded: bool = False,
    xss: bool = False,
) -> CampaignPlan:
    """Builds a valid CampaignPlan with all contract fields."""
    finding_title = "<script>alert('xss')</script> Falta de casillas rurales" if xss else "Falta de casillas rurales en zonas dispersas"
    finding_summary = (
        "Los electores deben desplazarse más de 2 horas en transporte público para votar. "
        "<img src=x onerror=alert(1)>" if xss else
        "Los electores deben desplazarse más de 2 horas en transporte público para llegar a su mesa de votación."
    )

    sources = [
        SourceRef(
            id="s1",
            url="https://centralelectoral.ine.mx/comunicado-casillas",
            title="Informe de Cobertura de Casillas 2024",
            domain="centralelectoral.ine.mx",
            outlet="INE Central Electoral",
            tier="oficial",
            published="2026-05-10",
        ),
        SourceRef(
            id="s2",
            url="https://eluniversal.com.mx/estados/chiapas-participacion",
            title="Factores de abstención en la frontera sur",
            domain="eluniversal.com.mx",
            outlet="El Universal",
            tier="medio_reconocido",
            published="2026-06-01",
        ),
    ]

    findings = [
        Finding(
            id="f1",
            title=finding_title,
            summary=finding_summary,
            category="acceso_casillas_distancia",
            evidence=["s1", "s2"],
            scope="estado",
            confidence="alta",
        ),
        Finding(
            id="f2",
            title="Apatía y desconfianza en juventudes de 18 a 24 años",
            summary="Los jóvenes manifiestan desinterés y escaso conocimiento sobre el proceso electoral federal.",
            category="apatia_desafeccion",
            evidence=["s1"],
            scope="estado",
            confidence="media",
        ),
    ]

    snapshot = DataSnapshot(
        unit_id=unit_id,
        name=unit_name,
        level=level,  # type: ignore[arg-type]
        ent=ent,
        ent_name="Chiapas",
        lista_nominal=3850000,
        pred_abstention=0.482,
        pred_low=0.451,
        pred_high=0.513,
        category="rojo",
        risk_score=78.5,
        last_participation=0.518,
        last_year=2024,
        trend_pp=-1.3,
        abstencion_esperada=1855700,
        part_18_34_last=0.418,
        gap_youth_pp_last=-6.4,
        pct_18_24=14.2,
        pct_rural=49.1,
        pct_hli=28.5,
        pct_internet=52.3,
        im_2020=0.82,
        drivers=[
            DriverBrief(label="Alta ruralidad y dispersión", contribution_pp=3.2),
            DriverBrief(label="Baja penetración digital", contribution_pp=2.1),
            DriverBrief(label="Desafección juvenil", contribution_pp=1.8),
        ],
        recommendations=["Rutas móviles de credencialización", "Materiales en tsotsil y tseltal"],
        municipios=124,
        municipios_rojos=42,
    )

    research = ResearchBundle(
        unit_id=unit_id,
        unit_name=unit_name,
        level=level,  # type: ignore[arg-type]
        findings=[] if degraded else findings,
        sources=[] if degraded else sources,
        discarded_sources=2,
        queries=["participacion electoral chiapas 2024", "causas abstencionismo chiapas"],
        generated_at="2026-10-28T14:30:00Z",
        model="gemini-3.8-flash",
        from_cache=False,
        degraded=degraded,
        note="Investigación degradada por falta de conectividad" if degraded else None,
    )

    target_groups = [
        TargetGroup(
            name="Jóvenes universitarios y primerizos (18-24)",
            description="Electores que sufragan por primera vez, concentrados en cabeceras distritales.",
            size_estimate=546000,
            size_basis="Cálculo demográfico sobre el 14.2% de la Lista Nominal.",
        ),
        TargetGroup(
            name="Comunidades rurales de alta dispersión",
            description="Poblaciones alejadas de las cabeceras municipales con baja conectividad.",
            size_estimate=890000,
            size_basis="Población rural del Censo INEGI 2020.",
        ),
    ]

    proposals = [
        Proposal(
            id="p1",
            title="Módulos Móviles y Transporte Cívico Rural",
            description="Instalación de casillas extraordinarias y rutas de transporte comunitario.",
            lever="casillas_rurales",
            channels=["Rutas comunitarias", "Convocatoria con autoridades ejidales"],
            target_group="Comunidades rurales de alta dispersión",
            addresses=["f1"],
            effect_pp=2.5,
            coverage=85.0,
            targeting="rojo",
            rationale="Disminuye la distancia física y barreras de transporte.",
        ),
        Proposal(
            id="p2",
            title="Embajadores Democráticos Universitarios",
            description="Brigadas cívicas en tecnológicos y universidades públicas estatales.",
            lever="promocion_jovenes",
            channels=["Redes institucionales", "Talleres cívicos"],
            target_group="Jóvenes universitarios y primerizos (18-24)",
            addresses=["f2"],
            effect_pp=1.8,
            coverage=75.0,
            targeting="todos",
            rationale="Activa la participación juvenil de primera vez.",
        ),
    ]

    impact = ImpactAnalysis(
        campaigns=[
            {"lever": "casillas_rurales", "targeting": "rojo", "effect_pp": 2.5, "coverage": 85.0},
            {"lever": "promocion_jovenes", "targeting": "todos", "effect_pp": 1.8, "coverage": 75.0},
        ],
        abstention_base=0.482,
        abstention_scenario=0.455,
        delta_pp=-2.7,
        votos_adicionales=103950,
        category_before="rojo",
        category_after="naranja",
        municipios_mejoran=18,
        per_proposal=[
            ProposalImpact(proposal_id="p1", lever="casillas_rurales", votos_solo=65000),
            ProposalImpact(proposal_id="p2", lever="promocion_jovenes", votos_solo=48000),
        ],
        overlap_votos=9050,
        assumptions=[
            "Efecto calibrado con rendimientos decrecientes y solapamiento del 8.7%.",
            "Escenario hipotético no causal, condicionado al despliegue operativo pleno.",
        ],
    )

    steps = [
        ImplementationStep(
            order=1,
            phase="Diagnóstico preparatorio",
            start="2026-11-01",
            end="2026-12-15",
            actions=["Mapeo de rutas de transporte", "Convenios con universidades"],
            responsible="Junta Local Ejecutiva",
            kpi="100% de rutas críticas censadas",
        ),
        ImplementationStep(
            order=2,
            phase="Despliegue operativo y materiales",
            start="2027-01-15",
            end="2027-04-30",
            actions=["Distribución de materiales", "Activación de brigadas"],
            responsible="Vocalía de Capacitación Electoral",
            kpi="85% de planteles visitados",
        ),
        ImplementationStep(
            order=3,
            phase="Movilización previa y veda",
            start="2027-05-01",
            end="2027-05-31",
            actions=["Recordatorio de ubicación de casillas", "Cierre antes de veda"],
            responsible="Coordinación Nacional de Comunicación",
            kpi="Alcance territorial del 90%",
        ),
    ]

    risks = [
        RiskItem(
            risk="Dificultades de acceso por condiciones climáticas en la sierra.",
            mitigation="Previsión de vehículos 4x4 y resguardo anticipado de materiales electorales.",
        ),
        RiskItem(
            risk="Desconfianza hacia brigadas institucionales en comunidades indígenas.",
            mitigation="Acompañamiento de líderes comunitarios y traductores certificados en lengua materna.",
        ),
    ]

    kpis = [
        "Incremento de participación juvenil en al menos 2.0 pp.",
        "Cobertura territorial de transporte en el 85% de las localidades prioritarias.",
        "Reducción neta del abstencionismo territorial estimada en 2.7 pp.",
    ]

    return CampaignPlan(
        id="cplan_test001",
        unit=snapshot,
        research=research,
        focus="Jóvenes y comunidades rurales",
        objective="Mitigar el abstencionismo estructural en Chiapas mediante casillas rurales y movilización juvenil.",
        target_groups=target_groups,
        proposals=proposals,
        impact=impact,
        steps=steps,
        risks=risks,
        kpis=kpis,
        slides=[],
        generated_at="2026-10-28T14:30:00Z",
        llm=LLMInfo(model="glm-5.3", effort="high", degraded=degraded),
    )


# ---------------------------------------------------------------- Tests

def test_build_slides_structure_and_limits():
    """Verifies 10 deterministic slides in exact order, limit of bullets and length, and source citations."""
    plan = _make_synthetic_plan()
    slides = build_slides(plan)

    assert len(slides) == 10
    kinds = [s.kind for s in slides]
    assert kinds == SLIDE_KINDS_ORDER

    for idx, s in enumerate(slides):
        assert s.id == f"sl{idx + 1}"
        assert len(s.bullets) <= 6, f"Slide {s.id} ({s.kind}) has > 6 bullets: {len(s.bullets)}"
        for b in s.bullets:
            assert len(b) <= 160, f"Bullet in {s.id} exceeds 160 chars ({len(b)}): {b}"
        # Speaker notes: 2-4 sentences, meaningful text
        assert len(s.notes.strip()) > 30, f"Notes in {s.id} too short"
        sentences = [sent for sent in re.split(r"[.!?]+", s.notes) if sent.strip()]
        assert 2 <= len(sentences) <= 5, f"Notes in {s.id} sentence count {len(sentences)} not in [2, 5]"

    # Slide 3 (problematicas) should contain [s1] or [s2]
    sl3 = slides[2]
    assert sl3.kind == "problematicas"
    bullets_text = " ".join(sl3.bullets)
    assert "[s1" in bullets_text or "[s2" in bullets_text


def test_build_slides_degraded_mode():
    """Verifies that in degraded mode, slide 3 identifies degraded mode and uses model factors."""
    plan = _make_synthetic_plan(degraded=True)
    slides = build_slides(plan)

    sl3 = slides[2]
    assert sl3.kind == "problematicas"
    assert "Factores asociados según el modelo" in sl3.subtitle
    assert sl3.data.get("degraded") is True
    # Bullets should mention factors from model
    bullets_text = " ".join(sl3.bullets)
    assert "modelo Atalaya" in bullets_text or "Factor" in bullets_text


def test_region_svg_state_and_mun():
    """Verifies region_svg output contains only IDs from the state and uses palette colors."""
    # State level
    plan_state = _make_synthetic_plan(unit_id="07", level="state", ent="07")
    svg_state = region_svg(plan_state)

    assert svg_state.startswith("<svg")
    assert svg_state.endswith("</svg>")
    # Check palette colors
    assert CATEGORY_COLORS["rojo"] in svg_state or CATEGORY_COLORS["naranja"] in svg_state or CATEGORY_COLORS["verde"] in svg_state

    # Check that any data-id or id in features strictly belongs to state '07'
    data_ids = re.findall(r'data-id="([^"]+)"', svg_state)
    assert len(data_ids) > 0
    for did in data_ids:
        assert did.startswith("07"), f"ID {did} does not belong to state 07"

    # Municipal level: target mun highlighted with magenta stroke
    plan_mun = _make_synthetic_plan(unit_id="07019", unit_name="Comitán de Domínguez", level="mun", ent="07")
    svg_mun = region_svg(plan_mun)

    assert svg_mun.startswith("<svg")
    assert 'data-id="07019"' in svg_mun
    assert 'stroke="#b5186b"' in svg_mun
    # Gray neighbor color present
    assert "#e4e4e7" in svg_mun


def test_render_html_escaping_and_logo():
    """Verifies HTML has 10 sections, embeds logo data URI, and properly escapes XSS."""
    plan = _make_synthetic_plan(xss=True)
    slides = build_slides(plan)
    html_out = render_html(plan, slides)

    # 10 slide sections
    section_count = len(re.findall(r'<section class="slide', html_out))
    assert section_count == 10

    # Logo data URI present
    assert "data:image/" in html_out

    # XSS escaping: <script> should NOT be present unescaped
    assert "<script>alert('xss')</script>" not in html_out
    assert "&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;" in html_out or "&lt;script&gt;" in html_out
    assert "<img src=x onerror=alert(1)>" not in html_out


def test_export_pptx(tmp_path: Path):
    """Verifies PowerPoint creation, 10 slides, editable titles, notes, and slide override."""
    plan = _make_synthetic_plan()
    slides = build_slides(plan)
    pptx_path = tmp_path / "plan_test.pptx"

    export_pptx(plan, pptx_path, slides)
    assert pptx_path.is_file()
    assert pptx_path.stat().st_size > 5000

    # Open with python-pptx
    prs = Presentation(str(pptx_path))
    assert len(prs.slides) == 10

    # Verify titles and notes
    for i, slide in enumerate(prs.slides):
        notes_text = slide.notes_slide.notes_text_frame.text
        assert len(notes_text.strip()) > 0, f"Slide {i+1} missing speaker notes"

    # Test override of slides
    overridden_slides = build_slides(plan)
    overridden_slides[1].title = "TITULO EDITADO POR OPERADOR"
    overridden_path = tmp_path / "plan_overridden.pptx"
    export_pptx(plan, overridden_path, overridden_slides)

    prs_ov = Presentation(str(overridden_path))
    slide2 = prs_ov.slides[1]
    slide2_texts = []
    for shape in slide2.shapes:
        if shape.has_text_frame:
            slide2_texts.append(shape.text_frame.text)
    assert any("TITULO EDITADO POR OPERADOR" in t for t in slide2_texts)


def test_export_pdf(tmp_path: Path):
    """Verifies PDF generation via Chrome/Edge, checks 10 page count if browser is installed."""
    try:
        find_browser()
    except RuntimeError:
        pytest.skip("Chrome/Edge browser not found for PDF export test")

    plan = _make_synthetic_plan()
    slides = build_slides(plan)
    pdf_path = tmp_path / "plan_test.pdf"

    export_pdf(plan, pdf_path, slides)
    assert pdf_path.is_file()
    assert pdf_path.stat().st_size > 10000

    # Verify exactly 10 pages in PDF
    pdf_bytes = pdf_path.read_bytes()
    page_count = len(re.findall(rb"/Type\s*/Page\b", pdf_bytes))
    assert page_count == 10, f"PDF has {page_count} pages, expected exactly 10"


def test_export_filename():
    """Verifies filename format, absence of accents and spaces."""
    plan = _make_synthetic_plan(unit_name="San Cristóbal de Las Casas", ent="07")
    plan.generated_at = "2026-10-28T15:00:00Z"

    filename = export_filename(plan, "pptx")
    assert filename == "AtalayaElectoral_PlanCampana_san-cristobal-de-las-casas_20261028.pptx"

    # No accents or spaces allowed
    assert " " not in filename
    assert not re.search(r"[áéíóúÁÉÍÓÚñÑ]", filename)

    pdf_filename = export_filename(plan, "pdf")
    assert pdf_filename.endswith(".pdf")
