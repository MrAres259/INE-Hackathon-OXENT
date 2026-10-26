"use client";

import React, { useState } from "react";
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
  data: MapRiskData;
}

export function Legend({ data }: LegendProps) {
  const { mapMode = "semaforo", extrude3d = false, riskItems = [] } = useAtalaya();
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Determine current active municipal index
  let munIndex: Map<string, RiskItem> | null = null;
  if (data) {
    if (mapMode === "delta") {
      munIndex = data.alt?.mun ?? data.base?.mun ?? null;
    } else if (mapMode === "compare") {
      // In compare mode: counts for "con intervención"
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

  // Delta mode
  if (mapMode === "delta") {
    const deltaEntries: LegendEntry[] = deltaLegend(data?.alt?.mun, data?.base?.mun);

    return (
      <div className="bg-slate-900/95 backdrop-blur-md border border-slate-700/80 rounded-xl p-3 shadow-2xl text-white max-w-sm pointer-events-auto">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-1">
            <span className="text-xs font-bold text-slate-200">
              Cambio en abstención (pp)
            </span>
            <InfoTip term="modo.delta" side="right" />
          </div>
          <button
            type="button"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="text-[10px] text-slate-400 hover:text-slate-200 p-1 rounded hover:bg-slate-800 transition-colors"
            title={isCollapsed ? "Expandir leyenda" : "Colapsar leyenda"}
          >
            {isCollapsed ? "▼" : "▲"}
          </button>
        </div>
        <div className="text-[10px] text-slate-400 mb-2">intervención − base · azul = menos abstención</div>

        {!isCollapsed && (
          <div className="space-y-1">
            {deltaEntries.map((e) => (
              <div key={e.key} className="flex items-center justify-between text-xs gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className="w-3.5 h-3.5 rounded-sm shrink-0 border border-black/30 shadow-xs"
                    style={{ backgroundColor: e.color }}
                  />
                  <span className="text-slate-300 text-[11px] font-medium">{e.label}</span>
                </div>
                {typeof e.count === "number" && e.count > 0 && (
                  <span className="font-mono text-[10px] text-slate-400 bg-slate-800/80 px-1.5 py-0.5 rounded">
                    {e.count}
                  </span>
                )}
              </div>
            ))}

            {extrude3d && (
              <div className="mt-2 pt-1.5 border-t border-slate-800 text-[10px] text-emerald-400 font-medium flex items-center gap-1.5">
                <ColumnMiniDiagram />
                <span>Altura = tamaño del cambio |Δ| (pp)</span>
              </div>
            )}
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
    <div className="bg-slate-900/95 backdrop-blur-md border border-slate-700/80 rounded-xl p-3 shadow-2xl text-white max-w-sm pointer-events-auto">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div>
          <div className="flex items-center gap-1">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-200 block">
              Semáforo de Riesgo 2027
            </span>
            <InfoTip term="semaforo" side="right" />
          </div>
          <span className="text-[10px] text-slate-400">
            Conteo de municipios
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded font-mono">
            {totalCount} mun.
          </span>
          <button
            type="button"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="text-[10px] text-slate-400 hover:text-slate-200 p-1 rounded hover:bg-slate-800 transition-colors"
            title={isCollapsed ? "Expandir leyenda" : "Colapsar leyenda"}
          >
            {isCollapsed ? "▼" : "▲"}
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[10px] text-slate-400 px-0.5 pb-0.5 border-b border-slate-800/60 font-medium">
            <span>Nivel de riesgo</span>
            <div className="flex items-center gap-3">
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
                <div className="flex items-center gap-2">
                  <span
                    className="w-3.5 h-3.5 rounded-sm shrink-0 border border-black/30 shadow-xs"
                    style={{ backgroundColor: entry.color }}
                  />
                  <span className="text-slate-200 font-medium text-[11px]">
                    {entry.label}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="font-mono font-bold text-slate-300 text-[11px] bg-slate-800/80 px-1.5 py-0.5 rounded">
                    {count}
                  </span>
                  <span
                    className="font-mono text-[10px] text-slate-400 bg-slate-800/50 px-1.5 py-0.5 rounded"
                    title={catLn > 0 ? `Padrón: ${catLn.toLocaleString("es-MX")} personas` : undefined}
                  >
                    {totalLn > 0 ? `${pctLn.toFixed(1)}% LN` : "—"}
                  </span>
                </div>
              </div>
            );
          })}

          {mapMode === "compare" && (
            <div className="mt-2 pt-1.5 border-t border-slate-800 text-[10px] space-y-1.5">
              <div className="text-slate-400 flex items-center justify-between">
                <span>Con intervención</span>
                <span className="text-slate-400 italic font-medium">Lado izquierdo: base</span>
              </div>
              {transitions && (
                <div className="flex items-center justify-between bg-slate-950/60 px-2 py-1.5 rounded-lg border border-slate-800 text-slate-300">
                  <span className="font-mono text-[10px]">
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
            <div className="mt-2 pt-1.5 border-t border-slate-800 text-[10px] text-emerald-400 font-medium flex items-center gap-1.5">
              <ColumnMiniDiagram />
              <span>Altura = índice de riesgo (0–100)</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
