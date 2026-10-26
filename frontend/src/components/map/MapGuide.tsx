"use client";

import React from "react";
import Link from "next/link";

export const GUIDE_STORAGE_KEY = "atalaya.guide.v1";

/**
 * Pure helper to determine if the first-visit guide should be shown.
 * Wrapped in try/catch for safety; returns false if storage is null or throws.
 */
export function shouldShowGuide(
  storage: Pick<Storage, "getItem"> | null | undefined
): boolean {
  if (!storage) return false;
  try {
    const val = storage.getItem(GUIDE_STORAGE_KEY);
    return val === null || val === "";
  } catch {
    return false;
  }
}

/**
 * Pure helper to mark the first-visit guide as dismissed in storage.
 * Wrapped in try/catch for safety; no-op if storage is null or throws.
 */
export function dismissGuide(
  storage?: Pick<Storage, "setItem"> | null
): void {
  const target =
    storage !== undefined
      ? storage
      : typeof window !== "undefined"
      ? window.localStorage
      : null;
  if (!target) return;
  try {
    target.setItem(GUIDE_STORAGE_KEY, "1");
  } catch {
    // ignore quota, security, or private browsing errors
  }
}

export interface MapGuideProps {
  open: boolean;
  onClose: () => void;
  className?: string;
}

export function MapGuide({ open, onClose, className = "" }: MapGuideProps) {
  if (!open) return null;

  const handleDismiss = () => {
    if (typeof window !== "undefined") {
      dismissGuide(window.localStorage);
    }
    onClose();
  };

  return (
    <div
      role="region"
      aria-label="Guía de lectura del mapa"
      className={`bg-slate-900/95 backdrop-blur-md border border-slate-700/80 rounded-xl p-3 shadow-2xl text-white max-w-[340px] w-full pointer-events-auto z-30 transition-all ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-2 mb-2.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <svg
            className="w-4 h-4 text-emerald-400 shrink-0"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
              clipRule="evenodd"
            />
          </svg>
          <h3 className="font-bold text-xs text-white truncate">
            ¿Cómo leer este mapa?
          </h3>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Cerrar guía"
          className="text-slate-400 hover:text-white text-xs p-0.5 rounded transition-colors"
          title="Cerrar guía"
        >
          ✕
        </button>
      </div>

      {/* 4 Steps */}
      <ol className="space-y-2 text-[11px] text-slate-200 mb-3">
        <li className="flex items-center gap-2">
          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300 font-bold text-[10px] border border-emerald-500/40">
            1
          </span>
          <span className="leading-tight">
            El color es el riesgo de abstención 2027 (semáforo).
          </span>
        </li>
        <li className="flex items-center gap-2">
          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300 font-bold text-[10px] border border-emerald-500/40">
            2
          </span>
          <span className="leading-tight">
            Haz clic en un estado y luego en un municipio para ver su diagnóstico.
          </span>
        </li>
        <li className="flex items-center gap-2">
          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300 font-bold text-[10px] border border-emerald-500/40">
            3
          </span>
          <span className="leading-tight">
            Cambia el escenario arriba para simular una intervención o un caso pesimista.
          </span>
        </li>
        <li className="flex items-center gap-2">
          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300 font-bold text-[10px] border border-emerald-500/40">
            4
          </span>
          <span className="leading-tight">
            El asistente responde preguntas sobre estos datos.
          </span>
        </li>
      </ol>

      {/* Actions */}
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-800">
        <Link
          href="/metodologia"
          className="text-[11px] text-slate-400 hover:text-emerald-300 transition-colors underline underline-offset-2"
        >
          Ver metodología
        </Link>
        <button
          type="button"
          onClick={handleDismiss}
          className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs px-2.5 py-1 rounded-md transition-colors shadow-xs"
        >
          Entendido
        </button>
      </div>
    </div>
  );
}
