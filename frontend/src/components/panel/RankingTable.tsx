"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useAtalaya } from "@/lib/state";
import { getRanking } from "@/lib/api";
import type { RiskItem, Level, Category } from "@/lib/types";
import { InfoTip } from "@/components/ui/InfoTip";
import {
  formatPct,
  formatInt,
  formatDeltaPp,
  generateRankingCsv,
  sortRankingItems,
  getAbstencionEsperada,
  type RankingSortKey,
} from "@/lib/format";
import {
  filterRankingBySemaforo,
  CATEGORY_STYLES,
  CATEGORY_ORDER,
} from "@/lib/panelStats";

type ExtendedSortKey = RankingSortKey | "abst" | "delta";

export function RankingTable() {
  const {
    level: contextLevel,
    selectedEnt,
    selectedRegionId,
    scenario,
    selectRegion,
    meta,
    simulationResult,
  } = useAtalaya();

  const [level, setLevel] = useState<Level>(contextLevel);
  const [entFilter, setEntFilter] = useState<string>(selectedEnt ?? "");
  const [sortBy, setSortBy] = useState<ExtendedSortKey>("risk");
  const [filterCategory, setFilterCategory] = useState<Category | null>(null);
  const [items, setItems] = useState<RiskItem[]>([]);
  const [loading, setLoading] = useState(false);

  // Sync level/ent with global state when changed
  useEffect(() => {
    setLevel(contextLevel);
  }, [contextLevel]);

  useEffect(() => {
    if (selectedEnt) setEntFilter(selectedEnt);
  }, [selectedEnt]);

  useEffect(() => {
    // If scenario != base and simulationResult is available for this level
    if (scenario !== "base" && simulationResult && simulationResult.level === level) {
      let filtered = simulationResult.items.filter((item) => item.category !== "sin_dato");
      if (level === "mun" && entFilter) {
        filtered = filtered.filter((item) => item.ent === entFilter);
      }
      setItems(filtered.slice(0, 30));
      return;
    }

    setLoading(true);
    getRanking(level, entFilter || undefined, scenario, 30)
      .then((res) => {
        const valid = res.items.filter((item) => item.category !== "sin_dato");
        setItems(valid);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [level, entFilter, scenario, simulationResult]);

  // Local filter by semaforo chips
  const filteredItems = useMemo(() => {
    return filterRankingBySemaforo(items, filterCategory);
  }, [items, filterCategory]);

  // Sort items
  const sortedItems = useMemo(() => {
    if (sortBy === "abst") {
      return [...filteredItems].sort((a, b) => (b.pred_abstention ?? 0) - (a.pred_abstention ?? 0)).slice(0, 20);
    }
    if (sortBy === "delta") {
      return [...filteredItems].sort((a, b) => (a.delta_vs_base_pp ?? 0) - (b.delta_vs_base_pp ?? 0)).slice(0, 20);
    }
    return sortRankingItems(filteredItems, sortBy as RankingSortKey).slice(0, 20);
  }, [filteredItems, sortBy]);

  const handleExportCsv = () => {
    const csvContent = generateRankingCsv(sortedItems);
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `ranking_riesgo_atalaya_${level}_${scenario}_${sortBy}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleSortClick = (key: ExtendedSortKey) => {
    setSortBy(key);
  };

  return (
    <div className="space-y-4">
      {/* Header & Controls */}
      <div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <h3 className="font-display text-base font-bold text-foreground">Ranking de priorización</h3>
            <InfoTip term="prioridad" size="xs" />
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={sortedItems.length === 0}
              className="h-7 border border-border bg-card hover:bg-accent text-foreground text-xs px-2.5 rounded-md transition-colors flex items-center gap-1.5 disabled:opacity-50 cursor-pointer shadow-xs"
            >
              <svg className="w-3.5 h-3.5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              <span>CSV</span>
            </button>
            <InfoTip term="ranking.csv" size="xs" />
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          Top 20 zonas con mayor índice de vulnerabilidad y abstención potencial. Toca o haz clic en una fila para ubicarla en el mapa.
        </p>
        {scenario !== "base" && (
          <p className="text-[11px] text-muted-foreground mt-1">
            Cambio vs base: <span className="text-good font-semibold">(negativo = menos abstención)</span>
          </p>
        )}
      </div>

      {/* Filter & Sort Toolbar */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {/* Level segmented control */}
            <div className="inline-flex rounded-lg p-0.5 bg-muted border border-border text-xs">
              <button
                type="button"
                onClick={() => setLevel("state")}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                  level === "state"
                    ? "bg-card text-primary shadow-xs font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Estados
              </button>
              <button
                type="button"
                onClick={() => setLevel("mun")}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                  level === "mun"
                    ? "bg-card text-primary shadow-xs font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Municipios
              </button>
            </div>

            {/* State selector for municipalities */}
            {level === "mun" && meta?.states && (
              <select
                value={entFilter}
                onChange={(e) => setEntFilter(e.target.value)}
                className="bg-card border border-border rounded-lg px-2.5 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">Todas las entidades</option>
                {meta.states.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Sort selector dropdown */}
          <div className="flex items-center gap-1.5 text-xs text-foreground">
            <span className="text-[11px] text-muted-foreground hidden sm:inline">Ordenar:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as ExtendedSortKey)}
              className="bg-card border border-border rounded-lg px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="risk">Índice de riesgo</option>
              <option value="abstencion_esperada">Abstención esperada</option>
              <option value="abst">Abstención pronosticada</option>
              {scenario !== "base" && <option value="delta">Cambio Δ vs base</option>}
              <option value="prioridad">Prioridad estratégica</option>
            </select>
            <InfoTip term="ranking.orden" size="xs" />
          </div>
        </div>

        {/* Semáforo Filter Chips */}
        <div className="flex flex-wrap items-center gap-1 pt-1">
          <span className="text-[11px] text-muted-foreground mr-1">Filtrar:</span>
          {CATEGORY_ORDER.map((cat) => {
            const active = filterCategory === cat;
            const style = CATEGORY_STYLES[cat];
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setFilterCategory(active ? null : cat)}
                title={`Filtrar por semáforo ${style.label}`}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] transition-colors cursor-pointer ${
                  active
                    ? "border-primary bg-primary-soft text-primary font-semibold shadow-xs"
                    : "border-border text-muted-foreground hover:text-foreground bg-card"
                }`}
              >
                <span className={`size-2 rounded-full ${style.dotClass}`} />
                <span>{style.label}</span>
              </button>
            );
          })}
          {filterCategory && (
            <button
              type="button"
              onClick={() => setFilterCategory(null)}
              className="text-[11px] text-primary hover:underline ml-1 cursor-pointer"
            >
              Limpiar filtro
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur text-[10px] uppercase font-semibold text-muted-foreground border-b border-border">
            <tr>
              <th className="py-2.5 pl-3 pr-2 w-7">#</th>
              <th className="py-2.5 px-2">Zona</th>
              <th className="py-2.5 px-2 text-right">
                <button
                  type="button"
                  onClick={() => handleSortClick("abst")}
                  className={`inline-flex items-center justify-end gap-1 hover:text-primary cursor-pointer ${
                    sortBy === "abst" ? "text-primary font-bold" : ""
                  }`}
                >
                  <span>Abst. 2027</span>
                  {sortBy === "abst" && <span className="text-xs">↓</span>}
                  <InfoTip term="pred_abstention" size="xs" />
                </button>
              </th>
              {scenario !== "base" && (
                <th className="py-2.5 px-2 text-right">
                  <button
                    type="button"
                    onClick={() => handleSortClick("delta")}
                    className={`inline-flex items-center justify-end gap-0.5 hover:text-primary cursor-pointer ${
                      sortBy === "delta" ? "text-primary font-bold" : ""
                    }`}
                  >
                    <span>Δ</span>
                    {sortBy === "delta" && <span className="text-xs">↓</span>}
                    <InfoTip term="modo.delta" size="xs" />
                  </button>
                </th>
              )}
              <th className="hidden sm:table-cell py-2.5 px-2 text-right">
                <button
                  type="button"
                  onClick={() => handleSortClick("abstencion_esperada")}
                  className={`inline-flex items-center justify-end gap-1 hover:text-primary cursor-pointer ${
                    sortBy === "abstencion_esperada" ? "text-primary font-bold" : ""
                  }`}
                >
                  <span>Esperada</span>
                  {sortBy === "abstencion_esperada" && <span className="text-xs">↓</span>}
                  <InfoTip term="abstencion_esperada" size="xs" />
                </button>
              </th>
              <th className="py-2.5 px-2 text-right">
                <button
                  type="button"
                  onClick={() => handleSortClick("risk")}
                  className={`inline-flex items-center justify-end gap-1 hover:text-primary cursor-pointer ${
                    sortBy === "risk" ? "text-primary font-bold" : ""
                  }`}
                >
                  <span>Riesgo</span>
                  {sortBy === "risk" && <span className="text-xs">↓</span>}
                  <InfoTip term="risk_score" size="xs" />
                </button>
              </th>
              <th className="hidden min-[480px]:table-cell py-2.5 pr-3 pl-2 text-right">
                <div className="flex items-center justify-end gap-1">
                  <span>Semáforo</span>
                  <InfoTip term="semaforo" size="xs" />
                </div>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {loading ? (
              <tr>
                <td colSpan={scenario !== "base" ? 7 : 6} className="py-8 text-center text-muted-foreground">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <svg className="animate-spin h-5 w-5 text-primary" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                    </svg>
                    <span>Cargando ranking territorial...</span>
                  </div>
                </td>
              </tr>
            ) : sortedItems.length === 0 ? (
              <tr>
                <td colSpan={scenario !== "base" ? 7 : 6} className="py-8 text-center text-muted-foreground">
                  No se encontraron resultados para los filtros seleccionados
                </td>
              </tr>
            ) : (
              sortedItems.map((item, idx) => {
                const abstEsperada = getAbstencionEsperada(item);
                const style = CATEGORY_STYLES[item.category] ?? CATEGORY_STYLES.sin_dato;
                const isSelected = selectedRegionId === item.id;

                return (
                  <tr
                    key={item.id}
                    onClick={() => selectRegion(item.id)}
                    className={`hover:bg-accent cursor-pointer transition-colors group ${
                      isSelected ? "bg-accent/70" : ""
                    }`}
                  >
                    <td className="py-2.5 pl-3 pr-2 font-mono text-[11px] text-muted-foreground group-hover:text-foreground tnum">
                      {idx + 1}
                    </td>
                    <td className="py-2.5 px-2 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`size-2 shrink-0 rounded-full ${style.dotClass}`} />
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-foreground group-hover:text-primary transition-colors truncate">
                            {item.name}
                          </div>
                          <div className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                            <span>Clave {item.id}</span>
                            {item.prioridad !== undefined && item.prioridad !== null && (
                              <span className="text-primary font-semibold">· Prioridad #{item.prioridad}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono font-bold text-foreground tnum">
                      <div>{formatPct(item.pred_abstention)}</div>
                      {item.delta_vs_base_pp !== undefined && item.delta_vs_base_pp !== null && (
                        <div
                          className={`text-[10px] font-normal ${
                            item.delta_vs_base_pp < 0 ? "text-good" : item.delta_vs_base_pp > 0 ? "text-bad" : "text-muted-foreground"
                          }`}
                        >
                          {formatDeltaPp(item.delta_vs_base_pp)}
                        </div>
                      )}
                    </td>
                    {scenario !== "base" && (
                      <td className="py-2.5 px-2 text-right font-mono text-xs font-semibold tnum">
                        {item.delta_vs_base_pp !== undefined && item.delta_vs_base_pp !== null ? (
                          <span
                            className={
                              item.delta_vs_base_pp < 0 ? "text-good" : item.delta_vs_base_pp > 0 ? "text-bad" : "text-muted-foreground"
                            }
                          >
                            {formatDeltaPp(item.delta_vs_base_pp)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    )}
                    <td className="hidden sm:table-cell py-2.5 px-2 text-right font-mono text-muted-foreground tnum">
                      <div className="text-foreground">{formatInt(abstEsperada)}</div>
                      <div className="text-[9px] text-muted-foreground font-normal">pers.</div>
                    </td>
                    <td className="py-2.5 px-2 text-right font-display font-bold text-foreground text-sm tnum">
                      {item.risk_score ?? "—"}
                    </td>
                    <td className="hidden min-[480px]:table-cell py-2.5 pr-3 pl-2 text-right">
                      <span
                        className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full ${style.badgeClass}`}
                      >
                        {style.label}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
