// ATALAYA Intel - Monitor Header Component
"use client";

import React, { useState } from "react";
import type { MonitorSnapshot, IntelStatus, Job } from "@/lib/intel/types";
import { InfoTip } from "@/components/ui/InfoTip";
import { JobProgress } from "@/components/intel/JobProgress";
import { useOperator } from "@/lib/intel/operator";
import { getMonitorKpis } from "./monitorFilters";

export interface MonitorHeaderProps {
  snapshot?: MonitorSnapshot | null;
  status?: IntelStatus | null;
  isScanning?: boolean;
  activeJob?: Job<MonitorSnapshot> | null;
  onScan?: (windowDays: 7 | 14 | 30) => Promise<void>;
  cooldownMessage?: string | null;
  className?: string;
}

export function formatTimeAgo(isoString?: string | null): string {
  if (!isoString) return "Fecha no disponible";
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    if (diffMs < 0) return "Hace un momento";
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "Hace unos segundos";
    if (diffMin < 60) return `Hace ${diffMin} min`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `Hace ${diffHours} h`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return "Hace 1 día";
    return `Hace ${diffDays} días`;
  } catch {
    return isoString;
  }
}

export function MonitorHeader({
  snapshot,
  status,
  isScanning = false,
  activeJob,
  onScan,
  cooldownMessage,
  className = "",
}: MonitorHeaderProps) {
  const { isOperator } = useOperator();
  const [selectedWindow, setSelectedWindow] = useState<7 | 14 | 30>(
    (snapshot?.window_days as 7 | 14 | 30) ?? 14
  );

  const kpis = snapshot ? getMonitorKpis(snapshot.items) : null;

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Top row: Title, relative time, engine status */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/80 pb-4">
        <div data-tour="mon-intro">
          <div className="flex items-center gap-2">
            <h1 className="font-display text-2xl font-bold text-foreground">
              Monitor INE de Medios y Desinformación
            </h1>
            <InfoTip term="monitor_ine" size="sm" />
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Detección de noticias críticas, verificación independiente y análisis de impacto en participación.
          </p>
        </div>

        {/* Engine status & last scan */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {snapshot ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-border bg-card">
              <span className="text-muted-foreground">Último escaneo:</span>
              <span className="font-semibold text-foreground" data-testid="last-scan-time">
                {formatTimeAgo(snapshot.generated_at)}
              </span>
              <span className="text-muted-foreground font-mono">
                · Ventana {snapshot.window_days} días
              </span>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">Sin escaneos registrados</span>
          )}

          {/* Search mode badge */}
          {snapshot && (() => {
            const sm = snapshot.search_mode || status?.search_mode;
            const modelName = snapshot.model || status?.gemini_last_model || status?.gemini_model;
            let modeLabel = "Búsqueda de respaldo (noticias indexadas)";
            let dotColor = "bg-risk-mid";

            if (sm === "grounding") {
              modeLabel = "Búsqueda web completa (Google)";
              dotColor = "bg-good";
            } else if (sm === "sin_internet") {
              modeLabel = "Sin búsqueda en internet";
              dotColor = "bg-muted-foreground";
            } else if (sm === "respaldo") {
              modeLabel = "Búsqueda de respaldo (noticias indexadas)";
              dotColor = "bg-risk-mid";
            } else if (snapshot.note?.toLowerCase().includes("sin internet")) {
              modeLabel = "Sin búsqueda en internet";
              dotColor = "bg-muted-foreground";
            } else if (snapshot.degraded) {
              modeLabel = "Búsqueda de respaldo (noticias indexadas)";
              dotColor = "bg-risk-mid";
            }

            return (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-card">
                <span className={`size-2 rounded-full ${dotColor}`} />
                <span className="font-medium text-foreground">
                  {modelName ? `${modelName}: ` : ""}{modeLabel}
                </span>
                <InfoTip term="fuentes_verificadas" size="xs" />
              </div>
            );
          })()}
        </div>
      </div>

      {/* Scan Control bar */}
      {onScan && (
        <div data-tour="mon-escanear" className="rounded-lg border border-primary/20 bg-primary-soft/30 p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground font-semibold">Ventana de escaneo:</span>
            <div className="inline-flex rounded-md border border-border bg-background p-0.5">
              {([7, 14, 30] as const).map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setSelectedWindow(w)}
                  disabled={isScanning}
                  className={`px-2.5 py-1 text-xs rounded transition-colors ${
                    selectedWindow === w
                      ? "bg-primary text-white font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {w} días
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={() => onScan(selectedWindow)}
            disabled={isScanning}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-primary text-white text-xs font-semibold hover:bg-primary-hover disabled:opacity-50 transition-colors cursor-pointer"
          >
            {isScanning ? (
              <>
                <svg className="animate-spin size-3.5 text-white" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                <span>Escaneando...</span>
              </>
            ) : (
              <>
                <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                  <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                  <path d="M16 21h5v-5" />
                </svg>
                <span>Escanear ahora</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* Cooldown Alert Message */}
      {cooldownMessage && (
        <div
          role="alert"
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200 flex items-center gap-2"
        >
          <svg className="size-4 shrink-0 text-amber-600 dark:text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span className="font-medium">{cooldownMessage}</span>
        </div>
      )}

      {/* Active Job Progress */}
      {activeJob && (
        <JobProgress job={activeJob} className="my-2" />
      )}

      {/* Empty State Banner when no snapshot */}
      {!snapshot && !activeJob && (
        <div className="rounded-xl border border-dashed border-border bg-card/50 p-8 text-center space-y-3">
          <div className="mx-auto size-12 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xl">
            📡
          </div>
          <h2 className="font-display text-base font-bold text-foreground">
            No hay escaneos recientes en el Monitor
          </h2>
          <p className="text-xs text-muted-foreground max-w-md mx-auto leading-relaxed">
            El Monitor detecta noticias críticas y rumores sobre el INE, calcula el impacto en participación electoral
            y sugiere medidas de mitigación institucionales.
          </p>
          {onScan && (
            <div className="pt-2">
              <button
                type="button"
                onClick={() => onScan(selectedWindow)}
                disabled={isScanning}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-white text-xs font-semibold hover:bg-primary-hover transition-colors cursor-pointer"
              >
                Ejecutar primer escaneo
              </button>
            </div>
          )}
        </div>
      )}

      {/* KPIs Grid */}
      {kpis && (
        <div data-tour="mon-kpis" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 pt-1" data-testid="monitor-kpis">
          {/* Verdaderas */}
          <div className="rounded-lg border border-[#3f9a5b]/30 bg-[#3f9a5b]/10 p-3 space-y-1">
            <div className="flex items-center justify-between text-xs text-[#2e7444] dark:text-[#52b972]">
              <span className="font-semibold">Verdaderas</span>
              <InfoTip term="noticia_verdadera" size="xs" />
            </div>
            <div className="text-2xl font-bold font-display text-[#2e7444] dark:text-[#52b972] tnum" data-testid="kpi-verdaderas">
              {kpis.verdadera}
            </div>
            <span className="text-[10px] text-muted-foreground">Hechos confirmados</span>
          </div>

          {/* Falsas */}
          <div className="rounded-lg border border-[#c8352f]/30 bg-[#c8352f]/10 p-3 space-y-1">
            <div className="flex items-center justify-between text-xs text-[#a62520] dark:text-[#e0524d]">
              <span className="font-semibold">Falsas</span>
              <InfoTip term="fake_news" size="xs" />
            </div>
            <div className="text-2xl font-bold font-display text-[#a62520] dark:text-[#e0524d] tnum" data-testid="kpi-falsas">
              {kpis.falsa}
            </div>
            <span className="text-[10px] text-muted-foreground">Sin sustento</span>
          </div>

          {/* Engañosas */}
          <div className="rounded-lg border border-[#ec7a2c]/30 bg-[#ec7a2c]/10 p-3 space-y-1">
            <div className="flex items-center justify-between text-xs text-[#c25a13] dark:text-[#f3954f]">
              <span className="font-semibold">Engañosas</span>
              <InfoTip term="noticia_enganosa" size="xs" />
            </div>
            <div className="text-2xl font-bold font-display text-[#c25a13] dark:text-[#f3954f] tnum" data-testid="kpi-enganosas">
              {kpis.enganosa}
            </div>
            <span className="text-[10px] text-muted-foreground">Fuera de contexto</span>
          </div>

          {/* Sin verificar */}
          <div className="rounded-lg border border-[#8a8290]/30 bg-[#8a8290]/10 p-3 space-y-1">
            <div className="flex items-center justify-between text-xs text-[#6b6470] dark:text-[#a8a1ad]">
              <span className="font-semibold">Sin verificar</span>
              <InfoTip term="sin_verificar" size="xs" />
            </div>
            <div className="text-2xl font-bold font-display text-[#6b6470] dark:text-[#a8a1ad] tnum" data-testid="kpi-sin-verificar">
              {kpis.sin_verificar}
            </div>
            <span className="text-[10px] text-muted-foreground">En validación</span>
          </div>

          {/* Críticas */}
          <div className="rounded-lg border border-[#b5186b]/40 bg-[#b5186b]/15 p-3 space-y-1">
            <div className="flex items-center justify-between text-xs text-[#8e1053] dark:text-[#e04596]">
              <span className="font-semibold">Críticas</span>
              <InfoTip term="severidad" size="xs" />
            </div>
            <div className="text-2xl font-bold font-display text-[#8e1053] dark:text-[#e04596] tnum" data-testid="kpi-criticas">
              {kpis.critica}
            </div>
            <span className="text-[10px] text-muted-foreground">Atención prioritaria</span>
          </div>

          {/* Pendientes */}
          <div className="rounded-lg border border-border bg-card p-3 space-y-1">
            <div className="flex items-center justify-between text-xs text-foreground">
              <span className="font-semibold">Pendientes</span>
              <InfoTip term="registro_ine" size="xs" />
            </div>
            <div className="text-2xl font-bold font-display text-primary tnum" data-testid="kpi-pendientes">
              {kpis.pendientes}
            </div>
            <span className="text-[10px] text-muted-foreground">Sin registro formal</span>
          </div>
        </div>
      )}
    </div>
  );
}
