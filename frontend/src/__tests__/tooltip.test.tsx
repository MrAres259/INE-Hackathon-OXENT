import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MapTooltip } from "../components/map/MapTooltip";
import { AtalayaContext, type AtalayaContextValue } from "../lib/state";
import { MOCK_META } from "../lib/mocks/meta";
import type { HoverInfo } from "../components/map/AtalayaMap";
import type { RiskItem } from "../lib/types";

function renderTooltipWithContext(
  hover: HoverInfo | null,
  contextOverrides: Partial<AtalayaContextValue> = {}
) {
  const mockContext: AtalayaContextValue = {
    scenario: "intervencion",
    setScenario: () => {},
    scenarioParams: {},
    setScenarioParams: () => {},
    paramsByScenario: { intervencion: {}, pesimista: {} },
    leverParams: {},
    applyScenarioParams: async () => undefined,
    resetScenarioParams: async () => {},
    isScenarioModified: () => false,
    level: "mun",
    selectedEnt: "02",
    selectedRegionId: "02001",
    selectedDetail: null,
    loadingDetail: false,
    meta: MOCK_META,
    riskItems: [],
    loadingRisk: false,
    simulationResult: null,
    isMock: false,
    isScenarioModalOpen: false,
    setIsScenarioModalOpen: () => {},
    health: null,
    apiAvailable: true,
    hasData: true,
    mapMode: "semaforo",
    setMapMode: () => {},
    extrude3d: false,
    setExtrude3d: () => {},
    view3d: "inclinada",
    setView3d: () => {},
    comparePos: 50,
    setComparePos: () => {},
    selectState: () => {},
    selectMunicipality: () => {},
    selectRegion: () => {},
    resetToNational: () => {},
    runSimulation: async () => {},
    ...contextOverrides,
  };

  return renderToStaticMarkup(
    <AtalayaContext.Provider value={mockContext}>
      <MapTooltip hover={hover} />
    </AtalayaContext.Provider>
  );
}

describe("MapTooltip Base vs Intervention and Scenario Display", () => {
  const baseItem: RiskItem = {
    id: "02001",
    name: "Ensenada",
    level: "mun",
    ent: "02",
    lista_nominal: 350000,
    last_year: 2024,
    last_participation: 0.42,
    pred_participation: 0.393,
    pred_abstention: 0.607, // 60.7 %
    pred_low: 0.58,
    pred_high: 0.63,
    trend_pp: -1.2,
    risk_score: 82,
    category: "rojo",
  };

  const altItem: RiskItem = {
    ...baseItem,
    pred_participation: 0.489,
    pred_abstention: 0.511, // 51.1 %
    delta_vs_base_pp: -9.6,
    risk_score: 52,
    category: "amarillo",
  };

  it("renders distinct base (60.7 %) and intervention (51.1 %) values with -9.6 pp delta", () => {
    const hover: HoverInfo = {
      id: "02001",
      level: "mun",
      name: "Ensenada",
      ent: "02",
      x: 200,
      y: 150,
      base: baseItem,
      alt: altItem,
      item: altItem,
    };

    const html = renderTooltipWithContext(hover, { scenario: "intervencion" });

    // Both distinct values must be displayed
    expect(html).toContain("Sin intervención:");
    expect(html).toContain("60.7%");
    expect(html).toContain("Con intervención:");
    expect(html).toContain("51.1%");

    // Delta of -9.6 pp
    expect(html).toContain("−9.6 pp");
    expect(html).toContain("menos abstención");

    // Category transition in badge
    expect(html).toContain("Riesgo Moderado");
    expect(html).toContain("antes: Riesgo Crítico");
  });

  it("renders standard format when scenario is base (igual que hoy)", () => {
    const hover: HoverInfo = {
      id: "02001",
      level: "mun",
      name: "Ensenada",
      ent: "02",
      x: 200,
      y: 150,
      base: baseItem,
      alt: null,
      item: baseItem,
    };

    const html = renderTooltipWithContext(hover, { scenario: "base" });

    expect(html).toContain("Abstención 2027 (pronóstico):");
    expect(html).toContain("60.7%");
    expect(html).not.toContain("Sin intervención:");
    expect(html).not.toContain("Con intervención:");
    expect(html).not.toContain("antes:");
    expect(html).toContain("Riesgo Crítico");
  });

  it("renders scenario-specific label 'Con escenario pesimista' in pesimista scenario", () => {
    const pesimAltItem: RiskItem = {
      ...baseItem,
      pred_abstention: 0.627,
      delta_vs_base_pp: 2.0,
      risk_score: 88,
      category: "rojo",
    };

    const hover: HoverInfo = {
      id: "02001",
      level: "mun",
      name: "Ensenada",
      ent: "02",
      x: 200,
      y: 150,
      base: baseItem,
      alt: pesimAltItem,
      item: pesimAltItem,
    };

    const html = renderTooltipWithContext(hover, { scenario: "pesimista" });

    expect(html).toContain("Sin intervención:");
    expect(html).toContain("60.7%");
    expect(html).toContain("Con escenario pesimista:");
    expect(html).toContain("62.7%");
    expect(html).toContain("+2.0 pp");
    expect(html).toContain("más abstención");
  });

  it("returns null when hover is null", () => {
    const html = renderTooltipWithContext(null);
    expect(html).toBe("");
  });
});
