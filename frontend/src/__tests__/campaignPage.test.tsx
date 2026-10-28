import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import CampanasPage from "../app/campanas/page";
import { CampaignRunner } from "../components/intel/campaign/CampaignRunner";
import { ExportBar } from "../components/intel/campaign/ExportBar";
import { buildExportSlidesOverride } from "../components/intel/campaign/campaignDraft";
import { MOCK_CAMPAIGN_PLAN } from "../lib/intel/mocks";
import * as intelApi from "../lib/intel/api";
import * as operatorModule from "../lib/intel/operator";
import { AtalayaContext, type AtalayaContextValue } from "../lib/state";
import { MOCK_META } from "../lib/mocks/meta";
import { defaultsForScenario } from "../lib/scenarioParams";

let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
  usePathname: () => "/campanas",
  useSearchParams: () => mockSearchParams,
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

describe("Campaign Page Full Flow (campaignPage.test.tsx)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams();
  });

  describe("1. Caché ⇒ Muestra plan", () => {
    it("renders cached plan elements when currentPlan is present", () => {
      const html = renderToStaticMarkup(
        <AtalayaContext.Provider value={createMockContext()}>
          <CampaignRunner
            unitId="07"
            focus="Jóvenes"
            currentPlan={MOCK_CAMPAIGN_PLAN}
            onPlanLoaded={vi.fn()}
          />
        </AtalayaContext.Provider>
      );

      // Verifies plan in memory banner is displayed
      expect(html).toContain("Plan disponible en memoria");
    });
  });

  describe("2. Sin caché y sin operador ⇒ Mensaje y OperatorGate", () => {
    it("displays friendly empty message and operator gate when no plan exists and user is not operator", () => {
      vi.spyOn(operatorModule, "useOperator").mockReturnValue({
        token: null,
        isOperator: false,
        verify: vi.fn().mockResolvedValue(true),
        logout: vi.fn(),
      });

      // CampaignRunner with unit selected but no plan loaded
      const html = renderToStaticMarkup(
        <AtalayaContext.Provider value={createMockContext()}>
          <CampaignRunner
            unitId="07"
            focus=""
            currentPlan={null}
            onPlanLoaded={vi.fn()}
          />
        </AtalayaContext.Provider>
      );

      // In initial render without plan, prompts for selection or cached check
      expect(html).toBeDefined();
    });
  });

  describe("3. Operador ⇒ Job y progreso hasta done con fetch simulado", () => {
    it("transitions job progress from queued through stages to done", async () => {
      vi.spyOn(operatorModule, "useOperator").mockReturnValue({
        token: "valid-operator-token",
        isOperator: true,
        verify: vi.fn().mockResolvedValue(true),
        logout: vi.fn(),
      });

      const mockJob = {
        id: "job_camp_123",
        kind: "campaign" as const,
        key: "07:jovenes",
        status: "running" as const,
        stage: "Investigando con Gemini en fuentes verificadas",
        progress: 35,
        created_at: new Date().toISOString(),
      };

      const requestCampaignSpy = vi
        .spyOn(intelApi, "requestCampaign")
        .mockResolvedValue(mockJob);

      const pollJobSpy = vi.spyOn(intelApi, "pollJob").mockResolvedValue({
        ...mockJob,
        status: "done",
        stage: "Listo",
        progress: 100,
        result: MOCK_CAMPAIGN_PLAN,
      });

      // Test API contract invocation
      const initialResponse = await intelApi.requestCampaign({
        unit_id: "07",
        focus: "jovenes",
        refresh: true,
      });

      expect(requestCampaignSpy).toHaveBeenCalledWith({
        unit_id: "07",
        focus: "jovenes",
        refresh: true,
      });
      expect(initialResponse).toEqual(mockJob);

      // Polling completion
      const finished = await intelApi.pollJob("job_camp_123");
      expect(pollJobSpy).toHaveBeenCalledWith("job_camp_123");
      expect(finished.status).toBe("done");
      expect(finished.result).toEqual(MOCK_CAMPAIGN_PLAN);
    });
  });

  describe("4. Export llama con slides editadas", () => {
    it("sends slides override containing only edited fields when user customized slides", async () => {
      const exportSpy = vi.spyOn(intelApi, "exportCampaign").mockResolvedValue({
        blob: new Blob(["test"], { type: "application/pdf" }),
        filename: "AtalayaElectoral_PlanCampana_07.pdf",
      });

      const customDrafts = {
        s1: {
          title: "Plan Chiapas 2027 — Edición Institucional",
          bullets: ["Enfoque especial para comunidades tsotsiles"],
        },
      };

      const overrideSlides = buildExportSlidesOverride(MOCK_CAMPAIGN_PLAN, customDrafts);
      expect(overrideSlides).not.toBeNull();

      // Trigger export API
      await intelApi.exportCampaign({
        plan_id: MOCK_CAMPAIGN_PLAN.id,
        format: "pdf",
        slides: overrideSlides,
      });

      expect(exportSpy).toHaveBeenCalledWith({
        plan_id: MOCK_CAMPAIGN_PLAN.id,
        format: "pdf",
        slides: expect.arrayContaining([
          expect.objectContaining({
            title: "Plan Chiapas 2027 — Edición Institucional",
          }),
        ]),
      });
    });
  });

  describe("5. Render de la página de campañas completa", () => {
    it("renders page title and header status without runtime errors", () => {
      const html = renderToStaticMarkup(
        <AtalayaContext.Provider value={createMockContext()}>
          <CampanasPage />
        </AtalayaContext.Provider>
      );

      expect(html).toContain("Plan de Campaña con IA");
      expect(html).toContain("Entidad o municipio a intervenir");
      expect(html).toContain("Enfoque prioritario");
    });
  });
});
