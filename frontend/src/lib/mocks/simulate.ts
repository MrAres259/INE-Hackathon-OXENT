// MOCK DATA: Deterministic scenario simulation engine
import type { ScenarioRequest, ScenarioResult, ScenarioSummary, Category, RiskItem, Campaign } from "../types";
import { generateMockStates, generateMockMunicipalityItems } from "./risk";

export function simulateMockScenario(req: ScenarioRequest): ScenarioResult {
  const scenario = req.scenario;
  const params = req.params ?? {};
  const level = req.level;
  const ent = req.ent;

  const isMun = level === "mun";
  const munEnt = ent ? ent : undefined;

  // Base items to compare
  const baseItems: RiskItem[] = isMun
    ? generateMockMunicipalityItems(munEnt, "base")
    : generateMockStates("base");

  // Simulated items
  const simulatedItems: RiskItem[] = isMun
    ? generateMockMunicipalityItems(munEnt, scenario, params)
    : generateMockStates(scenario, params);

  const byCategory: Record<Category, number> = {
    verde: 0,
    amarillo: 0,
    naranja: 0,
    rojo: 0,
    sin_dato: 0,
  };

  const byCategoryBase: Record<Category, number> = {
    verde: 0,
    amarillo: 0,
    naranja: 0,
    rojo: 0,
    sin_dato: 0,
  };

  for (const item of simulatedItems) {
    byCategory[item.category] = (byCategory[item.category] || 0) + 1;
  }

  for (const item of baseItems) {
    byCategoryBase[item.category] = (byCategoryBase[item.category] || 0) + 1;
  }

  let totalVotosAdicionales = 0;
  let totalDelta = 0;
  let deltaCount = 0;

  for (let i = 0; i < simulatedItems.length; i++) {
    const sim = simulatedItems[i];
    const base = baseItems[i];
    if (sim && base && sim.lista_nominal) {
      const partDiff = (sim.pred_participation ?? 0) - (base.pred_participation ?? 0);
      totalVotosAdicionales += Math.round(partDiff * sim.lista_nominal);
      if (sim.delta_vs_base_pp !== undefined && sim.delta_vs_base_pp !== null) {
        totalDelta += sim.delta_vs_base_pp;
        deltaCount++;
      }
    }
  }

  const meanDelta = deltaCount > 0 ? Math.round((totalDelta / deltaCount) * 10) / 10 : 0;

  let campaignSummaries = undefined;
  let votosSumaIndividual = undefined;
  let votosTraslape = undefined;

  if (scenario === "intervencion") {
    const campaigns: Campaign[] = Array.isArray((params as any)?.campaigns) && (params as any).campaigns.length > 0
      ? (params as any).campaigns
      : [
          {
            lever: (params?.lever as string) ?? "promocion_jovenes",
            targeting: (params?.targeting as string) ?? "rojo_naranja",
            effect_pp: typeof params?.effect_pp === "number" ? params.effect_pp : 3.0,
            coverage: typeof params?.coverage === "number" ? params.coverage : 100,
            ents: Array.isArray((params as any)?.ents) ? (params as any).ents : [],
          },
        ];

    const LEVER_LABELS: Record<string, string> = {
      promocion_jovenes: "Promoción del voto joven",
      casillas_rurales: "Casillas y traslado en zonas rurales",
      materiales_lengua_indigena: "Materiales y capacitación en lenguas indígenas",
      campana_general: "Campaña general de promoción del voto",
    };

    campaignSummaries = campaigns.map((c) => {
      const singleItems: RiskItem[] = isMun
        ? generateMockMunicipalityItems(munEnt, "intervencion", { ...c, campaigns: [c] })
        : generateMockStates("intervencion", { ...c, campaigns: [c] });

      let votosSolo = 0;
      let totalDeltaSolo = 0;
      let deltaSoloCount = 0;
      let targetUnits = 0;

      for (let i = 0; i < singleItems.length; i++) {
        const sim = singleItems[i];
        const base = baseItems[i];
        if (sim && base && sim.lista_nominal) {
          const partDiff = (sim.pred_participation ?? 0) - (base.pred_participation ?? 0);
          if (partDiff > 0.0001 || (sim.delta_vs_base_pp !== undefined && sim.delta_vs_base_pp !== null && sim.delta_vs_base_pp < 0)) {
            targetUnits++;
            votosSolo += Math.round(partDiff * sim.lista_nominal);
            if (sim.delta_vs_base_pp !== undefined && sim.delta_vs_base_pp !== null) {
              totalDeltaSolo += sim.delta_vs_base_pp;
              deltaSoloCount++;
            }
          }
        }
      }

      const meanDeltaSolo = deltaSoloCount > 0 ? Math.round((totalDeltaSolo / deltaSoloCount) * 10) / 10 : 0;
      const label = LEVER_LABELS[c.lever] ?? c.lever;

      return {
        lever: c.lever,
        label,
        ents: c.ents ?? [],
        n_target_units: targetUnits,
        votos_solo: votosSolo,
        mean_delta_pp_solo: meanDeltaSolo,
      };
    });

    votosSumaIndividual = campaignSummaries.reduce((sum, c) => sum + c.votos_solo, 0);
    votosTraslape = Math.max(0, votosSumaIndividual - totalVotosAdicionales);
  }

  const summary: ScenarioSummary = {
    n_units: simulatedItems.length,
    by_category: byCategory,
    by_category_base: byCategoryBase,
    votos_adicionales: totalVotosAdicionales,
    mean_delta_pp: meanDelta,
    campaigns: campaignSummaries,
    votos_suma_individual: votosSumaIndividual,
    votos_traslape: votosTraslape,
  };

  return {
    scenario,
    params,
    level,
    items: simulatedItems,
    summary,
  };
}
