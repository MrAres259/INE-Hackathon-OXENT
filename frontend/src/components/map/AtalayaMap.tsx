"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Level, RiskItem, GeoIndexItem, TileManifest } from "@/lib/types";
import {
  LAYER_IDS,
  SOURCE_IDS,
  MEXICO_BOUNDS,
  MAX_BOUNDS,
  EXTRUSION_MAX_M,
  featureStateFor,
  type ColorMode,
} from "@/lib/mapStyle";
import {
  detectWebGL,
  featureTarget,
  levelOfFeature,
  createTileErrorTracker,
  type GeometryMode,
} from "@/lib/mapSupport";
import type { MapRiskData } from "@/lib/mapRisk";
import {
  fetchStatesGeoJson,
  fetchMunAllGeoJson,
  fetchCountryGeoJson,
  fetchGeoIndex,
  fetchTileManifest,
} from "@/lib/geo";
import { useAtalaya } from "@/lib/state";
import {
  buildStyle,
  buildDataLayers,
  buildSources,
  setColorMode,
} from "./mapLayers";
import { MapFallback } from "./MapFallback";

declare global {
  interface Window {
    __atalayaMaps?: maplibregl.Map[];
    __atalayaMapErrors?: unknown[];
  }
}

export type MapView = "active" | "base" | "alt";

export type HoverInfo = {
  id: string;
  level: Level;
  name: string;
  ent: string;
  x: number;
  y: number; // x,y en px relativos al contenedor
  item: RiskItem | null;
  base: RiskItem | null;
  alt: RiskItem | null;
};

export type AtalayaMapProps = {
  data: MapRiskData;
  view: MapView;
  colorMode: ColorMode;
  extrude: boolean;
  onHover?: (h: HoverInfo | null) => void;
  onMapReady?: (map: maplibregl.Map) => void;
  onMapRemove?: (map: maplibregl.Map) => void;
  controls?: boolean; // NavigationControl + attribution compacta (default true)
  className?: string;
};

type MapState = "loading" | "ready" | "error" | "unsupported" | "context-lost";

const isMockForce = (): boolean => {
  if (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_MOCK) {
    return (
      process.env.NEXT_PUBLIC_MOCK === "1" ||
      process.env.NEXT_PUBLIC_MOCK === "true"
    );
  }
  return false;
};

export function AtalayaMap({
  data,
  view,
  colorMode,
  extrude,
  onHover,
  onMapReady,
  onMapRemove,
  controls = true,
  className,
}: AtalayaMapProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  const [mapState, setMapState] = useState<MapState>("loading");
  const [geometryMode, setGeometryMode] = useState<GeometryMode>("geojson");
  const [retryKey, setRetryKey] = useState(0);

  const mapStateRef = useRef<MapState>("loading");
  mapStateRef.current = mapState;

  const geometryModeRef = useRef<GeometryMode>(geometryMode);
  geometryModeRef.current = geometryMode;

  // References to keep callbacks and state fresh in listeners without re-subscribing
  const onHoverRef = useRef(onHover);
  onHoverRef.current = onHover;

  const onMapReadyRef = useRef(onMapReady);
  onMapReadyRef.current = onMapReady;

  const onMapRemoveRef = useRef(onMapRemove);
  onMapRemoveRef.current = onMapRemove;

  const dataRef = useRef(data);
  dataRef.current = data;

  const viewRef = useRef(view);
  viewRef.current = view;

  const hoveredRef = useRef<{ level: Level; id: string } | null>(null);
  const geoIndexRef = useRef<Map<string, GeoIndexItem>>(new Map());

  const lastAppliedEntRef = useRef<string | null>(null);
  const lastAppliedLevelRef = useRef<Level | null>(null);

  // Cache for incremental feature-state painting (prevents redundant setFeatureState calls)
  const lastStateSignaturesRef = useRef<Map<string, string>>(new Map());

  const {
    level,
    selectedEnt,
    selectedRegionId,
    selectState,
    selectRegion,
    resetToNational,
  } = useAtalaya();

  const levelRef = useRef(level);
  levelRef.current = level;

  // Pre-load GeoIndex for fast camera bounds lookup
  useEffect(() => {
    fetchGeoIndex()
      .then((items) => {
        const m = new Map<string, GeoIndexItem>();
        items.forEach((item) => {
          m.set(item.id, item);
        });
        geoIndexRef.current = m;
      })
      .catch(() => {});
  }, []);

  // Handle retry from fallback or context loss
  const handleRetry = useCallback(() => {
    if (mapRef.current) {
      try {
        mapRef.current.remove();
      } catch {}
      mapRef.current = null;
    }
    lastStateSignaturesRef.current.clear();
    setMapState("loading");
    setRetryKey((k) => k + 1);
  }, []);

  // Map initialization and lifecycle
  useEffect(() => {
    // 1. Detect WebGL support before creating map
    const webgl = detectWebGL();
    if (!webgl.ok) {
      setMapState("unsupported");
      return;
    }

    if (!containerRef.current) return;

    let isMounted = true;
    let contextRestoreTimeout: ReturnType<typeof setTimeout> | null = null;

    // 20s timeout for map loading
    const timeoutId = setTimeout(() => {
      if (isMounted && mapStateRef.current !== "ready") {
        setMapState("error");
      }
    }, 20000);

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildStyle(),
      bounds: MEXICO_BOUNDS,
      fitBoundsOptions: { padding: 24 },
      maxBounds: MAX_BOUNDS,
      minZoom: 3.5,
      maxZoom: 12,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      fadeDuration: 150,
    });

    mapRef.current = map;

    // Register debug map array in window
    if (typeof window !== "undefined") {
      window.__atalayaMaps = window.__atalayaMaps || [];
      window.__atalayaMapErrors = window.__atalayaMapErrors || [];
      if (!window.__atalayaMaps.includes(map)) {
        window.__atalayaMaps.push(map);
      }
    }

    // Add optional compact controls
    if (controls !== false) {
      map.addControl(
        new maplibregl.AttributionControl({ compact: true }),
        "bottom-right"
      );
      map.addControl(
        new maplibregl.NavigationControl({ visualizePitch: true }),
        "bottom-right"
      );
    }

    // Base raster tile error tracker
    const tileTracker = createTileErrorTracker();

    map.on("sourcedata", (e: { sourceId?: string; sourceDataType?: string }) => {
      const sourceId = e.sourceId;
      if (
        sourceId &&
        (sourceId === SOURCE_IDS.cartoBase || sourceId === SOURCE_IDS.cartoLabels)
      ) {
        if (e.sourceDataType === "content") {
          tileTracker.success(sourceId);
        }
      }
    });

    map.on("error", (e: unknown) => {
      const err = e as {
        error?: Error;
        sourceId?: string;
        source?: { id?: string };
        layerId?: string;
      };
      const sourceId = err?.sourceId ?? err?.source?.id;

      if (sourceId === SOURCE_IDS.cartoBase) {
        if (tileTracker.error(SOURCE_IDS.cartoBase) && map.getLayer(LAYER_IDS.baseRaster)) {
          try {
            map.setLayoutProperty(LAYER_IDS.baseRaster, "visibility", "none");
          } catch {}
        }
      } else if (sourceId === SOURCE_IDS.cartoLabels) {
        if (tileTracker.error(SOURCE_IDS.cartoLabels) && map.getLayer(LAYER_IDS.labelsRaster)) {
          try {
            map.setLayoutProperty(LAYER_IDS.labelsRaster, "visibility", "none");
          } catch {}
        }
      } else {
        if (typeof window !== "undefined" && window.__atalayaMapErrors) {
          window.__atalayaMapErrors.push(err?.error ?? e);
        }
      }
    });

    // WebGL Context Lost and Restored handlers
    const canvas = map.getCanvas();
    const handleContextLost = (e: Event) => {
      e.preventDefault();
      if (!isMounted) return;
      setMapState("context-lost");
      if (contextRestoreTimeout) clearTimeout(contextRestoreTimeout);
      contextRestoreTimeout = setTimeout(() => {
        if (isMounted) {
          handleRetry();
        }
      }, 5000);
    };

    const handleContextRestored = () => {
      if (contextRestoreTimeout) {
        clearTimeout(contextRestoreTimeout);
        contextRestoreTimeout = null;
      }
      if (isMounted) {
        handleRetry();
      }
    };

    canvas.addEventListener("webglcontextlost", handleContextLost);
    canvas.addEventListener("webglcontextrestored", handleContextRestored);

    // ResizeObserver for automatic layout responsiveness
    const ro = new ResizeObserver(() => {
      if (mapRef.current) {
        mapRef.current.resize();
      }
    });
    ro.observe(containerRef.current);

    // Zoom out event: if user zooms out below 4.8 when in mun level, reset to national
    map.on("zoomend", (e: { originalEvent?: unknown }) => {
      if (e.originalEvent && map.getZoom() < 4.8 && levelRef.current === "mun") {
        resetToNational();
      }
    });

    // Helper to clear active hover
    const clearHover = () => {
      if (hoveredRef.current) {
        try {
          const target = featureTarget(
            geometryModeRef.current,
            hoveredRef.current.level,
            hoveredRef.current.id
          );
          map.setFeatureState(target, { hover: false });
        } catch {}
        hoveredRef.current = null;
      }
      map.getCanvas().style.cursor = "";
      onHoverRef.current?.(null);
    };

    // Mouse move: query rendered features and trigger hover
    map.on("mousemove", (e: maplibregl.MapMouseEvent) => {
      const zoom = map.getZoom();
      const isMunVisible = zoom >= 5.5;
      const layers = isMunVisible
        ? [LAYER_IDS.munFill, LAYER_IDS.statesFill]
        : [LAYER_IDS.statesFill, LAYER_IDS.munFill];

      const features = map.queryRenderedFeatures(e.point, { layers });
      if (!features || features.length === 0) {
        clearHover();
        return;
      }

      let feat = features[0];
      if (isMunVisible) {
        const munFeat = features.find((f) => f.layer?.id === LAYER_IDS.munFill);
        if (munFeat) feat = munFeat;
      } else {
        const stateFeat = features.find(
          (f) => f.layer?.id === LAYER_IDS.statesFill
        );
        if (stateFeat) feat = stateFeat;
      }

      const id = String(feat.id ?? feat.properties?.id ?? "");
      if (!id) {
        clearHover();
        return;
      }

      const fLevel = levelOfFeature(feat);
      const target = featureTarget(geometryModeRef.current, fLevel, id);
      const ent = String(
        feat.properties?.ent ?? (id.length === 2 ? id : id.slice(0, 2))
      );
      const name = String(feat.properties?.name ?? "");

      if (
        hoveredRef.current &&
        (hoveredRef.current.id !== id || hoveredRef.current.level !== fLevel)
      ) {
        try {
          const prevTarget = featureTarget(
            geometryModeRef.current,
            hoveredRef.current.level,
            hoveredRef.current.id
          );
          map.setFeatureState(prevTarget, { hover: false });
        } catch {}
      }

      hoveredRef.current = { level: fLevel, id };
      try {
        map.setFeatureState(target, { hover: true });
      } catch {}

      map.getCanvas().style.cursor = "pointer";

      const curData = dataRef.current;
      const curView = viewRef.current;
      const activeIdx =
        curView === "base"
          ? curData.base
          : curView === "alt"
          ? (curData.alt ?? curData.base)
          : curData.active;

      const item = activeIdx[fLevel].get(id) ?? null;
      const base = curData.base[fLevel].get(id) ?? null;
      const alt = curData.alt ? curData.alt[fLevel].get(id) ?? null : null;

      onHoverRef.current?.({
        id,
        level: fLevel,
        name,
        ent,
        x: e.point.x,
        y: e.point.y,
        item,
        base,
        alt,
      });
    });

    map.on("mouseleave", () => {
      clearHover();
    });

    // Click handler: select state or municipality
    map.on("click", (e: maplibregl.MapMouseEvent) => {
      const zoom = map.getZoom();
      const isMunVisible = zoom >= 5.5;
      const layers = isMunVisible
        ? [LAYER_IDS.munFill, LAYER_IDS.statesFill]
        : [LAYER_IDS.statesFill, LAYER_IDS.munFill];

      const features = map.queryRenderedFeatures(e.point, { layers });
      if (!features || features.length === 0) return;

      let feat = features[0];
      if (isMunVisible) {
        const munFeat = features.find((f) => f.layer?.id === LAYER_IDS.munFill);
        if (munFeat) feat = munFeat;
      } else {
        const stateFeat = features.find(
          (f) => f.layer?.id === LAYER_IDS.statesFill
        );
        if (stateFeat) feat = stateFeat;
      }

      const id = String(feat.id ?? feat.properties?.id ?? "");
      if (!id) return;

      const fLevel = levelOfFeature(feat);
      if (fLevel === "mun") {
        selectRegion(id);
      } else {
        const ent = String(feat.properties?.ent ?? id);
        selectState(ent);
      }
    });

    // Load sources and layers
    map.on("load", async () => {
      try {
        let activeMode: GeometryMode = "geojson";
        let manifest: TileManifest | null = null;

        if (isMockForce()) {
          activeMode = "mock";
        } else {
          manifest = await fetchTileManifest();
          activeMode = manifest ? "vector" : "geojson";
        }

        if (!isMounted || !mapRef.current) return;

        setGeometryMode(activeMode);
        geometryModeRef.current = activeMode;

        let sources;
        if (activeMode === "vector") {
          const countryGeo = await fetchCountryGeoJson();
          if (!isMounted || !mapRef.current) return;
          sources = buildSources("vector", manifest, { country: countryGeo });
        } else {
          const [statesGeo, munGeo, countryGeo] = await Promise.all([
            fetchStatesGeoJson(),
            fetchMunAllGeoJson(),
            fetchCountryGeoJson(),
          ]);
          if (!isMounted || !mapRef.current) return;
          sources = buildSources(activeMode, null, {
            country: countryGeo,
            states: statesGeo,
            mun: munGeo,
          });
        }

        for (const [sourceId, spec] of Object.entries(sources)) {
          if (!map.getSource(sourceId)) {
            map.addSource(sourceId, spec);
          }
        }

        const dataLayers = buildDataLayers(colorMode, activeMode);
        for (const layer of dataLayers) {
          if (!map.getLayer(layer.id)) {
            map.addLayer(layer);
          }
        }

        clearTimeout(timeoutId);
        setMapState("ready");
        onMapReadyRef.current?.(map);
      } catch (err) {
        if (typeof window !== "undefined" && window.__atalayaMapErrors) {
          window.__atalayaMapErrors.push(err);
        }
        if (isMounted) {
          clearTimeout(timeoutId);
          setMapState("error");
        }
      }
    });

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
      if (contextRestoreTimeout) clearTimeout(contextRestoreTimeout);
      ro.disconnect();

      canvas.removeEventListener("webglcontextlost", handleContextLost);
      canvas.removeEventListener("webglcontextrestored", handleContextRestored);

      if (typeof window !== "undefined" && window.__atalayaMaps) {
        const idx = window.__atalayaMaps.indexOf(map);
        if (idx !== -1) {
          window.__atalayaMaps.splice(idx, 1);
        }
      }

      onMapRemoveRef.current?.(map);
      map.remove();
      mapRef.current = null;
    };
  }, [retryKey, controls]); // eslint-disable-line react-hooks/exhaustive-deps

  // Incremental feature-state painting (data, dimming, and selection)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapState !== "ready") return;

    const mode = geometryMode;
    const signatures = lastStateSignaturesRef.current;

    const idx =
      view === "base"
        ? data.base
        : view === "alt"
        ? (data.alt ?? data.base)
        : data.active;

    // Paint states
    const allStateIds = new Set([
      ...idx.state.keys(),
      ...data.base.state.keys(),
    ]);

    for (const id of allStateIds) {
      const item = idx.state.get(id);
      const baseItem = data.base.state.get(id);
      const fs = featureStateFor(
        item,
        baseItem,
        data.vmax.state,
        EXTRUSION_MAX_M.state
      );

      const dim = selectedEnt ? id !== selectedEnt : false;
      const isSelected = selectedEnt ? id === selectedEnt : selectedRegionId === id;
      const sig = `${fs.cat}|${fs.delta}|${fs.h}|${fs.reliable}|${dim}|${isSelected}`;

      if (signatures.get(id) !== sig) {
        try {
          const target = featureTarget(mode, "state", id);
          map.setFeatureState(target, {
            ...fs,
            dim,
            selected: isSelected,
          });
          signatures.set(id, sig);
        } catch {}
      }
    }

    // Paint municipalities
    const allMunIds = new Set([...idx.mun.keys(), ...data.base.mun.keys()]);
    for (const id of allMunIds) {
      const item = idx.mun.get(id);
      const baseItem = data.base.mun.get(id);
      const fs = featureStateFor(
        item,
        baseItem,
        data.vmax.mun,
        EXTRUSION_MAX_M.mun
      );

      const ent = id.slice(0, 2);
      const dim = selectedEnt ? ent !== selectedEnt : false;
      const isSelected = selectedRegionId === id;
      const sig = `${fs.cat}|${fs.delta}|${fs.h}|${fs.reliable}|${dim}|${isSelected}`;

      if (signatures.get(id) !== sig) {
        try {
          const target = featureTarget(mode, "mun", id);
          map.setFeatureState(target, {
            ...fs,
            dim,
            selected: isSelected,
          });
          signatures.set(id, sig);
        } catch {}
      }
    }
  }, [mapState, geometryMode, data, view, extrude, selectedEnt, selectedRegionId]);

  // 3D extrusion toggle and camera angle
  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapState !== "ready") return;

    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const duration = prefersReducedMotion ? 0 : extrude ? 1000 : 800;

    if (extrude) {
      if (map.getLayer(LAYER_IDS.statesExtrusion)) {
        map.setLayoutProperty(
          LAYER_IDS.statesExtrusion,
          "visibility",
          "visible"
        );
      }
      if (map.getLayer(LAYER_IDS.munExtrusion)) {
        map.setLayoutProperty(LAYER_IDS.munExtrusion, "visibility", "visible");
      }
      if (map.getLayer(LAYER_IDS.labelsRaster)) {
        map.setPaintProperty(LAYER_IDS.labelsRaster, "raster-opacity", 0.6);
      }
      map.dragRotate.enable();
      try {
        map.setLight({ anchor: "viewport", intensity: 0.35 });
      } catch {}
      map.easeTo({ pitch: 55, bearing: -12, duration });
    } else {
      if (map.getLayer(LAYER_IDS.statesExtrusion)) {
        map.setLayoutProperty(LAYER_IDS.statesExtrusion, "visibility", "none");
      }
      if (map.getLayer(LAYER_IDS.munExtrusion)) {
        map.setLayoutProperty(LAYER_IDS.munExtrusion, "visibility", "none");
      }
      if (map.getLayer(LAYER_IDS.labelsRaster)) {
        map.setPaintProperty(LAYER_IDS.labelsRaster, "raster-opacity", 0.85);
      }
      map.dragRotate.disable();
      map.easeTo({ pitch: 0, bearing: 0, duration });
    }
  }, [mapState, extrude]);

  // Color mode update
  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapState !== "ready") return;
    setColorMode(map, colorMode);
  }, [mapState, colorMode]);

  // Camera reactivity with useAtalaya()
  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapState !== "ready") return;

    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const duration = prefersReducedMotion ? 0 : 1200;

    if (selectedEnt !== lastAppliedEntRef.current) {
      lastAppliedEntRef.current = selectedEnt;

      if (selectedEnt) {
        const geoItem = geoIndexRef.current.get(selectedEnt);
        if (geoItem?.bbox) {
          const [minLon, minLat, maxLon, maxLat] = geoItem.bbox;
          map.fitBounds(
            [
              [minLon, minLat],
              [maxLon, maxLat],
            ],
            { padding: 48, duration }
          );
        }
      } else if (level === "state") {
        map.fitBounds(MEXICO_BOUNDS, { padding: 24, duration });
      }
    } else if (
      level === "state" &&
      !selectedEnt &&
      lastAppliedLevelRef.current !== "state"
    ) {
      map.fitBounds(MEXICO_BOUNDS, { padding: 24, duration });
    }

    lastAppliedLevelRef.current = level;
  }, [mapState, selectedEnt, level]);

  return (
    <div
      className={`relative w-full h-full ${className ?? ""}`}
      data-map-state={mapState}
      data-geometry={geometryMode}
    >
      <div ref={containerRef} className="absolute inset-0" />
      {mapState === "unsupported" && <MapFallback reason="unsupported" />}
      {mapState === "error" && (
        <MapFallback reason="error" onRetry={handleRetry} />
      )}
      {mapState === "context-lost" && <MapFallback reason="context-lost" />}
    </div>
  );
}
