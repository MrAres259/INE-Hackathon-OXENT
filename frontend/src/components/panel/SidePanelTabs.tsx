"use client";

import React, { useState } from "react";
import { RegionDetailPanel } from "./RegionDetailPanel";
import { RankingTable } from "./RankingTable";
import { ChatPanel } from "./ChatPanel";

export function SidePanelTabs() {
  const [activeTab, setActiveTab] = useState<"detail" | "ranking" | "chat">("detail");

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl flex flex-col h-full min-h-0 shadow-xl overflow-hidden">
      {/* Tab Navigation */}
      <div className="flex border-b border-slate-800 bg-slate-950/60 p-1.5 gap-1 shrink-0">
        <button
          type="button"
          onClick={() => setActiveTab("detail")}
          title="Diagnóstico: detalle de la zona seleccionada"
          className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 ${
            activeTab === "detail"
              ? "bg-slate-800 text-white shadow-sm"
              : "text-slate-400 hover:text-white hover:bg-slate-900"
          }`}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <span>Diagnóstico</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("ranking")}
          title="Ranking: zonas ordenadas para priorizar"
          className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 ${
            activeTab === "ranking"
              ? "bg-slate-800 text-white shadow-sm"
              : "text-slate-400 hover:text-white hover:bg-slate-900"
          }`}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
          </svg>
          <span>Ranking</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("chat")}
          title="Asistente: preguntas en lenguaje natural sobre los datos"
          className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 ${
            activeTab === "chat"
              ? "bg-slate-800 text-emerald-400 shadow-sm"
              : "text-slate-400 hover:text-white hover:bg-slate-900"
          }`}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
          <span>Asistente IA</span>
        </button>
      </div>

      {/* Tab Body */}
      <div className="p-4 flex-1 min-h-0 overflow-y-auto">
        {activeTab === "detail" && <RegionDetailPanel />}
        {activeTab === "ranking" && <RankingTable />}
        {activeTab === "chat" && <ChatPanel />}
      </div>
    </div>
  );
}
