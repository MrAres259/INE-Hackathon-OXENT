"use client";

import React, { useState, useEffect } from "react";
import { useAtalaya } from "@/lib/state";
import { formatInt, formatPp } from "@/lib/format";

export function ScenarioControls() {
  const {
    isScenarioModalOpen,
    setIsScenarioModalOpen,
    meta,
    scenarioParams,
    setScenarioParams,
    runSimulation,
    simulationResult,
  } = useAtalaya();

  const [localParams, setLocalParams] = useState(scenarioParams);
  const [isSimulating, setIsSimulating] = useState(false);

  useEffect(() => {
    setLocalParams(scenarioParams);
  }, [scenarioParams]);

  if (!isScenarioModalOpen) return null;

  const intervencionDef = meta?.scenarios.find((s) => s.id === "intervencion");

  const handleSimulate = async () => {
    setIsSimulating(true);
    setScenarioParams(localParams);
    try {
      await runSimulation(localParams);
      setIsScenarioModalOpen(false);
    } finally {
      setIsSimulating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full p-6 text-white shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-4">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
              Ajustar Escenario de Intervención
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Parametriza palancas operativas y simula el impacto en el riesgo electoral 2027.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsScenarioModalOpen(false)}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form Params */}
        <div className="space-y-4">
          {/* Palanca */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Palanca de intervención institucional
            </label>
            <select
              value={localParams.palanca as string}
              onChange={(e) => setLocalParams({ ...localParams, palanca: e.target.value })}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="promocion_jovenes">Promoción de voto en jóvenes (18-24 años)</option>
              <option value="casillas_rurales">Instalación y accesibilidad de casillas rurales</option>
              <option value="materiales_lengua_indigena">Materiales y difusión en lenguas indígenas</option>
              <option value="campana_general">Campaña intensiva general de participación</option>
            </select>
          </div>

          {/* Focalización */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Focalización territorial
            </label>
            <select
              value={localParams.focalizacion as string}
              onChange={(e) => setLocalParams({ ...localParams, focalizacion: e.target.value })}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="rojo">Solo municipios en Riesgo Crítico (Rojo)</option>
              <option value="rojo_naranja">Municipios en Riesgo Alto y Crítico (Rojo + Naranja)</option>
              <option value="todos">Cobertura universal (todos los municipios)</option>
            </select>
          </div>

          {/* Effect pp slider */}
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label className="text-xs font-semibold text-slate-300">
                Efecto esperado de incremento en participación
              </label>
              <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800">
                +{Number(localParams.effect_pp ?? 3.5).toFixed(1)} pp
              </span>
            </div>
            <input
              type="range"
              min={0.5}
              max={10.0}
              step={0.5}
              value={Number(localParams.effect_pp ?? 3.5)}
              onChange={(e) => setLocalParams({ ...localParams, effect_pp: parseFloat(e.target.value) })}
              className="w-full accent-emerald-500 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-slate-500 mt-0.5">
              <span>+0.5 pp (Conservador)</span>
              <span>+5.0 pp (Moderado)</span>
              <span>+10.0 pp (Agresivo)</span>
            </div>
          </div>

          {/* Coverage slider */}
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label className="text-xs font-semibold text-slate-300">
                Cobertura operativa estimada
              </label>
              <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800">
                {Math.round(Number(localParams.coverage ?? 0.8) * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0.1}
              max={1.0}
              step={0.05}
              value={Number(localParams.coverage ?? 0.8)}
              onChange={(e) => setLocalParams({ ...localParams, coverage: parseFloat(e.target.value) })}
              className="w-full accent-emerald-500 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-slate-500 mt-0.5">
              <span>10% (Piloto acotado)</span>
              <span>80% (Capacidad INE estándar)</span>
              <span>100% (Despliegue total)</span>
            </div>
          </div>
        </div>

        {/* Previous simulation summary banner if available */}
        {simulationResult && (
          <div className="mt-4 p-3 bg-slate-800/80 rounded-xl border border-slate-700/80 text-xs flex items-center justify-between">
            <span className="text-slate-300">Última simulación:</span>
            <div className="flex items-center gap-3">
              <span className="text-emerald-400 font-semibold">
                +{formatInt(simulationResult.summary.votos_adicionales)} votos recuperados
              </span>
              <span className="text-slate-400">|</span>
              <span className="text-emerald-400 font-semibold">
                {formatPp(simulationResult.summary.mean_delta_pp)} promedio
              </span>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="mt-6 flex items-center justify-end gap-3 border-t border-slate-800 pt-4">
          <button
            type="button"
            onClick={() => setIsScenarioModalOpen(false)}
            className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSimulate}
            disabled={isSimulating}
            className="px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 rounded-lg transition-colors flex items-center gap-2 shadow-sm"
          >
            {isSimulating ? (
              <>
                <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                </svg>
                <span>Simulando...</span>
              </>
            ) : (
              <span>Aplicar y Simular</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
