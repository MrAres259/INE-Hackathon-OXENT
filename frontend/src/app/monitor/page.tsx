"use client";

import React, { useEffect, useState } from "react";
import { IntelPageShell } from "@/components/intel/IntelPageShell";
import { OperatorGate } from "@/components/intel/OperatorGate";
import { InfoTip } from "@/components/ui/InfoTip";
import { getIntelStatus } from "@/lib/intel/api";
import type { IntelStatus } from "@/lib/intel/types";

export default function MonitorPage() {
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
                Monitor INE de Medios y Desinformación
              </h1>
              <InfoTip term="monitor_ine" size="sm" />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Detección de noticias críticas, verificación independiente y análisis de impacto en participación.
            </p>
          </div>

          {/* Engine & Cooldown status badge */}
          {status && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-border bg-card text-xs">
              <span
                className={`size-2 rounded-full ${
                  status.gemini_enabled ? "bg-good" : "bg-risk-mid"
                }`}
              />
              <span className="font-medium text-foreground">
                Monitor: {status.gemini_enabled ? "Activo" : "Modo degradado"}
              </span>
              <span className="text-muted-foreground font-mono">
                · Cooldown: {status.monitor_cooldown_min} min
              </span>
              <InfoTip term="veredicto" size="xs" />
            </div>
          )}
        </div>

        {/* Operator Gatekeeper */}
        <OperatorGate label="Acceso de operador para escanear">
          <div className="rounded-lg border border-primary/20 bg-primary-soft/50 p-4 text-xs space-y-2">
            <span className="font-bold text-primary">Modo operador habilitado</span>
            <p className="text-muted-foreground">
              Puedes ejecutar escaneos forzados de la web y redes, registrar resoluciones institucionales y emitir respuestas oficiales.
            </p>
          </div>
        </OperatorGate>

        {/* Skeleton placeholder banner */}
        <div className="rounded-xl border border-dashed border-border bg-card/40 p-12 text-center space-y-3">
          <div className="mx-auto size-12 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xl">
            📡
          </div>
          <h2 className="font-display text-lg font-bold text-foreground">
            En construcción
          </h2>
          <p className="text-xs text-muted-foreground max-w-md mx-auto leading-relaxed">
            El módulo de detección y clasificación de afirmaciones sobre el INE, evaluación de viralidad en redes,
            cálculo de impacto territorial en mapa 2D y registro inmutable de enterado se desplegará en la siguiente ola.
          </p>
        </div>
      </div>
    </IntelPageShell>
  );
}
