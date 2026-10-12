import { describe, it, expect } from "vitest";
import {
  indexItems,
  categoryCounts,
  maxAbstencionEsperada,
  transitionSummary,
  EMPTY_LEVEL_INDEX,
} from "../lib/mapRisk";
import type { RiskItem } from "../lib/types";

function makeItem(
  id: string,
  category: RiskItem["category"],
  abstencion_esperada?: number | null
): RiskItem {
  return {
    id,
    name: `Unit ${id}`,
    level: "mun",
    ent: id.substring(0, 2),
    lista_nominal: 100_000,
    last_year: 2024,
    last_participation: 0.55,
    pred_participation: 0.55,
    pred_abstention: 0.45,
    pred_low: 0.4,
    pred_high: 0.5,
    trend_pp: 0,
    risk_score: 50,
    category,
    abstencion_esperada: abstencion_esperada ?? null,
  };
}

describe("mapRisk Pure Functions Tests", () => {
  it("indexes items by id into a Map", () => {
    const items: RiskItem[] = [
      makeItem("07101", "verde"),
      makeItem("07089", "rojo"),
    ];

    const idx = indexItems(items);
    expect(idx).toBeInstanceOf(Map);
    expect(idx.size).toBe(2);
    expect(idx.get("07101")?.name).toBe("Unit 07101");
    expect(idx.get("07089")?.category).toBe("rojo");
    expect(idx.get("99999")).toBeUndefined();

    const emptyIdx = indexItems([]);
    expect(emptyIdx.size).toBe(0);
  });

  it("calculates category counts across all categories", () => {
    const map = new Map<string, RiskItem>([
      ["1", makeItem("1", "verde")],
      ["2", makeItem("2", "verde")],
      ["3", makeItem("3", "amarillo")],
      ["4", makeItem("4", "naranja")],
      ["5", makeItem("5", "rojo")],
      ["6", makeItem("6", "sin_dato")],
    ]);

    const counts = categoryCounts(map);
    expect(counts).toEqual({
      verde: 2,
      amarillo: 1,
      naranja: 1,
      rojo: 1,
      sin_dato: 1,
    });

    const emptyCounts = categoryCounts(new Map());
    expect(emptyCounts).toEqual({
      verde: 0,
      amarillo: 0,
      naranja: 0,
      rojo: 0,
      sin_dato: 0,
    });
  });

  it("finds maxAbstencionEsperada across indexed units", () => {
    const map = new Map<string, RiskItem>([
      ["1", makeItem("1", "verde", 15_000)],
      ["2", makeItem("2", "rojo", 85_000)],
      ["3", makeItem("3", "naranja", null)],
      ["4", makeItem("4", "amarillo", 42_000)],
    ]);

    expect(maxAbstencionEsperada(map)).toBe(85_000);

    const emptyMap = new Map<string, RiskItem>();
    expect(maxAbstencionEsperada(emptyMap)).toBe(0);
  });

  it("evaluates transitionSummary correctly (rojo->naranja improves, naranja->rojo worsens)", () => {
    const base = new Map<string, RiskItem>([
      ["u1", makeItem("u1", "rojo", 50_000)],      // will improve to naranja
      ["u2", makeItem("u2", "naranja", 30_000)],   // will worsen to rojo
      ["u3", makeItem("u3", "amarillo", 20_000)],  // stays amarillo
      ["u4", makeItem("u4", "verde", 10_000)],     // stays verde
      ["u5", makeItem("u5", "rojo", 40_000)],      // stays rojo
    ]);

    const alt = new Map<string, RiskItem>([
      ["u1", makeItem("u1", "naranja", 45_000)],   // improved (rojo -> naranja)
      ["u2", makeItem("u2", "rojo", 35_000)],      // worsened (naranja -> rojo)
      ["u3", makeItem("u3", "amarillo", 20_000)],  // same
      ["u4", makeItem("u4", "verde", 10_000)],     // same
      ["u5", makeItem("u5", "rojo", 40_000)],      // same
    ]);

    const summary = transitionSummary(base, alt);

    expect(summary.improved).toBe(1); // u1
    expect(summary.worsened).toBe(1); // u2
    expect(summary.same).toBe(3);     // u3, u4, u5
    expect(summary.rojoBase).toBe(2); // u1, u5
    expect(summary.rojoAlt).toBe(2);  // u2, u5
  });

  it("exports EMPTY_LEVEL_INDEX constant", () => {
    expect(EMPTY_LEVEL_INDEX.state).toBeInstanceOf(Map);
    expect(EMPTY_LEVEL_INDEX.mun).toBeInstanceOf(Map);
    expect(EMPTY_LEVEL_INDEX.state.size).toBe(0);
    expect(EMPTY_LEVEL_INDEX.mun.size).toBe(0);
  });
});
