import type { RiskItem, Level, ScenarioId, Category, Campaign } from "../types";
import { MOCK_STATES } from "./meta";

// Helper to determine category from risk_score
export function getCategoryFromScore(score: number | null): Category {
  if (score === null || isNaN(score)) return "sin_dato";
  if (score >= 75) return "rojo";
  if (score >= 55) return "naranja";
  if (score >= 35) return "amarillo";
  return "verde";
}

// Deterministic pseudo-hash from string to float [0, 1)
function pseudoHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs((Math.sin(hash) * 10000) % 1);
}

export function generateMockStates(scenario: ScenarioId = "base", params?: Record<string, any>): RiskItem[] {
  return MOCK_STATES.map((state) => {
    const h = pseudoHash(state.id + "_state");
    // Historical participation DIP_FED ~ 0.42 to 0.64
    const lastPart = Math.round((0.44 + h * 0.20) * 1000) / 1000;
    const trend = Math.round((-2.5 + h * 4.0) * 10) / 10; // pp per election (-2.5 to +1.5)
    
    // Base predicted abstention
    let predAbs = Math.round((1 - lastPart - (trend / 100) * 0.5) * 1000) / 1000;
    predAbs = Math.max(0.25, Math.min(0.75, predAbs));

    let deltaVsBase: number | null = null;

    if (scenario === "intervencion") {
      const campaigns: Campaign[] = Array.isArray((params as any)?.campaigns) && (params as any).campaigns.length > 0
        ? (params as any).campaigns
        : [
            {
              lever: (params?.lever as string) ?? "promocion_jovenes",
              targeting: (params?.targeting as string) ?? "rojo_naranja",
              effect_pp: typeof params?.effect_pp === "number" ? params.effect_pp : 3.0,
              coverage: typeof params?.coverage === "number" ? params.coverage : 100,
              ents: Array.isArray((params as any)?.ents) ? (params as any).ents : [],
            },
          ];

      let prod = 1.0;
      let totalApplied = 0;
      for (const c of campaigns) {
        const targeting = c.targeting ?? "todos";
        const appliesScore =
          !params?.targeting ||
          targeting === "todos" ||
          (targeting === "rojo_naranja" && predAbs >= 0.30) ||
          (targeting === "rojo" && predAbs >= 0.45);
        const appliesEnt = !c.ents || c.ents.length === 0 || c.ents.includes(state.id);
        if (appliesScore && appliesEnt) {
          totalApplied++;
          const effectPp = typeof c.effect_pp === "number" ? c.effect_pp : 3.0;
          const coverage = typeof c.coverage === "number" ? c.coverage : 100;
          const deltaPp = effectPp * (coverage / 100);
          const delta = deltaPp / 100;
          const r = Math.min(delta / predAbs, 1);
          prod *= (1 - r);
        }
      }
      if (totalApplied > 0) {
        const newAbs = Math.max(0.02, predAbs * prod);
        const deltaPp = (predAbs - newAbs) * 100;
        deltaVsBase = -Math.round(deltaPp * 10) / 10;
        predAbs = Math.max(0.20, Math.round(newAbs * 1000) / 1000);
      } else {
        deltaVsBase = 0;
      }
    } else if (scenario === "pesimista") {
      const shockPp = typeof params?.shock_pp === "number" ? params.shock_pp : 2.0;
      const trendAmp = typeof params?.trend_amplifier === "number" ? params.trend_amplifier : 50;
      const deltaPp = shockPp + Math.abs(trend < 0 ? trend * (trendAmp / 100) : 0);
      deltaVsBase = Math.round(deltaPp * 10) / 10;
      predAbs = Math.min(0.85, Math.round((predAbs + deltaPp / 100) * 1000) / 1000);
    }

    const predPart = Math.round((1 - predAbs) * 1000) / 1000;
    const predLow = Math.max(0.1, Math.round((predAbs - 0.035) * 1000) / 1000);
    const predHigh = Math.min(0.9, Math.round((predAbs + 0.035) * 1000) / 1000);

    // Risk score 0..100
    let riskScore = Math.round(predAbs * 110 - trend * 4.5);
    riskScore = Math.max(10, Math.min(95, riskScore));
    if (scenario === "intervencion") {
      riskScore = Math.max(5, riskScore - 15);
    } else if (scenario === "pesimista") {
      riskScore = Math.min(99, riskScore + 12);
    }

    const category = getCategoryFromScore(riskScore);
    const listaNominal = Math.round((1200000 + h * 8000000) / 1000) * 1000;

    return {
      id: state.id,
      name: state.name,
      level: "state",
      ent: state.id,
      lista_nominal: listaNominal,
      last_year: 2024,
      last_participation: lastPart,
      pred_participation: predPart,
      pred_abstention: predAbs,
      pred_low: predLow,
      pred_high: predHigh,
      trend_pp: trend,
      risk_score: riskScore,
      category,
      delta_vs_base_pp: deltaVsBase,
      abstencion_esperada: Math.round(predAbs * listaNominal),
    };
  });
}

export interface MunTemplate {
  cvegeo: string;
  ent: string;
  name: string;
  baseRiskScore: number;
  lastPart: number;
  trend: number;
  lista: number;
}

export const MOCK_MUN_TEMPLATES: Record<string, MunTemplate[]> = {
  // 07 Chiapas
  "07": [
    { cvegeo: "07101", ent: "07", name: "Tuxtla Gutiérrez", baseRiskScore: 48, lastPart: 0.53, trend: -0.8, lista: 425000 },
    { cvegeo: "07089", ent: "07", name: "Tapachula", baseRiskScore: 58, lastPart: 0.49, trend: -1.4, lista: 255000 },
    { cvegeo: "07059", ent: "07", name: "Ocosingo", baseRiskScore: 78, lastPart: 0.41, trend: -3.2, lista: 145000 },
    { cvegeo: "07078", ent: "07", name: "San Cristóbal de Las Casas", baseRiskScore: 52, lastPart: 0.51, trend: -0.6, lista: 160000 },
    { cvegeo: "07019", ent: "07", name: "Comitán de Domínguez", baseRiskScore: 61, lastPart: 0.48, trend: -1.8, lista: 115000 },
    { cvegeo: "07065", ent: "07", name: "Palenque", baseRiskScore: 69, lastPart: 0.45, trend: -2.1, lista: 92000 },
    { cvegeo: "07108", ent: "07", name: "Villaflores", baseRiskScore: 44, lastPart: 0.55, trend: 0.4, lista: 78000 },
    { cvegeo: "07027", ent: "07", name: "Chiapa de Corzo", baseRiskScore: 42, lastPart: 0.56, trend: 0.2, lista: 73000 },
    { cvegeo: "07097", ent: "07", name: "Tonalá", baseRiskScore: 64, lastPart: 0.47, trend: -1.9, lista: 68000 },
    { cvegeo: "07017", ent: "07", name: "Cintalapa", baseRiskScore: 76, lastPart: 0.42, trend: -2.8, lista: 62000 },
  ],
  // 15 Estado de México
  "15": [
    { cvegeo: "15106", ent: "15", name: "Toluca", baseRiskScore: 41, lastPart: 0.58, trend: 0.3, lista: 680000 },
    { cvegeo: "15033", ent: "15", name: "Ecatepec de Morelos", baseRiskScore: 71, lastPart: 0.46, trend: -2.2, lista: 1280000 },
    { cvegeo: "15057", ent: "15", name: "Naucalpan de Juárez", baseRiskScore: 49, lastPart: 0.54, trend: -0.5, lista: 650000 },
    { cvegeo: "15058", ent: "15", name: "Nezahualcóyotl", baseRiskScore: 66, lastPart: 0.48, trend: -1.7, lista: 890000 },
    { cvegeo: "15104", ent: "15", name: "Tlalnepantla de Baz", baseRiskScore: 46, lastPart: 0.55, trend: 0.1, lista: 540000 },
    { cvegeo: "15031", ent: "15", name: "Chimalhuacán", baseRiskScore: 79, lastPart: 0.42, trend: -2.7, lista: 520000 },
    { cvegeo: "15024", ent: "15", name: "Cuautitlán Izcalli", baseRiskScore: 39, lastPart: 0.59, trend: 0.8, lista: 410000 },
    { cvegeo: "15054", ent: "15", name: "Metepec", baseRiskScore: 28, lastPart: 0.66, trend: 1.2, lista: 195000 },
    { cvegeo: "15099", ent: "15", name: "Texcoco", baseRiskScore: 54, lastPart: 0.52, trend: -0.9, lista: 185000 },
    { cvegeo: "15037", ent: "15", name: "Huixquilucan", baseRiskScore: 32, lastPart: 0.63, trend: 0.6, lista: 210000 },
  ],
  // 20 Oaxaca
  "20": [
    { cvegeo: "20067", ent: "20", name: "Oaxaca de Juárez", baseRiskScore: 36, lastPart: 0.61, trend: 0.5, lista: 215000 },
    { cvegeo: "20184", ent: "20", name: "San Juan Bautista Tuxtepec", baseRiskScore: 57, lastPart: 0.50, trend: -1.2, lista: 125000 },
    { cvegeo: "20079", ent: "20", name: "Salina Cruz", baseRiskScore: 62, lastPart: 0.48, trend: -1.8, lista: 65000 },
    { cvegeo: "20043", ent: "20", name: "Heroica Ciudad de Juchitán de Zaragoza", baseRiskScore: 77, lastPart: 0.43, trend: -2.9, lista: 78000 },
    { cvegeo: "20385", ent: "20", name: "Santa Cruz Xoxocotlán", baseRiskScore: 49, lastPart: 0.53, trend: -0.4, lista: 68000 },
    { cvegeo: "20039", ent: "20", name: "Heroica Ciudad de Huajuapan de León", baseRiskScore: 43, lastPart: 0.56, trend: 0.2, lista: 55000 },
    { cvegeo: "20399", ent: "20", name: "Santa Lucía del Camino", baseRiskScore: 47, lastPart: 0.54, trend: -0.1, lista: 42000 },
    { cvegeo: "20515", ent: "20", name: "Santo Domingo Tehuantepec", baseRiskScore: 68, lastPart: 0.46, trend: -2.1, lista: 51000 },
    { cvegeo: "20318", ent: "20", name: "San Pedro Mixtepec", baseRiskScore: 73, lastPart: 0.44, trend: -2.5, lista: 38000 },
    { cvegeo: "20054", ent: "20", name: "Miahuatlán de Porfirio Díaz", baseRiskScore: 82, lastPart: 0.39, trend: -3.5, lista: 34000 },
  ],
};

export function getMunTemplatesForState(ent: string): MunTemplate[] {
  if (MOCK_MUN_TEMPLATES[ent]) {
    return MOCK_MUN_TEMPLATES[ent];
  }
  return [
    { cvegeo: `${ent}001`, ent, name: `Municipio Capital (${ent})`, baseRiskScore: 45, lastPart: 0.55, trend: -0.5, lista: 300000 },
    { cvegeo: `${ent}002`, ent, name: `Municipio Norte (${ent})`, baseRiskScore: 68, lastPart: 0.46, trend: -2.0, lista: 120000 },
    { cvegeo: `${ent}003`, ent, name: `Municipio Sur (${ent})`, baseRiskScore: 79, lastPart: 0.41, trend: -3.1, lista: 85000 },
    { cvegeo: `${ent}004`, ent, name: `Municipio Oriente (${ent})`, baseRiskScore: 54, lastPart: 0.51, trend: -1.0, lista: 95000 },
    { cvegeo: `${ent}005`, ent, name: `Municipio Poniente (${ent})`, baseRiskScore: 33, lastPart: 0.62, trend: 0.7, lista: 140000 },
  ];
}

export function generateMockMunicipalityItems(
  ent?: string,
  scenario: ScenarioId = "base",
  params?: Record<string, any>
): RiskItem[] {
  if (!ent) {
    const all: RiskItem[] = [];
    for (const state of MOCK_STATES) {
      all.push(...generateMockMunicipalityItems(state.id, scenario, params));
    }
    return all;
  }

  const templates = getMunTemplatesForState(ent);

  return templates.map((m) => {
    let riskScore = m.baseRiskScore;
    let predAbs = Math.round((1 - m.lastPart - (m.trend / 100) * 0.5) * 1000) / 1000;
    predAbs = Math.max(0.20, Math.min(0.85, predAbs));

    let deltaVsBase: number | null = null;

    if (scenario === "intervencion") {
      const campaigns: Campaign[] = Array.isArray((params as any)?.campaigns) && (params as any).campaigns.length > 0
        ? (params as any).campaigns
        : [
            {
              lever: (params?.lever as string) ?? "promocion_jovenes",
              targeting: (params?.targeting as string) ?? "rojo_naranja",
              effect_pp: typeof params?.effect_pp === "number" ? params.effect_pp : 3.0,
              coverage: typeof params?.coverage === "number" ? params.coverage : 100,
              ents: Array.isArray((params as any)?.ents) ? (params as any).ents : [],
            },
          ];

      let prod = 1.0;
      let totalApplied = 0;
      for (const c of campaigns) {
        const targeting = c.targeting ?? "rojo_naranja";
        const applies =
          targeting === "todos" ||
          (targeting === "rojo_naranja" && m.baseRiskScore >= 55) ||
          (targeting === "rojo" && m.baseRiskScore >= 75);
        const appliesEnt = !c.ents || c.ents.length === 0 || c.ents.includes(m.ent);

        if (applies && appliesEnt) {
          totalApplied++;
          const effectPp = typeof c.effect_pp === "number" ? c.effect_pp : 3.0;
          const coverage = typeof c.coverage === "number" ? c.coverage : 100;
          const lever = c.lever ?? "promocion_jovenes";
          let peso = 1.0;
          if (lever === "casillas_rurales") {
            peso = m.cvegeo.endsWith("3") || m.cvegeo.endsWith("0") ? 1.2 : 0.85;
          } else if (lever === "materiales_lengua_indigena") {
            peso = m.ent === "07" || m.ent === "20" ? 1.25 : 0.75;
          } else if (lever === "promocion_jovenes") {
            peso = m.cvegeo.endsWith("1") || m.cvegeo.endsWith("6") ? 1.15 : 0.9;
          }
          const deltaPp = effectPp * (coverage / 100) * peso;
          const delta = deltaPp / 100;
          const r = Math.min(delta / predAbs, 1);
          prod *= (1 - r);
        }
      }

      if (totalApplied > 0) {
        const newAbs = Math.max(0.02, predAbs * prod);
        const deltaPp = (predAbs - newAbs) * 100;
        deltaVsBase = -Math.round(deltaPp * 10) / 10;
        predAbs = Math.max(0.18, Math.round(newAbs * 1000) / 1000);
        riskScore = Math.max(10, riskScore - 18);
      } else {
        deltaVsBase = 0;
      }
    } else if (scenario === "pesimista") {
      const shockPp = typeof params?.shock_pp === "number" ? params.shock_pp : 2.0;
      const trendAmp = typeof params?.trend_amplifier === "number" ? params.trend_amplifier : 50;
      const deltaPp = shockPp + Math.abs(m.trend < 0 ? m.trend * (trendAmp / 100) : 0);
      deltaVsBase = Math.round(deltaPp * 10) / 10;
      predAbs = Math.min(0.90, Math.round((predAbs + deltaPp / 100) * 1000) / 1000);
      riskScore = Math.min(99, riskScore + 14);
    }

    const predPart = Math.round((1 - predAbs) * 1000) / 1000;
    const predLow = Math.max(0.1, Math.round((predAbs - 0.04) * 1000) / 1000);
    const predHigh = Math.min(0.95, Math.round((predAbs + 0.04) * 1000) / 1000);
    const category = getCategoryFromScore(riskScore);

    return {
      id: m.cvegeo,
      name: m.name,
      level: "mun",
      ent: m.ent,
      lista_nominal: m.lista,
      last_year: 2024,
      last_participation: m.lastPart,
      pred_participation: predPart,
      pred_abstention: predAbs,
      pred_low: predLow,
      pred_high: predHigh,
      trend_pp: m.trend,
      risk_score: riskScore,
      category,
      delta_vs_base_pp: deltaVsBase,
      abstencion_esperada: Math.round(predAbs * m.lista),
    };
  });
}
