import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AtalayaProvider,
  AtalayaContext,
  useAtalaya,
  resolveExplainOpen,
  type AtalayaContextValue,
} from "../lib/state";
import * as stateModule from "../lib/state";
import { MapTooltip } from "../components/map/MapTooltip";
import { MOCK_META } from "../lib/mocks/meta";
import type { HoverInfo } from "../components/map/AtalayaMap";
import type { RiskItem } from "../lib/types";

describe("Explain Request & Navigation Suite (explainRequest.test.ts)", () => {
  describe("1. requestExplain sets different nonces even for the same zone", () => {
    let origWindow: any;
    let origDoc: any;
    let origActEnv: any;

    beforeEach(() => {
      origWindow = (globalThis as any).window;
      origDoc = (globalThis as any).document;
      origActEnv = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
      (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

      // Mock window.location and history
      (globalThis as any).window = {
        location: {
          pathname: "/",
          search: "",
          href: "http://localhost:3000/",
        },
        history: {
          replaceState: vi.fn(),
        },
        matchMedia: () => ({
          matches: false,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }),
      };
    });

    afterEach(() => {
      (globalThis as any).window = origWindow;
      (globalThis as any).document = origDoc;
      (globalThis as any).IS_REACT_ACT_ENVIRONMENT = origActEnv;
      vi.restoreAllMocks();
    });

    function setupMinimalDOM() {
      class FakeElement {}
      class FakeHTMLElement extends FakeElement {}

      const defaultView: any = {
        Element: FakeElement,
        HTMLElement: FakeHTMLElement,
        HTMLInputElement: class extends FakeHTMLElement {},
        HTMLIFrameElement: class extends FakeHTMLElement {},
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn().mockReturnValue(true),
        matchMedia: vi.fn().mockReturnValue({
          matches: false,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }),
        location: {
          pathname: "/",
          search: "",
          href: "http://localhost:3000/",
          replace: vi.fn(),
        },
        history: {
          replaceState: vi.fn(),
        },
      };

      const fakeDoc: any = {
        nodeType: 9,
        defaultView,
        createElement: (tag: string) => {
          const el: any = {
            tagName: tag.toUpperCase(),
            nodeType: 1,
            ownerDocument: fakeDoc,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            appendChild: vi.fn(),
            removeChild: vi.fn(),
            insertBefore: vi.fn(),
            setAttribute: vi.fn(),
            removeAttribute: vi.fn(),
            focus: vi.fn(),
            getBoundingClientRect: () => ({ height: 50, width: 100, top: 0, bottom: 50, left: 0, right: 100 }),
            style: {},
            childNodes: [],
          };
          return el;
        },
        createElementNS: (_ns: string, tag: string) => fakeDoc.createElement(tag),
        createTextNode: () => ({ nodeType: 3 }),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        createComment: () => ({ nodeType: 8 }),
        activeElement: null,
        body: { classList: { add: vi.fn(), remove: vi.fn() } },
        documentElement: {
          dataset: {},
          style: { setProperty: vi.fn(), getPropertyValue: vi.fn() },
        },
      };

      (globalThis as any).document = fakeDoc;
      (globalThis as any).window = defaultView;
      (globalThis as any).self = defaultView;
      const container = fakeDoc.createElement("div");
      container.ownerDocument = fakeDoc;
      return container;
    }

    it("calling requestExplain twice for the exact same zone produces distinct nonces", async () => {
      const container = setupMinimalDOM();
      let capturedCtx: AtalayaContextValue | null = null;

      function Probe() {
        capturedCtx = useAtalaya();
        return null;
      }

      const ReactDOM = await import("react-dom/client");
      const root = ReactDOM.createRoot(container);

      await React.act(async () => {
        root.render(
          React.createElement(AtalayaProvider, null, React.createElement(Probe))
        );
      });

      expect(capturedCtx).not.toBeNull();
      expect(capturedCtx!.explainRequest).toBeNull();

      // First call for unit "02" (Baja California)
      await React.act(async () => {
        capturedCtx!.requestExplain!({
          unitId: "02",
          name: "Baja California",
          level: "state",
        });
      });

      const firstRequest = capturedCtx!.explainRequest;
      expect(firstRequest).not.toBeNull();
      expect(firstRequest?.unitId).toBe("02");
      expect(firstRequest?.name).toBe("Baja California");
      expect(firstRequest?.level).toBe("state");
      expect(typeof firstRequest?.nonce).toBe("number");
      const firstNonce = firstRequest!.nonce;

      // Second call for the EXACT same unit "02"
      await React.act(async () => {
        capturedCtx!.requestExplain!({
          unitId: "02",
          name: "Baja California",
          level: "state",
        });
      });

      const secondRequest = capturedCtx!.explainRequest;
      expect(secondRequest).not.toBeNull();
      expect(secondRequest?.unitId).toBe("02");
      const secondNonce = secondRequest!.nonce;

      // Nonces must be strictly distinct
      expect(secondNonce).not.toBe(firstNonce);
      expect(secondNonce).toBeGreaterThan(firstNonce);

      // clearExplainRequest resets the request
      await React.act(async () => {
        capturedCtx!.clearExplainRequest!();
      });
      expect(capturedCtx!.explainRequest).toBeNull();
    });
  });

  describe("2. resolveExplainOpen for layout modes", () => {
    it("compact-portrait: advances snap from peek to half", () => {
      const res = resolveExplainOpen("compact-portrait", "peek", false);
      expect(res.tab).toBe("chat");
      expect(res.snap).toBe("half");
      expect(res.openDrawer).toBeUndefined();
    });

    it("compact-portrait: advances snap from half to full", () => {
      const res = resolveExplainOpen("compact-portrait", "half", false);
      expect(res.tab).toBe("chat");
      expect(res.snap).toBe("full");
      expect(res.openDrawer).toBeUndefined();
    });

    it("compact-portrait: keeps snap full when already full", () => {
      const res = resolveExplainOpen("compact-portrait", "full", false);
      expect(res.tab).toBe("chat");
      expect(res.snap).toBe("full");
    });

    it("compact-landscape: opens drawer and sets tab to chat", () => {
      const res = resolveExplainOpen("compact-landscape", "peek", false);
      expect(res.tab).toBe("chat");
      expect(res.openDrawer).toBe(true);
      expect(res.snap).toBeUndefined();
    });

    it("desktop: uncollapses panel when panel is collapsed", () => {
      const res = resolveExplainOpen("desktop", "peek", true);
      expect(res.tab).toBe("chat");
      expect(res.openPanel).toBe(true);
      expect(res.openDrawer).toBeUndefined();
      expect(res.snap).toBeUndefined();
    });

    it("desktop: preserves panel when already open", () => {
      const res = resolveExplainOpen("desktop", "peek", false);
      expect(res.tab).toBe("chat");
      expect(res.openPanel).toBeUndefined();
    });
  });

  describe("3. MapTooltip explain button & click interaction", () => {
    const baseItem: RiskItem = {
      id: "02001",
      name: "Ensenada",
      level: "mun",
      ent: "02",
      lista_nominal: 350000,
      last_year: 2024,
      last_participation: 0.42,
      pred_participation: 0.393,
      pred_abstention: 0.607,
      pred_low: 0.58,
      pred_high: 0.63,
      trend_pp: -1.2,
      risk_score: 82,
      category: "rojo",
    };

    const hover: HoverInfo = {
      id: "02001",
      level: "mun",
      name: "Ensenada",
      ent: "02",
      x: 200,
      y: 150,
      base: baseItem,
      alt: null,
      item: baseItem,
    };

    function findExplainButton(node: any): any {
      if (!node) return null;
      if (node.props?.["aria-label"]?.startsWith("Explicar por qué")) {
        return node;
      }
      if (Array.isArray(node)) {
        for (const child of node) {
          const found = findExplainButton(child);
          if (found) return found;
        }
      }
      if (node.props?.children) {
        return findExplainButton(node.props.children);
      }
      return null;
    }

    it("renders primary button '¿Por qué? Explícame' with brand magenta #b5186b and aria-label", () => {
      const mockContext: Partial<AtalayaContextValue> = {
        scenario: "base",
        meta: MOCK_META,
        selectRegion: vi.fn(),
        selectState: vi.fn(),
        requestExplain: vi.fn(),
      };

      const html = renderToStaticMarkup(
        React.createElement(
          AtalayaContext.Provider,
          { value: mockContext as AtalayaContextValue },
          React.createElement(MapTooltip, { hover })
        )
      );

      // Button content and branding
      expect(html).toContain("¿Por qué? Explícame");
      expect(html).toContain('aria-label="Explicar por qué Ensenada tiene este nivel de riesgo"');
      expect(html).toContain("#b5186b");
      expect(html).toContain("focus-visible:ring-2");
      // Assistant hint
      expect(html).toContain("Te lo explico en palabras sencillas en el asistente");
      // Diagnostic button alongside
      expect(html).toContain("Ver diagnóstico");
    });

    it("calls requestExplain with { unitId, name, level } when button is clicked", () => {
      const mockRequestExplain = vi.fn();
      const mockContext: Partial<AtalayaContextValue> = {
        scenario: "base",
        meta: MOCK_META,
        selectRegion: vi.fn(),
        selectState: vi.fn(),
        requestExplain: mockRequestExplain,
      };

      vi.spyOn(stateModule, "useAtalaya").mockReturnValue(mockContext as AtalayaContextValue);

      const tree = MapTooltip({ hover });
      const explainBtn = findExplainButton(tree);

      expect(explainBtn).not.toBeNull();
      expect(explainBtn.props["aria-label"]).toBe("Explicar por qué Ensenada tiene este nivel de riesgo");

      // Click the button
      const stopPropagation = vi.fn();
      explainBtn.props.onClick({ stopPropagation });

      expect(stopPropagation).toHaveBeenCalled();
      expect(mockRequestExplain).toHaveBeenCalledTimes(1);
      expect(mockRequestExplain).toHaveBeenCalledWith({
        unitId: "02001",
        name: "Ensenada",
        level: "mun",
      });

      vi.restoreAllMocks();
    });

    it("also triggers onSelect when onSelect prop is provided to MapTooltip", () => {
      const mockRequestExplain = vi.fn();
      const mockOnSelect = vi.fn();
      const mockContext: Partial<AtalayaContextValue> = {
        scenario: "base",
        meta: MOCK_META,
        selectRegion: vi.fn(),
        selectState: vi.fn(),
        requestExplain: mockRequestExplain,
      };

      vi.spyOn(stateModule, "useAtalaya").mockReturnValue(mockContext as AtalayaContextValue);

      const tree = MapTooltip({ hover, onSelect: mockOnSelect });
      const explainBtn = findExplainButton(tree);

      explainBtn.props.onClick({ stopPropagation: vi.fn() });

      expect(mockRequestExplain).toHaveBeenCalledWith({
        unitId: "02001",
        name: "Ensenada",
        level: "mun",
      });
      expect(mockOnSelect).toHaveBeenCalledWith(hover);

      vi.restoreAllMocks();
    });
  });
});
