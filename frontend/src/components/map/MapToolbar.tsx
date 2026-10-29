"use client";

import React, { useState, useEffect } from "react";
import { useAtalaya } from "@/lib/state";
import type { MapRiskData } from "@/lib/mapRisk";
import type { MapMode } from "@/lib/types";
import { InfoTip } from "@/components/ui/InfoTip";
import { MapGuide, shouldShowGuide } from "./MapGuide";

export interface MapLayerSwitcherProps {
  data?: MapRiskData;
  className?: string;
}

export function MapLayerSwitcher({ className = "" }: MapLayerSwitcherProps) {
  const {
    mapMode = "semaforo",
    setMapMode,
    scenario = "base",
  } = useAtalaya();

  const currentMode: MapMode = mapMode ?? "semaforo";

  return (
    <div
      role="group"
      aria-label="Modo de visualización del mapa"
      data-tour="capas"
      data-map-overlay="layers"
      className={`float-panel flex items-center gap-0.5 p-1 text-xs pointer-events-auto h-auto [@media(orientation:landscape)_and_(max-height:540px)]:h-9 [@media(max-width:380px)]:h-9 ${className}`}
    >
      {/* Modo 1: Semáforo */}
      <button
        type="button"
        role="button"
        aria-label="Semáforo"
        aria-pressed={currentMode === "semaforo"}
        onClick={() => setMapMode("semaforo")}
        title="Semáforo: Riesgo de abstención 2027 por semáforo de 4 niveles"
        className={`flex items-center gap-1.5 px-2.5 py-1.5 [@media(orientation:landscape)_and_(max-height:540px)]:px-2 [@media(orientation:landscape)_and_(max-height:540px)]:py-1 [@media(orientation:landscape)_and_(max-height:540px)]:h-7 [@media(max-width:380px)]:px-2 [@media(max-width:380px)]:py-1 [@media(max-width:380px)]:h-7 rounded-md text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
          currentMode === "semaforo"
            ? "bg-primary text-primary-foreground shadow-xs"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        }`}
      >
        <svg
          className="size-3.5 shrink-0"
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <circle cx="8" cy="3.5" r="2.2" fill="#3f9a5b" />
          <circle cx="8" cy="8" r="2.2" fill="#f2bf3a" />
          <circle cx="8" cy="12.5" r="2.2" fill="#c8352f" />
        </svg>
        <span className="hidden min-[400px]:inline [@media(orientation:landscape)_and_(max-height:540px)]:!hidden [@media(max-width:380px)]:!hidden">Semáforo</span>
      </button>

      {/* Modo 2: Cambio Δ */}
      <button
        type="button"
        role="button"
        aria-label="Cambio Δ"
        aria-pressed={currentMode === "delta"}
        onClick={() => setMapMode("delta")}
        title={
          scenario === "base"
            ? "Cambio Δ: Elige Intervención o Pesimista para ver cambios respecto a la base"
            : "Cambio Δ: Diferencia en puntos porcentuales respecto al escenario base (azul = menos abstención)"
        }
        className={`flex items-center gap-1.5 px-2.5 py-1.5 [@media(orientation:landscape)_and_(max-height:540px)]:px-2 [@media(orientation:landscape)_and_(max-height:540px)]:py-1 [@media(orientation:landscape)_and_(max-height:540px)]:h-7 [@media(max-width:380px)]:px-2 [@media(max-width:380px)]:py-1 [@media(max-width:380px)]:h-7 rounded-md text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
          currentMode === "delta"
            ? "bg-primary text-primary-foreground shadow-xs"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        }`}
      >
        <svg
          className="size-3.5 shrink-0"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 2.5l5.5 10.5H2.5L8 2.5z" />
        </svg>
        <span className="hidden min-[400px]:inline [@media(orientation:landscape)_and_(max-height:540px)]:!hidden [@media(max-width:380px)]:!hidden">Cambio&nbsp;Δ</span>
      </button>

      {/* Modo 3: Comparar */}
      <button
        type="button"
        role="button"
        aria-label="Comparar"
        aria-pressed={currentMode === "compare"}
        onClick={() => setMapMode("compare")}
        title="Comparar: Cortina deslizante entre escenario base y alterno"
        className={`flex items-center gap-1.5 px-2.5 py-1.5 [@media(orientation:landscape)_and_(max-height:540px)]:px-2 [@media(orientation:landscape)_and_(max-height:540px)]:py-1 [@media(orientation:landscape)_and_(max-height:540px)]:h-7 [@media(max-width:380px)]:px-2 [@media(max-width:380px)]:py-1 [@media(max-width:380px)]:h-7 rounded-md text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
          currentMode === "compare"
            ? "bg-primary text-primary-foreground shadow-xs"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        }`}
      >
        <svg
          className="size-3.5 shrink-0"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden="true"
        >
          <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
          <line x1="8" y1="2.5" x2="8" y2="13.5" strokeDasharray="2 1.5" />
        </svg>
        <span className="hidden min-[400px]:inline [@media(orientation:landscape)_and_(max-height:540px)]:!hidden [@media(max-width:380px)]:!hidden">Comparar</span>
      </button>

      <InfoTip
        term="modo.semaforo"
        title="Modos de visualización"
        text="Semáforo: colorea cada zona con su categoría de riesgo en el escenario activo. Cambio Δ: diferencia de abstención entre el escenario alterno y el base en pp (azul = mejora). Comparar: cortina deslizable entre escenario base e intervención."
        side="bottom"
        size="xs"
      />
    </div>
  );
}

export interface MapToolbarProps {
  data?: MapRiskData;
  onExportPng?: () => void;
  className?: string;
}

export function MapToolbar({ onExportPng, className = "" }: MapToolbarProps) {
  const {
    extrude3d = false,
    setExtrude3d,
    view3d = "inclinada",
    setView3d,
  } = useAtalaya();

  const [guideOpen, setGuideOpen] = useState(false);

  // First-visit auto-open with ~900ms delay to ensure tour anchors exist in DOM
  useEffect(() => {
    if (typeof window !== "undefined") {
      if (shouldShowGuide(window.localStorage)) {
        const timer = setTimeout(() => {
          if (shouldShowGuide(window.localStorage)) {
            setGuideOpen(true);
          }
        }, 900);
        return () => clearTimeout(timer);
      }
    }
  }, []);

  // Contract C1: listen to "atalaya:open-guide" event dispatched on window
  useEffect(() => {
    const handleOpen = () => setGuideOpen(true);
    window.addEventListener("atalaya:open-guide", handleOpen);
    return () => window.removeEventListener("atalaya:open-guide", handleOpen);
  }, []);

  const handleToggleGuide = () => {
    setGuideOpen((prev) => {
      const next = !prev;
      if (next && typeof window !== "undefined") {
        try {
          window.dispatchEvent(new CustomEvent("atalaya:guide-open"));
        } catch {}
      }
      return next;
    });
  };

  return (
    <>
      <div
        role="toolbar"
        aria-label="Herramientas del mapa"
        data-tour="herramientas"
        data-map-overlay="toolbar"
        className={`float-panel flex flex-col items-center gap-1 p-1 pointer-events-auto [@media(orientation:landscape)_and_(max-height:540px)]:p-0.5 [@media(max-width:380px)]:p-0.5 ${className}`}
      >
        {/* Toggle 3D */}
        <button
          type="button"
          role="button"
          data-map-overlay="view-toggle"
          aria-pressed={extrude3d}
          onClick={() => setExtrude3d(!extrude3d)}
          title="Vista 3D: bloques con altura = índice de riesgo (con foco al acercarte)"
          aria-label="Vista 3D (altura = riesgo)"
          className={`size-8 [@media(pointer:coarse)]:size-10 [@media(orientation:landscape)_and_(max-height:540px)]:!size-9 [@media(orientation:landscape)_and_(max-height:540px)]:min-w-[36px] [@media(orientation:landscape)_and_(max-height:540px)]:min-h-[36px] grid place-items-center rounded-md text-xs font-medium transition-colors cursor-pointer ${
            extrude3d
              ? "bg-primary text-primary-foreground shadow-xs font-semibold"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          }`}
        >
          <svg
            className="size-4 shrink-0"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 1.5l5.5 3.2v6.6L8 14.5l-5.5-3.2V4.7L8 1.5z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 1.5v13M2.5 4.7l5.5 3.5 5.5-3.5" />
          </svg>
        </button>

        {/* 3D Perspective options when 3D is active */}
        {extrude3d && (
          <div
            role="group"
            aria-label="Perspectiva 3D"
            className="flex flex-col items-center gap-0.5 bg-muted/60 p-0.5 rounded-md border border-border"
          >
            <button
              type="button"
              role="button"
              aria-pressed={view3d === "inclinada"}
              onClick={() => setView3d("inclinada")}
              title="Vista inclinada: perspectiva para apreciar la altura de los bloques"
              aria-label="Vista inclinada"
              className={`size-7 [@media(pointer:coarse)]:size-9 [@media(orientation:landscape)_and_(max-height:540px)]:!size-8 grid place-items-center rounded text-xs transition-colors cursor-pointer ${
                view3d === "inclinada"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              }`}
            >
              <svg
                className="size-3.5 shrink-0"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.5 12l4-2.5h7l-4 2.5h-7z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.5 9.5V3.5l3 1.8v4.2" />
              </svg>
            </button>
            <button
              type="button"
              role="button"
              aria-pressed={view3d === "cenital"}
              onClick={() => setView3d("cenital")}
              title="Vista cenital: vista desde arriba manteniendo los bloques 3D"
              aria-label="Vista cenital"
              className={`size-7 [@media(pointer:coarse)]:size-9 [@media(orientation:landscape)_and_(max-height:540px)]:!size-8 grid place-items-center rounded text-xs transition-colors cursor-pointer ${
                view3d === "cenital"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              }`}
            >
              <svg
                className="size-3.5 shrink-0"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                aria-hidden="true"
              >
                <circle cx="8" cy="8" r="5.5" />
                <circle cx="8" cy="8" r="1.5" fill="currentColor" />
                <path strokeLinecap="round" d="M8 1v2M8 13v2M1 8h2M13 8h2" />
              </svg>
            </button>
          </div>
        )}

        <div className="w-5 h-px bg-border my-0.5" />

        {/* PNG export button */}
        {onExportPng && (
          <button
            type="button"
            role="button"
            onClick={onExportPng}
            title="Exportar imagen PNG del mapa"
            aria-label="Exportar mapa a PNG"
            className="size-8 [@media(pointer:coarse)]:size-10 [@media(orientation:landscape)_and_(max-height:540px)]:!size-9 [@media(orientation:landscape)_and_(max-height:540px)]:min-w-[36px] [@media(orientation:landscape)_and_(max-height:540px)]:min-h-[36px] grid place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer"
          >
            <svg
              className="size-4 shrink-0"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.5 11.5v2h11v-2M8 2.5v7m0 0l-2.5-2.5M8 9.5l2.5-2.5" />
            </svg>
          </button>
        )}

        {/* Guía "?" button */}
        <button
          type="button"
          role="button"
          aria-label="Cómo leer este mapa"
          aria-pressed={guideOpen}
          onClick={handleToggleGuide}
          title="Cómo leer este mapa (recorrido interactivo)"
          className={`size-8 [@media(pointer:coarse)]:size-10 [@media(orientation:landscape)_and_(max-height:540px)]:!size-9 [@media(orientation:landscape)_and_(max-height:540px)]:min-w-[36px] [@media(orientation:landscape)_and_(max-height:540px)]:min-h-[36px] grid place-items-center rounded-md text-xs font-semibold transition-colors cursor-pointer ${
            guideOpen
              ? "bg-primary text-primary-foreground shadow-xs"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          }`}
        >
          <svg
            className="size-4 shrink-0"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM8.94 6.94a.75.75 0 11-1.061-1.061 3 3 0 112.871 5.026v.345a.75.75 0 01-1.5 0v-.5c0-.72.57-1.172 1.081-1.287A1.5 1.5 0 108.94 6.94zM10 15a1 1 0 100-2 1 1 0 000 2z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>

      {/* Recorrido interactivo guiado anclado */}
      <MapGuide open={guideOpen} onClose={() => setGuideOpen(false)} />
    </>
  );
}
