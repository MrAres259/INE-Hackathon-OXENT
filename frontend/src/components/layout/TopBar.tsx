"use client";

import React from "react";
import Link from "next/link";
import { useAtalaya } from "@/lib/state";
import type { ScenarioId } from "@/lib/types";

export function TopBar() {
  const {
    scenario,
    setScenario,
    isMock,
    meta,
    setIsScenarioModalOpen,
    level,
    selectedEnt,
    hasData,
    apiAvailable,
  } = useAtalaya();

  const storeLabel = meta?.store === "opensearch" ? "OpenSearch" : "memoria";

  return (
    <header className="bg-slate-900 text-white border-b border-slate-800 shadow-sm sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        {/* Logo & Title */}
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-emerald-600 text-white font-bold text-lg shadow-inner">
            A
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold tracking-tight text-white text-lg">
                ATALAYA
              </span>
              <span className="text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded border border-slate-700">
                Elección Federal 2027
              </span>
            </div>
            <p className="text-xs text-slate-400 hidden sm:block">
              Predicción y escenarios de riesgo de abstención · INE Reto 2
            </p>
          </div>
        </div>

        {/* Center: Scenario Switcher */}
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg p-1 bg-slate-800 border border-slate-700 text-xs">
            <button
              type="button"
              onClick={() => setScenario("base")}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                scenario === "base"
                  ? "bg-slate-700 text-white shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Base (Inercial)
            </button>
            <button
              type="button"
              onClick={() => setScenario("intervencion")}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                scenario === "intervencion"
                  ? "bg-emerald-700 text-white shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Intervención
            </button>
            <button
              type="button"
              onClick={() => setScenario("pesimista")}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                scenario === "pesimista"
                  ? "bg-amber-800 text-white shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Pesimista
            </button>
          </div>

          {/* Adjust intervention button */}
          <button
            type="button"
            onClick={() => setIsScenarioModalOpen(true)}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-500 transition-colors shadow-sm flex items-center gap-1.5"
            title="Ajustar parámetros de intervención"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
              />
            </svg>
            <span className="hidden md:inline">Ajustar intervención</span>
          </button>
        </div>

        {/* Right: Data indicator & Metodología */}
        <div className="flex items-center gap-3">
          {/* Mock banner indicator */}
          {isMock ? (
            <div className="flex items-center gap-1.5 text-xs bg-amber-950/80 text-amber-300 border border-amber-800/80 px-2.5 py-1 rounded-full">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
              <span className="font-medium">Demostración</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-xs bg-emerald-950/80 text-emerald-300 border border-emerald-800/80 px-2.5 py-1 rounded-full">
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              <span className="font-medium">{storeLabel}</span>
            </div>
          )}

          <Link
            href="/metodologia"
            className="text-xs text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3 py-1.5 rounded-lg transition-colors font-medium flex items-center gap-1"
          >
            <span>Metodología</span>
            <svg
              className="w-3 h-3 text-slate-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </Link>
        </div>
      </div>

      {/* Discreet Banner for Health / Data State */}
      {!hasData ? (
        <div className="bg-amber-950/90 border-t border-amber-800/80 text-amber-200 text-xs px-4 py-2 text-center font-medium flex items-center justify-center gap-2">
          <span className="w-2 h-2 rounded-full bg-amber-400"></span>
          <span>
            Aún no hay datos cargados. Coloque los archivos en <code className="bg-slate-900 px-1 py-0.5 rounded text-white font-mono">data/raw/</code> y ejecute <code className="bg-slate-900 px-1 py-0.5 rounded text-white font-mono">scripts\build_all.ps1</code>.
          </span>
        </div>
      ) : (!apiAvailable || isMock) ? (
        <div className="bg-slate-800/90 border-t border-slate-700 text-slate-300 text-xs px-4 py-1.5 text-center font-medium flex items-center justify-center gap-2">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
          <span>Datos de demostración (API no disponible)</span>
        </div>
      ) : null}
    </header>
  );
}
