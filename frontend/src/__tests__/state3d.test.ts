import { describe, it, expect } from "vitest";
import {
  parseMapUrlState,
  serializeMapUrlState,
  type MapUrlState,
} from "../lib/state";

describe("parseMapUrlState & serializeMapUrlState", () => {
  describe("parseMapUrlState defaults and basics", () => {
    it("parses empty string to default state", () => {
      const state = parseMapUrlState("");
      expect(state).toEqual({
        mapMode: "semaforo",
        extrude3d: false,
        view3d: "inclinada",
        scenario: "base",
      });
    });

    it("parses leading question mark cleanly", () => {
      const state = parseMapUrlState("?");
      expect(state).toEqual({
        mapMode: "semaforo",
        extrude3d: false,
        view3d: "inclinada",
        scenario: "base",
      });
    });

    it("parses 3d=1 with default view inclinada", () => {
      const state = parseMapUrlState("?3d=1");
      expect(state.extrude3d).toBe(true);
      expect(state.view3d).toBe("inclinada");
    });

    it("parses 3d=true as extrude3d=true", () => {
      const state = parseMapUrlState("3d=true");
      expect(state.extrude3d).toBe(true);
    });

    it("parses 3d=1 and vista=cenital", () => {
      const state = parseMapUrlState("?3d=1&vista=cenital");
      expect(state.extrude3d).toBe(true);
      expect(state.view3d).toBe("cenital");
    });

    it("parses map modes: delta and compare", () => {
      expect(parseMapUrlState("?mapa=delta").mapMode).toBe("delta");
      expect(parseMapUrlState("?mapa=compare").mapMode).toBe("compare");
      expect(parseMapUrlState("?mapa=semaforo").mapMode).toBe("semaforo");
    });

    it("parses scenarios: intervencion and pesimista", () => {
      expect(parseMapUrlState("?escenario=intervencion").scenario).toBe("intervencion");
      expect(parseMapUrlState("?escenario=pesimista").scenario).toBe("pesimista");
      expect(parseMapUrlState("?escenario=base").scenario).toBe("base");
    });
  });

  describe("vista sin 3d se ignora", () => {
    it("ignores vista=cenital when 3d is not specified", () => {
      const state = parseMapUrlState("?vista=cenital");
      expect(state.extrude3d).toBe(false);
      expect(state.view3d).toBe("inclinada");
    });

    it("ignores vista=cenital when 3d=0 or 3d=false", () => {
      const state0 = parseMapUrlState("?3d=0&vista=cenital");
      expect(state0.extrude3d).toBe(false);
      expect(state0.view3d).toBe("inclinada");

      const stateFalse = parseMapUrlState("?3d=false&vista=cenital");
      expect(stateFalse.extrude3d).toBe(false);
      expect(stateFalse.view3d).toBe("inclinada");
    });

    it("does not serialize vista when extrude3d is false even if view3d is cenital", () => {
      const qs = serializeMapUrlState({ extrude3d: false, view3d: "cenital" });
      const sp = new URLSearchParams(qs);
      expect(sp.has("3d")).toBe(false);
      expect(sp.has("vista")).toBe(false);
    });
  });

  describe("valores inválidos", () => {
    it("falls back to defaults on unknown map mode", () => {
      const state = parseMapUrlState("?mapa=desconocido");
      expect(state.mapMode).toBe("semaforo");
    });

    it("falls back to false for invalid 3d param", () => {
      const state = parseMapUrlState("?3d=yes");
      expect(state.extrude3d).toBe(false);
    });

    it("falls back to inclinada for unknown vista", () => {
      const state = parseMapUrlState("?3d=1&vista=isometrica");
      expect(state.extrude3d).toBe(true);
      expect(state.view3d).toBe("inclinada");
    });

    it("falls back to base scenario for unknown scenario", () => {
      const state = parseMapUrlState("?escenario=otro");
      expect(state.scenario).toBe("base");
    });

    it("handles corrupted or empty query gracefully", () => {
      const state = parseMapUrlState("?&&&&&&=");
      expect(state).toEqual({
        mapMode: "semaforo",
        extrude3d: false,
        view3d: "inclinada",
        scenario: "base",
      });
    });
  });

  describe("serializeMapUrlState & ida y vuelta (round-trip)", () => {
    it("serializes default state to empty string", () => {
      const defaults: MapUrlState = {
        mapMode: "semaforo",
        extrude3d: false,
        view3d: "inclinada",
        scenario: "base",
      };
      const serialized = serializeMapUrlState(defaults);
      expect(serialized).toBe("");
      expect(parseMapUrlState(serialized)).toEqual(defaults);
    });

    it("round-trips 3D cenital state", () => {
      const state: MapUrlState = {
        mapMode: "semaforo",
        extrude3d: true,
        view3d: "cenital",
        scenario: "base",
      };
      const qs = serializeMapUrlState(state);
      expect(qs).toBe("3d=1&vista=cenital");
      expect(parseMapUrlState(qs)).toEqual(state);
    });

    it("round-trips 3D inclinada state", () => {
      const state: MapUrlState = {
        mapMode: "semaforo",
        extrude3d: true,
        view3d: "inclinada",
        scenario: "base",
      };
      const qs = serializeMapUrlState(state);
      expect(qs).toBe("3d=1");
      expect(parseMapUrlState(qs)).toEqual(state);
    });

    it("round-trips complex state with delta and scenario", () => {
      const state: MapUrlState = {
        mapMode: "delta",
        extrude3d: true,
        view3d: "cenital",
        scenario: "intervencion",
      };
      const qs = serializeMapUrlState(state);
      expect(parseMapUrlState(qs)).toEqual(state);
    });

    it("round-trips compare mode", () => {
      const state: MapUrlState = {
        mapMode: "compare",
        extrude3d: false,
        view3d: "inclinada",
        scenario: "pesimista",
      };
      const qs = serializeMapUrlState(state);
      expect(parseMapUrlState(qs)).toEqual(state);
    });

    it("preserves non-map parameters when existingSearch is provided", () => {
      const qs = serializeMapUrlState(
        { extrude3d: true, view3d: "cenital" },
        "?custom=42&tab=resumen"
      );
      const sp = new URLSearchParams(qs);
      expect(sp.get("custom")).toBe("42");
      expect(sp.get("tab")).toBe("resumen");
      expect(sp.get("3d")).toBe("1");
      expect(sp.get("vista")).toBe("cenital");
    });

    it("deletes vista when switching from 3d to 2d with existingSearch", () => {
      const qs = serializeMapUrlState(
        { extrude3d: false, view3d: "cenital" },
        "?3d=1&vista=cenital"
      );
      const sp = new URLSearchParams(qs);
      expect(sp.has("3d")).toBe(false);
      expect(sp.has("vista")).toBe(false);
    });
  });
});
