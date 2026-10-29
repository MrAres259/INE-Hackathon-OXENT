// ATALAYA Intel - Registry Control Component
"use client";

import React, { useState } from "react";
import type { NewsItem, RegistryEntry, RegistryState } from "@/lib/intel/types";
import { REGISTRY_STATE_LABELS } from "@/lib/intel/labels";
import { InfoTip } from "@/components/ui/InfoTip";
import { postRegistry, getRegistry } from "@/lib/intel/api";
import { useOperator } from "@/lib/intel/operator";

export interface RegistryControlProps {
  item: NewsItem;
  onStatusUpdated?: (entry: RegistryEntry) => void;
  className?: string;
}

const OPERATOR_STATES: RegistryState[] = [
  "enterado",
  "comunicado_emitido",
  "campana_planeada",
  "respondida",
  "reportada",
  "descartada",
];

export function RegistryControl({
  item,
  onStatusUpdated,
  className = "",
}: RegistryControlProps) {
  const { isOperator } = useOperator();

  const [currentStatus, setCurrentStatus] = useState<RegistryState>(
    item.status?.status ?? "pendiente"
  );
  const [currentDate, setCurrentDate] = useState<string | null>(item.status?.at ?? null);
  const [currentActor, setCurrentActor] = useState<string>(item.status?.actor ?? "sistema");

  const [selectedNextState, setSelectedNextState] = useState<RegistryState | null>(null);
  const [note, setNote] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState(false);

  // History state
  const [showHistory, setShowHistory] = useState(false);
  const [historyList, setHistoryList] = useState<RegistryEntry[] | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const statusMeta = REGISTRY_STATE_LABELS[currentStatus] ?? REGISTRY_STATE_LABELS.pendiente;

  const handleSelectState = (st: RegistryState) => {
    setSelectedNextState(st);
    setShowConfirm(false);
    setError(null);
  };

  const handleConfirmSubmit = async () => {
    if (!selectedNextState) return;
    setSubmitting(true);
    setError(null);

    try {
      const entry = await postRegistry({
        item_id: item.id,
        kind: "news",
        status: selectedNextState,
        note: note.trim(),
        actor: "operador",
      });

      setCurrentStatus(entry.status);
      setCurrentDate(entry.at);
      setCurrentActor(entry.actor);
      setSelectedNextState(null);
      setNote("");
      setShowConfirm(false);
      setSuccessNotice(true);
      setTimeout(() => setSuccessNotice(false), 4000);

      onStatusUpdated?.(entry);

      // Refresh history if open
      if (showHistory) {
        loadHistory();
      }
    } catch (err: any) {
      setError(err?.detail || err?.message || "No fue posible registrar la actuación institucional.");
    } finally {
      setSubmitting(false);
    }
  };

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const entries = await getRegistry(item.id);
      setHistoryList(entries);
    } catch {
      // Ignore
    } finally {
      setLoadingHistory(false);
    }
  };

  const toggleHistory = () => {
    if (!showHistory && !historyList) {
      loadHistory();
    }
    setShowHistory((prev) => !prev);
  };

  const formattedDate = currentDate
    ? new Date(currentDate).toLocaleString("es-MX", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Sin registro previo";

  return (
    <div className={`space-y-3.5 rounded-xl border border-border bg-card p-4 ${className}`} data-testid="registry-control">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/80 pb-3">
        <div className="flex items-center gap-2">
          <h4 className="font-display text-sm font-bold text-foreground">
            Registro de actuación institucional
          </h4>
          <InfoTip term="registro_ine" size="sm" />
        </div>

        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">Estado actual:</span>
          <span
            className="font-bold px-2 py-0.5 rounded-full border border-border"
            style={{ color: statusMeta.color }}
            data-testid="current-registry-status"
          >
            {statusMeta.label}
          </span>
        </div>
      </div>

      {/* Institutional Assurance Badge */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/80 bg-muted/20 p-2.5 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-good font-bold">✓</span>
          <span className="font-semibold text-foreground">
            Queda registrado que el INE está al tanto
          </span>
        </div>
        <div className="text-[11px] text-muted-foreground font-mono">
          <span>{formattedDate}</span>
          {currentActor && <span> · Por: {currentActor}</span>}
        </div>
      </div>

      {/* Success alert */}
      {successNotice && (
        <div className="rounded-lg border border-good/40 bg-good/10 p-2.5 text-xs text-good font-semibold flex items-center gap-2">
          <span>✓</span>
          <span>Actuación registrada exitosamente en la bitácora inmutable.</span>
        </div>
      )}

      {/* Operator controls */}
        <div className="space-y-3 pt-1">
          <div className="space-y-1.5 text-xs">
            <span className="font-semibold text-foreground">
              Actualizar estado de atención:
            </span>
            <div className="flex flex-wrap gap-1.5">
              {OPERATOR_STATES.map((st) => {
                const meta = REGISTRY_STATE_LABELS[st];
                const isSelected = selectedNextState === st;
                return (
                  <button
                    key={st}
                    type="button"
                    onClick={() => handleSelectState(st)}
                    className={`px-2.5 py-1 text-xs rounded-md border font-medium transition-colors cursor-pointer ${
                      isSelected
                        ? "bg-primary text-white border-primary shadow-xs"
                        : "bg-muted text-foreground border-border hover:border-primary/40"
                    }`}
                    data-testid={`btn-state-${st}`}
                  >
                    {meta.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Note & Inline Confirmation Form */}
          {selectedNextState && (
            <div className="space-y-2.5 p-3 rounded-lg border border-primary/30 bg-primary-soft/20 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-primary">
                  Registrar cambio a: "{REGISTRY_STATE_LABELS[selectedNextState]?.label}"
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {note.length} / 500 caracteres
                </span>
              </div>

              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 500))}
                placeholder="Añadir nota institucional u observaciones de la actuación (opcional)..."
                rows={2}
                className="w-full p-2 text-xs rounded border border-border bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                data-testid="registry-note-input"
              />

              {error && (
                <div className="text-destructive font-medium text-[11px]">
                  {error}
                </div>
              )}

              {/* Inline Confirmation state */}
              {!showConfirm ? (
                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedNextState(null);
                      setNote("");
                    }}
                    className="px-2.5 py-1 rounded text-xs text-muted-foreground hover:text-foreground"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowConfirm(true)}
                    className="px-3.5 py-1 rounded bg-primary text-white font-semibold text-xs hover:bg-primary-hover cursor-pointer"
                    data-testid="btn-save-registry-trigger"
                  >
                    Guardar registro
                  </button>
                </div>
              ) : (
                <div className="rounded border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs flex flex-wrap items-center justify-between gap-2">
                  <span className="text-amber-900 dark:text-amber-200 font-medium">
                    ¿Confirmas asentar este estado en la bitácora inalterable?
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowConfirm(false)}
                      disabled={submitting}
                      className="px-2.5 py-1 text-xs rounded border border-border bg-card text-muted-foreground hover:text-foreground"
                    >
                      Regresar
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmSubmit}
                      disabled={submitting}
                      className="px-3 py-1 text-xs rounded bg-primary text-white font-bold hover:bg-primary-hover disabled:opacity-50 cursor-pointer"
                      data-testid="btn-confirm-registry"
                    >
                      {submitting ? "Guardando..." : "Confirmar e inscribir"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

      {/* History Toggle & Display */}
      <div className="pt-2 border-t border-border/80">
        <button
          type="button"
          onClick={toggleHistory}
          className="text-xs font-medium text-primary hover:underline flex items-center gap-1 cursor-pointer"
        >
          <span>{showHistory ? "Ocultar historial de actuaciones" : "Ver historial de actuaciones"}</span>
          <span>{showHistory ? "▲" : "▼"}</span>
        </button>

        {showHistory && (
          <div className="mt-2 space-y-2 text-xs">
            {loadingHistory && (
              <span className="text-muted-foreground">Cargando historial...</span>
            )}

            {!loadingHistory && (!historyList || historyList.length === 0) && (
              <span className="text-muted-foreground">No hay registros previos en la bitácora.</span>
            )}

            {historyList && historyList.length > 0 && (
              <ul className="divide-y divide-border/60 rounded-lg border border-border bg-card p-2 space-y-1.5">
                {historyList.map((entry, idx) => (
                  <li key={entry.at || idx} className="pt-1.5 first:pt-0 space-y-0.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-semibold" style={{ color: REGISTRY_STATE_LABELS[entry.status]?.color }}>
                        {REGISTRY_STATE_LABELS[entry.status]?.label ?? entry.status}
                      </span>
                      <span className="text-muted-foreground font-mono text-[10px]">
                        {new Date(entry.at).toLocaleString("es-MX")}
                      </span>
                    </div>
                    {entry.actor && (
                      <span className="text-[10px] text-muted-foreground">Registrado por: {entry.actor}</span>
                    )}
                    {entry.note && (
                      <p className="text-[11px] text-foreground/80 italic pl-2 border-l border-primary/30">
                        "{entry.note}"
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
