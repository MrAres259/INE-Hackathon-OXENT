import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TopBar } from "../components/layout/TopBar";
import { AtalayaContext, type AtalayaContextValue } from "../lib/state";
import { MOCK_META } from "../lib/mocks/meta";
import { defaultsForScenario } from "../lib/scenarioParams";
import { GUIDE_EVENTS } from "../lib/tours";

let mockPathname = "/";

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn().mockResolvedValue({ user: { username: "operador_ine" } }),
  logout: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/geo", () => ({
  fetchGeoIndex: vi.fn().mockResolvedValue([]),
}));

function createMockContext(overrides: Partial<AtalayaContextValue> = {}): AtalayaContextValue {
  return {
    scenario: "base",
    setScenario: vi.fn(),
    scenarioParams: defaultsForScenario("base", MOCK_META),
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

describe("TopBar Guide and Anchor Suite (topBarGuide.test.tsx)", () => {
  let origWindow: any;
  let origDoc: any;
  let origActEnv: any;

  beforeEach(() => {
    mockPathname = "/";
    origWindow = (globalThis as any).window;
    origDoc = (globalThis as any).document;
    origActEnv = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
  });

  afterEach(() => {
    (globalThis as any).window = origWindow;
    (globalThis as any).document = origDoc;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = origActEnv;
  });

  function setupDOM() {
    const elements: Record<string, any[]> = {};
    const listeners: Record<string, Function[]> = {};

    const defaultView: any = {
      addEventListener: vi.fn((event: string, handler: any) => {
        listeners[event] = listeners[event] || [];
        listeners[event].push(handler);
      }),
      removeEventListener: vi.fn((event: string, handler: any) => {
        if (listeners[event]) {
          listeners[event] = listeners[event].filter((h) => h !== handler);
        }
      }),
      dispatchEvent: vi.fn((event: any) => {
        const type = event?.type || event;
        if (listeners[type]) {
          listeners[type].forEach((h) => h(event));
        }
        return true;
      }),
      CustomEvent: class CustomEvent {
        type: string;
        detail: any;
        constructor(type: string, params: any = {}) {
          this.type = type;
          this.detail = params?.detail;
        }
      },
      setTimeout: setTimeout.bind(globalThis),
      clearTimeout: clearTimeout.bind(globalThis),
      location: { pathname: mockPathname, search: "", href: `http://localhost:3000${mockPathname}` },
      history: { replaceState: vi.fn() },
      HTMLIFrameElement: class {},
      Element: class {},
      HTMLElement: class {},
      Node: class {},
      innerWidth: 1280,
      innerHeight: 800,
      matchMedia: vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
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
          setAttribute: vi.fn((k: string, v: string) => {
            el[k] = v;
          }),
          removeAttribute: vi.fn((k: string) => {
            delete el[k];
          }),
          focus: vi.fn(),
          blur: vi.fn(),
          style: {
            setProperty: vi.fn(),
            getPropertyValue: vi.fn().mockReturnValue(""),
          },
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
      body: {
        classList: { add: vi.fn(), remove: vi.fn() },
      },
      documentElement: {
        dataset: {},
        style: { setProperty: vi.fn(), getPropertyValue: vi.fn().mockReturnValue("") },
      },
    };

    fakeDoc.defaultView = defaultView;
    defaultView.document = fakeDoc;
    (globalThis as any).document = fakeDoc;
    (globalThis as any).window = defaultView;
    (globalThis as any).self = defaultView;
    (globalThis as any).CustomEvent = defaultView.CustomEvent;

    const container = fakeDoc.createElement("div");
    container.ownerDocument = fakeDoc;

    return { container, fakeDoc, defaultView, elements, listeners };
  }

  function findButtons(elements: any[], predicate: (props: any) => boolean) {
    const matches: Array<{ element: any; props: any }> = [];
    for (const el of elements) {
      const propsKey = Object.keys(el).find((k) => k.startsWith("__reactProps"));
      if (propsKey && el[propsKey] && predicate(el[propsKey])) {
        matches.push({ element: el, props: el[propsKey] });
      }
    }
    return matches;
  }

  // 1. Anchors across variants
  it("en '/' con escenario base: hay [data-tour=secciones] (>= 1 por variante) y [data-tour=intervencion], sin [data-tour=ajustar]", () => {
    mockPathname = "/";
    const html = renderToStaticMarkup(
      <AtalayaContext.Provider value={createMockContext({ scenario: "base" })}>
        <TopBar />
      </AtalayaContext.Provider>
    );

    // [data-tour=secciones] is in all 3 variants (desktop, compact-landscape, compact-portrait)
    const seccionesMatches = html.match(/data-tour="secciones"/g);
    expect(seccionesMatches).not.toBeNull();
    expect(seccionesMatches!.length).toBeGreaterThanOrEqual(3);

    // [data-tour=intervencion] is present in the scenario selector (within data-tour="escenario")
    const intervencionMatches = html.match(/data-tour="intervencion"/g);
    expect(intervencionMatches).not.toBeNull();
    expect(intervencionMatches!.length).toBeGreaterThanOrEqual(3);

    // In base scenario, "ajustar" is not shown
    expect(html).not.toContain('data-tour="ajustar"');
  });

  it("en '/' con escenario intervencion: hay [data-tour=ajustar]", () => {
    mockPathname = "/";
    const html = renderToStaticMarkup(
      <AtalayaContext.Provider value={createMockContext({ scenario: "intervencion" })}>
        <TopBar />
      </AtalayaContext.Provider>
    );

    const ajustarMatches = html.match(/data-tour="ajustar"/g);
    expect(ajustarMatches).not.toBeNull();
    // Present in desktop, compact-landscape, and compact-portrait
    expect(ajustarMatches!.length).toBeGreaterThanOrEqual(3);
    expect(html).toContain('data-tour="secciones"');
    expect(html).toContain('data-tour="intervencion"');
  });

  // 2. Guide button visibility by section
  it("en '/campanas' y '/monitor': hay botón 'Ayuda y guía del sistema' y [data-tour=secciones]", () => {
    for (const route of ["/campanas", "/monitor"]) {
      mockPathname = route;
      const html = renderToStaticMarkup(
        <AtalayaContext.Provider value={createMockContext({ scenario: "intervencion" })}>
          <TopBar />
        </AtalayaContext.Provider>
      );

      expect(html).toContain('aria-label="Ayuda y guía del sistema"');
      expect(html).toContain('data-tour="secciones"');
    }
  });

  it("en '/metodologia': NO hay botón de guía ni opción de guía en menú", () => {
    mockPathname = "/metodologia";
    const html = renderToStaticMarkup(
      <AtalayaContext.Provider value={createMockContext({ scenario: "intervencion" })}>
        <TopBar />
      </AtalayaContext.Provider>
    );

    expect(html).not.toContain('aria-label="Ayuda y guía del sistema"');
    expect(html).not.toContain("Guía interactiva");
    expect(html).toContain('data-tour="secciones"');
  });

  // 3. Interactive behavior: click in "?" emits atalaya:open-guide
  it("clic en '?' emite atalaya:open-guide", async () => {
    mockPathname = "/";
    const { container, defaultView, elements } = setupDOM();
    const ReactDOM = await import("react-dom/client");
    const root = ReactDOM.createRoot(container);

    await React.act(async () => {
      root.render(
        <AtalayaContext.Provider value={createMockContext({ scenario: "base" })}>
          <TopBar />
        </AtalayaContext.Provider>
      );
    });

    const guideButtons = findButtons(
      elements["button"] || [],
      (p) => p["aria-label"] === "Ayuda y guía del sistema"
    );
    expect(guideButtons.length).toBeGreaterThanOrEqual(1);

    // Click the first guide button
    await React.act(async () => {
      guideButtons[0].props.onClick?.({ preventDefault: () => {} });
    });

    expect(defaultView.dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: GUIDE_EVENTS.open })
    );
  });

  // 4. Interactive behavior: atalaya:guide-open closes moreMenu and userMenu
  it("con el menú '⋯' abierto, atalaya:guide-open lo cierra", async () => {
    mockPathname = "/";
    const { container, defaultView, elements } = setupDOM();
    const ReactDOM = await import("react-dom/client");
    const root = ReactDOM.createRoot(container);

    await React.act(async () => {
      root.render(
        <AtalayaContext.Provider value={createMockContext({ scenario: "base" })}>
          <TopBar />
        </AtalayaContext.Provider>
      );
    });

    // Find the "Más opciones" (⋯) button
    const moreButtons = findButtons(
      elements["button"] || [],
      (p) => p["aria-label"] === "Más opciones"
    );
    expect(moreButtons.length).toBeGreaterThanOrEqual(1);

    // Open more menu
    await React.act(async () => {
      moreButtons[0].props.onClick?.({ preventDefault: () => {} });
    });

    // Check menu is opened
    const menuDivsOpen = (elements["div"] || []).filter((el) => {
      const propsKey = Object.keys(el).find((k) => k.startsWith("__reactProps"));
      return propsKey && el[propsKey]?.role === "menu" && el[propsKey]?.["aria-label"] === "Opciones adicionales";
    });
    expect(menuDivsOpen.length).toBe(1);

    // Emit atalaya:guide-open
    await React.act(async () => {
      defaultView.dispatchEvent(new defaultView.CustomEvent(GUIDE_EVENTS.opened));
    });

    // Check more menu was closed (aria-expanded is false)
    const moreBtnProps = moreButtons[0].element[
      Object.keys(moreButtons[0].element).find((k) => k.startsWith("__reactProps"))!
    ];
    expect(moreBtnProps["aria-expanded"]).toBe(false);
  });

  it("con el menú de usuario abierto, atalaya:guide-open lo cierra", async () => {
    mockPathname = "/";
    const { container, defaultView, elements } = setupDOM();
    const ReactDOM = await import("react-dom/client");
    const root = ReactDOM.createRoot(container);

    await React.act(async () => {
      root.render(
        <AtalayaContext.Provider value={createMockContext({ scenario: "base" })}>
          <TopBar />
        </AtalayaContext.Provider>
      );
    });

    // Find user menu button (aria-haspopup="menu")
    const userButtons = findButtons(
      elements["button"] || [],
      (p) => p["aria-haspopup"] === "menu" && p["aria-label"] !== "Más opciones"
    );
    expect(userButtons.length).toBeGreaterThanOrEqual(1);

    // Open user menu
    await React.act(async () => {
      userButtons[0].props.onClick?.({ preventDefault: () => {} });
    });

    // Menu should be open
    const userMenuOpen = (elements["div"] || []).filter((el) => {
      const propsKey = Object.keys(el).find((k) => k.startsWith("__reactProps"));
      return propsKey && el[propsKey]?.role === "menu" && el[propsKey]?.["aria-label"] === "Menú de usuario";
    });
    expect(userMenuOpen.length).toBe(1);

    // Emit atalaya:guide-open
    await React.act(async () => {
      defaultView.dispatchEvent(new defaultView.CustomEvent(GUIDE_EVENTS.opened));
    });

    // The user menu button's aria-expanded should now be false
    const userBtnProps = userButtons[0].element[
      Object.keys(userButtons[0].element).find((k) => k.startsWith("__reactProps"))!
    ];
    expect(userBtnProps["aria-expanded"]).toBe(false);
  });

  it("al pulsar 'Guía interactiva' desde el menú '⋯', cierra el menú y emite atalaya:open-guide", async () => {
    mockPathname = "/";
    const { container, defaultView, elements } = setupDOM();
    const ReactDOM = await import("react-dom/client");
    const root = ReactDOM.createRoot(container);

    await React.act(async () => {
      root.render(
        <AtalayaContext.Provider value={createMockContext({ scenario: "base" })}>
          <TopBar />
        </AtalayaContext.Provider>
      );
    });

    // Open more menu
    const moreButtons = findButtons(
      elements["button"] || [],
      (p) => p["aria-label"] === "Más opciones"
    );
    await React.act(async () => {
      moreButtons[0].props.onClick?.({ preventDefault: () => {} });
    });

    // Find "Guía interactiva" item
    const guideMenuItems = findButtons(
      elements["button"] || [],
      (p) => p.role === "menuitem" && p.children?.[1]?.props?.children === "Guía interactiva"
    );
    expect(guideMenuItems.length).toBe(1);

    // Click "Guía interactiva"
    await React.act(async () => {
      guideMenuItems[0].props.onClick?.({ preventDefault: () => {} });
    });

    // Emitted open event
    expect(defaultView.dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: GUIDE_EVENTS.open })
    );

    // Menu "⋯" is now closed
    const moreBtnProps = moreButtons[0].element[
      Object.keys(moreButtons[0].element).find((k) => k.startsWith("__reactProps"))!
    ];
    expect(moreBtnProps["aria-expanded"]).toBe(false);
  });

  it("con el buscador móvil a pantalla completa abierto, atalaya:guide-open lo cierra", async () => {
    mockPathname = "/";
    const { container, defaultView, elements } = setupDOM();
    const ReactDOM = await import("react-dom/client");
    const root = ReactDOM.createRoot(container);

    await React.act(async () => {
      root.render(
        <AtalayaContext.Provider value={createMockContext({ scenario: "base" })}>
          <TopBar />
        </AtalayaContext.Provider>
      );
    });

    // Find mobile search open button
    const searchButtons = findButtons(
      elements["button"] || [],
      (p) => p["aria-label"] === "Buscar estado o municipio"
    );
    expect(searchButtons.length).toBeGreaterThanOrEqual(1);

    // Open mobile search overlay
    await React.act(async () => {
      searchButtons[0].props.onClick?.({ preventDefault: () => {} });
    });

    // Cancelar button exists in mobile search overlay
    const cancelButtons = findButtons(
      elements["button"] || [],
      (p) => p.children === "Cancelar"
    );
    expect(cancelButtons.length).toBe(1);

    // Emit atalaya:guide-open
    await React.act(async () => {
      defaultView.dispatchEvent(new defaultView.CustomEvent(GUIDE_EVENTS.opened));
    });

    // Cancelar button should no longer exist (overlay unmounted)
    const cancelButtonsAfter = findButtons(
      elements["button"] || [],
      (p) => p.children === "Cancelar"
    );
    expect(cancelButtonsAfter.length).toBe(0);
  });

  it("en '/' en las variantes compactas existe button[data-tour=buscar] (>= 1); en '/campanas' no", () => {
    mockPathname = "/";
    const homeHtml = renderToStaticMarkup(
      <AtalayaContext.Provider value={createMockContext({ scenario: "base" })}>
        <TopBar />
      </AtalayaContext.Provider>
    );

    const buttonMatches =
      homeHtml.match(/<button[^>]*data-tour="buscar"[^>]*aria-label="Buscar estado o municipio"/g) ??
      homeHtml.match(/<button[^>]*data-tour="buscar"/g);
    expect(buttonMatches).not.toBeNull();
    expect(buttonMatches!.length).toBeGreaterThanOrEqual(1);

    mockPathname = "/campanas";
    const campanasHtml = renderToStaticMarkup(
      <AtalayaContext.Provider value={createMockContext({ scenario: "base" })}>
        <TopBar />
      </AtalayaContext.Provider>
    );
    expect(campanasHtml).not.toContain('data-tour="buscar"');
  });

  it("la variante de escritorio tiene, en las pestañas de sección y en Ajustar, aria-label con el nombre completo", () => {
    mockPathname = "/";
    const html = renderToStaticMarkup(
      <AtalayaContext.Provider value={createMockContext({ scenario: "intervencion" })}>
        <TopBar />
      </AtalayaContext.Provider>
    );

    const desktopMatch = html.match(/<div data-layout-mode="desktop"[\s\S]*?<\/div>\s*<div data-layout-mode="compact-landscape"/);
    expect(desktopMatch).not.toBeNull();
    const desktopHtml = desktopMatch![0];

    expect(desktopHtml).toContain('aria-label="Mapa de riesgo"');
    expect(desktopHtml).toContain('aria-label="Plan de campaña"');
    expect(desktopHtml).toContain('aria-label="Monitor INE"');
    expect(desktopHtml).toContain('aria-label="Ajustar parámetros"');
  });

  it("el contenedor del buscador de escritorio lleva la clase de ancho mínimo", () => {
    mockPathname = "/";
    const html = renderToStaticMarkup(
      <AtalayaContext.Provider value={createMockContext({ scenario: "base" })}>
        <TopBar />
      </AtalayaContext.Provider>
    );

    const desktopMatch = html.match(/<div data-layout-mode="desktop"[\s\S]*?<\/div>\s*<div data-layout-mode="compact-landscape"/);
    expect(desktopMatch).not.toBeNull();
    const desktopHtml = desktopMatch![0];

    const searchContainerMatch = desktopHtml.match(/<div[^>]*data-tour="buscar"[^>]*>/);
    expect(searchContainerMatch).not.toBeNull();
    expect(searchContainerMatch![0]).toContain("min-w-[160px]");
  });
});


