"use client";

import React, { useState, useEffect } from "react";
import { useAtalaya } from "@/lib/state";
import type { MapRiskData } from "@/lib/mapRisk";
import type { MapMode } from "@/lib/types";

import { InfoTip } from "@/components/ui/InfoTip";
import { MapGuide, shouldShowGuide } from "./MapGuide";

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

  const [guideOpen, setGuideOpen] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      if (shouldShowGuide(window.localStorage)) {
        setGuideOpen(true);
      }
    }
  }, []);

  const currentMode: MapMode = mapMode ?? "semaforo";
  const scenarioLabel = data?.altLabel ?? "";

  return (
    <div className="flex flex-col gap-2 pointer-events-none">
      <div className="bg-slate-900/90 backdrop-blur-md border border-slate-700/80 rounded-xl p-1.5 shadow-xl text-white flex flex-col gap-1.5 w-fit max-w-[calc(100vw-340px)] lg:max-w-[calc(65vw-390px)] pointer-events-auto">
        {/* Top row / wrap container: Mode segment + 3D / Tools */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Group 1: Modes segment + Modes InfoTip */}
          <div className="flex items-center gap-1 shrink-0">
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
                className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-all whitespace-nowrap ${
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
                <span className="whitespace-nowrap">Semáforo</span>
              </button>

              {/* Mode 2: Cambio Δ */}
              <button
                type="button"
                role="button"
                aria-pressed={currentMode === "delta"}
                onClick={() => setMapMode("delta")}
                title="Cambio Δ: Diferencia en puntos porcentuales respecto al escenario base (azul = mejora)"
                className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-all whitespace-nowrap ${
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
                <span className="whitespace-nowrap">Cambio&nbsp;Δ</span>
              </button>

              {/* Mode 3: Comparar */}
              <button
                type="button"
                role="button"
                aria-pressed={currentMode === "compare"}
                onClick={() => setMapMode("compare")}
                title="Comparar: Cortina deslizante entre escenario base y escenario alterno"
                className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-all whitespace-nowrap ${
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
                <span className="whitespace-nowrap">Comparar</span>
              </button>
            </div>

            {/* InfoTip 1: Modes of visualization */}
            <InfoTip
              term="modo.semaforo"
              title="Modos de visualización"
              text="Semáforo: colorea cada zona con su categoría de riesgo en el escenario activo. Cambio Δ: diferencia de abstención entre el escenario alterno y el base en pp (azul = mejora). Comparar: cortina deslizable entre escenario base e intervención."
              side="bottom"
            />
          </div>

          {/* Group 2: 3D toggle + Perspective segment + 3D InfoTip + Guía (?) + PNG */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* 3D toggle button */}
            <button
              type="button"
              role="button"
              aria-pressed={extrude3d}
              onClick={() => setExtrude3d(!extrude3d)}
              title="Columnas 3D: altura = índice de riesgo (rojo más alto)"
              className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium transition-all border whitespace-nowrap shrink-0 ${
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
              <span className="whitespace-nowrap">3D</span>
            </button>

            {/* 3D view toggle when 3D is active: compact icons with title */}
            {extrude3d && (
              <div
                role="group"
                aria-label="Perspectiva 3D"
                className="flex items-center bg-slate-950/70 p-0.5 rounded-lg border border-slate-800 shrink-0"
              >
                <button
                  type="button"
                  role="button"
                  aria-pressed={view3d === "inclinada"}
                  onClick={() => setView3d("inclinada")}
                  title="Vista inclinada: perspectiva para apreciar la altura de las columnas"
                  aria-label="Vista inclinada"
                  className={`flex items-center justify-center p-1.5 rounded-md text-xs font-medium transition-all whitespace-nowrap ${
                    view3d === "inclinada"
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
                    aria-hidden="true"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.5 12l4-2.5h7l-4 2.5h-7z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.5 9.5V3.5l3 1.8v4.2" />
                  </svg>
                  <span className="sr-only">Inclinada</span>
                </button>
                <button
                  type="button"
                  role="button"
                  aria-pressed={view3d === "cenital"}
                  onClick={() => setView3d("cenital")}
                  title="Vista cenital: vista desde arriba manteniendo las columnas"
                  aria-label="Vista cenital"
                  className={`flex items-center justify-center p-1.5 rounded-md text-xs font-medium transition-all whitespace-nowrap ${
                    view3d === "cenital"
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
                    aria-hidden="true"
                  >
                    <circle cx="8" cy="8" r="5.5" />
                    <circle cx="8" cy="8" r="1.5" fill="currentColor" />
                    <path strokeLinecap="round" d="M8 1v2M8 13v2M1 8h2M13 8h2" />
                  </svg>
                  <span className="sr-only">Cenital</span>
                </button>
              </div>
            )}

            {/* InfoTip 2: 3D columns & perspective */}
            <div className="shrink-0">
              <InfoTip
                term="modo.3d"
                title="Vista 3D (Columnas)"
                text="Columnas sobre cada zona: altura = índice de riesgo (rojo más alto) o magnitud de cambio |Δ|. Usa Inclinada para ver alturas o Cenital para vista desde arriba."
                side="bottom"
              />
            </div>

            {/* Guía button to toggle MapGuide: icon-only question mark in circle */}
            <button
              type="button"
              role="button"
              aria-label="Cómo leer este mapa"
              aria-pressed={guideOpen}
              onClick={() => setGuideOpen((prev) => !prev)}
              title="Cómo leer este mapa"
              className={`flex items-center justify-center p-1.5 rounded-lg text-xs font-medium transition-all border shrink-0 ${
                guideOpen
                  ? "bg-emerald-600/30 text-emerald-300 border-emerald-500/60 shadow-xs font-semibold"
                  : "bg-slate-950/70 text-slate-300 hover:text-white border-slate-800 hover:bg-slate-800/60"
              }`}
            >
              <svg
                className="w-3.5 h-3.5 shrink-0 text-emerald-400"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM8.94 6.94a.75.75 0 11-1.061-1.061 3 3 0 112.871 5.026v.345a.75.75 0 01-1.5 0v-.5c0-.72.57-1.172 1.081-1.287A1.5 1.5 0 108.94 6.94zM10 15a1 1 0 100-2 1 1 0 000 2z"
                  clipRule="evenodd"
                />
              </svg>
            </button>

            {/* PNG export button */}
            {onExportPng && (
              <button
                type="button"
                role="button"
                onClick={onExportPng}
                title="Exportar imagen PNG del mapa"
                className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium transition-all border bg-slate-950/70 text-slate-300 hover:text-white border-slate-800 hover:bg-slate-800/60 whitespace-nowrap shrink-0"
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
                <span className="whitespace-nowrap">PNG</span>
              </button>
            )}
          </div>
        </div>

        {/* Bottom row: Alternate scenario label from data.altLabel + Adjust button */}
        <div className="flex items-center justify-between gap-2 px-1 text-[11px] text-slate-300 border-t border-slate-800/80 pt-1">
          <span className="truncate text-slate-400" title={scenarioLabel}>
            {scenarioLabel || "Escenario base"}
          </span>
          <button
            type="button"
            onClick={() => setIsScenarioModalOpen(true)}
            className="shrink-0 text-[10px] font-semibold text-emerald-400 hover:text-emerald-300 bg-slate-800/80 hover:bg-slate-800 border border-slate-700 px-2 py-0.5 rounded transition-colors whitespace-nowrap"
            title="Ajustar parámetros del escenario"
          >
            Ajustar
          </button>
        </div>
      </div>

      {/* First-visit or reopened Guide card */}
      <MapGuide open={guideOpen} onClose={() => setGuideOpen(false)} />
    </div>
  );
}
