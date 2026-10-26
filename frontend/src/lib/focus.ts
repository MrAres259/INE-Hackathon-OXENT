export interface ResolveFocusParams {
  selectedEnt?: string | null;
  zoom: number;
  centerEnt?: string | null;
  previous?: string | null;
}

/**
 * Resolves the state code ("ent") to focus for municipal extrusions in 3D.
 *
 * Rules:
 * 1. If selectedEnt exists, selection takes precedence ("la selección manda").
 * 2. If zoom < 5.5, returns null (national zoom: only 32 states are elevated; no municipal focus).
 * 3. Otherwise (zoom >= 5.5), returns centerEnt if available, falling back to previous (e.g. when center is over sea).
 */
export function resolveFocusEnt(params: ResolveFocusParams): string | null {
  const { selectedEnt, zoom, centerEnt, previous } = params;

  if (selectedEnt && selectedEnt.trim() !== "") {
    return selectedEnt.trim();
  }

  if (zoom < 5.5) {
    return null;
  }

  if (centerEnt && centerEnt.trim() !== "") {
    return centerEnt.trim();
  }

  if (previous && previous.trim() !== "") {
    return previous.trim();
  }

  return null;
}

/**
 * Extracts a 2-digit state identifier ("ent") from a MapLibre feature or feature-like object.
 * Reads properties.ent first; falls back to the first 2 characters of id or properties.id.
 */
export function entFromFeature(f?: {
  properties?: Record<string, any> | null;
  id?: unknown;
} | null): string | null {
  if (!f) return null;

  const rawEnt = f.properties?.ent;
  if (rawEnt !== undefined && rawEnt !== null && String(rawEnt).trim() !== "") {
    const s = String(rawEnt).trim();
    return s.length === 1 ? s.padStart(2, "0") : s;
  }

  const rawId = f.id ?? f.properties?.id;
  if (rawId !== undefined && rawId !== null && String(rawId).trim() !== "") {
    const s = String(rawId).trim();
    if (s.length >= 2) {
      return s.slice(0, 2);
    }
    if (s.length === 1) {
      return s.padStart(2, "0");
    }
  }

  return null;
}
