"use client";

import React, { useRef, useCallback, useEffect } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useAtalaya } from "@/lib/state";
import { createCameraSync, type CameraSyncHandle } from "./compareSync";
import { transitionSummary, type MapRiskData } from "@/lib/mapRisk";
import { AtalayaMap, type HoverInfo } from "./AtalayaMap";

export interface CompareSwipeProps {
  data: MapRiskData;
  extrude?: boolean;
  onHover?: (h: HoverInfo | null) => void;
  className?: string;
}

export function CompareSwipe({
  data,
  extrude = false,
  onHover,
  className = "",
}: CompareSwipeProps) {
  const { comparePos = 50, setComparePos } = useAtalaya();

  const containerRef = useRef<HTMLDivElement>(null);
  const mapARef = useRef<MapLibreMap | null>(null);
  const mapBRef = useRef<MapLibreMap | null>(null);
  const syncRef = useRef<CameraSyncHandle | null>(null);
  const isDraggingRef = useRef(false);

  // Handle map ready callbacks for camera synchronization
  const handleMapAReady = useCallback((map: MapLibreMap) => {
    mapARef.current = map;
    if (mapBRef.current) {
      syncRef.current?.dispose();
      syncRef.current = createCameraSync(map, mapBRef.current);
    }
  }, []);

  const handleMapBReady = useCallback(
    (map: MapLibreMap) => {
      mapBRef.current = map;
      try {
        map.getContainer().style.clipPath = `inset(0 0 0 ${comparePos}%)`;
      } catch {}
      if (mapARef.current) {
        syncRef.current?.dispose();
        syncRef.current = createCameraSync(mapARef.current, map);
      }
    },
    [comparePos]
  );

  useEffect(() => {
    if (mapBRef.current) {
      try {
        mapBRef.current.getContainer().style.clipPath = `inset(0 0 0 ${comparePos}%)`;
      } catch {}
    }
  }, [comparePos]);

  const handleMapARemove = useCallback(() => {
    syncRef.current?.dispose();
    syncRef.current = null;
    mapARef.current = null;
  }, []);

  const handleMapBRemove = useCallback(() => {
    syncRef.current?.dispose();
    syncRef.current = null;
    mapBRef.current = null;
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
      className={`relative w-full h-full select-none overflow-hidden bg-[#060a13] ${className}`}
    >
      {/* Left Map: Base scenario (without intervention) */}
      <div className="absolute inset-0">
        <AtalayaMap
          data={data}
          view="base"
          colorMode="category"
          extrude={extrude}
          controls={false}
          onHover={onHover}
          onMapReady={handleMapAReady}
          onMapRemove={handleMapARemove}
        />
      </div>

      {/* Right Map: Alternative scenario (with intervention), clipped by swipe position */}
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ clipPath: `inset(0 0 0 ${comparePos}%)` }}
      >
        <AtalayaMap
          data={data}
          view="alt"
          colorMode="category"
          extrude={extrude}
          controls={true}
          onHover={onHover}
          onMapReady={handleMapBReady}
          onMapRemove={handleMapBRemove}
        />
      </div>

      {/* Loading veil on right side while data.alt is null */}
      {!data?.alt && (
        <div
          className="absolute inset-y-0 right-0 z-20 flex flex-col items-center justify-center bg-slate-950/70 backdrop-blur-xs text-slate-300 pointer-events-none"
          style={{ left: `${comparePos}%` }}
        >
          <div className="flex items-center gap-2 bg-slate-900/90 border border-slate-700/80 px-3.5 py-2 rounded-xl shadow-2xl text-xs font-medium text-slate-200">
            <svg
              className="animate-spin h-4 w-4 text-emerald-400"
              viewBox="0 0 24 24"
              fill="none"
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
        {/* Divider line */}
        <div className="absolute inset-y-0 left-0 -translate-x-1/2 w-0.5 bg-white/70 shadow-[0_0_8px_rgba(0,0,0,0.8)]" />

        {/* Labels attached to handle at mid-height */}
        {comparePos >= 15 && (
          <div className="absolute right-7 top-1/2 -translate-y-1/2 pointer-events-none whitespace-nowrap">
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-950/85 backdrop-blur-md border border-slate-700/80 text-slate-200 shadow-xl">
              ◀ Sin intervención
            </span>
          </div>
        )}

        {comparePos <= 85 && (
          <div className="absolute left-7 top-1/2 -translate-y-1/2 pointer-events-none whitespace-nowrap">
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-950/85 backdrop-blur-md border border-emerald-600/80 text-emerald-200 shadow-xl">
              Con intervención ▶
            </span>
          </div>
        )}

        {/* Draggable knob */}
        <div
          role="slider"
          tabIndex={0}
          aria-label="Separador de comparación de escenarios"
          aria-valuenow={Math.round(comparePos)}
          aria-valuemin={0}
          aria-valuemax={100}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onKeyDown={handleKeyDown}
          className="absolute top-1/2 left-0 -translate-x-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-slate-900/95 border-2 border-white shadow-2xl flex items-center justify-center text-white cursor-ew-resize hover:scale-110 active:scale-95 transition-transform pointer-events-auto focus:outline-none focus:ring-2 focus:ring-emerald-400"
          title="Arrastra o usa flechas ← / → para mover la cortina de comparación"
        >
          <svg
            className="w-4 h-4 text-slate-200 pointer-events-none"
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <path d="M5.5 3.5L1 8l4.5 4.5V3.5zm5 0V12.5L15 8l-4.5-4.5z" />
          </svg>
        </div>
      </div>

      {/* Top center summary chip, below the top toolbars */}
      {summary && (
        <div className="absolute top-36 left-1/2 -translate-x-1/2 z-20 pointer-events-none max-w-md w-max">
          <div className="bg-slate-900/90 backdrop-blur-md border border-slate-700/80 px-4 py-2 rounded-xl text-xs font-medium text-slate-200 shadow-xl flex flex-col items-center text-center gap-0.5">
            <div className="flex items-center gap-2 font-semibold">
              <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
              <span>
                Rojo: {summary.rojoBase} → {summary.rojoAlt} municipios · {summary.improved} mejoran de categoría
              </span>
            </div>
            {altLabel && (
              <div className="text-[11px] text-slate-400 max-w-sm truncate" title={altLabel}>
                {altLabel}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
