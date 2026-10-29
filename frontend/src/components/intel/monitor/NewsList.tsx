// ATALAYA Intel - News List Component
"use client";

import React from "react";
import type { NewsItem } from "@/lib/intel/types";
import { NewsCard } from "./NewsCard";

export interface NewsListProps {
  items: NewsItem[];
  selectedId: string | null;
  onSelect: (item: NewsItem) => void;
  className?: string;
}

export function NewsList({
  items,
  selectedId,
  onSelect,
  className = "",
}: NewsListProps) {
  if (items.length === 0) {
    return (
      <div
        className={`rounded-xl border border-dashed border-border bg-card/40 p-8 text-center text-xs space-y-2 ${className}`}
        data-testid="news-list-empty"
      >
        <div className="mx-auto size-10 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
          <svg className="size-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </div>
        <p className="font-semibold text-foreground">
          No hay elementos que coincidan con los filtros
        </p>
        <p className="text-muted-foreground max-w-xs mx-auto">
          Prueba cambiando la pestaña, ajustando los criterios de búsqueda o limpiando los filtros avanzados.
        </p>
      </div>
    );
  }

  return (
    <div className={`space-y-2.5 ${className}`} role="list" aria-label="Lista de noticias y rumores">
      <div className="text-[11px] text-muted-foreground px-1 flex items-center justify-between">
        <span>Mostrando {items.length} {items.length === 1 ? "elemento" : "elementos"}</span>
      </div>

      <div className="space-y-2">
        {items.map((item) => (
          <NewsCard
            key={item.id}
            item={item}
            isSelected={item.id === selectedId}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}
