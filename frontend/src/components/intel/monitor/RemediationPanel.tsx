// ATALAYA Intel - Remediation Panel Component
"use client";

import React, { useState } from "react";
import Link from "next/link";
import type { Remediation, NewsTopic } from "@/lib/intel/types";
import { ACTION_LABELS, PLATFORM_LABELS } from "@/lib/intel/labels";
import { InfoTip } from "@/components/ui/InfoTip";
import { campaignPrefillUrl } from "@/lib/intel/prefill";

export interface RemediationPanelProps {
  remediation: Remediation;
  itemTopic?: NewsTopic;
  affectedEnt?: string | null;
  className?: string;
}

export function RemediationPanel({
  remediation,
  itemTopic,
  affectedEnt,
  className = "",
}: RemediationPanelProps) {
  const [copied, setCopied] = useState(false);
  const actionMeta = ACTION_LABELS[remediation.action] ?? ACTION_LABELS.registrar;

  const handleCopy = async () => {
    if (!remediation.draft_message) return;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(remediation.draft_message);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      }
    } catch {
      // Ignore clipboard write failures
    }
  };

  const hasCampaignPrefill =
    Boolean(remediation.campaign_prefill?.campaigns && remediation.campaign_prefill.campaigns.length > 0);
  const isCampaignAction =
    remediation.action === "campana_intervencion" ||
    remediation.secondary_actions?.includes("campana_intervencion") ||
    hasCampaignPrefill;

  const draftLength = remediation.draft_message?.length ?? 0;
  const isSocialResponse = remediation.action === "responder_corregir";

  return (
    <div className={`space-y-4 rounded-xl border border-border bg-card p-4 ${className}`} data-testid="remediation-panel">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/80 pb-3">
        <div className="flex items-center gap-2">
          <h4 className="font-display text-sm font-bold text-foreground">
            Remediación institucional recomendada
          </h4>
          <InfoTip term="accion_remediacion" size="sm" />
        </div>

        <div className="flex items-center gap-2">
          {remediation.deadline_hours && (
            <span className="font-mono text-xs font-semibold px-2.5 py-0.5 rounded-full border border-primary/30 bg-primary/10 text-primary">
              Atención en {remediation.deadline_hours} h
            </span>
          )}
        </div>
      </div>

      {/* Degraded mode notice */}
      {remediation.degraded && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-900 dark:text-amber-200">
          Nota: Texto de plantilla generado de forma determinista sin asistencia de LLM.
        </div>
      )}

      {/* Main Action & Secondaries */}
      <div className="space-y-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground font-medium">Acción principal:</span>
          <span className="px-3 py-1 rounded-md bg-primary text-white font-bold text-xs">
            {actionMeta.label}
          </span>
          <span className="text-muted-foreground text-[11px]">({actionMeta.deadlineHint})</span>
        </div>

        {remediation.secondary_actions && remediation.secondary_actions.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-muted-foreground font-medium text-[11px]">Acciones complementarias:</span>
            {remediation.secondary_actions.map((sec) => (
              <span
                key={sec}
                className="px-2 py-0.5 rounded text-[11px] font-medium bg-muted text-foreground border border-border"
              >
                {ACTION_LABELS[sec]?.label ?? sec}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Measures (Numbered) */}
      {remediation.measures && remediation.measures.length > 0 && (
        <div className="space-y-1.5 text-xs">
          <span className="font-semibold text-foreground">Medidas institucionales recomendadas:</span>
          <ol className="list-decimal pl-4 space-y-1 text-muted-foreground text-[11px] leading-relaxed">
            {remediation.measures.map((m, idx) => (
              <li key={idx} className="pl-0.5">
                {m}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Rationale */}
      {remediation.rationale && (
        <div className="space-y-1 text-xs">
          <span className="font-semibold text-foreground">Justificación institucional:</span>
          <p className="text-muted-foreground text-[11px] leading-relaxed">
            {remediation.rationale}
          </p>
        </div>
      )}

      {/* Draft Message (Comunicado o respuesta) */}
      {remediation.draft_message && (
        <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground">
                {isSocialResponse ? "Borrador de respuesta en redes:" : "Borrador de comunicado oficial:"}
              </span>
              <span className="text-[10px] text-muted-foreground font-mono">
                {isSocialResponse ? `${draftLength} / 280 caracteres` : `${draftLength} caracteres`}
              </span>
            </div>

            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-semibold border border-border bg-card text-foreground hover:bg-muted transition-colors cursor-pointer"
              data-testid="btn-copy-draft"
            >
              {copied ? (
                <>
                  <svg className="size-3.5 text-good" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span className="text-good font-bold">¡Copiado!</span>
                </>
              ) : (
                <>
                  <svg className="size-3.5 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                  <span>Copiar borrador</span>
                </>
              )}
            </button>
          </div>

          <div
            className="p-2.5 rounded border border-border bg-card font-sans text-xs leading-relaxed text-foreground select-text"
            data-testid="draft-message-box"
          >
            {remediation.draft_message}
          </div>
        </div>
      )}

      {/* Report Targets (Plataformas a reportar) */}
      {remediation.report_targets && remediation.report_targets.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-border/80 text-xs">
          <span className="font-semibold text-foreground">
            Objetivos de denuncia / reporte ante plataformas ({remediation.report_targets.length}):
          </span>

          <div className="space-y-1.5">
            {remediation.report_targets.map((tgt, idx) => (
              <div
                key={tgt.url || idx}
                className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-lg border border-border bg-card text-[11px]"
              >
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded font-semibold bg-muted text-foreground border border-border">
                    {PLATFORM_LABELS[tgt.platform] ?? tgt.platform}
                  </span>
                  <span className="font-mono text-muted-foreground">{tgt.author || "Autor"}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-foreground">{tgt.reason}</span>
                </div>

                {tgt.url && (
                  <a
                    href={tgt.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline font-medium inline-flex items-center gap-0.5"
                  >
                    <span>Reportar enlace</span>
                    <span>↗</span>
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Territorial Campaign Buttons (If applicable) */}
      {isCampaignAction && (
        <div className="pt-2 border-t border-border/80 flex flex-wrap items-center gap-2 text-xs">
          {hasCampaignPrefill && (
            <Link
              href={campaignPrefillUrl(remediation.campaign_prefill!)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-primary text-white font-semibold hover:bg-primary-hover transition-colors"
              data-testid="btn-simulate-map"
            >
              <span>🗺️ Simular campaña en el mapa</span>
            </Link>
          )}

          <Link
            href={`/campanas?zona=${encodeURIComponent(affectedEnt || "")}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-primary/30 bg-primary-soft text-primary font-semibold hover:bg-primary-soft/80 transition-colors"
            data-testid="btn-plan-campaign-ai"
          >
            <span>✨ Planear campaña con IA</span>
          </Link>
        </div>
      )}
    </div>
  );
}
