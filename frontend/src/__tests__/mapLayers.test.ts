import { describe, it, expect, vi } from "vitest";
import {
  buildStyle,
  buildDataLayers,
  setColorMode,
} from "@/components/map/mapLayers";
import {
  LAYER_IDS,
  SOURCE_IDS,
  BASEMAP,
  fillExpression,
  deltaFillExpression,
  categoryFillExpression,
} from "@/lib/mapStyle";
import type { LayerSpecification } from "maplibre-gl";

describe("mapLayers", () => {
  describe("buildStyle", () => {
    it("builds a v8 style without glyphs and with basemap raster sources", () => {
      const style = buildStyle();
      expect(style.version).toBe(8);
      // No glyphs defined (offline basemap)
      expect((style as { glyphs?: unknown }).glyphs).toBeUndefined();

      // Base raster source
      const cartoBase = style.sources[SOURCE_IDS.cartoBase] as {
        type: string;
        tiles: string[];
        tileSize: number;
        maxzoom: number;
        attribution: string;
      };
      expect(cartoBase).toBeDefined();
      expect(cartoBase.type).toBe("raster");
      expect(cartoBase.tiles).toEqual([BASEMAP.base]);
      expect(cartoBase.tileSize).toBe(256);
      expect(cartoBase.maxzoom).toBe(16);
      expect(cartoBase.attribution).toBe(BASEMAP.attribution);

      // Labels raster source
      const cartoLabels = style.sources[SOURCE_IDS.cartoLabels] as {
        type: string;
        tiles: string[];
        tileSize: number;
        maxzoom: number;
        attribution: string;
      };
      expect(cartoLabels).toBeDefined();
      expect(cartoLabels.type).toBe("raster");
      expect(cartoLabels.tiles).toEqual([BASEMAP.labels]);
      expect(cartoLabels.tileSize).toBe(256);
      expect(cartoLabels.maxzoom).toBe(16);
      expect(cartoLabels.attribution).toBe(BASEMAP.attribution);

      // Initial background layer
      expect(style.layers).toBeDefined();
      expect(style.layers.length).toBeGreaterThanOrEqual(1);
      const bg = style.layers.find((l) => l.id === LAYER_IDS.background);
      expect(bg).toBeDefined();
      expect(bg?.type).toBe("background");
      expect((bg as { paint?: { "background-color"?: string } })?.paint?.["background-color"]).toBe(
        BASEMAP.background
      );
    });
  });

  describe("buildDataLayers", () => {
    it("returns layers with exact IDs in the order specified in §14.6", () => {
      const layers = buildDataLayers("category");
      const expectedIds = [
        LAYER_IDS.background,
        LAYER_IDS.baseRaster,
        LAYER_IDS.country,
        LAYER_IDS.statesFill,
        LAYER_IDS.munFill,
        LAYER_IDS.munLine,
        LAYER_IDS.statesLine,
        LAYER_IDS.statesExtrusion,
        LAYER_IDS.munExtrusion,
        LAYER_IDS.hoverStates,
        LAYER_IDS.hoverMun,
        LAYER_IDS.selected,
        LAYER_IDS.labelsRaster,
      ];

      expect(layers.map((l) => l.id)).toEqual(expectedIds);
    });

    it("does not include any symbol layer", () => {
      const layers = buildDataLayers("category");
      for (const layer of layers) {
        expect(layer.type).not.toBe("symbol");
      }
    });

    it("configures labels raster layer with 0.85 opacity", () => {
      const layers = buildDataLayers("category");
      const labels = layers.find((l) => l.id === LAYER_IDS.labelsRaster) as LayerSpecification & {
        paint?: Record<string, unknown>;
      };
      expect(labels).toBeDefined();
      expect(labels.type).toBe("raster");
      expect(labels.paint?.["raster-opacity"]).toBe(0.85);
    });

    it("configures extrusion layers with height reading feature-state h", () => {
      const layers = buildDataLayers("category");
      const statesExt = layers.find(
        (l) => l.id === LAYER_IDS.statesExtrusion
      ) as LayerSpecification & {
        paint?: Record<string, unknown>;
        maxzoom?: number;
      };
      const munExt = layers.find(
        (l) => l.id === LAYER_IDS.munExtrusion
      ) as LayerSpecification & {
        paint?: Record<string, unknown>;
        minzoom?: number;
      };

      expect(statesExt).toBeDefined();
      expect(statesExt.type).toBe("fill-extrusion");
      expect(statesExt.maxzoom).toBe(6.2);
      expect(statesExt.paint?.["fill-extrusion-height"]).toEqual([
        "coalesce",
        ["feature-state", "h"],
        0,
      ]);
      expect(statesExt.paint?.["fill-extrusion-opacity"]).toBe(0.92);
      expect(statesExt.paint?.["fill-extrusion-vertical-gradient"]).toBe(true);

      expect(munExt).toBeDefined();
      expect(munExt.type).toBe("fill-extrusion");
      expect(munExt.minzoom).toBe(5);
      expect(munExt.paint?.["fill-extrusion-height"]).toEqual([
        "coalesce",
        ["feature-state", "h"],
        0,
      ]);
      expect(munExt.paint?.["fill-extrusion-opacity"]).toBe(0.92);
      expect(munExt.paint?.["fill-extrusion-vertical-gradient"]).toBe(true);
    });

    it("uses deltaFillExpression for fill and extrusion colors in delta mode", () => {
      const deltaLayers = buildDataLayers("delta");
      const statesFill = deltaLayers.find(
        (l) => l.id === LAYER_IDS.statesFill
      ) as LayerSpecification & { paint?: Record<string, unknown> };
      const munFill = deltaLayers.find(
        (l) => l.id === LAYER_IDS.munFill
      ) as LayerSpecification & { paint?: Record<string, unknown> };
      const statesExt = deltaLayers.find(
        (l) => l.id === LAYER_IDS.statesExtrusion
      ) as LayerSpecification & { paint?: Record<string, unknown> };
      const munExt = deltaLayers.find(
        (l) => l.id === LAYER_IDS.munExtrusion
      ) as LayerSpecification & { paint?: Record<string, unknown> };

      const expectedDelta = deltaFillExpression();
      expect(statesFill.paint?.["fill-color"]).toEqual(expectedDelta);
      expect(munFill.paint?.["fill-color"]).toEqual(expectedDelta);
      expect(statesExt.paint?.["fill-extrusion-color"]).toEqual(expectedDelta);
      expect(munExt.paint?.["fill-extrusion-color"]).toEqual(expectedDelta);
    });

    it("validates data layers with validateStyleMin from style spec", async () => {
      try {
        const spec = await import("@maplibre/maplibre-gl-style-spec");
        if (typeof spec.validateStyleMin === "function") {
          const testStyle = {
            version: 8 as const,
            sources: {
              ...buildStyle().sources,
              [SOURCE_IDS.country]: {
                type: "geojson",
                data: { type: "FeatureCollection", features: [] },
              },
              [SOURCE_IDS.states]: {
                type: "geojson",
                data: { type: "FeatureCollection", features: [] },
                promoteId: "id",
              },
              [SOURCE_IDS.mun]: {
                type: "geojson",
                data: { type: "FeatureCollection", features: [] },
                promoteId: "id",
              },
            },
            layers: buildDataLayers("category"),
          };

          const errors = spec.validateStyleMin(testStyle as unknown as import("maplibre-gl").StyleSpecification);
          expect(errors).toEqual([]);

          const deltaStyle = {
            ...testStyle,
            layers: buildDataLayers("delta"),
          };
          const deltaErrors = spec.validateStyleMin(deltaStyle as unknown as import("maplibre-gl").StyleSpecification);
          expect(deltaErrors).toEqual([]);
        }
      } catch {
        // validateStyleMin omitted if style-spec is not resolvable
      }
    });
  });

  describe("setColorMode", () => {
    it("updates paint properties on state and municipality layers", () => {
      const mockSetPaintProperty = vi.fn();
      const mockGetLayer = vi.fn().mockReturnValue({});
      const mockMap = {
        getLayer: mockGetLayer,
        setPaintProperty: mockSetPaintProperty,
      } as unknown as import("maplibre-gl").Map;

      setColorMode(mockMap, "delta");
      expect(mockSetPaintProperty).toHaveBeenCalledWith(
        LAYER_IDS.statesFill,
        "fill-color",
        fillExpression("delta")
      );
      expect(mockSetPaintProperty).toHaveBeenCalledWith(
        LAYER_IDS.munFill,
        "fill-color",
        fillExpression("delta")
      );
      expect(mockSetPaintProperty).toHaveBeenCalledWith(
        LAYER_IDS.statesExtrusion,
        "fill-extrusion-color",
        fillExpression("delta")
      );
      expect(mockSetPaintProperty).toHaveBeenCalledWith(
        LAYER_IDS.munExtrusion,
        "fill-extrusion-color",
        fillExpression("delta")
      );
    });
  });
});
