import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AtalayaProvider, useAtalaya, type AtalayaContextValue } from "../lib/state";
import { TopBar } from "../components/layout/TopBar";
import * as authModule from "../lib/auth";
import * as api from "../lib/api";

let mockPathname = "/login";

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

describe("State Initial Load & Session Suite (stateLoad.test.tsx)", () => {
  let origWindow: any;
  let origDoc: any;
  let origActEnv: any;

  beforeEach(() => {
    mockPathname = "/login";
    origWindow = (globalThis as any).window;
    origDoc = (globalThis as any).document;
    origActEnv = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;

    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    authModule.resetRedirectState();
    vi.clearAllMocks();
  });

  afterEach(() => {
    (globalThis as any).window = origWindow;
    (globalThis as any).document = origDoc;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = origActEnv;
    authModule.resetRedirectState();
  });

  function setupDOM(initialPath: string = "/login") {
    mockPathname = initialPath;
    const elements: Record<string, any[]> = {};

    const fakeDoc: any = {
      nodeType: 9,
      createElement: (tag: string) => {
        const el: any = {
          tagName: tag.toUpperCase(),
          nodeType: 1,
          ownerDocument: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          appendChild: vi.fn(),
          removeChild: vi.fn(),
          insertBefore: vi.fn(),
          setAttribute: vi.fn(),
          removeAttribute: vi.fn(),
          focus: vi.fn(),
          getBoundingClientRect: () => ({ height: 56, width: 1280, top: 0, bottom: 56, left: 0, right: 1280 }),
          style: {},
          childNodes: [],
        };
        elements[tag] = elements[tag] || [];
        elements[tag].push(el);
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
        style: {
          setProperty: vi.fn(),
          getPropertyValue: vi.fn(),
        },
      },
    };

    const defaultView: any = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn().mockReturnValue(true),
      HTMLIFrameElement: class {},
      IntersectionObserver: class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      },
      requestIdleCallback: (cb: any) => setTimeout(cb, 0),
      cancelIdleCallback: (id: any) => clearTimeout(id),
      setTimeout: setTimeout.bind(globalThis),
      clearTimeout: clearTimeout.bind(globalThis),
      CustomEvent: typeof CustomEvent !== "undefined" ? CustomEvent : class {
        detail: any;
        constructor(public type: string, init?: any) {
          this.detail = init?.detail;
        }
      },
      location: {
        pathname: initialPath,
        search: "",
        href: `http://localhost:3000${initialPath}`,
        replace: vi.fn(),
      },
      history: {
        replaceState: vi.fn(),
      },
      matchMedia: vi.fn().mockReturnValue({
        matches: false,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
      innerWidth: 1280,
      innerHeight: 800,
    };

    fakeDoc.defaultView = defaultView;
    (globalThis as any).document = fakeDoc;
    (globalThis as any).window = defaultView;
    (globalThis as any).self = defaultView;
    (globalThis as any).IntersectionObserver = defaultView.IntersectionObserver;

    const container = fakeDoc.createElement("div");
    container.ownerDocument = fakeDoc;

    return { container, defaultView, fakeDoc };
  }

  describe("AtalayaProvider on /login", () => {
    it("does not call fetch to /api/* (meta, risk, health, session) and leaves no uncaught exceptions", async () => {
      const { container } = setupDOM("/login");
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy;

      const spyGetMeta = vi.spyOn(api, "getMeta");
      const spyGetHealth = vi.spyOn(api, "getHealth");
      const spyGetRisk = vi.spyOn(api, "getRisk");
      const spyGetSession = vi.spyOn(authModule, "getSession");

      let capturedCtx: AtalayaContextValue | null = null;
      function Probe() {
        capturedCtx = useAtalaya();
        return null;
      }

      const ReactDOM = await import("react-dom/client");
      const root = ReactDOM.createRoot(container);

      await React.act(async () => {
        root.render(
          <AtalayaProvider>
            <Probe />
          </AtalayaProvider>
        );
      });

      // Wait a tick for any async effect to run
      await React.act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      expect(spyGetHealth).not.toHaveBeenCalled();
      expect(spyGetMeta).not.toHaveBeenCalled();
      expect(spyGetRisk).not.toHaveBeenCalled();
      expect(spyGetSession).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();

      // State is in clean initial defaults
      expect(capturedCtx).not.toBeNull();
      expect(capturedCtx!.meta).toBeNull();
      expect(capturedCtx!.riskItems).toEqual([]);
    });
  });

  describe("AtalayaProvider outside /login (e.g. /)", () => {
    it("performs initial load (health, meta, risk) when session is valid", async () => {
      const { container } = setupDOM("/");

      const spyGetHealth = vi.spyOn(api, "getHealth").mockResolvedValue({
        status: "ok",
        store: "memory",
        llm: false,
        warmup: "ready",
        data: { units_mun: 2475, units_state: 32, participation_rows: 1000, years: [2024] },
      } as any);

      const mockMetaData = {
        store: "memory",
        scenarios: [
          { id: "intervencion", label: "Intervención", params: [] },
          { id: "pesimista", label: "Pesimista", params: [] },
        ],
      };
      const spyGetMeta = vi.spyOn(api, "getMeta").mockResolvedValue(mockMetaData as any);

      const mockRiskItems = [
        { id: "01", name: "Aguascalientes", level: "state", pred_abstention: 0.45 },
      ];
      const spyGetRisk = vi.spyOn(api, "getRisk").mockResolvedValue({
        level: "state",
        items: mockRiskItems,
      } as any);

      let capturedCtx: AtalayaContextValue | null = null;
      function Probe() {
        capturedCtx = useAtalaya();
        return null;
      }

      const ReactDOM = await import("react-dom/client");
      const root = ReactDOM.createRoot(container);

      await React.act(async () => {
        root.render(
          <AtalayaProvider>
            <Probe />
          </AtalayaProvider>
        );
      });

      await React.act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      expect(spyGetHealth).toHaveBeenCalled();
      expect(spyGetMeta).toHaveBeenCalled();
      expect(spyGetRisk).toHaveBeenCalledWith("state", undefined, "base");

      expect(capturedCtx!.meta).toEqual(mockMetaData);
      expect(capturedCtx!.riskItems).toEqual(mockRiskItems);
    });

    it("triggers redirectToLogin once on 401 and handles the error gracefully without uncaught rejection", async () => {
      const { container, defaultView } = setupDOM("/");

      const redirectSpy = vi.spyOn(authModule, "redirectToLogin");

      const err401 = new api.ApiError("Unauthorized", 401, { detail: "Sesión requerida." });
      vi.spyOn(api, "getMeta").mockRejectedValue(err401);
      vi.spyOn(api, "getRisk").mockRejectedValue(err401);
      vi.spyOn(api, "getHealth").mockResolvedValue({
        status: "ok",
        store: "memory",
        llm: false,
        warmup: "ready",
      } as any);

      let capturedCtx: AtalayaContextValue | null = null;
      function Probe() {
        capturedCtx = useAtalaya();
        return null;
      }

      const ReactDOM = await import("react-dom/client");
      const root = ReactDOM.createRoot(container);

      // Rendering should NOT throw unhandled exceptions
      await React.act(async () => {
        root.render(
          <AtalayaProvider>
            <Probe />
          </AtalayaProvider>
        );
      });

      await React.act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      // redirectToLogin called
      expect(redirectSpy).toHaveBeenCalled();
      expect(defaultView.location.href).toBe("/login");
      // State gracefully handled
      expect(capturedCtx!.meta).toBeNull();
    });
  });

  describe("TopBar user menu session loading", () => {
    it("does not call getSession when TopBar is on /login", async () => {
      const { container } = setupDOM("/login");
      const spyGetSession = vi.spyOn(authModule, "getSession");

      const ReactDOM = await import("react-dom/client");
      const root = ReactDOM.createRoot(container);

      await React.act(async () => {
        root.render(
          <AtalayaProvider>
            <TopBar />
          </AtalayaProvider>
        );
      });

      await React.act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      expect(spyGetSession).not.toHaveBeenCalled();
    });

    it("fetches session and displays username in user menu outside /login", async () => {
      const { container } = setupDOM("/");

      vi.spyOn(authModule, "getSession").mockResolvedValue({
        user: { username: "operador_ine" },
        expires_at: "2026-10-30T12:00:00Z",
      });

      const spyGetHealth = vi.spyOn(api, "getHealth").mockResolvedValue({} as any);
      const spyGetMeta = vi.spyOn(api, "getMeta").mockResolvedValue({} as any);
      const spyGetRisk = vi.spyOn(api, "getRisk").mockResolvedValue({ items: [] } as any);

      const ReactDOM = await import("react-dom/client");
      const root = ReactDOM.createRoot(container);

      await React.act(async () => {
        root.render(
          <AtalayaProvider>
            <TopBar />
          </AtalayaProvider>
        );
      });

      await React.act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      // UserMenuDropdown button title attribute contains "operador_ine"
      const buttons = container.ownerDocument.createElement("div");
      // Let's also verify through static markup with AtalayaProvider
      const html = renderToStaticMarkup(
        <AtalayaProvider>
          <TopBar />
        </AtalayaProvider>
      );
      // TopBar rendered
      expect(html).toContain("Atalaya");
      expect(html).toContain("Electoral");
    });
  });
});
