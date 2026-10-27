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
import { paramsForScenario, describeScenario, scenarioParamsKey } from "./scenarioParams";

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

interface StoredAlt {
  scenario: ScenarioId;
  paramsKey: string;
  data: LevelIndex;
}

export function useMapRisk(): MapRiskData {
  const { scenario, scenarioParams, mapMode, meta } = useAtalaya();

  const [base, setBase] = useState<LevelIndex>(cachedBase ?? EMPTY_LEVEL_INDEX);
  const [baseLoading, setBaseLoading] = useState<boolean>(!cachedBase);
  const [baseError, setBaseError] = useState<string | null>(null);

  const [storedAlt, setStoredAlt] = useState<StoredAlt | null>(null);
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

  const resolvedParams = useMemo(
    () => paramsForScenario(altScenario, scenarioParams, meta),
    [altScenario, scenarioParams, meta]
  );
  const currentParamsKey = useMemo(
    () => scenarioParamsKey(resolvedParams),
    [resolvedParams]
  );

  const isAltValid =
    storedAlt !== null &&
    storedAlt.scenario === altScenario &&
    storedAlt.paramsKey === currentParamsKey;

  const alt: LevelIndex | null = isAltValid ? storedAlt.data : null;

  // Simulate alternate scenario with 400ms debounce
  useEffect(() => {
    if (!needsAlt) {
      setStoredAlt(null);
      setAltLoading(false);
      setAltError(null);
      return;
    }

    if (!meta) {
      return;
    }

    setAltLoading(true);
    const reqId = ++reqIdRef.current;
    const targetScenario = altScenario;
    const targetKey = currentParamsKey;
    const targetParams = resolvedParams;

    const timer = setTimeout(async () => {
      try {
        const [stateSim, munSim] = await Promise.all([
          simulateScenario({
            scenario: targetScenario,
            params: targetParams,
            level: "state",
            ent: null,
          }),
          simulateScenario({
            scenario: targetScenario,
            params: targetParams,
            level: "mun",
            ent: null,
          }),
        ]);

        if (reqId === reqIdRef.current) {
          setStoredAlt({
            scenario: targetScenario,
            paramsKey: targetKey,
            data: {
              state: indexItems(stateSim.items),
              mun: indexItems(munSim.items),
            },
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
  }, [needsAlt, altScenario, currentParamsKey, resolvedParams, meta]);

  const active: LevelIndex = scenario === "base" ? base : (alt ?? base);

  const vmax = useMemo(
    () => ({
      state: maxAbstencionEsperada(base.state),
      mun: maxAbstencionEsperada(base.mun),
    }),
    [base]
  );

  const isCalculatingAlt = needsAlt && (!isAltValid || altLoading);

  return {
    base,
    alt,
    altScenario,
    altLabel,
    active,
    vmax,
    loading: baseLoading || isCalculatingAlt,
    error: baseError ?? altError,
  };
}
