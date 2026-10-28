"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAtalaya } from "@/lib/state";
import type { ScenarioId } from "@/lib/types";
import { BrandLockup } from "@/components/brand/BrandMark";
import { RegionSearch } from "@/components/map/RegionSearch";
import { InfoTip } from "@/components/ui/InfoTip";

const SCENARIOS: { id: ScenarioId; label: string }[] = [
  { id: "base", label: "Base" },
  { id: "intervencion", label: "Intervención" },
  { id: "pesimista", label: "Pesimista" },
];

const SECTIONS = [
  {
    id: "mapa",
    label: "Mapa de riesgo",
    shortLabel: "Mapa",
    href: "/",
    icon: (
      <svg className="size-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
        />
      </svg>
    ),
    infoTerm: null,
  },
  {
    id: "campanas",
    label: "Plan de campaña",
    shortLabel: "Campañas",
    href: "/campanas",
    icon: (
      <svg className="size-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z"
        />
      </svg>
    ),
    infoTerm: "plan_campana" as const,
  },
  {
    id: "monitor",
    label: "Monitor INE",
    shortLabel: "Monitor",
    href: "/monitor",
    icon: (
      <svg className="size-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M13 10V3L4 14h7v7l9-11h-7z"
        />
      </svg>
    ),
    infoTerm: "monitor_ine" as const,
  },
];

export function TopBar() {
  const {
    scenario,
    setScenario,
    isMock,
    meta,
    setIsScenarioModalOpen,
    apiAvailable,
    hasData,
    isScenarioModified,
    resetScenarioParams,
    paramsByScenario,
  } = useAtalaya();

  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  // Determine active section route
  let rawPath: string | null = null;
  try {
    rawPath = usePathname();
  } catch {
    rawPath = "/";
  }
  const pathname = rawPath || "/";
  const isHome = pathname === "/";

  const campaignsCount =
    scenario === "intervencion" && Array.isArray(paramsByScenario.intervencion?.campaigns)
      ? paramsByScenario.intervencion.campaigns.length
      : 1;

  const handleOpenGuide = () => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("atalaya:open-guide"));
    }
  };

  const isDemo = isMock || !apiAvailable;
  const storeLabel = isDemo
    ? "Demostración"
    : meta?.store === "opensearch"
    ? "OpenSearch"
    : "Memoria";

  return (
    <header className="shrink-0 bg-card border-b border-border pt-[env(safe-area-inset-top,0px)] sticky top-0 z-30 select-none">
      {/* PC single-row layout (>= 1024px) */}
      <div className="hidden lg:flex h-14 items-center justify-between px-4 gap-3">
        {/* Brand Lockup & Section Navigation Tabs */}
        <div className="flex items-center gap-4">
          <BrandLockup />

          {/* Section Tabs */}
          <nav
            className="flex items-center gap-1 rounded-lg bg-muted p-0.5 border border-border"
            aria-label="Secciones principales"
          >
            {SECTIONS.map((sec) => {
              const isActive = sec.href === "/" ? isHome : pathname.startsWith(sec.href);
              return (
                <div key={sec.id} className="flex items-center">
                  <Link
                    href={sec.href}
                    className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                      isActive
                        ? "bg-card text-primary shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    aria-current={isActive ? "page" : undefined}
                  >
                    {sec.icon}
                    <span>{sec.label}</span>
                  </Link>
                  {sec.infoTerm && <InfoTip term={sec.infoTerm} size="xs" />}
                </div>
              );
            })}
          </nav>
        </div>

        {/* Center: Scenario switcher + Adjust (Visible ONLY on /) */}
        {isHome ? (
          <div className="flex items-center gap-1.5" data-tour="escenario">
            <div className="flex rounded-lg bg-muted p-0.5 border border-border">
              {SCENARIOS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setScenario(s.id)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                    scenario === s.id
                      ? "bg-card text-primary shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <InfoTip term="escenarios" size="sm" />

            {scenario !== "base" && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setIsScenarioModalOpen(true)}
                  className="h-8 px-2.5 text-xs font-semibold rounded-md border border-border bg-card hover:bg-accent text-foreground flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
                  aria-label="Ajustar parámetros"
                >
                  <svg
                    className="w-3.5 h-3.5 text-primary"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
                    />
                  </svg>
                  <span>Ajustar</span>
                </button>

                {isScenarioModified(scenario) && (
                  <button
                    type="button"
                    onClick={() => resetScenarioParams(scenario)}
                    className="h-8 px-2 text-xs font-medium rounded-md border border-border bg-muted/60 hover:bg-accent text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
                    title="Restablecer valores originales"
                    aria-label="Restablecer valores originales"
                  >
                    <span>
                      {scenario === "intervencion" && campaignsCount >= 2
                        ? `${campaignsCount} campañas`
                        : "Modificado"}
                    </span>
                    <span className="text-muted-foreground/60">·</span>
                    <svg className="size-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                      />
                    </svg>
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1" />
        )}

        {/* Right side: Search (only on /), Engine indicator, Metodología, Help */}
        <div className="flex items-center gap-2">
          {/* Global Search - mounted ONLY on / so shortcut '/' is only active on / */}
          {isHome && <RegionSearch className="w-56 xl:w-64" />}

          {/* Engine indicator */}
          <div className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground rounded-full border border-border bg-muted/50">
            <span
              className={`size-2 rounded-full ${
                isDemo ? "bg-risk-mid animate-pulse" : "bg-good"
              }`}
            />
            <span className="hidden xl:inline text-[11px] font-medium font-mono">
              {storeLabel}
            </span>
            <InfoTip term="motor" size="xs" />
          </div>

          {/* Metodología */}
          <Link
            href="/metodologia"
            className="h-8 px-2.5 text-xs font-medium rounded-md hover:bg-accent text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
              />
            </svg>
            <span className="hidden xl:inline">Metodología</span>
          </Link>

          {/* Help button (dispatches C1) */}
          <button
            type="button"
            onClick={handleOpenGuide}
            className="size-8 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors cursor-pointer"
            aria-label="Ayuda y guía del sistema"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <circle cx="12" cy="12" r="10" strokeWidth={2} />
              <path
                strokeLinecap="round"
                strokeWidth={2}
                d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3m.08 4h.01"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Compact layout (< 1024px: mobile & vertical tablet) */}
      <div className="flex flex-col lg:hidden px-3 py-2 gap-2">
        {/* Row 1: BrandLockup compact + action icons */}
        <div className="flex items-center justify-between">
          <BrandLockup compact />

          <div className="flex items-center gap-1">
            {/* Search icon button (only on /) */}
            {isHome && (
              <button
                type="button"
                onClick={() => setMobileSearchOpen(true)}
                className="size-8 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors cursor-pointer"
                aria-label="Buscar región"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
              </button>
            )}

            {/* Metodología icon link */}
            <Link
              href="/metodologia"
              className="size-8 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors"
              aria-label="Metodología"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                />
              </svg>
            </Link>

            {/* Help button (dispatches C1) */}
            <button
              type="button"
              onClick={handleOpenGuide}
              className="size-8 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors cursor-pointer"
              aria-label="Ayuda"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <circle cx="12" cy="12" r="10" strokeWidth={2} />
                <path
                  strokeLinecap="round"
                  strokeWidth={2}
                  d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3m.08 4h.01"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Row 2: Full width section switcher without horizontal scroll */}
        <nav
          className="flex w-full rounded-lg bg-muted p-0.5 border border-border"
          aria-label="Secciones principales"
        >
          {SECTIONS.map((sec) => {
            const isActive = sec.href === "/" ? isHome : pathname.startsWith(sec.href);
            return (
              <Link
                key={sec.id}
                href={sec.href}
                className={`flex-1 flex items-center justify-center gap-1 rounded-md py-1.5 text-center text-xs font-semibold transition-all cursor-pointer ${
                  isActive
                    ? "bg-card text-primary shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                aria-current={isActive ? "page" : undefined}
              >
                {sec.icon}
                <span className="truncate">{sec.shortLabel}</span>
              </Link>
            );
          })}
        </nav>

        {/* Row 3: Full width scenario switcher + Adjust button (Visible ONLY on /) */}
        {isHome && (
          <div className="flex items-center gap-1.5 w-full">
            <div
              className="flex flex-1 rounded-lg bg-muted p-0.5 border border-border"
              data-tour="escenario"
            >
              {SCENARIOS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setScenario(s.id)}
                  className={`flex-1 rounded-md py-1.5 text-center text-xs font-semibold transition-all cursor-pointer ${
                    scenario === s.id
                      ? "bg-card text-primary shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {scenario !== "base" && (
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsScenarioModalOpen(true)}
                  className="h-8 px-2.5 rounded-md border border-border bg-card hover:bg-accent text-primary flex items-center gap-1 transition-colors shadow-xs shrink-0 cursor-pointer text-xs font-semibold"
                  aria-label="Ajustar parámetros"
                >
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
                    />
                  </svg>
                  <span>Ajustar</span>
                </button>

                {isScenarioModified(scenario) && (
                  <button
                    type="button"
                    onClick={() => resetScenarioParams(scenario)}
                    className="h-8 min-w-[40px] px-2 rounded-md border border-border bg-muted/60 hover:bg-accent text-muted-foreground hover:text-foreground flex items-center justify-center gap-1 transition-colors shrink-0 cursor-pointer text-xs"
                    title="Restablecer valores originales"
                    aria-label="Restablecer valores originales"
                  >
                    {scenario === "intervencion" && campaignsCount >= 2 && (
                      <span className="font-medium">{campaignsCount} camp. ·</span>
                    )}
                    <svg className="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                      />
                    </svg>
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Mobile search full-width overlay (Only on /) */}
      {isHome && mobileSearchOpen && (
        <div className="fixed inset-x-0 top-0 z-50 flex h-14 items-center gap-2 border-b border-border bg-card px-3 shadow-md lg:hidden">
          <RegionSearch
            autoFocus
            showKbd={false}
            onSelect={() => setMobileSearchOpen(false)}
            className="flex-1"
          />
          <button
            type="button"
            onClick={() => setMobileSearchOpen(false)}
            className="h-8 px-3 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            Cancelar
          </button>
        </div>
      )}

      {/* Discreet Banner for Data Status */}
      {!hasData && (
        <div className="bg-primary-soft border-t border-border text-foreground text-xs px-4 py-1.5 text-center font-medium flex items-center justify-center gap-2">
          <span className="size-2 rounded-full bg-risk-mid animate-pulse" />
          <span>
            Aún no hay datos cargados. Coloque los archivos en{" "}
            <code className="bg-card px-1 py-0.5 rounded text-foreground font-mono border border-border">
              data/raw/
            </code>{" "}
            y ejecute el procesador.
          </span>
        </div>
      )}
    </header>
  );
}
