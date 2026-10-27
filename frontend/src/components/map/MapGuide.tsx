"use client";

import React, { useState, useEffect, useCallback, useLayoutEffect } from "react";

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

export interface TourStep {
  sel: string;
  title: string;
  text: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    sel: "escenario",
    title: "1 · Elige un escenario",
    text: "Base sigue la tendencia actual; Intervención y Pesimista simulan el impacto ante acciones preventivas o caídas de participación.",
  },
  {
    sel: "capas",
    title: "2 · Cambia la vista del mapa",
    text: "Semáforo muestra el nivel de riesgo 2027; Cambio Δ muestra la diferencia contra la base y Comparar ofrece una cortina interactiva.",
  },
  {
    sel: "panel",
    title: "3 · Explora el detalle territorial",
    text: "Consulta el diagnóstico completo, factores sociodemográficos, recomendaciones operativas y ranking para cualquier estado o municipio.",
  },
  {
    sel: "buscar",
    title: "4 · Búsqueda rápida",
    text: "Presiona / o escribe en el buscador para localizar cualquier estado o municipio de México al instante.",
  },
  {
    sel: "herramientas",
    title: "5 · Herramientas y vista 3D",
    text: "Activa la vista 3D para apreciar la altura según el riesgo, exporta el mapa a imagen PNG o reabre esta guía en cualquier momento.",
  },
  {
    sel: "leyenda",
    title: "6 · Consulta la leyenda",
    text: "Identifica los cuatro niveles del semáforo, el conteo de municipios y la proporción de lista nominal representada en cada categoría.",
  },
];

/**
 * Determines whether a DOM element is visible (width > 0, height > 0, and not display:none).
 */
export function isElementVisible(el: any): boolean {
  if (!el) return false;
  if (el.style && el.style.display === "none") return false;
  try {
    if (typeof window !== "undefined" && typeof window.getComputedStyle === "function") {
      const style = window.getComputedStyle(el);
      if (style && style.display === "none") return false;
    }
  } catch {}
  if (typeof el.getBoundingClientRect === "function") {
    const r = el.getBoundingClientRect();
    if (!r || r.width <= 0 || r.height <= 0) return false;
    return true;
  }
  return false;
}

/**
 * Finds the first visible anchor element for the tour step selector.
 * Uses querySelectorAll and falls back to querySelector.
 */
export function findVisibleAnchor(
  sel: string,
  doc?: any
): { el: any; rect: DOMRect } | null {
  const documentRef =
    doc !== undefined
      ? doc
      : typeof document !== "undefined"
      ? document
      : null;
  if (!documentRef) return null;

  const selector = `[data-tour="${sel}"]`;

  if (typeof documentRef.querySelectorAll === "function") {
    try {
      const nodes = documentRef.querySelectorAll(selector);
      const list = Array.from(nodes || []);
      for (const node of list) {
        if (isElementVisible(node)) {
          return { el: node, rect: (node as any).getBoundingClientRect() };
        }
      }
    } catch {}
  }

  if (typeof documentRef.querySelector === "function") {
    try {
      const el = documentRef.querySelector(selector);
      if (isElementVisible(el)) {
        return { el, rect: el.getBoundingClientRect() };
      }
    } catch {}
  }

  return null;
}

/**
 * Helper to find the next valid step anchor element with positive dimensions and visibility.
 * Skips missing, zero-dimension, or display:none anchors.
 */
export function getValidStepAndRect(
  fromIndex = 0,
  doc?: any
): { index: number; rect: DOMRect } | null {
  const documentRef =
    doc !== undefined
      ? doc
      : typeof document !== "undefined"
      ? document
      : null;
  if (!documentRef) return null;

  for (let idx = fromIndex; idx < TOUR_STEPS.length; idx++) {
    const match = findVisibleAnchor(TOUR_STEPS[idx].sel, documentRef);
    if (match) {
      return { index: idx, rect: match.rect };
    }
  }
  return null;
}

export interface MapGuideProps {
  open?: boolean;
  onClose?: () => void;
  className?: string;
}

// Safe useLayoutEffect fallback for SSR
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function MapGuide({ open, onClose, className = "" }: MapGuideProps) {
  const isControlled = open !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const effectiveOpen = isControlled ? Boolean(open) : internalOpen;

  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const handleClose = useCallback(() => {
    if (typeof window !== "undefined") {
      dismissGuide(window.localStorage);
    }
    setRect(null);
    if (!isControlled) {
      setInternalOpen(false);
    }
    onClose?.();
  }, [isControlled, onClose]);

  // First-visit auto-open with ~900ms delay if uncontrolled
  useEffect(() => {
    if (isControlled) return;
    if (typeof window !== "undefined" && shouldShowGuide(window.localStorage)) {
      const timer = setTimeout(() => {
        if (shouldShowGuide(window.localStorage)) {
          setInternalOpen(true);
          setI(0);
        }
      }, 900);
      return () => clearTimeout(timer);
    }
  }, [isControlled]);

  // Contract C1: listen for atalaya:open-guide CustomEvent
  useEffect(() => {
    const handleOpenEvent = () => {
      setI(0);
      if (!isControlled) {
        setInternalOpen(true);
      }
    };
    window.addEventListener("atalaya:open-guide", handleOpenEvent);
    return () => window.removeEventListener("atalaya:open-guide", handleOpenEvent);
  }, [isControlled]);

  // Reset index when opened
  useEffect(() => {
    if (effectiveOpen) {
      setI(0);
    } else {
      setRect(null);
    }
  }, [effectiveOpen]);

  // Layout effect to position spotlight on current anchor or skip if missing/zero-width
  useIsomorphicLayoutEffect(() => {
    if (!effectiveOpen) return;
    const match = getValidStepAndRect(i);
    if (!match) {
      // No remaining valid steps found: close tour
      handleClose();
      return;
    }
    if (match.index !== i) {
      setI(match.index);
    }
    setRect(match.rect);
  }, [effectiveOpen, i, handleClose]);

  // Reposition on window resize and scroll
  useEffect(() => {
    if (!effectiveOpen) return;

    const handleReposition = () => {
      const currentSel = TOUR_STEPS[i]?.sel;
      const match = currentSel ? findVisibleAnchor(currentSel, document) : null;
      if (match) {
        setRect(match.rect);
        return;
      }
      // If current anchor vanished, advance to next valid
      const nextMatch = getValidStepAndRect(i + 1);
      if (nextMatch) {
        setI(nextMatch.index);
        setRect(nextMatch.rect);
      } else {
        handleClose();
      }
    };

    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    return () => {
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [effectiveOpen, i, handleClose]);

  // Close on Escape key
  useEffect(() => {
    if (!effectiveOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [effectiveOpen, handleClose]);

  const handleNext = () => {
    const nextMatch = getValidStepAndRect(i + 1);
    if (nextMatch) {
      setI(nextMatch.index);
      setRect(nextMatch.rect);
    } else {
      handleClose();
    }
  };

  // Determine current active anchor step and rect
  const activeMatch = rect
    ? { index: i, rect }
    : effectiveOpen
    ? getValidStepAndRect(i)
    : null;

  if (!effectiveOpen || !activeMatch) {
    return null;
  }

  const currentStep = TOUR_STEPS[activeMatch.index];
  if (!currentStep) return null;
  const currentRect = activeMatch.rect;

  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const vh = typeof window !== "undefined" ? window.innerHeight : 768;
  const margin = 12;
  const w = Math.min(280, Math.max(200, vw - margin * 2));

  const balloonHeightEstimate = 160;
  // If the anchor center is in the bottom half of the viewport, place the balloon above the anchor
  const anchorCenterY = currentRect.top + currentRect.height / 2;
  const isBottomHalf = anchorCenterY > vh / 2;

  // Horizontal position centered on anchor, clamped to screen with 12px margins
  const left = Math.min(
    Math.max(margin, currentRect.left + currentRect.width / 2 - w / 2),
    Math.max(margin, vw - w - margin)
  );

  // Vertical position: above if anchor is in bottom half, below if anchor is in top half
  let top = isBottomHalf
    ? currentRect.top - balloonHeightEstimate - 10
    : currentRect.bottom + 10;

  // Clamp vertical position with 12px margin so balloon never leaves screen
  const maxTop = Math.max(margin, vh - balloonHeightEstimate - margin);
  top = Math.min(Math.max(margin, top), maxTop);

  const hasMoreSteps = getValidStepAndRect(activeMatch.index + 1) !== null;

  return (
    <>
      {/* Spotlight ring surrounding targeted anchor */}
      <div
        className="pointer-events-none fixed z-[70] rounded-lg ring-2 ring-primary ring-offset-2 ring-offset-background transition-all"
        style={{
          position: "fixed",
          zIndex: 70,
          left: Math.max(0, currentRect.left - 4),
          top: Math.max(0, currentRect.top - 4),
          width: currentRect.width + 8,
          height: Math.min(currentRect.height + 8, 160),
        }}
      />

      {/* Floating guided tour balloon */}
      <div
        role="region"
        aria-label="Guía interactiva del mapa"
        className={`fixed z-[70] float-panel p-3.5 shadow-float text-foreground ${className}`}
        style={{
          position: "fixed",
          zIndex: 70,
          left,
          top,
          width: w,
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-display text-sm font-bold text-foreground truncate">
            {currentStep.title}
          </h3>
          <span className="text-[10px] text-muted-foreground font-mono shrink-0">
            {activeMatch.index + 1}/{TOUR_STEPS.length}
          </span>
        </div>

        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {currentStep.text}
        </p>

        <div className="mt-3 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleClose}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            Omitir
          </button>
          <button
            type="button"
            onClick={handleNext}
            className="h-7 px-3 text-xs font-semibold rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-xs cursor-pointer"
          >
            {hasMoreSteps ? "Siguiente" : "Listo"}
          </button>
        </div>
      </div>
    </>
  );
}
