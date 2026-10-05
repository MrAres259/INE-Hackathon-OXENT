"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import type {
  ScenarioId,
  Level,
  RiskItem,
  RegionDetail,
  ScenarioResult,
  Meta,
} from "./types";
import { getMeta, getRisk, getRegion, simulateScenario, subscribeMockStatus, isMockEnabled } from "./api";

interface AtalayaContextValue {
  scenario: ScenarioId;
  setScenario: (s: ScenarioId) => void;
  scenarioParams: Record<string, number | string>;
  setScenarioParams: (p: Record<string, number | string>) => void;
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
  selectState: (ent: string) => void;
  selectMunicipality: (cvegeo: string) => void;
  selectRegion: (id: string | null) => void;
  resetToNational: () => void;
  runSimulation: (customParams?: Record<string, number | string>) => Promise<void>;
}

const AtalayaContext = createContext<AtalayaContextValue | null>(null);

export function AtalayaProvider({ children }: { children: React.ReactNode }) {
  const [scenario, setScenarioState] = useState<ScenarioId>("base");
  const [scenarioParams, setScenarioParams] = useState<Record<string, number | string>>({
    palanca: "promocion_jovenes",
    focalizacion: "rojo_naranja",
    effect_pp: 3.5,
    coverage: 0.8,
  });
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

  // Subscribe to mock state changes
  useEffect(() => {
    return subscribeMockStatus((mockActive) => {
      setIsMock(mockActive);
    });
  }, []);

  // Fetch Meta once
  useEffect(() => {
    getMeta().then((m) => {
      setMeta(m);
      if (m?.scenarios) {
        const intervencion = m.scenarios.find((s) => s.id === "intervencion");
        if (intervencion?.params) {
          const defaults: Record<string, number | string> = {};
          intervencion.params.forEach((p) => {
            defaults[p.key] = p.default;
          });
          setScenarioParams((prev) => ({ ...defaults, ...prev }));
        }
      }
    });
  }, []);

  // Load risk items whenever level, ent, or scenario changes
  const loadRisk = useCallback(async () => {
    setLoadingRisk(true);
    try {
      const res = await getRisk(level, selectedEnt ?? undefined, scenario);
      setRiskItems(res.items);
    } catch {
      // handled inside api.ts fallback
    } finally {
      setLoadingRisk(false);
    }
  }, [level, selectedEnt, scenario]);

  useEffect(() => {
    loadRisk();
  }, [loadRisk]);

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
    setSelectedRegionId(ent); // initially select the state itself in details
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
      const p = customParams ?? scenarioParams;
      const res = await simulateScenario({
        scenario: "intervencion",
        params: p,
        level,
        ent: selectedEnt,
      });
      setSimulationResult(res);
      setRiskItems(res.items);
      setScenarioState("intervencion");
    },
    [scenarioParams, level, selectedEnt]
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
