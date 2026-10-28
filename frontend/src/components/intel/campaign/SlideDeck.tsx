"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import type { CampaignPlan, Slide } from "@/lib/intel/types";
import {
  type PlanDrafts,
  type SlideEdit,
  ensurePlanSlides,
  applyDraftToSlide,
  isSlideEdited,
  isPlanEdited,
  updateSlideDraft,
  restoreSlideDraft,
  clearDrafts,
} from "./campaignDraft";
import { SlideView } from "./SlideView";
import { SlideEditor } from "./SlideEditor";

export interface SlideDeckProps {
  plan: CampaignPlan;
  drafts: PlanDrafts;
  onDraftChange: (newDrafts: PlanDrafts) => void;
  onSourceSelect?: (sourceId: string) => void;
  className?: string;
}

export function SlideDeck({
  plan,
  drafts,
  onDraftChange,
  onSourceSelect,
  className = "",
}: SlideDeckProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [scale, setScale] = useState(1);

  const containerRef = useRef<HTMLDivElement>(null);
  const slideFrameRef = useRef<HTMLDivElement>(null);

  // Guarantee all 10 canonical slides are present
  const originalSlides = useMemo(() => ensurePlanSlides(plan), [plan]);

  // Merge drafts into each slide
  const activeSlides: Slide[] = useMemo(() => {
    return originalSlides.map((orig) => {
      const edit = drafts[orig.id];
      return applyDraftToSlide(orig, edit);
    });
  }, [originalSlides, drafts]);

  const totalSlides = activeSlides.length;
  const safeIndex = Math.min(Math.max(0, currentIndex), Math.max(0, totalSlides - 1));
  const currentSlide = activeSlides[safeIndex] || originalSlides[0];
  const currentOriginalSlide = originalSlides[safeIndex] || originalSlides[0];
  const currentDraft = drafts[currentSlide?.id];
  const currentIsEdited = isSlideEdited(currentOriginalSlide, currentDraft);
  const planIsEdited = isPlanEdited(plan, drafts);

  // Keyboard navigation ← / → / Space
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in input/textarea or editor is open
      if (
        isEditing ||
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA"
      ) {
        return;
      }

      if (e.key === "ArrowRight" || e.key === "PageDown") {
        e.preventDefault();
        setCurrentIndex((prev) => Math.min(prev + 1, totalSlides - 1));
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        setCurrentIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === " " && !e.shiftKey) {
        e.preventDefault();
        setCurrentIndex((prev) => (prev + 1) % totalSlides);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [totalSlides, isEditing]);

  // Measure container and compute 1280x720 scale factor
  useEffect(() => {
    const updateScale = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const targetWidth = 1280;
      const targetHeight = 720;
      const wScale = rect.width / targetWidth;
      const hScale = rect.height / targetHeight;
      const chosenScale = Math.min(wScale, hScale);
      setScale(chosenScale > 0 ? chosenScale : 1);
    };

    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, []);

  const handleFullscreenToggle = async () => {
    try {
      if (!document.fullscreenElement) {
        if (containerRef.current?.requestFullscreen) {
          await containerRef.current.requestFullscreen();
          setIsFullscreen(true);
        }
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
          setIsFullscreen(false);
        }
      }
    } catch {
      // Fullscreen not allowed or rejected
    }
  };

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // Save edits for current slide
  const handleSaveSlideEdit = (edit: SlideEdit) => {
    const nextDrafts = updateSlideDraft(plan.id, currentSlide.id, edit);
    onDraftChange(nextDrafts);
  };

  // Restore current slide to original
  const handleRestoreCurrentSlide = () => {
    const nextDrafts = restoreSlideDraft(plan.id, currentSlide.id);
    onDraftChange(nextDrafts);
  };

  // Restore all slides in plan
  const handleRestoreAll = () => {
    clearDrafts(plan.id);
    onDraftChange({});
  };

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {/* 1. Deck Controls Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl border border-border bg-card/80 text-xs">
        <div className="flex items-center gap-2">
          {/* Navigation Arrows */}
          <div className="flex items-center rounded-lg border border-border overflow-hidden bg-background">
            <button
              type="button"
              disabled={safeIndex === 0}
              onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
              className="size-8 flex items-center justify-center hover:bg-accent disabled:opacity-30 transition-colors cursor-pointer"
              aria-label="Diapositiva anterior"
              title="Anterior (←)"
            >
              ◀
            </button>
            <span className="px-3 font-semibold text-foreground font-mono select-none">
              {safeIndex + 1} / {totalSlides}
            </span>
            <button
              type="button"
              disabled={safeIndex >= totalSlides - 1}
              onClick={() => setCurrentIndex((prev) => Math.min(totalSlides - 1, prev + 1))}
              className="size-8 flex items-center justify-center hover:bg-accent disabled:opacity-30 transition-colors cursor-pointer"
              aria-label="Diapositiva siguiente"
              title="Siguiente (→)"
            >
              ▶
            </button>
          </div>

          <span className="hidden sm:inline text-muted-foreground">
            Diapositiva {safeIndex + 1} de {totalSlides}
          </span>

          {currentIsEdited && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary/10 text-primary border border-primary/20">
              Editada
            </span>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          {currentIsEdited && (
            <button
              type="button"
              onClick={handleRestoreCurrentSlide}
              className="h-8 px-2.5 rounded-md border border-border bg-muted/40 hover:bg-accent text-xs font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              title="Restaurar el contenido original de esta diapositiva"
            >
              Restaurar diapositiva
            </button>
          )}

          {planIsEdited && (
            <button
              type="button"
              onClick={handleRestoreAll}
              className="h-8 px-2.5 rounded-md border border-border bg-muted/40 hover:bg-accent text-xs font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              title="Restaurar todas las diapositivas originales del plan"
            >
              Restaurar todo
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="h-8 px-3 rounded-md bg-muted hover:bg-accent border border-border text-xs font-semibold text-foreground transition-colors cursor-pointer flex items-center gap-1.5"
            aria-label="Editar diapositiva actual"
          >
            <span>✏️</span>
            <span>Editar</span>
          </button>

          <button
            type="button"
            onClick={handleFullscreenToggle}
            className="size-8 rounded-md border border-border bg-muted/40 hover:bg-accent text-foreground flex items-center justify-center text-sm transition-colors cursor-pointer"
            aria-label={isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
            title="Pantalla completa"
          >
            {isFullscreen ? "↙" : "⛶"}
          </button>
        </div>
      </div>

      {/* 2. Slide Main 16:9 Scaled Container */}
      <div
        ref={containerRef}
        className="relative w-full aspect-[16/9] rounded-2xl border border-border bg-muted/30 overflow-hidden shadow-inner flex items-center justify-center"
      >
        <div
          ref={slideFrameRef}
          className="w-[1280px] h-[720px] origin-center shrink-0"
          style={{
            transform: `scale(${scale})`,
          }}
        >
          <SlideView
            slide={currentSlide}
            plan={plan}
            onSourceClick={onSourceSelect}
          />
        </div>
      </div>

      {/* 3. Thumbnails Strip (10 Miniatures) */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
          <span className="font-semibold text-foreground">
            Índice de diapositivas ({totalSlides})
          </span>
          <span className="text-[11px]">Navega con flechas ← / →</span>
        </div>

        <div
          role="tablist"
          aria-label="Miniaturas de diapositivas"
          className="flex gap-2 overflow-x-auto pb-2 pt-1 px-1 scrollbar-thin"
        >
          {activeSlides.map((slide, idx) => {
            const isSelected = idx === safeIndex;
            const isEditedSlide = isSlideEdited(originalSlides[idx], drafts[slide.id]);

            return (
              <button
                key={slide.id || idx}
                type="button"
                role="tab"
                aria-selected={isSelected}
                data-thumbnail-index={idx}
                onClick={() => setCurrentIndex(idx)}
                className={`group relative flex flex-col justify-between shrink-0 w-28 md:w-32 h-18 p-2 rounded-xl border text-left transition-all cursor-pointer select-none ${
                  isSelected
                    ? "border-primary bg-primary/10 ring-2 ring-primary/20 shadow-xs"
                    : "border-border bg-card hover:border-primary/40 hover:bg-accent/40"
                }`}
              >
                <div className="flex items-center justify-between gap-1 w-full text-[10px]">
                  <span className="font-mono font-bold text-muted-foreground group-hover:text-foreground">
                    #{idx + 1}
                  </span>
                  {isEditedSlide && (
                    <span className="size-2 rounded-full bg-primary" title="Editada" />
                  )}
                </div>

                <div className="font-medium text-[11px] text-foreground leading-tight line-clamp-2 mt-auto">
                  {slide.title}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 4. Slide Editor Modal Dialog */}
      {isEditing && (
        <SlideEditor
          slide={currentSlide}
          originalSlide={currentOriginalSlide}
          draft={currentDraft}
          isEdited={currentIsEdited}
          onSave={handleSaveSlideEdit}
          onRestore={handleRestoreCurrentSlide}
          onClose={() => setIsEditing(false)}
        />
      )}
    </div>
  );
}
