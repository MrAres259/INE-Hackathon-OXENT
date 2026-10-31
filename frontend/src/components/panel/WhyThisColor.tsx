"use client";

import React, { useEffect, useState } from "react";
import { useAtalaya } from "@/lib/state";
import { getExplanation } from "@/lib/explain/api";
import { ExplainCard } from "@/components/explain/ExplainCard";
import type { Explanation, ExplainLevel } from "@/lib/explain/types";

export interface WhyThisColorProps {
  unitId: string;
  name: string;
  level: ExplainLevel;
}

export function WhyThisColor({ unitId, name, level }: WhyThisColorProps) {
  const atalaya = useAtalaya();
  const requestExplain = (atalaya as { requestExplain?: (req: { unitId: string; name: string; level: ExplainLevel }) => void })?.requestExplain;

  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);

    getExplanation(unitId, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setExplanation(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (controller.signal.aborted || (err as { name?: string })?.name === "AbortError") {
          return;
        }
        setError(true);
        setLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [unitId, retryNonce]);

  if (loading) {
    return (
      <div
        className="rounded-lg border border-border bg-card p-3 space-y-2 animate-pulse"
        data-testid="why-this-color-loading"
        aria-busy="true"
        aria-label="Cargando explicación de la zona"
      >
        <div className="h-4 bg-muted rounded w-3/4" />
        <div className="h-3 bg-muted rounded w-full" />
        <div className="h-3 bg-muted rounded w-5/6" />
      </div>
    );
  }

  if (error || !explanation) {
    return (
      <div
        className="rounded-lg border border-border bg-card p-3 text-xs flex items-center justify-between text-muted-foreground"
        data-testid="why-this-color-error"
      >
        <span>No pudimos cargar la explicación.</span>
        <button
          type="button"
          onClick={() => setRetryNonce((n) => n + 1)}
          className="text-primary hover:underline font-semibold cursor-pointer ml-2"
        >
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div data-testid="why-this-color-card">
      <ExplainCard
        explanation={explanation}
        variant="panel"
        onExplainInChat={() => {
          if (typeof requestExplain === "function") {
            requestExplain({ unitId, name, level });
          }
        }}
      />
    </div>
  );
}
