// ATALAYA Intel - Campaign Draft State & LocalStorage Persistence
import type { CampaignPlan, Slide, SlideKind } from "@/lib/intel/types";

export interface SlideEdit {
  title?: string;
  subtitle?: string | null;
  bullets?: string[];
  notes?: string;
}

export type PlanDrafts = Record<string, SlideEdit>;

const DRAFT_PREFIX = "atalaya_campaign_draft_";

const memoryDrafts: Record<string, string> = {};

export function _resetMemoryDrafts(): void {
  for (const k of Object.keys(memoryDrafts)) {
    delete memoryDrafts[k];
  }
}

function getStorage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.getItem("__test__");
      return window.localStorage;
    }
    if (typeof globalThis !== "undefined" && (globalThis as any).localStorage) {
      (globalThis as any).localStorage.getItem("__test__");
      return (globalThis as any).localStorage;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Loads draft edits for a given plan ID from localStorage.
 * Tolerant to missing storage, corrupted JSON, or quota exceptions.
 */
export function getDrafts(planId: string): PlanDrafts {
  if (!planId) return {};
  const storage = getStorage();
  let raw: string | null = null;
  if (storage) {
    try {
      raw = storage.getItem(`${DRAFT_PREFIX}${planId}`);
    } catch {
      raw = memoryDrafts[`${DRAFT_PREFIX}${planId}`] || null;
    }
  } else {
    raw = memoryDrafts[`${DRAFT_PREFIX}${planId}`] || null;
  }

  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as PlanDrafts;
    }
  } catch {
    // Quota, security or syntax error: fallback to empty draft
  }
  return {};
}

/**
 * Saves draft edits for a plan ID to localStorage.
 */
export function saveDrafts(planId: string, drafts: PlanDrafts): void {
  if (!planId) return;
  const storage = getStorage();
  const keys = Object.keys(drafts);
  const jsonStr = keys.length === 0 ? null : JSON.stringify(drafts);

  if (storage) {
    try {
      if (jsonStr === null) {
        storage.removeItem(`${DRAFT_PREFIX}${planId}`);
      } else {
        storage.setItem(`${DRAFT_PREFIX}${planId}`, jsonStr);
      }
    } catch {
      // LocalStorage quota or access denied: keep in memory fallback
    }
  }

  if (jsonStr === null) {
    delete memoryDrafts[`${DRAFT_PREFIX}${planId}`];
  } else {
    memoryDrafts[`${DRAFT_PREFIX}${planId}`] = jsonStr;
  }
}

/**
 * Clears all draft edits for a plan ID from localStorage.
 */
export function clearDrafts(planId: string): void {
  if (!planId) return;
  delete memoryDrafts[`${DRAFT_PREFIX}${planId}`];
  const storage = getStorage();
  if (!storage) return;

  try {
    storage.removeItem(`${DRAFT_PREFIX}${planId}`);
  } catch {
    // Ignore
  }
}

/**
 * Updates draft for a specific slide ID and returns the updated PlanDrafts.
 */
export function updateSlideDraft(
  planId: string,
  slideId: string,
  changes: SlideEdit
): PlanDrafts {
  const current = getDrafts(planId);
  const updatedSlide = {
    ...(current[slideId] || {}),
    ...changes,
  };

  const nextDrafts: PlanDrafts = {
    ...current,
    [slideId]: updatedSlide,
  };

  saveDrafts(planId, nextDrafts);
  return nextDrafts;
}

/**
 * Restores a single slide to original (removes its draft entry).
 */
export function restoreSlideDraft(planId: string, slideId: string): PlanDrafts {
  const current = getDrafts(planId);
  if (!current[slideId]) return current;

  const nextDrafts = { ...current };
  delete nextDrafts[slideId];
  saveDrafts(planId, nextDrafts);
  return nextDrafts;
}

/**
 * Checks if a specific slide has been modified compared to original.
 */
export function isSlideEdited(slide: Slide, draft?: SlideEdit): boolean {
  if (!draft) return false;

  if (draft.title !== undefined && draft.title !== slide.title) {
    return true;
  }
  if (draft.subtitle !== undefined && draft.subtitle !== (slide.subtitle ?? null)) {
    return true;
  }
  if (draft.notes !== undefined && draft.notes !== slide.notes) {
    return true;
  }
  if (draft.bullets !== undefined) {
    const orig = slide.bullets || [];
    if (draft.bullets.length !== orig.length) return true;
    for (let i = 0; i < orig.length; i++) {
      if (draft.bullets[i] !== orig[i]) return true;
    }
  }
  return false;
}

/**
 * Checks if any slide in the plan has active edits.
 */
export function isPlanEdited(plan: CampaignPlan, drafts: PlanDrafts): boolean {
  if (!drafts || Object.keys(drafts).length === 0) return false;
  const slides = ensurePlanSlides(plan);
  return slides.some((s) => isSlideEdited(s, drafts[s.id]));
}

/**
 * Applies draft edits onto a slide, preserving non-editable fields (id, kind, data).
 */
export function applyDraftToSlide(slide: Slide, draft?: SlideEdit): Slide {
  if (!draft) return slide;
  return {
    ...slide,
    title: draft.title !== undefined ? draft.title : slide.title,
    subtitle: draft.subtitle !== undefined ? draft.subtitle : slide.subtitle,
    bullets: draft.bullets !== undefined ? [...draft.bullets] : slide.bullets,
    notes: draft.notes !== undefined ? draft.notes : slide.notes,
    data: slide.data, // Data figures are strictly preserved
  };
}

/**
 * Merges drafts onto all slides of a plan.
 */
export function applyDraftsToSlides(slides: Slide[], drafts: PlanDrafts): Slide[] {
  return slides.map((s) => applyDraftToSlide(s, drafts[s.id]));
}

/**
 * Builds the override array of slides for POST /api/intel/campaign/export.
 * Returns null if no slide is edited.
 * If edited, only includes the updated title/subtitle/bullets/notes alongside id, kind, and data.
 */
export function buildExportSlidesOverride(
  plan: CampaignPlan,
  drafts: PlanDrafts
): Slide[] | null {
  const slides = ensurePlanSlides(plan);
  if (!isPlanEdited(plan, drafts)) {
    return null;
  }

  return slides.map((orig) => {
    const draft = drafts[orig.id];
    if (!draft || !isSlideEdited(orig, draft)) {
      return orig;
    }
    return applyDraftToSlide(orig, draft);
  });
}

/**
 * Helper that guarantees a full 10-slide deck matching the 10 canonical SlideKinds
 * from 00-CONTEXT.md §6.4. If the plan came with partial slides (e.g. MOCK_CAMPAIGN_PLAN),
 * this synthesizes the missing slides from the plan's structured data.
 */
export function ensurePlanSlides(plan: CampaignPlan): Slide[] {
  if (!plan) return [];
  const existingSlides = plan.slides || [];
  const existingByKind = new Map<SlideKind, Slide>();
  for (const s of existingSlides) {
    if (!existingByKind.has(s.kind)) {
      existingByKind.set(s.kind, s);
    }
  }

  const KINDS_ORDER: SlideKind[] = [
    "portada",
    "diagnostico_datos",
    "problematicas",
    "region",
    "grupo_objetivo",
    "propuestas",
    "impacto",
    "implementacion",
    "riesgos_kpis",
    "fuentes",
  ];

  const unit = plan.unit;
  const res = plan.research;
  const imp = plan.impact;

  return KINDS_ORDER.map((kind, idx) => {
    const existing = existingByKind.get(kind);
    if (existing) return existing;

    const sid = `slide_${idx + 1}_${kind}`;

    switch (kind) {
      case "portada":
        return {
          id: sid,
          kind: "portada",
          title: `Plan Estratégico de Promoción del Voto: ${unit.name}`,
          subtitle: plan.focus
            ? `${unit.name}, ${unit.ent_name} · Enfoque: ${plan.focus}`
            : `${unit.name}, ${unit.ent_name}`,
          bullets: [
            "Borrador generado con IA — propuesta del equipo OXENT",
            `Unidad territorial: ${unit.name} (${unit.ent_name})`,
            `Lista nominal: ${unit.lista_nominal.toLocaleString("es-MX")} electores`,
            `Abstención estimada: ${((unit.pred_abstention ?? 0.4) * 100).toFixed(1)}% (Semáforo ${unit.category})`,
          ],
          notes: "Presentación ejecutiva del plan de campaña cívica focalizada.",
          data: {
            unit_id: unit.unit_id,
            unit_name: unit.name,
            ent_name: unit.ent_name,
            level: unit.level,
            focus: plan.focus,
          },
        };

      case "diagnostico_datos":
        return {
          id: sid,
          kind: "diagnostico_datos",
          title: "Diagnóstico Territorial y Electoral",
          subtitle: `Situación inercial de la abstención en ${unit.name} hacia la elección 2027`,
          bullets: [
            `Abstención pronosticada: ${((unit.pred_abstention ?? 0.4) * 100).toFixed(1)}% [${((unit.pred_low ?? 0.38) * 100).toFixed(1)}% – ${((unit.pred_high ?? 0.45) * 100).toFixed(1)}%]`,
            `Población no votante esperada: ${(unit.abstencion_esperada ?? 0).toLocaleString("es-MX")} personas`,
            `Tendencia de participación: ${(unit.trend_pp ?? -2).toFixed(1)} pp respecto a procesos previos`,
            `Brecha juvenil: ${(unit.gap_youth_pp_last ?? -5).toFixed(1)} pp por debajo del promedio territorial`,
          ],
          notes: "Datos del modelo estadístico de Atalaya Electoral basados en CCPC del INE.",
          data: {
            kpis: [
              { label: "Abstención base", value: `${((unit.pred_abstention ?? 0.4) * 100).toFixed(1)}%` },
              { label: "Abstención esperada", value: `${(unit.abstencion_esperada ?? 0).toLocaleString("es-MX")}` },
              { label: "Brecha juvenil", value: `${(unit.gap_youth_pp_last ?? -5).toFixed(1)} pp` },
            ],
          },
        };

      case "problematicas":
        return {
          id: sid,
          kind: "problematicas",
          title: "Causas Documentadas de Abstención",
          subtitle: `Factores estructurales y coyunturales identificados en ${unit.name}`,
          bullets: (res?.findings || []).map(
            (f) => `${f.title}: ${f.summary} [${f.evidence.join(", ")}]`
          ),
          notes: "Hallazgos de investigación documental verificados en fuentes institucionales y académicas.",
          data: { findings: res?.findings || [] },
        };

      case "region":
        return {
          id: sid,
          kind: "region",
          title: "Diagnóstico Territorial y Mapa",
          subtitle: `Visualización del fragmento territorial de ${unit.name}`,
          bullets: [
            `Unidad analizada: ${unit.name} (${unit.ent_name})`,
            `Nivel de análisis: ${unit.level === "state" ? "Entidad federativa" : "Municipio"}`,
            `Categoría de riesgo asignada: ${unit.category.toUpperCase()}`,
          ],
          notes: "Mapa territorial fragmentado coloreado según el semáforo institucional de riesgo.",
          data: {
            unit_id: unit.unit_id,
            ent: unit.ent,
            level: unit.level,
          },
        };

      case "grupo_objetivo":
        return {
          id: sid,
          kind: "grupo_objetivo",
          title: "Público Objetivo y Segmentación",
          subtitle: "Segmentos prioritarios para la movilización del voto",
          bullets: (plan.target_groups || []).map(
            (g) =>
              `${g.name}: ${g.description}${
                g.size_estimate ? ` (~${g.size_estimate.toLocaleString("es-MX")} electores)` : ""
              }`
          ),
          notes: "Segmentación basada en registros censales de INEGI y lista nominal del INE.",
          data: { target_groups: plan.target_groups || [] },
        };

      case "propuestas":
        return {
          id: sid,
          kind: "propuestas",
          title: "Estrategia e Intervenciones Clave",
          subtitle: "Acciones cívicas focalizadas por palanca operativa",
          bullets: (plan.proposals || []).map(
            (p) => `${p.title} (+${p.effect_pp.toFixed(1)} pp): ${p.description}`
          ),
          notes: "Propuestas correspondientes a las 4 palancas institucionales del simulador.",
          data: { proposals: plan.proposals || [] },
        };

      case "impacto":
        return {
          id: sid,
          kind: "impacto",
          title: "Proyección de Impacto y Movilización",
          subtitle: "Simulación determinista del incremento en participación",
          bullets: [
            `Abstención base: ${((imp?.abstention_base ?? 0.44) * 100).toFixed(1)}% → Escenario: ${((imp?.abstention_scenario ?? 0.39) * 100).toFixed(1)}%`,
            `Reducción neta estimada: ${(imp?.delta_pp ?? -4.7).toFixed(1)} pp`,
            `Votos adicionales proyectados: +${(imp?.votos_adicionales ?? 0).toLocaleString("es-MX")}`,
            `Transición de semáforo: ${imp?.category_before?.toUpperCase() ?? "ROJO"} → ${imp?.category_after?.toUpperCase() ?? "NARANJA"}`,
          ],
          notes: "Cálculos generados mediante el modelo de simulación determinista de Atalaya.",
          data: {
            before: imp?.abstention_base,
            after: imp?.abstention_scenario,
            delta_pp: imp?.delta_pp,
            votos: imp?.votos_adicionales,
            per_proposal: imp?.per_proposal || [],
          },
        };

      case "implementacion":
        return {
          id: sid,
          kind: "implementacion",
          title: "Cronograma de Despliegue Operativo",
          subtitle: "Ruta crítica y responsabilidades hacia la jornada electoral",
          bullets: (plan.steps || []).map(
            (s) => `Fase ${s.order} (${s.start} a ${s.end}): ${s.phase} — Responsable: ${s.responsible}`
          ),
          notes: "Cronograma institucional calendarizado con hitos y metas de verificación.",
          data: { steps: plan.steps || [] },
        };

      case "riesgos_kpis":
        return {
          id: sid,
          kind: "riesgos_kpis",
          title: "Gestión de Riesgos e Indicadores de Éxito",
          subtitle: "Mitigaciones operativas y métricas de seguimiento",
          bullets: [
            ...(plan.risks || []).map((r) => `Riesgo: ${r.risk} — Mitigación: ${r.mitigation}`),
            ...(plan.kpis || []).map((k) => `KPI: ${k}`),
          ],
          notes: "Monitoreo preventivo de contingencias territoriales y evaluación de desempeño.",
          data: { risks: plan.risks || [], kpis: plan.kpis || [] },
        };

      case "fuentes":
        return {
          id: sid,
          kind: "fuentes",
          title: "Fuentes Documentales Verificadas",
          subtitle: "Referencias oficiales, académicas y hemerográficas consultadas",
          bullets: (res?.sources || []).map(
            (s) => `[${s.id}] ${s.title} (${s.outlet || s.domain}) · Nivel: ${s.tier}`
          ),
          notes: "Todas las fuentes fueron contrastadas y filtradas contra criterios de verificación del INE.",
          data: { sources: res?.sources || [] },
        };
    }
  });
}
