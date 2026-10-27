import { describe, it, expect } from "vitest";
import {
  defaultParamsFromMeta,
  defaultsForScenario,
  leverDefaults,
  paramsForScenario,
  describeScenario,
  isScenarioModified,
  scenarioParamsKey,
} from "../lib/scenarioParams";
import { MOCK_META } from "../lib/mocks/meta";

describe("scenarioParams Pure Functions", () => {
  it("extracts defaults from mock meta with exact keys and coverage 100", () => {
    const defaults = defaultParamsFromMeta(MOCK_META);

    expect(defaults).toEqual({
      lever: "promocion_jovenes",
      targeting: "rojo_naranja",
      effect_pp: 3.0,
      coverage: 100,
      shock_pp: 2.0,
      trend_amplifier: 50,
    });
    expect(defaults.coverage).toBe(100);
    expect(defaults.effect_pp).toBe(3.0);
    expect(defaults.lever).toBe("promocion_jovenes");
    expect(defaults.targeting).toBe("rojo_naranja");
    expect(defaults.shock_pp).toBe(2.0);
    expect(defaults.trend_amplifier).toBe(50);
  });

  it("handles null meta safely in defaultParamsFromMeta", () => {
    expect(defaultParamsFromMeta(null)).toEqual({});
  });

  it("returns empty object for base scenario", () => {
    const baseParams = paramsForScenario("base", { lever: "casillas_rurales", effect_pp: 5 }, MOCK_META);
    expect(baseParams).toEqual({});
  });

  it("filters out extraneous keys and completes missing keys for intervencion", () => {
    const userParams = {
      lever: "casillas_rurales",
      shock_pp: 3.0, // extraneous key from pesimista
      unexpected_key: "foobar", // extraneous
    };

    const result = paramsForScenario("intervencion", userParams, MOCK_META);

    // Kept user param
    expect(result.lever).toBe("casillas_rurales");
    // Completed missing defaults
    expect(result.targeting).toBe("rojo_naranja");
    expect(result.effect_pp).toBe(3.0);
    expect(result.coverage).toBe(100);
    // Extraneous keys removed
    expect(result.shock_pp).toBeUndefined();
    expect(result.unexpected_key).toBeUndefined();
  });

  it("filters out extraneous keys and completes missing keys for pesimista", () => {
    const userParams = {
      shock_pp: 1.5,
      lever: "promocion_jovenes", // extraneous key from intervencion
    };

    const result = paramsForScenario("pesimista", userParams, MOCK_META);

    expect(result.shock_pp).toBe(1.5);
    expect(result.trend_amplifier).toBe(50);
    expect(result.lever).toBeUndefined();
  });

  it("returns empty object for paramsForScenario when meta is null", () => {
    expect(paramsForScenario("intervencion", { lever: "promocion_jovenes" }, null)).toEqual({});
    expect(paramsForScenario("base", {}, null)).toEqual({});
  });

  it("describes intervencion scenario with option labels and units", () => {
    // Default params
    const defaultDesc = describeScenario("intervencion", {}, MOCK_META);
    expect(defaultDesc).toBe(
      "Intervención: Promoción del voto joven · +3 pp · cobertura 100 % · Zonas rojas y naranjas"
    );

    // Custom params
    const customDesc = describeScenario(
      "intervencion",
      {
        lever: "materiales_lengua_indigena",
        effect_pp: 4.5,
        coverage: 75,
        targeting: "rojo",
      },
      MOCK_META
    );
    expect(customDesc).toBe(
      "Intervención: Materiales y capacitación en lenguas indígenas · +4.5 pp · cobertura 75 % · Solo zonas rojas"
    );
  });

  it("describes pesimista scenario with option labels and units", () => {
    // Default params
    const defaultDesc = describeScenario("pesimista", {}, MOCK_META);
    expect(defaultDesc).toBe("Pesimista: caída 2 pp · acentuación 50 %");

    // Custom params
    const customDesc = describeScenario(
      "pesimista",
      { shock_pp: 3.5, trend_amplifier: 80 },
      MOCK_META
    );
    expect(customDesc).toBe("Pesimista: caída 3.5 pp · acentuación 80 %");
  });

  it("describes scenarios gracefully when meta is null using defaults", () => {
    const descInterv = describeScenario("intervencion", {}, null);
    expect(descInterv).toBe(
      "Intervención: Promoción del voto joven · +3 pp · cobertura 100 % · Zonas rojas y naranjas"
    );

    const descPesim = describeScenario("pesimista", {}, null);
    expect(descPesim).toBe("Pesimista: caída 2 pp · acentuación 50 %");
  });

  it("extracts scenario-specific defaults using defaultsForScenario", () => {
    expect(defaultsForScenario("base", MOCK_META)).toEqual({});
    expect(defaultsForScenario("intervencion", MOCK_META)).toEqual({
      lever: "promocion_jovenes",
      targeting: "rojo_naranja",
      effect_pp: 3.0,
      coverage: 100,
    });
    expect(defaultsForScenario("pesimista", MOCK_META)).toEqual({
      shock_pp: 2.0,
      trend_amplifier: 50,
    });
  });

  it("produces deterministic canonical string keys with scenarioParamsKey", () => {
    expect(scenarioParamsKey({ b: "foo", a: 42 })).toBe("a:42|b:foo");
  });

  it("detects modification using isScenarioModified", () => {
    const intervDefaults = defaultsForScenario("intervencion", MOCK_META);
    expect(isScenarioModified("intervencion", intervDefaults, MOCK_META)).toBe(false);
    expect(isScenarioModified("intervencion", { ...intervDefaults, effect_pp: 5 }, MOCK_META)).toBe(true);
    expect(isScenarioModified("base", {}, MOCK_META)).toBe(false);
  });

  it("extracts lever defaults without lever key using leverDefaults", () => {
    expect(leverDefaults(MOCK_META)).toEqual({
      targeting: "rojo_naranja",
      effect_pp: 3.0,
      coverage: 100,
    });
    expect(leverDefaults(null)).toEqual({
      targeting: "rojo_naranja",
      effect_pp: 3.0,
      coverage: 100,
    });
  });
});
