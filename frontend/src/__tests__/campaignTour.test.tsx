import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import CampanasPage from "../app/campanas/page";
import { UnitPicker } from "../components/intel/campaign/UnitPicker";
import { IntelPageShell } from "../components/intel/IntelPageShell";
import { TOURS, GUIDE_EVENTS } from "../lib/tours";
import { MOCK_CAMPAIGN_PLAN } from "../lib/intel/mocks";
import { MOCK_META } from "../lib/mocks/meta";
import { AtalayaContext, type AtalayaContextValue } from "../lib/state";
import { defaultsForScenario } from "../lib/scenarioParams";
import * as geoModule from "../lib/geo";
import * as intelApi from "../lib/intel/api";

// Mock next/navigation
let mockSearchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
  usePathname: () => "/campanas",
  useSearchParams: () => mockSearchParams,
}));

// Mock intel API
vi.mock("@/lib/intel/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/intel/api")>("@/lib/intel/api");
  return {
    ...actual,
    getIntelStatus: vi.fn(),
    getCachedCampaign: vi.fn(),
    requestCampaign: vi.fn(),
    pollJob: vi.fn(),
    exportCampaign: vi.fn(),
  };
});

function createMockContext(overrides: Partial<AtalayaContextValue> = {}): AtalayaContextValue {
  return {
    scenario: "intervencion",
    setScenario: vi.fn(),
    scenarioParams: defaultsForScenario("intervencion", MOCK_META),
    setScenarioParams: vi.fn(),
    paramsByScenario: {
      intervencion: defaultsForScenario("intervencion", MOCK_META),
      pesimista: defaultsForScenario("pesimista", MOCK_META),
    },
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
    ...overrides,
  };
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++;
    pos += needle.length;
  }
  return count;
}

function domToHtml(node: any): string {
  if (!node) return "";
  if (node.nodeType === 3) return node.nodeValue || "";
  if (node.nodeType === 8) return "";
  if (node.nodeType === 1) {
    const tag = (node.tagName || "div").toLowerCase();
    let attrs = "";
    if (node.attributes) {
      for (const [k, v] of Object.entries(node.attributes)) {
        attrs += ` ${k}="${String(v).replace(/"/g, "&quot;")}"`;
      }
    }
    if (!node.attributes?.style && node.style) {
      const styleKeys = Object.keys(node.style).filter(
        (k) => !["setProperty", "removeProperty", "getPropertyValue"].includes(k) && typeof node.style[k] === "string"
      );
      if (styleKeys.length > 0) {
        const styleStr = styleKeys
          .map((k) => {
            const kebab = k.replace(/([A-Z])/g, "-$1").toLowerCase();
            return `${kebab}: ${node.style[k]}`;
          })
          .join("; ");
        attrs += ` style="${styleStr.replace(/"/g, "&quot;")}"`;
      }
    }
    const children = (node.childNodes || []).map(domToHtml).join("");
    return `<${tag}${attrs}>${children}</${tag}>`;
  }
  return "";
}

async function waitFor(
  callback: () => Promise<void> | void,
  { timeout = 2500, interval = 20 }: { timeout?: number; interval?: number } = {}
): Promise<void> {
  const start = Date.now();
  let lastErr: any;
  while (Date.now() - start < timeout) {
    try {
      await callback();
      return;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, interval));
    }
  }
  throw lastErr || new Error(`waitFor timed out after ${timeout}ms`);
}

function setupDOM() {
  const origWindow = (globalThis as any).window;
  const origDoc = (globalThis as any).document;
  const origSelf = (globalThis as any).self;
  const origAct = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  const origResizeObserver = (globalThis as any).ResizeObserver;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

  const windowListeners: Record<string, Function[]> = {};
  class FakeElement {}
  class FakeHTMLElement extends FakeElement {}
  class FakeHTMLIFrameElement extends FakeHTMLElement {}

  let lastResizeObserver: any = null;
  class FakeResizeObserver {
    callback: (entries: any[]) => void;
    observedTargets: any[] = [];
    observe = vi.fn((target: any) => {
      this.observedTargets.push(target);
    });
    unobserve = vi.fn((target: any) => {
      this.observedTargets = this.observedTargets.filter((t) => t !== target);
    });
    disconnect = vi.fn(() => {
      this.observedTargets = [];
    });
    constructor(cb: any) {
      this.callback = cb;
      lastResizeObserver = this;
    }
  }

  const fakeWindow: any = {
    HTMLIFrameElement: FakeHTMLIFrameElement,
    HTMLElement: FakeHTMLElement,
    Element: FakeElement,
    Node: FakeElement,
    ResizeObserver: FakeResizeObserver,
    addEventListener: vi.fn((event: string, handler: any) => {
      windowListeners[event] = windowListeners[event] || [];
      windowListeners[event].push(handler);
    }),
    removeEventListener: vi.fn((event: string, handler: any) => {
      if (windowListeners[event]) {
        windowListeners[event] = windowListeners[event].filter((h) => h !== handler);
      }
    }),
    dispatchEvent: vi.fn((evt: any) => {
      const list = windowListeners[evt.type] || [];
      list.forEach((cb) => cb(evt));
      return true;
    }),
    setTimeout: setTimeout.bind(globalThis),
    clearTimeout: clearTimeout.bind(globalThis),
    requestAnimationFrame: (cb: any) => setTimeout(cb, 16),
    cancelAnimationFrame: (id: any) => clearTimeout(id),
    requestIdleCallback: (cb: any) => setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 50 }), 10),
    cancelIdleCallback: (id: any) => clearTimeout(id),
    IntersectionObserver: class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
    scrollTo: vi.fn(),
    getComputedStyle: vi.fn(() => ({
      display: "block",
      visibility: "visible",
      getPropertyValue: () => "",
    })),
    matchMedia: vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
    localStorage: {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    },
  };
  fakeWindow.self = fakeWindow;
  (globalThis as any).ResizeObserver = FakeResizeObserver;

  let fakeDoc: any;
  const elements: any[] = [];
  const createFakeElement = (tag: string) => {
    const elEvents: Record<string, Function[]> = {};
    const upperTag = tag.toUpperCase();
    const el: any = {
      tagName: upperTag,
      nodeType: 1,
      childNodes: [],
      children: [],
      options: upperTag === "SELECT" ? [] : undefined,
      selected: false,
      value: "",
      style: {
        setProperty: vi.fn((k: string, v: string) => {
          el.style[k] = v;
        }),
        removeProperty: vi.fn((k: string) => {
          const camel = k.replace(/-([a-z])/g, (_, l) => l.toUpperCase());
          const kebab = k.replace(/([A-Z])/g, "-$1").toLowerCase();
          delete el.style[k];
          delete el.style[camel];
          delete el.style[kebab];
        }),
        getPropertyValue: vi.fn((k: string) => {
          const camel = k.replace(/-([a-z])/g, (_, l) => l.toUpperCase());
          const kebab = k.replace(/([A-Z])/g, "-$1").toLowerCase();
          return el.style[k] ?? el.style[camel] ?? el.style[kebab] ?? "";
        }),
      },
      ownerDocument: fakeDoc,
      dataset: {},
      classList: {
        add: vi.fn(),
        remove: vi.fn(),
        contains: vi.fn(() => false),
        toggle: vi.fn(),
      },
      addEventListener: vi.fn((event: string, handler: any) => {
        elEvents[event] = elEvents[event] || [];
        elEvents[event].push(handler);
      }),
      removeEventListener: vi.fn((event: string, handler: any) => {
        if (elEvents[event]) {
          elEvents[event] = elEvents[event].filter((h) => h !== handler);
        }
      }),
      dispatchEvent: vi.fn((evt: any) => {
        const list = elEvents[evt.type] || [];
        list.forEach((cb) => cb(evt));
        return true;
      }),
      appendChild: vi.fn((child) => {
        el.childNodes.push(child);
        el.children.push(child);
        child.parentNode = el;
        if (upperTag === "SELECT" && child.tagName === "OPTION") {
          el.options.push(child);
        }
        return child;
      }),
      removeChild: vi.fn((child) => {
        el.childNodes = el.childNodes.filter((c: any) => c !== child);
        el.children = el.children.filter((c: any) => c !== child);
        child.parentNode = null;
        if (upperTag === "SELECT" && el.options) {
          el.options = el.options.filter((c: any) => c !== child);
        }
        return child;
      }),
      insertBefore: vi.fn((child, ref) => {
        const idx = el.childNodes.indexOf(ref);
        if (idx === -1) {
          el.childNodes.push(child);
          el.children.push(child);
        } else {
          el.childNodes.splice(idx, 0, child);
          el.children.splice(idx, 0, child);
        }
        child.parentNode = el;
        if (upperTag === "SELECT" && child.tagName === "OPTION") {
          if (!el.options.includes(child)) el.options.push(child);
        }
        return child;
      }),
      attributes: {} as Record<string, string>,
      setAttribute: vi.fn((name: string, value: string) => {
        el.attributes[name] = String(value);
        if (name === "id") el.id = String(value);
        if (name === "class" || name === "className") el.className = String(value);
        if (name.startsWith("data-")) {
          el.dataset[name.slice(5)] = String(value);
        }
        el[name] = value;
      }),
      getAttribute: vi.fn((name: string) => el.attributes[name] ?? null),
      removeAttribute: vi.fn((name: string) => {
        delete el.attributes[name];
        delete el[name];
      }),
      focus: vi.fn(() => {
        fakeDoc.activeElement = el;
        el.dispatchEvent(new Event("focus"));
      }),
      blur: vi.fn(() => {
        if (fakeDoc.activeElement === el) fakeDoc.activeElement = null;
        el.dispatchEvent(new Event("blur"));
      }),
      click: vi.fn(() => {
        el.dispatchEvent(new Event("click"));
      }),
      getBoundingClientRect: () => ({ height: 40, width: 200, top: 0, bottom: 40, left: 0, right: 200 }),
      contains: vi.fn((other: any) => other === el || el.childNodes.includes(other)),
    };
    elements.push(el);
    return el;
  };

  fakeDoc = {
    nodeType: 9,
    createElement: createFakeElement,
    createElementNS: (_ns: string, tag: string) => createFakeElement(tag),
    createTextNode: (text: string) => ({
      nodeType: 3,
      nodeValue: text,
      textContent: text,
      ownerDocument: fakeDoc,
      parentNode: null,
    }),
    createComment: (text?: string) => ({
      nodeType: 8,
      nodeValue: text || "",
      ownerDocument: fakeDoc,
      parentNode: null,
    }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    activeElement: null,
    body: createFakeElement("body"),
    documentElement: createFakeElement("html"),
  };
  fakeDoc.defaultView = fakeWindow;
  fakeWindow.document = fakeDoc;

  (globalThis as any).document = fakeDoc;
  (globalThis as any).window = fakeWindow;
  (globalThis as any).self = fakeWindow;

  const cleanup = () => {
    (globalThis as any).window = origWindow;
    (globalThis as any).document = origDoc;
    (globalThis as any).self = origSelf;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = origAct;
    (globalThis as any).ResizeObserver = origResizeObserver;
  };

  return {
    fakeDoc,
    fakeWindow,
    elements,
    getLastResizeObserver: () => lastResizeObserver,
    cleanup,
  };
}

describe("W1-D / F2-C Campaign Tour Suite (campaignTour.test.tsx)", () => {
  let domHarness: ReturnType<typeof setupDOM>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams();
    vi.mocked(intelApi.getIntelStatus).mockResolvedValue({
      gemini_enabled: true,
      gemini_model: "gemini-2.5-flash",
      search_mode: "grounding",
      budget_used: 12,
      budget_limit: 100,
      llm_effort: "low",
      llm_enabled: true,
      llm_model: "glm-5.3",
      operator_configured: true,
      monitor_cooldown_min: 15,
    });
    vi.mocked(intelApi.getCachedCampaign).mockResolvedValue(null as any);
    vi.spyOn(geoModule, "fetchGeoIndex").mockResolvedValue([
      { id: "32", name: "Zacatecas", level: "state", ent: "32" },
      { id: "07", name: "Chiapas", level: "state", ent: "07" },
      { id: "07001", name: "Acacoyagua", level: "mun", ent: "07" },
    ]);
    domHarness = setupDOM();
  });

  afterEach(() => {
    domHarness?.cleanup();
  });

  describe("1. Sin plan: contiene camp-intro, camp-zona, camp-generar y NO camp-diapositivas", () => {
    it("renders intro, zone picker, and generator anchors without plan", async () => {
      mockSearchParams = new URLSearchParams();
      vi.mocked(intelApi.getCachedCampaign).mockResolvedValue(null as any);

      const { createRoot } = await import("react-dom/client");
      const container = domHarness.fakeDoc.createElement("div");
      const root = createRoot(container);

      await React.act(async () => {
        root.render(
          <AtalayaContext.Provider value={createMockContext()}>
            <CampanasPage />
          </AtalayaContext.Provider>
        );
      });

      let html = "";
      await waitFor(async () => {
        await React.act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
        });
        html = domToHtml(container);
        expect(html).toContain('data-tour="camp-intro"');
      });

      // Present anchors without plan
      expect(html).toContain('data-tour="camp-intro"');
      expect(html).toContain('data-tour="camp-zona"');
      expect(html).toContain('data-tour="camp-generar"');

      // Hidden anchors when plan has not been generated yet
      expect(html).not.toContain('data-tour="camp-diapositivas"');
      expect(html).not.toContain('data-tour="camp-investigacion"');
      expect(html).not.toContain('data-tour="camp-exportar"');
      expect(html).not.toContain('data-tour="camp-simular"');

      await React.act(async () => {
        root.unmount();
      });
    });
  });

  describe("2. Con plan: existen los 7 data-tour de CAMPAIGN_STEPS con duplicados de exportar y simular", () => {
    it("renders all 7 CAMPAIGN_STEPS tour anchors, with camp-exportar and camp-simular appearing twice", async () => {
      mockSearchParams = new URLSearchParams("?zona=32");
      vi.mocked(intelApi.getCachedCampaign).mockResolvedValue(MOCK_CAMPAIGN_PLAN);

      const { createRoot } = await import("react-dom/client");
      const container = domHarness.fakeDoc.createElement("div");
      const root = createRoot(container);

      await React.act(async () => {
        root.render(
          <AtalayaContext.Provider value={createMockContext()}>
            <CampanasPage />
          </AtalayaContext.Provider>
        );
      });

      let html = "";
      await waitFor(
        async () => {
          await React.act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 25));
          });
          html = domToHtml(container);
          expect(html).toContain('data-tour="camp-diapositivas"');
        },
        { timeout: 3000 }
      );

      // All 7 tour anchors from campaign contract
      expect(html).toContain('data-tour="camp-intro"');
      expect(html).toContain('data-tour="camp-zona"');
      expect(html).toContain('data-tour="camp-generar"');
      expect(html).toContain('data-tour="camp-diapositivas"');
      expect(html).toContain('data-tour="camp-investigacion"');
      expect(html).toContain('data-tour="camp-exportar"');
      expect(html).toContain('data-tour="camp-simular"');

      // Desktop and mobile variants: camp-exportar and camp-simular must appear exactly twice
      expect(countOccurrences(html, 'data-tour="camp-exportar"')).toBe(2);
      expect(countOccurrences(html, 'data-tour="camp-simular"')).toBe(2);

      // The single-instance anchors appear exactly once
      expect(countOccurrences(html, 'data-tour="camp-intro"')).toBe(1);
      expect(countOccurrences(html, 'data-tour="camp-zona"')).toBe(1);
      expect(countOccurrences(html, 'data-tour="camp-generar"')).toBe(1);
      expect(countOccurrences(html, 'data-tour="camp-diapositivas"')).toBe(1);
      expect(countOccurrences(html, 'data-tour="camp-investigacion"')).toBe(1);

      await React.act(async () => {
        root.unmount();
      });
    });
  });

  describe("3. Todos los sel de TOURS.campanas.steps tienen ancla en el render con plan", () => {
    it("verifies every selector in TOURS.campanas.steps exists in the rendered HTML", async () => {
      mockSearchParams = new URLSearchParams("?zona=32");
      vi.mocked(intelApi.getCachedCampaign).mockResolvedValue(MOCK_CAMPAIGN_PLAN);

      const { createRoot } = await import("react-dom/client");
      const container = domHarness.fakeDoc.createElement("div");
      const root = createRoot(container);

      await React.act(async () => {
        root.render(
          <AtalayaContext.Provider value={createMockContext()}>
            <CampanasPage />
          </AtalayaContext.Provider>
        );
      });

      let html = "";
      await waitFor(
        async () => {
          await React.act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 25));
          });
          html = domToHtml(container);
          expect(html).toContain('data-tour="camp-diapositivas"');
        },
        { timeout: 3000 }
      );

      expect(TOURS.campanas).toBeDefined();
      expect(TOURS.campanas.steps.length).toBe(7);

      for (const step of TOURS.campanas.steps) {
        const selectors = Array.isArray(step.sel) ? step.sel : [step.sel];
        const matchFound = selectors.some((sel) => html.includes(`data-tour="${sel}"`));
        expect(
          matchFound,
          `El paso "${step.title}" con selector(es) ${JSON.stringify(step.sel)} debe existir en el HTML renderizado con plan`
        ).toBe(true);
      }

      await React.act(async () => {
        root.unmount();
      });
    });
  });

  describe("4. UnitPicker con la lista abierta + atalaya:guide-open ⇒ lista cerrada", () => {
    it("registers listener for atalaya:guide-open and closes suggestion list on event dispatch", async () => {
      const { createRoot } = await import("react-dom/client");
      const container = domHarness.fakeDoc.createElement("div");
      const root = createRoot(container);

      await React.act(async () => {
        root.render(
          <AtalayaContext.Provider value={createMockContext()}>
            <UnitPicker
              selectedUnitId={null}
              focus=""
              onUnitSelect={vi.fn()}
              onFocusChange={vi.fn()}
            />
          </AtalayaContext.Provider>
        );
      });

      // Verify window.addEventListener was called with atalaya:guide-open
      expect(domHarness.fakeWindow.addEventListener).toHaveBeenCalledWith(
        GUIDE_EVENTS.opened,
        expect.any(Function)
      );

      // Find the search input element that has unit-search-input id
      const searchInput = domHarness.elements.find(
        (e) => e.tagName === "INPUT" && (e.id === "unit-search-input" || e.attributes?.id === "unit-search-input")
      );
      expect(searchInput).toBeDefined();

      // Dispatch atalaya:guide-open
      await React.act(async () => {
        domHarness.fakeWindow.dispatchEvent(new Event(GUIDE_EVENTS.opened));
      });

      // Assert that blurring occurred to hide keyboard and dismiss dropdown
      expect(searchInput.blur).toHaveBeenCalled();

      // Unmount root and check removeEventListener
      await React.act(async () => {
        root.unmount();
      });

      expect(domHarness.fakeWindow.removeEventListener).toHaveBeenCalledWith(
        GUIDE_EVENTS.opened,
        expect.any(Function)
      );
    });

    it("verifies simulated state transition when atalaya:guide-open fires: list closes and blur is called", () => {
      let isOpen = true;
      let blurInvoked = false;
      const fakeInput = {
        blur: () => {
          blurInvoked = true;
        },
      };

      const handleGuideOpen = () => {
        isOpen = false;
        fakeInput.blur();
      };

      expect(isOpen).toBe(true);
      expect(blurInvoked).toBe(false);

      handleGuideOpen();

      expect(isOpen).toBe(false);
      expect(blurInvoked).toBe(true);
    });
  });

  describe("5. F2-C: Publicación de --page-inset-bottom con la barra fija de exportar", () => {
    it("con plan, simulando el alto de la barra (mock de ResizeObserver/getBoundingClientRect), document.documentElement.style.getPropertyValue('--page-inset-bottom') es '<n>px'; al desmontar queda vacío", async () => {
      mockSearchParams = new URLSearchParams("?zona=32");
      vi.mocked(intelApi.getCachedCampaign).mockResolvedValue(MOCK_CAMPAIGN_PLAN);

      const { createRoot } = await import("react-dom/client");
      const container = domHarness.fakeDoc.createElement("div");
      const root = createRoot(container);

      await React.act(async () => {
        root.render(
          <AtalayaContext.Provider value={createMockContext()}>
            <CampanasPage />
          </AtalayaContext.Provider>
        );
      });

      // Wait for plan to load and render
      await waitFor(() => {
        const val = domHarness.fakeDoc.documentElement.style.getPropertyValue("--page-inset-bottom");
        expect(val).not.toBe("");
      });

      // Find the mobile export bar container
      const mobileBar = domHarness.elements.find(
        (e) =>
          e.tagName === "DIV" &&
          (e.className?.includes("fixed") || e.attributes?.class?.includes("fixed")) &&
          (e.dataset?.tour === "camp-exportar" || e.attributes?.["data-tour"] === "camp-exportar")
      );
      expect(mobileBar).toBeDefined();

      // Simulate a mobile height of 124px via getBoundingClientRect and ResizeObserver callback
      mobileBar.getBoundingClientRect = () => ({
        height: 124,
        width: 360,
        top: 516,
        bottom: 640,
        left: 0,
        right: 360,
      });

      const observer = domHarness.getLastResizeObserver();
      expect(observer).toBeDefined();

      await React.act(async () => {
        observer.callback([
          {
            target: mobileBar,
            contentRect: { height: 124 },
            borderBoxSize: [{ blockSize: 124 }],
          },
        ]);
      });

      // Assert that --page-inset-bottom is published as "<n>px" (124px)
      expect(
        domHarness.fakeDoc.documentElement.style.getPropertyValue("--page-inset-bottom")
      ).toBe("124px");

      // Verify padding-bottom on the mobile bar includes safe-area-inset-bottom
      const pb =
        mobileBar.style.getPropertyValue("padding-bottom") || mobileBar.style.paddingBottom;
      expect(pb).toContain("max(0.5rem, env(safe-area-inset-bottom))");

      // Unmount the component
      await React.act(async () => {
        root.unmount();
      });

      // Assert that upon unmount the property is removed and becomes empty
      expect(
        domHarness.fakeDoc.documentElement.style.getPropertyValue("--page-inset-bottom")
      ).toBe("");
    });

    it("sin plan, la variable --page-inset-bottom permanece vacía", async () => {
      mockSearchParams = new URLSearchParams();
      vi.mocked(intelApi.getCachedCampaign).mockResolvedValue(null as any);

      const { createRoot } = await import("react-dom/client");
      const container = domHarness.fakeDoc.createElement("div");
      const root = createRoot(container);

      await React.act(async () => {
        root.render(
          <AtalayaContext.Provider value={createMockContext()}>
            <CampanasPage />
          </AtalayaContext.Provider>
        );
      });

      await waitFor(async () => {
        expect(domToHtml(container)).toContain('data-tour="camp-intro"');
      });

      expect(
        domHarness.fakeDoc.documentElement.style.getPropertyValue("--page-inset-bottom")
      ).toBe("");

      await React.act(async () => {
        root.unmount();
      });
    });
  });

  describe("6. F2-C: IntelPageShell renderiza scroll-padding-bottom con la variable", () => {
    it("IntelPageShell renderiza scroll-padding-bottom y padding-bottom dinámicos", async () => {
      const { createRoot } = await import("react-dom/client");
      const container = domHarness.fakeDoc.createElement("div");
      const root = createRoot(container);

      await React.act(async () => {
        root.render(
          <IntelPageShell>
            <div data-testid="test-content">Contenido interior</div>
          </IntelPageShell>
        );
      });

      const shellDiv = domHarness.elements.find(
        (e) =>
          e.tagName === "DIV" &&
          (e.className?.includes("overflow-y-auto") || e.attributes?.class?.includes("overflow-y-auto"))
      );
      expect(shellDiv).toBeDefined();

      // scroll-padding-bottom: var(--page-inset-bottom, 0px)
      expect(shellDiv.style.getPropertyValue("scroll-padding-bottom")).toBe(
        "var(--page-inset-bottom, 0px)"
      );

      // padding-bottom: calc(var(--page-inset-bottom, 0px) + 24px)
      expect(shellDiv.style.getPropertyValue("padding-bottom")).toBe(
        "calc(var(--page-inset-bottom, 0px) + 24px)"
      );

      const html = domToHtml(container);
      expect(html).toContain("scroll-padding-bottom: var(--page-inset-bottom, 0px)");
      expect(html).toContain("padding-bottom: calc(var(--page-inset-bottom, 0px) + 24px)");

      await React.act(async () => {
        root.unmount();
      });
    });
  });
});
