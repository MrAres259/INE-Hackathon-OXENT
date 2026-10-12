"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { getRisk, simulateScenario } from "./api";
import { useAtalaya } from "./state";
import type { ScenarioId } from "./types";
import {
  type LevelIndex,
  type MapRiskData,
  indexItems,
  maxAbstencionEsperada,
  EMPTY_LEVEL_INDEX,
} from "./mapRisk";
import { paramsForScenario, describeScenario } from "./scenarioParams";

// Module-level cache for base scenario so multiple mounts (or React StrictMode) only trigger one fetch
let basePromise: Promise<LevelIndex> | null = null;
let cachedBase: LevelIndex | null = null;

function fetchBaseOnce(): Promise<LevelIndex> {
  if (cachedBase) {
    return Promise.resolve(cachedBase);
  }
  if (!basePromise) {
    const stateP = getRisk("state", undefined, "base");
    const munP = getRisk("mun", undefined, "base");

    basePromise = Promise.all([stateP, munP]).then(([stateRes, munRes]) => {
      cachedBase = {
        state: indexItems(stateRes.items),
        mun: indexItems(munRes.items),
      };
      return cachedBase;
    });
  }
  return basePromise;
}

export function useMapRisk(): MapRiskData {
  const { scenario, scenarioParams, mapMode, meta } = useAtalaya();

  const [base, setBase] = useState<LevelIndex>(cachedBase ?? EMPTY_LEVEL_INDEX);
  const [baseLoading, setBaseLoading] = useState<boolean>(!cachedBase);
  const [baseError, setBaseError] = useState<string | null>(null);

  const [alt, setAlt] = useState<LevelIndex | null>(null);
  const [altLoading, setAltLoading] = useState<boolean>(false);
  const [altError, setAltError] = useState<string | null>(null);

  const reqIdRef = useRef<number>(0);

  // Load base data once
  useEffect(() => {
    let mounted = true;
    if (cachedBase) {
      setBase(cachedBase);
      setBaseLoading(false);
      return;
    }

    setBaseLoading(true);
    fetchBaseOnce()
      .then((data) => {
        if (mounted) {
          setBase(data);
          setBaseLoading(false);
        }
      })
      .catch((err) => {
        if (mounted) {
          setBaseError(err instanceof Error ? err.message : "Error al cargar datos base");
          setBaseLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  const altScenario: Exclude<ScenarioId, "base"> = scenario === "base" ? "intervencion" : scenario;
  const needsAlt = scenario !== "base" || mapMode === "delta" || mapMode === "compare";
  const altLabel = describeScenario(altScenario, scenarioParams, meta);

  // Simulate alternate scenario with 400ms debounce
  useEffect(() => {
    if (!needsAlt) {
      setAlt(null);
      setAltLoading(false);
      setAltError(null);
      return;
    }

    if (!meta) {
      return;
    }

    setAltLoading(true);
    const reqId = ++reqIdRef.current;

    const timer = setTimeout(async () => {
      try {
        const resolvedParams = paramsForScenario(altScenario, scenarioParams, meta);
        const [stateSim, munSim] = await Promise.all([
          simulateScenario({
            scenario: altScenario,
            params: resolvedParams,
            level: "state",
            ent: null,
          }),
          simulateScenario({
            scenario: altScenario,
            params: resolvedParams,
            level: "mun",
            ent: null,
          }),
        ]);

        if (reqId === reqIdRef.current) {
          setAlt({
            state: indexItems(stateSim.items),
            mun: indexItems(munSim.items),
          });
          setAltLoading(false);
          setAltError(null);
        }
      } catch (err) {
        if (reqId === reqIdRef.current) {
          setAltError(err instanceof Error ? err.message : "Error al simular escenario");
          setAltLoading(false);
        }
      }
    }, 400);

    return () => {
      clearTimeout(timer);
    };
  }, [needsAlt, altScenario, scenarioParams, meta]);

  const active: LevelIndex = scenario === "base" ? base : (alt ?? base);

  const vmax = useMemo(
    () => ({
      state: maxAbstencionEsperada(base.state),
      mun: maxAbstencionEsperada(base.mun),
    }),
    [base]
  );

  return {
    base,
    alt,
    altScenario,
    altLabel,
    active,
    vmax,
    loading: baseLoading || altLoading,
    error: baseError ?? altError,
  };
}
