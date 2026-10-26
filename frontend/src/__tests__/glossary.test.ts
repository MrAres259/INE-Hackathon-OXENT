import { describe, it, expect } from "vitest";
import {
  GLOSSARY,
  glossaryFor,
  PARAM_TERM,
  optionTerm,
  type GlossaryKey,
} from "../lib/glossary";

describe("Glossary (Single Source of Truth)", () => {
  const EXPECTED_KEYS = [
    // Escenarios y parámetros
    "escenarios",
    "escenario.base",
    "escenario.intervencion",
    "escenario.pesimista",
    "param.lever",
    "lever.promocion_jovenes",
    "lever.casillas_rurales",
    "lever.materiales_lengua_indigena",
    "lever.campana_general",
    "param.targeting",
    "param.effect_pp",
    "param.coverage",
    "param.shock_pp",
    "param.trend_amplifier",
    "simulacion.votos",
    // Semáforo e indicadores
    "semaforo",
    "risk_score",
    "r_abs",
    "r_vuln",
    "r_trend",
    "r_vol",
    "pred_abstention",
    "intervalo",
    "abstencion_esperada",
    "prioridad",
    "lista_nominal",
    "pct_ln",
    "vulnerability_pp",
    "trend_pp",
    "volatility",
    "participacion",
    "ns_rate",
    "confiabilidad",
    "sin_dato",
    "factores",
    "recomendaciones",
    "ccpc.pct_ln_18_34",
    "ccpc.part_18_34",
    "ccpc.gap_youth_pp",
    "ccpc.gap_sexo_pp",
    "ccpc.pct_ln_rural",
    "perfil_edad_sexo",
    // Mapa y sistema
    "modo.semaforo",
    "modo.delta",
    "modo.comparar",
    "modo.3d",
    "motor",
    "asistente",
  ];

  it("contains all canonical keys from CONTEXT.md §5", () => {
    for (const key of EXPECTED_KEYS) {
      expect(key in GLOSSARY, `Missing expected key: ${key}`).toBe(true);
      const entry = glossaryFor(key);
      expect(entry, `glossaryFor('${key}') returned undefined`).toBeDefined();
      expect(entry?.title).toBeTruthy();
    }
  });

  it("ensures no glossary body is empty and none exceeds 420 characters", () => {
    for (const [key, entry] of Object.entries(GLOSSARY)) {
      expect(entry.body.trim().length, `Empty body for key ${key}`).toBeGreaterThan(0);
      expect(
        entry.body.length,
        `Body for key ${key} exceeds 420 chars (was ${entry.body.length})`
      ).toBeLessThanOrEqual(420);
    }
  });

  it("PARAM_TERM covers all standard scenario parameters", () => {
    const requiredParams = [
      "lever",
      "targeting",
      "effect_pp",
      "coverage",
      "shock_pp",
      "trend_amplifier",
    ];

    for (const param of requiredParams) {
      expect(PARAM_TERM[param], `PARAM_TERM missing ${param}`).toBeDefined();
      const termKey = PARAM_TERM[param];
      expect(termKey in GLOSSARY, `PARAM_TERM[${param}]='${termKey}' not in GLOSSARY`).toBe(true);
    }
  });

  it("optionTerm covers all four levers", () => {
    const levers = [
      "promocion_jovenes",
      "casillas_rurales",
      "materiales_lengua_indigena",
      "campana_general",
    ];

    for (const lever of levers) {
      const term = optionTerm("lever", lever);
      expect(term, `optionTerm('lever', '${lever}') returned undefined`).toBe(
        `lever.${lever}` as GlossaryKey
      );
      expect(term && term in GLOSSARY).toBe(true);
    }
  });

  it("includes semáforo cutoff numbers (75, 55, 35) in semaforo entry", () => {
    const semaforo = GLOSSARY["semaforo"];
    expect(semaforo).toBeDefined();
    expect(semaforo.body).toContain("75");
    expect(semaforo.body).toContain("55");
    expect(semaforo.body).toContain("35");
  });

  it("includes risk index component weights (50, 20, 15, 15) in risk_score entry", () => {
    const riskScore = GLOSSARY["risk_score"];
    expect(riskScore).toBeDefined();
    expect(riskScore.body).toContain("50");
    expect(riskScore.body).toContain("20");
    expect(riskScore.body).toContain("15");
  });
});
