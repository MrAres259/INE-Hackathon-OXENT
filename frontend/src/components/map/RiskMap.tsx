"use client";

import React, { useState, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import { useAtalaya } from "@/lib/state";
import { useMapRisk } from "@/lib/useMapRisk";
import { Breadcrumb } from "./Breadcrumb";
import { MapToolbar } from "./MapToolbar";
import { RegionSearch } from "./RegionSearch";
import { Legend } from "./Legend";
import { MapTooltip } from "./MapTooltip";
import type { HoverInfo } from "./AtalayaMap";

const MapLoading = () => (
  <div className="absolute inset-0 bg-[#060a13] flex flex-col items-center justify-center text-slate-400 gap-3">
    <svg
      className="animate-spin h-8 w-8 text-emerald-500"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
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
    <span className="text-xs font-medium text-slate-300">
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
  const { mapMode = "semaforo", extrude3d = false } = useAtalaya();

  // Single invocation of useMapRisk per §14.4 / §14.7
  const data = useMapRisk();

  const [hover, setHover] = useState<HoverInfo | null>(null);
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
      className="relative h-full w-full min-h-0 flex-1 overflow-hidden rounded-2xl border border-slate-800 bg-[#060a13]"
    >
      {/* Map View Rendering inside dedicated absolute inset-0 container */}
      <div className="absolute inset-0 [&_.maplibregl-map]:h-full [&_.maplibregl-map]:w-full">
        {mapMode === "compare" ? (
          <CompareSwipe
            data={data}
            extrude={extrude3d}
            onHover={setHover}
          />
        ) : mapMode === "delta" ? (
          <AtalayaMap
            data={data}
            view="alt"
            colorMode="delta"
            extrude={extrude3d}
            onHover={setHover}
          />
        ) : (
          <AtalayaMap
            data={data}
            view="active"
            colorMode="category"
            extrude={extrude3d}
            onHover={setHover}
          />
        )}
      </div>

      {/* Overlays (z-20 above canvas, pointer-events only on cards) */}
      {/* Top Left: Breadcrumb + MapToolbar */}
      <div className="absolute top-3 left-3 z-20 flex flex-col gap-2 pointer-events-none">
        <Breadcrumb />
        <MapToolbar data={data} />
      </div>

      {/* Top Right: RegionSearch */}
      <div className="absolute top-3 right-3 z-20 pointer-events-none">
        <RegionSearch />
      </div>

      {/* Bottom Left: Legend */}
      <div className="absolute bottom-3 left-3 z-20 pointer-events-none">
        <Legend data={data} />
      </div>

      {/* Bottom Right: Status Indicator (Loading scenario or Error) */}
      {(data.loading || data.error) && (
        <div className="absolute bottom-3 right-3 z-20 pointer-events-none">
          {data.loading && (
            <div className="bg-slate-900/90 backdrop-blur-md border border-slate-700/80 px-3 py-1.5 rounded-full text-xs text-slate-300 shadow-xl flex items-center gap-2">
              <span className="animate-spin h-3.5 w-3.5 border-2 border-emerald-400 border-t-transparent rounded-full" />
              <span>Calculando escenario…</span>
            </div>
          )}
          {data.error && (
            <div className="bg-rose-950/90 backdrop-blur-md border border-rose-800/80 px-3 py-1.5 rounded-xl text-xs text-rose-200 shadow-xl">
              <span>Error: {data.error}</span>
            </div>
          )}
        </div>
      )}

      {/* Hover Tooltip following cursor */}
      <MapTooltip
        hover={hover}
        containerWidth={containerRect.width}
        containerHeight={containerRect.height}
      />
    </div>
  );
}
