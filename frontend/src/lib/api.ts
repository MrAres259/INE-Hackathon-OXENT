// ATALAYA API Client - Real backend caller with SSE streaming & offline mock fallback
import type {
  Meta,
  RiskItem,
  Level,
  ScenarioId,
  ScenarioRequest,
  ScenarioResult,
  RegionDetail,
  ModelMetrics,
  ChatRequest,
  ChatStreamHandlers,
  ChatPlan,
  ChatData,
  ChatDone,
} from "./types";

import { MOCK_META } from "./mocks/meta";
import { generateMockStates, generateMockMunicipalityItems } from "./mocks/risk";
import { getMockRegionDetail } from "./mocks/regions";
import { simulateMockScenario } from "./mocks/simulate";
import { getMockRanking } from "./mocks/ranking";
import { MOCK_METRICS } from "./mocks/metrics";
import { streamMockChat } from "./mocks/chat";

// Mock status store
let currentIsMock = false;
const mockListeners = new Set<(isMock: boolean) => void>();

export function isMockEnabled(): boolean {
  if (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_MOCK) {
    return process.env.NEXT_PUBLIC_MOCK === "1" || process.env.NEXT_PUBLIC_MOCK === "true";
  }
  return currentIsMock;
}

export function setMockActive(active: boolean): void {
  currentIsMock = active;
  mockListeners.forEach((fn) => fn(active));
}

export function subscribeMockStatus(listener: (isMock: boolean) => void): () => void {
  mockListeners.add(listener);
  listener(isMockEnabled());
  return () => {
    mockListeners.delete(listener);
  };
}

export class ApiError extends Error {
  status: number;
  data?: unknown;

  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...init?.headers,
    },
  });

  if (!res.ok) {
    let errorData: unknown;
    try {
      errorData = await res.json();
    } catch {
      errorData = await res.text().catch(() => null);
    }
    throw new ApiError(`Request failed with status ${res.status}: ${res.statusText}`, res.status, errorData);
  }

  return (await res.json()) as T;
}

// 1. GET /api/meta
export async function getMeta(): Promise<Meta> {
  if (isMockEnabled()) {
    return MOCK_META;
  }
  try {
    return await fetchJson<Meta>("/api/meta");
  } catch (err) {
    setMockActive(true);
    return MOCK_META;
  }
}

// 2. GET /api/risk?level=state|mun&ent=07&scenario=base
export async function getRisk(
  level: Level = "state",
  ent?: string,
  scenario: ScenarioId = "base"
): Promise<{ level: Level; scenario: ScenarioId; items: RiskItem[] }> {
  if (isMockEnabled()) {
    const items =
      level === "mun" && ent
        ? generateMockMunicipalityItems(ent, scenario)
        : generateMockStates(scenario);
    return { level, scenario, items };
  }

  const query = new URLSearchParams({ level, scenario });
  if (ent) query.set("ent", ent);

  try {
    return await fetchJson<{ level: Level; scenario: ScenarioId; items: RiskItem[] }>(`/api/risk?${query.toString()}`);
  } catch (err) {
    setMockActive(true);
    const items =
      level === "mun" && ent
        ? generateMockMunicipalityItems(ent, scenario)
        : generateMockStates(scenario);
    return { level, scenario, items };
  }
}

// 3. POST /api/scenario/simulate
export async function simulateScenario(req: ScenarioRequest): Promise<ScenarioResult> {
  if (isMockEnabled()) {
    return simulateMockScenario(req);
  }

  try {
    return await fetchJson<ScenarioResult>("/api/scenario/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
  } catch (err) {
    setMockActive(true);
    return simulateMockScenario(req);
  }
}

// 4. GET /api/region/{id}?scenario=base
export async function getRegion(id: string, scenario: ScenarioId = "base"): Promise<RegionDetail> {
  if (isMockEnabled()) {
    return getMockRegionDetail(id, scenario);
  }

  try {
    const query = new URLSearchParams({ scenario });
    return await fetchJson<RegionDetail>(`/api/region/${encodeURIComponent(id)}?${query.toString()}`);
  } catch (err) {
    setMockActive(true);
    return getMockRegionDetail(id, scenario);
  }
}

// 5. GET /api/ranking?level=mun&ent=&scenario=base&limit=20
export async function getRanking(
  level: Level = "mun",
  ent?: string,
  scenario: ScenarioId = "base",
  limit = 20
): Promise<{ items: RiskItem[] }> {
  if (isMockEnabled()) {
    return { items: getMockRanking(level, ent, scenario, limit) };
  }

  const query = new URLSearchParams({ level, scenario, limit: limit.toString() });
  if (ent) query.set("ent", ent);

  try {
    return await fetchJson<{ items: RiskItem[] }>(`/api/ranking?${query.toString()}`);
  } catch (err) {
    setMockActive(true);
    return { items: getMockRanking(level, ent, scenario, limit) };
  }
}

// 6. GET /api/metrics
export async function getMetrics(): Promise<ModelMetrics> {
  if (isMockEnabled()) {
    return MOCK_METRICS;
  }

  try {
    return await fetchJson<ModelMetrics>("/api/metrics");
  } catch (err) {
    setMockActive(true);
    return MOCK_METRICS;
  }
}

// SSE Parser
export interface SSEEvent {
  event: string;
  data: string;
}

export function parseSSEChunk(
  buffer: string,
  chunk: string
): { events: SSEEvent[]; remaining: string } {
  const combined = buffer + chunk;
  const events: SSEEvent[] = [];

  // Normalize newlines
  const normalized = combined.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const parts = normalized.split("\n\n");

  // Incomplete remaining buffer
  const remaining = parts.pop() ?? "";

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    let eventName = "message";
    const dataLines: string[] = [];

    const lines = part.split("\n");
    for (const line of lines) {
      if (line.startsWith(":")) {
        continue; // SSE comment
      }
      if (line.startsWith("event:")) {
        const val = line.slice(6);
        eventName = val.startsWith(" ") ? val.slice(1) : val;
      } else if (line.startsWith("data:")) {
        const val = line.slice(5);
        dataLines.push(val.startsWith(" ") ? val.slice(1) : val);
      }
    }

    if (dataLines.length > 0 || eventName !== "message") {
      events.push({
        event: eventName,
        data: dataLines.join("\n"),
      });
    }
  }

  return { events, remaining };
}

// 7. POST /api/chat (SSE)
export async function streamChat(
  req: ChatRequest,
  handlers: ChatStreamHandlers,
  signal?: AbortSignal
): Promise<void> {
  if (isMockEnabled()) {
    return streamMockChat(req, handlers, signal);
  }

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(req),
      signal,
    });

    if (!res.ok) {
      throw new ApiError(`HTTP ${res.status}: ${res.statusText}`, res.status);
    }

    if (!res.body) {
      throw new ApiError("Respuesta SSE vacía", 500);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const parsed = parseSSEChunk(buffer, chunk);
      buffer = parsed.remaining;

      for (const ev of parsed.events) {
        let payload: any = ev.data;
        try {
          payload = JSON.parse(ev.data);
        } catch {
          // keep string
        }

        switch (ev.event) {
          case "plan":
            handlers.onPlan?.(payload as ChatPlan);
            break;
          case "data":
            handlers.onData?.(payload as ChatData);
            break;
          case "token":
            handlers.onToken?.(payload as { text: string });
            break;
          case "done":
            handlers.onDone?.(payload as ChatDone);
            break;
          case "error":
            handlers.onError?.(payload as { message: string });
            break;
        }
      }
    }

    // Process leftover buffer
    if (buffer.trim()) {
      const parsed = parseSSEChunk(buffer, "\n\n");
      for (const ev of parsed.events) {
        let payload: any = ev.data;
        try {
          payload = JSON.parse(ev.data);
        } catch {}

        switch (ev.event) {
          case "plan":
            handlers.onPlan?.(payload as ChatPlan);
            break;
          case "data":
            handlers.onData?.(payload as ChatData);
            break;
          case "token":
            handlers.onToken?.(payload as { text: string });
            break;
          case "done":
            handlers.onDone?.(payload as ChatDone);
            break;
          case "error":
            handlers.onError?.(payload as { message: string });
            break;
        }
      }
    }
  } catch (err: unknown) {
    if ((err as Error)?.name === "AbortError") {
      return;
    }
    // Fallback to mock if network/server error
    setMockActive(true);
    return streamMockChat(req, handlers, signal);
  }
}
