"use client";

import React, { useRef, useCallback, useEffect, useState } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useAtalaya } from "@/lib/state";
import { createCameraSync, type CameraSyncHandle } from "./compareSync";
import { transitionSummary, type MapRiskData } from "@/lib/mapRisk";
import { AtalayaMap, type HoverInfo } from "./AtalayaMap";
import { MapErrorBoundary } from "./MapErrorBoundary";

export interface CompareSummaryProps {
  data: MapRiskData;
  defaultCollapsed?: boolean;
  className?: string;
}

export function CompareSummary({
  data,
  defaultCollapsed,
  className = "",
}: CompareSummaryProps) {
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (defaultCollapsed !== undefined) return defaultCollapsed;
    return false;
  });

  useEffect(() => {
    if (defaultCollapsed !== undefined) return;
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 1023px), (orientation: landscape) and (max-height: 540px)");
    setIsCollapsed(mq.matches);
    const handler = (e: MediaQueryListEvent) => {
      setIsCollapsed(e.matches);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [defaultCollapsed]);

  const summary =
    data?.base?.mun && data?.alt?.mun
      ? transitionSummary(data.base.mun, data.alt.mun)
      : null;

  if (!summary) return null;

  const altLabel = data?.altLabel ?? "";

  if (isCollapsed) {
    return (
      <button
        type="button"
        data-map-overlay="compare-summary"
        onClick={() => setIsCollapsed(false)}
        className={`float-panel px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-accent flex items-center gap-1.5 cursor-pointer shadow-float pointer-events-auto ${className}`}
        title="Mostrar resumen de comparación"
      >
        <span className="size-2 rounded-full bg-good shrink-0" />
        <span>Resumen</span>
      </button>
    );
  }

  return (
    <div
      data-map-overlay="compare-summary"
      className={`float-panel p-2.5 text-xs font-medium text-foreground shadow-float pointer-events-auto flex flex-col gap-1 [@media(orientation:landscape)_and_(max-height:540px)]:p-1.5 [@media(orientation:landscape)_and_(max-height:540px)]:text-[11px] [@media(orientation:landscape)_and_(max-height:540px)]:max-w-[280px] ${className}`}
      style={{ maxWidth: "min(26rem, calc(100% - 5.5rem))" }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 font-semibold text-foreground">
          <span className="size-2 rounded-full bg-good shrink-0" />
          <span className="tnum">
            Rojo {summary.rojoBase} → {summary.rojoAlt} · {summary.improved} mejoran de categoría
          </span>
        </div>
        <button
          type="button"
          onClick={() => setIsCollapsed(true)}
          className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer shrink-0"
          aria-label="Plegar resumen"
          title="Plegar a pastilla Resumen"
        >
          <svg
            className="size-3.5"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
      {altLabel && (
        <div
          className="text-[11px] text-muted-foreground line-clamp-2 leading-tight"
          title={altLabel}
        >
          {altLabel}
        </div>
      )}
    </div>
  );
}

export interface CompareSwipeProps {
  data: MapRiskData;
  extrude?: boolean;
  view3d?: "inclinada" | "cenital";
  showSummary?: boolean;
  onHover?: (h: HoverInfo | null) => void;
  onMapReady?: (map: MapLibreMap) => void;
  className?: string;
}

export function CompareSwipe({
  data,
  extrude = false,
  view3d,
  showSummary = false,
  onHover,
  onMapReady,
  className = "",
}: CompareSwipeProps) {
  const atalayaContext = useAtalaya();
  const {
    comparePos = 50,
    setComparePos,
    view3d: contextView3d = "inclinada",
  } = atalayaContext;
  const activeView3d: "inclinada" | "cenital" = view3d ?? contextView3d;

  const containerRef = useRef<HTMLDivElement>(null);
  const mapARef = useRef<MapLibreMap | null>(null);
  const mapBRef = useRef<MapLibreMap | null>(null);
  const syncRef = useRef<CameraSyncHandle | null>(null);
  const isDraggingRef = useRef(false);

  // Helper to re-establish sync when both maps are ready
  const updateSync = useCallback(() => {
    syncRef.current?.dispose();
    syncRef.current = null;
    if (mapARef.current && mapBRef.current) {
      syncRef.current = createCameraSync(mapARef.current, mapBRef.current);
    }
  }, []);

  // Handle map ready callbacks for camera synchronization
  const handleMapAReady = useCallback(
    (map: MapLibreMap) => {
      mapARef.current = map;
      onMapReady?.(map);
      updateSync();
    },
    [onMapReady, updateSync]
  );

  const handleMapBReady = useCallback(
    (map: MapLibreMap) => {
      mapBRef.current = map;
      updateSync();
    },
    [updateSync]
  );

  useEffect(() => {
    if (mapBRef.current) {
      try {
        mapBRef.current.getContainer().style.clipPath = `inset(0 0 0 ${comparePos}%)`;
      } catch {}
    }
  }, [comparePos]);

  const handleMapARemove = useCallback((map?: MapLibreMap) => {
    if (!map || !mapARef.current || mapARef.current === map) {
      syncRef.current?.dispose();
      syncRef.current = null;
      mapARef.current = null;
    }
  }, []);

  const handleMapBRemove = useCallback((map?: MapLibreMap) => {
    if (!map || !mapBRef.current || mapBRef.current === map) {
      syncRef.current?.dispose();
      syncRef.current = null;
      mapBRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      syncRef.current?.dispose();
      syncRef.current = null;
    };
  }, []);

  // Pointer dragging handlers for slider handle
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    isDraggingRef.current = true;
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setComparePos(Math.round(pct * 10) / 10);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDraggingRef.current) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {}
      isDraggingRef.current = false;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setComparePos(Math.max(0, comparePos - 2));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setComparePos(Math.min(100, comparePos + 2));
    } else if (e.key === "Home") {
      e.preventDefault();
      setComparePos(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setComparePos(100);
    }
  };

  // Transition summary chip
  const summary =
    data?.base?.mun && data?.alt?.mun
      ? transitionSummary(data.base.mun, data.alt.mun)
      : null;

  const altLabel = data?.altLabel ?? "";

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full select-none overflow-hidden bg-[#eef0f3] ${className}`}
    >
      {/* Left Map: Base scenario (without intervention) */}
      <div className="absolute inset-0">
        <MapErrorBoundary onReset={handleMapARemove}>
          <AtalayaMap
            data={data}
            view="base"
            colorMode="category"
            extrude={extrude}
            view3d={activeView3d}
            controls={false}
            onHover={onHover}
            onMapReady={handleMapAReady}
            onMapRemove={handleMapARemove}
          />
        </MapErrorBoundary>
      </div>

      {/* Right Map: Alternative scenario (with intervention), clipped by swipe position */}
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ clipPath: `inset(0 0 0 ${comparePos}%)` }}
      >
        <MapErrorBoundary onReset={handleMapBRemove}>
          <AtalayaMap
            data={data}
            view="alt"
            colorMode="category"
            extrude={extrude}
            view3d={activeView3d}
            controls={true}
            onHover={onHover}
            onMapReady={handleMapBReady}
            onMapRemove={handleMapBRemove}
          />
        </MapErrorBoundary>
      </div>

      {/* Loading veil on right side while data.alt is null */}
      {!data?.alt && (
        <div
          className="absolute inset-y-0 right-0 z-20 flex flex-col items-center justify-center bg-card/70 backdrop-blur-xs text-muted-foreground pointer-events-none"
          style={{ left: `${comparePos}%` }}
        >
          <div className="flex items-center gap-2 float-panel px-3.5 py-2 text-xs font-medium text-foreground">
            <svg
              className="animate-spin h-4 w-4 text-primary"
              viewBox="0 0 24 24"
              fill="none"
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
            <span>Calculando escenario…</span>
          </div>
        </div>
      )}

      {/* Vertical swipe divider & handle */}
      <div
        className="absolute inset-y-0 z-30 pointer-events-none"
        style={{ left: `${comparePos}%` }}
      >
        {/* Divider line: white with subtle shadow */}
        <div className="absolute inset-y-0 left-0 -translate-x-1/2 w-0.5 bg-white shadow-[0_0_6px_rgba(0,0,0,0.25)]" />

        {/* Labels attached to handle at the height of divider knob (avoids collision with legend, summary, or toolbar) */}
        {comparePos >= 15 && (
          <div
            data-map-overlay="swipe-left-label"
            className="absolute right-7 top-1/2 -translate-y-1/2 pointer-events-none whitespace-nowrap"
          >
            <span className="inline-flex items-center px-2.5 py-1 [@media(orientation:landscape)_and_(max-height:540px)]:px-1.5 [@media(orientation:landscape)_and_(max-height:540px)]:py-0.5 [@media(max-width:380px)]:px-1.5 [@media(max-width:380px)]:py-0.5 rounded-full text-[11px] font-semibold bg-card/90 backdrop-blur-md border border-border text-foreground shadow-float">
              <span className="[@media(orientation:landscape)_and_(max-height:540px)]:hidden [@media(max-width:380px)]:hidden">◀ Sin intervención</span>
              <span className="hidden [@media(orientation:landscape)_and_(max-height:540px)]:inline [@media(max-width:380px)]:inline">◀ Sin</span>
            </span>
          </div>
        )}

        {comparePos <= 85 && (
          <div
            data-map-overlay="swipe-right-label"
            className="absolute left-7 top-1/2 -translate-y-1/2 pointer-events-none whitespace-nowrap"
          >
            <span className="inline-flex items-center px-2.5 py-1 [@media(orientation:landscape)_and_(max-height:540px)]:px-1.5 [@media(orientation:landscape)_and_(max-height:540px)]:py-0.5 [@media(max-width:380px)]:px-1.5 [@media(max-width:380px)]:py-0.5 rounded-full text-[11px] font-semibold bg-card/90 backdrop-blur-md border border-primary text-foreground shadow-float">
              <span className="[@media(orientation:landscape)_and_(max-height:540px)]:hidden [@media(max-width:380px)]:hidden">Con intervención ▶</span>
              <span className="hidden [@media(orientation:landscape)_and_(max-height:540px)]:inline [@media(max-width:380px)]:inline">Con ▶</span>
            </span>
          </div>
        )}

        {/* Draggable knob: 36px, 44px on coarse */}
        <div
          role="slider"
          tabIndex={0}
          data-map-overlay="swipe-handle"
          aria-label="Separador de comparación de escenarios"
          aria-valuenow={Math.round(comparePos)}
          aria-valuemin={0}
          aria-valuemax={100}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onKeyDown={handleKeyDown}
          className="absolute top-1/2 left-0 -translate-x-1/2 -translate-y-1/2 z-10 size-9 [@media(pointer:coarse)]:size-11 [@media(orientation:landscape)_and_(max-height:540px)]:!size-8 rounded-full bg-card border-2 border-primary text-primary shadow-float flex items-center justify-center cursor-ew-resize hover:scale-110 active:scale-95 transition-transform pointer-events-auto focus:outline-none focus:ring-2 focus:ring-primary"
          title="Arrastra o usa flechas ← / → para mover la cortina de comparación"
        >
          <svg
            className="w-4 h-4 text-primary pointer-events-none"
            viewBox="0 0 16 16"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M5.5 3.5L1 8l4.5 4.5V3.5zm5 0V12.5L15 8l-4.5-4.5z" />
          </svg>
        </div>
      </div>

      {showSummary && (
        <div className="absolute top-28 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
          <CompareSummary data={data} />
        </div>
      )}
    </div>
  );
}
