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
      className={`absolute inset-0 z-30 flex flex-col items-center justify-center p-6 bg-[#060a13]/95 backdrop-blur-sm text-center select-none ${className}`}
    >
      <div className="max-w-md bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-2xl flex flex-col items-center gap-3">
        {reason === "unsupported" && (
          <>
            <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 mb-1">
              <svg
                className="w-6 h-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            <h3 className="text-sm font-bold text-white">WebGL no disponible</h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              Tu navegador no tiene WebGL activo; el ranking y el panel de detalle siguen disponibles.
            </p>
          </>
        )}

        {reason === "error" && (
          <>
            <div className="w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400 mb-1">
              <svg
                className="w-6 h-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <h3 className="text-sm font-bold text-white">Error de carga</h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              No se pudo cargar el mapa.
            </p>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="mt-2 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition-colors shadow-sm cursor-pointer"
              >
                Reintentar
              </button>
            )}
          </>
        )}

        {reason === "context-lost" && (
          <>
            <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mb-1">
              <svg
                className="animate-spin h-6 w-6 text-emerald-400"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
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
            <h3 className="text-sm font-bold text-white">Recuperando mapa…</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Reiniciando contexto gráfico WebGL...
            </p>
          </>
        )}
      </div>
    </div>
  );
}
