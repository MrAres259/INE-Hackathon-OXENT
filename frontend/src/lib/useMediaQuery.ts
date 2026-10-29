"use client";

import { useEffect, useState } from "react";

export type SheetSnap = "peek" | "half" | "full";

export const SNAP_PEEK_BASE_PX = 132;

export type LayoutMode = "desktop" | "compact-portrait" | "compact-landscape";

export interface LayoutDimensions {
  width: number;
  height: number;
  landscape?: boolean;
}

/**
 * Pure function computing layout mode from dimensions and orientation.
 * - compact-landscape: (orientation: landscape) and (max-height: 540px)
 * - compact-portrait: (max-width: 1023px) and not compact-landscape
 * - desktop: remainder (tablets >= 1024, laptops, PC)
 */
export function layoutModeFor({
  width,
  height,
  landscape,
}: LayoutDimensions): LayoutMode {
  const isLandscape = landscape !== undefined ? landscape : width > height;
  if (isLandscape && height <= 540) {
    return "compact-landscape";
  }
  if (width < 1024) {
    return "compact-portrait";
  }
  return "desktop";
}

/**
 * Returns the target height in pixels for each snap position.
 * - peek: min(132px, 22vh) + safeAreaBottom (compact-portrait)
 * - half: 52% of viewport height
 * - full: viewport height - 12px
 */
export function getSnapHeight(
  snap: SheetSnap,
  viewportHeightPx: number,
  safeAreaBottomPx: number = 0
): number {
  const vh = Math.max(1, viewportHeightPx);
  const peekBase = Math.min(SNAP_PEEK_BASE_PX, Math.round(vh * 0.22));
  switch (snap) {
    case "peek":
      return peekBase + safeAreaBottomPx;
    case "half":
      return Math.round(vh * 0.52);
    case "full":
      return Math.max(peekBase + safeAreaBottomPx, vh - 12);
  }
}

/**
 * Determines which of the 3 sheet snap positions is closest to the given height.
 */
export function nearestSnap(
  heightPx: number,
  viewportHeightPx: number,
  safeAreaBottomPx: number = 0
): SheetSnap {
  const peekH = getSnapHeight("peek", viewportHeightPx, safeAreaBottomPx);
  const halfH = getSnapHeight("half", viewportHeightPx, safeAreaBottomPx);
  const fullH = getSnapHeight("full", viewportHeightPx, safeAreaBottomPx);

  const distPeek = Math.abs(heightPx - peekH);
  const distHalf = Math.abs(heightPx - halfH);
  const distFull = Math.abs(heightPx - fullH);

  if (distPeek <= distHalf && distPeek <= distFull) {
    return "peek";
  }
  if (distHalf <= distFull) {
    return "half";
  }
  return "full";
}

/**
 * Cycles through the snaps on tap: peek -> half -> full -> peek.
 */
export function nextSnap(current: SheetSnap): SheetSnap {
  switch (current) {
    case "peek":
      return "half";
    case "half":
      return "full";
    case "full":
      return "peek";
  }
}

/**
 * Subscribes to window.matchMedia updates. SSR safe: if window or matchMedia
 * is absent, invokes onMatch(false) and returns a no-op cleanup function.
 */
export function subscribeMediaQuery(
  query: string,
  onMatch: (matches: boolean) => void
): () => void {
  if (typeof window === "undefined" || !window.matchMedia) {
    onMatch(false);
    return () => {};
  }
  const mq = window.matchMedia(query);
  onMatch(mq.matches);
  const update = () => onMatch(mq.matches);
  mq.addEventListener("change", update);
  return () => mq.removeEventListener("change", update);
}

/**
 * SSR-safe media query hook (returns false during SSR and initial hydration,
 * then syncs via matchMedia change event).
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(false);

  useEffect(() => {
    return subscribeMediaQuery(query, setMatches);
  }, [query]);

  return matches;
}

/**
 * SSR-safe layout mode hook (initial state: "desktop").
 * Synchronizes with viewport size and orientation on mount and publishes to
 * document.documentElement.dataset.layout.
 */
export function useLayoutMode(): LayoutMode {
  const [mode, setMode] = useState<LayoutMode>("desktop");

  useEffect(() => {
    const computeCurrentMode = (): LayoutMode => {
      if (typeof window === "undefined") return "desktop";
      const isLandscape =
        window.matchMedia?.("(orientation: landscape)")?.matches ??
        (window.innerWidth > window.innerHeight);
      return layoutModeFor({
        width: window.innerWidth,
        height: window.innerHeight,
        landscape: isLandscape,
      });
    };

    const update = () => {
      const next = computeCurrentMode();
      setMode(next);
      if (typeof document !== "undefined" && document.documentElement) {
        document.documentElement.dataset.layout = next;
      }
    };

    update();

    const mqlLandscape = window.matchMedia?.("(orientation: landscape) and (max-height: 540px)");
    const mqlPortrait = window.matchMedia?.("(max-width: 1023px)");
    const mqlOrientation = window.matchMedia?.("(orientation: landscape)");

    mqlLandscape?.addEventListener?.("change", update);
    mqlPortrait?.addEventListener?.("change", update);
    mqlOrientation?.addEventListener?.("change", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);

    return () => {
      mqlLandscape?.removeEventListener?.("change", update);
      mqlPortrait?.removeEventListener?.("change", update);
      mqlOrientation?.removeEventListener?.("change", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return mode;
}

/**
 * Responsive breakpoint hook: matches compact modes (portrait or landscape).
 */
export function useIsCompact(): boolean {
  const mode = useLayoutMode();
  return mode !== "desktop";
}
