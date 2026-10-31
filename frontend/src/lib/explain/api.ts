// ATALAYA Explain API Client
import type { Explanation, ContextResult } from "./types";
import type { Job } from "../intel/types";
import {
  fetchJson,
  ApiError,
  shouldFallbackToMock,
  isMockEnabled,
  setMockActive,
} from "../api";

export function createMockExplanation(unitId: string): Explanation {
  const isMun = unitId.length > 2;
  return {
    unit_id: unitId,
    level: isMun ? "mun" : "state",
    name: unitId === "23" ? "Quintana Roo" : unitId === "07" ? "Chiapas" : `Zona ${unitId}`,
    state_name: isMun ? "Entidad Federativa" : null,
    category: "rojo",
    risk_score: 59.5,
    pred_abstention_pct: 48.2,
    headline: "Historial de baja participación constante",
    in_short: [
      "La zona ha mantenido participación por debajo del promedio nacional.",
      "Los jóvenes entre 18 y 29 años registran la mayor abstención medida.",
      "El crecimiento poblacional reciente coincide con menor arraigo electoral.",
    ],
    reasons: [
      {
        id: "historial-1",
        kind: "historial",
        title: "Historial de participación por debajo de la media",
        body: "En 5 de las últimas 6 elecciones federales, esta zona registró una participación inferior al promedio nacional.",
        strength: "fuerte",
        evidence_type: "dato_medido",
        direction: "sube_abstencion",
        numbers: [
          {
            key: "part_media",
            label: "Participación promedio",
            value: 44.5,
            unit: "pct",
            display: "44.5 %",
          },
        ],
        source: "Cómputos distritales INE 2009–2024",
      },
      {
        id: "quien-no-vota-1",
        kind: "quien_no_vota",
        title: "Menor participación observada en jóvenes de 18 a 29 años",
        body: "Los cuadernillos electorales indican una brecha desfavorable de 12 puntos porcentuales en jóvenes respecto a adultos mayores.",
        strength: "fuerte",
        evidence_type: "dato_medido",
        direction: "sube_abstencion",
        numbers: [
          {
            key: "gap_jovenes",
            label: "Brecha jóvenes",
            value: 12.0,
            unit: "pp",
            display: "12.0 puntos porcentuales",
          },
        ],
        source: "Estudio muestral de participación ciudadana INE (CCPC)",
      },
    ],
    score_breakdown: [
      {
        key: "abs",
        label: "Abstención esperada",
        weight: 0.5,
        rank_pct: 78.0,
        points: 39.0,
        plain: "Abstención pronosticada más alta que el 78 % de las entidades",
      },
      {
        key: "vuln",
        label: "Vulnerabilidad demográfica",
        weight: 0.2,
        rank_pct: 53.0,
        points: 10.6,
        plain: "Composición juvenil y dispersión territorial moderada",
      },
      {
        key: "trend",
        label: "Tendencia histórica",
        weight: 0.15,
        rank_pct: 47.0,
        points: 7.05,
        plain: "Tendencia de participación a la baja en elecciones intermedias",
      },
      {
        key: "vol",
        label: "Volatilidad",
        weight: 0.15,
        rank_pct: 19.0,
        points: 2.85,
        plain: "Variabilidad electoral baja entre procesos consecutivos",
      },
    ],
    groups: [
      {
        group: "Jóvenes 18–29",
        participation_pct: 38.5,
        share_ln_pct: 28.0,
        share_abstainers_pct: 35.0,
        suppressed: false,
      },
      {
        group: "Adultos 30–59",
        participation_pct: 52.0,
        share_ln_pct: 54.0,
        share_abstainers_pct: 48.0,
        suppressed: false,
      },
      {
        group: "Adultos mayores 60+",
        participation_pct: 61.2,
        share_ln_pct: 18.0,
        share_abstainers_pct: 17.0,
        suppressed: false,
      },
    ],
    what_we_dont_know: [
      "No se dispone de desglose por sección en zonas con menos de 10 casillas para resguardar la secrecía del voto.",
      "Los factores de migración reciente provienen del censo decenal y pueden variar.",
    ],
    confidence: "alta",
    confidence_note: "Datos completos con más de 5 elecciones federales comparables.",
    recommendations: [
      {
        title: "Campaña focalizada en credencialización juvenil",
        rationale: "El rezago principal se concentra en primeros votantes y cambios de domicilio.",
        priority: "alta",
      },
    ],
    suggested_questions: [
      {
        id: "sq-1",
        text: "¿Por qué los jóvenes participan menos en esta zona?",
        intent_hint: "profile",
      },
      {
        id: "sq-2",
        text: "¿Cómo ha evolucionado la abstención en las últimas elecciones?",
        intent_hint: "trend",
      },
      {
        id: "sq-3",
        text: "¿Qué acciones de campo recomienda el modelo?",
        intent_hint: "recommend",
      },
    ],
    sources: [
      "Cómputos Distritales Federales 2009–2024 (INE)",
      "Estudio Muestral de Participación Ciudadana (CCPC)",
      "Censo de Población y Vivienda 2020 (INEGI)",
    ],
    data_year: 2024,
    scenario_note: "Pronóstico bajo escenario base para el proceso 2027.",
    generated_at: new Date().toISOString(),
  };
}

export function createMockContextResult(unitId: string): ContextResult {
  const isMun = unitId.length > 2;
  return {
    unit_id: unitId,
    name: unitId === "23" ? "Quintana Roo" : unitId === "07" ? "Chiapas" : `Zona ${unitId}`,
    level: isMun ? "mun" : "state",
    findings: [
      {
        id: "finding-1",
        title: "Reportes de movilidad laboral en zonas de alta afluencia",
        summary: "Fuentes públicas reportan que la movilidad laboral en sectores de servicios coincide con baja afluencia electoral.",
        category: "migracion_movilidad",
        category_label: "Movilidad y migración",
        scope: "estado",
        verification: "cita_verificada",
        quote: "Gran parte del personal laboral requiere transporte especial para acudir a su casilla en jornada electoral.",
        sources: [
          {
            url: "https://ejemplo.mx/noticia-1",
            title: "Movilidad laboral y participación ciudadana",
            domain: "ejemplo.mx",
            outlet: "Prensa Local",
            tier: "medio_regional",
            published: "2024-06-03",
          },
        ],
      },
    ],
    search_mode: "grounding",
    model: "gemini-3.6-flash",
    generated_at: new Date().toISOString(),
    from_cache: true,
    degraded: false,
    note: null,
    disclaimer: "Información recopilada de fuentes públicas verificadas. No implica causa estadística de abstención.",
  };
}

// 1. GET /api/explain/{id}
export async function getExplanation(
  unitId: string,
  signal?: AbortSignal
): Promise<Explanation> {
  if (isMockEnabled()) {
    return createMockExplanation(unitId);
  }

  try {
    return await fetchJson<Explanation>(`/api/explain/${encodeURIComponent(unitId)}`, {
      signal,
    });
  } catch (err: unknown) {
    if (shouldFallbackToMock(err)) {
      setMockActive(true);
      return createMockExplanation(unitId);
    }
    throw err;
  }
}

// 2. GET /api/explain/{id}/context (404 -> null)
export async function getCachedContext(unitId: string): Promise<ContextResult | null> {
  if (isMockEnabled()) {
    return createMockContextResult(unitId);
  }

  try {
    return await fetchJson<ContextResult>(
      `/api/explain/${encodeURIComponent(unitId)}/context`
    );
  } catch (err: unknown) {
    if (err instanceof ApiError && err.status === 404) {
      return null;
    }
    if (shouldFallbackToMock(err)) {
      setMockActive(true);
      return createMockContextResult(unitId);
    }
    throw err;
  }
}

// 3. POST /api/explain/{id}/context
export async function requestContext(
  unitId: string,
  opts?: { refresh?: boolean }
): Promise<
  | { kind: "done"; context: ContextResult }
  | { kind: "job"; job: Job<ContextResult> }
> {
  if (isMockEnabled()) {
    return { kind: "done", context: createMockContextResult(unitId) };
  }

  try {
    const data = await fetchJson<
      { status: "done"; context: ContextResult } | Job<ContextResult>
    >(`/api/explain/${encodeURIComponent(unitId)}/context`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refresh: opts?.refresh ?? false }),
    });

    if (
      data &&
      typeof data === "object" &&
      "status" in data &&
      data.status === "done" &&
      "context" in data
    ) {
      return { kind: "done", context: data.context };
    }

    return { kind: "job", job: data as Job<ContextResult> };
  } catch (err: unknown) {
    if (shouldFallbackToMock(err)) {
      setMockActive(true);
      return { kind: "done", context: createMockContextResult(unitId) };
    }
    throw err;
  }
}
