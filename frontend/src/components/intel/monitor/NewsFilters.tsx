// ATALAYA Intel - News Filters Component
"use client";

import React, { useState } from "react";
import type { Verdict, SeverityLevel, ActionType, RegistryState, NewsTopic } from "@/lib/intel/types";
import {
  VERDICT_LABELS,
  SEVERITY_LABELS,
  ACTION_LABELS,
  REGISTRY_STATE_LABELS,
  NEWS_TOPIC_LABELS,
} from "@/lib/intel/labels";
import type { MonitorFilterState, MonitorTab, SortOption } from "./monitorFilters";

export interface NewsFiltersProps {
  filters: MonitorFilterState;
  onChange: (next: MonitorFilterState) => void;
  counts: { verificadas: number; rumores: number };
  className?: string;
}

export function NewsFilters({ filters, onChange, counts, className = "" }: NewsFiltersProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const hasActiveFilters =
    filters.verdict !== "todos" ||
    filters.severity !== "todos" ||
    filters.action !== "todos" ||
    filters.registryState !== "todos" ||
    filters.topic !== "todos" ||
    filters.searchQuery.trim().length > 0 ||
    filters.sortBy !== "severidad";

  const handleReset = () => {
    onChange({
      ...filters,
      verdict: "todos",
      severity: "todos",
      action: "todos",
      registryState: "todos",
      topic: "todos",
      searchQuery: "",
      sortBy: "severidad",
    });
  };

  return (
    <div className={`space-y-3 ${className}`}>
      {/* 1. Main Tabs: Noticias verificadas vs Desinformación y rumores */}
      <div className="flex border-b border-border" role="tablist" aria-label="Categoría de noticias">
        <button
          type="button"
          role="tab"
          aria-selected={filters.tab === "verificadas"}
          onClick={() => onChange({ ...filters, tab: "verificadas", verdict: "todos" })}
          className={`flex-1 py-2.5 px-3 text-xs font-semibold text-center border-b-2 transition-colors cursor-pointer flex items-center justify-center gap-2 ${
            filters.tab === "verificadas"
              ? "border-primary text-primary font-bold"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          data-testid="tab-verificadas"
        >
          <span>Noticias verificadas</span>
          <span
            className={`px-1.5 py-0.2 rounded-full text-[11px] font-mono ${
              filters.tab === "verificadas"
                ? "bg-primary text-white"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {counts.verificadas}
          </span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={filters.tab === "rumores"}
          onClick={() => onChange({ ...filters, tab: "rumores", verdict: "todos" })}
          className={`flex-1 py-2.5 px-3 text-xs font-semibold text-center border-b-2 transition-colors cursor-pointer flex items-center justify-center gap-2 ${
            filters.tab === "rumores"
              ? "border-[#c8352f] text-[#a62520] dark:text-[#e0524d] font-bold"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          data-testid="tab-rumores"
        >
          <span>Desinformación y rumores</span>
          <span
            className={`px-1.5 py-0.2 rounded-full text-[11px] font-mono ${
              filters.tab === "rumores"
                ? "bg-[#c8352f] text-white"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {counts.rumores}
          </span>
        </button>
      </div>

      {/* 2. Search & Sort bar */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Search input */}
        <div className="relative flex-1 min-w-[200px]">
          <svg
            className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="search"
            value={filters.searchQuery}
            onChange={(e) => onChange({ ...filters, searchQuery: e.target.value })}
            placeholder="Buscar por titular, afirmación o palabra clave..."
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md border border-border bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            aria-label="Buscar noticias"
          />
        </div>

        {/* Sort Select */}
        <div className="flex items-center gap-1.5 text-xs">
          <label htmlFor="sort-select" className="text-muted-foreground whitespace-nowrap">
            Ordenar:
          </label>
          <select
            id="sort-select"
            value={filters.sortBy}
            onChange={(e) => onChange({ ...filters, sortBy: e.target.value as SortOption })}
            className="px-2.5 py-1.5 text-xs rounded-md border border-border bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="severidad">Mayor severidad</option>
            <option value="fecha">Más recientes</option>
            <option value="viralidad">Mayor viralidad</option>
          </select>
        </div>

        {/* Toggle advanced filters */}
        <button
          type="button"
          onClick={() => setShowAdvanced((prev) => !prev)}
          className={`px-2.5 py-1.5 text-xs rounded-md border transition-colors flex items-center gap-1.5 cursor-pointer ${
            showAdvanced || hasActiveFilters
              ? "border-primary/40 bg-primary-soft text-primary font-medium"
              : "border-border bg-card text-muted-foreground hover:text-foreground"
          }`}
          aria-expanded={showAdvanced}
        >
          <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="4" y1="21" x2="4" y2="14" />
            <line x1="4" y1="10" x2="4" y2="3" />
            <line x1="12" y1="21" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12" y2="3" />
            <line x1="20" y1="21" x2="20" y2="16" />
            <line x1="20" y1="12" x2="20" y2="3" />
            <line x1="1" y1="14" x2="7" y2="14" />
            <line x1="9" y1="8" x2="15" y2="8" />
            <line x1="17" y1="16" x2="23" y2="16" />
          </svg>
          <span>Filtros</span>
          {hasActiveFilters && (
            <span className="size-1.5 rounded-full bg-primary" />
          )}
        </button>

        {/* Reset button */}
        {hasActiveFilters && (
          <button
            type="button"
            onClick={handleReset}
            className="text-xs text-muted-foreground hover:text-primary transition-colors underline cursor-pointer"
          >
            Limpiar
          </button>
        )}
      </div>

      {/* 3. Collapsible Advanced Filters */}
      {showAdvanced && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5 p-3 rounded-lg border border-border bg-card/60 text-xs animate-in fade-in duration-100">
          {/* Veredicto */}
          <div className="space-y-1">
            <label className="text-muted-foreground font-medium">Veredicto:</label>
            <select
              value={filters.verdict}
              onChange={(e) => onChange({ ...filters, verdict: e.target.value as Verdict | "todos" })}
              className="w-full px-2 py-1 text-xs rounded border border-border bg-background text-foreground"
            >
              <option value="todos">Todos los veredictos</option>
              {filters.tab === "verificadas" ? (
                <>
                  <option value="verdadera">{VERDICT_LABELS.verdadera.label}</option>
                  <option value="enganosa">{VERDICT_LABELS.enganosa.label}</option>
                </>
              ) : (
                <>
                  <option value="falsa">{VERDICT_LABELS.falsa.label}</option>
                  <option value="sin_verificar">{VERDICT_LABELS.sin_verificar.label}</option>
                </>
              )}
            </select>
          </div>

          {/* Severidad */}
          <div className="space-y-1">
            <label className="text-muted-foreground font-medium">Severidad:</label>
            <select
              value={filters.severity}
              onChange={(e) => onChange({ ...filters, severity: e.target.value as SeverityLevel | "todos" })}
              className="w-full px-2 py-1 text-xs rounded border border-border bg-background text-foreground"
            >
              <option value="todos">Todas las severidades</option>
              {(Object.keys(SEVERITY_LABELS) as SeverityLevel[]).map((sev) => (
                <option key={sev} value={sev}>
                  {SEVERITY_LABELS[sev].label}
                </option>
              ))}
            </select>
          </div>

          {/* Acción recomendada */}
          <div className="space-y-1">
            <label className="text-muted-foreground font-medium">Acción sugerida:</label>
            <select
              value={filters.action}
              onChange={(e) => onChange({ ...filters, action: e.target.value as ActionType | "todos" })}
              className="w-full px-2 py-1 text-xs rounded border border-border bg-background text-foreground"
            >
              <option value="todos">Todas las acciones</option>
              {(Object.keys(ACTION_LABELS) as ActionType[]).map((act) => (
                <option key={act} value={act}>
                  {ACTION_LABELS[act].label}
                </option>
              ))}
            </select>
          </div>

          {/* Estado del registro */}
          <div className="space-y-1">
            <label className="text-muted-foreground font-medium">Estado institucional:</label>
            <select
              value={filters.registryState}
              onChange={(e) => onChange({ ...filters, registryState: e.target.value as RegistryState | "todos" })}
              className="w-full px-2 py-1 text-xs rounded border border-border bg-background text-foreground"
            >
              <option value="todos">Todos los estados</option>
              {(Object.keys(REGISTRY_STATE_LABELS) as RegistryState[]).map((st) => (
                <option key={st} value={st}>
                  {REGISTRY_STATE_LABELS[st].label}
                </option>
              ))}
            </select>
          </div>

          {/* Tema */}
          <div className="space-y-1 sm:col-span-2 md:col-span-4">
            <label className="text-muted-foreground font-medium">Temática:</label>
            <select
              value={filters.topic}
              onChange={(e) => onChange({ ...filters, topic: e.target.value as NewsTopic | "todos" })}
              className="w-full px-2 py-1 text-xs rounded border border-border bg-background text-foreground"
            >
              <option value="todos">Todas las temáticas</option>
              {(Object.keys(NEWS_TOPIC_LABELS) as NewsTopic[]).map((t) => (
                <option key={t} value={t}>
                  {NEWS_TOPIC_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
