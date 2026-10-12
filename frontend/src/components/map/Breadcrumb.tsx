"use client";

import React from "react";
import { useAtalaya } from "@/lib/state";

export function Breadcrumb() {
  const {
    level,
    selectedEnt,
    selectedRegionId,
    selectedDetail,
    meta,
    resetToNational,
    selectState,
  } = useAtalaya();

  const stateName = selectedEnt
    ? meta?.states.find((s) => s.id === selectedEnt)?.name ?? `Estado ${selectedEnt}`
    : null;

  const isMun = selectedRegionId && selectedRegionId.length === 5;
  const munName = isMun && selectedDetail ? selectedDetail.name : null;

  return (
    <nav className="flex items-center gap-1.5 text-xs text-slate-300 bg-slate-900/90 backdrop-blur-md border border-slate-700/80 px-3 py-1.5 rounded-xl shadow-xl pointer-events-auto">
      <button
        type="button"
        onClick={resetToNational}
        className="font-medium hover:text-white hover:underline transition-colors flex items-center gap-1 text-slate-200"
      >
        <span>México (Nacional)</span>
      </button>

      {selectedEnt && (
        <>
          <span className="text-slate-500">/</span>
          <button
            type="button"
            onClick={() => selectState(selectedEnt)}
            className={`font-medium hover:text-white transition-colors ${
              !isMun ? "text-emerald-400 font-semibold" : "hover:underline text-slate-200"
            }`}
          >
            {stateName}
          </button>
        </>
      )}

      {isMun && munName && (
        <>
          <span className="text-slate-500">/</span>
          <span className="font-semibold text-emerald-400">{munName}</span>
        </>
      )}

      {level === "mun" && (
        <button
          type="button"
          onClick={resetToNational}
          className="ml-2 px-2 py-0.5 text-[10px] font-bold bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 rounded transition-colors"
          title="Regresar a vista nacional"
        >
          ← México
        </button>
      )}
    </nav>
  );
}
