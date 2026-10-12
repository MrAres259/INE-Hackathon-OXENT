import type {
  StyleSpecification,
  LayerSpecification,
} from "maplibre-gl";
import type maplibregl from "maplibre-gl";
import {
  LAYER_IDS,
  SOURCE_IDS,
  BASEMAP,
  fillExpression,
  type ColorMode,
} from "@/lib/mapStyle";

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
 * Builds data layer specifications in the exact order specified in §14.6:
 * bg -> carto-base -> country-fill -> states-fill -> mun-fill -> mun-line ->
 * states-line -> states-extrusion -> mun-extrusion -> states-hover ->
 * mun-hover -> selected-line -> carto-labels
 */
export function buildDataLayers(colorMode: ColorMode): LayerSpecification[] {
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
      source: SOURCE_IDS.states,
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
      source: SOURCE_IDS.mun,
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
      source: SOURCE_IDS.mun,
      minzoom: 5,
      paint: {
        "line-color": "rgba(148,163,184,0.25)",
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          5,
          0.2,
          12,
          0.8,
        ],
      },
    },
    {
      id: LAYER_IDS.statesLine,
      type: "line",
      source: SOURCE_IDS.states,
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
      source: SOURCE_IDS.states,
      maxzoom: 6.2,
      layout: {
        visibility: "none",
      },
      paint: {
        "fill-extrusion-color": fillExpression(colorMode),
        "fill-extrusion-height": ["coalesce", ["feature-state", "h"], 0],
        "fill-extrusion-opacity": 0.92,
        "fill-extrusion-vertical-gradient": true,
      },
    },
    {
      id: LAYER_IDS.munExtrusion,
      type: "fill-extrusion",
      source: SOURCE_IDS.mun,
      minzoom: 5,
      layout: {
        visibility: "none",
      },
      paint: {
        "fill-extrusion-color": fillExpression(colorMode),
        "fill-extrusion-height": ["coalesce", ["feature-state", "h"], 0],
        "fill-extrusion-opacity": 0.92,
        "fill-extrusion-vertical-gradient": true,
      },
    },
    {
      id: LAYER_IDS.hoverStates,
      type: "line",
      source: SOURCE_IDS.states,
      paint: {
        "line-color": "#ffffff",
        "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 2.2, 0],
      },
    },
    {
      id: LAYER_IDS.hoverMun,
      type: "line",
      source: SOURCE_IDS.mun,
      paint: {
        "line-color": "#ffffff",
        "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 2.2, 0],
      },
    },
    {
      id: LAYER_IDS.selected,
      type: "line",
      source: SOURCE_IDS.mun,
      paint: {
        "line-color": "#ffffff",
        "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 3, 0],
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
  const expr = fillExpression(mode);
  if (map.getLayer(LAYER_IDS.statesFill)) {
    map.setPaintProperty(LAYER_IDS.statesFill, "fill-color", expr);
  }
  if (map.getLayer(LAYER_IDS.munFill)) {
    map.setPaintProperty(LAYER_IDS.munFill, "fill-color", expr);
  }
  if (map.getLayer(LAYER_IDS.statesExtrusion)) {
    map.setPaintProperty(LAYER_IDS.statesExtrusion, "fill-extrusion-color", expr);
  }
  if (map.getLayer(LAYER_IDS.munExtrusion)) {
    map.setPaintProperty(LAYER_IDS.munExtrusion, "fill-extrusion-color", expr);
  }
}
