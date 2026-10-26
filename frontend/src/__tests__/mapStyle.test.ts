import { describe, it, expect } from "vitest";
import {
  deltaColor,
  DELTA_NODATA,
  DELTA_BINS,
  categoryFillExpression,
  deltaFillExpression,
  fillExpression,
  riskHeight,
  deltaHeight,
  mixHex,
  columnColorExpression,
  columnHeightExpression,
  COLUMN_MAX_M,
  COLUMN_MIN_FRACTION,
  COLUMN_ZOOM_SPLIT,
  featureStateFor,
  categoryLegend,
  deltaLegend,
  LAYER_IDS,
  SOURCE_IDS,
  MEXICO_BOUNDS,
  MAX_BOUNDS,
  BASEMAP,
  SOURCE_LAYERS,
  TILESET_MANIFEST,
} from "../lib/mapStyle";
import { CATEGORY_COLORS } from "../lib/format";
import type { RiskItem } from "../lib/types";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";

describe("mapStyle Logic & Expressions Tests", () => {
  it("exports valid map constants, layer IDs, column bounds, and basemap", () => {
    expect(LAYER_IDS.statesFill).toBe("states-fill");
    expect(LAYER_IDS.munFill).toBe("mun-fill");
    expect(LAYER_IDS.stateColumns).toBe("state-columns");
    expect(LAYER_IDS.munColumns).toBe("mun-columns");
    expect(LAYER_IDS.selectedStates).toBe("states-selected-line");
    expect(SOURCE_IDS.states).toBe("states");
    expect(SOURCE_IDS.mun).toBe("mun");
    expect(SOURCE_IDS.stateColumns).toBe("state-columns");
    expect(SOURCE_IDS.munColumns).toBe("mun-columns");
    expect(SOURCE_IDS.vector).toBe("atalaya");
    expect(SOURCE_LAYERS.states).toBe("states");
    expect(SOURCE_LAYERS.mun).toBe("mun");
    expect(TILESET_MANIFEST).toBe("/geo/tiles.json");
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
    expect(COLUMN_MAX_M.state).toBe(380_000);
    expect(COLUMN_MAX_M.mun).toBe(70_000);
    expect(COLUMN_MIN_FRACTION).toBe(0.04);
    expect(COLUMN_ZOOM_SPLIT).toBe(5.5);
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

  it("calculates monotonic riskHeight with 80 > 60 > 40 > 20 > 0 and null/NaN => 0 with COLUMN_MIN_FRACTION minimum", () => {
    const maxMeters = 100_000;

    // null, undefined, NaN -> 0
    expect(riskHeight(null, maxMeters)).toBe(0);
    expect(riskHeight(undefined, maxMeters)).toBe(0);
    expect(riskHeight(NaN, maxMeters)).toBe(0);

    // Score 0 returns minimum fraction height > 0
    const h0 = riskHeight(0, maxMeters);
    expect(h0).toBe(maxMeters * COLUMN_MIN_FRACTION);
    expect(h0).toBeGreaterThan(0);

    // Monotonic riskHeight: 80 (rojo) > 60 (naranja) > 40 (amarillo) > 20 (verde) > 0
    const h20 = riskHeight(20, maxMeters);
    const h40 = riskHeight(40, maxMeters);
    const h60 = riskHeight(60, maxMeters);
    const h80 = riskHeight(80, maxMeters);

    expect(h80).toBeGreaterThan(h60);
    expect(h60).toBeGreaterThan(h40);
    expect(h40).toBeGreaterThan(h20);
    expect(h20).toBeGreaterThan(h0);

    // Capping at 100
    expect(riskHeight(100, maxMeters)).toBe(maxMeters);
    expect(riskHeight(150, maxMeters)).toBe(maxMeters);
  });

  it("calculates symmetric deltaHeight with cap at 5 pp", () => {
    const maxMeters = 100_000;

    // null, undefined, NaN -> 0
    expect(deltaHeight(null, maxMeters)).toBe(0);
    expect(deltaHeight(undefined, maxMeters)).toBe(0);
    expect(deltaHeight(NaN, maxMeters)).toBe(0);

    // Zero delta has minimum fraction
    expect(deltaHeight(0, maxMeters)).toBe(maxMeters * COLUMN_MIN_FRACTION);

    // Symmetry: deltaHeight(-x) === deltaHeight(x)
    expect(deltaHeight(-3.2, maxMeters)).toBeCloseTo(deltaHeight(3.2, maxMeters));
    expect(deltaHeight(-1.5, maxMeters)).toBeCloseTo(deltaHeight(1.5, maxMeters));
    expect(deltaHeight(-0.5, maxMeters)).toBeCloseTo(deltaHeight(0.5, maxMeters));

    // Cap at 5 pp
    const hAt5 = deltaHeight(5.0, maxMeters);
    expect(hAt5).toBe(maxMeters);
    expect(deltaHeight(7.5, maxMeters)).toBe(maxMeters);
    expect(deltaHeight(-8.0, maxMeters)).toBe(maxMeters);
  });

  it("interpolates colors with mixHex including boundary values t=0 and t=1", () => {
    // Exact extremes
    expect(mixHex("#ff0000", "#0000ff", 0)).toBe("#ff0000");
    expect(mixHex("#ff0000", "#0000ff", 1)).toBe("#0000ff");

    // Clamping below 0 and above 1
    expect(mixHex("#ff0000", "#0000ff", -0.5)).toBe("#ff0000");
    expect(mixHex("#ff0000", "#0000ff", 1.5)).toBe("#0000ff");

    // Midpoint interpolation between black and white -> #808080 (128)
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");

    // Support 3-digit shorthand
    expect(mixHex("#f00", "#00f", 0)).toBe("#ff0000");
    expect(mixHex("#f00", "#00f", 1)).toBe("#0000ff");
  });

  it("constructs valid columnColorExpression with dim and hover branches for both modes", () => {
    for (const mode of ["category", "delta"] as const) {
      const expr = columnColorExpression(mode) as unknown[];
      expect(Array.isArray(expr)).toBe(true);
      expect(expr[0]).toBe("case");
      // Check feature-state hover check
      expect(JSON.stringify(expr)).toContain("hover");
      // Check feature-state dim check
      expect(JSON.stringify(expr)).toContain("dim");
    }
  });

  it("constructs valid columnHeightExpression with decreasing factors and passes style-spec validation", () => {
    const expr = columnHeightExpression() as unknown[];
    expect(Array.isArray(expr)).toBe(true);
    expect(expr[0]).toBe("interpolate");
    expect(expr[1]).toEqual(["linear"]);
    expect(expr[2]).toEqual(["zoom"]);

    // Stops: 3 -> 1, 5.5 -> 0.85, 7 -> 0.5, 9 -> 0.28, 12 -> 0.15
    const stops: { zoom: number; factor: number }[] = [];
    for (let i = 3; i < expr.length; i += 2) {
      const z = expr[i] as number;
      const mult = expr[i + 1] as unknown[];
      expect(Array.isArray(mult)).toBe(true);
      expect(mult[0]).toBe("*");
      expect(mult[1]).toEqual(["coalesce", ["feature-state", "h"], 0]);
      const factor = mult[2] as number;
      stops.push({ zoom: z, factor });
    }

    expect(stops).toHaveLength(5);
    expect(stops.map((s) => s.zoom)).toEqual([3, 5.5, 7, 9, 12]);
    expect(stops.map((s) => s.factor)).toEqual([1, 0.85, 0.5, 0.28, 0.15]);

    // Verify factor is strictly decreasing as zoom increases
    for (let i = 1; i < stops.length; i++) {
      expect(stops[i].factor).toBeLessThan(stops[i - 1].factor);
    }

    // Validate against MapLibre style specification using validateStyleMin
    const minimalStyle = {
      version: 8 as const,
      sources: {
        columns: {
          type: "geojson" as const,
          data: { type: "FeatureCollection" as const, features: [] },
        },
      },
      layers: [
        {
          id: "test-column-height-layer",
          type: "fill-extrusion" as const,
          source: "columns",
          paint: {
            "fill-extrusion-height": columnHeightExpression(),
          },
        },
      ],
    };

    const errors = validateStyleMin(minimalStyle);
    expect(errors).toHaveLength(0);
  });

  it("produces correct featureStateFor edge cases using risk_score in category and |delta| in delta mode", () => {
    // 1. Absent item
    const absent = featureStateFor(undefined, undefined, "category", "state");
    expect(absent).toEqual({
      cat: "sin_dato",
      delta: null,
      h: 0,
      reliable: false,
    });

    // 2. Base item without delta (item === base)
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

    // Category mode: uses risk_score (60)
    const stateCat = featureStateFor(baseItem, baseItem, "category", "state");
    expect(stateCat.delta).toBeNull();
    expect(stateCat.cat).toBe("naranja");
    expect(stateCat.reliable).toBe(true);
    expect(stateCat.h).toBe(riskHeight(60, COLUMN_MAX_M.state));

    // Delta mode when item === base: delta is null -> h is deltaHeight(null) = 0
    const stateDeltaBase = featureStateFor(baseItem, baseItem, "delta", "state");
    expect(stateDeltaBase.delta).toBeNull();
    expect(stateDeltaBase.h).toBe(0);

    // 3. Explicit delta
    const itemExplicitDelta: RiskItem = {
      ...baseItem,
      level: "mun",
      delta_vs_base_pp: -3.5,
      risk_score: 82,
    };

    // In category mode: height from risk_score (82)
    const stateMunCat = featureStateFor(itemExplicitDelta, baseItem, "category", "mun");
    expect(stateMunCat.h).toBe(riskHeight(82, COLUMN_MAX_M.mun));

    // In delta mode: height from |delta| (-3.5)
    const stateMunDelta = featureStateFor(itemExplicitDelta, baseItem, "delta", "mun");
    expect(stateMunDelta.delta).toBe(-3.5);
    expect(stateMunDelta.h).toBe(deltaHeight(-3.5, COLUMN_MAX_M.mun));

    // 4. Derived delta (pred_abstention difference * 100)
    const itemDerivedDelta: RiskItem = {
      ...baseItem,
      delta_vs_base_pp: undefined,
      pred_abstention: 0.42, // (0.42 - 0.50) * 100 = -8.0 pp
    };
    const stateDerived = featureStateFor(itemDerivedDelta, baseItem, "delta", "state");
    expect(stateDerived.delta).toBeCloseTo(-8.0);
    expect(stateDerived.h).toBe(deltaHeight(-8.0, COLUMN_MAX_M.state));

    // 5. reliable=false when explicit false or category is sin_dato
    const itemUnreliable: RiskItem = {
      ...baseItem,
      reliable: false,
    };
    expect(featureStateFor(itemUnreliable, baseItem, "category", "state").reliable).toBe(false);

    const itemSinDato: RiskItem = {
      ...baseItem,
      category: "sin_dato",
    };
    expect(featureStateFor(itemSinDato, baseItem, "category", "state").reliable).toBe(false);
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
