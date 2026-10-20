import { describe, it, expect, vi } from "vitest";
import {
  buildStyle,
  buildDataLayers,
  buildSources,
  setColorMode,
} from "@/components/map/mapLayers";
import {
  LAYER_IDS,
  SOURCE_IDS,
  SOURCE_LAYERS,
  BASEMAP,
  fillExpression,
  deltaFillExpression,
} from "@/lib/mapStyle";
import type {
  LayerSpecification,
  VectorSourceSpecification,
  FillLayerSpecification,
} from "maplibre-gl";
import type { TileManifest } from "@/lib/types";

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
      expect(
        (bg as { paint?: { "background-color"?: string } })?.paint?.[
          "background-color"
        ]
      ).toBe(BASEMAP.background);
    });
  });

  describe("buildSources", () => {
    it("builds vector sources with promoteId and absolute tile URL", () => {
      const fakeManifest: TileManifest = {
        tilejson: "3.0.0",
        tiles: ["/geo/tiles/{z}/{x}/{y}.pbf"],
        minzoom: 3,
        maxzoom: 9,
        bounds: [-118.6, 14.3, -86.5, 32.8],
        vector_layers: [
          { id: "states", minzoom: 3, maxzoom: 9 },
          { id: "mun", minzoom: 5, maxzoom: 9 },
        ],
      };

      const sources = buildSources("vector", fakeManifest, null);
      expect(sources[SOURCE_IDS.country]).toBeDefined();
      expect(sources[SOURCE_IDS.country].type).toBe("geojson");

      const vectorSource = sources[
        SOURCE_IDS.vector
      ] as VectorSourceSpecification;
      expect(vectorSource).toBeDefined();
      expect(vectorSource.type).toBe("vector");
      expect(vectorSource.minzoom).toBe(3);
      expect(vectorSource.maxzoom).toBe(9);
      expect(vectorSource.promoteId).toEqual({ states: "id", mun: "id" });
      expect(vectorSource.tiles).toBeDefined();
      expect(vectorSource.tiles?.[0]).toMatch(/^https?:\/\//);
      expect(vectorSource.tiles?.[0]).toContain("{z}/{x}/{y}.pbf");
    });

    it("builds GeoJSON sources with promoteId in geojson mode", () => {
      const sources = buildSources("geojson", null, null);
      expect(sources[SOURCE_IDS.country].type).toBe("geojson");
      expect(sources[SOURCE_IDS.states].type).toBe("geojson");
      expect(
        (sources[SOURCE_IDS.states] as { promoteId?: string }).promoteId
      ).toBe("id");
      expect(sources[SOURCE_IDS.mun].type).toBe("geojson");
      expect((sources[SOURCE_IDS.mun] as { promoteId?: string }).promoteId).toBe(
        "id"
      );
    });
  });

  describe("buildDataLayers", () => {
    it("returns layers with exact IDs in the expected order including states-selected-line", () => {
      const layers = buildDataLayers("category", "geojson");
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
        LAYER_IDS.selectedStates,
        LAYER_IDS.labelsRaster,
      ];

      expect(layers.map((l) => l.id)).toEqual(expectedIds);
    });

    it("configures states-selected-line layer right after selected-line with 3px line", () => {
      const layers = buildDataLayers("category", "geojson");
      const selectedIndex = layers.findIndex((l) => l.id === LAYER_IDS.selected);
      const selectedStatesIndex = layers.findIndex(
        (l) => l.id === LAYER_IDS.selectedStates
      );
      expect(selectedStatesIndex).toBe(selectedIndex + 1);

      const stateLine = layers[selectedStatesIndex] as LayerSpecification & {
        paint?: Record<string, unknown>;
      };
      expect(stateLine.type).toBe("line");
      expect(stateLine.paint?.["line-color"]).toBe("#ffffff");
      expect(stateLine.paint?.["line-width"]).toEqual([
        "case",
        ["boolean", ["feature-state", "selected"], false],
        3,
        0,
      ]);
    });

    it("assigns source-layer only in vector mode", () => {
      const vectorLayers = buildDataLayers("category", "vector");
      const geojsonLayers = buildDataLayers("category", "geojson");

      const stateFillVector = vectorLayers.find(
        (l) => l.id === LAYER_IDS.statesFill
      ) as FillLayerSpecification;
      const munFillVector = vectorLayers.find(
        (l) => l.id === LAYER_IDS.munFill
      ) as FillLayerSpecification;

      expect(stateFillVector["source-layer"]).toBe(SOURCE_LAYERS.states);
      expect(munFillVector["source-layer"]).toBe(SOURCE_LAYERS.mun);
      expect(stateFillVector.source).toBe(SOURCE_IDS.vector);
      expect(munFillVector.source).toBe(SOURCE_IDS.vector);

      const stateFillGeo = geojsonLayers.find(
        (l) => l.id === LAYER_IDS.statesFill
      ) as FillLayerSpecification;
      const munFillGeo = geojsonLayers.find(
        (l) => l.id === LAYER_IDS.munFill
      ) as FillLayerSpecification;

      expect(stateFillGeo["source-layer"]).toBeUndefined();
      expect(munFillGeo["source-layer"]).toBeUndefined();
      expect(stateFillGeo.source).toBe(SOURCE_IDS.states);
      expect(munFillGeo.source).toBe(SOURCE_IDS.mun);
    });

    it("does not include any symbol layer", () => {
      const layers = buildDataLayers("category");
      for (const layer of layers) {
        expect(layer.type).not.toBe("symbol");
      }
    });

    it("configures labels raster layer with 0.85 opacity", () => {
      const layers = buildDataLayers("category");
      const labels = layers.find(
        (l) => l.id === LAYER_IDS.labelsRaster
      ) as LayerSpecification & {
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
