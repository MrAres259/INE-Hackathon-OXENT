"use client";

import React, { useState, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import { useAtalaya } from "@/lib/state";
import { useMapRisk } from "@/lib/useMapRisk";
import type { Map as MapLibreMap } from "maplibre-gl";
import { Breadcrumb } from "./Breadcrumb";
import { MapToolbar, MapLayerSwitcher } from "./MapToolbar";
import { Legend } from "./Legend";
import { MapTooltip } from "./MapTooltip";
import type { HoverInfo } from "./AtalayaMap";
import { MapErrorBoundary } from "./MapErrorBoundary";
import { CompareSummary } from "./CompareSwipe";
import {
  reduceTooltipIntent,
  initialTooltipIntentState,
  tooltipIntent,
  type TooltipIntentState,
  type TooltipIntentEvent,
} from "@/lib/tooltipIntent";

const MapLoading = () => (
  <div className="absolute inset-0 bg-[#eef0f3] flex flex-col items-center justify-center text-muted-foreground gap-3">
    <svg
      className="animate-spin h-8 w-8 text-primary"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
    <span className="text-xs font-medium text-foreground">
      Cargando visualización del mapa interactivo...
    </span>
  </div>
);

// Dynamic imports with ssr: false to prevent MapLibre window/document errors during SSR
const AtalayaMap = dynamic(
  () => import("./AtalayaMap").then((m) => m.AtalayaMap),
  {
    ssr: false,
    loading: () => <MapLoading />,
  }
);

const CompareSwipe = dynamic(
  () => import("./CompareSwipe").then((m) => m.CompareSwipe),
  {
    ssr: false,
    loading: () => <MapLoading />,
  }
);

export function RiskMap() {
  const atalayaContext = useAtalaya();
  const {
    mapMode = "semaforo",
    extrude3d = false,
    scenario = "base",
    view3d = "inclinada",
  } = atalayaContext;

  // Single invocation of useMapRisk per §14.4 / §14.7
  const data = useMapRisk();

  const mapInstanceRef = useRef<MapLibreMap | null>(null);

  // Pure tooltip intent state machine for dwell, anchoring, and interactive tooltip
  const [tooltipState, dispatchTooltip] = React.useReducer(
    (s: TooltipIntentState, e: TooltipIntentEvent) => reduceTooltipIntent(s, e),
    initialTooltipIntentState
  );

  // Tick timer effect for pending dwell or delayed hide
  useEffect(() => {
    let delay: number | null = null;
    const now = Date.now();
    if (tooltipState.pending && !tooltipState.isOverTooltip) {
      delay = Math.max(0, tooltipState.pending.dwellUntilMs - now);
    } else if (
      tooltipState.hideAtMs !== null &&
      !tooltipState.isOverTooltip &&
      !tooltipState.isOverMap
    ) {
      delay = Math.max(0, tooltipState.hideAtMs - now);
    }

    if (delay === null) return;

    const timer = setTimeout(() => {
      dispatchTooltip(tooltipIntent.tick());
    }, delay);
    return () => clearTimeout(timer);
  }, [
    tooltipState.pending,
    tooltipState.hideAtMs,
    tooltipState.isOverTooltip,
    tooltipState.isOverMap,
  ]);

  // Hide tooltip on guide open event
  useEffect(() => {
    const handleGuideOpen = () => dispatchTooltip(tooltipIntent.guideOpen());
    window.addEventListener("atalaya:open-guide", handleGuideOpen);
    return () => window.removeEventListener("atalaya:open-guide", handleGuideOpen);
  }, []);

  const handleMapReady = React.useCallback((map: MapLibreMap) => {
    mapInstanceRef.current = map;
    map.on("dragstart", () => dispatchTooltip(tooltipIntent.dragStart()));
    map.on("movestart", () => dispatchTooltip(tooltipIntent.dragStart()));
  }, []);

  const handleHover = React.useCallback((nextHover: HoverInfo | null) => {
    if (nextHover) {
      dispatchTooltip(
        tooltipIntent.hover(nextHover.id, nextHover.x, nextHover.y, nextHover)
      );
    } else {
      dispatchTooltip(tooltipIntent.leave());
    }
  }, []);

  // Derive base/alt/item on every render from data so tooltip refreshes upon simulation/apply
  const hover = React.useMemo<HoverInfo | null>(() => {
    if (!tooltipState.active) return null;
    const active = tooltipState.active;
    const lvl: "state" | "mun" =
      active.data?.level ?? (active.id.length === 2 ? "state" : "mun");
    const id = active.id;
    const baseItem = data.base[lvl]?.get(id) ?? null;
    const altItem = data.alt ? (data.alt[lvl]?.get(id) ?? null) : null;
    const activeItem = data.active[lvl]?.get(id) ?? baseItem;

    return {
      id,
      level: lvl,
      name: active.data?.name ?? activeItem?.name ?? "",
      ent: active.data?.ent ?? activeItem?.ent ?? (id.length === 2 ? id : id.slice(0, 2)),
      x: active.x,
      y: active.y,
      base: baseItem,
      alt: altItem,
      item: activeItem,
    };
  }, [tooltipState.active, data]);

  const handleExportPng = React.useCallback(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    map.once("render", () => {
      try {
        const canvas = map.getCanvas();
        const dataUrl = canvas.toDataURL("image/png");
        const a = document.createElement("a");
        const filename = `atalaya-mapa-${mapMode}-${scenario}.png`;
        a.href = dataUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } catch (err) {
        console.error("Error al exportar mapa PNG:", err);
      }
    });

    map.triggerRepaint();
  }, [mapMode, scenario]);

  const [containerRect, setContainerRect] = useState<{ width: number; height: number }>({
    width: 800,
    height: 520,
  });
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Measure container for tooltip edge flipping
  useEffect(() => {
    if (!wrapperRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const cr = entry.contentRect;
        if (cr.width > 0 && cr.height > 0) {
          setContainerRect({ width: cr.width, height: cr.height });
        }
      }
    });
    ro.observe(wrapperRef.current);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={wrapperRef}
      className="relative h-full w-full min-h-0 flex-1 overflow-hidden bg-[#eef0f3]"
    >
      {/* Map View Rendering inside dedicated absolute inset-0 container */}
      <div className="absolute inset-0 [&_.maplibregl-map]:h-full [&_.maplibregl-map]:w-full">
        {mapMode === "compare" ? (
          <CompareSwipe
            data={data}
            extrude={extrude3d}
            view3d={view3d}
            onHover={handleHover}
            onMapReady={handleMapReady}
          />
        ) : mapMode === "delta" ? (
          <MapErrorBoundary>
            <AtalayaMap
              data={data}
              view="alt"
              colorMode="delta"
              extrude={extrude3d}
              view3d={view3d}
              onHover={handleHover}
              onMapReady={handleMapReady}
            />
          </MapErrorBoundary>
        ) : (
          <MapErrorBoundary>
            <AtalayaMap
              data={data}
              view="active"
              colorMode="category"
              extrude={extrude3d}
              view3d={view3d}
              onHover={handleHover}
              onMapReady={handleMapReady}
            />
          </MapErrorBoundary>
        )}
      </div>

      {/* Overlays Layer (pointer-events-none container with pointer-events-auto children) */}
      <div className="absolute inset-0 pointer-events-none p-3">
        {/* Top Left group: Breadcrumb, MapLayerSwitcher, and CompareSummary in column with gap-2 */}
        <div className="absolute top-3 left-3 z-20 flex flex-col items-start gap-2 pointer-events-none lg:static">
          <div className="flex flex-col items-start gap-2 pointer-events-auto z-20 lg:absolute lg:top-3 lg:left-3">
            <Breadcrumb />
            <MapLayerSwitcher data={data} />
            {mapMode === "compare" && <CompareSummary data={data} />}
          </div>

          {/* Legend: in compact follows MapLayerSwitcher with gap-2; on PC (>=1024) positioned at bottom-left */}
          <div className="pointer-events-auto z-20 lg:absolute lg:left-3 lg:bottom-[calc(var(--map-inset-bottom,0px)+12px)]">
            <Legend data={data} />
          </div>
        </div>

        {/* Tools: top-right on compact (<1024), top-right below panel collapse button (top: 56px, right: 12px) on PC (>=1024) */}
        <div className="absolute right-3 top-3 lg:top-[56px] z-20 pointer-events-auto">
          <MapToolbar data={data} onExportPng={handleExportPng} />
        </div>

        {/* Status notice (loading scenario or error): top-center on compact, bottom-center on PC */}
        {(data.loading || data.error) && (
          <div className="absolute left-1/2 -translate-x-1/2 top-14 lg:top-auto lg:bottom-[calc(var(--map-inset-bottom,0px)+12px)] z-20 pointer-events-auto">
            {data.loading && (
              <div className="float-panel px-3.5 py-1.5 text-xs text-foreground shadow-float flex items-center gap-2">
                <span className="animate-spin size-3.5 border-2 border-primary border-t-transparent rounded-full shrink-0" />
                <span>Calculando escenario…</span>
              </div>
            )}
            {data.error && (
              <div className="float-panel px-3.5 py-1.5 text-xs text-destructive border-destructive/40 shadow-float">
                <span>Error: {data.error}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Hover Tooltip with hover intent and interactive actions (hidden when guide is open or on non-hover devices) */}
      {!(typeof document !== "undefined" && document.body?.dataset?.guide === "open") && (
        <MapTooltip
          hover={hover}
          containerWidth={containerRect.width}
          containerHeight={containerRect.height}
          onMouseEnter={() => dispatchTooltip(tooltipIntent.enterTooltip())}
          onMouseLeave={() => dispatchTooltip(tooltipIntent.leaveTooltip())}
        />
      )}
    </div>
  );
}
