import { describe, it, expect } from "vitest";
import {
  isItemInTab,
  countByTab,
  getMonitorKpis,
  filterNewsItems,
  INITIAL_MONITOR_FILTERS,
  type MonitorFilterState,
} from "../components/intel/monitor/monitorFilters";
import { MOCK_MONITOR } from "../lib/intel/mocks";
import type { NewsItem } from "../lib/intel/types";

describe("monitorFilters Suite (monitorFilters.test.ts)", () => {
  const items: NewsItem[] = MOCK_MONITOR.items;

  it("isItemInTab correctly partitions verdicts into verified news and rumors", () => {
    const itemVerdadera = items.find((i) => i.verdict === "verdadera")!;
    const itemEnganosa = items.find((i) => i.verdict === "enganosa")!;
    const itemFalsa = items.find((i) => i.verdict === "falsa")!;
    const itemSinVerificar = items.find((i) => i.verdict === "sin_verificar")!;

    expect(isItemInTab(itemVerdadera, "verificadas")).toBe(true);
    expect(isItemInTab(itemVerdadera, "rumores")).toBe(false);

    expect(isItemInTab(itemEnganosa, "verificadas")).toBe(true);
    expect(isItemInTab(itemEnganosa, "rumores")).toBe(false);

    expect(isItemInTab(itemFalsa, "rumores")).toBe(true);
    expect(isItemInTab(itemFalsa, "verificadas")).toBe(false);

    expect(isItemInTab(itemSinVerificar, "rumores")).toBe(true);
    expect(isItemInTab(itemSinVerificar, "verificadas")).toBe(false);
  });

  it("countByTab accurately counts verified vs rumors items", () => {
    const counts = countByTab(items);
    // In MOCK_MONITOR: 1 verdadera + 1 enganosa = 2 verificadas; 1 falsa + 1 sin_verificar = 2 rumores
    expect(counts.verificadas).toBe(2);
    expect(counts.rumores).toBe(2);
  });

  it("getMonitorKpis returns correct counts for all categories", () => {
    const kpis = getMonitorKpis(items);
    expect(kpis.total).toBe(4);
    expect(kpis.verdadera).toBe(1);
    expect(kpis.falsa).toBe(1);
    expect(kpis.enganosa).toBe(1);
    expect(kpis.sin_verificar).toBe(1);
    expect(kpis.critica).toBe(1);
    expect(kpis.pendientes).toBeGreaterThanOrEqual(1);
  });

  it("filters items by tab (verificadas vs rumores)", () => {
    const verificadas = filterNewsItems(items, {
      ...INITIAL_MONITOR_FILTERS,
      tab: "verificadas",
    });
    expect(verificadas.every((i) => i.verdict === "verdadera" || i.verdict === "enganosa")).toBe(true);
    expect(verificadas.length).toBe(2);

    const rumores = filterNewsItems(items, {
      ...INITIAL_MONITOR_FILTERS,
      tab: "rumores",
    });
    expect(rumores.every((i) => i.verdict === "falsa" || i.verdict === "sin_verificar")).toBe(true);
    expect(rumores.length).toBe(2);
  });

  it("filters items by verdict", () => {
    const res = filterNewsItems(items, {
      ...INITIAL_MONITOR_FILTERS,
      tab: "verificadas",
      verdict: "verdadera",
    });
    expect(res.length).toBe(1);
    expect(res[0].verdict).toBe("verdadera");
  });

  it("filters items by severity level", () => {
    const res = filterNewsItems(items, {
      ...INITIAL_MONITOR_FILTERS,
      tab: "rumores",
      severity: "critica",
    });
    expect(res.length).toBe(1);
    expect(res[0].severity.level).toBe("critica");
  });

  it("filters items by recommended action", () => {
    const res = filterNewsItems(items, {
      ...INITIAL_MONITOR_FILTERS,
      tab: "rumores",
      action: "desmentido_oficial",
    });
    expect(res.length).toBe(1);
    expect(res[0].remediation.action).toBe("desmentido_oficial");
  });

  it("filters items by registry state", () => {
    const res = filterNewsItems(items, {
      ...INITIAL_MONITOR_FILTERS,
      tab: "verificadas",
      registryState: "pendiente",
    });
    expect(res.length).toBeGreaterThanOrEqual(1);
    expect(res.every((i) => (i.status?.status ?? "pendiente") === "pendiente")).toBe(true);
  });

  it("filters items by topic", () => {
    const res = filterNewsItems(items, {
      ...INITIAL_MONITOR_FILTERS,
      tab: "verificadas",
      topic: "presupuesto_recortes",
    });
    expect(res.length).toBe(1);
    expect(res[0].topic).toBe("presupuesto_recortes");
  });

  it("filters items by text search query", () => {
    const res = filterNewsItems(items, {
      ...INITIAL_MONITOR_FILTERS,
      tab: "verificadas",
      searchQuery: "presupuestal",
    });
    expect(res.length).toBe(1);
    expect(res[0].headline.toLowerCase()).toContain("presupuestal");

    const none = filterNewsItems(items, {
      ...INITIAL_MONITOR_FILTERS,
      tab: "verificadas",
      searchQuery: "inexistente_xyz_123",
    });
    expect(none.length).toBe(0);
  });

  it("sorts items by severidad (highest score first)", () => {
    const sorted = filterNewsItems(items, {
      ...INITIAL_MONITOR_FILTERS,
      tab: "rumores",
      sortBy: "severidad",
    });
    expect(sorted.length).toBe(2);
    expect(sorted[0].severity.score).toBeGreaterThanOrEqual(sorted[1].severity.score);
  });

  it("sorts items by fecha (descending)", () => {
    const sorted = filterNewsItems(items, {
      ...INITIAL_MONITOR_FILTERS,
      tab: "verificadas",
      sortBy: "fecha",
    });
    expect(sorted.length).toBe(2);
    const time0 = new Date(sorted[0].published || sorted[0].first_seen).getTime();
    const time1 = new Date(sorted[1].published || sorted[1].first_seen).getTime();
    expect(time0).toBeGreaterThanOrEqual(time1);
  });

  it("sorts items by viralidad (descending)", () => {
    const sorted = filterNewsItems(items, {
      ...INITIAL_MONITOR_FILTERS,
      tab: "rumores",
      sortBy: "viralidad",
    });
    expect(sorted.length).toBe(2);
    const score0 = sorted[0].virality?.score ?? -1;
    const score1 = sorted[1].virality?.score ?? -1;
    expect(score0).toBeGreaterThanOrEqual(score1);
  });
});
