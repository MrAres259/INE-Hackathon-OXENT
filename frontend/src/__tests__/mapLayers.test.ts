import { describe, it, expect, vi } from "vitest";
import {
  buildStyle,
  buildDataLayers,
  buildSources,
  setColorMode,
  setColumnsVisible,
} from "@/components/map/mapLayers";
import {
  LAYER_IDS,
  SOURCE_IDS,
  SOURCE_LAYERS,
  BASEMAP,
  fillExpression,
  columnColorExpression,
  COLUMN_ZOOM_SPLIT,
} from "@/lib/mapStyle";
import type {
  LayerSpecification,
  VectorSourceSpecification,
  GeoJSONSourceSpecification,
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
    it("builds vector sources with promoteId and absolute tile URL, including column sources", () => {
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

      // Column sources must be included in vector mode
      const stateColSource = sources[
        SOURCE_IDS.stateColumns
      ] as GeoJSONSourceSpecification;
      expect(stateColSource).toBeDefined();
      expect(stateColSource.type).toBe("geojson");
      expect((stateColSource as any).promoteId).toBe("id");

      const munColSource = sources[
        SOURCE_IDS.munColumns
      ] as GeoJSONSourceSpecification;
      expect(munColSource).toBeDefined();
      expect(munColSource.type).toBe("geojson");
      expect((munColSource as any).promoteId).toBe("id");
    });

    it("includes both column sources with promoteId 'id' across all modes: vector, geojson, and mock", () => {
      const modes = ["vector", "geojson", "mock"] as const;

      for (const m of modes) {
        const sources = buildSources(m, null, null);
        const stateCol = sources[SOURCE_IDS.stateColumns] as GeoJSONSourceSpecification;
        const munCol = sources[SOURCE_IDS.munColumns] as GeoJSONSourceSpecification;

        expect(stateCol).toBeDefined();
        expect(stateCol.type).toBe("geojson");
        expect((stateCol as any).promoteId).toBe("id");

        expect(munCol).toBeDefined();
        expect(munCol.type).toBe("geojson");
        expect((munCol as any).promoteId).toBe("id");
      }
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
    it("returns layers with exact IDs in the expected order including state-columns and mun-columns", () => {
      const layers = buildDataLayers("category", "geojson");
      const expectedIds = [
        LAYER_IDS.background,
        LAYER_IDS.baseRaster,
        LAYER_IDS.country,
        LAYER_IDS.statesFill,
        LAYER_IDS.munFill,
        LAYER_IDS.munLine,
        LAYER_IDS.statesLine,
        LAYER_IDS.stateColumns,
        LAYER_IDS.munColumns,
        LAYER_IDS.hoverStates,
        LAYER_IDS.hoverMun,
        LAYER_IDS.selected,
        LAYER_IDS.selectedStates,
        LAYER_IDS.labelsRaster,
      ];

      expect(layers.map((l) => l.id)).toEqual(expectedIds);
    });

    it("ensures no fill-extrusion layers exist for polygon sources", () => {
      for (const mode of ["geojson", "vector"] as const) {
        const layers = buildDataLayers("category", mode);
        const extrusions = layers.filter(
          (l): l is FillExtrusionLayerSpecification => l.type === "fill-extrusion"
        );

        // The only extrusion layers allowed are the 3D columns
        expect(extrusions).toHaveLength(2);
        for (const ext of extrusions) {
          expect([LAYER_IDS.stateColumns, LAYER_IDS.munColumns]).toContain(ext.id);
          expect([SOURCE_IDS.stateColumns, SOURCE_IDS.munColumns]).toContain(ext.source);
          // Must not use vector or polygon sources
          expect(ext.source).not.toBe(SOURCE_IDS.vector);
          expect(ext.source).not.toBe(SOURCE_IDS.states);
          expect(ext.source).not.toBe(SOURCE_IDS.mun);
        }
      }
    });

    it("positions state-columns (maxzoom 5.5) and mun-columns (minzoom 5.5) with visibility none between states-line and states-hover", () => {
      const layers = buildDataLayers("category", "geojson");

      const statesLineIdx = layers.findIndex((l) => l.id === LAYER_IDS.statesLine);
      const stateColIdx = layers.findIndex((l) => l.id === LAYER_IDS.stateColumns);
      const munColIdx = layers.findIndex((l) => l.id === LAYER_IDS.munColumns);
      const statesHoverIdx = layers.findIndex((l) => l.id === LAYER_IDS.hoverStates);

      expect(statesLineIdx).toBeGreaterThan(-1);
      expect(stateColIdx).toBe(statesLineIdx + 1);
      expect(munColIdx).toBe(stateColIdx + 1);
      expect(statesHoverIdx).toBe(munColIdx + 1);

      const stateCol = layers[stateColIdx] as FillExtrusionLayerSpecification;
      expect(stateCol.type).toBe("fill-extrusion");
      expect(stateCol.source).toBe(SOURCE_IDS.stateColumns);
      expect(stateCol.maxzoom).toBe(COLUMN_ZOOM_SPLIT);
      expect(stateCol.layout?.visibility).toBe("none");
      expect(stateCol.paint?.["fill-extrusion-height"]).toEqual([
        "coalesce",
        ["feature-state", "h"],
        0,
      ]);
      expect(stateCol.paint?.["fill-extrusion-base"]).toBe(0);
      expect(stateCol.paint?.["fill-extrusion-opacity"]).toBe(0.95);
      expect(stateCol.paint?.["fill-extrusion-vertical-gradient"]).toBe(true);

      const munCol = layers[munColIdx] as FillExtrusionLayerSpecification;
      expect(munCol.type).toBe("fill-extrusion");
      expect(munCol.source).toBe(SOURCE_IDS.munColumns);
      expect(munCol.minzoom).toBe(COLUMN_ZOOM_SPLIT);
      expect(munCol.layout?.visibility).toBe("none");
      expect(munCol.paint?.["fill-extrusion-height"]).toEqual([
        "coalesce",
        ["feature-state", "h"],
        0,
      ]);
      expect(munCol.paint?.["fill-extrusion-base"]).toBe(0);
      expect(munCol.paint?.["fill-extrusion-opacity"]).toBe(0.95);
      expect(munCol.paint?.["fill-extrusion-vertical-gradient"]).toBe(true);
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
      expect(munLine.paint?.["line-color"]).toBe("rgba(226,232,240,1)");
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

    it("uses columnColorExpression for column layers", () => {
      for (const mode of ["category", "delta"] as const) {
        const layers = buildDataLayers(mode);
        const stateCol = layers.find(
          (l) => l.id === LAYER_IDS.stateColumns
        ) as LayerSpecification & { paint?: Record<string, unknown> };
        const munCol = layers.find(
          (l) => l.id === LAYER_IDS.munColumns
        ) as LayerSpecification & { paint?: Record<string, unknown> };

        const expectedColor = columnColorExpression(mode);
        expect(stateCol.paint?.["fill-extrusion-color"]).toEqual(expectedColor);
        expect(munCol.paint?.["fill-extrusion-color"]).toEqual(expectedColor);
      }
    });
  });

  describe("setColorMode", () => {
    it("updates paint properties on state and municipality fills and column layers", () => {
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
        LAYER_IDS.stateColumns,
        "fill-extrusion-color",
        columnColorExpression("delta")
      );
      expect(mockSetPaintProperty).toHaveBeenCalledWith(
        LAYER_IDS.munColumns,
        "fill-extrusion-color",
        columnColorExpression("delta")
      );
    });
  });

  describe("setColumnsVisible", () => {
    it("toggles visibility layout property on state and municipal column layers", () => {
      const mockSetLayoutProperty = vi.fn();
      const mockGetLayer = vi.fn().mockReturnValue({});
      const mockMap = {
        getLayer: mockGetLayer,
        setLayoutProperty: mockSetLayoutProperty,
      } as unknown as import("maplibre-gl").Map;

      setColumnsVisible(mockMap, true);
      expect(mockSetLayoutProperty).toHaveBeenCalledWith(
        LAYER_IDS.stateColumns,
        "visibility",
        "visible"
      );
      expect(mockSetLayoutProperty).toHaveBeenCalledWith(
        LAYER_IDS.munColumns,
        "visibility",
        "visible"
      );

      setColumnsVisible(mockMap, false);
      expect(mockSetLayoutProperty).toHaveBeenCalledWith(
        LAYER_IDS.stateColumns,
        "visibility",
        "none"
      );
      expect(mockSetLayoutProperty).toHaveBeenCalledWith(
        LAYER_IDS.munColumns,
        "visibility",
        "none"
      );
    });

    it("does not throw when map is null or lacks layers", () => {
      expect(() => setColumnsVisible(null as any, true)).not.toThrow();

      const mockMapMissingLayers = {
        getLayer: vi.fn().mockReturnValue(null),
        setLayoutProperty: vi.fn(),
      } as unknown as import("maplibre-gl").Map;

      expect(() => setColumnsVisible(mockMapMissingLayers, true)).not.toThrow();
    });
  });
});
