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

export interface MapTooltipProps {
  hover: HoverInfo | null;
  containerWidth?: number;
  containerHeight?: number;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onSelect?: (hover: HoverInfo) => void;
}

export function MapTooltip({
  hover,
  containerWidth = 800,
  containerHeight = 600,
  onMouseEnter,
  onMouseLeave,
  onSelect,
}: MapTooltipProps) {
  const { meta, scenario, selectRegion, selectState, requestExplain } = useAtalaya();

  if (!hover) return null;

  const item = hover.item;
  const baseItem = hover.base ?? item;
  const altItem = hover.alt;
  const isAltActive = scenario !== "base" && Boolean(altItem);

  const isMun = hover.level === "mun";
  const stateName = isMun
    ? meta?.states.find((s) => s.id === hover.ent)?.name ?? `Estado ${hover.ent}`
    : "Entidad Federativa";

  // Position and flipping near edges (with +16px anchor offset)
  const isLandscape =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(orientation: landscape) and (max-height: 540px)").matches;

  let insetRight = 0;
  let insetBottom = 0;
  if (typeof window !== "undefined" && typeof getComputedStyle === "function") {
    try {
      const root = document.documentElement;
      const ir = parseFloat(getComputedStyle(root).getPropertyValue("--map-inset-right"));
      const ib = parseFloat(getComputedStyle(root).getPropertyValue("--map-inset-bottom"));
      if (!Number.isNaN(ir) && ir > 0) insetRight = ir;
      if (!Number.isNaN(ib) && ib > 0) insetBottom = ib;
    } catch {}
  }

  const tooltipWidth = isLandscape ? 240 : 280;
  const tooltipHeight = isLandscape ? Math.min(220, containerHeight - 24) : 260;

  const usableWidth = Math.max(tooltipWidth + 32, containerWidth - insetRight);
  const usableHeight = Math.max(tooltipHeight + 32, containerHeight - insetBottom);

  const flipX = hover.x + tooltipWidth > usableWidth - 16;
  const flipY = hover.y + tooltipHeight > usableHeight - 16;

  let left = flipX ? hover.x - 16 : hover.x + 16;
  let top = flipY ? hover.y - 16 : hover.y + 16;

  if (!flipX && left + tooltipWidth > usableWidth - 8) {
    left = Math.max(16, usableWidth - tooltipWidth - 8);
  }
  if (flipX && left < 16) {
    left = 16;
  }
  if (top < 16) {
    top = 16;
  }

  const transform = `${flipX ? "translateX(-100%)" : ""} ${flipY ? "translateY(-100%)" : ""}`.trim();

  // Category
  const activeItem = isAltActive ? (altItem ?? baseItem) : (item ?? baseItem);
  const category = activeItem?.category ?? "sin_dato";
  const baseCategory = baseItem?.category ?? "sin_dato";
  const hasCategoryChange = isAltActive && baseCategory !== "sin_dato" && category !== baseCategory;
  const catColor = getCategoryColor(category);
  const catLabel = getCategoryLabel(category);

  // Reliable data flag
  const isReliable = activeItem ? activeItem.reliable !== false && activeItem.category !== "sin_dato" : false;

  // Expected abstention (people)
  const abstEsperada = activeItem ? getAbstencionEsperada(activeItem) : 0;

  // Alternate scenario comparisons
  let deltaPp: number | null = null;
  if (isAltActive && altItem) {
    if (typeof altItem.delta_vs_base_pp === "number") {
      deltaPp = altItem.delta_vs_base_pp;
    } else if (
      typeof altItem.pred_abstention === "number" &&
      typeof baseItem?.pred_abstention === "number"
    ) {
      deltaPp = (altItem.pred_abstention - baseItem.pred_abstention) * 100;
    }
  }

  const deltaFormatted = deltaPp !== null ? formatDeltaPp(deltaPp).replace("-", "−") : null;
  const isHighNs = typeof activeItem?.ns_rate === "number" && activeItem.ns_rate > 0.3;
  const altLabel = scenario === "pesimista" ? "Con escenario pesimista:" : "Con intervención:";

  const handleSelect = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onSelect) {
      onSelect(hover);
    } else if (hover.level === "mun") {
      selectRegion?.(hover.id);
    } else {
      selectState?.(hover.ent || hover.id);
    }
  };

  const handleExplain = (e: React.MouseEvent) => {
    e.stopPropagation();
    requestExplain?.({
      unitId: hover.id,
      name: hover.name,
      level: hover.level,
    });
    if (onSelect) {
      onSelect(hover);
    }
  };

  return (
    <div
      data-map-tooltip=""
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="absolute pointer-events-auto z-50 transition-opacity duration-75 [@media(hover:none)]:hidden max-h-[calc(100vh-24px)]"
      style={{
        left,
        top,
        transform: transform || undefined,
      }}
    >
      <div className="w-68 max-w-[280px] [@media(orientation:landscape)_and_(max-height:540px)]:w-[240px] [@media(orientation:landscape)_and_(max-height:540px)]:max-w-[240px] [@media(orientation:landscape)_and_(max-height:540px)]:p-2 [@media(orientation:landscape)_and_(max-height:540px)]:text-[11px] float-panel p-3 text-xs space-y-2 shadow-float text-foreground">
        {/* Header: Name, state, category chip */}
        <div className="flex items-start justify-between gap-2 border-b border-border pb-2">
          <div className="min-w-0">
            <h4
              className="font-display font-bold text-foreground text-sm leading-tight truncate"
              title={hover.name}
            >
              {hover.name}
            </h4>
            <div className="text-[10px] text-muted-foreground truncate">{stateName}</div>
          </div>
          <span className="inline-flex items-center gap-1.5 shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-muted text-foreground border border-border">
            <span
              className="size-2 rounded-full shrink-0"
              style={{ backgroundColor: catColor }}
            />
            <span>{catLabel}</span>
            {hasCategoryChange && (
              <span className="text-muted-foreground font-normal text-[9px]">
                (antes: {getCategoryLabel(baseCategory)})
              </span>
            )}
          </span>
        </div>

        {/* Abstention metrics */}
        <div className="space-y-1">
          {isReliable ? (
            isAltActive ? (
              // Active scenario: Base first, then Alt
              <div className="space-y-1">
                <div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-muted-foreground">Sin intervención:</span>
                    <span className="tnum font-bold text-foreground text-sm font-mono">
                      {formatPct(baseItem?.pred_abstention)}
                    </span>
                  </div>
                  {baseItem?.pred_low !== null &&
                    baseItem?.pred_low !== undefined &&
                    baseItem?.pred_high !== null &&
                    baseItem?.pred_high !== undefined && (
                      <div className="tnum text-[10px] text-right font-mono mt-0.5">
                        <div className="text-muted-foreground">
                          intervalo {formatPct(baseItem.pred_low)} – {formatPct(baseItem.pred_high)}
                        </div>
                        <div className="text-[9px] text-muted-foreground/75 font-sans">
                          rango probable
                        </div>
                      </div>
                    )}
                </div>

                {altItem && altItem.pred_abstention !== null && altItem.pred_abstention !== undefined && (
                  <div className="pt-1 mt-1 border-t border-border space-y-0.5">
                    <div className="flex items-baseline justify-between">
                      <span className="text-muted-foreground">{altLabel}</span>
                      <span className="tnum font-bold text-primary font-mono">
                        {formatPct(altItem.pred_abstention)}
                      </span>
                    </div>
                    {deltaFormatted !== null && deltaPp !== null && (
                      <div className="tnum text-[10px] text-right font-mono">
                        {deltaPp < -0.01 ? (
                          <span className="text-good font-medium">
                            {deltaFormatted} = menos abstención
                          </span>
                        ) : deltaPp > 0.01 ? (
                          <span className="text-bad font-medium">
                            {deltaFormatted} = más abstención
                          </span>
                        ) : (
                          <span className="text-muted-foreground font-medium">
                            {deltaFormatted} = sin cambio
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              // Base scenario: Single prediction metric
              <div>
                <div className="flex items-baseline justify-between">
                  <span className="text-muted-foreground">Abstención 2027 (pronóstico):</span>
                  <span className="tnum font-bold text-foreground text-sm font-mono">
                    {formatPct(item?.pred_abstention)}
                  </span>
                </div>
                {item?.pred_low !== null &&
                  item?.pred_low !== undefined &&
                  item?.pred_high !== null &&
                  item?.pred_high !== undefined && (
                    <div className="tnum text-[10px] text-right font-mono mt-0.5">
                      <div className="text-muted-foreground">
                        intervalo {formatPct(item.pred_low)} – {formatPct(item.pred_high)}
                      </div>
                      <div className="text-[9px] text-muted-foreground/75 font-sans">
                        rango probable
                      </div>
                    </div>
                  )}
              </div>
            )
          ) : (
            <div className="text-muted-foreground italic text-[11px]">
              Sin información confiable
            </div>
          )}

          {/* Abstención esperada en personas */}
          {abstEsperada > 0 && (
            <div className="flex items-baseline justify-between text-muted-foreground pt-0.5">
              <span>Personas que no votarían:</span>
              <span className="tnum font-medium text-foreground font-mono">
                {formatInt(abstEsperada)} pers.
              </span>
            </div>
          )}

          {/* High NS warning */}
          {isHighNs && (
            <div className="mt-1 text-[10px] text-foreground flex items-center gap-1.5 bg-muted border border-border rounded px-2 py-1">
              <span>⚠️</span>
              <span>
                Alta tasa de cuadernillos no disponibles ({Math.round((item!.ns_rate ?? 0) * 100)}%)
              </span>
            </div>
          )}
        </div>

        {/* Actions: Real buttons with visible focus and click hints */}
        <div className="pt-2 border-t border-border space-y-1.5">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span className="font-mono">Clave {hover.id}</span>
          </div>
          <div className="flex flex-col sm:flex-row gap-1.5">
            <button
              type="button"
              onClick={handleExplain}
              aria-label={`Explicar por qué ${hover.name} tiene este nivel de riesgo`}
              className="flex-1 py-1.5 px-2.5 rounded-md bg-[#b5186b] text-white font-semibold text-xs text-center hover:bg-[#9a145a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b5186b] focus-visible:ring-offset-2 transition-colors cursor-pointer shadow-xs inline-flex items-center justify-center gap-1.5"
            >
              <svg
                className="size-3.5 shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                />
              </svg>
              <span>¿Por qué? Explícame</span>
            </button>
            <button
              type="button"
              onClick={handleSelect}
              className="flex-1 py-1.5 px-2 rounded-md bg-secondary text-secondary-foreground font-semibold text-xs text-center hover:bg-secondary/80 border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-colors cursor-pointer shadow-xs"
            >
              Ver diagnóstico
            </button>
          </div>
          <div className="text-[10px] text-muted-foreground text-center space-y-0.5">
            <div>Te lo explico en palabras sencillas en el asistente</div>
            <div className="text-[9px] text-muted-foreground/75">o haz clic en la zona</div>
          </div>
        </div>
      </div>
    </div>
  );
}
