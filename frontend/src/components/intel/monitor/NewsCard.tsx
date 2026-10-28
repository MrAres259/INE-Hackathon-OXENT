// ATALAYA Intel - News Card Component
"use client";

import React from "react";
import type { NewsItem } from "@/lib/intel/types";
import {
  VERDICT_LABELS,
  SEVERITY_LABELS,
  ACTION_LABELS,
  REGISTRY_STATE_LABELS,
  NEWS_TOPIC_LABELS,
} from "@/lib/intel/labels";

export interface NewsCardProps {
  item: NewsItem;
  isSelected?: boolean;
  onSelect: (item: NewsItem) => void;
  className?: string;
}

export function NewsCard({
  item,
  isSelected = false,
  onSelect,
  className = "",
}: NewsCardProps) {
  const verdictMeta = VERDICT_LABELS[item.verdict] ?? VERDICT_LABELS.sin_verificar;
  const severityMeta = SEVERITY_LABELS[item.severity?.level] ?? SEVERITY_LABELS.baja;
  const actionMeta = ACTION_LABELS[item.remediation?.action] ?? ACTION_LABELS.registrar;
  const currentStatus = item.status?.status ?? "pendiente";
  const statusMeta = REGISTRY_STATE_LABELS[currentStatus] ?? REGISTRY_STATE_LABELS.pendiente;

  const sourcesCount = item.sources?.length ?? 0;
  const postsCount = item.virality?.posts?.length ?? 0;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(item);
    }
  };

  const confidenceLabel =
    item.verdict_confidence === "alta"
      ? "Confianza alta"
      : item.verdict_confidence === "media"
      ? "Confianza media"
      : "Confianza baja";

  return (
    <div
      role="button"
      tabIndex={0}
      aria-selected={isSelected}
      onClick={() => onSelect(item)}
      onKeyDown={handleKeyDown}
      data-testid={`news-card-${item.id}`}
      className={`rounded-xl border p-3.5 transition-all text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
        isSelected
          ? "border-primary bg-primary-soft/40 shadow-xs ring-1 ring-primary/60"
          : "border-border bg-card hover:border-primary/40 hover:bg-card/80 shadow-xs"
      } ${className}`}
    >
      {/* Top badges: Verdict, Confidence, Severity */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 mb-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Verdict Chip */}
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${verdictMeta.bgClass} ${verdictMeta.textClass} ${verdictMeta.borderClass}`}
            data-testid={`card-verdict-${item.id}`}
          >
            {verdictMeta.label}
          </span>

          {/* Confidence Chip */}
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] text-muted-foreground bg-muted border border-border">
            {confidenceLabel}
          </span>
        </div>

        {/* Severity Badge */}
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border ${severityMeta.bgClass} ${severityMeta.textClass} ${severityMeta.borderClass}`}
          title={severityMeta.description}
        >
          <span>{severityMeta.label}</span>
          <span className="font-mono text-[10px]">({item.severity?.score ?? 0})</span>
        </span>
      </div>

      {/* Headline */}
      <h3 className="font-display text-xs font-bold text-foreground leading-snug line-clamp-2 mb-1.5">
        {item.headline}
      </h3>

      {/* Claim / Excerpt snippet */}
      <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed mb-3">
        {item.claim || item.summary}
      </p>

      {/* Topic Chip */}
      <div className="mb-3">
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium text-foreground/80 bg-muted/80">
          {NEWS_TOPIC_LABELS[item.topic] ?? item.topic}
        </span>
      </div>

      {/* Footer details: Action recommended & deadline, registry status, count of sources/posts */}
      <div className="space-y-1.5 pt-2 border-t border-border/60 text-[11px]">
        {/* Action & Deadline */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-foreground/90 font-medium truncate" title={actionMeta.label}>
            {actionMeta.label}
          </span>
          {item.remediation?.deadline_hours && (
            <span className="font-mono font-semibold text-primary shrink-0">
              {item.remediation.deadline_hours} h
            </span>
          )}
        </div>

        {/* Status & Counts */}
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span
            className="font-medium px-1.5 py-0.2 rounded-full border border-border"
            style={{ color: statusMeta.color }}
          >
            {statusMeta.label}
          </span>

          <div className="flex items-center gap-2 font-mono">
            {sourcesCount > 0 && <span>{sourcesCount} fuentes</span>}
            {postsCount > 0 && <span>{postsCount} posts</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
