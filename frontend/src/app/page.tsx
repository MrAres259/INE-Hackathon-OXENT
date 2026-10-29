"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { RiskMap } from "@/components/map/RiskMap";
import { SidePanelTabs, useSidePanelTabs } from "@/components/panel/SidePanelTabs";
import { ScenarioControls } from "@/components/layout/ScenarioControls";
import { useAtalaya } from "@/lib/state";
import {
  useLayoutMode,
  nearestSnap,
  nextSnap,
  getSnapHeight,
  type SheetSnap,
} from "@/lib/useMediaQuery";

export default function DashboardPage() {
  const { selectedRegionId, isScenarioModalOpen } = useAtalaya();
  const layoutMode = useLayoutMode();
  const isLandscape = layoutMode === "compact-landscape";
  const isPortrait = layoutMode === "compact-portrait";
  const isDesktop = layoutMode === "desktop";
  const isCompact = layoutMode !== "desktop";

  // Desktop panel state
  const [panelWidth, setPanelWidth] = useState<number>(400);
  const [panelOpen, setPanelOpen] = useState<boolean>(true);
  const draggingDesktop = useRef<boolean>(false);

  // Compact bottom sheet state (portrait)
  const [snap, setSnap] = useState<SheetSnap>("peek");
  const [isDraggingSheet, setIsDraggingSheet] = useState<boolean>(false);
  const [sheetDragHeight, setSheetDragHeight] = useState<number | null>(null);
  const dragStartRef = useRef<{ startY: number; startH: number } | null>(null);

  // Compact landscape drawer state (overlay drawer, closed by default with 40px tab)
  const [landscapeDrawerOpen, setLandscapeDrawerOpen] = useState<boolean>(false);
  const drawerTouchStartRef = useRef<number | null>(null);

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

  // Stable callback for panel tab changes (switches peek to half on compact portrait)
  const handlePanelTabChange = useCallback(
    (_tab?: string) => {
      if (layoutMode === "compact-portrait") {
        setSnap((current) => (current === "peek" ? "half" : current));
      }
    },
    [layoutMode]
  );

  const { activeTab, selectTab } = useSidePanelTabs(selectedRegionId, handlePanelTabChange);

  // Compact sheet responsiveness to region selection and scenario modal (portrait)
  useEffect(() => {
    if (isPortrait && selectedRegionId) {
      setSnap((s) => (s === "peek" ? "half" : s));
    }
  }, [selectedRegionId, isPortrait]);

  useEffect(() => {
    if (isPortrait && isScenarioModalOpen) {
      setSnap("peek");
    }
  }, [isScenarioModalOpen, isPortrait]);

  // When a zone is chosen in compact-landscape: open drawer in Diagnóstico
  useEffect(() => {
    if (isLandscape && selectedRegionId) {
      selectTab("detail");
      setLandscapeDrawerOpen(true);
    }
  }, [selectedRegionId, isLandscape, selectTab]);

  // Bottom sheet drag handlers (portrait)
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

  // Swipe-to-right to close drawer in compact-landscape
  const handleDrawerTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      drawerTouchStartRef.current = e.touches[0].clientX;
    }
  };

  const handleDrawerTouchEnd = (e: React.TouchEvent) => {
    if (drawerTouchStartRef.current !== null && e.changedTouches.length === 1) {
      const deltaX = e.changedTouches[0].clientX - drawerTouchStartRef.current;
      if (deltaX > 40) {
        setLandscapeDrawerOpen(false);
      }
    }
    drawerTouchStartRef.current = null;
  };

  // Map CSS variables per layout mode
  const mapInsetBottom = isLandscape
    ? "0px"
    : isPortrait
    ? "calc(min(132px, 22vh) + env(safe-area-inset-bottom, 0px))"
    : "0px";

  const mapFitBottom = isLandscape
    ? "0px"
    : isPortrait
    ? `${Math.round(0.52 * viewportHeight)}px`
    : "0px";

  const mapInsetRight = isLandscape
    ? landscapeDrawerOpen
      ? "min(380px, 46vw)"
      : "40px"
    : "0px";

  const mapFitRight = mapInsetRight;

  const topbarH = isLandscape ? "48px" : isPortrait ? "116px" : "56px";

  const sheetHeightStyle =
    isDraggingSheet && sheetDragHeight !== null
      ? `${sheetDragHeight}px`
      : snap === "peek"
      ? "calc(min(132px, 22vh) + env(safe-area-inset-bottom, 0px))"
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
            "--map-inset-right": mapInsetRight,
            "--map-fit-right": mapFitRight,
            "--topbar-h": topbarH,
          } as React.CSSProperties
        }
      >
        <RiskMap />

        {/* ScenarioControls rendered inside the map section */}
        <ScenarioControls />

        {/* Panel collapse/expand floating toggle button (PC only) */}
        <div className="absolute right-3 top-3 z-20 hidden lg:block [@media(orientation:landscape)_and_(max-height:540px)]:!hidden pointer-events-auto">
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

      {/* Single instance of Panel / Sheet (preserves state across mobile/desktop/landscape transitions) */}
      <aside
        onTouchStart={isLandscape && landscapeDrawerOpen ? handleDrawerTouchStart : undefined}
        onTouchEnd={isLandscape && landscapeDrawerOpen ? handleDrawerTouchEnd : undefined}
        className={
          isLandscape
            ? "absolute right-0 top-0 bottom-0 z-20 flex flex-col border-l border-border bg-card shadow-float overflow-hidden"
            : isPortrait
            ? `absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-t-2xl border-t border-border bg-card shadow-float overflow-hidden ${
                isDraggingSheet ? "" : "transition-[height] duration-300 ease-out"
              }`
            : `relative flex shrink-0 flex-col border-l border-border bg-card h-full ${
                !panelOpen ? "hidden" : ""
              }`
        }
        style={
          isLandscape
            ? { width: landscapeDrawerOpen ? "min(380px, 46vw)" : "40px" }
            : isPortrait
            ? { height: sheetHeightStyle }
            : { width: panelWidth }
        }
      >
        {/* Compact Portrait Grab Handle */}
        {isPortrait && (
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
        {isDesktop && (
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

        {/* Compact Landscape: 40px vertical strip when closed */}
        {isLandscape && !landscapeDrawerOpen && (
          <div className="flex flex-col items-center py-2 gap-3 w-10 shrink-0 h-full select-none">
            <button
              type="button"
              onClick={() => {
                selectTab("detail");
                setLandscapeDrawerOpen(true);
              }}
              title="Diagnóstico"
              aria-label="Abrir diagnóstico"
              className={`size-8 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
                activeTab === "detail"
                  ? "bg-primary-soft text-primary font-bold"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              <svg className="size-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => {
                selectTab("ranking");
                setLandscapeDrawerOpen(true);
              }}
              title="Ranking"
              aria-label="Abrir ranking"
              className={`size-8 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
                activeTab === "ranking"
                  ? "bg-primary-soft text-primary font-bold"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              <svg className="size-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12"
                />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => {
                selectTab("chat");
                setLandscapeDrawerOpen(true);
              }}
              title="Asistente"
              aria-label="Abrir asistente"
              className={`size-8 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
                activeTab === "chat"
                  ? "bg-primary-soft text-primary font-bold"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              <svg className="size-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
                />
              </svg>
            </button>
          </div>
        )}

        {/* SidePanelTabs is kept mounted across all modes to preserve state and chat */}
        <div
          className={
            isLandscape && !landscapeDrawerOpen
              ? "hidden"
              : "flex flex-col h-full min-h-0 flex-1"
          }
        >
          <SidePanelTabs
            activeTab={activeTab}
            onSelectTab={selectTab}
            onTabChange={handlePanelTabChange}
            headerAction={
              isLandscape ? (
                <button
                  type="button"
                  onClick={() => setLandscapeDrawerOpen(false)}
                  className="size-7 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors cursor-pointer shrink-0 ml-1"
                  aria-label="Cerrar panel"
                  title="Cerrar panel"
                >
                  <svg className="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              ) : undefined
            }
          />
        </div>
      </aside>
    </div>
  );
}
