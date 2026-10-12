import { describe, it, expect } from "vitest";
import {
  shouldFallbackToMock,
  ApiError,
  getHealth,
  getMetrics,
  getRisk,
  setMockActive,
} from "../lib/api";

describe("API Client Error and Mock Fallback Rules", () => {
  it("does NOT fallback to mock on HTTP 422 Unprocessable Entity", () => {
    const error422 = new ApiError("Validation Error", 422, {
      detail: [{ loc: ["body", "params", "effect_pp"], msg: "Must be <= 10.0" }],
    });
    expect(shouldFallbackToMock(error422)).toBe(false);
  });

  it("falls back to mock on HTTP 404 (endpoint not implemented) and 5xx (server error)", () => {
    const error404 = new ApiError("Not Found", 404);
    expect(shouldFallbackToMock(error404)).toBe(true);

    const error500 = new ApiError("Internal Server Error", 500);
    expect(shouldFallbackToMock(error500)).toBe(true);

    const error503 = new ApiError("Service Unavailable", 503);
    expect(shouldFallbackToMock(error503)).toBe(true);
  });

  it("falls back to mock on network failures (Failed to fetch)", () => {
    const networkError = new TypeError("Failed to fetch");
    expect(shouldFallbackToMock(networkError)).toBe(true);
  });

  it("provides health check structure with units_mun and participation_rows", async () => {
    const health = await getHealth();
    expect(health).toBeDefined();
    expect(health.status).toBe("ok");
    expect(health.data).toBeDefined();
    expect(typeof health.data.units_mun).toBe("number");
    expect(typeof health.data.units_state).toBe("number");
    expect(Array.isArray(health.data.years)).toBe(true);
  });

  it("includes baseline_mae_pp in backtest metrics for persistence comparison", async () => {
    const metrics = await getMetrics();
    expect(metrics).toBeDefined();
    expect(metrics.backtests.length).toBeGreaterThan(0);
    for (const b of metrics.backtests) {
      expect(b.mae_pp).toBeGreaterThan(0);
      expect(b.baseline_mae_pp).toBeDefined();
      expect(b.baseline_mae_pp!).toBeGreaterThan(b.mae_pp);
    }
  });

  it("mock getRisk('mun') without ent returns municipalities of >= 30 states and getRisk('state') returns only states even in parallel", async () => {
    setMockActive(true);

    const [munRes, stateRes] = await Promise.all([
      getRisk("mun", undefined, "base"),
      getRisk("state", undefined, "base"),
    ]);

    expect(munRes.level).toBe("mun");
    expect(stateRes.level).toBe("state");

    // All states have 2-digit ids
    expect(stateRes.items).toHaveLength(32);
    for (const s of stateRes.items) {
      expect(s.level).toBe("state");
      expect(s.id).toMatch(/^\d{2}$/);
    }

    // National municipalities cover >= 30 distinct states
    expect(munRes.items.length).toBeGreaterThan(100);
    const statesInMuns = new Set(munRes.items.map((m) => m.ent));
    expect(statesInMuns.size).toBeGreaterThanOrEqual(30);
    for (const m of munRes.items) {
      expect(m.level).toBe("mun");
      expect(m.id).toMatch(/^\d{5}$/);
    }
  });
});
