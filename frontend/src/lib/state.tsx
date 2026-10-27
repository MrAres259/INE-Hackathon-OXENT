"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
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
import {
  defaultParamsFromMeta,
  defaultsForScenario,
  leverDefaults,
  paramsForScenario,
  describeScenario,
  scenarioParamsKey,
  isScenarioModified as isScenarioModifiedHelper,
} from "./scenarioParams";
import { formatSignedVotes } from "./format";
import { showToast } from "./toast";

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

export interface AtalayaContextValue {
  scenario: ScenarioId;
  setScenario: (s: ScenarioId) => void;
  scenarioParams: Record<string, number | string>;
  setScenarioParams: React.Dispatch<React.SetStateAction<Record<string, number | string>>>;
  paramsByScenario: {
    intervencion: Record<string, number | string>;
    pesimista: Record<string, number | string>;
  };
  leverParams: Record<string, Record<string, number | string>>;
  applyScenarioParams: (
    scenario: ScenarioId,
    params: Record<string, number | string>,
    options?: { showToast?: boolean }
  ) => Promise<ScenarioResult | undefined>;
  resetScenarioParams: (scenario: ScenarioId) => Promise<void>;
  isScenarioModified: (scenario: ScenarioId) => boolean;
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

export const AtalayaContext = createContext<AtalayaContextValue | null>(null);

export function AtalayaProvider({ children }: { children: React.ReactNode }) {
  const [scenario, setScenarioState] = useState<ScenarioId>("base");
  const [paramsByScenario, setParamsByScenario] = useState<{
    intervencion: Record<string, number | string>;
    pesimista: Record<string, number | string>;
  }>({
    intervencion: defaultsForScenario("intervencion", null),
    pesimista: defaultsForScenario("pesimista", null),
  });
  const [leverParams, setLeverParams] = useState<Record<string, Record<string, number | string>>>(() => {
    const defs = leverDefaults(null);
    return {
      promocion_jovenes: { ...defs },
    };
  });
  const [level, setLevel] = useState<Level>("state");
  const [selectedEnt, setSelectedEnt] = useState<string | null>(null);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<RegionDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [riskItems, setRiskItems] = useState<RiskItem[]>([]);
  const [loadingRisk, setLoadingRisk] = useState(false);

  interface StoredSimulation {
    scenario: ScenarioId;
    paramsKey: string;
    result: ScenarioResult;
  }
  const [storedSimulation, setStoredSimulation] = useState<StoredSimulation | null>(null);

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

  const simReqIdRef = useRef<number>(0);
  const baseReqIdRef = useRef<number>(0);

  const scenarioParams = useMemo(() => {
    if (scenario === "base") return {};
    return paramsByScenario[scenario] ?? {};
  }, [scenario, paramsByScenario]);

  const setScenarioParams = useCallback(
    (action: React.SetStateAction<Record<string, number | string>>) => {
      if (scenario === "base") return;
      setParamsByScenario((prev) => {
        const current = prev[scenario] ?? {};
        const next = typeof action === "function" ? action(current) : action;
        if (scenario === "intervencion") {
          const activeLever = String(next.lever || current.lever || "promocion_jovenes");
          const { lever: _l, ...leverFields } = next;
          setLeverParams((lp) => ({
            ...lp,
            [activeLever]: { ...(lp[activeLever] ?? {}), ...leverFields },
          }));
        }
        return {
          ...prev,
          [scenario]: next,
        };
      });
    },
    [scenario]
  );

  const simulationResult = useMemo<ScenarioResult | null>(() => {
    if (scenario === "base") return null;
    if (!storedSimulation) return null;
    if (storedSimulation.scenario !== scenario) return null;
    const currentResolved = paramsForScenario(scenario, paramsByScenario[scenario], meta);
    const currentKey = scenarioParamsKey(currentResolved);
    if (storedSimulation.paramsKey !== currentKey) return null;
    return storedSimulation.result;
  }, [scenario, storedSimulation, paramsByScenario, meta]);

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

  // Fetch Meta once and initialize scenario defaults
  useEffect(() => {
    getMeta().then((m) => {
      setMeta(m);
      if (m?.scenarios) {
        const defInterv = defaultsForScenario("intervencion", m);
        const defPesim = defaultsForScenario("pesimista", m);
        const lvrDefs = leverDefaults(m);
        const initialLever = String(defInterv.lever ?? "promocion_jovenes");
        setParamsByScenario((prev) => ({
          intervencion: { ...defInterv, ...prev.intervencion },
          pesimista: { ...defPesim, ...prev.pesimista },
        }));
        setLeverParams((prev) => ({
          [initialLever]: { ...lvrDefs, ...(prev[initialLever] ?? {}) },
          ...prev,
        }));
      }
    });
  }, []);

  // Base scenario risk loader
  useEffect(() => {
    if (scenario !== "base") return;
    const reqId = ++baseReqIdRef.current;
    setLoadingRisk(true);
    getRisk(level, selectedEnt ?? undefined, "base")
      .then((res) => {
        if (reqId === baseReqIdRef.current && scenario === "base") {
          setRiskItems(res.items);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (reqId === baseReqIdRef.current) {
          setLoadingRisk(false);
        }
      });
  }, [scenario, level, selectedEnt]);

  // Non-base scenario: re-simulation with 400ms debounce
  useEffect(() => {
    if (scenario === "base") {
      return;
    }
    if (!meta) return;

    const reqId = ++simReqIdRef.current;
    const currentParams = paramsByScenario[scenario];
    const resolvedParams = paramsForScenario(scenario, currentParams, meta);
    const pKey = scenarioParamsKey(resolvedParams);

    const timer = setTimeout(async () => {
      setLoadingRisk(true);
      try {
        const res = await simulateScenario({
          scenario,
          params: resolvedParams,
          level,
          ent: selectedEnt,
        });
        if (reqId === simReqIdRef.current) {
          setStoredSimulation({
            scenario,
            paramsKey: pKey,
            result: res,
          });
          setRiskItems(res.items);
        }
      } catch {
        // Handled in controls or fallback
      } finally {
        if (reqId === simReqIdRef.current) {
          setLoadingRisk(false);
        }
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [scenario, paramsByScenario, level, selectedEnt, meta]);

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
    simReqIdRef.current++;
    baseReqIdRef.current++;
    setScenarioState(s);
  }, []);

  const applyScenarioParams = useCallback(
    async (
      scenarioToApply: ScenarioId,
      newParams: Record<string, number | string>,
      options?: { showToast?: boolean }
    ) => {
      if (scenarioToApply === "base") return;
      if (!meta) return;

      const resolved = paramsForScenario(scenarioToApply, newParams, meta);
      const reqId = ++simReqIdRef.current;
      setLoadingRisk(true);

      try {
        const res = await simulateScenario({
          scenario: scenarioToApply,
          params: resolved,
          level,
          ent: selectedEnt,
        });

        const pKey = scenarioParamsKey(resolved);
        if (reqId === simReqIdRef.current) {
          setStoredSimulation({
            scenario: scenarioToApply,
            paramsKey: pKey,
            result: res,
          });
          setParamsByScenario((prev) => ({
            ...prev,
            [scenarioToApply]: resolved,
          }));
          if (scenarioToApply === "intervencion") {
            const activeLever = String(resolved.lever || "promocion_jovenes");
            const { lever: _l, ...leverFields } = resolved;
            setLeverParams((prev) => ({
              ...prev,
              [activeLever]: leverFields,
            }));
          }
          if (scenario === scenarioToApply) {
            setRiskItems(res.items);
          }
        }

        if (options?.showToast !== false) {
          const desc = describeScenario(
            scenarioToApply as Exclude<ScenarioId, "base">,
            resolved,
            meta
          );
          const votes = res.summary?.votos_adicionales;
          const votesStr =
            votes !== undefined && votes !== null
              ? `${formatSignedVotes(votes)} votos estimados`
              : undefined;
          const detail = votesStr ? `${desc} · ${votesStr}` : desc;
          showToast({
            kind: "success",
            title: "Escenario actualizado",
            detail,
          });
        }

        return res;
      } finally {
        if (reqId === simReqIdRef.current) {
          setLoadingRisk(false);
        }
      }
    },
    [meta, level, selectedEnt, scenario]
  );

  const resetScenarioParams = useCallback(
    async (scenarioToReset: ScenarioId) => {
      if (scenarioToReset === "base") return;
      const defaults = defaultsForScenario(scenarioToReset, meta);
      if (scenarioToReset === "intervencion") {
        const defLever = String(defaults.lever ?? "promocion_jovenes");
        const { lever: _l, ...defFields } = defaults;
        setLeverParams({ [defLever]: defFields });
      }
      await applyScenarioParams(scenarioToReset, defaults, { showToast: false });
      showToast({
        kind: "success",
        title: "Valores originales restablecidos",
        detail: describeScenario(
          scenarioToReset as Exclude<ScenarioId, "base">,
          defaults,
          meta
        ),
      });
    },
    [meta, applyScenarioParams]
  );

  const runSimulation = useCallback(
    async (customParams?: Record<string, number | string>) => {
      if (scenario === "base") return;
      const p = customParams ?? paramsByScenario[scenario];
      await applyScenarioParams(scenario, p);
    },
    [scenario, paramsByScenario, applyScenarioParams]
  );

  const isScenarioModified = useCallback(
    (sc: ScenarioId) => {
      if (sc === "base") return false;
      return isScenarioModifiedHelper(sc, paramsByScenario[sc], meta);
    },
    [paramsByScenario, meta]
  );

  return (
    <AtalayaContext.Provider
      value={{
        scenario,
        setScenario,
        scenarioParams,
        setScenarioParams,
        paramsByScenario,
        leverParams,
        applyScenarioParams,
        resetScenarioParams,
        isScenarioModified,
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
