import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import MonitorPage from "../app/monitor/page";
import { MonitorHeader } from "../components/intel/monitor/MonitorHeader";
import { NewsDetail } from "../components/intel/monitor/NewsDetail";
import { MOCK_MONITOR } from "../lib/intel/mocks";
import { TOURS } from "../lib/tours";
import * as intelApi from "../lib/intel/api";
import type { NewsItem, MonitorSnapshot } from "../lib/intel/types";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  usePathname: () => "/monitor",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

// Mock intel API
vi.mock("@/lib/intel/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/intel/api")>("@/lib/intel/api");
  return {
    ...actual,
    getIntelStatus: vi.fn(),
    getMonitor: vi.fn(),
    scanMonitor: vi.fn(),
    pollJob: vi.fn(),
    postRegistry: vi.fn(),
    getRegistry: vi.fn(),
  };
});

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
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

  const windowListeners: Record<string, Function[]> = {};
  class FakeElement {}
  class FakeHTMLElement extends FakeElement {}
  class FakeHTMLIFrameElement extends FakeHTMLElement {}

  const fakeWindow: any = {
    HTMLIFrameElement: FakeHTMLIFrameElement,
    HTMLElement: FakeHTMLElement,
    Element: FakeElement,
    Node: FakeElement,
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
          delete el.style[k];
        }),
        getPropertyValue: vi.fn((k: string) => el.style[k] ?? ""),
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
  };

  return { fakeDoc, fakeWindow, elements, cleanup };
}

describe("Monitor INE Tour Anchors Suite (monitorTour.test.tsx)", () => {
  let domHarness: ReturnType<typeof setupDOM>;

  const itemVerdadera = MOCK_MONITOR.items.find(
    (it) => it.verdict === "verdadera" && it.impact !== null
  )!;
  const itemRumor = MOCK_MONITOR.items.find(
    (it) => it.kind === "rumor" && it.virality !== null
  )!;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(intelApi.getIntelStatus).mockResolvedValue({
      gemini_enabled: true,
      gemini_model: "gemini-3.8-flash",
      llm_enabled: true,
      llm_model: "glm-5.3",
      llm_effort: "high",
      operator_configured: true,
      budget_used: 10,
      budget_limit: 40,
      monitor_cooldown_min: 15,
    });
    vi.mocked(intelApi.getMonitor).mockResolvedValue(MOCK_MONITOR);
    domHarness = setupDOM();
  });

  afterEach(() => {
    domHarness?.cleanup();
  });

  it("con snapshot simulado: existen mon-intro, mon-escanear, mon-kpis, mon-filtros, mon-lista, y en la verdadera mon-impacto, mon-remediacion, mon-registro", async () => {
    // Ensure itemVerdadera is the first item in the mock snapshot
    const snapshotWithVerdadera: MonitorSnapshot = {
      ...MOCK_MONITOR,
      items: [
        itemVerdadera,
        ...MOCK_MONITOR.items.filter((it) => it.id !== itemVerdadera.id),
      ],
    };
    vi.mocked(intelApi.getMonitor).mockResolvedValue(snapshotWithVerdadera);

    const { createRoot } = await import("react-dom/client");
    const container = domHarness.fakeDoc.createElement("div");
    const root = createRoot(container);

    await React.act(async () => {
      root.render(<MonitorPage />);
    });

    let html = "";
    await waitFor(
      async () => {
        await React.act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 25));
        });
        html = domToHtml(container);
        expect(html).toContain('data-tour="mon-lista"');
      },
      { timeout: 3000 }
    );

    // Header anchors
    expect(html).toContain('data-tour="mon-intro"');
    expect(html).toContain('data-tour="mon-escanear"');
    expect(html).toContain('data-tour="mon-kpis"');

    // Page containers
    expect(html).toContain('data-tour="mon-filtros"');
    expect(html).toContain('data-tour="mon-lista"');

    // NewsDetail for true news
    expect(html).toContain('data-tour="mon-impacto"');
    expect(html).toContain('data-tour="mon-remediacion"');
    expect(html).toContain('data-tour="mon-registro"');

    // Virality panel should NOT be in the true news detail
    expect(html).not.toContain('data-tour="mon-viralidad"');

    await React.act(async () => {
      root.unmount();
    });
  });

  it("en el detalle del rumor: existe mon-viralidad, y no mon-impacto", async () => {
    // Create snapshot where the rumor item is first
    const snapshotWithRumor: MonitorSnapshot = {
      ...MOCK_MONITOR,
      items: [
        itemRumor,
        ...MOCK_MONITOR.items.filter((it) => it.id !== itemRumor.id),
      ],
    };
    vi.mocked(intelApi.getMonitor).mockResolvedValue(snapshotWithRumor);

    const { createRoot } = await import("react-dom/client");
    const container = domHarness.fakeDoc.createElement("div");
    const root = createRoot(container);

    await React.act(async () => {
      root.render(<MonitorPage />);
    });

    let htmlPage = "";
    await waitFor(
      async () => {
        await React.act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 25));
        });
        htmlPage = domToHtml(container);
        expect(htmlPage).toContain('data-tour="mon-viralidad"');
      },
      { timeout: 3000 }
    );

    expect(htmlPage).toContain('data-tour="mon-viralidad"');
    expect(htmlPage).not.toContain('data-tour="mon-impacto"');
    expect(htmlPage).toContain('data-tour="mon-remediacion"');
    expect(htmlPage).toContain('data-tour="mon-registro"');

    await React.act(async () => {
      root.unmount();
    });

    // Also verify NewsDetail rendered standalone
    const htmlDetail = renderToStaticMarkup(<NewsDetail item={itemRumor} />);
    expect(htmlDetail).toContain('data-tour="mon-viralidad"');
    expect(htmlDetail).not.toContain('data-tour="mon-impacto"');
    expect(htmlDetail).toContain('data-tour="mon-remediacion"');
    expect(htmlDetail).toContain('data-tour="mon-registro"');
  });

  it("sin datos: existen mon-intro y mon-escanear, no mon-lista", async () => {
    vi.mocked(intelApi.getMonitor).mockResolvedValue(null as any);

    const { createRoot } = await import("react-dom/client");
    const container = domHarness.fakeDoc.createElement("div");
    const root = createRoot(container);

    await React.act(async () => {
      root.render(<MonitorPage />);
    });

    let html = "";
    await waitFor(
      async () => {
        await React.act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 25));
        });
        html = domToHtml(container);
        expect(html).toContain('data-tour="mon-intro"');
        expect(html).not.toContain("Cargando datos del Monitor");
      },
      { timeout: 3000 }
    );

    // Header anchors that must exist without data
    expect(html).toContain('data-tour="mon-intro"');
    expect(html).toContain('data-tour="mon-escanear"');

    // List and filter anchors must not exist without data
    expect(html).not.toContain('data-tour="mon-lista"');
    expect(html).not.toContain('data-tour="mon-filtros"');
    expect(html).not.toContain('data-tour="mon-kpis"');
    expect(html).not.toContain('data-tour="mon-impacto"');
    expect(html).not.toContain('data-tour="mon-viralidad"');

    await React.act(async () => {
      root.unmount();
    });
  });

  it("cada sel de TOURS.monitor.steps tiene ancla en alguno de los renders", async () => {
    const monitorSteps = TOURS.monitor.steps;
    expect(monitorSteps.length).toBeGreaterThan(0);

    const { createRoot } = await import("react-dom/client");

    // Render 1: Page with verified news
    const snapshotVerdadera: MonitorSnapshot = {
      ...MOCK_MONITOR,
      items: [
        itemVerdadera,
        ...MOCK_MONITOR.items.filter((it) => it.id !== itemVerdadera.id),
      ],
    };
    vi.mocked(intelApi.getMonitor).mockResolvedValue(snapshotVerdadera);

    const container1 = domHarness.fakeDoc.createElement("div");
    const root1 = createRoot(container1);
    await React.act(async () => {
      root1.render(<MonitorPage />);
    });

    let htmlVerdadera = "";
    await waitFor(
      async () => {
        await React.act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 25));
        });
        htmlVerdadera = domToHtml(container1);
        expect(htmlVerdadera).toContain('data-tour="mon-impacto"');
      },
      { timeout: 3000 }
    );
    await React.act(async () => {
      root1.unmount();
    });

    // Render 2: Page with rumor
    const snapshotRumor: MonitorSnapshot = {
      ...MOCK_MONITOR,
      items: [
        itemRumor,
        ...MOCK_MONITOR.items.filter((it) => it.id !== itemRumor.id),
      ],
    };
    vi.mocked(intelApi.getMonitor).mockResolvedValue(snapshotRumor);

    const container2 = domHarness.fakeDoc.createElement("div");
    const root2 = createRoot(container2);
    await React.act(async () => {
      root2.render(<MonitorPage />);
    });

    let htmlRumor = "";
    await waitFor(
      async () => {
        await React.act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 25));
        });
        htmlRumor = domToHtml(container2);
        expect(htmlRumor).toContain('data-tour="mon-viralidad"');
      },
      { timeout: 3000 }
    );
    await React.act(async () => {
      root2.unmount();
    });

    // Extract all data-tour values across renders
    const extractTours = (html: string): Set<string> => {
      const set = new Set<string>();
      const regex = /data-tour="([^"]+)"/g;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(html)) !== null) {
        set.add(match[1]);
      }
      return set;
    };

    const anchorsVerdadera = extractTours(htmlVerdadera);
    const anchorsRumor = extractTours(htmlRumor);
    const allAnchors = new Set([...anchorsVerdadera, ...anchorsRumor]);

    for (const step of monitorSteps) {
      if (typeof step.sel === "string") {
        expect(
          allAnchors.has(step.sel),
          `Anchor "${step.sel}" for step "${step.title}" should exist in at least one render`
        ).toBe(true);
      } else if (Array.isArray(step.sel)) {
        const found = step.sel.some((s) => allAnchors.has(s));
        expect(
          found,
          `At least one of [${step.sel.join(", ")}] for step "${step.title}" should exist in at least one render`
        ).toBe(true);
      }
    }
  });

  it("MonitorHeader: mon-escanear solo existe cuando onScan está presente", () => {
    // With onScan
    const htmlWithScan = renderToStaticMarkup(
      <MonitorHeader snapshot={MOCK_MONITOR} onScan={vi.fn()} />
    );
    expect(htmlWithScan).toContain('data-tour="mon-escanear"');

    // Without onScan
    const htmlWithoutScan = renderToStaticMarkup(
      <MonitorHeader snapshot={MOCK_MONITOR} />
    );
    expect(htmlWithoutScan).not.toContain('data-tour="mon-escanear"');
  });

  it("NewsDetail: no renderiza mon-impacto ni mon-viralidad si la noticia carece de ambos", () => {
    const itemNeutral: NewsItem = {
      ...itemVerdadera,
      id: "news_neutral",
      impact: null,
      virality: null,
    };

    const html = renderToStaticMarkup(<NewsDetail item={itemNeutral} />);
    expect(html).not.toContain('data-tour="mon-impacto"');
    expect(html).not.toContain('data-tour="mon-viralidad"');
    expect(html).toContain('data-tour="mon-remediacion"');
    expect(html).toContain('data-tour="mon-registro"');
  });
});
