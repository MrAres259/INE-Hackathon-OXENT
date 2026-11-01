import { describe, it, expect } from "vitest";
import {
  TOURS,
  tourForPath,
  isGuideOpen,
  GUIDE_EVENTS,
  TourId,
} from "../lib/tours";

describe("Tours contract & helpers (tours.test.ts)", () => {
  describe("tourForPath", () => {
    it("returns correct tour for valid paths and query params", () => {
      expect(tourForPath("/")?.id).toBe("mapa");
      expect(tourForPath("/campanas")?.id).toBe("campanas");
      expect(tourForPath("/campanas/")?.id).toBe("campanas");
      expect(tourForPath("/campanas/resumen")?.id).toBe("campanas");
      expect(tourForPath("/monitor?x=1")?.id).toBe("monitor");
      expect(tourForPath("/monitor/?tab=rumores#section")?.id).toBe("monitor");
    });

    it("returns null for paths without tour, null, or undefined", () => {
      expect(tourForPath("/metodologia")).toBeNull();
      expect(tourForPath("/login")).toBeNull();
      expect(tourForPath("/otro")).toBeNull();
      expect(tourForPath(null)).toBeNull();
      expect(tourForPath(undefined)).toBeNull();
      expect(tourForPath("")).toBeNull();
    });
  });

  describe("unique storage keys", () => {
    it("ensures each tour has a unique storageKey", () => {
      const keys = Object.values(TOURS).map((t) => t.storageKey);
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(keys.length);
      expect(keys.length).toBe(3);
    });
  });

  describe("step count per tour", () => {
    it("ensures each tour has at least 5 steps", () => {
      for (const [id, tour] of Object.entries(TOURS)) {
        expect(
          tour.steps.length,
          `Tour "${id}" should have at least 5 steps`
        ).toBeGreaterThanOrEqual(5);
      }
    });
  });

  describe("forbidden terms check (plain Spanish rule)", () => {
    it("contains no jargon: 'pp', 'score', 'tooltip', 'percentil'", () => {
      const forbiddenRegex = /\b(pp|score|scores|tooltip|tooltips|percentil|percentiles)\b/i;

      for (const [id, tour] of Object.entries(TOURS)) {
        for (const step of tour.steps) {
          expect(step.title).not.toMatch(forbiddenRegex);
          expect(step.text).not.toMatch(forbiddenRegex);
        }
      }
    });
  });

  describe("map steps contract", () => {
    it("has the 8 selectors in the exact contract order", () => {
      const expectedSels = [
        "escenario",
        ["ajustar", "intervencion"],
        "capas",
        "panel",
        "buscar",
        "herramientas",
        "leyenda",
        "secciones",
      ];

      expect(TOURS.mapa.steps).toHaveLength(8);
      for (let i = 0; i < expectedSels.length; i++) {
        expect(TOURS.mapa.steps[i].sel).toEqual(expectedSels[i]);
      }
    });
  });

  describe("GUIDE_EVENTS", () => {
    it("defines the standard event names", () => {
      expect(GUIDE_EVENTS.open).toBe("atalaya:open-guide");
      expect(GUIDE_EVENTS.opened).toBe("atalaya:guide-open");
      expect(GUIDE_EVENTS.closed).toBe("atalaya:guide-close");
    });
  });

  describe("isGuideOpen", () => {
    it("returns false when document body does not have data-guide='open'", () => {
      const mockDoc = {
        body: {
          dataset: { guide: "closed" },
        },
      } as unknown as Document;
      expect(isGuideOpen(mockDoc)).toBe(false);
    });

    it("returns true when document body has data-guide='open'", () => {
      const mockDoc = {
        body: {
          dataset: { guide: "open" },
        },
      } as unknown as Document;
      expect(isGuideOpen(mockDoc)).toBe(true);
    });

    it("handles null or undefined safely", () => {
      expect(isGuideOpen(undefined)).toBe(false);
      expect(isGuideOpen({} as Document)).toBe(false);
    });
  });
});
