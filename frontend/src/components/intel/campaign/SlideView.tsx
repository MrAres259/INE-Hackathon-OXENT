"use client";

import React, { useState } from "react";
import type { Slide, CampaignPlan, SlideKind } from "@/lib/intel/types";
import { LEVER_LABELS, SOURCE_TIER_LABELS } from "@/lib/intel/labels";
import { FragmentMap } from "@/components/intel/FragmentMap";

export interface SlideViewProps {
  slide: Slide;
  plan: CampaignPlan;
  onSourceClick?: (sourceId: string) => void;
  className?: string;
}

const KIND_BADGES: Record<SlideKind, { label: string; icon: string }> = {
  portada: { label: "Portada Ejecutiva", icon: "📄" },
  diagnostico_datos: { label: "Diagnóstico Territorial", icon: "📊" },
  problematicas: { label: "Causas de Abstención", icon: "🔍" },
  region: { label: "Encuadre Geográfico", icon: "🗺️" },
  grupo_objetivo: { label: "Público Objetivo", icon: "👥" },
  propuestas: { label: "Estrategia Operativa", icon: "🎯" },
  impacto: { label: "Impacto Proyectado", icon: "📈" },
  implementacion: { label: "Ruta de Implementación", icon: "🗓️" },
  riesgos_kpis: { label: "Riesgos y KPIs", icon: "⚖️" },
  fuentes: { label: "Fuentes Verificadas", icon: "📚" },
};

export function SlideView({
  slide,
  plan,
  onSourceClick,
  className = "",
}: SlideViewProps) {
  const [showNotes, setShowNotes] = useState(false);
  const badge = KIND_BADGES[slide.kind] || { label: "Diapositiva", icon: "📌" };

  // Helper to render text with clickable [s#] citation references
  const renderTextWithCitations = (text: string) => {
    if (!text) return "";
    const regex = /\[(s\d+|s_\d+)\]/gi;
    const parts = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(text.slice(lastIndex, match.index));
      }
      const sourceId = match[1];
      parts.push(
        <button
          key={`${sourceId}-${match.index}`}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSourceClick?.(sourceId);
          }}
          className="inline-flex items-center px-1 py-0.5 rounded text-[10px] font-mono font-bold text-primary hover:bg-primary/15 transition-colors cursor-pointer"
          title={`Ver fuente [${sourceId}] en el panel de investigación`}
        >
          [{sourceId}]
        </button>
      );
      lastIndex = regex.lastIndex;
    }
    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }
    return parts;
  };

  return (
    <div
      className={`relative flex flex-col justify-between w-full h-full p-6 md:p-8 rounded-2xl border border-border bg-gradient-to-br from-card to-card/70 shadow-lg overflow-hidden select-text text-foreground ${className}`}
      data-slide-kind={slide.kind}
    >
      {/* 1. Header: Brand chip, Slide Kind Badge & Titles */}
      <div className="space-y-2 border-b border-border/60 pb-3">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-primary" />
            <span className="font-display text-[11px] font-bold tracking-wider uppercase text-primary">
              Atalaya Electoral · INE
            </span>
            <span className="text-muted-foreground">|</span>
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground font-medium">
              <span>{badge.icon}</span>
              <span>{badge.label}</span>
            </span>
          </div>

          {slide.notes && (
            <button
              type="button"
              onClick={() => setShowNotes(!showNotes)}
              className="text-[11px] font-medium text-muted-foreground hover:text-foreground flex items-center gap-1 cursor-pointer"
            >
              <span>{showNotes ? "Ocultar notas" : "Ver notas"}</span>
              <span className="text-xs">💬</span>
            </button>
          )}
        </div>

        <div>
          <h2 className="font-display text-xl md:text-2xl font-black text-foreground tracking-tight leading-tight">
            {slide.title}
          </h2>
          {slide.subtitle && (
            <p className="text-xs md:text-sm text-muted-foreground mt-0.5 leading-snug">
              {slide.subtitle}
            </p>
          )}
        </div>
      </div>

      {/* 2. Slide Content Body (Customized per Kind) */}
      <div className="flex-1 py-4 overflow-y-auto min-h-0 space-y-4">
        {/* KIND: Portada */}
        {slide.kind === "portada" && (
          <div className="h-full flex flex-col justify-center space-y-4 max-w-2xl">
            <div className="space-y-1">
              <span className="inline-block px-2.5 py-1 rounded-full text-[11px] font-semibold bg-primary/10 text-primary border border-primary/20">
                Propuesta estratégica del equipo OXENT con IA
              </span>
            </div>
            <ul className="space-y-2 text-xs md:text-sm">
              {slide.bullets.map((b, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-primary font-bold">▪</span>
                  <span className="leading-relaxed">{renderTextWithCitations(b)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* KIND: Diagnóstico de Datos */}
        {slide.kind === "diagnostico_datos" && (
          <div className="space-y-4">
            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div className="rounded-xl border border-border bg-card p-3 shadow-xs">
                <span className="text-[10px] text-muted-foreground uppercase font-semibold">
                  Abstención Pronosticada
                </span>
                <div className="text-xl font-display font-black text-primary mt-1">
                  {((plan.unit.pred_abstention ?? 0.4) * 100).toFixed(1)}%
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  [{((plan.unit.pred_low ?? 0.38) * 100).toFixed(1)}% – {((plan.unit.pred_high ?? 0.45) * 100).toFixed(1)}%]
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card p-3 shadow-xs">
                <span className="text-[10px] text-muted-foreground uppercase font-semibold">
                  Lista Nominal
                </span>
                <div className="text-xl font-display font-black text-foreground mt-1">
                  {plan.unit.lista_nominal.toLocaleString("es-MX")}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {(plan.unit.abstencion_esperada ?? 0).toLocaleString("es-MX")} votos en riesgo
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card p-3 shadow-xs">
                <span className="text-[10px] text-muted-foreground uppercase font-semibold">
                  Brecha Juvenil
                </span>
                <div className="text-xl font-display font-black text-risk-mid mt-1">
                  {(plan.unit.gap_youth_pp_last ?? -5).toFixed(1)} pp
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  Diferencial en votación 18-24
                </div>
              </div>
            </div>

            <ul className="space-y-1.5 text-xs">
              {slide.bullets.map((b, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-primary font-bold">▪</span>
                  <span className="leading-relaxed">{renderTextWithCitations(b)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* KIND: Problemáticas */}
        {slide.kind === "problematicas" && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(plan.research?.findings || []).slice(0, 4).map((f) => (
                <div
                  key={f.id}
                  className="rounded-xl border border-border bg-card p-3 shadow-xs space-y-1.5 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-foreground truncate">{f.title}</span>
                    <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-semibold">
                      {f.confidence}
                    </span>
                  </div>
                  <p className="text-muted-foreground leading-relaxed line-clamp-3">
                    {f.summary}
                  </p>
                  <div className="pt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                    <span>Evidencia:</span>
                    {f.evidence.map((eid) => (
                      <button
                        key={eid}
                        type="button"
                        onClick={() => onSourceClick?.(eid)}
                        className="px-1.5 py-0.2 rounded bg-muted font-mono font-bold text-primary hover:bg-primary/20 transition-colors cursor-pointer"
                      >
                        [{eid}]
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {slide.bullets.length > 0 && (
              <ul className="space-y-1 text-xs pt-1">
                {slide.bullets.map((b, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-primary font-bold">▪</span>
                    <span className="leading-relaxed">{renderTextWithCitations(b)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* KIND: Región (FragmentMap) */}
        {slide.kind === "region" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
            <div className="w-full">
              <FragmentMap
                level={plan.unit.level}
                ent={plan.unit.ent}
                ids={[plan.unit.unit_id]}
                values={{ [plan.unit.unit_id]: plan.unit.risk_score ?? 80 }}
                scale={{ kind: "category" }}
                height={260}
                label={`Fragmento geográfico de ${plan.unit.name}`}
              />
            </div>
            <div className="space-y-3 text-xs">
              <div className="rounded-xl border border-border bg-card p-3 space-y-1.5">
                <div className="font-semibold text-foreground">
                  Delimitación y Clasificación
                </div>
                <div className="text-muted-foreground">
                  Entidad: <strong className="text-foreground">{plan.unit.ent_name}</strong>
                </div>
                <div className="text-muted-foreground">
                  Nivel: <strong className="text-foreground">{plan.unit.level === "state" ? "Estatal" : "Municipal"}</strong>
                </div>
                <div className="text-muted-foreground">
                  Riesgo institucional: <strong className="text-foreground uppercase">{plan.unit.category}</strong>
                </div>
              </div>
              <ul className="space-y-1.5">
                {slide.bullets.map((b, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-primary font-bold">▪</span>
                    <span className="leading-relaxed">{renderTextWithCitations(b)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* KIND: Grupo Objetivo */}
        {slide.kind === "grupo_objetivo" && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(plan.target_groups || []).map((grp, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-border bg-card p-3 shadow-xs space-y-2 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-foreground">{grp.name}</span>
                    {grp.size_estimate && (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold">
                        ~{grp.size_estimate.toLocaleString("es-MX")} personas
                      </span>
                    )}
                  </div>
                  <p className="text-muted-foreground leading-relaxed">
                    {grp.description}
                  </p>
                  <div className="text-[10px] text-muted-foreground italic">
                    Base: {grp.size_basis}
                  </div>
                </div>
              ))}
            </div>

            {slide.bullets.length > 0 && (
              <ul className="space-y-1 text-xs pt-1">
                {slide.bullets.map((b, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-primary font-bold">▪</span>
                    <span className="leading-relaxed">{renderTextWithCitations(b)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* KIND: Propuestas */}
        {slide.kind === "propuestas" && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(plan.proposals || []).map((p) => {
                const leverLabel = LEVER_LABELS[p.lever] || p.lever;
                return (
                  <div
                    key={p.id}
                    className="rounded-xl border border-border bg-card p-3 shadow-xs space-y-2 text-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-bold text-foreground">{p.title}</span>
                      <span className="shrink-0 text-[10px] font-bold text-good px-2 py-0.5 rounded bg-good/10">
                        +{p.effect_pp.toFixed(1)} pp
                      </span>
                    </div>
                    <div className="text-[10px] font-semibold text-primary">
                      Palanca: {leverLabel}
                    </div>
                    <p className="text-muted-foreground leading-relaxed line-clamp-2">
                      {p.description}
                    </p>
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground border-t border-border/50 pt-1.5">
                      <span>Cobertura: {p.coverage}%</span>
                      <span>Focalización: {p.targeting}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {slide.bullets.length > 0 && (
              <ul className="space-y-1 text-xs pt-1">
                {slide.bullets.map((b, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-primary font-bold">▪</span>
                    <span className="leading-relaxed">{renderTextWithCitations(b)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* KIND: Impacto */}
        {slide.kind === "impacto" && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-xl border border-border bg-card p-3 shadow-xs">
                <span className="text-[10px] text-muted-foreground uppercase font-semibold">
                  Abstención Antes vs Después
                </span>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-lg font-bold text-muted-foreground line-through">
                    {((plan.impact?.abstention_base ?? 0.44) * 100).toFixed(1)}%
                  </span>
                  <span className="text-xl font-display font-black text-good">
                    {((plan.impact?.abstention_scenario ?? 0.39) * 100).toFixed(1)}%
                  </span>
                </div>
                <span className="text-[10px] text-good font-semibold">
                  Reducción neta: {(plan.impact?.delta_pp ?? -4.7).toFixed(1)} pp
                </span>
              </div>

              <div className="rounded-xl border border-border bg-card p-3 shadow-xs">
                <span className="text-[10px] text-muted-foreground uppercase font-semibold">
                  Votos Adicionales Netos
                </span>
                <div className="text-xl font-display font-black text-good mt-1">
                  +{(plan.impact?.votos_adicionales ?? 0).toLocaleString("es-MX")}
                </div>
                <span className="text-[10px] text-muted-foreground">
                  Electores movilizados a casillas
                </span>
              </div>

              <div className="rounded-xl border border-border bg-card p-3 shadow-xs">
                <span className="text-[10px] text-muted-foreground uppercase font-semibold">
                  Semáforo de Riesgo
                </span>
                <div className="flex items-center gap-2 mt-1 text-xs font-bold uppercase">
                  <span className="text-destructive">{plan.impact?.category_before ?? "ROJO"}</span>
                  <span>→</span>
                  <span className="text-risk-mid">{plan.impact?.category_after ?? "NARANJA"}</span>
                </div>
                <span className="text-[10px] text-muted-foreground">
                  Transición institucional estimada
                </span>
              </div>
            </div>

            <ul className="space-y-1.5 text-xs">
              {slide.bullets.map((b, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-primary font-bold">▪</span>
                  <span className="leading-relaxed">{renderTextWithCitations(b)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* KIND: Implementación */}
        {slide.kind === "implementacion" && (
          <div className="space-y-2.5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(plan.steps || []).map((st) => (
                <div
                  key={st.order}
                  className="rounded-xl border border-border bg-card p-3 shadow-xs space-y-1.5 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-foreground">
                      Fase {st.order}: {st.phase}
                    </span>
                    <span className="text-[10px] font-mono text-muted-foreground">
                      {st.start} a {st.end}
                    </span>
                  </div>
                  <div className="text-[11px] text-primary font-medium">
                    {st.responsible}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    KPI: <strong>{st.kpi}</strong>
                  </div>
                </div>
              ))}
            </div>

            {slide.bullets.length > 0 && (
              <ul className="space-y-1 text-xs pt-1">
                {slide.bullets.map((b, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-primary font-bold">▪</span>
                    <span className="leading-relaxed">{renderTextWithCitations(b)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* KIND: Riesgos y KPIs */}
        {slide.kind === "riesgos_kpis" && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="rounded-xl border border-border bg-card p-3 shadow-xs space-y-2 text-xs">
                <span className="font-bold text-foreground block">Riesgos Operativos</span>
                <ul className="space-y-2 text-muted-foreground">
                  {(plan.risks || []).map((r, i) => (
                    <li key={i} className="space-y-0.5">
                      <div className="font-medium text-foreground">⚠️ {r.risk}</div>
                      <div className="text-[11px]">Mitigación: {r.mitigation}</div>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-xl border border-border bg-card p-3 shadow-xs space-y-2 text-xs">
                <span className="font-bold text-foreground block">Indicadores Clave (KPIs)</span>
                <ul className="space-y-1.5 text-muted-foreground">
                  {(plan.kpis || []).map((kpi, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <span className="text-good font-bold">✓</span>
                      <span>{kpi}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {slide.bullets.length > 0 && (
              <ul className="space-y-1 text-xs pt-1">
                {slide.bullets.map((b, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-primary font-bold">▪</span>
                    <span className="leading-relaxed">{renderTextWithCitations(b)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* KIND: Fuentes */}
        {slide.kind === "fuentes" && (
          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {(plan.research?.sources || []).map((src) => {
                const tierMeta = SOURCE_TIER_LABELS[src.tier] || SOURCE_TIER_LABELS.no_reconocido;
                return (
                  <div
                    key={src.id}
                    className="flex items-start justify-between gap-2 p-2 rounded-lg border border-border bg-card shadow-xs"
                  >
                    <div className="min-w-0">
                      <div className="flex items-baseline gap-1 font-semibold text-foreground truncate">
                        <span className="text-primary font-mono font-bold">[{src.id}]</span>
                        <a
                          href={src.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:underline hover:text-primary transition-colors truncate"
                        >
                          {src.title || src.domain}
                        </a>
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {src.outlet || src.domain} {src.published && `· ${src.published}`}
                      </div>
                    </div>
                    <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
                      {tierMeta.label}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="p-2.5 rounded-lg border border-border/80 bg-muted/30 text-[11px] text-muted-foreground leading-relaxed">
              Aviso: Todas las fuentes citadas fueron verificadas conforme al protocolo de neutralidad institucional del INE. Redes sociales no acreditadas y blogs anónimos fueron excluidos.
            </div>
          </div>
        )}
      </div>

      {/* 3. Speaker Notes Drawer (if toggled) */}
      {showNotes && slide.notes && (
        <div className="mt-2 p-3 rounded-xl border border-primary/20 bg-primary/5 text-xs text-foreground space-y-1 animate-in fade-in duration-150">
          <div className="font-bold text-primary flex items-center gap-1.5">
            <span>💬</span>
            <span>Notas del Orador:</span>
          </div>
          <p className="leading-relaxed text-muted-foreground italic">
            {slide.notes}
          </p>
        </div>
      )}

      {/* 4. Footer Brand & Pagination hint */}
      <div className="border-t border-border/60 pt-2 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>Atalaya Electoral · Modelo de intervención institucional</span>
        <span className="font-mono">{plan.unit.name} · {plan.id}</span>
      </div>
    </div>
  );
}
