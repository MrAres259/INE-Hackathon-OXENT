// ATALAYA Intel - Virality Panel Component
"use client";

import React from "react";
import type { Virality, Verdict } from "@/lib/intel/types";
import { SEVERITY_LABELS, PLATFORM_LABELS } from "@/lib/intel/labels";
import { InfoTip } from "@/components/ui/InfoTip";

export interface ViralityPanelProps {
  virality: Virality;
  itemVerdict?: Verdict;
  itemKind?: "noticia" | "rumor";
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

export function ViralityPanel({
  virality,
  itemVerdict,
  itemKind,
  className = "",
}: ViralityPanelProps) {
  const severityMeta = SEVERITY_LABELS[virality.level] ?? SEVERITY_LABELS.baja;

  const growthColor =
    virality.growth === "creciente"
      ? "text-[#c8352f] dark:text-[#e0524d] bg-[#c8352f]/10 border-[#c8352f]/30"
      : virality.growth === "decreciente"
      ? "text-[#16a34a] dark:text-[#4ade80] bg-[#16a34a]/10 border-[#16a34a]/30"
      : "text-[#d97706] dark:text-[#fbbf24] bg-[#d97706]/10 border-[#d97706]/30";

  return (
    <div className={`space-y-4 rounded-xl border border-border bg-card p-4 ${className}`} data-testid="virality-panel">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border/80 pb-3">
        <div className="flex items-center gap-2">
          <h4 className="font-display text-sm font-bold text-foreground">
            Índice de viralidad y propagación en redes
          </h4>
          <InfoTip term="viralidad" size="sm" />
        </div>

        <span
          className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${severityMeta.bgClass} ${severityMeta.textClass} ${severityMeta.borderClass}`}
        >
          Nivel {severityMeta.label}
        </span>
      </div>

      {/* Meter & Projections */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        {/* Score gauge */}
        <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground font-medium">Puntuación de viralidad</span>
            <span className="font-mono text-base font-bold text-foreground tnum" data-testid="virality-score">
              {virality.score} / 100
            </span>
          </div>

          {/* Visual bar */}
          <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${Math.min(100, Math.max(0, virality.score))}%`,
                backgroundColor: severityMeta.color,
              }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1">
            <span>Ritmo:</span>
            <span className={`px-2 py-0.5 rounded font-medium border text-[10px] capitalize ${growthColor}`}>
              {virality.growth}
            </span>
          </div>
        </div>

        {/* 7-day projection & Reach */}
        <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
          <div className="space-y-1">
            <span className="text-muted-foreground font-medium">Proyección a 7 días si se ignora:</span>
            <div className="flex items-center gap-2 font-mono text-sm font-bold text-foreground tnum">
              <span>{virality.score}</span>
              <span className="text-primary font-sans">→</span>
              <span className="text-[#c8352f] dark:text-[#e0524d]">{virality.projected_score_7d} / 100</span>
            </div>
          </div>

          <div className="space-y-1 pt-1 border-t border-border/60">
            <span className="text-muted-foreground font-medium text-[11px]">Alcance estimado:</span>
            <div className="font-mono text-xs font-semibold text-foreground">
              {virality.reach_estimate
                ? `${virality.reach_estimate.toLocaleString("es-MX")} reproducciones/vistas`
                : "Sin estimación de vistas"}
            </div>
          </div>
        </div>
      </div>

      {/* Platforms involved */}
      {virality.platforms && virality.platforms.length > 0 && (
        <div className="space-y-1.5 text-xs">
          <span className="text-muted-foreground font-medium">Plataformas con actividad detectada:</span>
          <div className="flex flex-wrap gap-1.5">
            {virality.platforms.map((p) => (
              <span
                key={p}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-muted border border-border text-[11px] font-semibold text-foreground"
              >
                <span>{PLATFORM_LABELS[p] ?? p}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Basis / Signals */}
      {virality.basis && virality.basis.length > 0 && (
        <div className="space-y-1.5 text-xs">
          <span className="text-muted-foreground font-medium">Señales observadas:</span>
          <ul className="list-disc pl-4 space-y-1 text-muted-foreground text-[11px] leading-relaxed">
            {virality.basis.map((b, idx) => (
              <li key={idx}>{b}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Ignore Risk Alert */}
      {virality.ignore_risk && (
        <div
          role="alert"
          className="rounded-lg border border-[#c8352f]/40 bg-[#c8352f]/10 p-3.5 text-xs space-y-1.5 text-[#a62520] dark:text-[#f3a4a0]"
          data-testid="virality-ignore-risk"
        >
          <div className="flex items-center justify-between font-bold">
            <div className="flex items-center gap-1.5">
              <span>⚠️ Riesgo de ignorar esta falsedad:</span>
              <InfoTip term="riesgo_ignorar" size="xs" />
            </div>
          </div>
          <p className="text-[11px] leading-relaxed text-foreground/90">
            {virality.ignore_risk}
          </p>
        </div>
      )}

      {/* Social Posts List or Unverified Notice */}
      {(() => {
        const verifiedPosts = (virality.posts || []).filter(
          (post) => post.link_status === "citado_en_fuente" || post.link_status === "grounding"
        );

        const isRumorOrUnverified =
          itemKind === "rumor" ||
          itemVerdict === "falsa" ||
          itemVerdict === "enganosa" ||
          itemVerdict === "sin_verificar" ||
          (!itemVerdict && itemKind !== "noticia");

        if (verifiedPosts.length === 0) {
          if (isRumorOrUnverified) {
            return (
              <div className="space-y-2 pt-2 border-t border-border/80" data-testid="no-verified-posts">
                <div
                  role="status"
                  className="rounded-lg border border-border bg-muted/20 p-3.5 text-xs text-muted-foreground leading-relaxed"
                  data-testid="no-verified-posts-notice"
                >
                  No se encontraron enlaces públicos verificables a publicaciones en redes. Los rumores se detectan a través de verificadores y medios; con búsqueda web completa la cobertura aumenta.
                </div>
              </div>
            );
          }
          return null;
        }

        return (
          <div className="space-y-2 pt-2 border-t border-border/80">
            <div className="flex items-center justify-between text-xs font-semibold text-foreground">
              <span>Publicaciones monitoreadas en redes ({verifiedPosts.length}):</span>
            </div>

            <div className="space-y-2">
              {verifiedPosts.map((post, idx) => {
                const eng = post.engagement;
                const hasMetrics =
                  eng &&
                  (eng.likes != null || eng.shares != null || eng.comments != null || eng.views != null);
                const sourceName =
                  post.evidence_outlet || (post.evidence_url ? getDomain(post.evidence_url) : "fuente");

                return (
                  <div
                    key={post.url || idx}
                    className="rounded-lg border border-border bg-card p-3 space-y-2 text-xs"
                    data-testid="social-post-card"
                  >
                    {/* Top: Platform & Author */}
                    <div className="flex flex-wrap items-center justify-between gap-1 text-[11px]">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded font-semibold bg-primary/10 text-primary border border-primary/20">
                          {PLATFORM_LABELS[post.platform] ?? post.platform}
                        </span>
                        <span className="font-mono text-foreground font-semibold">
                          {post.author || "Cuenta sin nombre en el enlace"}
                        </span>
                      </div>

                      {post.published && (
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(post.published).toLocaleDateString("es-MX", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                        </span>
                      )}
                    </div>

                    {/* Excerpt */}
                    {post.excerpt && (
                      <blockquote className="border-l-2 border-primary/40 pl-2.5 py-0.5 text-muted-foreground text-[11px] italic leading-relaxed">
                        "{post.excerpt}"
                      </blockquote>
                    )}

                    {/* Metrics & External Link */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-border/60 text-[10px] text-muted-foreground">
                      {hasMetrics ? (
                        <div className="flex flex-wrap items-center gap-2.5 font-mono">
                          {eng.likes != null && <span>👍 {eng.likes.toLocaleString("es-MX")}</span>}
                          {eng.shares != null && <span>🔄 {eng.shares.toLocaleString("es-MX")}</span>}
                          {eng.comments != null && <span>💬 {eng.comments.toLocaleString("es-MX")}</span>}
                          {eng.views != null && <span>👁️ {eng.views.toLocaleString("es-MX")}</span>}
                        </div>
                      ) : (
                        <div />
                      )}

                      {post.url && (
                        <a
                          href={post.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-primary hover:underline inline-flex items-center gap-1 min-h-[36px] py-1 break-words"
                        >
                          <span>Ver publicación</span>
                          <span aria-hidden="true">↗</span>
                        </a>
                      )}
                    </div>

                    {/* Proof Line */}
                    {post.link_status === "citado_en_fuente" && (
                      <div className="pt-1 border-t border-border/40 text-[11px] text-muted-foreground">
                        {post.evidence_url ? (
                          <a
                            href={post.evidence_url}
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

                    {post.link_status === "grounding" && (
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
        );
      })()}
    </div>
  );
}
