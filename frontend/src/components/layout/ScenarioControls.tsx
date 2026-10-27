"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useAtalaya } from "@/lib/state";
import {
  formatSignedVotes,
  getVotesLabel,
  getVotesColorClass,
  formatDeltaPp,
  getDeltaAbstentionColorClass,
  CATEGORY_LABELS,
} from "@/lib/format";
import { ApiError } from "@/lib/api";
import { InfoTip } from "@/components/ui/InfoTip";
import { PARAM_TERM, optionTerm, glossaryFor } from "@/lib/glossary";
import { defaultsForScenario, isScenarioModified } from "@/lib/scenarioParams";
import { showToast } from "@/lib/toast";

export function ScenarioControls() {
  const {
    isScenarioModalOpen,
    setIsScenarioModalOpen,
    meta,
    paramsByScenario,
    applyScenarioParams,
    resetScenarioParams,
    simulationResult,
    scenario,
  } = useAtalaya();

  const activeParams = useMemo(() => {
    if (scenario === "base") return {};
    return paramsByScenario[scenario] ?? {};
  }, [scenario, paramsByScenario]);

  const [localParams, setLocalParams] = useState<Record<string, number | string>>(activeParams);
  const [isSimulating, setIsSimulating] = useState(false);
  const [paramErrors, setParamErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);

  // Sync localParams when scenario or state params change
  useEffect(() => {
    if (scenario !== "base") {
      setLocalParams(paramsByScenario[scenario] ?? {});
    }
  }, [scenario, paramsByScenario]);

  // Close sheet on Escape key
  useEffect(() => {
    if (!isScenarioModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsScenarioModalOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isScenarioModalOpen, setIsScenarioModalOpen]);

  // Find scenario definition dynamically from meta
  const scenarioDef =
    meta?.scenarios.find((s) => s.id === scenario && s.params && s.params.length > 0) ??
    meta?.scenarios.find((s) => s.id === scenario) ??
    meta?.scenarios.find((s) => s.id === "intervencion") ??
    meta?.scenarios[0];

  const paramsList = scenarioDef?.params ?? [];

  const defaults = useMemo(() => defaultsForScenario(scenario, meta), [scenario, meta]);
  const isModified = useMemo(() => {
    if (scenario === "base") return false;
    return (
      isScenarioModified(scenario, localParams, meta) ||
      isScenarioModified(scenario, paramsByScenario[scenario], meta)
    );
  }, [scenario, localParams, paramsByScenario, meta]);

  if (!isScenarioModalOpen) return null;

  const handleSimulate = async () => {
    if (scenario === "base") return;
    setIsSimulating(true);
    setParamErrors({});
    setGeneralError(null);
    try {
      await applyScenarioParams(scenario, localParams);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 422) {
        const errors: Record<string, string> = {};
        const data = err.data as Record<string, unknown>;
        let errorMsg = "Error de validación (422) en los parámetros enviados.";
        if (Array.isArray(data?.detail)) {
          for (const item of data.detail as Array<{ loc?: string[]; msg?: string }>) {
            const key = Array.isArray(item.loc) ? item.loc[item.loc.length - 1] : "general";
            errors[key] = item.msg || "Parámetro inválido";
          }
          errorMsg = data.detail.map((d) => d.msg).filter(Boolean).join(". ") || errorMsg;
        } else if (typeof data?.detail === "string") {
          errorMsg = data.detail;
          setGeneralError(data.detail);
        } else {
          setGeneralError(errorMsg);
        }
        setParamErrors(errors);
        showToast({
          kind: "error",
          title: "Error de simulación",
          detail: errorMsg,
        });
      } else {
        const msg = (err as Error)?.message || "Error al simular escenario";
        setGeneralError(msg);
        showToast({
          kind: "error",
          title: "Error de simulación",
          detail: msg,
        });
      }
    } finally {
      setIsSimulating(false);
    }
  };

  const handleReset = async () => {
    if (scenario === "base" || !isModified || isSimulating) return;
    setIsSimulating(true);
    setParamErrors({});
    setGeneralError(null);
    try {
      setLocalParams(defaults);
      await resetScenarioParams(scenario);
    } catch (err: unknown) {
      const msg = (err as Error)?.message || "Error al restablecer valores";
      setGeneralError(msg);
      showToast({
        kind: "error",
        title: "Error de simulación",
        detail: msg,
      });
    } finally {
      setIsSimulating(false);
    }
  };

  const title =
    scenarioDef?.id === "pesimista"
      ? "Ajustar escenario pesimista"
      : scenarioDef?.label
      ? `Ajustar: ${scenarioDef.label}`
      : "Ajustar intervención";

  return (
    <div className="absolute inset-x-2 bottom-2 z-30 flex max-h-[78%] flex-col overflow-hidden float-panel animate-in fade-in duration-200 lg:inset-x-auto lg:inset-y-3 lg:left-3 lg:max-h-none lg:w-[360px] select-none">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-border px-4 py-3 shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-display text-sm font-bold text-foreground">
              {title}
            </h3>
            <InfoTip
              term={scenarioDef?.id === "pesimista" ? "escenario.pesimista" : "escenario.intervencion"}
              size="xs"
            />
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {scenarioDef?.description ??
              "Parametriza palancas operativas y simula el impacto en el riesgo electoral 2027."}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsScenarioModalOpen(false)}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
          aria-label="Cerrar hoja de parámetros"
        >
          <svg className="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {generalError && (
        <div className="m-3 p-2.5 bg-destructive/10 border border-destructive/20 text-destructive text-xs rounded-md">
          {generalError}
        </div>
      )}

      {/* Dynamic Controls generated from meta */}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {paramsList.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">
            No se encontraron parámetros configurables para este escenario.
          </p>
        ) : (
          paramsList.map((p) => {
            const currentVal = localParams[p.key] ?? p.default;
            const hasError = !!paramErrors[p.key];

            if (p.type === "select") {
              const isSegmented = p.options && p.options.length <= 3;

              return (
                <div key={p.key} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-semibold text-foreground">
                    <span className="flex items-center gap-1">
                      {p.label}
                      {PARAM_TERM[p.key] && <InfoTip term={PARAM_TERM[p.key]} size="xs" />}
                    </span>
                  </div>

                  {isSegmented ? (
                    <div className="grid grid-cols-3 gap-1 rounded-md bg-muted p-0.5 text-xs">
                      {p.options?.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => {
                            setLocalParams((prev) => ({ ...prev, [p.key]: opt.value }));
                            setParamErrors((prev) => ({ ...prev, [p.key]: "" }));
                          }}
                          className={`rounded px-1.5 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                            String(currentVal) === String(opt.value)
                              ? "bg-card text-primary shadow-xs"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <select
                      value={String(currentVal)}
                      onChange={(e) => {
                        const val = e.target.value;
                        setLocalParams((prev) => ({ ...prev, [p.key]: val }));
                        setParamErrors((prev) => ({ ...prev, [p.key]: "" }));
                      }}
                      className={`h-9 w-full rounded-md border ${
                        hasError ? "border-destructive" : "border-border"
                      } bg-background px-3 text-xs text-foreground outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/20 cursor-pointer`}
                    >
                      {p.options?.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  )}

                  {(() => {
                    const optKey = optionTerm(p.key, String(currentVal));
                    const optEntry = optKey ? glossaryFor(optKey) : undefined;
                    if (!optEntry) return null;
                    return (
                      <p className="text-[11px] text-muted-foreground line-clamp-2" title={optEntry.body}>
                        {optEntry.body}
                      </p>
                    );
                  })()}
                  {hasError && (
                    <p className="text-xs text-destructive font-medium">{paramErrors[p.key]}</p>
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
                <div key={p.key} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-semibold text-foreground">
                    <span className="flex items-center gap-1">
                      {p.label}
                      {PARAM_TERM[p.key] && <InfoTip term={PARAM_TERM[p.key]} size="xs" />}
                    </span>
                    <span className="tnum rounded bg-primary-soft px-1.5 py-0.5 text-xs font-semibold text-accent-foreground">
                      {p.unit === "%"
                        ? `${Math.round(numVal)}%`
                        : p.unit === "pp"
                        ? `${numVal >= 0 ? "+" : ""}${numVal.toFixed(1)} pp`
                        : `${numVal} ${p.unit ?? ""}`}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
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
                      className="flex-1 cursor-pointer"
                      style={{ accentColor: "var(--primary)" }}
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
                      className={`h-8 w-16 rounded-md border ${
                        hasError ? "border-destructive" : "border-border"
                      } bg-background px-2 text-xs text-foreground text-right tnum font-mono outline-none focus:border-primary`}
                    />
                  </div>
                  {hasError && (
                    <p className="text-xs text-destructive font-medium">{paramErrors[p.key]}</p>
                  )}
                </div>
              );
            }

            return null;
          })
        )}

        {/* Live Formula Box */}
        {scenarioDef?.id === "intervencion" && (() => {
          const effect = Number(localParams.effect_pp ?? 3.0);
          const rawCoverage = Number(localParams.coverage ?? 100);
          const covPct = rawCoverage;
          const resultado = effect * (covPct / 100);
          const maxResultado = 1.5 * resultado;

          const lever = String(localParams.lever ?? "promocion_jovenes");
          let variableLabel = "";
          if (lever === "promocion_jovenes") {
            variableLabel = "población de 18 a 24 años";
          } else if (lever === "casillas_rurales") {
            variableLabel = "población rural";
          } else if (lever === "materiales_lengua_indigena") {
            variableLabel = "población hablante de lengua indígena";
          }

          return (
            <div className="p-2.5 rounded-md bg-muted text-[11px] text-muted-foreground leading-relaxed">
              <p>
                Efecto real: {effect.toFixed(1)} pp × {Math.round(covPct)}% ={" "}
                <strong className="text-foreground tnum">{resultado.toFixed(2)} pp</strong>
                {variableLabel && lever !== "campana_general" ? (
                  <span>
                    , hasta 1.5× ({maxResultado.toFixed(2)} pp) donde {variableLabel} es mayor.
                  </span>
                ) : (
                  "."
                )}
              </p>
            </div>
          );
        })()}

        {scenarioDef?.id === "pesimista" && (() => {
          const shock = Number(localParams.shock_pp ?? 2.0);
          const rawTrend = Number(localParams.trend_amplifier ?? 50);
          const trendPct = rawTrend;

          return (
            <div className="p-2.5 rounded-md bg-muted text-[11px] text-muted-foreground leading-relaxed">
              <p>
                Todos los municipios caen{" "}
                <strong className="text-foreground tnum">{shock.toFixed(2)} pp</strong>; los que
                vienen cayendo, además,{" "}
                <strong className="text-foreground tnum">{Math.round(trendPct)}%</strong> de su caída
                histórica.
              </p>
            </div>
          );
        })()}

        {/* Simulation Summary Result */}
        {simulationResult ? (
          <div className="rounded-lg border border-border bg-card p-3 space-y-3">
            <div className="flex items-center justify-between text-xs font-bold text-foreground">
              <span>Resultado simulado</span>
              <span className="text-[10px] text-muted-foreground tnum font-mono">
                {simulationResult.summary.n_units} zonas evaluadas
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md bg-muted/60 p-2 border border-border/50">
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground uppercase tracking-wider">
                  <span>{getVotesLabel(simulationResult.summary.votos_adicionales)}</span>
                  <InfoTip term="simulacion.votos" size="xs" />
                </div>
                <span
                  className={`text-sm sm:text-base font-bold tnum font-mono ${getVotesColorClass(
                    simulationResult.summary.votos_adicionales
                  )} block mt-0.5`}
                >
                  {formatSignedVotes(simulationResult.summary.votos_adicionales)}
                </span>
              </div>
              <div className="rounded-md bg-muted/60 p-2 border border-border/50">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider block">
                  Cambio en abstención
                </span>
                <span
                  className={`text-sm sm:text-base font-bold tnum font-mono ${getDeltaAbstentionColorClass(
                    simulationResult.summary.mean_delta_pp
                  )} block mt-0.5`}
                >
                  {formatDeltaPp(simulationResult.summary.mean_delta_pp)}
                </span>
              </div>
            </div>

            {/* Stacked bar of risk distribution */}
            {(() => {
              const total = (["verde", "amarillo", "naranja", "rojo"] as const).reduce(
                (sum, c) => sum + (simulationResult.summary.by_category?.[c] ?? 0),
                0
              );
              if (total === 0) return null;
              return (
                <div className="space-y-1.5">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider block">
                    Distribución por semáforo
                  </span>
                  <div className="h-2 rounded-full overflow-hidden flex bg-muted w-full">
                    <div
                      style={{
                        width: `${((simulationResult.summary.by_category?.verde ?? 0) / total) * 100}%`,
                      }}
                      className="bg-risk-low h-full"
                      title={CATEGORY_LABELS.verde}
                    />
                    <div
                      style={{
                        width: `${((simulationResult.summary.by_category?.amarillo ?? 0) / total) * 100}%`,
                      }}
                      className="bg-risk-mid h-full"
                      title={CATEGORY_LABELS.amarillo}
                    />
                    <div
                      style={{
                        width: `${((simulationResult.summary.by_category?.naranja ?? 0) / total) * 100}%`,
                      }}
                      className="bg-risk-high h-full"
                      title={CATEGORY_LABELS.naranja}
                    />
                    <div
                      style={{
                        width: `${((simulationResult.summary.by_category?.rojo ?? 0) / total) * 100}%`,
                      }}
                      className="bg-risk-crit h-full"
                      title={CATEGORY_LABELS.rojo}
                    />
                  </div>
                  <div className="grid grid-cols-4 gap-1 text-center font-mono text-[11px]">
                    {(["verde", "amarillo", "naranja", "rojo"] as const).map((cat) => {
                      const simCount = simulationResult.summary.by_category?.[cat] ?? 0;
                      const baseCount = simulationResult.summary.by_category_base?.[cat] ?? 0;
                      const diff = simCount - baseCount;
                      return (
                        <div key={cat} className="p-1 rounded bg-muted/40 border border-border/40">
                          <span className="text-foreground font-bold">{simCount}</span>
                          {diff !== 0 && (
                            <span
                              className={`block text-[10px] ${
                                diff > 0
                                  ? cat === "verde"
                                    ? "text-good"
                                    : "text-bad"
                                  : cat === "verde"
                                  ? "text-bad"
                                  : "text-good"
                              }`}
                            >
                              {diff > 0 ? `+${diff}` : diff}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-center">
            <p className="text-xs text-muted-foreground">
              Aplica para ver el resultado
            </p>
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="flex items-center justify-between gap-2 border-t border-border p-3 shrink-0">
        <button
          type="button"
          onClick={handleReset}
          disabled={!isModified || isSimulating}
          className="px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:bg-muted rounded-md transition-colors flex items-center gap-1.5 cursor-pointer"
          title="Restablecer valores originales"
          aria-label="Restablecer valores originales"
        >
          <svg className="size-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          <span>Restablecer</span>
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsScenarioModalOpen(false)}
            className="px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            Cerrar
          </button>
          <button
            type="button"
            onClick={handleSimulate}
            disabled={isSimulating}
            className="px-4 py-1.5 text-xs font-semibold text-primary-foreground bg-primary hover:opacity-90 disabled:opacity-50 rounded-md transition-all flex items-center gap-1.5 shadow-xs cursor-pointer"
          >
            {isSimulating ? (
              <>
                <svg className="animate-spin size-3.5" viewBox="0 0 24 24" fill="none">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                  />
                </svg>
                <span>Simulando...</span>
              </>
            ) : (
              <span>Aplicar</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
