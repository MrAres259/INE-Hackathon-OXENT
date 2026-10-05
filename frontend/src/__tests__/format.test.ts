import { describe, it, expect } from "vitest";
import {
  formatPct,
  formatPp,
  formatInt,
  getCategoryColor,
  getCategoryLabel,
  escapeCsvField,
  generateRankingCsv,
  getVotesLabel,
  formatSignedVotes,
  getVotesColorClass,
  formatDeltaPp,
  getDeltaAbstentionColorClass,
  getDeltaAbstentionHex,
  hasProminentDrivers,
} from "../lib/format";
import type { RiskItem, Driver } from "../lib/types";

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

  it("formats signed votes and labels according to sign", () => {
    expect(getVotesLabel(326621)).toBe("Votos adicionales estimados");
    expect(getVotesLabel(0)).toBe("Votos adicionales estimados");
    expect(getVotesLabel(null)).toBe("Votos adicionales estimados");
    expect(getVotesLabel(undefined)).toBe("Votos adicionales estimados");
    expect(getVotesLabel(-1631433)).toBe("Votos perdidos estimados");
    expect(getVotesLabel(-1)).toBe("Votos perdidos estimados");

    expect(formatSignedVotes(326621)).toMatch(/^\+326[.,\s]?621$/);
    expect(formatSignedVotes(-1631433)).toMatch(/^−1[.,\s]?631[.,\s]?433$/);
    expect(formatSignedVotes(0)).toBe("+0");
    expect(formatSignedVotes(null)).toBe("—");
    expect(formatSignedVotes(undefined)).toBe("—");
    expect(formatSignedVotes(NaN)).toBe("—");

    expect(getVotesColorClass(326621)).toBe("text-emerald-400");
    expect(getVotesColorClass(0)).toBe("text-emerald-400");
    expect(getVotesColorClass(-1631433)).toBe("text-rose-400");
    expect(getVotesColorClass(null)).toBe("text-slate-400");
  });

  it("evaluates delta abstention semantics: negative improves, positive worsens", () => {
    expect(formatDeltaPp(-2.5)).toBe("-2.5 pp");
    expect(formatDeltaPp(1.8)).toBe("+1.8 pp");
    expect(formatDeltaPp(0)).toBe("0.0 pp");
    expect(formatDeltaPp(null)).toBe("—");

    // Negative delta = less abstention = green
    expect(getDeltaAbstentionColorClass(-2.5)).toBe("text-emerald-400");
    expect(getDeltaAbstentionHex(-2.5)).toBe("#10b981");

    // Positive delta = more abstention = red/rose
    expect(getDeltaAbstentionColorClass(1.8)).toBe("text-rose-400");
    expect(getDeltaAbstentionHex(1.8)).toBe("#f43f5e");

    // Neutral
    expect(getDeltaAbstentionColorClass(0)).toBe("text-slate-200");
    expect(getDeltaAbstentionColorClass(null)).toBe("text-slate-400");
  });

  it("checks driver prominence threshold (|contribution_pp| >= 0.3)", () => {
    expect(hasProminentDrivers(null)).toBe(false);
    expect(hasProminentDrivers([])).toBe(false);

    const weakDrivers: Driver[] = [
      { key: "graproes", label: "Escolaridad", contribution_pp: 0.1, direction: "baja_abstencion" },
      { key: "pct_rural", label: "Ruralidad", contribution_pp: -0.2, direction: "sube_abstencion" },
      { key: "pct_18_24", label: "Jóvenes", contribution_pp: 0.29, direction: "sube_abstencion" },
    ];
    expect(hasProminentDrivers(weakDrivers)).toBe(false);

    const strongDrivers: Driver[] = [
      { key: "graproes", label: "Escolaridad", contribution_pp: 0.1, direction: "baja_abstencion" },
      { key: "pct_18_24", label: "Jóvenes", contribution_pp: -0.3, direction: "sube_abstencion" },
    ];
    expect(hasProminentDrivers(strongDrivers)).toBe(true);

    const prominentPositive: Driver[] = [
      { key: "im_2020", label: "Marginación", contribution_pp: 1.5, direction: "sube_abstencion" },
    ];
    expect(hasProminentDrivers(prominentPositive)).toBe(true);
  });
});
