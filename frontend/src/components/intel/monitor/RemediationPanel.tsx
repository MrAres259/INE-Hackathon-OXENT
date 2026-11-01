// ATALAYA Intel - Remediation Panel Component
"use client";

import React, { useState } from "react";
import Link from "next/link";
import type { Remediation, NewsTopic, SocialPost } from "@/lib/intel/types";
import { ACTION_LABELS, PLATFORM_LABELS } from "@/lib/intel/labels";
import { InfoTip } from "@/components/ui/InfoTip";
import { campaignPrefillUrl } from "@/lib/intel/prefill";

export interface RemediationPanelProps {
  remediation: Remediation;
  itemTopic?: NewsTopic;
  affectedEnt?: string | null;
  posts?: SocialPost[];
  className?: string;
}

function getDomain(urlStr?: string | null): string {
  if (!urlStr) return "";
  try {
    const parsed = new URL(urlStr);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return urlStr;
  }
}

export function RemediationPanel({
  remediation,
  itemTopic,
  affectedEnt,
  posts,
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

      {/* Notice when action is reportar_plataforma and no targets */}
      {remediation.action === "reportar_plataforma" &&
        (!remediation.report_targets || remediation.report_targets.length === 0) && (
          <div
            role="status"
            className="space-y-1.5 rounded-lg border border-border bg-muted/20 p-3 text-xs text-muted-foreground leading-relaxed pt-2 border-t border-border/80"
            data-testid="no-report-targets-notice"
          >
            <span className="font-semibold text-foreground block">
              Objetivos de denuncia / reporte ante plataformas:
            </span>
            <p>
              No hay enlaces verificables para reportar. Ubica la publicación desde la nota del verificador citada en las fuentes.
            </p>
          </div>
        )}

      {/* Report Targets (Plataformas a reportar) */}
      {remediation.report_targets && remediation.report_targets.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-border/80 text-xs">
          <span className="font-semibold text-foreground">
            Objetivos de denuncia / reporte ante plataformas ({remediation.report_targets.length}):
          </span>

          <div className="space-y-2">
            {remediation.report_targets.map((tgt, idx) => {
              const matchedPost = posts?.find((p) => p.url === tgt.url);
              const linkStatus =
                matchedPost?.link_status || (tgt as unknown as { link_status?: string }).link_status;
              const evidenceUrl =
                matchedPost?.evidence_url || (tgt as unknown as { evidence_url?: string }).evidence_url;
              const evidenceOutlet =
                matchedPost?.evidence_outlet ||
                (tgt as unknown as { evidence_outlet?: string }).evidence_outlet;
              const sourceName =
                evidenceOutlet || (evidenceUrl ? getDomain(evidenceUrl) : "fuente");

              return (
                <div
                  key={tgt.url || idx}
                  className="p-2.5 rounded-lg border border-border bg-card text-[11px] space-y-1.5"
                  data-testid="report-target-card"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded font-semibold bg-muted text-foreground border border-border">
                        {PLATFORM_LABELS[tgt.platform] ?? tgt.platform}
                      </span>
                      <span className="font-mono text-muted-foreground font-semibold">
                        {tgt.author || "Cuenta sin nombre en el enlace"}
                      </span>
                      <span className="text-muted-foreground">·</span>
                      <span className="text-foreground">{tgt.reason}</span>
                    </div>

                    {tgt.url && (
                      <a
                        href={tgt.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline font-medium inline-flex items-center gap-1 min-h-[36px] py-1 break-words"
                      >
                        <span>Reportar enlace</span>
                        <span aria-hidden="true">↗</span>
                      </a>
                    )}
                  </div>

                  {/* Proof line if available */}
                  {linkStatus === "citado_en_fuente" && (
                    <div className="pt-1 border-t border-border/40 text-[11px] text-muted-foreground">
                      {evidenceUrl ? (
                        <a
                          href={evidenceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-primary hover:underline min-h-[36px] py-1 break-words font-medium"
                        >
                          <span>Enlace citado en la nota de {sourceName}</span>
                          <span aria-hidden="true">↗</span>
                        </a>
                      ) : (
                        <span className="inline-flex items-center min-h-[36px] py-1 break-words">
                          Enlace citado en la nota de {sourceName}
                        </span>
                      )}
                    </div>
                  )}

                  {linkStatus === "grounding" && (
                    <div className="pt-1 border-t border-border/40 text-[11px] text-muted-foreground flex items-center gap-1.5 min-h-[36px] py-1">
                      <svg className="size-3 text-muted-foreground shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                      <span>Encontrado por búsqueda web</span>
                    </div>
                  )}
                </div>
              );
            })}
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
              <svg className="size-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
                <line x1="8" y1="2" x2="8" y2="18" />
                <line x1="16" y1="6" x2="16" y2="22" />
              </svg>
              <span>Simular campaña en el mapa</span>
            </Link>
          )}

          <Link
            href={`/campanas?zona=${encodeURIComponent(affectedEnt || "")}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-primary/30 bg-primary-soft text-primary font-semibold hover:bg-primary-soft/80 transition-colors"
            data-testid="btn-plan-campaign-ai"
          >
            <svg className="size-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
            </svg>
            <span>Planear campaña con IA</span>
          </Link>
        </div>
      )}
    </div>
  );
}
