import { describe, it, expect } from "vitest";
import {
  columnRadiusKm,
  circlePolygon,
  buildColumnCollections,
  COLUMN_SEGMENTS,
} from "../lib/columns";
import type { GeoIndexItem } from "../lib/types";

function haversineDistanceKm(p1: [number, number], p2: [number, number]): number {
  const R = 6371.0;
  const dLat = ((p2[1] - p1[1]) * Math.PI) / 180;
  const dLon = ((p2[0] - p1[0]) * Math.PI) / 180;
  const lat1 = (p1[1] * Math.PI) / 180;
  const lat2 = (p2[1] * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

describe("columns geometry tests", () => {
  describe("columnRadiusKm", () => {
    it("keeps radius strictly within bounds for areas 1, 50, 5000, 250000 km² and without area", () => {
      const testAreas = [1, 50, 5000, 250000];

      // Municipality radius: [0.8, 4.5] km, default 2.0 km
      expect(columnRadiusKm("mun", undefined)).toBe(2.0);
      expect(columnRadiusKm("mun", 0)).toBe(2.0);
      expect(columnRadiusKm("mun", -10)).toBe(2.0);

      for (const area of testAreas) {
        const rMun = columnRadiusKm("mun", area);
        expect(rMun).toBeGreaterThanOrEqual(0.8);
        expect(rMun).toBeLessThanOrEqual(4.5);
      }

      // Exact clamp checks for mun
      expect(columnRadiusKm("mun", 1)).toBe(0.8); // 0.22 * sqrt(1/pi) ≈ 0.124 -> clamped to 0.8
      expect(columnRadiusKm("mun", 50)).toBeCloseTo(0.878, 2);
      expect(columnRadiusKm("mun", 5000)).toBe(4.5); // 0.22 * sqrt(5000/pi) ≈ 8.78 -> clamped to 4.5
      expect(columnRadiusKm("mun", 250000)).toBe(4.5);

      // State radius: [12.0, 35.0] km, default 20.0 km
      expect(columnRadiusKm("state", undefined)).toBe(20.0);
      expect(columnRadiusKm("state", 0)).toBe(20.0);
      expect(columnRadiusKm("state", -100)).toBe(20.0);

      for (const area of testAreas) {
        const rState = columnRadiusKm("state", area);
        expect(rState).toBeGreaterThanOrEqual(12.0);
        expect(rState).toBeLessThanOrEqual(35.0);
      }

      // Exact clamp checks for state
      expect(columnRadiusKm("state", 1)).toBe(12.0); // 0.18 * sqrt(1/pi) ≈ 0.101 -> clamped to 12.0
      expect(columnRadiusKm("state", 50)).toBe(12.0);
      expect(columnRadiusKm("state", 5000)).toBe(12.0);
      expect(columnRadiusKm("state", 250000)).toBe(35.0); // 0.18 * sqrt(250000/pi) ≈ 50.78 -> clamped to 35.0
    });
  });

  describe("circlePolygon", () => {
    it("closes the ring and has segments + 1 points", () => {
      const center: [number, number] = [-99.14, 19.35];
      const radiusKm = 5.0;
      const coords = circlePolygon(center, radiusKm, COLUMN_SEGMENTS);

      expect(Array.isArray(coords)).toBe(true);
      expect(coords.length).toBe(1);

      const ring = coords[0];
      expect(ring.length).toBe(COLUMN_SEGMENTS + 1);

      // Ring must be closed
      expect(ring[0][0]).toBe(ring[ring.length - 1][0]);
      expect(ring[0][1]).toBe(ring[ring.length - 1][1]);
    });

    it("measures radius within ±2% of requested at 15° and 32° of latitude", () => {
      // Test at 15° latitude (southern Mexico / Chiapas)
      const center15: [number, number] = [-93.0, 15.0];
      const radius15 = 6.0; // km
      const coords15 = circlePolygon(center15, radius15, 24);
      const ring15 = coords15[0];

      // Measure geodesic distance from center to all vertices (excluding duplicate last)
      for (let i = 0; i < ring15.length - 1; i++) {
        const pt = ring15[i];
        const dist = haversineDistanceKm(center15, pt);
        const relErr = Math.abs(dist - radius15) / radius15;
        expect(relErr).toBeLessThan(0.02); // within ±2%
      }

      // Test at 32° latitude (northern Mexico / Baja California / Sonora)
      const center32: [number, number] = [-115.0, 32.0];
      const radius32 = 30.0; // km
      const coords32 = circlePolygon(center32, radius32, 24);
      const ring32 = coords32[0];

      for (let i = 0; i < ring32.length - 1; i++) {
        const pt = ring32[i];
        const dist = haversineDistanceKm(center32, pt);
        const relErr = Math.abs(dist - radius32) / radius32;
        expect(relErr).toBeLessThan(0.02); // within ±2%
      }
    });
  });

  describe("buildColumnCollections", () => {
    it("uses anchor when available, falls back to centroid, and omits items without both", () => {
      const items: GeoIndexItem[] = [
        {
          id: "07",
          name: "Chiapas",
          level: "state",
          ent: "07",
          centroid: [-92.5, 16.5],
          anchor: [-92.7, 16.7],
          area_km2: 73311,
        },
        {
          id: "09",
          name: "Ciudad de México",
          level: "state",
          ent: "09",
          centroid: [-99.14, 19.35],
          // No anchor: should fallback to centroid
          area_km2: 1495,
        },
        {
          id: "07101",
          name: "Tuxtla Gutiérrez",
          level: "mun",
          ent: "07",
          centroid: [-93.1, 16.75],
          anchor: [-93.12, 16.77],
          area_km2: 334,
        },
        {
          id: "99999",
          name: "Sin Coordenadas",
          level: "mun",
          ent: "99",
          // Neither anchor nor centroid: should be omitted
        },
      ];

      const collections = buildColumnCollections(items);
      expect(collections.state.type).toBe("FeatureCollection");
      expect(collections.mun.type).toBe("FeatureCollection");

      // State features: Chiapas and CDMX (2 features)
      expect(collections.state.features).toHaveLength(2);

      const chiapasFeat = collections.state.features.find((f) => f.id === "07");
      expect(chiapasFeat).toBeDefined();
      expect(chiapasFeat?.properties.name).toBe("Chiapas");
      expect(chiapasFeat?.properties.level).toBe("state");
      expect(chiapasFeat?.properties.id).toBe("07");
      // Must use anchor [-92.7, 16.7] as center: average of ring coordinates ≈ anchor
      const chiapasRing = chiapasFeat!.geometry.coordinates[0];
      const chiapasAvgLon =
        chiapasRing.slice(0, -1).reduce((s, p) => s + p[0], 0) / (chiapasRing.length - 1);
      const chiapasAvgLat =
        chiapasRing.slice(0, -1).reduce((s, p) => s + p[1], 0) / (chiapasRing.length - 1);
      expect(chiapasAvgLon).toBeCloseTo(-92.7, 2);
      expect(chiapasAvgLat).toBeCloseTo(16.7, 2);

      const cdmxFeat = collections.state.features.find((f) => f.id === "09");
      expect(cdmxFeat).toBeDefined();
      // Must use centroid [-99.14, 19.35]
      const cdmxRing = cdmxFeat!.geometry.coordinates[0];
      const cdmxAvgLon =
        cdmxRing.slice(0, -1).reduce((s, p) => s + p[0], 0) / (cdmxRing.length - 1);
      const cdmxAvgLat =
        cdmxRing.slice(0, -1).reduce((s, p) => s + p[1], 0) / (cdmxRing.length - 1);
      expect(cdmxAvgLon).toBeCloseTo(-99.14, 2);
      expect(cdmxAvgLat).toBeCloseTo(19.35, 2);

      // Mun features: Tuxtla Gutiérrez (1 feature, omitted "Sin Coordenadas")
      expect(collections.mun.features).toHaveLength(1);
      const tuxtlaFeat = collections.mun.features[0];
      expect(tuxtlaFeat.id).toBe("07101");
      expect(tuxtlaFeat.properties.level).toBe("mun");
      expect(tuxtlaFeat.properties.name).toBe("Tuxtla Gutiérrez");

      // Omitted item must not appear in any collection
      expect(collections.mun.features.some((f) => f.id === "99999")).toBe(false);
      expect(collections.state.features.some((f) => f.id === "99999")).toBe(false);
    });

    it("handles empty or invalid item lists gracefully without throwing", () => {
      const empty1 = buildColumnCollections([]);
      expect(empty1.state.features).toHaveLength(0);
      expect(empty1.mun.features).toHaveLength(0);

      const empty2 = buildColumnCollections(null as any);
      expect(empty2.state.features).toHaveLength(0);
      expect(empty2.mun.features).toHaveLength(0);
    });
  });
});
