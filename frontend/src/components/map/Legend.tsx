"use client";

import React, { useState, useEffect } from "react";
import { useAtalaya } from "@/lib/state";
import type { Category, RiskItem } from "@/lib/types";
import type { MapRiskData } from "@/lib/mapRisk";
import { categoryCounts, transitionSummary } from "@/lib/mapRisk";
import {
  categoryLegend,
  deltaLegend,
  type LegendEntry,
} from "@/lib/mapStyle";
import { CATEGORY_COLORS } from "@/lib/format";
import { InfoTip } from "@/components/ui/InfoTip";
import type { GlossaryKey } from "@/lib/glossary";

function ColumnMiniDiagram() {
  return (
    <svg
      className="w-7 h-4 shrink-0"
      viewBox="0 0 28 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect x="1" y="11" width="5" height="5" rx="0.75" fill={CATEGORY_COLORS.verde} />
      <rect x="8" y="8" width="5" height="8" rx="0.75" fill={CATEGORY_COLORS.amarillo} />
      <rect x="15" y="5" width="5" height="11" rx="0.75" fill={CATEGORY_COLORS.naranja} />
      <rect x="22" y="1" width="5" height="15" rx="0.75" fill={CATEGORY_COLORS.rojo} />
    </svg>
  );
}

export interface LegendProps {
  data?: MapRiskData;
  defaultOpen?: boolean;
  className?: string;
}

export function Legend({ data, defaultOpen, className = "" }: LegendProps) {
  const {
    mapMode = "semaforo",
    extrude3d = false,
    riskItems = [],
    scenario = "base",
  } = useAtalaya();

  // Collapsed by default on compact screens (< 1024px)
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (defaultOpen !== undefined) return !defaultOpen;
    if (typeof window !== "undefined") {
      return window.innerWidth < 1024;
    }
    return false;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 1023px)");
    if (defaultOpen === undefined) {
      setIsCollapsed(mq.matches);
    }
    const handler = (e: MediaQueryListEvent) => {
      if (defaultOpen === undefined) {
        setIsCollapsed(e.matches);
      }
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [defaultOpen]);

  // Determine current active municipal index
  let munIndex: Map<string, RiskItem> | null = null;
  if (data) {
    if (mapMode === "delta") {
      munIndex = data.alt?.mun ?? data.base?.mun ?? null;
    } else if (mapMode === "compare") {
      munIndex = data.alt?.mun ?? data.base?.mun ?? null;
    } else {
      munIndex = data.active?.mun ?? data.base?.mun ?? null;
    }
  }

  // Transitions for compare mode
  const transitions =
    mapMode === "compare" && data?.base?.mun && data?.alt?.mun
      ? transitionSummary(data.base.mun, data.alt.mun)
      : null;

  const scenarioLabel =
    scenario === "base"
      ? "Base (inercial)"
      : scenario === "intervencion"
      ? "Intervención"
      : "Pesimista";

  // Delta mode
  if (mapMode === "delta") {
    const deltaEntries: LegendEntry[] = deltaLegend(data?.alt?.mun, data?.base?.mun);

    return (
      <div
        data-tour="leyenda"
        data-map-overlay="legend"
        className={`float-panel overflow-hidden text-xs pointer-events-auto transition-all ${
          isCollapsed ? "w-auto" : "w-52 sm:w-56"
        } ${className}`}
      >
        <div className="flex items-center justify-between gap-1.5 px-3 py-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-display font-bold text-foreground text-xs truncate">
              Cambio vs base
            </span>
            <InfoTip term="modo.delta" size="xs" side="right" />
          </div>
          <button
            type="button"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer shrink-0"
            aria-label={isCollapsed ? "Expandir leyenda" : "Plegar leyenda"}
            title={isCollapsed ? "Expandir leyenda" : "Plegar leyenda"}
          >
            <svg
              className={`size-3.5 transition-transform duration-200 ${
                isCollapsed ? "-rotate-90" : ""
              }`}
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6l4 4 4-4" />
            </svg>
          </button>
        </div>

        {!isCollapsed && (
          <div className="space-y-1.5 border-t border-border px-3 py-2">
            <div className="text-[10px] text-muted-foreground mb-1 leading-snug">
              intervención − base · azul = menos abstención
            </div>
            {deltaEntries.map((e) => (
              <div key={e.key} className="flex items-center justify-between text-xs gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-3.5 h-3.5 rounded-xs shrink-0 border border-black/10 shadow-2xs"
                    style={{ backgroundColor: e.color }}
                  />
                  <span className="text-foreground text-[11px] font-medium truncate">
                    {e.label}
                  </span>
                </div>
                {typeof e.count === "number" && e.count > 0 && (
                  <span className="tnum font-mono text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">
                    {e.count}
                  </span>
                )}
              </div>
            ))}

            {extrude3d && (
              <div className="mt-2 pt-1.5 border-t border-border text-[10px] space-y-0.5">
                <div className="text-primary font-medium flex items-center gap-1.5">
                  <ColumnMiniDiagram />
                  <span>Altura = tamaño del cambio |Δ| (pp)</span>
                </div>
                <div className="text-muted-foreground text-[9px] pl-8">
                  Al acercarte: solo el estado en foco
                </div>
              </div>
            )}

            <div className="pt-1 text-[10px] text-muted-foreground border-t border-border">
              Escenario: {scenarioLabel}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Semáforo or Compare mode
  let counts: Record<Category, number> = {
    verde: 0,
    amarillo: 0,
    naranja: 0,
    rojo: 0,
    sin_dato: 0,
  };

  let totalLn = 0;
  const lnByCategory: Record<Category, number> = {
    verde: 0,
    amarillo: 0,
    naranja: 0,
    rojo: 0,
    sin_dato: 0,
  };

  if (munIndex && munIndex.size > 0) {
    counts = categoryCounts(munIndex);
    for (const item of munIndex.values()) {
      const ln = item.lista_nominal ?? 0;
      totalLn += ln;
      const cat = (item.category in lnByCategory ? item.category : "sin_dato") as Category;
      lnByCategory[cat] += ln;
    }
  } else if (riskItems.length > 0) {
    for (const item of riskItems) {
      const cat = (item.category in counts ? item.category : "sin_dato") as Category;
      counts[cat]++;
      const ln = item.lista_nominal ?? 0;
      totalLn += ln;
      lnByCategory[cat] += ln;
    }
  }

  const entries: LegendEntry[] = categoryLegend(counts);
  const totalCount = munIndex?.size ?? (riskItems.length > 0 ? riskItems.length : 2478);

  return (
    <div
      data-tour="leyenda"
      data-map-overlay="legend"
      className={`float-panel overflow-hidden text-xs pointer-events-auto transition-all ${
        isCollapsed ? "w-auto" : "w-52 sm:w-56"
      } ${className}`}
    >
      <div className="flex items-center justify-between gap-1.5 px-3 py-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="font-display font-bold text-foreground text-xs truncate">
            Semáforo 2027
          </span>
          <InfoTip term="semaforo" size="xs" side="right" />
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!isCollapsed && (
            <span className="tnum font-mono text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              {totalCount}
            </span>
          )}
          <button
            type="button"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer shrink-0"
            aria-label={isCollapsed ? "Expandir leyenda" : "Plegar leyenda"}
            title={isCollapsed ? "Expandir leyenda" : "Plegar leyenda"}
          >
            <svg
              className={`size-3.5 transition-transform duration-200 ${
                isCollapsed ? "-rotate-90" : ""
              }`}
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6l4 4 4-4" />
            </svg>
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <div className="space-y-1.5 border-t border-border px-3 py-2">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground px-0.5 pb-0.5 border-b border-border font-medium">
            <span>Nivel de riesgo</span>
            <div className="flex items-center gap-2.5">
              <span>Mun.</span>
              <span className="flex items-center gap-0.5">
                <span>% LN</span>
                <InfoTip term="pct_ln" size="xs" side="left" />
              </span>
            </div>
          </div>

          {entries.map((entry) => {
            const count = entry.count ?? counts[entry.key as Category] ?? 0;
            const catLn = lnByCategory[entry.key as Category] ?? 0;
            const pctLn = totalLn > 0 ? (catLn / totalLn) * 100 : 0;

            return (
              <div key={entry.key} className="flex items-center justify-between text-xs gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-3 h-3 rounded-xs shrink-0 border border-black/10 shadow-2xs"
                    style={{ backgroundColor: entry.color }}
                  />
                  <span className="text-foreground font-medium text-[11px] truncate">
                    {entry.label}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="tnum font-mono font-bold text-foreground text-[11px] bg-muted px-1.5 py-0.5 rounded">
                    {count}
                  </span>
                  <span
                    className="tnum font-mono text-[10px] text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded"
                    title={catLn > 0 ? `Padrón: ${catLn.toLocaleString("es-MX")} personas` : undefined}
                  >
                    {totalLn > 0 ? `${pctLn.toFixed(1)}%` : "—"}
                  </span>
                </div>
              </div>
            );
          })}

          {mapMode === "compare" && (
            <div className="mt-2 pt-1.5 border-t border-border text-[10px] space-y-1">
              <div className="text-muted-foreground flex items-center justify-between">
                <span>Con intervención</span>
                <span className="italic">Lado izq.: base</span>
              </div>
              {transitions && (
                <div className="flex items-center justify-between bg-muted/50 px-2 py-1.5 rounded-md border border-border text-foreground text-[10px]">
                  <span className="tnum font-mono">
                    Rojo: {transitions.rojoBase} → {transitions.rojoAlt} · {transitions.improved} mejoran
                  </span>
                  <InfoTip
                    term={"comparar.resumen" as unknown as GlossaryKey}
                    size="xs"
                    side="left"
                  />
                </div>
              )}
            </div>
          )}

          {extrude3d && (
            <div className="mt-2 pt-1.5 border-t border-border text-[10px] space-y-0.5">
              <div className="text-primary font-medium flex items-center gap-1.5">
                <ColumnMiniDiagram />
                <span>Altura = índice de riesgo (0–100)</span>
              </div>
              <div className="text-muted-foreground text-[9px] pl-8">
                Al acercarte: solo el estado en foco
              </div>
            </div>
          )}

          <div className="pt-1 text-[10px] text-muted-foreground border-t border-border">
            Escenario: {scenarioLabel}
          </div>
        </div>
      )}
    </div>
  );
}
