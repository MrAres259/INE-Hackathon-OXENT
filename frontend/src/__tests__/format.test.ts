import { describe, it, expect } from "vitest";
import {
  formatPct,
  formatPp,
  formatInt,
  getCategoryColor,
  getCategoryLabel,
  escapeCsvField,
  generateRankingCsv,
} from "../lib/format";
import type { RiskItem } from "../lib/types";

describe("Format Utilities", () => {
  it("formats percentages correctly", () => {
    expect(formatPct(0.524)).toBe("52.4%");
    expect(formatPct(0.5)).toBe("50.0%");
    expect(formatPct(0.5246, 2)).toBe("52.46%");
    expect(formatPct(null)).toBe("—");
    expect(formatPct(undefined)).toBe("—");
    expect(formatPct(NaN)).toBe("—");
  });

  it("formats percentage points with explicit sign", () => {
    expect(formatPp(3.5)).toBe("+3.5 pp");
    expect(formatPp(-2.1)).toBe("-2.1 pp");
    expect(formatPp(0)).toBe("0.0 pp");
    expect(formatPp(null)).toBe("—");
    expect(formatPp(undefined)).toBe("—");
  });

  it("formats integers with locale grouping", () => {
    expect(formatInt(1250000)).toMatch(/1[.,\s]?250[.,\s]?000/);
    expect(formatInt(0)).toBe("0");
    expect(formatInt(null)).toBe("—");
  });

  it("maps categories to official semáforo colors", () => {
    expect(getCategoryColor("verde")).toBe("#2e7d32");
    expect(getCategoryColor("amarillo")).toBe("#f9a825");
    expect(getCategoryColor("naranja")).toBe("#ef6c00");
    expect(getCategoryColor("rojo")).toBe("#c62828");
    expect(getCategoryColor("sin_dato")).toBe("#bdbdbd");
  });

  it("maps categories to Spanish labels", () => {
    expect(getCategoryLabel("verde")).toBe("Riesgo Bajo");
    expect(getCategoryLabel("amarillo")).toBe("Riesgo Moderado");
    expect(getCategoryLabel("naranja")).toBe("Riesgo Alto");
    expect(getCategoryLabel("rojo")).toBe("Riesgo Crítico");
    expect(getCategoryLabel("sin_dato")).toBe("Sin dato");
  });

  it("escapes CSV fields properly", () => {
    expect(escapeCsvField("Simple")).toBe("Simple");
    expect(escapeCsvField("Text, with comma")).toBe('"Text, with comma"');
    expect(escapeCsvField('Text with "quotes"')).toBe('"Text with ""quotes"""');
    expect(escapeCsvField("Line1\nLine2")).toBe('"Line1\nLine2"');
    expect(escapeCsvField(1234)).toBe("1234");
    expect(escapeCsvField(null)).toBe("");
  });

  it("generates valid CSV from ranking items", () => {
    const items: RiskItem[] = [
      {
        id: "07101",
        name: "Tuxtla Gutiérrez, Chiapas",
        level: "mun",
        ent: "07",
        lista_nominal: 425000,
        last_year: 2024,
        last_participation: 0.53,
        pred_participation: 0.52,
        pred_abstention: 0.48,
        pred_low: 0.44,
        pred_high: 0.52,
        trend_pp: -0.8,
        risk_score: 48,
        category: "amarillo",
        delta_vs_base_pp: -2.8,
      },
    ];

    const csv = generateRankingCsv(items);
    const lines = csv.split("\r\n");
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("Clave,Nombre,Nivel");
    expect(lines[1]).toContain('"Tuxtla Gutiérrez, Chiapas"');
    expect(lines[1]).toContain("07101");
    expect(lines[1]).toContain("48.0"); // Abstention
    expect(lines[1]).toContain("Riesgo Moderado");
  });
});
