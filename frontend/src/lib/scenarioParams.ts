import type { Meta, ScenarioId } from "./types";

const LEVER_DEFAULT_LABELS: Record<string, string> = {
  promocion_jovenes: "Promoción del voto joven",
  casillas_rurales: "Casillas y traslado en zonas rurales",
  materiales_lengua_indigena: "Materiales y capacitación en lenguas indígenas",
  campana_general: "Campaña general de promoción del voto",
};

const TARGETING_DEFAULT_LABELS: Record<string, string> = {
  rojo: "Solo zonas rojas",
  rojo_naranja: "Zonas rojas y naranjas",
  todos: "Todo el país",
};

const INTERVENCION_FALLBACK_DEFAULTS: Record<string, number | string> = {
  lever: "promocion_jovenes",
  targeting: "rojo_naranja",
  effect_pp: 3.0,
  coverage: 100,
};

const PESIMISTA_FALLBACK_DEFAULTS: Record<string, number | string> = {
  shock_pp: 2.0,
  trend_amplifier: 50,
};

/**
 * Default parameters for a single scenario.
 * base => {}
 * intervencion / pesimista => defaults defined in meta, or standard defaults if meta is null
 */
export function defaultsForScenario(
  scenario: ScenarioId,
  meta: Meta | null
): Record<string, number | string> {
  if (scenario === "base") return {};

  const scDef = meta?.scenarios?.find((s) => s.id === scenario);
  if (scDef?.params && scDef.params.length > 0) {
    const defs: Record<string, number | string> = {};
    for (const p of scDef.params) {
      defs[p.key] = p.default;
    }
    return defs;
  }

  if (scenario === "intervencion") {
    return { ...INTERVENCION_FALLBACK_DEFAULTS };
  }
  if (scenario === "pesimista") {
    return { ...PESIMISTA_FALLBACK_DEFAULTS };
  }

  return {};
}

/**
 * Canonical string key representing scenario parameters for cache/matching.
 */
export function scenarioParamsKey(params: Record<string, number | string>): string {
  const keys = Object.keys(params).sort();
  return keys.map((k) => `${k}:${params[k]}`).join("|");
}

/**
 * Returns true if the given scenario has parameters that differ from its defaults.
 */
export function isScenarioModified(
  scenario: ScenarioId,
  params: Record<string, number | string> | undefined,
  meta: Meta | null
): boolean {
  if (scenario === "base" || !params) return false;
  const defs = defaultsForScenario(scenario, meta);
  const resolved = paramsForScenario(scenario, params, meta);
  for (const k of Object.keys(defs)) {
    const defVal = defs[k];
    const resVal = resolved[k];
    if (typeof defVal === "number") {
      if (Number(resVal) !== Number(defVal)) return true;
    } else {
      if (String(resVal) !== String(defVal)) return true;
    }
  }
  return false;
}

/**
 * Union of the `default` value of params across ALL scenarios in meta (keys do not clash).
 */
export function defaultParamsFromMeta(meta: Meta | null): Record<string, number | string> {
  if (!meta?.scenarios) return {};
  const defaults: Record<string, number | string> = {};
  for (const sc of meta.scenarios) {
    if (sc.params) {
      for (const p of sc.params) {
        defaults[p.key] = p.default;
      }
    }
  }
  return defaults;
}

/**
 * Only keys declared in meta for the given scenario; missing keys => default from meta; base => {}.
 */
export function paramsForScenario(
  scenario: ScenarioId,
  params: Record<string, number | string>,
  meta: Meta | null
): Record<string, number | string> {
  if (scenario === "base") return {};
  if (!meta?.scenarios) return {};

  const scDef = meta.scenarios.find((s) => s.id === scenario);
  if (!scDef?.params) return {};

  const result: Record<string, number | string> = {};
  for (const p of scDef.params) {
    if (params[p.key] !== undefined) {
      result[p.key] = params[p.key];
    } else {
      result[p.key] = p.default;
    }
  }
  return result;
}

/**
 * Human-readable scenario description with option labels and units from meta.
 * intervencion => "Intervención: Promoción del voto joven · +3 pp · cobertura 100 % · Zonas rojas y naranjas"
 * pesimista   => "Pesimista: caída 2 pp · acentuación 50 %"
 */
export function describeScenario(
  scenario: Exclude<ScenarioId, "base">,
  params: Record<string, number | string>,
  meta: Meta | null
): string {
  const resolved = paramsForScenario(scenario, params, meta);

  if (scenario === "intervencion") {
    const scDef = meta?.scenarios?.find((s) => s.id === "intervencion");
    const leverParam = scDef?.params?.find((p) => p.key === "lever");
    const targetingParam = scDef?.params?.find((p) => p.key === "targeting");
    const effectParam = scDef?.params?.find((p) => p.key === "effect_pp");
    const coverageParam = scDef?.params?.find((p) => p.key === "coverage");

    const leverVal = resolved.lever ?? params.lever ?? "promocion_jovenes";
    const targetingVal = resolved.targeting ?? params.targeting ?? "rojo_naranja";
    const effectVal = Number(resolved.effect_pp ?? params.effect_pp ?? 3.0);
    const coverageVal = Number(resolved.coverage ?? params.coverage ?? 100);

    const leverLabel =
      leverParam?.options?.find((o) => o.value === String(leverVal))?.label ??
      LEVER_DEFAULT_LABELS[String(leverVal)] ??
      String(leverVal);

    const targetingLabel =
      targetingParam?.options?.find((o) => o.value === String(targetingVal))?.label ??
      TARGETING_DEFAULT_LABELS[String(targetingVal)] ??
      String(targetingVal);

    const effectUnit = effectParam?.unit ?? "pp";
    const coverageUnit = coverageParam?.unit ?? "%";

    const effStr = effectVal > 0 ? `+${effectVal}` : `${effectVal}`;
    return `Intervención: ${leverLabel} · ${effStr} ${effectUnit} · cobertura ${coverageVal} ${coverageUnit} · ${targetingLabel}`;
  }

  if (scenario === "pesimista") {
    const scDef = meta?.scenarios?.find((s) => s.id === "pesimista");
    const shockParam = scDef?.params?.find((p) => p.key === "shock_pp");
    const trendParam = scDef?.params?.find((p) => p.key === "trend_amplifier");

    const shockVal = Number(resolved.shock_pp ?? params.shock_pp ?? 2.0);
    const trendVal = Number(resolved.trend_amplifier ?? params.trend_amplifier ?? 50);

    const shockUnit = shockParam?.unit ?? "pp";
    const trendUnit = trendParam?.unit ?? "%";

    return `Pesimista: caída ${shockVal} ${shockUnit} · acentuación ${trendVal} ${trendUnit}`;
  }

  return scenario;
}
