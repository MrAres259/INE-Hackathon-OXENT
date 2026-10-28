import type { Campaign, Meta, ScenarioId } from "./types";

export const LEVER_DEFAULT_LABELS: Record<string, string> = {
  promocion_jovenes: "Promoción del voto joven",
  casillas_rurales: "Casillas y traslado en zonas rurales",
  materiales_lengua_indigena: "Materiales y capacitación en lenguas indígenas",
  campana_general: "Campaña general de promoción del voto",
};

export const LEVER_SHORT_LABELS: Record<string, string> = {
  promocion_jovenes: "Voto joven",
  casillas_rurales: "Casillas rurales",
  materiales_lengua_indigena: "Lenguas indígenas",
  campana_general: "Campaña general",
};

export const TARGETING_DEFAULT_LABELS: Record<string, string> = {
  rojo: "Solo zonas rojas",
  rojo_naranja: "Zonas rojas y naranjas",
  todos: "Todo el país",
};

export const INTERVENCION_FALLBACK_DEFAULTS: Record<string, number | string> = {
  lever: "promocion_jovenes",
  targeting: "rojo_naranja",
  effect_pp: 3.0,
  coverage: 100,
};

export const PESIMISTA_FALLBACK_DEFAULTS: Record<string, number | string> = {
  shock_pp: 2.0,
  trend_amplifier: 50,
};

export function defaultCampaign(meta: Meta | null): Campaign {
  const scDef = meta?.scenarios?.find((s) => s.id === "intervencion");
  const lever = (scDef?.params?.find((p) => p.key === "lever")?.default as string) ?? "promocion_jovenes";
  const targeting = (scDef?.params?.find((p) => p.key === "targeting")?.default as string) ?? "rojo_naranja";
  const effect_pp = Number(scDef?.params?.find((p) => p.key === "effect_pp")?.default ?? 3.0);
  const coverage = Number(scDef?.params?.find((p) => p.key === "coverage")?.default ?? 100);
  return {
    lever,
    targeting,
    effect_pp,
    coverage,
    ents: [],
  };
}

/**
 * Default parameters for a single scenario.
 * base => {}
 * intervencion / pesimista => defaults defined in meta, or standard defaults if meta is null
 */
export function defaultsForScenario(
  scenario: ScenarioId,
  meta: Meta | null
): Record<string, any> {
  if (scenario === "base") return {};

  const scDef = meta?.scenarios?.find((s) => s.id === scenario);
  if (scDef?.params && scDef.params.length > 0) {
    const defs: Record<string, any> = {};
    for (const p of scDef.params) {
      defs[p.key] = p.default;
    }
    if (scenario === "intervencion") {
      if (!defs.campaigns || !Array.isArray(defs.campaigns)) {
        defs.campaigns = [
          {
            lever: String(defs.lever ?? "promocion_jovenes"),
            targeting: String(defs.targeting ?? "rojo_naranja"),
            effect_pp: Number(defs.effect_pp ?? 3.0),
            coverage: Number(defs.coverage ?? 100),
            ents: [],
          },
        ];
      }
      // Ensure top-level loose keys are populated for compatibility
      const c1 = defs.campaigns[0];
      defs.lever = defs.lever ?? c1.lever;
      defs.targeting = defs.targeting ?? c1.targeting;
      defs.effect_pp = defs.effect_pp ?? c1.effect_pp;
      defs.coverage = defs.coverage ?? c1.coverage;
    }
    return defs;
  }

  if (scenario === "intervencion") {
    const defCamp = {
      lever: "promocion_jovenes",
      targeting: "rojo_naranja",
      effect_pp: 3.0,
      coverage: 100,
      ents: [],
    };
    return {
      ...INTERVENCION_FALLBACK_DEFAULTS,
      campaigns: [defCamp],
    };
  }
  if (scenario === "pesimista") {
    return { ...PESIMISTA_FALLBACK_DEFAULTS };
  }

  return {};
}

/**
 * Default parameters for an intervention lever (defaults from meta without `lever` and `campaigns`).
 */
export function leverDefaults(meta: Meta | null): Record<string, any> {
  const defs = defaultsForScenario("intervencion", meta);
  const { lever: _lever, campaigns: _campaigns, ents: _ents, ...rest } = defs;
  return rest;
}

export const SCENARIO_DISPLAY_NAMES: Record<ScenarioId, string> = {
  base: "Base",
  intervencion: "Intervención",
  pesimista: "Pesimista",
};

/**
 * Canonical string key representing scenario parameters for cache/matching.
 */
export function scenarioParamsKey(params: Record<string, any>): string {
  const keys = Object.keys(params).sort();
  return keys
    .map((k) => {
      const v = params[k];
      if (typeof v === "object" && v !== null) {
        return `${k}:${JSON.stringify(v)}`;
      }
      return `${k}:${v}`;
    })
    .join("|");
}

/**
 * Returns true if the given scenario has parameters that differ from its defaults.
 * Intervencion differs from "una campaña por defecto".
 */
export function isScenarioModified(
  scenario: ScenarioId,
  params: Record<string, any> | undefined,
  meta: Meta | null
): boolean {
  if (scenario === "base" || !params) return false;

  if (scenario === "intervencion") {
    const scDef = meta?.scenarios?.find((s) => s.id === "intervencion");
    const defLever = (scDef?.params?.find((p) => p.key === "lever")?.default as string) ?? "promocion_jovenes";
    const defTargeting = (scDef?.params?.find((p) => p.key === "targeting")?.default as string) ?? "rojo_naranja";
    const defEffect = Number(scDef?.params?.find((p) => p.key === "effect_pp")?.default ?? 3.0);
    const defCoverage = Number(scDef?.params?.find((p) => p.key === "coverage")?.default ?? 100);

    // Check loose keys on params
    if (params.lever !== undefined && params.lever !== defLever) return true;
    if (params.targeting !== undefined && params.targeting !== defTargeting) return true;
    if (params.effect_pp !== undefined && Number(params.effect_pp) !== defEffect) return true;
    if (params.coverage !== undefined && Number(params.coverage) !== defCoverage) return true;
    if (Array.isArray(params.ents) && params.ents.length > 0) return true;

    // Check campaigns array
    if (Array.isArray(params.campaigns)) {
      if (params.campaigns.length !== 1) return true;
      const c = params.campaigns[0];
      if (c.lever !== defLever) return true;
      if (c.targeting !== defTargeting) return true;
      if (Number(c.effect_pp) !== defEffect) return true;
      if (Number(c.coverage) !== defCoverage) return true;
      if (Array.isArray(c.ents) && c.ents.length > 0) return true;
    }

    return false;
  }

  if (scenario === "pesimista") {
    const defs = defaultsForScenario("pesimista", meta);
    const resolved = paramsForScenario("pesimista", params, meta);
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

  return false;
}

/**
 * Union of the `default` value of params across ALL scenarios in meta (keys do not clash).
 */
export function defaultParamsFromMeta(meta: Meta | null): Record<string, any> {
  if (!meta?.scenarios) return {};
  const defaults: Record<string, any> = {};
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
 * Intervención sends `{ campaigns }` and loose keys of first campaign if meta supports campaigns,
 * or only first campaign's loose keys if meta does not declare campaigns.
 */
export function paramsForScenario(
  scenario: ScenarioId,
  params: Record<string, any>,
  meta: Meta | null
): Record<string, any> {
  if (scenario === "base") return {};
  if (!meta?.scenarios) return {};

  const scDef = meta.scenarios.find((s) => s.id === scenario);
  if (!scDef?.params) return {};

  if (scenario === "intervencion") {
    let campaigns: Campaign[] = [];
    if (Array.isArray(params?.campaigns) && params.campaigns.length > 0) {
      campaigns = params.campaigns.map((c) => ({
        lever: String(c.lever || "promocion_jovenes"),
        targeting: String(c.targeting || "rojo_naranja"),
        effect_pp: Number(c.effect_pp ?? 3.0),
        coverage: Number(c.coverage ?? 100),
        ents: Array.isArray(c.ents) ? [...c.ents] : [],
      }));
    } else {
      const lever = String(params?.lever ?? "promocion_jovenes");
      const targeting = String(params?.targeting ?? "rojo_naranja");
      const effect_pp = Number(params?.effect_pp ?? 3.0);
      const coverage = Number(params?.coverage ?? 100);
      const ents = Array.isArray(params?.ents) ? [...params.ents] : [];
      campaigns = [{ lever, targeting, effect_pp, coverage, ents }];
    }

    const hasCampaignsInMeta = scDef.params.some((p) => p.key === "campaigns");
    const c1 = campaigns[0];

    if (!hasCampaignsInMeta) {
      return {
        lever: c1.lever,
        targeting: c1.targeting,
        effect_pp: c1.effect_pp,
        coverage: c1.coverage,
      };
    }

    return {
      campaigns,
      lever: c1.lever,
      targeting: c1.targeting,
      effect_pp: c1.effect_pp,
      coverage: c1.coverage,
    };
  }

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
 * 1 campaña = texto actual; varias = "Intervención: 2 campañas · Voto joven +10 pp (todo el país) · Casillas rurales +5 pp (Chiapas, Oaxaca)"
 */
export function describeScenario(
  scenario: Exclude<ScenarioId, "base">,
  params: Record<string, any>,
  meta: Meta | null
): string {
  if (scenario === "intervencion") {
    let campaigns: Campaign[] = [];
    if (Array.isArray(params?.campaigns) && params.campaigns.length > 0) {
      campaigns = params.campaigns;
    } else {
      campaigns = [
        {
          lever: String(params?.lever ?? "promocion_jovenes"),
          targeting: String(params?.targeting ?? "rojo_naranja"),
          effect_pp: Number(params?.effect_pp ?? 3.0),
          coverage: Number(params?.coverage ?? 100),
          ents: Array.isArray(params?.ents) ? params.ents : [],
        },
      ];
    }

    if (campaigns.length > 1) {
      const pieces = campaigns.map((c) => {
        const shortName = LEVER_SHORT_LABELS[c.lever] ?? c.lever;
        const effNum = Number(c.effect_pp ?? 3.0);
        const effStr = effNum > 0 ? `+${effNum}` : `${effNum}`;
        let scope = "todo el país";
        if (c.ents && c.ents.length > 0) {
          if (c.ents.length <= 3) {
            const stateNames = c.ents.map((id) => {
              const st = meta?.states?.find((s) => s.id === id);
              return st ? st.name : id;
            });
            scope = stateNames.join(", ");
          } else {
            scope = `${c.ents.length} estados`;
          }
        }
        return `${shortName} ${effStr} pp (${scope})`;
      });

      return `Intervención: ${campaigns.length} campañas · ${pieces.join(" · ")}`;
    }

    const c1 = campaigns[0];
    const scDef = meta?.scenarios?.find((s) => s.id === "intervencion");
    const leverParam = scDef?.params?.find((p) => p.key === "lever");
    const targetingParam = scDef?.params?.find((p) => p.key === "targeting");
    const effectParam = scDef?.params?.find((p) => p.key === "effect_pp");
    const coverageParam = scDef?.params?.find((p) => p.key === "coverage");

    const leverVal = c1.lever ?? "promocion_jovenes";
    const targetingVal = c1.targeting ?? "rojo_naranja";
    const effectVal = Number(c1.effect_pp ?? 3.0);
    const coverageVal = Number(c1.coverage ?? 100);

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

    const shockVal = Number(params.shock_pp ?? 2.0);
    const trendVal = Number(params.trend_amplifier ?? 50);

    const shockUnit = shockParam?.unit ?? "pp";
    const trendUnit = trendParam?.unit ?? "%";

    return `Pesimista: caída ${shockVal} ${shockUnit} · acentuación ${trendVal} ${trendUnit}`;
  }

  return scenario;
}

