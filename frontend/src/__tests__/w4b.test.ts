import { describe, it, expect } from "vitest";
import {
  formatSuppressed,
  getAbstencionEsperada,
  sortRankingItems,
  generateRankingCsv,
} from "../lib/format";
import type { RiskItem, SeriesPoint, ProfilePoint, RegionDetail, ModelMetrics } from "../lib/types";

describe("W4-B Frontend Real Data Specifications", () => {
  describe("1. Suppression and Protected Data Formatting", () => {
    it("formats suppressed cells as protected data message", () => {
      const cellWithFlag: ProfilePoint = {
        year: 2024,
        age_group: "18-24",
        sexo: "M",
        ln: null,
        participation: null,
        suprimido: true,
      };
      expect(formatSuppressed(cellWithFlag)).toBe("dato protegido (menos de 10 personas)");
    });

    it("automatically protects microdata cells with ln < 10", () => {
      const cellSmallLn: ProfilePoint = {
        year: 2024,
        age_group: "65+",
        sexo: "X",
        ln: 4,
        participation: 0.5,
      };
      expect(formatSuppressed(cellSmallLn)).toBe("dato protegido (menos de 10 personas)");
    });

    it("returns null for non-suppressed valid cells with ln >= 10", () => {
      const validCell: ProfilePoint = {
        year: 2024,
        age_group: "25-34",
        sexo: "M",
        ln: 1250,
        participation: 0.584,
        suprimido: false,
      };
      expect(formatSuppressed(validCell)).toBeNull();
    });
  });

  describe("2. Series points with null participation and PJF 2025", () => {
    it("supports series points with null participation, reliability flags and ns_rate", () => {
      const series: SeriesPoint[] = [
        {
          year: 2009,
          election: "DIP_FED",
          participation: 0.44,
          lista_nominal: 50000,
          reliable: true,
          low_confidence: false,
          ns_rate: 0.02,
        },
        {
          year: 2015,
          election: "DIP_FED",
          participation: null, // Break in data / unreliable
          lista_nominal: 55000,
          reliable: false,
          low_confidence: true,
          ns_rate: 0.65,
        },
        {
          year: 2024,
          election: "DIP_FED",
          participation: 0.59,
          lista_nominal: 62000,
          reliable: true,
          low_confidence: false,
          ns_rate: 0.04,
        },
        {
          year: 2025,
          election: "PJF",
          participation: 0.13,
          lista_nominal: 63000,
          reliable: true,
          low_confidence: false,
          ns_rate: null,
        },
      ];

      expect(series).toHaveLength(4);
      expect(series[1].participation).toBeNull();
      expect(series[1].reliable).toBe(false);
      expect(series[1].ns_rate).toBe(0.65);

      const pjf = series.find((s) => s.election === "PJF" || s.year === 2025);
      expect(pjf).toBeDefined();
      expect(pjf?.election).toBe("PJF");
      expect(pjf?.participation).toBe(0.13);
    });
  });

  describe("3. Expected Abstention (Abstención Esperada) Calculation", () => {
    it("uses explicit abstencion_esperada if provided", () => {
      const item: RiskItem = {
        id: "07101",
        name: "Tuxtla",
        level: "mun",
        ent: "07",
        lista_nominal: 400000,
        last_year: 2024,
        last_participation: 0.5,
        pred_participation: 0.5,
        pred_abstention: 0.5,
        pred_low: 0.45,
        pred_high: 0.55,
        trend_pp: 0,
        risk_score: 50,
        category: "amarillo",
        abstencion_esperada: 198500,
      };
      expect(getAbstencionEsperada(item)).toBe(198500);
    });

    it("calculates expected abstention from pred_abstention * lista_nominal when not explicit", () => {
      const item: RiskItem = {
        id: "07101",
        name: "Tuxtla",
        level: "mun",
        ent: "07",
        lista_nominal: 100000,
        last_year: 2024,
        last_participation: 0.5,
        pred_participation: 0.6,
        pred_abstention: 0.4,
        pred_low: 0.35,
        pred_high: 0.45,
        trend_pp: 0,
        risk_score: 50,
        category: "amarillo",
      };
      expect(getAbstencionEsperada(item)).toBe(40000);
    });
  });

  describe("4. Ranking Sorting (Índice de Riesgo, Abstención Esperada, Prioridad)", () => {
    const items: RiskItem[] = [
      {
        id: "01001",
        name: "Aguascalientes",
        level: "mun",
        ent: "01",
        lista_nominal: 500000,
        last_year: 2024,
        last_participation: 0.55,
        pred_participation: 0.52,
        pred_abstention: 0.48,
        pred_low: 0.45,
        pred_high: 0.51,
        trend_pp: -0.5,
        risk_score: 52, // Amarillo
        category: "amarillo",
        abstencion_esperada: 240000,
        prioridad: 5,
      },
      {
        id: "07001",
        name: "Municipio Crítico Chiapas",
        level: "mun",
        ent: "07",
        lista_nominal: 60000,
        last_year: 2024,
        last_participation: 0.38,
        pred_participation: 0.35,
        pred_abstention: 0.65,
        pred_low: 0.60,
        pred_high: 0.70,
        trend_pp: -3.2,
        risk_score: 84, // Rojo
        category: "rojo",
        abstencion_esperada: 39000,
        prioridad: 1,
      },
      {
        id: "14039",
        name: "Guadalajara",
        level: "mun",
        ent: "14",
        lista_nominal: 1200000,
        last_year: 2024,
        last_participation: 0.50,
        pred_participation: 0.49,
        pred_abstention: 0.51,
        pred_low: 0.46,
        pred_high: 0.56,
        trend_pp: -1.0,
        risk_score: 64, // Naranja
        category: "naranja",
        abstencion_esperada: 612000,
        prioridad: 2,
      },
    ];

    it("sorts by risk_score descending", () => {
      const sorted = sortRankingItems(items, "risk");
      expect(sorted[0].id).toBe("07001"); // 84 pts
      expect(sorted[1].id).toBe("14039"); // 64 pts
      expect(sorted[2].id).toBe("01001"); // 52 pts
    });

    it("sorts by abstencion_esperada (personas) descending", () => {
      const sorted = sortRankingItems(items, "abstencion_esperada");
      expect(sorted[0].id).toBe("14039"); // 612,000 personas
      expect(sorted[1].id).toBe("01001"); // 240,000 personas
      expect(sorted[2].id).toBe("07001"); // 39,000 personas
    });

    it("sorts by prioridad ascending (rank #1 first)", () => {
      const sorted = sortRankingItems(items, "prioridad");
      expect(sorted[0].id).toBe("07001"); // Prioridad #1
      expect(sorted[1].id).toBe("14039"); // Prioridad #2
      expect(sorted[2].id).toBe("01001"); // Prioridad #5
    });

    it("includes Abstención Esperada and Prioridad in CSV output", () => {
      const csv = generateRankingCsv(items);
      const lines = csv.split("\r\n");
      expect(lines[0]).toContain("Abstención Esperada (personas)");
      expect(lines[0]).toContain("Prioridad");
      expect(lines[1]).toContain("240000"); // Aguascalientes expected abstention
      expect(lines[2]).toContain("1"); // Chiapas prioridad
    });
  });

  describe("5. Optional Fields and Interface Flexibility", () => {
    it("handles minimal RegionDetail without optional Ola 4 fields", () => {
      const minimalDetail: RegionDetail = {
        id: "07",
        name: "Chiapas",
        level: "state",
        ent: "07",
        lista_nominal: 3800000,
        last_year: 2024,
        last_participation: 0.58,
        pred_participation: 0.54,
        pred_abstention: 0.46,
        pred_low: 0.41,
        pred_high: 0.51,
        trend_pp: 0.5,
        risk_score: 42,
        category: "amarillo",
        parent: null,
        series: [],
        features: [],
        drivers: [],
        scenarios: [],
        recommendations: [],
      };

      expect(minimalDetail.id).toBe("07");
      expect(minimalDetail.profile).toBeUndefined();
      expect(minimalDetail.ccpc).toBeUndefined();
      expect(minimalDetail.abstencion_esperada).toBeUndefined();
      expect(minimalDetail.prioridad).toBeUndefined();
      expect(minimalDetail.r_abs).toBeUndefined();
    });

    it("handles full RegionDetail with Ola 4 CCPC and component fields", () => {
      const fullDetail: RegionDetail = {
        id: "07101",
        name: "Tuxtla Gutiérrez",
        level: "mun",
        ent: "07",
        lista_nominal: 420000,
        last_year: 2024,
        last_participation: 0.53,
        pred_participation: 0.51,
        pred_abstention: 0.49,
        pred_low: 0.44,
        pred_high: 0.54,
        trend_pp: -1.2,
        risk_score: 58,
        category: "naranja",
        parent: { id: "07", name: "Chiapas" },
        series: [],
        features: [],
        drivers: [],
        scenarios: [],
        recommendations: [],
        profile: [
          { year: 2024, age_group: "18-24", sexo: "M", ln: 28000, participation: 0.48 },
        ],
        ccpc: {
          pct_ln_18_34: 0.32,
          part_18_34: 0.46,
          gap_youth_pp: -5.0,
          gap_sexo_pp: 3.1,
          pct_ln_rural: 0.12,
        },
        pj_2025: { participation: 0.14 },
        imputed_census: false,
        abstencion_esperada: 205800,
        prioridad: 14,
        r_abs: 55.0,
        r_vuln: 62.0,
        r_trend: 68.0,
        r_vol: 45.0,
        vulnerability_pp: 2.4,
      };

      expect(fullDetail.profile?.length).toBe(1);
      expect(fullDetail.ccpc?.pct_ln_18_34).toBe(0.32);
      expect(fullDetail.abstencion_esperada).toBe(205800);
      expect(fullDetail.r_abs).toBe(55.0);
    });

    it("handles ModelMetrics with honest candidates and structural R2 fields", () => {
      const metrics: ModelMetrics = {
        target_year: 2027,
        train_years: [2015, 2018, 2021, 2024],
        backtests: [],
        coefficients: [],
        structural_r2: 0.30,
        structural_r2_within_state: 0.27,
        between_state_share: 0.47,
        selected_model: "persist_l1",
        national_level_assumption: 51.84,
        reliability_rule: "reliable = (ns_rate <= 0.5) and (participacion >= 0.02)",
        excluded_unreliable: { "2024": 38 },
        drivers_low_confidence: false,
        generated_at: "2026-10-05T12:00:00Z",
        data_sources: [],
      };

      expect(metrics.selected_model).toBe("persist_l1");
      expect(metrics.structural_r2).toBe(0.30);
      expect(metrics.structural_r2_within_state).toBe(0.27);
      expect(metrics.between_state_share).toBe(0.47);
      expect(metrics.national_level_assumption).toBe(51.84);
    });
  });
});
