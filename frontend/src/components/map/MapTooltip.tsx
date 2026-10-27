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
}

export function MapTooltip({
  hover,
  containerWidth = 800,
  containerHeight = 600,
}: MapTooltipProps) {
  const { meta, scenario } = useAtalaya();

  if (!hover) return null;

  const item = hover.item;
  const baseItem = hover.base ?? item;
  const altItem = hover.alt;
  const isAltActive = scenario !== "base" && Boolean(altItem);

  const isMun = hover.level === "mun";
  const stateName = isMun
    ? meta?.states.find((s) => s.id === hover.ent)?.name ?? `Estado ${hover.ent}`
    : "Entidad Federativa";

  // Position and flipping near edges
  const tooltipWidth = 280;
  const tooltipHeight = 230;
  const flipX = hover.x + tooltipWidth > containerWidth - 16;
  const flipY = hover.y + tooltipHeight > containerHeight - 16;

  const left = flipX ? hover.x - 14 : hover.x + 14;
  const top = flipY ? hover.y - 14 : hover.y + 14;
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

  return (
    <div
      data-map-tooltip=""
      className="absolute pointer-events-none z-50 transition-opacity duration-75 [@media(hover:none)]:hidden"
      style={{
        left,
        top,
        transform: transform || undefined,
      }}
    >
      <div className="w-68 float-panel p-3 text-xs space-y-2 shadow-float text-foreground">
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

        {/* Footer click hint */}
        <div className="pt-1.5 border-t border-border text-[10px] text-muted-foreground flex items-center justify-between gap-1">
          <span className="font-mono shrink-0">Clave {hover.id}</span>
          <span className="text-primary font-medium text-right">
            Clic para ver diagnóstico →
          </span>
        </div>
      </div>
    </div>
  );
}
