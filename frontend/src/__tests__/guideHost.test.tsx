import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TOURS, GUIDE_EVENTS } from "../lib/tours";
import { GuideHost } from "../components/guide/GuideHost";
import { MapToolbar } from "../components/map/MapToolbar";

// Track props passed to spy MapGuide
const mapGuideSpyCalls: any[] = [];

vi.mock("@/components/map/MapGuide", () => {
  return {
    MapGuide: (props: any) => {
      mapGuideSpyCalls.push(props);
      if (!props.open) return null;
      return <div data-testid="map-guide-spy" data-storagekey={props.storageKey} />;
    },
    shouldShowGuide: vi.fn((storage: any, key: string) => {
      if (!storage) return false;
      try {
        const val = storage.getItem(key);
        return val === null || val === "";
      } catch {
        return false;
      }
    }),
    dismissGuide: vi.fn((storage: any, key: string) => {
      if (storage?.setItem && key) {
        storage.setItem(key, "1");
      }
    }),
  };
});

let currentPathname: string | null = "/";
vi.mock("next/navigation", () => ({
  usePathname: () => currentPathname,
}));

vi.mock("@/lib/state", () => ({
  useAtalaya: () => ({
    extrude3d: false,
    setExtrude3d: vi.fn(),
    view3d: "inclinada",
    setView3d: vi.fn(),
  }),
}));

describe("GuideHost & MapToolbar Guide Integration (guideHost.test.tsx)", () => {
  let origDoc: any;
  let origWin: any;
  let origActEnv: any;

  let storageMap: Record<string, string>;
  let mockLocalStorage: any;
  let windowListeners: Record<string, Array<(e: any) => void>>;
  let mockWindow: any;
  let docElements: any[];
  let mockDocument: any;

  beforeEach(() => {
    vi.useFakeTimers();
    mapGuideSpyCalls.length = 0;
    currentPathname = "/";

    origDoc = (globalThis as any).document;
    origWin = (globalThis as any).window;
    origActEnv = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

    storageMap = {};
    mockLocalStorage = {
      getItem: vi.fn((k: string) => storageMap[k] ?? null),
      setItem: vi.fn((k: string, v: string) => {
        storageMap[k] = String(v);
      }),
      removeItem: vi.fn((k: string) => {
        delete storageMap[k];
      }),
      clear: vi.fn(() => {
        for (const k of Object.keys(storageMap)) delete storageMap[k];
      }),
    };

    windowListeners = {};
    mockWindow = {
      addEventListener: vi.fn((event: string, handler: any) => {
        windowListeners[event] = windowListeners[event] || [];
        windowListeners[event].push(handler);
      }),
      removeEventListener: vi.fn((event: string, handler: any) => {
        if (windowListeners[event]) {
          windowListeners[event] = windowListeners[event].filter((h) => h !== handler);
        }
      }),
      dispatchEvent: vi.fn((event: any) => {
        const type = event?.type || event;
        const handlers = windowListeners[type] || [];
        for (const h of handlers) {
          h(event);
        }
        return true;
      }),
      localStorage: mockLocalStorage,
      getComputedStyle: vi.fn(() => ({
        display: "block",
        visibility: "visible",
      })),
      HTMLIFrameElement: class {},
      Element: class {},
      HTMLElement: class {},
    };

    docElements = [];
    const mockBody: any = {
      nodeType: 1,
      tagName: "BODY",
      childNodes: [],
      classList: { add: vi.fn(), remove: vi.fn() },
      contains: vi.fn((el: any) => docElements.includes(el)),
      appendChild: vi.fn((el: any) => {
        if (!docElements.includes(el)) docElements.push(el);
        mockBody.childNodes.push(el);
        return el;
      }),
      removeChild: vi.fn((el: any) => {
        const idx = docElements.indexOf(el);
        if (idx >= 0) docElements.splice(idx, 1);
        const cIdx = mockBody.childNodes.indexOf(el);
        if (cIdx >= 0) mockBody.childNodes.splice(cIdx, 1);
        return el;
      }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dataset: {},
      style: {},
      closest: vi.fn(() => null),
    };

    mockDocument = {
      nodeType: 9,
      body: mockBody,
      documentElement: { style: {} },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      createElement: (tag: string) => {
        const el: any = {
          tagName: tag.toUpperCase(),
          nodeType: 1,
          ownerDocument: mockDocument,
          childNodes: [],
          style: {},
          attributes: {} as Record<string, string>,
          dataset: {} as Record<string, string>,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          appendChild: (child: any) => {
            el.childNodes.push(child);
            return child;
          },
          removeChild: (child: any) => {
            const idx = el.childNodes.indexOf(child);
            if (idx >= 0) el.childNodes.splice(idx, 1);
            return child;
          },
          insertBefore: (newNode: any) => {
            el.childNodes.push(newNode);
            return newNode;
          },
          setAttribute: (k: string, v: string) => {
            el[k] = v;
            el.attributes[k] = v;
            if (k.startsWith("data-")) {
              el.dataset[k.slice(5)] = v;
            }
          },
          getAttribute: (k: string) => el[k] ?? el.attributes[k] ?? null,
          hasAttribute: (k: string) => k in el || k in el.attributes,
          removeAttribute: (k: string) => {
            delete el[k];
            delete el.attributes[k];
          },
          getBoundingClientRect: () => ({
            top: 10,
            left: 10,
            width: 100,
            height: 40,
            bottom: 50,
            right: 110,
          }),
          closest: vi.fn(() => null),
        };
        return el;
      },
      createElementNS: (_ns: string, tag: string) => mockDocument.createElement(tag),
      createTextNode: (text: string) => ({ nodeType: 3, nodeValue: text }),
      createComment: () => ({ nodeType: 8 }),
      createDocumentFragment: () => {
        const frag: any = {
          nodeType: 11,
          childNodes: [],
          appendChild: (c: any) => {
            frag.childNodes.push(c);
            return c;
          },
          removeChild: (c: any) => {
            const idx = frag.childNodes.indexOf(c);
            if (idx >= 0) frag.childNodes.splice(idx, 1);
            return c;
          },
        };
        return frag;
      },
      querySelector: vi.fn((sel: string) => {
        const results = mockDocument.querySelectorAll(sel);
        return results[0] || null;
      }),
      querySelectorAll: vi.fn((sel: string) => {
        return docElements.filter((el) => {
          const dataTourMatch = sel.match(/\[data-tour="([^"]+)"\]/);
          if (dataTourMatch) {
            return (
              el.getAttribute?.("data-tour") === dataTourMatch[1] ||
              el.dataset?.tour === dataTourMatch[1]
            );
          }
          if (sel.includes('role="dialog"') && sel.includes('aria-modal="true"')) {
            const isGuide = el.hasAttribute?.("data-guide-balloon") || el.dataset?.guideBalloon;
            if (isGuide) return false;
            return (
              el.getAttribute?.("role") === "dialog" &&
              (el.getAttribute?.("aria-modal") === "true" || el.attributes?.["aria-modal"] === "true")
            );
          }
          return false;
        });
      }),
    };

    mockDocument.defaultView = mockWindow;
    mockDocument.body.ownerDocument = mockDocument;

    (globalThis as any).document = mockDocument;
    (globalThis as any).window = mockWindow;
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as any).document = origDoc;
    (globalThis as any).window = origWin;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = origActEnv;
  });

  async function renderComponent(ui: React.ReactElement) {
    const ReactDOM = await import("react-dom/client");
    const container = mockDocument.createElement("div");
    const root = ReactDOM.createRoot(container);
    await React.act(async () => {
      root.render(ui);
    });
    return { root, container };
  }

  it("en '/' pasa TOURS.mapa.steps y su clave de almacenamiento", async () => {
    currentPathname = "/";
    await renderComponent(<GuideHost />);

    expect(mapGuideSpyCalls.length).toBeGreaterThanOrEqual(1);
    const lastCall = mapGuideSpyCalls[mapGuideSpyCalls.length - 1];
    expect(lastCall.steps).toEqual(TOURS.mapa.steps);
    expect(lastCall.storageKey).toBe(TOURS.mapa.storageKey);
  });

  it("en '/monitor' pasa TOURS.monitor.steps y su clave de almacenamiento", async () => {
    currentPathname = "/monitor";
    await renderComponent(<GuideHost />);

    expect(mapGuideSpyCalls.length).toBeGreaterThanOrEqual(1);
    const lastCall = mapGuideSpyCalls[mapGuideSpyCalls.length - 1];
    expect(lastCall.steps).toEqual(TOURS.monitor.steps);
    expect(lastCall.storageKey).toBe(TOURS.monitor.storageKey);
  });

  it("en '/metodologia' no renderiza la guía", async () => {
    currentPathname = "/metodologia";
    await renderComponent(<GuideHost />);

    expect(mapGuideSpyCalls.length).toBe(0);
  });

  it("primera visita: con temporizadores falsos y el ancla presente abre tras 900 ms", async () => {
    currentPathname = "/";
    const anchor = mockDocument.createElement("div");
    anchor.setAttribute("data-tour", "escenario");
    mockDocument.body.appendChild(anchor);

    await renderComponent(<GuideHost />);

    // Before 900 ms: not open yet
    await React.act(async () => {
      vi.advanceTimersByTime(800);
    });
    let lastCall = mapGuideSpyCalls[mapGuideSpyCalls.length - 1];
    expect(lastCall.open).toBe(false);

    // At 900 ms: opens
    await React.act(async () => {
      vi.advanceTimersByTime(100);
    });
    lastCall = mapGuideSpyCalls[mapGuideSpyCalls.length - 1];
    expect(lastCall.open).toBe(true);
  });

  it("primera visita: sin ancla en 6 s no abre", async () => {
    currentPathname = "/";
    // No anchor in document
    await renderComponent(<GuideHost />);

    await React.act(async () => {
      vi.advanceTimersByTime(6500);
    });

    const lastCall = mapGuideSpyCalls[mapGuideSpyCalls.length - 1];
    expect(lastCall.open).toBe(false);
  });

  it("primera visita: con clave guardada en localStorage no abre", async () => {
    currentPathname = "/";
    mockLocalStorage.setItem(TOURS.mapa.storageKey, "1");

    const anchor = mockDocument.createElement("div");
    anchor.setAttribute("data-tour", "escenario");
    mockDocument.body.appendChild(anchor);

    await renderComponent(<GuideHost />);

    await React.act(async () => {
      vi.advanceTimersByTime(2000);
    });

    const lastCall = mapGuideSpyCalls[mapGuideSpyCalls.length - 1];
    expect(lastCall.open).toBe(false);
  });

  it("con un [role=dialog][aria-modal=true] ajeno abierto espera a que se cierre", async () => {
    currentPathname = "/";
    const anchor = mockDocument.createElement("div");
    anchor.setAttribute("data-tour", "escenario");
    mockDocument.body.appendChild(anchor);

    // External modal is open
    const modal = mockDocument.createElement("div");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    mockDocument.body.appendChild(modal);

    await renderComponent(<GuideHost />);

    // Advance to 1000 ms: modal is open, so it must not open
    await React.act(async () => {
      vi.advanceTimersByTime(1000);
    });
    let lastCall = mapGuideSpyCalls[mapGuideSpyCalls.length - 1];
    expect(lastCall.open).toBe(false);

    // Modal closes
    mockDocument.body.removeChild(modal);

    // Next polling tick (150 ms) detects modal is gone
    await React.act(async () => {
      vi.advanceTimersByTime(150);
    });
    lastCall = mapGuideSpyCalls[mapGuideSpyCalls.length - 1];
    expect(lastCall.open).toBe(true);
  });

  it("evento atalaya:open-guide abre la guía; cambiar de ruta con la guía abierta la cierra sin escribir en localStorage", async () => {
    currentPathname = "/";
    storageMap[TOURS.mapa.storageKey] = "1"; // already viewed

    const ReactDOM = await import("react-dom/client");
    const container = mockDocument.createElement("div");
    const root = ReactDOM.createRoot(container);

    await React.act(async () => {
      root.render(<GuideHost />);
    });

    let lastCall = mapGuideSpyCalls[mapGuideSpyCalls.length - 1];
    expect(lastCall.open).toBe(false);

    // Dispatch atalaya:open-guide
    await React.act(async () => {
      mockWindow.dispatchEvent({ type: GUIDE_EVENTS.open });
    });

    lastCall = mapGuideSpyCalls[mapGuideSpyCalls.length - 1];
    expect(lastCall.open).toBe(true);

    // Prepare for route change
    currentPathname = "/campanas";
    storageMap[TOURS.campanas.storageKey] = "1"; // mark campanas as seen
    mockLocalStorage.setItem.mockClear();

    await React.act(async () => {
      root.render(<GuideHost />);
    });

    lastCall = mapGuideSpyCalls[mapGuideSpyCalls.length - 1];
    expect(lastCall.open).toBe(false);

    // Crucial requirement: closing due to route change must NOT write to localStorage
    expect(mockLocalStorage.setItem).not.toHaveBeenCalled();
  });

  it("MapToolbar ya no monta MapGuide y su botón emite atalaya:open-guide", async () => {
    const ReactDOM = await import("react-dom/client");
    const container = mockDocument.createElement("div");
    const root = ReactDOM.createRoot(container);

    await React.act(async () => {
      root.render(<MapToolbar />);
    });

    // Check MapGuide was not mounted by MapToolbar
    const guideCallsBefore = mapGuideSpyCalls.length;
    expect(guideCallsBefore).toBe(0);

    // Find the "?" button by checking elements with aria-label="Cómo leer este mapa"
    const findElementByAriaLabel = (node: any, label: string): any => {
      if (node?.getAttribute?.("aria-label") === label || node?.["aria-label"] === label) return node;
      for (const child of node?.childNodes || []) {
        const found = findElementByAriaLabel(child, label);
        if (found) return found;
      }
      return null;
    };

    const guideBtn = findElementByAriaLabel(container, "Cómo leer este mapa");
    expect(guideBtn).toBeDefined();

    // Verify listeners for opened/closed were registered
    expect(mockWindow.addEventListener).toHaveBeenCalledWith(
      GUIDE_EVENTS.opened,
      expect.any(Function)
    );
    expect(mockWindow.addEventListener).toHaveBeenCalledWith(
      GUIDE_EVENTS.closed,
      expect.any(Function)
    );

    // Click button -> emits atalaya:open-guide
    const propsKey = Object.keys(guideBtn).find((k) => k.startsWith("__reactProps"));
    const clickFn = (propsKey ? (guideBtn as any)[propsKey]?.onClick : undefined) || guideBtn.onClick;
    expect(typeof clickFn).toBe("function");

    await React.act(async () => {
      clickFn();
    });

    expect(mockWindow.dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: GUIDE_EVENTS.open })
    );

    // Respond with atalaya:guide-open -> aria-pressed becomes true
    await React.act(async () => {
      mockWindow.dispatchEvent({ type: GUIDE_EVENTS.opened });
    });

    // Respond with atalaya:guide-close -> aria-pressed becomes false
    await React.act(async () => {
      mockWindow.dispatchEvent({ type: GUIDE_EVENTS.closed });
    });
  });
});
