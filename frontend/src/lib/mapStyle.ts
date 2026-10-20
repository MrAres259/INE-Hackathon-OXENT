import type { ExpressionSpecification } from "maplibre-gl";
import type { Category, RiskItem } from "./types";
import { CATEGORY_COLORS, CATEGORY_LABELS } from "./format";

export type ColorMode = "category" | "delta";

export const LAYER_IDS = {
  background: "bg",
  baseRaster: "carto-base",
  country: "country-fill",
  statesFill: "states-fill",
  munFill: "mun-fill",
  munLine: "mun-line",
  statesLine: "states-line",
  statesExtrusion: "states-extrusion",
  munExtrusion: "mun-extrusion",
  hoverStates: "states-hover",
  hoverMun: "mun-hover",
  selected: "selected-line",
  selectedStates: "states-selected-line",
  labelsRaster: "carto-labels",
} as const;

export const SOURCE_IDS = {
  states: "states",
  mun: "mun",
  country: "country",
  cartoBase: "carto-base",
  cartoLabels: "carto-labels",
  vector: "atalaya",
} as const;

export const SOURCE_LAYERS = {
  states: "states",
  mun: "mun",
} as const;

export const TILESET_MANIFEST = "/geo/tiles.json";

export const MEXICO_BOUNDS: [[number, number], [number, number]] = [
  [-118.6, 14.3],
  [-86.5, 32.8],
];

export const MAX_BOUNDS: [[number, number], [number, number]] = [
  [-130, 5],
  [-75, 40],
];

export const BASEMAP = {
  base: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
  labels: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
  attribution: "Esri, HERE, Garmin, © OpenStreetMap contributors · INEGI MG 2024 · INE CCPC",
  background: "#060a13",
  land: "#0e1626",
  maxzoom: 16,
};

export const DELTA_NODATA = "#4b5563";

export const DELTA_BINS: { min: number; max: number; color: string; label: string }[] = [
  { min: -Infinity, max: -3, color: "#2166ac", label: "≤ −3 pp" },
  { min: -3, max: -1.5, color: "#4393c3", label: "−3 a −1.5 pp" },
  { min: -1.5, max: -0.5, color: "#92c5de", label: "−1.5 a −0.5 pp" },
  { min: -0.5, max: 0.5, color: "#3b4252", label: "Sin cambio" },
  { min: 0.5, max: 1.5, color: "#f4a582", label: "+0.5 a +1.5 pp" },
  { min: 1.5, max: 3, color: "#d6604d", label: "+1.5 a +3 pp" },
  { min: 3, max: Infinity, color: "#b2182b", label: "≥ +3 pp" },
];

export function deltaColor(pp: number | null | undefined): string {
  if (pp === null || pp === undefined || isNaN(pp)) return DELTA_NODATA;
  if (pp <= -3) return DELTA_BINS[0].color;
  if (pp <= -1.5) return DELTA_BINS[1].color;
  if (pp <= -0.5) return DELTA_BINS[2].color;
  if (pp < 0.5) return DELTA_BINS[3].color;
  if (pp < 1.5) return DELTA_BINS[4].color;
  if (pp < 3) return DELTA_BINS[5].color;
  return DELTA_BINS[6].color;
}

export function categoryFillExpression(): ExpressionSpecification {
  return [
    "match",
    ["coalesce", ["feature-state", "cat"], "sin_dato"],
    "verde", CATEGORY_COLORS.verde,
    "amarillo", CATEGORY_COLORS.amarillo,
    "naranja", CATEGORY_COLORS.naranja,
    "rojo", CATEGORY_COLORS.rojo,
    "sin_dato", CATEGORY_COLORS.sin_dato,
    CATEGORY_COLORS.sin_dato,
  ] as ExpressionSpecification;
}

export function deltaFillExpression(): ExpressionSpecification {
  return [
    "case",
    ["==", ["typeof", ["feature-state", "delta"]], "number"],
    [
      "step",
      ["feature-state", "delta"],
      DELTA_BINS[0].color,
      -3, DELTA_BINS[1].color,
      -1.5, DELTA_BINS[2].color,
      -0.5, DELTA_BINS[3].color,
      0.5, DELTA_BINS[4].color,
      1.5, DELTA_BINS[5].color,
      3, DELTA_BINS[6].color,
    ],
    DELTA_NODATA,
  ] as ExpressionSpecification;
}

export function fillExpression(mode: ColorMode): ExpressionSpecification {
  return mode === "delta" ? deltaFillExpression() : categoryFillExpression();
}

export function extrusionHeight(
  value: number | null | undefined,
  vmax: number,
  maxMeters: number
): number {
  if (value === null || value === undefined || isNaN(value) || value <= 0 || vmax <= 0) {
    return 0;
  }
  const h = (Math.sqrt(value) / Math.sqrt(vmax)) * maxMeters;
  return Math.min(h, maxMeters);
}

export const EXTRUSION_MAX_M = {
  state: 350_000,
  mun: 120_000,
} as const;

export type FeatureStateValues = {
  cat: Category;
  delta: number | null;
  h: number;
  reliable: boolean;
};

export function featureStateFor(
  item: RiskItem | undefined,
  base: RiskItem | undefined,
  vmax: number,
  maxMeters: number
): FeatureStateValues {
  if (!item) {
    return {
      cat: "sin_dato",
      delta: null,
      h: 0,
      reliable: false,
    };
  }

  let delta: number | null = null;
  if (item === base) {
    delta = null;
  } else if (item.delta_vs_base_pp !== undefined && item.delta_vs_base_pp !== null) {
    delta = item.delta_vs_base_pp;
  } else if (
    item.pred_abstention !== null &&
    item.pred_abstention !== undefined &&
    base?.pred_abstention !== null &&
    base?.pred_abstention !== undefined
  ) {
    delta = (item.pred_abstention - base.pred_abstention) * 100;
  }

  const h = extrusionHeight(item.abstencion_esperada, vmax, maxMeters);
  const reliable = item.reliable !== false && item.category !== "sin_dato";
  const cat = item.category ?? "sin_dato";

  return {
    cat,
    delta,
    h,
    reliable,
  };
}

export type LegendEntry = {
  key: string;
  label: string;
  color: string;
  count?: number;
};

export function categoryLegend(counts?: Partial<Record<Category, number>>): LegendEntry[] {
  const categories: Category[] = ["verde", "amarillo", "naranja", "rojo", "sin_dato"];
  return categories.map((cat) => ({
    key: cat,
    label: CATEGORY_LABELS[cat] ?? cat,
    color: CATEGORY_COLORS[cat],
    count: counts ? (counts[cat] ?? 0) : undefined,
  }));
}

export function deltaLegend(
  alt?: Map<string, RiskItem>,
  base?: Map<string, RiskItem>
): LegendEntry[] {
  let binCounts: number[] | undefined;

  if (alt) {
    binCounts = new Array(DELTA_BINS.length).fill(0);
    for (const [id, item] of alt.entries()) {
      const baseItem = base?.get(id);
      let d: number | null = null;
      if (item.delta_vs_base_pp !== undefined && item.delta_vs_base_pp !== null) {
        d = item.delta_vs_base_pp;
      } else if (
        item.pred_abstention !== null &&
        item.pred_abstention !== undefined &&
        baseItem?.pred_abstention !== null &&
        baseItem?.pred_abstention !== undefined
      ) {
        d = (item.pred_abstention - baseItem.pred_abstention) * 100;
      }

      if (d !== null && !isNaN(d)) {
        if (d <= -3) binCounts[0]++;
        else if (d <= -1.5) binCounts[1]++;
        else if (d <= -0.5) binCounts[2]++;
        else if (d < 0.5) binCounts[3]++;
        else if (d < 1.5) binCounts[4]++;
        else if (d < 3) binCounts[5]++;
        else binCounts[6]++;
      }
    }
  }

  return DELTA_BINS.map((bin, idx) => ({
    key: `delta-${idx}`,
    label: bin.label,
    color: bin.color,
    count: binCounts ? binCounts[idx] : undefined,
  }));
}
