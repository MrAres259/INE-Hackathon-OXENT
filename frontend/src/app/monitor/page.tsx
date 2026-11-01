// ATALAYA Intel - Monitor Page
"use client";

import React, { useEffect, useState, useMemo, useCallback } from "react";
import { IntelPageShell } from "@/components/intel/IntelPageShell";
import { getIntelStatus, getMonitor, scanMonitor, pollJob, IntelApiError } from "@/lib/intel/api";
import type { MonitorSnapshot, IntelStatus, Job, RegistryEntry } from "@/lib/intel/types";
import {
  INITIAL_MONITOR_FILTERS,
  filterNewsItems,
  countByTab,
  type MonitorFilterState,
} from "@/components/intel/monitor/monitorFilters";
import { MonitorHeader } from "@/components/intel/monitor/MonitorHeader";
import { NewsFilters } from "@/components/intel/monitor/NewsFilters";
import { NewsList } from "@/components/intel/monitor/NewsList";
import { NewsDetail } from "@/components/intel/monitor/NewsDetail";

export default function MonitorPage() {
  const [status, setStatus] = useState<IntelStatus | null>(null);
  const [snapshot, setSnapshot] = useState<MonitorSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  const [filters, setFilters] = useState<MonitorFilterState>(INITIAL_MONITOR_FILTERS);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  const [isScanning, setIsScanning] = useState(false);
  const [activeJob, setActiveJob] = useState<Job<MonitorSnapshot> | null>(null);
  const [cooldownMessage, setCooldownMessage] = useState<string | null>(null);

  const applySnapshot = useCallback((sn: MonitorSnapshot) => {
    setSnapshot(sn);
    if (sn.items && sn.items.length > 0) {
      const { verificadas, rumores } = countByTab(sn.items);
      if (verificadas === 0 && rumores > 0) {
        setFilters((prev) => ({ ...prev, tab: "rumores" }));
        const firstRumor = sn.items.find((i) => i.verdict === "falsa" || i.verdict === "sin_verificar");
        setSelectedItemId(firstRumor ? firstRumor.id : sn.items[0].id);
      } else if (rumores === 0 && verificadas > 0) {
        setFilters((prev) => ({ ...prev, tab: "verificadas" }));
        const firstVerif = sn.items.find((i) => i.verdict === "verdadera" || i.verdict === "enganosa");
        setSelectedItemId(firstVerif ? firstVerif.id : sn.items[0].id);
      } else {
        setSelectedItemId(sn.items[0].id);
      }
    }
  }, []);

  // Load initial status and monitor snapshot
  useEffect(() => {
    let mounted = true;

    Promise.all([
      getIntelStatus().catch(() => null),
      getMonitor().catch(() => null),
    ]).then(([st, sn]) => {
      if (!mounted) return;
      if (st) setStatus(st);
      if (sn) {
        applySnapshot(sn);
      }
      setLoading(false);
    });

    return () => {
      mounted = false;
    };
  }, [applySnapshot]);

  // Compute tab counts and filtered items
  const allItems = useMemo(() => snapshot?.items ?? [], [snapshot]);
  const tabCounts = useMemo(() => countByTab(allItems), [allItems]);
  const filteredItems = useMemo(() => filterNewsItems(allItems, filters), [allItems, filters]);

  // Selected item object
  const selectedItem = useMemo(() => {
    if (selectedItemId) {
      const found = allItems.find((i) => i.id === selectedItemId);
      if (found) return found;
    }
    return filteredItems[0] ?? allItems[0] ?? null;
  }, [selectedItemId, allItems, filteredItems]);

  // Operator scan handler
  const handleScan = async (windowDays: 7 | 14 | 30) => {
    setIsScanning(true);
    setCooldownMessage(null);

    try {
      const res = await scanMonitor({ window_days: windowDays, refresh: true });

      if ("snapshot" in res) {
        applySnapshot(res.snapshot);
      } else if ("id" in res) {
        setActiveJob(res);
        const finalJob = await pollJob<MonitorSnapshot>(res.id, {
          onUpdate: (j) => setActiveJob(j),
        });

        if (finalJob.status === "done" && finalJob.result) {
          applySnapshot(finalJob.result);
        } else if (finalJob.error) {
          setCooldownMessage(finalJob.error);
        }
      }
    } catch (err: any) {
      if (err instanceof IntelApiError && (err.status === 429 || err.retryAfterS)) {
        const mins = err.retryAfterS ? Math.ceil(err.retryAfterS / 60) : 15;
        setCooldownMessage(`Podrás escanear de nuevo en ${mins} min.`);
      } else {
        setCooldownMessage(
          err?.detail || err?.message || "No fue posible ejecutar el escaneo del monitor."
        );
      }
    } finally {
      setIsScanning(false);
      setActiveJob(null);
    }
  };

  // Status updated callback from RegistryControl
  const handleStatusUpdated = (entry: RegistryEntry) => {
    if (!snapshot) return;

    const updatedItems = snapshot.items.map((it) => {
      if (it.id === entry.item_id) {
        return {
          ...it,
          status: entry,
        };
      }
      return it;
    });

    setSnapshot({
      ...snapshot,
      items: updatedItems,
    });
  };

  return (
    <IntelPageShell>
      <div className="space-y-6 py-2">
        {/* Monitor Header with KPIs, engine status, and scan controls */}
        <MonitorHeader
          snapshot={snapshot}
          status={status}
          isScanning={isScanning}
          activeJob={activeJob}
          onScan={handleScan}
          cooldownMessage={cooldownMessage}
        />

        {/* Loading skeleton */}
        {loading && (
          <div className="p-12 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
            <svg className="animate-spin size-4 text-primary" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            <span>Cargando datos del Monitor INE...</span>
          </div>
        )}

        {/* Main Content Area: List + Detail */}
        {!loading && snapshot && allItems.length > 0 && (
          <div className="space-y-4">
            {/* Desktop Layout (>= 1280px) and Mobile list when detail is closed */}
            <div className="xl:grid xl:grid-cols-12 xl:gap-6 items-start">
              {/* Left Column: Filters and News List */}
              <div
                className={`xl:col-span-5 2xl:col-span-4 space-y-4 ${
                  mobileDetailOpen ? "hidden xl:block" : "block"
                }`}
              >
                <div data-tour="mon-filtros">
                  <NewsFilters
                    filters={filters}
                    onChange={setFilters}
                    counts={tabCounts}
                  />
                </div>

                <div data-tour="mon-lista">
                  <NewsList
                    items={filteredItems}
                    selectedId={selectedItem?.id ?? null}
                    onSelect={(item) => {
                      setSelectedItemId(item.id);
                      setMobileDetailOpen(true);
                    }}
                  />
                </div>
              </div>

              {/* Right Column: Detail View */}
              <div
                className={`xl:col-span-7 2xl:col-span-8 ${
                  !mobileDetailOpen ? "hidden xl:block" : "block"
                }`}
              >
                {selectedItem ? (
                  <NewsDetail
                    item={selectedItem}
                    onStatusUpdated={handleStatusUpdated}
                    onMobileBack={() => setMobileDetailOpen(false)}
                  />
                ) : (
                  <div className="rounded-xl border border-dashed border-border p-12 text-center text-xs text-muted-foreground">
                    Selecciona una noticia o rumor de la lista para ver el diagnóstico detallado, impacto territorial y remediación sugerida.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </IntelPageShell>
  );
}
