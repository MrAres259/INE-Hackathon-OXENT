"use client";

import React from "react";
import type { HoverInfo } from "./AtalayaMap";
import { useAtalaya } from "@/lib/state";
import {
  formatPct,
  formatInt,
  formatDeltaPp,
  getAbstencionEsperada,
  getCategoryColor,
  getCategoryLabel,
} from "@/lib/format";
import { deltaColor } from "@/lib/mapStyle";

export interface MapTooltipProps {
  hover: HoverInfo | null;
  containerWidth?: number;
  containerHeight?: number;
}

export function MapTooltip({
  hover,
  containerWidth = 800,
  containerHeight = 600,
}: MapTooltipProps) {
  const { meta } = useAtalaya();

  if (!hover) return null;

  const item = hover.item;
  const isMun = hover.level === "mun";
  const stateName = isMun
    ? meta?.states.find((s) => s.id === hover.ent)?.name ?? `Estado ${hover.ent}`
    : "Entidad Federativa";

  // Position and flipping near edges
  const tooltipWidth = 270;
  const tooltipHeight = 220;
  const flipX = hover.x + tooltipWidth > containerWidth - 16;
  const flipY = hover.y + tooltipHeight > containerHeight - 16;

  const left = flipX ? hover.x - 14 : hover.x + 14;
  const top = flipY ? hover.y - 14 : hover.y + 14;
  const transform = `${flipX ? "translateX(-100%)" : ""} ${flipY ? "translateY(-100%)" : ""}`.trim();

  // Category
  const category = item?.category ?? "sin_dato";
  const catColor = getCategoryColor(category);
  const catLabel = getCategoryLabel(category);

  // Reliable data flag
  const isReliable = item ? item.reliable !== false && item.category !== "sin_dato" : false;

  // Expected abstention (people)
  const abstEsperada = item ? getAbstencionEsperada(item) : 0;

  // Alternate scenario comparisons
  const hasAlt = hover.alt && hover.alt !== hover.base;
  let deltaPp: number | null = null;
  if (hasAlt && hover.alt) {
    if (typeof hover.alt.delta_vs_base_pp === "number") {
      deltaPp = hover.alt.delta_vs_base_pp;
    } else if (
      typeof hover.alt.pred_abstention === "number" &&
      typeof hover.base?.pred_abstention === "number"
    ) {
      deltaPp = (hover.alt.pred_abstention - hover.base.pred_abstention) * 100;
    }
  }

  const isHighNs = typeof item?.ns_rate === "number" && item.ns_rate > 0.3;

  return (
    <div
      data-map-tooltip=""
      className="absolute pointer-events-none z-50 transition-opacity duration-75"
      style={{
        left,
        top,
        transform: transform || undefined,
      }}
    >
      <div className="w-64 bg-slate-900/95 backdrop-blur-md border border-slate-700/80 rounded-xl p-3 shadow-2xl text-white text-xs space-y-2">
        {/* Header: Name, state, category chip */}
        <div className="flex items-start justify-between gap-2 border-b border-slate-800 pb-2">
          <div className="min-w-0">
            <h4 className="font-bold text-white text-sm leading-tight truncate" title={hover.name}>
              {hover.name}
            </h4>
            <div className="text-[10px] text-slate-400 truncate">{stateName}</div>
          </div>
          <span
            className="shrink-0 px-2 py-0.5 rounded text-[10px] font-semibold text-white shadow-xs"
            style={{ backgroundColor: catColor }}
          >
            {catLabel}
          </span>
        </div>

        {/* Abstention metrics */}
        <div className="space-y-1">
          {isReliable && item?.pred_abstention !== null && item?.pred_abstention !== undefined ? (
            <div>
              <div className="flex items-baseline justify-between">
                <span className="text-slate-300">Abstención 2027:</span>
                <span className="font-bold text-white text-sm font-mono">
                  {formatPct(item.pred_abstention)}
                </span>
              </div>
              {item.pred_low !== null &&
                item.pred_low !== undefined &&
                item.pred_high !== null &&
                item.pred_high !== undefined && (
                  <div className="text-[10px] text-slate-400 text-right font-mono">
                    intervalo {formatPct(item.pred_low)} – {formatPct(item.pred_high)}
                  </div>
                )}
            </div>
          ) : (
            <div className="text-slate-400 italic text-[11px]">
              Sin información confiable
            </div>
          )}

          {/* Abstención esperada en personas */}
          {abstEsperada > 0 && (
            <div className="flex items-baseline justify-between text-slate-300">
              <span>Abstención esperada:</span>
              <span className="font-medium text-slate-100 font-mono">
                {formatInt(abstEsperada)} pers.
              </span>
            </div>
          )}

          {/* Alternate scenario (Intervención / Pesimista) */}
          {hasAlt && hover.alt && hover.alt.pred_abstention !== null && (
            <div className="pt-1 mt-1 border-t border-slate-800/80 flex items-baseline justify-between">
              <span className="text-slate-300">Con intervención:</span>
              <div className="flex items-baseline gap-1.5 font-mono">
                <span className="font-bold text-emerald-300">
                  {formatPct(hover.alt.pred_abstention)}
                </span>
                {deltaPp !== null && (
                  <span
                    className="font-semibold text-[11px]"
                    style={{ color: deltaColor(deltaPp) }}
                  >
                    Δ {formatDeltaPp(deltaPp)}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* High NS warning */}
          {isHighNs && (
            <div className="mt-1 text-[10px] text-amber-300/90 flex items-center gap-1.5 bg-amber-950/50 border border-amber-800/60 rounded px-2 py-1">
              <span>⚠️</span>
              <span>
                Alta tasa de cuadernillos no disponibles ({Math.round((item!.ns_rate ?? 0) * 100)}%)
              </span>
            </div>
          )}
        </div>

        {/* Footer click hint */}
        <div className="pt-1.5 border-t border-slate-800 text-[10px] text-slate-400 flex items-center justify-between">
          <span className="text-slate-500 font-mono">Clave INEGI {hover.id}</span>
          <span className="text-emerald-400/90 font-medium">
            {isMun ? "Clic para ver detalle →" : "Clic para ver municipios →"}
          </span>
        </div>
      </div>
    </div>
  );
}
