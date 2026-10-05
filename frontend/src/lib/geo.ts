// GeoJSON loader with automatic fallback to synthetic mock geometry
import type { FeatureCollection, Geometry } from "geojson";
import type { GeoIndexItem } from "./mocks/geo";
import { getMockStatesGeoJson, getMockMunGeoJson, getMockGeoIndex } from "./mocks/geo";

const isMockForce = (): boolean => {
  if (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_MOCK) {
    return process.env.NEXT_PUBLIC_MOCK === "1" || process.env.NEXT_PUBLIC_MOCK === "true";
  }
  return false;
};

export async function fetchStatesGeoJson(): Promise<FeatureCollection<Geometry, { cve_ent: string; nom_ent: string }>> {
  if (isMockForce()) {
    return getMockStatesGeoJson();
  }
  try {
    const res = await fetch("/geo/states.json");
    if (!res.ok) {
      return getMockStatesGeoJson();
    }
    return (await res.json()) as FeatureCollection<Geometry, { cve_ent: string; nom_ent: string }>;
  } catch {
    return getMockStatesGeoJson();
  }
}

export async function fetchMunGeoJson(
  ent: string
): Promise<FeatureCollection<Geometry, { cvegeo: string; cve_ent: string; nom_mun: string }>> {
  if (isMockForce()) {
    return getMockMunGeoJson(ent);
  }
  try {
    const res = await fetch(`/geo/mun/${ent}.json`);
    if (!res.ok) {
      return getMockMunGeoJson(ent);
    }
    return (await res.json()) as FeatureCollection<Geometry, { cvegeo: string; cve_ent: string; nom_mun: string }>;
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
    return (await res.json()) as GeoIndexItem[];
  } catch {
    return getMockGeoIndex();
  }
}
