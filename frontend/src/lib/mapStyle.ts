import type { ExpressionSpecification } from "maplibre-gl";
import type { Category, Level, RiskItem } from "./types";
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
  stateColumns: "state-columns",
  munColumns: "mun-columns",
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
  stateColumns: "state-columns",
  munColumns: "mun-columns",
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

export const COLUMN_MAX_M = { state: 420_000, mun: 90_000 } as const;
export const COLUMN_MIN_FRACTION = 0.04;
export const COLUMN_ZOOM_SPLIT = 5.5;

export function riskHeight(score: number | null | undefined, maxMeters: number): number {
  if (score === null || score === undefined || Number.isNaN(score)) {
    return 0;
  }
  const clamped = Math.max(0, Math.min(100, score));
  const fraction = Math.pow(clamped / 100, 1.6);
  return maxMeters * Math.max(COLUMN_MIN_FRACTION, fraction);
}

export function deltaHeight(deltaPp: number | null | undefined, maxMeters: number): number {
  if (deltaPp === null || deltaPp === undefined || Number.isNaN(deltaPp)) {
    return 0;
  }
  const absDelta = Math.abs(deltaPp);
  const fraction = Math.min(absDelta, 5) / 5;
  return maxMeters * Math.max(COLUMN_MIN_FRACTION, fraction);
}

/**
 * Linearly interpolates between two hex colors by factor t (clamped to [0, 1]).
 * Returns lowercase #rrggbb format.
 */
export function mixHex(a: string, b: string, t: number): string {
  const parseHex = (hex: string): [number, number, number] => {
    let clean = hex.replace("#", "").trim();
    if (clean.length === 3) {
      clean = clean
        .split("")
        .map((c) => c + c)
        .join("");
    }
    const num = parseInt(clean, 16);
    if (Number.isNaN(num)) return [0, 0, 0];
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  };

  const factor = Math.max(0, Math.min(1, t));
  const [r1, g1, b1] = parseHex(a);
  const [r2, g2, b2] = parseHex(b);

  if (factor === 0) {
    return `#${r1.toString(16).padStart(2, "0")}${g1.toString(16).padStart(2, "0")}${b1.toString(16).padStart(2, "0")}`;
  }
  if (factor === 1) {
    return `#${r2.toString(16).padStart(2, "0")}${g2.toString(16).padStart(2, "0")}${b2.toString(16).padStart(2, "0")}`;
  }

  const r = Math.round(r1 + (r2 - r1) * factor);
  const g = Math.round(g1 + (g2 - g1) * factor);
  const bVal = Math.round(b1 + (b2 - b1) * factor);

  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${bVal.toString(16).padStart(2, "0")}`;
}

const DIM_FACTOR = 0.7;
const HOVER_FACTOR = 0.35;
const HOVER_TARGET = "#ffffff";

// Precomputed category variants for column shaders
const CATEGORY_HOVER_COLORS: Record<Category, string> = {
  verde: mixHex(CATEGORY_COLORS.verde, HOVER_TARGET, HOVER_FACTOR),
  amarillo: mixHex(CATEGORY_COLORS.amarillo, HOVER_TARGET, HOVER_FACTOR),
  naranja: mixHex(CATEGORY_COLORS.naranja, HOVER_TARGET, HOVER_FACTOR),
  rojo: mixHex(CATEGORY_COLORS.rojo, HOVER_TARGET, HOVER_FACTOR),
  sin_dato: mixHex(CATEGORY_COLORS.sin_dato, HOVER_TARGET, HOVER_FACTOR),
};

const CATEGORY_DIM_COLORS: Record<Category, string> = {
  verde: mixHex(CATEGORY_COLORS.verde, BASEMAP.land, DIM_FACTOR),
  amarillo: mixHex(CATEGORY_COLORS.amarillo, BASEMAP.land, DIM_FACTOR),
  naranja: mixHex(CATEGORY_COLORS.naranja, BASEMAP.land, DIM_FACTOR),
  rojo: mixHex(CATEGORY_COLORS.rojo, BASEMAP.land, DIM_FACTOR),
  sin_dato: mixHex(CATEGORY_COLORS.sin_dato, BASEMAP.land, DIM_FACTOR),
};

function categoryColumnVariantExpression(variant: "base" | "hover" | "dim"): ExpressionSpecification {
  const colors =
    variant === "hover"
      ? CATEGORY_HOVER_COLORS
      : variant === "dim"
      ? CATEGORY_DIM_COLORS
      : CATEGORY_COLORS;

  return [
    "match",
    ["coalesce", ["feature-state", "cat"], "sin_dato"],
    "verde", colors.verde,
    "amarillo", colors.amarillo,
    "naranja", colors.naranja,
    "rojo", colors.rojo,
    "sin_dato", colors.sin_dato,
    colors.sin_dato,
  ] as ExpressionSpecification;
}

// Precomputed delta bin variants for column shaders
const DELTA_BINS_HOVER = DELTA_BINS.map((b) => mixHex(b.color, HOVER_TARGET, HOVER_FACTOR));
const DELTA_BINS_DIM = DELTA_BINS.map((b) => mixHex(b.color, BASEMAP.land, DIM_FACTOR));
const DELTA_NODATA_HOVER = mixHex(DELTA_NODATA, HOVER_TARGET, HOVER_FACTOR);
const DELTA_NODATA_DIM = mixHex(DELTA_NODATA, BASEMAP.land, DIM_FACTOR);

function deltaColumnVariantExpression(variant: "base" | "hover" | "dim"): ExpressionSpecification {
  const binColors =
    variant === "hover"
      ? DELTA_BINS_HOVER
      : variant === "dim"
      ? DELTA_BINS_DIM
      : DELTA_BINS.map((b) => b.color);
  const nodataColor =
    variant === "hover"
      ? DELTA_NODATA_HOVER
      : variant === "dim"
      ? DELTA_NODATA_DIM
      : DELTA_NODATA;

  return [
    "case",
    ["==", ["typeof", ["feature-state", "delta"]], "number"],
    [
      "step",
      ["feature-state", "delta"],
      binColors[0],
      -3, binColors[1],
      -1.5, binColors[2],
      -0.5, binColors[3],
      0.5, binColors[4],
      1.5, binColors[5],
      3, binColors[6],
    ],
    nodataColor,
  ] as ExpressionSpecification;
}

export function columnColorExpression(mode: ColorMode): ExpressionSpecification {
  const hoverExpr =
    mode === "delta"
      ? deltaColumnVariantExpression("hover")
      : categoryColumnVariantExpression("hover");
  const dimExpr =
    mode === "delta"
      ? deltaColumnVariantExpression("dim")
      : categoryColumnVariantExpression("dim");
  const baseExpr =
    mode === "delta"
      ? deltaColumnVariantExpression("base")
      : categoryColumnVariantExpression("base");

  return [
    "case",
    ["boolean", ["feature-state", "hover"], false],
    hoverExpr,
    ["boolean", ["feature-state", "dim"], false],
    dimExpr,
    baseExpr,
  ] as ExpressionSpecification;
}

export type FeatureStateValues = {
  cat: Category;
  delta: number | null;
  h: number;
  reliable: boolean;
};

export function featureStateFor(
  item: RiskItem | undefined,
  base: RiskItem | undefined,
  colorMode: ColorMode,
  level: Level
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

  const maxMeters = COLUMN_MAX_M[level];
  const h =
    colorMode === "delta"
      ? deltaHeight(delta, maxMeters)
      : riskHeight(item.risk_score, maxMeters);

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
