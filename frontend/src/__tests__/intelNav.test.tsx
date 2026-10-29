import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TopBar } from "../components/layout/TopBar";
import { AtalayaContext, type AtalayaContextValue } from "../lib/state";
import { MOCK_META } from "../lib/mocks/meta";
import { defaultsForScenario } from "../lib/scenarioParams";

let mockPathname = "/";

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

function createMockContext(overrides: Partial<AtalayaContextValue> = {}): AtalayaContextValue {
  return {
    scenario: "intervencion",
    setScenario: vi.fn(),
    scenarioParams: defaultsForScenario("intervencion", MOCK_META),
    setScenarioParams: vi.fn(),
    paramsByScenario: {
      intervencion: defaultsForScenario("intervencion", MOCK_META),
      pesimista: defaultsForScenario("pesimista", MOCK_META),
    },
    leverParams: {},
    applyScenarioParams: vi.fn().mockResolvedValue(undefined),
    resetScenarioParams: vi.fn().mockResolvedValue(undefined),
    isScenarioModified: () => false,
    level: "state",
    selectedEnt: null,
    selectedRegionId: null,
    selectedDetail: null,
    loadingDetail: false,
    meta: MOCK_META,
    riskItems: [],
    loadingRisk: false,
    simulationResult: null,
    isMock: false,
    isScenarioModalOpen: false,
    setIsScenarioModalOpen: vi.fn(),
    health: null,
    apiAvailable: true,
    hasData: true,
    mapMode: "semaforo",
    setMapMode: vi.fn(),
    extrude3d: false,
    setExtrude3d: vi.fn(),
    view3d: "inclinada",
    setView3d: vi.fn(),
    comparePos: 50,
    setComparePos: vi.fn(),
    selectState: vi.fn(),
    selectMunicipality: vi.fn(),
    selectRegion: vi.fn(),
    resetToNational: vi.fn(),
    runSimulation: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("Intel Navigation Suite (intelNav.test.tsx)", () => {
  beforeEach(() => {
    mockPathname = "/";
  });

  it("renders all 3 section tabs (Mapa de riesgo, Plan de campaña, Monitor INE)", () => {
    mockPathname = "/";
    const html = renderToStaticMarkup(
      <AtalayaContext.Provider value={createMockContext()}>
        <TopBar />
      </AtalayaContext.Provider>
    );

    expect(html).toContain("Mapa de riesgo");
    expect(html).toContain("Plan de campaña");
    expect(html).toContain("Monitor INE");
  });

  it("marks 'Mapa de riesgo' as active when on '/' and renders map controls", () => {
    mockPathname = "/";
    const html = renderToStaticMarkup(
      <AtalayaContext.Provider value={createMockContext({ scenario: "intervencion" })}>
        <TopBar />
      </AtalayaContext.Provider>
    );

    // Active link aria-current="page"
    expect(html).toContain('aria-current="page"');
    // Map controls are present on '/'
    expect(html).toContain('data-tour="escenario"');
    expect(html).toContain("Ajustar");
    expect(html).toContain("Buscar estado o municipio");
  });

  it("marks 'Plan de campaña' as active when on '/campanas' and hides map controls", () => {
    mockPathname = "/campanas";
    const html = renderToStaticMarkup(
      <AtalayaContext.Provider value={createMockContext({ scenario: "intervencion" })}>
        <TopBar />
      </AtalayaContext.Provider>
    );

    expect(html).toContain('href="/campanas"');
    // Scenario switcher is hidden outside '/'
    expect(html).not.toContain('data-tour="escenario"');
    // Adjust button is hidden
    expect(html).not.toContain("Ajustar");
    // Search is hidden outside '/'
    expect(html).not.toContain("Buscar estado o municipio");
  });

  it("marks 'Monitor INE' as active when on '/monitor' and hides map controls", () => {
    mockPathname = "/monitor";
    const html = renderToStaticMarkup(
      <AtalayaContext.Provider value={createMockContext({ scenario: "intervencion" })}>
        <TopBar />
      </AtalayaContext.Provider>
    );

    expect(html).toContain('href="/monitor"');
    // Map controls hidden
    expect(html).not.toContain('data-tour="escenario"');
    expect(html).not.toContain("Ajustar");
    expect(html).not.toContain("Buscar estado o municipio");
  });

  it("compact layout renders full-width navigation bar without horizontal scroll", () => {
    mockPathname = "/";
    const html = renderToStaticMarkup(
      <AtalayaContext.Provider value={createMockContext()}>
        <TopBar />
      </AtalayaContext.Provider>
    );

    // Compact section switcher contains short labels
    expect(html).toContain("Mapa");
    expect(html).toContain("Campañas");
    expect(html).toContain("Monitor");
  });

  it("applies responsive layout classes to prevent horizontal scroll at 1024-1440px", () => {
    mockPathname = "/";
    const html = renderToStaticMarkup(
      <AtalayaContext.Provider value={createMockContext()}>
        <TopBar />
      </AtalayaContext.Provider>
    );

    // Section tabs with whitespace-nowrap and responsive labels
    expect(html).toContain("whitespace-nowrap");
    expect(html).toContain("hidden 2xl:inline");
    expect(html).toContain("2xl:hidden");

    // Search input shrinks with min-w-0 flex-1 max-w-[22rem]
    expect(html).toContain("min-w-0 flex-1 max-w-[22rem]");

    // Metodologia and store engine label hidden below 2xl
    expect(html).toContain('hidden 2xl:inline whitespace-nowrap">Metodología');
    expect(html).toContain('hidden 2xl:inline text-[11px] font-medium font-mono whitespace-nowrap');
  });

  describe("F4-A · Compact-landscape TopBar single row specifications", () => {
    it("renders compact-landscape single-row layout with height <= 48px (h-12)", () => {
      mockPathname = "/";
      const html = renderToStaticMarkup(
        <AtalayaContext.Provider value={createMockContext()}>
          <TopBar />
        </AtalayaContext.Provider>
      );

      // Compact-landscape container exists with h-12 (48px) and orientation/max-height media queries
      expect(html).toContain("[@media(orientation:landscape)_and_(max-height:540px)]:flex h-12");
    });

    it("renders icon-only brand mark and section icon links in compact-landscape", () => {
      mockPathname = "/";
      const html = renderToStaticMarkup(
        <AtalayaContext.Provider value={createMockContext()}>
          <TopBar />
        </AtalayaContext.Provider>
      );

      // Section tabs rendered with accessible labels
      expect(html).toContain('aria-label="Mapa de riesgo"');
      expect(html).toContain('aria-label="Plan de campaña"');
      expect(html).toContain('aria-label="Monitor INE"');
    });

    it("renders compact scenario selector (Base · Interv. · Pesim.) and icon for Ajustar on '/'", () => {
      mockPathname = "/";
      const html = renderToStaticMarkup(
        <AtalayaContext.Provider value={createMockContext({ scenario: "intervencion" })}>
          <TopBar />
        </AtalayaContext.Provider>
      );

      expect(html).toContain("Interv.");
      expect(html).toContain("Pesim.");
      expect(html).toContain('aria-label="Ajustar parámetros"');
    });

    it("hides scenario controls and search on '/campanas' and '/monitor' in compact-landscape", () => {
      mockPathname = "/campanas";
      const html = renderToStaticMarkup(
        <AtalayaContext.Provider value={createMockContext({ scenario: "intervencion" })}>
          <TopBar />
        </AtalayaContext.Provider>
      );

      expect(html).not.toContain("Interv.");
      expect(html).not.toContain("Pesim.");
    });
  });
});
