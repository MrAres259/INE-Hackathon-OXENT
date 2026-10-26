// GeoJSON loader with automatic fallback to synthetic mock geometry
import type { FeatureCollection, Geometry } from "geojson";
import type { GeoIndexFile, GeoIndexItem, RiskItem, TileManifest } from "./types";
import { getMockStatesGeoJson, getMockMunGeoJson, getMockGeoIndex as getBaseMockGeoIndex } from "./mocks/geo";
import { MOCK_STATES } from "./mocks/meta";
import { CATEGORY_COLORS } from "./format";

export type StateProperties = {
  id: string;
  name: string;
};

export type MunProperties = {
  id: string;
  ent: string;
  name: string;
};

export function toIndexItems(raw: GeoIndexFile): GeoIndexItem[] {
  const items: GeoIndexItem[] = [];
  if (raw?.states) {
    for (const [id, s] of Object.entries(raw.states)) {
      const rawState = s as typeof s & { anchor?: [number, number]; area_km2?: number };
      items.push({
        id,
        name: s.name,
        level: "state",
        ent: id,
        bbox: s.bbox,
        centroid: s.centroid,
        ...(rawState.anchor !== undefined ? { anchor: rawState.anchor } : {}),
        ...(rawState.area_km2 !== undefined ? { area_km2: rawState.area_km2 } : {}),
      });
    }
  }
  if (raw?.mun) {
    for (const [id, m] of Object.entries(raw.mun)) {
      const rawMun = m as typeof m & { anchor?: [number, number]; area_km2?: number };
      items.push({
        id,
        name: m.name,
        level: "mun",
        ent: m.ent,
        centroid: m.centroid,
        ...(rawMun.anchor !== undefined ? { anchor: rawMun.anchor } : {}),
        ...(rawMun.area_km2 !== undefined ? { area_km2: rawMun.area_km2 } : {}),
      });
    }
  }
  return items;
}

export function getMockGeoIndex(): GeoIndexItem[] {
  const base = getBaseMockGeoIndex();
  return base.map((item) => ({
    ...item,
    anchor: item.anchor ?? item.centroid,
    area_km2:
      item.area_km2 ??
      (item.level === "state" ? 60_000 : 800),
  }));
}

export function colorForFeature(
  feature: { properties?: { id?: string } } | null | undefined,
  itemsById: Map<string, RiskItem> | Record<string, RiskItem>
): string {
  const id = feature?.properties?.id;
  if (!id) return CATEGORY_COLORS.sin_dato;
  const item = itemsById instanceof Map ? itemsById.get(id) : itemsById[id];
  return item ? CATEGORY_COLORS[item.category] : CATEGORY_COLORS.sin_dato;
}

const isMockForce = (): boolean => {
  if (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_MOCK) {
    return process.env.NEXT_PUBLIC_MOCK === "1" || process.env.NEXT_PUBLIC_MOCK === "true";
  }
  return false;
};

export async function fetchStatesGeoJson(): Promise<FeatureCollection<Geometry, StateProperties>> {
  if (isMockForce()) {
    return getMockStatesGeoJson();
  }
  try {
    const res = await fetch("/geo/states.json");
    if (!res.ok) {
      return getMockStatesGeoJson();
    }
    return (await res.json()) as FeatureCollection<Geometry, StateProperties>;
  } catch {
    return getMockStatesGeoJson();
  }
}

export async function fetchMunGeoJson(
  ent: string
): Promise<FeatureCollection<Geometry, MunProperties>> {
  if (isMockForce()) {
    return getMockMunGeoJson(ent);
  }
  try {
    const res = await fetch(`/geo/mun/${ent}.json`);
    if (!res.ok) {
      return getMockMunGeoJson(ent);
    }
    return (await res.json()) as FeatureCollection<Geometry, MunProperties>;
  } catch {
    return getMockMunGeoJson(ent);
  }
}

export async function fetchGeoIndex(): Promise<GeoIndexItem[]> {
  if (isMockForce()) {
    return getMockGeoIndex();
  }
  try {
    const res = await fetch("/geo/index.json");
    if (!res.ok) {
      return getMockGeoIndex();
    }
    const raw = (await res.json()) as GeoIndexFile;
    return toIndexItems(raw);
  } catch {
    return getMockGeoIndex();
  }
}

export type CountryProperties = {
  id: string;
};

export function getMockMunAllGeoJson(): FeatureCollection<Geometry, MunProperties> {
  const allFeatures: FeatureCollection<Geometry, MunProperties>["features"] = [];
  for (const s of MOCK_STATES) {
    const fc = getMockMunGeoJson(s.id);
    allFeatures.push(...fc.features);
  }
  return {
    type: "FeatureCollection",
    features: allFeatures,
  };
}

export async function fetchMunAllGeoJson(): Promise<FeatureCollection<Geometry, MunProperties>> {
  if (isMockForce()) {
    return getMockMunAllGeoJson();
  }
  try {
    const res = await fetch("/geo/mun_all.json");
    if (!res.ok) {
      return getMockMunAllGeoJson();
    }
    return (await res.json()) as FeatureCollection<Geometry, MunProperties>;
  } catch {
    return getMockMunAllGeoJson();
  }
}

export async function fetchCountryGeoJson(): Promise<FeatureCollection<Geometry, CountryProperties> | null> {
  if (isMockForce()) {
    return null;
  }
  try {
    const res = await fetch("/geo/country.json");
    if (!res.ok) {
      return null;
    }
    return (await res.json()) as FeatureCollection<Geometry, CountryProperties>;
  } catch {
    return null;
  }
}

export function absoluteTileUrl(template: string, origin?: string): string {
  if (!template) return "";
  const base =
    origin ||
    (typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "http://localhost:3000");
  try {
    const url = new URL(template, base);
    return url
      .toString()
      .replace(/%7Bz%7D/gi, "{z}")
      .replace(/%7Bx%7D/gi, "{x}")
      .replace(/%7By%7D/gi, "{y}");
  } catch {
    return template;
  }
}

export async function fetchTileManifest(): Promise<TileManifest | null> {
  try {
    const res = await fetch("/geo/tiles.json", { cache: "no-cache" });
    if (!res.ok) {
      return null;
    }
    const data = (await res.json()) as TileManifest;
    if (!data || typeof data !== "object") {
      return null;
    }
    if (typeof data.tilejson !== "string" || !data.tilejson) {
      return null;
    }
    if (
      !Array.isArray(data.tiles) ||
      data.tiles.length === 0 ||
      typeof data.tiles[0] !== "string"
    ) {
      return null;
    }
    const tile0 = data.tiles[0];
    if (
      !tile0.includes("{z}") ||
      !tile0.includes("{x}") ||
      !tile0.includes("{y}")
    ) {
      return null;
    }
    if (
      typeof data.minzoom !== "number" ||
      typeof data.maxzoom !== "number" ||
      Number.isNaN(data.minzoom) ||
      Number.isNaN(data.maxzoom)
    ) {
      return null;
    }
    if (!Array.isArray(data.vector_layers)) {
      return null;
    }
    const hasStates = data.vector_layers.some((l) => l && l.id === "states");
    const hasMun = data.vector_layers.some((l) => l && l.id === "mun");
    if (!hasStates || !hasMun) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}
