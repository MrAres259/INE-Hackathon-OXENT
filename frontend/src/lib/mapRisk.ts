import type { Category, RiskItem, ScenarioId } from "./types";

export type LevelIndex = {
  state: Map<string, RiskItem>;
  mun: Map<string, RiskItem>;
};

export type MapRiskData = {
  base: LevelIndex;                            // escenario base, nacional
  alt: LevelIndex | null;                      // escenario alterno con los parámetros actuales (null mientras carga)
  altScenario: Exclude<ScenarioId, "base">;    // = escenario activo si ≠ base; si no, "intervencion"
  altLabel: string;                            // descripción legible del escenario alterno
  active: LevelIndex;                          // = scenario === "base" ? base : (alt ?? base)
  vmax: { state: number; mun: number };        // máx. abstencion_esperada en BASE (escala 3D fija entre escenarios)
  loading: boolean;
  error: string | null;
};

export function indexItems(items: RiskItem[]): Map<string, RiskItem> {
  const map = new Map<string, RiskItem>();
  for (const item of items) {
    map.set(item.id, item);
  }
  return map;
}

export function categoryCounts(idx: Map<string, RiskItem>): Record<Category, number> {
  const counts: Record<Category, number> = {
    verde: 0,
    amarillo: 0,
    naranja: 0,
    rojo: 0,
    sin_dato: 0,
  };
  for (const item of idx.values()) {
    const cat = item.category in counts ? item.category : "sin_dato";
    counts[cat]++;
  }
  return counts;
}

export function maxAbstencionEsperada(idx: Map<string, RiskItem>): number {
  let max = 0;
  for (const item of idx.values()) {
    const val = item.abstencion_esperada ?? 0;
    if (val > max) {
      max = val;
    }
  }
  return max;
}

const CATEGORY_SEVERITY: Record<Category, number> = {
  verde: 1,
  amarillo: 2,
  naranja: 3,
  rojo: 4,
  sin_dato: 0,
};

export function transitionSummary(
  base: Map<string, RiskItem>,
  alt: Map<string, RiskItem>
): { improved: number; worsened: number; same: number; rojoBase: number; rojoAlt: number } {
  let improved = 0;
  let worsened = 0;
  let same = 0;
  let rojoBase = 0;
  let rojoAlt = 0;

  for (const item of base.values()) {
    if (item.category === "rojo") rojoBase++;
  }

  for (const item of alt.values()) {
    if (item.category === "rojo") rojoAlt++;
  }

  for (const [id, baseItem] of base.entries()) {
    const altItem = alt.get(id);
    if (!altItem) continue;

    if (baseItem.category === "sin_dato" || altItem.category === "sin_dato") {
      same++;
    } else {
      const baseSev = CATEGORY_SEVERITY[baseItem.category] ?? 0;
      const altSev = CATEGORY_SEVERITY[altItem.category] ?? 0;
      if (altSev < baseSev) {
        improved++;
      } else if (altSev > baseSev) {
        worsened++;
      } else {
        same++;
      }
    }
  }

  return {
    improved,
    worsened,
    same,
    rojoBase,
    rojoAlt,
  };
}

export const EMPTY_LEVEL_INDEX: LevelIndex = {
  state: new Map<string, RiskItem>(),
  mun: new Map<string, RiskItem>(),
};
