import React, { useState } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  SidePanelTabsProps,
  useSidePanelTabs,
  PanelTabId,
} from "../components/panel/SidePanelTabs";
import { AtalayaContext, type AtalayaContextValue, type ExplainRequest } from "../lib/state";
import { MOCK_META } from "../lib/mocks/meta";
import DashboardPage from "../app/page";

// Mock leaf components so DashboardPage renders purely in-memory
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

// Force layout mode to compact-landscape (e.g. 844x390, 640x360)
vi.mock("@/lib/useMediaQuery", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/useMediaQuery")>();
  return {
    ...actual,
    useLayoutMode: () => "compact-landscape",
  };
});

let latestSidePanelProps: SidePanelTabsProps | null = null;

// Intercept SidePanelTabs to observe activeTab and trigger onSelectTab
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

describe("Landscape Tabs Suite (landscapeTabs.test.tsx)", () => {
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
    const defaultView: any = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn().mockReturnValue(true),
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
      createElement: (tag: string) => {
        const style: any = {
          setProperty: vi.fn((k: string, v: string) => {
            style[k] = v;
          }),
          removeProperty: vi.fn((k: string) => {
            delete style[k];
          }),
          getPropertyValue: vi.fn((k: string) => style[k] ?? ""),
        };
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
          style,
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
      body: {
        classList: {
          add: vi.fn(),
          remove: vi.fn(),
        },
      },
      documentElement: {
        dataset: {},
        style: { setProperty: vi.fn(), getPropertyValue: vi.fn() },
      },
    };

    fakeDoc.defaultView = defaultView;
    defaultView.document = fakeDoc;
    (globalThis as any).document = fakeDoc;
    (globalThis as any).window = defaultView;
    (globalThis as any).self = defaultView;

    const container = fakeDoc.createElement("div");
    container.ownerDocument = fakeDoc;
    return container;
  }

  it("useSidePanelTabs provides a stable selectTab reference across parent re-renders", async () => {
    const container = setupDOM();
    const ReactDOM = await import("react-dom/client");
    const root = ReactDOM.createRoot(container);

    let capturedHook: ReturnType<typeof useSidePanelTabs> | null = null;
    const selectTabInstances: Array<(tab: PanelTabId) => void> = [];

    function Probe({ tick }: { tick: number }) {
      // Dynamic inline callback on each render to simulate parent re-render
      const onTabChange = (_tab: PanelTabId) => {};
      capturedHook = useSidePanelTabs("23", onTabChange);
      selectTabInstances.push(capturedHook.selectTab);
      return null;
    }

    await React.act(async () => {
      root.render(<Probe tick={1} />);
    });
    await React.act(async () => {
      root.render(<Probe tick={2} />);
    });
    await React.act(async () => {
      root.render(<Probe tick={3} />);
    });

    expect(selectTabInstances.length).toBe(3);
    // selectTab function reference must be strictly identical across all renders
    expect(selectTabInstances[0]).toBe(selectTabInstances[1]);
    expect(selectTabInstances[1]).toBe(selectTabInstances[2]);
  });

  it("con layoutMode horizontal y zona elegida: seleccionar 'chat' y forzar varios re-renders => sigue en 'chat'; cambiar de zona => 'detail'; petición de explicación => 'chat'", async () => {
    const container = setupDOM();
    const ReactDOM = await import("react-dom/client");
    const root = ReactDOM.createRoot(container);

    let harnessControls: {
      reRender: () => void;
      changeRegion: (id: string) => void;
      requestExplain: (req: { unitId: string; name: string; level: "state" | "mun" }) => void;
    } | null = null;

    function Harness() {
      const [regionId, setRegionId] = useState<string | null>("23"); // Quintana Roo initially chosen
      const [explainReq, setExplainReq] = useState<ExplainRequest | null>(null);
      const [tick, setTick] = useState<number>(0);

      harnessControls = {
        reRender: () => setTick((t) => t + 1),
        changeRegion: (newId: string) => setRegionId(newId),
        requestExplain: (req) => {
          setRegionId(req.unitId);
          setExplainReq({
            ...req,
            nonce: Date.now() + Math.random(),
          });
        },
      };

      const ctxValue = createMockContext({
        selectedRegionId: regionId,
        explainRequest: explainReq,
      });

      return (
        <AtalayaContext.Provider value={ctxValue}>
          <div data-testid="harness" data-tick={tick}>
            <DashboardPage />
          </div>
        </AtalayaContext.Provider>
      );
    }

    // 1. Initial mount with zone "23" chosen in compact-landscape
    await React.act(async () => {
      root.render(<Harness />);
    });

    // In compact landscape with a zone chosen, default tab is "detail"
    expect(latestSidePanelProps).not.toBeNull();
    expect(latestSidePanelProps!.activeTab).toBe("detail");

    // 2. User switches to "chat" (Asistente)
    await React.act(async () => {
      latestSidePanelProps!.onSelectTab!("chat");
    });
    expect(latestSidePanelProps!.activeTab).toBe("chat");

    // 3. Forzar varios re-renders => sigue en "chat"
    await React.act(async () => {
      harnessControls!.reRender();
    });
    expect(latestSidePanelProps!.activeTab).toBe("chat");

    await React.act(async () => {
      harnessControls!.reRender();
    });
    expect(latestSidePanelProps!.activeTab).toBe("chat");

    await React.act(async () => {
      harnessControls!.reRender();
    });
    expect(latestSidePanelProps!.activeTab).toBe("chat");

    // 4. Cambiar de zona a "02" (Baja California) => regresa a "detail"
    await React.act(async () => {
      harnessControls!.changeRegion("02");
    });
    expect(latestSidePanelProps!.activeTab).toBe("detail");

    // 5. Con la nueva zona, seleccionar "ranking", forzar re-render => sigue en "ranking"
    await React.act(async () => {
      latestSidePanelProps!.onSelectTab!("ranking");
    });
    expect(latestSidePanelProps!.activeTab).toBe("ranking");

    await React.act(async () => {
      harnessControls!.reRender();
    });
    expect(latestSidePanelProps!.activeTab).toBe("ranking");

    // 6. Petición de explicación (e.g. desde chip o botón de tooltip) => "chat"
    await React.act(async () => {
      harnessControls!.requestExplain({
        unitId: "02004",
        name: "Tijuana",
        level: "mun",
      });
    });
    expect(latestSidePanelProps!.activeTab).toBe("chat");

    // 7. Forzar re-renders tras la petición de explicación => sigue en "chat"
    await React.act(async () => {
      harnessControls!.reRender();
    });
    expect(latestSidePanelProps!.activeTab).toBe("chat");
  });
});
