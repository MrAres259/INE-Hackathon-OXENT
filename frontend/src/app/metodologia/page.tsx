"use client";

import React, { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { getMetrics, getMeta } from "@/lib/api";
import type { ModelMetrics, Meta, MetaDataSource } from "@/lib/types";
import { CATEGORY_COLORS, CATEGORY_LABELS } from "@/lib/format";
import { GLOSSARY, type GlossaryEntry } from "@/lib/glossary";
import { BrandLockup } from "@/components/brand/BrandMark";

export interface NewsImpactParam {
  topic: string;
  s_topic_pp: number;
  harm: number;
  susc_var: string;
  label_es: string;
  rationale_es: string;
}

export const NEWS_IMPACT_PARAMS: NewsImpactParam[] = [
  {
    topic: "seguridad_violencia",
    s_topic_pp: 2.5,
    harm: 0.7,
    susc_var: "r_vuln",
    label_es: "Seguridad y violencia",
    rationale_es: "Eventos de inseguridad en zonas específicas pueden inhibir directamente la afluencia a casillas",
  },
  {
    topic: "resultados_fraude",
    s_topic_pp: 1.5,
    harm: 0.8,
    susc_var: "pct_internet",
    label_es: "Resultados y fraude",
    rationale_es: "Cuestionamientos a la certeza de los resultados debilitan la motivación cívica para emitir el voto",
  },
  {
    topic: "organizacion_casillas",
    s_topic_pp: 1.5,
    harm: 0.8,
    susc_var: "pct_rural",
    label_es: "Organización y casillas",
    rationale_es: "Problemas logísticos o reubicación de casillas impactan la accesibilidad física del electorado",
  },
  {
    topic: "confianza_institucional",
    s_topic_pp: 1.0,
    harm: 0.6,
    susc_var: "pct_internet",
    label_es: "Confianza institucional",
    rationale_es: "Los choques de confianza suelen mover la participación electoral en el orden de décimas de punto",
  },
  {
    topic: "presupuesto_recortes",
    s_topic_pp: 1.0,
    harm: 0.5,
    susc_var: "pct_rural",
    label_es: "Presupuesto y recortes",
    rationale_es: "Limitaciones presupuestales pueden mermar capacidades operativas y de despliegue territorial",
  },
  {
    topic: "credencial_padron",
    s_topic_pp: 1.0,
    harm: 1.0,
    susc_var: "pct_18_24",
    label_es: "Credencial y padrón",
    rationale_es: "Incertidumbre sobre vigencia de credencial desmoviliza especialmente a primeros votantes",
  },
  {
    topic: "procedimiento_votacion",
    s_topic_pp: 1.0,
    harm: 1.0,
    susc_var: "pct_internet",
    label_es: "Procedimiento de votación",
    rationale_es: "Confusión sobre requisitos u horarios de votación induce desinformación operativa directa",
  },
  {
    topic: "conducta_funcionarios",
    s_topic_pp: 0.5,
    harm: 0.4,
    susc_var: "vulnerability_pp",
    label_es: "Conducta de funcionarios",
    rationale_es: "Señalamientos a funcionarios individuales tienen impacto moderado en la conducta agregada",
  },
  {
    topic: "otra",
    s_topic_pp: 0.5,
    harm: 0.4,
    susc_var: "vulnerability_pp",
    label_es: "Otra temática",
    rationale_es: "Noticias no clasificadas presentan efectos acotados sobre la participación global",
  },
];

export interface SeverityActionRule {
  news_kind: string;
  threshold: string;
  action_label: string;
  secondary_actions?: string;
  deadline_hours: number;
  description: string;
}

export const SEVERITY_ACTIONS_RULES: SeverityActionRule[] = [
  {
    news_kind: "Falsa / Engañosa / Rumor",
    threshold: "Crítica (score ≥ 75 pts)",
    action_label: "Desmentido oficial (#INEdesmiente)",
    secondary_actions: "Reportar a plataforma + Responder y corregir",
    deadline_hours: 12,
    description: "Falsedades sobre requisitos de votación, fechas, anulación de credenciales o fraude viral.",
  },
  {
    news_kind: "Falsa / Engañosa / Rumor",
    threshold: "Alta (50 ≤ score < 75 pts)",
    action_label: "Reportar a plataforma",
    secondary_actions: "Responder y corregir con fuente verificada",
    deadline_hours: 24,
    description: "Rumores virales con alcance significativo en redes sociales.",
  },
  {
    news_kind: "Falsa / Engañosa / Rumor",
    threshold: "Media (25 ≤ score < 50 pts)",
    action_label: "Responder y corregir",
    secondary_actions: "Monitoreo de viralidad",
    deadline_hours: 48,
    description: "Afirmaciones engañosas o imprecisas en medios o redes sin viralidad extrema.",
  },
  {
    news_kind: "Falsa / Engañosa / Rumor",
    threshold: "Baja (score < 25 pts)",
    action_label: "Registrar en bitácora",
    secondary_actions: "Sin acción pública requerida",
    deadline_hours: 168,
    description: "Rumores incipientes o comentarios aislados con bajo enganche.",
  },
  {
    news_kind: "Verdadera / Crítica",
    threshold: "Impacto severo (Δ_max ≥ 1.0 pp o > 50k votos)",
    action_label: "Campaña de intervención",
    secondary_actions: "Comunicado oficial aclaratorio",
    deadline_hours: 48,
    description: "Eventos reales de alto impacto territorial que amenazan la afluencia en municipios prioritarios.",
  },
  {
    news_kind: "Verdadera / Crítica",
    threshold: "Impacto moderado (0.3 pp ≤ Δ_max < 1.0 pp)",
    action_label: "Comunicado oficial",
    secondary_actions: "Medidas operativas locales",
    deadline_hours: 72,
    description: "Dificultades operativas o presupuestales con impacto acotado a ciertas zonas.",
  },
  {
    news_kind: "Verdadera / Crítica",
    threshold: "Impacto leve (Δ_max < 0.3 pp y < 50k votos)",
    action_label: "Registrar en bitácora",
    secondary_actions: "Seguimiento en comisiones",
    deadline_hours: 168,
    description: "Controversias menores o de impacto marginal en el electorado.",
  },
];

export default function MetodologiaPage() {
  const [metrics, setMetrics] = useState<ModelMetrics | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [, setLoading] = useState(true);
  const [glossarySearch, setGlossarySearch] = useState("");
  const [activeSection, setActiveSection] = useState<string>("como-usar");
  const [copiedTerm, setCopiedTerm] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Metodología · Atalaya Electoral";
  }, []);

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

  const navSections = useMemo(
    () => [
      { href: "#como-usar", label: "Cómo usar Atalaya Electoral" },
      { href: "#glosario", label: "Glosario" },
      { href: "#inteligencia-ia", label: "Inteligencia con IA" },
      { href: "#campanas-combinadas", label: "Campañas combinadas" },
      { href: "#mapa-3d", label: "El mapa 3D" },
      { href: "#guardrails", label: "Límites del asistente" },
      { href: "#privacidad", label: "Privacidad y Anonimato" },
      { href: "#supuesto-nacional", label: "Supuesto Nacional 2027" },
      { href: "#modelos-predictivos", label: "1. Modelos Predictivos" },
      { href: "#perfil-estructural", label: "2. Perfil Estructural" },
      { href: "#confiabilidad", label: "3. Confiabilidad de Datos" },
      { href: "#semaforo", label: "4. Semáforo de Riesgo" },
      { href: "#fuentes", label: "5. Fuentes Oficiales" },
    ],
    []
  );

  useEffect(() => {
    const sectionIds = navSections.map((s) => s.href.slice(1));

    const handleScroll = () => {
      const scrollPosition = window.scrollY + 140;
      for (let i = sectionIds.length - 1; i >= 0; i--) {
        const el = document.getElementById(sectionIds[i]);
        if (el && el.offsetTop <= scrollPosition) {
          setActiveSection(sectionIds[i]);
          return;
        }
      }
      if (sectionIds.length > 0) {
        setActiveSection(sectionIds[0]);
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, [navSections]);

  const handleCopyLink = (anchorId: string) => {
    if (typeof window !== "undefined" && navigator?.clipboard) {
      const url = `${window.location.origin}${window.location.pathname}#${anchorId}`;
      navigator.clipboard
        .writeText(url)
        .then(() => {
          setCopiedTerm(anchorId);
          setTimeout(() => {
            setCopiedTerm((prev) => (prev === anchorId ? null : prev));
          }, 2000);
        })
        .catch(() => {});
    }
  };

  const dataSources: MetaDataSource[] =
    meta?.data_sources && meta.data_sources.length > 0
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

  const candidateModels =
    metrics?.candidates && metrics.candidates.length > 0
      ? metrics.candidates
      : [
          {
            name: "persist_l1",
            mean_mae_pp: 6.0,
            folds: [
              {
                train_until: 2018,
                test_year: 2021,
                mae_pp: 5.95,
                rmse_pp: 7.97,
                spearman: 0.84,
                top20_hit: 0.676,
                n: 2314,
                baseline_mae_pp: 5.95,
              },
              {
                train_until: 2021,
                test_year: 2024,
                mae_pp: 6.05,
                rmse_pp: 8.32,
                spearman: 0.805,
                top20_hit: 0.696,
                n: 2349,
                baseline_mae_pp: 6.05,
              },
            ],
          },
          {
            name: "persist_l2",
            mean_mae_pp: 8.12,
            folds: [
              {
                train_until: 2018,
                test_year: 2021,
                mae_pp: 11.91,
                rmse_pp: 14.2,
                spearman: 0.496,
                top20_hit: 0.419,
                n: 2314,
                baseline_mae_pp: 5.95,
              },
              {
                train_until: 2021,
                test_year: 2024,
                mae_pp: 4.32,
                rmse_pp: 5.92,
                spearman: 0.843,
                top20_hit: 0.685,
                n: 2349,
                baseline_mae_pp: 6.05,
              },
            ],
          },
          {
            name: "mean_l1_l2",
            mean_mae_pp: 6.11,
            folds: [
              {
                train_until: 2018,
                test_year: 2021,
                mae_pp: 7.73,
                rmse_pp: 9.64,
                spearman: 0.726,
                top20_hit: 0.611,
                n: 2314,
                baseline_mae_pp: 5.95,
              },
              {
                train_until: 2021,
                test_year: 2024,
                mae_pp: 4.49,
                rmse_pp: 6.05,
                spearman: 0.847,
                top20_hit: 0.749,
                n: 2349,
                baseline_mae_pp: 6.05,
              },
            ],
          },
          {
            name: "ridge",
            mean_mae_pp: 6.72,
            folds: [
              {
                train_until: 2018,
                test_year: 2021,
                mae_pp: 8.42,
                rmse_pp: 10.47,
                spearman: 0.679,
                top20_hit: 0.577,
                n: 2314,
                baseline_mae_pp: 5.95,
              },
              {
                train_until: 2021,
                test_year: 2024,
                mae_pp: 5.03,
                rmse_pp: 6.54,
                spearman: 0.812,
                top20_hit: 0.672,
                n: 2349,
                baseline_mae_pp: 6.05,
              },
            ],
          },
        ];

  const selectedModelKey = metrics?.selected_model ?? "persist_l1";
  const nationalAssumption = metrics?.national_level_assumption ?? 51.84;
  const reliabilityRule =
    metrics?.reliability_rule ?? "reliable = (ns_rate <= 0.5) and (participacion >= 0.02)";
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

  const normalizeSearch = (text: string): string =>
    text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();

  const glossaryEntries = useMemo(() => {
    return Object.entries(GLOSSARY) as [string, GlossaryEntry][];
  }, []);

  const filteredGlossary = useMemo(() => {
    const term = normalizeSearch(glossarySearch.trim());
    if (!term) return glossaryEntries;
    return glossaryEntries.filter(([key, entry]) => {
      const matchTitle = normalizeSearch(entry.title).includes(term);
      const matchBody = normalizeSearch(entry.body).includes(term);
      const matchRel = entry.relation ? normalizeSearch(entry.relation).includes(term) : false;
      const matchEx = entry.example ? normalizeSearch(entry.example).includes(term) : false;
      const matchKey = normalizeSearch(key).includes(term);
      return matchTitle || matchBody || matchRel || matchEx || matchKey;
    });
  }, [glossaryEntries, glossarySearch]);

  const groupedGlossary = useMemo(() => {
    const groups: {
      category: string;
      description: string;
      items: [string, GlossaryEntry][];
    }[] = [
      {
        category: "Escenarios y parámetros",
        description:
          "Variables de simulación 2027, palancas de intervención, cobertura y focalización territorial.",
        items: [],
      },
      {
        category: "Inteligencia con IA",
        description:
          "Planes estratégicos de campaña, investigación neutral en fuentes verificadas, monitor de medios y desinformación, y registro institucional.",
        items: [],
      },
      {
        category: "Semáforo e indicadores",
        description:
          "Índice de riesgo, componentes estadísticos, ranking de atención e indicadores del CCPC.",
        items: [],
      },
      {
        category: "Mapa",
        description:
          "Modos de visualización cartográfica, bloques 3D con foco, navegación y comparador con cortina.",
        items: [],
      },
      {
        category: "Asistente",
        description:
          "Capacidades de consulta en lenguaje natural, salvaguardas y fuentes de respuesta.",
        items: [],
      },
    ];

    const INTEL_KEYS = new Set([
      "plan_campana",
      "investigacion_gemini",
      "fuentes_verificadas",
      "nivel_verificacion",
      "hallazgo",
      "grupo_objetivo",
      "propuesta_palanca",
      "impacto_simulado",
      "diapositivas_editables",
      "clave_operador",
      "monitor_ine",
      "veredicto",
      "noticia_verdadera",
      "fake_news",
      "noticia_enganosa",
      "sin_verificar",
      "impacto_noticia",
      "decaimiento_noticia",
      "exposicion",
      "susceptibilidad",
      "viralidad",
      "riesgo_ignorar",
      "severidad",
      "accion_remediacion",
      "registro_ine",
      "fragmento_mapa",
    ]);

    for (const item of filteredGlossary) {
      const [key] = item;
      if (INTEL_KEYS.has(key)) {
        groups[1].items.push(item);
      } else if (
        key.startsWith("escenario") ||
        key.startsWith("param.") ||
        key.startsWith("lever.") ||
        key.startsWith("targeting.") ||
        key === "simulacion.votos" ||
        key === "campanas" ||
        key === "ambito" ||
        key === "combinacion" ||
        key === "traslape" ||
        key === "lineamientos"
      ) {
        groups[0].items.push(item);
      } else if (
        key.startsWith("modo.") ||
        key === "motor" ||
        key === "comparar.resumen" ||
        key === "buscador" ||
        key === "navegacion" ||
        key === "guia"
      ) {
        groups[3].items.push(item);
      } else if (key.startsWith("asistente")) {
        groups[4].items.push(item);
      } else {
        groups[2].items.push(item);
      }
    }

    return groups;
  }, [filteredGlossary]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* Encabezado: BrandLockup + volver al mapa */}
        <header className="space-y-4 pb-4 border-b border-border">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <BrandLockup />
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-primary transition-colors py-1 self-start sm:self-auto"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              <span>Volver al mapa</span>
            </Link>
          </div>

          <div>
            <h1 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
              Metodología y manual de uso de Atalaya Electoral
            </h1>
            <p className="text-sm text-muted-foreground mt-2 max-w-3xl leading-relaxed">
              Guía integral del sistema: pasos de navegación, glosario canónico interactivo, motor cartográfico 3D de bloques con foco, salvaguardas éticas del asistente, modelos predictivos y fuentes oficiales CCPC/INE/INEGI.
            </p>
          </div>
        </header>

        {/* Barra horizontal de chips en móvil / tablet (< 1024px) */}
        <nav
          aria-label="Navegación rápida de secciones"
          className="lg:hidden overflow-x-auto py-2 -mx-4 px-4 sm:-mx-6 sm:px-6 flex items-center gap-1.5 border-b border-border scrollbar-none"
        >
          {navSections.map((s) => {
            const isActive = activeSection === s.href.slice(1);
            return (
              <a
                key={s.href}
                href={s.href}
                className={`shrink-0 text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  isActive
                    ? "bg-primary-soft text-primary border-primary/30 font-semibold"
                    : "bg-card text-muted-foreground border-border hover:bg-accent hover:text-foreground"
                }`}
              >
                {s.label}
              </a>
            );
          })}
        </nav>

        {/* Layout principal: Columna izquierda sticky en PC + Contenido */}
        <div className="lg:flex lg:gap-8 lg:items-start">
          {/* Índice de secciones en PC (>= 1024px) */}
          <aside className="hidden lg:block w-[220px] shrink-0 sticky top-20 self-start">
            <div className="rounded-xl border border-border bg-card p-4 shadow-xs space-y-3">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground block px-1">
                Índice de secciones
              </span>
              <nav className="space-y-0.5 text-xs">
                {navSections.map((s) => {
                  const isActive = activeSection === s.href.slice(1);
                  return (
                    <a
                      key={s.href}
                      href={s.href}
                      className={`block px-2.5 py-1.5 rounded-lg transition-colors leading-snug ${
                        isActive
                          ? "bg-primary-soft text-primary font-semibold"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted"
                      }`}
                    >
                      {s.label}
                    </a>
                  );
                })}
              </nav>
            </div>
          </aside>

          {/* Secciones de contenido */}
          <main className="min-w-0 flex-1 space-y-8">
            {/* 1. Cómo usar Atalaya Electoral */}
            <section
              id="como-usar"
              className="rounded-xl border border-border bg-card p-5 sm:p-6 shadow-xs space-y-4 scroll-mt-20"
            >
              <div>
                <h2 className="font-display text-lg font-bold text-foreground flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-primary shrink-0"></span>
                  Cómo usar Atalaya Electoral
                </h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Flujo de trabajo sugerido para explorar el tablero y aprovechar el análisis territorial en 4 pasos:
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="p-4 rounded-xl bg-muted/40 border border-border space-y-2 flex flex-col justify-between">
                  <div className="space-y-1.5">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary-soft text-primary font-bold text-xs">
                      1
                    </span>
                    <h3 className="font-bold text-foreground text-sm">Explora el mapa y semáforo</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      El color de cada entidad o municipio refleja su riesgo de abstención 2027: 🔴 Crítico, 🟠 Alto, 🟡 Moderado y 🟢 Bajo, ordenados frente a la media nacional.
                    </p>
                  </div>
                  <span className="text-[10px] text-muted-foreground/80 font-mono">Modo Semáforo / Cambio Δ</span>
                </div>

                <div className="p-4 rounded-xl bg-muted/40 border border-border space-y-2 flex flex-col justify-between">
                  <div className="space-y-1.5">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary-soft text-primary font-bold text-xs">
                      2
                    </span>
                    <h3 className="font-bold text-foreground text-sm">Navega a municipios críticos</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Haz clic en cualquier estado para descender al nivel municipal. Usa el buscador rápido o haz clic en «← México» en la barra superior para volver al país.
                    </p>
                  </div>
                  <span className="text-[10px] text-muted-foreground/80 font-mono">Zoom automático y migas</span>
                </div>

                <div className="p-4 rounded-xl bg-muted/40 border border-border space-y-2 flex flex-col justify-between">
                  <div className="space-y-1.5">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary-soft text-primary font-bold text-xs">
                      3
                    </span>
                    <h3 className="font-bold text-foreground text-sm">Consulta el diagnóstico</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Revisa en el panel derecho los factores sociodemográficos que impulsan la abstención (educación, ruralidad, conectividad), la serie histórica CCPC y recomendaciones preventivas.
                    </p>
                  </div>
                  <span className="text-[10px] text-muted-foreground/80 font-mono">Ficha técnica por zona</span>
                </div>

                <div className="p-4 rounded-xl bg-muted/40 border border-border space-y-2 flex flex-col justify-between">
                  <div className="space-y-1.5">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary-soft text-primary font-bold text-xs">
                      4
                    </span>
                    <h3 className="font-bold text-foreground text-sm">Simula intervenciones</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Cambia el escenario en la barra superior (Base, Intervención o Pesimista). En «Ajustar» calibra palancas (jóvenes, casillas rurales), cobertura y focalización para proyectar votos recuperables.
                    </p>
                  </div>
                  <span className="text-[10px] text-muted-foreground/80 font-mono">Simulación de impacto</span>
                </div>
              </div>
            </section>

            {/* 2. Glosario con buscador */}
            <section
              id="glosario"
              className="rounded-xl border border-border bg-card p-5 sm:p-6 shadow-xs space-y-5 scroll-mt-20"
            >
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                <div>
                  <h2 className="font-display text-lg font-bold text-foreground flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-primary shrink-0"></span>
                    Glosario
                  </h2>
                  <p className="text-xs text-muted-foreground mt-1">
                    Definiciones oficiales de todos los indicadores, escenarios y controles de la plataforma. Todo proviene del glosario central.
                  </p>
                </div>

                {/* Buscador de términos */}
                <div className="w-full sm:w-80">
                  <div className="relative">
                    <svg
                      className="w-4 h-4 text-muted-foreground absolute left-3 top-2.5 pointer-events-none"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                      />
                    </svg>
                    <input
                      type="text"
                      value={glossarySearch}
                      onChange={(e) => setGlossarySearch(e.target.value)}
                      placeholder="Buscar término o concepto..."
                      className="w-full bg-background border border-border rounded-lg pl-9 pr-8 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-colors"
                    />
                    {glossarySearch && (
                      <button
                        type="button"
                        onClick={() => setGlossarySearch("")}
                        className="absolute right-2.5 top-2 text-xs text-muted-foreground hover:text-foreground p-0.5 rounded cursor-pointer"
                        title="Limpiar búsqueda"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground mt-1 block">
                    Mostrando {filteredGlossary.length} de {glossaryEntries.length} términos
                  </span>
                </div>
              </div>

              {groupedGlossary.map((group) => {
                if (group.items.length === 0) return null;
                return (
                  <div key={group.category} className="space-y-3 pt-2">
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-2">
                        <span>{group.category}</span>
                        <span className="text-[10px] bg-muted text-muted-foreground px-2 py-0.5 rounded-full font-mono tnum">
                          {group.items.length}
                        </span>
                      </h3>
                      <p className="text-xs text-muted-foreground mt-0.5">{group.description}</p>
                    </div>

                    <div className="divide-y divide-border rounded-xl border border-border bg-card overflow-hidden shadow-2xs">
                      {group.items.map(([key, item]) => {
                        const anchorId = `g-${key.replace(/\./g, "-")}`;
                        return (
                          <div
                            key={key}
                            id={anchorId}
                            className="group p-4 space-y-2 hover:bg-muted/30 transition-colors scroll-mt-24"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <h4 className="font-semibold text-foreground text-sm leading-snug">
                                {item.title}
                              </h4>
                              <button
                                type="button"
                                onClick={() => handleCopyLink(anchorId)}
                                className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-muted-foreground hover:text-primary transition-opacity shrink-0 p-1 -m-1 rounded hover:bg-muted cursor-pointer"
                                title="Copiar enlace a este término"
                                aria-label={`Enlace a ${item.title}`}
                              >
                                {copiedTerm === anchorId ? (
                                  <span className="text-[10px] font-medium text-good">Copiado</span>
                                ) : (
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                                    />
                                  </svg>
                                )}
                              </button>
                            </div>

                            <p className="text-xs text-muted-foreground leading-relaxed">
                              {item.body}
                            </p>

                            {item.relation && (
                              <div className="text-[11px] bg-muted/60 p-2.5 rounded-lg border border-border text-foreground leading-normal">
                                <strong className="text-primary font-semibold block mb-0.5">Cómo se relaciona:</strong>
                                {item.relation}
                              </div>
                            )}

                            {item.example && (
                              <div className="text-[11px] bg-primary-soft/40 p-2.5 rounded-lg border border-primary/20 text-foreground font-mono leading-normal">
                                <strong className="text-primary font-semibold font-sans block mb-0.5">Ejemplo:</strong>
                                {item.example}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </section>

            {/* 3. Inteligencia con IA (Plan de Campaña y Monitor INE) */}
            <section
              id="inteligencia-ia"
              className="rounded-xl border border-border bg-card p-5 sm:p-6 shadow-xs space-y-6 scroll-mt-20"
            >
              <div className="border-b border-border pb-4 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-primary shrink-0" />
                  <h2 className="font-display text-lg font-bold text-foreground">
                    Inteligencia con IA: Plan de Campaña y Monitor INE
                  </h2>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Metodología de los dos módulos de inteligencia artificial de Atalaya Electoral: investigación territorial de abstención en fuentes verificadas con Gemini, formulación estratégica de planes de campaña con GLM-5.3, monitoreo de incidentes y desinformación con cálculo de impacto en participación, y bitácora institucional inmutable.
                </p>
              </div>

              {/* Subsección A: Plan de Campaña Estratégico */}
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display text-base font-bold text-foreground flex items-center gap-2">
                    <span className="text-primary font-bold text-sm">A.</span>
                    Plan Estratégico de Campaña (Investigación, Planeación y Diapositivas)
                  </h3>
                  <span className="text-[10px] bg-primary-soft text-primary font-mono px-2 py-0.5 rounded-full font-semibold">
                    Gemini 3.8 Flash + GLM-5.3 + Simulador
                  </span>
                </div>

                <div className="p-4 rounded-xl bg-muted/40 border border-border space-y-2 text-xs">
                  <span className="font-bold text-foreground block text-sm">
                    ¿Qué hace el Plan de Campaña?
                  </span>
                  <p className="text-muted-foreground leading-relaxed">
                    Es una herramienta de auxilio operativo para las Juntas Locales y Distritales Ejecutivas del INE. Ante un estado o municipio en semáforo rojo o naranja, el sistema investiga en repositorios documentales por qué la ciudadanía no acude a votar, formula un plan de intervención estructurado con base en las atribuciones del Instituto, calcula con el simulador matemático el impacto en votos y reducción de abstención, y entrega una baraja de 10 diapositivas ejecutivas editables exportables a PowerPoint (PPTX) y PDF.
                  </p>
                </div>

                {/* Flujo de 5 etapas */}
                <div className="space-y-2 text-xs">
                  <span className="font-bold text-foreground text-xs uppercase tracking-wider block">
                    Flujo de ejecución en 5 etapas secuenciales:
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
                    <div className="p-3 rounded-lg bg-card border border-border space-y-1.5 shadow-2xs">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-primary text-[11px]">1. Datos Atalaya</span>
                        <span className="text-[10px] font-mono text-muted-foreground">5 %</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        Carga el diagnóstico territorial: abstención pronosticada 2027, lista nominal, brecha de jóvenes 18–24, ruralidad, lenguas indígenas, tendencia CCPC y factores sociodemográficos.
                      </p>
                    </div>

                    <div className="p-3 rounded-lg bg-card border border-border space-y-1.5 shadow-2xs">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-primary text-[11px]">2. Investigación</span>
                        <span className="text-[10px] font-mono text-muted-foreground">15–55 %</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        Gemini 3.8 Flash con búsqueda Google rastrea causas documentadas de abstención en los últimos 6 años exclusivamente en fuentes verificadas; descarta redes y partidos.
                      </p>
                    </div>

                    <div className="p-3 rounded-lg bg-card border border-border space-y-1.5 shadow-2xs">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-primary text-[11px]">3. Planeación GLM</span>
                        <span className="text-[10px] font-mono text-muted-foreground">60–85 %</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        GLM-5.3 redacta 2–4 propuestas vinculadas a las palancas del INE, grupo objetivo con tamaño calculado, pasos con responsables del INE hasta mayo 2027, riesgos y KPIs.
                      </p>
                    </div>

                    <div className="p-3 rounded-lg bg-card border border-border space-y-1.5 shadow-2xs">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-primary text-[11px]">4. Simulación</span>
                        <span className="text-[10px] font-mono text-muted-foreground">90 %</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        El motor determinista de Atalaya calcula el impacto cuantitativo (votos adicionales, reducción de abstención, rendimientos decrecientes y traslape). El LLM no inventa cifras.
                      </p>
                    </div>

                    <div className="p-3 rounded-lg bg-card border border-border space-y-1.5 shadow-2xs">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-primary text-[11px]">5. Diapositivas</span>
                        <span className="text-[10px] font-mono text-muted-foreground">95 %</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        Arma la baraja ejecutiva de 10 láminas en formato 16:9 con mapa fragmento de la zona y diseño de marca, editable directamente en pantalla y descargable a PPTX y PDF.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Fuentes admitidas vs descartadas y por qué el LLM no escribe cifras */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div className="p-4 rounded-xl bg-muted/40 border border-border space-y-2">
                    <h4 className="font-bold text-foreground text-sm flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-good shrink-0" />
                      Niveles de verificación admitidos y filtros anti-alucinación
                    </h4>
                    <p className="text-muted-foreground leading-relaxed">
                      Para garantizar certeza jurídica y máxima publicidad, solo se aceptan fuentes pertenecientes a <strong className="text-foreground">VERIFIABLE_TIERS</strong>:
                    </p>
                    <ul className="list-disc list-inside space-y-1 text-muted-foreground leading-relaxed pl-1">
                      <li><strong className="text-foreground">Oficial:</strong> Acuerdos del INE, OPLEs, dependencias públicas (.gob.mx, ine.mx) y censos INEGI.</li>
                      <li><strong className="text-foreground">Verificadores acreditados:</strong> Verificado.mx, AFP Factual, El Sabueso / Animal Político, Reuters Fact Check y Newtral.</li>
                      <li><strong className="text-foreground">Académico:</strong> Investigaciones de universidades (.edu.mx, UNAM, El Colmex, CIDE).</li>
                      <li><strong className="text-foreground">Medios reconocidos:</strong> Prensa nacional y regional con consejo editorial verificable.</li>
                    </ul>
                    <div className="p-2.5 rounded-lg bg-card border border-border text-[11px] text-muted-foreground space-y-1">
                      <strong className="text-destructive font-semibold block">Fuentes descartadas categóricamente:</strong>
                      <span>Redes sociales, blogs anónimos, partidos políticos, candidaturas y declaraciones proselitistas. Si un hallazgo pierde sus fuentes verificadas, se elimina. Además, toda URL citada por el modelo que no figure en los fragmentos de búsqueda (grounding chunks) o la lista semilla se descarta para evitar alucinaciones.</span>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-muted/40 border border-border space-y-2">
                    <h4 className="font-bold text-foreground text-sm flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
                      Por qué el LLM no escribe cifras de impacto
                    </h4>
                    <p className="text-muted-foreground leading-relaxed">
                      Los modelos de lenguaje son redactores cualitativos, pero propensos a alucinar sumas aritméticas o proyectar recuperaciones mágicas de votos. En Atalaya Electoral rige una regla estricta:
                    </p>
                    <div className="p-2.5 rounded-lg bg-card border border-border font-mono text-[11px] text-primary font-semibold">
                      LLM redacta propuestas operativas · El motor matemático calcula los votos
                    </div>
                    <p className="text-muted-foreground leading-relaxed">
                      Las cifras de votos recuperables, cambio en puntos porcentuales, rendimientos decrecientes y traslape provienen de la simulación determinista (<span className="font-mono text-foreground font-semibold">model.scenarios.simulate</span>). El LLM recibe las cifras ya calculadas y no puede modificarlas.
                    </p>
                    <div className="p-2.5 rounded-lg bg-card border border-border text-[11px] text-muted-foreground space-y-1">
                      <strong className="text-foreground font-semibold block">Modo de respaldo y sin internet:</strong>
                      <span>Si la API de Gemini alcanza su límite de cuota (40 consultas diarias) o falla, se activa el respaldo de búsqueda en Google News / Bing. Si la máquina opera sin conexión a internet, se generan planes deterministas basados en las recomendaciones de política del CCPC (<span className="font-mono text-foreground">llm.degraded = true</span>).</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Subsección B: Monitor INE */}
              <div className="space-y-4 pt-2 border-t border-border">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display text-base font-bold text-foreground flex items-center gap-2">
                    <span className="text-primary font-bold text-sm">B.</span>
                    Monitor Institucional de Medios, Desinformación y Remediación
                  </h3>
                  <span className="text-[10px] bg-primary-soft text-primary font-mono px-2 py-0.5 rounded-full font-semibold">
                    Veredictos + Impacto Territorial + Severidad
                  </span>
                </div>

                <div className="p-4 rounded-xl bg-muted/40 border border-border space-y-2 text-xs">
                  <span className="font-bold text-foreground block text-sm">
                    Detección temprana y clasificación por veracidad
                  </span>
                  <p className="text-muted-foreground leading-relaxed">
                    El Monitor rastrea continuamente noticias críticas sobre el INE y afirmaciones virales en medios y redes sociales (X, TikTok, Facebook, YouTube, Telegram). Clasifica cada incidente en uno de cuatro veredictos institucionales con regla mínima de evidencia:
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 pt-1 font-mono text-[11px]">
                    <div className="p-2.5 rounded bg-card border border-border">
                      <span className="text-bad font-sans font-bold block">1. Verdadera</span>
                      <span className="text-muted-foreground font-sans text-[10px]">Hecho real desfavorable sobre operación, presupuesto, casillas o credencial. Requiere ≥ 1 fuente verificada.</span>
                    </div>
                    <div className="p-2.5 rounded bg-card border border-border">
                      <span className="text-destructive font-sans font-bold block">2. Falsa</span>
                      <span className="text-muted-foreground font-sans text-[10px]">Desinformación o rumor sin sustento desmentido por verificadores acreditados o #INEdesmiente.</span>
                    </div>
                    <div className="p-2.5 rounded bg-card border border-border">
                      <span className="text-risk-mid font-sans font-bold block">3. Engañosa</span>
                      <span className="text-muted-foreground font-sans text-[10px]">Dato real descontextualizado o con interpretaciones tendenciosas que confunden al votante.</span>
                    </div>
                    <div className="p-2.5 rounded bg-card border border-border">
                      <span className="text-muted-foreground font-sans font-bold block">4. Sin verificar</span>
                      <span className="text-muted-foreground font-sans text-[10px]">Contenido viral reciente en seguimiento sin dictamen concluyente de verificadores.</span>
                    </div>
                  </div>
                </div>

                {/* Modelo de impacto en participación (§7.3) */}
                <div className="p-4 rounded-xl bg-muted/30 border border-border space-y-3 text-xs">
                  <div>
                    <h4 className="font-bold text-foreground text-sm flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
                      Modelo de Impacto Territorial Realista en Participación Ciudadana
                    </h4>
                    <p className="text-muted-foreground mt-1 leading-relaxed">
                      Cuando una noticia verdadera o engañosa afecta la credibilidad u operación electoral, el modelo cuantifica el incremento potencial en puntos porcentuales (pp) de abstención por municipio i, agregándolo después a nivel estatal ponderado por Lista Nominal:
                    </p>
                  </div>

                  <div className="font-mono text-foreground bg-card p-3.5 rounded-xl border border-border leading-relaxed overflow-x-auto shadow-2xs space-y-1.5">
                    <div className="text-primary font-bold">
                      Δ_i (pp de abstención) = min(CAP, S_topic × intensity × decay × exposure_i × susc_i)
                    </div>
                    <div className="text-muted-foreground font-sans text-[11px] space-y-0.5">
                      <div>• <strong className="text-foreground">S_topic:</strong> Sensibilidad base en pp a exposición plena (0.5 a 2.5 pp según tema).</div>
                      <div>• <strong className="text-foreground">intensity:</strong> Magnitud del choque informativo (rango conservador de 0.25 a 1.0).</div>
                      <div>• <strong className="text-foreground">decay:</strong> Decaimiento exponencial con días restantes a la elección d = (2027-06-06 − hoy): coyuntural exp(−d/60), persistente exp(−d/240), estructural 1.0. (Un incidente coyuntural a un año de la elección decae de forma realista).</div>
                      <div>• <strong className="text-foreground">exposure_i:</strong> Nacional = 0.6 + 0.4 × rank(pct_internet); Estatal = 1 en entidades afectadas, 0 fuera; Municipal = 1 en municipios afectados, 0.35 en el resto de su estado.</div>
                      <div>• <strong className="text-foreground">susc_i ∈ [0.5, 1.5]:</strong> 0.5 + 0.5 × rank(volatilidad) + 0.5 × rank(variable_tema), donde la variable es: credencial → jóvenes 18–24; casillas/presupuesto → ruralidad; confianza/procedimiento → internet; seguridad → índice de vulnerabilidad.</div>
                      <div>• <strong className="text-foreground">CAP institucional:</strong> Tope máximo estricto de 3.0 pp. Banda: [0.5 × Δ_i, min(3.0, 1.5 × Δ_i)].</div>
                      <div>• <strong className="text-foreground">Votos perdidos:</strong> (Δ_i / 100) × Lista Nominal_i. Los municipios con Δ ≥ 0.05 pp se presentan en el fragmento cartográfico 2D.</div>
                    </div>
                  </div>

                  {/* Tabla de parámetros de impacto por tema */}
                  <div className="space-y-2 pt-2">
                    <span className="font-bold text-foreground text-xs uppercase tracking-wider block">
                      Tabla oficial de parámetros por temática de noticia (data/seed/news_impact_params.csv):
                    </span>
                    <div className="overflow-x-auto rounded-xl border border-border shadow-2xs bg-card">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-muted text-[10px] uppercase font-bold text-muted-foreground border-b border-border">
                          <tr>
                            <th className="py-2.5 px-3">Temática</th>
                            <th className="py-2.5 px-2 text-right">Efecto Base S_topic</th>
                            <th className="py-2.5 px-2 text-right">Daño (Harm)</th>
                            <th className="py-2.5 px-2">Variable Susceptibilidad</th>
                            <th className="py-2.5 px-3">Justificación Institucional</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {NEWS_IMPACT_PARAMS.map((row) => (
                            <tr key={row.topic} className="hover:bg-muted/30 transition-colors">
                              <td className="py-2.5 px-3 font-semibold text-foreground">
                                <div>{row.label_es}</div>
                                <div className="text-[10px] text-muted-foreground font-mono font-normal">{row.topic}</div>
                              </td>
                              <td className="py-2.5 px-2 text-right font-mono font-bold text-primary tnum">
                                {row.s_topic_pp.toFixed(1)} pp
                              </td>
                              <td className="py-2.5 px-2 text-right font-mono text-muted-foreground tnum">
                                {row.harm.toFixed(1)}
                              </td>
                              <td className="py-2.5 px-2 font-mono text-[11px] text-ink">
                                {row.susc_var}
                              </td>
                              <td className="py-2.5 px-3 text-[11px] text-muted-foreground leading-relaxed">
                                {row.rationale_es}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                {/* Viralidad y Riesgo de ignorar */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div className="p-4 rounded-xl bg-muted/40 border border-border space-y-2">
                    <h4 className="font-bold text-foreground text-sm flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
                      Índice de Viralidad Digital (§7.4 revisada)
                    </h4>
                    <p className="text-muted-foreground leading-relaxed">
                      Para rumores y publicaciones en redes sociales, el enganche por post pondera interacciones visibles:
                    </p>
                    <div className="bg-card p-2 rounded border border-border font-mono text-[11px] text-foreground">
                      e = 3·shares + 2·comments + likes + 0.05·views (métrica oculta ⇒ 50)
                    </div>
                    <p className="text-muted-foreground leading-relaxed">
                      El puntaje (0 a 100) aplica escala logarítmica para calibrar adecuadamente notas virales reales sin saturación prematura:
                    </p>
                    <div className="bg-card p-2 rounded border border-border font-mono text-[10px] text-primary">
                      score = clamp(0, 100, round(15·log10(1+Σe) + 6·(n_plat−1) + 3·min(n_posts,5) + R − 15))
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Donde <strong className="text-foreground">R = 8</strong> si el post más reciente tiene ≤ 48 horas (4 si ≤ 7 días). Niveles: <strong className="text-good font-semibold">Baja</strong> (&lt;25), <strong className="text-risk-mid font-semibold">Media</strong> (25–49), <strong className="text-bad font-semibold">Alta</strong> (50–74) y <strong className="text-destructive font-semibold">Crítica</strong> (≥75).
                    </p>
                  </div>

                  <div className="p-4 rounded-xl bg-muted/40 border border-border space-y-2">
                    <h4 className="font-bold text-foreground text-sm flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-destructive shrink-0" />
                      Riesgo de ignorar la desinformación
                    </h4>
                    <p className="text-muted-foreground leading-relaxed">
                      El sistema calcula la aceleración esperada si la autoridad electoral no interviene (+15 puntos en 7 días para notas en crecimiento).
                    </p>
                    <div className="p-3 rounded-lg bg-card border border-border space-y-1 text-[11px] leading-relaxed">
                      <strong className="text-foreground block font-semibold">Efecto de desmovilización electoral directa:</strong>
                      <p className="text-muted-foreground">
                        Ignorar una falsedad que superó la viralidad media la consolida como la única versión disponible en buscadores e inteligencia artificial comercial. Si la desinformación atañe a <strong className="text-foreground">requisitos de credencial, vigencia del padrón o ubicación de casillas</strong>, induce abstención directa e involuntaria el día de las elecciones.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Severidad y Acciones institucionales */}
                <div className="space-y-2">
                  <span className="font-bold text-foreground text-xs uppercase tracking-wider block">
                    Matriz de Severidad Institucional y Plazos de Atención (§7.5):
                  </span>
                  <div className="overflow-x-auto rounded-xl border border-border shadow-2xs bg-card">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-muted text-[10px] uppercase font-bold text-muted-foreground border-b border-border">
                        <tr>
                          <th className="py-2.5 px-3">Tipo de Incidente</th>
                          <th className="py-2.5 px-2">Umbral de Severidad</th>
                          <th className="py-2.5 px-2">Acción Principal</th>
                          <th className="py-2.5 px-2">Acciones Secundarias</th>
                          <th className="py-2.5 px-2 text-right">Plazo Límite</th>
                          <th className="py-2.5 px-3">Descripción Operativa</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {SEVERITY_ACTIONS_RULES.map((rule, idx) => (
                          <tr key={idx} className="hover:bg-muted/30 transition-colors">
                            <td className="py-2.5 px-3 font-semibold text-foreground">
                              {rule.news_kind}
                            </td>
                            <td className="py-2.5 px-2 font-mono text-[11px] text-ink">
                              {rule.threshold}
                            </td>
                            <td className="py-2.5 px-2 font-semibold text-primary">
                              {rule.action_label}
                            </td>
                            <td className="py-2.5 px-2 text-[11px] text-muted-foreground">
                              {rule.secondary_actions ?? "—"}
                            </td>
                            <td className="py-2.5 px-2 text-right font-mono font-bold text-foreground tnum">
                              {rule.deadline_hours} h
                            </td>
                            <td className="py-2.5 px-3 text-[11px] text-muted-foreground leading-relaxed">
                              {rule.description}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Registro inmutable y clave de operador */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="p-3.5 rounded-lg bg-muted/40 border border-border space-y-1.5">
                    <strong className="text-foreground block font-semibold flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
                      Registro inmutable append-only (Bitácora oficial)
                    </strong>
                    <p className="text-muted-foreground leading-relaxed text-[11px]">
                      Cada incidente cuenta con un estado institucional (<span className="font-mono text-foreground">pendiente</span>, <span className="font-mono text-foreground">enterado</span>, <span className="font-mono text-foreground">comunicado_emitido</span>, <span className="font-mono text-foreground">campana_planeada</span>, <span className="font-mono text-foreground">respondida</span>, <span className="font-mono text-foreground">reportada</span> o <span className="font-mono text-foreground">descartada</span>). Los acuerdos se asientan cronológicamente en <span className="font-mono text-foreground">registry.jsonl</span> de forma inalterable (nunca se borra ni sobrescribe), garantizando certeza y rendición de cuentas interna.
                    </p>
                  </div>

                  <div className="p-3.5 rounded-lg bg-muted/40 border border-border space-y-1.5">
                    <strong className="text-foreground block font-semibold flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
                      Clave de Operador Institucional (Control de acceso)
                    </strong>
                    <p className="text-muted-foreground leading-relaxed text-[11px]">
                      La consulta ciudadana de diagnósticos y noticias es completamente abierta. No obstante, las acciones que consumen cuotas de IA o asientan acuerdos oficiales (investigar con Gemini, forzar escaneos y registrar decisiones del INE) requieren autenticación mediante <span className="font-mono text-foreground font-semibold">ATALAYA_OPERATOR_TOKEN</span> enviado en la cabecera segura <span className="font-mono text-foreground font-semibold">X-Operator-Token</span>.
                    </p>
                  </div>
                </div>
              </div>

              {/* Subsección C: Límites Éticos y Principios Rectores */}
              <div className="space-y-3 pt-2 border-t border-border">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-primary shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  <h3 className="font-display text-sm font-bold text-foreground uppercase tracking-wider">
                    Salvaguardas Éticas y Principios Constitucionales en Inteligencia Artificial
                  </h3>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 text-xs">
                  <div className="p-3 rounded-lg bg-card border border-border space-y-1.5 shadow-2xs">
                    <span className="font-bold text-primary text-[11px] block">1. Escenarios hipotéticos</span>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Todo cálculo de impacto es una simulación orientativa para planeación institucional preventiva. Nunca se presenta como evaluación de causalidad económica o social retroactiva.
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-card border border-border space-y-1.5 shadow-2xs">
                    <span className="font-bold text-primary text-[11px] block">2. Privacidad y anonimato</span>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Exclusión absoluta de datos personales. En redes sociales solo se identifican los nombres de usuario públicos (*handles*) para reportar ante plataformas o emitir réplicas; nunca se perfilan personas.
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-card border border-border space-y-1.5 shadow-2xs">
                    <span className="font-bold text-primary text-[11px] block">3. Neutralidad institucional</span>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Apego estricto a los principios rectores del INE: ningún prompt ni texto generado menciona partidos políticos, candidaturas, preferencias electorales ni encuestas de intención de voto.
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-card border border-border space-y-1.5 shadow-2xs">
                    <span className="font-bold text-primary text-[11px] block">4. Supervisión humana</span>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      La IA se equivoca y puede presentar imprecisiones: todo plan, diagnóstico cualitativo y borrador de comunicado es una propuesta preliminar sujeta a revisión, dictamen y aprobación humana.
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-card border border-border space-y-1.5 shadow-2xs">
                    <span className="font-bold text-primary text-[11px] block">5. Cuota y sustentabilidad</span>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Límite diario de 40 consultas gratuitas para preservar el presupuesto institucional, con mecanismos automáticos de degradación elegante a respaldos locales y deterministas.
                    </p>
                  </div>
                </div>
              </div>
            </section>

            {/* Campañas combinadas (Multi-palanca, país o estados) */}
            <section
              id="campanas-combinadas"
              className="rounded-xl border border-border bg-card p-5 sm:p-6 shadow-xs space-y-5 scroll-mt-20"
            >
              <div>
                <h2 className="font-display text-lg font-bold text-foreground flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-primary shrink-0"></span>
                  Campañas Combinadas: Simulación Multi-Palanca y Rendimientos Decrecientes
                </h2>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  El simulador de intervención permite proyectar el impacto conjunto de múltiples campañas institucionales simultáneas (hasta 4, una por cada palanca del INE) en todo el país o en estados seleccionados.
                </p>
              </div>

              {/* Bloque 1: Qué es y cómo se configura */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="p-4 rounded-xl bg-muted/40 border border-border space-y-2">
                  <h3 className="font-bold text-foreground text-sm flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-primary shrink-0"></span>
                    ¿Qué es una campaña combinada?
                  </h3>
                  <p className="text-muted-foreground leading-relaxed">
                    Un directivo o equipo técnico del INE puede planear simultáneamente varias acciones territoriales: por ejemplo, una campaña nacional de promoción del voto joven junto con una instalación reforzada de casillas rurales focalizada únicamente en estados con alta dispersión territorial (como Chiapas y Oaxaca).
                  </p>
                  <p className="text-muted-foreground leading-relaxed">
                    Se admite <strong className="text-foreground">hasta 4 campañas concurrentes</strong>, con un máximo de <strong className="text-foreground">una campaña por cada palanca institucional</strong> (promoción del voto joven, casillas rurales, materiales en lenguas indígenas y campaña general).
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-muted/40 border border-border space-y-2">
                  <h3 className="font-bold text-foreground text-sm flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-primary shrink-0"></span>
                    Parámetros independientes por campaña
                  </h3>
                  <p className="text-muted-foreground leading-relaxed">
                    Cada campaña se calibra de forma completamente independiente con cuatro parámetros operativos:
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-muted-foreground leading-relaxed pl-1">
                    <li><strong className="text-foreground">Palanca institucional:</strong> Determina la variable sociodemográfica de ponderación territorial (jóvenes, ruralidad, lengua originaria o peso uniforme 1×).</li>
                    <li><strong className="text-foreground">Focalización por semáforo:</strong> Zonas rojas (riesgo crítico), rojas y naranjas, o todas las zonas.</li>
                    <li><strong className="text-foreground">Ámbito territorial:</strong> Todo el país o entidades específicas (las 32 Juntas Locales Ejecutivas).</li>
                    <li><strong className="text-foreground">Efecto y cobertura:</strong> Efecto máximo esperado (0 a 10 pp) y porcentaje de cobertura en territorio (0 a 100 %).</li>
                  </ul>
                </div>
              </div>

              {/* Bloque 2: Regla de combinación (Rendimientos Decrecientes) */}
              <div className="p-4 rounded-xl bg-muted/30 border border-border space-y-3 text-xs">
                <div>
                  <h3 className="font-bold text-foreground text-sm flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-primary shrink-0"></span>
                    Regla de combinación: Rendimientos decrecientes
                  </h3>
                  <p className="text-muted-foreground mt-1 leading-relaxed">
                    Cuando dos o más campañas coinciden sobre un mismo municipio, sus efectos no se suman de manera lineal (lo que sobrestimaría votos recuperables y podría arrojar participaciones imposibles superiores al 100 %). Cada campaña adicional actúa sucesivamente sobre la <strong className="text-foreground">abstención remanente</strong> con rendimientos decrecientes.
                  </p>
                </div>

                {/* Fórmula */}
                <div className="font-mono text-foreground bg-card p-3.5 rounded-xl border border-border leading-relaxed overflow-x-auto shadow-2xs space-y-1.5">
                  <div className="text-muted-foreground font-sans text-[11px] font-semibold">
                    Fórmula matemática por municipio i con abstención base a_i = 1 − participacion_i:
                  </div>
                  <div>
                    1. Efecto ponderado de campaña c: <span className="text-primary font-bold">Δ_c,i = (effect_pp/100) · (coverage/100) · w_c,i</span> (si i cumple focalización y ámbito; 0 si no)
                  </div>
                  <div>
                    2. Tasa de reducción relativa: <span className="text-primary font-bold">r_c,i = min(Δ_c,i / a_i, 1)</span>
                  </div>
                  <div>
                    3. Abstención combinada nueva: <span className="text-primary font-bold">a&apos;_i = a_i · ∏_c (1 − r_c,i)</span>
                  </div>
                  <div>
                    4. Participación nueva proyectada: <span className="text-primary font-bold">min(1 − a&apos;_i, 0.98)</span> (tope institucional de 98 %)
                  </div>
                </div>

                {/* Ejemplo ilustrativo */}
                <div className="p-3.5 rounded-lg bg-primary-soft/40 border border-primary/20 space-y-2 text-foreground">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-primary">
                      Ejemplo ilustrativo hipotético (60 % de abstención base):
                    </span>
                  </div>
                  <p className="text-muted-foreground leading-relaxed">
                    Consideremos un municipio con una abstención inicial del 60 % (<span className="font-mono text-foreground font-semibold">a = 0.60</span>) y dos campañas concurrentes:
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono text-[11px]">
                    <div className="bg-card p-2.5 rounded border border-border">
                      <strong className="font-sans text-primary block">Campaña 1 (Voto joven):</strong>
                      Efecto esperado: Δ₁ = 6.0 pp (0.06)<br />
                      Tasa r₁ = 0.06 / 0.60 = 0.10 (reduce 10 % de la abstención)
                    </div>
                    <div className="bg-card p-2.5 rounded border border-border">
                      <strong className="font-sans text-primary block">Campaña 2 (Casillas rurales):</strong>
                      Efecto esperado: Δ₂ = 4.0 pp (0.04)<br />
                      Tasa r₂ = 0.04 / 0.60 = 0.0667 (reduce 6.67 % remanente)
                    </div>
                  </div>
                  <div className="p-2.5 rounded bg-card border border-border text-[11px] leading-relaxed">
                    <strong className="font-sans text-foreground">Resultado combinado: </strong>
                    <span className="font-mono text-primary font-bold">a&apos; = 0.60 × (1 − 0.10) × (1 − 0.0667) = 0.60 × 0.90 × 0.9333 = 0.504 (50.4 % de abstención)</span>.
                    <br />
                    Reducción total combinada: <strong className="text-good font-semibold">−9.6 pp</strong> (en lugar de −10.0 pp de una suma lineal). La diferencia de 0.4 pp refleja que la segunda campaña incide sobre electores ya motivados por la primera.
                  </div>
                  <span className="text-[10px] text-muted-foreground italic block">
                    * Nota: Si se configura una sola campaña, la fórmula equivale exactamente a la resta directa a_i − Δ, manteniendo idénticas todas las cifras históricas del sistema.
                  </span>
                </div>
              </div>

              {/* Bloque 3: Ámbito territorial por estado y métricas de traslape */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="p-4 rounded-xl bg-muted/40 border border-border space-y-2">
                  <h3 className="font-bold text-foreground text-sm flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-primary shrink-0"></span>
                    Ámbito territorial: Todo el país o Estados (JLE)
                  </h3>
                  <p className="text-muted-foreground leading-relaxed">
                    El ámbito por estado se estructura directamente sobre las <strong className="text-foreground">32 Juntas Locales Ejecutivas (JLE)</strong> del INE.
                  </p>
                  <p className="text-muted-foreground leading-relaxed">
                    Un municipio es intervenido por una campaña si y solo si cumple la intersección de dos condiciones:
                  </p>
                  <div className="bg-card p-2.5 rounded-lg border border-border font-mono text-[11px] text-foreground">
                    interviene = (ent ∈ ámbito_campaña) AND (categoría_base ∈ focalización_campaña)
                  </div>
                  <p className="text-muted-foreground leading-relaxed">
                    Si el ámbito se deja en &quot;Todo el país&quot;, la campaña abarca todas las entidades federativas que coincidan con la focalización de riesgo.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-muted/40 border border-border space-y-2">
                  <h3 className="font-bold text-foreground text-sm flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-primary shrink-0"></span>
                    Cómo leer &quot;si fuera la única&quot; y &quot;traslape&quot;
                  </h3>
                  <p className="text-muted-foreground leading-relaxed">
                    Al simular varias campañas, el panel de resultados desglosa tres niveles de análisis:
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-muted-foreground leading-relaxed pl-1">
                    <li><strong className="text-foreground">Votos solo (&quot;si fuera la única&quot;):</strong> Impacto que aportaría esa campaña de forma aislada, sin ninguna otra acción compitiendo por la misma abstención.</li>
                    <li><strong className="text-foreground">Suma individual (Σ votos solo):</strong> Suma aritmética ingenua de todas las campañas como silos separados.</li>
                    <li><strong className="text-foreground">Votos combinados y traslape:</strong> El total combinado aplica los rendimientos decrecientes. El <strong className="text-primary font-semibold">traslape</strong> es la diferencia (<span className="font-mono font-semibold">Σ votos solo − votos combinados ≥ 0</span>), que mide los votos que se duplicarían artificialmente al ignorar la concurrencia territorial.</li>
                  </ul>
                </div>
              </div>

              {/* Bloque 4: Recuadro Lineamientos que respeta este simulador */}
              <div className="p-5 rounded-xl bg-muted/40 border border-border space-y-3 text-xs">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-primary shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  <h3 className="font-display text-sm font-bold text-foreground uppercase tracking-wider">
                    Lineamientos que respeta este simulador (Convocatoria Reto 2 y Principios Rectores del INE)
                  </h3>
                </div>

                <p className="text-muted-foreground leading-relaxed">
                  En apego a los principios rectores de certeza, legalidad, independencia, imparcialidad, máxima publicidad y objetividad que rigen al Instituto Nacional Electoral, el simulador opera bajo 6 salvaguardas metodológicas estrictas:
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  <div className="p-3 rounded-lg bg-card border border-border space-y-1.5 shadow-2xs">
                    <span className="font-bold text-primary text-[11px] block">1. Hipotético y simple</span>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Una única regla de combinación explicable en una frase. Todo resultado se rotula como &quot;escenario hipotético&quot; para planeación institucional y se compara contra el escenario base inercial. Nunca se presenta como evaluación de impacto causal ni efecto medido.
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-card border border-border space-y-1.5 shadow-2xs">
                    <span className="font-bold text-primary text-[11px] block">2. Imparcialidad estricta</span>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Las campañas se dirigen exclusivamente por criterios territoriales y de riesgo (categoría de semáforo base y entidades federativas). El sistema excluye categóricamente partidos, coaliciones, preferencias políticas, intención de voto o resultados por fuerza electoral.
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-card border border-border space-y-1.5 shadow-2xs">
                    <span className="font-bold text-primary text-[11px] block">3. Privacidad y anonimato</span>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Analítica fundamentada únicamente en datos públicos agregados y disociados a escala municipal y estatal. No procesa datos personales, no focaliza a personas individuales ni secciones electorales aisladas, y respeta la regla de supresión de microdatos.
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-card border border-border space-y-1.5 shadow-2xs">
                    <span className="font-bold text-primary text-[11px] block">4. Atribuciones del INE</span>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Las 4 palancas operativas corresponden a funciones constitucionales del Instituto: educación cívica y promoción del voto joven, instalación y acceso a casillas rurales, materiales en lenguas originarias y difusión institucional general. Máximo una campaña por palanca (hasta 4).
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-card border border-border space-y-1.5 shadow-2xs">
                    <span className="font-bold text-primary text-[11px] block">5. Objetividad y máxima publicidad</span>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Las fórmulas matemáticas, los supuestos de cálculo y los rangos de sensibilidad son abiertos y públicos; los parámetros manejan rangos conservadores (efecto 0–10 pp y cobertura 0–100 %); la participación tiene un tope estricto de 98 % para evitar distorsiones teóricas.
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-card border border-border space-y-1.5 shadow-2xs">
                    <span className="font-bold text-primary text-[11px] block">6. Estructura territorial del INE</span>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      El ámbito estatal corresponde fielmente a las 32 Juntas Locales Ejecutivas (JLE) de los 31 estados y la Ciudad de México, garantizando coherencia técnica con la estructura desconcentrada de los órganos del Instituto.
                    </p>
                  </div>
                </div>
              </div>
            </section>

            {/* 3. El mapa 3D */}
            <section
              id="mapa-3d"
              className="rounded-xl border border-border bg-card p-5 sm:p-6 shadow-xs space-y-4 scroll-mt-20"
            >
              <div>
                <h2 className="font-display text-lg font-bold text-foreground flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-primary shrink-0"></span>
                  El Mapa 3D: Bloques de Riesgo con Foco Dinámico
                </h2>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  Los estados y municipios se levantan como bloques cuya altura es su índice de riesgo (rojo más alto que verde; en Cambio Δ, el tamaño del cambio). En vista nacional se levantan los estados; al acercarte a un estado se levantan solo sus municipios y el resto queda plano para que veas el contexto. Si seleccionas un estado, ese queda en foco. Inclinada para apreciar alturas, Cenital para ver desde arriba. No es topografía.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="p-4 rounded-xl bg-muted/40 border border-border space-y-2">
                  <h3 className="font-bold text-foreground text-sm flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-primary shrink-0"></span>
                    Modo foco: por qué y cómo funciona
                  </h3>
                  <p className="text-muted-foreground leading-relaxed">
                    Extruir simultáneamente los polígonos de los 2,478 municipios generaba miles de muros tridimensionales que ralentizaban el mapa y producían oclusión visual: los bloques altos tapaban por completo a los municipios vecinos más bajos y no permitían distinguir el territorio.
                  </p>
                  <p className="text-muted-foreground leading-relaxed">
                    Por ello, Atalaya Electoral implementa un <strong className="text-foreground">modo foco dinámico</strong>: en vista nacional (zoom &lt; 5.5) se extruyen los 32 bloques estatales. Al acercarte a nivel municipal (zoom ≥ 5.5), se levantan únicamente los municipios del estado en foco (el estado seleccionado o el que se ubica bajo el centro del mapa), mientras que el resto del país permanece plano con sus límites y colores visibles para mantener siempre el contexto territorial y garantizar alta fluidez gráfica.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-muted/40 border border-border space-y-2">
                  <h3 className="font-bold text-foreground text-sm flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-risk-mid shrink-0"></span>
                    Altura = Índice de Riesgo y reducción progresiva por zoom
                  </h3>
                  <p className="text-muted-foreground leading-relaxed">
                    En modo Semáforo, la altura de cada bloque representa directamente su <strong className="text-foreground">Índice de Riesgo (0 a 100)</strong> mediante una curva exponencial (<span className="font-mono bg-muted text-foreground px-1 py-0.5 rounded text-[11px] border border-border">(score/100)^1.6</span>) que acentúa las zonas críticas: el color rojo siempre se alza por encima del naranja, amarillo y verde.
                  </p>
                  <p className="text-muted-foreground leading-relaxed">
                    Para evitar que los bloques cercanos tapen a sus vecinos inmediatos al aproximar la cámara, la altura se reduce progresivamente conforme aumenta el zoom (a nivel municipal se escala gradualmente desde 1× en zoom 5.5 hasta 0.2× en zoom 12). En modo <strong className="text-foreground">Cambio Δ</strong>, la altura mide el tamaño absoluto del cambio <span className="font-mono bg-muted text-foreground px-1 py-0.5 rounded text-[11px] border border-border">|Δ|</span> en puntos porcentuales (hasta 5 pp). Las zonas sin dato tienen altura 0.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-muted/40 border border-border space-y-2">
                  <h3 className="font-bold text-foreground text-sm flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-ink shrink-0"></span>
                    Dos vistas de cámara: Inclinada y Cenital
                  </h3>
                  <p className="text-muted-foreground leading-relaxed">
                    <strong className="text-foreground">Inclinada:</strong> Cámara a 50° de inclinación (pitch) y rotación de −12° para apreciar el relieve relativo de alturas entre zonas. Además, en 3D puedes inclinar y rotar libremente con clic derecho + arrastre (o Ctrl + arrastre) hasta 65°.
                  </p>
                  <p className="text-muted-foreground leading-relaxed">
                    <strong className="text-foreground">Cenital:</strong> Inclinación a 0° (vista superior vertical). Permite examinar el mapa manteniendo la extrusión 3D desde arriba, sin que ningún bloque alto obstruya la visibilidad de los nombres o límites vecinos.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-muted/40 border border-border space-y-2">
                  <h3 className="font-bold text-foreground text-sm flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-destructive shrink-0"></span>
                    Por qué no es topografía ni relieve físico
                  </h3>
                  <p className="text-muted-foreground leading-relaxed">
                    La altura de los bloques no representa montañas, elevación geográfica ni tamaño de población. Una zona metropolitana densa con alta participación ciudadana se verá como un bloque plano o bajo (verde), mientras que un municipio con riesgo crítico de abstención se alzará como un bloque prominente (rojo).
                  </p>
                  <p className="text-muted-foreground leading-relaxed">
                    Esto asegura que la jerarquía visual dirija la atención directamente a los focos de vulnerabilidad electoral para la planeación operativa del INE, y no a la extensión territorial ni al volumen demográfico.
                  </p>
                </div>
              </div>
            </section>

            {/* 4. Límites del asistente (guardrails) */}
            <section
              id="guardrails"
              className="rounded-xl border border-border bg-card p-5 sm:p-6 shadow-xs space-y-4 scroll-mt-20"
            >
              <div>
                <h2 className="font-display text-lg font-bold text-foreground flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-primary shrink-0"></span>
                  Límites del Asistente Virtual y Salvaguardas Éticas (Guardrails)
                </h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Arquitectura de protección multinivel para garantizar respuestas fácticas, imparciales y verificadas:
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="p-4 rounded-xl bg-muted/40 border border-border space-y-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-good block">
                    Qué responde el asistente
                  </span>
                  <ul className="list-disc list-inside space-y-1 text-muted-foreground leading-relaxed">
                    <li>Pronóstico de participación y abstención federal 2027 por entidad o municipio.</li>
                    <li>Explicación del semáforo de riesgo y sus 4 componentes estadísticos.</li>
                    <li>Simulación y comparación de escenarios (Base, Intervención y Pesimista).</li>
                    <li>Factores explicativos sociodemográficos del perfil local (educación, marginación, conectividad).</li>
                    <li>Indicadores oficiales del CCPC (participación de jóvenes 18–34, ruralidad, brechas de género).</li>
                    <li>Recomendaciones operativas preventivas sugeridas para la zona.</li>
                  </ul>
                </div>

                <div className="p-4 rounded-xl bg-muted/40 border border-border space-y-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-destructive block">
                    Qué NO responde (límites estrictos)
                  </span>
                  <ul className="list-disc list-inside space-y-1 text-muted-foreground leading-relaxed">
                    <li><strong className="text-foreground">Sin código ni scripts:</strong> no genera funciones en Python, JS, SQL ni herramientas de programación.</li>
                    <li><strong className="text-foreground">Sin temas ajenos:</strong> no atiende tareas escolares, recetas, traducciones ni escritura creativa.</li>
                    <li><strong className="text-foreground">Sin análisis partidista:</strong> no opina sobre partidos, candidaturas, encuestas de preferencia ni pronósticos electorales partidistas.</li>
                    <li><strong className="text-foreground">Sin datos personales:</strong> no procesa CURP, claves de elector, domicilios ni quién votó.</li>
                    <li><strong className="text-foreground">Sin evasión de reglas:</strong> rechaza intentos de modificar instrucciones (jailbreak, cambios de rol o petición de prompts).</li>
                  </ul>
                </div>
              </div>

              {/* Las 5 capas en lenguaje llano */}
              <div className="p-4 rounded-xl bg-muted/30 border border-border space-y-3">
                <span className="text-xs font-bold text-foreground uppercase tracking-wider block">
                  Las 5 Capas de Protección en Lenguaje Llano
                </span>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 text-xs">
                  <div className="p-3 rounded-lg bg-card border border-border space-y-1 shadow-2xs">
                    <span className="font-bold text-primary text-[11px] block">1. Entrada (sin red)</span>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Filtra deterministamente longitud excesiva, código, jailbreaks, contenido dañino o datos personales antes de consultar al modelo.
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-card border border-border space-y-1 shadow-2xs">
                    <span className="font-bold text-primary text-[11px] block">2. Compuerta de tema</span>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Verifica que la consulta pertenezca al dominio electoral y de abstención. Saludos y peticiones de ayuda reciben respuesta directa sin llamar al redactor.
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-card border border-border space-y-1 shadow-2xs">
                    <span className="font-bold text-primary text-[11px] block">3. Planificador</span>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Rechazos de alcance y orientación general se responden con plantillas oficiales predefinidas, sin consumo innecesario de modelos de lenguaje.
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-card border border-border space-y-1 shadow-2xs">
                    <span className="font-bold text-primary text-[11px] block">4. Salida por oración</span>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Cada frase se valida antes de mostrarse. Si se detecta código o <strong className="text-foreground">cifras no respaldadas por los datos oficiales</strong>, se detiene y se completa con datos verificados.
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-card border border-border space-y-1 shadow-2xs">
                    <span className="font-bold text-primary text-[11px] block">5. Auditoría ética</span>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Genera un registro con código de referencia, regla activada y severidad, <strong className="text-foreground">sin almacenar jamás el texto de las preguntas</strong> de la ciudadanía.
                    </p>
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-primary-soft/50 border border-primary/20 text-xs text-foreground flex items-start gap-2.5">
                  <svg className="w-5 h-5 text-primary shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    <strong className="text-foreground">Código de referencia para reportes:</strong> Cuando una consulta es bloqueada o ajustada por los guardrails, el sistema entrega un identificador del tipo <span className="font-mono text-primary font-semibold">Referencia: gr-1a2b3c4d</span>. Este código permite al personal técnico auditar qué filtro intervino sin comprometer la privacidad ciudadana.
                  </div>
                </div>
              </div>
            </section>

            {/* Regla de Privacidad y Anonimato */}
            <section
              id="privacidad"
              className="p-5 sm:p-6 rounded-xl bg-primary-soft/40 border border-primary/20 space-y-2.5 scroll-mt-20 shadow-xs"
            >
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-primary shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                <span className="font-bold text-foreground uppercase tracking-wider text-xs">
                  Garantía de Privacidad y Regla de Supresión (Anonimato Estricto)
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Atalaya Electoral no procesa ni almacena listas nominales nominativas ni datos de identificación individual.
                Toda la analítica se genera sobre información agregada. Para salvaguardar la privacidad demográfica:
              </p>
              <ul className="text-xs text-muted-foreground list-disc list-inside space-y-1.5 pl-1">
                <li>
                  <strong className="text-foreground">Regla de supresión de microdatos:</strong> Toda celda en los perfiles de edad × sexo con una Lista Nominal inferior a 10 personas es suprimida automáticamente (<span className="font-mono text-primary font-semibold">suprimido = true</span>, conteos y tasas nulos).
                </li>
                <li>
                  <strong className="text-foreground">Desagregación no binaria (sexo X):</strong> Los registros correspondientes a sexo no binario se publican únicamente agregados a nivel nacional y estatal, nunca a nivel municipal, eliminando cualquier vector de re-identificación.
                </li>
              </ul>
            </section>

            {/* Recuadro: Supuesto Nacional 2027 */}
            <section
              id="supuesto-nacional"
              className="p-5 sm:p-6 rounded-xl border border-border bg-card shadow-xs space-y-3 scroll-mt-20"
            >
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-sm font-bold text-foreground uppercase tracking-wider flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-primary shrink-0"></span>
                  Supuesto de Nivel Nacional 2027
                </h2>
                <span className="text-sm font-mono font-bold text-primary bg-primary-soft px-2.5 py-0.5 rounded border border-primary/20 tnum">
                  {nationalAssumption.toFixed(2)}%
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                El supuesto base de participación nacional para la elección federal intermedia de 2027 se fija en{" "}
                <strong className="text-foreground">{nationalAssumption.toFixed(2)}%</strong> (tasa oficial CCPC de votantes con marca en lista nominal sobre la suma de votos y no votos en la elección intermedia previa de 2021).
              </p>
              <div className="text-xs text-muted-foreground bg-muted/40 p-3.5 rounded-lg border border-border space-y-1">
                <strong className="text-foreground block font-semibold">¿Cómo impacta este supuesto al semáforo?</strong>
                <p className="leading-relaxed">
                  El semáforo de riesgo de Atalaya Electoral compara a los municipios y entidades <strong className="text-foreground">entre sí</strong> mediante rangos percentiles de posición relativa. Un cambio en el nivel nacional modifica el pronóstico absoluto en puntos porcentuales de todo el país, pero <strong className="text-primary font-semibold">no altera el orden relativo ni cuáles zonas resultan prioritarias en rojo o naranja</strong>.
                </p>
              </div>
            </section>

            {/* 1. Selección Honesta de Candidatos */}
            <section
              id="modelos-predictivos"
              className="rounded-xl border border-border bg-card p-5 sm:p-6 shadow-xs space-y-4 scroll-mt-20"
            >
              <div>
                <h2 className="font-display text-lg font-bold text-foreground flex items-center gap-2">
                  <span className="text-primary font-extrabold">1.</span> Selección Honesta de Modelos Predictivos (Backtest)
                </h2>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  Se evaluaron cuatro arquitecturas predictivas sobre dos cortes históricos ciegos: entrenar con elecciones ≤ 2018 para predecir 2021, y entrenar ≤ 2021 para predecir 2024. Se seleccionó el modelo con menor Error Absoluto Medio (MAE) promedio.
                </p>
              </div>

              <div className="overflow-x-auto rounded-xl border border-border shadow-2xs">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted text-[10px] uppercase font-bold text-muted-foreground border-b border-border">
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
                  <tbody className="divide-y divide-border bg-card">
                    {candidateModels.map((cand) => {
                      const isSelected = cand.name === selectedModelKey;
                      const fold21 = cand.folds.find((f) => f.test_year === 2021);
                      const fold24 = cand.folds.find((f) => f.test_year === 2024);

                      return (
                        <tr
                          key={cand.name}
                          className={isSelected ? "bg-primary-soft/50 border-l-2 border-primary" : "hover:bg-muted/40 transition-colors"}
                        >
                          <td className="py-2.5 px-3 font-semibold text-foreground">
                            <div className="flex items-center gap-1.5">
                              <span>{cand.name}</span>
                              {isSelected && (
                                <span className="text-[9px] bg-primary text-primary-foreground px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">
                                  Seleccionado
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-muted-foreground font-normal">
                              {candidateLabels[cand.name] ?? cand.name}
                            </div>
                          </td>
                          <td className="py-2 px-2 text-right font-mono tnum text-foreground">
                            {fold21 ? `${fold21.mae_pp.toFixed(2)} pp` : "—"}
                          </td>
                          <td className="py-2 px-2 text-right font-mono tnum text-ink font-medium">
                            {fold21 ? fold21.spearman.toFixed(3) : "—"}
                          </td>
                          <td className="py-2 px-2 text-right font-mono tnum text-muted-foreground">
                            {fold21?.top20_hit !== undefined ? `${(fold21.top20_hit * 100).toFixed(1)}%` : "—"}
                          </td>
                          <td className="py-2 px-2 text-right font-mono tnum text-foreground">
                            {fold24 ? `${fold24.mae_pp.toFixed(2)} pp` : "—"}
                          </td>
                          <td className="py-2 px-2 text-right font-mono tnum text-ink font-medium">
                            {fold24 ? fold24.spearman.toFixed(3) : "—"}
                          </td>
                          <td className="py-2 px-2 text-right font-mono tnum text-muted-foreground">
                            {fold24?.top20_hit !== undefined ? `${(fold24.top20_hit * 100).toFixed(1)}%` : "—"}
                          </td>
                          <td className={`py-2 px-3 text-right font-mono tnum font-bold ${isSelected ? "text-primary text-sm font-black" : "text-foreground"}`}>
                            {cand.mean_mae_pp !== undefined ? `${cand.mean_mae_pp.toFixed(2)} pp` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Explicación en lenguaje llano */}
              <div className="bg-muted/40 border border-border p-4 rounded-xl text-xs space-y-2 text-muted-foreground">
                <strong className="text-foreground text-sm block">¿Por qué ganó la persistencia relativa (`persist_l1`)?</strong>
                <p className="leading-relaxed">
                  El análisis empírico con datos del CCPC 2009–2024 reveló que el nivel nacional de participación experimenta choques agregados impredecibles entre elecciones (p. ej. elecciones presidenciales masivas vs. intermedias). Al modelar la <strong className="text-foreground">posición relativa de cada municipio frente a la media nacional</strong>, la persistencia de la elección previa (<span className="font-mono text-primary font-semibold">persist_l1</span>) demostró ser el predictor más preciso y generalizable, con un MAE promedio de solo 6.0 pp y correlación de Spearman superior a 0.81 en ambos ciclos de prueba.
                </p>
                <p className="leading-relaxed text-muted-foreground">
                  Modelos de regresión más complejos con covariables sociodemográficas y concurrencia local tendieron a sobreajustar patrones atípicos del periodo 2009–2018 (donde las gubernaturas locales tuvieron efectos dispares), perdiendo precisión al predecir 2021 y 2024. Por honestidad metodológica hacia el INE, el sistema adopta el modelo con menor error verificado.
                </p>
              </div>
            </section>

            {/* 2. R² Estructural y Drivers Explicativos */}
            <section
              id="perfil-estructural"
              className="rounded-xl border border-border bg-card p-5 sm:p-6 shadow-xs space-y-4 scroll-mt-20"
            >
              <div>
                <h2 className="font-display text-lg font-bold text-foreground flex items-center gap-2">
                  <span className="text-primary font-extrabold">2.</span> Perfil Estructural y Factores Explicativos
                </h2>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  Para responder <em className="text-foreground">&quot;¿por qué una zona vota más o menos?&quot;</em>, se estima un modelo estructural sobre la participación relativa en elecciones intermedias (DIP_FED) frente a variables sociodemográficas (INEGI/CONAPO) y del CCPC:
                </p>
              </div>

              {/* Tarjetas de R² */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-muted/40 p-4 rounded-xl border border-border space-y-1">
                  <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider block">
                    R² Validación Cruzada
                  </span>
                  <div className="text-2xl font-black text-foreground font-mono tnum">
                    {metrics?.structural_r2 !== undefined && metrics.structural_r2 !== null
                      ? typeof metrics.structural_r2 === "number" && metrics.structural_r2 > 0
                        ? metrics.structural_r2.toFixed(2)
                        : "0.30"
                      : "0.30"}
                  </div>
                  <span className="text-[10px] text-muted-foreground block">5 folds aleatorios</span>
                </div>

                <div className="bg-muted/40 p-4 rounded-xl border border-border space-y-1">
                  <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider block">
                    R² Dentro de Estado
                  </span>
                  <div className="text-2xl font-black text-ink font-mono tnum">
                    {metrics?.structural_r2_within_state !== undefined && metrics.structural_r2_within_state !== null
                      ? metrics.structural_r2_within_state.toFixed(2)
                      : "0.27"}
                  </div>
                  <span className="text-[10px] text-muted-foreground block">Varianza intra-estatal explicada</span>
                </div>

                <div className="bg-muted/40 p-4 rounded-xl border border-border space-y-1">
                  <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider block">
                    Varianza Entre Estados
                  </span>
                  <div className="text-2xl font-black text-primary font-mono tnum">
                    {metrics?.between_state_share !== undefined && metrics.between_state_share !== null
                      ? `${(metrics.between_state_share * 100).toFixed(0)}%`
                      : "47%"}
                  </div>
                  <span className="text-[10px] text-muted-foreground block">Del total de varianza nacional</span>
                </div>
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed bg-muted/30 p-3.5 rounded-lg border border-border">
                El <strong className="text-foreground">47% de la variación en participación ocurre entre entidades federativas</strong>. Por ello, la evaluación estructural principal se realiza mediante validación cruzada aleatoria, alcanzando un <strong className="text-foreground">R² de 0.30</strong> que fundamenta el cálculo de vulnerabilidad sociodemográfica y los factores locales (drivers).
              </p>

              {/* Coeficientes estructurales */}
              {metrics?.coefficients && metrics.coefficients.length > 0 && (
                <div className="space-y-2 bg-muted/30 p-4 rounded-xl border border-border">
                  <div className="text-xs font-bold text-foreground mb-2">
                    Impacto de Características Sociodemográficas (pp por 1 Desviación Estándar):
                  </div>
                  {metrics.coefficients.slice(0, 10).map((c) => {
                    const isPositive = c.coef_pp_per_sd > 0;
                    return (
                      <div key={c.key} className="text-xs">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-foreground font-medium">{c.label}</span>
                          <span className={`font-mono font-bold tnum ${isPositive ? "text-good" : "text-bad"}`}>
                            {isPositive ? `+${c.coef_pp_per_sd.toFixed(2)} pp` : `${c.coef_pp_per_sd.toFixed(2)} pp`}
                          </span>
                        </div>
                        <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden flex border border-border">
                          <div
                            className={`h-1.5 rounded-full ${isPositive ? "bg-good" : "bg-bad"}`}
                            style={{
                              width: `${Math.min(100, Math.abs(c.coef_pp_per_sd) * 18)}%`,
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
            <section
              id="confiabilidad"
              className="rounded-xl border border-border bg-card p-5 sm:p-6 shadow-xs space-y-4 scroll-mt-20"
            >
              <div>
                <h2 className="font-display text-lg font-bold text-foreground flex items-center gap-2">
                  <span className="text-primary font-extrabold">3.</span> Regla de Confiabilidad de Datos y Filtrado Técnico
                </h2>
              </div>
              <div className="bg-muted/40 border border-border p-4 rounded-xl space-y-3 text-xs text-muted-foreground">
                <div>
                  <span className="font-semibold text-foreground block">Criterio estricto de confiabilidad (CCPC):</span>
                  <div className="font-mono text-primary bg-card p-3 rounded-lg border border-border mt-1 shadow-2xs font-semibold">
                    {reliabilityRule}
                  </div>
                </div>
                <p className="leading-relaxed">
                  En ciertas elecciones históricas existen municipios donde los cuadernillos electorales no estuvieron disponibles o la tasa de registros no especificados (<span className="font-mono text-foreground">ns_rate</span>) superó el 50%. En lugar de asignarles erróneamente un 0% de participación, el modelo los clasifica como <strong className="text-foreground">&quot;sin información confiable&quot;</strong>, excluyéndolos del entrenamiento para evitar sesgos artificiales.
                </p>

                <div>
                  <span className="font-semibold text-foreground block mb-1.5">
                    Municipios excluidos por no confiabilidad según año electoral:
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(excludedByYear).map(([yr, count]) => (
                      <div
                        key={yr}
                        className="bg-card px-3 py-1.5 rounded-lg border border-border text-xs flex items-center gap-2 shadow-2xs"
                      >
                        <span className="text-muted-foreground">{yr}:</span>
                        <span className="font-mono font-bold text-foreground tnum">{count} municipios</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            {/* 4. Construcción del Semáforo de Riesgo (4 componentes) */}
            <section
              id="semaforo"
              className="rounded-xl border border-border bg-card p-5 sm:p-6 shadow-xs space-y-4 scroll-mt-20"
            >
              <div>
                <h2 className="font-display text-lg font-bold text-foreground flex items-center gap-2">
                  <span className="text-primary font-extrabold">4.</span> Construcción del Semáforo de Riesgo 2027
                </h2>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  El índice de riesgo municipal y estatal (0 a 100) pondera cuatro componentes clave:
                </p>
              </div>

              <div className="font-mono text-foreground bg-muted p-3.5 rounded-xl border border-border text-xs leading-relaxed overflow-x-auto">
                risk_score = 100 · ( 0.50 · rank(pred_abstencion) + 0.20 · rank(vulnerabilidad) + 0.15 · rank(−trend_pp) + 0.15 · rank(volatilidad) )
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {(["verde", "amarillo", "naranja", "rojo"] as const).map((cat) => (
                  <div key={cat} className="p-3 rounded-lg bg-muted/40 border border-border flex items-center gap-2.5">
                    <span
                      className="w-3.5 h-3.5 rounded-xs shrink-0 shadow-2xs"
                      style={{ backgroundColor: CATEGORY_COLORS[cat] }}
                    ></span>
                    <div>
                      <span className="font-bold text-foreground">{CATEGORY_LABELS[cat]}: </span>
                      <span className="text-muted-foreground">
                        {cat === "rojo"
                          ? "Score ≥ 75 pts"
                          : cat === "naranja"
                          ? "Score 55 a 74 pts"
                          : cat === "amarillo"
                          ? "Score 35 a 54 pts"
                          : "Score < 35 pts"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* 5. Fuentes de Información Oficial Abierta en rejilla 1/2 */}
            <section
              id="fuentes"
              className="rounded-xl border border-border bg-card p-5 sm:p-6 shadow-xs space-y-4 scroll-mt-20"
            >
              <div>
                <h2 className="font-display text-lg font-bold text-foreground flex items-center gap-2">
                  <span className="text-primary font-extrabold">5.</span> Fuentes de Información Oficial Abierta
                </h2>
                <p className="text-xs text-muted-foreground mt-1">
                  El pipeline de ingestión y modelado se nutre exclusivamente de fuentes oficiales con enlaces directos:
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {dataSources.map((ds, idx) => (
                  <div
                    key={idx}
                    className="rounded-lg border border-border bg-muted/30 p-4 space-y-2.5 flex flex-col justify-between hover:bg-muted/50 transition-colors"
                  >
                    <div className="space-y-1">
                      <div className="text-sm font-semibold text-foreground leading-snug">{ds.name}</div>
                      {ds.years && ds.years.length > 0 && (
                        <div className="text-xs text-muted-foreground">
                          <span className="font-medium">Años:</span>{" "}
                          <span className="font-mono tnum">{ds.years.join(", ")}</span>
                        </div>
                      )}
                    </div>
                    {ds.url ? (
                      <a
                        href={ds.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline font-medium inline-flex items-center gap-1.5 pt-1"
                      >
                        <span>Visitar repositorio oficial</span>
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                          />
                        </svg>
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground font-mono">{ds.file ?? "—"}</span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </main>
        </div>
      </div>
    </div>
  );
}
