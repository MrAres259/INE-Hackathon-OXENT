import React from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ExplainCard } from "../components/explain/ExplainCard";
import { ContextCard } from "../components/explain/ContextCard";
import { EvidenceBadge } from "../components/explain/EvidenceBadge";
import type { Explanation, ContextResult } from "../lib/explain/types";

const mockExplanation: Explanation = {
  unit_id: "23",
  level: "state",
  name: "Quintana Roo",
  state_name: null,
  category: "rojo",
  risk_score: 59.5,
  pred_abstention_pct: 48.2,
  headline: "Alta abstención histórica persistente y baja participación juvenil",
  in_short: [
    "La entidad presenta una abstención constante por encima del promedio nacional.",
    "El grupo de jóvenes de 18 a 29 años muestra la menor tasa de participación.",
  ],
  reasons: [
    {
      id: "r-semaforo",
      kind: "semaforo",
      title: "Riesgo Crítico por semáforo",
      body: "El índice combina cuatro componentes ponderados.",
      strength: "fuerte",
      evidence_type: "calculo_del_modelo",
      direction: "sube_abstencion",
      numbers: [],
      source: "Modelo Atalaya",
    },
    {
      id: "r-historial",
      kind: "historial",
      title: "Patrón histórico desfavorable",
      body: "Ha votado por debajo de la media nacional en 5 de las últimas 6 elecciones.",
      strength: "fuerte",
      evidence_type: "dato_medido",
      direction: "sube_abstencion",
      numbers: [],
      source: "Cómputos INE 2009–2024",
    },
    {
      id: "r-quien",
      kind: "quien_no_vota",
      title: "Baja participación de jóvenes",
      body: "La participación de jóvenes de 18 a 29 años fue 12 puntos menor que la de adultos mayores.",
      strength: "fuerte",
      evidence_type: "dato_medido",
      direction: "sube_abstencion",
      numbers: [],
      source: "Estudio Muestral INE",
    },
    {
      id: "r-urbano",
      kind: "urbano_rural",
      title: "Zonas mixtas con menor afluencia",
      body: "Las secciones de tipo mixto registran brecha de participación.",
      strength: "moderada",
      evidence_type: "dato_medido",
      direction: "sube_abstencion",
      numbers: [],
      source: "Estudio Muestral INE",
    },
    {
      id: "r-contexto",
      kind: "contexto",
      title: "Crecimiento poblacional y movilidad",
      body: "Más del 50 % de la población nació en otra entidad federativa.",
      strength: "debil",
      evidence_type: "contexto_descriptivo",
      direction: "neutral",
      numbers: [],
      source: "Censo INEGI 2020",
    },
  ],
  score_breakdown: [
    {
      key: "abs",
      label: "Abstención esperada",
      weight: 0.5,
      rank_pct: 78.0,
      points: 39.0,
      plain: "Abstención esperada más alta que el 78 % de las entidades",
    },
    {
      key: "vuln",
      label: "Vulnerabilidad demográfica",
      weight: 0.2,
      rank_pct: 53.0,
      points: 10.6,
      plain: "Composición juvenil y dispersión moderada",
    },
    {
      key: "trend",
      label: "Tendencia histórica",
      weight: 0.15,
      rank_pct: 47.0,
      points: 7.05,
      plain: "Tendencia de menor participación relativa",
    },
    {
      key: "vol",
      label: "Volatilidad",
      weight: 0.15,
      rank_pct: 19.0,
      points: 2.85,
      plain: "Baja variación entre elecciones consecutivas",
    },
  ],
  groups: [
    {
      group: "Jóvenes 18–29",
      participation_pct: 38.5,
      share_ln_pct: 28.0,
      share_abstainers_pct: 35.0,
      suppressed: false,
    },
    {
      group: "Sección protegida",
      participation_pct: null,
      share_ln_pct: null,
      share_abstainers_pct: null,
      suppressed: true,
    },
  ],
  what_we_dont_know: [
    "No se dispone de desglose en casillas con menos de 10 electores para proteger la secrecía.",
  ],
  confidence: "alta",
  confidence_note: "Datos completos con 6 elecciones comparables.",
  recommendations: [
    {
      title: "Instalación de casillas especiales en corredores laborales",
      rationale: "Facilita la votación de personas en sector servicios durante la jornada.",
      priority: "alta",
    },
  ],
  suggested_questions: [
    {
      id: "sq-1",
      text: "¿Por qué los jóvenes participan menos en Quintana Roo?",
      intent_hint: "profile",
    },
    {
      id: "sq-2",
      text: "¿Cómo ha evolucionado la abstención?",
      intent_hint: "trend",
    },
  ],
  sources: ["Cómputos Distritales Federales 2009–2024", "Censo 2020"],
  data_year: 2024,
  scenario_note: "Pronóstico bajo escenario base para 2027.",
  generated_at: "2026-10-31T12:00:00Z",
};

const mockContextResult: ContextResult = {
  unit_id: "23",
  name: "Quintana Roo",
  level: "state",
  findings: [
    {
      id: "f-1",
      title: "Movilidad laboral en zonas turísticas durante la jornada electoral",
      summary: "Medios regionales informan sobre dificultades de traslado para trabajadores del sector hotelero.",
      category: "movilidad",
      category_label: "Movilidad y transporte",
      scope: "estado",
      verification: "cita_verificada",
      quote: "El personal de turno dominical en la zona hotelera reportó dificultades para acudir a casillas lejanas.",
      sources: [
        {
          url: "https://ejemplo.mx/noticia-transporte",
          title: "Reporte de movilidad laboral",
          domain: "ejemplo.mx",
          outlet: "Diario de Quintana Roo",
          tier: "medio_regional",
          published: "2024-06-03",
        },
      ],
    },
    {
      id: "f-2",
      title: "Capacitación a funcionarios de casilla",
      summary: "Autoridades electorales concluyeron la entrega de paquetes sin incidentes mayores.",
      category: "organizacion",
      category_label: "Organización electoral",
      scope: "estado",
      verification: "fuente_verificada",
      quote: null,
      sources: [
        {
          url: "https://noticias.org/capacitacion",
          title: "Avance de organización",
          domain: "noticias.org",
          outlet: "Agencia Electoral",
          tier: "oficial",
          published: "2024-05-28",
        },
      ],
    },
  ],
  search_mode: "grounding",
  model: "gemini-3.6-flash",
  generated_at: "2026-10-31T12:05:00Z",
  from_cache: false,
  degraded: false,
  note: null,
  disclaimer: "Información extraída de fuentes periodísticas públicas verificadas.",
};

describe("ExplainCard Component Suite (explainCard.test.tsx)", () => {
  it("renders headline, header metadata and in_short summary", () => {
    const html = renderToStaticMarkup(
      <ExplainCard explanation={mockExplanation} variant="chat" />
    );

    expect(html).toContain("Alta abstención histórica persistente y baja participación juvenil");
    expect(html).toContain("Quintana Roo");
    expect(html).toContain("Riesgo Crítico");
    expect(html).toContain("Índice 59.5 de 100");
    expect(html).not.toContain("Score");
    expect(html).toContain("En pocas palabras");
    expect(html).toContain("La entidad presenta una abstención constante por encima del promedio nacional.");
  });

  it("renders full zone name without truncation and Spanish index in 2-row header", () => {
    const longNameExpl: Explanation = {
      ...mockExplanation,
      name: "Dolores Hidalgo Cuna de la Independencia Nacional",
      state_name: "Guanajuato",
      risk_score: 74.2,
      category: "alto",
    };
    const html = renderToStaticMarkup(
      <ExplainCard explanation={longNameExpl} variant="panel" />
    );
    expect(html).toContain("Dolores Hidalgo Cuna de la Independencia Nacional (Guanajuato)");
    expect(html).toContain("Riesgo Alto");
    expect(html).toContain("Índice 74.2 de 100");
    expect(html).not.toContain("Score");
  });

  it("renders stacked bar with 4 segments and accessible aria-label", () => {
    const html = renderToStaticMarkup(
      <ExplainCard explanation={mockExplanation} variant="chat" />
    );

    // role="img" with aria-label
    expect(html).toContain('role="img"');
    expect(html).toContain(
      'aria-label="Abstención esperada: 39.0 puntos, Vulnerabilidad demográfica: 10.6 puntos, Tendencia histórica: 7.0 puntos, Volatilidad: 2.9 puntos"'
    );

    // Plain text list underneath
    expect(html).toContain("Abstención esperada (39.0 pts):");
    expect(html).toContain("Vulnerabilidad demográfica (10.6 pts):");
    expect(html).toContain("Tendencia histórica (7.0 pts):");
    expect(html).toContain("Volatilidad (2.9 pts):");
  });

  it("renders EvidenceBadge with labels and 3-dot visual indicator", () => {
    const htmlFuerte = renderToStaticMarkup(
      <EvidenceBadge type="dato_medido" strength="fuerte" />
    );
    expect(htmlFuerte).toContain("Dato medido");
    expect(htmlFuerte).toContain("Fuerte");
    expect(htmlFuerte).toContain("●●●");

    const htmlModerada = renderToStaticMarkup(
      <EvidenceBadge type="asociacion" strength="moderada" />
    );
    expect(htmlModerada).toContain("Relación (no prueba causa)");
    expect(htmlModerada).toContain("Moderada");
    expect(htmlModerada).toContain("●●○");

    const htmlDebil = renderToStaticMarkup(
      <EvidenceBadge type="contexto_descriptivo" strength="debil" />
    );
    expect(htmlDebil).toContain("Dato de contexto");
    expect(htmlDebil).toContain("Débil");
    expect(htmlDebil).toContain("●○○");
  });

  it("variant='panel' limits to 3 reasons and displays 'Ver todas' button and 'Explícamelo en el asistente'", () => {
    const htmlPanel = renderToStaticMarkup(
      <ExplainCard
        explanation={mockExplanation}
        variant="panel"
        onExplainInChat={() => {}}
      />
    );

    // Skips "semaforo", shows first 3 of remaining 4 reasons
    expect(htmlPanel).toContain("Patrón histórico desfavorable");
    expect(htmlPanel).toContain("Baja participación de jóvenes");
    expect(htmlPanel).toContain("Zonas mixtas con menor afluencia");
    // 4th reason is hidden initially in panel
    expect(htmlPanel).not.toContain("Crecimiento poblacional y movilidad");

    // Shows "Ver todas (4)" button
    expect(htmlPanel).toContain("Ver todas (4)");

    // Shows "Explícamelo en el asistente" button
    expect(htmlPanel).toContain("Explícamelo en el asistente");
  });

  it("renders protected groups cells with 'Protegido' label and privacy notice", () => {
    const html = renderToStaticMarkup(
      <ExplainCard explanation={mockExplanation} variant="chat" />
    );

    expect(html).toContain("Quiénes votan menos");
    expect(html).toContain("Jóvenes 18–29");
    expect(html).toContain("38.5%");
    expect(html).toContain("Sección protegida");
    expect(html).toContain("Protegido");
  });
});

describe("ContextCard Component Suite (explainCard.test.tsx)", () => {
  it("renders verified quote with 'Cita comprobada en la fuente' vs 'Fuente confiable' badge", () => {
    const html = renderToStaticMarkup(<ContextCard result={mockContextResult} />);

    expect(html).toContain("Contexto público reciente");
    expect(html).toContain("Movilidad laboral en zonas turísticas durante la jornada electoral");
    expect(html).toContain("«El personal de turno dominical en la zona hotelera reportó dificultades para acudir a casillas lejanas.»");
    expect(html).toContain("Cita comprobada en la fuente");
    expect(html).toContain("Fuente confiable");
    expect(html).toContain("Modo de búsqueda:");
    expect(html).toContain("completa");
    expect(html).toContain("gemini-3.6-flash");
  });

  it("renders source links with target='_blank' and rel='noopener noreferrer'", () => {
    const html = renderToStaticMarkup(<ContextCard result={mockContextResult} />);

    expect(html).toContain('href="https://ejemplo.mx/noticia-transporte"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("Diario de Quintana Roo");
  });

  it("renders neutral note when degraded or without findings", () => {
    const degradedResult: ContextResult = {
      ...mockContextResult,
      findings: [],
      degraded: true,
      note: "No se encontraron noticias verificadas en las últimas 72 horas.",
    };

    const html = renderToStaticMarkup(<ContextCard result={degradedResult} />);
    expect(html).toContain("Aviso de contexto");
    expect(html).toContain("No se encontraron noticias verificadas en las últimas 72 horas.");
  });
});
