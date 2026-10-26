"use client";

import React, { useState, useEffect } from "react";
import { useAtalaya } from "@/lib/state";
import { getRanking } from "@/lib/api";
import type { RiskItem, Level } from "@/lib/types";
import { InfoTip } from "@/components/ui/InfoTip";
import {
  formatPct,
  formatPp,
  formatInt,
  formatDeltaPp,
  getDeltaAbstentionColorClass,
  getCategoryColor,
  getCategoryLabel,
  generateRankingCsv,
  sortRankingItems,
  getAbstencionEsperada,
  type RankingSortKey,
} from "@/lib/format";

export function RankingTable() {
  const {
    level: contextLevel,
    selectedEnt,
    scenario,
    selectRegion,
    meta,
    simulationResult,
  } = useAtalaya();

  const [level, setLevel] = useState<Level>(contextLevel);
  const [entFilter, setEntFilter] = useState<string>(selectedEnt ?? "");
  const [sortBy, setSortBy] = useState<RankingSortKey>("risk");
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

  const sortedItems = sortRankingItems(items, sortBy).slice(0, 20);

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

  return (
    <div className="space-y-4">
      {/* Header & Controls */}
      <div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <h3 className="text-base font-bold text-white">Ranking de Priorización 2027</h3>
            <InfoTip term="prioridad" size="xs" />
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={sortedItems.length === 0}
              className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              <span>Exportar CSV</span>
            </button>
            <InfoTip term="ranking.csv" size="xs" />
          </div>
        </div>
        <p className="text-xs text-slate-400 mt-0.5">
          Top 20 zonas con mayor índice de vulnerabilidad y abstención potencial. Clic en una fila para ubicarla en el mapa.
        </p>
        {scenario !== "base" && (
          <p className="text-[11px] text-slate-400 mt-1">
            Cambio vs base: <span className="text-emerald-400 font-semibold">(negativo = menos abstención)</span>
          </p>
        )}
      </div>

      {/* Filter & Sort Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg p-0.5 bg-slate-800 border border-slate-700 text-xs">
            <button
              type="button"
              onClick={() => setLevel("state")}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                level === "state"
                  ? "bg-slate-700 text-white shadow-xs"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Estados
            </button>
            <button
              type="button"
              onClick={() => setLevel("mun")}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                level === "mun"
                  ? "bg-slate-700 text-white shadow-xs"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Municipios
            </button>
          </div>

          {level === "mun" && meta?.states && (
            <select
              value={entFilter}
              onChange={(e) => setEntFilter(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
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

        {/* Order Selector */}
        <div className="flex items-center gap-1.5 text-xs text-slate-300">
          <span className="text-[11px] text-slate-400 hidden sm:inline">Ordenar por:</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as RankingSortKey)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            <option value="risk">Índice de riesgo</option>
            <option value="abstencion_esperada">Abstención esperada (personas)</option>
            <option value="prioridad">Prioridad</option>
          </select>
          <InfoTip term="ranking.orden" size="xs" />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-800/80 text-[10px] uppercase font-semibold text-slate-400 border-b border-slate-800">
            <tr>
              <th className="py-2.5 pl-3 pr-2">#</th>
              <th className="py-2.5 px-2">Zona</th>
              <th className="py-2.5 px-2 text-right">
                <div className="flex items-center justify-end gap-1">
                  <span>Abst. 2027</span>
                  <InfoTip term="pred_abstention" size="xs" />
                </div>
                {scenario !== "base" && (
                  <div className="flex items-center justify-end gap-0.5 text-[9px] lowercase font-normal text-slate-400">
                    <span>(Δ vs base)</span>
                    <InfoTip term="modo.delta" size="xs" />
                  </div>
                )}
              </th>
              <th className="py-2.5 px-2 text-right">
                <div className="flex items-center justify-end gap-1">
                  <span>Abst. Esperada</span>
                  <InfoTip term="abstencion_esperada" size="xs" />
                </div>
              </th>
              <th className="py-2.5 px-2 text-right">
                <div className="flex items-center justify-end gap-1">
                  <span>Riesgo</span>
                  <InfoTip term="risk_score" size="xs" />
                </div>
              </th>
              <th className="py-2.5 pr-3 pl-2 text-right">
                <div className="flex items-center justify-end gap-1">
                  <span>Semáforo</span>
                  <InfoTip term="semaforo" size="xs" />
                </div>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 bg-slate-900/60">
            {loading ? (
              <tr>
                <td colSpan={6} className="py-6 text-center text-slate-400">
                  Cargando ranking...
                </td>
              </tr>
            ) : sortedItems.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-6 text-center text-slate-400">
                  No se encontraron resultados
                </td>
              </tr>
            ) : (
              sortedItems.map((item, idx) => {
                const catColor = getCategoryColor(item.category);
                const catLabel = getCategoryLabel(item.category);
                const abstEsperada = getAbstencionEsperada(item);

                return (
                  <tr
                    key={item.id}
                    onClick={() => selectRegion(item.id)}
                    className="hover:bg-slate-800/80 cursor-pointer transition-colors group"
                  >
                    <td className="py-2 pl-3 pr-2 font-mono text-[11px] text-slate-400 group-hover:text-white">
                      {idx + 1}
                    </td>
                    <td className="py-2 px-2">
                      <div className="font-semibold text-slate-200 group-hover:text-emerald-400 transition-colors">
                        {item.name}
                      </div>
                      <div className="text-[10px] text-slate-400 flex items-center gap-1.5">
                        <span>Clave: {item.id}</span>
                        {item.prioridad !== undefined && item.prioridad !== null && (
                          <span className="text-emerald-400 font-semibold">· Prioridad #{item.prioridad}</span>
                        )}
                      </div>
                    </td>
                    <td className="py-2 px-2 text-right font-mono font-bold text-white">
                      <div>{formatPct(item.pred_abstention)}</div>
                      {item.delta_vs_base_pp !== undefined && item.delta_vs_base_pp !== null && (
                        <div
                          className={`text-[10px] font-normal ${getDeltaAbstentionColorClass(
                            item.delta_vs_base_pp
                          )}`}
                        >
                          {formatDeltaPp(item.delta_vs_base_pp)}
                        </div>
                      )}
                    </td>
                    <td className="py-2 px-2 text-right font-mono text-slate-300">
                      <div>{formatInt(abstEsperada)}</div>
                      <div className="text-[9px] text-slate-400 font-normal">pers.</div>
                    </td>
                    <td className="py-2 px-2 text-right font-mono font-bold text-white">
                      {item.risk_score ?? "—"}
                    </td>
                    <td className="py-2 pr-3 pl-2 text-right">
                      <span
                        className="inline-block text-[10px] font-bold px-2 py-0.5 rounded text-white shadow-xs"
                        style={{ backgroundColor: catColor }}
                      >
                        {catLabel}
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
