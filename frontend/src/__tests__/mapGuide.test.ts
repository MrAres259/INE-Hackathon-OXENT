import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createPortal } from "react-dom";
import {
  shouldShowGuide,
  dismissGuide,
  GUIDE_STORAGE_KEY,
  TOUR_STEPS,
  MapGuide,
  findVisibleAnchor,
  getValidStepAndRect,
  getValidStepBackwards,
  placeBalloon,
  getSafeTop,
  syncGuideBodyAttr,
  handleGuidePointerCapture,
  handleGuideKeyDown,
  isAnchorNotOccluded,
  scrollAnchorIntoViewIfNeeded,
  clipRectToScreen,
  updateAnchorTracking,
  type AnchorTrackingState,
  getScrollParent,
  isAnchorUsable,
  getUsableStepIndices,
  getMapInsets,
  getUsefulBand,
  isDocumentScroller,
} from "../components/map/MapGuide";

vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom")>();
  return {
    ...actual,
    createPortal: vi.fn((children: React.ReactNode, container: any) => {
      if (container) {
        container.children = container.children || [];
        container.children.push(children);
      }
      return children;
    }),
  };
});

describe("MapGuide Pure Storage Logic (mapGuide.test.ts)", () => {
  it("exports the expected storage key 'atalaya.guide.mapa.v2'", () => {
    expect(GUIDE_STORAGE_KEY).toBe("atalaya.guide.mapa.v2");
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

    it("accepts a custom storage key", () => {
      const mockStorage: Pick<Storage, "getItem"> = {
        getItem: vi.fn((key: string) => (key === "custom.key" ? "1" : null)),
      };
      expect(shouldShowGuide(mockStorage, "custom.key")).toBe(false);
      expect(shouldShowGuide(mockStorage, "other.key")).toBe(true);
    });

    it("returns false when getItem throws an exception (e.g. SecurityError or private browsing)", () => {
      const mockStorage: Pick<Storage, "getItem"> = {
        getItem: vi.fn(() => {
          throw new Error("SecurityError: localStorage is disabled");
        }),
      };
      expect(shouldShowGuide(mockStorage)).toBe(false);
    });

    it("returns false when storage is null or undefined", () => {
      expect(shouldShowGuide(null)).toBe(false);
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

    it("writes to custom storage key if provided", () => {
      const mockStorage: Pick<Storage, "setItem"> = {
        setItem: vi.fn(),
      };
      dismissGuide(mockStorage, "atalaya.guide.campanas.v1");
      expect(mockStorage.setItem).toHaveBeenCalledWith("atalaya.guide.campanas.v1", "1");
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

    it("safely handles null or undefined arguments without throwing", () => {
      expect(() => dismissGuide(null)).not.toThrow();
      expect(() => dismissGuide()).not.toThrow();
    });
  });

  describe("TOUR_STEPS configuration", () => {
    it("defines 8 sequential tour steps matching required contract anchors", () => {
      expect(TOUR_STEPS).toHaveLength(8);
      const anchors = TOUR_STEPS.map((s) => s.sel);
      expect(anchors).toEqual([
        "escenario",
        ["ajustar", "intervencion"],
        "capas",
        "panel",
        "buscar",
        "herramientas",
        "leyenda",
        "secciones",
      ]);
      TOUR_STEPS.forEach((step) => {
        expect(step.title).toBeTruthy();
        expect(step.text).toBeTruthy();
      });
    });
  });

  describe("DOM Anchor skipping and selection logic", () => {
    const originalDocument = (globalThis as any).document;
    const originalWindow = (globalThis as any).window;

    afterEach(() => {
      (globalThis as any).document = originalDocument;
      (globalThis as any).window = originalWindow;
    });

    it("sel con arreglo: usa el segundo valor si el primero no existe", () => {
      const intervencionElement = {
        getBoundingClientRect: () => ({
          top: 10,
          bottom: 40,
          left: 10,
          right: 150,
          width: 140,
          height: 30,
        }),
      };

      const mockDoc = {
        querySelectorAll: vi.fn((sel: string) => {
          if (sel === '[data-tour="intervencion"]') return [intervencionElement];
          return [];
        }),
        querySelector: vi.fn((sel: string) => {
          if (sel === '[data-tour="ajustar"]') return null;
          if (sel === '[data-tour="intervencion"]') return intervencionElement;
          return null;
        }),
      };

      const match = findVisibleAnchor(["ajustar", "intervencion"], mockDoc);
      expect(match).not.toBeNull();
      expect(match?.el).toBe(intervencionElement);
      expect(match?.rect.width).toBe(140);
    });

    it("getValidStepAndRect salta pasos sin ancla o con ancho 0 y devuelve el primer ancla válida", () => {
      const mockElements: Record<string, any> = {
        '[data-tour="escenario"]': null,
        '[data-tour="ajustar"]': null,
        '[data-tour="intervencion"]': null,
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

      const mockDoc = {
        querySelector: vi.fn((sel: string) => mockElements[sel] ?? null),
      };

      const match = getValidStepAndRect(0, mockDoc);
      expect(match).not.toBeNull();
      expect(match?.index).toBe(3); // index 3 is 'panel' in 8-step TOUR_STEPS
      expect(match?.rect.width).toBe(400);

      const matchFromPanel = getValidStepAndRect(3, mockDoc);
      expect(matchFromPanel?.index).toBe(3);

      const matchPastPanel = getValidStepAndRect(4, mockDoc);
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
        '[data-tour="ajustar"]': null,
        '[data-tour="intervencion"]': null,
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

      expect(html).toContain("Diagnóstico, Ranking y Asistente");
      expect(html).not.toContain("Elige un escenario");
      expect(html).not.toContain("Cambia la vista del mapa");
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
        querySelector: vi.fn(() => null),
      };

      const onClose = vi.fn();
      const html = renderToStaticMarkup(
        React.createElement(MapGuide, { open: true, onClose })
      );

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
      expect(match?.index).toBe(0);
      expect(match?.rect.width).toBe(160);
      expect(match?.rect.left).toBe(120);
    });

    it("aplica position fixed y z-index 1001 en el anillo y el globo, y 1000 en el fondo", () => {
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

      // Verify layers: backdrop is 1000, spotlight and balloon are 1001
      expect(html).toContain("z-[1000]");
      expect(html).toContain("z-index:1000");
      expect(html).toContain("z-[1001]");
      expect(html).toContain("z-index:1001");
      expect(html).toContain('data-guide-balloon="true"');
      expect(html).toContain('aria-labelledby="guide-balloon-title"');
      expect(html).toContain('aria-describedby="guide-balloon-desc"');
    });

    it("no renderiza nada cuando open=false", () => {
      const html = renderToStaticMarkup(
        React.createElement(MapGuide, { open: false })
      );
      expect(html).toBe("");
    });
  });

  describe("Custom steps and storageKey support", () => {
    const originalDocument = (globalThis as any).document;
    const originalWindow = (globalThis as any).window;

    afterEach(() => {
      (globalThis as any).document = originalDocument;
      (globalThis as any).window = originalWindow;
    });

    it("recorre pasos personalizados y descarta con storageKey personalizada", () => {
      const customSteps = [
        { sel: "step-alpha", title: "Paso Alfa", text: "Texto Alfa" },
        { sel: "step-beta", title: "Paso Beta", text: "Texto Beta" },
      ];
      const customStorageKey = "atalaya.guide.test.custom";

      const visibleAlpha = {
        style: { display: "block" },
        getBoundingClientRect: () => ({ top: 10, bottom: 40, left: 10, right: 100, width: 90, height: 30 }),
      };

      const mockStorage: Record<string, string> = {};
      (globalThis as any).window = {
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
      (globalThis as any).document = {
        querySelectorAll: vi.fn((sel: string) => (sel === '[data-tour="step-alpha"]' ? [visibleAlpha] : [])),
        querySelector: vi.fn((sel: string) => (sel === '[data-tour="step-alpha"]' ? visibleAlpha : null)),
      };

      const onClose = vi.fn();
      const html = renderToStaticMarkup(
        React.createElement(MapGuide, {
          open: true,
          steps: customSteps,
          storageKey: customStorageKey,
          onClose,
        })
      );

      expect(html).toContain("Paso Alfa");
      expect(html).toContain("Texto Alfa");

      dismissGuide((globalThis as any).window.localStorage, customStorageKey);
      expect(mockStorage[customStorageKey]).toBe("1");
    });
  });

  describe("Contador honesto", () => {
    const originalDocument = (globalThis as any).document;
    const originalWindow = (globalThis as any).window;

    afterEach(() => {
      (globalThis as any).document = originalDocument;
      (globalThis as any).window = originalWindow;
    });

    it("con 8 pasos y 3 anclas ausentes muestra '1/5' ... '5/5' y 'Terminar' en el quinto", () => {
      // 8 total steps in TOUR_STEPS. Present: escenario(0), capas(2), panel(3), buscar(4), herramientas(5)
      // Absent: [ajustar, intervencion](1), leyenda(6), secciones(7)
      // Total usable = 5
      const rect = { top: 10, bottom: 40, left: 10, right: 100, width: 90, height: 30 };
      const makeEl = () => ({
        style: { display: "block" },
        getBoundingClientRect: () => rect,
      });

      const presentMap: Record<string, any> = {
        '[data-tour="escenario"]': makeEl(),
        '[data-tour="capas"]': makeEl(),
        '[data-tour="panel"]': makeEl(),
        '[data-tour="buscar"]': makeEl(),
        '[data-tour="herramientas"]': makeEl(),
      };

      (globalThis as any).window = {
        innerWidth: 1024,
        innerHeight: 768,
        localStorage: { getItem: () => null, setItem: () => {} },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      (globalThis as any).document = {
        querySelectorAll: vi.fn((sel: string) => (presentMap[sel] ? [presentMap[sel]] : [])),
        querySelector: vi.fn((sel: string) => presentMap[sel] ?? null),
      };

      // 1. Initial step (0 / escenario): displays "1/5", "Siguiente", not "Terminar"
      const htmlFirst = renderToStaticMarkup(
        React.createElement(MapGuide, { open: true, initialStep: 0 })
      );
      expect(htmlFirst).toContain("1/5");
      expect(htmlFirst).toContain("Siguiente");
      expect(htmlFirst).not.toContain("Terminar");

      // 2. Last usable step (5 / herramientas): displays "5/5", "Terminar", not "Siguiente"
      const htmlLast = renderToStaticMarkup(
        React.createElement(MapGuide, { open: true, initialStep: 5 })
      );
      expect(htmlLast).toContain("5/5");
      expect(htmlLast).toContain("Terminar");
      expect(htmlLast).toContain("Anterior");
    });
  });

  describe("Oclusión (isAnchorNotOccluded & elementsFromPoint)", () => {
    it("con elementsFromPoint simulado que devuelve otro elemento encima, el paso se salta; si devuelve un hijo del ancla, no", () => {
      const anchorNode = {
        getBoundingClientRect: () => ({ top: 10, left: 10, width: 100, height: 40, right: 110, bottom: 50 }),
        contains: (child: any) => child === childNode,
      };
      const childNode = { id: "child" };
      const overlayNode = { id: "modal-overlay", contains: () => false };

      // 1. Overlay on top -> occluded
      const mockDocOccluded = {
        elementsFromPoint: vi.fn(() => [overlayNode, anchorNode]),
      };
      expect(isAnchorNotOccluded(anchorNode, mockDocOccluded as any)).toBe(false);

      // 2. Child on top -> not occluded
      const mockDocChild = {
        elementsFromPoint: vi.fn(() => [childNode, anchorNode]),
      };
      expect(isAnchorNotOccluded(anchorNode, mockDocChild as any)).toBe(true);

      // 3. Anchor itself on top -> not occluded
      const mockDocSelf = {
        elementsFromPoint: vi.fn(() => [anchorNode]),
      };
      expect(isAnchorNotOccluded(anchorNode, mockDocSelf as any)).toBe(true);

      // 4. Guide elements ignored
      const guideBackdrop = {
        hasAttribute: (attr: string) => attr === "data-guide-backdrop",
        closest: () => true,
      };
      const mockDocGuide = {
        elementsFromPoint: vi.fn(() => [guideBackdrop, childNode]),
      };
      expect(isAnchorNotOccluded(anchorNode, mockDocGuide as any)).toBe(true);
    });
  });

  describe("Desplazamiento (scrollIntoView)", () => {
    const originalWindow = (globalThis as any).window;

    afterEach(() => {
      (globalThis as any).window = originalWindow;
    });

    it("ancla fuera de pantalla => scrollIntoView llamado con block: 'center' y behavior: 'smooth'", () => {
      const scrollIntoViewMock = vi.fn();
      const outOfScreenEl = {
        getBoundingClientRect: () => ({ top: 1200, bottom: 1260, left: 10, right: 100, width: 90, height: 60 }),
        scrollIntoView: scrollIntoViewMock,
      };

      (globalThis as any).window = {
        innerHeight: 768,
        visualViewport: { height: 768, width: 1024 },
        matchMedia: vi.fn(() => ({ matches: false })),
      };

      const scrolled = scrollAnchorIntoViewIfNeeded(outOfScreenEl);
      expect(scrolled).toBe(true);
      expect(scrollIntoViewMock).toHaveBeenCalledWith({
        block: "center",
        inline: "nearest",
        behavior: "smooth",
      });
    });

    it("con movimiento reducido, behavior es 'auto'", () => {
      const scrollIntoViewMock = vi.fn();
      const outOfScreenEl = {
        getBoundingClientRect: () => ({ top: -200, bottom: -150, left: 10, right: 100, width: 90, height: 50 }),
        scrollIntoView: scrollIntoViewMock,
      };

      (globalThis as any).window = {
        innerHeight: 768,
        visualViewport: { height: 768, width: 1024 },
        matchMedia: vi.fn((q: string) => ({
          matches: q.includes("prefers-reduced-motion"),
        })),
      };

      const scrolled = scrollAnchorIntoViewIfNeeded(outOfScreenEl);
      expect(scrolled).toBe(true);
      expect(scrollIntoViewMock).toHaveBeenCalledWith({
        block: "center",
        inline: "nearest",
        behavior: "auto",
      });
    });

    it("no desplaza si el ancla cabe completa dentro del área útil", () => {
      const scrollIntoViewMock = vi.fn();
      const insideScreenEl = {
        getBoundingClientRect: () => ({ top: 100, bottom: 200, left: 10, right: 100, width: 90, height: 100 }),
        scrollIntoView: scrollIntoViewMock,
      };

      (globalThis as any).window = {
        innerHeight: 768,
        visualViewport: { height: 768, width: 1024 },
        matchMedia: vi.fn(() => ({ matches: false })),
      };

      const scrolled = scrollAnchorIntoViewIfNeeded(insideScreenEl);
      expect(scrolled).toBe(false);
      expect(scrollIntoViewMock).not.toHaveBeenCalled();
    });
  });

  describe("Seguimiento en vivo (updateAnchorTracking & 400ms tolerance)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("el ancla cambia de posición tras abrir => el anillo se actualiza en el siguiente cuadro", () => {
      const initialRect = { top: 10, left: 10, width: 100, height: 40, bottom: 50, right: 110 } as DOMRect;
      let currentRect = initialRect;

      const anchorEl = {
        getBoundingClientRect: () => currentRect,
        isConnected: true,
      };

      const trackingState: AnchorTrackingState = {
        currentEl: anchorEl,
        prevRect: initialRect,
        disappearedTimer: null,
        currentStepIndex: 0,
      };

      const onUpdateRect = vi.fn();
      const mockDoc = {
        querySelector: (sel: string) => (sel === "header" ? null : anchorEl),
        querySelectorAll: () => [anchorEl],
      };

      // 1. Position hasn't changed (<= 0.5px) -> no update
      updateAnchorTracking(trackingState, {
        sel: "escenario",
        doc: mockDoc,
        onUpdateRect,
        onAdvanceStep: vi.fn(),
        onClose: vi.fn(),
      });
      expect(onUpdateRect).not.toHaveBeenCalled();

      // 2. Position moved > 0.5px -> updates rect
      currentRect = { top: 35, left: 60, width: 100, height: 40, bottom: 75, right: 160 } as DOMRect;
      updateAnchorTracking(trackingState, {
        sel: "escenario",
        doc: mockDoc,
        onUpdateRect,
        onAdvanceStep: vi.fn(),
        onClose: vi.fn(),
      });
      expect(onUpdateRect).toHaveBeenCalledWith(currentRect);
    });

    it("ancla desaparece < 400 ms y vuelve => mismo paso; > 400 ms => siguiente", () => {
      const validRect = { top: 10, left: 10, width: 100, height: 40, bottom: 50, right: 110 } as DOMRect;
      const anchorEl = {
        style: { display: "block" },
        getBoundingClientRect: () => validRect,
        isConnected: true,
      };

      const trackingState: AnchorTrackingState = {
        currentEl: anchorEl,
        prevRect: validRect,
        disappearedTimer: null,
        currentStepIndex: 0,
      };

      const nextAnchorEl = {
        style: { display: "block" },
        getBoundingClientRect: () => validRect,
        isConnected: true,
      };

      const mockDoc = {
        querySelector: (sel: string) => {
          if (sel === '[data-tour="escenario"]') return anchorEl.style.display !== "none" ? anchorEl : null;
          if (sel === '[data-tour="ajustar"]') return nextAnchorEl;
          return null;
        },
        querySelectorAll: (sel: string) => {
          if (sel === '[data-tour="escenario"]') return anchorEl.style.display !== "none" ? [anchorEl] : [];
          if (sel === '[data-tour="ajustar"]') return [nextAnchorEl];
          return [];
        },
      };

      const onAdvanceStep = vi.fn();
      const onClose = vi.fn();

      // Anchor disappears: tracking notices disappearance and sets 400ms timer
      anchorEl.style.display = "none";
      updateAnchorTracking(trackingState, {
        sel: "escenario",
        doc: mockDoc,
        onUpdateRect: vi.fn(),
        onAdvanceStep,
        onClose,
      });

      expect(trackingState.disappearedTimer).not.toBeNull();
      expect(onAdvanceStep).not.toHaveBeenCalled();

      // Advance by 250ms (< 400ms) and anchor reappears: timer is cancelled, stays on same step
      vi.advanceTimersByTime(250);
      anchorEl.style.display = "block";
      updateAnchorTracking(trackingState, {
        sel: "escenario",
        doc: mockDoc,
        onUpdateRect: vi.fn(),
        onAdvanceStep,
        onClose,
      });

      expect(trackingState.disappearedTimer).toBeNull();
      expect(onAdvanceStep).not.toHaveBeenCalled();
      expect(trackingState.currentStepIndex).toBe(0);

      // Now anchor disappears again and stays absent > 400ms
      anchorEl.style.display = "none";
      updateAnchorTracking(trackingState, {
        sel: "escenario",
        doc: mockDoc,
        onUpdateRect: vi.fn(),
        onAdvanceStep,
        onClose,
      });
      expect(trackingState.disappearedTimer).not.toBeNull();

      vi.advanceTimersByTime(400);
      // Timeout fired -> advances to next usable step (step 1 / ajustar)
      expect(onAdvanceStep).toHaveBeenCalledWith(1, validRect, nextAnchorEl);
      expect(trackingState.currentStepIndex).toBe(1);
    });
  });

  describe("Ancla de 2000 px de alto", () => {
    it("anillo recortado a la pantalla y globo completo dentro", () => {
      const viewport = { w: 1024, h: 768 };
      const tallAnchor = {
        left: 100,
        top: 0,
        width: 400,
        height: 2000,
        right: 500,
        bottom: 2000,
      };

      const clipped = clipRectToScreen(tallAnchor, viewport);
      expect(clipped.top).toBe(0);
      expect(clipped.bottom).toBe(768);
      expect(clipped.height).toBe(768);

      const balloon = { w: 280, h: 160 };
      const margin = 12;
      const safeTop = 56;

      const placement = placeBalloon(clipped, balloon, viewport, margin, safeTop);

      expect(placement.top).toBeGreaterThanOrEqual(safeTop);
      expect(placement.top + balloon.h).toBeLessThanOrEqual(viewport.h - margin);
      expect(placement.left).toBeGreaterThanOrEqual(margin);
      expect(placement.left + balloon.w).toBeLessThanOrEqual(viewport.w - margin);
    });
  });

  describe("Bloqueo total de teclado, contextmenu y touchmove", () => {
    it("tecla '/' con destino fuera del globo es bloqueada", () => {
      const mockBalloon = {
        contains: vi.fn(() => false),
      };

      let defaultPrevented = false;
      let immediateStopped = false;

      const slashEvent = {
        key: "/",
        target: { id: "page-body" },
        preventDefault: () => {
          defaultPrevented = true;
        },
        stopPropagation: () => {},
        stopImmediatePropagation: () => {
          immediateStopped = true;
        },
      };

      const handled = handleGuideKeyDown(slashEvent, mockBalloon, vi.fn());
      expect(handled).toBe(true);
      expect(defaultPrevented).toBe(true);
      expect(immediateStopped).toBe(true);
    });

    it("ArrowRight avanza y ArrowLeft retrocede", () => {
      const onNext = vi.fn();
      const onPrev = vi.fn();
      const mockBalloon = { contains: () => false };

      let nextPrevented = false;
      handleGuideKeyDown(
        {
          key: "ArrowRight",
          preventDefault: () => {
            nextPrevented = true;
          },
        },
        mockBalloon,
        vi.fn(),
        undefined,
        onNext,
        onPrev
      );
      expect(nextPrevented).toBe(true);
      expect(onNext).toHaveBeenCalled();

      let prevPrevented = false;
      handleGuideKeyDown(
        {
          key: "ArrowLeft",
          preventDefault: () => {
            prevPrevented = true;
          },
        },
        mockBalloon,
        vi.fn(),
        undefined,
        onNext,
        onPrev
      );
      expect(prevPrevented).toBe(true);
      expect(onPrev).toHaveBeenCalled();
    });

    it("Escape cierra la guía y emite evento", () => {
      const onClose = vi.fn();
      let defaultPrevented = false;
      handleGuideKeyDown(
        {
          key: "Escape",
          preventDefault: () => {
            defaultPrevented = true;
          },
        },
        null,
        onClose
      );
      expect(defaultPrevented).toBe(true);
      expect(onClose).toHaveBeenCalled();
    });

    it("contextmenu y touchmove fuera del globo son bloqueados", () => {
      const mockBalloon = {
        contains: vi.fn((el: any) => el?.id === "in-balloon"),
      };

      let contextMenuBlocked = false;
      const contextMenuEvent = {
        target: { id: "outside" },
        preventDefault: () => {
          contextMenuBlocked = true;
        },
        stopPropagation: vi.fn(),
        stopImmediatePropagation: vi.fn(),
      };
      expect(handleGuidePointerCapture(contextMenuEvent, mockBalloon)).toBe(true);
      expect(contextMenuBlocked).toBe(true);

      let touchMoveBlocked = false;
      const touchMoveEvent = {
        target: { id: "outside" },
        preventDefault: () => {
          touchMoveBlocked = true;
        },
        stopPropagation: vi.fn(),
        stopImmediatePropagation: vi.fn(),
      };
      expect(handleGuidePointerCapture(touchMoveEvent, mockBalloon)).toBe(true);
      expect(touchMoveBlocked).toBe(true);

      // Inside balloon is allowed
      const insideEvent = {
        target: { id: "in-balloon" },
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      };
      expect(handleGuidePointerCapture(insideEvent, mockBalloon)).toBe(false);
      expect(insideEvent.preventDefault).not.toHaveBeenCalled();
    });
  });

  describe("Desmontaje y sincronización", () => {
    it("al desmontar con la guía abierta se cancela el bucle y se quita body[data-guide]", () => {
      const mockDoc = { body: { dataset: { guide: "open" } } };
      const cancelRaf = vi.fn();
      (globalThis as any).cancelAnimationFrame = cancelRaf;

      // Simulate unmount cleanup actions:
      cancelRaf(123);
      syncGuideBodyAttr(false, mockDoc);

      expect(cancelRaf).toHaveBeenCalledWith(123);
      expect(mockDoc.body.dataset.guide).toBeUndefined();
    });

    it("clipRectToScreen acota rectángulos mayores al viewport", () => {
      const vp = { w: 800, h: 600 };
      const rect = { left: -50, top: -100, width: 1000, height: 1200 };
      const clipped = clipRectToScreen(rect, vp);

      expect(clipped.left).toBe(0);
      expect(clipped.top).toBe(0);
      expect(clipped.right).toBe(800);
      expect(clipped.bottom).toBe(600);
      expect(clipped.width).toBe(800);
      expect(clipped.height).toBe(600);
    });
  });

  describe("placeBalloon pure placement logic", () => {
    it("ancla alta en la columna derecha (como el panel de PC) -> globo a la izquierda, completo", () => {
      const viewport = { w: 1024, h: 768 };
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
      expect(result.left).toBeLessThanOrEqual(anchor.left - 10);
      expect(result.left).toBeGreaterThanOrEqual(margin);
      expect(result.top).toBeGreaterThanOrEqual(safeTop);
      expect(result.top + balloon.h).toBeLessThanOrEqual(viewport.h - margin);
    });

    it("ancla pegada arriba -> abajo", () => {
      const viewport = { w: 1024, h: 768 };
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
  });

  describe("Landscape viewport and drawer insets", () => {
    it("placeBalloon con viewport 915x412 e inset derecho 380 coloca el globo completo y sin tapar el ancla en los pasos", () => {
      const viewport = { w: 915, h: 412 };
      const insetRight = 380;
      const balloon = { w: 280, h: 160 };
      const margin = 12;
      const safeTop = 48;

      const stepRects: Record<
        string,
        { left: number; top: number; width: number; height: number; right: number; bottom: number }
      > = {
        escenario: { left: 120, top: 8, width: 160, height: 32, right: 280, bottom: 40 },
        ajustar: { left: 290, top: 8, width: 80, height: 32, right: 370, bottom: 40 },
        capas: { left: 12, top: 60, width: 120, height: 36, right: 132, bottom: 96 },
        panel: { left: 535, top: 0, width: 380, height: 412, right: 915, bottom: 412 },
        buscar: { left: 300, top: 8, width: 160, height: 32, right: 460, bottom: 40 },
        herramientas: { left: 491, top: 56, width: 36, height: 144, right: 527, bottom: 200 },
        leyenda: { left: 12, top: 220, width: 110, height: 36, right: 122, bottom: 256 },
        secciones: { left: 12, top: 300, width: 140, height: 36, right: 152, bottom: 336 },
      };

      for (const step of TOUR_STEPS) {
        const sel = Array.isArray(step.sel) ? step.sel[0] : step.sel;
        const rect = stepRects[sel];
        if (!rect) continue;

        const result = placeBalloon(rect, balloon, viewport, margin, safeTop, insetRight);

        expect(result.left).toBeGreaterThanOrEqual(margin);
        expect(result.left + balloon.w).toBeLessThanOrEqual(viewport.w - insetRight);
        expect(result.top).toBeGreaterThanOrEqual(safeTop);
        expect(result.top + balloon.h).toBeLessThanOrEqual(viewport.h - margin);

        const overlapsAnchor =
          result.left < rect.right &&
          result.left + balloon.w > rect.left &&
          result.top < rect.bottom &&
          result.top + balloon.h > rect.top;
        expect(overlapsAnchor).toBe(false);
      }
    });

    it("emite el evento atalaya:guide-open al activarse", () => {
      let dispatchedEvent: string | null = null;
      const originalWindow = (globalThis as any).window;

      const mockWindow = {
        innerWidth: 1024,
        innerHeight: 768,
        localStorage: { getItem: () => null, setItem: () => {} },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn((e: any) => {
          dispatchedEvent = e.type;
        }),
      };

      (globalThis as any).window = mockWindow;

      try {
        mockWindow.dispatchEvent(new CustomEvent("atalaya:guide-open"));
        expect(dispatchedEvent).toBe("atalaya:guide-open");
      } finally {
        (globalThis as any).window = originalWindow;
      }
    });

    it("emite el evento atalaya:guide-close al cerrarse", () => {
      let dispatchedClose = false;
      const originalWindow = (globalThis as any).window;

      const mockWindow = {
        innerWidth: 1024,
        innerHeight: 768,
        localStorage: { getItem: () => null, setItem: () => {} },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn((e: any) => {
          if (e.type === "atalaya:guide-close") {
            dispatchedClose = true;
          }
        }),
      };

      (globalThis as any).window = mockWindow;

      try {
        mockWindow.dispatchEvent(new CustomEvent("atalaya:guide-close"));
        expect(dispatchedClose).toBe(true);
      } finally {
        (globalThis as any).window = originalWindow;
      }
    });
  });

  describe("F1-A · Anclas alcanzables, desplazamiento según tamaño y contador estable", () => {
    const originalDocument = (globalThis as any).document;
    const originalWindow = (globalThis as any).window;

    afterEach(() => {
      (globalThis as any).document = originalDocument;
      (globalThis as any).window = originalWindow;
    });

    describe("getScrollParent", () => {
      it("devuelve el ancestro más cercano con overflow-y auto/scroll y scrollHeight > clientHeight + 1", () => {
        const grandParent = {
          style: { overflowY: "auto" },
          scrollHeight: 1000,
          clientHeight: 500,
          parentElement: null,
        };
        const parent = {
          style: { overflowY: "visible" },
          scrollHeight: 800,
          clientHeight: 500,
          parentElement: grandParent,
        };
        const el = {
          parentElement: parent,
        };

        expect(getScrollParent(el)).toBe(grandParent);
      });

      it("devuelve null si scrollHeight <= clientHeight + 1 (no hay desbordamiento real)", () => {
        const parent = {
          style: { overflowY: "auto" },
          scrollHeight: 500,
          clientHeight: 500,
          parentElement: null,
        };
        const el = { parentElement: parent };

        expect(getScrollParent(el)).toBeNull();
      });

      it("devuelve null si ningún ancestro tiene overflow-y auto o scroll", () => {
        const parent = {
          style: { overflowY: "hidden" },
          scrollHeight: 1200,
          clientHeight: 500,
          parentElement: null,
        };
        const el = { parentElement: parent };

        expect(getScrollParent(el)).toBeNull();
      });

      it("devuelve null para null o undefined", () => {
        expect(getScrollParent(null)).toBeNull();
        expect(getScrollParent(undefined)).toBeNull();
      });
    });

    describe("isAnchorUsable", () => {
      it("devuelve false si el elemento no es visible", () => {
        const hiddenEl = {
          style: { display: "none" },
          getBoundingClientRect: () => ({ top: 10, left: 10, width: 0, height: 0 }),
        };
        expect(isAnchorUsable(hiddenEl)).toBe(false);
      });

      it("devuelve true si el ancla está fuera de pantalla pero tiene getScrollParent (es alcanzable)", () => {
        const scrollParent = {
          style: { overflowY: "auto" },
          scrollHeight: 1500,
          clientHeight: 600,
          getBoundingClientRect: () => ({ top: 56, bottom: 656, left: 0, right: 1000, width: 1000, height: 600 }),
          parentElement: null,
        };
        const outOfScreenEl = {
          parentElement: scrollParent,
          getBoundingClientRect: () => ({ top: 900, bottom: 950, left: 10, right: 100, width: 90, height: 50 }),
        };

        // Even if elementsFromPoint would say occluded:
        const mockDoc = {
          elementsFromPoint: vi.fn(() => [{ id: "overlay" }]),
        };

        expect(isAnchorUsable(outOfScreenEl, mockDoc as any)).toBe(true);
      });

      it("devuelve true si el ancla quedó arriba (top < safeTop) pero tiene getScrollParent", () => {
        const scrollParent = {
          style: { overflowY: "auto" },
          scrollHeight: 1500,
          clientHeight: 600,
          parentElement: null,
        };
        const scrolledAboveEl = {
          parentElement: scrollParent,
          getBoundingClientRect: () => ({ top: -100, bottom: -50, left: 10, right: 100, width: 90, height: 50 }),
        };

        const mockDoc = {
          querySelector: vi.fn((sel: string) => sel === "header" ? { getBoundingClientRect: () => ({ bottom: 56 }) } : null),
        };

        expect(isAnchorUsable(scrolledAboveEl, mockDoc as any)).toBe(true);
      });

      it("si está completa en el área útil evalúa isAnchorNotOccluded", () => {
        const occludedEl = {
          getBoundingClientRect: () => ({ top: 100, bottom: 200, left: 10, right: 100, width: 90, height: 100 }),
          contains: () => false,
        };
        const mockDoc = {
          elementsFromPoint: vi.fn(() => {
            return [{ id: "modal-overlay", contains: () => false }];
          }),
        };

        expect(isAnchorUsable(occludedEl, mockDoc as any)).toBe(false);
      });
    });

    describe("Desplazamiento según tamaño (scrollAnchorIntoViewIfNeeded)", () => {
      it("ancla de 500 px con globo de 160 px en pantalla de 640 px => block: 'start'", () => {
        const scrollIntoViewMock = vi.fn();
        const tallAnchor = {
          getBoundingClientRect: () => ({ top: 0, bottom: 500, left: 10, right: 210, width: 200, height: 500 }),
          scrollIntoView: scrollIntoViewMock,
        };

        (globalThis as any).window = {
          innerHeight: 640,
          visualViewport: { height: 640, width: 360 },
          matchMedia: vi.fn(() => ({ matches: false })),
        };

        const scrolled = scrollAnchorIntoViewIfNeeded(tallAnchor, undefined, 160);
        expect(scrolled).toBe(true);
        expect(scrollIntoViewMock).toHaveBeenCalledWith({
          block: "start",
          inline: "nearest",
          behavior: "smooth",
        });
      });

      it("ancla de 80 px fuera de pantalla en pantalla de 640 px => block: 'center'", () => {
        const scrollIntoViewMock = vi.fn();
        const shortAnchor = {
          getBoundingClientRect: () => ({ top: 700, bottom: 780, left: 10, right: 210, width: 200, height: 80 }),
          scrollIntoView: scrollIntoViewMock,
        };

        (globalThis as any).window = {
          innerHeight: 640,
          visualViewport: { height: 640, width: 360 },
          matchMedia: vi.fn(() => ({ matches: false })),
        };

        const scrolled = scrollAnchorIntoViewIfNeeded(shortAnchor, undefined, 160);
        expect(scrolled).toBe(true);
        expect(scrollIntoViewMock).toHaveBeenCalledWith({
          block: "center",
          inline: "nearest",
          behavior: "smooth",
        });
      });

      it("ancla ya completa con espacio para el globo => sin scrollIntoView", () => {
        const scrollIntoViewMock = vi.fn();
        const insideAnchor = {
          getBoundingClientRect: () => ({ top: 100, bottom: 180, left: 10, right: 210, width: 200, height: 80 }),
          scrollIntoView: scrollIntoViewMock,
        };

        (globalThis as any).window = {
          innerHeight: 640,
          visualViewport: { height: 640, width: 360 },
          matchMedia: vi.fn(() => ({ matches: false })),
        };

        const scrolled = scrollAnchorIntoViewIfNeeded(insideAnchor, undefined, 160);
        expect(scrolled).toBe(false);
        expect(scrollIntoViewMock).not.toHaveBeenCalled();
      });
    });

    describe("Seguimiento y no avance falso durante desplazamiento (updateAnchorTracking)", () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it("durante el desplazamiento (antes de scrollend) el bucle no avanza de paso aunque la oclusión diga 'tapada' por > 400 ms", () => {
        const anchorEl = {
          style: { display: "block" },
          isConnected: true,
          getBoundingClientRect: () => ({ top: 300, left: 10, width: 100, height: 40, bottom: 340, right: 110 }),
        };

        const trackingState: AnchorTrackingState = {
          currentEl: anchorEl,
          prevRect: null,
          disappearedTimer: null,
          currentStepIndex: 0,
        };

        const onAdvanceStep = vi.fn();
        const onUpdateRect = vi.fn();
        const onClose = vi.fn();

        // Simulate elementsFromPoint returning overlay (occluded)
        const mockDoc = {
          elementsFromPoint: vi.fn(() => [{ id: "overlay", contains: () => false }]),
          querySelector: vi.fn(() => anchorEl),
        };

        // Call updateAnchorTracking with isScrolling: true
        updateAnchorTracking(trackingState, {
          sel: "step-test",
          doc: mockDoc,
          isScrolling: true,
          onAdvanceStep,
          onUpdateRect,
          onClose,
        });

        // Fast forward > 400 ms
        vi.advanceTimersByTime(500);

        expect(onAdvanceStep).not.toHaveBeenCalled();
        expect(trackingState.disappearedTimer).toBeNull();
      });

      it("durante el desplazamiento el bucle sigue midiendo el rectángulo si este cambia", () => {
        const initialRect = { top: 300, left: 10, width: 100, height: 40, bottom: 340, right: 110 } as DOMRect;
        let currentRect = initialRect;

        const anchorEl = {
          style: { display: "block" },
          isConnected: true,
          getBoundingClientRect: () => currentRect,
        };

        const trackingState: AnchorTrackingState = {
          currentEl: anchorEl,
          prevRect: initialRect,
          disappearedTimer: null,
          currentStepIndex: 0,
        };

        const onUpdateRect = vi.fn();

        currentRect = { top: 250, left: 10, width: 100, height: 40, bottom: 290, right: 110 } as DOMRect;

        updateAnchorTracking(trackingState, {
          sel: "step-test",
          doc: {},
          isScrolling: true,
          onAdvanceStep: vi.fn(),
          onUpdateRect,
          onClose: vi.fn(),
        });

        expect(onUpdateRect).toHaveBeenCalledWith(currentRect);
      });
    });

    describe("Contador estable con anclas alcanzables por desplazamiento", () => {
      it("con 7 pasos utilizables y un ancla que tras desplazar queda bajo la barra superior, el contador sigue siendo 'n/7' en todos los pasos", () => {
        // Setup 7 steps inside a scrollable container
        const customSteps = [
          { sel: "step-1", title: "Paso 1", text: "T1" },
          { sel: "step-2", title: "Paso 2", text: "T2" },
          { sel: "step-3", title: "Paso 3", text: "T3" },
          { sel: "step-4", title: "Paso 4", text: "T4" },
          { sel: "step-5", title: "Paso 5", text: "T5" },
          { sel: "step-6", title: "Paso 6", text: "T6" },
          { sel: "step-7", title: "Paso 7", text: "T7" },
        ];

        const scrollParent = {
          style: { overflowY: "auto" },
          scrollHeight: 3500,
          clientHeight: 600,
          parentElement: null,
        };

        // Step 1 scrolled up under header (top: -100, safeTop: 56)
        // Step 2 is in view (top: 100)
        // Steps 3..7 are down below (top: 500, 900, 1300...)
        const elementsMap: Record<string, any> = {
          '[data-tour="step-1"]': {
            parentElement: scrollParent,
            style: { display: "block" },
            getBoundingClientRect: () => ({ top: -100, bottom: -40, left: 10, right: 100, width: 90, height: 60 }),
          },
          '[data-tour="step-2"]': {
            parentElement: scrollParent,
            style: { display: "block" },
            getBoundingClientRect: () => ({ top: 100, bottom: 160, left: 10, right: 100, width: 90, height: 60 }),
          },
          '[data-tour="step-3"]': {
            parentElement: scrollParent,
            style: { display: "block" },
            getBoundingClientRect: () => ({ top: 500, bottom: 560, left: 10, right: 100, width: 90, height: 60 }),
          },
          '[data-tour="step-4"]': {
            parentElement: scrollParent,
            style: { display: "block" },
            getBoundingClientRect: () => ({ top: 900, bottom: 960, left: 10, right: 100, width: 90, height: 60 }),
          },
          '[data-tour="step-5"]': {
            parentElement: scrollParent,
            style: { display: "block" },
            getBoundingClientRect: () => ({ top: 1300, bottom: 1360, left: 10, right: 100, width: 90, height: 60 }),
          },
          '[data-tour="step-6"]': {
            parentElement: scrollParent,
            style: { display: "block" },
            getBoundingClientRect: () => ({ top: 1700, bottom: 1760, left: 10, right: 100, width: 90, height: 60 }),
          },
          '[data-tour="step-7"]': {
            parentElement: scrollParent,
            style: { display: "block" },
            getBoundingClientRect: () => ({ top: 2100, bottom: 2160, left: 10, right: 100, width: 90, height: 60 }),
          },
        };

        const mockDoc = {
          querySelector: vi.fn((sel: string) => {
            if (sel === "header") return { getBoundingClientRect: () => ({ bottom: 56 }) };
            return elementsMap[sel] ?? null;
          }),
          querySelectorAll: vi.fn((sel: string) => {
            return elementsMap[sel] ? [elementsMap[sel]] : [];
          }),
        };

        (globalThis as any).window = {
          innerWidth: 1024,
          innerHeight: 768,
          localStorage: { getItem: () => null, setItem: () => {} },
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        };
        (globalThis as any).document = mockDoc;

        // Check getUsableStepIndices returns all 7 steps even with step-1 scrolled up
        const usable = getUsableStepIndices(customSteps, mockDoc);
        expect(usable).toHaveLength(7);
        expect(usable).toEqual([0, 1, 2, 3, 4, 5, 6]);

        // When viewing step 2 (index 1), counter renders "2/7"
        const html = renderToStaticMarkup(
          React.createElement(MapGuide, {
            open: true,
            steps: customSteps,
            initialStep: 1,
          })
        );

        expect(html).toContain("2/7");
        expect(html).toContain("Paso 2");

        // When viewing step 7 (index 6), counter renders "7/7" and "Terminar"
        const htmlLast = renderToStaticMarkup(
          React.createElement(MapGuide, {
            open: true,
            steps: customSteps,
            initialStep: 6,
          })
        );

        expect(htmlLast).toContain("7/7");
        expect(htmlLast).toContain("Terminar");
      });
    });

    describe("Ancla fuera de pantalla, elementsFromPoint y simulación de scrollend", () => {
      it("ancla fuera de pantalla dentro de contenedor con desplazamiento y elementsFromPoint simulado que devuelve otro elemento en su centro => el paso no se salta; se llama scrollIntoView y, al terminar el desplazamiento (simula scrollend), si elementsFromPoint ya devuelve el ancla se muestra, y si sigue tapada avanza", () => {
        // Step 0 anchor: outside screen, center occluded initially
        let currentOccludingEl: any = { id: "fixed-export-bar", contains: () => false };
        let scrollListeners: Record<string, ((e?: any) => void)[]> = {};

        const scrollParent = {
          style: { overflowY: "auto" },
          scrollHeight: 2000,
          clientHeight: 600,
          parentElement: null,
          addEventListener: vi.fn((ev: string, cb: any) => {
            scrollListeners[ev] = scrollListeners[ev] || [];
            scrollListeners[ev].push(cb);
          }),
          removeEventListener: vi.fn((ev: string, cb: any) => {
            if (scrollListeners[ev]) {
              scrollListeners[ev] = scrollListeners[ev].filter((fn) => fn !== cb);
            }
          }),
          dispatchEvent: vi.fn((e: any) => {
            const handlers = scrollListeners[e.type] || [];
            handlers.forEach((h) => h(e));
          }),
        };

        const scrollIntoViewMock = vi.fn();
        let step0Rect = { top: 900, bottom: 960, left: 10, right: 200, width: 190, height: 60 };

        const step0Anchor = {
          parentElement: scrollParent,
          style: { display: "block" },
          isConnected: true,
          scrollIntoView: scrollIntoViewMock,
          getBoundingClientRect: () => step0Rect,
          contains: (el: any) => el === step0Anchor,
        };

        const step1Anchor = {
          parentElement: scrollParent,
          style: { display: "block" },
          isConnected: true,
          scrollIntoView: vi.fn(),
          getBoundingClientRect: () => ({ top: 1200, bottom: 1260, left: 10, right: 200, width: 190, height: 60 }),
          contains: (el: any) => el === step1Anchor,
        };

        const customSteps = [
          { sel: "step-0", title: "Paso Cero", text: "T0" },
          { sel: "step-1", title: "Paso Uno", text: "T1" },
        ];

        const mockDoc = {
          querySelector: vi.fn((sel: string) => {
            if (sel === '[data-tour="step-0"]') return step0Anchor;
            if (sel === '[data-tour="step-1"]') return step1Anchor;
            return null;
          }),
          querySelectorAll: vi.fn((sel: string) => {
            if (sel === '[data-tour="step-0"]') return [step0Anchor];
            if (sel === '[data-tour="step-1"]') return [step1Anchor];
            return [];
          }),
          elementsFromPoint: vi.fn(() => [currentOccludingEl, step0Anchor]),
        };

        (globalThis as any).window = {
          innerWidth: 1024,
          innerHeight: 640,
          visualViewport: { width: 1024, height: 640 },
          localStorage: { getItem: () => null, setItem: () => {} },
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          matchMedia: vi.fn(() => ({ matches: false })),
        };
        (globalThis as any).document = mockDoc;

        // 1. Step is NOT skipped initially even though occluded
        const match = findVisibleAnchor("step-0", mockDoc);
        expect(match).not.toBeNull();
        expect(match?.el).toBe(step0Anchor);

        // 2. scrollIntoView is called when scrolling is checked
        const didScroll = scrollAnchorIntoViewIfNeeded(step0Anchor, mockDoc as any, 160);
        expect(didScroll).toBe(true);
        expect(scrollIntoViewMock).toHaveBeenCalled();

        // 3. Post-scroll: when elementsFromPoint returns the anchor, it is clear and stays
        currentOccludingEl = step0Anchor;
        step0Rect = { top: 150, bottom: 210, left: 10, right: 200, width: 190, height: 60 };
        expect(isAnchorNotOccluded(step0Anchor, mockDoc as any)).toBe(true);

        // 4. If elementsFromPoint STILL returns the overlay (still occluded), isAnchorNotOccluded is false
        currentOccludingEl = { id: "modal-overlay", contains: () => false };
        expect(isAnchorNotOccluded(step0Anchor, mockDoc as any)).toBe(false);

        // When still occluded, getValidStepAndRect advances to step 1
        const nextMatch = getValidStepAndRect(1, mockDoc, customSteps);
        expect(nextMatch).not.toBeNull();
        expect(nextMatch?.index).toBe(1);
        expect(nextMatch?.el).toBe(step1Anchor);
      });

      it("en MapGuide montado con ancla oculta que se desplaza: al disparar scrollend, si sigue tapada avanza al siguiente paso", async () => {
        let currentOccludingEl: any = { id: "fixed-export-bar", contains: () => false };
        let scrollListeners: Record<string, ((e?: any) => void)[]> = {};

        const scrollParent = {
          style: { overflowY: "auto" },
          scrollHeight: 2000,
          clientHeight: 600,
          parentElement: null,
          addEventListener: vi.fn((ev: string, cb: any) => {
            scrollListeners[ev] = scrollListeners[ev] || [];
            scrollListeners[ev].push(cb);
          }),
          removeEventListener: vi.fn((ev: string, cb: any) => {
            if (scrollListeners[ev]) {
              scrollListeners[ev] = scrollListeners[ev].filter((fn) => fn !== cb);
            }
          }),
          dispatchEvent: vi.fn((e: any) => {
            const handlers = (scrollListeners[e.type] || []).slice();
            handlers.forEach((h) => h(e));
          }),
        };

        const scrollIntoViewMock = vi.fn();
        let step0Rect = { top: 900, bottom: 960, left: 10, right: 200, width: 190, height: 60 };

        const step0Anchor = {
          parentElement: scrollParent,
          style: { display: "block" },
          isConnected: true,
          scrollIntoView: scrollIntoViewMock,
          getBoundingClientRect: () => step0Rect,
          contains: (el: any) => el === step0Anchor,
        };

        const step1Anchor = {
          parentElement: scrollParent,
          style: { display: "block" },
          isConnected: true,
          scrollIntoView: vi.fn(),
          getBoundingClientRect: () => ({ top: 1200, bottom: 1260, left: 10, right: 200, width: 190, height: 60 }),
          contains: (el: any) => el === step1Anchor,
        };

        const customSteps = [
          { sel: "step-0", title: "Paso Cero", text: "T0" },
          { sel: "step-1", title: "Paso Uno", text: "T1" },
        ];

        const mockBody = {
          dataset: {},
          appendChild: vi.fn(),
          removeChild: vi.fn(),
        };

        const mockDoc = {
          body: mockBody,
          querySelector: vi.fn((sel: string) => {
            if (sel === '[data-tour="step-0"]') return step0Anchor;
            if (sel === '[data-tour="step-1"]') return step1Anchor;
            return null;
          }),
          querySelectorAll: vi.fn((sel: string) => {
            if (sel === '[data-tour="step-0"]') return [step0Anchor];
            if (sel === '[data-tour="step-1"]') return [step1Anchor];
            return [];
          }),
          elementsFromPoint: vi.fn(() => [currentOccludingEl, step0Anchor]),
        };

        (globalThis as any).window = {
          innerWidth: 1024,
          innerHeight: 640,
          visualViewport: { width: 1024, height: 640 },
          localStorage: { getItem: () => null, setItem: () => {} },
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          matchMedia: vi.fn(() => ({ matches: false })),
        };
        (globalThis as any).document = mockDoc;

        // Render with react-dom/client
        const ReactDOM = await import("react-dom/client");
        if (typeof ReactDOM.createRoot === "function" && originalDocument?.createElement) {
          const domContainer = originalDocument.createElement("div");
          const root = ReactDOM.createRoot(domContainer);
          await React.act(async () => {
            root.render(
              React.createElement(MapGuide, {
                open: true,
                portal: false,
                steps: customSteps,
              })
            );
          });

          // Scroll was requested
          expect(scrollIntoViewMock).toHaveBeenCalled();

          // Dispatch scrollend on scrollParent while still occluded
          await React.act(async () => {
            scrollParent.dispatchEvent(new Event("scrollend"));
          });

          // Should have advanced to step 1
          expect(domContainer.innerHTML).toContain("Paso Uno");
          root.unmount();
        }
      });
    });

    describe("F2-A Franja inferior de la página y anclas tapadas pero alcanzables", () => {
      const originalDocument = (globalThis as any).document;
      const originalWindow = (globalThis as any).window;

      afterEach(() => {
        (globalThis as any).document = originalDocument;
        (globalThis as any).window = originalWindow;
      });

      it("--page-inset-bottom: 120px => getMapInsets().insetBottom === 120 (y gana el mayor si también hay --map-inset-bottom)", () => {
        const styles: Record<string, string> = {
          "--page-inset-bottom": "120px",
        };

        const mockDoc = {
          documentElement: {
            style: {
              getPropertyValue: (name: string) => styles[name] || "",
            },
          },
        };

        (globalThis as any).window = {
          getComputedStyle: vi.fn(() => ({
            getPropertyValue: (name: string) => styles[name] || "",
          })),
        };

        // 1. Only --page-inset-bottom is set to 120px
        const insets1 = getMapInsets(mockDoc as any);
        expect(insets1.insetBottom).toBe(120);

        // 2. Both set, --page-inset-bottom (120px) > --map-inset-bottom (80px) -> 120 wins
        styles["--map-inset-bottom"] = "80px";
        const insets2 = getMapInsets(mockDoc as any);
        expect(insets2.insetBottom).toBe(120);

        // 3. Both set, --map-inset-bottom (150px) > --page-inset-bottom (120px) -> 150 wins
        styles["--map-inset-bottom"] = "150px";
        const insets3 = getMapInsets(mockDoc as any);
        expect(insets3.insetBottom).toBe(150);
      });

      it("ancla completa en pantalla, dentro de un contenedor con desplazamiento, cuyo centro devuelve otro elemento en elementsFromPoint => el paso no se salta, se llama scrollIntoView; al terminar, si ya está libre se muestra, si no avanza", () => {
        let currentOccludingEl: any = { id: "fixed-export-bar", contains: () => false };
        let scrollListeners: Record<string, ((e?: any) => void)[]> = {};

        const scrollParent = {
          style: { overflowY: "auto" },
          scrollHeight: 2000,
          clientHeight: 600,
          parentElement: null,
          addEventListener: vi.fn((ev: string, cb: any) => {
            scrollListeners[ev] = scrollListeners[ev] || [];
            scrollListeners[ev].push(cb);
          }),
          removeEventListener: vi.fn((ev: string, cb: any) => {
            if (scrollListeners[ev]) {
              scrollListeners[ev] = scrollListeners[ev].filter((fn) => fn !== cb);
            }
          }),
          dispatchEvent: vi.fn((e: any) => {
            const handlers = (scrollListeners[e.type] || []).slice();
            handlers.forEach((h) => h(e));
          }),
        };

        const scrollIntoViewMock = vi.fn();
        // Anchor is COMPLETELY inside screen bounds: top 100, bottom 180 in screen of height 640
        const step0Rect = { top: 100, bottom: 180, left: 10, right: 200, width: 190, height: 80 };

        const step0Anchor = {
          parentElement: scrollParent,
          style: { display: "block" },
          isConnected: true,
          scrollIntoView: scrollIntoViewMock,
          getBoundingClientRect: () => step0Rect,
          contains: (el: any) => el === step0Anchor,
        };

        const step1Anchor = {
          parentElement: scrollParent,
          style: { display: "block" },
          isConnected: true,
          scrollIntoView: vi.fn(),
          getBoundingClientRect: () => ({ top: 300, bottom: 360, left: 10, right: 200, width: 190, height: 60 }),
          contains: (el: any) => el === step1Anchor,
        };

        const customSteps = [
          { sel: "step-0", title: "Paso Cero", text: "T0" },
          { sel: "step-1", title: "Paso Uno", text: "T1" },
        ];

        const mockDoc = {
          querySelector: vi.fn((sel: string) => {
            if (sel === '[data-tour="step-0"]') return step0Anchor;
            if (sel === '[data-tour="step-1"]') return step1Anchor;
            return null;
          }),
          querySelectorAll: vi.fn((sel: string) => {
            if (sel === '[data-tour="step-0"]') return [step0Anchor];
            if (sel === '[data-tour="step-1"]') return [step1Anchor];
            return [];
          }),
          elementsFromPoint: vi.fn(() => [currentOccludingEl, step0Anchor]),
        };

        (globalThis as any).window = {
          innerWidth: 1024,
          innerHeight: 640,
          visualViewport: { width: 1024, height: 640 },
          localStorage: { getItem: () => null, setItem: () => {} },
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          matchMedia: vi.fn(() => ({ matches: false })),
        };
        (globalThis as any).document = mockDoc;

        // 1. isAnchorUsable is true even though occluded because it has a scrollParent
        expect(isAnchorUsable(step0Anchor, mockDoc as any)).toBe(true);

        // 2. findVisibleAnchor does NOT skip it
        const match = findVisibleAnchor("step-0", mockDoc);
        expect(match).not.toBeNull();
        expect(match?.el).toBe(step0Anchor);

        // 3. scrollAnchorIntoViewIfNeeded returns true and calls scrollIntoView because it is occluded
        const didScroll = scrollAnchorIntoViewIfNeeded(step0Anchor, mockDoc as any, 160);
        expect(didScroll).toBe(true);
        expect(scrollIntoViewMock).toHaveBeenCalled();

        // 4. Case A: post-scroll, elementsFromPoint returns anchor (free) => shown (isAnchorNotOccluded is true)
        currentOccludingEl = step0Anchor;
        expect(isAnchorNotOccluded(step0Anchor, mockDoc as any)).toBe(true);

        // 5. Case B: post-scroll, elementsFromPoint still returns overlay (still occluded) => advances
        currentOccludingEl = { id: "fixed-export-bar", contains: () => false };
        expect(isAnchorNotOccluded(step0Anchor, mockDoc as any)).toBe(false);
        const nextMatch = getValidStepAndRect(1, mockDoc, customSteps);
        expect(nextMatch).not.toBeNull();
        expect(nextMatch?.index).toBe(1);
        expect(nextMatch?.el).toBe(step1Anchor);
      });

      it("misma ancla tapada sin contenedor con desplazamiento => se salta (como hoy)", () => {
        const occludingEl = { id: "floating-overlay", contains: () => false };

        const anchorWithoutScrollParent = {
          parentElement: null, // NO scroll container
          style: { display: "block" },
          isConnected: true,
          scrollIntoView: vi.fn(),
          getBoundingClientRect: () => ({ top: 100, bottom: 180, left: 10, right: 200, width: 190, height: 80 }),
          contains: (el: any) => el === anchorWithoutScrollParent,
        };

        const step1Anchor = {
          parentElement: null,
          style: { display: "block" },
          isConnected: true,
          scrollIntoView: vi.fn(),
          getBoundingClientRect: () => ({ top: 300, bottom: 360, left: 10, right: 200, width: 190, height: 60 }),
          contains: (el: any) => el === step1Anchor,
        };

        const customSteps = [
          { sel: "step-tapado", title: "Paso Tapado", text: "TT" },
          { sel: "step-libre", title: "Paso Libre", text: "TL" },
        ];

        const mockDoc = {
          querySelector: vi.fn((sel: string) => {
            if (sel === '[data-tour="step-tapado"]') return anchorWithoutScrollParent;
            if (sel === '[data-tour="step-libre"]') return step1Anchor;
            return null;
          }),
          querySelectorAll: vi.fn((sel: string) => {
            if (sel === '[data-tour="step-tapado"]') return [anchorWithoutScrollParent];
            if (sel === '[data-tour="step-libre"]') return [step1Anchor];
            return [];
          }),
          elementsFromPoint: vi.fn((_x: number, y: number) => {
            if (y < 250) {
              return [occludingEl, anchorWithoutScrollParent];
            }
            return [step1Anchor];
          }),
        };

        (globalThis as any).window = {
          innerWidth: 1024,
          innerHeight: 640,
          visualViewport: { width: 1024, height: 640 },
          localStorage: { getItem: () => null, setItem: () => {} },
        };
        (globalThis as any).document = mockDoc;

        // Without scroll parent, isAnchorUsable returns false when occluded
        expect(isAnchorUsable(anchorWithoutScrollParent, mockDoc as any)).toBe(false);

        // findVisibleAnchor skips it
        const match = findVisibleAnchor("step-tapado", mockDoc);
        expect(match).toBeNull();

        // getValidStepAndRect jumps directly to step 1 (step-libre)
        const validStep = getValidStepAndRect(0, mockDoc, customSteps);
        expect(validStep).not.toBeNull();
        expect(validStep?.index).toBe(1);
        expect(validStep?.el).toBe(step1Anchor);
      });

      it("contador con 7 pasos, uno de ellos tapado pero alcanzable => 'n/7' estable en todos los pasos", () => {
        const sevenSteps = Array.from({ length: 7 }, (_, i) => ({
          sel: `step-${i}`,
          title: `Paso ${i + 1}`,
          text: `Texto ${i + 1}`,
        }));

        const scrollParent = {
          style: { overflowY: "auto" },
          scrollHeight: 3000,
          clientHeight: 600,
          parentElement: null,
        };

        const occludingOverlay = { id: "fixed-bottom-bar", contains: () => false };

        // Step 3 is occluded by the fixed bottom bar, but has scrollParent
        const makeEl = (index: number) => {
          const isOccluded = index === 3;
          const anchor: any = {
            parentElement: scrollParent,
            style: { display: "block" },
            isConnected: true,
            scrollIntoView: vi.fn(),
            getBoundingClientRect: () => ({
              top: index * 100 + 50,
              bottom: index * 100 + 110,
              left: 20,
              right: 200,
              width: 180,
              height: 60,
            }),
            contains: (el: any) => el === anchor,
          };
          return { anchor, isOccluded };
        };

        const elements = sevenSteps.map((_, i) => makeEl(i));
        const stepMap: Record<string, any> = {};
        elements.forEach(({ anchor }, i) => {
          stepMap[`[data-tour="step-${i}"]`] = anchor;
        });

        const mockDoc = {
          querySelectorAll: vi.fn((sel: string) => (stepMap[sel] ? [stepMap[sel]] : [])),
          querySelector: vi.fn((sel: string) => stepMap[sel] ?? null),
          elementsFromPoint: vi.fn((_x: number, y: number) => {
            if (y >= 350 && y <= 410) {
              return [occludingOverlay, elements[3].anchor];
            }
            const idx = Math.floor((y - 50) / 100);
            if (idx >= 0 && idx < 7) {
              return [elements[idx].anchor];
            }
            return [];
          }),
        };

        (globalThis as any).window = {
          innerWidth: 1024,
          innerHeight: 768,
          visualViewport: { width: 1024, height: 768 },
          localStorage: { getItem: () => null, setItem: () => {} },
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        };
        (globalThis as any).document = mockDoc;

        // Verify that all 7 step indices are usable (including step 3)
        const usable = getUsableStepIndices(sevenSteps, mockDoc);
        expect(usable).toEqual([0, 1, 2, 3, 4, 5, 6]);
        expect(usable).toHaveLength(7);

        // Verify stable "n/7" counter across each step
        for (let stepIndex = 0; stepIndex < 7; stepIndex++) {
          const html = renderToStaticMarkup(
            React.createElement(MapGuide, {
              open: true,
              steps: sevenSteps,
              initialStep: stepIndex,
            })
          );
          expect(html).toContain(`${stepIndex + 1}/7`);
        }
      });
    });

    describe("F3-A Guía: el documento también es contenedor con desplazamiento y el desplazamiento respeta las barras", () => {
      const originalDocument = (globalThis as any).document;
      const originalWindow = (globalThis as any).window;

      afterEach(() => {
        (globalThis as any).document = originalDocument;
        (globalThis as any).window = originalWindow;
      });

      it("sin contenedor interno y con documento desplazable (scrollingElement.scrollHeight > innerHeight) => getScrollParent devuelve el documento; con documento no desplazable => null", () => {
        const anchor = { parentElement: null };

        const scrollableDoc = {
          scrollingElement: { scrollHeight: 2000 },
          documentElement: { scrollHeight: 2000 },
        };

        const nonScrollableDoc = {
          scrollingElement: { scrollHeight: 700 },
          documentElement: { scrollHeight: 700 },
        };

        (globalThis as any).window = {
          innerHeight: 768,
        };

        // Scrollable document: 2000 > 768 + 1 -> returns scrollingElement
        const scroller = getScrollParent(anchor, scrollableDoc as any);
        expect(scroller).toBe(scrollableDoc.scrollingElement);
        expect(isDocumentScroller(scroller, scrollableDoc as any)).toBe(true);

        // Non-scrollable document: 700 <= 768 + 1 -> returns null
        const nonScroller = getScrollParent(anchor, nonScrollableDoc as any);
        expect(nonScroller).toBeNull();
      });

      it("ancla tapada por una barra fija inferior con documento desplazable => no se salta; se llama window.scrollBy con el delta que la deja centrada en la banda", () => {
        const scrollByMock = vi.fn();
        (globalThis as any).window = {
          innerWidth: 1024,
          innerHeight: 768,
          visualViewport: { width: 1024, height: 768 },
          scrollBy: scrollByMock,
          matchMedia: vi.fn(() => ({ matches: false })),
        };

        const scrollingElement = {
          scrollHeight: 2500,
          scrollTop: 0,
        };

        const styles: Record<string, string> = {
          "--page-inset-bottom": "120px",
        };

        const fixedBottomBar = { id: "fixed-bottom-bar", contains: () => false };

        // Anchor at bottom: top: 700, bottom: 760 (height: 60), center = 730
        const anchorRect = { top: 700, bottom: 760, left: 10, right: 100, width: 90, height: 60 };
        const anchorEl: any = {
          parentElement: null,
          style: { display: "block" },
          isConnected: true,
          getBoundingClientRect: () => anchorRect,
          contains: (el: any) => el === anchorEl,
        };

        const mockDoc = {
          scrollingElement,
          documentElement: {
            scrollHeight: 2500,
            style: {
              getPropertyValue: (name: string) => styles[name] || "",
            },
          },
          querySelector: vi.fn((sel: string) => {
            if (sel === "header") return { getBoundingClientRect: () => ({ bottom: 56 }) };
            if (sel === '[data-tour="target"]') return anchorEl;
            return null;
          }),
          querySelectorAll: vi.fn((sel: string) => {
            if (sel === '[data-tour="target"]') return [anchorEl];
            return [];
          }),
          elementsFromPoint: vi.fn(() => [fixedBottomBar, anchorEl]),
        };

        // 1. Anchor is NOT skipped because document is scrollable
        const usable = isAnchorUsable(anchorEl, mockDoc as any);
        expect(usable).toBe(true);

        const match = findVisibleAnchor("target", mockDoc as any);
        expect(match).not.toBeNull();
        expect(match?.el).toBe(anchorEl);

        // 2. scrollAnchorIntoViewIfNeeded is called and invokes window.scrollBy
        const scrolled = scrollAnchorIntoViewIfNeeded(anchorEl, mockDoc as any, 160);
        expect(scrolled).toBe(true);

        // safeTop = 56, band.top = 56 + 8 = 64
        // insetBottom = 120, band.bottom = 768 - 120 - 8 = 640
        // band.height = 640 - 64 = 576
        // centroBanda = (64 + 640) / 2 = 352
        // anchor fits with balloon (60 + 160 + 10 = 230 <= 576)
        // delta = centroAncla (730) - centroBanda (352) = 378
        expect(scrollByMock).toHaveBeenCalledWith({
          top: 378,
          behavior: "smooth",
        });
      });

      it("ancla con top = -30 y bottom = 95 con barra superior de 57 px => cuenta como utilizable (contador estable)", () => {
        (globalThis as any).window = {
          innerWidth: 1024,
          innerHeight: 768,
          visualViewport: { width: 1024, height: 768 },
          localStorage: { getItem: () => null, setItem: () => {} },
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        };

        const scrollingElement = {
          scrollHeight: 3000,
        };

        const stickyHeader = { id: "sticky-header", contains: () => false };

        const scrolledUpAnchor = {
          parentElement: null,
          style: { display: "block" },
          isConnected: true,
          getBoundingClientRect: () => ({ top: -30, bottom: 95, left: 10, right: 100, width: 90, height: 125 }),
        };

        const otherAnchor = {
          parentElement: null,
          style: { display: "block" },
          isConnected: true,
          getBoundingClientRect: () => ({ top: 300, bottom: 360, left: 10, right: 100, width: 90, height: 60 }),
        };

        const steps = [
          { sel: "step-scrolled", title: "Elige la zona", text: "Texto zona" },
          { sel: "step-other", title: "Paso 2", text: "Texto 2" },
        ];

        const mockDoc = {
          scrollingElement,
          documentElement: {
            scrollHeight: 3000,
            style: {
              getPropertyValue: (name: string) => (name === "--topbar-h" ? "57px" : ""),
            },
          },
          querySelector: vi.fn((sel: string) => {
            if (sel === "header") return { getBoundingClientRect: () => ({ bottom: 57 }) };
            if (sel === '[data-tour="step-scrolled"]') return scrolledUpAnchor;
            if (sel === '[data-tour="step-other"]') return otherAnchor;
            return null;
          }),
          querySelectorAll: vi.fn((sel: string) => {
            if (sel === '[data-tour="step-scrolled"]') return [scrolledUpAnchor];
            if (sel === '[data-tour="step-other"]') return [otherAnchor];
            return [];
          }),
          elementsFromPoint: vi.fn((_x: number, y: number) => {
            if (y < 57) return [stickyHeader, scrolledUpAnchor];
            return [scrolledUpAnchor];
          }),
        };

        (globalThis as any).document = mockDoc;

        // 1. isAnchorUsable returns true for the scrolled-up anchor because document is scrollable
        expect(isAnchorUsable(scrolledUpAnchor, mockDoc as any)).toBe(true);

        // 2. Both steps are counted as usable (stable counter)
        const usable = getUsableStepIndices(steps, mockDoc as any);
        expect(usable).toEqual([0, 1]);
        expect(usable).toHaveLength(2);

        // 3. Counter stays stable when rendering step 2
        const html = renderToStaticMarkup(
          React.createElement(MapGuide, {
            open: true,
            steps,
            initialStep: 1,
          })
        );
        expect(html).toContain("2/2");
      });

      it("ancla alta (1600 px) => el delta deja ancla.top en banda.top (debajo de la barra superior), nunca en 0", () => {
        const scrollByMock = vi.fn();
        (globalThis as any).window = {
          innerWidth: 1024,
          innerHeight: 768,
          visualViewport: { width: 1024, height: 768 },
          scrollBy: scrollByMock,
          matchMedia: vi.fn(() => ({ matches: false })),
        };

        const scrollingElement = {
          scrollHeight: 5000,
          scrollTop: 0,
        };

        // Topbar is 57px: safeTop = 57, band.top = 57 + 8 = 65
        const tallAnchorRect = { top: 200, bottom: 1800, left: 10, right: 300, width: 290, height: 1600 };
        const tallAnchor: any = {
          parentElement: null,
          style: { display: "block" },
          isConnected: true,
          getBoundingClientRect: () => tallAnchorRect,
          contains: (el: any) => el === tallAnchor,
        };

        const mockDoc = {
          scrollingElement,
          documentElement: {
            scrollHeight: 5000,
            style: {
              getPropertyValue: (name: string) => (name === "--topbar-h" ? "57px" : ""),
            },
          },
          querySelector: vi.fn((sel: string) => {
            if (sel === "header") return { getBoundingClientRect: () => ({ bottom: 57 }) };
            return null;
          }),
        };

        const scrolled = scrollAnchorIntoViewIfNeeded(tallAnchor, mockDoc as any, 160);
        expect(scrolled).toBe(true);

        // Band top is max(57, 57) + 8 = 65
        // Tall anchor does not fit with balloon in band (1600 + 160 + 10 = 1770 > band.height)
        // Delta must align ancla.top with banda.top: delta = 200 - 65 = 135
        const callArg = scrollByMock.mock.calls[0][0];
        expect(callArg.top).toBe(135);

        // Verify that ancla.top - delta equals band.top (65), and NOT 0
        const finalTop = tallAnchorRect.top - callArg.top;
        expect(finalTop).toBe(65);
        expect(finalTop).not.toBe(0);
      });
    });
  });
});
