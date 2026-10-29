"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import type { CampaignPlan, Job } from "@/lib/intel/types";
import {
  getCachedCampaign,
  requestCampaign,
  pollJob,
  IntelApiError,
} from "@/lib/intel/api";
import { useOperator } from "@/lib/intel/operator";
import { JobProgress } from "@/components/intel/JobProgress";
import { OperatorGate } from "@/components/intel/OperatorGate";

export interface CampaignRunnerProps {
  unitId: string | null;
  focus: string;
  currentPlan: CampaignPlan | null;
  onPlanLoaded: (plan: CampaignPlan | null) => void;
  className?: string;
}

const CAMPAIGN_STAGES = [
  "Leyendo datos de Atalaya",
  "Investigando con Gemini en fuentes verificadas",
  "Planeando la campaña con GLM-5.3",
  "Calculando impacto con el simulador",
  "Armando diapositivas",
];

function formatTimeAgo(isoString: string): string {
  try {
    const diffMs = Date.now() - new Date(isoString).getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHours = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) return `hace ${diffDays} día${diffDays > 1 ? "s" : ""}`;
    if (diffHours > 0) return `hace ${diffHours} h`;
    if (diffMin > 0) return `hace ${diffMin} min`;
    return "hace unos momentos";
  } catch {
    return isoString.slice(0, 10);
  }
}

export function CampaignRunner({
  unitId,
  focus,
  currentPlan,
  onPlanLoaded,
  className = "",
}: CampaignRunnerProps) {
  const { isOperator } = useOperator();

  const [checkingCache, setCheckingCache] = useState(false);
  const [runningJob, setRunningJob] = useState<Job<CampaignPlan> | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [cachedNotFound, setCachedNotFound] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);

  // When unitId changes: abort current job, check cached plan
  useEffect(() => {
    // Abort previous polling
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setRunningJob(null);
    setErrorMessage(null);

    if (!unitId) {
      setCachedNotFound(false);
      onPlanLoaded(null);
      return;
    }

    let active = true;
    setCheckingCache(true);
    setCachedNotFound(false);

    getCachedCampaign(unitId, focus || null)
      .then((plan) => {
        if (!active) return;
        setCheckingCache(false);
        setCachedNotFound(false);
        onPlanLoaded(plan);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setCheckingCache(false);
        if (err instanceof IntelApiError && err.status === 404) {
          setCachedNotFound(true);
          onPlanLoaded(null);
        } else {
          // If 404 or other network check failure, mark as not found
          setCachedNotFound(true);
          onPlanLoaded(null);
        }
      });

    return () => {
      active = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [unitId, focus, onPlanLoaded]);

  // Launch new research & plan execution
  const handleLaunchPlan = useCallback(
    async (refresh = false) => {
      if (!unitId) return;

      // Abort previous if any
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setErrorMessage(null);
      setRunningJob({
        id: "starting",
        kind: "campaign",
        key: `${unitId}:${focus || ""}`,
        status: "queued",
        stage: "Iniciando investigación...",
        progress: 5,
        created_at: new Date().toISOString(),
      });

      try {
        const response = await requestCampaign({
          unit_id: unitId,
          focus: focus ? focus.trim() : null,
          refresh,
        });

        if ("plan" in response && response.plan) {
          // Cached plan returned immediately
          setRunningJob(null);
          setCachedNotFound(false);
          onPlanLoaded(response.plan);
          return;
        }

        // Job queued/running -> poll until complete
        const initialJob = response as Job<CampaignPlan>;
        setRunningJob(initialJob);

        const finishedJob = await pollJob<CampaignPlan>(initialJob.id, {
          signal: controller.signal,
          intervalMs: 1500,
          onUpdate: (updated) => {
            setRunningJob(updated);
          },
        });

        if (finishedJob.status === "done" && finishedJob.result) {
          setRunningJob(null);
          setCachedNotFound(false);
          onPlanLoaded(finishedJob.result);
        } else if (finishedJob.status === "error") {
          setErrorMessage(finishedJob.error || "Ocurrió un error al planear la campaña.");
          setRunningJob(null);
        }
      } catch (err: unknown) {
        if (controller.signal.aborted) {
          return; // Cancelled intentionally
        }
        setRunningJob(null);
        if (err instanceof IntelApiError) {
          setErrorMessage(err.detail);
        } else if (err instanceof Error) {
          setErrorMessage(err.message);
        } else {
          setErrorMessage("Error de conexión al generar el plan de campaña.");
        }
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    },
    [unitId, focus, onPlanLoaded]
  );

  const handleCancelJob = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setRunningJob(null);
  };

  // State: No unit selected
  if (!unitId) {
    return (
      <div className={`rounded-xl border border-dashed border-border bg-card/50 p-8 text-center space-y-2 ${className}`}>
        <div className="mx-auto size-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
          <svg className="size-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
            <line x1="8" y1="2" x2="8" y2="18" />
            <line x1="16" y1="6" x2="16" y2="22" />
          </svg>
        </div>
        <h3 className="text-sm font-semibold text-foreground">
          Selecciona una entidad o municipio
        </h3>
        <p className="text-xs text-muted-foreground max-w-sm mx-auto">
          Utiliza el buscador superior para elegir la zona territorial donde deseas investigar causas de abstención y planear intervenciones.
        </p>
      </div>
    );
  }

  // State: Checking cache
  if (checkingCache) {
    return (
      <div className={`rounded-xl border border-border bg-card p-6 flex items-center justify-center gap-3 text-xs text-muted-foreground ${className}`}>
        <svg className="animate-spin size-4 text-primary" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
        <span>Consultando planes existentes en caché...</span>
      </div>
    );
  }

  // State: Active Job Running
  if (runningJob) {
    return (
      <div className={`space-y-3 ${className}`}>
        <JobProgress
          job={runningJob}
          stages={CAMPAIGN_STAGES}
          error={errorMessage}
          onRetry={() => handleLaunchPlan(true)}
        />
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleCancelJob}
            className="text-xs text-muted-foreground hover:text-foreground underline transition-colors cursor-pointer"
          >
            Cancelar proceso
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Error banner if generation failed */}
      {errorMessage && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3.5 text-xs text-destructive space-y-2">
          <div className="flex items-start gap-2">
            <span className="text-base leading-none">⚠️</span>
            <div className="flex-1 font-medium leading-relaxed">{errorMessage}</div>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => handleLaunchPlan(false)}
              className="h-7 px-3 rounded bg-destructive text-white text-xs font-semibold hover:bg-destructive/90 transition-colors cursor-pointer"
            >
              Reintentar
            </button>
          </div>
        </div>
      )}

      {/* State 1: Plan in cache */}
      {currentPlan && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card/80 p-3.5 text-xs">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-good" />
            <span className="font-semibold text-foreground">
              Plan disponible en memoria
            </span>
            <span className="text-muted-foreground font-mono">
              · {formatTimeAgo(currentPlan.generated_at)}
            </span>
            {currentPlan.llm?.degraded && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-risk-mid/10 text-risk-mid border border-risk-mid/30">
                Plan de respaldo determinista
              </span>
            )}
          </div>

          {/* Regenerate Button for Operators */}
          {isOperator ? (
            <button
              type="button"
              onClick={() => handleLaunchPlan(true)}
              className="h-7 px-3 rounded-md border border-border bg-muted/60 hover:bg-accent text-xs font-semibold text-foreground transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <svg className="size-3 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>Regenerar plan</span>
            </button>
          ) : (
            <span className="text-[11px] text-muted-foreground">
              Modo lectura pública
            </span>
          )}
        </div>
      )}

      {/* State 2: No plan in cache */}
      {cachedNotFound && !currentPlan && (
        <div className="rounded-xl border border-border bg-card p-6 space-y-4">
          <div className="space-y-1">
            <h3 className="font-display text-sm font-bold text-foreground">
              No existe plan previo para esta zona
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              No se encontró un plan de campaña precalculado en la memoria de Atalaya para esta delimitación territorial y enfoque.
            </p>
          </div>

          {isOperator ? (
            <div className="pt-2">
              <button
                type="button"
                onClick={() => handleLaunchPlan(false)}
                className="h-9 px-4 rounded-lg bg-primary hover:bg-primary/90 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer flex items-center gap-2"
              >
                <span>✨</span>
                <span>Investigar y planear con IA</span>
              </button>
            </div>
          ) : (
            <div className="space-y-3 pt-1">
              <p className="text-xs text-muted-foreground">
                La generación de nuevos análisis con Gemini 3.8 Flash y GLM-5.3 requiere autenticación como operador del INE.
              </p>
              <OperatorGate label="Ingresar clave de operador para planear" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
