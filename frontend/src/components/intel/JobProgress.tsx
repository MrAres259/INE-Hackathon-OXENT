"use client";

import React from "react";
import type { Job } from "@/lib/intel/types";

export interface JobProgressProps {
  job?: Job | null;
  stage?: string;
  progress?: number;
  stages?: string[];
  error?: string | null;
  onRetry?: () => void;
  className?: string;
}

export function JobProgress({
  job,
  stage: stageProp,
  progress: progressProp,
  stages = [],
  error: errorProp,
  onRetry,
  className = "",
}: JobProgressProps) {
  const currentStage = job?.stage ?? stageProp ?? "Procesando...";
  const currentProgress = Math.max(0, Math.min(100, job?.progress ?? progressProp ?? 0));
  const errorMessage = job?.error ?? errorProp;
  const isError = job?.status === "error" || Boolean(errorMessage);

  return (
    <div
      role="region"
      aria-label="Progreso del trabajo"
      aria-live="polite"
      className={`rounded-lg border border-border bg-card p-4 shadow-xs space-y-3 ${className}`}
    >
      {/* Header: Stage name & Progress % */}
      <div className="flex items-center justify-between text-xs font-semibold">
        <span className="text-foreground flex items-center gap-2">
          {!isError && currentProgress < 100 && (
            <svg className="animate-spin size-3.5 text-primary" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          )}
          <span>{currentStage}</span>
        </span>
        <span className="font-mono text-muted-foreground tnum">{currentProgress}%</span>
      </div>

      {/* Progress Bar */}
      <div
        role="progressbar"
        aria-valuenow={currentProgress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={currentStage}
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className={`h-full transition-all duration-300 ${
            isError ? "bg-destructive" : "bg-primary"
          }`}
          style={{ width: `${currentProgress}%` }}
        />
      </div>

      {/* Stages Checklist (if provided) */}
      {stages.length > 0 && (
        <ol className="space-y-1.5 pt-1 text-[11px]">
          {stages.map((stg, idx) => {
            const isCompleted = currentProgress >= ((idx + 1) / stages.length) * 100;
            const isCurrent = !isCompleted && currentStage.toLowerCase().includes(stg.toLowerCase());

            return (
              <li key={stg} className="flex items-center gap-2">
                <span
                  className={`size-3.5 rounded-full flex items-center justify-center text-[9px] font-bold ${
                    isCompleted
                      ? "bg-good text-white"
                      : isCurrent
                      ? "bg-primary text-white animate-pulse"
                      : "bg-muted text-muted-foreground border border-border"
                  }`}
                >
                  {isCompleted ? "✓" : idx + 1}
                </span>
                <span
                  className={
                    isCompleted
                      ? "text-muted-foreground line-through"
                      : isCurrent
                      ? "font-semibold text-foreground"
                      : "text-muted-foreground"
                  }
                >
                  {stg}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {/* Error State with Retry Button */}
      {isError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive space-y-2">
          <div className="flex items-start gap-2">
            <span className="text-base leading-none">⚠️</span>
            <div className="flex-1 font-medium">{errorMessage || "Ocurrió un error durante la ejecución."}</div>
          </div>
          {onRetry && (
            <div className="pt-1 flex justify-end">
              <button
                type="button"
                onClick={onRetry}
                className="h-7 px-3 rounded-md bg-destructive text-white hover:bg-destructive/90 text-xs font-semibold transition-colors cursor-pointer"
              >
                Reintentar
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
