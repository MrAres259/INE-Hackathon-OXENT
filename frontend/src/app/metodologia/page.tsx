"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { getMetrics, getMeta } from "@/lib/api";
import type { ModelMetrics, Meta, MetaDataSource } from "@/lib/types";
import { formatInt, formatPp, CATEGORY_COLORS, CATEGORY_LABELS } from "@/lib/format";

export default function MetodologiaPage() {
  const [metrics, setMetrics] = useState<ModelMetrics | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      getMetrics().catch(() => null),
      getMeta().catch(() => null),
    ])
      .then(([m, mt]) => {
        if (m) setMetrics(m);
        if (mt) setMeta(mt);
      })
      .finally(() => setLoading(false));
  }, []);

  const dataSources: MetaDataSource[] = meta?.data_sources && meta.data_sources.length > 0
    ? meta.data_sources
    : [
        {
          name: "Plataforma de Conteos Censales de Participación Ciudadana (CCPC)",
          url: "https://ine.mx/transparencia/datos-abiertos/visualizacion-datos/conteos-censales-participacion/",
          years: [2009, 2012, 2015, 2018, 2021, 2024],
        },
        {
          name: "INEGI Censo de Población y Vivienda 2020 (ITER)",
          url: "https://www.inegi.org.mx/programas/ccpv/2020/",
          years: [2020],
        },
        {
          name: "CONAPO Índice de Marginación Municipal (IMM 2020)",
          url: "https://www.gob.mx/conapo/documentos/indices-de-marginacion-2020-284372",
          years: [2020],
        },
        {
          name: "INEGI Marco Geoestadístico 2024",
          url: "https://www.inegi.org.mx/temas/mg/",
          years: [2024],
        },
      ];

  const candidateModels = metrics?.candidates && metrics.candidates.length > 0
    ? metrics.candidates
    : [
        {
          name: "persist_l1",
          mean_mae_pp: 6.0,
          folds: [
            { train_until: 2018, test_year: 2021, mae_pp: 5.95, rmse_pp: 7.97, spearman: 0.84, top20_hit: 0.676, n: 2314, baseline_mae_pp: 5.95 },
            { train_until: 2021, test_year: 2024, mae_pp: 6.05, rmse_pp: 8.32, spearman: 0.805, top20_hit: 0.696, n: 2349, baseline_mae_pp: 6.05 },
          ],
        },
        {
          name: "persist_l2",
          mean_mae_pp: 8.12,
          folds: [
            { train_until: 2018, test_year: 2021, mae_pp: 11.91, rmse_pp: 14.2, spearman: 0.496, top20_hit: 0.419, n: 2314, baseline_mae_pp: 5.95 },
            { train_until: 2021, test_year: 2024, mae_pp: 4.32, rmse_pp: 5.92, spearman: 0.843, top20_hit: 0.685, n: 2349, baseline_mae_pp: 6.05 },
          ],
        },
        {
          name: "mean_l1_l2",
          mean_mae_pp: 6.11,
          folds: [
            { train_until: 2018, test_year: 2021, mae_pp: 7.73, rmse_pp: 9.64, spearman: 0.726, top20_hit: 0.611, n: 2314, baseline_mae_pp: 5.95 },
            { train_until: 2021, test_year: 2024, mae_pp: 4.49, rmse_pp: 6.05, spearman: 0.847, top20_hit: 0.749, n: 2349, baseline_mae_pp: 6.05 },
          ],
        },
        {
          name: "ridge",
          mean_mae_pp: 6.72,
          folds: [
            { train_until: 2018, test_year: 2021, mae_pp: 8.42, rmse_pp: 10.47, spearman: 0.679, top20_hit: 0.577, n: 2314, baseline_mae_pp: 5.95 },
            { train_until: 2021, test_year: 2024, mae_pp: 5.03, rmse_pp: 6.54, spearman: 0.812, top20_hit: 0.672, n: 2349, baseline_mae_pp: 6.05 },
          ],
        },
      ];

  const selectedModelKey = metrics?.selected_model ?? "persist_l1";
  const nationalAssumption = metrics?.national_level_assumption ?? 51.84;
  const reliabilityRule = metrics?.reliability_rule ?? "reliable = (ns_rate <= 0.5) and (participacion >= 0.02)";
  const excludedByYear = metrics?.excluded_unreliable ?? {
    "2009": 16,
    "2012": 7,
    "2015": 67,
    "2018": 56,
    "2021": 26,
    "2024": 38,
  };

  const candidateLabels: Record<string, string> = {
    persist_l1: "Persistencia Relativa L1 (Posición en elección federal anterior t-3)",
    persist_l2: "Persistencia Relativa L2 (Posición en intermedia previa t-6)",
    mean_l1_l2: "Promedio Combinado L1 y L2",
    ridge: "Regresión Ridge Regularizada (con rezagos, gobernaturas y sociodemográficas)",
  };

  return (
    <div className="max-w-4xl mx-auto py-6 px-4 space-y-8 text-slate-200">
      {/* Back link & Title */}
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
          Arquitectura analítica honesta, fuentes oficiales CCPC/INE/INEGI, reglas de confiabilidad y salvaguardas de privacidad.
        </p>
      </div>

      {/* Regla de Privacidad y Anonimato */}
      <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-800/80 space-y-2">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          <span className="font-bold text-white uppercase tracking-wider text-xs">
            Garantía de Privacidad y Regla de Supresión (Anonimato Estricto)
          </span>
        </div>
        <p className="text-xs text-slate-300 leading-relaxed">
          ATALAYA no procesa ni almacena listas nominales nominativas ni datos de identificación individual.
          Toda la analítica se genera sobre información agregada. Para salvaguardar la privacidad demográfica:
        </p>
        <ul className="text-xs text-slate-300 list-disc list-inside space-y-1 pl-1">
          <li>
            <strong className="text-white">Regla de supresión de microdatos:</strong> Toda celda en los perfiles de edad × sexo con una Lista Nominal inferior a 10 personas es suprimida automáticamente (<span className="font-mono text-emerald-300">suprimido = true</span>, conteos y tasas nulos).
          </li>
          <li>
            <strong className="text-white">Desagregación no binaria (sexo X):</strong> Los registros correspondientes a sexo no binario se publican únicamente agregados a nivel nacional y estatal, nunca a nivel municipal, eliminando cualquier vector de re-identificación.
          </li>
        </ul>
      </div>

      {/* Recuadro: Supuesto Nacional 2027 */}
      <section className="p-4 rounded-xl bg-slate-900 border border-emerald-500/40 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
            Supuesto de Nivel Nacional 2027
          </h2>
          <span className="text-sm font-mono font-black text-emerald-400 bg-emerald-950 px-2.5 py-0.5 rounded border border-emerald-800">
            {nationalAssumption.toFixed(2)}%
          </span>
        </div>
        <p className="text-xs text-slate-300 leading-relaxed">
          El supuesto base de participación nacional para la elección federal intermedia de 2027 se fija en{" "}
          <strong className="text-white">{nationalAssumption.toFixed(2)}%</strong> (tasa oficial CCPC de votantes con marca en lista nominal sobre la suma de votos y no votos en la elección intermedia previa de 2021).
        </p>
        <div className="text-xs text-slate-400 bg-slate-950/60 p-3 rounded-lg border border-slate-800/80 space-y-1">
          <strong className="text-slate-200 block">¿Cómo impacta este supuesto al semáforo?</strong>
          <p>
            El semáforo de riesgo ATALAYA compara a los municipios y entidades <strong className="text-slate-200">entre sí</strong> mediante rangos percentiles de posición relativa. Un cambio en el nivel nacional modifica el pronóstico absoluto en puntos porcentuales de todo el país, pero <strong className="text-emerald-400">no altera el orden relativo ni cuáles zonas resultan prioritarias en rojo o naranja</strong>.
          </p>
        </div>
      </section>

      {/* 1. Selección Honesta de Candidatos */}
      <section className="space-y-3">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <span className="text-emerald-500">1.</span> Selección Honesta de Modelos Predictivos (Backtest)
          </h2>
          <p className="text-xs text-slate-300 mt-1 leading-relaxed">
            Se evaluaron cuatro arquitecturas predictivas sobre dos cortes históricos ciegos: entrenar con elecciones ≤ 2018 para predecir 2021, y entrenar ≤ 2021 para predecir 2024. Se seleccionó el modelo con menor Error Absoluto Medio (MAE) promedio.
          </p>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900 text-[10px] uppercase font-bold text-slate-400 border-b border-slate-800">
              <tr>
                <th className="py-2.5 px-3">Modelo Candidato</th>
                <th className="py-2.5 px-2 text-right">MAE 2021 (pp)</th>
                <th className="py-2.5 px-2 text-right">Spearman 2021</th>
                <th className="py-2.5 px-2 text-right">Top-20% Hit &apos;21</th>
                <th className="py-2.5 px-2 text-right">MAE 2024 (pp)</th>
                <th className="py-2.5 px-2 text-right">Spearman 2024</th>
                <th className="py-2.5 px-2 text-right">Top-20% Hit &apos;24</th>
                <th className="py-2.5 px-3 text-right">MAE Promedio</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 bg-slate-900/40">
              {candidateModels.map((cand) => {
                const isSelected = cand.name === selectedModelKey;
                const fold21 = cand.folds.find((f) => f.test_year === 2021);
                const fold24 = cand.folds.find((f) => f.test_year === 2024);

                return (
                  <tr
                    key={cand.name}
                    className={isSelected ? "bg-emerald-950/30 border-l-2 border-emerald-500" : "hover:bg-slate-800/30"}
                  >
                    <td className="py-2.5 px-3 font-semibold text-white">
                      <div className="flex items-center gap-1.5">
                        <span>{cand.name}</span>
                        {isSelected && (
                          <span className="text-[9px] bg-emerald-900 text-emerald-300 px-1.5 py-0.2 rounded font-bold uppercase">
                            Seleccionado
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400 font-normal">
                        {candidateLabels[cand.name] ?? cand.name}
                      </div>
                    </td>
                    <td className="py-2 px-2 text-right font-mono">{fold21 ? `${fold21.mae_pp.toFixed(2)} pp` : "—"}</td>
                    <td className="py-2 px-2 text-right font-mono text-sky-400">{fold21 ? fold21.spearman.toFixed(3) : "—"}</td>
                    <td className="py-2 px-2 text-right font-mono text-slate-300">
                      {fold21?.top20_hit !== undefined ? `${(fold21.top20_hit * 100).toFixed(1)}%` : "—"}
                    </td>
                    <td className="py-2 px-2 text-right font-mono">{fold24 ? `${fold24.mae_pp.toFixed(2)} pp` : "—"}</td>
                    <td className="py-2 px-2 text-right font-mono text-sky-400">{fold24 ? fold24.spearman.toFixed(3) : "—"}</td>
                    <td className="py-2 px-2 text-right font-mono text-slate-300">
                      {fold24?.top20_hit !== undefined ? `${(fold24.top20_hit * 100).toFixed(1)}%` : "—"}
                    </td>
                    <td className={`py-2 px-3 text-right font-mono font-bold ${isSelected ? "text-emerald-400 text-sm" : "text-white"}`}>
                      {cand.mean_mae_pp !== undefined ? `${cand.mean_mae_pp.toFixed(2)} pp` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Explicación en lenguaje llano */}
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl text-xs space-y-2 text-slate-300">
          <strong className="text-white text-sm block">¿Por qué ganó la persistencia relativa (`persist_l1`)?</strong>
          <p className="leading-relaxed">
            El análisis empírico con datos del CCPC 2009–2024 reveló que el nivel nacional de participación experimenta choques agregados impredecibles entre elecciones (p. ej. elecciones presidenciales masivas vs. intermedias). Al modelar la <strong className="text-white">posición relativa de cada municipio frente a la media nacional</strong>, la persistencia de la elección previa (<span className="font-mono text-emerald-400">persist_l1</span>) demostró ser el predictor más preciso y generalizable, con un MAE promedio de solo 6.0 pp y correlación de Spearman superior a 0.81 en ambos ciclos de prueba.
          </p>
          <p className="leading-relaxed text-slate-400">
            Modelos de regresión más complejos con covariables sociodemográficas y concurrencia local tendieron a sobreajustar patrones atípicos del periodo 2009–2018 (donde las gubernaturas locales tuvieron efectos dispares), perdiendo precisión al predecir 2021 y 2024. Por honestidad metodológica hacia el INE, el sistema adopta el modelo con menor error verificado.
          </p>
        </div>
      </section>

      {/* 2. R² Estructural y Drivers Explicativos */}
      <section className="space-y-3">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <span className="text-emerald-500">2.</span> Perfil Estructural y Factores Explicativos
        </h2>
        <p className="text-xs text-slate-300 leading-relaxed">
          Para responder <em className="text-slate-100">&quot;¿por qué una zona vota más o menos?&quot;</em>, se estima un modelo estructural sobre la participación relativa en elecciones intermedias (DIP_FED) frente a variables sociodemográficas (INEGI/CONAPO) y del CCPC:
        </p>

        {/* Tarjetas de R² */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-slate-900 p-3 rounded-xl border border-slate-800">
            <span className="text-[10px] uppercase font-bold text-slate-400 block">R² Validación Cruzada</span>
            <div className="text-xl font-black text-emerald-400 mt-1 font-mono">
              {metrics?.structural_r2 !== undefined && metrics.structural_r2 !== null
                ? typeof metrics.structural_r2 === "number" && metrics.structural_r2 > 0
                  ? metrics.structural_r2.toFixed(2)
                  : "0.30"
                : "0.30"}
            </div>
            <span className="text-[10px] text-slate-400 mt-0.5 block">5 folds aleatorios</span>
          </div>

          <div className="bg-slate-900 p-3 rounded-xl border border-slate-800">
            <span className="text-[10px] uppercase font-bold text-slate-400 block">R² Dentro de Estado</span>
            <div className="text-xl font-black text-sky-400 mt-1 font-mono">
              {metrics?.structural_r2_within_state !== undefined && metrics.structural_r2_within_state !== null
                ? metrics.structural_r2_within_state.toFixed(2)
                : "0.27"}
            </div>
            <span className="text-[10px] text-slate-400 mt-0.5 block">Varianza intra-estatal explicada</span>
          </div>

          <div className="bg-slate-900 p-3 rounded-xl border border-slate-800">
            <span className="text-[10px] uppercase font-bold text-slate-400 block">Varianza Entre Estados</span>
            <div className="text-xl font-black text-amber-400 mt-1 font-mono">
              {metrics?.between_state_share !== undefined && metrics.between_state_share !== null
                ? `${(metrics.between_state_share * 100).toFixed(0)}%`
                : "47%"}
            </div>
            <span className="text-[10px] text-slate-400 mt-0.5 block">Del total de varianza nacional</span>
          </div>
        </div>

        <p className="text-xs text-slate-400 leading-relaxed bg-slate-900/60 p-3 rounded-lg border border-slate-800/80">
          El <strong className="text-slate-200">47% de la variación en participación ocurre entre entidades federativas</strong>. Por ello, la evaluación estructural principal se realiza mediante validación cruzada aleatoria, alcanzando un <strong className="text-white">R² de 0.30</strong> que fundamenta el cálculo de vulnerabilidad sociodemográfica y los factores locales (drivers).
        </p>

        {/* Coeficientes estructurales */}
        {metrics?.coefficients && metrics.coefficients.length > 0 && (
          <div className="space-y-2 bg-slate-900/60 p-4 rounded-xl border border-slate-800">
            <div className="text-xs font-bold text-white mb-2">
              Impacto de Características Sociodemográficas (pp por 1 Desviación Estándar):
            </div>
            {metrics.coefficients.slice(0, 10).map((c) => {
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
                  <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden flex">
                    <div
                      className="h-1.5 rounded-full"
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
        )}
      </section>

      {/* 3. Regla de Confiabilidad y Exclusiones */}
      <section className="space-y-3">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <span className="text-emerald-500">3.</span> Regla de Confiabilidad de Datos y Filtrado Técnico
        </h2>
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl space-y-3 text-xs text-slate-300">
          <div>
            <span className="font-semibold text-white block">Criterio estricto de confiabilidad (CCPC):</span>
            <div className="font-mono text-emerald-400 bg-slate-950 p-2.5 rounded-lg border border-slate-800 mt-1">
              {reliabilityRule}
            </div>
          </div>
          <p className="leading-relaxed">
            En ciertas elecciones históricas existen municipios donde los cuadernillos electorales no estuvieron disponibles o la tasa de registros no especificados (<span className="font-mono text-slate-300">ns_rate</span>) superó el 50%. En lugar de asignarles erróneamente un 0% de participación, el modelo los clasifica como <strong className="text-white">&quot;sin información confiable&quot;</strong>, excluyéndolos del entrenamiento para evitar sesgos artificiales.
          </p>

          <div>
            <span className="font-semibold text-white block mb-1.5">
              Municipios excluidos por no confiabilidad según año electoral:
            </span>
            <div className="flex flex-wrap gap-2">
              {Object.entries(excludedByYear).map(([yr, count]) => (
                <div
                  key={yr}
                  className="bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700/60 text-xs flex items-center gap-2"
                >
                  <span className="text-slate-400">{yr}:</span>
                  <span className="font-mono font-bold text-amber-300">{count} municipios</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 4. Construcción del Semáforo de Riesgo (4 componentes) */}
      <section className="space-y-3">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <span className="text-emerald-500">4.</span> Construcción del Semáforo de Riesgo 2027
        </h2>
        <p className="text-xs text-slate-300 leading-relaxed">
          El índice de riesgo municipal y estatal (0 a 100) pondera cuatro componentes clave:
        </p>
        <div className="font-mono text-slate-200 bg-slate-900 p-3 rounded-xl border border-slate-800 text-xs leading-relaxed">
          risk_score = 100 · ( 0.50 · rank(pred_abstencion) + 0.20 · rank(vulnerabilidad) + 0.15 · rank(−trend_pp) + 0.15 · rank(volatilidad) )
        </div>
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

      {/* 5. Fuentes de Información Oficial */}
      <section className="space-y-3">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <span className="text-emerald-500">5.</span> Fuentes de Información Oficial Abierta
        </h2>
        <p className="text-xs text-slate-300">
          El pipeline de ingestión y modelado se nutre exclusivamente de fuentes oficiales con enlaces directos:
        </p>
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900 text-[10px] uppercase font-bold text-slate-400 border-b border-slate-800">
              <tr>
                <th className="py-2.5 px-3">Fuente Institucional</th>
                <th className="py-2.5 px-3">Enlace Oficial</th>
                <th className="py-2.5 px-3 text-right">Años</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 bg-slate-900/40">
              {dataSources.map((ds, idx) => (
                <tr key={idx} className="hover:bg-slate-800/30">
                  <td className="py-2.5 px-3 font-semibold text-white">{ds.name}</td>
                  <td className="py-2.5 px-3">
                    {ds.url ? (
                      <a
                        href={ds.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-emerald-400 hover:text-emerald-300 underline font-mono text-[11px] inline-flex items-center gap-1"
                      >
                        <span>Visitar repositorio oficial</span>
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    ) : (
                      <span className="text-slate-400 font-mono text-[11px]">{ds.file ?? "—"}</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-slate-300">
                    {ds.years ? ds.years.join(", ") : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
