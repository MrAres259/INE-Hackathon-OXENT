"use client";

import React from "react";
import type { EvidenceType, Strength } from "@/lib/explain/types";
import { InfoTip } from "@/components/ui/InfoTip";
import type { GlossaryKey } from "@/lib/glossary";

export interface EvidenceBadgeProps {
  type: EvidenceType;
  strength: Strength;
  size?: "default" | "compact";
  className?: string;
}

const TYPE_LABELS: Record<EvidenceType, string> = {
  dato_medido: "Dato medido",
  calculo_del_modelo: "Cálculo del modelo",
  asociacion: "Relación (no prueba causa)",
  contexto_descriptivo: "Dato de contexto",
};

const SHORT_TYPE_LABELS: Record<EvidenceType, string> = {
  dato_medido: "Dato medido",
  calculo_del_modelo: "Modelo",
  asociacion: "Relación",
  contexto_descriptivo: "Contexto",
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

export function EvidenceBadge({
  type,
  strength,
  size = "default",
  className = "",
}: EvidenceBadgeProps) {
  const typeLabel = TYPE_LABELS[type] ?? type;
  const shortLabel = SHORT_TYPE_LABELS[type] ?? typeLabel;
  const typeGlossaryKey = (TYPE_GLOSSARY_KEYS[type] ?? "evidencia_dato_medido") as GlossaryKey;
  const strengthLabel = STRENGTH_LABELS[strength] ?? strength;
  const dots = STRENGTH_DOTS[strength] ?? "●●○";
  const fullLabel = `${typeLabel} · evidencia ${strengthLabel.toLowerCase()}`;

  if (size === "compact") {
    return (
      <span
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-medium border bg-muted/60 text-foreground border-border shrink-0 whitespace-nowrap leading-none ${className}`}
        aria-label={fullLabel}
        title={fullLabel}
      >
        <span className="inline-flex items-center gap-0.5">
          <span>{shortLabel}</span>
          <InfoTip term={typeGlossaryKey} size="xs" />
        </span>
        <span className="font-mono text-[10px] text-primary select-none ml-0.5" aria-hidden="true">
          {dots}
        </span>
      </span>
    );
  }

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
