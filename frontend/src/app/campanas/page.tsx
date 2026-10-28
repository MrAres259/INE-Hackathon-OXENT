"use client";

import React, { useEffect, useState, useCallback } from "react";
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

export default function CampanasPage() {
  const [status, setStatus] = useState<IntelStatus | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [focus, setFocus] = useState<string>("");
  const [plan, setPlan] = useState<CampaignPlan | null>(null);
  const [drafts, setDrafts] = useState<PlanDrafts>({});
  const [highlightedSourceId, setHighlightedSourceId] = useState<string | null>(null);

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
      <div className="space-y-6 py-2 pb-16 md:pb-6">
        {/* 1. Header with Title and Intel Engine Status */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/80 pb-4">
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
          {status && (
            <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-full border border-border bg-card text-xs shadow-2xs">
              <span
                className={`size-2 rounded-full ${
                  status.gemini_enabled ? "bg-good" : "bg-risk-mid"
                }`}
              />
              <span className="font-semibold text-foreground">
                Gemini 3.8: {status.gemini_enabled ? "Activo" : "Deshabilitado"}
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
          )}
        </div>

        {/* 2. Zone Picker & Focus Input */}
        <UnitPicker
          selectedUnitId={selectedUnitId}
          focus={focus}
          onUnitSelect={setSelectedUnitId}
          onFocusChange={setFocus}
        />

        {/* 3. Campaign Runner & Cache Manager */}
        <CampaignRunner
          unitId={selectedUnitId}
          focus={focus}
          currentPlan={plan}
          onPlanLoaded={handlePlanLoaded}
        />

        {/* 4. Active Plan Presentation & Research (2 columns on >= 1280px) */}
        {plan && (
          <div className="space-y-6 pt-2 animate-in fade-in duration-300">
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
              {/* Left Column (Slides Deck & Export): 7 cols on xl, 8 on 2xl */}
              <div className="xl:col-span-7 2xl:col-span-8 space-y-4">
                <SlideDeck
                  plan={plan}
                  drafts={drafts}
                  onDraftChange={handleDraftChange}
                  onSourceSelect={handleSourceSelect}
                />

                {/* Permanent Disclaimer */}
                <div className="rounded-xl border border-border/80 bg-muted/30 p-3 text-[11px] text-muted-foreground leading-relaxed flex items-start gap-2">
                  <span className="text-sm shrink-0">🏛️</span>
                  <span>{plan.disclaimer}</span>
                </div>

                {/* Export Bar (Desktop) */}
                <div className="hidden md:block">
                  <ExportBar plan={plan} drafts={drafts} />
                </div>
              </div>

              {/* Right Column (Research Panel & Findings): 5 cols on xl, 4 on 2xl */}
              <div className="xl:col-span-5 2xl:col-span-4">
                <ResearchPanel
                  plan={plan}
                  highlightedSourceId={highlightedSourceId}
                />
              </div>
            </div>

            {/* Mobile Fixed Export Bar at bottom */}
            <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 p-2 bg-card/95 backdrop-blur-md border-t border-border shadow-float">
              <ExportBar plan={plan} drafts={drafts} />
            </div>
          </div>
        )}
      </div>
    </IntelPageShell>
  );
}
