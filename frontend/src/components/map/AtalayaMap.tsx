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
  featureStateFor,
  type ColorMode,
} from "@/lib/mapStyle";
import {
  detectWebGL,
  featureTarget,
  levelOfFeature,
  createTileErrorTracker,
  fitPaddingWithInset,
  type GeometryMode,
} from "@/lib/mapSupport";
import { resolveFocusEnt, entFromFeature } from "@/lib/focus";
import { createHoverScheduler } from "@/lib/hoverThrottle";
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
  setExtrusionVisible,
  setExtrusionFocus,
} from "./mapLayers";
import { MapFallback } from "./MapFallback";

export type MapView = "active" | "base" | "alt";

declare global {
  interface Window {
    __atalayaMaps?: maplibregl.Map[];
    __atalayaMapErrors?: unknown[];
    __atalayaPerf?: {
      hoverQueries: number;
      paintCalls: number;
    };
  }
}

const isPerfEnabled = (): boolean => {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get("perf") === "1";
  } catch {
    return false;
  }
};

if (typeof window !== "undefined" && isPerfEnabled()) {
  window.__atalayaPerf = window.__atalayaPerf || {
    hoverQueries: 0,
    paintCalls: 0,
  };
}

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
  view3d?: "inclinada" | "cenital";
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

function AtalayaMapImpl({
  data,
  view,
  colorMode,
  extrude,
  view3d = "inclinada",
  onHover,
  onMapReady,
  onMapRemove,
  controls = true,
  className,
}: AtalayaMapProps): React.JSX.Element {
  const outerRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  const [mapState, setMapState] = useState<MapState>("loading");
  const [geometryMode, setGeometryMode] = useState<GeometryMode>("geojson");
  const [retryKey, setRetryKey] = useState(0);

  const mapStateRef = useRef<MapState>("loading");
  mapStateRef.current = mapState;

  const geometryModeRef = useRef<GeometryMode>(geometryMode);
  geometryModeRef.current = geometryMode;

  const extrudeRef = useRef(extrude);
  extrudeRef.current = extrude;

  const view3dRef = useRef(view3d);
  view3dRef.current = view3d;

  const colorModeRef = useRef(colorMode);
  colorModeRef.current = colorMode;

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
  const lastHoverCallbackPosRef = useRef<{
    id: string;
    level: Level;
    x: number;
    y: number;
  } | null>(null);

  const geoIndexRef = useRef<Map<string, GeoIndexItem>>(new Map());
  const geoIndexPromiseRef = useRef<Promise<GeoIndexItem[]> | null>(null);

  const lastAppliedEntRef = useRef<string | null>(null);
  const lastAppliedLevelRef = useRef<Level | null>(null);

  const lightSetRef = useRef(false);

  // 3D focus state and ref (exposed as data-focus-ent on outer container)
  const focusEntRef = useRef<string | null>(null);
  const [focusEnt, setFocusEnt] = useState<string | null>(null);

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

  const selectedEntRef = useRef(selectedEnt);
  selectedEntRef.current = selectedEnt;

  // Pre-load GeoIndex for fast camera bounds lookup
  useEffect(() => {
    const p = fetchGeoIndex()
      .then((items) => {
        const m = new Map<string, GeoIndexItem>();
        items.forEach((item) => {
          m.set(item.id, item);
        });
        geoIndexRef.current = m;
        return items;
      })
      .catch(() => [] as GeoIndexItem[]);
    geoIndexPromiseRef.current = p;
  }, []);

  // Handle retry from fallback or context loss
  const handleRetry = useCallback(() => {
    lastStateSignaturesRef.current.clear();
    setMapState("loading");
    setRetryKey((k) => k + 1);
  }, []);

  // Update 3D extrusion focus and visibility
  const updateFocus = useCallback((mapInstance?: maplibregl.Map | null) => {
    const map = mapInstance ?? mapRef.current;
    if (!map || mapStateRef.current !== "ready") return;

    if (!extrudeRef.current) {
      setExtrusionVisible(map, false);
      setExtrusionFocus(map, null);
      focusEntRef.current = null;
      setFocusEnt(null);
      if (outerRef.current) {
        outerRef.current.dataset.focusEnt = "";
      }
      return;
    }

    setExtrusionVisible(map, true);

    let centerEnt: string | null = null;
    try {
      const canvas = map.getCanvas();
      const w = canvas.clientWidth || canvas.width || 800;
      const h = canvas.clientHeight || canvas.height || 600;
      const centerPt: [number, number] = [w / 2, h / 2];

      if (map.getLayer(LAYER_IDS.statesFill)) {
        const feats = map.queryRenderedFeatures(centerPt, {
          layers: [LAYER_IDS.statesFill],
        });
        if (feats && feats.length > 0) {
          centerEnt = entFromFeature(feats[0]);
        }
      }
    } catch {}

    const newFocus = resolveFocusEnt({
      selectedEnt: selectedEntRef.current,
      zoom: map.getZoom(),
      centerEnt,
      previous: focusEntRef.current,
    });

    focusEntRef.current = newFocus;
    setFocusEnt(newFocus);
    if (outerRef.current) {
      outerRef.current.dataset.focusEnt = newFocus ?? "";
    }

    setExtrusionFocus(map, newFocus);
  }, []);

  // Helper to paint a single item onto polygon target
  const paintFeature = (
    id: string,
    lvl: Level,
    item: RiskItem | undefined,
    baseItem: RiskItem | undefined,
    mode: GeometryMode,
    curColorMode: ColorMode,
    signatures: Map<string, string>,
    mapInstance: maplibregl.Map
  ) => {
    let fs: any;
    try {
      fs = (featureStateFor as any)(item, baseItem, curColorMode, lvl);
    } catch {
      fs = { cat: "sin_dato", delta: null, h: 0, reliable: false };
    }
    const h = typeof fs.h === "number" && !isNaN(fs.h) ? fs.h : 0;
    const safeFs = { ...fs, h };

    const ent = lvl === "state" ? id : id.slice(0, 2);
    const dim = selectedEnt
      ? lvl === "state"
        ? id !== selectedEnt
        : ent !== selectedEnt
      : false;
    const isSelected = selectedEnt
      ? lvl === "state"
        ? id === selectedEnt
        : selectedRegionId === id
      : selectedRegionId === id;

    const sig = `${curColorMode}|${safeFs.cat}|${safeFs.delta}|${safeFs.h}|${safeFs.reliable}|${dim}|${isSelected}`;

    const polyTarget = featureTarget(mode, lvl, id);
    const polyKey = `${polyTarget.source}|${polyTarget.sourceLayer ?? ""}|${id}`;
    if (signatures.get(polyKey) !== sig) {
      try {
        mapInstance.setFeatureState(polyTarget, {
          ...safeFs,
          dim,
          selected: isSelected,
        });
        signatures.set(polyKey, sig);
        if (typeof window !== "undefined" && window.__atalayaPerf) {
          window.__atalayaPerf.paintCalls++;
        }
      } catch {}
    }
  };

  // Map initialization and lifecycle
  useEffect(() => {
    const webgl = detectWebGL();
    if (!webgl.ok) {
      setMapState("unsupported");
      return;
    }

    if (!containerRef.current) return;

    let isMounted = true;
    let removed = false;
    let contextRestoreTimeout: ReturnType<typeof setTimeout> | null = null;

    const timeoutId = setTimeout(() => {
      if (isMounted && mapRef.current === map && mapStateRef.current !== "ready") {
        setMapState("error");
      }
    }, 20000);

    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

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
      pitchWithRotate: true,
      fadeDuration: 0,
      pixelRatio: Math.min(dpr, 2),
    });

    mapRef.current = map;

    if (typeof window !== "undefined") {
      window.__atalayaMaps = window.__atalayaMaps || [];
      window.__atalayaMapErrors = window.__atalayaMapErrors || [];
      if (!window.__atalayaMaps.includes(map)) {
        window.__atalayaMaps.push(map);
      }
    }

    if (controls !== false) {
      const isCompactAttribution =
        typeof window !== "undefined"
          ? window.innerWidth < 640 || window.innerHeight <= 540
          : true;
      const attribControl = new maplibregl.AttributionControl({
        compact: isCompactAttribution,
      });
      map.addControl(attribControl, "bottom-right");

      const navControl = new maplibregl.NavigationControl({ visualizePitch: true });
      // Ensure getContainer() is available on navControl for measurement and overlay tagging
      (navControl as unknown as { getContainer?: () => HTMLElement }).getContainer = () =>
        (navControl as unknown as { _container: HTMLElement })._container;
      map.addControl(navControl, "bottom-right");

      const closeCompactAttribution = () => {
        if (typeof window === "undefined" || !map) return;
        const shouldBeCompact = window.innerWidth < 640 || window.innerHeight <= 540;
        if (shouldBeCompact) {
          const container = typeof map.getContainer === "function" ? map.getContainer() : null;
          const attribEl = container?.querySelector(".maplibregl-ctrl-attrib");
          if (attribEl) {
            attribEl.classList.remove("maplibregl-compact-show");
          }
        }
      };

      const updateNavControl = () => {
        if (typeof window === "undefined" || !map) return;
        const isTouchOrSmall = window.innerWidth < 768;
        const hasPitch = typeof map.getPitch === "function" ? map.getPitch() > 0 : false;

        const navEl =
          ((typeof (navControl as unknown as { getContainer?: () => HTMLElement }).getContainer === "function"
            ? (navControl as unknown as { getContainer?: () => HTMLElement }).getContainer!()
            : null) ||
          (navControl as unknown as { _container?: HTMLElement })._container ||
          (typeof map.getContainer === "function" ? (map.getContainer()?.querySelector(".maplibregl-ctrl-group") as HTMLElement | null) : null)) as HTMLElement | null;

        if (navEl && typeof navEl.setAttribute === "function") {
          navEl.setAttribute("data-map-overlay", "zoom");
          if (isTouchOrSmall) {
            const zoomIn = navEl.querySelector(".maplibregl-ctrl-zoom-in") as HTMLElement | null;
            const zoomOut = navEl.querySelector(".maplibregl-ctrl-zoom-out") as HTMLElement | null;
            const compass = navEl.querySelector(".maplibregl-ctrl-compass") as HTMLElement | null;
            if (zoomIn) zoomIn.style.display = "none";
            if (zoomOut) zoomOut.style.display = "none";
            if (compass) {
              compass.style.display = hasPitch ? "" : "none";
            }
            navEl.style.display = hasPitch ? "" : "none";
          } else {
            const zoomIn = navEl.querySelector(".maplibregl-ctrl-zoom-in") as HTMLElement | null;
            const zoomOut = navEl.querySelector(".maplibregl-ctrl-zoom-out") as HTMLElement | null;
            const compass = navEl.querySelector(".maplibregl-ctrl-compass") as HTMLElement | null;
            if (zoomIn) zoomIn.style.display = "";
            if (zoomOut) zoomOut.style.display = "";
            if (compass) compass.style.display = "";
            navEl.style.display = "";
          }
        }
      };

      // F4-D: tras load, quita maplibregl-compact-show para que inicie como botón ⓘ en pantallas < 640px o <= 540px alto
      map.on("load", () => {
        closeCompactAttribution();
        updateNavControl();
      });
      map.once("idle", () => {
        closeCompactAttribution();
        updateNavControl();
      });
      map.on("pitch", updateNavControl);
      map.on("rotate", updateNavControl);

      const handleAttribResize = () => {
        if (typeof window !== "undefined" && attribControl) {
          const compact = window.innerWidth < 640 || window.innerHeight <= 540;
          (attribControl as unknown as { _compact?: boolean; _updateCompact?: () => void })._compact = compact;
          (attribControl as unknown as { _updateCompact?: () => void })._updateCompact?.();
          closeCompactAttribution();
          updateNavControl();
        }
      };
      map.on("resize", handleAttribResize);

      closeCompactAttribution();
      updateNavControl();
    }


    const tileTracker = createTileErrorTracker();

    map.on("sourcedata", (e: { sourceId?: string; sourceDataType?: string }) => {
      if (!isMounted || mapRef.current !== map) return;
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
      if (!isMounted || mapRef.current !== map) return;
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

    const canvas = map.getCanvas();
    const handleContextLost = (e: Event) => {
      e.preventDefault();
      if (!isMounted || mapRef.current !== map) return;
      setMapState("context-lost");
      if (contextRestoreTimeout) clearTimeout(contextRestoreTimeout);
      contextRestoreTimeout = setTimeout(() => {
        if (isMounted && mapRef.current === map) {
          handleRetry();
        }
      }, 5000);
    };

    const handleContextRestored = () => {
      if (contextRestoreTimeout) {
        clearTimeout(contextRestoreTimeout);
        contextRestoreTimeout = null;
      }
      if (!isMounted || mapRef.current !== map) return;
      lastStateSignaturesRef.current.clear();
      setMapState("ready");
      try {
        map.triggerRepaint();
      } catch {}
    };

    canvas.addEventListener("webglcontextlost", handleContextLost);
    canvas.addEventListener("webglcontextrestored", handleContextRestored);

    const ro = new ResizeObserver(() => {
      if (isMounted && mapRef.current === map) {
        try {
          map.resize();
        } catch {}
      }
    });
    ro.observe(containerRef.current);

    map.on("zoomend", (e: { originalEvent?: unknown }) => {
      if (!isMounted || mapRef.current !== map) return;
      if (e.originalEvent && map.getZoom() < 4.8 && levelRef.current === "mun") {
        resetToNational();
      }
    });

    const clearHover = () => {
      if (!isMounted || mapRef.current !== map) return;
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
      try {
        map.getCanvas().style.cursor = "";
      } catch {}
      lastHoverCallbackPosRef.current = null;
      onHoverRef.current?.(null);
    };

    const processHover = (point: { x: number; y: number }) => {
      if (!isMounted || mapRef.current !== map) return;
      const zoom = map.getZoom();
      const isMunVisible = zoom >= 5.5;
      const is3d = extrudeRef.current;

      const statesExtLayer = LAYER_IDS.statesExtrusion;
      const munExtLayer = LAYER_IDS.munExtrusion;

      const layers: string[] = [];
      if (is3d) {
        if (isMunVisible) {
          if (map.getLayer(munExtLayer)) layers.push(munExtLayer);
          if (map.getLayer(statesExtLayer)) layers.push(statesExtLayer);
          layers.push(LAYER_IDS.munFill, LAYER_IDS.statesFill);
        } else {
          if (map.getLayer(statesExtLayer)) layers.push(statesExtLayer);
          if (map.getLayer(munExtLayer)) layers.push(munExtLayer);
          layers.push(LAYER_IDS.statesFill, LAYER_IDS.munFill);
        }
      } else {
        if (isMunVisible) {
          layers.push(LAYER_IDS.munFill, LAYER_IDS.statesFill);
        } else {
          layers.push(LAYER_IDS.statesFill, LAYER_IDS.munFill);
        }
      }

      const validLayers = layers.filter((id) => Boolean(map.getLayer(id)));
      if (validLayers.length === 0) {
        clearHover();
        return;
      }

      if (typeof window !== "undefined" && window.__atalayaPerf) {
        window.__atalayaPerf.hoverQueries++;
      }

      const features = map.queryRenderedFeatures([point.x, point.y], {
        layers: validLayers,
      });

      if (!features || features.length === 0) {
        clearHover();
        return;
      }

      let feat = features[0];
      if (!is3d) {
        if (isMunVisible) {
          const munFeat = features.find((f) => f.layer?.id === LAYER_IDS.munFill);
          if (munFeat) feat = munFeat;
        } else {
          const stateFeat = features.find(
            (f) => f.layer?.id === LAYER_IDS.statesFill
          );
          if (stateFeat) feat = stateFeat;
        }
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

      try {
        map.getCanvas().style.cursor = "pointer";
      } catch {}

      const lastPos = lastHoverCallbackPosRef.current;
      const shouldNotify =
        !lastPos ||
        lastPos.id !== id ||
        lastPos.level !== fLevel ||
        Math.hypot(point.x - lastPos.x, point.y - lastPos.y) >= 3;

      if (shouldNotify) {
        lastHoverCallbackPosRef.current = {
          id,
          level: fLevel,
          x: point.x,
          y: point.y,
        };
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
          x: point.x,
          y: point.y,
          item,
          base,
          alt,
        });
      }
    };

    const hoverScheduler = createHoverScheduler(
      (pt) => {
        processHover(pt);
      },
      { minMovePx: 3 }
    );

    map.on("mousemove", (e: maplibregl.MapMouseEvent) => {
      if (!isMounted || mapRef.current !== map) return;
      if (map.isMoving()) {
        return;
      }
      hoverScheduler.schedule(e.point);
    });

    map.on("moveend", () => {
      if (!isMounted || mapRef.current !== map) return;
      hoverScheduler.cancel(true);
      clearHover();
      if (extrudeRef.current) {
        updateFocus(map);
      }
    });

    map.on("mouseleave", () => {
      if (!isMounted || mapRef.current !== map) return;
      hoverScheduler.cancel(true);
      clearHover();
    });

    map.on("click", (e: maplibregl.MapMouseEvent) => {
      if (!isMounted || mapRef.current !== map) return;
      const zoom = map.getZoom();
      const isMunVisible = zoom >= 5.5;
      const is3d = extrudeRef.current;

      const statesExtLayer = LAYER_IDS.statesExtrusion;
      const munExtLayer = LAYER_IDS.munExtrusion;

      const layers: string[] = [];
      if (is3d) {
        if (isMunVisible) {
          if (map.getLayer(munExtLayer)) layers.push(munExtLayer);
          if (map.getLayer(statesExtLayer)) layers.push(statesExtLayer);
          layers.push(LAYER_IDS.munFill, LAYER_IDS.statesFill);
        } else {
          if (map.getLayer(statesExtLayer)) layers.push(statesExtLayer);
          if (map.getLayer(munExtLayer)) layers.push(munExtLayer);
          layers.push(LAYER_IDS.statesFill, LAYER_IDS.munFill);
        }
      } else {
        if (isMunVisible) {
          layers.push(LAYER_IDS.munFill, LAYER_IDS.statesFill);
        } else {
          layers.push(LAYER_IDS.statesFill, LAYER_IDS.munFill);
        }
      }

      const validLayers = layers.filter((id) => Boolean(map.getLayer(id)));
      if (validLayers.length === 0) return;

      const features = map.queryRenderedFeatures([e.point.x, e.point.y], {
        layers: validLayers,
      });
      if (!features || features.length === 0) return;

      let feat = features[0];
      if (!is3d) {
        if (isMunVisible) {
          const munFeat = features.find((f) => f.layer?.id === LAYER_IDS.munFill);
          if (munFeat) feat = munFeat;
        } else {
          const stateFeat = features.find(
            (f) => f.layer?.id === LAYER_IDS.statesFill
          );
          if (stateFeat) feat = stateFeat;
        }
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

    map.on("load", async () => {
      try {
        if (!isMounted || mapRef.current !== map) return;
        let activeMode: GeometryMode = "geojson";
        let manifest: TileManifest | null = null;

        if (isMockForce()) {
          activeMode = "mock";
        } else {
          manifest = await fetchTileManifest();
          if (!isMounted || mapRef.current !== map) return;
          activeMode = manifest ? "vector" : "geojson";
        }

        if (!isMounted || mapRef.current !== map) return;

        setGeometryMode(activeMode);
        geometryModeRef.current = activeMode;

        let sources;
        if (activeMode === "vector") {
          const countryGeo = await fetchCountryGeoJson();
          if (!isMounted || mapRef.current !== map) return;
          sources = buildSources("vector", manifest, {
            country: countryGeo,
          });
        } else {
          const [statesGeo, munGeo, countryGeo] = await Promise.all([
            fetchStatesGeoJson(),
            fetchMunAllGeoJson(),
            fetchCountryGeoJson(),
          ]);
          if (!isMounted || mapRef.current !== map) return;
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

        if (extrudeRef.current) {
          updateFocus(map);
        } else {
          setExtrusionVisible(map, false);
          setExtrusionFocus(map, null);
        }
      } catch (err) {
        if (typeof window !== "undefined" && window.__atalayaMapErrors) {
          window.__atalayaMapErrors.push(err);
        }
        if (isMounted && mapRef.current === map) {
          clearTimeout(timeoutId);
          setMapState("error");
        }
      }
    });

    return () => {
      if (removed) return;
      removed = true;
      isMounted = false;

      hoverScheduler.cancel(true);
      clearTimeout(timeoutId);
      if (contextRestoreTimeout) {
        clearTimeout(contextRestoreTimeout);
        contextRestoreTimeout = null;
      }
      ro.disconnect();

      try {
        canvas.removeEventListener("webglcontextlost", handleContextLost);
        canvas.removeEventListener(
          "webglcontextrestored",
          handleContextRestored
        );
      } catch {}

      if (typeof window !== "undefined" && window.__atalayaMaps) {
        const idx = window.__atalayaMaps.indexOf(map);
        if (idx !== -1) {
          window.__atalayaMaps.splice(idx, 1);
        }
      }

      try {
        onMapRemoveRef.current?.(map);
      } catch (err) {
        if (typeof window !== "undefined" && window.__atalayaMapErrors) {
          window.__atalayaMapErrors.push(err);
        }
      }

      try {
        map.remove();
      } catch (err) {
        if (typeof window !== "undefined" && window.__atalayaMapErrors) {
          window.__atalayaMapErrors.push(err);
        }
      }

      if (mapRef.current === map) {
        mapRef.current = null;
      }
    };
  }, [retryKey, controls, updateFocus]);

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
      paintFeature(
        id,
        "state",
        item,
        baseItem,
        mode,
        colorMode,
        signatures,
        map
      );
    }

    // Paint municipalities
    const allMunIds = new Set([...idx.mun.keys(), ...data.base.mun.keys()]);
    for (const id of allMunIds) {
      const item = idx.mun.get(id);
      const baseItem = data.base.mun.get(id);
      paintFeature(
        id,
        "mun",
        item,
        baseItem,
        mode,
        colorMode,
        signatures,
        map
      );
    }
  }, [mapState, geometryMode, data, view, colorMode, selectedEnt, selectedRegionId]);

  // 3D extrusion toggle and camera angle
  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapState !== "ready") return;

    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const duration = prefersReducedMotion ? 0 : extrude ? 1000 : 800;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

    if (extrude) {
      updateFocus(map);

      if (map.getLayer(LAYER_IDS.labelsRaster)) {
        map.setPaintProperty(LAYER_IDS.labelsRaster, "raster-opacity", 0.6);
      }

      map.dragRotate.enable();
      map.touchZoomRotate.enable();
      map.touchZoomRotate.enableRotation();
      map.setMaxPitch(65);

      if (!lightSetRef.current) {
        try {
          map.setLight({ anchor: "viewport", intensity: 0.35 });
          lightSetRef.current = true;
        } catch {}
      }

      const targetPitch = view3d === "cenital" ? 0 : 50;
      const targetBearing = view3d === "cenital" ? 0 : -12;
      map.easeTo({ pitch: targetPitch, bearing: targetBearing, duration });

      if (typeof (map as any).setPixelRatio === "function") {
        (map as any).setPixelRatio(Math.min(dpr, 1.5));
      }
    } else {
      setExtrusionVisible(map, false);
      setExtrusionFocus(map, null);
      focusEntRef.current = null;
      setFocusEnt(null);
      if (outerRef.current) {
        outerRef.current.dataset.focusEnt = "";
      }

      if (map.getLayer(LAYER_IDS.labelsRaster)) {
        map.setPaintProperty(LAYER_IDS.labelsRaster, "raster-opacity", 0.85);
      }

      map.dragRotate.disable();
      map.touchZoomRotate.disableRotation();
      map.setMaxPitch(0);
      map.easeTo({ pitch: 0, bearing: 0, duration });

      if (typeof (map as any).setPixelRatio === "function") {
        (map as any).setPixelRatio(Math.min(dpr, 2));
      }
    }
  }, [mapState, extrude, view3d, updateFocus]);

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
          const container = map.getContainer();
          const valorBottom = container
            ? parseFloat(
                getComputedStyle(container).getPropertyValue("--map-fit-bottom")
              )
            : 0;
          const valorRight = container
            ? parseFloat(
                getComputedStyle(container).getPropertyValue("--map-fit-right")
              )
            : 0;
          const paddingBottom = fitPaddingWithInset(
            48,
            container?.clientHeight ?? 0,
            valorBottom
          );
          const paddingRight = fitPaddingWithInset(
            48,
            container?.clientWidth ?? 0,
            valorRight
          );
          const padding = {
            top: paddingBottom.top,
            left: paddingBottom.left,
            right: paddingRight.bottom,
            bottom: paddingBottom.bottom,
          };
          map.fitBounds(
            [
              [minLon, minLat],
              [maxLon, maxLat],
            ],
            { padding, duration }
          );
        }
      } else if (level === "state") {
        map.fitBounds(MEXICO_BOUNDS, { padding: 24, duration });
      }

      if (extrudeRef.current) {
        updateFocus(map);
      }
    } else if (
      level === "state" &&
      !selectedEnt &&
      lastAppliedLevelRef.current !== "state"
    ) {
      map.fitBounds(MEXICO_BOUNDS, { padding: 24, duration });
      if (extrudeRef.current) {
        updateFocus(map);
      }
    }

    lastAppliedLevelRef.current = level;
  }, [mapState, selectedEnt, level, updateFocus]);

  return (
    <div
      ref={outerRef}
      className={`relative w-full h-full ${className ?? ""}`}
      data-map-state={mapState}
      data-geometry={geometryMode}
      data-focus-ent={focusEnt ?? ""}
    >
      <div
        ref={containerRef}
        className="absolute inset-0 [&_.maplibregl-ctrl-bottom-right]:mr-[var(--map-inset-right,0px)]"
      />
      {mapState === "unsupported" && <MapFallback reason="unsupported" />}
      {mapState === "error" && (
        <MapFallback reason="error" onRetry={handleRetry} />
      )}
      {mapState === "context-lost" && <MapFallback reason="context-lost" />}
    </div>
  );
}

export const AtalayaMap = React.memo(AtalayaMapImpl);
