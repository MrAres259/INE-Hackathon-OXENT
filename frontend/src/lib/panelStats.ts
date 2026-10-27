import type { Category, RiskItem, RegionDetail, Driver } from "./types";
import { getAbstencionEsperada, getCategoryLabel } from "./format";

export const CATEGORY_ORDER: Category[] = ["rojo", "naranja", "amarillo", "verde"];

export interface CategoryCountItem {
  category: Category;
  label: string;
  count: number;
  pct: number;
  dotClass: string;
  bgClass: string;
}

export const CATEGORY_STYLES: Record<
  Category,
  {
    label: string;
    dotClass: string;
    bgClass: string;
    badgeClass: string;
    textClass: string;
  }
> = {
  rojo: {
    label: "Crítico",
    dotClass: "bg-risk-crit",
    bgClass: "bg-risk-crit",
    badgeClass: "bg-risk-crit text-white",
    textClass: "text-risk-crit",
  },
  naranja: {
    label: "Alto",
    dotClass: "bg-risk-high",
    bgClass: "bg-risk-high",
    badgeClass: "bg-risk-high text-white",
    textClass: "text-risk-high",
  },
  amarillo: {
    label: "Moderado",
    dotClass: "bg-risk-mid",
    bgClass: "bg-risk-mid",
    badgeClass: "bg-risk-mid text-foreground font-semibold",
    textClass: "text-foreground",
  },
  verde: {
    label: "Bajo",
    dotClass: "bg-risk-low",
    bgClass: "bg-risk-low",
    badgeClass: "bg-risk-low text-white",
    textClass: "text-risk-low",
  },
  sin_dato: {
    label: "Sin dato",
    dotClass: "bg-muted-foreground",
    bgClass: "bg-muted",
    badgeClass: "bg-muted text-muted-foreground",
    textClass: "text-muted-foreground",
  },
};

export function getCategoryCounts(items: RiskItem[]): Record<Category, number> {
  const counts: Record<Category, number> = {
    verde: 0,
    amarillo: 0,
    naranja: 0,
    rojo: 0,
    sin_dato: 0,
  };
  for (const item of items) {
    if (item.category && item.category in counts) {
      counts[item.category]++;
    } else {
      counts.sin_dato++;
    }
  }
  return counts;
}

export function getCategoryDistribution(items: RiskItem[]): CategoryCountItem[] {
  const counts = getCategoryCounts(items);
  const total = items.length;

  return CATEGORY_ORDER.map((cat) => {
    const count = counts[cat] ?? 0;
    const pct = total > 0 ? (count / total) * 100 : 0;
    return {
      category: cat,
      label: CATEGORY_STYLES[cat].label,
      count,
      pct,
      dotClass: CATEGORY_STYLES[cat].dotClass,
      bgClass: CATEGORY_STYLES[cat].bgClass,
    };
  });
}

export function computeNationalStats(items: RiskItem[]): {
  totalZones: number;
  avgAbstention: number | null;
  totalExpected: number;
  counts: Record<Category, number>;
} {
  const totalZones = items.length;
  let abstSum = 0;
  let abstCount = 0;
  let totalExpected = 0;

  for (const item of items) {
    if (item.pred_abstention !== null && item.pred_abstention !== undefined && !isNaN(item.pred_abstention)) {
      abstSum += item.pred_abstention;
      abstCount++;
    }
    totalExpected += getAbstencionEsperada(item);
  }

  const avgAbstention = abstCount > 0 ? abstSum / abstCount : null;
  const counts = getCategoryCounts(items);

  return {
    totalZones,
    avgAbstention,
    totalExpected,
    counts,
  };
}

export function getTopRiskZones(items: RiskItem[], limit = 6): RiskItem[] {
  return [...items]
    .sort((a, b) => {
      const scoreA = a.risk_score ?? -1;
      const scoreB = b.risk_score ?? -1;
      if (scoreB !== scoreA) return scoreB - scoreA;
      return (b.pred_abstention ?? 0) - (a.pred_abstention ?? 0);
    })
    .slice(0, limit);
}

export function filterRankingBySemaforo(items: RiskItem[], category: Category | null): RiskItem[] {
  if (!category) return items;
  return items.filter((item) => item.category === category);
}

export function formatDiagnosticSummaryLine(detail: RegionDetail): string | null {
  const catWord =
    detail.category && detail.category !== "sin_dato"
      ? getCategoryLabel(detail.category).replace(/^Riesgo\s+/i, "").toLowerCase()
      : null;
  const scoreVal = detail.risk_score;
  const scorePart = scoreVal !== undefined && scoreVal !== null ? `(${scoreVal} de 100)` : null;

  let riskPrefix = "";
  if (catWord && scorePart) {
    riskPrefix = `Riesgo ${catWord} ${scorePart}`;
  } else if (catWord) {
    riskPrefix = `Riesgo ${catWord}`;
  } else if (scorePart) {
    riskPrefix = `Índice de riesgo ${scorePart}`;
  }

  const hasAbst =
    detail.pred_abstention !== null &&
    detail.pred_abstention !== undefined &&
    !isNaN(detail.pred_abstention);
  const abstPct = hasAbst ? (detail.pred_abstention! * 100).toFixed(1) : null;
  const abstEsperada = getAbstencionEsperada(detail);
  const hasPeople = abstEsperada > 0;
  const peopleStr = hasPeople ? ` (≈ ${Math.round(abstEsperada).toLocaleString("es-MX")} personas)` : "";

  let abstSentence = "";
  if (abstPct) {
    abstSentence = `se espera que no vote el ${abstPct} % de su lista nominal en 2027${peopleStr}`;
  }

  if (riskPrefix && abstSentence) {
    return `${riskPrefix}: ${abstSentence}.`;
  } else if (riskPrefix) {
    return `${riskPrefix}.`;
  } else if (abstSentence) {
    return `${abstSentence.charAt(0).toUpperCase() + abstSentence.slice(1)}.`;
  }
  return null;
}
