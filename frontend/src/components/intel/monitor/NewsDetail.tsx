// ATALAYA Intel - News Detail Component
"use client";

import React from "react";
import type { NewsItem, RegistryEntry } from "@/lib/intel/types";
import {
  VERDICT_LABELS,
  SEVERITY_LABELS,
  NEWS_TOPIC_LABELS,
} from "@/lib/intel/labels";
import { InfoTip } from "@/components/ui/InfoTip";
import { SourceList } from "@/components/intel/SourceList";
import { ImpactMap } from "./ImpactMap";
import { ViralityPanel } from "./ViralityPanel";
import { RemediationPanel } from "./RemediationPanel";
import { RegistryControl } from "./RegistryControl";

export interface NewsDetailProps {
  item: NewsItem;
  onStatusUpdated?: (entry: RegistryEntry) => void;
  onMobileBack?: () => void;
  className?: string;
}

export function NewsDetail({
  item,
  onStatusUpdated,
  onMobileBack,
  className = "",
}: NewsDetailProps) {
  const verdictMeta = VERDICT_LABELS[item.verdict] ?? VERDICT_LABELS.sin_verificar;
  const severityMeta = SEVERITY_LABELS[item.severity?.level] ?? SEVERITY_LABELS.baja;

  const verdictTerm =
    item.verdict === "verdadera"
      ? "noticia_verdadera"
      : item.verdict === "falsa"
      ? "fake_news"
      : item.verdict === "enganosa"
      ? "noticia_enganosa"
      : "sin_verificar";

  const topEnt = item.impact?.units?.[0]?.id ?? item.geo?.ents?.[0] ?? null;

  return (
    <div className={`space-y-6 ${className}`} data-testid={`news-detail-${item.id}`}>
      {/* Mobile back navigation button */}
      {onMobileBack && (
        <button
          type="button"
          onClick={onMobileBack}
          className="xl:hidden inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-card text-xs font-semibold text-foreground hover:bg-muted transition-colors cursor-pointer mb-2"
          data-testid="btn-mobile-back"
        >
          <span>← Volver a la lista de noticias</span>
        </button>
      )}

      {/* Main Card Header */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3 shadow-xs">
        {/* Top Badges */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
          <div className="flex flex-wrap items-center gap-2">
            {/* Verdict */}
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${verdictMeta.bgClass} ${verdictMeta.textClass} ${verdictMeta.borderClass}`}
            >
              <span>{verdictMeta.label}</span>
              <InfoTip term={verdictTerm} size="xs" />
            </span>

            {/* Severity */}
            <span
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border ${severityMeta.bgClass} ${severityMeta.textClass} ${severityMeta.borderClass}`}
            >
              <span>Severidad {severityMeta.label}</span>
              <span className="font-mono text-[11px]">({item.severity?.score ?? 0}/100)</span>
              <InfoTip term="severidad" size="xs" />
            </span>

            {/* Topic */}
            <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-muted text-foreground border border-border">
              {NEWS_TOPIC_LABELS[item.topic] ?? item.topic}
            </span>
          </div>

          {/* Published date & Confidence */}
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            {item.published && (
              <span>
                Publicado:{" "}
                {new Date(item.published).toLocaleDateString("es-MX", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </span>
            )}
            <span className="px-1.5 py-0.5 rounded bg-muted font-mono text-[10px]">
              Confianza {item.verdict_confidence}
            </span>
          </div>
        </div>

        {/* Headline */}
        <h2 className="font-display text-lg font-bold text-foreground leading-snug">
          {item.headline}
        </h2>

        {/* Claim Callout */}
        {item.claim && (
          <div className="rounded-lg border border-primary/20 bg-primary-soft/30 p-3 space-y-1">
            <span className="text-[11px] font-bold text-primary uppercase tracking-wide">
              Afirmación evaluada:
            </span>
            <p className="text-xs text-foreground font-medium leading-relaxed">
              "{item.claim}"
            </p>
          </div>
        )}

        {/* Summary */}
        {item.summary && (
          <div className="space-y-1 text-xs">
            <span className="font-semibold text-foreground">Resumen de los hechos:</span>
            <p className="text-muted-foreground leading-relaxed">
              {item.summary}
            </p>
          </div>
        )}

        {/* Verdict Rationale */}
        {item.verdict_rationale && (
          <div className="space-y-1 rounded-lg border border-border bg-muted/20 p-3 text-xs">
            <div className="flex items-center gap-1.5 font-semibold text-foreground">
              <span>Fundamentación del veredicto:</span>
              <InfoTip term="veredicto" size="xs" />
            </div>
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              {item.verdict_rationale}
            </p>
          </div>
        )}
      </div>

      {/* Impact Map (If impact exists, typically for true/misleading news) */}
      {item.impact && (
        <div data-tour="mon-impacto">
          <ImpactMap impact={item.impact} itemId={item.id} />
        </div>
      )}

      {/* Virality Panel (If virality exists, typically for fake/viral news) */}
      {item.virality && (
        <div data-tour="mon-viralidad">
          <ViralityPanel virality={item.virality} />
        </div>
      )}

      {/* Remediation Panel */}
      {item.remediation && (
        <div data-tour="mon-remediacion">
          <RemediationPanel
            remediation={item.remediation}
            itemTopic={item.topic}
            affectedEnt={topEnt}
          />
        </div>
      )}

      {/* Independent Fact-Checks */}
      {item.fact_checks && item.fact_checks.length > 0 && (
        <SourceList
          sources={item.fact_checks}
          title="Verificaciones independientes de hechos (Fact-checking)"
        />
      )}

      {/* Sources Consulted */}
      {item.sources && item.sources.length > 0 && (
        <SourceList
          sources={item.sources}
          title="Fuentes periodísticas e institucionales consultadas"
        />
      )}

      {/* Registry Control (INE Acknowledgement and Operator Actions) */}
      <div data-tour="mon-registro">
        <RegistryControl item={item} onStatusUpdated={onStatusUpdated} />
      </div>
    </div>
  );
}
