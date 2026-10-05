"use client";

import React from "react";
import { useAtalaya } from "@/lib/state";
import { CATEGORY_COLORS, CATEGORY_LABELS } from "@/lib/format";
import type { Category } from "@/lib/types";

export function Legend() {
  const { meta, riskItems, simulationResult, scenario } = useAtalaya();

  // Compute category counts
  const counts: Record<Category, number> = {
    verde: 0,
    amarillo: 0,
    naranja: 0,
    rojo: 0,
    sin_dato: 0,
  };

  if (scenario === "intervencion" && simulationResult?.summary?.by_category) {
    Object.assign(counts, simulationResult.summary.by_category);
  } else {
    for (const item of riskItems) {
      if (item.category in counts) {
        counts[item.category]++;
      }
    }
  }

  const categories: { id: Category; label: string; rule: string }[] = meta?.categories ?? [
    { id: "verde", label: "Riesgo Bajo", rule: "< 35 pts" },
    { id: "amarillo", label: "Riesgo Moderado", rule: "35 a 54 pts" },
    { id: "naranja", label: "Riesgo Alto", rule: "55 a 74 pts" },
    { id: "rojo", label: "Riesgo Crítico", rule: "≥ 75 pts" },
    { id: "sin_dato", label: "Sin dato", rule: "Datos insuficientes" },
  ];

  return (
    <div className="bg-slate-900/95 backdrop-blur-sm border border-slate-800 rounded-xl p-3 shadow-lg text-white max-w-xs">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
          Semáforo de Riesgo 2027
        </span>
        <span className="text-[10px] text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded">
          {riskItems.length} zonas
        </span>
      </div>

      <div className="space-y-1.5">
        {categories.map((cat) => {
          const color = CATEGORY_COLORS[cat.id] ?? "#bdbdbd";
          const count = counts[cat.id] ?? 0;

          return (
            <div key={cat.id} className="flex items-center justify-between text-xs gap-2">
              <div className="flex items-center gap-2">
                <span
                  className="w-3.5 h-3.5 rounded-sm shrink-0 border border-black/20 shadow-xs"
                  style={{ backgroundColor: color }}
                />
                <span className="text-slate-200 font-medium text-[11px]">
                  {cat.label}
                </span>
                <span className="text-[10px] text-slate-400 hidden sm:inline">
                  ({cat.rule})
                </span>
              </div>
              <span className="font-mono font-bold text-slate-300 text-[11px] bg-slate-800/80 px-1.5 py-0.5 rounded">
                {count}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
