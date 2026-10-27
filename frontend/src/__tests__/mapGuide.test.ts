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
  placeBalloon,
  getSafeTop,
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

    it("con dos anclas iguales (una oculta), el paso usa la visible", () => {
      const hiddenAnchor = {
        style: { display: "none" },
        getBoundingClientRect: () => ({
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          width: 0,
          height: 0,
        }),
      };
      const visibleAnchor = {
        style: { display: "block" },
        getBoundingClientRect: () => ({
          top: 12,
          left: 120,
          right: 280,
          bottom: 44,
          width: 160,
          height: 32,
        }),
      };

      const mockDoc = {
        querySelectorAll: vi.fn((sel: string) => {
          if (sel === '[data-tour="escenario"]') {
            return [hiddenAnchor, visibleAnchor];
          }
          return [];
        }),
        querySelector: vi.fn((sel: string) => {
          if (sel === '[data-tour="escenario"]') {
            return hiddenAnchor;
          }
          return null;
        }),
      };

      const match = getValidStepAndRect(0, mockDoc);
      expect(match).not.toBeNull();
      expect(match?.index).toBe(0); // 'escenario' is step 0
      expect(match?.rect.width).toBe(160);
      expect(match?.rect.left).toBe(120);
    });

    it("aplica position fixed y z-index 70 en el anillo y el globo", () => {
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

      const visibleAnchor = {
        style: { display: "inline-flex" },
        getBoundingClientRect: () => ({
          top: 10,
          bottom: 40,
          left: 10,
          right: 150,
          width: 140,
          height: 30,
        }),
      };

      (globalThis as any).window = mockWindow;
      (globalThis as any).document = {
        querySelectorAll: vi.fn((sel: string) => {
          if (sel === '[data-tour="escenario"]') return [visibleAnchor];
          return [];
        }),
        querySelector: vi.fn((sel: string) => {
          if (sel === '[data-tour="escenario"]') return visibleAnchor;
          return null;
        }),
      };

      const html = renderToStaticMarkup(
        React.createElement(MapGuide, { open: true })
      );

      // Verify both spotlight ring and balloon have z-[70] and z-index: 70
      expect(html).toContain("z-[70]");
      expect(html).toContain("z-index:70");
      expect(html).toContain("position:fixed");
    });

    it("coloca el globo arriba cuando el ancla está en la mitad inferior de la pantalla", () => {
      const mockWindow = {
        innerWidth: 1024,
        innerHeight: 768, // Half is 384
        localStorage: {
          getItem: () => null,
          setItem: () => {},
        },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };

      // Anchor located near bottom: top: 600, height: 40 (center: 620 > 384)
      const bottomAnchor = {
        style: { display: "block" },
        getBoundingClientRect: () => ({
          top: 600,
          bottom: 640,
          left: 200,
          right: 350,
          width: 150,
          height: 40,
        }),
      };

      (globalThis as any).window = mockWindow;
      (globalThis as any).document = {
        querySelectorAll: vi.fn((sel: string) => {
          if (sel === '[data-tour="escenario"]') return [bottomAnchor];
          return [];
        }),
        querySelector: vi.fn((sel: string) => {
          if (sel === '[data-tour="escenario"]') return bottomAnchor;
          return null;
        }),
      };

      const html = renderToStaticMarkup(
        React.createElement(MapGuide, { open: true })
      );

      // Balloon should be placed above the anchor (top < 600)
      // Estimate: 600 - 160 - 10 = 430px
      expect(html).toContain("top:430px");
    });

    it("el anillo rodea el rectángulo real del ancla sin tope de 160px", () => {
      const mockWindow = {
        innerWidth: 1024,
        innerHeight: 768,
        localStorage: { getItem: () => null, setItem: () => {} },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      // Tall anchor with height 400
      const tallAnchor = {
        style: { display: "block" },
        getBoundingClientRect: () => ({
          top: 100,
          bottom: 500,
          left: 600,
          right: 1000,
          width: 400,
          height: 400,
        }),
      };

      (globalThis as any).window = mockWindow;
      (globalThis as any).document = {
        querySelectorAll: vi.fn((sel: string) => (sel === '[data-tour="escenario"]' ? [tallAnchor] : [])),
        querySelector: vi.fn((sel: string) => (sel === '[data-tour="escenario"]' ? tallAnchor : null)),
      };

      const html = renderToStaticMarkup(
        React.createElement(MapGuide, { open: true })
      );

      // Ring height should be 400 + 8 = 408px, NOT capped to 160px
      expect(html).toContain("height:408px");
      expect(html).not.toContain("height:160px");
    });

    it("no renderiza nada cuando open=false", () => {
      const html = renderToStaticMarkup(
        React.createElement(MapGuide, { open: false })
      );
      expect(html).toBe("");
    });
  });

  describe("placeBalloon pure placement logic", () => {
    it("ancla alta en la columna derecha (como el panel de PC) -> globo a la izquierda, completo", () => {
      const viewport = { w: 1024, h: 768 };
      // Panel anchor filling right column from top 56 to 768
      const anchor = {
        left: 624,
        top: 56,
        width: 400,
        height: 712,
        right: 1024,
        bottom: 768,
      };
      const balloon = { w: 280, h: 160 };
      const margin = 12;
      const safeTop = 56;

      const result = placeBalloon(anchor, balloon, viewport, margin, safeTop);

      expect(result.side).toBe("left");
      // Placed to the left of the anchor with at least 10px gap
      expect(result.left).toBeLessThanOrEqual(anchor.left - 10);
      expect(result.left).toBeGreaterThanOrEqual(margin);
      // Balloon fits completely within screen bounds respecting safeTop
      expect(result.top).toBeGreaterThanOrEqual(safeTop);
      expect(result.top + balloon.h).toBeLessThanOrEqual(viewport.h - margin);
    });

    it("ancla pegada arriba -> abajo", () => {
      const viewport = { w: 1024, h: 768 };
      // Top control (e.g. scenario bar under header)
      const anchor = {
        left: 300,
        top: 56,
        width: 200,
        height: 40,
        right: 500,
        bottom: 96,
      };
      const balloon = { w: 280, h: 160 };
      const margin = 12;
      const safeTop = 56;

      const result = placeBalloon(anchor, balloon, viewport, margin, safeTop);

      expect(result.side).toBe("bottom");
      expect(result.top).toBe(anchor.bottom + 10);
      expect(result.top).toBeGreaterThanOrEqual(safeTop);
      expect(result.top + balloon.h).toBeLessThanOrEqual(viewport.h - margin);
      expect(result.left).toBeGreaterThanOrEqual(margin);
      expect(result.left + balloon.w).toBeLessThanOrEqual(viewport.w - margin);
    });

    it("ancla pegada abajo (pestañas de la hoja en celular 375x812) -> arriba", () => {
      const viewport = { w: 375, h: 812 };
      // Tabs at bottom sheet peek position (e.g. top: 680, bottom: 724)
      const anchor = {
        left: 0,
        top: 680,
        width: 375,
        height: 44,
        right: 375,
        bottom: 724,
      };
      const balloon = { w: 280, h: 160 };
      const margin = 12;
      const safeTop = 56;

      const result = placeBalloon(anchor, balloon, viewport, margin, safeTop);

      expect(result.side).toBe("top");
      expect(result.top).toBe(anchor.top - 10 - balloon.h);
      expect(result.top).toBeGreaterThanOrEqual(safeTop);
      expect(result.top + balloon.h).toBeLessThanOrEqual(viewport.h - margin);
      expect(result.left).toBeGreaterThanOrEqual(margin);
      expect(result.left + balloon.w).toBeLessThanOrEqual(viewport.w - margin);
    });

    it("ancla que ocupa toda la pantalla -> globo dentro de la pantalla y bajo safeTop", () => {
      const viewport = { w: 375, h: 812 };
      const anchor = {
        left: 0,
        top: 0,
        width: 375,
        height: 812,
        right: 375,
        bottom: 812,
      };
      const balloon = { w: 280, h: 160 };
      const margin = 12;
      const safeTop = 56;

      const result = placeBalloon(anchor, balloon, viewport, margin, safeTop);

      expect(result.top).toBeGreaterThanOrEqual(safeTop);
      expect(result.top + balloon.h).toBeLessThanOrEqual(viewport.h);
      expect(result.left).toBeGreaterThanOrEqual(margin);
      expect(result.left + balloon.w).toBeLessThanOrEqual(viewport.w);
    });

    it("el globo nunca tiene top < safeTop ni se sale por los lados en múltiples resoluciones", () => {
      const viewports = [
        { w: 360, h: 640 },
        { w: 375, h: 812 },
        { w: 768, h: 1024 },
        { w: 1024, h: 768 },
        { w: 1366, h: 768 },
        { w: 1920, h: 1080 },
      ];
      const safeTops = [0, 48, 56, 64];
      const anchors = [
        { left: -100, top: -50, width: 200, height: 100 },
        { left: 0, top: 0, width: 300, height: 200 },
        { left: 200, top: 50, width: 500, height: 40 },
        { left: 500, top: 700, width: 400, height: 500 },
        { left: 10, top: 10, width: 2000, height: 2000 },
        { left: 100, top: 400, width: 60, height: 60 },
      ];

      for (const vp of viewports) {
        for (const st of safeTops) {
          for (const anc of anchors) {
            const balloon = { w: Math.min(280, vp.w - 24), h: 160 };
            const res = placeBalloon(anc, balloon, vp, 12, st);

            expect(res.top).toBeGreaterThanOrEqual(st);
            expect(res.top + balloon.h).toBeLessThanOrEqual(vp.h);
            expect(res.left).toBeGreaterThanOrEqual(12);
            expect(res.left + balloon.w).toBeLessThanOrEqual(vp.w);
          }
        }
      }
    });

    it("coloca a la derecha cuando el ancla está a la izquierda y vertical no cabe", () => {
      const viewport = { w: 1024, h: 768 };
      // Anchor filling left column from top to bottom
      const anchor = {
        left: 0,
        top: 0,
        width: 100,
        height: 768,
        right: 100,
        bottom: 768,
      };
      const balloon = { w: 280, h: 160 };
      const margin = 12;
      const safeTop = 56;

      const result = placeBalloon(anchor, balloon, viewport, margin, safeTop);

      expect(result.side).toBe("right");
      expect(result.left).toBe(anchor.right + 10);
      expect(result.top).toBeGreaterThanOrEqual(safeTop);
      expect(result.top + balloon.h).toBeLessThanOrEqual(viewport.h - margin);
    });

    it("fallback ubica en zona libre inferior más grande cuando espacio abajo supera arriba", () => {
      const viewport = { w: 400, h: 800 };
      // Anchor near top covering full width
      const anchor = {
        left: 0,
        top: 60,
        width: 400,
        height: 300,
        right: 400,
        bottom: 360,
      };
      const balloon = { w: 280, h: 160 };
      const safeTop = 56;

      const result = placeBalloon(anchor, balloon, viewport, 12, safeTop);

      expect(result.side).toBe("bottom");
      expect(result.top).toBeGreaterThanOrEqual(safeTop);
      expect(result.left).toBeGreaterThanOrEqual(12);
    });
  });

  describe("getSafeTop helper", () => {
    it("returns 0 if doc or header is missing", () => {
      expect(getSafeTop(undefined)).toBe(0);
      expect(getSafeTop({ querySelector: () => null } as any)).toBe(0);
    });

    it("returns header bottom if header exists with positive bottom", () => {
      const mockDoc = {
        querySelector: vi.fn((sel: string) => {
          if (sel === "header") {
            return {
              getBoundingClientRect: () => ({ bottom: 56 }),
            };
          }
          return null;
        }),
      };
      expect(getSafeTop(mockDoc as any)).toBe(56);
    });
  });
});
