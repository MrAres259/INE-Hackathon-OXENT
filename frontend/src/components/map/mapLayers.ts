import type {
  StyleSpecification,
  LayerSpecification,
  SourceSpecification,
} from "maplibre-gl";
import type maplibregl from "maplibre-gl";
import type { FeatureCollection, Geometry } from "geojson";
import {
  LAYER_IDS,
  SOURCE_IDS,
  SOURCE_LAYERS,
  BASEMAP,
  fillExpression,
  extrusionColorExpression,
  extrusionHeightExpression,
  EXTRUSION_ZOOM_SPLIT,
  type ColorMode,
} from "@/lib/mapStyle";
import type { GeometryMode } from "@/lib/mapSupport";
import type { TileManifest } from "@/lib/types";
import {
  absoluteTileUrl,
  type CountryProperties,
  type StateProperties,
  type MunProperties,
} from "@/lib/geo";

export type GeoSourcesData = {
  country?: FeatureCollection<Geometry, CountryProperties> | null;
  states?: FeatureCollection<Geometry, StateProperties> | null;
  mun?: FeatureCollection<Geometry, MunProperties> | null;
};

/**
 * Builds the initial MapLibre style specification.
 * Pure and testable. Version 8, without glyphs (offline basemap),
 * raster tile sources, and a background layer.
 */
export function buildStyle(): StyleSpecification {
  const maxzoom = (BASEMAP as { maxzoom?: number }).maxzoom ?? 16;

  return {
    version: 8,
    sources: {
      [SOURCE_IDS.cartoBase]: {
        type: "raster",
        tiles: [BASEMAP.base],
        tileSize: 256,
        maxzoom,
        attribution: BASEMAP.attribution,
      },
      [SOURCE_IDS.cartoLabels]: {
        type: "raster",
        tiles: [BASEMAP.labels],
        tileSize: 256,
        maxzoom,
        attribution: BASEMAP.attribution,
      },
    },
    layers: [
      {
        id: LAYER_IDS.background,
        type: "background",
        paint: {
          "background-color": BASEMAP.background,
        },
      },
    ],
  };
}

/**
 * Builds source specifications for MapLibre map initialization.
 * In vector mode, provides vector tiles source with promoteId and country geojson.
 * In geojson / mock mode, provides states, mun, and country geojson sources.
 */
export function buildSources(
  mode: GeometryMode,
  manifest?: TileManifest | null,
  geo?: GeoSourcesData | null
): Record<string, SourceSpecification> {
  const emptyFC: FeatureCollection<Geometry, any> = {
    type: "FeatureCollection",
    features: [],
  };

  if (mode === "vector") {
    const tileTemplates =
      manifest?.tiles && manifest.tiles.length > 0
        ? manifest.tiles
        : ["/geo/tiles/{z}/{x}/{y}.pbf"];
    const absoluteTiles = tileTemplates.map((t) => absoluteTileUrl(t));

    return {
      [SOURCE_IDS.country]: {
        type: "geojson",
        data: geo?.country ?? emptyFC,
      },
      [SOURCE_IDS.vector]: {
        type: "vector",
        tiles: absoluteTiles,
        minzoom: manifest?.minzoom ?? 3,
        maxzoom: manifest?.maxzoom ?? 9,
        bounds: manifest?.bounds ?? [-118.6, 14.3, -86.5, 32.8],
        promoteId: { states: "id", mun: "id" },
        attribution: BASEMAP.attribution,
      },
    };
  }

  return {
    [SOURCE_IDS.country]: {
      type: "geojson",
      data: geo?.country ?? emptyFC,
    },
    [SOURCE_IDS.states]: {
      type: "geojson",
      data: geo?.states ?? emptyFC,
      promoteId: "id",
    },
    [SOURCE_IDS.mun]: {
      type: "geojson",
      data: geo?.mun ?? emptyFC,
      promoteId: "id",
    },
  };
}

/**
 * Builds data layer specifications in the exact order:
 * bg -> carto-base -> country-fill -> states-fill -> mun-fill -> mun-line ->
 * states-line -> states-extrusion -> mun-extrusion -> states-hover ->
 * mun-hover -> selected-line -> states-selected-line -> carto-labels
 */
export function buildDataLayers(
  colorMode: ColorMode,
  mode: GeometryMode = "geojson"
): LayerSpecification[] {
  const isVector = mode === "vector";
  const stateSource = isVector ? SOURCE_IDS.vector : SOURCE_IDS.states;
  const munSource = isVector ? SOURCE_IDS.vector : SOURCE_IDS.mun;
  const stateLayerProp = isVector
    ? { "source-layer": SOURCE_LAYERS.states }
    : {};
  const munLayerProp = isVector ? { "source-layer": SOURCE_LAYERS.mun } : {};

  return [
    {
      id: LAYER_IDS.background,
      type: "background",
      paint: {
        "background-color": BASEMAP.background,
      },
    },
    {
      id: LAYER_IDS.baseRaster,
      type: "raster",
      source: SOURCE_IDS.cartoBase,
    },
    {
      id: LAYER_IDS.country,
      type: "fill",
      source: SOURCE_IDS.country,
      paint: {
        "fill-color": BASEMAP.land,
        "fill-opacity": 1,
      },
    },
    {
      id: LAYER_IDS.statesFill,
      type: "fill",
      source: stateSource,
      ...stateLayerProp,
      paint: {
        "fill-color": fillExpression(colorMode),
        "fill-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          5,
          ["case", ["boolean", ["feature-state", "dim"], false], 0.22, 0.88],
          6.2,
          0,
        ],
      },
    },
    {
      id: LAYER_IDS.munFill,
      type: "fill",
      source: munSource,
      ...munLayerProp,
      paint: {
        "fill-color": fillExpression(colorMode),
        "fill-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          5,
          0,
          6,
          ["case", ["boolean", ["feature-state", "dim"], false], 0.18, 0.9],
        ],
      },
    },
    {
      id: LAYER_IDS.munLine,
      type: "line",
      source: munSource,
      ...munLayerProp,
      minzoom: 5,
      paint: {
        "line-color": "rgba(226,232,240,1)",
        "line-opacity": [
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
        ],
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          5,
          0.2,
          9,
          0.6,
          12,
          1.2,
        ],
      },
    },
    {
      id: LAYER_IDS.statesLine,
      type: "line",
      source: stateSource,
      ...stateLayerProp,
      paint: {
        "line-color": "rgba(226,232,240,0.55)",
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          3.5,
          0.6,
          10,
          1.6,
        ],
      },
    },
    {
      id: LAYER_IDS.statesExtrusion,
      type: "fill-extrusion",
      source: stateSource,
      ...stateLayerProp,
      maxzoom: EXTRUSION_ZOOM_SPLIT,
      layout: {
        visibility: "none",
      },
      paint: {
        "fill-extrusion-color": extrusionColorExpression(colorMode),
        "fill-extrusion-height": extrusionHeightExpression("state"),
        "fill-extrusion-base": 0,
        "fill-extrusion-opacity": 0.92,
        "fill-extrusion-vertical-gradient": true,
      },
    },
    {
      // All municipal geometry sources (vector tiles, GeoJSON, and mock data) consistently provide 'ent' as the 2-digit state identifier.
      id: LAYER_IDS.munExtrusion,
      type: "fill-extrusion",
      source: munSource,
      ...munLayerProp,
      minzoom: EXTRUSION_ZOOM_SPLIT,
      filter: ["==", ["get", "ent"], ""],
      layout: {
        visibility: "none",
      },
      paint: {
        "fill-extrusion-color": extrusionColorExpression(colorMode),
        "fill-extrusion-height": extrusionHeightExpression("mun"),
        "fill-extrusion-base": 0,
        "fill-extrusion-opacity": 0.92,
        "fill-extrusion-vertical-gradient": true,
      },
    },
    {
      id: LAYER_IDS.hoverStates,
      type: "line",
      source: stateSource,
      ...stateLayerProp,
      paint: {
        "line-color": "#ffffff",
        "line-width": [
          "case",
          ["boolean", ["feature-state", "hover"], false],
          2.2,
          0,
        ],
      },
    },
    {
      id: LAYER_IDS.hoverMun,
      type: "line",
      source: munSource,
      ...munLayerProp,
      paint: {
        "line-color": "#ffffff",
        "line-width": [
          "case",
          ["boolean", ["feature-state", "hover"], false],
          2.2,
          0,
        ],
      },
    },
    {
      id: LAYER_IDS.selected,
      type: "line",
      source: munSource,
      ...munLayerProp,
      paint: {
        "line-color": "#ffffff",
        "line-width": [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          3,
          0,
        ],
        "line-blur": 0.5,
      },
    },
    {
      id: LAYER_IDS.selectedStates,
      type: "line",
      source: stateSource,
      ...stateLayerProp,
      paint: {
        "line-color": "#ffffff",
        "line-width": [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          3,
          0,
        ],
        "line-blur": 0.5,
      },
    },
    {
      id: LAYER_IDS.labelsRaster,
      type: "raster",
      source: SOURCE_IDS.cartoLabels,
      paint: {
        "raster-opacity": 0.85,
      },
    },
  ];
}

/**
 * Dynamically switches layer fill and extrusion colors according to color mode.
 */
export function setColorMode(map: maplibregl.Map, mode: ColorMode): void {
  try {
    const expr = fillExpression(mode);
    if (map?.getLayer && map.getLayer(LAYER_IDS.statesFill)) {
      map.setPaintProperty(LAYER_IDS.statesFill, "fill-color", expr);
    }
    if (map?.getLayer && map.getLayer(LAYER_IDS.munFill)) {
      map.setPaintProperty(LAYER_IDS.munFill, "fill-color", expr);
    }
    const extExpr = extrusionColorExpression(mode);
    if (map?.getLayer && map.getLayer(LAYER_IDS.statesExtrusion)) {
      map.setPaintProperty(LAYER_IDS.statesExtrusion, "fill-extrusion-color", extExpr);
    }
    if (map?.getLayer && map.getLayer(LAYER_IDS.munExtrusion)) {
      map.setPaintProperty(LAYER_IDS.munExtrusion, "fill-extrusion-color", extExpr);
    }
  } catch {
    // Never throws
  }
}

/**
 * Dynamically toggles visibility of state and municipal 3D extrusion layers.
 * Never throws if map or layers are not loaded.
 */
export function setExtrusionVisible(map: maplibregl.Map, visible: boolean): void {
  try {
    const vis = visible ? "visible" : "none";
    if (map?.getLayer && map.getLayer(LAYER_IDS.statesExtrusion)) {
      map.setLayoutProperty(LAYER_IDS.statesExtrusion, "visibility", vis);
    }
    if (map?.getLayer && map.getLayer(LAYER_IDS.munExtrusion)) {
      map.setLayoutProperty(LAYER_IDS.munExtrusion, "visibility", vis);
    }
  } catch {
    // Never throws
  }
}

const focusCache = new WeakMap<maplibregl.Map, string>();

/**
 * Updates the extrusion focus filter on the municipal extrusion layer.
 * Only the municipalities belonging to the focused state (ent) are extruded.
 * Caches the current focus per map instance via WeakMap to avoid redundant setFilter calls.
 * Never throws if map or layer is unavailable.
 */
export function setExtrusionFocus(map: maplibregl.Map, ent: string | null): void {
  try {
    if (!map) return;
    const targetEnt = ent ?? "";
    const current = focusCache.get(map);
    if (current === targetEnt) {
      return;
    }
    if (map?.getLayer && map.getLayer(LAYER_IDS.munExtrusion)) {
      map.setFilter(LAYER_IDS.munExtrusion, ["==", ["get", "ent"], targetEnt]);
      focusCache.set(map, targetEnt);
    }
  } catch {
    // Never throws
  }
}
