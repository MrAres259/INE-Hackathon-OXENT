// ATALAYA Intel API Client
import type {
  CampaignPlan,
  CampaignRequest,
  IntelStatus,
  Job,
  MonitorScanRequest,
  MonitorSnapshot,
  NewsImpact,
  RegistryEntry,
  SlidesOverride,
  Level,
} from "./types";
import { getOperatorToken } from "./operator";
import { MOCK_CAMPAIGN_PLAN, MOCK_MONITOR } from "./mocks";
import { isMockEnabled } from "@/lib/api";
import { redirectToLogin } from "@/lib/auth";

export class IntelApiError extends Error {
  status: number;
  detail: string;
  retryAfterS?: number | null;

  constructor(message: string, status: number, detail?: string, retryAfterS?: number | null) {
    super(message);
    this.name = "IntelApiError";
    this.status = status;
    this.detail = detail || message;
    this.retryAfterS = retryAfterS;
  }
}

function parseRetryAfter(headerVal: string | null): number | null {
  if (!headerVal) return null;
  const parsed = parseFloat(headerVal);
  return Number.isFinite(parsed) ? parsed : null;
}

function getHeaders(initHeaders?: HeadersInit, explicitToken?: string): Headers {
  const headers = new Headers(initHeaders);
  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }
  const token = explicitToken !== undefined ? explicitToken : getOperatorToken();
  if (token) {
    headers.set("X-Operator-Token", token);
  }
  return headers;
}

async function requestJson<T>(url: string, init?: RequestInit, explicitToken?: string): Promise<T> {
  const headers = getHeaders(init?.headers, explicitToken);
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      credentials: "same-origin",
      headers,
    });
  } catch (netErr: any) {
    throw new IntelApiError(
      netErr?.message || "Error de red al conectar con el servidor",
      0,
      "No fue posible conectar con el servicio de Inteligencia."
    );
  }

  if (!res.ok) {
    if (res.status === 401) {
      redirectToLogin();
    }
    let detail = `Error ${res.status}: ${res.statusText}`;
    let retryAfterS = parseRetryAfter(res.headers.get("Retry-After"));

    try {
      const errJson = await res.json();
      if (errJson && typeof errJson === "object") {
        if (typeof errJson.detail === "string") {
          detail = errJson.detail;
        } else if (errJson.detail) {
          detail = JSON.stringify(errJson.detail);
        } else if (typeof errJson.message === "string") {
          detail = errJson.message;
        }
      }
    } catch {
      try {
        const text = await res.text();
        if (text) detail = text;
      } catch {
        // use fallback
      }
    }

    throw new IntelApiError(detail, res.status, detail, retryAfterS);
  }

  if (res.status === 204) {
    return undefined as unknown as T;
  }

  return (await res.json()) as T;
}

// 1. GET /api/intel/status
export async function getIntelStatus(): Promise<IntelStatus> {
  if (isMockEnabled()) {
    return {
      gemini_enabled: true,
      gemini_model: "gemini-3.8-flash",
      llm_enabled: true,
      llm_model: "glm-5.3",
      llm_effort: "high",
      operator_configured: true,
      budget_used: 12,
      budget_limit: 40,
      monitor_cooldown_min: 15,
    };
  }

  try {
    return await requestJson<IntelStatus>("/api/intel/status");
  } catch (err: any) {
    if (err.status === 0 || err.status >= 500) {
      return {
        gemini_enabled: false,
        gemini_model: "gemini-3.8-flash",
        llm_enabled: true,
        llm_model: "glm-5.3",
        llm_effort: "high",
        operator_configured: false,
        budget_used: 0,
        budget_limit: 40,
        monitor_cooldown_min: 15,
      };
    }
    throw err;
  }
}

// 2. POST /api/intel/operator/check
export async function checkOperator(token?: string): Promise<boolean> {
  await requestJson<void>(
    "/api/intel/operator/check",
    {
      method: "POST",
    },
    token
  );
  return true;
}

// 3. POST /api/intel/campaign
export async function requestCampaign(
  req: CampaignRequest
): Promise<{ status: "done"; plan: CampaignPlan } | Job<CampaignPlan>> {
  return await requestJson<{ status: "done"; plan: CampaignPlan } | Job<CampaignPlan>>(
    "/api/intel/campaign",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    }
  );
}

// 4. GET /api/intel/campaign/{unit_id}?focus=
export async function getCachedCampaign(
  unitId: string,
  focus?: string | null
): Promise<CampaignPlan> {
  if (isMockEnabled()) {
    return MOCK_CAMPAIGN_PLAN;
  }

  const query = new URLSearchParams();
  if (focus) query.set("focus", focus);
  const qStr = query.toString();
  const url = `/api/intel/campaign/${encodeURIComponent(unitId)}${qStr ? `?${qStr}` : ""}`;

  try {
    return await requestJson<CampaignPlan>(url);
  } catch (err: any) {
    if (err.status === 0 || isMockEnabled()) {
      return MOCK_CAMPAIGN_PLAN;
    }
    throw err;
  }
}

// 5. POST /api/intel/campaign/export
export async function exportCampaign(
  override: SlidesOverride
): Promise<{ blob: Blob; filename: string }> {
  const headers = getHeaders({
    "Content-Type": "application/json",
  });

  let res: Response;
  try {
    res = await fetch("/api/intel/campaign/export", {
      method: "POST",
      credentials: "same-origin",
      headers,
      body: JSON.stringify(override),
    });
  } catch (netErr: any) {
    throw new IntelApiError(
      netErr?.message || "Error al descargar el archivo de exportación",
      0,
      "No fue posible conectar con el servicio de exportación."
    );
  }

  if (!res.ok) {
    if (res.status === 401) {
      redirectToLogin();
    }
    let detail = `Error ${res.status}: ${res.statusText}`;
    try {
      const errJson = await res.json();
      if (errJson?.detail) {
        detail = typeof errJson.detail === "string" ? errJson.detail : JSON.stringify(errJson.detail);
      }
    } catch {
      // ignore
    }
    throw new IntelApiError(detail, res.status, detail);
  }

  // Parse filename from Content-Disposition
  let filename = `AtalayaElectoral_PlanCampana_${override.plan_id}.${override.format}`;
  const disposition = res.headers.get("Content-Disposition");
  if (disposition) {
    const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match && utf8Match[1]) {
      filename = decodeURIComponent(utf8Match[1].trim());
    } else {
      const match = disposition.match(/filename=["']?([^"';]+)["']?/i);
      if (match && match[1]) {
        filename = match[1].trim();
      }
    }
  }

  const blob = await res.blob();
  return { blob, filename };
}

// 6. GET /api/intel/jobs/{job_id}
export async function getJob<T = unknown>(jobId: string): Promise<Job<T>> {
  return await requestJson<Job<T>>(`/api/intel/jobs/${encodeURIComponent(jobId)}`);
}

// 7. Polling helper with backoff and AbortSignal
export async function pollJob<T = unknown>(
  jobId: string,
  options?: {
    onUpdate?: (job: Job<T>) => void;
    signal?: AbortSignal;
    intervalMs?: number;
  }
): Promise<Job<T>> {
  let polls = 0;
  const baseInterval = options?.intervalMs ?? 1500;

  while (true) {
    if (options?.signal?.aborted) {
      throw new IntelApiError("Sondeo cancelado", 0, "Operación cancelada por el usuario.");
    }

    const job = await getJob<T>(jobId);
    polls++;
    options?.onUpdate?.(job);

    if (job.status === "done" || job.status === "error") {
      return job;
    }

    const currentInterval = polls > 20 ? 3000 : baseInterval;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => resolve(), currentInterval);
      if (options?.signal) {
        options.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(new IntelApiError("Sondeo cancelado", 0, "Operación cancelada por el usuario."));
          },
          { once: true }
        );
      }
    });
  }
}

// 8. GET /api/intel/monitor
export async function getMonitor(): Promise<MonitorSnapshot> {
  if (isMockEnabled()) {
    return MOCK_MONITOR;
  }

  try {
    return await requestJson<MonitorSnapshot>("/api/intel/monitor");
  } catch (err: any) {
    if (err.status === 0 || isMockEnabled()) {
      return MOCK_MONITOR;
    }
    throw err;
  }
}

// 9. POST /api/intel/monitor/scan
export async function scanMonitor(
  req: MonitorScanRequest = {}
): Promise<{ status: "done"; snapshot: MonitorSnapshot } | Job<MonitorSnapshot>> {
  return await requestJson<{ status: "done"; snapshot: MonitorSnapshot } | Job<MonitorSnapshot>>(
    "/api/intel/monitor/scan",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    }
  );
}

// 10. GET /api/intel/monitor/items/{item_id}/impact?level=state|mun&ent=
export async function getItemImpact(
  itemId: string,
  level: Level = "state",
  ent?: string
): Promise<NewsImpact> {
  const query = new URLSearchParams({ level });
  if (ent) query.set("ent", ent);

  return await requestJson<NewsImpact>(
    `/api/intel/monitor/items/${encodeURIComponent(itemId)}/impact?${query.toString()}`
  );
}

// 11. POST /api/intel/registry
export async function postRegistry(entry: Omit<RegistryEntry, "at">): Promise<RegistryEntry> {
  return await requestJson<RegistryEntry>("/api/intel/registry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
  });
}

// 12. GET /api/intel/registry/{item_id}
export async function getRegistry(itemId: string): Promise<RegistryEntry[]> {
  return await requestJson<RegistryEntry[]>(`/api/intel/registry/${encodeURIComponent(itemId)}`);
}
