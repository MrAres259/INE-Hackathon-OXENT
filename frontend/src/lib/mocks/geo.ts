// MOCK DATA: Synthetic coarse GeoJSON for Mexican states and municipalities
import type { FeatureCollection, Polygon, Geometry } from "geojson";
import type { GeoIndexFile, GeoIndexItem, GeoIndexState, GeoIndexMun } from "../types";
import { toIndexItems } from "../geo";
import { MOCK_STATES } from "./meta";
import { MOCK_MUN_TEMPLATES } from "./risk";

export type { GeoIndexItem };

// Approximate centroids for the 32 Mexican states [lat, lon]
export const STATE_CENTROIDS: Record<string, [number, number]> = {
  "01": [21.88, -102.30], // Aguascalientes
  "02": [30.50, -115.10], // Baja California
  "03": [25.50, -111.70], // Baja California Sur
  "04": [19.00, -90.50],  // Campeche
  "05": [27.30, -101.80], // Coahuila
  "06": [19.10, -103.80], // Colima
  "07": [16.50, -92.50],  // Chiapas
  "08": [28.50, -106.00], // Chihuahua
  "09": [19.35, -99.14],  // Ciudad de México
  "10": [24.80, -104.90], // Durango
  "11": [21.00, -101.00], // Guanajuato
  "12": [17.60, -100.00], // Guerrero
  "13": [20.50, -98.90],  // Hidalgo
  "14": [20.60, -103.60], // Jalisco
  "15": [19.35, -99.70],  // Estado de México
  "16": [19.20, -101.90], // Michoacán
  "17": [18.75, -99.10],  // Morelos
  "18": [21.80, -104.90], // Nayarit
  "19": [25.60, -99.80],  // Nuevo León
  "20": [17.00, -96.50],  // Oaxaca
  "21": [19.00, -97.90],  // Puebla
  "22": [20.85, -99.85],  // Querétaro
  "23": [19.60, -87.90],  // Quintana Roo
  "24": [22.50, -100.50], // San Luis Potosí
  "25": [25.00, -107.50], // Sinaloa
  "26": [29.80, -110.80], // Sonora
  "27": [17.95, -92.60],  // Tabasco
  "28": [24.30, -98.60],  // Tamaulipas
  "29": [19.35, -98.20],  // Tlaxcala
  "30": [19.50, -96.70],  // Veracruz
  "31": [20.80, -89.00],  // Yucatán
  "32": [23.30, -102.80], // Zacatecas
};

// Generates an approximate polygon box given a center and half-extents
function createBoxPolygon(lat: number, lon: number, dLat: number, dLon: number): Polygon {
  return {
    type: "Polygon",
    coordinates: [
      [
        [lon - dLon, lat - dLat],
        [lon + dLon, lat - dLat],
        [lon + dLon, lat + dLat],
        [lon - dLon, lat + dLat],
        [lon - dLon, lat - dLat],
      ],
    ],
  };
}

export function getMockStatesGeoJson(): FeatureCollection<Geometry, { id: string; name: string }> {
  return {
    type: "FeatureCollection",
    features: MOCK_STATES.map((state) => {
      const centroid = STATE_CENTROIDS[state.id] ?? [23.0, -102.0];
      const isLarge = ["02", "05", "08", "26", "10", "32"].includes(state.id);
      const isTiny = ["09", "17", "29", "01"].includes(state.id);
      const dLat = isTiny ? 0.25 : isLarge ? 1.2 : 0.65;
      const dLon = isTiny ? 0.25 : isLarge ? 1.4 : 0.75;

      return {
        type: "Feature",
        id: state.id,
        properties: {
          id: state.id,
          name: state.name,
        },
        geometry: createBoxPolygon(centroid[0], centroid[1], dLat, dLon),
      };
    }),
  };
}

export function getMockMunGeoJson(
  ent: string
): FeatureCollection<Geometry, { id: string; ent: string; name: string }> {
  const centroid = STATE_CENTROIDS[ent] ?? [23.0, -102.0];
  const templates = MOCK_MUN_TEMPLATES[ent] ?? [];
  const count = Math.max(templates.length, 6);

  // Layout in rows x cols around the state centroid
  const cols = 3;
  const rows = Math.ceil(count / cols);
  const cellHeight = 0.35;
  const cellWidth = 0.45;
  const startLat = centroid[0] + ((rows - 1) * cellHeight) / 2;
  const startLon = centroid[1] - ((cols - 1) * cellWidth) / 2;

  const features = templates.map((m, idx) => {
    const r = Math.floor(idx / cols);
    const c = idx % cols;
    const lat = startLat - r * cellHeight;
    const lon = startLon + c * cellWidth;

    return {
      type: "Feature" as const,
      id: m.cvegeo,
      properties: {
        id: m.cvegeo,
        ent,
        name: m.name,
      },
      geometry: createBoxPolygon(lat, lon, cellHeight * 0.45, cellWidth * 0.45),
    };
  });

  return {
    type: "FeatureCollection",
    features,
  };
}

export function getMockGeoIndexFile(): GeoIndexFile {
  const states: Record<string, GeoIndexState> = {};
  for (const s of MOCK_STATES) {
    const [lat, lon] = STATE_CENTROIDS[s.id] ?? [23.0, -102.0];
    states[s.id] = {
      name: s.name,
      bbox: [lon - 0.8, lat - 0.8, lon + 0.8, lat + 0.8],
      centroid: [lon, lat],
    };
  }

  const mun: Record<string, GeoIndexMun> = {};
  for (const [ent, muns] of Object.entries(MOCK_MUN_TEMPLATES)) {
    const [stateLat, stateLon] = STATE_CENTROIDS[ent] ?? [23.0, -102.0];
    muns.forEach((m, idx) => {
      const r = Math.floor(idx / 3);
      const c = idx % 3;
      const lat = stateLat + 0.35 - r * 0.35;
      const lon = stateLon - 0.45 + c * 0.45;
      mun[m.cvegeo] = {
        name: m.name,
        ent,
        centroid: [lon, lat],
      };
    });
  }

  return {
    states,
    mun,
  };
}

export function getMockGeoIndex(): GeoIndexItem[] {
  return toIndexItems(getMockGeoIndexFile());
}
