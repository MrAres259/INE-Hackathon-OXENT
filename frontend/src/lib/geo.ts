// GeoJSON loader with automatic fallback to synthetic mock geometry
import type { FeatureCollection, Geometry } from "geojson";
import type { GeoIndexFile, GeoIndexItem, RiskItem } from "./types";
import { getMockStatesGeoJson, getMockMunGeoJson, getMockGeoIndex } from "./mocks/geo";
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
      items.push({
        id,
        name: s.name,
        level: "state",
        ent: id,
        bbox: s.bbox,
        centroid: s.centroid,
      });
    }
  }
  if (raw?.mun) {
    for (const [id, m] of Object.entries(raw.mun)) {
      items.push({
        id,
        name: m.name,
        level: "mun",
        ent: m.ent,
        centroid: m.centroid,
      });
    }
  }
  return items;
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
