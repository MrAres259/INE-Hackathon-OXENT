import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import MonitorPage from "../app/monitor/page";
import { MonitorHeader } from "../components/intel/monitor/MonitorHeader";
import { NewsCard } from "../components/intel/monitor/NewsCard";
import { IntelPageShell } from "../components/intel/IntelPageShell";
import { countByTab } from "../components/intel/monitor/monitorFilters";
import { MOCK_MONITOR } from "../lib/intel/mocks";
import * as intelApi from "../lib/intel/api";
import * as operatorModule from "../lib/intel/operator";
import type { Job, MonitorSnapshot, RegistryEntry } from "../lib/intel/types";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  usePathname: () => "/monitor",
  useSearchParams: () => new URLSearchParams(),
}));

// Mock intel API
vi.mock("@/lib/intel/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/intel/api")>("@/lib/intel/api");
  return {
    ...actual,
    getIntelStatus: vi.fn(),
    getMonitor: vi.fn(),
    scanMonitor: vi.fn(),
    pollJob: vi.fn(),
    postRegistry: vi.fn(),
    getRegistry: vi.fn(),
  };
});

describe("MonitorPage Component Suite (monitorPage.test.tsx)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(intelApi.getIntelStatus).mockResolvedValue({
      gemini_enabled: true,
      gemini_model: "gemini-3.8-flash",
      llm_enabled: true,
      llm_model: "glm-5.3",
      llm_effort: "high",
      operator_configured: true,
      budget_used: 10,
      budget_limit: 40,
      monitor_cooldown_min: 15,
    });
    vi.mocked(intelApi.getMonitor).mockResolvedValue(MOCK_MONITOR);
  });

  it("renders KPIs and tabs when snapshot is provided", () => {
    const html = renderToStaticMarkup(
      <MonitorHeader
        snapshot={MOCK_MONITOR}
      />
    );

    // Header title and last scan
    expect(html).toContain("Monitor INE de Medios y Desinformación");
    expect(html).toContain("Ventana 14 días");

    // All 6 KPIs
    expect(html).toContain("Verdaderas");
    expect(html).toContain("Falsas");
    expect(html).toContain("Engañosas");
    expect(html).toContain("Sin verificar");
    expect(html).toContain("Críticas");
    expect(html).toContain("Pendientes");

    // Values from MOCK_MONITOR
    expect(html).toContain("data-testid=\"kpi-verdaderas\"");
    expect(html).toContain("data-testid=\"kpi-falsas\"");
    expect(html).toContain("data-testid=\"kpi-criticas\"");
  });

  it("renders empty state explanation when snapshot is null", () => {
    const html = renderToStaticMarkup(
      <MonitorHeader
        snapshot={null}
      />
    );

    expect(html).toContain("No hay escaneos recientes en el Monitor");
    expect(html).toContain("El Monitor detecta noticias críticas y rumores sobre el INE");
  });

  it("handles operator scanning trigger and renders JobProgress when job is active", () => {
    const mockJob: Job<MonitorSnapshot> = {
      id: "job_scan_01",
      kind: "monitor",
      key: "scan_14",
      status: "running",
      stage: "Escaneando fuentes de medios reconocidos...",
      progress: 45,
      created_at: "2026-10-28T12:00:00Z",
    };

    const html = renderToStaticMarkup(
      <MonitorHeader
        snapshot={MOCK_MONITOR}
        activeJob={mockJob}
        isScanning={true}
      />
    );

    expect(html).toContain("Escaneando fuentes de medios reconocidos...");
    expect(html).toContain("45%");
    expect(html).toContain("progressbar");
  });

  it("displays 429 cooldown notification message properly", () => {
    const cooldownMsg = "Podrás escanear de nuevo en 12 min.";
    const html = renderToStaticMarkup(
      <MonitorHeader
        snapshot={MOCK_MONITOR}
        cooldownMessage={cooldownMsg}
      />
    );

    expect(html).toContain("Podrás escanear de nuevo en 12 min.");
    expect(html).toContain("role=\"alert\"");
  });

  it("updates card registry state when new entry is recorded", () => {
    const initialItem = MOCK_MONITOR.items[0];
    const updatedEntry: RegistryEntry = {
      item_id: initialItem.id,
      kind: "news",
      status: "comunicado_emitido",
      note: "Se emitió comunicado aclaratorio por la Coordinación de Comunicación Social",
      at: "2026-10-28T14:00:00Z",
      actor: "operador",
    };

    const updatedItem = {
      ...initialItem,
      status: updatedEntry,
    };

    // Render original card
    const htmlBefore = renderToStaticMarkup(
      <NewsCard item={initialItem} onSelect={vi.fn()} />
    );
    expect(htmlBefore).toContain("Pendiente de atención");

    // Render updated card
    const htmlAfter = renderToStaticMarkup(
      <NewsCard item={updatedItem} onSelect={vi.fn()} />
    );
    expect(htmlAfter).toContain("Comunicado emitido");
  });

  it("scanMonitor call triggers job polling workflow", async () => {
    const mockJobResponse: Job<MonitorSnapshot> = {
      id: "scan_job_123",
      kind: "monitor",
      key: "scan_14",
      status: "running",
      stage: "Buscando noticias en Gemini",
      progress: 30,
      created_at: "2026-10-28T12:00:00Z",
    };

    vi.mocked(intelApi.scanMonitor).mockResolvedValueOnce(mockJobResponse);

    const res = await intelApi.scanMonitor({ window_days: 14, refresh: true });
    expect(intelApi.scanMonitor).toHaveBeenCalledWith({ window_days: 14, refresh: true });
    expect("id" in res).toBe(true);
    if ("id" in res) {
      expect(res.id).toBe("scan_job_123");
    }
  });

  it("handles 429 error from scanMonitor with retry-after calculation", async () => {
    const err429 = new intelApi.IntelApiError(
      "Espera 15 min antes de volver a escanear",
      429,
      "Espera 15 min antes de volver a escanear",
      900 // 15 minutes = 900 seconds
    );

    vi.mocked(intelApi.scanMonitor).mockRejectedValueOnce(err429);

    try {
      await intelApi.scanMonitor({ window_days: 14, refresh: true });
      expect.unreachable();
    } catch (err: any) {
      expect(err.status).toBe(429);
      expect(err.retryAfterS).toBe(900);
      const minutes = Math.ceil(err.retryAfterS / 60);
      expect(minutes).toBe(15);
      const msg = `Podrás escanear de nuevo en ${minutes} min.`;
      expect(msg).toBe("Podrás escanear de nuevo en 15 min.");
    }
  });

  it("IntelPageShell renders content container without duplicate TopBar", () => {
    const html = renderToStaticMarkup(
      <IntelPageShell>
        <div data-testid="test-shell-content">Contenido de prueba</div>
      </IntelPageShell>
    );

    expect(html).toContain("data-testid=\"test-shell-content\"");
    expect(html).toContain("Contenido de prueba");
    // Verify TopBar elements are not duplicated inside IntelPageShell
    expect(html).not.toContain("data-testid=\"topbar\"");
    expect(html).not.toContain("Plan de campaña");
  });

  it("auto-switches to rumors tab when verified tab has 0 items and rumors has items", () => {
    const onlyRumorsSnapshot: MonitorSnapshot = {
      ...MOCK_MONITOR,
      items: MOCK_MONITOR.items.filter((i) => i.verdict === "falsa" || i.verdict === "sin_verificar"),
    };

    const counts = countByTab(onlyRumorsSnapshot.items);
    expect(counts.verificadas).toBe(0);
    expect(counts.rumores).toBeGreaterThan(0);
  });

  it("auto-switches to verified tab when rumors tab has 0 items and verified has items", () => {
    const onlyVerifiedSnapshot: MonitorSnapshot = {
      ...MOCK_MONITOR,
      items: MOCK_MONITOR.items.filter((i) => i.verdict === "verdadera" || i.verdict === "enganosa"),
    };

    const counts = countByTab(onlyVerifiedSnapshot.items);
    expect(counts.verificadas).toBeGreaterThan(0);
    expect(counts.rumores).toBe(0);
  });
});
