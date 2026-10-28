import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getIntelStatus,
  checkOperator,
  requestCampaign,
  getCachedCampaign,
  exportCampaign,
  getJob,
  pollJob,
  getMonitor,
  scanMonitor,
  postRegistry,
  getRegistry,
  IntelApiError,
} from "../lib/intel/api";
import { setOperatorToken, clearOperatorToken, getOperatorToken } from "../lib/intel/operator";
import type { Job, SlidesOverride } from "../lib/intel/types";

describe("Intel API Client Suite (intelApi.test.ts)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    clearOperatorToken();
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearOperatorToken();
  });

  it("checkOperator sends X-Operator-Token and resolves on 204", async () => {
    let capturedHeaders: Headers | undefined;
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      capturedHeaders = new Headers(init?.headers);
      return new Response(null, { status: 204 });
    });

    const result = await checkOperator("clave_secreta_ine");
    expect(result).toBe(true);
    expect(capturedHeaders?.get("X-Operator-Token")).toBe("clave_secreta_ine");
  });

  it("checkOperator throws IntelApiError with backend 401 detail", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      return new Response(
        JSON.stringify({ detail: "Clave de operador inválida." }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    });

    await expect(checkOperator("clave_incorrecta")).rejects.toThrow(IntelApiError);
    try {
      await checkOperator("clave_incorrecta");
    } catch (err: any) {
      expect(err.status).toBe(401);
      expect(err.detail).toBe("Clave de operador inválida.");
    }
  });

  it("automatically attaches operator token from storage to requests", async () => {
    setOperatorToken("token_almacenado_123");
    let capturedHeaders: Headers | undefined;

    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      capturedHeaders = new Headers(init?.headers);
      return new Response(
        JSON.stringify({ status: "done", plan: { id: "plan_1" } }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    await requestCampaign({ unit_id: "07" });
    expect(capturedHeaders?.get("X-Operator-Token")).toBe("token_almacenado_123");

    // Clear token -> header omitted
    clearOperatorToken();
    await requestCampaign({ unit_id: "07" });
    expect(capturedHeaders?.get("X-Operator-Token")).toBeNull();
  });

  it("handles 429 rate limit errors with Retry-After header", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      return new Response(
        JSON.stringify({ detail: "Espera 45 s antes de volver a escanear." }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": "45",
          },
        }
      );
    });

    try {
      await scanMonitor({ refresh: true });
      expect.unreachable();
    } catch (err: any) {
      expect(err).toBeInstanceOf(IntelApiError);
      expect(err.status).toBe(429);
      expect(err.detail).toBe("Espera 45 s antes de volver a escanear.");
      expect(err.retryAfterS).toBe(45);
    }
  });

  it("exportCampaign reads Content-Disposition filename and returns blob with filename", async () => {
    const fakeContent = "fake pdf binary data";
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      return new Response(fakeContent, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": 'attachment; filename="AtalayaElectoral_PlanCampana_Chiapas_20261028.pdf"',
        },
      });
    });

    const override: SlidesOverride = { plan_id: "plan_chiapas", format: "pdf" };
    const { blob, filename } = await exportCampaign(override);

    expect(filename).toBe("AtalayaElectoral_PlanCampana_Chiapas_20261028.pdf");
    expect(blob).toBeDefined();
    expect(blob.size).toBe(fakeContent.length);
  });

  it("exportCampaign handles RFC 5987 UTF-8 encoded filename", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      return new Response("binary", {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": "attachment; filename*=UTF-8''AtalayaElectoral_Michoac%C3%A1n_2027.pdf",
        },
      });
    });

    const { filename } = await exportCampaign({ plan_id: "plan_16", format: "pdf" });
    expect(filename).toBe("AtalayaElectoral_Michoacán_2027.pdf");
  });

  it("pollJob polls until job status is done, invoking onUpdate", async () => {
    let callCount = 0;
    const stages = ["queued", "running", "done"] as const;

    globalThis.fetch = vi.fn().mockImplementation(async () => {
      const status = stages[Math.min(callCount, stages.length - 1)];
      const progress = status === "done" ? 100 : (callCount + 1) * 35;
      callCount++;

      const job: Job = {
        id: "job_xyz",
        kind: "campaign",
        key: "07",
        status,
        stage: `Etapa ${status}`,
        progress,
        created_at: "2026-10-28T12:00:00Z",
      };

      return new Response(JSON.stringify(job), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const updates: Job[] = [];
    const finalJob = await pollJob("job_xyz", {
      intervalMs: 10,
      onUpdate: (j) => updates.push(j),
    });

    expect(finalJob.status).toBe("done");
    expect(finalJob.progress).toBe(100);
    expect(updates.length).toBeGreaterThanOrEqual(3);
  });

  it("pollJob stops immediately when job status is error", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      const job: Job = {
        id: "job_err",
        kind: "campaign",
        key: "07",
        status: "error",
        stage: "Falla de validación",
        progress: 40,
        error: "Error en la consulta de fuentes",
        created_at: "2026-10-28T12:00:00Z",
      };
      return new Response(JSON.stringify(job), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const job = await pollJob("job_err", { intervalMs: 10 });
    expect(job.status).toBe("error");
    expect(job.error).toBe("Error en la consulta de fuentes");
  });

  it("pollJob aborts cleanly when AbortSignal fires", async () => {
    const controller = new AbortController();

    globalThis.fetch = vi.fn().mockImplementation(async () => {
      const job: Job = {
        id: "job_abort",
        kind: "campaign",
        key: "07",
        status: "running",
        stage: "Investigando...",
        progress: 25,
        created_at: "2026-10-28T12:00:00Z",
      };
      return new Response(JSON.stringify(job), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const pollPromise = pollJob("job_abort", {
      intervalMs: 50,
      signal: controller.signal,
    });

    // Abort after 20ms
    setTimeout(() => controller.abort(), 20);

    await expect(pollPromise).rejects.toThrow(/cancelad/i);
  });

  it("falls back to mocks on network failure for getMonitor and getCachedCampaign", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    const monitor = await getMonitor();
    expect(monitor).toBeDefined();
    expect(monitor.items.length).toBeGreaterThanOrEqual(4);

    const campaign = await getCachedCampaign("07");
    expect(campaign).toBeDefined();
    expect(campaign.unit.ent_name).toBe("Chiapas");
  });
});
