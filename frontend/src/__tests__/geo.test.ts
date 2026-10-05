import { describe, it, expect } from "vitest";
import {
  toIndexItems,
  colorForFeature,
  fetchStatesGeoJson,
  fetchMunGeoJson,
  fetchGeoIndex,
} from "../lib/geo";
import {
  getMockStatesGeoJson,
  getMockMunGeoJson,
  getMockGeoIndexFile,
  getMockGeoIndex,
} from "../lib/mocks/geo";
import { CATEGORY_COLORS } from "../lib/format";
import type { GeoIndexFile, RiskItem } from "../lib/types";

describe("Geo Adapter and Contract Tests", () => {
  it("adapts pipeline GeoIndexFile object into flat GeoIndexItem array", () => {
    const rawFixture: GeoIndexFile = {
      states: {
        "07": {
          name: "Chiapas",
          bbox: [-94.1, 14.5, -90.3, 17.9],
          centroid: [-92.5, 16.5],
        },
        "09": {
          name: "Ciudad de México",
          bbox: [-99.3, 19.0, -98.9, 19.6],
          centroid: [-99.14, 19.35],
        },
      },
      mun: {
        "07101": {
          name: "Tuxtla Gutiérrez",
          ent: "07",
          centroid: [-93.1, 16.7],
        },
        "09003": {
          name: "Coyoacán",
          ent: "09",
          centroid: [-99.16, 19.35],
        },
      },
    };

    const items = toIndexItems(rawFixture);
    expect(items).toHaveLength(4);

    const chiapas = items.find((i) => i.id === "07");
    expect(chiapas).toBeDefined();
    expect(chiapas?.level).toBe("state");
    expect(chiapas?.name).toBe("Chiapas");
    expect(chiapas?.ent).toBe("07");
    expect(chiapas?.bbox).toEqual([-94.1, 14.5, -90.3, 17.9]);
    expect(chiapas?.centroid).toEqual([-92.5, 16.5]);

    const tuxtla = items.find((i) => i.id === "07101");
    expect(tuxtla).toBeDefined();
    expect(tuxtla?.level).toBe("mun");
    expect(tuxtla?.name).toBe("Tuxtla Gutiérrez");
    expect(tuxtla?.ent).toBe("07");
    expect(tuxtla?.centroid).toEqual([-93.1, 16.7]);
  });

  it("colors pipeline features correctly using colorForFeature pure function", () => {
    // Inline pipeline features conforming strictly to tools/geo/build_geo.mjs output
    const stateFeature = {
      type: "Feature" as const,
      properties: { id: "07", name: "Chiapas" },
      geometry: { type: "Polygon" as const, coordinates: [] },
    };

    const munFeature = {
      type: "Feature" as const,
      properties: { id: "07101", ent: "07", name: "Tuxtla Gutiérrez" },
      geometry: { type: "Polygon" as const, coordinates: [] },
    };

    const missingFeature = {
      type: "Feature" as const,
      properties: { id: "99999", ent: "99", name: "Inexistente" },
      geometry: { type: "Polygon" as const, coordinates: [] },
    };

    const itemsById = new Map<string, RiskItem>();
    itemsById.set("07", {
      id: "07",
      name: "Chiapas",
      level: "state",
      ent: "07",
      lista_nominal: 3800000,
      last_year: 2024,
      last_participation: 0.52,
      pred_participation: 0.48,
      pred_abstention: 0.52,
      pred_low: 0.49,
      pred_high: 0.55,
      trend_pp: -1.2,
      risk_score: 82.5,
      category: "rojo",
    });

    itemsById.set("07101", {
      id: "07101",
      name: "Tuxtla Gutiérrez",
      level: "mun",
      ent: "07",
      lista_nominal: 420000,
      last_year: 2024,
      last_participation: 0.65,
      pred_participation: 0.66,
      pred_abstention: 0.34,
      pred_low: 0.31,
      pred_high: 0.37,
      trend_pp: 0.8,
      risk_score: 28.0,
      category: "verde",
    });

    // Verify correct color resolution
    expect(colorForFeature(stateFeature, itemsById)).toBe(CATEGORY_COLORS.rojo);
    expect(colorForFeature(munFeature, itemsById)).toBe(CATEGORY_COLORS.verde);
    // Unmapped/missing feature defaults to sin_dato
    expect(colorForFeature(missingFeature, itemsById)).toBe(CATEGORY_COLORS.sin_dato);
    // Null feature defaults to sin_dato
    expect(colorForFeature(null, itemsById)).toBe(CATEGORY_COLORS.sin_dato);
  });

  it("ensures mock geo produces exact pipeline schema with id/name/ent properties", () => {
    const statesGeo = getMockStatesGeoJson();
    expect(statesGeo.features.length).toBe(32);

    for (const feat of statesGeo.features) {
      expect(feat.properties).toHaveProperty("id");
      expect(feat.properties).toHaveProperty("name");
      expect((feat.properties as any).cve_ent).toBeUndefined();
      expect((feat.properties as any).nom_ent).toBeUndefined();
    }

    const munGeo = getMockMunGeoJson("07");
    expect(munGeo.features.length).toBeGreaterThan(0);

    for (const feat of munGeo.features) {
      expect(feat.properties).toHaveProperty("id");
      expect(feat.properties).toHaveProperty("ent");
      expect(feat.properties).toHaveProperty("name");
      expect(feat.properties.ent).toBe("07");
      expect((feat.properties as any).cvegeo).toBeUndefined();
      expect((feat.properties as any).nom_mun).toBeUndefined();
    }
  });

  it("ensures getMockGeoIndex uses toIndexItems over getMockGeoIndexFile", () => {
    const rawFile = getMockGeoIndexFile();
    expect(rawFile).toHaveProperty("states");
    expect(rawFile).toHaveProperty("mun");
    expect(rawFile.states["07"]).toBeDefined();
    expect(rawFile.states["07"].name).toBe("Chiapas");

    const indexItems = getMockGeoIndex();
    expect(Array.isArray(indexItems)).toBe(true);
    expect(indexItems.length).toBeGreaterThan(32);

    const chiapas = indexItems.find((i) => i.id === "07");
    expect(chiapas?.level).toBe("state");
    expect(chiapas?.name).toBe("Chiapas");
  });
});
