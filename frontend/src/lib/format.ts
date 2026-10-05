// Formatting utilities for percentages, points, numbers, categories, and CSV generation
import type { Category, RiskItem, Driver } from "./types";

export const CATEGORY_COLORS: Record<Category, string> = {
  verde: "#2e7d32",
  amarillo: "#f9a825",
  naranja: "#ef6c00",
  rojo: "#c62828",
  sin_dato: "#bdbdbd",
};

export const CATEGORY_LABELS: Record<Category, string> = {
  verde: "Riesgo Bajo",
  amarillo: "Riesgo Moderado",
  naranja: "Riesgo Alto",
  rojo: "Riesgo Crítico",
  sin_dato: "Sin dato",
};

export function getCategoryColor(category: Category): string {
  return CATEGORY_COLORS[category] ?? CATEGORY_COLORS.sin_dato;
}

export function getCategoryLabel(category: Category): string {
  return CATEGORY_LABELS[category] ?? CATEGORY_LABELS.sin_dato;
}

export function formatPct(val: number | null | undefined, decimals = 1): string {
  if (val === null || val === undefined || isNaN(val)) return "—";
  return `${(val * 100).toFixed(decimals)}%`;
}

export function formatPp(val: number | null | undefined, decimals = 1): string {
  if (val === null || val === undefined || isNaN(val)) return "—";
  const sign = val > 0 ? "+" : "";
  return `${sign}${val.toFixed(decimals)} pp`;
}

export function formatInt(val: number | null | undefined): string {
  if (val === null || val === undefined || isNaN(val)) return "—";
  return Math.round(val).toLocaleString("es-MX");
}

export function getVotesLabel(val: number | null | undefined): string {
  if (val !== null && val !== undefined && val < 0) {
    return "Votos perdidos estimados";
  }
  return "Votos adicionales estimados";
}

export function formatSignedVotes(val: number | null | undefined): string {
  if (val === null || val === undefined || isNaN(val)) return "—";
  const rounded = Math.round(val);
  if (rounded < 0) {
    return `−${Math.abs(rounded).toLocaleString("es-MX")}`;
  }
  return `+${rounded.toLocaleString("es-MX")}`;
}

export function getVotesColorClass(val: number | null | undefined): string {
  if (val === null || val === undefined || isNaN(val)) return "text-slate-400";
  return val < 0 ? "text-rose-400" : "text-emerald-400";
}

export const MEAN_DELTA_LABEL = "Cambio promedio en abstención";
export const DELTA_ABSTENTION_NOTE = "(negativo = menos abstención)";

export function formatDeltaPp(val: number | null | undefined, decimals = 1): string {
  if (val === null || val === undefined || isNaN(val)) return "—";
  const sign = val > 0 ? "+" : "";
  return `${sign}${val.toFixed(decimals)} pp`;
}

export function getDeltaAbstentionColorClass(val: number | null | undefined): string {
  if (val === null || val === undefined || isNaN(val)) return "text-slate-400";
  if (val < 0) return "text-emerald-400";
  if (val > 0) return "text-rose-400";
  return "text-slate-200";
}

export function getDeltaAbstentionHex(val: number | null | undefined): string {
  if (val === null || val === undefined || isNaN(val)) return "#94a3b8";
  if (val < 0) return "#10b981";
  if (val > 0) return "#f43f5e";
  return "#e2e8f0";
}

export function hasProminentDrivers(
  drivers: Driver[] | null | undefined,
  threshold = 0.3
): boolean {
  if (!drivers || drivers.length === 0) return false;
  return drivers.some((d) => Math.abs(d.contribution_pp) >= threshold);
}

export function formatSuppressed(item: {
  suprimido?: boolean;
  ln?: number | null;
  participation?: number | null;
}): string | null {
  if (item.suprimido) {
    return "dato protegido (menos de 10 personas)";
  }
  if (item.ln !== null && item.ln !== undefined && item.ln > 0 && item.ln < 10) {
    return "dato protegido (menos de 10 personas)";
  }
  return null;
}

export function getAbstencionEsperada(item: RiskItem): number {
  if (item.abstencion_esperada !== undefined && item.abstencion_esperada !== null) {
    return Math.round(item.abstencion_esperada);
  }
  if (item.pred_abstention !== null && item.pred_abstention !== undefined && item.lista_nominal) {
    return Math.round(item.pred_abstention * item.lista_nominal);
  }
  return 0;
}

export type RankingSortKey = "risk" | "abstencion_esperada" | "prioridad";

export function sortRankingItems(items: RiskItem[], sortBy: RankingSortKey = "risk"): RiskItem[] {
  const copy = [...items];
  if (sortBy === "risk") {
    return copy.sort((a, b) => (b.risk_score ?? 0) - (a.risk_score ?? 0));
  }
  if (sortBy === "abstencion_esperada") {
    return copy.sort((a, b) => getAbstencionEsperada(b) - getAbstencionEsperada(a));
  }
  if (sortBy === "prioridad") {
    return copy.sort((a, b) => {
      // If both have explicit prioridad, sort ascending by prioridad rank (1 is highest priority)
      if (a.prioridad != null && b.prioridad != null) {
        return a.prioridad - b.prioridad;
      }
      if (a.prioridad != null) return -1;
      if (b.prioridad != null) return 1;

      // Fallback: prioritize rojo/naranja zones, ordered by abstencion_esperada descending
      const isCriticalA = a.category === "rojo" || a.category === "naranja";
      const isCriticalB = b.category === "rojo" || b.category === "naranja";
      if (isCriticalA && !isCriticalB) return -1;
      if (!isCriticalA && isCriticalB) return 1;

      return getAbstencionEsperada(b) - getAbstencionEsperada(a);
    });
  }
  return copy;
}

export function escapeCsvField(field: string | number | null | undefined): string {
  if (field === null || field === undefined) return "";
  const str = String(field);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function generateRankingCsv(items: RiskItem[]): string {
  const headers = [
    "Clave",
    "Nombre",
    "Nivel",
    "Entidad",
    "Lista Nominal",
    "Participación 2024 (%)",
    "Abstención Pronosticada 2027 (%)",
    "Abstención Esperada (personas)",
    "Prioridad",
    "Índice de Riesgo (0-100)",
    "Semáforo",
    "Tendencia (pp)",
    "Delta vs Base (pp)",
  ];

  const rows = items.map((item) => [
    escapeCsvField(item.id),
    escapeCsvField(item.name),
    escapeCsvField(item.level === "state" ? "Estado" : "Municipio"),
    escapeCsvField(item.ent),
    escapeCsvField(item.lista_nominal),
    escapeCsvField(item.last_participation !== null ? (item.last_participation * 100).toFixed(1) : ""),
    escapeCsvField(item.pred_abstention !== null ? (item.pred_abstention * 100).toFixed(1) : ""),
    escapeCsvField(getAbstencionEsperada(item)),
    escapeCsvField(item.prioridad !== undefined && item.prioridad !== null ? item.prioridad : ""),
    escapeCsvField(item.risk_score),
    escapeCsvField(getCategoryLabel(item.category)),
    escapeCsvField(item.trend_pp !== null ? item.trend_pp.toFixed(1) : ""),
    escapeCsvField(item.delta_vs_base_pp !== undefined && item.delta_vs_base_pp !== null ? item.delta_vs_base_pp.toFixed(1) : ""),
  ]);

  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
}
