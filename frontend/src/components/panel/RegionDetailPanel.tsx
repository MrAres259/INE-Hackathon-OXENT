"use client";

import React, { useState, useEffect } from "react";
import { useAtalaya } from "@/lib/state";
import { getMetrics } from "@/lib/api";
import type { ModelMetrics } from "@/lib/types";
import {
  formatPct,
  formatPp,
  formatInt,
  formatDeltaPp,
  getDeltaAbstentionColorClass,
  hasProminentDrivers,
  getCategoryColor,
  getCategoryLabel,
  CATEGORY_COLORS,
  formatSuppressed,
  getAbstencionEsperada,
} from "@/lib/format";
import { Sparkline } from "@/components/viz/Sparkline";
import { InfoTip } from "@/components/ui/InfoTip";
import type { GlossaryKey } from "@/lib/glossary";

export function RegionDetailPanel() {
  const {
    selectedDetail,
    loadingDetail,
    riskItems,
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

  // If loading
  if (loadingDetail) {
    return (
      <div className="p-6 text-center text-slate-400 space-y-3">
        <svg className="animate-spin h-6 w-6 text-emerald-500 mx-auto" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
        </svg>
        <p className="text-xs">Cargando diagnóstico territorial...</p>
      </div>
    );
  }

  // NATIONAL SUMMARY VIEW (When no region is selected)
  if (!selectedDetail) {
    const top5Risk = [...riskItems]
      .sort((a, b) => (b.risk_score ?? 0) - (a.risk_score ?? 0))
      .slice(0, 5);

    const counts = { verde: 0, amarillo: 0, naranja: 0, rojo: 0, sin_dato: 0 };
    riskItems.forEach((item) => {
      if (item.category in counts) counts[item.category]++;
    });

    return (
      <div className="space-y-6">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800">
            Vista General
          </span>
          <h2 className="text-xl font-extrabold text-white mt-1">Diagnóstico Nacional 2027</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Selecciona una entidad o municipio en el mapa para ver su pronóstico detallado y factores explicativos.
          </p>
        </div>

        {/* Global summary stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-800/80 p-3 rounded-xl border border-slate-700/60">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-400">Total Zonas Evaluadas</span>
              <InfoTip
                title="Total de Zonas Evaluadas"
                text="Número total de entidades federativas (32) o municipios (2,478) evaluados y modelados según el nivel territorial activo."
                size="xs"
              />
            </div>
            <div className="text-xl font-bold text-white mt-0.5">{riskItems.length}</div>
          </div>
          <div className="bg-slate-800/80 p-3 rounded-xl border border-slate-700/60">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-400">Escenario Activo</span>
              <InfoTip term="escenarios" size="xs" />
            </div>
            <div className="text-base font-bold text-emerald-400 capitalize mt-0.5">{scenario}</div>
          </div>
        </div>

        {/* Categories Distribution */}
        <div className="bg-slate-800/40 p-4 rounded-xl border border-slate-800">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
              Distribución por Semáforo de Riesgo
            </h3>
            <InfoTip term="semaforo" size="xs" />
          </div>
          <div className="space-y-2">
            {(["rojo", "naranja", "amarillo", "verde"] as const).map((cat) => {
              const count = counts[cat];
              const pct = riskItems.length > 0 ? (count / riskItems.length) * 100 : 0;
              return (
                <div key={cat}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="flex items-center gap-1.5 font-medium text-slate-300">
                      <span className="w-2.5 h-2.5 rounded-xs" style={{ backgroundColor: CATEGORY_COLORS[cat] }}></span>
                      {getCategoryLabel(cat)}
                    </span>
                    <span className="font-mono text-slate-400">
                      {count} ({pct.toFixed(0)}%)
                    </span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                    <div
                      className="h-2 rounded-full transition-all duration-500"
                      style={{ width: `${pct}%`, backgroundColor: CATEGORY_COLORS[cat] }}
                    ></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Top 5 Critical Risk Regions */}
        <div>
          <div className="flex items-center justify-between mb-2.5">
            <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
              Zonas de Mayor Riesgo
            </h3>
            <InfoTip term="risk_score" size="xs" />
          </div>
          <div className="space-y-1.5">
            {top5Risk.map((item, idx) => (
              <div
                key={item.id}
                className="w-full p-2.5 rounded-lg bg-slate-800/60 hover:bg-slate-800 border border-slate-700/50 hover:border-slate-600 transition-colors flex items-center justify-between group"
              >
                <button
                  type="button"
                  onClick={() => selectRegion(item.id)}
                  className="flex items-center gap-2.5 flex-1 min-w-0 text-left cursor-pointer"
                >
                  <span className="text-xs font-mono font-bold text-slate-400 group-hover:text-white shrink-0">
                    #{idx + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-white group-hover:text-emerald-400 transition-colors truncate">
                      {item.name}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      Abstención pronosticada: {formatPct(item.pred_abstention)}
                    </div>
                  </div>
                </button>
                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                  <button
                    type="button"
                    onClick={() => selectRegion(item.id)}
                    className="text-[11px] font-bold font-mono px-2 py-0.5 rounded text-white cursor-pointer hover:opacity-90"
                    style={{ backgroundColor: getCategoryColor(item.category) }}
                    title="Ver detalle de la zona"
                  >
                    {item.risk_score} pts
                  </button>
                  <InfoTip
                    title="Puntos de Riesgo (pts)"
                    text="Puntaje en la escala de 0 a 100 del índice de riesgo. A mayor puntaje, mayor riesgo relativo de abstención."
                    size="xs"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // REGION SELECTED DETAIL VIEW
  const catColor = getCategoryColor(selectedDetail.category);
  const catLabel = getCategoryLabel(selectedDetail.category);
  const isTrendNegative = (selectedDetail.trend_pp ?? 0) < 0;
  const abstEsperada = getAbstencionEsperada(selectedDetail);

  // 1-line plain language diagnostic summary (Task 3)
  const summaryLine = (() => {
    const catWord =
      selectedDetail.category && selectedDetail.category !== "sin_dato"
        ? getCategoryLabel(selectedDetail.category).replace(/^Riesgo\s+/i, "").toLowerCase()
        : null;
    const scoreVal = selectedDetail.risk_score;
    const scorePart = scoreVal !== undefined && scoreVal !== null ? `(${scoreVal} de 100)` : null;

    let riskPrefix = "";
    if (catWord && scorePart) {
      riskPrefix = `Riesgo ${catWord} ${scorePart}`;
    } else if (catWord) {
      riskPrefix = `Riesgo ${catWord}`;
    } else if (scorePart) {
      riskPrefix = `Índice de riesgo ${scorePart}`;
    }

    const hasAbst =
      selectedDetail.pred_abstention !== null &&
      selectedDetail.pred_abstention !== undefined &&
      !isNaN(selectedDetail.pred_abstention);
    const abstPct = hasAbst ? (selectedDetail.pred_abstention! * 100).toFixed(1) : null;
    const hasPeople = abstEsperada > 0;
    const peopleStr = hasPeople ? ` (≈ ${formatInt(abstEsperada)} personas)` : "";

    let abstSentence = "";
    if (abstPct) {
      abstSentence = `se espera que no vote el ${abstPct} % de su lista nominal en 2027${peopleStr}`;
    }

    if (riskPrefix && abstSentence) {
      return `${riskPrefix}: ${abstSentence}.`;
    } else if (riskPrefix) {
      return `${riskPrefix}.`;
    } else if (abstSentence) {
      return `${abstSentence.charAt(0).toUpperCase() + abstSentence.slice(1)}.`;
    }
    return null;
  })();

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
    <div className="space-y-6">
      {/* Header & Badges */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
              {selectedDetail.level === "state" ? "Entidad Federativa" : "Municipio"} · Clave {selectedDetail.id}
            </span>
            {selectedDetail.reliable === false && (
              <span
                className="text-[10px] font-semibold bg-rose-950/80 text-rose-300 border border-rose-800/80 px-2 py-0.5 rounded-full flex items-center gap-1"
                title="Información con alta tasa de registros no especificados (> 50 %)"
              >
                <span>⚠️</span>
                <span>Sin información confiable</span>
                <InfoTip term="confiabilidad" size="xs" />
              </span>
            )}
            {selectedDetail.imputed_census && (
              <span
                className="text-[10px] font-semibold bg-amber-950/80 text-amber-300 border border-amber-800/80 px-2 py-0.5 rounded-full flex items-center gap-1"
                title="Datos de censo estimados o imputados desde municipio de origen"
              >
                <span>⚠️</span>
                <span>Censo imputado</span>
              </span>
            )}
            {metrics?.drivers_low_confidence && (
              <span
                className="text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700 px-2 py-0.5 rounded-full flex items-center gap-1"
                title="El perfil explicativo presenta menor ajuste en modelos agrupados por estado"
              >
                <span>ℹ️</span>
                <span>Factores con baja confianza</span>
              </span>
            )}
          </div>
          {selectedDetail.parent && (
            <button
              type="button"
              onClick={() => selectState(selectedDetail.parent!.id)}
              className="text-[10px] text-slate-400 hover:text-white transition-colors cursor-pointer flex items-center gap-1 group"
              title={`Volver a ${selectedDetail.parent.name}`}
            >
              <span>Estado:</span>
              <span className="text-emerald-400 font-semibold group-hover:underline">
                {selectedDetail.parent.name}
              </span>
              <span>←</span>
            </button>
          )}
        </div>
        <h2 className="text-xl font-extrabold text-white mt-1.5">{selectedDetail.name}</h2>
        <div className="text-xs text-slate-400 mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1">
            <span>
              Lista nominal: <strong className="text-white">{formatInt(selectedDetail.lista_nominal)}</strong> electores
            </span>
            <InfoTip term="lista_nominal" size="xs" />
          </span>
          {selectedDetail.prioridad !== undefined && selectedDetail.prioridad !== null && (
            <span className="inline-flex items-center gap-1 text-emerald-400 font-semibold">
              <span>· Prioridad #{selectedDetail.prioridad}</span>
              <InfoTip term="prioridad" size="xs" />
            </span>
          )}
        </div>
        {summaryLine && (
          <p className="text-xs text-slate-200 mt-2 bg-slate-800/60 p-2.5 rounded-lg border border-slate-700/60 leading-relaxed">
            {summaryLine}
          </p>
        )}
      </div>

      {/* Main KPI Badges */}
      <div className="grid grid-cols-2 gap-3">
        {/* Risk Score & Semáforo */}
        <div
          className="p-3.5 rounded-xl border flex flex-col justify-between"
          style={{
            backgroundColor: `${catColor}15`,
            borderColor: `${catColor}50`,
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <span className="text-[10px] uppercase font-bold tracking-wider" style={{ color: catColor }}>
                Semáforo de Riesgo
              </span>
              <InfoTip term="semaforo" size="xs" />
            </div>
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: catColor }}></span>
          </div>
          <div className="mt-2">
            <div className="text-2xl font-black text-white flex items-center gap-1.5">
              <span>{selectedDetail.risk_score ?? "—"}</span>
              <span className="text-xs font-normal text-slate-400">/ 100</span>
              <InfoTip term="risk_score" size="xs" />
            </div>
            <div className="text-xs font-bold mt-0.5" style={{ color: catColor }}>
              {catLabel}
            </div>
          </div>
        </div>

        {/* Predicted Abstention 2027 */}
        <div className="bg-slate-800/80 p-3.5 rounded-xl border border-slate-700/80 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
              Abstención Estimada 2027
            </span>
            <InfoTip term="pred_abstention" size="xs" />
          </div>
          <div className="mt-2">
            <div className="text-2xl font-black text-white">
              {formatPct(selectedDetail.pred_abstention)}
            </div>
            {selectedDetail.delta_vs_base_pp !== undefined && selectedDetail.delta_vs_base_pp !== null && (
              <div className="mt-1">
                <span
                  className={`text-xs font-bold font-mono ${getDeltaAbstentionColorClass(
                    selectedDetail.delta_vs_base_pp
                  )}`}
                >
                  {formatDeltaPp(selectedDetail.delta_vs_base_pp)} vs base
                </span>
                <span className="text-[10px] text-slate-400 block">
                  (negativo = menos abstención)
                </span>
              </div>
            )}
            <div className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1">
              <span>Intervalo: [{formatPct(selectedDetail.pred_low)} – {formatPct(selectedDetail.pred_high)}]</span>
              <InfoTip term="intervalo" size="xs" />
            </div>
          </div>
        </div>
      </div>

      {/* Abstención Esperada (personas que se espera no voten) y Prioridad */}
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="bg-slate-800/60 p-3 rounded-xl border border-slate-800">
          <div className="flex items-center justify-between">
            <span className="text-slate-400 block text-[10px] uppercase font-bold">Personas que se espera no voten</span>
            <InfoTip term="abstencion_esperada" size="xs" />
          </div>
          <span className="text-lg font-black text-rose-400 mt-0.5 block font-mono">
            {formatInt(abstEsperada)}
          </span>
          <span className="text-[10px] text-slate-400 mt-0.5 block">
            Abstención esperada 2027
          </span>
        </div>
        <div className="bg-slate-800/60 p-3 rounded-xl border border-slate-800">
          <div className="flex items-center justify-between">
            <span className="text-slate-400 block text-[10px] uppercase font-bold">Atención Estratégica</span>
            <InfoTip term="prioridad" size="xs" />
          </div>
          <div className="mt-0.5">
            {selectedDetail.prioridad !== undefined && selectedDetail.prioridad !== null ? (
              <span className="text-lg font-black text-emerald-400 font-mono">
                #{selectedDetail.prioridad}
              </span>
            ) : selectedDetail.category === "rojo" || selectedDetail.category === "naranja" ? (
              <span className="text-xs font-bold text-amber-400">Atención prioritaria</span>
            ) : (
              <span className="text-xs font-medium text-slate-400">Riesgo moderado/bajo</span>
            )}
          </div>
          <span className="text-[10px] text-slate-400 mt-0.5 block">
            Prioridad en zonas rojas/naranjas
          </span>
        </div>
      </div>

      {/* Secondary Metrics: Last Participation & Trend */}
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="bg-slate-800/40 p-2.5 rounded-lg border border-slate-800">
          <div className="flex items-center justify-between">
            <span className="text-slate-400 block text-[10px]">Última Participación (2024)</span>
            <InfoTip term="participacion" size="xs" />
          </div>
          <span className="text-sm font-bold text-white mt-0.5 block">
            {formatPct(selectedDetail.last_participation)}
          </span>
        </div>
        <div className="bg-slate-800/40 p-2.5 rounded-lg border border-slate-800">
          <div className="flex items-center justify-between">
            <span className="text-slate-400 block text-[10px]">Tendencia por Elección</span>
            <InfoTip term="trend_pp" size="xs" />
          </div>
          <div className="flex items-center gap-1 mt-0.5">
            <span
              className={`text-sm font-bold ${
                isTrendNegative ? "text-amber-400" : "text-emerald-400"
              }`}
            >
              {formatPp(selectedDetail.trend_pp)}
            </span>
            <span className="text-xs">{isTrendNegative ? "▼" : "▲"}</span>
          </div>
        </div>
      </div>

      {/* Bloque: Por qué este nivel de riesgo (4 componentes 50/20/15/15) */}
      <div className="bg-slate-800/40 p-3.5 rounded-xl border border-slate-800 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
              Por qué este nivel de riesgo
            </h3>
            <InfoTip
              term={"detalle.componentes" as any}
              title="Componentes del Índice"
              text="Ponderación que integra el índice de riesgo: 50% abstención pronosticada, 20% vulnerabilidad sociodemográfica, 15% tendencia de caída y 15% volatilidad."
              size="xs"
            />
          </div>
          <span className="text-[10px] text-slate-400 font-mono">Pesos del Semáforo</span>
        </div>

        <div className="space-y-2">
          {/* r_abs (50%) */}
          <div>
            <div className="flex justify-between items-center text-xs mb-0.5">
              <span className="text-slate-300 text-[11px] inline-flex items-center gap-1">
                <span>Pronóstico de abstención (50%)</span>
                <InfoTip term="r_abs" size="xs" />
              </span>
              <span className="font-mono font-bold text-white text-[11px]">
                {selectedDetail.r_abs !== undefined && selectedDetail.r_abs !== null
                  ? `${(selectedDetail.r_abs <= 1 ? selectedDetail.r_abs * 100 : selectedDetail.r_abs).toFixed(1)} pts`
                  : selectedDetail.pred_abstention !== null
                  ? formatPct(selectedDetail.pred_abstention)
                  : "—"}
              </span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
              <div
                className="h-1.5 rounded-full bg-rose-500"
                style={{
                  width: `${Math.min(100, Math.max(0, (selectedDetail.r_abs !== null && selectedDetail.r_abs !== undefined ? (selectedDetail.r_abs <= 1 ? selectedDetail.r_abs * 100 : selectedDetail.r_abs) : (selectedDetail.pred_abstention ? selectedDetail.pred_abstention * 100 : 50))))}%`,
                }}
              ></div>
            </div>
          </div>

          {/* r_vuln (20%) */}
          <div>
            <div className="flex justify-between items-center text-xs mb-0.5">
              <span className="text-slate-300 text-[11px] inline-flex items-center gap-1">
                <span>Vulnerabilidad sociodemográfica (20%)</span>
                <InfoTip term="r_vuln" size="xs" />
              </span>
              <span className="font-mono font-bold text-white text-[11px]">
                {selectedDetail.r_vuln !== undefined && selectedDetail.r_vuln !== null
                  ? `${(selectedDetail.r_vuln <= 1 ? selectedDetail.r_vuln * 100 : selectedDetail.r_vuln).toFixed(1)} pts`
                  : selectedDetail.vulnerability_pp !== undefined && selectedDetail.vulnerability_pp !== null
                  ? formatPp(selectedDetail.vulnerability_pp)
                  : "—"}
              </span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
              <div
                className="h-1.5 rounded-full bg-amber-500"
                style={{
                  width: `${Math.min(100, Math.max(0, (selectedDetail.r_vuln !== null && selectedDetail.r_vuln !== undefined ? (selectedDetail.r_vuln <= 1 ? selectedDetail.r_vuln * 100 : selectedDetail.r_vuln) : 50)))}%`,
                }}
              ></div>
            </div>
          </div>

          {/* r_trend (15%) */}
          <div>
            <div className="flex justify-between items-center text-xs mb-0.5">
              <span className="text-slate-300 text-[11px] inline-flex items-center gap-1">
                <span>Tendencia histórica de caída (15%)</span>
                <InfoTip term="r_trend" size="xs" />
              </span>
              <span className="font-mono font-bold text-white text-[11px]">
                {selectedDetail.r_trend !== undefined && selectedDetail.r_trend !== null
                  ? `${(selectedDetail.r_trend <= 1 ? selectedDetail.r_trend * 100 : selectedDetail.r_trend).toFixed(1)} pts`
                  : formatPp(selectedDetail.trend_pp)}
              </span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
              <div
                className="h-1.5 rounded-full bg-sky-500"
                style={{
                  width: `${Math.min(100, Math.max(0, (selectedDetail.r_trend !== null && selectedDetail.r_trend !== undefined ? (selectedDetail.r_trend <= 1 ? selectedDetail.r_trend * 100 : selectedDetail.r_trend) : 50)))}%`,
                }}
              ></div>
            </div>
          </div>

          {/* r_vol (15%) */}
          <div>
            <div className="flex justify-between items-center text-xs mb-0.5">
              <span className="text-slate-300 text-[11px] inline-flex items-center gap-1">
                <span>Volatilidad histórica (15%)</span>
                <InfoTip term="r_vol" size="xs" />
              </span>
              <span className="font-mono font-bold text-white text-[11px]">
                {selectedDetail.r_vol !== undefined && selectedDetail.r_vol !== null
                  ? `${(selectedDetail.r_vol <= 1 ? selectedDetail.r_vol * 100 : selectedDetail.r_vol).toFixed(1)} pts`
                  : "—"}
              </span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
              <div
                className="h-1.5 rounded-full bg-purple-500"
                style={{
                  width: `${Math.min(100, Math.max(0, (selectedDetail.r_vol !== null && selectedDetail.r_vol !== undefined ? (selectedDetail.r_vol <= 1 ? selectedDetail.r_vol * 100 : selectedDetail.r_vol) : 50)))}%`,
                }}
              ></div>
            </div>
          </div>
        </div>

        {/* Frase explicativa */}
        <p className="text-[11px] text-slate-300 bg-slate-900/60 p-2.5 rounded-lg border border-slate-800 leading-relaxed">
          {selectedDetail.r_vuln && selectedDetail.r_vuln > 70
            ? "La vulnerabilidad estructural sociodemográfica (marginación y perfil poblacional) es el factor dominante en el nivel de riesgo de esta zona frente al promedio nacional."
            : isTrendNegative
            ? "La persistente tendencia a la baja en la participación electoral histórica amplifica la alerta del semáforo hacia 2027."
            : "El semáforo combina la inercia proyectada de abstención (50%), la vulnerabilidad del censo (20%) y la dinámica histórica de volatilidad y tendencia."}
        </p>
      </div>

      {/* Indicadores CCPC y Judicial 2025 */}
      <div className="bg-slate-800/40 p-3.5 rounded-xl border border-slate-800 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
            Indicadores CCPC (INE) y Judicial 2025
          </h3>
          <span className="text-[10px] text-slate-400">Conteos Censales</span>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800/80">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-400 block">Jóvenes (18–34) en Lista</span>
              <InfoTip term="ccpc.pct_ln_18_34" size="xs" />
            </div>
            <span className="font-mono font-bold text-white text-xs mt-0.5 block">
              {formatPct(selectedDetail.ccpc?.pct_ln_18_34)}
            </span>
          </div>
          <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800/80">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-400 block">Part. Jóvenes (18–34)</span>
              <InfoTip term="ccpc.part_18_34" size="xs" />
            </div>
            <span className="font-mono font-bold text-white text-xs mt-0.5 block">
              {formatPct(selectedDetail.ccpc?.part_18_34)}
            </span>
          </div>
          <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800/80">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-400 block">Brecha Juvenil vs Promedio</span>
              <InfoTip term="ccpc.gap_youth_pp" size="xs" />
            </div>
            <span className="font-mono font-bold text-amber-400 text-xs mt-0.5 block">
              {formatPp(selectedDetail.ccpc?.gap_youth_pp)}
            </span>
          </div>
          <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800/80">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-400 block">Brecha Género (Mujeres − Hombres)</span>
              <InfoTip term="ccpc.gap_sexo_pp" size="xs" />
            </div>
            <span className="font-mono font-bold text-sky-400 text-xs mt-0.5 block">
              {formatPp(selectedDetail.ccpc?.gap_sexo_pp)}
            </span>
          </div>
          <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800/80">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-400 block">Lista Nominal Rural</span>
              <InfoTip term="ccpc.pct_ln_rural" size="xs" />
            </div>
            <span className="font-mono font-bold text-white text-xs mt-0.5 block">
              {formatPct(selectedDetail.ccpc?.pct_ln_rural)}
            </span>
          </div>
          <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800/80">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-400 block">Participación Judicial 2025</span>
              <InfoTip
                title="Participación Elección Judicial 2025"
                text="Participación ciudadana registrada en la elección extraordinaria del Poder Judicial de la Federación 2025. Se presenta como referencia independiente del histórico federal."
                size="xs"
              />
            </div>
            <span className="font-mono font-bold text-amber-300 text-xs mt-0.5 block">
              {formatPct(selectedDetail.pj_2025?.participation ?? selectedDetail.part_pj_2025)}
            </span>
          </div>
        </div>
      </div>

      {/* Bloque: Participación por edad y sexo (CCPC) */}
      {selectedDetail.profile && selectedDetail.profile.length > 0 && (
        <div className="bg-slate-800/40 p-3.5 rounded-xl border border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <div>
                <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                  Participación por Edad y Sexo (CCPC)
                </h3>
                <p className="text-[10px] text-slate-400">Comparativa mujeres vs hombres</p>
              </div>
              <InfoTip term="perfil_edad_sexo" size="xs" />
            </div>

            {/* Year Selector Tabs */}
            {profileYears.length > 1 && (
              <div className="inline-flex rounded-lg p-0.5 bg-slate-900 border border-slate-800 text-[10px]">
                {profileYears.map((yr) => (
                  <button
                    key={yr}
                    type="button"
                    onClick={() => setProfileYear(yr)}
                    className={`px-2 py-0.5 rounded font-medium transition-colors ${
                      activeYear === yr ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white"
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
                <div key={grp} className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/80 space-y-1.5">
                  <div className="text-[11px] font-bold text-slate-200 flex items-center justify-between">
                    <span>Grupo {grp} años</span>
                  </div>

                  {/* Mujeres */}
                  <div className="text-[10px]">
                    <div className="flex justify-between items-center text-slate-300 mb-0.5">
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-purple-400 inline-block"></span>
                        <span>Mujeres</span>
                      </span>
                      {suppM ? (
                        <span className="text-amber-400 font-semibold italic text-[9px]">{suppM}</span>
                      ) : (
                        <span className="font-mono font-bold text-white">{formatPct(rowM?.participation)}</span>
                      )}
                    </div>
                    {!suppM && rowM?.participation !== null && rowM?.participation !== undefined && (
                      <div className="w-full bg-slate-800 rounded-full h-1 overflow-hidden">
                        <div
                          className="h-1 rounded-full bg-purple-400"
                          style={{ width: `${Math.min(100, Math.max(0, rowM.participation * 100))}%` }}
                        ></div>
                      </div>
                    )}
                  </div>

                  {/* Hombres */}
                  <div className="text-[10px]">
                    <div className="flex justify-between items-center text-slate-300 mb-0.5">
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-sky-400 inline-block"></span>
                        <span>Hombres</span>
                      </span>
                      {suppH ? (
                        <span className="text-amber-400 font-semibold italic text-[9px]">{suppH}</span>
                      ) : (
                        <span className="font-mono font-bold text-white">{formatPct(rowH?.participation)}</span>
                      )}
                    </div>
                    {!suppH && rowH?.participation !== null && rowH?.participation !== undefined && (
                      <div className="w-full bg-slate-800 rounded-full h-1 overflow-hidden">
                        <div
                          className="h-1 rounded-full bg-sky-400"
                          style={{ width: `${Math.min(100, Math.max(0, rowH.participation * 100))}%` }}
                        ></div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Scenario Comparisons */}
      {selectedDetail.scenarios && selectedDetail.scenarios.length > 0 && (
        <div className="bg-slate-800/40 p-3.5 rounded-xl border border-slate-800">
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-1.5">
              <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                Comparación de Escenarios (Abstención 2027)
              </h3>
              <InfoTip
                term={"detalle.escenarios" as any}
                title="Comparación de Escenarios"
                text="Contrasta el pronóstico de abstención 2027 en los tres escenarios: Base (inercial), Con Intervención (acciones focalizadas del INE) y Pesimista (caída general de participación)."
                size="xs"
              />
            </div>
            <span className="text-[10px] text-slate-400 font-normal">
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
              const color = CATEGORY_COLORS[sc.category];

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
                  className={`p-2 rounded-lg transition-colors ${
                    isIntervencion
                      ? "bg-emerald-950/30 border border-emerald-500/30"
                      : "border border-transparent"
                  }`}
                >
                  <div className="flex justify-between text-xs mb-1">
                    <span className={isIntervencion ? "text-emerald-400 font-semibold" : "text-slate-300 font-medium"}>
                      {label}
                    </span>
                    <span className="font-mono font-bold text-white flex items-center gap-1.5">
                      {hasVal ? (
                        <span>{formatPct(sc.pred_abstention)}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-slate-400">
                          <span>sin dato</span>
                          <InfoTip term="sin_dato" size="xs" />
                        </span>
                      )}
                      {scDelta !== null && (
                        <span
                          className={`text-[10px] ${getDeltaAbstentionColorClass(scDelta)}`}
                          title="Cambio en abstención vs base (negativo = menos abstención)"
                        >
                          ({formatDeltaPp(scDelta)})
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                    {hasVal ? (
                      <div
                        className="h-2 rounded-full"
                        style={{ width: `${Math.min(100, Math.max(0, sc.pred_abstention! * 100))}%`, backgroundColor: color }}
                      ></div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Historical Sparkline */}
      <div className="bg-slate-800/40 p-3.5 rounded-xl border border-slate-800">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
              Serie Histórica CCPC (DIP_FED 2009–2024)
            </h3>
            <InfoTip
              term={"detalle.serie" as any}
              title="Serie Histórica de Participación"
              text="Evolución de la participación electoral en elecciones de Diputaciones Federales (2009–2024), Presidenciales y Judicial 2025. Los huecos representan años con información no confiable (> 50 % de registros no especificados)."
              size="xs"
            />
          </div>
          <span className="text-[10px] text-slate-400">INE CCPC</span>
        </div>
        <Sparkline
          series={selectedDetail.series}
          predParticipation={selectedDetail.pred_participation}
          targetYear={2027}
        />
        {selectedDetail.series?.some((p) => p.participation === null || p.reliable === false) && (
          <div className="mt-2 text-[10px] text-slate-400 flex items-center justify-between bg-slate-900/60 px-2.5 py-1.5 rounded-lg border border-slate-800/80">
            <span className="flex items-center gap-1 text-amber-300">
              <span>⚠️</span>
              <span>Contiene años sin información confiable (&gt; 50 % no especificados)</span>
            </span>
            <InfoTip term="confiabilidad" size="xs" />
          </div>
        )}
      </div>

      {/* Risk Drivers (Divergent Bar Chart) */}
      <div className="bg-slate-800/40 p-3.5 rounded-xl border border-slate-800">
        <div className="flex items-center justify-between mb-2.5">
          <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
            Factores que Más Influyen en el Riesgo
          </h3>
          <InfoTip term="factores" size="xs" />
        </div>
        {!selectedDetail.drivers || selectedDetail.drivers.length === 0 ? (
          <div className="text-xs text-slate-400 py-3 text-center flex items-center justify-center gap-1.5">
            <span>Sin información suficiente</span>
            <InfoTip term="sin_dato" size="xs" />
          </div>
        ) : !hasProminentDrivers(selectedDetail.drivers) ? (
          <div className="text-xs text-slate-400 py-3 text-center">
            Sin factores sociodemográficos destacados
          </div>
        ) : (
          <div className="space-y-2">
            {selectedDetail.drivers.map((d) => {
              const isUp = d.direction === "sube_abstencion";
              const barColor = isUp ? "#ef4444" : "#10b981";

              return (
                <div key={d.key} className="text-xs">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-slate-300 text-[11px] truncate max-w-[200px]" title={d.label}>
                      {d.label}
                    </span>
                    <span
                      className="font-mono font-bold text-[11px]"
                      style={{ color: barColor }}
                    >
                      {isUp ? `+${d.contribution_pp.toFixed(1)} pp` : `-${Math.abs(d.contribution_pp).toFixed(1)} pp`}
                    </span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden flex">
                    <div
                      className="h-1.5 rounded-full"
                      style={{
                        width: `${Math.min(100, Math.abs(d.contribution_pp) * 20)}%`,
                        backgroundColor: barColor,
                      }}
                    ></div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Sociodemographic Features vs National Median */}
      {selectedDetail.features && selectedDetail.features.length > 0 && (
        <div className="bg-slate-800/40 p-3.5 rounded-xl border border-slate-800">
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-1.5">
              <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                Variables Sociodemográficas
              </h3>
              <InfoTip term="vulnerability_pp" size="xs" />
            </div>
            <span className="text-[10px] text-slate-400">INEGI / CONAPO</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-[10px] text-slate-400">
                  <th className="py-1 font-semibold">Indicador</th>
                  <th className="py-1 text-right font-semibold">Valor</th>
                  <th className="py-1 text-right font-semibold">Mediana Nal.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {selectedDetail.features.slice(0, 10).map((f) => (
                  <tr key={f.key} className="hover:bg-slate-800/30">
                    <td className="py-1.5 text-slate-300 text-[11px] pr-2">{f.label}</td>
                    <td className="py-1.5 text-right font-mono font-bold text-white">
                      {typeof f.value === "number"
                        ? f.unit === "proporción"
                          ? formatPct(f.value)
                          : f.unit === "personas" || f.unit === "votos" || f.unit === "hab."
                          ? formatInt(f.value)
                          : f.value.toFixed(1)
                        : f.value ?? "—"}
                    </td>
                    <td className="py-1.5 text-right font-mono text-slate-400 text-[10px]">
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
        </div>
      )}

      {/* Recommendations */}
      <div>
        <div className="flex items-center justify-between mb-2.5">
          <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
            Recomendaciones Preventivas
          </h3>
          <InfoTip term="recomendaciones" size="xs" />
        </div>
        {!selectedDetail.recommendations || selectedDetail.recommendations.length === 0 ? (
          <div className="p-3 bg-slate-800/40 rounded-xl border border-slate-800 text-xs text-slate-400 text-center flex items-center justify-center gap-1.5">
            <span>Sin información suficiente</span>
            <InfoTip term="sin_dato" size="xs" />
          </div>
        ) : (
          <div className="space-y-2.5">
            {selectedDetail.recommendations.map((rec) => {
              const badgeBg =
                rec.priority === "alta"
                  ? "bg-rose-950 text-rose-300 border-rose-800"
                  : rec.priority === "media"
                  ? "bg-amber-950 text-amber-300 border-amber-800"
                  : "bg-slate-800 text-slate-300 border-slate-700";

              return (
                <div
                  key={rec.id}
                  className="p-3 rounded-xl bg-slate-800/70 border border-slate-700/70 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${badgeBg}`}
                    >
                      Prioridad {rec.priority}
                    </span>
                    <span className="text-[9px] text-slate-400 uppercase">
                      Fuente: {rec.source === "rules" ? "Reglas" : "IA"}
                    </span>
                  </div>
                  <h4 className="text-xs font-bold text-white">{rec.title}</h4>
                  <p className="text-[11px] text-slate-300 leading-relaxed">{rec.rationale}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
