import { describe, it, expect } from "vitest";
import {
  getCategoryCounts,
  getCategoryDistribution,
  computeNationalStats,
  getTopRiskZones,
  filterRankingBySemaforo,
  formatDiagnosticSummaryLine,
  CATEGORY_STYLES,
} from "../lib/panelStats";
import type { RiskItem, RegionDetail } from "../lib/types";

const mockRiskItems: RiskItem[] = [
  {
    id: "01",
    name: "Aguascalientes",
    level: "state",
    ent: "01",
    lista_nominal: 1000000,
    last_year: 2024,
    last_participation: 0.55,
    pred_participation: 0.52,
    pred_abstention: 0.48,
    pred_low: 0.45,
    pred_high: 0.51,
    trend_pp: -2.1,
    risk_score: 42.5,
    category: "amarillo",
  },
  {
    id: "02",
    name: "Baja California",
    level: "state",
    ent: "02",
    lista_nominal: 3000000,
    last_year: 2024,
    last_participation: 0.40,
    pred_participation: 0.38,
    pred_abstention: 0.62,
    pred_low: 0.58,
    pred_high: 0.66,
    trend_pp: -4.0,
    risk_score: 78.9,
    category: "rojo",
  },
  {
    id: "09",
    name: "Ciudad de México",
    level: "state",
    ent: "09",
    lista_nominal: 8000000,
    last_year: 2024,
    last_participation: 0.68,
    pred_participation: 0.65,
    pred_abstention: 0.35,
    pred_low: 0.32,
    pred_high: 0.38,
    trend_pp: 1.5,
    risk_score: 28.0,
    category: "verde",
  },
  {
    id: "14",
    name: "Jalisco",
    level: "state",
    ent: "14",
    lista_nominal: 6000000,
    last_year: 2024,
    last_participation: 0.50,
    pred_participation: 0.47,
    pred_abstention: 0.53,
    pred_low: 0.49,
    pred_high: 0.57,
    trend_pp: -1.2,
    risk_score: 61.2,
    category: "naranja",
  },
];

describe("panelStats helper functions", () => {
  it("computes category counts accurately", () => {
    const counts = getCategoryCounts(mockRiskItems);
    expect(counts.rojo).toBe(1);
    expect(counts.naranja).toBe(1);
    expect(counts.amarillo).toBe(1);
    expect(counts.verde).toBe(1);
    expect(counts.sin_dato).toBe(0);
  });

  it("handles unknown or missing categories by incrementing sin_dato", () => {
    const itemsWithUnknown = [
      ...mockRiskItems,
      { id: "99", name: "Zona X", level: "mun", ent: "99", category: "invalido" as any } as RiskItem,
    ];
    const counts = getCategoryCounts(itemsWithUnknown);
    expect(counts.sin_dato).toBe(1);
  });

  it("calculates category distribution with percentages", () => {
    const dist = getCategoryDistribution(mockRiskItems);
    expect(dist).toHaveLength(4); // rojo, naranja, amarillo, verde
    expect(dist[0].category).toBe("rojo");
    expect(dist[0].count).toBe(1);
    expect(dist[0].pct).toBe(25);
    expect(dist[0].bgClass).toBe("bg-risk-crit");
  });

  it("computes national stats (weighted average by lista nominal)", () => {
    const stats = computeNationalStats(mockRiskItems);
    expect(stats.totalZones).toBe(4);
    // Weighted abstention: 8,320,000 expected / 18,000,000 total LN ≈ 46.22%
    expect(stats.avgAbstention).toBeCloseTo(8320000 / 18000000);
    // Expected abstention: 0.48 * 1M + 0.62 * 3M + 0.35 * 8M + 0.53 * 6M
    // = 480k + 1860k + 2800k + 3180k = 8320k = 8,320,000
    expect(stats.totalExpected).toBe(8320000);
  });

  it("calculates weighted average properly with distinct lista_nominal", () => {
    const items: RiskItem[] = [
      {
        id: "A",
        name: "Estado Pequeno",
        level: "state",
        ent: "01",
        lista_nominal: 1000000,
        pred_abstention: 0.20,
        category: "verde",
      } as RiskItem,
      {
        id: "B",
        name: "Estado Grande",
        level: "state",
        ent: "02",
        lista_nominal: 9000000,
        pred_abstention: 0.50,
        category: "amarillo",
      } as RiskItem,
    ];
    const stats = computeNationalStats(items);
    // Simple average would be 0.35, weighted is (200k + 4500k) / 10M = 0.47
    expect(stats.avgAbstention).toBeCloseTo(0.47);
    expect(stats.totalExpected).toBe(4700000);
  });

  it("returns null for avgAbstention when items have no lista_nominal", () => {
    const itemsWithoutLn: RiskItem[] = [
      {
        id: "X",
        name: "Zona Sin LN",
        level: "mun",
        ent: "01",
        pred_abstention: 0.45,
        category: "naranja",
      } as RiskItem,
    ];
    const stats = computeNationalStats(itemsWithoutLn);
    expect(stats.avgAbstention).toBeNull();
  });

  it("handles empty array in national stats gracefully", () => {
    const stats = computeNationalStats([]);
    expect(stats.totalZones).toBe(0);
    expect(stats.avgAbstention).toBeNull();
    expect(stats.totalExpected).toBe(0);
    expect(stats.counts.rojo).toBe(0);
  });

  it("ranks top risk zones descending", () => {
    const top = getTopRiskZones(mockRiskItems, 2);
    expect(top).toHaveLength(2);
    expect(top[0].id).toBe("02"); // 78.9
    expect(top[1].id).toBe("14"); // 61.2
  });

  it("filters ranking items by semaforo category", () => {
    const rojos = filterRankingBySemaforo(mockRiskItems, "rojo");
    expect(rojos).toHaveLength(1);
    expect(rojos[0].id).toBe("02");

    const all = filterRankingBySemaforo(mockRiskItems, null);
    expect(all).toHaveLength(4);
  });

  it("formats 1-line diagnostic summary line accurately", () => {
    const detail: RegionDetail = {
      id: "08037",
      name: "Juárez",
      level: "mun",
      ent: "08",
      lista_nominal: 1100000,
      last_year: 2024,
      last_participation: 0.41,
      pred_participation: 0.39,
      pred_abstention: 0.61,
      pred_low: 0.57,
      pred_high: 0.65,
      trend_pp: -3.5,
      risk_score: 69.2,
      category: "naranja",
      parent: { id: "08", name: "Chihuahua" },
      series: [],
      features: [],
      drivers: [],
      scenarios: [],
      recommendations: [],
    };

    const line = formatDiagnosticSummaryLine(detail);
    expect(line).toBe(
      "Riesgo alto (69.2 de 100): se espera que no vote el 61.0 % de su lista nominal en 2027 (≈ 671,000 personas)."
    );
  });

  it("CATEGORY_STYLES has correct tokens for all categories", () => {
    expect(CATEGORY_STYLES.amarillo.textClass).toBe("text-foreground");
    expect(CATEGORY_STYLES.amarillo.badgeClass).toContain("text-foreground");
    expect(CATEGORY_STYLES.rojo.bgClass).toBe("bg-risk-crit");
    expect(CATEGORY_STYLES.verde.bgClass).toBe("bg-risk-low");
  });
});
