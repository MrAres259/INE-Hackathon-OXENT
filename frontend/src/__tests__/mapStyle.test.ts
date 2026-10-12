import { describe, it, expect } from "vitest";
import {
  deltaColor,
  DELTA_NODATA,
  DELTA_BINS,
  categoryFillExpression,
  deltaFillExpression,
  fillExpression,
  extrusionHeight,
  featureStateFor,
  categoryLegend,
  deltaLegend,
  LAYER_IDS,
  SOURCE_IDS,
  MEXICO_BOUNDS,
  MAX_BOUNDS,
  BASEMAP,
} from "../lib/mapStyle";
import { CATEGORY_COLORS } from "../lib/format";
import type { RiskItem } from "../lib/types";

describe("mapStyle Logic & Expressions Tests", () => {
  it("exports valid map constants and Esri basemap with {z}/{y}/{x}", () => {
    expect(LAYER_IDS.statesFill).toBe("states-fill");
    expect(LAYER_IDS.munFill).toBe("mun-fill");
    expect(SOURCE_IDS.states).toBe("states");
    expect(MEXICO_BOUNDS).toEqual([[-118.6, 14.3], [-86.5, 32.8]]);
    expect(MAX_BOUNDS).toEqual([[-130, 5], [-75, 40]]);
    expect(BASEMAP.background).toBe("#060a13");
    expect(BASEMAP.base).toContain("server.arcgisonline.com");
    expect(BASEMAP.base).toContain("{z}/{y}/{x}");
    expect(BASEMAP.labels).toContain("server.arcgisonline.com");
    expect(BASEMAP.labels).toContain("{z}/{y}/{x}");
    expect(BASEMAP.maxzoom).toBe(16);
    expect(BASEMAP.attribution).toContain("Esri");
    expect(BASEMAP.attribution).toContain("INEGI MG 2024");
  });

  it("resolves deltaColor accurately on every class boundary", () => {
    // (-inf, -3] -> #2166ac
    expect(deltaColor(-4)).toBe("#2166ac");
    expect(deltaColor(-3)).toBe("#2166ac");

    // (-3, -1.5] -> #4393c3
    expect(deltaColor(-2)).toBe("#4393c3");
    expect(deltaColor(-1.5)).toBe("#4393c3");

    // (-1.5, -0.5] -> #92c5de
    expect(deltaColor(-1.0)).toBe("#92c5de");
    expect(deltaColor(-0.5)).toBe("#92c5de");

    // (-0.5, 0.5) -> #3b4252
    expect(deltaColor(-0.2)).toBe("#3b4252");
    expect(deltaColor(0)).toBe("#3b4252");
    expect(deltaColor(0.2)).toBe("#3b4252");

    // [0.5, 1.5) -> #f4a582
    expect(deltaColor(0.5)).toBe("#f4a582");
    expect(deltaColor(1.0)).toBe("#f4a582");

    // [1.5, 3) -> #d6604d
    expect(deltaColor(1.5)).toBe("#d6604d");
    expect(deltaColor(2.5)).toBe("#d6604d");

    // [3, inf) -> #b2182b
    expect(deltaColor(3)).toBe("#b2182b");
    expect(deltaColor(5)).toBe("#b2182b");

    // null / undefined / NaN -> DELTA_NODATA
    expect(deltaColor(null)).toBe(DELTA_NODATA);
    expect(deltaColor(undefined)).toBe(DELTA_NODATA);
    expect(deltaColor(NaN)).toBe(DELTA_NODATA);
  });

  it("constructs valid deltaFillExpression and categoryFillExpression with all colors", () => {
    const catExpr = categoryFillExpression() as unknown[];
    expect(Array.isArray(catExpr)).toBe(true);
    expect(catExpr[0]).toBe("match");
    expect(catExpr).toContain(CATEGORY_COLORS.verde);
    expect(catExpr).toContain(CATEGORY_COLORS.amarillo);
    expect(catExpr).toContain(CATEGORY_COLORS.naranja);
    expect(catExpr).toContain(CATEGORY_COLORS.rojo);
    expect(catExpr).toContain(CATEGORY_COLORS.sin_dato);

    const deltaExpr = deltaFillExpression() as unknown[];
    expect(Array.isArray(deltaExpr)).toBe(true);
    expect(deltaExpr[0]).toBe("case");
    expect(deltaExpr).toContain(DELTA_NODATA);

    const stepExpr = deltaExpr[2] as unknown[];
    expect(Array.isArray(stepExpr)).toBe(true);
    expect(stepExpr[0]).toBe("step");
    for (const bin of DELTA_BINS) {
      expect(stepExpr).toContain(bin.color);
    }

    // fillExpression switches between both modes
    expect(fillExpression("category")).toEqual(catExpr);
    expect(fillExpression("delta")).toEqual(deltaExpr);
  });

  it("calculates extrusionHeight with square-root scaling and caps at maxMeters", () => {
    const maxMeters = 100_000;
    const vmax = 10_000;

    // null, undefined, 0, negative -> 0
    expect(extrusionHeight(null, vmax, maxMeters)).toBe(0);
    expect(extrusionHeight(undefined, vmax, maxMeters)).toBe(0);
    expect(extrusionHeight(0, vmax, maxMeters)).toBe(0);
    expect(extrusionHeight(-100, vmax, maxMeters)).toBe(0);

    // vmax <= 0 -> 0
    expect(extrusionHeight(5000, 0, maxMeters)).toBe(0);
    expect(extrusionHeight(5000, -100, maxMeters)).toBe(0);

    // at vmax -> exact maxMeters
    expect(extrusionHeight(vmax, vmax, maxMeters)).toBe(maxMeters);

    // above vmax -> capped at maxMeters
    expect(extrusionHeight(vmax * 2, vmax, maxMeters)).toBe(maxMeters);

    // at vmax / 4 -> sqrt(1/4) * maxMeters = 0.5 * maxMeters
    expect(extrusionHeight(vmax / 4, vmax, maxMeters)).toBeCloseTo(maxMeters * 0.5);
  });

  it("produces correct featureStateFor edge cases", () => {
    const vmax = 50_000;
    const maxMeters = 100_000;

    // 1. Absent item
    const absent = featureStateFor(undefined, undefined, vmax, maxMeters);
    expect(absent).toEqual({
      cat: "sin_dato",
      delta: null,
      h: 0,
      reliable: false,
    });

    // 2. Base without delta (item === base)
    const baseItem: RiskItem = {
      id: "07",
      name: "Chiapas",
      level: "state",
      ent: "07",
      lista_nominal: 1_000_000,
      last_year: 2024,
      last_participation: 0.5,
      pred_participation: 0.5,
      pred_abstention: 0.5,
      pred_low: 0.45,
      pred_high: 0.55,
      trend_pp: -1.0,
      risk_score: 60,
      category: "naranja",
      abstencion_esperada: 25_000,
      reliable: true,
    };
    const stateSame = featureStateFor(baseItem, baseItem, vmax, maxMeters);
    expect(stateSame.delta).toBeNull();
    expect(stateSame.cat).toBe("naranja");
    expect(stateSame.reliable).toBe(true);
    expect(stateSame.h).toBeGreaterThan(0);

    // 3. Explicit delta
    const itemExplicitDelta: RiskItem = {
      ...baseItem,
      delta_vs_base_pp: -3.5,
    };
    const stateExplicit = featureStateFor(itemExplicitDelta, baseItem, vmax, maxMeters);
    expect(stateExplicit.delta).toBe(-3.5);

    // 4. Derived delta (pred_abstention difference * 100)
    const itemDerivedDelta: RiskItem = {
      ...baseItem,
      delta_vs_base_pp: undefined,
      pred_abstention: 0.42,
    };
    const stateDerived = featureStateFor(itemDerivedDelta, baseItem, vmax, maxMeters);
    expect(stateDerived.delta).toBeCloseTo(-8.0);

    // 5. reliable=false when explicit false or category is sin_dato
    const itemUnreliable: RiskItem = {
      ...baseItem,
      reliable: false,
    };
    expect(featureStateFor(itemUnreliable, baseItem, vmax, maxMeters).reliable).toBe(false);

    const itemSinDato: RiskItem = {
      ...baseItem,
      category: "sin_dato",
    };
    expect(featureStateFor(itemSinDato, baseItem, vmax, maxMeters).reliable).toBe(false);
  });

  it("generates category and delta legends with counts", () => {
    // Category legend
    const catLegendNoCounts = categoryLegend();
    expect(catLegendNoCounts).toHaveLength(5);
    expect(catLegendNoCounts[0].count).toBeUndefined();

    const catLegendWithCounts = categoryLegend({ rojo: 10, verde: 25 });
    expect(catLegendWithCounts.find((e) => e.key === "rojo")?.count).toBe(10);
    expect(catLegendWithCounts.find((e) => e.key === "verde")?.count).toBe(25);
    expect(catLegendWithCounts.find((e) => e.key === "naranja")?.count).toBe(0);

    // Delta legend
    const deltaLegendNoAlt = deltaLegend();
    expect(deltaLegendNoAlt).toHaveLength(7);
    expect(deltaLegendNoAlt[0].count).toBeUndefined();

    const altMap = new Map<string, RiskItem>();
    const baseMap = new Map<string, RiskItem>();

    baseMap.set("01", {
      id: "01",
      name: "Ags",
      level: "state",
      ent: "01",
      lista_nominal: 100,
      last_year: 2024,
      last_participation: 0.5,
      pred_participation: 0.5,
      pred_abstention: 0.5,
      pred_low: 0.4,
      pred_high: 0.6,
      trend_pp: 0,
      risk_score: 50,
      category: "amarillo",
    });

    altMap.set("01", {
      ...baseMap.get("01")!,
      delta_vs_base_pp: -3.5, // falls into bin 0 (<= -3)
    });

    const deltaLegendWithCounts = deltaLegend(altMap, baseMap);
    expect(deltaLegendWithCounts[0].count).toBe(1);
    expect(deltaLegendWithCounts[1].count).toBe(0);
  });
});
