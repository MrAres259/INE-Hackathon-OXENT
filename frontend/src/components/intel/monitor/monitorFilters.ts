// ATALAYA Intel - Monitor filters and sorting utilities
import type {
  NewsItem,
  Verdict,
  SeverityLevel,
  ActionType,
  RegistryState,
  NewsTopic,
} from "@/lib/intel/types";

export type MonitorTab = "verificadas" | "rumores";
export type SortOption = "severidad" | "fecha" | "viralidad";

export interface MonitorFilterState {
  tab: MonitorTab;
  verdict: Verdict | "todos";
  severity: SeverityLevel | "todos";
  action: ActionType | "todos";
  registryState: RegistryState | "todos";
  topic: NewsTopic | "todos";
  searchQuery: string;
  sortBy: SortOption;
}

export const INITIAL_MONITOR_FILTERS: MonitorFilterState = {
  tab: "verificadas",
  verdict: "todos",
  severity: "todos",
  action: "todos",
  registryState: "todos",
  topic: "todos",
  searchQuery: "",
  sortBy: "severidad",
};

/**
 * Checks whether an item belongs to the selected tab.
 * "verificadas" tab includes "verdadera" and "enganosa".
 * "rumores" tab includes "falsa" and "sin_verificar".
 */
export function isItemInTab(item: NewsItem, tab: MonitorTab): boolean {
  if (tab === "verificadas") {
    return item.verdict === "verdadera" || item.verdict === "enganosa";
  }
  return item.verdict === "falsa" || item.verdict === "sin_verificar";
}

/**
 * Returns the count of items in each tab.
 */
export function countByTab(items: NewsItem[]): { verificadas: number; rumores: number } {
  let verificadas = 0;
  let rumores = 0;
  for (const it of items) {
    if (it.verdict === "verdadera" || it.verdict === "enganosa") {
      verificadas++;
    } else if (it.verdict === "falsa" || it.verdict === "sin_verificar") {
      rumores++;
    }
  }
  return { verificadas, rumores };
}

/**
 * Computes high-level monitor KPIs across all items.
 */
export function getMonitorKpis(items: NewsItem[]): {
  total: number;
  verdadera: number;
  falsa: number;
  enganosa: number;
  sin_verificar: number;
  critica: number;
  pendientes: number;
} {
  let verdadera = 0;
  let falsa = 0;
  let enganosa = 0;
  let sin_verificar = 0;
  let critica = 0;
  let pendientes = 0;

  for (const it of items) {
    if (it.verdict === "verdadera") verdadera++;
    else if (it.verdict === "falsa") falsa++;
    else if (it.verdict === "enganosa") enganosa++;
    else if (it.verdict === "sin_verificar") sin_verificar++;

    if (it.severity?.level === "critica") {
      critica++;
    }

    const st = it.status?.status ?? "pendiente";
    if (st === "pendiente") {
      pendientes++;
    }
  }

  return {
    total: items.length,
    verdadera,
    falsa,
    enganosa,
    sin_verificar,
    critica,
    pendientes,
  };
}

/**
 * Filters and sorts items based on user filter criteria.
 */
export function filterNewsItems(items: NewsItem[], filters: MonitorFilterState): NewsItem[] {
  return items
    .filter((item) => {
      // 1. Tab filter
      if (!isItemInTab(item, filters.tab)) {
        return false;
      }
      // 2. Verdict filter
      if (filters.verdict !== "todos" && item.verdict !== filters.verdict) {
        return false;
      }
      // 3. Severity filter
      if (filters.severity !== "todos" && item.severity?.level !== filters.severity) {
        return false;
      }
      // 4. Action filter
      if (filters.action !== "todos" && item.remediation?.action !== filters.action) {
        return false;
      }
      // 5. Registry state filter
      if (filters.registryState !== "todos") {
        const itemStatus = item.status?.status ?? "pendiente";
        if (itemStatus !== filters.registryState) {
          return false;
        }
      }
      // 6. Topic filter
      if (filters.topic !== "todos" && item.topic !== filters.topic) {
        return false;
      }
      // 7. Search query
      if (filters.searchQuery.trim().length > 0) {
        const q = filters.searchQuery.trim().toLowerCase();
        const matchesHeadline = item.headline?.toLowerCase().includes(q) ?? false;
        const matchesSummary = item.summary?.toLowerCase().includes(q) ?? false;
        const matchesClaim = item.claim?.toLowerCase().includes(q) ?? false;
        const matchesTopic = item.topic?.toLowerCase().includes(q) ?? false;
        if (!matchesHeadline && !matchesSummary && !matchesClaim && !matchesTopic) {
          return false;
        }
      }
      return true;
    })
    .sort((a, b) => {
      if (filters.sortBy === "severidad") {
        const scoreA = a.severity?.score ?? 0;
        const scoreB = b.severity?.score ?? 0;
        if (scoreB !== scoreA) return scoreB - scoreA;
        const dateA = new Date(a.published || a.first_seen || 0).getTime();
        const dateB = new Date(b.published || b.first_seen || 0).getTime();
        return dateB - dateA;
      }
      if (filters.sortBy === "fecha") {
        const dateA = new Date(a.published || a.first_seen || 0).getTime();
        const dateB = new Date(b.published || b.first_seen || 0).getTime();
        return dateB - dateA;
      }
      if (filters.sortBy === "viralidad") {
        const scoreA = a.virality?.score ?? -1;
        const scoreB = b.virality?.score ?? -1;
        if (scoreB !== scoreA) return scoreB - scoreA;
        return (b.severity?.score ?? 0) - (a.severity?.score ?? 0);
      }
      return 0;
    });
}
