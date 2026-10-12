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
  HealthResponse,
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

export function shouldFallbackToMock(err: unknown): boolean {
  if (err instanceof ApiError) {
    // 422 Validation error: do NOT fallback to mock; UI needs the backend error message
    if (err.status === 422) return false;
    // 404 endpoint not implemented on backend or 5xx server error: fallback
    return err.status === 404 || err.status >= 500;
  }
  // Network errors (Failed to fetch, connection refused): fallback
  return true;
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

// 0. GET /api/health
export async function getHealth(): Promise<HealthResponse> {
  if (isMockEnabled()) {
    return {
      status: "ok",
      store: "memory",
      llm: false,
      warmup: "ready",
      data: {
        units_mun: 2475,
        units_state: 32,
        participation_rows: 14820,
        years: [2009, 2012, 2015, 2018, 2021, 2024],
      },
    };
  }
  try {
    return await fetchJson<HealthResponse>("/api/health");
  } catch (err) {
    if (shouldFallbackToMock(err)) {
      setMockActive(true);
      return {
        status: "ok",
        store: "memory",
        llm: false,
        warmup: "ready",
        data: {
          units_mun: 2475,
          units_state: 32,
          participation_rows: 14820,
          years: [2009, 2012, 2015, 2018, 2021, 2024],
        },
      };
    }
    throw err;
  }
}

// 1. GET /api/meta
export async function getMeta(): Promise<Meta> {
  if (isMockEnabled()) {
    return MOCK_META;
  }
  try {
    return await fetchJson<Meta>("/api/meta");
  } catch (err) {
    if (shouldFallbackToMock(err)) {
      setMockActive(true);
      return MOCK_META;
    }
    throw err;
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
      level === "mun"
        ? generateMockMunicipalityItems(ent, scenario)
        : generateMockStates(scenario);
    return { level, scenario, items };
  }

  const query = new URLSearchParams({ level, scenario });
  if (ent) query.set("ent", ent);

  try {
    return await fetchJson<{ level: Level; scenario: ScenarioId; items: RiskItem[] }>(`/api/risk?${query.toString()}`);
  } catch (err) {
    if (shouldFallbackToMock(err)) {
      setMockActive(true);
      const items =
        level === "mun"
          ? generateMockMunicipalityItems(ent, scenario)
          : generateMockStates(scenario);
      return { level, scenario, items };
    }
    throw err;
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
    if (err instanceof ApiError && err.status === 422) {
      throw err;
    }
    if (shouldFallbackToMock(err)) {
      setMockActive(true);
      return simulateMockScenario(req);
    }
    throw err;
  }
}

// 4. GET /api/region/{id}?scenario=base
export async function getRegion(id: string, scenario: ScenarioId = "base"): Promise<RegionDetail | null> {
  if (isMockEnabled()) {
    return getMockRegionDetail(id, scenario);
  }

  try {
    const query = new URLSearchParams({ scenario });
    return await fetchJson<RegionDetail>(`/api/region/${encodeURIComponent(id)}?${query.toString()}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      // 404 from real API means unit doesn't exist
      if (!isMockEnabled()) {
        return null;
      }
    }
    if (shouldFallbackToMock(err)) {
      setMockActive(true);
      return getMockRegionDetail(id, scenario);
    }
    throw err;
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
    if (shouldFallbackToMock(err)) {
      setMockActive(true);
      return { items: getMockRanking(level, ent, scenario, limit) };
    }
    throw err;
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
    if (shouldFallbackToMock(err)) {
      setMockActive(true);
      return MOCK_METRICS;
    }
    throw err;
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
      const err = new ApiError(`HTTP ${res.status}: ${res.statusText}`, res.status);
      if (shouldFallbackToMock(err)) {
        setMockActive(true);
        return streamMockChat(req, handlers, signal);
      }
      throw err;
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
    if (shouldFallbackToMock(err)) {
      setMockActive(true);
      return streamMockChat(req, handlers, signal);
    }
    handlers.onError?.({ message: (err as Error)?.message || "Error al conectar con el asistente" });
  }
}
