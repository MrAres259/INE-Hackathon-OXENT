// MOCK DATA: Region details with series, features, drivers, scenarios, and recommendations
import type { RegionDetail, ScenarioId, Category, Driver, Recommendation, Feature, SeriesPoint } from "../types";
import { MOCK_STATES } from "./meta";
import { generateMockStates, generateMockMunicipalityItems, MOCK_MUN_TEMPLATES, getCategoryFromScore } from "./risk";

export function getMockRegionDetail(id: string, scenario: ScenarioId = "base"): RegionDetail {
  const isMun = id.length === 5;
  const ent = isMun ? id.substring(0, 2) : id;
  const stateMeta = MOCK_STATES.find((s) => s.id === ent) ?? { id: ent, name: `Estado ${ent}` };

  let baseItem;
  let parent = null;

  if (isMun) {
    const munItems = generateMockMunicipalityItems(ent, scenario);
    baseItem = munItems.find((m) => m.id === id);
    if (!baseItem) {
      // Create fallback item
      baseItem = {
        id,
        name: `Municipio ${id}`,
        level: "mun" as const,
        ent,
        lista_nominal: 85000,
        last_year: 2024,
        last_participation: 0.48,
        pred_participation: 0.51,
        pred_abstention: 0.49,
        pred_low: 0.45,
        pred_high: 0.53,
        trend_pp: -1.2,
        risk_score: 62,
        category: "naranja" as Category,
      };
    }
    parent = { id: ent, name: stateMeta.name };
  } else {
    const stateItems = generateMockStates(scenario);
    baseItem = stateItems.find((s) => s.id === id);
    if (!baseItem) {
      baseItem = {
        id,
        name: stateMeta.name,
        level: "state" as const,
        ent,
        lista_nominal: 2500000,
        last_year: 2024,
        last_participation: 0.52,
        pred_participation: 0.53,
        pred_abstention: 0.47,
        pred_low: 0.44,
        pred_high: 0.50,
        trend_pp: 0.2,
        risk_score: 45,
        category: "amarillo" as Category,
      };
    }
  }

  // 1. Series point history (DIP_FED: 2009, 2012, 2015, 2018, 2021, 2024)
  const basePart = baseItem.last_participation ?? 0.50;
  const trend = (baseItem.trend_pp ?? 0) / 100;
  const nominal = baseItem.lista_nominal ?? 100000;

  const series: SeriesPoint[] = [
    { year: 2009, election: "DIP_FED", participation: Math.max(0.3, Math.min(0.8, Math.round((basePart - trend * 5 - 0.08) * 1000) / 1000)), lista_nominal: Math.round(nominal * 0.72) },
    { year: 2012, election: "DIP_FED", participation: Math.max(0.3, Math.min(0.8, Math.round((basePart - trend * 4 + 0.09) * 1000) / 1000)), lista_nominal: Math.round(nominal * 0.78) }, // Presidencial bump
    { year: 2015, election: "DIP_FED", participation: Math.max(0.3, Math.min(0.8, Math.round((basePart - trend * 3 - 0.05) * 1000) / 1000)), lista_nominal: Math.round(nominal * 0.84) },
    { year: 2018, election: "DIP_FED", participation: Math.max(0.3, Math.min(0.8, Math.round((basePart - trend * 2 + 0.11) * 1000) / 1000)), lista_nominal: Math.round(nominal * 0.90) }, // Presidencial bump
    { year: 2021, election: "DIP_FED", participation: Math.max(0.3, Math.min(0.8, Math.round((basePart - trend * 1 - 0.03) * 1000) / 1000)), lista_nominal: Math.round(nominal * 0.95) },
    { year: 2024, election: "DIP_FED", participation: basePart, lista_nominal: nominal }, // Presidencial
  ];

  // 2. Sociodemographic features (INEGI Censo 2020 + CONAPO)
  const features: Feature[] = [
    { key: "pob_tot", label: "Población total", value: Math.round(nominal * 1.38), unit: "hab.", national_median: 48500 },
    { key: "pob_18ymas", label: "Población ≥ 18 años", value: nominal, unit: "hab.", national_median: 33400 },
    { key: "pct_18_24", label: "Jóvenes (18-24 años)", value: 0.174, unit: "proporción", national_median: 0.165 },
    { key: "pct_65ymas", label: "Adultos mayores (≥ 65 años)", value: 0.112, unit: "proporción", national_median: 0.108 },
    { key: "graproes", label: "Escolaridad promedio", value: 9.4, unit: "años", national_median: 9.7 },
    { key: "pct_hli", label: "Hablantes lengua indígena", value: isMun && (ent === "07" || ent === "20") ? 0.385 : 0.045, unit: "proporción", national_median: 0.058 },
    { key: "pct_sin_servsalud", label: "Sin servicios de salud", value: 0.285, unit: "proporción", national_median: 0.262 },
    { key: "pct_internet", label: "Viviendas con internet", value: 0.524, unit: "proporción", national_median: 0.521 },
    { key: "pct_rural", label: "Población rural (< 2500 hab)", value: isMun && (ent === "07" || ent === "20") ? 0.462 : 0.215, unit: "proporción", national_median: 0.231 },
    { key: "pct_analfabeta", label: "Población analfabeta", value: isMun && (ent === "07" || ent === "20") ? 0.125 : 0.042, unit: "proporción", national_median: 0.047 },
    { key: "pct_po2sm", label: "Ingresos ≤ 2 salarios mínimos", value: 0.612, unit: "proporción", national_median: 0.584 },
    { key: "im_2020", label: "Índice de marginación 2020", value: isMun && (ent === "07" || ent === "20") ? 0.45 : -0.12, unit: "índice", national_median: 0.0 },
  ];

  // 3. Risk drivers (contributions in pp)
  const drivers: Driver[] = [
    { key: "trend_pp", label: "Tendencia de desmovilización electoral", contribution_pp: 2.8, direction: "sube_abstencion" },
    { key: "pct_18_24", label: "Alta proporción de población joven (18-24)", contribution_pp: 2.1, direction: "sube_abstencion" },
    { key: "pct_rural", label: "Dispersión territorial y ruralidad", contribution_pp: 1.6, direction: "sube_abstencion" },
    { key: "graproes", label: "Grado de escolaridad en nivel básico", contribution_pp: -1.2, direction: "baja_abstencion" },
  ];

  // 4. Scenario comparisons
  const baseAbs = baseItem.pred_abstention ?? 0.48;
  const scenariosComparison = [
    { scenario: "base" as ScenarioId, pred_abstention: baseAbs, category: getCategoryFromScore(baseItem.risk_score) },
    { scenario: "intervencion" as ScenarioId, pred_abstention: Math.max(0.18, Math.round((baseAbs - 0.038) * 1000) / 1000), category: getCategoryFromScore(Math.max(10, (baseItem.risk_score ?? 50) - 18)) },
    { scenario: "pesimista" as ScenarioId, pred_abstention: Math.min(0.92, Math.round((baseAbs + 0.032) * 1000) / 1000), category: getCategoryFromScore(Math.min(99, (baseItem.risk_score ?? 50) + 14)) },
  ];

  // 5. Preventive recommendations
  const recommendations: Recommendation[] = [
    {
      id: "rec-1",
      title: "Campaña focalizada en universidades y centros de trabajo juveniles",
      rationale: "La zona presenta un 17.4% de población entre 18 y 24 años, segmento con una caída promedio de participación de 3.2 pp en elecciones intermedias.",
      priority: "alta",
      lever: "promocion_jovenes",
      source: "rules",
    },
    {
      id: "rec-2",
      title: "Optimización de rutas de transporte y casillas extraordinarias",
      rationale: "La dispersión rural del 46.2% incrementa el costo de traslado de votantes. Casillas más próximas mitigan hasta 2.5 pp de abstención.",
      priority: baseItem.risk_score && baseItem.risk_score >= 60 ? "alta" : "media",
      lever: "casillas_rurales",
      source: "rules",
    },
    {
      id: "rec-3",
      title: "Brigadas informativas en lenguas originarias y medios comunitarios",
      rationale: "Presencia significativa de hablantes de lengua indígena requiere información electoral bilingüe sobre cargos federales.",
      priority: ent === "07" || ent === "20" ? "alta" : "baja",
      lever: "materiales_lengua_indigena",
      source: "rules",
    },
    {
      id: "rec-4",
      title: "Alianzas con comercios locales y estímulos ciudadanos al voto",
      rationale: "Fomenta la corresponsabilidad cívica comunitaria en la jornada electoral intermedia sin sesgo partidista.",
      priority: "baja",
      lever: "campana_general",
      source: "llm",
    },
  ];

  return {
    ...baseItem,
    parent,
    series,
    features,
    drivers,
    scenarios: scenariosComparison,
    recommendations,
  };
}
