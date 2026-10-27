"use client";

import React from "react";

export type FallbackReason = "unsupported" | "error" | "context-lost";

export interface MapFallbackProps {
  reason: FallbackReason;
  onRetry?: () => void;
  className?: string;
}

export function MapFallback({
  reason,
  onRetry,
  className = "",
}: MapFallbackProps): React.JSX.Element {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`absolute inset-0 z-30 flex flex-col items-center justify-center p-6 bg-background/80 backdrop-blur-sm text-center select-none ${className}`}
    >
      <div className="max-w-md bg-card border border-border rounded-2xl p-6 shadow-float flex flex-col items-center gap-3 text-foreground">
        {reason === "unsupported" && (
          <>
            <div className="size-12 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-600 mb-1">
              <svg
                className="size-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            <h3 className="font-display text-sm font-bold text-foreground">WebGL no disponible</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Tu navegador no tiene WebGL activo; el ranking y el panel de detalle siguen disponibles.
            </p>
          </>
        )}

        {reason === "error" && (
          <>
            <div className="size-12 rounded-full bg-destructive/10 border border-destructive/30 flex items-center justify-center text-destructive mb-1">
              <svg
                className="size-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <h3 className="font-display text-sm font-bold text-foreground">Error de carga</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              No se pudo cargar el mapa.
            </p>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="mt-2 px-4 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-lg transition-colors shadow-xs cursor-pointer"
              >
                Reintentar
              </button>
            )}
          </>
        )}

        {reason === "context-lost" && (
          <>
            <div className="size-12 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center text-primary mb-1">
              <svg
                className="animate-spin size-6 text-primary"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
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
            </div>
            <h3 className="font-display text-sm font-bold text-foreground">Recuperando mapa…</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Reiniciando contexto gráfico WebGL...
            </p>
          </>
        )}
      </div>
    </div>
  );
}
