// Formatting utilities for percentages, points, numbers, categories, and CSV generation
import type { Category, RiskItem } from "./types";

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
    escapeCsvField(item.risk_score),
    escapeCsvField(getCategoryLabel(item.category)),
    escapeCsvField(item.trend_pp !== null ? item.trend_pp.toFixed(1) : ""),
    escapeCsvField(item.delta_vs_base_pp !== undefined && item.delta_vs_base_pp !== null ? item.delta_vs_base_pp.toFixed(1) : ""),
  ]);

  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
}
