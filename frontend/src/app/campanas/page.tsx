"use client";

import React, { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { IntelPageShell } from "@/components/intel/IntelPageShell";
import { InfoTip } from "@/components/ui/InfoTip";
import { getIntelStatus } from "@/lib/intel/api";
import type { IntelStatus, CampaignPlan } from "@/lib/intel/types";
import { UnitPicker } from "@/components/intel/campaign/UnitPicker";
import { CampaignRunner } from "@/components/intel/campaign/CampaignRunner";
import { SlideDeck } from "@/components/intel/campaign/SlideDeck";
import { ResearchPanel } from "@/components/intel/campaign/ResearchPanel";
import { ExportBar } from "@/components/intel/campaign/ExportBar";
import {
  type PlanDrafts,
  getDrafts,
  saveDrafts,
} from "@/components/intel/campaign/campaignDraft";

function CampanasContent() {
  const [status, setStatus] = useState<IntelStatus | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [focus, setFocus] = useState<string>("");
  const [plan, setPlan] = useState<CampaignPlan | null>(null);
  const [drafts, setDrafts] = useState<PlanDrafts>({});
  const [highlightedSourceId, setHighlightedSourceId] = useState<string | null>(null);
  const mobileBarRef = useRef<HTMLDivElement | null>(null);

  // Load Intel AI Status on mount
  useEffect(() => {
    let active = true;
    getIntelStatus()
      .then((s) => {
        if (active) setStatus(s);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Publish --page-inset-bottom CSS variable based on mobile export bar height
  useEffect(() => {
    if (typeof document === "undefined" || !document.documentElement) return;

    if (!plan) {
      document.documentElement.style.removeProperty("--page-inset-bottom");
      return;
    }

    const updateInset = (observedHeight?: number) => {
      const el = mobileBarRef.current;
      if (!el) {
        document.documentElement.style.removeProperty("--page-inset-bottom");
        return;
      }

      let isHidden = false;
      try {
        if (typeof window !== "undefined" && typeof window.getComputedStyle === "function") {
          const style = window.getComputedStyle(el);
          if (style && (style.display === "none" || style.visibility === "hidden")) {
            isHidden = true;
          }
        }
      } catch {}

      let height = 0;
      if (!isHidden) {
        const rect = typeof el.getBoundingClientRect === "function" ? el.getBoundingClientRect() : null;
        const rectHeight = rect ? rect.height : 0;
        if (rectHeight > 0) {
          height = Math.round(rectHeight);
        } else if (typeof observedHeight === "number" && observedHeight > 0) {
          height = Math.round(observedHeight);
        } else if (el.offsetHeight > 0) {
          height = Math.round(el.offsetHeight);
        }
      }

      if (height > 0) {
        document.documentElement.style.setProperty("--page-inset-bottom", `${height}px`);
      } else {
        document.documentElement.style.setProperty("--page-inset-bottom", "0px");
      }
    };

    updateInset();

    const el = mobileBarRef.current;
    let observer: ResizeObserver | null = null;
    if (el && typeof ResizeObserver !== "undefined") {
      try {
        observer = new ResizeObserver((entries) => {
          let entryHeight: number | undefined;
          if (entries && entries.length > 0) {
            const entry = entries[0];
            if (entry.borderBoxSize && entry.borderBoxSize.length > 0) {
              entryHeight = entry.borderBoxSize[0].blockSize;
            } else if (entry.contentRect) {
              entryHeight = entry.contentRect.height;
            }
          }
          updateInset(entryHeight);
        });
        observer.observe(el);
      } catch {}
    }

    const handleResize = () => {
      updateInset();
    };
    if (typeof window !== "undefined") {
      window.addEventListener("resize", handleResize);
    }

    return () => {
      if (observer) {
        observer.disconnect();
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("resize", handleResize);
      }
      document.documentElement.style.removeProperty("--page-inset-bottom");
    };
  }, [plan]);

  // When plan loads or changes: load draft edits from localStorage
  const handlePlanLoaded = useCallback((newPlan: CampaignPlan | null) => {
    setPlan(newPlan);
    setHighlightedSourceId(null);
    if (newPlan) {
      const stored = getDrafts(newPlan.id);
      setDrafts(stored);
    } else {
      setDrafts({});
    }
  }, []);

  const handleDraftChange = useCallback(
    (newDrafts: PlanDrafts) => {
      setDrafts(newDrafts);
      if (plan) {
        saveDrafts(plan.id, newDrafts);
      }
    },
    [plan]
  );

  const handleSourceSelect = useCallback((sourceId: string) => {
    setHighlightedSourceId(sourceId);
  }, []);

  return (
    <IntelPageShell>
      <div className="space-y-6 py-2 pb-6">
        {/* 1. Header with Title and Intel Engine Status */}
        <div data-tour="camp-intro" className="flex flex-wrap items-center justify-between gap-3 border-b border-border/80 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-2xl font-black text-foreground tracking-tight">
                Plan de Campaña con IA
              </h1>
              <InfoTip term="plan_campana" size="sm" />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Investigación en fuentes verificadas y planeación estratégica de intervenciones electorales focalizadas.
            </p>
          </div>

          {/* AI Engine & Budget Status Badge */}
          {status && (() => {
            const mode = status.search_mode;
            const model = status.gemini_last_model || status.gemini_model || "Gemini";
            let modeLabel = "Búsqueda de respaldo (noticias indexadas)";
            let dotColor = "bg-risk-mid";

            if (!status.gemini_enabled) {
              modeLabel = "Sin búsqueda en internet";
              dotColor = "bg-muted-foreground";
            } else if (mode === "grounding") {
              modeLabel = "Búsqueda web completa (Google)";
              dotColor = "bg-good";
            } else if (mode === "sin_internet") {
              modeLabel = "Sin búsqueda en internet";
              dotColor = "bg-muted-foreground";
            } else if (mode === "respaldo") {
              modeLabel = "Búsqueda de respaldo (noticias indexadas)";
              dotColor = "bg-risk-mid";
            }

            return (
              <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-full border border-border bg-card text-xs shadow-2xs">
                <span className={`size-2 rounded-full ${dotColor}`} />
                <span className="font-semibold text-foreground">
                  {model}: {modeLabel}
                </span>
                <span className="text-muted-foreground font-mono">
                  · {status.budget_used} / {status.budget_limit} consultas
                </span>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground font-mono">
                  GLM-5.3 ({status.llm_effort})
                </span>
                <InfoTip term="investigacion_gemini" size="xs" />
              </div>
            );
          })()}
        </div>

        {/* 2. Zone Picker & Focus Input */}
        <div data-tour="camp-zona">
          <UnitPicker
            selectedUnitId={selectedUnitId}
            focus={focus}
            onUnitSelect={setSelectedUnitId}
            onFocusChange={setFocus}
          />
        </div>

        {/* 3. Campaign Runner & Cache Manager */}
        <div data-tour="camp-generar">
          <CampaignRunner
            unitId={selectedUnitId}
            focus={focus}
            currentPlan={plan}
            onPlanLoaded={handlePlanLoaded}
          />
        </div>

        {/* 4. Active Plan Presentation & Research (2 columns on >= 1280px) */}
        {plan && (
          <div className="space-y-6 pt-2 animate-in fade-in duration-300">
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
              {/* Left Column (Slides Deck & Export): 7 cols on xl, 8 on 2xl */}
              <div className="xl:col-span-7 2xl:col-span-8 space-y-4">
                <div data-tour="camp-diapositivas">
                  <SlideDeck
                    plan={plan}
                    drafts={drafts}
                    onDraftChange={handleDraftChange}
                    onSourceSelect={handleSourceSelect}
                  />
                </div>

                {/* Permanent Disclaimer */}
                <div className="rounded-xl border border-border/80 bg-muted/30 p-3 text-[11px] text-muted-foreground leading-relaxed flex items-start gap-2">
                  <svg className="size-4 shrink-0 text-muted-foreground mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 21h18M3 10h18M5 10v11M9 10v11M15 10v11M19 10v11M12 2L2 7h20L12 2z" />
                  </svg>
                  <span>{plan.disclaimer}</span>
                </div>

                {/* Export Bar (Desktop) */}
                <div className="hidden md:block" data-tour="camp-exportar">
                  <ExportBar plan={plan} drafts={drafts} />
                </div>
              </div>

              {/* Right Column (Research Panel & Findings): 5 cols on xl, 4 on 2xl */}
              <div className="xl:col-span-5 2xl:col-span-4" data-tour="camp-investigacion">
                <ResearchPanel
                  plan={plan}
                  highlightedSourceId={highlightedSourceId}
                />
              </div>
            </div>

            {/* Mobile Fixed Export Bar at bottom */}
            <div
              ref={mobileBarRef}
              data-tour="camp-exportar"
              className="md:hidden fixed bottom-0 left-0 right-0 z-40 p-2 bg-card/95 backdrop-blur-md border-t border-border shadow-float"
              style={{
                paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))",
              }}
            >
              <ExportBar plan={plan} drafts={drafts} />
            </div>
          </div>
        )}
      </div>
    </IntelPageShell>
  );
}

export default function CampanasPage() {
  return (
    <Suspense
      fallback={
        <IntelPageShell>
          <div className="space-y-6 py-2 pb-6 animate-pulse">
            <div className="h-14 bg-muted/40 rounded-xl" />
            <div className="h-28 bg-muted/30 rounded-xl" />
            <div className="h-64 bg-muted/20 rounded-xl" />
          </div>
        </IntelPageShell>
      }
    >
      <CampanasContent />
    </Suspense>
  );
}
