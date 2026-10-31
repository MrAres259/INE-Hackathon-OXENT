"use client";

import React from "react";
import type { SuggestedQuestion } from "@/lib/explain/types";
import { InfoTip } from "@/components/ui/InfoTip";
import type { GlossaryKey } from "@/lib/glossary";

export interface SuggestedQuestionsProps {
  questions: SuggestedQuestion[];
  onAsk: (q: SuggestedQuestion) => void;
  disabled?: boolean;
  className?: string;
}

export function SuggestedQuestions({
  questions,
  onAsk,
  disabled = false,
  className = "",
}: SuggestedQuestionsProps) {
  if (!questions || questions.length === 0) {
    return null;
  }

  const displayedQuestions = questions.slice(0, 6);

  return (
    <div className={`space-y-1.5 pt-2 ${className}`}>
      <div className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
        <span>Puedes preguntarme:</span>
        <InfoTip term={"preguntas_sugeridas" as GlossaryKey} size="xs" />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {displayedQuestions.map((q, idx) => (
          <button
            key={q.id || `sq-${idx}`}
            type="button"
            onClick={() => onAsk(q)}
            disabled={disabled}
            className="text-[11px] text-left px-2.5 py-1 rounded-full bg-card hover:bg-accent text-foreground hover:text-accent-foreground border border-border transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-2xs"
          >
            {q.text}
          </button>
        ))}
      </div>
    </div>
  );
}
