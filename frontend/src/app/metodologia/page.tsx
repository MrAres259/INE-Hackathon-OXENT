"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { getMetrics } from "@/lib/api";
import type { ModelMetrics } from "@/lib/types";
import { formatInt, formatPp, CATEGORY_COLORS, CATEGORY_LABELS } from "@/lib/format";

export default function MetodologiaPage() {
  const [metrics, setMetrics] = useState<ModelMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getMetrics()
      .then((m) => setMetrics(m))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-4xl mx-auto py-6 px-4 space-y-8 text-slate-200">
      {/* Back link */}
      <div>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400 hover:text-emerald-300 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          <span>Regresar al Tablero Principal</span>
        </Link>
        <h1 className="text-3xl font-extrabold text-white mt-3">
          Metodología del Modelo ATALAYA
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Fundamentos analíticos, fuentes oficiales, formulación del modelo predictivo y delimitación ética.
        </p>
      </div>

      {/* Note: No Personal Data */}
      <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-800/80 flex items-start gap-3">
        <svg className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
        <div className="text-xs space-y-1">
          <div className="font-bold text-white uppercase tracking-wider">
            Garantía de Privacidad y Anonimato Estricto
          </div>
          <p className="text-slate-300 leading-relaxed">
            ATALAYA no almacena, procesa ni infiere registros individuales ni listas nominales nominativas.
            Toda la analítica se ejecuta exclusivamente sobre **datos estadísticos agregados a nivel municipal y estatal**
            de acuerdo con la normativa del Instituto Nacional Electoral (INE) y el marco de protección de datos personales.
          </p>
        </div>
      </div>

      {/* 1. Qué es ATALAYA */}
      <section className="space-y-3">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <span className="text-emerald-500">1.</span> Objetivo y Pregunta Guía
        </h2>
        <p className="text-xs text-slate-300 leading-relaxed">
          En el marco del Reto 2 del Hackathon INE, el propósito de ATALAYA es responder a la interrogante:
          <em className="text-emerald-300 font-medium block my-1">
            "¿Qué zonas territoriales podrían presentar mayor abstención en las elecciones intermedias de 2027 si no se interviene?"
          </em>
          El objetivo institucional es dotar al INE de una herramienta de planeación anticipada para priorizar estratégicamente
          recursos, instalación de casillas, difusión bilingüe y campañas cívicas focalizadas.
        </p>
      </section>

      {/* 2. Fuentes de Datos Oficiales */}
      <section className="space-y-3">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <span className="text-emerald-500">2.</span> Fuentes de Información Oficial
        </h2>
        <p className="text-xs text-slate-300">
          El pipeline de ingestión procesa exclusivamente repositorios abiertos gubernamentales:
        </p>
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900 text-[10px] uppercase font-bold text-slate-400 border-b border-slate-800">
              <tr>
                <th className="py-2.5 px-3">Fuente Institucional</th>
                <th className="py-2.5 px-3">Archivo / Colección</th>
                <th className="py-2.5 px-3 text-right">Registros</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 bg-slate-900/40">
              {metrics?.data_sources.map((ds, idx) => (
                <tr key={idx}>
                  <td className="py-2 px-3 font-semibold text-white">{ds.name}</td>
                  <td className="py-2 px-3 font-mono text-[11px] text-slate-400">{ds.file}</td>
                  <td className="py-2 px-3 text-right font-mono text-emerald-400 font-bold">
                    {formatInt(ds.rows)}
                  </td>
                </tr>
              )) ?? (
                <tr>
                  <td colSpan={3} className="py-4 text-center text-slate-500">Cargando fuentes...</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 3. Modelo Matemático */}
      <section className="space-y-3">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <span className="text-emerald-500">3.</span> Formulación del Modelo Predictivo
        </h2>
        <p className="text-xs text-slate-300 leading-relaxed">
          El modelo predictivo está diseñado bajo principios de parsimonia y explicabilidad matemática,
          utilizando una **regresión regularizada Ridge (L2)** con resolución matricial analítica cerrada (sin cajas negras).
        </p>
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl text-xs space-y-2">
          <div className="font-semibold text-slate-200">Estructura del Predictor:</div>
          <ul className="list-disc list-inside space-y-1 text-slate-400 pl-1">
            <li>
              <strong className="text-white">Inercia histórica y periodicidad:</strong> La participación en la elección intermedia previa
              (<span className="font-mono text-emerald-400">y_&#123;T-6&#125;</span>) y la elección federal previa
              (<span className="font-mono text-emerald-400">y_&#123;T-3&#125;</span>), capturando el ciclo de elecciones concurrentes presidenciales.
            </li>
            <li>
              <strong className="text-white">Tendencia secular municipal:</strong> Pendiente de participación (<span className="font-mono text-emerald-400">trend_pp</span>) observada en el histórico 2009–2024.
            </li>
            <li>
              <strong className="text-white">Determinantes sociodemográficos:</strong> Escolaridad promedio (<span className="font-mono text-slate-300">GRAPROES</span>), proporción de jóvenes de 18 a 24 años (<span className="font-mono text-slate-300">pct_18_24</span>), ruralidad, acceso a internet e índice de marginación (<span className="font-mono text-slate-300">CONAPO IMM</span>).
            </li>
          </ul>
        </div>
      </section>

      {/* 4. Coeficientes */}
      {metrics?.coefficients && metrics.coefficients.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <span className="text-emerald-500">4.</span> Coeficientes del Modelo Estandarizado
          </h2>
          <p className="text-xs text-slate-300">
            Impacto en puntos porcentuales por cada desviación estándar de cambio en la variable explicativa:
          </p>
          <div className="space-y-2 bg-slate-900/60 p-4 rounded-xl border border-slate-800">
            {metrics.coefficients.map((c) => {
              const isPositive = c.coef_pp_per_sd > 0;
              const barColor = isPositive ? "#10b981" : "#f43f5e";

              return (
                <div key={c.key} className="text-xs">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-slate-300 font-medium">{c.label}</span>
                    <span className="font-mono font-bold" style={{ color: barColor }}>
                      {isPositive ? `+${c.coef_pp_per_sd.toFixed(2)} pp` : `${c.coef_pp_per_sd.toFixed(2)} pp`}
                    </span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden flex">
                    <div
                      className="h-2 rounded-full"
                      style={{
                        width: `${Math.min(100, Math.abs(c.coef_pp_per_sd) * 18)}%`,
                        backgroundColor: barColor,
                      }}
                    ></div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 5. Backtest */}
      {metrics?.backtests && metrics.backtests.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <span className="text-emerald-500">5.</span> Validación Histórica Cruzada (Backtest)
          </h2>
          <p className="text-xs text-slate-300">
            El modelo fue validado entrenando con ciclos electorales previos y evaluando su precisión contra los resultados reales:
          </p>
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900 text-[10px] uppercase font-bold text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-2.5 px-3">Entrenamiento</th>
                  <th className="py-2.5 px-3">Elección Evaluada</th>
                  <th className="py-2.5 px-3 text-right">MAE (pp)</th>
                  <th className="py-2.5 px-3 text-right">RMSE (pp)</th>
                  <th className="py-2.5 px-3 text-right">Correlación Spearman</th>
                  <th className="py-2.5 px-3 text-right">Municipios (N)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 bg-slate-900/40">
                {metrics.backtests.map((b, idx) => (
                  <tr key={idx}>
                    <td className="py-2 px-3 text-slate-300">Elecciones ≤ {b.train_until}</td>
                    <td className="py-2 px-3 font-semibold text-white">Elección Federal {b.test_year}</td>
                    <td className="py-2 px-3 text-right font-mono text-emerald-400 font-bold">{b.mae_pp.toFixed(2)} pp</td>
                    <td className="py-2 px-3 text-right font-mono text-slate-300">{b.rmse_pp.toFixed(2)} pp</td>
                    <td className="py-2 px-3 text-right font-mono text-sky-400 font-bold">{b.spearman.toFixed(3)}</td>
                    <td className="py-2 px-3 text-right font-mono text-slate-400">{formatInt(b.n)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 6. Semáforo de Riesgo */}
      <section className="space-y-3">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <span className="text-emerald-500">6.</span> Construcción del Índice de Riesgo y Semáforo
        </h2>
        <p className="text-xs text-slate-300 leading-relaxed">
          El índice de riesgo (0 a 100) pondera tres dimensiones clave:
          <span className="font-mono text-slate-200 block my-1 bg-slate-900 p-2.5 rounded-lg border border-slate-800">
            risk_score = 100 · ( 0.60 · pct_rank(pred_abstencion) + 0.25 · pct_rank(−trend_pp) + 0.15 · pct_rank(volatilidad) )
          </span>
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          {(["verde", "amarillo", "naranja", "rojo"] as const).map((cat) => (
            <div key={cat} className="p-3 rounded-lg bg-slate-900 border border-slate-800 flex items-center gap-2.5">
              <span className="w-3.5 h-3.5 rounded-xs shrink-0" style={{ backgroundColor: CATEGORY_COLORS[cat] }}></span>
              <div>
                <span className="font-bold text-white">{CATEGORY_LABELS[cat]}: </span>
                <span className="text-slate-400">
                  {cat === "rojo" ? "Score ≥ 75 pts" : cat === "naranja" ? "Score 55 a 74 pts" : cat === "amarillo" ? "Score 35 a 54 pts" : "Score < 35 pts"}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 7. Limitaciones y Supuestos */}
      <section className="space-y-3">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <span className="text-emerald-500">7.</span> Supuestos y Limitaciones Metodológicas
        </h2>
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl text-xs space-y-2 text-slate-300">
          <p>
            • <strong className="text-white">Escenarios de intervención hipotéticos:</strong> Las simulaciones no constituyen una garantía de resultado electoral, sino ejercicios de sensibilidad contrafactual para medir elasticidades de respuesta ante intervenciones focalizadas.
          </p>
          <p>
            • <strong className="text-white">Dinámica de municipios nuevos:</strong> Los municipios de creación reciente posterior al Censo 2020 se mapean a sus municipios de origen mediante tabla de concordancia (crosswalk).
          </p>
          <p>
            • <strong className="text-white">Estructura demográfica estática:</strong> Las variables de población y marginación corresponden al levantamiento oficial INEGI Censo 2020 y CONAPO 2020.
          </p>
        </div>
      </section>
    </div>
  );
}
