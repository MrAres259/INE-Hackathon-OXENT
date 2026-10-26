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
    "targeting.rojo",
    "targeting.rojo_naranja",
    "targeting.todos",
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
    // Claves nuevas §8.1
    "ranking.orden",
    "ranking.csv",
    "detalle.serie",
    "detalle.componentes",
    "detalle.escenarios",
    "comparar.resumen",
    "buscador",
    "navegacion",
    "asistente.alcance",
    "guia",
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

  it("optionTerm covers all four levers and three targeting options", () => {
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

    const targetings = ["rojo", "rojo_naranja", "todos"];
    for (const targeting of targetings) {
      const term = optionTerm("targeting", targeting);
      expect(term, `optionTerm('targeting', '${targeting}') returned undefined`).toBe(
        `targeting.${targeting}` as GlossaryKey
      );
      expect(term && term in GLOSSARY).toBe(true);
    }
  });

  it("matches labels from scenarios.py for all params, levers, and targetings", () => {
    const SCENARIOS_PY_LABELS: Record<string, string> = {
      "param.lever": "Palanca de intervención",
      "lever.promocion_jovenes": "Promoción del voto joven",
      "lever.casillas_rurales": "Casillas y traslado en zonas rurales",
      "lever.materiales_lengua_indigena": "Materiales y capacitación en lenguas indígenas",
      "lever.campana_general": "Campaña general de promoción del voto",
      "param.targeting": "Focalización",
      "targeting.rojo": "Solo zonas rojas",
      "targeting.rojo_naranja": "Zonas rojas y naranjas",
      "targeting.todos": "Todo el país",
      "param.effect_pp": "Efecto máximo esperado",
      "param.coverage": "Cobertura de la intervención",
      "param.shock_pp": "Caída general de participación",
      "param.trend_amplifier": "Acentuación de tendencias negativas",
    };

    for (const [key, expectedTitle] of Object.entries(SCENARIOS_PY_LABELS)) {
      expect(key in GLOSSARY, `Key ${key} missing from GLOSSARY`).toBe(true);
      const entry = glossaryFor(key);
      expect(entry?.title, `Title mismatch for ${key}`).toBe(expectedTitle);
    }
  });

  it("contains all 10 new keys from CONTEXT.md §8.1 with valid length constraints", () => {
    const NEW_KEYS_W2_F = [
      "ranking.orden",
      "ranking.csv",
      "detalle.serie",
      "detalle.componentes",
      "detalle.escenarios",
      "comparar.resumen",
      "buscador",
      "navegacion",
      "asistente.alcance",
      "guia",
    ];

    for (const key of NEW_KEYS_W2_F) {
      expect(key in GLOSSARY, `Missing key ${key}`).toBe(true);
      const entry = glossaryFor(key);
      expect(entry?.title).toBeTruthy();
      expect(entry?.body.length).toBeGreaterThan(0);
      expect(entry?.body.length).toBeLessThanOrEqual(420);
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
