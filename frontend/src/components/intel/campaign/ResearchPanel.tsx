"use client";

import React, { useRef, useEffect } from "react";
import type { CampaignPlan } from "@/lib/intel/types";
import { FINDING_CATEGORY_LABELS, LEVER_LABELS } from "@/lib/intel/labels";
import { SourceList } from "@/components/intel/SourceList";
import { InfoTip } from "@/components/ui/InfoTip";

export interface ResearchPanelProps {
  plan: CampaignPlan;
  highlightedSourceId?: string | null;
  className?: string;
}

export function ResearchPanel({
  plan,
  highlightedSourceId,
  className = "",
}: ResearchPanelProps) {
  const sourcesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (highlightedSourceId && sourcesRef.current) {
      sourcesRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [highlightedSourceId]);

  const research = plan.research;
  const impact = plan.impact;

  return (
    <div className={`space-y-6 ${className}`}>
      {/* 1. Research Engine & Verifiability Header */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
          <div className="flex items-center gap-2">
            <span className="text-base">🔬</span>
            <div>
              <div className="text-xs font-bold text-foreground flex items-center gap-1.5">
                <span>Investigación Documental</span>
                <InfoTip term="investigacion_gemini" size="xs" />
              </div>
              <div className="text-[11px] text-muted-foreground font-mono flex items-center gap-1.5 flex-wrap">
                <span>
                  Motor: {research?.model || "Gemini"} · {(() => {
                    const sm = research?.search_mode;
                    if (sm === "grounding") return "Búsqueda web completa (Google)";
                    if (sm === "sin_internet") return "Sin búsqueda en internet";
                    if (sm === "respaldo") return "Búsqueda de respaldo (noticias indexadas)";
                    if (research?.note?.toLowerCase().includes("sin internet")) return "Sin búsqueda en internet";
                    return "Búsqueda de respaldo (noticias indexadas)";
                  })()}
                </span>
                <InfoTip term="investigacion_gemini" size="xs" />
              </div>
            </div>
          </div>

          <div className="text-right">
            <span className="text-[11px] text-muted-foreground font-mono">
              {research?.generated_at?.slice(0, 10)}
            </span>
          </div>
        </div>

        {/* Degraded Note if applicable */}
        {research?.degraded && (
          <div className="rounded-lg border border-risk-mid/30 bg-risk-mid/10 p-2.5 text-xs text-risk-mid flex items-start gap-2">
            <span>⚠️</span>
            <div className="leading-relaxed">
              <strong>Modo de respaldo determinista:</strong> {research.note || "Se utilizaron diagnósticos precalculados y reglas institucionales."}
            </div>
          </div>
        )}

        {/* Discarded sources pill */}
        <div className="flex items-center justify-between text-xs pt-1">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <span>Fuentes no verificadas descartadas:</span>
            <span className="font-mono font-bold text-foreground">
              {research?.discarded_sources ?? 0}
            </span>
            <InfoTip term="fuentes_verificadas" size="xs" />
          </div>

          <span className="text-[11px] font-semibold text-good">
            {research?.sources?.length ?? 0} fuentes acreditadas
          </span>
        </div>
      </div>

      {/* 2. Documented Findings (Hallazgos) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
            <span>Hallazgos Electorales</span>
            <span className="text-muted-foreground font-mono">
              ({research?.findings?.length ?? 0})
            </span>
            <InfoTip term="hallazgo" size="xs" />
          </div>
          <span className="text-[11px] text-muted-foreground">Causas documentadas</span>
        </div>

        <div className="space-y-2.5">
          {(research?.findings || []).map((finding) => {
            const catLabel =
              FINDING_CATEGORY_LABELS[finding.category] || finding.category;

            return (
              <div
                key={finding.id}
                className="rounded-xl border border-border bg-card p-3 shadow-xs space-y-1.5 text-xs"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-bold text-foreground leading-snug">
                    {finding.title}
                  </span>
                  <span
                    className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase border ${
                      finding.confidence === "alta"
                        ? "bg-good/10 text-good border-good/20"
                        : finding.confidence === "media"
                        ? "bg-risk-mid/10 text-risk-mid border-risk-mid/20"
                        : "bg-muted text-muted-foreground border-border"
                    }`}
                  >
                    Certeza {finding.confidence}
                  </span>
                </div>

                <div className="text-[11px] font-semibold text-primary">
                  {catLabel} · <span className="font-normal capitalize">Alcance {finding.scope}</span>
                </div>

                <p className="text-muted-foreground leading-relaxed">
                  {finding.summary}
                </p>

                {/* Evidence links */}
                <div className="pt-1 flex flex-wrap items-center gap-1 text-[11px]">
                  <span className="text-muted-foreground">Evidencia:</span>
                  {finding.evidence.map((eid) => (
                    <span
                      key={eid}
                      className={`px-1.5 py-0.2 rounded font-mono font-bold text-[10px] transition-colors ${
                        highlightedSourceId === eid
                          ? "bg-primary text-white"
                          : "bg-muted text-primary hover:bg-primary/20"
                      }`}
                    >
                      [{eid}]
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. Search Queries Executed */}
      {research?.queries && research.queries.length > 0 && (
        <div className="rounded-xl border border-border bg-card/60 p-3.5 space-y-2 text-xs">
          <div className="font-semibold text-foreground flex items-center gap-1.5">
            <span>
              {research?.search_mode === "grounding"
                ? "Consultas realizadas en Google Search:"
                : "Consultas de búsqueda:"}
            </span>
          </div>
          <ul className="space-y-1 text-[11px] font-mono text-muted-foreground pl-3 list-disc">
            {research.queries.map((q, i) => (
              <li key={i} className="truncate" title={q}>
                {q}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 4. Verified Sources List */}
      <div ref={sourcesRef}>
        <SourceList
          sources={research?.sources || []}
          title="Fuentes de Información Contrastadas"
        />
      </div>

      {/* 5. Impact Breakdown & Overlap */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between border-b border-border/60 pb-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
            <span>Desglose de Impacto por Propuesta</span>
            <InfoTip term="impacto_simulado" size="xs" />
          </div>
          <InfoTip term="propuesta_palanca" size="xs" />
        </div>

        {/* Per-proposal contributions */}
        <div className="space-y-2 text-xs">
          {(impact?.per_proposal || []).map((item) => {
            const proposal = plan.proposals.find((p) => p.id === item.proposal_id);
            const leverLabel = LEVER_LABELS[item.lever] || item.lever;

            return (
              <div
                key={item.proposal_id}
                className="flex items-center justify-between p-2 rounded-lg bg-muted/40 border border-border/60"
              >
                <div className="min-w-0 pr-2">
                  <div className="font-semibold text-foreground truncate">
                    {proposal?.title || item.proposal_id}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {leverLabel}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <span className="font-mono font-bold text-good">
                    +{item.votos_solo.toLocaleString("es-MX")}
                  </span>
                  <div className="text-[10px] text-muted-foreground">votos brutos</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Overlap and Net Total */}
        <div className="rounded-lg border border-border bg-muted/30 p-2.5 space-y-1.5 text-xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span>Traslape por rendimientos decrecientes:</span>
            <span className="font-mono text-destructive">
              -{(impact?.overlap_votos ?? 0).toLocaleString("es-MX")} votos
            </span>
          </div>

          <div className="flex items-center justify-between border-t border-border pt-1.5 font-bold text-foreground">
            <span>Impacto neto adicional estimado:</span>
            <span className="font-mono text-good text-sm">
              +{(impact?.votos_adicionales ?? 0).toLocaleString("es-MX")} votos
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
