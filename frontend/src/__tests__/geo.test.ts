import { describe, it, expect, vi } from "vitest";
import {
  toIndexItems,
  colorForFeature,
  fetchStatesGeoJson,
  fetchMunGeoJson,
  fetchGeoIndex,
  fetchMunAllGeoJson,
  fetchCountryGeoJson,
  getMockMunAllGeoJson,
  fetchTileManifest,
  absoluteTileUrl,
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

  it("loads national mock municipalities with fetchMunAllGeoJson", async () => {
    const munAll = await fetchMunAllGeoJson();
    expect(munAll.type).toBe("FeatureCollection");
    expect(munAll.features.length).toBeGreaterThan(100);

    const statesInMunAll = new Set(munAll.features.map((f) => f.properties.ent));
    expect(statesInMunAll.size).toBe(32);

    for (const feat of munAll.features) {
      expect(feat.properties.id).toMatch(/^\d{5}$/);
      expect(feat.properties.ent).toHaveLength(2);
      expect(feat.properties.name).toBeDefined();
    }
  });

  it("handles fetchCountryGeoJson gracefully (returns null in mock mode)", async () => {
    // In node/mock mode without static files, it falls back to null
    const country = await fetchCountryGeoJson();
    // Either null or valid FeatureCollection
    if (country !== null) {
      expect(country.type).toBe("FeatureCollection");
    } else {
      expect(country).toBeNull();
    }
  });

  describe("Tile Manifest and URL Helpers", () => {
    it("preserves unencoded {z}/{x}/{y} in absoluteTileUrl", () => {
      const url = absoluteTileUrl(
        "/geo/tiles/{z}/{x}/{y}.pbf",
        "http://localhost:3000"
      );
      expect(url).toBe("http://localhost:3000/geo/tiles/{z}/{x}/{y}.pbf");
      expect(url).not.toContain("%7B");
      expect(url).not.toContain("%7D");

      const defaultUrl = absoluteTileUrl("/geo/tiles/{z}/{x}/{y}.pbf");
      expect(defaultUrl).toContain("{z}/{x}/{y}.pbf");
      expect(defaultUrl).toMatch(/^https?:\/\//);
    });

    it("validates valid tile manifest with fetchTileManifest", async () => {
      const validManifest = {
        tilejson: "3.0.0",
        tiles: ["/geo/tiles/{z}/{x}/{y}.pbf"],
        minzoom: 3,
        maxzoom: 9,
        vector_layers: [
          { id: "states", minzoom: 3, maxzoom: 9 },
          { id: "mun", minzoom: 5, maxzoom: 9 },
        ],
      };

      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => validManifest,
      } as Response);

      const result = await fetchTileManifest();
      expect(result).toEqual(validManifest);
      fetchSpy.mockRestore();
    });

    it("returns null if manifest lacks mun layer", async () => {
      const manifestWithoutMun = {
        tilejson: "3.0.0",
        tiles: ["/geo/tiles/{z}/{x}/{y}.pbf"],
        minzoom: 3,
        maxzoom: 9,
        vector_layers: [{ id: "states", minzoom: 3, maxzoom: 9 }],
      };

      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => manifestWithoutMun,
      } as Response);

      const result = await fetchTileManifest();
      expect(result).toBeNull();
      fetchSpy.mockRestore();
    });

    it("returns null if manifest lacks {z} in tile URL", async () => {
      const manifestWithoutZ = {
        tilejson: "3.0.0",
        tiles: ["/geo/tiles/{x}/{y}.pbf"],
        minzoom: 3,
        maxzoom: 9,
        vector_layers: [
          { id: "states", minzoom: 3, maxzoom: 9 },
          { id: "mun", minzoom: 5, maxzoom: 9 },
        ],
      };

      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => manifestWithoutZ,
      } as Response);

      const result = await fetchTileManifest();
      expect(result).toBeNull();
      fetchSpy.mockRestore();
    });

    it("returns null when fetch fails or errors", async () => {
      const fetchSpy404 = vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 404,
      } as Response);

      const result404 = await fetchTileManifest();
      expect(result404).toBeNull();
      fetchSpy404.mockRestore();

      const fetchSpyReject = vi
        .spyOn(global, "fetch")
        .mockRejectedValueOnce(new Error("Network Error"));
      const resultReject = await fetchTileManifest();
      expect(resultReject).toBeNull();
      fetchSpyReject.mockRestore();
    });
  });
});

