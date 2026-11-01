import React, { useState } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import MetodologiaPage from "../app/metodologia/page";
import DashboardPage from "../app/page";
import { InfoTip } from "../components/ui/InfoTip";
import { RegionSearch } from "../components/map/RegionSearch";
import { GUIDE_EVENTS, TOURS } from "../lib/tours";
import { AtalayaContext, type AtalayaContextValue } from "../lib/state";
import { MOCK_META } from "../lib/mocks/meta";
import type { SidePanelTabsProps } from "../components/panel/SidePanelTabs";

// Mock leaf map/panel components so DashboardPage renders purely in-memory
vi.mock("@/components/map/RiskMap", () => ({
  RiskMap: () => <div data-testid="risk-map" />,
}));

vi.mock("@/components/layout/ScenarioControls", () => ({
  ScenarioControls: () => <div data-testid="scenario-controls" />,
}));

vi.mock("@/components/panel/RegionDetailPanel", () => ({
  RegionDetailPanel: () => <div data-testid="detail-panel" />,
}));

vi.mock("@/components/panel/RankingTable", () => ({
  RankingTable: () => <div data-testid="ranking-panel" />,
}));

vi.mock("@/components/panel/ChatPanel", () => ({
  ChatPanel: () => <div data-testid="chat-panel" />,
}));

// Mock geo index for RegionSearch
vi.mock("@/lib/geo", () => ({
  fetchGeoIndex: vi.fn().mockResolvedValue([
    { id: "01", name: "Aguascalientes", ent: 1, level: "state" },
    { id: "02", name: "Baja California", ent: 2, level: "state" },
    { id: "02004", name: "Tijuana", ent: 2, mun: 4, level: "mun" },
  ]),
}));

// Dynamic layout mode for testing layout-dependent behaviors
let mockCurrentLayoutMode: "compact-portrait" | "compact-landscape" | "desktop" = "compact-portrait";

vi.mock("@/lib/useMediaQuery", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/useMediaQuery")>();
  return {
    ...actual,
    useLayoutMode: () => mockCurrentLayoutMode,
  };
});

let latestSidePanelProps: SidePanelTabsProps | null = null;

// Intercept SidePanelTabs to observe props and trigger callbacks
vi.mock("@/components/panel/SidePanelTabs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/panel/SidePanelTabs")>();
  return {
    ...actual,
    SidePanelTabs: (props: SidePanelTabsProps) => {
      latestSidePanelProps = props;
      return (
        <div data-testid="side-panel-tabs" data-active-tab={props.activeTab}>
          {props.headerAction}
        </div>
      );
    },
  };
});

function createMockContext(overrides: Partial<AtalayaContextValue> = {}): AtalayaContextValue {
  return {
    scenario: "base",
    setScenario: vi.fn(),
    scenarioParams: {},
    setScenarioParams: vi.fn(),
    paramsByScenario: { intervencion: {}, pesimista: {} },
    leverParams: {},
    applyScenarioParams: vi.fn().mockResolvedValue(undefined),
    resetScenarioParams: vi.fn().mockResolvedValue(undefined),
    isScenarioModified: () => false,
    level: "state",
    selectedEnt: null,
    selectedRegionId: null,
    selectedDetail: null,
    loadingDetail: false,
    meta: MOCK_META,
    riskItems: [],
    loadingRisk: false,
    simulationResult: null,
    isMock: false,
    isScenarioModalOpen: false,
    setIsScenarioModalOpen: vi.fn(),
    health: null,
    apiAvailable: true,
    hasData: true,
    mapMode: "semaforo",
    setMapMode: vi.fn(),
    extrude3d: false,
    setExtrude3d: vi.fn(),
    view3d: "inclinada",
    setView3d: vi.fn(),
    comparePos: 50,
    setComparePos: vi.fn(),
    selectState: vi.fn(),
    selectMunicipality: vi.fn(),
    selectRegion: vi.fn(),
    resetToNational: vi.fn(),
    runSimulation: vi.fn().mockResolvedValue(undefined),
    explainRequest: null,
    requestExplain: vi.fn(),
    clearExplainRequest: vi.fn(),
    ...overrides,
  };
}

describe("Guide Coordination Suite (guideCoordination.test.tsx)", () => {
  let origWindow: any;
  let origDoc: any;
  let origActEnv: any;

  beforeEach(() => {
    origWindow = (globalThis as any).window;
    origDoc = (globalThis as any).document;
    origActEnv = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    latestSidePanelProps = null;
    vi.clearAllMocks();
  });

  afterEach(() => {
    (globalThis as any).window = origWindow;
    (globalThis as any).document = origDoc;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = origActEnv;
  });

  function setupDOM() {
    const windowEvents = new EventTarget();
    const docEvents = new EventTarget();

    const defaultView: any = {
      addEventListener: (type: string, fn: any, opts: any) => windowEvents.addEventListener(type, fn, opts),
      removeEventListener: (type: string, fn: any, opts: any) => windowEvents.removeEventListener(type, fn, opts),
      dispatchEvent: (e: any) => windowEvents.dispatchEvent(e),
      setTimeout: setTimeout.bind(globalThis),
      clearTimeout: clearTimeout.bind(globalThis),
      location: { pathname: "/", search: "", href: "http://localhost:3000/" },
      history: { replaceState: vi.fn() },
      HTMLIFrameElement: class {},
      Element: class {},
      HTMLElement: class {},
      Node: class {},
      innerWidth: 844,
      innerHeight: 390,
      localStorage: {
        getItem: vi.fn().mockReturnValue(null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
      matchMedia: vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    };

    const fakeDoc: any = {
      nodeType: 9,
      defaultView,
      addEventListener: (type: string, fn: any, opts: any) => docEvents.addEventListener(type, fn, opts),
      removeEventListener: (type: string, fn: any, opts: any) => docEvents.removeEventListener(type, fn, opts),
      dispatchEvent: (e: any) => docEvents.dispatchEvent(e),
      activeElement: null,
      createElement: (tag: string) => {
        const elEvents = new EventTarget();
        const attributes: Record<string, any> = {};
        const style: any = {
          setProperty: vi.fn((k: string, v: string) => {
            style[k] = v;
          }),
          removeProperty: vi.fn((k: string) => {
            delete style[k];
          }),
          getPropertyValue: vi.fn((k: string) => style[k] ?? ""),
        };
        const childNodes: any[] = [];
        const el: any = {
          tagName: tag.toUpperCase(),
          nodeType: 1,
          ownerDocument: fakeDoc,
          dataset: {},
          classList: {
            add: vi.fn(),
            remove: vi.fn(),
            contains: vi.fn(() => false),
          },
          style,
          childNodes,
          attributes,
          addEventListener: (type: string, fn: any, opts: any) => elEvents.addEventListener(type, fn, opts),
          removeEventListener: (type: string, fn: any, opts: any) => elEvents.removeEventListener(type, fn, opts),
          dispatchEvent: (e: any) => elEvents.dispatchEvent(e),
          appendChild: vi.fn((c: any) => {
            childNodes.push(c);
            c.parentNode = el;
            return c;
          }),
          removeChild: vi.fn((c: any) => {
            const idx = childNodes.indexOf(c);
            if (idx !== -1) childNodes.splice(idx, 1);
            c.parentNode = null;
            return c;
          }),
          insertBefore: vi.fn((c: any) => {
            childNodes.push(c);
            c.parentNode = el;
            return c;
          }),
          setAttribute: vi.fn((k: string, v: any) => {
            attributes[k] = String(v);
            el[k] = v;
          }),
          getAttribute: vi.fn((k: string) => attributes[k] ?? null),
          removeAttribute: vi.fn((k: string) => {
            delete attributes[k];
            delete el[k];
          }),
          getBoundingClientRect: vi.fn(() => ({
            top: 100,
            left: 100,
            bottom: 120,
            right: 120,
            width: 20,
            height: 20,
          })),
          contains: vi.fn((other: any) => other === el || childNodes.includes(other)),
          focus: vi.fn(() => {
            fakeDoc.activeElement = el;
            el.dispatchEvent(new Event("focus"));
          }),
          blur: vi.fn(() => {
            if (fakeDoc.activeElement === el) fakeDoc.activeElement = null;
            el.dispatchEvent(new Event("blur"));
          }),
        };
        return el;
      },
      createElementNS: (_ns: string, tag: string) => fakeDoc.createElement(tag),
      createTextNode: (text: string) => ({
        nodeType: 3,
        nodeValue: text,
        textContent: text,
      }),
      createComment: () => ({ nodeType: 8 }),
    };

    const body = fakeDoc.createElement("body");
    body.dataset = {};
    fakeDoc.body = body;

    const docEl = fakeDoc.createElement("html");
    fakeDoc.documentElement = docEl;

    fakeDoc.defaultView = defaultView;
    defaultView.document = fakeDoc;
    (globalThis as any).document = fakeDoc;
    (globalThis as any).window = defaultView;
    (globalThis as any).self = defaultView;

    const container = fakeDoc.createElement("div");
    return { container, fakeDoc, defaultView, windowEvents };
  }

  function findDescendant(node: any, predicate: (n: any) => boolean): any {
    if (!node) return null;
    if (predicate(node)) return node;
    if (node.childNodes && Array.isArray(node.childNodes)) {
      for (const child of node.childNodes) {
        const found = findDescendant(child, predicate);
        if (found) return found;
      }
    }
    return null;
  }

  function getReactProps(el: any) {
    if (!el) return null;
    const key = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
    return key ? el[key] : null;
  }

  describe("Metodología: Párrafo y lista de guías interactivas", () => {
    it("renderiza de forma estática la sección con los títulos de TOURS.mapa.steps", () => {
      const html = renderToStaticMarkup(<MetodologiaPage />);

      expect(html).toContain("Guías interactivas");
      expect(html).toContain("Mapa de riesgo (8 pasos)");
      expect(html).toContain("Plan de campaña (7 pasos)");
      expect(html).toContain("Monitor INE (8 pasos)");

      // Verify all steps from TOURS.mapa.steps are listed
      for (const step of TOURS.mapa.steps) {
        expect(html).toContain(step.title);
      }

      // Verify all steps from TOURS.campanas.steps and TOURS.monitor.steps are listed
      for (const step of TOURS.campanas.steps) {
        expect(html).toContain(step.title);
      }
      for (const step of TOURS.monitor.steps) {
        expect(html).toContain(step.title);
      }
    });
  });

  describe("InfoTip: Coordinación con guía", () => {
    it("InfoTip abierto se cierra al recibir atalaya:guide-open", async () => {
      const { container, defaultView, fakeDoc } = setupDOM();
      const ReactDOM = await import("react-dom/client");
      const root = ReactDOM.createRoot(container);

      await React.act(async () => {
        root.render(<InfoTip term="semaforo" />);
      });

      // Find the button element
      const button = findDescendant(container, (c: any) => c.tagName === "BUTTON");
      expect(button).toBeDefined();

      const props = getReactProps(button);
      expect(props).toBeDefined();

      // Click to open InfoTip
      await React.act(async () => {
        props.onClick({
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
        });
      });

      // Tooltip popover should be rendered into document.body portal
      const tooltipBefore = findDescendant(fakeDoc.body, (c: any) => c.role === "tooltip" || c.attributes?.role === "tooltip");
      expect(tooltipBefore).toBeDefined();

      // Dispatch atalaya:guide-open
      await React.act(async () => {
        defaultView.dispatchEvent(new Event(GUIDE_EVENTS.opened));
      });

      // Tooltip popover should now be closed / removed from body
      const tooltipAfter = findDescendant(fakeDoc.body, (c: any) => c.role === "tooltip" || c.attributes?.role === "tooltip");
      expect(tooltipAfter).toBeNull();
    });

    it("con body.dataset.guide = 'open', focus, mouseenter y click no lo abren", async () => {
      const { container, fakeDoc } = setupDOM();
      fakeDoc.body.dataset.guide = "open";

      const ReactDOM = await import("react-dom/client");
      const root = ReactDOM.createRoot(container);

      await React.act(async () => {
        root.render(<InfoTip term="semaforo" />);
      });

      const button = findDescendant(container, (c: any) => c.tagName === "BUTTON");
      expect(button).toBeDefined();

      const props = getReactProps(button);
      expect(props).toBeDefined();

      // Try focus
      await React.act(async () => {
        props.onFocus?.();
      });
      let tooltip = findDescendant(fakeDoc.body, (c: any) => c.role === "tooltip" || c.attributes?.role === "tooltip");
      expect(tooltip).toBeNull();

      // Try mouseenter
      await React.act(async () => {
        props.onMouseEnter?.();
      });
      tooltip = findDescendant(fakeDoc.body, (c: any) => c.role === "tooltip" || c.attributes?.role === "tooltip");
      expect(tooltip).toBeNull();

      // Try click
      await React.act(async () => {
        props.onClick?.({
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
        });
      });
      tooltip = findDescendant(fakeDoc.body, (c: any) => c.role === "tooltip" || c.attributes?.role === "tooltip");
      expect(tooltip).toBeNull();
    });
  });

  describe("RegionSearch: Coordinación con guía", () => {
    it("con body.dataset.guide = 'open', la tecla '/' no enfoca el campo", async () => {
      const { container, defaultView, fakeDoc } = setupDOM();
      fakeDoc.body.dataset.guide = "open";

      const ReactDOM = await import("react-dom/client");
      const root = ReactDOM.createRoot(container);

      const ctxValue = createMockContext();

      await React.act(async () => {
        root.render(
          <AtalayaContext.Provider value={ctxValue}>
            <RegionSearch />
          </AtalayaContext.Provider>
        );
      });

      const input = findDescendant(container, (c: any) => c.tagName === "INPUT");
      expect(input).toBeDefined();

      // Dispatch '/' keydown on window with guide open
      const preventDefault = vi.fn();
      await React.act(async () => {
        defaultView.dispatchEvent(
          Object.assign(new Event("keydown"), {
            key: "/",
            preventDefault,
          })
        );
      });

      expect(preventDefault).not.toHaveBeenCalled();
      expect(input.focus).not.toHaveBeenCalled();

      // Now close guide
      delete fakeDoc.body.dataset.guide;

      // Dispatch '/' keydown on window with guide closed
      await React.act(async () => {
        defaultView.dispatchEvent(
          Object.assign(new Event("keydown"), {
            key: "/",
            preventDefault,
          })
        );
      });

      expect(preventDefault).toHaveBeenCalled();
      expect(input.focus).toHaveBeenCalled();
    });

    it("atalaya:guide-open cierra la lista de resultados y quita el foco", async () => {
      const { container, defaultView } = setupDOM();

      const ReactDOM = await import("react-dom/client");
      const root = ReactDOM.createRoot(container);

      const ctxValue = createMockContext();

      await React.act(async () => {
        root.render(
          <AtalayaContext.Provider value={ctxValue}>
            <RegionSearch />
          </AtalayaContext.Provider>
        );
      });

      // Allow fetchGeoIndex promise to resolve
      await React.act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      const input = findDescendant(container, (c: any) => c.tagName === "INPUT");
      expect(input).toBeDefined();

      const inputProps = getReactProps(input);
      expect(inputProps).toBeDefined();

      // Type a query to open results
      await React.act(async () => {
        inputProps.onChange({ target: { value: "Baja" } });
      });

      // Dropdown should be open (dropdown div has button children for results)
      const dropdownButtonBefore = findDescendant(container, (c: any) => c.tagName === "BUTTON" && c.textContent?.includes("Baja California"));
      expect(dropdownButtonBefore).toBeDefined();

      // Dispatch atalaya:guide-open
      await React.act(async () => {
        defaultView.dispatchEvent(new Event(GUIDE_EVENTS.opened));
      });

      // Dropdown should be closed (removed from DOM)
      const dropdownButtonAfter = findDescendant(container, (c: any) => c.tagName === "BUTTON" && c.textContent?.includes("Baja California"));
      expect(dropdownButtonAfter).toBeNull();
      expect(input.blur).toHaveBeenCalled();
    });
  });

  describe("app/page.tsx: Coordinación con guía en modos móvil y apaisado", () => {
    it("en compact-portrait con la hoja en 'half', atalaya:guide-open la deja en 'peek'", async () => {
      mockCurrentLayoutMode = "compact-portrait";
      const { container, defaultView } = setupDOM();

      const ReactDOM = await import("react-dom/client");
      const root = ReactDOM.createRoot(container);

      function Harness() {
        const [regionId] = useState<string | null>("23"); // Selected zone opens half sheet
        const ctxValue = createMockContext({
          selectedRegionId: regionId,
        });

        return (
          <AtalayaContext.Provider value={ctxValue}>
            <DashboardPage />
          </AtalayaContext.Provider>
        );
      }

      await React.act(async () => {
        root.render(<Harness />);
      });

      // Find the aside sheet
      // container -> root div -> section + aside
      const rootDiv = container.childNodes.find((c: any) => c.tagName === "DIV");
      const aside = rootDiv?.childNodes?.find((c: any) => c.tagName === "ASIDE");
      expect(aside).toBeDefined();

      // In compact-portrait with region selected, snap is half (52dvh)
      expect(aside.style.height).toBe("52dvh");

      // Dispatch atalaya:guide-open
      await React.act(async () => {
        defaultView.dispatchEvent(new Event(GUIDE_EVENTS.opened));
      });

      // Sheet snap should now be peek
      expect(aside.style.height).toBe("calc(min(132px, 22vh) + env(safe-area-inset-bottom, 0px))");
    });

    it("en compact-landscape con el cajón abierto, atalaya:guide-open cierra el cajón", async () => {
      mockCurrentLayoutMode = "compact-landscape";
      const { container, defaultView } = setupDOM();

      const ReactDOM = await import("react-dom/client");
      const root = ReactDOM.createRoot(container);

      let setRegion: ((id: string) => void) | null = null;

      function Harness() {
        const [regionId, setRegionId] = useState<string | null>(null);
        setRegion = setRegionId;

        const ctxValue = createMockContext({
          selectedRegionId: regionId,
        });

        return (
          <AtalayaContext.Provider value={ctxValue}>
            <DashboardPage />
          </AtalayaContext.Provider>
        );
      }

      await React.act(async () => {
        root.render(<Harness />);
      });

      const rootDiv = container.childNodes.find((c: any) => c.tagName === "DIV");
      const aside = rootDiv?.childNodes?.find((c: any) => c.tagName === "ASIDE");
      expect(aside).toBeDefined();

      // Initially closed in landscape: 40px width
      expect(aside.style.width).toBe("40px");

      // Select a region to open the landscape drawer
      await React.act(async () => {
        setRegion?.("23");
      });

      // Drawer is now open
      expect(aside.style.width).toBe("min(380px, 46vw)");

      // Dispatch atalaya:guide-open
      await React.act(async () => {
        defaultView.dispatchEvent(new Event(GUIDE_EVENTS.opened));
      });

      // Drawer should now be closed (40px)
      expect(aside.style.width).toBe("40px");
    });

    it("en compact-landscape con el cajón cerrado, hay un [data-tour=panel] en la pestaña vertical", async () => {
      mockCurrentLayoutMode = "compact-landscape";
      const { container } = setupDOM();

      const ReactDOM = await import("react-dom/client");
      const root = ReactDOM.createRoot(container);

      const ctxValue = createMockContext({
        selectedRegionId: null, // Drawer stays closed
      });

      await React.act(async () => {
        root.render(
          <AtalayaContext.Provider value={ctxValue}>
            <DashboardPage />
          </AtalayaContext.Provider>
        );
      });

      const panelAnchor = findDescendant(
        container,
        (c: any) =>
          c.attributes?.["data-tour"] === "panel" ||
          c["data-tour"] === "panel" ||
          c.getAttribute?.("data-tour") === "panel"
      );
      expect(panelAnchor).toBeDefined();
      expect(panelAnchor).not.toBeNull();
      const className = panelAnchor.attributes?.class || panelAnchor.className || "";
      expect(className).toContain("w-10");
    });
  });
});

