// MOCK DATA: Deterministic scenario simulation engine
import type { ScenarioRequest, ScenarioResult, ScenarioSummary, Category, RiskItem } from "../types";
import { generateMockStates, generateMockMunicipalityItems } from "./risk";

export function simulateMockScenario(req: ScenarioRequest): ScenarioResult {
  const scenario = req.scenario;
  const params = req.params ?? {};
  const level = req.level;
  const ent = req.ent;

  // Base items to compare
  const baseItems: RiskItem[] =
    level === "mun" && ent
      ? generateMockMunicipalityItems(ent, "base")
      : generateMockStates("base");

  // Simulated items
  const simulatedItems: RiskItem[] =
    level === "mun" && ent
      ? generateMockMunicipalityItems(ent, scenario, params)
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

  const summary: ScenarioSummary = {
    n_units: simulatedItems.length,
    by_category: byCategory,
    by_category_base: byCategoryBase,
    votos_adicionales: totalVotosAdicionales,
    mean_delta_pp: meanDelta,
  };

  return {
    scenario,
    params,
    level,
    items: simulatedItems,
    summary,
  };
}
