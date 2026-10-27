import { describe, it, expect, vi } from "vitest";
import {
  buildStyle,
  buildDataLayers,
  buildSources,
  setColorMode,
  setExtrusionVisible,
  setExtrusionFocus,
} from "@/components/map/mapLayers";
import {
  LAYER_IDS,
  SOURCE_IDS,
  SOURCE_LAYERS,
  BASEMAP,
  fillExpression,
  extrusionColorExpression,
  extrusionHeightExpression,
  EXTRUSION_ZOOM_SPLIT,
} from "@/lib/mapStyle";
import type {
  LayerSpecification,
  VectorSourceSpecification,
  FillLayerSpecification,
  FillExtrusionLayerSpecification,
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
      expect(Object.keys(sources).sort()).toEqual([SOURCE_IDS.country, SOURCE_IDS.vector].sort());
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
      expect(Object.keys(sources).sort()).toEqual(
        [SOURCE_IDS.country, SOURCE_IDS.states, SOURCE_IDS.mun].sort()
      );
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
    it("returns layers with exact IDs in the expected order including states-extrusion and mun-extrusion", () => {
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

    it("positions states-extrusion (maxzoom 5.5) and mun-extrusion (minzoom 5.5, filter by ent) between states-line and states-hover", () => {
      const layers = buildDataLayers("category", "geojson");

      const statesLineIdx = layers.findIndex((l) => l.id === LAYER_IDS.statesLine);
      const statesExtIdx = layers.findIndex((l) => l.id === LAYER_IDS.statesExtrusion);
      const munExtIdx = layers.findIndex((l) => l.id === LAYER_IDS.munExtrusion);
      const statesHoverIdx = layers.findIndex((l) => l.id === LAYER_IDS.hoverStates);

      expect(statesLineIdx).toBeGreaterThan(-1);
      expect(statesExtIdx).toBe(statesLineIdx + 1);
      expect(munExtIdx).toBe(statesExtIdx + 1);
      expect(statesHoverIdx).toBe(munExtIdx + 1);

      const statesExt = layers[statesExtIdx] as FillExtrusionLayerSpecification;
      expect(statesExt.type).toBe("fill-extrusion");
      expect(statesExt.source).toBe(SOURCE_IDS.states);
      expect(statesExt.maxzoom).toBe(EXTRUSION_ZOOM_SPLIT);
      expect(statesExt.layout?.visibility).toBe("none");
      expect(statesExt.paint?.["fill-extrusion-height"]).toEqual(
        extrusionHeightExpression("state")
      );
      expect(statesExt.paint?.["fill-extrusion-base"]).toBe(0);
      expect(statesExt.paint?.["fill-extrusion-opacity"]).toBe(0.92);
      expect(statesExt.paint?.["fill-extrusion-vertical-gradient"]).toBe(true);

      const munExt = layers[munExtIdx] as FillExtrusionLayerSpecification;
      expect(munExt.type).toBe("fill-extrusion");
      expect(munExt.source).toBe(SOURCE_IDS.mun);
      expect(munExt.minzoom).toBe(EXTRUSION_ZOOM_SPLIT);
      expect(munExt.filter).toEqual(["==", ["get", "ent"], ""]);
      expect(munExt.layout?.visibility).toBe("none");
      expect(munExt.paint?.["fill-extrusion-height"]).toEqual(
        extrusionHeightExpression("mun")
      );
      expect(munExt.paint?.["fill-extrusion-base"]).toBe(0);
      expect(munExt.paint?.["fill-extrusion-opacity"]).toBe(0.92);
      expect(munExt.paint?.["fill-extrusion-vertical-gradient"]).toBe(true);
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
      expect(stateLine.paint?.["line-color"]).toBe("#b5186b");
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
      const stateExtVector = vectorLayers.find(
        (l) => l.id === LAYER_IDS.statesExtrusion
      ) as FillExtrusionLayerSpecification;
      const munExtVector = vectorLayers.find(
        (l) => l.id === LAYER_IDS.munExtrusion
      ) as FillExtrusionLayerSpecification;

      expect(stateFillVector["source-layer"]).toBe(SOURCE_LAYERS.states);
      expect(munFillVector["source-layer"]).toBe(SOURCE_LAYERS.mun);
      expect(stateExtVector["source-layer"]).toBe(SOURCE_LAYERS.states);
      expect(munExtVector["source-layer"]).toBe(SOURCE_LAYERS.mun);
      expect(stateFillVector.source).toBe(SOURCE_IDS.vector);
      expect(munFillVector.source).toBe(SOURCE_IDS.vector);
      expect(stateExtVector.source).toBe(SOURCE_IDS.vector);
      expect(munExtVector.source).toBe(SOURCE_IDS.vector);

      const stateFillGeo = geojsonLayers.find(
        (l) => l.id === LAYER_IDS.statesFill
      ) as FillLayerSpecification;
      const munFillGeo = geojsonLayers.find(
        (l) => l.id === LAYER_IDS.munFill
      ) as FillLayerSpecification;
      const stateExtGeo = geojsonLayers.find(
        (l) => l.id === LAYER_IDS.statesExtrusion
      ) as FillExtrusionLayerSpecification;
      const munExtGeo = geojsonLayers.find(
        (l) => l.id === LAYER_IDS.munExtrusion
      ) as FillExtrusionLayerSpecification;

      expect(stateFillGeo["source-layer"]).toBeUndefined();
      expect(munFillGeo["source-layer"]).toBeUndefined();
      expect(stateExtGeo["source-layer"]).toBeUndefined();
      expect(munExtGeo["source-layer"]).toBeUndefined();
      expect(stateFillGeo.source).toBe(SOURCE_IDS.states);
      expect(munFillGeo.source).toBe(SOURCE_IDS.mun);
      expect(stateExtGeo.source).toBe(SOURCE_IDS.states);
      expect(munExtGeo.source).toBe(SOURCE_IDS.mun);
    });

    it("does not include any symbol layer", () => {
      const layers = buildDataLayers("category");
      for (const layer of layers) {
        expect(layer.type).not.toBe("symbol");
      }
    });

    it("configures readable municipal boundaries with interpolated line-opacity and line-width", () => {
      const layers = buildDataLayers("category");
      const munLine = layers.find(
        (l) => l.id === LAYER_IDS.munLine
      ) as LayerSpecification & {
        minzoom?: number;
        paint?: Record<string, unknown>;
      };
      expect(munLine).toBeDefined();
      expect(munLine.type).toBe("line");
      expect(munLine.minzoom).toBe(5);
      expect(munLine.paint?.["line-color"]).toBe("rgba(255,255,255,0.7)");
      expect(munLine.paint?.["line-opacity"]).toEqual([
        "interpolate",
        ["linear"],
        ["zoom"],
        5,
        0.15,
        7,
        0.35,
        9,
        0.55,
        12,
        0.7,
      ]);
      expect(munLine.paint?.["line-width"]).toEqual([
        "interpolate",
        ["linear"],
        ["zoom"],
        5,
        0.2,
        9,
        0.6,
        12,
        1.2,
      ]);
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

    it("uses extrusionColorExpression for extrusion layers", () => {
      for (const mode of ["category", "delta"] as const) {
        const layers = buildDataLayers(mode);
        const stateExt = layers.find(
          (l) => l.id === LAYER_IDS.statesExtrusion
        ) as LayerSpecification & { paint?: Record<string, unknown> };
        const munExt = layers.find(
          (l) => l.id === LAYER_IDS.munExtrusion
        ) as LayerSpecification & { paint?: Record<string, unknown> };

        const expectedColor = extrusionColorExpression(mode);
        expect(stateExt.paint?.["fill-extrusion-color"]).toEqual(expectedColor);
        expect(munExt.paint?.["fill-extrusion-color"]).toEqual(expectedColor);
      }
    });
  });

  describe("setColorMode", () => {
    it("updates paint properties on state and municipality fills and extrusion layers", () => {
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
        extrusionColorExpression("delta")
      );
      expect(mockSetPaintProperty).toHaveBeenCalledWith(
        LAYER_IDS.munExtrusion,
        "fill-extrusion-color",
        extrusionColorExpression("delta")
      );
    });
  });

  describe("setExtrusionVisible", () => {
    it("toggles visibility layout property on state and municipal extrusion layers", () => {
      const mockSetLayoutProperty = vi.fn();
      const mockGetLayer = vi.fn().mockReturnValue({});
      const mockMap = {
        getLayer: mockGetLayer,
        setLayoutProperty: mockSetLayoutProperty,
      } as unknown as import("maplibre-gl").Map;

      setExtrusionVisible(mockMap, true);
      expect(mockSetLayoutProperty).toHaveBeenCalledWith(
        LAYER_IDS.statesExtrusion,
        "visibility",
        "visible"
      );
      expect(mockSetLayoutProperty).toHaveBeenCalledWith(
        LAYER_IDS.munExtrusion,
        "visibility",
        "visible"
      );

      setExtrusionVisible(mockMap, false);
      expect(mockSetLayoutProperty).toHaveBeenCalledWith(
        LAYER_IDS.statesExtrusion,
        "visibility",
        "none"
      );
      expect(mockSetLayoutProperty).toHaveBeenCalledWith(
        LAYER_IDS.munExtrusion,
        "visibility",
        "none"
      );
    });

    it("does not throw when map is null or lacks layers", () => {
      expect(() => setExtrusionVisible(null as any, true)).not.toThrow();

      const mockMapMissingLayers = {
        getLayer: vi.fn().mockReturnValue(null),
        setLayoutProperty: vi.fn(),
      } as unknown as import("maplibre-gl").Map;

      expect(() => setExtrusionVisible(mockMapMissingLayers, true)).not.toThrow();
    });
  });

  describe("setExtrusionFocus", () => {
    it("applies filter to mun-extrusion layer matching focused state ent", () => {
      const mockSetFilter = vi.fn();
      const mockGetLayer = vi.fn().mockReturnValue({});
      const mockMap = {
        getLayer: mockGetLayer,
        setFilter: mockSetFilter,
      } as unknown as import("maplibre-gl").Map;

      setExtrusionFocus(mockMap, "07");
      expect(mockSetFilter).toHaveBeenCalledTimes(1);
      expect(mockSetFilter).toHaveBeenCalledWith(LAYER_IDS.munExtrusion, [
        "==",
        ["get", "ent"],
        "07",
      ]);
    });

    it("does not call setFilter if ent has not changed", () => {
      const mockSetFilter = vi.fn();
      const mockGetLayer = vi.fn().mockReturnValue({});
      const mockMap = {
        getLayer: mockGetLayer,
        setFilter: mockSetFilter,
      } as unknown as import("maplibre-gl").Map;

      setExtrusionFocus(mockMap, "14");
      expect(mockSetFilter).toHaveBeenCalledTimes(1);

      // Same ent again: must NOT call setFilter
      setExtrusionFocus(mockMap, "14");
      expect(mockSetFilter).toHaveBeenCalledTimes(1);

      // Different ent: calls setFilter
      setExtrusionFocus(mockMap, "15");
      expect(mockSetFilter).toHaveBeenCalledTimes(2);
      expect(mockSetFilter).toHaveBeenCalledWith(LAYER_IDS.munExtrusion, [
        "==",
        ["get", "ent"],
        "15",
      ]);
    });

    it("resets filter when ent is null", () => {
      const mockSetFilter = vi.fn();
      const mockGetLayer = vi.fn().mockReturnValue({});
      const mockMap = {
        getLayer: mockGetLayer,
        setFilter: mockSetFilter,
      } as unknown as import("maplibre-gl").Map;

      setExtrusionFocus(mockMap, "09");
      expect(mockSetFilter).toHaveBeenCalledTimes(1);

      setExtrusionFocus(mockMap, null);
      expect(mockSetFilter).toHaveBeenCalledTimes(2);
      expect(mockSetFilter).toHaveBeenCalledWith(LAYER_IDS.munExtrusion, [
        "==",
        ["get", "ent"],
        "",
      ]);

      // null again: cached as "", must not call setFilter again
      setExtrusionFocus(mockMap, null);
      expect(mockSetFilter).toHaveBeenCalledTimes(2);
    });

    it("does not throw when map is null or lacks layers", () => {
      expect(() => setExtrusionFocus(null as any, "01")).not.toThrow();

      const mockMapMissingLayers = {
        getLayer: vi.fn().mockReturnValue(null),
        setFilter: vi.fn(),
      } as unknown as import("maplibre-gl").Map;

      expect(() => setExtrusionFocus(mockMapMissingLayers, "01")).not.toThrow();
    });
  });
});
