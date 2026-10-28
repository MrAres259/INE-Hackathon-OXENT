"use client";

import React, { useState, useEffect, useCallback, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

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

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
  bottom?: number;
  right?: number;
}

export interface Size {
  w: number;
  h: number;
}

export type BalloonSide = "bottom" | "top" | "left" | "right" | "inside";

export interface BalloonPlacement {
  top: number;
  left: number;
  side: BalloonSide;
}

/**
 * Pure placement algorithm for the guided tour balloon.
 * Tries bottom, top, left, right (10px gap) taking the first that fits completely
 * without overlapping the anchor, respecting margin and safeTop.
 * Falls back to horizontal centering in the largest free space, or inside anchor top.
 */
export function placeBalloon(
  anchor: Rect,
  balloon: { w: number; h: number },
  viewport: { w: number; h: number },
  margin = 12,
  safeTop = 0
): BalloonPlacement {
  const aTop = anchor.top;
  const aLeft = anchor.left;
  const aWidth = anchor.width;
  const aHeight = anchor.height;
  const aBottom = anchor.bottom !== undefined ? anchor.bottom : aTop + aHeight;
  const aRight = anchor.right !== undefined ? anchor.right : aLeft + aWidth;

  const bW = balloon.w;
  const bH = balloon.h;
  const vW = viewport.w;
  const vH = viewport.h;

  const GAP = 10;
  const minY = Math.max(margin, safeTop);
  const maxY = Math.max(minY, vH - margin - bH);
  const minX = margin;
  const maxX = Math.max(minX, vW - margin - bW);

  // 1. Abajo (bottom)
  const bottomTop = aBottom + GAP;
  if (bottomTop >= minY && bottomTop + bH <= vH - margin) {
    let bottomLeft = aLeft + (aWidth - bW) / 2;
    bottomLeft = Math.max(minX, Math.min(bottomLeft, maxX));
    return { top: bottomTop, left: bottomLeft, side: "bottom" };
  }

  // 2. Arriba (top)
  const topTop = aTop - GAP - bH;
  if (topTop >= minY && topTop + bH <= vH - margin) {
    let topLeft = aLeft + (aWidth - bW) / 2;
    topLeft = Math.max(minX, Math.min(topLeft, maxX));
    return { top: topTop, left: topLeft, side: "top" };
  }

  // 3. Izquierda (left)
  const leftLeft = aLeft - GAP - bW;
  if (leftLeft >= minX && leftLeft <= maxX && maxY >= minY) {
    let leftTop = Math.max(minY, Math.min(aTop, maxY));
    return { top: leftTop, left: leftLeft, side: "left" };
  }

  // 4. Derecha (right)
  const rightLeft = aRight + GAP;
  if (rightLeft >= minX && rightLeft <= maxX && maxY >= minY) {
    let rightTop = Math.max(minY, Math.min(aTop, maxY));
    return { top: rightTop, left: rightLeft, side: "right" };
  }

  // Fallback: horizontal center, largest free space outside anchor, or inside anchor top edge
  let fLeft = (vW - bW) / 2;
  fLeft = Math.max(minX, Math.min(fLeft, maxX));

  const spaceAbove = Math.max(0, aTop - minY);
  const spaceBelow = Math.max(0, (vH - margin) - aBottom);

  if (spaceBelow > spaceAbove && spaceBelow > 0) {
    const fTop = Math.min(maxY, Math.max(minY, aBottom + GAP));
    return { top: fTop, left: fLeft, side: "bottom" };
  }

  if (spaceAbove >= spaceBelow && spaceAbove > 0) {
    const fTop = Math.max(minY, Math.min(maxY, aTop - GAP - bH));
    return { top: fTop, left: fLeft, side: "top" };
  }

  // Inside anchor pinned to its top edge under safeTop
  const fTop = Math.min(maxY, Math.max(minY, aTop + GAP));
  return { top: fTop, left: fLeft, side: "inside" };
}

/**
 * Measures bottom of <header> element in DOM for safeTop offset.
 */
export function getSafeTop(doc?: Document): number {
  const d = doc !== undefined ? doc : typeof document !== "undefined" ? document : null;
  if (!d) return 0;
  try {
    const header = d.querySelector("header");
    if (header && typeof header.getBoundingClientRect === "function") {
      const r = header.getBoundingClientRect();
      if (r && r.bottom > 0) {
        return r.bottom;
      }
    }
  } catch {}
  return 0;
}

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

/**
 * Helper to find the previous valid step anchor searching backwards from fromIndex.
 */
export function getValidStepBackwards(
  fromIndex: number,
  doc?: any
): { index: number; rect: DOMRect } | null {
  const documentRef =
    doc !== undefined
      ? doc
      : typeof document !== "undefined"
      ? document
      : null;
  if (!documentRef) return null;

  for (let idx = fromIndex; idx >= 0; idx--) {
    const match = findVisibleAnchor(TOUR_STEPS[idx].sel, documentRef);
    if (match) {
      return { index: idx, rect: match.rect };
    }
  }
  return null;
}

/**
 * Synchronizes document.body.dataset.guide="open" and removes it when closed.
 */
export function syncGuideBodyAttr(open: boolean, doc?: any): void {
  const d = doc !== undefined ? doc : typeof document !== "undefined" ? document : null;
  if (!d?.body) return;
  if (!d.body.dataset) d.body.dataset = {};
  if (open) {
    d.body.dataset.guide = "open";
  } else {
    delete d.body.dataset.guide;
  }
}

/**
 * Intercepts pointerdown, mousedown, click, wheel, touchstart events when the guide is open.
 * Returns true if the event was blocked (prevented), false if allowed (target is inside balloon).
 */
export function handleGuidePointerCapture(
  e: {
    target: any;
    preventDefault: () => void;
    stopPropagation: () => void;
    stopImmediatePropagation?: () => void;
  },
  balloonEl?: any
): boolean {
  if (balloonEl && typeof balloonEl.contains === "function" && balloonEl.contains(e.target)) {
    return false;
  }
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation?.();
  return true;
}

/**
 * Handles keyboard navigation inside the accessible guide dialog.
 * Traps Tab/Shift+Tab focus within balloon and closes on Escape.
 */
export function handleGuideKeyDown(
  e: {
    key: string;
    shiftKey?: boolean;
    preventDefault: () => void;
  },
  balloonEl: any,
  onClose: () => void,
  activeElement?: any
): boolean {
  if (e.key === "Escape") {
    e.preventDefault();
    onClose();
    return true;
  }
  if (e.key === "Tab" && balloonEl) {
    const focusable =
      typeof balloonEl.querySelectorAll === "function"
        ? Array.from(
            balloonEl.querySelectorAll(
              'button:not([disabled]), [tabindex]:not([tabindex="-1"])'
            )
          )
        : [];
    if (focusable.length === 0) return false;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const current =
      activeElement !== undefined
        ? activeElement
        : typeof document !== "undefined"
        ? document.activeElement
        : null;

    if (e.shiftKey) {
      if (
        current === first ||
        (typeof balloonEl.contains === "function" && !balloonEl.contains(current))
      ) {
        e.preventDefault();
        (last as any)?.focus?.();
        return true;
      }
    } else {
      if (
        current === last ||
        (typeof balloonEl.contains === "function" && !balloonEl.contains(current))
      ) {
        e.preventDefault();
        (first as any)?.focus?.();
        return true;
      }
    }
  }
  return false;
}

export interface MapGuideProps {
  open?: boolean;
  onClose?: () => void;
  className?: string;
  portal?: boolean;
}

// Safe useLayoutEffect fallback for SSR
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function MapGuide({
  open,
  onClose,
  className = "",
  portal = true,
}: MapGuideProps) {
  const isControlled = open !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const effectiveOpen = isControlled ? Boolean(open) : internalOpen;

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // Sync body dataset during render as well for SSR/testing
  syncGuideBodyAttr(effectiveOpen);

  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [balloonHeight, setBalloonHeight] = useState<number>(160);
  const [, setRerenderTick] = useState(0);

  const balloonRef = useRef<HTMLDivElement | null>(null);
  const nextButtonRef = useRef<HTMLButtonElement | null>(null);

  const handleClose = useCallback(() => {
    if (typeof window !== "undefined") {
      dismissGuide(window.localStorage);
    }
    syncGuideBodyAttr(false);
    setRect(null);
    if (!isControlled) {
      setInternalOpen(false);
    }
    onClose?.();
  }, [isControlled, onClose]);

  // Set document.body.dataset.guide = "open" and block scroll while guide is open
  useEffect(() => {
    syncGuideBodyAttr(effectiveOpen);
    return () => {
      syncGuideBodyAttr(false);
    };
  }, [effectiveOpen]);

  // Capture all pointer/mouse/touch/wheel events to prevent any interaction with page beneath
  useEffect(() => {
    if (!effectiveOpen) return;

    const handlePointerCapture = (e: Event) => {
      handleGuidePointerCapture(e as any, balloonRef.current);
    };

    window.addEventListener("pointerdown", handlePointerCapture, true);
    window.addEventListener("mousedown", handlePointerCapture, true);
    window.addEventListener("click", handlePointerCapture, true);
    window.addEventListener("touchstart", handlePointerCapture, true);
    window.addEventListener("wheel", handlePointerCapture, { capture: true, passive: false });

    return () => {
      window.removeEventListener("pointerdown", handlePointerCapture, true);
      window.removeEventListener("mousedown", handlePointerCapture, true);
      window.removeEventListener("click", handlePointerCapture, true);
      window.removeEventListener("touchstart", handlePointerCapture, true);
      window.removeEventListener("wheel", handlePointerCapture, true);
    };
  }, [effectiveOpen]);

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

  // Measure real balloon height on step change or open
  useIsomorphicLayoutEffect(() => {
    if (!effectiveOpen || !balloonRef.current) return;
    const bRect = balloonRef.current.getBoundingClientRect();
    if (bRect && bRect.height > 0 && Math.abs(bRect.height - balloonHeight) > 1) {
      setBalloonHeight(bRect.height);
    }
  }, [effectiveOpen, i, balloonHeight]);

  // Reposition on window resize and scroll
  useEffect(() => {
    if (!effectiveOpen) return;

    const handleReposition = () => {
      if (balloonRef.current) {
        const bRect = balloonRef.current.getBoundingClientRect();
        if (bRect && bRect.height > 0 && Math.abs(bRect.height - balloonHeight) > 1) {
          setBalloonHeight(bRect.height);
        }
      }
      setRerenderTick((t) => t + 1);

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
  }, [effectiveOpen, i, balloonHeight, handleClose]);

  // Accessible keyboard navigation: Escape = Omitir; Tab = trap focus inside balloon
  useEffect(() => {
    if (!effectiveOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      handleGuideKeyDown(e, balloonRef.current, handleClose);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [effectiveOpen, handleClose]);

  // Initial focus on Siguiente / Terminar button
  useEffect(() => {
    if (!effectiveOpen) return;
    const timer = setTimeout(() => {
      nextButtonRef.current?.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, [effectiveOpen, i]);

  const handleNext = () => {
    const nextMatch = getValidStepAndRect(i + 1);
    if (nextMatch) {
      setI(nextMatch.index);
      setRect(nextMatch.rect);
    } else {
      handleClose();
    }
  };

  const handlePrev = () => {
    const prevMatch = getValidStepBackwards(i - 1);
    if (prevMatch) {
      setI(prevMatch.index);
      setRect(prevMatch.rect);
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
  const safeTop = getSafeTop();

  const placement = placeBalloon(
    currentRect,
    { w, h: balloonHeight },
    { w: vw, h: vh },
    margin,
    safeTop
  );

  // Spotlight ring surrounding targeted anchor without arbitrary height cap
  const ringPad = 4;
  const ringLeft = Math.max(0, currentRect.left - ringPad);
  const ringTop = Math.max(0, currentRect.top - ringPad);
  const ringRight = Math.min(vw, (currentRect.right ?? (currentRect.left + currentRect.width)) + ringPad);
  const ringBottom = Math.min(vh, (currentRect.bottom ?? (currentRect.top + currentRect.height)) + ringPad);
  const ringWidth = Math.max(0, ringRight - ringLeft);
  const ringHeight = Math.max(0, ringBottom - ringTop);

  const hasMoreSteps = getValidStepAndRect(activeMatch.index + 1) !== null;

  const guideElements = (
    <>
      {/* Dimmed backdrop capturing all events with cutout over targeted anchor */}
      <div
        data-guide-backdrop="true"
        className="fixed inset-0 z-[65] pointer-events-auto select-none"
        style={{ position: "fixed", inset: 0, zIndex: 65 }}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        {/* Top backdrop */}
        <div
          className="absolute bg-[rgba(26,16,25,0.55)]"
          style={{ position: "absolute", left: 0, top: 0, width: "100%", height: ringTop }}
        />
        {/* Bottom backdrop */}
        <div
          className="absolute bg-[rgba(26,16,25,0.55)]"
          style={{ position: "absolute", left: 0, top: ringBottom, width: "100%", bottom: 0 }}
        />
        {/* Left backdrop */}
        <div
          className="absolute bg-[rgba(26,16,25,0.55)]"
          style={{ position: "absolute", left: 0, top: ringTop, width: ringLeft, height: ringHeight }}
        />
        {/* Right backdrop */}
        <div
          className="absolute bg-[rgba(26,16,25,0.55)]"
          style={{ position: "absolute", left: ringRight, top: ringTop, right: 0, height: ringHeight }}
        />
        {/* Transparent blocker over highlighted control: visible but non-interactive */}
        <div
          className="absolute"
          style={{
            position: "absolute",
            left: ringLeft,
            top: ringTop,
            width: ringWidth,
            height: ringHeight,
            cursor: "default",
          }}
        />
      </div>

      {/* Spotlight ring surrounding targeted anchor */}
      <div
        data-guide-spotlight="true"
        className="pointer-events-none fixed z-[70] rounded-lg ring-2 ring-primary ring-offset-2 ring-offset-background transition-all"
        style={{
          position: "fixed",
          zIndex: 70,
          left: ringLeft,
          top: ringTop,
          width: ringWidth,
          height: ringHeight,
          pointerEvents: "none",
          boxShadow: "0 0 0 2px var(--color-background, #ffffff), 0 0 0 4px var(--color-primary, #b5186b)",
        }}
      />

      {/* Floating accessible modal guided tour balloon */}
      <div
        ref={balloonRef}
        role="dialog"
        aria-modal="true"
        aria-label="Guía interactiva del mapa"
        className={`fixed z-[70] float-panel p-3.5 shadow-float text-foreground ${className}`}
        style={{
          position: "fixed",
          zIndex: 70,
          left: placement.left,
          top: placement.top,
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
          <div className="flex items-center gap-1.5">
            {activeMatch.index > 0 && (
              <button
                type="button"
                onClick={handlePrev}
                className="h-7 px-2.5 text-xs font-medium rounded-md border border-border text-foreground hover:bg-accent transition-colors cursor-pointer"
              >
                Anterior
              </button>
            )}
            <button
              ref={nextButtonRef}
              type="button"
              onClick={handleNext}
              className="h-7 px-3 text-xs font-semibold rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-xs cursor-pointer"
            >
              {hasMoreSteps ? "Siguiente" : "Terminar"}
            </button>
          </div>
        </div>
      </div>
    </>
  );

  const isClient = typeof window !== "undefined" && typeof document !== "undefined";
  const shouldPortal = portal && (mounted || process.env.NODE_ENV === "test");

  if (shouldPortal && isClient && document?.body) {
    return createPortal(guideElements, document.body);
  }

  return guideElements;
}
