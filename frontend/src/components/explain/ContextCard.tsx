"use client";

import React from "react";
import type { ContextResult, Verification } from "@/lib/explain/types";
import { InfoTip } from "@/components/ui/InfoTip";
import type { GlossaryKey } from "@/lib/glossary";

export interface ContextCardProps {
  result: ContextResult;
  className?: string;
}

function formatSearchMode(mode: ContextResult["search_mode"]): string {
  switch (mode) {
    case "grounding":
      return "completa";
    case "respaldo":
      return "respaldo";
    case "sin_internet":
      return "sin internet";
    default:
      return mode || "completa";
  }
}

function VerificationBadge({ verification }: { verification: Verification }) {
  if (verification === "cita_verificada") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-good/15 text-good border border-good/30 shrink-0">
        <span aria-hidden="true">✓</span>
        <span>Cita comprobada en la fuente</span>
        <InfoTip term={"cita_verificada" as GlossaryKey} size="xs" />
      </span>
    );
  }
  if (verification === "fuente_verificada") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary/10 text-primary border border-primary/20 shrink-0">
        <span>Fuente confiable</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-muted text-muted-foreground border border-border shrink-0">
      <span>Sin verificar</span>
    </span>
  );
}

export function ContextCard({ result, className = "" }: ContextCardProps) {
  const hasFindings = result.findings && result.findings.length > 0;
  const isDegraded = result.degraded || !hasFindings;

  return (
    <div
      className={`w-full rounded-xl border border-border bg-card p-3.5 space-y-3 shadow-xs text-xs ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border pb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <svg className="size-4 text-primary shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z"
            />
          </svg>
          <h3 className="font-bold text-sm text-foreground truncate">Contexto público reciente</h3>
          <InfoTip term={"contexto_publico" as GlossaryKey} size="xs" />
        </div>
        {result.name && (
          <span className="text-[11px] font-semibold text-muted-foreground truncate">
            {result.name}
          </span>
        )}
      </div>

      {/* Disclaimer */}
      {result.disclaimer && (
        <div className="p-2.5 rounded-md bg-muted/40 border border-border/60 text-[11px] text-muted-foreground leading-relaxed">
          {result.disclaimer}
        </div>
      )}

      {/* Degraded / Sin hallazgos */}
      {isDegraded ? (
        <div className="p-3 rounded-lg bg-muted/30 border border-border text-muted-foreground text-xs leading-relaxed space-y-1">
          <p className="font-medium text-foreground">Aviso de contexto</p>
          <p>{result.note || "No se encontraron hallazgos públicos verificados para esta zona en este momento."}</p>
        </div>
      ) : (
        /* Findings List */
        <div className="space-y-3">
          {result.findings.map((finding) => (
            <div
              key={finding.id}
              className="p-3 rounded-lg border border-border/70 bg-card space-y-2 shadow-2xs"
            >
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                  {finding.category_label || finding.category}
                </span>
                <VerificationBadge verification={finding.verification} />
              </div>

              <h4 className="font-bold text-xs text-foreground leading-snug">{finding.title}</h4>

              <p className="text-xs text-foreground leading-relaxed">{finding.summary}</p>

              {finding.quote && (
                <blockquote className="border-l-2 border-primary/50 pl-2.5 py-1 text-[11px] italic text-muted-foreground bg-muted/20 rounded-r">
                  «{finding.quote}»
                </blockquote>
              )}

              {finding.sources && finding.sources.length > 0 && (
                <div className="space-y-1 pt-1.5 border-t border-border/50">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                    Fuentes:
                  </span>
                  <ul className="space-y-1 pl-1">
                    {finding.sources.map((src, sIdx) => {
                      const outletLabel = src.outlet || src.domain || "Enlace";
                      return (
                        <li key={src.url || sIdx} className="text-[11px] flex items-center gap-1.5 flex-wrap">
                          <a
                            href={src.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-primary hover:underline underline-offset-2 inline-flex items-center gap-1 truncate max-w-full"
                          >
                            <span className="truncate">{src.title || outletLabel}</span>
                            <svg className="size-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                          </a>
                          <span className="text-muted-foreground text-[10px]">
                            ({outletLabel}{src.published ? ` · ${src.published}` : ""})
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="text-[10px] text-muted-foreground pt-2 border-t border-border flex items-center justify-between flex-wrap gap-2">
        <span>
          Modo de búsqueda:{" "}
          <strong className="text-foreground">{formatSearchMode(result.search_mode)}</strong>
        </span>
        {result.model && (
          <span>
            Modelo: <span className="font-mono text-foreground">{result.model}</span>
          </span>
        )}
      </div>
    </div>
  );
}
