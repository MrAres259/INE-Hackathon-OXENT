import React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Breadcrumb } from "../components/map/Breadcrumb";
import { MapLayerSwitcher, MapToolbar } from "../components/map/MapToolbar";
import { Legend } from "../components/map/Legend";
import { MapFallback } from "../components/map/MapFallback";
import { CompareSwipe } from "../components/map/CompareSwipe";
import { RiskMap } from "../components/map/RiskMap";

// Mock Atalaya context
vi.mock("@/lib/state", () => ({
  useAtalaya: vi.fn(() => ({
    level: "state",
    selectedEnt: "09",
    selectedRegionId: null,
    selectedDetail: null,
    meta: {
      states: [
        { id: "09", name: "Ciudad de México", code: "CDMX" },
        { id: "19", name: "Nuevo León", code: "NL" },
      ],
    },
    resetToNational: vi.fn(),
    selectState: vi.fn(),
    mapMode: "semaforo",
    setMapMode: vi.fn(),
    extrude3d: false,
    setExtrude3d: vi.fn(),
    view3d: "inclinada",
    setView3d: vi.fn(),
    scenario: "base",
    scenarioParams: {},
    riskItems: [],
  })),
}));

describe("Map Overlays (mapOverlays.test.tsx)", () => {
  describe("Breadcrumb", () => {
    it("renders navigation breadcrumb with state name and Mexico", () => {
      const html = renderToStaticMarkup(<Breadcrumb />);
      expect(html).toContain("México");
      expect(html).toContain("Ciudad de México");
      expect(html).toContain("float-panel");
      // Check truncation class exists for long names on mobile
      expect(html).toContain("max-w-[40vw]");
    });
  });

  describe("MapLayerSwitcher", () => {
    it("renders with data-tour='capas' and all 3 map modes", () => {
      const html = renderToStaticMarkup(<MapLayerSwitcher />);
      expect(html).toContain('data-tour="capas"');
      expect(html).toContain("Semáforo");
      expect(html).toContain("Cambio");
      expect(html).toContain("Δ");
      expect(html).toContain("Comparar");
      expect(html).toContain("float-panel");
    });
  });

  describe("MapToolbar", () => {
    it("renders with data-tour='herramientas', 3D toggle, PNG export and guide button", () => {
      const onExportPng = vi.fn();
      const html = renderToStaticMarkup(<MapToolbar onExportPng={onExportPng} />);
      expect(html).toContain('data-tour="herramientas"');
      expect(html).toContain("float-panel");
      expect(html).toContain('aria-label="Vista 3D (altura = riesgo)"');
      expect(html).toContain('aria-label="Exportar mapa a PNG"');
      expect(html).toContain('aria-label="Cómo leer este mapa"');
    });
  });

  describe("Legend", () => {
    it("renders with data-tour='leyenda', title Semáforo 2027 and float-panel styling", () => {
      const html = renderToStaticMarkup(<Legend defaultOpen={true} />);
      expect(html).toContain('data-tour="leyenda"');
      expect(html).toContain("Semáforo 2027");
      expect(html).toContain("float-panel");
      expect(html).toContain("Nivel de riesgo");
      expect(html).toContain("% LN");
      // B3: Quita "· Puntos = municipios"
      expect(html).not.toContain("Puntos = municipios");
      expect(html).toContain("Escenario: Base (inercial)");
    });
  });

  describe("CompareSwipe", () => {
    it("renders full comparison summary text with responsive 'de categoría' suffix", () => {
      const mockData = {
        active: { state: new Map(), mun: new Map() },
        base: {
          state: new Map(),
          mun: new Map([
            [
              "01001",
              {
                id: "01001",
                ent: "01",
                name: "Aguascalientes",
                level: "mun",
                category: "rojo",
                lista_nominal: 50000,
              },
            ],
          ]),
        },
        alt: {
          state: new Map(),
          mun: new Map([
            [
              "01001",
              {
                id: "01001",
                ent: "01",
                name: "Aguascalientes",
                level: "mun",
                category: "verde",
                lista_nominal: 50000,
              },
            ],
          ]),
        },
        loading: false,
        error: null,
        altLabel: "Intervención focalizada",
      } as any;

      const html = renderToStaticMarkup(<CompareSwipe data={mockData} />);
      expect(html).toContain("Rojo: 1 → 0 municipios · 1 mejoran");
      expect(html).toContain('<span class="hidden sm:inline"> de categoría</span>');
      expect(html).toContain("Intervención focalizada");
    });
  });

  describe("RiskMap", () => {
    it("positions tools at lg:top-[56px] on PC and organizes top-left group in column with gap-2", () => {
      const html = renderToStaticMarkup(<RiskMap />);
      // B2: tools top-right below panel collapse button (top: 56px, right: 12px) on PC
      expect(html).toContain("lg:top-[56px]");
      // B3: top-left group with gap-2
      expect(html).toContain("flex flex-col items-start gap-2");
    });
  });

  describe("MapFallback", () => {
    it("renders accessible error state with retry action in light card style", () => {
      const onRetry = vi.fn();
      const html = renderToStaticMarkup(<MapFallback reason="error" onRetry={onRetry} />);
      expect(html).toContain('role="alert"');
      expect(html).toContain("Error de carga");
      expect(html).toContain("Reintentar");
      expect(html).toContain("bg-card");
      expect(html).toContain("shadow-float");
    });
  });

  describe("Theme token cleanliness", () => {
    it("ensures no legacy dark-theme classes are rendered in overlays", () => {
      const bHtml = renderToStaticMarkup(<Breadcrumb />);
      const lHtml = renderToStaticMarkup(<MapLayerSwitcher />);
      const tHtml = renderToStaticMarkup(<MapToolbar />);
      const legHtml = renderToStaticMarkup(<Legend defaultOpen={true} />);
      const fHtml = renderToStaticMarkup(<MapFallback reason="error" />);

      const combined = `${bHtml} ${lHtml} ${tHtml} ${legHtml} ${fHtml}`;
      // Verify no legacy dark colors
      expect(combined).not.toContain("bg-slate-900");
      expect(combined).not.toContain("bg-slate-950");
      expect(combined).not.toContain("border-slate-800");
      expect(combined).not.toContain("border-slate-700");
      expect(combined).not.toContain("#060a13");
    });
  });
});
