"use client";

import React, { useState } from "react";
import type {
  Explanation,
  ReasonKind,
  ScoreComponent,
  SuggestedQuestion,
} from "@/lib/explain/types";
import { EvidenceBadge } from "./EvidenceBadge";
import { SuggestedQuestions } from "./SuggestedQuestions";
import { InfoTip } from "@/components/ui/InfoTip";
import type { GlossaryKey } from "@/lib/glossary";

export interface ExplainCardProps {
  explanation: Explanation;
  variant: "chat" | "panel";
  onAsk?: (q: SuggestedQuestion) => void;
  onExplainInChat?: () => void;
  hideSuggestions?: boolean;
  className?: string;
}

function ReasonIcon({ kind }: { kind: ReasonKind }) {
  switch (kind) {
    case "historial":
      return (
        <svg className="size-4 text-primary shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    case "quien_no_vota":
      return (
        <svg className="size-4 text-primary shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      );
    case "urbano_rural":
      return (
        <svg className="size-4 text-primary shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
      );
    case "tendencia":
      return (
        <svg className="size-4 text-primary shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
        </svg>
      );
    case "volatilidad":
      return (
        <svg className="size-4 text-primary shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18" />
        </svg>
      );
    case "perfil_territorial":
      return (
        <svg className="size-4 text-primary shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      );
    case "contexto":
      return (
        <svg className="size-4 text-primary shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
        </svg>
      );
    case "confiabilidad":
      return (
        <svg className="size-4 text-primary shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
      );
    default:
      return (
        <svg className="size-4 text-primary shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
  }
}

function getCategoryMeta(cat: string): { color: string; label: string } {
  const norm = cat?.toLowerCase() || "";
  if (norm.includes("rojo") || norm.includes("critico") || norm.includes("crítico")) {
    return { color: "#c8352f", label: "Riesgo Crítico" };
  }
  if (norm.includes("naranja") || norm.includes("alto")) {
    return { color: "#ec7a2c", label: "Riesgo Alto" };
  }
  if (norm.includes("amarillo") || norm.includes("moderado")) {
    return { color: "#f2bf3a", label: "Riesgo Moderado" };
  }
  if (norm.includes("verde") || norm.includes("bajo")) {
    return { color: "#3f9a5b", label: "Riesgo Bajo" };
  }
  const cleanLabel = cat?.startsWith("Riesgo") ? cat : `Riesgo ${cat}`;
  return { color: "#bdbdbd", label: cleanLabel || "Sin dato" };
}

const SCORE_COMPONENT_CLASSES: Record<ScoreComponent["key"], string> = {
  abs: "bg-ink text-white",
  vuln: "bg-primary text-white",
  trend: "bg-muted-foreground text-white",
  vol: "bg-muted-foreground/40 text-foreground",
};

export function ExplainCard({
  explanation,
  variant,
  onAsk,
  onExplainInChat,
  hideSuggestions = false,
  className = "",
}: ExplainCardProps) {
  const [showAllReasons, setShowAllReasons] = useState(false);

  const { color: dotColor, label: categoryLabel } = getCategoryMeta(explanation.category);
  const displayName =
    explanation.state_name && explanation.state_name !== explanation.name
      ? `${explanation.name} (${explanation.state_name})`
      : explanation.name;

  const scoreAriaLabel = (explanation.score_breakdown || [])
    .map((s) => `${s.label}: ${s.points.toFixed(1)} puntos`)
    .join(", ");

  const filteredReasons = (explanation.reasons || []).filter((r) => r.kind !== "semaforo");
  const visibleReasons =
    variant === "panel" && !showAllReasons ? filteredReasons.slice(0, 3) : filteredReasons;

  return (
    <div
      className={`w-full rounded-xl border border-border bg-card shadow-xs text-xs space-y-3 ${
        variant === "chat" ? "p-3.5" : "p-3 space-y-2.5"
      } ${className}`}
    >
      {/* 1. Encabezado */}
      <div className="border-b border-border pb-2 space-y-1.5">
        {/* Fila 1: Punto de color + Nombre completo (puede ocupar 2 líneas, sin truncate) */}
        <div className="flex items-start gap-2 min-w-0">
          <span
            className="size-2.5 rounded-full shrink-0 mt-1"
            style={{ backgroundColor: dotColor }}
            aria-hidden="true"
          />
          <h3 className="font-bold text-sm text-foreground leading-snug break-words flex-1 min-w-0">
            {displayName}
          </h3>
        </div>

        {/* Fila 2: Chip de riesgo + Índice de riesgo + InfoTip */}
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-muted text-muted-foreground shrink-0">
            {categoryLabel}
          </span>
          {explanation.risk_score !== null && explanation.risk_score !== undefined && (
            <span className="text-[11px] text-muted-foreground font-normal shrink-0">
              Índice {explanation.risk_score.toFixed(1)} de 100
            </span>
          )}
          <InfoTip term={"explicacion_zona" as GlossaryKey} size="xs" />
        </div>
      </div>

      {/* 2. Headline */}
      {explanation.headline && (
        <p className="font-display font-bold text-sm text-foreground leading-snug">
          {explanation.headline}
        </p>
      )}

      {/* 3. En pocas palabras */}
      {explanation.in_short && explanation.in_short.length > 0 && (
        <div className="space-y-1">
          <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
            En pocas palabras
          </h4>
          <ul className="list-disc list-inside space-y-1 text-xs text-foreground">
            {explanation.in_short.map((bullet, idx) => (
              <li key={idx} className="leading-relaxed">
                {bullet}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 4. ¿Por qué este color? */}
      {explanation.score_breakdown && explanation.score_breakdown.length > 0 && (
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center gap-1">
            <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
              ¿Por qué este color?
            </h4>
            <InfoTip term={"puntos_indice" as GlossaryKey} size="xs" />
          </div>

          {/* Stacked Horizontal Bar */}
          <div
            role="img"
            aria-label={scoreAriaLabel}
            className="h-5 w-full flex overflow-hidden rounded-md border border-border bg-muted/40"
          >
            {explanation.score_breakdown.map((s) => {
              const widthPct = Math.max(0, s.points);
              return (
                <div
                  key={s.key}
                  style={{ width: `${widthPct}%` }}
                  className={`h-full flex items-center justify-center text-[9px] font-mono select-none transition-all ${
                    SCORE_COMPONENT_CLASSES[s.key] ?? "bg-primary/60 text-white"
                  }`}
                  title={`${s.label}: ${s.points.toFixed(1)} pts`}
                >
                  {widthPct >= 10 && <span className="truncate px-0.5">{s.points.toFixed(1)}</span>}
                </div>
              );
            })}
          </div>

          {/* Plain list underneath */}
          <ul className="space-y-1 text-xs text-muted-foreground pt-0.5">
            {explanation.score_breakdown.map((s) => (
              <li key={s.key} className="flex items-start gap-1.5 leading-relaxed">
                <span className="font-semibold text-foreground shrink-0">
                  {s.label} ({s.points.toFixed(1)} pts):
                </span>
                <span>{s.plain}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 5. Lo que muestran los datos */}
      {visibleReasons.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-border">
          <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
            Lo que muestran los datos
          </h4>
          <div className="space-y-2.5">
            {visibleReasons.map((reason) => (
              <div
                key={reason.id}
                className="p-2.5 rounded-lg border border-border/70 bg-card space-y-1.5"
              >
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <ReasonIcon kind={reason.kind} />
                    <span className="font-bold text-foreground text-xs">{reason.title}</span>
                  </div>
                  <EvidenceBadge type={reason.evidence_type} strength={reason.strength} />
                </div>
                <p className="text-xs text-foreground leading-relaxed">{reason.body}</p>
                {reason.source && (
                  <div className="text-[10px] text-muted-foreground font-mono">
                    Fuente: {reason.source}
                  </div>
                )}
              </div>
            ))}
          </div>

          {variant === "panel" && !showAllReasons && filteredReasons.length > 3 && (
            <button
              type="button"
              onClick={() => setShowAllReasons(true)}
              className="w-full mt-2 py-1 px-2.5 rounded-md border border-border bg-card hover:bg-muted text-foreground text-xs font-medium transition-colors cursor-pointer text-center"
            >
              Ver todas ({filteredReasons.length})
            </button>
          )}
        </div>
      )}

      {/* 6. Quiénes votan menos */}
      {explanation.groups && explanation.groups.length > 0 && (
        <div className="space-y-1.5 pt-2 border-t border-border">
          <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
            Quiénes votan menos
          </h4>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-xs min-w-[280px]">
              <thead>
                <tr className="bg-muted/60 border-b border-border text-[10px] uppercase font-semibold text-muted-foreground">
                  <th className="py-1.5 px-2">Grupo</th>
                  <th className="py-1.5 px-2 text-right">Votó (%)</th>
                  <th className="py-1.5 px-2 text-right">% de la lista</th>
                  <th className="py-1.5 px-2 text-right">% de abstención</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {explanation.groups.map((g, idx) => (
                  <tr key={idx} className="hover:bg-muted/30">
                    <td className="py-1 px-2 font-medium text-foreground">{g.group}</td>
                    <td className="py-1 px-2 text-right font-mono text-[11px]">
                      {g.suppressed ? (
                        <span className="inline-flex items-center gap-1 text-muted-foreground italic">
                          <span>Protegido</span>
                          <InfoTip
                            title="Dato protegido"
                            text="Dato suprimido para proteger la privacidad institucional (menos de 10 personas)."
                            size="xs"
                          />
                        </span>
                      ) : g.participation_pct !== null && g.participation_pct !== undefined ? (
                        `${g.participation_pct.toFixed(1)}%`
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-1 px-2 text-right font-mono text-[11px]">
                      {g.suppressed ? (
                        <span className="text-muted-foreground italic">Protegido</span>
                      ) : g.share_ln_pct !== null && g.share_ln_pct !== undefined ? (
                        `${g.share_ln_pct.toFixed(1)}%`
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-1 px-2 text-right font-mono text-[11px]">
                      {g.suppressed ? (
                        <span className="text-muted-foreground italic">Protegido</span>
                      ) : g.share_abstainers_pct !== null && g.share_abstainers_pct !== undefined ? (
                        `${g.share_abstainers_pct.toFixed(1)}%`
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 7. Lo que no sabemos */}
      {((explanation.what_we_dont_know && explanation.what_we_dont_know.length > 0) ||
        explanation.confidence) && (
        <div className="space-y-1.5 pt-2 border-t border-border">
          <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
            Lo que no sabemos
          </h4>
          {explanation.what_we_dont_know && explanation.what_we_dont_know.length > 0 && (
            <ul className="list-disc list-inside space-y-0.5 text-xs text-foreground">
              {explanation.what_we_dont_know.map((item, idx) => (
                <li key={idx} className="leading-relaxed">
                  {item}
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground pt-1">
            <span>Nivel de confianza:</span>
            <span className="font-semibold text-foreground capitalize">
              Confianza {explanation.confidence}
            </span>
            <InfoTip term={"confianza_explicacion" as GlossaryKey} size="xs" />
          </div>
          {explanation.confidence_note && (
            <p className="text-[11px] text-muted-foreground italic">
              {explanation.confidence_note}
            </p>
          )}
        </div>
      )}

      {/* 8. Recomendaciones */}
      {explanation.recommendations && explanation.recommendations.length > 0 && (
        <div className="space-y-1.5 pt-2 border-t border-border">
          <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
            Recomendaciones
          </h4>
          <ul className="space-y-1.5 text-xs">
            {explanation.recommendations.slice(0, 3).map((rec, rIdx) => (
              <li
                key={rIdx}
                className="p-2 rounded-md bg-muted/40 border border-border/60 space-y-0.5"
              >
                <div className="flex items-center justify-between gap-1.5">
                  <span className="font-semibold text-foreground">{rec.title}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-card border border-border text-muted-foreground uppercase font-mono">
                    Prioridad {rec.priority}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground">{rec.rationale}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 9. Scenario Note */}
      {explanation.scenario_note && (
        <p className="text-[10px] text-muted-foreground/80 italic pt-1">
          {explanation.scenario_note}
        </p>
      )}

      {/* 10. Actions according to variant */}
      {variant === "chat" &&
        !hideSuggestions &&
        onAsk &&
        explanation.suggested_questions &&
        explanation.suggested_questions.length > 0 && (
          <SuggestedQuestions questions={explanation.suggested_questions} onAsk={onAsk} />
        )}

      {variant === "panel" && onExplainInChat && (
        <div className="pt-2 border-t border-border mt-3">
          <button
            type="button"
            onClick={onExplainInChat}
            className="w-full py-2 px-3 rounded-lg bg-primary text-primary-foreground font-semibold text-xs hover:bg-primary/90 transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
          >
            <span>Explícamelo en el asistente</span>
            <svg
              className="size-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
