"use client";

import { useEffect, useState } from "react";

export type SheetSnap = "peek" | "half" | "full";

export const SNAP_PEEK_BASE_PX = 132;

/**
 * Returns the target height in pixels for each snap position.
 * - peek: 132px + safeAreaBottom
 * - half: 52% of viewport height
 * - full: viewport height - 12px
 */
export function getSnapHeight(
  snap: SheetSnap,
  viewportHeightPx: number,
  safeAreaBottomPx: number = 0
): number {
  const vh = Math.max(1, viewportHeightPx);
  switch (snap) {
    case "peek":
      return SNAP_PEEK_BASE_PX + safeAreaBottomPx;
    case "half":
      return Math.round(vh * 0.52);
    case "full":
      return Math.max(SNAP_PEEK_BASE_PX + safeAreaBottomPx, vh - 12);
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
 * Responsive breakpoint hook: matches screen width < 1024px.
 */
export function useIsCompact(): boolean {
  return useMediaQuery("(max-width: 1023px)");
}
