import { describe, it, expect } from "vitest";
import {
  detectWebGL,
  featureTarget,
  levelOfFeature,
  createTileErrorTracker,
  fitPaddingWithInset,
} from "@/lib/mapSupport";

describe("mapSupport", () => {
  describe("detectWebGL", () => {
    it("returns ok: false, version: 0 when document is undefined or invalid", () => {
      expect(detectWebGL(undefined)).toEqual({ ok: false, version: 0 });
      const fakeDocWithoutCreate = {} as Document;
      expect(detectWebGL(fakeDocWithoutCreate)).toEqual({ ok: false, version: 0 });
    });

    it("returns ok: false, version: 0 when canvas fails to provide webgl context", () => {
      const mockDoc = {
        createElement: () => ({
          getContext: () => null,
        }),
      } as unknown as Document;

      expect(detectWebGL(mockDoc)).toEqual({ ok: false, version: 0 });
    });

    it("detects WebGL2 and returns ok: true, version: 2", () => {
      const mockDoc = {
        createElement: () => ({
          getContext: (type: string) => {
            if (type === "webgl2") return {};
            return null;
          },
        }),
      } as unknown as Document;

      expect(detectWebGL(mockDoc)).toEqual({ ok: true, version: 2 });
    });

    it("detects WebGL1 fallback and returns ok: true, version: 1", () => {
      const mockDoc = {
        createElement: () => ({
          getContext: (type: string) => {
            if (type === "webgl") return {};
            return null;
          },
        }),
      } as unknown as Document;

      expect(detectWebGL(mockDoc)).toEqual({ ok: true, version: 1 });
    });
  });

  describe("featureTarget", () => {
    it("returns atalaya source and sourceLayer in vector mode", () => {
      const stateTarget = featureTarget("vector", "state", "07");
      expect(stateTarget).toEqual({
        source: "atalaya",
        sourceLayer: "states",
        id: "07",
      });

      const munTarget = featureTarget("vector", "mun", "07101");
      expect(munTarget).toEqual({
        source: "atalaya",
        sourceLayer: "mun",
        id: "07101",
      });
    });

    it("returns separate source and no sourceLayer in geojson mode", () => {
      const stateTarget = featureTarget("geojson", "state", "07");
      expect(stateTarget).toEqual({
        source: "states",
        id: "07",
      });
      expect(stateTarget.sourceLayer).toBeUndefined();

      const munTarget = featureTarget("geojson", "mun", "07101");
      expect(munTarget).toEqual({
        source: "mun",
        id: "07101",
      });
      expect(munTarget.sourceLayer).toBeUndefined();
    });

    it("returns separate source and no sourceLayer in mock mode", () => {
      const stateTarget = featureTarget("mock", "state", "14");
      expect(stateTarget).toEqual({
        source: "states",
        id: "14",
      });
      expect(stateTarget.sourceLayer).toBeUndefined();

      const munTarget = featureTarget("mock", "mun", "14039");
      expect(munTarget).toEqual({
        source: "mun",
        id: "14039",
      });
      expect(munTarget.sourceLayer).toBeUndefined();
    });
  });

  describe("levelOfFeature", () => {
    it("resolves level from sourceLayer if present", () => {
      expect(levelOfFeature({ sourceLayer: "states" })).toBe("state");
      expect(levelOfFeature({ sourceLayer: "mun" })).toBe("mun");
    });

    it("resolves level from layer.id if sourceLayer is absent", () => {
      expect(levelOfFeature({ layer: { id: "states-fill" } })).toBe("state");
      expect(levelOfFeature({ layer: { id: "mun-line" } })).toBe("mun");
    });

    it("resolves level from 3D extrusion layer IDs", () => {
      expect(levelOfFeature({ layer: { id: "states-extrusion" } })).toBe("state");
      expect(levelOfFeature({ layer: { id: "mun-extrusion" } })).toBe("mun");
    });

    it("resolves level from source names", () => {
      expect(levelOfFeature({ source: "states" })).toBe("state");
      expect(levelOfFeature({ source: "mun" })).toBe("mun");
    });

    it("resolves level from id length if neither sourceLayer nor layer.id is informative", () => {
      expect(levelOfFeature({ id: "07" })).toBe("state");
      expect(levelOfFeature({ id: "07101" })).toBe("mun");
    });
  });

  describe("createTileErrorTracker", () => {
    it("does not hide on a single isolated error", () => {
      let currentTime = 1000;
      const tracker = createTileErrorTracker({
        threshold: 6,
        windowMs: 20000,
        now: () => currentTime,
      });

      const shouldHide = tracker.error("carto-base");
      expect(shouldHide).toBe(false);
      expect(tracker.hidden("carto-base")).toBe(false);
    });

    it("hides when reaching 6 errors within window without success", () => {
      let currentTime = 1000;
      const tracker = createTileErrorTracker({
        threshold: 6,
        windowMs: 20000,
        now: () => currentTime,
      });

      for (let i = 0; i < 5; i++) {
        currentTime += 500;
        expect(tracker.error("carto-base")).toBe(false);
        expect(tracker.hidden("carto-base")).toBe(false);
      }

      currentTime += 500; // 6th error
      const shouldHide = tracker.error("carto-base");
      expect(shouldHide).toBe(true);
      expect(tracker.hidden("carto-base")).toBe(true);
    });

    it("resets on success", () => {
      let currentTime = 1000;
      const tracker = createTileErrorTracker({
        threshold: 6,
        windowMs: 20000,
        now: () => currentTime,
      });

      for (let i = 0; i < 6; i++) {
        currentTime += 100;
        tracker.error("carto-base");
      }
      expect(tracker.hidden("carto-base")).toBe(true);

      // Successful load resets
      currentTime += 200;
      tracker.success("carto-base");
      expect(tracker.hidden("carto-base")).toBe(false);

      // Next error does not trigger hide
      currentTime += 100;
      expect(tracker.error("carto-base")).toBe(false);
      expect(tracker.hidden("carto-base")).toBe(false);
    });

    it("handles window expiration correctly", () => {
      let currentTime = 0;
      const tracker = createTileErrorTracker({
        threshold: 6,
        windowMs: 20000,
        now: () => currentTime,
      });

      // 5 errors at t = 0..4000
      for (let i = 0; i < 5; i++) {
        currentTime = i * 1000;
        tracker.error("carto-base");
      }
      expect(tracker.hidden("carto-base")).toBe(false);

      // Fast forward past the 20s window: t = 25000
      currentTime = 25000;
      // 6th error occurs after previous errors expired
      const shouldHide = tracker.error("carto-base");
      expect(shouldHide).toBe(false);
      expect(tracker.hidden("carto-base")).toBe(false);
    });
  });

  describe("fitPaddingWithInset", () => {
    it("calculates padding with extra bottom inset within bounds", () => {
      // containerHeight = 800, 60% = 480, base = 48, maxExtra = 432
      const padding = fitPaddingWithInset(48, 800, 200);
      expect(padding).toEqual({
        top: 48,
        right: 48,
        left: 48,
        bottom: 248,
      });
    });

    it("bounds extra padding to containerHeight * 0.6 - base", () => {
      // containerHeight = 500, 60% = 300, base = 48, maxExtra = 252
      const padding = fitPaddingWithInset(48, 500, 400);
      expect(padding).toEqual({
        top: 48,
        right: 48,
        left: 48,
        bottom: 300, // 48 + 252
      });
    });

    it("handles zero or negative extraBottom by setting extra to 0", () => {
      const pZero = fitPaddingWithInset(48, 800, 0);
      expect(pZero).toEqual({ top: 48, right: 48, left: 48, bottom: 48 });

      const pNeg = fitPaddingWithInset(48, 800, -100);
      expect(pNeg).toEqual({ top: 48, right: 48, left: 48, bottom: 48 });
    });

    it("handles non-numeric or NaN values by falling back to 0", () => {
      const pNaN = fitPaddingWithInset(48, 800, NaN as any);
      expect(pNaN).toEqual({ top: 48, right: 48, left: 48, bottom: 48 });

      const pUndef = fitPaddingWithInset(48, 800, undefined as any);
      expect(pUndef).toEqual({ top: 48, right: 48, left: 48, bottom: 48 });
    });

    it("handles small container height where containerHeight * 0.6 < base", () => {
      // 50 * 0.6 = 30, base = 48, maxExtra = max(0, 30 - 48) = 0
      const padding = fitPaddingWithInset(48, 50, 100);
      expect(padding).toEqual({ top: 48, right: 48, left: 48, bottom: 48 });
    });
  });
});

