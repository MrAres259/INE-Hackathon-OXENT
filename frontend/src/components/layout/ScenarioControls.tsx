"use client";

import React, { useState, useEffect } from "react";
import { useAtalaya } from "@/lib/state";
import {
  formatInt,
  formatPp,
  formatSignedVotes,
  getVotesLabel,
  getVotesColorClass,
  formatDeltaPp,
  getDeltaAbstentionColorClass,
  CATEGORY_COLORS,
  CATEGORY_LABELS,
} from "@/lib/format";
import { ApiError } from "@/lib/api";

export function ScenarioControls() {
  const {
    isScenarioModalOpen,
    setIsScenarioModalOpen,
    meta,
    scenarioParams,
    setScenarioParams,
    runSimulation,
    simulationResult,
    scenario,
  } = useAtalaya();

  const [localParams, setLocalParams] = useState<Record<string, number | string>>(scenarioParams);
  const [isSimulating, setIsSimulating] = useState(false);
  const [paramErrors, setParamErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);

  useEffect(() => {
    setLocalParams(scenarioParams);
  }, [scenarioParams]);

  if (!isScenarioModalOpen) return null;

  // Find scenario definition dynamically from meta
  const scenarioDef =
    meta?.scenarios.find((s) => s.id === scenario && s.params && s.params.length > 0) ??
    meta?.scenarios.find((s) => s.id === "intervencion") ??
    meta?.scenarios[0];

  const paramsList = scenarioDef?.params ?? [];

  const handleSimulate = async () => {
    setIsSimulating(true);
    setParamErrors({});
    setGeneralError(null);
    try {
      await runSimulation(localParams);
      setScenarioParams(localParams);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 422) {
        const errors: Record<string, string> = {};
        const data = err.data as any;
        if (Array.isArray(data?.detail)) {
          for (const item of data.detail) {
            const key = Array.isArray(item.loc) ? item.loc[item.loc.length - 1] : "general";
            errors[key] = item.msg || "Parámetro inválido";
          }
        } else if (typeof data?.detail === "string") {
          setGeneralError(data.detail);
        } else {
          setGeneralError("Error de validación (422) en los parámetros enviados.");
        }
        setParamErrors(errors);
      } else {
        setGeneralError((err as Error)?.message || "Error al simular escenario");
      }
    } finally {
      setIsSimulating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full p-6 text-white shadow-2xl animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-4">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
              {scenarioDef?.label ? `Ajustar: ${scenarioDef.label}` : "Ajustar Escenario de Intervención"}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {scenarioDef?.description ??
                "Parametriza palancas operativas y simula el impacto en el riesgo electoral 2027."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsScenarioModalOpen(false)}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {generalError && (
          <div className="mb-4 p-3 bg-rose-950/80 border border-rose-800 rounded-xl text-xs text-rose-300">
            {generalError}
          </div>
        )}

        {/* Dynamic Controls generated from Meta.scenarios[].params */}
        <div className="space-y-4">
          {paramsList.length === 0 ? (
            <p className="text-xs text-slate-400 py-4 text-center">
              No se encontraron parámetros configurables para este escenario.
            </p>
          ) : (
            paramsList.map((p) => {
              const currentVal = localParams[p.key] ?? p.default;
              const hasError = !!paramErrors[p.key];

              if (p.type === "select") {
                return (
                  <div key={p.key}>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      {p.label}
                    </label>
                    <select
                      value={String(currentVal)}
                      onChange={(e) => {
                        const val = e.target.value;
                        setLocalParams((prev) => ({ ...prev, [p.key]: val }));
                        setParamErrors((prev) => ({ ...prev, [p.key]: "" }));
                      }}
                      className={`w-full bg-slate-800 border ${
                        hasError ? "border-rose-500" : "border-slate-700"
                      } rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500`}
                    >
                      {p.options?.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    {hasError && (
                      <p className="text-xs text-rose-400 mt-1 font-medium">{paramErrors[p.key]}</p>
                    )}
                  </div>
                );
              }

              if (p.type === "number") {
                const numVal = Number(currentVal);
                const min = p.min ?? 0;
                const max = p.max ?? 10;
                const step = p.step ?? 0.1;

                return (
                  <div key={p.key}>
                    <div className="flex justify-between items-center mb-1.5">
                      <label className="text-xs font-semibold text-slate-300">
                        {p.label}
                      </label>
                      <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800">
                        {p.unit === "%"
                          ? `${Math.round(numVal <= 1.0 ? numVal * 100 : numVal)}%`
                          : p.unit === "pp"
                          ? `+${numVal.toFixed(1)} pp`
                          : `${numVal} ${p.unit ?? ""}`}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={min}
                        max={max}
                        step={step}
                        value={isNaN(numVal) ? min : numVal}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          setLocalParams((prev) => ({ ...prev, [p.key]: val }));
                          setParamErrors((prev) => ({ ...prev, [p.key]: "" }));
                        }}
                        className="flex-1 accent-emerald-500 cursor-pointer"
                      />
                      <input
                        type="number"
                        min={min}
                        max={max}
                        step={step}
                        value={isNaN(numVal) ? "" : numVal}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          setLocalParams((prev) => ({
                            ...prev,
                            [p.key]: isNaN(val) ? 0 : val,
                          }));
                          setParamErrors((prev) => ({ ...prev, [p.key]: "" }));
                        }}
                        className={`w-20 bg-slate-800 border ${
                          hasError ? "border-rose-500" : "border-slate-700"
                        } rounded-lg px-2 py-1 text-xs text-white text-right font-mono focus:outline-none focus:ring-1 focus:ring-emerald-500`}
                      />
                    </div>
                    {hasError && (
                      <p className="text-xs text-rose-400 mt-1 font-medium">{paramErrors[p.key]}</p>
                    )}
                  </div>
                );
              }

              return null;
            })
          )}
        </div>

        {/* Simulation Summary: counts by category vs base, additional votes, mean delta pp */}
        {simulationResult && (
          <div className="mt-5 p-4 bg-slate-800/90 rounded-xl border border-slate-700/80 space-y-3 text-xs">
            <div className="font-semibold text-slate-200 flex items-center justify-between">
              <span>Resumen del Escenario Simulado</span>
              <span className="text-[10px] text-slate-400 font-mono">
                {simulationResult.summary.n_units} zonas evaluadas
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block">
                  {getVotesLabel(simulationResult.summary.votos_adicionales)}
                </span>
                <span
                  className={`text-base font-bold font-mono ${getVotesColorClass(
                    simulationResult.summary.votos_adicionales
                  )} mt-0.5 block`}
                >
                  {formatSignedVotes(simulationResult.summary.votos_adicionales)}
                </span>
              </div>
              <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block">
                  Cambio promedio en abstención
                </span>
                <span
                  className={`text-base font-bold font-mono ${getDeltaAbstentionColorClass(
                    simulationResult.summary.mean_delta_pp
                  )} mt-0.5 block`}
                >
                  {formatDeltaPp(simulationResult.summary.mean_delta_pp)}
                </span>
                <span className="text-[10px] text-slate-400 block mt-0.5">
                  (negativo = menos abstención)
                </span>
              </div>
            </div>

            {/* Counts by category vs base */}
            <div>
              <span className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1.5">
                Distribución por Semáforo: Simulado vs Base
              </span>
              <div className="grid grid-cols-4 gap-1.5 text-center font-mono">
                {(["verde", "amarillo", "naranja", "rojo"] as const).map((cat) => {
                  const simCount = simulationResult.summary.by_category?.[cat] ?? 0;
                  const baseCount = simulationResult.summary.by_category_base?.[cat] ?? 0;
                  const diff = simCount - baseCount;

                  return (
                    <div
                      key={cat}
                      className="p-2 rounded-lg bg-slate-900/80 border border-slate-800 flex flex-col items-center"
                    >
                      <div className="flex items-center gap-1 text-[10px] text-slate-300 capitalize mb-0.5">
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: CATEGORY_COLORS[cat] }}
                        />
                        <span>{CATEGORY_LABELS[cat]}</span>
                      </div>
                      <div className="text-sm font-bold text-white">
                        {simCount}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        base: {baseCount}{" "}
                        {diff !== 0 && (
                          <span className={diff > 0 ? "text-emerald-400" : "text-amber-400"}>
                            ({diff > 0 ? `+${diff}` : diff})
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="mt-6 flex items-center justify-end gap-3 border-t border-slate-800 pt-4">
          <button
            type="button"
            onClick={() => setIsScenarioModalOpen(false)}
            className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
          >
            Cerrar
          </button>
          <button
            type="button"
            onClick={handleSimulate}
            disabled={isSimulating}
            className="px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 rounded-lg transition-colors flex items-center gap-2 shadow-sm"
          >
            {isSimulating ? (
              <>
                <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                </svg>
                <span>Simulando...</span>
              </>
            ) : (
              <span>Simular</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
