"use client";

import React from "react";
import type { SourceRef } from "@/lib/intel/types";
import { SOURCE_TIER_LABELS } from "@/lib/intel/labels";
import { InfoTip } from "@/components/ui/InfoTip";

export interface SourceListProps {
  sources: SourceRef[];
  className?: string;
  title?: string;
}

function isGoogleNewsUrl(urlStr: string): boolean {
  if (!urlStr) return false;
  try {
    const parsed = new URL(urlStr);
    return parsed.hostname === "news.google.com" || parsed.hostname.endsWith(".news.google.com");
  } catch {
    return urlStr.includes("news.google.com");
  }
}

export function SourceList({ sources, className = "", title = "Fuentes consultadas" }: SourceListProps) {
  if (!sources || sources.length === 0) {
    return (
      <div className={`text-xs text-muted-foreground p-3 border border-border rounded-lg bg-card/50 ${className}`}>
        No hay fuentes registradas para este elemento.
      </div>
    );
  }

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-center justify-between text-xs font-semibold text-foreground">
        <div className="flex items-center gap-1.5">
          <span>{title}</span>
          <span className="text-[11px] text-muted-foreground font-mono">({sources.length})</span>
          <InfoTip term="fuentes_verificadas" size="xs" />
        </div>
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <span>Nivel de verificación</span>
          <InfoTip term="nivel_verificacion" size="xs" />
        </div>
      </div>

      <ul className="space-y-2 divide-y divide-border/60 rounded-lg border border-border bg-card p-2 text-xs">
        {sources.map((src, idx) => {
          const tierMeta = SOURCE_TIER_LABELS[src.tier] ?? SOURCE_TIER_LABELS.no_reconocido;
          const refId = src.id || `s${idx + 1}`;
          const isGoogleNews = isGoogleNewsUrl(src.url);

          let linkText = src.title || src.domain || src.url;
          if (isGoogleNews) {
            const media =
              src.outlet ||
              (src.domain && src.domain !== "news.google.com" ? src.domain : null) ||
              src.title ||
              "Medio";
            linkText = media.includes("(vía Google News)") ? media : `${media} (vía Google News)`;
          }

          let chipClass = "bg-muted text-muted-foreground border-border";
          if (tierMeta.style === "solid") {
            chipClass =
              src.tier === "oficial"
                ? "bg-good text-white border-transparent"
                : "bg-primary text-white border-transparent";
          } else if (tierMeta.style === "outline") {
            chipClass = "bg-card text-foreground border-primary/30";
          } else {
            chipClass = "bg-muted text-muted-foreground border-border";
          }

          return (
            <li key={src.url || refId} className="pt-2 first:pt-0 space-y-1">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-1.5 min-w-0 flex-1">
                  <span className="font-mono font-bold text-primary text-[11px] shrink-0 pt-2">
                    [{refId}]
                  </span>
                  <a
                    href={src.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-foreground hover:text-primary transition-colors underline-offset-2 hover:underline break-words min-h-[36px] py-1 max-w-full"
                    title={src.title || src.url}
                  >
                    <span className="break-words">{linkText}</span>
                    <svg className="size-3 text-muted-foreground shrink-0 inline-block ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                </div>

                {/* Tier Chip */}
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border shrink-0 ${chipClass}`}
                >
                  {tierMeta.alertIcon && <span>⚠️</span>}
                  <span>{tierMeta.label}</span>
                </span>
              </div>

              {/* Subtitle: domain, outlet, published */}
              <div className="text-[11px] text-muted-foreground flex flex-wrap items-center gap-x-2 pl-5">
                {src.outlet && <span className="font-medium text-foreground/80">{src.outlet}</span>}
                {src.domain && <span>({src.domain})</span>}
                {src.published && (
                  <>
                    <span>·</span>
                    <span>{src.published}</span>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
