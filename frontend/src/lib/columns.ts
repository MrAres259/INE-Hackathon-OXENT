import type { FeatureCollection, Feature, Polygon } from "geojson";
import type { GeoIndexItem, Level } from "./types";

export type ColumnProps = {
  id: string;
  ent: string;
  name: string;
  level: Level;
};

export const COLUMN_SEGMENTS = 12;

/**
 * Calculates column radius in kilometers based on territorial area.
 * R_eq = sqrt(area/π).
 * mun: clamp(0.35·R_eq, 1.0, 8.0) km (without area: 3 km).
 * state: clamp(0.22·R_eq, 15, 45) km (without area: 25 km).
 */
export function columnRadiusKm(level: Level, areaKm2?: number): number {
  if (
    areaKm2 === undefined ||
    areaKm2 === null ||
    typeof areaKm2 !== "number" ||
    Number.isNaN(areaKm2) ||
    areaKm2 <= 0
  ) {
    return level === "mun" ? 3.0 : 25.0;
  }
  const req = Math.sqrt(areaKm2 / Math.PI);
  if (level === "mun") {
    return Math.max(1.0, Math.min(8.0, 0.35 * req));
  }
  return Math.max(15.0, Math.min(45.0, 0.22 * req));
}

/**
 * Generates a regular polygon approximating a circle on Earth's surface.
 * Counter-clockwise (CCW) ring with segments + 1 points (closed).
 * Corrects longitude distortion by cos(latitude).
 * 1° latitude = 110.574 km, 1° longitude = 111.320·cos(lat) km.
 */
export function circlePolygon(
  center: [number, number],
  radiusKm: number,
  segments: number = COLUMN_SEGMENTS
): [number, number][][] {
  const [centerLon, centerLat] = center;
  const latRad = (centerLat * Math.PI) / 180;
  const cosLat = Math.cos(latRad);
  const safeCosLat = Math.abs(cosLat) < 1e-6 ? (cosLat >= 0 ? 1e-6 : -1e-6) : cosLat;

  const ring: [number, number][] = [];
  const segs = Math.max(3, segments);

  for (let i = 0; i < segs; i++) {
    const theta = (2 * Math.PI * i) / segs;
    const dx = radiusKm * Math.cos(theta);
    const dy = radiusKm * Math.sin(theta);
    const dLat = dy / 110.574;
    const dLon = dx / (111.320 * safeCosLat);
    ring.push([centerLon + dLon, centerLat + dLat]);
  }
  // Close the ring
  ring.push([ring[0][0], ring[0][1]]);

  return [ring];
}

/**
 * Builds GeoJSON FeatureCollections of 3D column prisms for states and municipalities.
 * Center is anchor ?? centroid. Items lacking both are skipped.
 */
export function buildColumnCollections(items: GeoIndexItem[]): {
  state: FeatureCollection<Polygon, ColumnProps>;
  mun: FeatureCollection<Polygon, ColumnProps>;
} {
  const stateFeatures: Feature<Polygon, ColumnProps>[] = [];
  const munFeatures: Feature<Polygon, ColumnProps>[] = [];

  if (!Array.isArray(items)) {
    return {
      state: { type: "FeatureCollection", features: [] },
      mun: { type: "FeatureCollection", features: [] },
    };
  }

  for (const item of items) {
    if (!item) continue;
    const center = item.anchor ?? item.centroid;
    if (
      !center ||
      !Array.isArray(center) ||
      center.length < 2 ||
      typeof center[0] !== "number" ||
      typeof center[1] !== "number" ||
      Number.isNaN(center[0]) ||
      Number.isNaN(center[1])
    ) {
      continue;
    }

    const radiusKm = columnRadiusKm(item.level, item.area_km2);
    const coords = circlePolygon(center, radiusKm, COLUMN_SEGMENTS);

    const feature: Feature<Polygon, ColumnProps> = {
      type: "Feature",
      id: String(item.id),
      properties: {
        id: String(item.id),
        ent: String(item.ent ?? ""),
        name: String(item.name ?? ""),
        level: item.level,
      },
      geometry: {
        type: "Polygon",
        coordinates: coords,
      },
    };

    if (item.level === "state") {
      stateFeatures.push(feature);
    } else if (item.level === "mun") {
      munFeatures.push(feature);
    }
  }

  return {
    state: { type: "FeatureCollection", features: stateFeatures },
    mun: { type: "FeatureCollection", features: munFeatures },
  };
}
