"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Level, RiskItem, GeoIndexItem } from "@/lib/types";
import {
  LAYER_IDS,
  SOURCE_IDS,
  MEXICO_BOUNDS,
  MAX_BOUNDS,
  EXTRUSION_MAX_M,
  featureStateFor,
  type ColorMode,
} from "@/lib/mapStyle";
import type { MapRiskData } from "@/lib/mapRisk";
import {
  fetchStatesGeoJson,
  fetchMunAllGeoJson,
  fetchCountryGeoJson,
  fetchGeoIndex,
} from "@/lib/geo";
import { useAtalaya } from "@/lib/state";
import { buildStyle, buildDataLayers, setColorMode } from "./mapLayers";

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
  const [mapLoaded, setMapLoaded] = useState(false);

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

  const hoveredRef = useRef<{ source: string; id: string } | null>(null);
  const geoIndexRef = useRef<Map<string, GeoIndexItem>>(new Map());

  const lastAppliedEntRef = useRef<string | null>(null);
  const lastAppliedRegionIdRef = useRef<string | null>(null);
  const lastAppliedLevelRef = useRef<Level | null>(null);

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

  // Map initialization and lifecycle
  useEffect(() => {
    if (!containerRef.current) return;

    let isMounted = true;

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

    // Error handling
    let cartoBaseErrorHandled = false;
    let cartoLabelsErrorHandled = false;

    map.on("error", (e: unknown) => {
      const err = e as {
        error?: Error;
        sourceId?: string;
        source?: { id?: string };
        layerId?: string;
      };
      const sourceId = err?.sourceId ?? err?.source?.id;

      if (sourceId === SOURCE_IDS.cartoBase) {
        if (!cartoBaseErrorHandled && map.getLayer(LAYER_IDS.baseRaster)) {
          cartoBaseErrorHandled = true;
          try {
            map.setLayoutProperty(LAYER_IDS.baseRaster, "visibility", "none");
          } catch {}
        }
      } else if (sourceId === SOURCE_IDS.cartoLabels) {
        if (!cartoLabelsErrorHandled && map.getLayer(LAYER_IDS.labelsRaster)) {
          cartoLabelsErrorHandled = true;
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
          map.setFeatureState(
            { source: hoveredRef.current.source, id: hoveredRef.current.id },
            { hover: false }
          );
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

      const isMun = feat.layer?.id === LAYER_IDS.munFill || id.length === 5;
      const fLevel: Level = isMun ? "mun" : "state";
      const source = isMun ? SOURCE_IDS.mun : SOURCE_IDS.states;
      const ent = String(
        feat.properties?.ent ?? (id.length === 2 ? id : id.slice(0, 2))
      );
      const name = String(feat.properties?.name ?? "");

      if (
        hoveredRef.current &&
        (hoveredRef.current.id !== id || hoveredRef.current.source !== source)
      ) {
        try {
          map.setFeatureState(
            { source: hoveredRef.current.source, id: hoveredRef.current.id },
            { hover: false }
          );
        } catch {}
      }

      hoveredRef.current = { source, id };
      try {
        map.setFeatureState({ source, id }, { hover: true });
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

      const isMun = feat.layer?.id === LAYER_IDS.munFill || id.length === 5;
      if (isMun) {
        selectRegion(id);
      } else {
        const ent = String(feat.properties?.ent ?? id);
        selectState(ent);
      }
    });

    // Load sources and layers in parallel
    map.on("load", async () => {
      try {
        const [statesGeo, munGeo, countryGeo] = await Promise.all([
          fetchStatesGeoJson(),
          fetchMunAllGeoJson(),
          fetchCountryGeoJson(),
        ]);

        if (!isMounted || !mapRef.current) return;

        if (!map.getSource(SOURCE_IDS.country)) {
          map.addSource(SOURCE_IDS.country, {
            type: "geojson",
            data: countryGeo ?? { type: "FeatureCollection", features: [] },
          });
        }

        if (!map.getSource(SOURCE_IDS.states)) {
          map.addSource(SOURCE_IDS.states, {
            type: "geojson",
            data: statesGeo,
            promoteId: "id",
          });
        }

        if (!map.getSource(SOURCE_IDS.mun)) {
          map.addSource(SOURCE_IDS.mun, {
            type: "geojson",
            data: munGeo,
            promoteId: "id",
          });
        }

        const dataLayers = buildDataLayers(colorMode);
        for (const layer of dataLayers) {
          if (!map.getLayer(layer.id)) {
            map.addLayer(layer);
          }
        }

        setMapLoaded(true);
        onMapReadyRef.current?.(map);
      } catch (err) {
        if (typeof window !== "undefined" && window.__atalayaMapErrors) {
          window.__atalayaMapErrors.push(err);
        }
      }
    });

    return () => {
      isMounted = false;
      ro.disconnect();

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
  }, [controls]); // StrictMode safe map initialization

  // Feature-state painting: updates feature-state without setData
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

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
      try {
        map.setFeatureState({ source: SOURCE_IDS.states, id }, fs);
      } catch {}
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
      try {
        map.setFeatureState({ source: SOURCE_IDS.mun, id }, fs);
      } catch {}
    }
  }, [mapLoaded, data, view, extrude]);

  // 3D extrusion toggle and camera angle
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

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
  }, [mapLoaded, extrude]);

  // Color mode update
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    setColorMode(map, colorMode);
  }, [mapLoaded, colorMode]);

  // Camera and selection reactivity with useAtalaya()
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

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

        // Dim states outside of selectedEnt
        const allStateIds = new Set([
          ...data.active.state.keys(),
          ...data.base.state.keys(),
        ]);
        for (const id of allStateIds) {
          try {
            map.setFeatureState(
              { source: SOURCE_IDS.states, id },
              { dim: id !== selectedEnt }
            );
          } catch {}
        }

        // Dim municipalities outside of selectedEnt
        const allMunIds = new Set([
          ...data.active.mun.keys(),
          ...data.base.mun.keys(),
        ]);
        for (const id of allMunIds) {
          const ent = id.slice(0, 2);
          try {
            map.setFeatureState(
              { source: SOURCE_IDS.mun, id },
              { dim: ent !== selectedEnt }
            );
          } catch {}
        }
      } else if (level === "state") {
        map.fitBounds(MEXICO_BOUNDS, { padding: 24, duration });

        // Remove dimming
        const allStateIds = new Set([
          ...data.active.state.keys(),
          ...data.base.state.keys(),
        ]);
        for (const id of allStateIds) {
          try {
            map.setFeatureState(
              { source: SOURCE_IDS.states, id },
              { dim: false }
            );
          } catch {}
        }

        const allMunIds = new Set([
          ...data.active.mun.keys(),
          ...data.base.mun.keys(),
        ]);
        for (const id of allMunIds) {
          try {
            map.setFeatureState(
              { source: SOURCE_IDS.mun, id },
              { dim: false }
            );
          } catch {}
        }
      }
    } else if (
      level === "state" &&
      !selectedEnt &&
      lastAppliedLevelRef.current !== "state"
    ) {
      map.fitBounds(MEXICO_BOUNDS, { padding: 24, duration });
    }

    lastAppliedLevelRef.current = level;
  }, [mapLoaded, selectedEnt, level, data]);

  // Selected region feature state highlighting
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    if (selectedRegionId !== lastAppliedRegionIdRef.current) {
      if (lastAppliedRegionIdRef.current) {
        const prevId = lastAppliedRegionIdRef.current;
        const prevSource =
          prevId.length === 5 ? SOURCE_IDS.mun : SOURCE_IDS.states;
        try {
          map.setFeatureState(
            { source: prevSource, id: prevId },
            { selected: false }
          );
        } catch {}
      }

      if (selectedRegionId) {
        const newSource =
          selectedRegionId.length === 5 ? SOURCE_IDS.mun : SOURCE_IDS.states;
        try {
          map.setFeatureState(
            { source: newSource, id: selectedRegionId },
            { selected: true }
          );
        } catch {}
      }

      lastAppliedRegionIdRef.current = selectedRegionId;
    }
  }, [mapLoaded, selectedRegionId]);

  return (
    <div className={`relative w-full h-full ${className ?? ""}`}>
      <div ref={containerRef} className="absolute inset-0" />
    </div>
  );
}
