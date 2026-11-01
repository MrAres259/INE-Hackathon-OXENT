"use client";

import React, { useState, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { tourForPath, GUIDE_EVENTS } from "@/lib/tours";
import { MapGuide, shouldShowGuide } from "@/components/map/MapGuide";

function isAnchorVisible(el: HTMLElement): boolean {
  if (!el) return false;
  if (el.style?.display === "none" || el.style?.visibility === "hidden") return false;
  if (typeof window !== "undefined" && typeof window.getComputedStyle === "function") {
    try {
      const cs = window.getComputedStyle(el);
      if (cs && (cs.display === "none" || cs.visibility === "hidden")) return false;
    } catch {}
  }
  if (typeof el.getBoundingClientRect === "function") {
    try {
      const rect = el.getBoundingClientRect();
      if (rect && (rect.width > 0 || rect.height > 0)) {
        return true;
      }
    } catch {}
  }
  if (typeof document !== "undefined" && document.body && document.body.contains(el)) {
    if (el.hidden || el.getAttribute("aria-hidden") === "true") return false;
    return true;
  }
  return false;
}

function hasVisibleAnchorForStep(sel: string | string[]): boolean {
  if (typeof document === "undefined") return false;
  const selectors = Array.isArray(sel) ? sel : [sel];
  for (const s of selectors) {
    try {
      const elements = document.querySelectorAll(`[data-tour="${s}"]`);
      for (let i = 0; i < elements.length; i++) {
        if (isAnchorVisible(elements[i] as HTMLElement)) {
          return true;
        }
      }
    } catch {}
  }
  return false;
}

function hasAppModalOpen(): boolean {
  if (typeof document === "undefined") return false;
  const modals = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
  for (let i = 0; i < modals.length; i++) {
    const m = modals[i];
    if (m.hasAttribute?.("data-guide-balloon") || m.closest?.("[data-guide-balloon]")) {
      continue;
    }
    return true;
  }
  return false;
}

export function GuideHost() {
  const pathname = usePathname();
  const tour = tourForPath(pathname);
  const [open, setOpen] = useState(false);

  // Close guide without marking as viewed on route change
  const prevPathnameRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevPathnameRef.current !== null && prevPathnameRef.current !== pathname) {
      setOpen(false);
    }
    prevPathnameRef.current = pathname;
  }, [pathname]);

  // If no tour for current path, ensure guide is closed
  useEffect(() => {
    if (!tour && open) {
      setOpen(false);
    }
  }, [tour, open]);

  // Listen to GUIDE_EVENTS.open ("atalaya:open-guide")
  useEffect(() => {
    const handleOpen = () => {
      if (tour) {
        setOpen((prev) => (prev ? prev : true));
      }
    };

    window.addEventListener(GUIDE_EVENTS.open, handleOpen);
    return () => {
      window.removeEventListener(GUIDE_EVENTS.open, handleOpen);
    };
  }, [tour]);

  // First-visit auto-open per section
  useEffect(() => {
    if (!tour) return;
    if (typeof window === "undefined") return;

    let isFirst = false;
    try {
      isFirst = (shouldShowGuide as any)(window.localStorage, tour.storageKey);
    } catch {
      isFirst = false;
    }
    if (!isFirst) return;

    const startTime = Date.now();
    let initialTimer: ReturnType<typeof setTimeout> | null = null;
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let maxTimer: ReturnType<typeof setTimeout> | null = null;

    const checkAndOpen = () => {
      if (Date.now() - startTime > 6000) {
        if (pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
        return;
      }

      const firstStep = tour.steps[0];
      const anchorPresent = firstStep ? hasVisibleAnchorForStep(firstStep.sel) : false;
      const modalActive = hasAppModalOpen();

      if (anchorPresent && !modalActive) {
        if (pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
        setOpen(true);
      }
    };

    initialTimer = setTimeout(() => {
      checkAndOpen();
      // If not yet opened, poll every 150ms up to 6000ms
      pollInterval = setInterval(() => {
        checkAndOpen();
      }, 150);
    }, 900);

    maxTimer = setTimeout(() => {
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
    }, 6000);

    return () => {
      if (initialTimer) clearTimeout(initialTimer);
      if (pollInterval) clearInterval(pollInterval);
      if (maxTimer) clearTimeout(maxTimer);
    };
  }, [tour?.id, tour?.storageKey, pathname]);

  if (!tour) {
    return null;
  }

  return (
    <MapGuide
      open={open}
      steps={tour.steps}
      storageKey={tour.storageKey}
      onClose={() => setOpen(false)}
    />
  );
}
