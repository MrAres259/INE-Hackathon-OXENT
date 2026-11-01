"use client";

import React, { useState, useEffect, useCallback, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { TOURS, TourStep } from "@/lib/tours";

export { type TourStep };
export const TOUR_STEPS: TourStep[] = TOURS.mapa.steps;
export const GUIDE_STORAGE_KEY: string = TOURS.mapa.storageKey;

/**
 * Pure helper to determine if the first-visit guide should be shown.
 * Wrapped in try/catch for safety; returns false if storage is null or throws.
 */
export function shouldShowGuide(
  storage: Pick<Storage, "getItem"> | null | undefined,
  key: string = GUIDE_STORAGE_KEY
): boolean {
  if (!storage) return false;
  try {
    const val = storage.getItem(key);
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
  storage?: Pick<Storage, "setItem"> | null,
  key: string = GUIDE_STORAGE_KEY
): void {
  const target =
    storage !== undefined
      ? storage
      : typeof window !== "undefined"
      ? window.localStorage
      : null;
  if (!target) return;
  try {
    target.setItem(key, "1");
  } catch {
    // ignore quota, security, or private browsing errors
  }
}

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

export interface MapGuideInsets {
  topbarH?: number;
  insetBottom?: number;
  insetRight?: number;
  right?: number;
  bottom?: number;
  top?: number;
  left?: number;
}

/**
 * Pure placement algorithm for the guided tour balloon.
 * Tries bottom, top, left, right (10px gap) taking the first that fits completely
 * without overlapping the anchor, respecting margin, safeTop, and drawer insets.
 * Falls back to horizontal centering in the largest free space, or inside anchor top.
 */
export function placeBalloon(
  anchor: Rect,
  balloon: { w: number; h: number },
  viewport: { w: number; h: number },
  margin = 12,
  safeTop = 0,
  insets?: MapGuideInsets | number
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

  let insetRight = 0;
  let insetBottom = 0;
  if (typeof insets === "number") {
    insetRight = insets;
  } else if (insets && typeof insets === "object") {
    insetRight = insets.insetRight ?? insets.right ?? 0;
    insetBottom = insets.insetBottom ?? insets.bottom ?? 0;
    if (insets.topbarH) safeTop = Math.max(safeTop, insets.topbarH);
    if (insets.top) safeTop = Math.max(safeTop, insets.top);
  }

  const GAP = 10;
  const minY = Math.max(margin, safeTop);
  const maxY = Math.max(minY, vH - margin - insetBottom - bH);
  const minX = margin;
  const maxAvailableX = vW - insetRight;
  const maxX = Math.max(minX, maxAvailableX - margin - bW);

  const overlapsAnchor = (top: number, left: number) => {
    return (
      left < aRight &&
      left + bW > aLeft &&
      top < aBottom &&
      top + bH > aTop
    );
  };

  // 1. Abajo (bottom)
  const bottomTop = Math.max(aBottom + GAP, minY);
  if (bottomTop >= minY && bottomTop + bH <= vH - margin - insetBottom) {
    let bottomLeft = aLeft + (aWidth - bW) / 2;
    bottomLeft = Math.max(minX, Math.min(bottomLeft, maxX));
    if (!overlapsAnchor(bottomTop, bottomLeft)) {
      return { top: bottomTop, left: bottomLeft, side: "bottom" };
    }
  }

  // 2. Arriba (top)
  const topTop = aTop - GAP - bH;
  if (topTop >= minY && topTop + bH <= vH - margin - insetBottom) {
    let topLeft = aLeft + (aWidth - bW) / 2;
    topLeft = Math.max(minX, Math.min(topLeft, maxX));
    if (!overlapsAnchor(topTop, topLeft)) {
      return { top: topTop, left: topLeft, side: "top" };
    }
  }

  // 3. Izquierda (left)
  const leftLeft = aLeft - GAP - bW;
  if (leftLeft >= minX && leftLeft + bW <= maxAvailableX && maxY >= minY) {
    let leftTop = Math.max(minY, Math.min(aTop, maxY));
    if (!overlapsAnchor(leftTop, leftLeft)) {
      return { top: leftTop, left: leftLeft, side: "left" };
    }
  }

  // 4. Derecha (right)
  const rightLeft = aRight + GAP;
  if (rightLeft >= minX && rightLeft + bW <= maxAvailableX - margin && maxY >= minY) {
    let rightTop = Math.max(minY, Math.min(aTop, maxY));
    if (!overlapsAnchor(rightTop, rightLeft)) {
      return { top: rightTop, left: rightLeft, side: "right" };
    }
  }

  // Fallback: horizontal center in usable area
  let fLeft = (maxAvailableX - bW) / 2;
  fLeft = Math.max(minX, Math.min(fLeft, maxX));

  const spaceAbove = Math.max(0, aTop - minY);
  const spaceBelow = Math.max(0, (vH - margin - insetBottom) - aBottom);
  const spaceLeft = Math.max(0, aLeft - minX);
  const spaceRight = Math.max(0, maxAvailableX - margin - aRight);

  if (spaceLeft >= bW && spaceLeft >= spaceRight && spaceLeft >= spaceBelow && spaceLeft >= spaceAbove) {
    const fTop = Math.max(minY, Math.min(maxY, aTop));
    return { top: fTop, left: Math.max(minX, aLeft - GAP - bW), side: "left" };
  }

  if (spaceBelow > spaceAbove && spaceBelow > 0) {
    const fTop = Math.min(maxY, Math.max(minY, aBottom + GAP));
    return { top: fTop, left: fLeft, side: "bottom" };
  }

  if (spaceAbove >= spaceBelow && spaceAbove > 0) {
    const fTop = Math.max(minY, Math.min(maxY, aTop - GAP - bH));
    return { top: fTop, left: fLeft, side: "top" };
  }

  const fTop = Math.min(maxY, Math.max(minY, aTop + GAP));
  return { top: fTop, left: fLeft, side: "inside" };
}

/**
 * Measures CSS variables --topbar-h, --map-inset-bottom, --page-inset-bottom, and --map-inset-right on documentElement.
 * Returns insetBottom = max(--map-inset-bottom, --page-inset-bottom).
 */
export function getMapInsets(doc?: Document): { topbarH: number; insetBottom: number; insetRight: number } {
  const d = doc !== undefined ? doc : typeof document !== "undefined" ? document : null;
  if (!d) return { topbarH: 0, insetBottom: 0, insetRight: 0 };
  let topbarH = 0;
  let insetBottom = 0;
  let insetRight = 0;
  try {
    const root = d.documentElement;
    if (root) {
      let computed: CSSStyleDeclaration | null = null;
      if (typeof window !== "undefined" && typeof window.getComputedStyle === "function") {
        try {
          computed = window.getComputedStyle(root);
        } catch {}
      }
      const readVar = (name: string): number => {
        const val =
          computed?.getPropertyValue?.(name) ||
          (root as any).style?.getPropertyValue?.(name) ||
          "";
        const parsed = parseFloat(val);
        return !Number.isNaN(parsed) && parsed > 0 ? parsed : 0;
      };

      topbarH = readVar("--topbar-h");
      const mapInset = readVar("--map-inset-bottom");
      const pageInset = readVar("--page-inset-bottom");
      insetBottom = Math.max(mapInset, pageInset);
      insetRight = readVar("--map-inset-right");
    }
  } catch {}
  return { topbarH, insetBottom, insetRight };
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
      if (header.hasAttribute?.("data-tour") || (header as any)["data-tour"]) {
        return 0;
      }
      const r = header.getBoundingClientRect();
      if (r && r.bottom > 0) {
        return r.bottom;
      }
    }
  } catch {}
  return 0;
}

/**
 * Determines whether a DOM element is visible (width > 0, height > 0, connected, and not display:none / visibility:hidden).
 */
export function isElementVisible(el: any): boolean {
  if (!el) return false;
  if (el.isConnected === false) return false;
  if (el.style && el.style.display === "none") return false;
  try {
    if (typeof window !== "undefined" && typeof window.getComputedStyle === "function") {
      const style = window.getComputedStyle(el);
      if (style && (style.display === "none" || style.visibility === "hidden")) return false;
    }
  } catch {}
  if (typeof el.getBoundingClientRect === "function") {
    const r = el.getBoundingClientRect();
    if (!r || r.width <= 0 || r.height <= 0) return false;
    return true;
  }
  return false;
}

function isGuideElement(elem: any): boolean {
  if (!elem) return false;
  return Boolean(
    elem.hasAttribute?.("data-guide-backdrop") ||
    elem.hasAttribute?.("data-guide-spotlight") ||
    elem.hasAttribute?.("data-guide-balloon") ||
    elem.closest?.("[data-guide-backdrop], [data-guide-spotlight], [data-guide-balloon]")
  );
}

/**
 * Determines whether the given element is the document-level scrolling element.
 */
export function isDocumentScroller(scroller: any, doc?: Document): boolean {
  if (!scroller) return false;
  const d: any = doc !== undefined ? doc : typeof document !== "undefined" ? document : null;
  if (!d) return false;
  return (
    scroller === d ||
    scroller === d.scrollingElement ||
    scroller === d.documentElement ||
    scroller === d.body ||
    scroller.nodeName === "HTML" ||
    scroller.nodeName === "BODY"
  );
}

let stepFixedLayerCache = new WeakMap<object, boolean>();

export function clearFixedLayerCache(): void {
  stepFixedLayerCache = new WeakMap<object, boolean>();
}

/**
 * Checks whether the element or any ancestor has computed position: fixed or sticky.
 * Uses a WeakMap cache to avoid repeated style recalculations within the step.
 */
export function isInFixedLayer(el: any, cache?: WeakMap<object, boolean>): boolean {
  if (!el || typeof el !== "object") return false;
  const c = cache ?? stepFixedLayerCache;
  if (c) {
    try {
      if (c.has(el)) return c.get(el)!;
    } catch {}
  }

  const visited: any[] = [];
  let curr = el;
  let isFixed = false;

  while (curr && curr.nodeType !== 9 /* DOCUMENT_NODE */) {
    if (typeof document !== "undefined" && (curr === document || curr === document.documentElement)) {
      break;
    }
    if (c) {
      try {
        if (c.has(curr)) {
          isFixed = c.get(curr)!;
          break;
        }
      } catch {}
    }
    visited.push(curr);
    try {
      let pos = "";
      if (typeof window !== "undefined" && typeof window.getComputedStyle === "function") {
        try {
          const style = window.getComputedStyle(curr);
          pos = style?.position || "";
        } catch {}
      }
      if (!pos && curr.style?.position) {
        pos = curr.style.position;
      }
      if (!pos && typeof curr.getAttribute === "function") {
        const cls = curr.getAttribute("class") || "";
        if (/(?:^|\s)(?:fixed|sticky)(?:\s|$)/.test(cls)) {
          pos = cls.includes("fixed") ? "fixed" : "sticky";
        }
      } else if (!pos && typeof curr.className === "string") {
        if (/(?:^|\s)(?:fixed|sticky)(?:\s|$)/.test(curr.className)) {
          pos = curr.className.includes("fixed") ? "fixed" : "sticky";
        }
      }
      if (pos === "fixed" || pos === "sticky") {
        isFixed = true;
        break;
      }
    } catch {}
    curr = curr.parentElement || curr.parentNode;
  }

  if (c) {
    for (const node of visited) {
      try {
        c.set(node, isFixed);
      } catch {}
    }
  }

  return isFixed;
}

/**
 * Finds the closest ancestor element with overflow-y auto/scroll and scrollHeight > clientHeight + 1.
 * If no internal scrollable ancestor exists, returns document.scrollingElement (or documentElement)
 * when the document is scrollable (scrollingElement.scrollHeight > window.innerHeight + 1).
 * Otherwise returns null.
 */
export function getScrollParent(el: any, doc?: Document): any | null {
  if (!el || typeof el !== "object") return null;
  if (isInFixedLayer(el)) return null;
  const d: any =
    doc !== undefined
      ? doc
      : el.ownerDocument || (typeof document !== "undefined" ? document : null);

  let curr = el.parentElement || el.parentNode;
  while (
    curr &&
    curr !== d?.body &&
    curr !== d?.documentElement &&
    (!curr.nodeType || curr.nodeType === 1)
  ) {
    try {
      let overflowY = "";
      if (typeof window !== "undefined" && typeof window.getComputedStyle === "function") {
        const style = window.getComputedStyle(curr);
        overflowY = style?.overflowY || "";
      }
      if (!overflowY && curr.style?.overflowY) {
        overflowY = curr.style.overflowY;
      }
      const scrollHeight = curr.scrollHeight ?? 0;
      const clientHeight = curr.clientHeight ?? 0;
      if (
        (overflowY === "auto" || overflowY === "scroll") &&
        scrollHeight > clientHeight + 1
      ) {
        return curr;
      }
    } catch {}
    curr = curr.parentElement || curr.parentNode;
  }

  if (d) {
    const scroller = d.scrollingElement || d.documentElement;
    if (scroller) {
      const vH =
        typeof window !== "undefined"
          ? (window.innerHeight ?? 768)
          : 768;
      const scrollHeight = scroller.scrollHeight ?? 0;
      if (scrollHeight > vH + 1) {
        return scroller;
      }
    }
  }

  return null;
}

export interface UsefulBand {
  top: number;
  bottom: number;
  height: number;
}

/**
 * Computes the useful visible vertical band (banda útil):
 * top = max(getSafeTop(), --topbar-h) + 8
 * bottom = vh - insetBottom - 8 (insetBottom = max(--map-inset-bottom, --page-inset-bottom))
 * If the container is an internal scrollable element, intersects with its getBoundingClientRect().
 * For the document, the band is only the window's band.
 */
export function getUsefulBand(scrollerOrEl?: any, doc?: Document): UsefulBand {
  const d = doc !== undefined ? doc : typeof document !== "undefined" ? document : null;
  const vH = typeof window !== "undefined" ? (window.visualViewport?.height ?? window.innerHeight ?? 768) : 768;

  // Anchors living inside a fixed or sticky layer use the full screen viewport
  if (scrollerOrEl && isInFixedLayer(scrollerOrEl)) {
    return {
      top: 0,
      bottom: vH,
      height: vH,
    };
  }

  const insets = getMapInsets(d ?? undefined);
  const safeTop = Math.max(getSafeTop(d ?? undefined), insets.topbarH);

  let bandTop = safeTop + 8;
  let bandBottom = vH - insets.insetBottom - 8;

  let scroller = scrollerOrEl;
  if (scroller && !isDocumentScroller(scroller, d ?? undefined)) {
    const scrollHeight = scroller.scrollHeight ?? 0;
    const clientHeight = scroller.clientHeight ?? 0;
    const isScrollable = scrollHeight > clientHeight + 1;
    if (!isScrollable) {
      scroller = getScrollParent(scroller, d ?? undefined);
    }
  }

  if (scroller && !isDocumentScroller(scroller, d ?? undefined)) {
    try {
      if (typeof scroller.getBoundingClientRect === "function") {
        const r = scroller.getBoundingClientRect();
        if (r) {
          const sTop = r.top;
          const sBottom = r.bottom !== undefined ? r.bottom : r.top + r.height;
          bandTop = Math.max(bandTop, sTop);
          bandBottom = Math.min(bandBottom, sBottom);
        }
      }
    } catch {}
  }

  return {
    top: bandTop,
    bottom: bandBottom,
    height: Math.max(0, bandBottom - bandTop),
  };
}

/**
 * Checks whether the anchor is not occluded using elementsFromPoint within the useful band.
 * The first non-guide element must be the anchor, a descendant, or an ancestor.
 * If the visible center falls under the top bar or bottom inset, returns false.
 * If elementsFromPoint is not supported (e.g. standard jsdom), returns true.
 */
export function isAnchorNotOccluded(el: any, doc?: Document): boolean {
  if (!el || typeof el.getBoundingClientRect !== "function") return false;
  const d = doc !== undefined ? doc : typeof document !== "undefined" ? document : null;
  const r = el.getBoundingClientRect();
  if (!r || r.width <= 0 || r.height <= 0) return false;

  const vW = typeof window !== "undefined" ? (window.visualViewport?.width ?? window.innerWidth ?? 1024) : 1024;
  const vH = typeof window !== "undefined" ? (window.visualViewport?.height ?? window.innerHeight ?? 768) : 768;

  const rRight = r.right !== undefined ? r.right : r.left + r.width;
  const rBottom = r.bottom !== undefined ? r.bottom : r.top + r.height;

  // Visible part in viewport
  const visLeft = Math.max(0, Math.min(vW, r.left));
  const visRight = Math.max(0, Math.min(vW, rRight));
  const visTop = Math.max(0, Math.min(vH, r.top));
  const visBottom = Math.max(0, Math.min(vH, rBottom));

  if (visRight <= visLeft || visBottom <= visTop) {
    return false;
  }

  const band = getUsefulBand(el, d ?? undefined);
  const cx = (visLeft + visRight) / 2;
  const cy = (visTop + visBottom) / 2;

  // If the center of the visible part falls under the top bar or bottom inset, it is occluded
  if (cy < band.top || cy > band.bottom) {
    return false;
  }

  if (!d || typeof d.elementsFromPoint !== "function") {
    return true;
  }

  const elements = d.elementsFromPoint(cx, cy);
  if (!elements || elements.length === 0) return true;

  for (const elem of elements) {
    if (isGuideElement(elem)) {
      continue;
    }
    // First non-guide element must be anchor itself, descendant, or ancestor
    return el === elem || el.contains?.(elem) || elem.contains?.(el);
  }
  return true;
}

/**
 * Determines if an anchor is usable: visible and (unoccluded or reachable via scroll).
 * - not visible => false
 * - has getScrollParent (internal or document) => true (reachable via scroll)
 * - without getScrollParent => isAnchorNotOccluded in useful band
 */
export function isAnchorUsable(el: any, doc?: Document): boolean {
  if (!isElementVisible(el)) return false;
  const d = doc !== undefined ? doc : typeof document !== "undefined" ? document : null;
  const sp = getScrollParent(el, d ?? undefined);
  if (sp) {
    return true;
  }
  return isAnchorNotOccluded(el, d ?? undefined);
}

/**
 * Determines if an anchor element does not fit completely within the safe useful screen area.
 */
export function isAnchorOutOfUsefulScreen(el: any, doc?: Document): boolean {
  if (!el || typeof el.getBoundingClientRect !== "function") return false;
  const d = doc !== undefined ? doc : typeof document !== "undefined" ? document : null;
  const r = el.getBoundingClientRect();
  const band = getUsefulBand(el, d ?? undefined);
  const rBottom = r.bottom !== undefined ? r.bottom : r.top + r.height;

  return r.top < band.top || rBottom > band.bottom;
}

/**
 * Scrolls the anchor element into view respecting header and footer bars.
 * Uses manual displacement via scroller.scrollBy / window.scrollBy:
 * - If anchor + balloon (+10) fit in the useful band: centers anchor in band (delta = centroAncla - centroBanda)
 * - If they do not fit: aligns top of anchor with band.top (delta = ancla.top - banda.top)
 * - If already complete in useful band and balloon fits above or below in the band: does not scroll
 * Clamps delta to the container's possible scroll range.
 * Respects prefers-reduced-motion ("auto" vs "smooth").
 * Falls back to scrollIntoView only if scrollBy does not exist.
 */
export function scrollAnchorIntoViewIfNeeded(
  el: any,
  doc?: Document,
  balloonHeight = 160
): boolean {
  if (!el || typeof el.getBoundingClientRect !== "function") {
    return false;
  }
  if (isInFixedLayer(el)) {
    return false;
  }
  const d = doc !== undefined ? doc : typeof document !== "undefined" ? document : null;
  const r = el.getBoundingClientRect();
  if (!r) return false;

  const sp = getScrollParent(el, d ?? undefined);
  const isDoc = isDocumentScroller(sp, d ?? undefined);
  const band = getUsefulBand(sp, d ?? undefined);

  const aTop = r.top;
  const aBottom = r.bottom !== undefined ? r.bottom : r.top + r.height;
  const aHeight = r.height !== undefined ? r.height : aBottom - aTop;
  const centroAncla = (aTop + aBottom) / 2;
  const centroBanda = (band.top + band.bottom) / 2;

  const GAP = 10;
  const isCompleteInBand = aTop >= band.top && aBottom <= band.bottom;
  const balloonFitsBelow = aBottom + GAP + balloonHeight <= band.bottom;
  const balloonFitsAbove = aTop - GAP - balloonHeight >= band.top;
  const balloonFits = balloonFitsBelow || balloonFitsAbove;
  const isUnoccluded = isAnchorNotOccluded(el, d ?? undefined);

  // If already complete in useful band, balloon fits above or below in the band, and unoccluded: do not scroll
  if (isCompleteInBand && balloonFits && isUnoccluded) {
    return false;
  }

  const fitsWithBalloon = (aHeight + balloonHeight + GAP) <= band.height;
  let delta = fitsWithBalloon ? (centroAncla - centroBanda) : (aTop - band.top);

  // Limit delta to the container's possible scroll range
  if (isDoc && sp) {
    const currentScroll =
      typeof window !== "undefined"
        ? (window.scrollY ?? window.pageYOffset ?? sp.scrollTop ?? 0)
        : (sp.scrollTop ?? 0);
    const scrollHeight = sp.scrollHeight ?? 0;
    const clientH =
      typeof window !== "undefined"
        ? (window.innerHeight ?? 768)
        : 768;
    const maxScroll = Math.max(0, scrollHeight - clientH);
    if (scrollHeight > clientH) {
      const targetScroll = Math.max(0, Math.min(maxScroll, currentScroll + delta));
      delta = targetScroll - currentScroll;
    }
  } else if (sp && !isDoc) {
    const currentScroll = sp.scrollTop ?? 0;
    const scrollHeight = sp.scrollHeight ?? 0;
    const clientH = sp.clientHeight ?? 0;
    const maxScroll = Math.max(0, scrollHeight - clientH);
    if (scrollHeight > clientH) {
      const targetScroll = Math.max(0, Math.min(maxScroll, currentScroll + delta));
      delta = targetScroll - currentScroll;
    }
  }

  const prefersReducedMotion =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const behavior: ScrollBehavior = prefersReducedMotion ? "auto" : "smooth";

  // If delta is negligible and element is already in band / unoccluded, nothing to do
  if (Math.abs(delta) < 0.5 && isCompleteInBand && isUnoccluded) {
    return false;
  }

  // Document scroller: call window.scrollBy
  if (isDoc) {
    if (typeof window !== "undefined" && typeof window.scrollBy === "function") {
      window.scrollBy({ top: delta, behavior });
      return true;
    }
  }

  // Internal scroller: call scroller.scrollBy
  if (sp && !isDoc) {
    if (typeof sp.scrollBy === "function") {
      sp.scrollBy({ top: delta, behavior });
      return true;
    }
  }

  // Fallback to scrollIntoView if scrollBy does not exist
  if (typeof el.scrollIntoView === "function") {
    const block: ScrollLogicalPosition = fitsWithBalloon ? "center" : "start";
    try {
      el.scrollIntoView({ block, inline: "nearest", behavior });
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Clips a rectangle to the screen viewport bounds (0..vw x 0..vh).
 */
export function clipRectToScreen(
  rect: DOMRect | Rect,
  viewport: { w: number; h: number }
): Rect {
  const left = Math.max(0, Math.min(viewport.w, rect.left));
  const right = Math.max(0, Math.min(viewport.w, (rect as any).right !== undefined ? (rect as any).right : rect.left + rect.width));
  const top = Math.max(0, Math.min(viewport.h, rect.top));
  const bottom = Math.max(0, Math.min(viewport.h, (rect as any).bottom !== undefined ? (rect as any).bottom : rect.top + rect.height));
  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

/**
 * Finds the first usable anchor element for the tour step selector(s).
 * Tests each selector value in order.
 */
export function findVisibleAnchor(
  sel: string | string[],
  doc?: any
): { el: any; rect: DOMRect } | null {
  const documentRef =
    doc !== undefined
      ? doc
      : typeof document !== "undefined"
      ? document
      : null;
  if (!documentRef) return null;

  const selectors = Array.isArray(sel) ? sel : [sel];

  for (const s of selectors) {
    const selector = `[data-tour="${s}"]`;

    if (typeof documentRef.querySelectorAll === "function") {
      try {
        const nodes = Array.from(documentRef.querySelectorAll(selector) || []);
        for (const node of nodes) {
          if (isAnchorUsable(node, documentRef)) {
            return { el: node, rect: (node as any).getBoundingClientRect() };
          }
        }
      } catch {}
    }

    if (typeof documentRef.querySelector === "function") {
      try {
        const el = documentRef.querySelector(selector);
        if (isAnchorUsable(el, documentRef)) {
          return { el, rect: el.getBoundingClientRect() };
        }
      } catch {}
    }
  }

  return null;
}

/**
 * Returns list of usable step indices for stable counter calculation.
 */
export function getUsableStepIndices(steps: TourStep[], doc?: any): number[] {
  const documentRef =
    doc !== undefined
      ? doc
      : typeof document !== "undefined"
      ? document
      : null;
  if (!documentRef || !steps || steps.length === 0) return [];
  const indices: number[] = [];
  for (let idx = 0; idx < steps.length; idx++) {
    if (findVisibleAnchor(steps[idx].sel, documentRef) !== null) {
      indices.push(idx);
    }
  }
  return indices;
}

/**
 * Helper to find the next valid step anchor element with positive dimensions and visibility.
 * Skips missing, zero-dimension, occluded, or display:none anchors.
 */
export function getValidStepAndRect(
  fromIndex = 0,
  doc?: any,
  steps: TourStep[] = TOUR_STEPS
): { index: number; rect: DOMRect; el: any } | null {
  const documentRef =
    doc !== undefined
      ? doc
      : typeof document !== "undefined"
      ? document
      : null;
  if (!documentRef || !steps || steps.length === 0) return null;

  for (let idx = Math.max(0, fromIndex); idx < steps.length; idx++) {
    const match = findVisibleAnchor(steps[idx].sel, documentRef);
    if (match) {
      return { index: idx, rect: match.rect, el: match.el };
    }
  }
  return null;
}

/**
 * Helper to find the previous valid step anchor searching backwards from fromIndex.
 */
export function getValidStepBackwards(
  fromIndex: number,
  doc?: any,
  steps: TourStep[] = TOUR_STEPS
): { index: number; rect: DOMRect; el: any } | null {
  const documentRef =
    doc !== undefined
      ? doc
      : typeof document !== "undefined"
      ? document
      : null;
  if (!documentRef || !steps || steps.length === 0) return null;

  for (let idx = Math.min(fromIndex, steps.length - 1); idx >= 0; idx--) {
    const match = findVisibleAnchor(steps[idx].sel, documentRef);
    if (match) {
      return { index: idx, rect: match.rect, el: match.el };
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
 * Intercepts mouse, touch, wheel, pointer, and contextmenu events outside the balloon.
 * Returns true if the event was blocked, false if allowed (target is inside balloon).
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
 * Traps Tab/Shift+Tab focus within balloon, ArrowRight = Siguiente, ArrowLeft = Anterior,
 * Escape = Omitir/Close, and blocks any other key outside the balloon.
 */
export function handleGuideKeyDown(
  e: {
    key: string;
    target?: any;
    shiftKey?: boolean;
    preventDefault: () => void;
    stopPropagation?: () => void;
    stopImmediatePropagation?: () => void;
  },
  balloonEl: any,
  onClose: () => void,
  activeElement?: any,
  onNext?: () => void,
  onPrev?: () => void
): boolean {
  const isInsideBalloon =
    balloonEl &&
    (balloonEl === e.target || (typeof balloonEl.contains === "function" && balloonEl.contains(e.target)));

  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation?.();
    e.stopImmediatePropagation?.();
    onClose();
    return true;
  }

  if (e.key === "ArrowRight") {
    e.preventDefault();
    e.stopPropagation?.();
    e.stopImmediatePropagation?.();
    onNext?.();
    return true;
  }

  if (e.key === "ArrowLeft") {
    e.preventDefault();
    e.stopPropagation?.();
    e.stopImmediatePropagation?.();
    onPrev?.();
    return true;
  }

  if (e.key === "Tab" && balloonEl) {
    const focusable =
      typeof balloonEl.querySelectorAll === "function"
        ? Array.from(
            balloonEl.querySelectorAll(
              'button:not([disabled]), [tabindex]:not([tabindex="-1"]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
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
        e.stopPropagation?.();
        e.stopImmediatePropagation?.();
        (last as any)?.focus?.();
        return true;
      }
    } else {
      if (
        current === last ||
        (typeof balloonEl.contains === "function" && !balloonEl.contains(current))
      ) {
        e.preventDefault();
        e.stopPropagation?.();
        e.stopImmediatePropagation?.();
        (first as any)?.focus?.();
        return true;
      }
    }
    return true;
  }

  if (!isInsideBalloon) {
    e.preventDefault();
    e.stopPropagation?.();
    e.stopImmediatePropagation?.();
    return true;
  }

  return false;
}

export interface AnchorTrackingState {
  currentEl: any;
  prevRect: DOMRect | Rect | null;
  disappearedTimer: any;
  currentStepIndex: number;
}

/**
 * Pure helper for live anchor measurement and 400ms disappearance tolerance.
 */
export function updateAnchorTracking(
  state: AnchorTrackingState,
  options: {
    sel: string | string[];
    doc: any;
    steps?: TourStep[];
    isScrolling?: boolean;
    onUpdateRect: (rect: DOMRect) => void;
    onAdvanceStep: (nextIndex: number, nextRect: DOMRect, nextEl: any) => void;
    onClose: () => void;
  }
): void {
  const currentSel = options.sel;
  let targetEl = state.currentEl;

  if (options.isScrolling) {
    if (state.disappearedTimer) {
      clearTimeout(state.disappearedTimer);
      state.disappearedTimer = null;
    }
    if (targetEl && targetEl.isConnected !== false && isElementVisible(targetEl)) {
      const newRect = targetEl.getBoundingClientRect();
      const prev = state.prevRect;
      const changed =
        !prev ||
        Math.abs(newRect.top - prev.top) > 0.5 ||
        Math.abs(newRect.left - prev.left) > 0.5 ||
        Math.abs(newRect.width - prev.width) > 0.5 ||
        Math.abs(newRect.height - prev.height) > 0.5;

      if (changed) {
        state.prevRect = newRect;
        options.onUpdateRect(newRect);
      }
    }
    return;
  }

  if (
    !targetEl ||
    targetEl.isConnected === false ||
    !isElementVisible(targetEl) ||
    !isAnchorNotOccluded(targetEl, options.doc)
  ) {
    const found = findVisibleAnchor(currentSel, options.doc);
    if (found) {
      targetEl = found.el;
      state.currentEl = found.el;
    } else {
      targetEl = null;
      state.currentEl = null;
    }
  }

  if (!targetEl) {
    if (!state.disappearedTimer) {
      state.disappearedTimer = setTimeout(() => {
        state.disappearedTimer = null;
        const stillFound = findVisibleAnchor(currentSel, options.doc);
        if (!stillFound) {
          const nextMatch = getValidStepAndRect(
            state.currentStepIndex + 1,
            options.doc,
            options.steps ?? TOUR_STEPS
          );
          if (nextMatch) {
            state.currentStepIndex = nextMatch.index;
            state.currentEl = nextMatch.el;
            state.prevRect = nextMatch.rect;
            options.onAdvanceStep(nextMatch.index, nextMatch.rect, nextMatch.el);
          } else {
            options.onClose();
          }
        }
      }, 400);
    }
  } else {
    if (state.disappearedTimer) {
      clearTimeout(state.disappearedTimer);
      state.disappearedTimer = null;
    }

    const newRect = targetEl.getBoundingClientRect();
    const prev = state.prevRect;
    const changed =
      !prev ||
      Math.abs(newRect.top - prev.top) > 0.5 ||
      Math.abs(newRect.left - prev.left) > 0.5 ||
      Math.abs(newRect.width - prev.width) > 0.5 ||
      Math.abs(newRect.height - prev.height) > 0.5;

    if (changed) {
      state.prevRect = newRect;
      options.onUpdateRect(newRect);
    }
  }
}

export interface MapGuideProps {
  open?: boolean;
  onClose?: () => void;
  className?: string;
  portal?: boolean;
  steps?: TourStep[];
  storageKey?: string;
  initialStep?: number;
}

// Safe useLayoutEffect fallback for SSR
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function MapGuide({
  open,
  onClose,
  className = "",
  portal = true,
  steps: stepsProp,
  storageKey: storageKeyProp,
  initialStep = 0,
}: MapGuideProps) {
  const steps = stepsProp ?? TOUR_STEPS;
  const storageKey = storageKeyProp ?? GUIDE_STORAGE_KEY;

  const isControlled = open !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const effectiveOpen = isControlled ? Boolean(open) : internalOpen;

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // Sync body dataset during render as well for SSR/testing
  syncGuideBodyAttr(effectiveOpen);

  const [i, setI] = useState(initialStep);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [balloonHeight, setBalloonHeight] = useState<number>(160);
  const [usableIndices, setUsableIndices] = useState<number[]>(() =>
    getUsableStepIndices(steps, typeof document !== "undefined" ? document : null)
  );

  const directionRef = useRef<1 | -1>(1);
  const scrollingRef = useRef(false);
  const scrollCleanupRef = useRef<(() => void) | null>(null);

  const balloonRef = useRef<HTMLDivElement | null>(null);
  const nextButtonRef = useRef<HTMLButtonElement | null>(null);
  const currentAnchorElRef = useRef<any>(null);
  const prevRectRef = useRef<DOMRect | null>(null);
  const scrolledStepRef = useRef<number | null>(null);
  const trackingStateRef = useRef<AnchorTrackingState>({
    currentEl: null,
    prevRect: null,
    disappearedTimer: null,
    currentStepIndex: initialStep,
  });

  const hasDispatchedOpenRef = useRef(false);
  const hasDispatchedCloseRef = useRef(false);

  const emitOpen = useCallback(() => {
    if (typeof window !== "undefined" && !hasDispatchedOpenRef.current) {
      hasDispatchedOpenRef.current = true;
      hasDispatchedCloseRef.current = false;
      try {
        window.dispatchEvent(new CustomEvent("atalaya:guide-open"));
      } catch {}
    }
  }, []);

  const emitClose = useCallback(() => {
    if (typeof window !== "undefined" && !hasDispatchedCloseRef.current && hasDispatchedOpenRef.current) {
      hasDispatchedCloseRef.current = true;
      hasDispatchedOpenRef.current = false;
      try {
        window.dispatchEvent(new CustomEvent("atalaya:guide-close"));
      } catch {}
    }
  }, []);

  const handleClose = useCallback(() => {
    clearFixedLayerCache();
    if (typeof window !== "undefined") {
      dismissGuide(window.localStorage, storageKey);
    }
    emitClose();
    syncGuideBodyAttr(false);
    setRect(null);
    currentAnchorElRef.current = null;
    prevRectRef.current = null;
    scrolledStepRef.current = null;
    if (scrollCleanupRef.current) {
      scrollCleanupRef.current();
      scrollCleanupRef.current = null;
    }
    scrollingRef.current = false;
    if (trackingStateRef.current.disappearedTimer) {
      clearTimeout(trackingStateRef.current.disappearedTimer);
      trackingStateRef.current.disappearedTimer = null;
    }
    if (!isControlled) {
      setInternalOpen(false);
    }
    onClose?.();
  }, [isControlled, onClose, storageKey, emitClose]);

  // Reset to step 0 or initialStep when steps change with guide open
  const prevStepsRef = useRef(steps);
  useEffect(() => {
    if (prevStepsRef.current !== steps) {
      clearFixedLayerCache();
      prevStepsRef.current = steps;
      if (effectiveOpen) {
        setI(initialStep);
        trackingStateRef.current.currentStepIndex = initialStep;
        scrolledStepRef.current = null;
      }
    }
  }, [steps, effectiveOpen, initialStep]);

  // Clear fixed layer cache on step index change
  useEffect(() => {
    clearFixedLayerCache();
  }, [i]);

  // Sync body dataset and emit open/close events
  useEffect(() => {
    syncGuideBodyAttr(effectiveOpen);
    if (effectiveOpen) {
      emitOpen();
    } else {
      emitClose();
    }
  }, [effectiveOpen, emitOpen, emitClose]);

  // Update usable indices on open, step change, or steps change
  useEffect(() => {
    if (effectiveOpen) {
      const doc = typeof document !== "undefined" ? document : null;
      setUsableIndices(getUsableStepIndices(steps, doc));
    }
  }, [effectiveOpen, i, steps]);

  // Emit close on unmount if guide was open
  useEffect(() => {
    return () => {
      clearFixedLayerCache();
      emitClose();
      syncGuideBodyAttr(false);
      if (scrollCleanupRef.current) {
        scrollCleanupRef.current();
        scrollCleanupRef.current = null;
      }
      scrollingRef.current = false;
    };
  }, [emitClose]);

  // Total event blocking outside balloon
  useEffect(() => {
    if (!effectiveOpen) return;

    const handlePointerCapture = (e: Event) => {
      handleGuidePointerCapture(e as any, balloonRef.current);
    };

    const events = [
      "pointerdown",
      "mousedown",
      "click",
      "touchstart",
      "contextmenu",
      "dblclick",
      "auxclick",
      "gesturestart",
    ];

    events.forEach((ev) => window.addEventListener(ev, handlePointerCapture, true));
    window.addEventListener("wheel", handlePointerCapture, { capture: true, passive: false });
    window.addEventListener("touchmove", handlePointerCapture, { capture: true, passive: false });

    return () => {
      events.forEach((ev) => window.removeEventListener(ev, handlePointerCapture, true));
      window.removeEventListener("wheel", handlePointerCapture, true);
      window.removeEventListener("touchmove", handlePointerCapture, true);
    };
  }, [effectiveOpen]);

  // First-visit auto-open with ~900ms delay if uncontrolled
  useEffect(() => {
    if (isControlled) return;
    if (typeof window !== "undefined" && shouldShowGuide(window.localStorage, storageKey)) {
      const timer = setTimeout(() => {
        if (shouldShowGuide(window.localStorage, storageKey)) {
          setInternalOpen(true);
          setI(initialStep);
          trackingStateRef.current.currentStepIndex = initialStep;
        }
      }, 900);
      return () => clearTimeout(timer);
    }
  }, [isControlled, storageKey, initialStep]);

  // Uncontrolled mode listens to atalaya:open-guide; controlled does NOT
  useEffect(() => {
    if (isControlled) return;
    const handleOpenEvent = () => {
      directionRef.current = 1;
      setI(initialStep);
      trackingStateRef.current.currentStepIndex = initialStep;
      setInternalOpen(true);
    };
    window.addEventListener("atalaya:open-guide", handleOpenEvent);
    return () => window.removeEventListener("atalaya:open-guide", handleOpenEvent);
  }, [isControlled, initialStep]);

  // Reset index when opened
  useEffect(() => {
    if (effectiveOpen) {
      setI(initialStep);
      trackingStateRef.current.currentStepIndex = initialStep;
    } else {
      setRect(null);
      currentAnchorElRef.current = null;
      prevRectRef.current = null;
      scrolledStepRef.current = null;
      if (scrollCleanupRef.current) {
        scrollCleanupRef.current();
        scrollCleanupRef.current = null;
      }
      scrollingRef.current = false;
    }
  }, [effectiveOpen, initialStep]);

  const advanceInDirection = useCallback(
    (fromIdx: number) => {
      const doc = typeof document !== "undefined" ? document : null;
      if (directionRef.current >= 0) {
        const next = getValidStepAndRect(fromIdx + 1, doc, steps);
        if (next) {
          directionRef.current = 1;
          setI(next.index);
          trackingStateRef.current.currentStepIndex = next.index;
          setRect(next.rect);
          currentAnchorElRef.current = next.el;
          prevRectRef.current = next.rect;
        } else {
          handleClose();
        }
      } else {
        const prev = getValidStepBackwards(fromIdx - 1, doc, steps);
        if (prev) {
          directionRef.current = -1;
          setI(prev.index);
          trackingStateRef.current.currentStepIndex = prev.index;
          setRect(prev.rect);
          currentAnchorElRef.current = prev.el;
          prevRectRef.current = prev.rect;
        } else {
          handleClose();
        }
      }
    },
    [steps, handleClose]
  );

  // Position spotlight on current anchor and scroll if needed
  useIsomorphicLayoutEffect(() => {
    if (!effectiveOpen) {
      scrolledStepRef.current = null;
      if (scrollCleanupRef.current) {
        scrollCleanupRef.current();
        scrollCleanupRef.current = null;
      }
      scrollingRef.current = false;
      return;
    }
    const doc = typeof document !== "undefined" ? document : null;
    const match =
      directionRef.current >= 0
        ? getValidStepAndRect(i, doc, steps)
        : getValidStepBackwards(i, doc, steps);
    if (!match) {
      handleClose();
      return;
    }
    if (match.index !== i) {
      setI(match.index);
      trackingStateRef.current.currentStepIndex = match.index;
    }
    currentAnchorElRef.current = match.el;
    prevRectRef.current = match.rect;
    trackingStateRef.current.currentEl = match.el;
    trackingStateRef.current.prevRect = match.rect;
    setRect(match.rect);

    if (scrolledStepRef.current !== match.index) {
      scrolledStepRef.current = match.index;
      if (scrollCleanupRef.current) {
        scrollCleanupRef.current();
        scrollCleanupRef.current = null;
      }
      const didScroll = scrollAnchorIntoViewIfNeeded(
        match.el,
        doc ?? undefined,
        balloonHeight
      );
      if (didScroll) {
        scrollingRef.current = true;
        const sp = getScrollParent(match.el, doc ?? undefined);
        const isDoc = isDocumentScroller(sp, doc ?? undefined);
        let finished = false;
        let debounceTimer: any = null;
        let maxTimer: any = null;

        const cleanup = () => {
          if (debounceTimer) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
          }
          if (maxTimer) {
            clearTimeout(maxTimer);
            maxTimer = null;
          }
          if (sp && !isDoc && typeof sp.removeEventListener === "function") {
            sp.removeEventListener("scrollend", handleScrollEnd);
            sp.removeEventListener("scroll", handleScroll);
          }
          if (typeof window !== "undefined") {
            window.removeEventListener("scrollend", handleScrollEnd);
            window.removeEventListener("scroll", handleScroll, true);
          }
          scrollCleanupRef.current = null;
        };

        const onDone = () => {
          if (finished) return;
          finished = true;
          cleanup();
          scrollingRef.current = false;

          const el = currentAnchorElRef.current || match.el;
          if (!el || el.isConnected === false) {
            advanceInDirection(match.index);
            return;
          }
          const newRect = el.getBoundingClientRect();
          prevRectRef.current = newRect;
          setRect(newRect);

          const clear = isAnchorNotOccluded(el, doc ?? undefined);
          if (!clear) {
            advanceInDirection(match.index);
          }
        };

        const handleScrollEnd = () => {
          onDone();
        };

        const handleScroll = () => {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(onDone, 120);
        };

        if (sp && !isDoc && typeof sp.addEventListener === "function") {
          sp.addEventListener("scrollend", handleScrollEnd, { once: true });
          sp.addEventListener("scroll", handleScroll, { passive: true });
        }
        if (typeof window !== "undefined") {
          window.addEventListener("scrollend", handleScrollEnd, { once: true });
          window.addEventListener("scroll", handleScroll, { capture: true, passive: true });
        }
        debounceTimer = setTimeout(onDone, 120);
        maxTimer = setTimeout(onDone, 1200);
        scrollCleanupRef.current = cleanup;
      } else {
        scrollingRef.current = false;
      }
    }
  }, [effectiveOpen, i, steps, balloonHeight, handleClose, advanceInDirection]);

  // ResizeObserver on balloon to update its real height
  useEffect(() => {
    if (!effectiveOpen || !balloonRef.current) return;
    if (typeof ResizeObserver === "undefined") return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const h = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect?.height ?? 0;
        if (h > 0 && Math.abs(h - balloonHeight) > 1) {
          setBalloonHeight(h);
        }
      }
    });

    ro.observe(balloonRef.current);
    return () => {
      ro.disconnect();
    };
  }, [effectiveOpen, balloonHeight]);

  // Event listeners for window resize, orientationchange, scroll, and visualViewport
  useEffect(() => {
    if (!effectiveOpen) return;

    const handleReposition = () => {
      if (balloonRef.current) {
        const bRect = balloonRef.current.getBoundingClientRect();
        if (bRect && bRect.height > 0 && Math.abs(bRect.height - balloonHeight) > 1) {
          setBalloonHeight(bRect.height);
        }
      }

      if (scrollingRef.current) {
        if (currentAnchorElRef.current) {
          const r = currentAnchorElRef.current.getBoundingClientRect();
          prevRectRef.current = r;
          setRect(r);
        }
        return;
      }

      const currentSel = steps[i]?.sel;
      if (currentSel) {
        const match = findVisibleAnchor(currentSel, document);
        if (match) {
          currentAnchorElRef.current = match.el;
          prevRectRef.current = match.rect;
          setRect(match.rect);
          return;
        }
      }

      const nextMatch = getValidStepAndRect(i + 1, document, steps);
      if (nextMatch) {
        setI(nextMatch.index);
        trackingStateRef.current.currentStepIndex = nextMatch.index;
        currentAnchorElRef.current = nextMatch.el;
        prevRectRef.current = nextMatch.rect;
        setRect(nextMatch.rect);
      } else {
        handleClose();
      }
    };

    window.addEventListener("resize", handleReposition, { passive: true });
    window.addEventListener("orientationchange", handleReposition, { passive: true });
    window.addEventListener("scroll", handleReposition, { capture: true, passive: true });
    window.visualViewport?.addEventListener("resize", handleReposition, { passive: true });
    window.visualViewport?.addEventListener("scroll", handleReposition, { passive: true });

    return () => {
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("orientationchange", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
      window.visualViewport?.removeEventListener("resize", handleReposition);
      window.visualViewport?.removeEventListener("scroll", handleReposition);
    };
  }, [effectiveOpen, i, steps, balloonHeight, handleClose]);

  // Live tracking RAF loop with 400ms disappearance tolerance
  useEffect(() => {
    if (!effectiveOpen) return;

    let rafId: number | null = null;

    const tick = () => {
      const currentSel = steps[i]?.sel;
      if (currentSel) {
        trackingStateRef.current.currentStepIndex = i;
        updateAnchorTracking(trackingStateRef.current, {
          sel: currentSel,
          doc: document,
          steps,
          isScrolling: scrollingRef.current,
          onUpdateRect: (newRect) => {
            prevRectRef.current = newRect;
            setRect(newRect);
          },
          onAdvanceStep: (nextIdx, nextRect, nextEl) => {
            directionRef.current = 1;
            setI(nextIdx);
            setRect(nextRect);
            currentAnchorElRef.current = nextEl;
            prevRectRef.current = nextRect;
          },
          onClose: handleClose,
        });
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      if (trackingStateRef.current.disappearedTimer) {
        clearTimeout(trackingStateRef.current.disappearedTimer);
        trackingStateRef.current.disappearedTimer = null;
      }
    };
  }, [effectiveOpen, i, steps, handleClose]);

  const handleNext = useCallback(() => {
    directionRef.current = 1;
    const nextMatch = getValidStepAndRect(i + 1, typeof document !== "undefined" ? document : null, steps);
    if (nextMatch) {
      setI(nextMatch.index);
      trackingStateRef.current.currentStepIndex = nextMatch.index;
      setRect(nextMatch.rect);
      currentAnchorElRef.current = nextMatch.el;
      prevRectRef.current = nextMatch.rect;
    } else {
      handleClose();
    }
  }, [i, steps, handleClose]);

  const handlePrev = useCallback(() => {
    directionRef.current = -1;
    const prevMatch = getValidStepBackwards(i - 1, typeof document !== "undefined" ? document : null, steps);
    if (prevMatch) {
      setI(prevMatch.index);
      trackingStateRef.current.currentStepIndex = prevMatch.index;
      setRect(prevMatch.rect);
      currentAnchorElRef.current = prevMatch.el;
      prevRectRef.current = prevMatch.rect;
    }
  }, [i, steps]);

  // Keyboard navigation
  useEffect(() => {
    if (!effectiveOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      handleGuideKeyDown(e, balloonRef.current, handleClose, undefined, handleNext, handlePrev);
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [effectiveOpen, handleClose, handleNext, handlePrev]);

  // Initial focus on Siguiente / Terminar button
  useEffect(() => {
    if (!effectiveOpen) return;
    const timer = setTimeout(() => {
      nextButtonRef.current?.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, [effectiveOpen, i]);

  const doc = typeof document !== "undefined" ? document : null;
  const activeMatch = rect
    ? { index: i, rect }
    : effectiveOpen
    ? getValidStepAndRect(i, doc, steps)
    : null;

  if (!effectiveOpen || !activeMatch) {
    return null;
  }

  const currentStep = steps[activeMatch.index];
  if (!currentStep) return null;
  const currentRect = activeMatch.rect;

  const vw = typeof window !== "undefined"
    ? (window.visualViewport?.width ?? window.innerWidth)
    : 1024;
  const vh = typeof window !== "undefined"
    ? (window.visualViewport?.height ?? window.innerHeight)
    : 768;
  const insets = getMapInsets(doc ?? undefined);
  const margin = 12;
  const isLandscape = vh <= 540 && vw > vh;
  const w = isLandscape
    ? Math.min(320, Math.max(200, Math.floor(vw * 0.6)))
    : Math.min(320, Math.max(200, vw - margin * 2));
  const safeTop = Math.max(getSafeTop(doc ?? undefined), insets.topbarH);

  // Clipped anchor rectangle against screen bounds (0..vw x 0..vh)
  const clippedRect = clipRectToScreen(currentRect, { w: vw, h: vh });

  const placement = placeBalloon(
    clippedRect,
    { w, h: balloonHeight },
    { w: vw, h: vh },
    margin,
    safeTop,
    insets
  );

  // Spotlight ring surrounding targeted anchor clipped to viewport
  const ringPad = 4;
  const ringLeft = Math.max(0, clippedRect.left - ringPad);
  const ringTop = Math.max(0, clippedRect.top - ringPad);
  const ringRight = Math.min(vw, (clippedRect.right !== undefined ? clippedRect.right : (clippedRect.left + clippedRect.width)) + ringPad);
  const ringBottom = Math.min(vh, (clippedRect.bottom !== undefined ? clippedRect.bottom : (clippedRect.top + clippedRect.height)) + ringPad);
  const ringWidth = Math.max(0, ringRight - ringLeft);
  const ringHeight = Math.max(0, ringBottom - ringTop);

  // Honest counter: stable usable steps calculation
  const activeUsableIndices =
    usableIndices.length > 0 && usableIndices.includes(activeMatch.index)
      ? usableIndices
      : getUsableStepIndices(steps, doc);

  const totalUsable = Math.max(1, activeUsableIndices.length);
  const currentPos = activeUsableIndices.indexOf(activeMatch.index);
  const currentUsableNumber = currentPos !== -1 ? currentPos + 1 : 1;
  const isLastUsable =
    activeUsableIndices.length > 0 &&
    activeUsableIndices[activeUsableIndices.length - 1] === activeMatch.index;
  const hasMoreSteps =
    !isLastUsable && getValidStepAndRect(activeMatch.index + 1, doc, steps) !== null;

  const guideElements = (
    <>
      {/* Dimmed backdrop capturing all events with cutout over targeted anchor (z-index: 1000) */}
      <div
        data-guide-backdrop="true"
        className="fixed inset-0 z-[1000] pointer-events-auto select-none transition-opacity duration-300 ease-out motion-reduce:transition-none"
        style={{ position: "fixed", inset: 0, zIndex: 1000 }}
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
          className="absolute transition-all duration-300 ease-out motion-reduce:transition-none"
          style={{ position: "absolute", left: 0, top: 0, width: "100%", height: ringTop, backgroundColor: "rgba(26,16,25,0.55)" }}
        />
        {/* Bottom backdrop */}
        <div
          className="absolute transition-all duration-300 ease-out motion-reduce:transition-none"
          style={{ position: "absolute", left: 0, top: ringBottom, width: "100%", bottom: 0, backgroundColor: "rgba(26,16,25,0.55)" }}
        />
        {/* Left backdrop */}
        <div
          className="absolute transition-all duration-300 ease-out motion-reduce:transition-none"
          style={{ position: "absolute", left: 0, top: ringTop, width: ringLeft, height: ringHeight, backgroundColor: "rgba(26,16,25,0.55)" }}
        />
        {/* Right backdrop */}
        <div
          className="absolute transition-all duration-300 ease-out motion-reduce:transition-none"
          style={{ position: "absolute", left: ringRight, top: ringTop, right: 0, height: ringHeight, backgroundColor: "rgba(26,16,25,0.55)" }}
        />
        {/* Transparent blocker over highlighted control */}
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

      {/* Spotlight ring surrounding targeted anchor (z-index: 1001) */}
      <div
        data-guide-spotlight="true"
        className="pointer-events-none fixed z-[1001] rounded-lg ring-2 ring-primary ring-offset-2 ring-offset-background transition-all motion-reduce:transition-none"
        style={{
          position: "fixed",
          zIndex: 1001,
          left: ringLeft,
          top: ringTop,
          width: ringWidth,
          height: ringHeight,
          pointerEvents: "none",
          boxShadow: "0 0 0 2px var(--color-background, #ffffff), 0 0 0 4px var(--color-primary, #b5186b)",
        }}
      />

      {/* Floating accessible modal guided tour balloon (z-index: 1001) */}
      <div
        ref={balloonRef}
        role="dialog"
        aria-modal="true"
        data-guide-balloon="true"
        aria-labelledby="guide-balloon-title"
        aria-describedby="guide-balloon-desc"
        className={`fixed z-[1001] float-panel p-3.5 shadow-float text-foreground max-w-[min(320px,calc(100vw-24px))] max-h-[calc(100dvh-var(--topbar-h,0px)-24px)] overflow-y-auto ${className}`}
        style={{
          position: "fixed",
          zIndex: 1001,
          left: placement.left,
          top: placement.top,
          width: w,
          paddingBottom: "max(14px, env(safe-area-inset-bottom, 14px))",
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <h3 id="guide-balloon-title" className="font-display text-sm font-bold text-foreground truncate">
            {currentStep.title}
          </h3>
          <span className="text-[10px] text-muted-foreground font-mono shrink-0">
            {currentUsableNumber}/{totalUsable}
          </span>
        </div>

        <p id="guide-balloon-desc" className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {currentStep.text}
        </p>

        <div className="mt-3 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleClose}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer min-h-[36px] [@media(pointer:coarse)]:min-h-[36px] [@media(pointer:coarse)]:py-2 flex items-center"
          >
            Omitir
          </button>
          <div className="flex items-center gap-1.5">
            {currentUsableNumber > 1 && (
              <button
                type="button"
                onClick={handlePrev}
                className="h-7 px-2.5 text-xs font-medium rounded-md border border-border text-foreground hover:bg-accent transition-colors cursor-pointer min-h-[36px] [@media(pointer:coarse)]:min-h-[36px] [@media(pointer:coarse)]:px-3 flex items-center"
              >
                Anterior
              </button>
            )}
            <button
              ref={nextButtonRef}
              type="button"
              onClick={handleNext}
              className="h-7 px-3 text-xs font-semibold rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-xs cursor-pointer min-h-[36px] [@media(pointer:coarse)]:min-h-[36px] [@media(pointer:coarse)]:px-3.5 flex items-center"
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
