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
import {
  defaultsForScenario,
  isScenarioModified,
  leverDefaults,
  LEVER_DEFAULT_LABELS,
  LEVER_SHORT_LABELS,
} from "@/lib/scenarioParams";
import type { Campaign } from "@/lib/types";
import { MOCK_STATES } from "@/lib/mocks/meta";
import { showToast } from "@/lib/toast";

const ALL_LEVERS = [
  "promocion_jovenes",
  "casillas_rurales",
  "materiales_lengua_indigena",
  "campana_general",
] as const;

const LEVER_WEIGHT_VARIABLE: Record<string, string> = {
  promocion_jovenes: "población de 18 a 24 años",
  casillas_rurales: "población rural",
  materiales_lengua_indigena: "población hablante de lengua indígena",
};

export function ScenarioControls() {
  const {
    isScenarioModalOpen,
    setIsScenarioModalOpen,
    meta,
    paramsByScenario,
    leverParams,
    applyScenarioParams,
    resetScenarioParams,
    setScenarioParams,
    simulationResult,
    scenario,
  } = useAtalaya();

  const allStates = meta?.states ?? MOCK_STATES;

  // Initialize draft campaigns from paramsByScenario
  const initialCampaigns: Campaign[] = useMemo(() => {
    if (
      Array.isArray(paramsByScenario.intervencion?.campaigns) &&
      paramsByScenario.intervencion.campaigns.length > 0
    ) {
      return paramsByScenario.intervencion.campaigns.map((c: any) => ({
        lever: String(c.lever || "promocion_jovenes"),
        targeting: String(c.targeting || "rojo_naranja"),
        effect_pp: Number(c.effect_pp ?? 3.0),
        coverage: Number(c.coverage ?? 100),
        ents: Array.isArray(c.ents) ? [...c.ents] : [],
      }));
    }

    const p = paramsByScenario.intervencion;
    const activeLever = String(p?.lever ?? "promocion_jovenes");
    const saved = leverParams?.[activeLever];
    const defs = leverDefaults(meta);

    const effect_pp = Number(
      p?.effect_pp ?? saved?.effect_pp ?? defs.effect_pp ?? 3.0
    );
    const coverage = Number(
      p?.coverage ?? saved?.coverage ?? defs.coverage ?? 100
    );
    const targeting = String(
      p?.targeting ?? saved?.targeting ?? defs.targeting ?? "rojo_naranja"
    );
    const ents = Array.isArray(p?.ents)
      ? p.ents
      : Array.isArray(saved?.ents)
      ? saved.ents
      : [];

    return [
      {
        lever: activeLever,
        targeting,
        effect_pp,
        coverage,
        ents,
      },
    ];
  }, [paramsByScenario.intervencion, leverParams, meta]);

  const [campaigns, setCampaigns] = useState<Campaign[]>(initialCampaigns);
  const [pesimistaDraft, setPesimistaDraft] = useState<Record<string, number | string>>(
    paramsByScenario.pesimista ?? {}
  );
  const [isSimulating, setIsSimulating] = useState(false);
  const [cardErrors, setCardErrors] = useState<Record<number, string>>({});
  const [pesimistaErrors, setPesimistaErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [stateSearch, setStateSearch] = useState<Record<number, string>>({});
  const [scopeMode, setScopeMode] = useState<Record<number, "pais" | "estados">>({});

  // Sync state when scenario or paramsByScenario changes
  useEffect(() => {
    if (scenario === "intervencion") {
      setCampaigns(initialCampaigns);
    } else if (scenario === "pesimista") {
      setPesimistaDraft(paramsByScenario.pesimista ?? {});
    }
  }, [scenario, initialCampaigns, paramsByScenario.pesimista]);

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

  // Track modification status
  const isModified = useMemo(() => {
    if (scenario === "base") return false;
    if (scenario === "intervencion") {
      return (
        isScenarioModified("intervencion", { campaigns }, meta) ||
        isScenarioModified("intervencion", paramsByScenario.intervencion, meta)
      );
    }
    return (
      isScenarioModified("pesimista", pesimistaDraft, meta) ||
      isScenarioModified("pesimista", paramsByScenario.pesimista, meta)
    );
  }, [scenario, campaigns, pesimistaDraft, paramsByScenario, meta]);

  if (!isScenarioModalOpen) return null;

  const updateCampaign = (idx: number, patch: Partial<Campaign>) => {
    setCardErrors((prev) => ({ ...prev, [idx]: "" }));
    setCampaigns((prev) => {
      const next = [...prev];
      const current = next[idx];
      const updated = { ...current, ...patch };
      next[idx] = updated;
      setScenarioParams((sp) => ({
        ...sp,
        campaigns: next,
      }));
      return next;
    });
  };

  const handleLeverChange = (idx: number, newLever: string) => {
    const saved = leverParams[newLever];
    const defs = leverDefaults(meta);

    const nextCampaign: Campaign = {
      lever: newLever,
      targeting: String(saved?.targeting ?? defs.targeting ?? "rojo_naranja"),
      effect_pp: Number(saved?.effect_pp ?? defs.effect_pp ?? 3.0),
      coverage: Number(saved?.coverage ?? defs.coverage ?? 100),
      ents: Array.isArray(saved?.ents) ? [...saved.ents] : [],
    };

    updateCampaign(idx, nextCampaign);
  };

  const handleRemoveCampaign = (idx: number) => {
    if (campaigns.length <= 1) return;
    const nextCampaigns = campaigns.filter((_, i) => i !== idx);
    setCampaigns(nextCampaigns);
    setScenarioParams((sp) => ({
      ...sp,
      campaigns: nextCampaigns,
    }));
  };

  const handleAddCampaign = () => {
    if (campaigns.length >= 4) return;
    const used = campaigns.map((c) => c.lever);
    const free = ALL_LEVERS.filter((l) => !used.includes(l));
    if (free.length === 0) return;
    const nextLever = free[0];
    const saved = leverParams[nextLever];
    const defs = leverDefaults(meta);
    const newCamp: Campaign = {
      lever: nextLever,
      targeting: String(saved?.targeting ?? defs.targeting ?? "rojo_naranja"),
      effect_pp: Number(saved?.effect_pp ?? defs.effect_pp ?? 3.0),
      coverage: Number(saved?.coverage ?? defs.coverage ?? 100),
      ents: Array.isArray(saved?.ents) ? [...saved.ents] : [],
    };
    const nextCampaigns = [...campaigns, newCamp];
    setCampaigns(nextCampaigns);
    setScenarioParams((sp) => ({
      ...sp,
      campaigns: nextCampaigns,
    }));
  };

  const handleSimulate = async () => {
    if (scenario === "base") return;
    setIsSimulating(true);
    setCardErrors({});
    setPesimistaErrors({});
    setGeneralError(null);
    try {
      if (scenario === "intervencion") {
        await applyScenarioParams("intervencion", { campaigns });
      } else {
        await applyScenarioParams("pesimista", pesimistaDraft);
      }
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 422) {
        const cErrors: Record<number, string> = {};
        const pErrors: Record<string, string> = {};
        const data = err.data as Record<string, unknown>;
        let errorMsg = "Error de validación (422) en los parámetros enviados.";

        if (Array.isArray(data?.detail)) {
          for (const item of data.detail as Array<{ loc?: string[]; msg?: string }>) {
            const msg = item.msg || "Parámetro inválido";
            const match = msg.match(/(?:Campaña|campaña)\s*(\d+)/i);
            if (match) {
              const cIdx = parseInt(match[1], 10) - 1;
              cErrors[cIdx] = msg;
            } else if (Array.isArray(item.loc) && item.loc.includes("campaigns")) {
              const cIdx = Number(item.loc[item.loc.indexOf("campaigns") + 1]);
              if (!isNaN(cIdx)) {
                cErrors[cIdx] = msg;
              }
            } else if (Array.isArray(item.loc)) {
              const key = item.loc[item.loc.length - 1];
              pErrors[key] = msg;
            }
          }
          errorMsg = data.detail.map((d) => d.msg).filter(Boolean).join(". ") || errorMsg;
        } else if (typeof data?.detail === "string") {
          errorMsg = data.detail;
          const match = data.detail.match(/(?:Campaña|campaña)\s*(\d+)/i);
          if (match) {
            const cIdx = parseInt(match[1], 10) - 1;
            cErrors[cIdx] = data.detail;
          } else {
            setGeneralError(data.detail);
          }
        } else {
          setGeneralError(errorMsg);
        }

        setCardErrors(cErrors);
        setPesimistaErrors(pErrors);
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
    setCardErrors({});
    setPesimistaErrors({});
    setGeneralError(null);
    try {
      if (scenario === "intervencion") {
        const defs = defaultsForScenario("intervencion", meta);
        setCampaigns(defs.campaigns ?? []);
        await resetScenarioParams("intervencion");
      } else {
        setPesimistaDraft(defaultsForScenario("pesimista", meta));
        await resetScenarioParams("pesimista");
      }
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

  const scenarioDef = meta?.scenarios?.find((s) => s.id === scenario);
  const title =
    scenarioDef?.id === "pesimista"
      ? "Ajustar escenario pesimista"
      : scenarioDef?.label
      ? `Ajustar: ${scenarioDef.label}`
      : "Ajustar: Intervención hipotética";

  const freeLevers = ALL_LEVERS.filter(
    (l) => !campaigns.map((c) => c.lever).includes(l)
  );

  return (
    <div className="absolute inset-x-2 bottom-2 z-30 flex max-h-[85%] flex-col overflow-hidden float-panel animate-in fade-in duration-200 lg:inset-x-auto lg:inset-y-3 lg:left-3 lg:max-h-none lg:w-[420px] select-none">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-border px-4 py-3 shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-display text-sm font-bold text-foreground">
              {title}
            </h3>
            <InfoTip
              term={scenario === "pesimista" ? "escenario.pesimista" : "escenario.intervencion"}
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

      {/* Main Body */}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {/* ===================== INTERVENCIÓN: CAMPAÑAS ===================== */}
        {scenario === "intervencion" && (
          <div className="space-y-4">
            {/* Section Header */}
            <div className="flex items-center justify-between pb-1 border-b border-border/50">
              <div className="flex items-center gap-1.5">
                <span className="font-display text-xs font-bold text-foreground uppercase tracking-wider">
                  Campañas de intervención
                </span>
                <InfoTip term={"campanas" as any} size="xs" />
              </div>
              <span className="text-[11px] font-mono text-muted-foreground font-medium">
                {campaigns.length} {campaigns.length === 1 ? "campaña" : "campañas"} (máx. 4)
              </span>
            </div>

            {/* Campaign Cards */}
            <div className="space-y-3">
              {campaigns.map((c, idx) => {
                const usedByOthers = campaigns
                  .filter((_, i) => i !== idx)
                  .map((camp) => camp.lever);
                const availableLevers = ALL_LEVERS.filter(
                  (l) => !usedByOthers.includes(l)
                );

                const hasCardError = !!cardErrors[idx];
                const activeScope =
                  scopeMode[idx] ?? (c.ents.length === 0 ? "pais" : "estados");

                return (
                  <div
                    key={`${idx}-${c.lever}`}
                    className={`rounded-lg border ${
                      hasCardError ? "border-destructive bg-destructive/5" : "border-border bg-card/60"
                    } p-3 space-y-3 shadow-xs`}
                  >
                    {/* Card Header */}
                    <div className="flex items-center justify-between border-b border-border/40 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-xs text-foreground">
                          Campaña {idx + 1}
                        </span>
                        <span className="text-[11px] text-muted-foreground font-medium">
                          ({LEVER_SHORT_LABELS[c.lever] ?? c.lever})
                        </span>
                      </div>
                      {campaigns.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveCampaign(idx)}
                          className="text-xs text-destructive hover:text-destructive/80 font-medium px-2 py-0.5 rounded hover:bg-destructive/10 transition-colors cursor-pointer"
                          aria-label={`Quitar campaña ${idx + 1}`}
                        >
                          Quitar
                        </button>
                      )}
                    </div>

                    {cardErrors[idx] && (
                      <p className="text-xs text-destructive font-medium bg-destructive/10 p-2 rounded border border-destructive/20">
                        {cardErrors[idx]}
                      </p>
                    )}

                    {/* Palanca select */}
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-foreground flex items-center gap-1">
                        <span>Palanca</span>
                        <InfoTip term="param.lever" size="xs" />
                      </label>
                      <select
                        value={c.lever}
                        onChange={(e) => handleLeverChange(idx, e.target.value)}
                        className="h-9 w-full rounded-md border border-border bg-background px-3 text-xs text-foreground outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/20 cursor-pointer"
                      >
                        {availableLevers.map((l) => (
                          <option key={l} value={l}>
                            {LEVER_DEFAULT_LABELS[l] ?? l}
                          </option>
                        ))}
                      </select>
                      {(() => {
                        const optKey = optionTerm("lever", c.lever);
                        const optEntry = optKey ? glossaryFor(optKey) : undefined;
                        const weightVar = LEVER_WEIGHT_VARIABLE[c.lever];
                        return (
                          <div className="space-y-0.5 pt-0.5">
                            {optEntry && (
                              <p
                                className="text-[11px] text-muted-foreground line-clamp-2"
                                title={optEntry.body}
                              >
                                {optEntry.body}
                              </p>
                            )}
                            {weightVar ? (
                              <p className="text-[11px] text-muted-foreground leading-snug">
                                Su efecto se pondera por {weightVar}: rinde más donde {weightVar} es mayor y poco en zonas donde es baja.
                              </p>
                            ) : (
                              <p className="text-[11px] text-muted-foreground leading-snug">
                                Campaña general sin ponderación sociodemográfica diferencial (peso 1× uniforme).
                              </p>
                            )}
                          </div>
                        );
                      })()}
                    </div>

                    {/* Focalización (segmented) */}
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-foreground flex items-center gap-1">
                        <span>Focalización por semáforo</span>
                        <InfoTip term="param.targeting" size="xs" />
                      </label>
                      <div className="grid grid-cols-3 gap-1 rounded-md bg-muted p-0.5 text-xs">
                        {[
                          { value: "rojo", label: "Solo rojas" },
                          { value: "rojo_naranja", label: "Rojas y naranjas" },
                          { value: "todos", label: "Todo el país" },
                        ].map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => updateCampaign(idx, { targeting: opt.value })}
                            className={`rounded px-1.5 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                              c.targeting === opt.value
                                ? "bg-card text-primary shadow-xs"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Ámbito territorial */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-semibold text-foreground">
                        <span className="flex items-center gap-1">
                          <span>Ámbito territorial</span>
                          <InfoTip term={"ambito" as any} size="xs" />
                        </span>
                        {c.ents.length > 0 && (
                          <span className="text-[11px] font-mono font-medium text-primary">
                            {c.ents.length} {c.ents.length === 1 ? "estado" : "estados"}
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-0.5 text-xs">
                        <button
                          type="button"
                          onClick={() => {
                            setScopeMode((prev) => ({ ...prev, [idx]: "pais" }));
                            updateCampaign(idx, { ents: [] });
                          }}
                          className={`rounded px-2 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                            activeScope === "pais" && c.ents.length === 0
                              ? "bg-card text-primary shadow-xs"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          Todo el país
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setScopeMode((prev) => ({ ...prev, [idx]: "estados" }));
                          }}
                          className={`rounded px-2 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                            activeScope === "estados" || c.ents.length > 0
                              ? "bg-card text-primary shadow-xs"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          Estados (Juntas Locales)
                        </button>
                      </div>

                      {(activeScope === "estados" || c.ents.length > 0) && (
                        <div className="rounded-md border border-border bg-background p-2.5 space-y-2 mt-1">
                          {c.ents.length > 0 && (
                            <div className="space-y-1">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">
                                  Seleccionados ({c.ents.length})
                                </span>
                                <button
                                  type="button"
                                  onClick={() => updateCampaign(idx, { ents: [] })}
                                  className="text-[11px] text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
                                >
                                  Limpiar
                                </button>
                              </div>
                              <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto p-1 bg-muted/40 rounded border border-border/40">
                                {c.ents.map((entId) => {
                                  const st = allStates.find((s) => s.id === entId);
                                  return (
                                    <span
                                      key={entId}
                                      className="inline-flex items-center gap-1 rounded bg-primary-soft text-primary px-1.5 py-0.5 text-[11px] font-semibold"
                                    >
                                      <span>{st?.name ?? entId}</span>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const next = c.ents.filter((id) => id !== entId);
                                          updateCampaign(idx, { ents: next });
                                        }}
                                        className="size-3.5 inline-flex items-center justify-center rounded hover:bg-primary/20 text-primary cursor-pointer leading-none"
                                        aria-label={`Quitar ${st?.name ?? entId}`}
                                      >
                                        ×
                                      </button>
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* Search */}
                          <div className="relative">
                            <input
                              type="text"
                              placeholder="Buscar estado..."
                              value={stateSearch[idx] ?? ""}
                              onChange={(e) =>
                                setStateSearch((prev) => ({ ...prev, [idx]: e.target.value }))
                              }
                              className="h-8 w-full rounded border border-border bg-card px-2.5 text-xs text-foreground outline-none focus:border-primary"
                            />
                            {(stateSearch[idx] ?? "") && (
                              <button
                                type="button"
                                onClick={() => setStateSearch((prev) => ({ ...prev, [idx]: "" }))}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs"
                              >
                                ×
                              </button>
                            )}
                          </div>

                          {/* States list with checkboxes */}
                          <div className="max-h-36 overflow-y-auto space-y-0.5 divide-y divide-border/30 rounded border border-border/40 p-1">
                            {allStates
                              .filter((s) => {
                                const q = (stateSearch[idx] ?? "").toLowerCase().trim();
                                if (!q) return true;
                                return (
                                  s.name.toLowerCase().includes(q) || s.id.includes(q)
                                );
                              })
                              .map((st) => {
                                const isChecked = c.ents.includes(st.id);
                                return (
                                  <label
                                    key={st.id}
                                    className="flex items-center justify-between px-2 py-1.5 hover:bg-accent/50 rounded cursor-pointer text-xs"
                                  >
                                    <div className="flex items-center gap-2">
                                      <input
                                        type="checkbox"
                                        checked={isChecked}
                                        onChange={() => {
                                          const next = isChecked
                                            ? c.ents.filter((id) => id !== st.id)
                                            : [...c.ents, st.id];
                                          updateCampaign(idx, { ents: next });
                                        }}
                                        className="size-3.5 rounded border-border text-primary focus:ring-primary cursor-pointer"
                                      />
                                      <span
                                        className={
                                          isChecked
                                            ? "font-semibold text-primary"
                                            : "text-foreground"
                                        }
                                      >
                                        {st.name}
                                      </span>
                                    </div>
                                    <span className="text-[10px] font-mono text-muted-foreground">
                                      {st.id}
                                    </span>
                                  </label>
                                );
                              })}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Efecto máximo esperado slider */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs font-semibold text-foreground">
                        <span className="flex items-center gap-1">
                          <span>Efecto máximo esperado</span>
                          <InfoTip term="param.effect_pp" size="xs" />
                        </span>
                        <span className="tnum rounded bg-primary-soft px-1.5 py-0.5 text-xs font-semibold text-accent-foreground font-mono">
                          +{c.effect_pp.toFixed(1)} pp
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min={0}
                          max={10}
                          step={0.5}
                          value={c.effect_pp}
                          onChange={(e) =>
                            updateCampaign(idx, {
                              effect_pp: parseFloat(e.target.value) || 0,
                            })
                          }
                          className="flex-1 cursor-pointer"
                          style={{ accentColor: "var(--primary)" }}
                        />
                        <input
                          type="number"
                          min={0}
                          max={10}
                          step={0.5}
                          value={c.effect_pp}
                          onChange={(e) =>
                            updateCampaign(idx, {
                              effect_pp: parseFloat(e.target.value) || 0,
                            })
                          }
                          className="h-8 w-16 rounded-md border border-border bg-background px-2 text-xs text-foreground text-right tnum font-mono outline-none focus:border-primary"
                        />
                      </div>
                    </div>

                    {/* Cobertura slider */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs font-semibold text-foreground">
                        <span className="flex items-center gap-1">
                          <span>Cobertura de la intervención</span>
                          <InfoTip term="param.coverage" size="xs" />
                        </span>
                        <span className="tnum rounded bg-primary-soft px-1.5 py-0.5 text-xs font-semibold text-accent-foreground font-mono">
                          {Math.round(c.coverage)}%
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={5}
                          value={c.coverage}
                          onChange={(e) =>
                            updateCampaign(idx, {
                              coverage: parseFloat(e.target.value) || 0,
                            })
                          }
                          className="flex-1 cursor-pointer"
                          style={{ accentColor: "var(--primary)" }}
                        />
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={5}
                          value={c.coverage}
                          onChange={(e) =>
                            updateCampaign(idx, {
                              coverage: parseFloat(e.target.value) || 0,
                            })
                          }
                          className="h-8 w-16 rounded-md border border-border bg-background px-2 text-xs text-foreground text-right tnum font-mono outline-none focus:border-primary"
                        />
                      </div>
                    </div>

                    {/* Live formula for card */}
                    {(() => {
                      const effect = Number(c.effect_pp ?? 3.0);
                      const covPct = Number(c.coverage ?? 100);
                      const resultado = effect * (covPct / 100);
                      const maxResultado = 1.5 * resultado;
                      const variableLabel = LEVER_WEIGHT_VARIABLE[c.lever];

                      return (
                        <div className="p-2 rounded bg-muted/60 text-[11px] text-muted-foreground leading-relaxed">
                          <p>
                            Efecto real: {effect.toFixed(1)} pp × {Math.round(covPct)}% ={" "}
                            <strong className="text-foreground tnum">
                              {resultado.toFixed(2)} pp
                            </strong>
                            {variableLabel && c.lever !== "campana_general" ? (
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
                  </div>
                );
              })}
            </div>

            {/* + Agregar campaña button */}
            <button
              type="button"
              onClick={handleAddCampaign}
              disabled={campaigns.length >= 4 || freeLevers.length === 0}
              className="w-full h-9 rounded-md border border-dashed border-border hover:border-primary/50 bg-card hover:bg-accent text-primary text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              <svg className="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span>+ Agregar campaña</span>
              {campaigns.length >= 4 && (
                <span className="text-[10px] text-muted-foreground font-normal">(máximo 4)</span>
              )}
            </button>

            {/* Regla de combinación */}
            <div className="flex items-start gap-1.5 p-2.5 rounded-md bg-primary-soft/40 border border-primary/20 text-[11px] text-foreground leading-relaxed">
              <InfoTip term={"combinacion" as any} size="xs" />
              <p className="text-muted-foreground">
                Si varias campañas llegan a las mismas personas, la segunda solo puede convencer a quien la primera no movió (rendimientos decrecientes).
              </p>
            </div>
          </div>
        )}

        {/* ===================== PESIMISTA ===================== */}
        {scenario === "pesimista" && (
          <div className="space-y-4">
            {/* Shock pp */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-semibold text-foreground">
                <span className="flex items-center gap-1">
                  <span>Caída general de participación</span>
                  <InfoTip term={PARAM_TERM.shock_pp} size="xs" />
                </span>
                <span className="tnum rounded bg-primary-soft px-1.5 py-0.5 text-xs font-semibold text-accent-foreground font-mono">
                  {Number(pesimistaDraft.shock_pp ?? 2.0).toFixed(1)} pp
                </span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={5}
                  step={0.5}
                  value={Number(pesimistaDraft.shock_pp ?? 2.0)}
                  onChange={(e) =>
                    setPesimistaDraft((prev) => ({
                      ...prev,
                      shock_pp: parseFloat(e.target.value) || 0,
                    }))
                  }
                  className="flex-1 cursor-pointer"
                  style={{ accentColor: "var(--primary)" }}
                />
                <input
                  type="number"
                  min={0}
                  max={5}
                  step={0.5}
                  value={Number(pesimistaDraft.shock_pp ?? 2.0)}
                  onChange={(e) =>
                    setPesimistaDraft((prev) => ({
                      ...prev,
                      shock_pp: parseFloat(e.target.value) || 0,
                    }))
                  }
                  className="h-8 w-16 rounded-md border border-border bg-background px-2 text-xs text-foreground text-right tnum font-mono outline-none focus:border-primary"
                />
              </div>
              {pesimistaErrors.shock_pp && (
                <p className="text-xs text-destructive font-medium">{pesimistaErrors.shock_pp}</p>
              )}
            </div>

            {/* Trend amplifier */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-semibold text-foreground">
                <span className="flex items-center gap-1">
                  <span>Acentuación de tendencias negativas</span>
                  <InfoTip term={PARAM_TERM.trend_amplifier} size="xs" />
                </span>
                <span className="tnum rounded bg-primary-soft px-1.5 py-0.5 text-xs font-semibold text-accent-foreground font-mono">
                  {Math.round(Number(pesimistaDraft.trend_amplifier ?? 50))}%
                </span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={10}
                  value={Number(pesimistaDraft.trend_amplifier ?? 50)}
                  onChange={(e) =>
                    setPesimistaDraft((prev) => ({
                      ...prev,
                      trend_amplifier: parseFloat(e.target.value) || 0,
                    }))
                  }
                  className="flex-1 cursor-pointer"
                  style={{ accentColor: "var(--primary)" }}
                />
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={10}
                  value={Number(pesimistaDraft.trend_amplifier ?? 50)}
                  onChange={(e) =>
                    setPesimistaDraft((prev) => ({
                      ...prev,
                      trend_amplifier: parseFloat(e.target.value) || 0,
                    }))
                  }
                  className="h-8 w-16 rounded-md border border-border bg-background px-2 text-xs text-foreground text-right tnum font-mono outline-none focus:border-primary"
                />
              </div>
              {pesimistaErrors.trend_amplifier && (
                <p className="text-xs text-destructive font-medium">
                  {pesimistaErrors.trend_amplifier}
                </p>
              )}
            </div>

            {/* Live Formula Box */}
            {(() => {
              const shock = Number(pesimistaDraft.shock_pp ?? 2.0);
              const trendPct = Number(pesimistaDraft.trend_amplifier ?? 50);

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
          </div>
        )}

        {/* ===================== RESULTADO SIMULADO ===================== */}
        {simulationResult ? (
          <div className="rounded-lg border border-border bg-card p-3 space-y-3">
            <div>
              <div className="flex items-center justify-between text-xs font-bold text-foreground">
                <span>Resultado simulado</span>
                <span className="text-[10px] text-muted-foreground tnum font-mono">
                  {simulationResult.summary.n_units} zonas evaluadas
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Comparado con el escenario base
              </p>
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

            {/* Zones vs base */}
            {(() => {
              let down = 0;
              let up = 0;
              let noChange = 0;
              for (const it of simulationResult.items) {
                const delta = it.delta_vs_base_pp;
                if (typeof delta === "number") {
                  if (delta < -0.05) down++;
                  else if (delta > 0.05) up++;
                  else noChange++;
                } else {
                  noChange++;
                }
              }
              return (
                <div className="text-[11px] text-muted-foreground flex flex-wrap items-center gap-1.5 pt-1 border-t border-border/50">
                  <span>Zonas vs base:</span>
                  <span className="text-good font-semibold tnum">{down} bajan</span>
                  <span>·</span>
                  <span className="text-bad font-semibold tnum">{up} suben</span>
                  <span>·</span>
                  <span className="text-muted-foreground font-semibold tnum">{noChange} sin cambio</span>
                </div>
              );
            })()}

            {/* Multi-campaign breakdown table */}
            {scenario === "intervencion" &&
              simulationResult.summary.campaigns &&
              simulationResult.summary.campaigns.length >= 2 && (
                <div className="rounded-md border border-border bg-muted/40 p-2.5 space-y-2 mt-2">
                  <div className="flex items-center justify-between text-xs font-bold text-foreground">
                    <span className="flex items-center gap-1">
                      <span>Si cada campaña fuera la única</span>
                      <InfoTip term={"campanas" as any} size="xs" />
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px] text-left">
                      <thead>
                        <tr className="border-b border-border text-muted-foreground font-semibold">
                          <th className="pb-1 font-medium">Palanca</th>
                          <th className="pb-1 font-medium">Ámbito</th>
                          <th className="pb-1 font-medium text-right">Votos</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/40">
                        {simulationResult.summary.campaigns.map((cs, i) => {
                          let scopeLabel = "Todo el país";
                          if (cs.ents && cs.ents.length > 0) {
                            if (cs.ents.length <= 3) {
                              const names = cs.ents.map(
                                (id) => allStates.find((s) => s.id === id)?.name ?? id
                              );
                              scopeLabel = names.join(", ");
                            } else {
                              scopeLabel = `${cs.ents.length} estados`;
                            }
                          }
                          return (
                            <tr key={i} className="hover:bg-muted/40">
                              <td className="py-1 text-foreground font-medium">
                                {LEVER_SHORT_LABELS[cs.lever] ?? cs.label}
                              </td>
                              <td className="py-1 text-muted-foreground">{scopeLabel}</td>
                              <td className="py-1 text-right font-mono font-semibold text-good tnum">
                                {formatSignedVotes(cs.votos_solo)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot className="border-t border-border pt-1 font-semibold text-[11px]">
                        {simulationResult.summary.votos_suma_individual !== undefined && (
                          <tr>
                            <td colSpan={2} className="py-1 text-muted-foreground font-medium">
                              Suma individual
                            </td>
                            <td className="py-1 text-right font-mono text-foreground tnum font-semibold">
                              {formatSignedVotes(simulationResult.summary.votos_suma_individual)}
                            </td>
                          </tr>
                        )}
                        {simulationResult.summary.votos_traslape !== undefined && (
                          <tr>
                            <td colSpan={2} className="py-1 text-muted-foreground font-medium">
                              <span className="inline-flex items-center gap-1">
                                <span>Traslape</span>
                                <InfoTip
                                  term={"traslape" as any}
                                  text="personas alcanzadas por más de una campaña"
                                  size="xs"
                                />
                              </span>
                            </td>
                            <td className="py-1 text-right font-mono text-bad tnum font-semibold">
                              -{Math.abs(simulationResult.summary.votos_traslape).toLocaleString("es-MX")}
                            </td>
                          </tr>
                        )}
                      </tfoot>
                    </table>
                  </div>
                </div>
              )}

            {/* Stacked risk bar */}
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

        {/* Footer lineamientos disclaimer */}
        <div className="flex items-start gap-1.5 p-2 rounded-md bg-muted/60 text-[11px] text-muted-foreground leading-relaxed">
          <InfoTip term={"lineamientos" as any} size="xs" />
          <p>
            Escenario hipotético para planeación. Solo usa criterios territoriales y datos agregados; no considera preferencias políticas ni datos personales.
          </p>
        </div>
      </div>

      {/* Footer Actions */}
      <div className="flex items-center justify-between gap-2 border-t border-border p-3 shrink-0">
        <button
          type="button"
          onClick={handleReset}
          disabled={!isModified || isSimulating}
          className="px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:bg-muted rounded-md transition-colors flex items-center gap-1.5 cursor-pointer min-h-[36px]"
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
            className="px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer min-h-[36px]"
          >
            Cerrar
          </button>
          <button
            type="button"
            onClick={handleSimulate}
            disabled={isSimulating}
            className="px-4 py-1.5 text-xs font-semibold text-primary-foreground bg-primary hover:opacity-90 disabled:opacity-50 rounded-md transition-all flex items-center gap-1.5 shadow-xs cursor-pointer min-h-[36px]"
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
