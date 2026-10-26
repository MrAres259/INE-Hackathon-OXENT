"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import type {
  ScenarioId,
  Level,
  RiskItem,
  RegionDetail,
  ScenarioResult,
  Meta,
  HealthResponse,
  MapMode,
} from "./types";
import {
  getHealth,
  getMeta,
  getRisk,
  getRegion,
  simulateScenario,
  subscribeMockStatus,
  isMockEnabled,
} from "./api";
import { defaultParamsFromMeta, paramsForScenario } from "./scenarioParams";

export type View3d = "inclinada" | "cenital";

export interface MapUrlState {
  mapMode: MapMode;
  extrude3d: boolean;
  view3d: View3d;
  scenario: ScenarioId;
}

export function parseMapUrlState(search: string): MapUrlState {
  const cleanSearch = search.startsWith("?") ? search.slice(1) : search;
  const sp = new URLSearchParams(cleanSearch);

  const mapa = sp.get("mapa");
  const mapMode: MapMode =
    mapa === "delta" || mapa === "compare" ? mapa : "semaforo";

  const d3 = sp.get("3d");
  const extrude3d = d3 === "1" || d3 === "true";

  const vista = sp.get("vista");
  const view3d: View3d = extrude3d && vista === "cenital" ? "cenital" : "inclinada";

  const esc = sp.get("escenario");
  const scenario: ScenarioId =
    esc === "intervencion" || esc === "pesimista" ? esc : "base";

  return {
    mapMode,
    extrude3d,
    view3d,
    scenario,
  };
}

export function serializeMapUrlState(
  state: Partial<MapUrlState>,
  existingSearch?: string
): string {
  const clean = existingSearch?.startsWith("?") ? existingSearch.slice(1) : existingSearch;
  const sp = new URLSearchParams(clean ?? "");

  if (state.mapMode && state.mapMode !== "semaforo") {
    sp.set("mapa", state.mapMode);
  } else {
    sp.delete("mapa");
  }

  if (state.extrude3d) {
    sp.set("3d", "1");
  } else {
    sp.delete("3d");
  }

  if (state.extrude3d && state.view3d === "cenital") {
    sp.set("vista", "cenital");
  } else {
    sp.delete("vista");
  }

  if (state.scenario && state.scenario !== "base") {
    sp.set("escenario", state.scenario);
  } else {
    sp.delete("escenario");
  }

  return sp.toString();
}

interface AtalayaContextValue {
  scenario: ScenarioId;
  setScenario: (s: ScenarioId) => void;
  scenarioParams: Record<string, number | string>;
  setScenarioParams: React.Dispatch<React.SetStateAction<Record<string, number | string>>>;
  level: Level;
  selectedEnt: string | null;
  selectedRegionId: string | null;
  selectedDetail: RegionDetail | null;
  loadingDetail: boolean;
  meta: Meta | null;
  riskItems: RiskItem[];
  loadingRisk: boolean;
  simulationResult: ScenarioResult | null;
  isMock: boolean;
  isScenarioModalOpen: boolean;
  setIsScenarioModalOpen: (open: boolean) => void;
  health: HealthResponse | null;
  apiAvailable: boolean;
  hasData: boolean;
  mapMode: MapMode;
  setMapMode: (m: MapMode) => void;
  extrude3d: boolean;
  setExtrude3d: (e: boolean) => void;
  view3d: View3d;
  setView3d: (v: View3d) => void;
  comparePos: number;
  setComparePos: (pos: number) => void;
  selectState: (ent: string) => void;
  selectMunicipality: (cvegeo: string) => void;
  selectRegion: (id: string | null) => void;
  resetToNational: () => void;
  runSimulation: (customParams?: Record<string, number | string>) => Promise<void>;
}

const AtalayaContext = createContext<AtalayaContextValue | null>(null);

export function AtalayaProvider({ children }: { children: React.ReactNode }) {
  const [scenario, setScenarioState] = useState<ScenarioId>("base");
  const [scenarioParams, setScenarioParams] = useState<Record<string, number | string>>({});
  const [level, setLevel] = useState<Level>("state");
  const [selectedEnt, setSelectedEnt] = useState<string | null>(null);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<RegionDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [riskItems, setRiskItems] = useState<RiskItem[]>([]);
  const [loadingRisk, setLoadingRisk] = useState(false);
  const [simulationResult, setSimulationResult] = useState<ScenarioResult | null>(null);
  const [isMock, setIsMock] = useState(isMockEnabled());
  const [isScenarioModalOpen, setIsScenarioModalOpen] = useState(false);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [apiAvailable, setApiAvailable] = useState<boolean>(true);
  const [hasData, setHasData] = useState<boolean>(true);
  const [mapMode, setMapMode] = useState<MapMode>("semaforo");
  const [extrude3d, setExtrude3d] = useState<boolean>(false);
  const [view3d, setView3d] = useState<View3d>("inclinada");
  const [comparePos, setComparePos] = useState<number>(50);
  const [isUrlInitialized, setIsUrlInitialized] = useState<boolean>(false);

  // Read initial map parameters from URL on client mount (avoids hydration mismatch)
  useEffect(() => {
    if (typeof window !== "undefined") {
      const parsed = parseMapUrlState(window.location.search);
      if (parsed.mapMode !== "semaforo") {
        setMapMode(parsed.mapMode);
      }
      if (parsed.extrude3d) {
        setExtrude3d(true);
      }
      if (parsed.view3d !== "inclinada") {
        setView3d(parsed.view3d);
      }
      if (parsed.scenario !== "base") {
        setScenarioState(parsed.scenario);
      }
      setIsUrlInitialized(true);
    }
  }, []);

  // Synchronize map & scenario params to URL without reloading
  useEffect(() => {
    if (!isUrlInitialized || typeof window === "undefined") return;
    const search = serializeMapUrlState(
      { mapMode, extrude3d, view3d, scenario },
      window.location.search
    );
    const newUrl = `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`;
    window.history.replaceState(null, "", newUrl);
  }, [mapMode, extrude3d, view3d, scenario, isUrlInitialized]);

  // Subscribe to mock state changes
  useEffect(() => {
    return subscribeMockStatus((mockActive) => {
      setIsMock(mockActive);
      if (mockActive) {
        setApiAvailable(false);
      }
    });
  }, []);

  // Health check on startup
  useEffect(() => {
    getHealth()
      .then((h) => {
        setHealth(h);
        const units = h?.data?.units_mun ?? 0;
        if (units === 0 && !isMockEnabled()) {
          setHasData(false);
        } else {
          setHasData(true);
        }
        setApiAvailable(!isMockEnabled());
      })
      .catch(() => {
        setApiAvailable(false);
        setHasData(true);
      });
  }, []);

  // Fetch Meta once
  useEffect(() => {
    getMeta().then((m) => {
      setMeta(m);
      if (m?.scenarios) {
        const defaults = defaultParamsFromMeta(m);
        setScenarioParams((prev) => {
          const next: Record<string, number | string> = { ...defaults };
          for (const [k, v] of Object.entries(prev)) {
            if (k in defaults) {
              next[k] = v;
            }
          }
          return next;
        });
      }
    });
  }, []);

  // Base scenario risk loader
  useEffect(() => {
    if (scenario !== "base") return;
    setLoadingRisk(true);
    getRisk(level, selectedEnt ?? undefined, "base")
      .then((res) => {
        setRiskItems(res.items);
      })
      .catch(() => {})
      .finally(() => setLoadingRisk(false));
  }, [scenario, level, selectedEnt]);

  // Non-base scenario: re-simulation with 400ms debounce
  useEffect(() => {
    if (scenario === "base") {
      setSimulationResult(null);
      return;
    }
    if (!meta) return;

    const timer = setTimeout(async () => {
      setLoadingRisk(true);
      try {
        const resolvedParams = paramsForScenario(scenario, scenarioParams, meta);
        const res = await simulateScenario({
          scenario,
          params: resolvedParams,
          level,
          ent: selectedEnt,
        });
        setSimulationResult(res);
        setRiskItems(res.items);
      } catch {
        // Handled in controls or fallback
      } finally {
        setLoadingRisk(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [scenario, scenarioParams, level, selectedEnt, meta]);

  // Load region detail whenever selectedRegionId or scenario changes
  useEffect(() => {
    if (!selectedRegionId) {
      setSelectedDetail(null);
      return;
    }
    setLoadingDetail(true);
    getRegion(selectedRegionId, scenario)
      .then((det) => setSelectedDetail(det))
      .catch(() => setSelectedDetail(null))
      .finally(() => setLoadingDetail(false));
  }, [selectedRegionId, scenario]);

  const selectState = useCallback((ent: string) => {
    setSelectedEnt(ent);
    setLevel("mun");
    setSelectedRegionId(ent);
  }, []);

  const selectMunicipality = useCallback((cvegeo: string) => {
    setSelectedRegionId(cvegeo);
  }, []);

  const selectRegion = useCallback(
    (id: string | null) => {
      if (!id) {
        setSelectedRegionId(null);
        setSelectedDetail(null);
        return;
      }
      setSelectedRegionId(id);
      if (id.length === 2) {
        setSelectedEnt(id);
        setLevel("mun");
      } else if (id.length === 5) {
        const ent = id.substring(0, 2);
        setSelectedEnt(ent);
        setLevel("mun");
      }
    },
    []
  );

  const resetToNational = useCallback(() => {
    setLevel("state");
    setSelectedEnt(null);
    setSelectedRegionId(null);
    setSelectedDetail(null);
  }, []);

  const setScenario = useCallback((s: ScenarioId) => {
    setScenarioState(s);
  }, []);

  const runSimulation = useCallback(
    async (customParams?: Record<string, number | string>) => {
      if (!meta) return;
      const p = customParams ?? scenarioParams;
      const resolved = paramsForScenario("intervencion", p, meta);
      const res = await simulateScenario({
        scenario: "intervencion",
        params: resolved,
        level,
        ent: selectedEnt,
      });
      setSimulationResult(res);
      setRiskItems(res.items);
      setScenarioState("intervencion");
    },
    [scenarioParams, level, selectedEnt, meta]
  );

  return (
    <AtalayaContext.Provider
      value={{
        scenario,
        setScenario,
        scenarioParams,
        setScenarioParams,
        level,
        selectedEnt,
        selectedRegionId,
        selectedDetail,
        loadingDetail,
        meta,
        riskItems,
        loadingRisk,
        simulationResult,
        isMock,
        isScenarioModalOpen,
        setIsScenarioModalOpen,
        health,
        apiAvailable,
        hasData,
        mapMode,
        setMapMode,
        extrude3d,
        setExtrude3d,
        view3d,
        setView3d,
        comparePos,
        setComparePos,
        selectState,
        selectMunicipality,
        selectRegion,
        resetToNational,
        runSimulation,
      }}
    >
      {children}
    </AtalayaContext.Provider>
  );
}

export function useAtalaya(): AtalayaContextValue {
  const ctx = useContext(AtalayaContext);
  if (!ctx) {
    throw new Error("useAtalaya must be used within an AtalayaProvider");
  }
  return ctx;
}
