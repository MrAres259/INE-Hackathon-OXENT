// ATALAYA Intel - Impact Map Component
"use client";

import React, { useState } from "react";
import type { NewsImpact } from "@/lib/intel/types";
import { FragmentMap } from "@/components/intel/FragmentMap";
import { InfoTip } from "@/components/ui/InfoTip";
import { getItemImpact } from "@/lib/intel/api";

export interface ImpactMapProps {
  impact: NewsImpact;
  itemId: string;
  className?: string;
}

const RISK_BADGES: Record<string, { label: string; class: string }> = {
  rojo: { label: "Crítico", class: "bg-[#b5186b]/15 text-[#8e1053] dark:text-[#e04596] border-[#b5186b]/30" },
  naranja: { label: "Alto", class: "bg-[#ea580c]/15 text-[#c2410c] dark:text-[#fb923c] border-[#ea580c]/30" },
  amarillo: { label: "Medio", class: "bg-[#eab308]/15 text-[#a16207] dark:text-[#fde047] border-[#eab308]/30" },
  verde: { label: "Bajo", class: "bg-[#16a34a]/15 text-[#15803d] dark:text-[#4ade80] border-[#16a34a]/30" },
};

export function ImpactMap({ impact, itemId, className = "" }: ImpactMapProps) {
  const [viewLevel, setViewLevel] = useState<"state" | "mun">("state");
  const [selectedEnt, setSelectedEnt] = useState<string | null>(null);
  const [selectedEntName, setSelectedEntName] = useState<string>("");
  const [munImpact, setMunImpact] = useState<NewsImpact | null>(null);
  const [loadingMun, setLoadingMun] = useState(false);
  const [munError, setMunError] = useState<string | null>(null);
  const [showAssumptions, setShowAssumptions] = useState(false);

  // Drill down into state municipalities
  const handleDrillDown = async (entId: string, entName?: string) => {
    setSelectedEnt(entId);
    setSelectedEntName(entName || entId);
    setLoadingMun(true);
    setMunError(null);

    try {
      const result = await getItemImpact(itemId, "mun", entId);
      setMunImpact(result);
      setViewLevel("mun");
    } catch (err: any) {
      setMunError(err?.detail || err?.message || "No fue posible obtener el impacto municipal.");
    } finally {
      setLoadingMun(false);
    }
  };

  const handleBackToStates = () => {
    setViewLevel("state");
    setSelectedEnt(null);
    setSelectedEntName("");
    setMunImpact(null);
    setMunError(null);
  };

  const activeImpact = viewLevel === "mun" && munImpact ? munImpact : impact;

  const mapIds = activeImpact.units.map((u) => u.id);
  const mapValues: Record<string, number> = {};
  for (const u of activeImpact.units) {
    mapValues[u.id] = u.delta_pp;
  }

  return (
    <div className={`space-y-4 rounded-xl border border-border bg-card p-4 ${className}`} data-testid="impact-map-section">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/80 pb-3">
        <div className="flex items-center gap-2">
          <h4 className="font-display text-sm font-bold text-foreground">
            {viewLevel === "state"
              ? "Impacto territorial estimado en participación"
              : `Impacto en municipios de ${selectedEntName || selectedEnt}`}
          </h4>
          <InfoTip term="impacto_noticia" size="sm" />
          <InfoTip term="fragmento_mapa" size="xs" />
        </div>

        {viewLevel === "mun" && (
          <button
            type="button"
            onClick={handleBackToStates}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded border border-border bg-card text-foreground hover:bg-muted transition-colors cursor-pointer"
            data-testid="btn-back-to-states"
          >
            <span>← Volver a vista estatal</span>
          </button>
        )}
      </div>

      {/* KPIs Summary Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
        <div className="rounded-lg border border-border bg-muted/30 p-2.5 space-y-0.5">
          <span className="text-muted-foreground text-[11px]">Δ Nacional estimado</span>
          <div className="font-mono text-base font-bold text-primary tnum">
            +{impact.delta_pp_national.toFixed(2)} pp
          </div>
        </div>

        <div className="rounded-lg border border-border bg-muted/30 p-2.5 space-y-0.5">
          <span className="text-muted-foreground text-[11px]">Votos en riesgo</span>
          <div className="font-mono text-base font-bold text-[#c8352f] dark:text-[#e0524d] tnum">
            {impact.votos_perdidos_total.toLocaleString("es-MX")}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-muted/30 p-2.5 space-y-0.5">
          <span className="text-muted-foreground text-[11px]">Máximo incremento</span>
          <div className="font-mono text-base font-bold text-foreground tnum">
            +{impact.max_delta_pp.toFixed(2)} pp
          </div>
        </div>
      </div>

      {/* Municipal Loading / Error state */}
      {loadingMun && (
        <div className="flex items-center justify-center p-6 text-xs text-muted-foreground gap-2">
          <svg className="animate-spin size-4 text-primary" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          <span>Cargando datos municipales de {selectedEntName}...</span>
        </div>
      )}

      {munError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive flex items-center justify-between">
          <span>{munError}</span>
          <button
            type="button"
            onClick={handleBackToStates}
            className="underline font-semibold cursor-pointer"
          >
            Volver
          </button>
        </div>
      )}

      {/* If no units exceed 0.05 pp, show clear low-impact message instead of empty map */}
      {activeImpact.units.filter((u) => u.delta_pp >= 0.05).length === 0 ? (
        <div className="rounded-lg border border-border bg-muted/20 p-6 text-center space-y-2" data-testid="low-impact-notice">
          <div className="text-sm font-semibold text-foreground">
            Impacto estimado bajo: ninguna entidad supera 0.05 pp
          </div>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            El impacto nacional estimado es de +{impact.delta_pp_national.toFixed(2)} pp y {impact.votos_perdidos_total.toLocaleString("es-MX")} votos en riesgo. Ninguna demarcación territorial supera el umbral crítico de 0.05 pp de abstención adicional.
          </p>
        </div>
      ) : (
        <>
          {/* 2D Fragment Map */}
      {!loadingMun && (
        <div className="rounded-lg border border-border bg-muted/20 p-2">
          <FragmentMap
            level={viewLevel}
            ent={selectedEnt || undefined}
            ids={mapIds}
            values={mapValues}
            scale={{ kind: "sequential", max: 3, unit: "pp" }}
            context={true}
            onSelect={(id) => {
              if (viewLevel === "state") {
                const target = impact.units.find((u) => u.id === id);
                handleDrillDown(id, target?.name);
              }
            }}
            height={260}
            label={
              viewLevel === "state"
                ? "Entidades federativas afectadas"
                : `Municipios afectados de ${selectedEntName}`
            }
          />
        </div>
      )}

      {/* Units Table */}
      <div className="space-y-1.5">
        <span className="text-xs font-semibold text-foreground">
          {viewLevel === "state" ? "Desglose por entidad federativa:" : "Desglose por municipio:"}
        </span>

        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-[11px] font-semibold text-muted-foreground">
                <th className="py-2 px-3">{viewLevel === "state" ? "Estado" : "Municipio"}</th>
                <th className="py-2 px-3">Δ pp (Banda)</th>
                <th className="py-2 px-3">Votos en riesgo</th>
                <th className="py-2 px-3">Semáforo</th>
                {viewLevel === "state" && <th className="py-2 px-3 text-right">Acción</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {activeImpact.units.map((u) => {
                const beforeBadge = RISK_BADGES[u.category_before] ?? {
                  label: u.category_before,
                  class: "bg-muted text-muted-foreground",
                };
                const afterBadge = RISK_BADGES[u.category_after] ?? {
                  label: u.category_after,
                  class: "bg-muted text-muted-foreground",
                };

                return (
                  <tr key={u.id} className="hover:bg-muted/30 transition-colors">
                    <td className="py-2 px-3 font-medium text-foreground">
                      {u.name}
                      <span className="text-[10px] text-muted-foreground font-mono ml-1.5">
                        ({u.id})
                      </span>
                    </td>
                    <td className="py-2 px-3 font-mono tnum text-primary">
                      +{u.delta_pp.toFixed(2)} pp
                      <span className="text-[10px] text-muted-foreground ml-1 font-sans">
                        ({u.delta_low_pp.toFixed(2)} - {u.delta_high_pp.toFixed(2)})
                      </span>
                    </td>
                    <td className="py-2 px-3 font-mono tnum text-[#c8352f] dark:text-[#e0524d] font-semibold">
                      {u.votos_perdidos.toLocaleString("es-MX")}
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-1 text-[10px] font-medium">
                        <span className={`px-1.5 py-0.2 rounded border ${beforeBadge.class}`}>
                          {beforeBadge.label}
                        </span>
                        <span className="text-muted-foreground">→</span>
                        <span className={`px-1.5 py-0.2 rounded border ${afterBadge.class}`}>
                          {afterBadge.label}
                        </span>
                      </div>
                    </td>
                    {viewLevel === "state" && (
                      <td className="py-2 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleDrillDown(u.id, u.name)}
                          className="px-2 py-0.5 rounded text-[11px] font-semibold text-primary hover:bg-primary-soft transition-colors cursor-pointer"
                          data-testid={`btn-drilldown-${u.id}`}
                        >
                          Ver municipios →
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      </>
      )}

      {/* Assumptions Collapsible Section */}
      <div className="rounded-lg border border-border/80 bg-muted/20">
        <button
          type="button"
          onClick={() => setShowAssumptions((prev) => !prev)}
          className="w-full py-2 px-3 text-xs font-medium text-muted-foreground hover:text-foreground flex items-center justify-between transition-colors cursor-pointer"
          aria-expanded={showAssumptions}
        >
          <div className="flex items-center gap-1.5">
            <svg
              className={`size-3.5 transition-transform ${showAssumptions ? "rotate-90" : ""}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
            <span>Supuestos metodológicos y parámetros de impacto</span>
          </div>
          <div className="flex items-center gap-1">
            <InfoTip term="decaimiento_noticia" size="xs" />
            <InfoTip term="exposicion" size="xs" />
            <InfoTip term="susceptibilidad" size="xs" />
          </div>
        </button>

        {showAssumptions && (
          <div className="p-3 pt-0 border-t border-border/60 text-xs space-y-2 mt-2">
            <ul className="list-disc pl-4 space-y-1 text-muted-foreground text-[11px] leading-relaxed">
              {impact.assumptions.map((assump, idx) => (
                <li key={idx}>{assump}</li>
              ))}
            </ul>

            {impact.params && Object.keys(impact.params).length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {Object.entries(impact.params).map(([k, v]) => (
                  <span
                    key={k}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-card border border-border text-[10px] font-mono text-muted-foreground"
                  >
                    <span className="font-semibold text-foreground">{k}:</span>
                    <span>{String(v)}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
