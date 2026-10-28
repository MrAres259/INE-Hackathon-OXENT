import { describe, it, expect } from "vitest";
import { MOCK_META, MOCK_STATES } from "../lib/mocks/meta";
import {
  generateMockStates,
  generateMockMunicipalityItems,
  getCategoryFromScore,
} from "../lib/mocks/risk";
import { getMockRegionDetail } from "../lib/mocks/regions";
import { simulateMockScenario } from "../lib/mocks/simulate";
import { getMockRanking } from "../lib/mocks/ranking";

describe("Deterministic Mock Logic", () => {
  it("includes all 32 Mexican states in metadata", () => {
    expect(MOCK_STATES).toHaveLength(32);
    expect(MOCK_META.states).toHaveLength(32);
    expect(MOCK_STATES[0].id).toBe("01");
    expect(MOCK_STATES[31].id).toBe("32");
  });

  it("determines correct category from risk score", () => {
    expect(getCategoryFromScore(85)).toBe("rojo");
    expect(getCategoryFromScore(75)).toBe("rojo");
    expect(getCategoryFromScore(65)).toBe("naranja");
    expect(getCategoryFromScore(55)).toBe("naranja");
    expect(getCategoryFromScore(45)).toBe("amarillo");
    expect(getCategoryFromScore(35)).toBe("amarillo");
    expect(getCategoryFromScore(25)).toBe("verde");
    expect(getCategoryFromScore(null)).toBe("sin_dato");
  });

  it("generates 32 deterministic states with valid ranges", () => {
    const states = generateMockStates("base");
    expect(states).toHaveLength(32);

    for (const s of states) {
      expect(s.level).toBe("state");
      expect(s.last_participation).toBeGreaterThan(0.3);
      expect(s.last_participation).toBeLessThan(0.8);
      expect(s.pred_abstention).toBeGreaterThan(0.2);
      expect(s.pred_abstention).toBeLessThan(0.85);
      expect(s.risk_score).toBeGreaterThanOrEqual(0);
      expect(s.risk_score).toBeLessThanOrEqual(100);
      expect(["verde", "amarillo", "naranja", "rojo", "sin_dato"]).toContain(s.category);
    }
  });

  it("applies intervention scenario parameters deterministically", () => {
    const baseStates = generateMockStates("base");
    const intervStates = generateMockStates("intervencion", { effect_pp: 4.0, coverage: 90 });

    expect(intervStates).toHaveLength(32);
    for (let i = 0; i < 32; i++) {
      expect(intervStates[i].pred_abstention).toBeLessThanOrEqual(baseStates[i].pred_abstention!);
      expect(intervStates[i].delta_vs_base_pp).toBeLessThan(0); // negative delta = less abstention
    }
  });

  it("generates sample municipalities for Chiapas (07)", () => {
    const muns = generateMockMunicipalityItems("07", "base");
    expect(muns.length).toBeGreaterThanOrEqual(10);
    expect(muns.some((m) => m.name.includes("Tuxtla"))).toBe(true);
    expect(muns.some((m) => m.name.includes("Tapachula"))).toBe(true);
  });

  it("simulates scenario and aggregates summary statistics", () => {
    const result = simulateMockScenario({
      scenario: "intervencion",
      params: { effect_pp: 3.0, coverage: 100, lever: "promocion_jovenes", targeting: "rojo_naranja" },
      level: "state",
    });

    expect(result.scenario).toBe("intervencion");
    expect(result.summary.n_units).toBe(32);
    expect(result.summary.votos_adicionales).toBeGreaterThan(0);
    expect(result.summary.mean_delta_pp).toBeLessThan(0);
  });

  it("builds complete region detail with series, features, and recommendations", () => {
    const detail = getMockRegionDetail("07");
    expect(detail.id).toBe("07");
    expect(detail.name).toBe("Chiapas");
    expect(detail.series.length).toBe(6); // 2009, 2012, 2015, 2018, 2021, 2024
    expect(detail.features.length).toBeGreaterThan(5);
    expect(detail.drivers.length).toBeGreaterThan(2);
    expect(detail.recommendations.length).toBeGreaterThan(2);
  });

  it("generates ranking sorted descending by risk_score", () => {
    const ranking = getMockRanking("state", undefined, "base", 10);
    expect(ranking).toHaveLength(10);
    for (let i = 0; i < ranking.length - 1; i++) {
      expect(ranking[i].risk_score!).toBeGreaterThanOrEqual(ranking[i + 1].risk_score!);
    }
  });

  it("includes structural_r2 and forecast_coefficients in MOCK_METRICS", async () => {
    const { MOCK_METRICS } = await import("../lib/mocks/metrics");
    expect(MOCK_METRICS.structural_r2).toBeDefined();
    expect(typeof MOCK_METRICS.structural_r2).toBe("number");
    expect(MOCK_METRICS.structural_r2).toBeGreaterThan(0);

    expect(MOCK_METRICS.coefficients.length).toBeGreaterThan(0);
    // Structural coefficients describe sociodemographic features
    expect(MOCK_METRICS.coefficients.some((c) => c.key === "graproes")).toBe(true);

    expect(MOCK_METRICS.forecast_coefficients).toBeDefined();
    expect(MOCK_METRICS.forecast_coefficients!.length).toBeGreaterThan(0);
    // Forecast coefficients contain lags and pres
    expect(MOCK_METRICS.forecast_coefficients!.some((c) => c.key === "lag1")).toBe(true);
    expect(MOCK_METRICS.forecast_coefficients!.some((c) => c.key === "pres")).toBe(true);
  });

  it("simulates pesimista scenario with negative votos_adicionales and positive delta", () => {
    const result = simulateMockScenario({
      scenario: "pesimista",
      level: "state",
    });

    expect(result.scenario).toBe("pesimista");
    expect(result.summary.n_units).toBe(32);
    // In pessimistic scenario, additional votes are negative (votos perdidos)
    expect(result.summary.votos_adicionales).toBeLessThan(0);
    // Mean delta is positive (more abstention)
    expect(result.summary.mean_delta_pp).toBeGreaterThan(0);
  });

  it("generates national municipalities for all states with abstencion_esperada", () => {
    const allMuns = generateMockMunicipalityItems(undefined, "base");
    expect(allMuns.length).toBeGreaterThan(100);

    const statesRepresented = new Set(allMuns.map((m) => m.ent));
    expect(statesRepresented.size).toBe(32);

    for (const m of allMuns) {
      expect(m.level).toBe("mun");
      expect(m.id).toMatch(/^\d{5}$/);
      expect(m.ent).toHaveLength(2);
      expect(typeof m.abstencion_esperada).toBe("number");
      expect(m.abstencion_esperada).toBeGreaterThan(0);
    }
  });

  it("simulates national municipality scenario with ent=null", () => {
    const result = simulateMockScenario({
      scenario: "intervencion",
      level: "mun",
      ent: null,
      params: { effect_pp: 3.0, coverage: 100, targeting: "rojo_naranja" },
    });

    expect(result.level).toBe("mun");
    expect(result.summary.n_units).toBeGreaterThan(100);
    expect(result.summary.votos_adicionales).toBeGreaterThan(0);
    expect(result.summary.mean_delta_pp).toBeLessThan(0);
  });

  it("simulates multiple campaigns with diminishing returns, breakdown and overlap", () => {
    const result = simulateMockScenario({
      scenario: "intervencion",
      level: "mun",
      ent: null,
      params: {
        campaigns: [
          {
            lever: "promocion_jovenes",
            targeting: "todos",
            effect_pp: 5.0,
            coverage: 100,
            ents: [],
          },
          {
            lever: "casillas_rurales",
            targeting: "rojo_naranja",
            effect_pp: 4.0,
            coverage: 80,
            ents: ["07"], // Chiapas only
          },
        ],
      },
    });

    expect(result.summary.campaigns).toBeDefined();
    expect(result.summary.campaigns).toHaveLength(2);

    const c1 = result.summary.campaigns![0];
    const c2 = result.summary.campaigns![1];

    expect(c1.lever).toBe("promocion_jovenes");
    expect(c1.votos_solo).toBeGreaterThan(0);
    expect(c1.n_target_units).toBeGreaterThan(100);

    expect(c2.lever).toBe("casillas_rurales");
    expect(c2.votos_solo).toBeGreaterThan(0);
    expect(c2.ents).toEqual(["07"]);

    // Diminishing returns: individual sum >= combined votes
    expect(result.summary.votos_suma_individual).toBeDefined();
    expect(result.summary.votos_traslape).toBeDefined();
    expect(result.summary.votos_suma_individual!).toBe(c1.votos_solo + c2.votos_solo);
    expect(result.summary.votos_suma_individual!).toBeGreaterThanOrEqual(result.summary.votos_adicionales);
    expect(result.summary.votos_traslape!).toBe(
      result.summary.votos_suma_individual! - result.summary.votos_adicionales
    );
    expect(result.summary.votos_traslape!).toBeGreaterThanOrEqual(0);
  });
});
