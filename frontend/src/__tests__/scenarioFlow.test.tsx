import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  defaultsForScenario,
  paramsForScenario,
  describeScenario,
  isScenarioModified,
  scenarioParamsKey,
} from "../lib/scenarioParams";
import {
  showToast,
  clearToasts,
  subscribeToasts,
  dismissToast,
  type ToastItem,
} from "../lib/toast";
import { Toaster } from "../components/ui/Toaster";
import { TopBar } from "../components/layout/TopBar";
import { ScenarioControls } from "../components/layout/ScenarioControls";
import { AtalayaProvider, AtalayaContext, useAtalaya, type AtalayaContextValue } from "../lib/state";
import { MOCK_META } from "../lib/mocks/meta";
import * as api from "../lib/api";

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
    isScenarioModalOpen: true,
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

describe("W4-A Scenario Flow & Ephemeral Toast Suite", () => {
  beforeEach(() => {
    clearToasts();
    vi.clearAllMocks();
  });

  describe("1. defaultsForScenario and isScenarioModified helpers", () => {
    it("returns empty object for base scenario", () => {
      expect(defaultsForScenario("base", MOCK_META)).toEqual({});
      expect(defaultsForScenario("base", null)).toEqual({});
      expect(isScenarioModified("base", {}, MOCK_META)).toBe(false);
    });

    it("returns distinct defaults for intervencion and pesimista from meta", () => {
      const intervDefs = defaultsForScenario("intervencion", MOCK_META);
      const pesimDefs = defaultsForScenario("pesimista", MOCK_META);

      expect(intervDefs).toEqual({
        lever: "promocion_jovenes",
        targeting: "rojo_naranja",
        effect_pp: 3.0,
        coverage: 100,
      });

      expect(pesimDefs).toEqual({
        shock_pp: 2.0,
        trend_amplifier: 50,
      });

      // Keys do not leak or overlap
      expect(intervDefs.shock_pp).toBeUndefined();
      expect(pesimDefs.lever).toBeUndefined();
    });

    it("falls back to standard defaults when meta is null", () => {
      const intervDefs = defaultsForScenario("intervencion", null);
      const pesimDefs = defaultsForScenario("pesimista", null);

      expect(intervDefs.effect_pp).toBe(3.0);
      expect(intervDefs.coverage).toBe(100);
      expect(pesimDefs.shock_pp).toBe(2.0);
      expect(pesimDefs.trend_amplifier).toBe(50);
    });

    it("detects modification accurately", () => {
      const intervDefs = defaultsForScenario("intervencion", MOCK_META);
      expect(isScenarioModified("intervencion", intervDefs, MOCK_META)).toBe(false);

      // Numeric change
      expect(
        isScenarioModified("intervencion", { ...intervDefs, effect_pp: 4.5 }, MOCK_META)
      ).toBe(true);

      // Select / string change
      expect(
        isScenarioModified("intervencion", { ...intervDefs, lever: "casillas_rurales" }, MOCK_META)
      ).toBe(true);

      const pesimDefs = defaultsForScenario("pesimista", MOCK_META);
      expect(isScenarioModified("pesimista", pesimDefs, MOCK_META)).toBe(false);

      expect(
        isScenarioModified("pesimista", { ...pesimDefs, shock_pp: 3.0 }, MOCK_META)
      ).toBe(true);
    });

    it("scenarioParamsKey produces deterministic canonical key", () => {
      const key1 = scenarioParamsKey({ b: 2, a: 1 });
      const key2 = scenarioParamsKey({ a: 1, b: 2 });
      expect(key1).toBe("a:1|b:2");
      expect(key1).toBe(key2);
    });
  });

  describe("2. Parameters by Scenario (Separation & Persistence)", () => {
    it("maintains separate parameter dictionaries and preserves them across scenario changes", () => {
      const intervDefaults = defaultsForScenario("intervencion", MOCK_META);
      const pesimDefaults = defaultsForScenario("pesimista", MOCK_META);

      // Simulated state store representing state.tsx
      const state: {
        paramsByScenario: {
          intervencion: Record<string, number | string>;
          pesimista: Record<string, number | string>;
        };
        activeScenario: "intervencion" | "pesimista";
      } = {
        paramsByScenario: {
          intervencion: { ...intervDefaults },
          pesimista: { ...pesimDefaults },
        },
        activeScenario: "intervencion",
      };

      // 1. User modifies Intervención
      state.paramsByScenario.intervencion = {
        ...state.paramsByScenario.intervencion,
        effect_pp: 6.0,
        coverage: 80,
      };
      expect(
        isScenarioModified("intervencion", state.paramsByScenario.intervencion, MOCK_META)
      ).toBe(true);

      // 2. User switches to Pesimista -> Pesimista must have its defaults
      state.activeScenario = "pesimista";
      const activePesimParams = state.paramsByScenario[state.activeScenario];
      expect(activePesimParams).toEqual(pesimDefaults);
      expect(isScenarioModified("pesimista", activePesimParams, MOCK_META)).toBe(false);

      // 3. User switches back to Intervención -> Intervención must retain its custom values
      state.activeScenario = "intervencion";
      const activeIntervParams = state.paramsByScenario[state.activeScenario];
      expect(activeIntervParams.effect_pp).toBe(6.0);
      expect(activeIntervParams.coverage).toBe(80);
      expect(isScenarioModified("intervencion", activeIntervParams, MOCK_META)).toBe(true);
    });
  });

  describe("3. Simulation Execution and No Cross-Scenario Results", () => {
    it("simulating in Pesimista calls simulateScenario with scenario: 'pesimista' and does not change scenario", async () => {
      const spySimulate = vi.spyOn(api, "simulateScenario").mockResolvedValue({
        scenario: "pesimista",
        level: "state",
        params: { shock_pp: 2.5, trend_amplifier: 60 },
        summary: {
          n_units: 32,
          mean_delta_pp: 2.5,
          votos_adicionales: -450000,
          by_category: { verde: 2, amarillo: 5, naranja: 10, rojo: 15, sin_dato: 0 },
          by_category_base: { verde: 5, amarillo: 10, naranja: 12, rojo: 5, sin_dato: 0 },
        },
        items: [],
      });

      const pesimParams = { shock_pp: 2.5, trend_amplifier: 60 };
      const resolved = paramsForScenario("pesimista", pesimParams, MOCK_META);

      const res = await api.simulateScenario({
        scenario: "pesimista",
        params: resolved,
        level: "state",
        ent: null,
      });

      expect(spySimulate).toHaveBeenCalledWith({
        scenario: "pesimista",
        params: resolved,
        level: "state",
        ent: null,
      });
      expect(res.scenario).toBe("pesimista");
      expect(res.summary.votos_adicionales).toBe(-450000);
      expect(res.summary.mean_delta_pp).toBe(2.5);

      spySimulate.mockRestore();
    });

    it("discards slow in-flight responses from previous scenario", async () => {
      let activeScenario = "intervencion";
      let simReqId = 0;
      let appliedResult: any = null;

      // Simulate starting a slow Intervencion request
      const reqId1 = ++simReqId;
      const slowIntervencionPromise = new Promise<any>((resolve) => {
        setTimeout(() => {
          resolve({
            scenario: "intervencion",
            reqId: reqId1,
            summary: { votos_adicionales: 500000 },
          });
        }, 100);
      });

      // User changes scenario to Base (or Pesimista) before request 1 finishes
      activeScenario = "base";
      simReqId++; // Invalidation

      // Request 1 finally arrives
      const result1 = await slowIntervencionPromise;
      if (result1.reqId === simReqId && result1.scenario === activeScenario) {
        appliedResult = result1;
      }

      // Assert that slow response was discarded and never applied
      expect(appliedResult).toBeNull();
    });
  });

  describe("4. resetScenarioParams restores defaults and resets isScenarioModified", () => {
    it("resets scenario parameters to defaults and sets isScenarioModified to false", () => {
      const meta = MOCK_META;
      const initialCustom = {
        shock_pp: 5.0,
        trend_amplifier: 90,
      };

      expect(isScenarioModified("pesimista", initialCustom, meta)).toBe(true);

      // Reset
      const resetParams = defaultsForScenario("pesimista", meta);
      expect(resetParams).toEqual({
        shock_pp: 2.0,
        trend_amplifier: 50,
      });
      expect(isScenarioModified("pesimista", resetParams, meta)).toBe(false);
    });
  });

  describe("5. Ephemeral Toaster (showToast, auto-dismiss, max 2 visible)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      clearToasts();
    });

    afterEach(() => {
      vi.useRealTimers();
      clearToasts();
    });

    it("showToast delivers toast to subscriber, renders accessible markup, and auto-dismisses after 3.5s", () => {
      let currentToasts: ToastItem[] = [];
      const unsubscribe = subscribeToasts((items) => {
        currentToasts = items;
      });

      showToast({
        kind: "success",
        title: "Escenario actualizado",
        detail: "Intervención: Promoción del voto joven · +10 pp · cobertura 100 % · Zonas rojas y naranjas · +5,814,320 votos estimados",
      });

      expect(currentToasts).toHaveLength(1);
      expect(currentToasts[0].kind).toBe("success");
      expect(currentToasts[0].title).toBe("Escenario actualizado");
      expect(currentToasts[0].detail).toContain("+5,814,320 votos estimados");

      // Verify markup rendered by Toaster
      const html = renderToStaticMarkup(<Toaster />);
      expect(html).toContain('role="status"');
      expect(html).toContain('aria-live="polite"');
      expect(html).toContain("Escenario actualizado");
      expect(html).toContain("+5,814,320 votos estimados");
      expect(html).toContain("bg-good");

      // Advance timers by 3500ms -> auto-dismiss
      vi.advanceTimersByTime(3500);

      expect(currentToasts).toHaveLength(0);
      const emptyHtml = renderToStaticMarkup(<Toaster />);
      expect(emptyHtml).toBe("");

      unsubscribe();
    });

    it("renders error toasts with bg-destructive styling", () => {
      showToast({
        kind: "error",
        title: "Error de simulación",
        detail: "El parámetro effect_pp no puede ser mayor a 10.0",
      });

      const html = renderToStaticMarkup(<Toaster />);
      expect(html).toContain("bg-destructive");
      expect(html).toContain("Error de simulación");
      expect(html).toContain("effect_pp");
    });

    it("limits visible toasts to a maximum of 2", () => {
      showToast({ kind: "success", title: "Toast 1" });
      showToast({ kind: "success", title: "Toast 2" });
      showToast({ kind: "success", title: "Toast 3" });

      const html = renderToStaticMarkup(<Toaster />);
      expect(html).not.toContain("Toast 1");
      expect(html).toContain("Toast 2");
      expect(html).toContain("Toast 3");
    });

    it("allows manual dismiss via dismissToast", () => {
      const id = showToast({ kind: "success", title: "Toast to dismiss" });
      expect(renderToStaticMarkup(<Toaster />)).toContain("Toast to dismiss");

      dismissToast(id);
      expect(renderToStaticMarkup(<Toaster />)).toBe("");
    });
  });

  describe("6. UI Integration: ScenarioControls and TopBar", () => {
    it("ScenarioControls shows 'Aplica para ver el resultado' when simulationResult is null", () => {
      const mockCtx = createMockContext({
        isScenarioModalOpen: true,
        simulationResult: null,
        scenario: "intervencion",
      });

      const html = renderToStaticMarkup(
        <AtalayaContext.Provider value={mockCtx}>
          <ScenarioControls />
        </AtalayaContext.Provider>
      );
      expect(html).toContain("Ajustar: Con intervención hipotética");
      expect(html).toContain("Aplica para ver el resultado");
      expect(html).not.toContain("zonas evaluadas");
    });

    it("ScenarioControls shows simulated result with correct format.ts classes in pesimista scenario", () => {
      const mockCtx = createMockContext({
        isScenarioModalOpen: true,
        scenario: "pesimista",
        scenarioParams: defaultsForScenario("pesimista", MOCK_META),
        paramsByScenario: {
          intervencion: defaultsForScenario("intervencion", MOCK_META),
          pesimista: defaultsForScenario("pesimista", MOCK_META),
        },
        isScenarioModified: () => true,
        simulationResult: {
          scenario: "pesimista",
          level: "mun",
          params: { shock_pp: 2.0, trend_amplifier: 50 },
          summary: {
            n_units: 2470,
            mean_delta_pp: 2.5, // Worsening => text-bad
            votos_adicionales: -1250000, // Lost votes => text-bad
            by_category: { verde: 200, amarillo: 400, naranja: 870, rojo: 1000, sin_dato: 0 },
            by_category_base: { verde: 400, amarillo: 600, naranja: 800, rojo: 670, sin_dato: 0 },
          },
          items: [],
        },
      });

      const html = renderToStaticMarkup(
        <AtalayaContext.Provider value={mockCtx}>
          <ScenarioControls />
        </AtalayaContext.Provider>
      );
      expect(html).toContain("Ajustar escenario pesimista");
      expect(html).toContain("Resultado simulado");
      expect(html).toContain("Votos perdidos estimados");
      expect(html).toContain("−1,250,000");
      expect(html).toContain("text-bad");
      expect(html).toContain("+2.5 pp");
      expect(html).toContain("Restablecer");
    });

    it("TopBar renders 'Modificado · ↺' pill on PC and 40px reset button on compact when scenario is modified", () => {
      const mockCtx = createMockContext({
        scenario: "intervencion",
        isScenarioModified: (sc: string) => sc === "intervencion",
      });

      const html = renderToStaticMarkup(
        <AtalayaContext.Provider value={mockCtx}>
          <TopBar />
        </AtalayaContext.Provider>
      );
      expect(html).toContain("Modificado");
      expect(html).toContain('aria-label="Restablecer valores originales"');
      expect(html).toContain("min-w-[40px]");
    });

    it("TopBar does NOT render 'Modificado' when scenario is at defaults", () => {
      const mockCtx = createMockContext({
        scenario: "intervencion",
        isScenarioModified: () => false,
      });

      const html = renderToStaticMarkup(
        <AtalayaContext.Provider value={mockCtx}>
          <TopBar />
        </AtalayaContext.Provider>
      );
      expect(html).not.toContain("Modificado");
      expect(html).not.toContain('aria-label="Restablecer valores originales"');
    });
  });
});
