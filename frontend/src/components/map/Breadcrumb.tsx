"use client";

import React from "react";
import { useAtalaya } from "@/lib/state";
import { InfoTip } from "@/components/ui/InfoTip";
import type { GlossaryKey } from "@/lib/glossary";

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
    <nav
      aria-label="Migas de navegación territorial"
      className="float-panel flex items-center gap-1 px-2.5 py-1 text-xs pointer-events-auto max-w-[calc(100vw-24px)] overflow-hidden"
    >
      <button
        type="button"
        onClick={resetToNational}
        className={`rounded px-1.5 py-0.5 font-semibold hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer ${
          !selectedEnt ? "text-primary" : "text-foreground"
        }`}
      >
        México
      </button>

      {selectedEnt && (
        <>
          <svg
            className="size-3 text-muted-foreground shrink-0"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 12l4-4-4-4" />
          </svg>
          <button
            type="button"
            onClick={() => selectState(selectedEnt)}
            className={`rounded px-1.5 py-0.5 font-semibold hover:bg-accent hover:text-accent-foreground transition-colors truncate max-w-[40vw] sm:max-w-none cursor-pointer ${
              !isMun ? "text-primary" : "text-foreground"
            }`}
          >
            {stateName}
          </button>
        </>
      )}

      {isMun && munName && (
        <>
          <svg
            className="size-3 text-muted-foreground shrink-0"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 12l4-4-4-4" />
          </svg>
          <span className="px-1.5 py-0.5 font-semibold text-primary truncate max-w-[40vw] sm:max-w-none">
            {munName}
          </span>
        </>
      )}

      {level === "mun" && (
        <button
          type="button"
          onClick={resetToNational}
          className="ml-1 px-1.5 py-0.5 text-[10px] font-bold bg-muted hover:bg-accent text-foreground border border-border rounded transition-colors cursor-pointer"
          title="Regresar a vista nacional"
        >
          ← México
        </button>
      )}

      <InfoTip term={"navegacion" as unknown as GlossaryKey} size="xs" side="bottom" />
    </nav>
  );
}
