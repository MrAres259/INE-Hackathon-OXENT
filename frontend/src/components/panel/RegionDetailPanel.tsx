"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useAtalaya } from "@/lib/state";
import { getMetrics } from "@/lib/api";
import type { ModelMetrics, RiskItem } from "@/lib/types";
import {
  formatPct,
  formatPp,
  formatInt,
  formatDeltaPp,
  formatSignedVotes,
  hasProminentDrivers,
  getCategoryLabel,
  formatSuppressed,
  getAbstencionEsperada,
} from "@/lib/format";
import { Sparkline } from "@/components/viz/Sparkline";
import { InfoTip } from "@/components/ui/InfoTip";
import {
  computeNationalStats,
  getCategoryDistribution,
  getTopRiskZones,
  formatDiagnosticSummaryLine,
  CATEGORY_STYLES,
  CATEGORY_ORDER,
} from "@/lib/panelStats";

export function RegionDetailPanel() {
  const {
    selectedDetail,
    loadingDetail,
    riskItems,
    level,
    selectRegion,
    selectState,
    meta,
    scenario,
    simulationResult,
  } = useAtalaya();

  const [metrics, setMetrics] = useState<ModelMetrics | null>(null);
  const [profileYear, setProfileYear] = useState<number | null>(null);

  useEffect(() => {
    getMetrics().then((m) => setMetrics(m)).catch(() => {});
  }, []);

  // Loading state
  if (loadingDetail) {
    return (
      <div className="p-8 text-center text-muted-foreground space-y-3">
        <svg className="animate-spin h-6 w-6 text-primary mx-auto" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
        </svg>
        <p className="text-xs">Cargando diagnóstico territorial...</p>
      </div>
    );
  }

  // NATIONAL SUMMARY VIEW (When no region is selected)
  if (!selectedDetail) {
    const topZones = getTopRiskZones(riskItems, 6);
    const categoryDist = getCategoryDistribution(riskItems);
    const natStats = computeNationalStats(riskItems);
    const totalZonesCount = riskItems.length;
    const baseLabel = level === "state" ? "de 32 estados" : `${totalZonesCount} municipios`;

    return (
      <div className="space-y-4">
        {/* Header */}
        <div>
          <h2 className="font-display text-lg font-bold text-foreground">Panorama nacional 2027</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Toca o haz clic en un estado del mapa para ver su detalle.
          </p>
        </div>

        {/* Global Summary KPI Cards (2xN grid) */}
        <div className="grid grid-cols-2 gap-2">
          {/* Card 1: Abstención pronosticada */}
          <div className="rounded-lg border border-border bg-card p-3 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                <span>Abstención pronosticada</span>
                <InfoTip term="pred_abstention" size="xs" />
              </div>
              <div className="tnum mt-1 font-display text-xl font-bold text-foreground">
                {formatPct(natStats.avgAbstention)}
              </div>
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
              nacional, ponderada por lista nominal
            </div>
          </div>

          {/* Card 2: Abstención Esperada */}
          <div className="rounded-lg border border-border bg-card p-3 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                <span>Abstención esperada</span>
                <InfoTip term="abstencion_esperada" size="xs" />
              </div>
              <div className="tnum mt-1 font-display text-xl font-bold text-foreground">
                {natStats.totalExpected > 1e6
                  ? `${(natStats.totalExpected / 1e6).toFixed(1)} M`
                  : formatInt(natStats.totalExpected)}
              </div>
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              personas
            </div>
          </div>

          {/* Card 3: Zonas Evaluadas */}
          <div className="rounded-lg border border-border bg-card p-3 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                <span>Zonas evaluadas</span>
                <InfoTip
                  title="Total de Zonas Evaluadas"
                  text="Número total de entidades federativas (32) o municipios evaluados según el nivel territorial activo."
                  size="xs"
                />
              </div>
              <div className="tnum mt-1 font-display text-xl font-bold text-foreground">
                {totalZonesCount}
              </div>
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {level === "state" ? "entidades federativas" : "municipios"}
            </div>
          </div>

          {/* Card 4: Escenario Activo */}
          <div className="rounded-lg border border-border bg-card p-3 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                <span>Escenario activo</span>
                <InfoTip term="escenarios" size="xs" />
              </div>
              <div className="mt-1 font-display text-xl font-bold text-primary truncate">
                {scenario === "intervencion"
                  ? "Intervención"
                  : scenario === "pesimista"
                  ? "Pesimista"
                  : "Base"}
              </div>
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {scenario === "base"
                ? "Inercial"
                : scenario === "intervencion"
                ? "Con intervención"
                : "Pesimista"}
            </div>
          </div>

          {/* Card en escenario != base con votos vs base */}
          {scenario !== "base" && simulationResult?.summary && (
            <div className="col-span-2 rounded-lg border border-primary/20 bg-primary-soft p-3 text-xs">
              <span
                className={`tnum font-display text-base font-bold ${
                  simulationResult.summary.votos_adicionales >= 0 ? "text-good" : "text-bad"
                }`}
              >
                {formatSignedVotes(simulationResult.summary.votos_adicionales)}
              </span>{" "}
              <span className="text-muted-foreground">votos vs escenario base</span>
            </div>
          )}
        </div>

        {/* Stacked Semáforo Bar & Legend */}
        <section className="rounded-lg border border-border bg-card p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-1 text-xs font-bold text-foreground">
              <span>Distribución por semáforo</span>
              <InfoTip term="semaforo" size="xs" />
            </div>
            <span className="text-[10px] text-muted-foreground">{baseLabel}</span>
          </div>

          {/* Stacked horizontal bar: rojo -> verde */}
          <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
            {categoryDist.map((item) => (
              <div
                key={item.category}
                className={`${item.bgClass} transition-all duration-300`}
                style={{ width: `${item.pct}%` }}
                title={`${item.label}: ${item.count} (${item.pct.toFixed(1)}%)`}
              />
            ))}
          </div>

          {/* 2x2 Legend */}
          <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
            {categoryDist.map((item) => (
              <div key={item.category} className="flex items-center gap-1.5">
                <span className={`size-2 shrink-0 rounded-full ${item.dotClass}`} />
                <span className="text-muted-foreground">{item.label}</span>
                <span className="tnum ml-auto font-semibold text-foreground">
                  {item.count} <span className="text-[10px] font-normal text-muted-foreground">({item.pct.toFixed(0)}%)</span>
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Priority Zones (Top 5-6) */}
        <section>
          <div className="mb-1.5 flex items-center justify-between px-1 text-xs font-bold text-foreground">
            <span className="flex items-center gap-1">
              <span>Zonas de mayor riesgo</span>
              <InfoTip term="risk_score" size="xs" />
            </span>
            <span className="text-[11px] font-normal text-muted-foreground">Índice</span>
          </div>
          <div className="space-y-1.5">
            {topZones.map((item, idx) => {
              const abstEsperada = getAbstencionEsperada(item);
              const style = CATEGORY_STYLES[item.category] ?? CATEGORY_STYLES.sin_dato;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => selectRegion(item.id)}
                  className="flex w-full min-h-[40px] items-center gap-3 rounded-lg border border-border bg-card p-2 text-left hover:bg-accent transition-colors group cursor-pointer"
                >
                  <span className="tnum w-4 text-xs font-mono font-bold text-muted-foreground group-hover:text-foreground shrink-0">
                    {idx + 1}
                  </span>
                  <span className={`size-2.5 shrink-0 rounded-full ${style.dotClass}`} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold text-foreground group-hover:text-primary transition-colors">
                      {item.name}
                    </div>
                    <div className="tnum text-[11px] text-muted-foreground">
                      Abst. {formatPct(item.pred_abstention)} · {formatInt(abstEsperada)} pers.
                    </div>
                  </div>
                  <span className="tnum text-xs font-bold font-display text-foreground shrink-0 ml-1">
                    {item.risk_score ?? "—"}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    );
  }

  // REGION SELECTED DETAIL VIEW
  const catStyle = CATEGORY_STYLES[selectedDetail.category] ?? CATEGORY_STYLES.sin_dato;
  const isTrendNegative = (selectedDetail.trend_pp ?? 0) < 0;
  const abstEsperada = getAbstencionEsperada(selectedDetail);
  const summaryLine = formatDiagnosticSummaryLine(selectedDetail);

  // Municipalities of this state (when level is state and municipalities are available in riskItems)
  const stateMunis =
    selectedDetail.level === "state"
      ? riskItems.filter((m) => m.level === "mun" && m.ent === selectedDetail.id)
      : [];

  // Profile data for CCPC Age & Sex
  const profileYears = selectedDetail.profile
    ? Array.from(new Set(selectedDetail.profile.map((p) => p.year))).sort((a, b) => b - a)
    : [];
  const activeYear = profileYear ?? (profileYears.length > 0 ? profileYears[0] : null);
  const activeProfile = selectedDetail.profile
    ? selectedDetail.profile.filter((p) => p.year === activeYear)
    : [];
  const ageGroups = ["18-24", "25-34", "35-44", "45-54", "55-64", "65+"];

  return (
    <div className="space-y-4">
      {/* Back button & Region Header */}
      <div>
        {selectedDetail.parent ? (
          <button
            type="button"
            onClick={() => selectState(selectedDetail.parent!.id)}
            className="mb-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors cursor-pointer group"
          >
            <span className="text-sm font-bold">‹</span>
            <span>{selectedDetail.parent.name}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => selectRegion(null)}
            className="mb-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors cursor-pointer group"
          >
            <span className="text-sm font-bold">‹</span>
            <span>Nacional</span>
          </button>
        )}

        {/* Subtitle & Badges */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {selectedDetail.level === "state"
              ? "Estado"
              : `Municipio · ${selectedDetail.parent?.name ?? ""}`} · Clave {selectedDetail.id}
          </span>
          {selectedDetail.reliable === false && (
            <span
              className="text-[10px] font-semibold bg-risk-crit/10 text-risk-crit border border-risk-crit/30 px-2 py-0.5 rounded-full flex items-center gap-1"
              title="Información con alta tasa de registros no especificados (> 50 %)"
            >
              <span>⚠️</span>
              <span>Sin información confiable</span>
              <InfoTip term="confiabilidad" size="xs" />
            </span>
          )}
          {selectedDetail.imputed_census && (
            <span
              className="text-[10px] font-semibold bg-muted text-muted-foreground border border-border px-2 py-0.5 rounded-full flex items-center gap-1"
              title="Datos de censo estimados o imputados desde municipio de origen"
            >
              <span>⚠️</span>
              <span>Censo imputado</span>
            </span>
          )}
          {metrics?.drivers_low_confidence && (
            <span
              className="text-[10px] font-semibold bg-muted text-muted-foreground border border-border px-2 py-0.5 rounded-full flex items-center gap-1"
              title="El perfil explicativo presenta menor ajuste en modelos agrupados por estado"
            >
              <span>ℹ️</span>
              <span>Factores con baja confianza</span>
            </span>
          )}
        </div>

        {/* Title & Category Badge */}
        <div className="flex items-start justify-between gap-2 mt-1">
          <h2 className="font-display text-xl font-bold text-foreground truncate min-w-0">
            {selectedDetail.name}
          </h2>
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${catStyle.badgeClass}`}
          >
            {getCategoryLabel(selectedDetail.category)}
          </span>
        </div>

        {/* Subline */}
        <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1">
            <span>
              Lista nominal: <strong className="text-foreground">{formatInt(selectedDetail.lista_nominal)}</strong> electores
            </span>
            <InfoTip term="lista_nominal" size="xs" />
          </span>
          {selectedDetail.prioridad !== undefined && selectedDetail.prioridad !== null && (
            <span className="inline-flex items-center gap-1 text-primary font-semibold">
              <span>· Prioridad #{selectedDetail.prioridad}</span>
              <InfoTip term="prioridad" size="xs" />
            </span>
          )}
        </div>

        {/* 1-line plain language summary line */}
        {summaryLine && (
          <div className="rounded-lg bg-muted p-3 text-xs text-foreground leading-relaxed mt-2.5 border border-border">
            {summaryLine}
          </div>
        )}
      </div>

      {/* Main KPI Badges (3 columns, 2 in < 360 px) */}
      <div className="grid grid-cols-2 min-[360px]:grid-cols-3 gap-2">
        {/* KPI 1: Abst. 2027 */}
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
            <span>Abst. 2027</span>
            <InfoTip term="pred_abstention" size="xs" />
          </div>
          <div className="tnum mt-1 font-display text-xl font-bold text-foreground">
            {formatPct(selectedDetail.pred_abstention)}
          </div>
          <div className="text-[11px] mt-0.5 truncate">
            {selectedDetail.delta_vs_base_pp !== undefined && selectedDetail.delta_vs_base_pp !== null ? (
              <span
                className={`font-semibold ${
                  selectedDetail.delta_vs_base_pp < 0 ? "text-good" : "text-bad"
                }`}
              >
                {formatDeltaPp(selectedDetail.delta_vs_base_pp)} vs base
              </span>
            ) : (
              <span className="text-muted-foreground">
                [{formatPct(selectedDetail.pred_low)} – {formatPct(selectedDetail.pred_high)}]
              </span>
            )}
          </div>
        </div>

        {/* KPI 2: Esperada (personas) */}
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
            <span>Esperada</span>
            <InfoTip term="abstencion_esperada" size="xs" />
          </div>
          <div className="tnum mt-1 font-display text-xl font-bold text-foreground">
            {abstEsperada > 1e6 ? `${(abstEsperada / 1e6).toFixed(2)} M` : formatInt(abstEsperada)}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            personas
          </div>
        </div>

        {/* KPI 3: Riesgo (de 100) */}
        <div className="col-span-2 min-[360px]:col-span-1 rounded-lg border border-border bg-card p-3">
          <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
            <span>Riesgo</span>
            <InfoTip term="risk_score" size="xs" />
          </div>
          <div className="tnum mt-1 font-display text-xl font-bold text-foreground">
            {selectedDetail.risk_score ?? "—"}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            de 100
          </div>
        </div>
      </div>

      {/* SECTIONS IN SPECIFIED ORDER */}

      {/* 1. Participación histórica (Sparkline) */}
      <section className="rounded-lg border border-border bg-card p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
            <span>Participación histórica</span>
            <InfoTip
              term={"detalle.serie" as any}
              title="Serie Histórica de Participación"
              text="Evolución de la participación electoral en elecciones de Diputaciones Federales (2009–2024), Presidenciales y Judicial 2025. Los huecos representan años con información no confiable (> 50 % de registros no especificados)."
              size="xs"
            />
          </div>
          <span className="text-[10px] text-muted-foreground">INE CCPC</span>
        </div>
        <Sparkline
          series={selectedDetail.series}
          predParticipation={selectedDetail.pred_participation}
          targetYear={2027}
        />
        {selectedDetail.series?.some((p) => p.participation === null || p.reliable === false) && (
          <div className="mt-2 text-[10px] text-muted-foreground flex items-center justify-between bg-muted/60 px-2.5 py-1.5 rounded-lg border border-border">
            <span className="flex items-center gap-1 text-risk-high font-medium">
              <span>⚠️</span>
              <span>Contiene años sin información confiable (&gt; 50 % no especificados)</span>
            </span>
            <InfoTip term="confiabilidad" size="xs" />
          </div>
        )}
      </section>

      {/* 2. Componentes del índice (barras horizontales bg-primary) */}
      <section className="rounded-lg border border-border bg-card p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 text-xs font-bold text-foreground">
            <span>Componentes del índice</span>
            <InfoTip
              term={"detalle.componentes" as any}
              title="Componentes del Índice"
              text="Ponderación que integra el índice de riesgo: 50% abstención pronosticada, 20% vulnerabilidad sociodemográfica, 15% tendencia de caída y 15% volatilidad."
              size="xs"
            />
          </div>
          <span className="text-[10px] text-muted-foreground font-mono">Pesos del Semáforo</span>
        </div>

        <div className="space-y-2">
          {/* r_abs (50%) */}
          <div>
            <div className="flex justify-between items-center text-xs mb-0.5">
              <span className="text-muted-foreground text-[11px] inline-flex items-center gap-1">
                <span>Pronóstico de abstención (50%)</span>
                <InfoTip term="r_abs" size="xs" />
              </span>
              <span className="font-mono font-bold text-foreground text-[11px] tnum">
                {selectedDetail.r_abs !== undefined && selectedDetail.r_abs !== null
                  ? `${(selectedDetail.r_abs <= 1 ? selectedDetail.r_abs * 100 : selectedDetail.r_abs).toFixed(1)} pts`
                  : selectedDetail.pred_abstention !== null
                  ? formatPct(selectedDetail.pred_abstention)
                  : "—"}
              </span>
            </div>
            <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
              <div
                className="h-1.5 rounded-full bg-primary"
                style={{
                  width: `${Math.min(
                    100,
                    Math.max(
                      0,
                      selectedDetail.r_abs !== null && selectedDetail.r_abs !== undefined
                        ? selectedDetail.r_abs <= 1
                          ? selectedDetail.r_abs * 100
                          : selectedDetail.r_abs
                        : selectedDetail.pred_abstention
                        ? selectedDetail.pred_abstention * 100
                        : 50
                    )
                  )}%`,
                }}
              />
            </div>
          </div>

          {/* r_vuln (20%) */}
          <div>
            <div className="flex justify-between items-center text-xs mb-0.5">
              <span className="text-muted-foreground text-[11px] inline-flex items-center gap-1">
                <span>Vulnerabilidad sociodemográfica (20%)</span>
                <InfoTip term="r_vuln" size="xs" />
              </span>
              <span className="font-mono font-bold text-foreground text-[11px] tnum">
                {selectedDetail.r_vuln !== undefined && selectedDetail.r_vuln !== null
                  ? `${(selectedDetail.r_vuln <= 1 ? selectedDetail.r_vuln * 100 : selectedDetail.r_vuln).toFixed(1)} pts`
                  : selectedDetail.vulnerability_pp !== undefined && selectedDetail.vulnerability_pp !== null
                  ? formatPp(selectedDetail.vulnerability_pp)
                  : "—"}
              </span>
            </div>
            <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
              <div
                className="h-1.5 rounded-full bg-primary"
                style={{
                  width: `${Math.min(
                    100,
                    Math.max(
                      0,
                      selectedDetail.r_vuln !== null && selectedDetail.r_vuln !== undefined
                        ? selectedDetail.r_vuln <= 1
                          ? selectedDetail.r_vuln * 100
                          : selectedDetail.r_vuln
                        : 50
                    )
                  )}%`,
                }}
              />
            </div>
          </div>

          {/* r_trend (15%) */}
          <div>
            <div className="flex justify-between items-center text-xs mb-0.5">
              <span className="text-muted-foreground text-[11px] inline-flex items-center gap-1">
                <span>Tendencia histórica de caída (15%)</span>
                <InfoTip term="r_trend" size="xs" />
              </span>
              <span className="font-mono font-bold text-foreground text-[11px] tnum">
                {selectedDetail.r_trend !== undefined && selectedDetail.r_trend !== null
                  ? `${(selectedDetail.r_trend <= 1 ? selectedDetail.r_trend * 100 : selectedDetail.r_trend).toFixed(1)} pts`
                  : formatPp(selectedDetail.trend_pp)}
              </span>
            </div>
            <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
              <div
                className="h-1.5 rounded-full bg-primary"
                style={{
                  width: `${Math.min(
                    100,
                    Math.max(
                      0,
                      selectedDetail.r_trend !== null && selectedDetail.r_trend !== undefined
                        ? selectedDetail.r_trend <= 1
                          ? selectedDetail.r_trend * 100
                          : selectedDetail.r_trend
                        : 50
                    )
                  )}%`,
                }}
              />
            </div>
          </div>

          {/* r_vol (15%) */}
          <div>
            <div className="flex justify-between items-center text-xs mb-0.5">
              <span className="text-muted-foreground text-[11px] inline-flex items-center gap-1">
                <span>Volatilidad histórica (15%)</span>
                <InfoTip term="r_vol" size="xs" />
              </span>
              <span className="font-mono font-bold text-foreground text-[11px] tnum">
                {selectedDetail.r_vol !== undefined && selectedDetail.r_vol !== null
                  ? `${(selectedDetail.r_vol <= 1 ? selectedDetail.r_vol * 100 : selectedDetail.r_vol).toFixed(1)} pts`
                  : "—"}
              </span>
            </div>
            <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
              <div
                className="h-1.5 rounded-full bg-primary"
                style={{
                  width: `${Math.min(
                    100,
                    Math.max(
                      0,
                      selectedDetail.r_vol !== null && selectedDetail.r_vol !== undefined
                        ? selectedDetail.r_vol <= 1
                          ? selectedDetail.r_vol * 100
                          : selectedDetail.r_vol
                        : 50
                    )
                  )}%`,
                }}
              />
            </div>
          </div>
        </div>

        {/* Frase explicativa */}
        <p className="text-[11px] text-muted-foreground bg-muted/60 p-2.5 rounded-lg border border-border leading-relaxed">
          {selectedDetail.r_vuln && selectedDetail.r_vuln > 70
            ? "La vulnerabilidad estructural sociodemográfica (marginación y perfil poblacional) es el factor dominante en el nivel de riesgo de esta zona frente al promedio nacional."
            : isTrendNegative
            ? "La persistente tendencia a la baja en la participación electoral histórica amplifica la alerta del semáforo hacia 2027."
            : "El semáforo combina la inercia proyectada de abstención (50%), la vulnerabilidad del censo (20%) y la dinámica histórica de volatilidad y tendencia."}
        </p>
      </section>

      {/* 3. Perfil edad × sexo (CCPC) */}
      {selectedDetail.profile && selectedDetail.profile.length > 0 && (
        <section className="rounded-lg border border-border bg-card p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <div>
                <h3 className="text-xs font-bold text-foreground">
                  Perfil por edad y sexo (CCPC)
                </h3>
                <p className="text-[10px] text-muted-foreground">Comparativa mujeres vs hombres</p>
              </div>
              <InfoTip term="perfil_edad_sexo" size="xs" />
            </div>

            {/* Year Selector Tabs */}
            {profileYears.length > 1 && (
              <div className="inline-flex rounded-lg p-0.5 bg-muted border border-border text-[10px]">
                {profileYears.map((yr) => (
                  <button
                    key={yr}
                    type="button"
                    onClick={() => setProfileYear(yr)}
                    className={`px-2 py-0.5 rounded font-medium transition-colors cursor-pointer ${
                      activeYear === yr
                        ? "bg-card text-primary shadow-xs font-semibold"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {yr}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Age Group Bars */}
          <div className="space-y-2 pt-1">
            {ageGroups.map((grp) => {
              const rowM = activeProfile.find((r) => r.age_group === grp && r.sexo === "M");
              const rowH = activeProfile.find((r) => r.age_group === grp && r.sexo === "H");
              const suppM = formatSuppressed(rowM ?? {});
              const suppH = formatSuppressed(rowH ?? {});

              return (
                <div key={grp} className="bg-muted/40 p-2.5 rounded-lg border border-border/80 space-y-1.5">
                  <div className="text-[11px] font-bold text-foreground flex items-center justify-between">
                    <span>Grupo {grp} años</span>
                  </div>

                  {/* Mujeres */}
                  <div className="text-[10px]">
                    <div className="flex justify-between items-center text-muted-foreground mb-0.5">
                      <span className="flex items-center gap-1">
                        <span className="size-2 rounded-full bg-ink inline-block"></span>
                        <span className="text-foreground">Mujeres</span>
                      </span>
                      {suppM ? (
                        <span className="text-risk-high font-semibold italic text-[9px]">{suppM}</span>
                      ) : (
                        <span className="font-mono font-bold text-foreground tnum">
                          {formatPct(rowM?.participation)}
                        </span>
                      )}
                    </div>
                    {!suppM && rowM?.participation !== null && rowM?.participation !== undefined && (
                      <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                        <div
                          className="h-1.5 rounded-full bg-ink"
                          style={{ width: `${Math.min(100, Math.max(0, rowM.participation * 100))}%` }}
                        />
                      </div>
                    )}
                  </div>

                  {/* Hombres */}
                  <div className="text-[10px]">
                    <div className="flex justify-between items-center text-muted-foreground mb-0.5">
                      <span className="flex items-center gap-1">
                        <span className="size-2 rounded-full bg-primary inline-block"></span>
                        <span className="text-foreground">Hombres</span>
                      </span>
                      {suppH ? (
                        <span className="text-risk-high font-semibold italic text-[9px]">{suppH}</span>
                      ) : (
                        <span className="font-mono font-bold text-foreground tnum">
                          {formatPct(rowH?.participation)}
                        </span>
                      )}
                    </div>
                    {!suppH && rowH?.participation !== null && rowH?.participation !== undefined && (
                      <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                        <div
                          className="h-1.5 rounded-full bg-primary"
                          style={{ width: `${Math.min(100, Math.max(0, rowH.participation * 100))}%` }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 4. Indicadores CCPC (INE) */}
      <section className="rounded-lg border border-border bg-card p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 text-xs font-bold text-foreground">
            <span>Indicadores CCPC (INE)</span>
            <InfoTip term="ccpc.pct_ln_18_34" size="xs" />
          </div>
          <span className="text-[10px] text-muted-foreground">Conteos Censales</span>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-muted/40 p-2 rounded-lg border border-border">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground block">Jóvenes (18–34) en Lista</span>
              <InfoTip term="ccpc.pct_ln_18_34" size="xs" />
            </div>
            <span className="font-mono font-bold text-foreground text-xs mt-0.5 block tnum">
              {formatPct(selectedDetail.ccpc?.pct_ln_18_34)}
            </span>
          </div>

          <div className="bg-muted/40 p-2 rounded-lg border border-border">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground block">Part. Jóvenes (18–34)</span>
              <InfoTip term="ccpc.part_18_34" size="xs" />
            </div>
            <span className="font-mono font-bold text-foreground text-xs mt-0.5 block tnum">
              {formatPct(selectedDetail.ccpc?.part_18_34)}
            </span>
          </div>

          <div className="bg-muted/40 p-2 rounded-lg border border-border">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground block">Brecha Juvenil vs Promedio</span>
              <InfoTip term="ccpc.gap_youth_pp" size="xs" />
            </div>
            <span className="font-mono font-bold text-risk-high text-xs mt-0.5 block tnum">
              {formatPp(selectedDetail.ccpc?.gap_youth_pp)}
            </span>
          </div>

          <div className="bg-muted/40 p-2 rounded-lg border border-border">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground block">Brecha Género (M − H)</span>
              <InfoTip term="ccpc.gap_sexo_pp" size="xs" />
            </div>
            <span className="font-mono font-bold text-primary text-xs mt-0.5 block tnum">
              {formatPp(selectedDetail.ccpc?.gap_sexo_pp)}
            </span>
          </div>

          <div className="bg-muted/40 p-2 rounded-lg border border-border">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground block">Lista Nominal Rural</span>
              <InfoTip term="ccpc.pct_ln_rural" size="xs" />
            </div>
            <span className="font-mono font-bold text-foreground text-xs mt-0.5 block tnum">
              {formatPct(selectedDetail.ccpc?.pct_ln_rural)}
            </span>
          </div>

          <div className="bg-muted/40 p-2 rounded-lg border border-border">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground block">Participación Judicial 2025</span>
              <InfoTip
                title="Participación Elección Judicial 2025"
                text="Participación ciudadana registrada en la elección extraordinaria del Poder Judicial de la Federación 2025. Se presenta como referencia independiente del histórico federal."
                size="xs"
              />
            </div>
            <span className="font-mono font-bold text-foreground text-xs mt-0.5 block tnum">
              {formatPct(selectedDetail.pj_2025?.participation ?? selectedDetail.part_pj_2025)}
            </span>
          </div>
        </div>
      </section>

      {/* 5. Factores explicativos (barras bg-bad / bg-good según signo) */}
      <section className="rounded-lg border border-border bg-card p-3 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 text-xs font-bold text-foreground">
            <span>Factores explicativos</span>
            <InfoTip term="factores" size="xs" />
          </div>
          <span className="text-[10px] text-muted-foreground">Impacto en abstención</span>
        </div>

        {!selectedDetail.drivers || selectedDetail.drivers.length === 0 ? (
          <div className="text-xs text-muted-foreground py-3 text-center flex items-center justify-center gap-1.5">
            <span>Sin información suficiente</span>
            <InfoTip term="sin_dato" size="xs" />
          </div>
        ) : !hasProminentDrivers(selectedDetail.drivers) ? (
          <div className="text-xs text-muted-foreground py-3 text-center">
            Sin factores sociodemográficos destacados
          </div>
        ) : (
          <div className="space-y-2">
            {selectedDetail.drivers.map((d) => {
              const isUp = d.direction === "sube_abstencion";

              return (
                <div key={d.key} className="text-xs">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-muted-foreground text-[11px] truncate max-w-[200px]" title={d.label}>
                      {d.label}
                    </span>
                    <span
                      className={`font-mono font-bold text-[11px] tnum ${isUp ? "text-bad" : "text-good"}`}
                    >
                      {isUp ? `+${d.contribution_pp.toFixed(1)} pp` : `-${Math.abs(d.contribution_pp).toFixed(1)} pp`}
                    </span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden flex">
                    <div
                      className={`h-1.5 rounded-full ${isUp ? "bg-bad" : "bg-good"}`}
                      style={{
                        width: `${Math.min(100, Math.abs(d.contribution_pp) * 20)}%`,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 6. Recomendaciones preventivas (tarjeta border-primary/20 bg-primary-soft) */}
      <section className="rounded-lg border border-primary/20 bg-primary-soft p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
            <svg className="w-3.5 h-3.5 text-primary" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.87-3.13-7-7-7zm-2 17h4v1h-4v-1zm1-15c0-.55.45-1 1-1s1 .45 1 1v1h-2V4zm-3.5 1.5l1.41 1.41-1.41 1.41-.71-.71 1.41-1.41.71-.7zM4 10h2v2H4v-2zm14 0h2v2h-2v-2zm-3.5-4.5l.71.7-1.41 1.41-.71-.71 1.41-1.4z" />
            </svg>
            <span>Recomendaciones preventivas</span>
            <InfoTip term="recomendaciones" size="xs" />
          </div>
        </div>

        {!selectedDetail.recommendations || selectedDetail.recommendations.length === 0 ? (
          <div className="text-xs text-muted-foreground py-2 text-center">
            Sin recomendaciones específicas registradas para esta zona
          </div>
        ) : (
          <ul className="space-y-2 text-xs">
            {selectedDetail.recommendations.map((rec) => (
              <li key={rec.id} className="space-y-0.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 font-semibold text-foreground">
                    <span className="text-primary font-bold">•</span>
                    <span>{rec.title}</span>
                  </div>
                  <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border border-border bg-card text-muted-foreground shrink-0">
                    Prioridad {rec.priority}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground pl-3 leading-relaxed">
                  {rec.rationale}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 7. Prioridad estratégica */}
      <section className="rounded-lg border border-border bg-card p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 text-xs font-bold text-foreground">
            <span>Atención Estratégica</span>
            <InfoTip term="prioridad" size="xs" />
          </div>
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          {selectedDetail.prioridad !== undefined && selectedDetail.prioridad !== null ? (
            <>
              <span className="text-lg font-bold font-display text-primary tnum">
                #{selectedDetail.prioridad}
              </span>
              <span className="text-xs text-muted-foreground">en zonas prioritarias</span>
            </>
          ) : selectedDetail.category === "rojo" || selectedDetail.category === "naranja" ? (
            <span className="text-xs font-bold text-risk-high">Atención prioritaria</span>
          ) : (
            <span className="text-xs font-medium text-muted-foreground">Riesgo moderado / bajo</span>
          )}
        </div>
      </section>

      {/* 8. Elección Judicial 2025 */}
      <section className="rounded-lg border border-border bg-card p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 text-xs font-bold text-foreground">
            <span>Elección Judicial 2025</span>
            <InfoTip
              title="Participación Elección Judicial 2025"
              text="Participación ciudadana registrada en la elección extraordinaria del Poder Judicial de la Federación 2025. Se presenta como referencia independiente del histórico federal."
              size="xs"
            />
          </div>
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-lg font-bold font-display text-foreground tnum">
            {formatPct(selectedDetail.pj_2025?.participation ?? selectedDetail.part_pj_2025)}
          </span>
          <span className="text-xs text-muted-foreground">participación registrada</span>
        </div>
      </section>

      {/* Scenario Comparisons */}
      {selectedDetail.scenarios && selectedDetail.scenarios.length > 0 && (
        <section className="rounded-lg border border-border bg-card p-3 space-y-2">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
              <span>Comparación de Escenarios (Abstención 2027)</span>
              <InfoTip
                term={"detalle.escenarios" as any}
                title="Comparación de Escenarios"
                text="Contrasta el pronóstico de abstención 2027 en los tres escenarios: Base (inercial), Con Intervención (acciones focalizadas del INE) y Pesimista (caída general de participación)."
                size="xs"
              />
            </div>
            <span className="text-[10px] text-muted-foreground font-normal">
              (negativo = menos abstención)
            </span>
          </div>
          <div className="space-y-2">
            {selectedDetail.scenarios.map((sc) => {
              const isIntervencion = sc.scenario === "intervencion";
              const label =
                sc.scenario === "base"
                  ? "Base (Inercial)"
                  : isIntervencion
                  ? "Con Intervención"
                  : "Pesimista";
              const hasVal = sc.pred_abstention !== null && sc.pred_abstention !== undefined && !isNaN(sc.pred_abstention);
              const scStyle = CATEGORY_STYLES[sc.category] ?? CATEGORY_STYLES.sin_dato;

              const baseAbst = selectedDetail.scenarios.find((s) => s.scenario === "base")?.pred_abstention;
              const scDelta =
                sc.scenario !== "base" &&
                baseAbst !== undefined &&
                baseAbst !== null &&
                hasVal
                  ? (sc.pred_abstention! - baseAbst) * 100
                  : null;

              return (
                <div
                  key={sc.scenario}
                  className={`p-2 rounded-lg transition-colors border ${
                    isIntervencion
                      ? "border-primary/30 bg-primary-soft/50"
                      : "border-border/60 bg-muted/30"
                  }`}
                >
                  <div className="flex justify-between text-xs mb-1">
                    <span className={isIntervencion ? "text-primary font-semibold" : "text-foreground font-medium"}>
                      {label}
                    </span>
                    <span className="font-mono font-bold text-foreground flex items-center gap-1.5 tnum">
                      {hasVal ? (
                        <span>{formatPct(sc.pred_abstention)}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <span>sin dato</span>
                          <InfoTip term="sin_dato" size="xs" />
                        </span>
                      )}
                      {scDelta !== null && (
                        <span
                          className={`text-[10px] font-semibold ${
                            scDelta < 0 ? "text-good" : scDelta > 0 ? "text-bad" : "text-muted-foreground"
                          }`}
                          title="Cambio en abstención vs base (negativo = menos abstención)"
                        >
                          ({formatDeltaPp(scDelta)})
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                    {hasVal ? (
                      <div
                        className={`h-2 rounded-full ${scStyle.bgClass}`}
                        style={{ width: `${Math.min(100, Math.max(0, sc.pred_abstention! * 100))}%` }}
                      />
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Sociodemographic Features vs National Median */}
      {selectedDetail.features && selectedDetail.features.length > 0 && (
        <section className="rounded-lg border border-border bg-card p-3 space-y-2">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
              <span>Variables sociodemográficas</span>
              <InfoTip term="vulnerability_pp" size="xs" />
            </div>
            <span className="text-[10px] text-muted-foreground">INEGI / CONAPO</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border text-[10px] text-muted-foreground">
                  <th className="py-1 font-semibold">Indicador</th>
                  <th className="py-1 text-right font-semibold">Valor</th>
                  <th className="py-1 text-right font-semibold">Mediana Nal.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {selectedDetail.features.slice(0, 10).map((f) => (
                  <tr key={f.key} className="hover:bg-accent/40">
                    <td className="py-1.5 text-muted-foreground text-[11px] pr-2">{f.label}</td>
                    <td className="py-1.5 text-right font-mono font-bold text-foreground tnum">
                      {typeof f.value === "number"
                        ? f.unit === "proporción"
                          ? formatPct(f.value)
                          : f.unit === "personas" || f.unit === "votos" || f.unit === "hab."
                          ? formatInt(f.value)
                          : f.value.toFixed(1)
                        : f.value ?? "—"}
                    </td>
                    <td className="py-1.5 text-right font-mono text-muted-foreground text-[10px] tnum">
                      {f.national_median !== null
                        ? typeof f.national_median === "number"
                          ? f.unit === "proporción"
                            ? formatPct(f.national_median)
                            : f.unit === "personas" || f.unit === "votos" || f.unit === "hab."
                            ? formatInt(f.national_median)
                            : f.national_median.toFixed(1)
                          : String(f.national_median)
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Municipios of the State (when in state detail and municipalities are available) */}
      {stateMunis.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between px-1 text-xs font-bold text-foreground">
            <span className="flex items-center gap-1.5">
              <span>Municipios de {selectedDetail.name}</span>
            </span>
            <span className="text-[11px] font-normal text-muted-foreground">
              {stateMunis.length} evaluados
            </span>
          </div>
          <div className="space-y-1.5">
            {getTopRiskZones(stateMunis, 8).map((m, idx) => {
              const abstEsp = getAbstencionEsperada(m);
              const mStyle = CATEGORY_STYLES[m.category] ?? CATEGORY_STYLES.sin_dato;

              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => selectRegion(m.id)}
                  className="flex w-full min-h-[40px] items-center gap-3 rounded-lg border border-border bg-card p-2 text-left hover:bg-accent transition-colors group cursor-pointer"
                >
                  <span className="tnum w-4 text-xs font-mono font-bold text-muted-foreground group-hover:text-foreground shrink-0">
                    {idx + 1}
                  </span>
                  <span className={`size-2.5 shrink-0 rounded-full ${mStyle.dotClass}`} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold text-foreground group-hover:text-primary transition-colors">
                      {m.name}
                    </div>
                    <div className="tnum text-[11px] text-muted-foreground">
                      Abst. {formatPct(m.pred_abstention)} · {formatInt(abstEsp)} pers.
                    </div>
                  </div>
                  <span className="tnum text-xs font-bold font-display text-foreground shrink-0 ml-1">
                    {m.risk_score ?? "—"}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
