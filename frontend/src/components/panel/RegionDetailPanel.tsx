"use client";

import React from "react";
import { useAtalaya } from "@/lib/state";
import {
  formatPct,
  formatPp,
  formatInt,
  getCategoryColor,
  getCategoryLabel,
  CATEGORY_COLORS,
} from "@/lib/format";
import { Sparkline } from "@/components/viz/Sparkline";

export function RegionDetailPanel() {
  const {
    selectedDetail,
    loadingDetail,
    riskItems,
    selectRegion,
    meta,
    scenario,
    simulationResult,
  } = useAtalaya();

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
            <span className="text-[11px] text-slate-400">Total Zonas Evaluadas</span>
            <div className="text-xl font-bold text-white mt-0.5">{riskItems.length}</div>
          </div>
          <div className="bg-slate-800/80 p-3 rounded-xl border border-slate-700/60">
            <span className="text-[11px] text-slate-400">Escenario Activo</span>
            <div className="text-base font-bold text-emerald-400 capitalize mt-0.5">{scenario}</div>
          </div>
        </div>

        {/* Categories Distribution */}
        <div className="bg-slate-800/40 p-4 rounded-xl border border-slate-800">
          <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider mb-3">
            Distribución por Semáforo de Riesgo
          </h3>
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
          <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider mb-2.5">
            Zonas de Mayor Vulnerabilidad
          </h3>
          <div className="space-y-1.5">
            {top5Risk.map((item, idx) => (
              <button
                key={item.id}
                type="button"
                onClick={() => selectRegion(item.id)}
                className="w-full text-left p-2.5 rounded-lg bg-slate-800/60 hover:bg-slate-800 border border-slate-700/50 hover:border-slate-600 transition-colors flex items-center justify-between group"
              >
                <div className="flex items-center gap-2.5">
                  <span className="text-xs font-mono font-bold text-slate-400 group-hover:text-white">
                    #{idx + 1}
                  </span>
                  <div>
                    <div className="text-xs font-semibold text-white group-hover:text-emerald-400 transition-colors">
                      {item.name}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      Abstención pronosticada: {formatPct(item.pred_abstention)}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className="text-[11px] font-bold font-mono px-2 py-0.5 rounded text-white"
                    style={{ backgroundColor: getCategoryColor(item.category) }}
                  >
                    {item.risk_score} pts
                  </span>
                </div>
              </button>
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

  return (
    <div className="space-y-6">
      {/* Header & Badges */}
      <div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
            {selectedDetail.level === "state" ? "Entidad Federativa" : "Municipio"} · Clave {selectedDetail.id}
          </span>
          {selectedDetail.parent && (
            <span className="text-[10px] text-slate-400">
              Estado: <span className="text-slate-200">{selectedDetail.parent.name}</span>
            </span>
          )}
        </div>
        <h2 className="text-xl font-extrabold text-white mt-1.5">{selectedDetail.name}</h2>
        <div className="text-xs text-slate-400 mt-0.5">
          Lista nominal estimada: <span className="font-semibold text-white">{formatInt(selectedDetail.lista_nominal)}</span> electores
        </div>
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
            <span className="text-[10px] uppercase font-bold tracking-wider" style={{ color: catColor }}>
              Semáforo de Riesgo
            </span>
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: catColor }}></span>
          </div>
          <div className="mt-2">
            <div className="text-2xl font-black text-white">
              {selectedDetail.risk_score ?? "—"} <span className="text-xs font-normal text-slate-400">/ 100</span>
            </div>
            <div className="text-xs font-bold mt-0.5" style={{ color: catColor }}>
              {catLabel}
            </div>
          </div>
        </div>

        {/* Predicted Abstention 2027 */}
        <div className="bg-slate-800/80 p-3.5 rounded-xl border border-slate-700/80 flex flex-col justify-between">
          <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
            Abstención Estimada 2027
          </span>
          <div className="mt-2">
            <div className="text-2xl font-black text-white">
              {formatPct(selectedDetail.pred_abstention)}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              Intervalo: [{formatPct(selectedDetail.pred_low)} – {formatPct(selectedDetail.pred_high)}]
            </div>
          </div>
        </div>
      </div>

      {/* Secondary Metrics: Last Participation & Trend */}
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="bg-slate-800/40 p-2.5 rounded-lg border border-slate-800">
          <span className="text-slate-400 block text-[10px]">Última Participación (2024)</span>
          <span className="text-sm font-bold text-white mt-0.5 block">
            {formatPct(selectedDetail.last_participation)}
          </span>
        </div>
        <div className="bg-slate-800/40 p-2.5 rounded-lg border border-slate-800">
          <span className="text-slate-400 block text-[10px]">Tendencia por Elección</span>
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

      {/* Scenario Comparisons */}
      {selectedDetail.scenarios && selectedDetail.scenarios.length > 0 && (
        <div className="bg-slate-800/40 p-3.5 rounded-xl border border-slate-800">
          <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider mb-2.5">
            Comparación de Escenarios (Abstención 2027)
          </h3>
          <div className="space-y-2">
            {selectedDetail.scenarios.map((sc) => {
              const label =
                sc.scenario === "base"
                  ? "Base (Inercial)"
                  : sc.scenario === "intervencion"
                  ? "Con Intervención"
                  : "Pesimista";
              const val = sc.pred_abstention ?? 0.5;
              const color = CATEGORY_COLORS[sc.category];

              return (
                <div key={sc.scenario}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-300 font-medium">{label}</span>
                    <span className="font-mono font-bold text-white">
                      {formatPct(sc.pred_abstention)}
                    </span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                    <div
                      className="h-2 rounded-full"
                      style={{ width: `${val * 100}%`, backgroundColor: color }}
                    ></div>
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
          <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
            Serie Histórica (DIP_FED 2009–2024)
          </h3>
          <span className="text-[10px] text-slate-400">INE SICEE</span>
        </div>
        <Sparkline
          series={selectedDetail.series}
          predParticipation={selectedDetail.pred_participation}
          targetYear={2027}
        />
        <div className="flex items-center justify-between text-[10px] text-slate-400 mt-2 border-t border-slate-800 pt-1.5">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full border border-sky-400 bg-sky-600"></span>
            <span>Elección Presidencial</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-slate-300"></span>
            <span>Intermedia</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            <span>Pronóstico 2027</span>
          </div>
        </div>
      </div>

      {/* Risk Drivers (Divergent Bar Chart) */}
      {selectedDetail.drivers && selectedDetail.drivers.length > 0 && (
        <div className="bg-slate-800/40 p-3.5 rounded-xl border border-slate-800">
          <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider mb-2.5">
            Factores que Más Influyen en el Riesgo
          </h3>
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
        </div>
      )}

      {/* Sociodemographic Features vs National Median */}
      {selectedDetail.features && selectedDetail.features.length > 0 && (
        <div className="bg-slate-800/40 p-3.5 rounded-xl border border-slate-800">
          <div className="flex items-center justify-between mb-2.5">
            <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
              Variables Sociodemográficas
            </h3>
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
                {selectedDetail.features.slice(0, 7).map((f) => (
                  <tr key={f.key} className="hover:bg-slate-800/30">
                    <td className="py-1.5 text-slate-300 text-[11px] pr-2">{f.label}</td>
                    <td className="py-1.5 text-right font-mono font-bold text-white">
                      {typeof f.value === "number"
                        ? f.unit === "proporción"
                          ? formatPct(f.value)
                          : f.unit === "hab."
                          ? formatInt(f.value)
                          : f.value.toFixed(1)
                        : f.value ?? "—"}
                    </td>
                    <td className="py-1.5 text-right font-mono text-slate-400 text-[10px]">
                      {f.national_median !== null
                        ? f.unit === "proporción"
                          ? formatPct(f.national_median)
                          : f.unit === "hab."
                          ? formatInt(f.national_median)
                          : f.national_median.toFixed(1)
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
      {selectedDetail.recommendations && selectedDetail.recommendations.length > 0 && (
        <div>
          <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider mb-2.5">
            Recomendaciones Preventivas
          </h3>
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
        </div>
      )}
    </div>
  );
}
