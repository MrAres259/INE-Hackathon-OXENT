import React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Breadcrumb } from "../components/map/Breadcrumb";
import { MapLayerSwitcher, MapToolbar } from "../components/map/MapToolbar";
import { Legend } from "../components/map/Legend";
import { MapFallback } from "../components/map/MapFallback";
import { CompareSwipe, CompareSummary } from "../components/map/CompareSwipe";
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
      expect(html).toContain('data-map-overlay="breadcrumb"');
      // Check truncation class exists for long names on mobile
      expect(html).toContain("max-w-[40vw]");
    });

    it("breadcrumb truncado conserva title completo y aplica clases LS", () => {
      const html = renderToStaticMarkup(<Breadcrumb />);
      // Title attribute preserves full state name
      expect(html).toContain('title="Ciudad de México"');
      // Truncated text is rendered for compact screens
      expect(html).toContain("Ciudad …México");
      // LS class is present on breadcrumb container
      expect(html).toContain("[@media(orientation:landscape)_and_(max-height:540px)]:max-w-[45vw]");
    });

    it("oculta las migas en compact-portrait a nivel nacional (!selectedEnt) y las muestra con estado", async () => {
      const { useAtalaya } = await import("@/lib/state");
      vi.mocked(useAtalaya).mockReturnValueOnce({
        ...vi.mocked(useAtalaya)(),
        selectedEnt: null,
      });
      const nationalHtml = renderToStaticMarkup(<Breadcrumb />);
      expect(nationalHtml).toContain("hidden lg:flex");

      const stateHtml = renderToStaticMarkup(<Breadcrumb />);
      expect(stateHtml).not.toContain("hidden lg:flex");
    });
  });

  describe("MapLayerSwitcher", () => {
    it("renders with data-tour='capas', data-map-overlay='layers' and all 3 map modes", () => {
      const html = renderToStaticMarkup(<MapLayerSwitcher />);
      expect(html).toContain('data-tour="capas"');
      expect(html).toContain('data-map-overlay="layers"');
      expect(html).toContain("Semáforo");
      expect(html).toContain("Cambio");
      expect(html).toContain("Δ");
      expect(html).toContain("Comparar");
      expect(html).toContain("float-panel");
    });

    it("incluye clases LS para 36px de alto y solo iconos con aria-labels", () => {
      const html = renderToStaticMarkup(<MapLayerSwitcher />);
      expect(html).toContain("[@media(orientation:landscape)_and_(max-height:540px)]:h-9");
      expect(html).toContain('aria-label="Semáforo"');
      expect(html).toContain('aria-label="Cambio Δ"');
      expect(html).toContain('aria-label="Comparar"');
      expect(html).toContain("[@media(orientation:landscape)_and_(max-height:540px)]:!hidden");
    });
  });

  describe("MapToolbar", () => {
    it("renders with data-tour='herramientas', data-map-overlay='toolbar', 3D toggle, PNG export and guide button", () => {
      const onExportPng = vi.fn();
      const html = renderToStaticMarkup(<MapToolbar onExportPng={onExportPng} />);
      expect(html).toContain('data-tour="herramientas"');
      expect(html).toContain('data-map-overlay="toolbar"');
      expect(html).toContain('data-map-overlay="view-toggle"');
      expect(html).toContain("float-panel");
      expect(html).toContain('aria-label="Vista 3D (altura = riesgo)"');
      expect(html).toContain('aria-label="Exportar mapa a PNG"');
      expect(html).toContain('aria-label="Cómo leer este mapa"');
    });

    it("incluye clases LS para botones de herramientas de 36px", () => {
      const onExportPng = vi.fn();
      const html = renderToStaticMarkup(<MapToolbar onExportPng={onExportPng} />);
      expect(html).toContain("[@media(orientation:landscape)_and_(max-height:540px)]:!size-9");
      expect(html).toContain("[@media(orientation:landscape)_and_(max-height:540px)]:min-w-[36px]");
    });
  });

  describe("Legend", () => {
    it("renders with data-tour='leyenda', data-map-overlay='legend', title Semáforo 2027 and float-panel styling", () => {
      const html = renderToStaticMarkup(<Legend defaultOpen={true} />);
      expect(html).toContain('data-tour="leyenda"');
      expect(html).toContain('data-map-overlay="legend"');
      expect(html).toContain("Semáforo 2027");
      expect(html).toContain("float-panel");
      expect(html).toContain("Nivel de riesgo");
      expect(html).toContain("% LN");
      // B3: Quita "· Puntos = municipios"
      expect(html).not.toContain("Puntos = municipios");
      expect(html).toContain("Escenario: Base (inercial)");
    });

    it("incluye popover data-map-overlay='legend-popover' y chip Semáforo en clases LS", () => {
      const html = renderToStaticMarkup(<Legend defaultOpen={true} />);
      expect(html).toContain('data-map-overlay="legend-popover"');
      expect(html).toContain("[@media(orientation:landscape)_and_(max-height:540px)]:w-auto");
      expect(html).toContain("[@media(orientation:landscape)_and_(max-height:540px)]:absolute");
      expect(html).toContain("Semáforo");
    });
  });

  describe("CompareSwipe and CompareSummary", () => {
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

    it("renders comparison summary in flow with wrapping text, line-clamp-2 and data-map-overlay", () => {
      const html = renderToStaticMarkup(<CompareSummary data={mockData} />);
      expect(html).toContain('data-map-overlay="compare-summary"');
      expect(html).toContain("Rojo 1 → 0 · 1 mejoran de categoría");
      expect(html).toContain("Intervención focalizada");
      expect(html).toContain("line-clamp-2");
      expect(html).toContain('title="Plegar a pastilla Resumen"');
    });

    it("renders comparison summary collapsed as Resumen pill on compact screens", () => {
      const html = renderToStaticMarkup(<CompareSummary data={mockData} defaultCollapsed={true} />);
      expect(html).toContain('data-map-overlay="compare-summary"');
      expect(html).toContain("Resumen");
      expect(html).toContain('title="Mostrar resumen de comparación"');
      expect(html).not.toContain("Rojo 1 → 0");
    });

    it("renders swipe divider handle and labels positioned at handle height without overlay collision", () => {
      const html = renderToStaticMarkup(<CompareSwipe data={mockData} />);
      expect(html).toContain('data-map-overlay="swipe-handle"');
      expect(html).toContain('data-map-overlay="swipe-left-label"');
      expect(html).toContain('data-map-overlay="swipe-right-label"');
      expect(html).toContain("top-1/2");
      expect(html).toContain("-translate-y-1/2");
    });

    it("renders compact Sin and Con swipe divider labels with LS classes", () => {
      const html = renderToStaticMarkup(<CompareSwipe data={mockData} />);
      expect(html).toContain("◀ Sin");
      expect(html).toContain("Con ▶");
      expect(html).toContain("[@media(orientation:landscape)_and_(max-height:540px)]:px-1.5");
      expect(html).toContain("[@media(orientation:landscape)_and_(max-height:540px)]:!size-8");
    });

    it("render en servidor y cliente a 375 px produce el mismo HTML inicial (sin fallo de hidratacion React #418)", () => {
      const origInnerWidth = typeof window !== "undefined" ? window.innerWidth : undefined;

      // Server render
      const serverSummaryHtml = renderToStaticMarkup(<CompareSummary data={mockData} />);
      const serverLegendHtml = renderToStaticMarkup(<Legend />);

      // Client render at 375px
      if (typeof window !== "undefined") {
        Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: 375 });
      }
      try {
        const clientSummaryHtml = renderToStaticMarkup(<CompareSummary data={mockData} />);
        const clientLegendHtml = renderToStaticMarkup(<Legend />);

        expect(clientSummaryHtml).toBe(serverSummaryHtml);
        expect(clientLegendHtml).toBe(serverLegendHtml);
      } finally {
        if (typeof window !== "undefined" && origInnerWidth !== undefined) {
          Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: origInnerWidth });
        }
      }
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

    it("respects --topbar-h and --map-inset-right in floating overlay containers", () => {
      const html = renderToStaticMarkup(<RiskMap />);
      expect(html).toContain("top-[calc(var(--topbar-h,0px)+8px)]");
      expect(html).toContain("right-[calc(var(--map-inset-right,0px)+8px)]");
      expect(html).toContain("maplibregl-ctrl-bottom-right");
      expect(html).toContain("var(--map-inset-right,0px)");
    });

    it("coloca MapLayerSwitcher y Legend en la misma fila en pantallas compactas con lg:contents para PC", () => {
      const html = renderToStaticMarkup(<RiskMap />);
      expect(html).toContain("flex items-center gap-2 flex-wrap lg:contents");
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

  describe("F4-D · globals.css rules and overlay classes", () => {
    it("globals.css contains F4-D rules for compact attribution and zoom control hiding", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const cssPath = path.resolve(__dirname, "../app/globals.css");
      const cssContent = fs.readFileSync(cssPath, "utf-8");
      expect(cssContent).toContain("/* F4-D */");
      expect(cssContent).toContain('[data-map-overlay="zoom"] .maplibregl-ctrl-zoom-in');
      expect(cssContent).toContain('[data-map-overlay="zoom"] .maplibregl-ctrl-zoom-out');
      expect(cssContent).toContain(".maplibregl-ctrl-attrib.maplibregl-compact:not(.maplibregl-compact-show)");
    });
  });
});

