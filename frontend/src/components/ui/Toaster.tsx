"use client";

import React, { useState, useEffect } from "react";
import { subscribeToasts, dismissToast, getToasts, type ToastItem } from "@/lib/toast";

export function Toaster() {
  const [toasts, setToasts] = useState<ToastItem[]>(() => getToasts());

  useEffect(() => {
    return subscribeToasts((items) => {
      setToasts(items);
    });
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed z-50 left-1/2 -translate-x-1/2 bottom-[156px] lg:bottom-[calc(24px+env(safe-area-inset-bottom,0px))] flex flex-col items-center gap-2 pointer-events-none max-w-[90vw] sm:max-w-md w-full px-4"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto w-full rounded-lg px-3.5 py-2.5 shadow-float flex items-start justify-between gap-3 transition-all duration-200 animate-in fade-in slide-in-from-bottom-2 select-none ${
            t.kind === "success"
              ? "bg-good text-white border border-good/30"
              : "bg-destructive text-white border border-destructive/30"
          }`}
        >
          <div className="flex items-start gap-2.5 min-w-0 flex-1">
            {t.kind === "success" ? (
              <svg
                className="size-4 shrink-0 mt-0.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            ) : (
              <svg
                className="size-4 shrink-0 mt-0.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" strokeWidth={2} />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01" />
              </svg>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold leading-tight">{t.title}</p>
              {t.detail && (
                <p className="text-[11px] leading-snug mt-0.5 text-white/90 break-words">
                  {t.detail}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => dismissToast(t.id)}
            className="shrink-0 rounded p-1 text-white/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            aria-label="Cerrar aviso"
          >
            <svg className="size-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
