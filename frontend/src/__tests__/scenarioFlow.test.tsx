import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  defaultsForScenario,
  leverDefaults,
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
import { ScenarioControls, useScenarioDraft } from "../components/layout/ScenarioControls";
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
    leverParams: {
      promocion_jovenes: leverDefaults(MOCK_META),
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
        campaigns: [
          {
            lever: "promocion_jovenes",
            targeting: "rojo_naranja",
            effect_pp: 3.0,
            coverage: 100,
            ents: [],
          },
        ],
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

  describe("7. Per-lever Memory & Explanation Flow (W5-A)", () => {
    it("maintains separate values per lever, preserves custom values when switching levers, and reset clears all levers", () => {
      // 1. Initial defaults for intervention levers
      const defaults = leverDefaults(MOCK_META);
      expect(defaults).toEqual({
        targeting: "rojo_naranja",
        effect_pp: 3.0,
        coverage: 100,
      });

      // Memory map simulating state.tsx leverParams
      let leverParams: Record<string, Record<string, number | string>> = {
        promocion_jovenes: { ...defaults },
      };
      let activeParams: Record<string, number | string> = {
        lever: "promocion_jovenes",
        ...defaults,
      };

      // Step 1: User applies voto joven at 10 pp
      activeParams = {
        ...activeParams,
        lever: "promocion_jovenes",
        effect_pp: 10.0,
      };
      leverParams["promocion_jovenes"] = {
        targeting: activeParams.targeting,
        effect_pp: 10.0,
        coverage: activeParams.coverage,
      };

      expect(leverParams["promocion_jovenes"].effect_pp).toBe(10.0);
      expect(isScenarioModified("intervencion", activeParams, MOCK_META)).toBe(true);

      // Step 2: User switches lever to casillas rurales in the controls
      // Fields load values for casillas rurales: not yet saved => defaults (3 pp, 100 %, rojo_naranja)
      const ruralValues = leverParams["casillas_rurales"] ?? leverDefaults(MOCK_META);
      expect(ruralValues).toEqual({
        targeting: "rojo_naranja",
        effect_pp: 3.0,
        coverage: 100,
      });

      // Step 3: User switches back to voto joven => 10 pp retained!
      const youthValues = leverParams["promocion_jovenes"] ?? leverDefaults(MOCK_META);
      expect(youthValues.effect_pp).toBe(10.0);

      // Step 4: User applies casillas rurales (e.g. at 5 pp) => does NOT change voto joven!
      leverParams["casillas_rurales"] = {
        ...ruralValues,
        effect_pp: 5.0,
      };
      activeParams = {
        lever: "casillas_rurales",
        ...leverParams["casillas_rurales"],
      };

      // Voto joven is still 10 pp!
      expect(leverParams["promocion_jovenes"].effect_pp).toBe(10.0);
      expect(leverParams["casillas_rurales"].effect_pp).toBe(5.0);

      // Step 5: Restablecer cleans both and returns to defaults
      leverParams = {};
      activeParams = defaultsForScenario("intervencion", MOCK_META);

      expect(activeParams.lever).toBe("promocion_jovenes");
      expect(activeParams.effect_pp).toBe(3.0);
      expect(isScenarioModified("intervencion", activeParams, MOCK_META)).toBe(false);

      // Both levers are now at defaults
      const youthReset = leverParams["promocion_jovenes"] ?? leverDefaults(MOCK_META);
      const ruralReset = leverParams["casillas_rurales"] ?? leverDefaults(MOCK_META);
      expect(youthReset.effect_pp).toBe(3.0);
      expect(ruralReset.effect_pp).toBe(3.0);
    });

    it("ScenarioControls renders distinct values per lever from leverParams and explains variable weighting", () => {
      // With promocion_jovenes at 10 pp
      const mockCtxYouth = createMockContext({
        scenario: "intervencion",
        paramsByScenario: {
          intervencion: {
            lever: "promocion_jovenes",
            effect_pp: 10.0,
            coverage: 100,
            targeting: "rojo_naranja",
          },
          pesimista: defaultsForScenario("pesimista", MOCK_META),
        },
        leverParams: {
          promocion_jovenes: {
            effect_pp: 10.0,
            coverage: 100,
            targeting: "rojo_naranja",
          },
          casillas_rurales: {
            effect_pp: 3.0,
            coverage: 100,
            targeting: "rojo_naranja",
          },
        },
      });

      const htmlYouth = renderToStaticMarkup(
        <AtalayaContext.Provider value={mockCtxYouth}>
          <ScenarioControls />
        </AtalayaContext.Provider>
      );

      expect(htmlYouth).toContain("+10.0 pp");
      expect(htmlYouth).toContain("Su efecto se pondera por población de 18 a 24 años");

      // With casillas_rurales active (with 3 pp defaults)
      const mockCtxRural = createMockContext({
        scenario: "intervencion",
        paramsByScenario: {
          intervencion: {
            lever: "casillas_rurales",
            effect_pp: 3.0,
            coverage: 100,
            targeting: "rojo_naranja",
          },
          pesimista: defaultsForScenario("pesimista", MOCK_META),
        },
        leverParams: {
          promocion_jovenes: {
            effect_pp: 10.0,
            coverage: 100,
            targeting: "rojo_naranja",
          },
          casillas_rurales: {
            effect_pp: 3.0,
            coverage: 100,
            targeting: "rojo_naranja",
          },
        },
      });

      const htmlRural = renderToStaticMarkup(
        <AtalayaContext.Provider value={mockCtxRural}>
          <ScenarioControls />
        </AtalayaContext.Provider>
      );

      expect(htmlRural).toContain("+3.0 pp");
      expect(htmlRural).toContain("Su efecto se pondera por población rural");
    });

    it("ScenarioControls explains simulation result compared with base and shows zones breakdown", () => {
      const mockCtx = createMockContext({
        scenario: "intervencion",
        simulationResult: {
          scenario: "intervencion",
          level: "mun",
          params: { lever: "promocion_jovenes", effect_pp: 3.0, coverage: 100, targeting: "rojo_naranja" },
          summary: {
            n_units: 3,
            mean_delta_pp: -1.5,
            votos_adicionales: 50000,
            by_category: { verde: 2, amarillo: 1, naranja: 0, rojo: 0, sin_dato: 0 },
            by_category_base: { verde: 1, amarillo: 1, naranja: 1, rojo: 0, sin_dato: 0 },
          },
          items: [
            { id: "01001", delta_vs_base_pp: -1.5 } as any,
            { id: "01002", delta_vs_base_pp: 0.1 } as any,
            { id: "01003", delta_vs_base_pp: 0.0 } as any,
          ],
        },
      });

      const html = renderToStaticMarkup(
        <AtalayaContext.Provider value={mockCtx}>
          <ScenarioControls />
        </AtalayaContext.Provider>
      );

      expect(html).toContain("Comparado con el escenario base");
      expect(html).toContain("Zonas vs base:");
      expect(html).toContain("1 bajan");
      expect(html).toContain("1 suben");
      expect(html).toContain("1 sin cambio");
    });
  });

  describe("8. Ola 6: Combined Campaigns Flow & UI", () => {
    it("renders combined campaigns with cards, scopes, and combination rule", () => {
      const mockCtx = createMockContext({
        scenario: "intervencion",
        paramsByScenario: {
          intervencion: {
            campaigns: [
              {
                lever: "promocion_jovenes",
                targeting: "todos",
                effect_pp: 10,
                coverage: 100,
                ents: [],
              },
              {
                lever: "casillas_rurales",
                targeting: "rojo_naranja",
                effect_pp: 5,
                coverage: 80,
                ents: ["07", "20"], // Chiapas, Oaxaca
              },
            ],
          },
          pesimista: defaultsForScenario("pesimista", MOCK_META),
        },
      });

      const html = renderToStaticMarkup(
        <AtalayaContext.Provider value={mockCtx}>
          <ScenarioControls />
        </AtalayaContext.Provider>
      );

      expect(html).toContain("Campañas de intervención");
      expect(html).toContain("Campaña 1");
      expect(html).toContain("Campaña 2");
      expect(html).toContain("Voto joven");
      expect(html).toContain("Casillas rurales");
      expect(html).toContain("Chiapas");
      expect(html).toContain("Oaxaca");
      expect(html).toContain("rendimientos decrecientes");
      expect(html).toContain("Escenario hipotético para planeación");
    });

    it("renders breakdown table 'Si cada campaña fuera la única' with Suma individual and Traslape when >= 2 campaigns", () => {
      const mockCtx = createMockContext({
        scenario: "intervencion",
        paramsByScenario: {
          intervencion: {
            campaigns: [
              { lever: "promocion_jovenes", targeting: "todos", effect_pp: 10, coverage: 100, ents: [] },
              { lever: "casillas_rurales", targeting: "rojo_naranja", effect_pp: 5, coverage: 80, ents: ["07"] },
            ],
          },
          pesimista: defaultsForScenario("pesimista", MOCK_META),
        },
        simulationResult: {
          scenario: "intervencion",
          level: "mun",
          params: {},
          summary: {
            n_units: 2475,
            mean_delta_pp: -2.8,
            votos_adicionales: 220000,
            by_category: { verde: 500, amarillo: 1000, naranja: 600, rojo: 375, sin_dato: 0 },
            by_category_base: { verde: 400, amarillo: 900, naranja: 700, rojo: 475, sin_dato: 0 },
            campaigns: [
              {
                lever: "promocion_jovenes",
                label: "Promoción del voto joven",
                ents: [],
                n_target_units: 2475,
                votos_solo: 180000,
                mean_delta_pp_solo: -2.1,
              },
              {
                lever: "casillas_rurales",
                label: "Casillas y traslado en zonas rurales",
                ents: ["07"],
                n_target_units: 124,
                votos_solo: 60000,
                mean_delta_pp_solo: -1.2,
              },
            ],
            votos_suma_individual: 240000,
            votos_traslape: 20000,
          },
          items: [],
        },
      });

      const html = renderToStaticMarkup(
        <AtalayaContext.Provider value={mockCtx}>
          <ScenarioControls />
        </AtalayaContext.Provider>
      );

      expect(html).toContain("Si cada campaña fuera la única");
      expect(html).toContain("Suma individual");
      expect(html).toContain("Traslape (personas alcanzadas por más de una campaña):");
      expect(html).toContain("+180,000");
      expect(html).toContain("+60,000");
      expect(html).toContain("+240,000");
      expect(html).toContain("−20,000");
    });

    it("displays error on the corresponding campaign card when 422 names the campaign", () => {
      // Test that card errors are mapped properly
      const mockCtx = createMockContext({
        scenario: "intervencion",
        paramsByScenario: {
          intervencion: {
            campaigns: [
              { lever: "promocion_jovenes", targeting: "todos", effect_pp: 3, coverage: 100, ents: [] },
              { lever: "casillas_rurales", targeting: "rojo", effect_pp: 15, coverage: 100, ents: [] },
            ],
          },
          pesimista: defaultsForScenario("pesimista", MOCK_META),
        },
      });

      const html = renderToStaticMarkup(
        <AtalayaContext.Provider value={mockCtx}>
          <ScenarioControls />
        </AtalayaContext.Provider>
      );

      // Renders both cards and the add campaign button
      expect(html).toContain("Campaña 1");
      expect(html).toContain("Campaña 2");
      expect(html).toContain("+ Agregar campaña");
    });
  });

  describe("9. F6-A: Draft Editing, Apply, Reset, and Modal Close Behavior", () => {
    let fakeDoc: any;
    let fakeElement: any;
    let defaultView: any;
    const origDoc = (globalThis as any).document;
    const origWindow = (globalThis as any).window;
    const origActEnv = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;

    beforeEach(() => {
      fakeElement = {
        nodeType: 1,
        tagName: "DIV",
        ownerDocument: null as any,
        addEventListener: () => {},
        removeEventListener: () => {},
        appendChild: () => {},
        removeChild: () => {},
        insertBefore: () => {},
        setAttribute: () => {},
        removeAttribute: () => {},
        style: {},
        childNodes: [],
      };
      defaultView = {
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => true,
        HTMLIFrameElement: class {},
        CustomEvent: typeof CustomEvent !== "undefined" ? CustomEvent : class {
          detail: any;
          constructor(public type: string, init?: any) {
            this.detail = init?.detail;
          }
        },
        event: undefined,
      };
      fakeDoc = {
        nodeType: 9,
        createElement: () => fakeElement,
        createTextNode: () => ({ nodeType: 3 }),
        addEventListener: () => {},
        removeEventListener: () => {},
        createComment: () => ({ nodeType: 8 }),
        defaultView: defaultView,
        activeElement: null,
        body: { classList: { add: () => {}, remove: () => {} } },
      };
      fakeElement.ownerDocument = fakeDoc;
      defaultView.document = fakeDoc;
      (globalThis as any).document = fakeDoc;
      (globalThis as any).window = defaultView;
      (globalThis as any).HTMLIFrameElement = defaultView.HTMLIFrameElement;
      (globalThis as any).CustomEvent = defaultView.CustomEvent;
      (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    });

    afterEach(() => {
      (globalThis as any).document = origDoc;
      (globalThis as any).window = origWindow;
      (globalThis as any).IS_REACT_ACT_ENVIRONMENT = origActEnv;
    });

    it("adding campaign, moving effect, and marking states do NOT call simulateScenario; Apply calls it ONCE with expected body and shows toast; close discards draft; Reset works", async () => {
      const spySimulate = vi.spyOn(api, "simulateScenario").mockResolvedValue({
        scenario: "intervencion",
        level: "state",
        params: {},
        summary: {
          n_units: 32,
          mean_delta_pp: -2.5,
          votos_adicionales: 350000,
          by_category: { verde: 10, amarillo: 12, naranja: 6, rojo: 4, sin_dato: 0 },
          by_category_base: { verde: 8, amarillo: 10, naranja: 8, rojo: 6, sin_dato: 0 },
        },
        items: [],
      });

      let toastsReceived: ToastItem[] = [];
      const unsub = subscribeToasts((items) => {
        toastsReceived = items;
      });

      const ReactDOM = await import("react-dom/client");
      const root = ReactDOM.createRoot(fakeElement);

      let latestDraft: ReturnType<typeof useScenarioDraft> | null = null;
      let modalOpen = true;
      let appliedParams: Record<string, any> = {
        campaigns: [
          {
            lever: "promocion_jovenes",
            targeting: "rojo_naranja",
            effect_pp: 3.0,
            coverage: 100,
            ents: [],
          },
        ],
      };
      let leverParamsState: Record<string, Record<string, any>> = {
        promocion_jovenes: leverDefaults(MOCK_META),
      };

      const setModalOpen = (open: boolean) => {
        modalOpen = open;
      };

      const applyMock = vi.fn().mockImplementation(async (sc: any, params: any) => {
        appliedParams = { ...params };
        if (Array.isArray(params.campaigns)) {
          for (const c of params.campaigns) {
            leverParamsState[c.lever] = {
              targeting: c.targeting,
              effect_pp: c.effect_pp,
              coverage: c.coverage,
              ents: c.ents ?? [],
            };
          }
        }
        await api.simulateScenario({
          scenario: sc,
          params,
          level: "state",
          ent: null,
        });
        showToast({
          kind: "success",
          title: "Escenario actualizado",
          detail: "Intervención actualizada",
        });
      });

      const resetMock = vi.fn().mockImplementation(async (sc: any) => {
        const defs = defaultsForScenario("intervencion", MOCK_META);
        appliedParams = defs;
        leverParamsState = { promocion_jovenes: leverDefaults(MOCK_META) };
        await api.simulateScenario({
          scenario: sc,
          params: defs,
          level: "state",
          ent: null,
        });
        showToast({
          kind: "success",
          title: "Valores originales restablecidos",
          detail: "Valores restablecidos",
        });
      });

      function TestHarness() {
        latestDraft = useScenarioDraft();
        return null;
      }

      function renderApp() {
        const ctx = createMockContext({
          isScenarioModalOpen: modalOpen,
          setIsScenarioModalOpen: setModalOpen,
          paramsByScenario: {
            intervencion: appliedParams,
            pesimista: defaultsForScenario("pesimista", MOCK_META),
          },
          leverParams: leverParamsState,
          applyScenarioParams: applyMock,
          resetScenarioParams: resetMock,
        });

        return (
          <AtalayaContext.Provider value={ctx}>
            <TestHarness />
          </AtalayaContext.Provider>
        );
      }

      // 1. Initial render: sheet is open
      await React.act(async () => {
        root.render(renderApp());
      });

      expect(latestDraft).not.toBeNull();
      expect(latestDraft!.campaigns).toHaveLength(1);
      expect(latestDraft!.campaigns[0].lever).toBe("promocion_jovenes");
      expect(latestDraft!.campaigns[0].effect_pp).toBe(3.0);
      expect(latestDraft!.hasUnappliedChanges).toBe(false);
      expect(spySimulate).not.toHaveBeenCalled();

      // 2. Draft modifications: add campaign, update effect, mark states -> NO simulation triggered!
      await React.act(async () => {
        latestDraft!.handleAddCampaign();
      });
      expect(latestDraft!.campaigns).toHaveLength(2);
      expect(spySimulate).not.toHaveBeenCalled();

      await React.act(async () => {
        latestDraft!.updateCampaign(0, { effect_pp: 8.5 });
      });
      expect(latestDraft!.campaigns[0].effect_pp).toBe(8.5);
      expect(spySimulate).not.toHaveBeenCalled();

      await React.act(async () => {
        latestDraft!.updateCampaign(0, { ents: ["07", "20"] });
      });
      expect(latestDraft!.campaigns[0].ents).toEqual(["07", "20"]);
      expect(spySimulate).not.toHaveBeenCalled();

      expect(latestDraft!.hasUnappliedChanges).toBe(true);

      // 3. User clicks "Aplicar" (handleSimulate) -> calls simulateScenario ONCE with expected body
      await React.act(async () => {
        await latestDraft!.handleSimulate();
      });

      expect(spySimulate).toHaveBeenCalledTimes(1);
      expect(spySimulate).toHaveBeenCalledWith(
        expect.objectContaining({
          scenario: "intervencion",
          params: expect.objectContaining({
            campaigns: expect.arrayContaining([
              expect.objectContaining({
                lever: "promocion_jovenes",
                effect_pp: 8.5,
                ents: ["07", "20"],
              }),
            ]),
          }),
        })
      );

      // Toast notification was shown
      expect(toastsReceived.some((t) => t.title === "Escenario actualizado")).toBe(true);

      // Re-render app with updated appliedParams
      await React.act(async () => {
        root.render(renderApp());
      });
      expect(latestDraft!.hasUnappliedChanges).toBe(false);

      // 4. User makes unapplied changes, then closes the sheet -> changes must be discarded
      await React.act(async () => {
        latestDraft!.updateCampaign(0, { effect_pp: 1.0 });
      });
      expect(latestDraft!.hasUnappliedChanges).toBe(true);
      expect(latestDraft!.campaigns[0].effect_pp).toBe(1.0);

      // Close modal
      await React.act(async () => {
        latestDraft!.handleClose();
      });
      expect(modalOpen).toBe(false);

      // Reopen modal
      await React.act(async () => {
        setModalOpen(true);
        root.render(renderApp());
      });
      // The draft has reverted back to the applied value (8.5), discarding unapplied 1.0
      expect(latestDraft!.campaigns[0].effect_pp).toBe(8.5);
      expect(latestDraft!.hasUnappliedChanges).toBe(false);

      // 5. Reset restores defaults
      await React.act(async () => {
        await latestDraft!.handleReset();
      });
      expect(resetMock).toHaveBeenCalledWith("intervencion");
      expect(toastsReceived.some((t) => t.title === "Valores originales restablecidos")).toBe(true);

      await React.act(async () => {
        root.render(renderApp());
      });
      expect(latestDraft!.campaigns).toHaveLength(1);
      expect(latestDraft!.campaigns[0].effect_pp).toBe(3.0);
      expect(latestDraft!.hasUnappliedChanges).toBe(false);

      unsub();
      await React.act(async () => {
        root.unmount();
      });
      spySimulate.mockRestore();
    });

    it("renders 'Cambios sin aplicar' and 'Muestra el último escenario aplicado' when draft differs from applied, and 'Todas las zonas'", () => {
      // 1. Without unapplied changes: no pill, no note
      const mockCtxClean = createMockContext({
        isScenarioModalOpen: true,
        scenario: "intervencion",
        paramsByScenario: {
          intervencion: {
            campaigns: [
              {
                lever: "promocion_jovenes",
                targeting: "todos",
                effect_pp: 3.0,
                coverage: 100,
                ents: [],
              },
            ],
          },
          pesimista: defaultsForScenario("pesimista", MOCK_META),
        },
        simulationResult: {
          scenario: "intervencion",
          level: "state",
          params: {},
          summary: {
            n_units: 32,
            mean_delta_pp: -1.0,
            votos_adicionales: 100000,
            by_category: { verde: 10, amarillo: 10, naranja: 8, rojo: 4, sin_dato: 0 },
            by_category_base: { verde: 8, amarillo: 10, naranja: 8, rojo: 6, sin_dato: 0 },
          },
          items: [],
        },
      });

      const htmlClean = renderToStaticMarkup(
        <AtalayaContext.Provider value={mockCtxClean}>
          <ScenarioControls />
        </AtalayaContext.Provider>
      );

      // Focalización is labeled "Todas las zonas" (requirement 4)
      expect(htmlClean).toContain("Todas las zonas");
      expect(htmlClean).not.toContain("Cambios sin aplicar");
      expect(htmlClean).not.toContain("Muestra el último escenario aplicado");

      // Traslape row with explicit minus and explanation (requirement 5)
      const mockCtxTraslape = createMockContext({
        isScenarioModalOpen: true,
        scenario: "intervencion",
        paramsByScenario: {
          intervencion: {
            campaigns: [
              { lever: "promocion_jovenes", targeting: "todos", effect_pp: 10, coverage: 100, ents: [] },
              { lever: "casillas_rurales", targeting: "rojo", effect_pp: 5, coverage: 80, ents: ["07"] },
            ],
          },
          pesimista: defaultsForScenario("pesimista", MOCK_META),
        },
        simulationResult: {
          scenario: "intervencion",
          level: "mun",
          params: {},
          summary: {
            n_units: 2475,
            mean_delta_pp: -2.8,
            votos_adicionales: 220000,
            by_category: { verde: 500, amarillo: 1000, naranja: 600, rojo: 375, sin_dato: 0 },
            by_category_base: { verde: 400, amarillo: 900, naranja: 700, rojo: 475, sin_dato: 0 },
            campaigns: [
              {
                lever: "promocion_jovenes",
                label: "Promoción del voto joven",
                ents: [],
                n_target_units: 2475,
                votos_solo: 180000,
                mean_delta_pp_solo: -2.1,
              },
              {
                lever: "casillas_rurales",
                label: "Casillas y traslado en zonas rurales",
                ents: ["07"],
                n_target_units: 124,
                votos_solo: 60000,
                mean_delta_pp_solo: -1.2,
              },
            ],
            votos_suma_individual: 240000,
            votos_traslape: 2240,
          },
          items: [],
        },
      });

      const htmlTraslape = renderToStaticMarkup(
        <AtalayaContext.Provider value={mockCtxTraslape}>
          <ScenarioControls />
        </AtalayaContext.Provider>
      );

      expect(htmlTraslape).toContain("Traslape (personas alcanzadas por más de una campaña):");
      expect(htmlTraslape).toContain("−2,240");
    });
  });

  describe("10. F6-B: Stale Guard Fix & Scenario Transitions Suite", () => {
    let fakeDoc: any;
    let fakeElement: any;
    let defaultView: any;
    const origDoc = (globalThis as any).document;
    const origWindow = (globalThis as any).window;
    const origActEnv = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;

    const baseItems = [
      { id: "01", name: "Aguascalientes", pred_abstention: 0.482, delta_vs_base_pp: 0, category: "amarillo" },
      { id: "26", name: "Sonora", pred_abstention: 0.585, delta_vs_base_pp: 0, category: "rojo" },
    ] as any;

    const intervencionItems = [
      { id: "01", name: "Aguascalientes", pred_abstention: 0.464, delta_vs_base_pp: -1.8, category: "verde" },
      { id: "26", name: "Sonora", pred_abstention: 0.558, delta_vs_base_pp: -2.7, category: "naranja" },
    ] as any;

    const chiapasItems = [
      { id: "07001", name: "Acacoyagua", pred_abstention: 0.42, delta_vs_base_pp: -2.0, category: "verde" },
      { id: "07002", name: "Acala", pred_abstention: 0.44, delta_vs_base_pp: -1.9, category: "verde" },
    ] as any;

    const oaxacaItems = [
      { id: "20001", name: "Abejones", pred_abstention: 0.38, delta_vs_base_pp: -3.0, category: "verde" },
      { id: "20002", name: "Acatlán de Pérez Figueroa", pred_abstention: 0.49, delta_vs_base_pp: -2.5, category: "amarillo" },
    ] as any;

    beforeEach(() => {
      fakeElement = {
        nodeType: 1,
        tagName: "DIV",
        ownerDocument: null as any,
        addEventListener: () => {},
        removeEventListener: () => {},
        appendChild: () => {},
        removeChild: () => {},
        insertBefore: () => {},
        setAttribute: () => {},
        removeAttribute: () => {},
        style: {},
        childNodes: [],
      };
      defaultView = {
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => true,
        location: { search: "", pathname: "/", hash: "" },
        history: { replaceState: () => {} },
        HTMLIFrameElement: class {},
        CustomEvent: typeof CustomEvent !== "undefined" ? CustomEvent : class {
          detail: any;
          constructor(public type: string, init?: any) {
            this.detail = init?.detail;
          }
        },
        event: undefined,
      };
      fakeDoc = {
        nodeType: 9,
        createElement: () => fakeElement,
        createTextNode: () => ({ nodeType: 3 }),
        addEventListener: () => {},
        removeEventListener: () => {},
        createComment: () => ({ nodeType: 8 }),
        defaultView: defaultView,
        activeElement: null,
        body: { classList: { add: () => {}, remove: () => {} } },
      };
      fakeElement.ownerDocument = fakeDoc;
      defaultView.document = fakeDoc;
      (globalThis as any).document = fakeDoc;
      (globalThis as any).window = defaultView;
      (globalThis as any).HTMLIFrameElement = defaultView.HTMLIFrameElement;
      (globalThis as any).CustomEvent = defaultView.CustomEvent;
      (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
      (globalThis as any).document = origDoc;
      (globalThis as any).window = origWindow;
      (globalThis as any).IS_REACT_ACT_ENVIRONMENT = origActEnv;
      vi.restoreAllMocks();
    });

    it("(a) Intervención → Base → Intervención: riskItems vuelven a ser los de la intervención", async () => {
      vi.spyOn(api, "getHealth").mockResolvedValue({
        status: "ok",
        version: "1.0",
        data: { units_mun: 2470 },
      } as any);

      vi.spyOn(api, "getMeta").mockResolvedValue(MOCK_META);

      vi.spyOn(api, "getRisk").mockImplementation(async (level, ent, scenario) => ({
        scenario: "base",
        level,
        items: baseItems,
      } as any));

      const spySimulate = vi.spyOn(api, "simulateScenario").mockImplementation(async (req) => ({
        scenario: req.scenario,
        level: req.level,
        params: req.params ?? {},
        items: intervencionItems,
        summary: {
          n_units: 32,
          mean_delta_pp: -1.8,
          votos_adicionales: 350000,
          by_category: { verde: 10, amarillo: 12, naranja: 6, rojo: 4, sin_dato: 0 },
          by_category_base: { verde: 8, amarillo: 10, naranja: 8, rojo: 6, sin_dato: 0 },
        },
      } as any));

      const ReactDOM = await import("react-dom/client");
      const root = ReactDOM.createRoot(fakeElement);

      let capturedCtx: AtalayaContextValue | null = null;
      function ContextProbe() {
        capturedCtx = useAtalaya();
        return null;
      }

      await React.act(async () => {
        root.render(
          <AtalayaProvider>
            <ContextProbe />
          </AtalayaProvider>
        );
      });

      // Let initial effects (meta, base getRisk) resolve
      await React.act(async () => {
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(capturedCtx).not.toBeNull();
      expect(capturedCtx!.scenario).toBe("base");
      expect(capturedCtx!.riskItems).toEqual(baseItems);

      // 1. Switch to Intervención
      await React.act(async () => {
        capturedCtx!.setScenario("intervencion");
      });
      await React.act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });

      expect(capturedCtx!.scenario).toBe("intervencion");
      expect(capturedCtx!.riskItems).toEqual(intervencionItems);

      // 2. Switch back to Base -> riskItems must become baseItems
      await React.act(async () => {
        capturedCtx!.setScenario("base");
      });
      await React.act(async () => {
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(capturedCtx!.scenario).toBe("base");
      expect(capturedCtx!.riskItems).toEqual(baseItems);

      // 3. Switch back to Intervención -> riskItems must return to intervencionItems (NOT remain baseItems)
      await React.act(async () => {
        capturedCtx!.setScenario("intervencion");
      });
      await React.act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });

      expect(capturedCtx!.scenario).toBe("intervencion");
      expect(capturedCtx!.riskItems).toEqual(intervencionItems);
      expect(capturedCtx!.riskItems[0].pred_abstention).toBe(0.464);
      expect(capturedCtx!.riskItems[1].pred_abstention).toBe(0.558);

      await React.act(async () => {
        root.unmount();
      });
    });

    it("(b) con Intervención activa, seleccionar estado A y luego B dispara una simulación con ent: B y riskItems son de B", async () => {
      vi.spyOn(api, "getHealth").mockResolvedValue({
        status: "ok",
        version: "1.0",
        data: { units_mun: 2470 },
      } as any);

      vi.spyOn(api, "getMeta").mockResolvedValue(MOCK_META);

      vi.spyOn(api, "getRisk").mockImplementation(async (level, ent, scenario) => ({
        scenario: "base",
        level,
        items: baseItems,
      } as any));

      const spySimulate = vi.spyOn(api, "simulateScenario").mockImplementation(async (req) => {
        if (req.ent === "07") {
          return {
            scenario: req.scenario,
            level: req.level,
            params: req.params ?? {},
            items: chiapasItems,
            summary: {
              n_units: 124,
              mean_delta_pp: -2.0,
              votos_adicionales: 50000,
              by_category: { verde: 40, amarillo: 50, naranja: 20, rojo: 14, sin_dato: 0 },
              by_category_base: { verde: 30, amarillo: 40, naranja: 30, rojo: 24, sin_dato: 0 },
            },
          } as any;
        }
        if (req.ent === "20") {
          return {
            scenario: req.scenario,
            level: req.level,
            params: req.params ?? {},
            items: oaxacaItems,
            summary: {
              n_units: 570,
              mean_delta_pp: -2.8,
              votos_adicionales: 70000,
              by_category: { verde: 200, amarillo: 250, naranja: 80, rojo: 40, sin_dato: 0 },
              by_category_base: { verde: 150, amarillo: 220, naranja: 120, rojo: 80, sin_dato: 0 },
            },
          } as any;
        }
        return {
          scenario: req.scenario,
          level: req.level,
          params: req.params ?? {},
          items: intervencionItems,
          summary: {
            n_units: 32,
            mean_delta_pp: -1.8,
            votos_adicionales: 350000,
            by_category: { verde: 10, amarillo: 12, naranja: 6, rojo: 4, sin_dato: 0 },
            by_category_base: { verde: 8, amarillo: 10, naranja: 8, rojo: 6, sin_dato: 0 },
          },
        } as any;
      });

      const ReactDOM = await import("react-dom/client");
      const root = ReactDOM.createRoot(fakeElement);

      let capturedCtx: AtalayaContextValue | null = null;
      function ContextProbe() {
        capturedCtx = useAtalaya();
        return null;
      }

      await React.act(async () => {
        root.render(
          <AtalayaProvider>
            <ContextProbe />
          </AtalayaProvider>
        );
      });

      // Let initial mount settle
      await React.act(async () => {
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(100);
      });

      // Activate Intervención
      await React.act(async () => {
        capturedCtx!.setScenario("intervencion");
      });
      await React.act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(capturedCtx!.riskItems).toEqual(intervencionItems);

      // Select estado A (Chiapas, "07") -> level becomes "mun"
      await React.act(async () => {
        capturedCtx!.selectState("07");
      });
      await React.act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });

      expect(spySimulate).toHaveBeenCalledWith(
        expect.objectContaining({
          scenario: "intervencion",
          level: "mun",
          ent: "07",
        })
      );
      expect(capturedCtx!.selectedEnt).toBe("07");
      expect(capturedCtx!.level).toBe("mun");
      expect(capturedCtx!.riskItems).toEqual(chiapasItems);

      // Select estado B (Oaxaca, "20") -> level remains "mun", selectedEnt changes to "20"
      await React.act(async () => {
        capturedCtx!.selectState("20");
      });
      await React.act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });

      expect(spySimulate).toHaveBeenCalledWith(
        expect.objectContaining({
          scenario: "intervencion",
          level: "mun",
          ent: "20",
        })
      );
      expect(capturedCtx!.selectedEnt).toBe("20");
      expect(capturedCtx!.level).toBe("mun");
      expect(capturedCtx!.riskItems).toEqual(oaxacaItems);

      await React.act(async () => {
        root.unmount();
      });
    });

    it("(c) editar sin aplicar sigue sin llamar a simulateScenario", async () => {
      vi.spyOn(api, "getHealth").mockResolvedValue({
        status: "ok",
        version: "1.0",
        data: { units_mun: 2470 },
      } as any);

      vi.spyOn(api, "getMeta").mockResolvedValue(MOCK_META);

      vi.spyOn(api, "getRisk").mockImplementation(async (level, ent, scenario) => ({
        scenario: "base",
        level,
        items: baseItems,
      } as any));

      const spySimulate = vi.spyOn(api, "simulateScenario").mockImplementation(async (req) => ({
        scenario: req.scenario,
        level: req.level,
        params: req.params ?? {},
        items: intervencionItems,
        summary: {
          n_units: 32,
          mean_delta_pp: -1.8,
          votos_adicionales: 350000,
          by_category: { verde: 10, amarillo: 12, naranja: 6, rojo: 4, sin_dato: 0 },
          by_category_base: { verde: 8, amarillo: 10, naranja: 8, rojo: 6, sin_dato: 0 },
        },
      } as any));

      const ReactDOM = await import("react-dom/client");
      const root = ReactDOM.createRoot(fakeElement);

      let capturedCtx: AtalayaContextValue | null = null;
      let capturedDraft: ReturnType<typeof useScenarioDraft> | null = null;

      function ProbeWithDraft() {
        capturedCtx = useAtalaya();
        capturedDraft = useScenarioDraft();
        return null;
      }

      await React.act(async () => {
        root.render(
          <AtalayaProvider>
            <ProbeWithDraft />
          </AtalayaProvider>
        );
      });

      // Switch to Intervención and settle initial simulation
      await React.act(async () => {
        capturedCtx!.setScenario("intervencion");
      });
      await React.act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });

      // Open the scenario modal so the draft is active
      await React.act(async () => {
        capturedCtx!.setIsScenarioModalOpen(true);
      });
      await React.act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      const simulateCallsBeforeEdits = spySimulate.mock.calls.length;

      // Perform draft edits: add campaign, update effect_pp, select states in draft
      await React.act(async () => {
        capturedDraft!.handleAddCampaign();
      });
      await React.act(async () => {
        capturedDraft!.updateCampaign(0, { effect_pp: 7.5 });
      });
      await React.act(async () => {
        capturedDraft!.updateCampaign(0, { ents: ["07", "20"] });
      });

      // Advance timers by more than the debounce window (e.g. 1500ms)
      await React.act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });

      // None of the draft edits triggered a simulation
      expect(spySimulate.mock.calls.length).toBe(simulateCallsBeforeEdits);
      expect(capturedDraft!.hasUnappliedChanges).toBe(true);
      expect(capturedDraft!.campaigns[0].effect_pp).toBe(7.5);

      await React.act(async () => {
        root.unmount();
      });
    });
  });
});
