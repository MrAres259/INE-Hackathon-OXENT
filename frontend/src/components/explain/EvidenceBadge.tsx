"use client";

import React from "react";
import type { EvidenceType, Strength } from "@/lib/explain/types";
import { InfoTip } from "@/components/ui/InfoTip";
import type { GlossaryKey } from "@/lib/glossary";

export interface EvidenceBadgeProps {
  type: EvidenceType;
  strength: Strength;
  className?: string;
}

const TYPE_LABELS: Record<EvidenceType, string> = {
  dato_medido: "Dato medido",
  calculo_del_modelo: "Cálculo del modelo",
  asociacion: "Relación (no prueba causa)",
  contexto_descriptivo: "Dato de contexto",
};

const TYPE_GLOSSARY_KEYS: Record<EvidenceType, string> = {
  dato_medido: "evidencia_dato_medido",
  calculo_del_modelo: "evidencia_calculo_modelo",
  asociacion: "evidencia_asociacion",
  contexto_descriptivo: "evidencia_contexto",
};

const STRENGTH_LABELS: Record<Strength, string> = {
  fuerte: "Fuerte",
  moderada: "Moderada",
  debil: "Débil",
};

const STRENGTH_DOTS: Record<Strength, string> = {
  fuerte: "●●●",
  moderada: "●●○",
  debil: "●○○",
};

export function EvidenceBadge({ type, strength, className = "" }: EvidenceBadgeProps) {
  const typeLabel = TYPE_LABELS[type] ?? type;
  const typeGlossaryKey = (TYPE_GLOSSARY_KEYS[type] ?? "evidencia_dato_medido") as GlossaryKey;
  const strengthLabel = STRENGTH_LABELS[strength] ?? strength;
  const dots = STRENGTH_DOTS[strength] ?? "●●○";

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium border bg-muted/60 text-foreground border-border shrink-0 ${className}`}
    >
      <span className="inline-flex items-center gap-1">
        <span>{typeLabel}</span>
        <InfoTip term={typeGlossaryKey} size="xs" />
      </span>
      <span className="text-muted-foreground select-none" aria-hidden="true">
        ·
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="font-mono text-[10px] text-primary select-none" aria-hidden="true">
          {dots}
        </span>
        <span>{strengthLabel}</span>
        <InfoTip term={"fuerza_evidencia" as GlossaryKey} size="xs" />
      </span>
    </span>
  );
}
