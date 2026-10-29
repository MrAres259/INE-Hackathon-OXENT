"use client";

import React from "react";
import { useAtalaya } from "@/lib/state";
import { InfoTip } from "@/components/ui/InfoTip";
import type { GlossaryKey } from "@/lib/glossary";

/**
 * Truncates text in the middle, inserting an ellipsis character.
 * Preserves beginning and end so territorial identifiers stay readable.
 */
export function truncateMiddle(text: string, maxLen = 14): string {
  if (!text || text.length <= maxLen) return text;
  const left = Math.ceil((maxLen - 1) / 2);
  const right = Math.floor((maxLen - 1) / 2);
  return `${text.slice(0, left)}…${text.slice(-right)}`;
}

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
      data-map-overlay="breadcrumb"
      className="float-panel flex items-center gap-1 px-2.5 py-1 text-xs pointer-events-auto max-w-[calc(100vw-24px)] [@media(orientation:landscape)_and_(max-height:540px)]:max-w-[45vw] [@media(max-width:380px)]:max-w-[45vw] overflow-hidden whitespace-nowrap"
    >
      <button
        type="button"
        onClick={resetToNational}
        className={`rounded px-1.5 py-0.5 font-semibold hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer shrink-0 ${
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
            title={stateName ?? undefined}
            className={`rounded px-1.5 py-0.5 font-semibold hover:bg-accent hover:text-accent-foreground transition-colors truncate max-w-[40vw] sm:max-w-none cursor-pointer ${
              !isMun ? "text-primary" : "text-foreground"
            }`}
          >
            <span className="hidden [@media(orientation:landscape)_and_(max-height:540px)]:inline [@media(max-width:380px)]:inline">
              {truncateMiddle(stateName ?? "", 14)}
            </span>
            <span className="inline [@media(orientation:landscape)_and_(max-height:540px)]:hidden [@media(max-width:380px)]:hidden">
              {stateName}
            </span>
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
          <span
            title={munName ?? undefined}
            className="px-1.5 py-0.5 font-semibold text-primary truncate max-w-[40vw] sm:max-w-none"
          >
            <span className="hidden [@media(orientation:landscape)_and_(max-height:540px)]:inline [@media(max-width:380px)]:inline">
              {truncateMiddle(munName ?? "", 14)}
            </span>
            <span className="inline [@media(orientation:landscape)_and_(max-height:540px)]:hidden [@media(max-width:380px)]:hidden">
              {munName}
            </span>
          </span>
        </>
      )}

      {level === "mun" && (
        <button
          type="button"
          onClick={resetToNational}
          className="ml-1 px-1.5 py-0.5 text-[10px] font-bold bg-muted hover:bg-accent text-foreground border border-border rounded transition-colors cursor-pointer shrink-0"
          title="Regresar a vista nacional"
          aria-label="Regresar a vista nacional"
        >
          <span>←</span>
          <span className="[@media(orientation:landscape)_and_(max-height:540px)]:hidden [@media(max-width:380px)]:hidden">
            &nbsp;México
          </span>
        </button>
      )}

      <InfoTip term={"navegacion" as unknown as GlossaryKey} size="xs" side="bottom" />
    </nav>
  );
}
