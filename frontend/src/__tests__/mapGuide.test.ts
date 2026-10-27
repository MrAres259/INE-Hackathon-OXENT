import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  shouldShowGuide,
  dismissGuide,
  GUIDE_STORAGE_KEY,
  TOUR_STEPS,
  MapGuide,
  getValidStepAndRect,
} from "../components/map/MapGuide";

describe("MapGuide Pure Storage Logic (mapGuide.test.ts)", () => {
  it("exports the expected storage key 'atalaya.guide.v1'", () => {
    expect(GUIDE_STORAGE_KEY).toBe("atalaya.guide.v1");
  });

  describe("shouldShowGuide", () => {
    it("returns true when storage is empty (getItem returns null)", () => {
      const mockStorage: Pick<Storage, "getItem"> = {
        getItem: vi.fn((key: string) => {
          expect(key).toBe(GUIDE_STORAGE_KEY);
          return null;
        }),
      };
      expect(shouldShowGuide(mockStorage)).toBe(true);
      expect(mockStorage.getItem).toHaveBeenCalledWith(GUIDE_STORAGE_KEY);
    });

    it("returns true when storage has empty string", () => {
      const mockStorage: Pick<Storage, "getItem"> = {
        getItem: vi.fn(() => ""),
      };
      expect(shouldShowGuide(mockStorage)).toBe(true);
    });

    it("returns false when the key is already stored ('1')", () => {
      const mockStorage: Pick<Storage, "getItem"> = {
        getItem: vi.fn((key: string) => (key === GUIDE_STORAGE_KEY ? "1" : null)),
      };
      expect(shouldShowGuide(mockStorage)).toBe(false);
    });

    it("returns false when the key is already stored with any value ('true')", () => {
      const mockStorage: Pick<Storage, "getItem"> = {
        getItem: vi.fn(() => "true"),
      };
      expect(shouldShowGuide(mockStorage)).toBe(false);
    });

    it("returns false when getItem throws an exception (e.g. SecurityError or private browsing)", () => {
      const mockStorage: Pick<Storage, "getItem"> = {
        getItem: vi.fn(() => {
          throw new Error("SecurityError: localStorage is disabled");
        }),
      };
      expect(shouldShowGuide(mockStorage)).toBe(false);
    });

    it("returns false when storage is null", () => {
      expect(shouldShowGuide(null)).toBe(false);
    });

    it("returns false when storage is undefined", () => {
      expect(shouldShowGuide(undefined)).toBe(false);
    });
  });

  describe("dismissGuide", () => {
    it("writes '1' to GUIDE_STORAGE_KEY in storage", () => {
      const mockStorage: Pick<Storage, "setItem"> = {
        setItem: vi.fn(),
      };
      dismissGuide(mockStorage);
      expect(mockStorage.setItem).toHaveBeenCalledWith(GUIDE_STORAGE_KEY, "1");
    });

    it("catches and ignores exceptions if setItem throws (e.g. QuotaExceededError)", () => {
      const mockStorage: Pick<Storage, "setItem"> = {
        setItem: vi.fn(() => {
          throw new Error("QuotaExceededError");
        }),
      };
      expect(() => dismissGuide(mockStorage)).not.toThrow();
      expect(mockStorage.setItem).toHaveBeenCalledWith(GUIDE_STORAGE_KEY, "1");
    });

    it("safely handles null storage without throwing", () => {
      expect(() => dismissGuide(null)).not.toThrow();
    });

    it("safely handles being called with no arguments when window is undefined/mocked", () => {
      expect(() => dismissGuide()).not.toThrow();
    });
  });

  describe("TOUR_STEPS configuration", () => {
    it("defines 6 sequential tour steps matching required contract anchors", () => {
      expect(TOUR_STEPS).toHaveLength(6);
      const anchors = TOUR_STEPS.map((s) => s.sel);
      expect(anchors).toEqual([
        "escenario",
        "capas",
        "panel",
        "buscar",
        "herramientas",
        "leyenda",
      ]);
      TOUR_STEPS.forEach((step) => {
        expect(step.title).toBeTruthy();
        expect(step.text).toBeTruthy();
      });
    });
  });

  describe("DOM Anchor skipping logic (salta pasos sin ancla)", () => {
    const originalDocument = (globalThis as any).document;
    const originalWindow = (globalThis as any).window;

    afterEach(() => {
      (globalThis as any).document = originalDocument;
      (globalThis as any).window = originalWindow;
    });

    it("getValidStepAndRect salta pasos sin ancla o con ancho 0 y devuelve el primer ancla válida", () => {
      const mockElements: Record<string, any> = {
        '[data-tour="escenario"]': null, // missing
        '[data-tour="capas"]': {
          getBoundingClientRect: () => ({
            top: 10,
            bottom: 40,
            left: 10,
            right: 150,
            width: 0,
            height: 0,
          }), // zero width
        },
        '[data-tour="panel"]': {
          getBoundingClientRect: () => ({
            top: 50,
            bottom: 650,
            left: 600,
            right: 1000,
            width: 400,
            height: 600,
          }), // valid!
        },
      };

      const mockDoc = {
        querySelector: vi.fn((sel: string) => mockElements[sel] ?? null),
      };

      const match = getValidStepAndRect(0, mockDoc);
      expect(match).not.toBeNull();
      expect(match?.index).toBe(2); // index 2 is 'panel'
      expect(match?.rect.width).toBe(400);

      // Starting from panel index (2) should return panel
      const matchFromPanel = getValidStepAndRect(2, mockDoc);
      expect(matchFromPanel?.index).toBe(2);

      // Starting past panel (3) should return null because buscar, herramientas, leyenda are not in mockElements
      const matchPastPanel = getValidStepAndRect(3, mockDoc);
      expect(matchPastPanel).toBeNull();
    });

    it("salta pasos sin ancla o con ancho 0 en renderizado", () => {
      const mockStorage: Record<string, string> = {};
      const mockWindow = {
        innerWidth: 1024,
        innerHeight: 768,
        localStorage: {
          getItem: (k: string) => mockStorage[k] ?? null,
          setItem: (k: string, v: string) => {
            mockStorage[k] = v;
          },
        },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };

      const mockElements: Record<string, any> = {
        '[data-tour="escenario"]': null,
        '[data-tour="capas"]': {
          getBoundingClientRect: () => ({
            top: 10,
            bottom: 40,
            left: 10,
            right: 150,
            width: 0,
            height: 0,
          }),
        },
        '[data-tour="panel"]': {
          getBoundingClientRect: () => ({
            top: 50,
            bottom: 650,
            left: 600,
            right: 1000,
            width: 400,
            height: 600,
          }),
        },
      };

      (globalThis as any).window = mockWindow;
      (globalThis as any).document = {
        querySelector: vi.fn((sel: string) => mockElements[sel] ?? null),
      };

      const onClose = vi.fn();
      const html = renderToStaticMarkup(
        React.createElement(MapGuide, { open: true, onClose })
      );

      // Should have skipped 'escenario' and 'capas' and rendered step 3 (panel)
      expect(html).toContain("3 · Explora el detalle territorial");
      expect(html).not.toContain("1 · Elige un escenario");
      expect(html).not.toContain("2 · Cambia la vista del mapa");
    });

    it("no renderiza nada cuando no existe ninguna ancla en el DOM", () => {
      const mockWindow = {
        innerWidth: 1024,
        innerHeight: 768,
        localStorage: {
          getItem: () => null,
          setItem: () => {},
        },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };

      (globalThis as any).window = mockWindow;
      (globalThis as any).document = {
        querySelector: vi.fn(() => null), // All anchors missing
      };

      const onClose = vi.fn();
      const html = renderToStaticMarkup(
        React.createElement(MapGuide, { open: true, onClose })
      );

      // Since no anchors exist, nothing is rendered
      expect(html).toBe("");
    });

    it("no renderiza nada cuando open=false", () => {
      const html = renderToStaticMarkup(
        React.createElement(MapGuide, { open: false })
      );
      expect(html).toBe("");
    });
  });
});
