"use client";

import React, { useEffect, useState } from "react";
import { IntelPageShell } from "@/components/intel/IntelPageShell";
import { OperatorGate } from "@/components/intel/OperatorGate";
import { InfoTip } from "@/components/ui/InfoTip";
import { getIntelStatus } from "@/lib/intel/api";
import type { IntelStatus } from "@/lib/intel/types";

export default function CampanasPage() {
  const [status, setStatus] = useState<IntelStatus | null>(null);

  useEffect(() => {
    getIntelStatus().then((s) => setStatus(s)).catch(() => {});
  }, []);

  return (
    <IntelPageShell>
      <div className="space-y-6 py-2">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/80 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-2xl font-bold text-foreground">
                Plan de campaña con IA
              </h1>
              <InfoTip term="plan_campana" size="sm" />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Investigación en fuentes verificadas y planeación estratégica de intervenciones electorales.
            </p>
          </div>

          {/* Engine & Budget status badge */}
          {status && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-border bg-card text-xs">
              <span
                className={`size-2 rounded-full ${
                  status.gemini_enabled ? "bg-good" : "bg-risk-mid"
                }`}
              />
              <span className="font-medium text-foreground">
                Gemini: {status.gemini_enabled ? "Activo" : "Deshabilitado"}
              </span>
              <span className="text-muted-foreground font-mono">
                · {status.budget_used} / {status.budget_limit} consultas
              </span>
              <InfoTip term="investigacion_gemini" size="xs" />
            </div>
          )}
        </div>

        {/* Operator Gatekeeper */}
        <OperatorGate label="Acceso de operador para planear">
          <div className="rounded-lg border border-primary/20 bg-primary-soft/50 p-4 text-xs space-y-2">
            <span className="font-bold text-primary">Modo operador habilitado</span>
            <p className="text-muted-foreground">
              Puedes lanzar investigaciones asistidas por IA y regenerar planes de campaña para cualquier unidad territorial.
            </p>
          </div>
        </OperatorGate>

        {/* Skeleton placeholder banner */}
        <div className="rounded-xl border border-dashed border-border bg-card/40 p-12 text-center space-y-3">
          <div className="mx-auto size-12 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xl">
            🛠️
          </div>
          <h2 className="font-display text-lg font-bold text-foreground">
            En construcción
          </h2>
          <p className="text-xs text-muted-foreground max-w-md mx-auto leading-relaxed">
            El módulo de investigación documental con Gemini 3.8 Flash, síntesis de causas de abstención,
            generación de propuestas con GLM-5.3 y exportación a diapositivas (PPTX/PDF) se desplegará en la siguiente ola.
          </p>
        </div>
      </div>
    </IntelPageShell>
  );
}
