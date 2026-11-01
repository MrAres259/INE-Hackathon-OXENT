"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAtalaya } from "@/lib/state";
import type { ScenarioId } from "@/lib/types";
import { BrandLockup, BrandMark } from "@/components/brand/BrandMark";
import { RegionSearch } from "@/components/map/RegionSearch";
import { InfoTip } from "@/components/ui/InfoTip";
import { getSession, logout } from "@/lib/auth";
import { tourForPath, GUIDE_EVENTS } from "@/lib/tours";

const SCENARIOS: { id: ScenarioId; label: string; shortLabel: string }[] = [
  { id: "base", label: "Base", shortLabel: "Base" },
  { id: "intervencion", label: "Intervención", shortLabel: "Interv." },
  { id: "pesimista", label: "Pesimista", shortLabel: "Pesim." },
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

function UserMenuDropdown({
  username,
  onLogout,
  variant = "button",
}: {
  username: string | null;
  onLogout: () => void;
  variant?: "button" | "icon" | "responsive";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleGuideOpened = () => {
      setOpen(false);
    };
    window.addEventListener(GUIDE_EVENTS.opened, handleGuideOpened);
    return () => window.removeEventListener(GUIDE_EVENTS.opened, handleGuideOpened);
  }, []);

  return (
    <div className="relative shrink-0" ref={ref}>
      {variant === "responsive" ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Menú de usuario"
          title={username ? `Usuario: ${username}` : "Usuario"}
          className="size-8 2xl:w-auto 2xl:h-8 2xl:px-2.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground flex items-center justify-center 2xl:justify-start gap-1.5 transition-colors cursor-pointer 2xl:border 2xl:border-border 2xl:bg-card/60 shrink-0"
        >
          <svg className="size-4 2xl:size-3.5 shrink-0 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
          <span className="hidden 2xl:inline text-xs font-semibold max-w-[100px] truncate text-foreground">
            {username || "Usuario"}
          </span>
          <svg className="hidden 2xl:inline size-3 text-muted-foreground" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
      ) : variant === "button" ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          className="h-8 px-2.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors cursor-pointer border border-border bg-card/60"
          title={username ? `Usuario: ${username}` : "Usuario"}
        >
          <svg className="size-3.5 shrink-0 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
          <span className="text-xs font-semibold max-w-[100px] truncate text-foreground">
            {username || "Usuario"}
          </span>
          <svg className="size-3 text-muted-foreground" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          className="size-8 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors cursor-pointer"
          aria-label="Menú de usuario"
          title={username ? `Usuario: ${username}` : "Usuario"}
        >
          <svg className="size-4 shrink-0 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        </button>
      )}

      {open && (
        <div
          role="menu"
          aria-label="Menú de usuario"
          className="absolute right-0 top-full mt-1.5 w-48 rounded-lg border border-border bg-card p-1 shadow-lg z-50 flex flex-col gap-1"
        >
          <div className="px-3 py-1.5 border-b border-border text-xs">
            <span className="text-[10px] uppercase font-bold text-muted-foreground block">
              Sesión activa
            </span>
            <span className="font-semibold text-foreground truncate block">
              {username || "Usuario"}
            </span>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
            className="flex items-center gap-2 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 rounded-md transition-colors w-full text-left cursor-pointer font-medium"
          >
            <svg className="size-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            <span>Cerrar sesión</span>
          </button>
        </div>
      )}
    </div>
  );
}

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
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);

  const [username, setUsername] = useState<string | null>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);

  // Determine active section route
  let rawPath: string | null = null;
  try {
    rawPath = usePathname();
  } catch {
    rawPath = "/";
  }
  const pathname = rawPath || "/";
  const isHome = pathname === "/";
  const isLoginPage =
    pathname === "/login" ||
    (typeof window !== "undefined" && window.location?.pathname === "/login");

  useEffect(() => {
    if (isLoginPage) return;
    let active = true;
    getSession()
      .then((sess) => {
        if (active && sess?.user?.username) {
          setUsername(sess.user.username);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [isLoginPage]);

  useEffect(() => {
    if (!userMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [userMenuOpen]);

  const handleLogout = async () => {
    await logout();
  };

  useEffect(() => {
    if (!moreMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setMoreMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [moreMenuOpen]);

  const headerRef = useRef<HTMLElement | null>(null);

  // Publish --topbar-h CSS variable on documentElement
  useEffect(() => {
    if (typeof document !== "undefined") {
      const updateTopbarH = () => {
        if (pathname === "/login") {
          document.documentElement.style.setProperty("--topbar-h", "0px");
          return;
        }
        const isLandscape =
          window.matchMedia?.("(orientation: landscape) and (max-height: 540px)")?.matches ??
          false;
        const isDesktop = window.innerWidth >= 1024 && !isLandscape;
        const measured = headerRef.current?.getBoundingClientRect
          ? Math.round(headerRef.current.getBoundingClientRect().height)
          : null;
        const fallback = isLandscape ? 48 : isDesktop ? 56 : isHome ? 88 : 48;
        const h = measured && measured > 0 ? measured : fallback;
        document.documentElement.style.setProperty("--topbar-h", `${h}px`);
      };
      updateTopbarH();
      window.addEventListener("resize", updateTopbarH);
      window.addEventListener("orientationchange", updateTopbarH);
      return () => {
        window.removeEventListener("resize", updateTopbarH);
        window.removeEventListener("orientationchange", updateTopbarH);
      };
    }
  }, [isHome, pathname]);

  // Hide TopBar completely on /login
  if (pathname === "/login") {
    return null;
  }

  const campaignsCount =
    scenario === "intervencion" && Array.isArray(paramsByScenario.intervencion?.campaigns)
      ? paramsByScenario.intervencion.campaigns.length
      : 1;

  const hasTour = tourForPath(pathname) !== null;

  const handleOpenGuide = () => {
    if (moreMenuOpen) {
      setMoreMenuOpen(false);
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(GUIDE_EVENTS.open));
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleGuideOpened = () => {
      setMoreMenuOpen(false);
      setMobileSearchOpen(false);
    };
    window.addEventListener(GUIDE_EVENTS.opened, handleGuideOpened);
    return () => window.removeEventListener(GUIDE_EVENTS.opened, handleGuideOpened);
  }, []);

  const isDemo = isMock || !apiAvailable;
  const storeLabel = isDemo
    ? "Demostración"
    : meta?.store === "opensearch"
    ? "OpenSearch"
    : "Memoria";

  return (
    <header ref={headerRef} className="shrink-0 bg-card border-b border-border pt-[env(safe-area-inset-top,0px)] sticky top-0 z-30 select-none">
      {/* PC single-row layout (>= 1024px and not compact-landscape) */}
      <div data-layout-mode="desktop" className="hidden lg:flex [@media(orientation:landscape)_and_(max-height:540px)]:!hidden h-14 items-center justify-between px-2 xl:px-4 gap-2 xl:gap-3 min-w-0 w-full">
        {/* Brand Lockup & Section Navigation Tabs */}
        <div className="flex items-center gap-2 xl:gap-4 shrink-0">
          <BrandLockup className="shrink-0 whitespace-nowrap max-xl:gap-0 xl:gap-2.5 max-xl:[&>div]:!hidden max-2xl:[&_.font-sans]:!hidden 2xl:[&_.font-sans]:!block" />

          {/* Section Tabs */}
          <nav
            className="flex items-center gap-0.5 xl:gap-1 rounded-lg bg-muted p-0.5 border border-border shrink-0"
            aria-label="Secciones principales"
            data-tour="secciones"
          >
            {SECTIONS.map((sec) => {
              const isActive = sec.href === "/" ? isHome : pathname.startsWith(sec.href);
              return (
                <div key={sec.id} className="flex items-center shrink-0">
                  <Link
                    href={sec.href}
                    aria-label={sec.label}
                    title={sec.label}
                    className={`flex items-center gap-1.5 rounded-md px-1.5 xl:px-2 2xl:px-2.5 py-1.5 text-xs font-semibold transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                      isActive
                        ? "bg-card text-primary shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    aria-current={isActive ? "page" : undefined}
                  >
                    {sec.icon}
                    <span className="hidden 2xl:inline whitespace-nowrap">
                      <span className="hidden 2xl:inline">{sec.label}</span>
                      <span className="2xl:hidden">{sec.shortLabel}</span>
                    </span>
                  </Link>
                  {sec.infoTerm && <InfoTip term={sec.infoTerm} size="xs" className="shrink-0" />}
                </div>
              );
            })}
          </nav>
        </div>

        {/* Center: Scenario switcher + Adjust (Visible ONLY on /) */}
        {isHome ? (
          <div className="flex items-center gap-1 xl:gap-1.5 shrink-0 whitespace-nowrap" data-tour="escenario">
            <div className="flex rounded-lg bg-muted p-0.5 border border-border shrink-0">
              {SCENARIOS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setScenario(s.id)}
                  data-tour={s.id === "intervencion" ? "intervencion" : undefined}
                  aria-label={s.label}
                  title={s.label}
                  className={`rounded-md px-1.5 xl:px-2.5 2xl:px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                    scenario === s.id
                      ? "bg-card text-primary shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span className="xl:hidden">{s.shortLabel}</span>
                  <span className="hidden xl:inline">{s.label}</span>
                </button>
              ))}
            </div>
            <InfoTip term="escenarios" size="sm" className="shrink-0" />

            {scenario !== "base" && (
              <div className="flex items-center gap-1 xl:gap-1.5 shrink-0 whitespace-nowrap">
                <button
                  type="button"
                  onClick={() => setIsScenarioModalOpen(true)}
                  data-tour="ajustar"
                  className="h-8 px-2 xl:px-2.5 text-xs font-semibold rounded-md border border-border bg-card hover:bg-accent text-foreground flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer whitespace-nowrap shrink-0"
                  aria-label="Ajustar parámetros"
                  title="Ajustar parámetros"
                >
                  <svg
                    className="w-3.5 h-3.5 text-primary shrink-0"
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
                  <span className="hidden xl:inline whitespace-nowrap">Ajustar</span>
                </button>

                {isScenarioModified(scenario) && (
                  <button
                    type="button"
                    onClick={() => resetScenarioParams(scenario)}
                    className="h-8 px-1.5 xl:px-2 text-xs font-medium rounded-md border border-border bg-muted/60 hover:bg-accent text-muted-foreground hover:text-foreground flex items-center gap-1 xl:gap-1.5 transition-colors shadow-xs cursor-pointer whitespace-nowrap shrink-0"
                    title="Restablecer valores originales"
                    aria-label="Restablecer valores originales"
                  >
                    <span className="whitespace-nowrap">
                      {scenario === "intervencion" && campaignsCount >= 2
                        ? `${campaignsCount} camp.`
                        : "Modificado"}
                    </span>
                    <span className="text-muted-foreground/60">·</span>
                    <svg className="size-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
        <div className={`flex items-center gap-1.5 xl:gap-2 min-w-0 ${isHome ? "flex-1" : "shrink-0"} justify-end`}>
          {/* Global Search - mounted ONLY on / so shortcut '/' is only active on / */}
          {isHome && <RegionSearch className="flex-1 min-w-[160px] max-w-[22rem]" />}

          {/* Engine indicator */}
          <div className="flex items-center gap-1 xl:gap-1.5 px-1.5 xl:px-2 py-1 text-xs text-muted-foreground rounded-full border border-border bg-muted/50 shrink-0">
            <span
              className={`size-2 rounded-full shrink-0 ${
                isDemo ? "bg-risk-mid animate-pulse" : "bg-good"
              }`}
            />
            <span className="hidden 2xl:inline text-[11px] font-medium font-mono whitespace-nowrap">
              {storeLabel}
            </span>
            <InfoTip term="motor" size="xs" className="shrink-0" />
          </div>

          {/* Metodología */}
          <Link
            href="/metodologia"
            className="size-8 2xl:w-auto 2xl:h-8 2xl:px-2.5 text-xs font-medium rounded-md hover:bg-accent text-muted-foreground hover:text-foreground flex items-center justify-center 2xl:justify-start gap-1.5 transition-colors shrink-0 whitespace-nowrap"
            title="Metodología"
            aria-label="Metodología"
          >
            <svg
              className="w-3.5 h-3.5 shrink-0"
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
            <span className="hidden 2xl:inline whitespace-nowrap">Metodología</span>
          </Link>

          {/* Help button (dispatches C1) */}
          {hasTour && (
            <button
              type="button"
              onClick={handleOpenGuide}
              className="size-8 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors cursor-pointer shrink-0"
              aria-label="Ayuda y guía del sistema"
              title="Ayuda y guía del sistema"
            >
              <svg
                className="w-4 h-4 shrink-0"
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
          )}

          {/* User Menu (Desktop) */}
          <UserMenuDropdown username={username} onLogout={handleLogout} variant="responsive" />
        </div>
      </div>

      {/* Compact-landscape single-row layout (<= 48px, orientation: landscape and height <= 540px) */}
      <div data-layout-mode="compact-landscape" className="hidden [@media(orientation:landscape)_and_(max-height:540px)]:flex h-12 items-center justify-between px-3 gap-2 min-w-0 w-full">
        {/* Brand icon only (no text) */}
        <Link
          href="/"
          aria-label="Atalaya Electoral, inicio"
          className="flex items-center shrink-0 focus-visible:outline-hidden"
        >
          <BrandMark size={28} />
        </Link>

        {/* Section tabs as icons */}
        <nav
          className="flex items-center gap-1 rounded-lg bg-muted p-0.5 border border-border shrink-0"
          aria-label="Secciones principales"
          data-tour="secciones"
        >
          {SECTIONS.map((sec) => {
            const isActive = sec.href === "/" ? isHome : pathname.startsWith(sec.href);
            return (
              <Link
                key={sec.id}
                href={sec.href}
                className={`flex items-center justify-center size-8 rounded-md transition-all cursor-pointer ${
                  isActive
                    ? "bg-card text-primary shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                aria-label={sec.label}
                title={sec.label}
                aria-current={isActive ? "page" : undefined}
              >
                {sec.icon}
              </Link>
            );
          })}
        </nav>

        {/* Scenario controls (Base · Interv. · Pesim.) + Ajustar as icon (Visible ONLY on /) */}
        {isHome && (
          <div className="flex items-center gap-1 shrink-0" data-tour="escenario">
            <div className="flex rounded-lg bg-muted p-0.5 border border-border shrink-0">
              {[
                { id: "base" as ScenarioId, label: "Base" },
                { id: "intervencion" as ScenarioId, label: "Interv." },
                { id: "pesimista" as ScenarioId, label: "Pesim." },
              ].map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setScenario(s.id)}
                  data-tour={s.id === "intervencion" ? "intervencion" : undefined}
                  className={`rounded-md px-2 py-1 text-[11px] font-semibold transition-all cursor-pointer whitespace-nowrap ${
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
              <button
                type="button"
                onClick={() => setIsScenarioModalOpen(true)}
                data-tour="ajustar"
                className="size-8 rounded-md border border-border bg-card hover:bg-accent text-primary flex items-center justify-center transition-colors shadow-xs cursor-pointer shrink-0"
                aria-label="Ajustar parámetros"
                title="Ajustar parámetros"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
                  />
                </svg>
              </button>
            )}
          </div>
        )}

        {/* Right side icon buttons: search (only on /), metodologia, guide */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Search icon button (only on /) */}
          {isHome && (
            <button
              type="button"
              onClick={() => setMobileSearchOpen(true)}
              data-tour="buscar"
              className="size-8 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors cursor-pointer"
              aria-label="Buscar estado o municipio"
              title="Buscar"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
            className="size-8 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors shrink-0"
            aria-label="Metodología"
            title="Metodología"
          >
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
              />
            </svg>
          </Link>

          {/* Help button (dispatches C1) */}
          {hasTour && (
            <button
              type="button"
              onClick={handleOpenGuide}
              className="size-8 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors cursor-pointer shrink-0"
              aria-label="Ayuda y guía del sistema"
              title="Ayuda y guía del sistema"
            >
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" strokeWidth={2} />
                <path strokeLinecap="round" strokeWidth={2} d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3m.08 4h.01" />
              </svg>
            </button>
          )}

          {/* User Menu (Compact Landscape) */}
          <UserMenuDropdown username={username} onLogout={handleLogout} variant="icon" />
        </div>
      </div>

      {/* Compact layout (< 1024px: mobile & vertical tablet, hidden on compact-landscape) */}
      <div data-layout-mode="compact-portrait" className="flex flex-col lg:hidden [@media(orientation:landscape)_and_(max-height:540px)]:!hidden px-2.5 py-1.5 gap-1.5">
        {/* Row 1: Brand + Section Icons + Action Icons */}
        <div className="flex items-center justify-between gap-1.5 min-w-0">
          {/* Brand: single BrandMark, text hidden on < 400px */}
          <Link
            href="/"
            aria-label="Atalaya Electoral, inicio"
            className="flex items-center gap-2 shrink-0 focus-visible:outline-hidden select-none group"
          >
            <BrandMark size={28} aria-hidden="true" className="shrink-0" />
            <div className="min-w-0 leading-tight hidden min-[400px]:block">
              <div className="font-display font-extrabold text-sm tracking-tight text-ink flex items-baseline gap-1">
                <span>Atalaya</span>
                <span className="text-primary font-bold">Electoral</span>
              </div>
            </div>
          </Link>

          {/* Section tabs as icons */}
          <nav
            className="flex items-center gap-1 rounded-lg bg-muted p-0.5 border border-border shrink-0"
            aria-label="Secciones principales"
            data-tour="secciones"
          >
            {SECTIONS.map((sec) => {
              const isActive = sec.href === "/" ? isHome : pathname.startsWith(sec.href);
              return (
                <Link
                  key={sec.id}
                  href={sec.href}
                  className={`flex items-center justify-center size-8 rounded-md transition-all cursor-pointer ${
                    isActive
                      ? "bg-card text-primary shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  aria-label={sec.label}
                  title={sec.label}
                  aria-current={isActive ? "page" : undefined}
                >
                  {sec.icon}
                </Link>
              );
            })}
          </nav>

          {/* Action icons: on < 400px Search (on /) + menu "⋯" (Metodología + Guía); on >= 400px direct icons */}
          <div className="flex items-center gap-0.5 shrink-0">
            {/* < 400px: Search + Menu "⋯" */}
            <div className="flex min-[400px]:hidden items-center gap-0.5 shrink-0 relative" ref={moreMenuRef}>
              {isHome && (
                <button
                  type="button"
                  onClick={() => setMobileSearchOpen(true)}
                  data-tour="buscar"
                  className="size-8 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors cursor-pointer"
                  aria-label="Buscar estado o municipio"
                  title="Buscar"
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

              <button
                type="button"
                onClick={() => setMoreMenuOpen((v) => !v)}
                className="size-8 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors cursor-pointer"
                aria-label="Más opciones"
                aria-haspopup="menu"
                aria-expanded={moreMenuOpen}
                title="Más opciones"
              >
                <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                  <circle cx="5" cy="12" r="2" />
                  <circle cx="12" cy="12" r="2" />
                  <circle cx="19" cy="12" r="2" />
                </svg>
              </button>

              {moreMenuOpen && (
                <div
                  role="menu"
                  aria-label="Opciones adicionales"
                  className="absolute right-0 top-full mt-1 w-44 rounded-md border border-border bg-card p-1 shadow-float z-50 flex flex-col gap-0.5"
                >
                  <Link
                    href="/metodologia"
                    role="menuitem"
                    onClick={() => setMoreMenuOpen(false)}
                    className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-foreground hover:bg-accent rounded-sm transition-colors"
                  >
                    <svg
                      className="w-3.5 h-3.5 shrink-0 text-muted-foreground"
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
                    <span>Metodología</span>
                  </Link>
                  {hasTour && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMoreMenuOpen(false);
                        handleOpenGuide();
                      }}
                      className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-foreground hover:bg-accent rounded-sm transition-colors text-left w-full cursor-pointer"
                    >
                      <svg
                        className="w-3.5 h-3.5 shrink-0 text-muted-foreground"
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
                      <span>Guía interactiva</span>
                    </button>
                  )}
                  <div className="px-2.5 py-1 text-[11px] text-muted-foreground border-t border-border mt-0.5 pt-1.5 flex items-center gap-1.5">
                    <svg className="size-3 text-primary shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    <span className="truncate font-semibold text-foreground">
                      {username || "Usuario"}
                    </span>
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMoreMenuOpen(false);
                      handleLogout();
                    }}
                    className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-destructive hover:bg-destructive/10 rounded-sm transition-colors text-left w-full cursor-pointer font-medium"
                  >
                    <svg
                      className="w-3.5 h-3.5 shrink-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                      />
                    </svg>
                    <span>Cerrar sesión</span>
                  </button>
                </div>
              )}
            </div>

            {/* >= 400px: Search + Metodología + Guía directly */}
            <div className="hidden min-[400px]:flex items-center gap-0.5 shrink-0">
              {isHome && (
                <button
                  type="button"
                  onClick={() => setMobileSearchOpen(true)}
                  data-tour="buscar"
                  className="size-8 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors cursor-pointer"
                  aria-label="Buscar estado o municipio"
                  title="Buscar"
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

              <Link
                href="/metodologia"
                className="size-8 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors shrink-0"
                aria-label="Metodología"
                title="Metodología"
              >
                <svg
                  className="w-4 h-4 shrink-0"
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

              {hasTour && (
                <button
                  type="button"
                  onClick={handleOpenGuide}
                  className="size-8 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors cursor-pointer shrink-0"
                  aria-label="Ayuda y guía del sistema"
                  title="Ayuda y guía del sistema"
                >
                  <svg
                    className="w-4 h-4 shrink-0"
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
              )}

              {/* User Menu (Compact Portrait >= 400px) */}
              <UserMenuDropdown username={username} onLogout={handleLogout} variant="icon" />
            </div>
          </div>
        </div>

        {/* Row 2: Scenario switcher + Adjust button (Visible ONLY on /) */}
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
                  data-tour={s.id === "intervencion" ? "intervencion" : undefined}
                  className={`flex-1 rounded-md py-1 text-center text-xs font-semibold transition-all cursor-pointer ${
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
                  data-tour="ajustar"
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
        )}
      </div>

      {/* Mobile search full-width overlay (Only on /) */}
      {isHome && mobileSearchOpen && (
        <div className="fixed inset-x-0 top-0 z-50 flex h-12 md:h-14 items-center gap-2 border-b border-border bg-card px-3 shadow-md lg:hidden">
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
