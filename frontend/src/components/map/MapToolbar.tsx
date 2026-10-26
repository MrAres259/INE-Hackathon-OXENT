"use client";

import React from "react";
import { useAtalaya } from "@/lib/state";
import type { MapRiskData } from "@/lib/mapRisk";
import type { MapMode } from "@/lib/types";

import { InfoTip } from "@/components/ui/InfoTip";

export interface MapToolbarProps {
  data: MapRiskData;
  onExportPng?: () => void;
}

export function MapToolbar({ data, onExportPng }: MapToolbarProps) {
  const {
    mapMode = "semaforo",
    setMapMode,
    extrude3d = false,
    setExtrude3d,
    view3d = "inclinada",
    setView3d,
    setIsScenarioModalOpen,
  } = useAtalaya();

  const currentMode: MapMode = mapMode ?? "semaforo";
  const scenarioLabel = data?.altLabel ?? "";

  return (
    <div className="bg-slate-900/90 backdrop-blur-md border border-slate-700/80 rounded-xl p-1.5 shadow-xl text-white flex flex-col gap-1.5 max-w-xl pointer-events-auto">
      {/* Top row: Mode segment control + 3D toggle + perspective segment + InfoTips */}
      <div className="flex items-center gap-1.5 flex-wrap sm:flex-nowrap">
        {/* Mode group */}
        <div className="flex items-center gap-1">
          <div
            role="group"
            aria-label="Modo de visualización del mapa"
            className="flex items-center bg-slate-950/70 p-0.5 rounded-lg border border-slate-800"
          >
            {/* Mode 1: Semáforo */}
            <button
              type="button"
              role="button"
              aria-pressed={currentMode === "semaforo"}
              onClick={() => setMapMode("semaforo")}
              title="Semáforo: Riesgo de abstención 2027 por semáforo de 4 niveles"
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                currentMode === "semaforo"
                  ? "bg-slate-700 text-white shadow-xs font-semibold"
                  : "text-slate-300 hover:text-white hover:bg-slate-800/60"
              }`}
            >
              <svg
                className="w-3.5 h-3.5 shrink-0"
                viewBox="0 0 16 16"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <circle cx="8" cy="3.5" r="2.2" fill="#10b981" />
                <circle cx="8" cy="8" r="2.2" fill="#f59e0b" />
                <circle cx="8" cy="12.5" r="2.2" fill="#ef4444" />
              </svg>
              <span>Semáforo</span>
            </button>

            {/* Mode 2: Cambio Δ */}
            <button
              type="button"
              role="button"
              aria-pressed={currentMode === "delta"}
              onClick={() => setMapMode("delta")}
              title="Cambio Δ: Diferencia en puntos porcentuales respecto al escenario base (azul = mejora)"
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                currentMode === "delta"
                  ? "bg-slate-700 text-white shadow-xs font-semibold"
                  : "text-slate-300 hover:text-white hover:bg-slate-800/60"
              }`}
            >
              <svg
                className="w-3.5 h-3.5 shrink-0"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 2.5l5.5 10.5H2.5L8 2.5z" />
              </svg>
              <span>Cambio Δ</span>
            </button>

            {/* Mode 3: Comparar */}
            <button
              type="button"
              role="button"
              aria-pressed={currentMode === "compare"}
              onClick={() => setMapMode("compare")}
              title="Comparar: Cortina deslizante entre escenario base y escenario alterno"
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                currentMode === "compare"
                  ? "bg-slate-700 text-white shadow-xs font-semibold"
                  : "text-slate-300 hover:text-white hover:bg-slate-800/60"
              }`}
            >
              <svg
                className="w-3.5 h-3.5 shrink-0"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
              >
                <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
                <line x1="8" y1="2.5" x2="8" y2="13.5" strokeDasharray="2 1.5" />
              </svg>
              <span>Comparar</span>
            </button>
          </div>

          <InfoTip
            term="modo.semaforo"
            title="Modos de visualización"
            text="Semáforo: colorea cada zona con su categoría de riesgo en el escenario activo. Cambio Δ: diferencia de abstención entre el escenario alterno y el base en pp (azul = mejora). Comparar: cortina deslizable entre escenario base e intervención."
            side="bottom"
          />
        </div>

        {/* 3D toggle button */}
        <button
          type="button"
          role="button"
          aria-pressed={extrude3d}
          onClick={() => setExtrude3d(!extrude3d)}
          title="Columnas 3D: altura = índice de riesgo (rojo más alto)"
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all border ${
            extrude3d
              ? "bg-emerald-600/30 text-emerald-300 border-emerald-500/60 shadow-xs font-semibold"
              : "bg-slate-950/70 text-slate-300 hover:text-white border-slate-800 hover:bg-slate-800/60"
          }`}
        >
          <svg
            className="w-3.5 h-3.5 shrink-0"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 1.5l5.5 3.2v6.6L8 14.5l-5.5-3.2V4.7L8 1.5z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 1.5v13M2.5 4.7l5.5 3.5 5.5-3.5" />
          </svg>
          <span>3D</span>
        </button>

        {/* 3D view toggle when 3D is active */}
        {extrude3d && (
          <div
            role="group"
            aria-label="Perspectiva 3D"
            className="flex items-center bg-slate-950/70 p-0.5 rounded-lg border border-slate-800"
          >
            <button
              type="button"
              role="button"
              aria-pressed={view3d === "inclinada"}
              onClick={() => setView3d("inclinada")}
              title="Vista inclinada: perspectiva para apreciar la altura de las columnas"
              className={`px-2 py-1 rounded-md text-xs font-medium transition-all ${
                view3d === "inclinada"
                  ? "bg-slate-700 text-white shadow-xs font-semibold"
                  : "text-slate-300 hover:text-white hover:bg-slate-800/60"
              }`}
            >
              Inclinada
            </button>
            <button
              type="button"
              role="button"
              aria-pressed={view3d === "cenital"}
              onClick={() => setView3d("cenital")}
              title="Vista cenital: vista desde arriba manteniendo las columnas"
              className={`px-2 py-1 rounded-md text-xs font-medium transition-all ${
                view3d === "cenital"
                  ? "bg-slate-700 text-white shadow-xs font-semibold"
                  : "text-slate-300 hover:text-white hover:bg-slate-800/60"
              }`}
            >
              Cenital
            </button>
          </div>
        )}

        {/* 3D InfoTip */}
        <InfoTip term="modo.3d" side="bottom" />

        {/* PNG export button */}
        {onExportPng && (
          <button
            type="button"
            role="button"
            onClick={onExportPng}
            title="Exportar imagen PNG del mapa"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all border bg-slate-950/70 text-slate-300 hover:text-white border-slate-800 hover:bg-slate-800/60"
          >
            <svg
              className="w-3.5 h-3.5 shrink-0"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.5 11.5v2h11v-2M8 2.5v7m0 0l-2.5-2.5M8 9.5l2.5-2.5" />
            </svg>
            <span>PNG</span>
          </button>
        )}
      </div>

      {/* Bottom row: Alternate scenario label from data.altLabel + Adjust button */}
      <div className="flex items-center justify-between gap-2 px-1 text-[11px] text-slate-300 border-t border-slate-800/80 pt-1">
        <span className="truncate text-slate-400" title={scenarioLabel}>
          {scenarioLabel || "Escenario base"}
        </span>
        <button
          type="button"
          onClick={() => setIsScenarioModalOpen(true)}
          className="shrink-0 text-[10px] font-semibold text-emerald-400 hover:text-emerald-300 bg-slate-800/80 hover:bg-slate-800 border border-slate-700 px-2 py-0.5 rounded transition-colors"
          title="Ajustar parámetros del escenario"
        >
          Ajustar
        </button>
      </div>
    </div>
  );
}
