"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { RiskMap } from "@/components/map/RiskMap";
import { SidePanelTabs } from "@/components/panel/SidePanelTabs";
import { ScenarioControls } from "@/components/layout/ScenarioControls";
import { useAtalaya } from "@/lib/state";
import {
  useIsCompact,
  nearestSnap,
  nextSnap,
  getSnapHeight,
  type SheetSnap,
} from "@/lib/useMediaQuery";

export default function DashboardPage() {
  const { selectedRegionId, isScenarioModalOpen } = useAtalaya();
  const isCompact = useIsCompact();

  // Desktop panel state
  const [panelWidth, setPanelWidth] = useState<number>(400);
  const [panelOpen, setPanelOpen] = useState<boolean>(true);
  const draggingDesktop = useRef<boolean>(false);

  // Compact bottom sheet state
  const [snap, setSnap] = useState<SheetSnap>("peek");
  const [isDraggingSheet, setIsDraggingSheet] = useState<boolean>(false);
  const [sheetDragHeight, setSheetDragHeight] = useState<number | null>(null);
  const dragStartRef = useRef<{ startY: number; startH: number } | null>(null);

  // Lock document body scroll on dashboard
  useEffect(() => {
    document.body.classList.add("h-dvh", "overflow-hidden");
    return () => {
      document.body.classList.remove("h-dvh", "overflow-hidden");
    };
  }, []);

  // Initialize desktop panel width and open state from localStorage
  useEffect(() => {
    try {
      const savedWidth = localStorage.getItem("atalaya-panel-width");
      if (savedWidth) {
        const parsed = parseInt(savedWidth, 10);
        if (!isNaN(parsed) && parsed >= 320 && parsed <= 640) {
          setPanelWidth(parsed);
        }
      } else {
        if (typeof window !== "undefined" && window.innerWidth >= 1024 && window.innerWidth < 1280) {
          setPanelWidth(360);
        }
      }

      const savedOpen = localStorage.getItem("atalaya-panel-open");
      if (savedOpen !== null) {
        setPanelOpen(savedOpen === "1" || savedOpen === "true");
      }
    } catch {}
  }, []);

  const updatePanelWidth = useCallback((w: number) => {
    setPanelWidth(w);
    try {
      localStorage.setItem("atalaya-panel-width", String(w));
    } catch {}
  }, []);

  const togglePanelOpen = useCallback(() => {
    setPanelOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("atalaya-panel-open", next ? "1" : "0");
      } catch {}
      return next;
    });
  }, []);

  // Desktop resize pointer listeners
  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      if (!draggingDesktop.current) return;
      const newWidth = Math.min(640, Math.max(320, window.innerWidth - e.clientX));
      setPanelWidth(newWidth);
    };

    const onPointerUp = () => {
      if (draggingDesktop.current) {
        draggingDesktop.current = false;
        try {
          localStorage.setItem("atalaya-panel-width", String(panelWidth));
        } catch {}
      }
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [panelWidth]);

  const handleDesktopReset = () => {
    const defaultW = window.innerWidth < 1280 ? 360 : 400;
    updatePanelWidth(defaultW);
  };

  // Compact sheet responsiveness to region selection and scenario modal
  useEffect(() => {
    if (isCompact && selectedRegionId) {
      setSnap((s) => (s === "peek" ? "half" : s));
    }
  }, [selectedRegionId, isCompact]);

  useEffect(() => {
    if (isCompact && isScenarioModalOpen) {
      setSnap("peek");
    }
  }, [isScenarioModalOpen, isCompact]);

  // Bottom sheet drag handlers
  const handleStartDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const currentSnapH = getSnapHeight(snap, window.innerHeight);
    dragStartRef.current = { startY: e.clientY, startH: currentSnapH };
    setIsDraggingSheet(true);
    setSheetDragHeight(currentSnapH);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragStartRef.current) return;
    const deltaY = dragStartRef.current.startY - e.clientY;
    const newH = Math.max(80, Math.min(window.innerHeight - 8, dragStartRef.current.startH + deltaY));
    setSheetDragHeight(newH);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragStartRef.current) return;
    const finalH = sheetDragHeight ?? dragStartRef.current.startH;
    const deltaMove = Math.abs(dragStartRef.current.startY - e.clientY);
    dragStartRef.current = null;
    setIsDraggingSheet(false);
    setSheetDragHeight(null);

    // If tap without significant drag, cycle snap
    if (deltaMove < 6) {
      setSnap((current) => nextSnap(current));
    } else {
      setSnap(nearestSnap(finalH, window.innerHeight));
    }
  };

  // Viewport height tracking for contract C10 (--map-fit-bottom)
  const [viewportHeight, setViewportHeight] = useState<number>(800);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setViewportHeight(window.innerHeight);
      const onResize = () => {
        setViewportHeight(window.innerHeight);
      };
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }
  }, []);

  // Stable callback for panel tab changes (switches peek to half on compact)
  const handlePanelTabChange = useCallback((_tab?: string) => {
    setSnap((current) => (current === "peek" ? "half" : current));
  }, []);

  // Contract C2: --map-inset-bottom reflects peek height on compact, 0px on PC
  const mapInsetBottom = isCompact
    ? "calc(132px + env(safe-area-inset-bottom, 0px))"
    : "0px";

  // Contract C10: --map-fit-bottom reflects half sheet height on compact, 0px on PC
  const mapFitBottom = isCompact
    ? `${Math.round(0.52 * viewportHeight)}px`
    : "0px";

  const sheetHeightStyle =
    isDraggingSheet && sheetDragHeight !== null
      ? `${sheetDragHeight}px`
      : snap === "peek"
      ? "calc(132px + env(safe-area-inset-bottom, 0px))"
      : snap === "half"
      ? "52dvh"
      : "calc(100% - 12px)";

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden">
      {/* Map Section */}
      <section
        className="relative flex min-w-0 flex-1 flex-col overflow-hidden h-full"
        style={
          {
            "--map-inset-bottom": mapInsetBottom,
            "--map-fit-bottom": mapFitBottom,
          } as React.CSSProperties
        }
      >
        <RiskMap />

        {/* Contract C4: ScenarioControls rendered inside the map section */}
        <ScenarioControls />

        {/* Panel collapse/expand floating toggle button (PC only) */}
        <div className="absolute right-3 top-3 z-20 hidden lg:block pointer-events-auto">
          <button
            type="button"
            onClick={togglePanelOpen}
            className="float-panel size-8 grid place-items-center text-muted-foreground hover:text-primary transition-colors cursor-pointer"
            aria-label={panelOpen ? "Ocultar panel" : "Mostrar panel"}
          >
            {panelOpen ? (
              <svg className="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth={2} />
                <path strokeWidth={2} d="M15 3v18" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9l3 3-3 3" />
              </svg>
            ) : (
              <svg className="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth={2} />
                <path strokeWidth={2} d="M15 3v18" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9l-3 3 3 3" />
              </svg>
            )}
          </button>
        </div>
      </section>

      {/* Single instance of Panel / Sheet (preserves state across mobile/desktop transitions) */}
      <aside
        data-tour="panel"
        className={
          isCompact
            ? `absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-t-2xl border-t border-border bg-card shadow-float overflow-hidden ${
                isDraggingSheet ? "" : "transition-[height] duration-300 ease-out"
              }`
            : `relative flex shrink-0 flex-col border-l border-border bg-card h-full ${
                !panelOpen ? "hidden" : ""
              }`
        }
        style={isCompact ? { height: sheetHeightStyle } : { width: panelWidth }}
      >
        {/* Compact Grab Handle */}
        {isCompact && (
          <button
            type="button"
            onPointerDown={handleStartDrag}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className="flex shrink-0 justify-center pb-1 pt-2 w-full touch-none cursor-pointer select-none"
            aria-label="Expandir o contraer panel"
          >
            <span className="h-1.5 w-10 rounded-full bg-border" />
          </button>
        )}

        {/* Desktop Resize handle (left edge, 8px clickable zone, pointer events) */}
        {!isCompact && (
          <div
            onPointerDown={(e) => {
              if (e.button === 0) {
                draggingDesktop.current = true;
              }
            }}
            onDoubleClick={handleDesktopReset}
            className="absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize hover:bg-primary/20 transition-colors"
            title="Arrastra para redimensionar (320-640px), doble clic para restaurar"
          />
        )}

        <SidePanelTabs onTabChange={handlePanelTabChange} />
      </aside>
    </div>
  );
}
