import type { Level } from "./types";

export type GeometryMode = "vector" | "geojson" | "mock";

/**
 * Pure WebGL support detector.
 * Tests webgl2 first, then webgl on a detached canvas element.
 */
export function detectWebGL(doc?: Document): { ok: boolean; version: 0 | 1 | 2 } {
  try {
    const d = doc ?? (typeof document !== "undefined" ? document : undefined);
    if (!d || typeof d.createElement !== "function") {
      return { ok: false, version: 0 };
    }
    const canvas = d.createElement("canvas");
    if (!canvas || typeof canvas.getContext !== "function") {
      return { ok: false, version: 0 };
    }
    try {
      const gl2 = canvas.getContext("webgl2");
      if (gl2) {
        return { ok: true, version: 2 };
      }
    } catch {}
    try {
      const gl =
        canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
      if (gl) {
        return { ok: true, version: 1 };
      }
    } catch {}
    return { ok: false, version: 0 };
  } catch {
    return { ok: false, version: 0 };
  }
}

/**
 * Resolves MapLibre feature state target object.
 * In vector mode, target includes sourceLayer: "states" | "mun" and source: "atalaya".
 * In geojson/mock mode, target specifies source: "states" | "mun".
 */
export function featureTarget(
  mode: GeometryMode,
  level: Level,
  id: string
): { source: string; sourceLayer?: string; id: string } {
  if (mode === "vector") {
    return {
      source: "atalaya",
      sourceLayer: level === "state" ? "states" : "mun",
      id,
    };
  }
  return {
    source: level === "state" ? "states" : "mun",
    id,
  };
}

/**
 * Determines whether a queried feature belongs to state or mun level.
 * In vector mode, checks sourceLayer first ("states" vs "mun").
 * Recognizes extrusion layers ("states-extrusion" vs "mun-extrusion") and sources.
 * Falls back to layer ID substring and id length (2 digits = state).
 */
export function levelOfFeature(f: {
  source?: string;
  sourceLayer?: string;
  layer?: { id?: string };
  id?: unknown;
}): Level {
  if (f.sourceLayer) {
    return f.sourceLayer === "states" || f.sourceLayer === "state"
      ? "state"
      : "mun";
  }
  const layerId = f.layer?.id;
  if (layerId) {
    if (
      layerId === "states-extrusion" ||
      layerId.includes("states") ||
      layerId.includes("state")
    ) {
      return "state";
    }
    if (layerId === "mun-extrusion" || layerId.includes("mun")) {
      return "mun";
    }
  }
  const source = f.source;
  if (source) {
    if (source.includes("states") || source.includes("state")) {
      return "state";
    }
    if (source.includes("mun")) {
      return "mun";
    }
  }
  const idStr = String(f.id ?? "");
  if (idStr.length === 2) return "state";
  return "mun";
}

export interface TileErrorTrackerOptions {
  threshold?: number;
  windowMs?: number;
  now?: () => number;
}

export interface TileErrorTracker {
  error(sourceId: string): boolean;
  success(sourceId: string): void;
  hidden(sourceId: string): boolean;
}

/**
 * Tracks tile loading errors per source within a rolling time window.
 * Returns true from error() only when >= threshold errors occurred
 * without any successful tile load in that window.
 */
export function createTileErrorTracker(
  opts?: TileErrorTrackerOptions
): TileErrorTracker {
  const threshold = opts?.threshold ?? 6;
  const windowMs = opts?.windowMs ?? 20000;
  const now = opts?.now ?? (() => Date.now());

  const errorsBySource = new Map<string, number[]>();
  const lastSuccessBySource = new Map<string, number>();
  const hiddenBySource = new Map<string, boolean>();

  return {
    error(sourceId: string): boolean {
      const currentTime = now();
      const cutoff = currentTime - windowMs;
      const prev = errorsBySource.get(sourceId) ?? [];
      const recent = prev.filter((t) => t >= cutoff);
      recent.push(currentTime);
      errorsBySource.set(sourceId, recent);

      const lastSuccess = lastSuccessBySource.get(sourceId);
      const noSuccessInWindow = lastSuccess === undefined || lastSuccess < cutoff;

      if (recent.length >= threshold && noSuccessInWindow) {
        hiddenBySource.set(sourceId, true);
        return true;
      }
      return hiddenBySource.get(sourceId) ?? false;
    },
    success(sourceId: string): void {
      const currentTime = now();
      lastSuccessBySource.set(sourceId, currentTime);
      errorsBySource.set(sourceId, []);
      hiddenBySource.set(sourceId, false);
    },
    hidden(sourceId: string): boolean {
      return hiddenBySource.get(sourceId) ?? false;
    },
  };
}

export interface FitPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Calculates fitBounds padding incorporating an extra bottom inset (e.g. from a mobile bottom sheet).
 * Limits extra padding to max(0, containerHeight * 0.6 - base), and falls back to 0 for non-numeric values.
 */
export function fitPaddingWithInset(
  base: number,
  containerHeight: number,
  extraBottom: number
): FitPadding {
  const safeBase = typeof base === "number" && !Number.isNaN(base) ? base : 0;
  const safeHeight =
    typeof containerHeight === "number" && !Number.isNaN(containerHeight)
      ? containerHeight
      : 0;
  const rawExtra =
    typeof extraBottom === "number" && !Number.isNaN(extraBottom)
      ? extraBottom
      : 0;

  const maxExtra = Math.max(0, safeHeight * 0.6 - safeBase);
  const extra = Math.min(Math.max(0, rawExtra), maxExtra);

  return {
    top: safeBase,
    right: safeBase,
    left: safeBase,
    bottom: safeBase + extra,
  };
}

