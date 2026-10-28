"use client";

import React, { useState } from "react";
import type { Slide } from "@/lib/intel/types";
import type { SlideEdit } from "./campaignDraft";
import { InfoTip } from "@/components/ui/InfoTip";

export interface SlideEditorProps {
  slide: Slide;
  originalSlide: Slide;
  draft?: SlideEdit;
  isEdited: boolean;
  onSave: (edit: SlideEdit) => void;
  onRestore: () => void;
  onClose: () => void;
}

const MAX_BULLET_LENGTH = 300;
const MAX_BULLETS = 8;

export function SlideEditor({
  slide,
  originalSlide,
  draft,
  isEdited,
  onSave,
  onRestore,
  onClose,
}: SlideEditorProps) {
  const [title, setTitle] = useState(draft?.title ?? slide.title);
  const [subtitle, setSubtitle] = useState(
    draft?.subtitle !== undefined ? draft.subtitle || "" : slide.subtitle || ""
  );
  const [bullets, setBullets] = useState<string[]>(
    draft?.bullets ? [...draft.bullets] : [...(slide.bullets || [])]
  );
  const [notes, setNotes] = useState(draft?.notes ?? slide.notes ?? "");

  const handleAddBullet = () => {
    if (bullets.length >= MAX_BULLETS) return;
    setBullets([...bullets, ""]);
  };

  const handleUpdateBullet = (index: number, val: string) => {
    const updated = [...bullets];
    updated[index] = val.slice(0, MAX_BULLET_LENGTH);
    setBullets(updated);
  };

  const handleRemoveBullet = (index: number) => {
    const updated = bullets.filter((_, i) => i !== index);
    setBullets(updated);
  };

  const handleMoveBullet = (index: number, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= bullets.length) return;
    const updated = [...bullets];
    const temp = updated[index];
    updated[index] = updated[targetIndex];
    updated[targetIndex] = temp;
    setBullets(updated);
  };

  const handleSaveForm = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      title: title.trim() || originalSlide.title,
      subtitle: subtitle.trim() ? subtitle.trim() : null,
      bullets: bullets.map((b) => b.trim()).filter((b) => b.length > 0),
      notes: notes.trim(),
    });
    onClose();
  };

  const handleRestoreSlide = () => {
    onRestore();
    setTitle(originalSlide.title);
    setSubtitle(originalSlide.subtitle || "");
    setBullets([...(originalSlide.bullets || [])]);
    setNotes(originalSlide.notes || "");
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="slide-editor-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border p-4 bg-muted/30">
          <div className="flex items-center gap-2">
            <h3 id="slide-editor-title" className="font-display text-base font-bold text-foreground">
              Editar Diapositiva: {originalSlide.title}
            </h3>
            {isEdited && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary/10 text-primary border border-primary/20">
                Editado
              </span>
            )}
            <InfoTip term="diapositivas_editables" size="sm" />
          </div>

          <button
            type="button"
            onClick={onClose}
            className="size-7 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground flex items-center justify-center text-sm cursor-pointer"
            aria-label="Cerrar editor"
          >
            ✕
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSaveForm} className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
          {/* Note about uneditable data figures */}
          <div className="rounded-lg border border-border/70 bg-muted/40 p-3 text-muted-foreground flex items-start gap-2">
            <span className="text-sm">ℹ️</span>
            <div className="leading-relaxed">
              Puedes ajustar el título, subtítulo, viñetas explicativas y notas del orador. Por certeza metodológica institucional, las cifras y estimaciones del modelo predictivo y del simulador determinista no son editables directamente.
            </div>
          </div>

          {/* Title */}
          <div className="space-y-1.5">
            <label htmlFor="editor-title" className="block font-semibold text-foreground">
              Título de la diapositiva <span className="text-primary">*</span>
            </label>
            <input
              id="editor-title"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
            />
          </div>

          {/* Subtitle */}
          <div className="space-y-1.5">
            <label htmlFor="editor-subtitle" className="block font-semibold text-foreground">
              Subtítulo <span className="text-muted-foreground font-normal">(opcional)</span>
            </label>
            <input
              id="editor-subtitle"
              type="text"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
            />
          </div>

          {/* Bullets List */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="font-semibold text-foreground">
                Viñetas descriptivas ({bullets.length}/{MAX_BULLETS})
              </label>
              {bullets.length < MAX_BULLETS && (
                <button
                  type="button"
                  onClick={handleAddBullet}
                  className="h-6 px-2 text-[11px] font-semibold rounded bg-muted hover:bg-accent text-foreground transition-colors cursor-pointer flex items-center gap-1"
                >
                  <span>+ Agregar viñeta</span>
                </button>
              )}
            </div>

            <div className="space-y-2">
              {bullets.map((bullet, idx) => (
                <div key={idx} className="flex items-center gap-1.5">
                  {/* Reorder buttons */}
                  <div className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => handleMoveBullet(idx, "up")}
                      className="size-4 rounded text-[9px] hover:bg-muted disabled:opacity-20 flex items-center justify-center cursor-pointer"
                      title="Subir viñeta"
                      aria-label="Subir viñeta"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      disabled={idx === bullets.length - 1}
                      onClick={() => handleMoveBullet(idx, "down")}
                      className="size-4 rounded text-[9px] hover:bg-muted disabled:opacity-20 flex items-center justify-center cursor-pointer"
                      title="Bajar viñeta"
                      aria-label="Bajar viñeta"
                    >
                      ▼
                    </button>
                  </div>

                  {/* Input with length counter */}
                  <div className="relative flex-1">
                    <input
                      type="text"
                      value={bullet}
                      maxLength={MAX_BULLET_LENGTH}
                      onChange={(e) => handleUpdateBullet(idx, e.target.value)}
                      placeholder={`Viñeta ${idx + 1}`}
                      className="h-8 w-full rounded-md border border-border bg-background pl-2.5 pr-14 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono text-muted-foreground pointer-events-none">
                      {bullet.length}/{MAX_BULLET_LENGTH}
                    </span>
                  </div>

                  {/* Remove button */}
                  <button
                    type="button"
                    onClick={() => handleRemoveBullet(idx)}
                    className="size-7 rounded hover:bg-destructive/10 text-destructive flex items-center justify-center text-xs cursor-pointer"
                    title="Eliminar viñeta"
                    aria-label={`Eliminar viñeta ${idx + 1}`}
                  >
                    🗑️
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Speaker Notes */}
          <div className="space-y-1.5">
            <label htmlFor="editor-notes" className="block font-semibold text-foreground">
              Notas del orador <span className="text-muted-foreground font-normal">(visibles en el visor y PPTX)</span>
            </label>
            <textarea
              id="editor-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notas, contexto o mensajes clave para quien presente la diapositiva..."
              className="w-full rounded-md border border-border bg-background p-2.5 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
            />
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-between border-t border-border pt-4 mt-4">
            <div>
              {isEdited && (
                <button
                  type="button"
                  onClick={handleRestoreSlide}
                  className="h-8 px-3 rounded-md border border-border text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
                >
                  Restaurar original
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="h-8 px-3 rounded-md border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="h-8 px-4 rounded-md bg-primary hover:bg-primary/90 text-xs font-semibold text-white transition-colors cursor-pointer shadow-xs"
              >
                Guardar cambios
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
