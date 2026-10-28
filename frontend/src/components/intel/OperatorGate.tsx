"use client";

import React, { useState } from "react";
import { useOperator } from "@/lib/intel/operator";
import { IntelApiError } from "@/lib/intel/api";
import { InfoTip } from "@/components/ui/InfoTip";

export interface OperatorGateProps {
  children?: React.ReactNode;
  fallback?: React.ReactNode;
  label?: string;
  onVerified?: () => void;
  className?: string;
}

export function OperatorGate({
  children,
  fallback,
  label = "Modo operador",
  onVerified,
  className = "",
}: OperatorGateProps) {
  const { isOperator, verify, logout } = useOperator();
  const [isOpen, setIsOpen] = useState(false);
  const [candidateToken, setCandidateToken] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const handleOpen = () => {
    setErrorMsg(null);
    setCandidateToken("");
    setIsOpen(true);
  };

  const handleClose = () => {
    if (verifying) return;
    setIsOpen(false);
    setErrorMsg(null);
    setCandidateToken("");
  };

  const handleVerify = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = candidateToken.trim();
    if (!trimmed) {
      setErrorMsg("Por favor introduce una clave de operador.");
      return;
    }

    setVerifying(true);
    setErrorMsg(null);
    try {
      await verify(trimmed);
      setIsOpen(false);
      setCandidateToken("");
      onVerified?.();
    } catch (err: unknown) {
      if (err instanceof IntelApiError) {
        setErrorMsg(err.detail);
      } else if (err instanceof Error) {
        setErrorMsg(err.message);
      } else {
        setErrorMsg("Error al validar la clave de operador.");
      }
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Operator Status Header / Action */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-lg border border-border bg-card/60 text-xs">
        <div className="flex items-center gap-2">
          <span
            className={`size-2.5 rounded-full ${
              isOperator ? "bg-good" : "bg-muted-foreground"
            }`}
          />
          <span className="font-semibold text-foreground">
            {isOperator ? "Modo operador activo" : "Funciones de operador restringidas"}
          </span>
          <InfoTip term="clave_operador" size="xs" />
        </div>

        {isOperator ? (
          <button
            type="button"
            onClick={logout}
            className="h-7 px-2.5 rounded border border-border bg-muted/60 hover:bg-accent text-muted-foreground hover:text-foreground text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5"
            title="Cerrar sesión de operador"
          >
            <svg className="size-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            <span>Salir del modo operador</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={handleOpen}
            className="h-7 px-3 rounded bg-primary text-white hover:bg-primary/90 text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 shadow-xs"
          >
            <svg className="size-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <span>{label}</span>
          </button>
        )}
      </div>

      {/* Render children if operator, else fallback */}
      {isOperator ? children : fallback}

      {/* Verification Modal Dialog */}
      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="operator-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs animate-in fade-in duration-200"
        >
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id="operator-dialog-title" className="font-display text-base font-bold text-foreground">
                  Autenticación de Operador
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Introduce la clave institucional configurada en el servidor (ATALAYA_OPERATOR_TOKEN).
                </p>
              </div>
              <InfoTip term="clave_operador" size="sm" />
            </div>

            <form onSubmit={handleVerify} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="operator-token-input" className="block text-xs font-semibold text-foreground">
                  Clave de operador
                </label>
                <input
                  id="operator-token-input"
                  type="password"
                  autoFocus
                  value={candidateToken}
                  onChange={(e) => setCandidateToken(e.target.value)}
                  placeholder="••••••••••••"
                  className="h-9 w-full rounded-md border border-border bg-background px-3 text-xs text-foreground placeholder:text-muted-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15"
                />
              </div>

              {/* Backend Error Display */}
              {errorMsg && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive flex items-start gap-2">
                  <span className="shrink-0 text-sm">⚠️</span>
                  <span className="font-medium leading-relaxed">{errorMsg}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={verifying}
                  className="h-8 px-3 rounded-md border border-border hover:bg-accent text-xs font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={verifying || !candidateToken.trim()}
                  className="h-8 px-4 rounded-md bg-primary hover:bg-primary/90 text-xs font-semibold text-white transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                >
                  {verifying ? (
                    <>
                      <svg className="animate-spin size-3.5 text-white" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                      </svg>
                      <span>Verificando...</span>
                    </>
                  ) : (
                    <span>Verificar clave</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
