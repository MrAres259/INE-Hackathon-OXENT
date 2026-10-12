// MOCK DATA: Ranking generator
import type { RiskItem, Level, ScenarioId } from "../types";
import { generateMockStates, generateMockMunicipalityItems } from "./risk";

export function getMockRanking(
  level: Level = "state",
  ent?: string,
  scenario: ScenarioId = "base",
  limit = 20
): RiskItem[] {
  let items: RiskItem[];

  if (level === "mun") {
    items = generateMockMunicipalityItems(ent, scenario);
  } else {
    items = generateMockStates(scenario);
  }

  // Sort by risk_score desc
  const sorted = [...items].sort((a, b) => (b.risk_score ?? 0) - (a.risk_score ?? 0));
  return sorted.slice(0, limit);
}
