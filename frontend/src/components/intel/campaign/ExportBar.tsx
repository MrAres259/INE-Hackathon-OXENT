"use client";

import React, { useState } from "react";
import Link from "next/link";
import type { CampaignPlan } from "@/lib/intel/types";
import { exportCampaign, IntelApiError } from "@/lib/intel/api";
import { campaignPrefillUrl } from "@/lib/intel/prefill";
import { type PlanDrafts, buildExportSlidesOverride } from "./campaignDraft";

export interface ExportBarProps {
  plan: CampaignPlan;
  drafts: PlanDrafts;
  className?: string;
}

export function ExportBar({ plan, drafts, className = "" }: ExportBarProps) {
  const [downloadingFormat, setDownloadingFormat] = useState<"pptx" | "pdf" | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleExport = async (format: "pptx" | "pdf") => {
    setDownloadingFormat(format);
    setErrorMessage(null);

    try {
      const slidesOverride = buildExportSlidesOverride(plan, drafts);

      const { blob, filename } = await exportCampaign({
        plan_id: plan.id,
        format,
        slides: slidesOverride,
      });

      // Trigger browser download via object URL
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err: unknown) {
      if (err instanceof IntelApiError) {
        if (err.status === 429 && err.retryAfterS) {
          setErrorMessage(
            `Límite de descargas alcanzado. Por favor espera ${Math.ceil(err.retryAfterS)} segundos antes de reintentar.`
          );
        } else {
          setErrorMessage(err.detail);
        }
      } else if (err instanceof Error) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage("Ocurrió un error al generar el archivo de exportación.");
      }
    } finally {
      setDownloadingFormat(null);
    }
  };

  const prefillUrl = campaignPrefillUrl({
    campaigns: plan.impact?.campaigns || [],
  });

  const zoneMapUrl = `/?zona=${encodeURIComponent(plan.unit.unit_id)}`;

  return (
    <div
      className={`rounded-2xl border border-border bg-card/95 backdrop-blur-md p-3.5 shadow-float space-y-2.5 ${className}`}
    >
      {/* Rate limit / Export error notification */}
      {errorMessage && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span>⚠️</span>
            <span className="font-medium">{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-xs hover:underline cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2.5">
        {/* Left: Map Navigation Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={prefillUrl}
            className="h-8 px-3 rounded-lg bg-good/15 hover:bg-good/25 text-good border border-good/30 text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer"
            title="Abre el mapa con las campañas calculadas precargadas en el escenario de intervención"
          >
            <span>🗺️</span>
            <span>Simular en el mapa</span>
          </Link>

          <Link
            href={zoneMapUrl}
            className="h-8 px-3 rounded-lg border border-border bg-muted/50 hover:bg-accent text-xs font-medium text-foreground transition-colors flex items-center gap-1.5 cursor-pointer"
            title="Localizar la unidad en el mapa principal"
          >
            <span>📍</span>
            <span>Ver zona en el mapa</span>
          </Link>
        </div>

        {/* Right: PPTX / PDF Downloads */}
        <div className="flex items-center gap-2">
          {/* PPTX Export Button */}
          <button
            type="button"
            disabled={downloadingFormat !== null}
            onClick={() => handleExport("pptx")}
            className="h-8 px-3.5 rounded-lg border border-primary/30 bg-primary/10 hover:bg-primary/20 text-primary text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            aria-label="Descargar presentación editable en formato PowerPoint (.pptx)"
          >
            {downloadingFormat === "pptx" ? (
              <>
                <svg className="animate-spin size-3.5 text-primary" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                <span>Generando PPTX...</span>
              </>
            ) : (
              <>
                <span>📊</span>
                <span>Descargar PPTX</span>
              </>
            )}
          </button>

          {/* PDF Export Button */}
          <button
            type="button"
            disabled={downloadingFormat !== null}
            onClick={() => handleExport("pdf")}
            className="h-8 px-3.5 rounded-lg bg-primary hover:bg-primary/90 text-white text-xs font-semibold shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            aria-label="Descargar presentación ejecutiva en formato PDF"
          >
            {downloadingFormat === "pdf" ? (
              <>
                <svg className="animate-spin size-3.5 text-white" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                <span>Generando PDF...</span>
              </>
            ) : (
              <>
                <span>📄</span>
                <span>Descargar PDF</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
