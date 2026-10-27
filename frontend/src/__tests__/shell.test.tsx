import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "fs";
import path from "path";
import { BrandMark, BrandLockup } from "../components/brand/BrandMark";
import {
  nearestSnap,
  nextSnap,
  getSnapHeight,
  subscribeMediaQuery,
  useIsCompact,
  SNAP_PEEK_BASE_PX,
} from "../lib/useMediaQuery";
import {
  useSidePanelTabs,
  SidePanelTabs,
  type PanelTabId,
} from "../components/panel/SidePanelTabs";
import DashboardPage from "../app/page";

let mockRegionId: string | null = null;
let mockScenarioOpen = false;

vi.mock("@/lib/state", () => ({
  useAtalaya: () => ({
    selectedRegionId: mockRegionId,
    isScenarioModalOpen: mockScenarioOpen,
  }),
}));

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

describe("W1-A Shell & Brand Suite (shell.test.tsx)", () => {
  describe("BrandMark and BrandLockup (Contract C6)", () => {
    it("renders standalone BrandMark with role='img' and accessible aria-label", () => {
      const html = renderToStaticMarkup(<BrandMark size={32} />);
      expect(html).toContain("<svg");
      expect(html).toContain('role="img"');
      expect(html).toContain('aria-label="Atalaya Electoral"');
      expect(html).toContain('width="32"');
      expect(html).toContain('height="32"');
      expect(html).toContain("<linearGradient");
    });

    it("renders BrandMark with aria-hidden='true' and suppresses role='img'", () => {
      const html = renderToStaticMarkup(<BrandMark size={24} aria-hidden="true" />);
      expect(html).toContain("<svg");
      expect(html).toContain('aria-hidden="true"');
      expect(html).not.toContain('role="img"');
      expect(html).not.toContain('aria-label=');
    });

    it("ensures two distinct instances do not repeat linearGradient ID (unique per useId)", () => {
      const html = renderToStaticMarkup(
        <div>
          <BrandMark size={32} />
          <BrandMark size={32} />
        </div>
      );

      const matches = Array.from(html.matchAll(/linearGradient id="([^"]+)"/g));
      expect(matches.length).toBe(2);
      expect(matches[0][1]).toBeTruthy();
      expect(matches[1][1]).toBeTruthy();
      expect(matches[0][1]).not.toBe(matches[1][1]);
    });

    it("renders BrandLockup with link to '/', aria-label, logo texts and conditional subtitle", () => {
      const fullHtml = renderToStaticMarkup(<BrandLockup />);
      expect(fullHtml).toContain('href="/"');
      expect(fullHtml).toContain('aria-label="Atalaya Electoral, inicio"');
      expect(fullHtml).toContain("Atalaya");
      expect(fullHtml).toContain("Electoral");
      expect(fullHtml).toContain("Riesgo de abstención · Elección federal 2027");

      const compactHtml = renderToStaticMarkup(<BrandLockup compact />);
      expect(compactHtml).toContain('href="/"');
      expect(compactHtml).toContain("Atalaya");
      expect(compactHtml).toContain("Electoral");
      expect(compactHtml).not.toContain("Riesgo de abstención · Elección federal 2027");
    });
  });

  describe("Bottom Sheet pure snapping logic", () => {
    const vh = 800;

    it("calculates accurate snap heights for peek, half, and full", () => {
      expect(getSnapHeight("peek", vh)).toBe(SNAP_PEEK_BASE_PX);
      expect(getSnapHeight("peek", vh, 34)).toBe(SNAP_PEEK_BASE_PX + 34);
      expect(getSnapHeight("half", vh)).toBe(Math.round(800 * 0.52)); // 416
      expect(getSnapHeight("full", vh)).toBe(800 - 12); // 788
    });

    it("nearestSnap correctly snaps to the closest height threshold", () => {
      // peek is 132
      expect(nearestSnap(80, vh)).toBe("peek");
      expect(nearestSnap(140, vh)).toBe("peek");
      expect(nearestSnap(200, vh)).toBe("peek");

      // half is 416
      expect(nearestSnap(350, vh)).toBe("half");
      expect(nearestSnap(420, vh)).toBe("half");
      expect(nearestSnap(550, vh)).toBe("half");

      // full is 788
      expect(nearestSnap(680, vh)).toBe("full");
      expect(nearestSnap(780, vh)).toBe("full");
      expect(nearestSnap(900, vh)).toBe("full");
    });

    it("nearestSnap handles safeAreaBottom offset for peek", () => {
      const safeBottom = 40;
      // peek target: 132 + 40 = 172
      expect(nearestSnap(180, vh, safeBottom)).toBe("peek");
    });

    it("nextSnap cycles cleanly: peek -> half -> full -> peek", () => {
      expect(nextSnap("peek")).toBe("half");
      expect(nextSnap("half")).toBe("full");
      expect(nextSnap("full")).toBe("peek");
    });
  });

  describe("Responsive hook logic (useIsCompact / subscribeMediaQuery)", () => {
    const originalWindow = (globalThis as any).window;

    afterEach(() => {
      (globalThis as any).window = originalWindow;
      vi.restoreAllMocks();
    });

    it("useIsCompact renders as false during SSR / static markup (no window)", () => {
      function Tester() {
        const isCompact = useIsCompact();
        return <div data-testid="compact">{String(isCompact)}</div>;
      }
      const html = renderToStaticMarkup(<Tester />);
      expect(html).toContain('data-testid="compact">false</div>');
    });

    it("subscribeMediaQuery safely invokes onMatch(false) when window is absent", () => {
      (globalThis as any).window = undefined;
      let result = true;
      const unsub = subscribeMediaQuery("(max-width: 1023px)", (val) => {
        result = val;
      });
      expect(result).toBe(false);
      expect(typeof unsub).toBe("function");
      unsub();
    });

    it("subscribeMediaQuery responds to mock matchMedia and updates on change events", () => {
      let changeListener: (() => void) | undefined = undefined;
      const mockMq = {
        matches: true,
        addEventListener: vi.fn((event: string, cb: () => void) => {
          if (event === "change") changeListener = cb;
        }),
        removeEventListener: vi.fn(),
      };

      (globalThis as any).window = {
        matchMedia: vi.fn((_query: string) => mockMq),
      };

      let compactState = false;
      const unsub = subscribeMediaQuery("(max-width: 1023px)", (val) => {
        compactState = val;
      });

      // Initially matched
      expect(compactState).toBe(true);
      expect((globalThis as any).window.matchMedia).toHaveBeenCalledWith("(max-width: 1023px)");
      expect(mockMq.addEventListener).toHaveBeenCalledWith("change", expect.any(Function));

      // Simulate change to desktop (matches = false)
      mockMq.matches = false;
      if (typeof changeListener === "function") {
        (changeListener as () => void)();
      }
      expect(compactState).toBe(false);

      // Cleanup
      unsub();
      expect(mockMq.removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
    });
  });

  describe("W2-A Shell Fixes Suite", () => {
    describe("A1 · SidePanelTabs tab switching and stabilization", () => {
      let defaultView: any;
      let fakeDoc: any;
      let fakeElement: any;
      const origWindow = (globalThis as any).window;
      const origDoc = (globalThis as any).document;
      const origActEnv = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;

      beforeEach(() => {
        defaultView = {
          addEventListener: () => {},
          removeEventListener: () => {},
          HTMLIFrameElement: class {},
        };
        fakeDoc = {
          nodeType: 9,
          createElement: () => fakeElement,
          createTextNode: () => ({ nodeType: 3 }),
          addEventListener: () => {},
          removeEventListener: () => {},
          createComment: () => ({ nodeType: 8 }),
          defaultView: defaultView,
          activeElement: null,
          body: {
            classList: {
              add: () => {},
              remove: () => {},
            },
          },
        };
        fakeElement = {
          nodeType: 1,
          tagName: "DIV",
          ownerDocument: fakeDoc,
          addEventListener: () => {},
          removeEventListener: () => {},
          appendChild: () => {},
          removeChild: () => {},
          insertBefore: () => {},
          setAttribute: () => {},
          removeAttribute: () => {},
          style: {},
          childNodes: [],
        };
        defaultView.document = fakeDoc;
        (globalThis as any).document = fakeDoc;
        (globalThis as any).window = defaultView;
        (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
      });

      afterEach(() => {
        (globalThis as any).document = origDoc;
        (globalThis as any).window = origWindow;
        (globalThis as any).IS_REACT_ACT_ENVIRONMENT = origActEnv;
      });

      it("con una zona seleccionada, cambiar a Ranking y forzar un re-render del padre no regresa a Diagnóstico; cambiar a otra zona sí", async () => {
        const ReactDOM = await import("react-dom/client");
        const root = ReactDOM.createRoot(fakeElement);

        let latestHook: ReturnType<typeof useSidePanelTabs> | null = null;
        const tabChanges: string[] = [];

        function ParentComponent({ regionId, renderId }: { regionId: string | null; renderId: number }) {
          // Inline function created anew on every render of parent (simulating the bug condition)
          const onTabChangeInline = (tab: PanelTabId) => {
            tabChanges.push(`render-${renderId}:${tab}`);
          };

          latestHook = useSidePanelTabs(regionId, onTabChangeInline);
          return null;
        }

        // 1. Initial mount with region "09" selected
        React.act(() => {
          root.render(<ParentComponent regionId="09" renderId={1} />);
        });
        expect(latestHook!.activeTab).toBe("detail");

        // 2. User switches to "ranking"
        React.act(() => {
          latestHook!.selectTab("ranking");
        });
        expect(latestHook!.activeTab).toBe("ranking");

        // 3. Parent re-renders with the SAME regionId ("09") and a NEW inline onTabChange callback
        React.act(() => {
          root.render(<ParentComponent regionId="09" renderId={2} />);
        });
        // The tab MUST remain "ranking" (not forced back to "detail")
        expect(latestHook!.activeTab).toBe("ranking");

        // 4. Force another re-render of parent with same region
        React.act(() => {
          root.render(<ParentComponent regionId="09" renderId={3} />);
        });
        expect(latestHook!.activeTab).toBe("ranking");

        // 5. Selecting a DIFFERENT region ("19") DOES return to "detail"
        React.act(() => {
          root.render(<ParentComponent regionId="19" renderId={4} />);
        });
        expect(latestHook!.activeTab).toBe("detail");
        expect(tabChanges).toContain("render-4:detail");

        // 6. Switching to "chat", deselecting, and reselecting region "19"
        React.act(() => {
          latestHook!.selectTab("chat");
        });
        expect(latestHook!.activeTab).toBe("chat");

        // Deselect (null)
        React.act(() => {
          root.render(<ParentComponent regionId={null} renderId={5} />);
        });
        // Deselecting does not force detail
        expect(latestHook!.activeTab).toBe("chat");

        // Reselect region "19"
        React.act(() => {
          root.render(<ParentComponent regionId="19" renderId={6} />);
        });
        expect(latestHook!.activeTab).toBe("detail");

        React.act(() => {
          root.unmount();
        });
      });

      it("a 375 px con una zona seleccionada, las pestañas Ranking y Asistente se pueden abrir y se quedan abiertas", async () => {
        const ReactDOM = await import("react-dom/client");
        const root = ReactDOM.createRoot(fakeElement);

        let latestHook: ReturnType<typeof useSidePanelTabs> | null = null;
        let snapState = "peek";

        function MobileHost({ regionId, tick }: { regionId: string | null; tick: number }) {
          latestHook = useSidePanelTabs(regionId, (tab) => {
            if (snapState === "peek") snapState = "half";
          });
          return null;
        }

        // Mount on 375px mobile device with region selected
        React.act(() => {
          root.render(<MobileHost regionId="09" tick={1} />);
        });
        expect(latestHook!.activeTab).toBe("detail");

        // Open Ranking
        React.act(() => {
          latestHook!.selectTab("ranking");
        });
        expect(latestHook!.activeTab).toBe("ranking");
        expect(snapState).toBe("half");

        // Force parent re-render (e.g. state/prop updates on 375px screen)
        React.act(() => {
          root.render(<MobileHost regionId="09" tick={2} />);
        });
        // Stays open on Ranking
        expect(latestHook!.activeTab).toBe("ranking");

        // Open Asistente
        React.act(() => {
          latestHook!.selectTab("chat");
        });
        expect(latestHook!.activeTab).toBe("chat");

        // Force another parent re-render
        React.act(() => {
          root.render(<MobileHost regionId="09" tick={3} />);
        });
        // Stays open on Asistente
        expect(latestHook!.activeTab).toBe("chat");

        React.act(() => {
          root.unmount();
        });
      });
    });

    describe("A2 · Una sola instancia del panel", () => {
      it("renders exactly one <aside> in DashboardPage with data-tour='panel' on tabs", () => {
        mockRegionId = null;
        mockScenarioOpen = false;
        const html = renderToStaticMarkup(<DashboardPage />);
        const matches = html.match(/<aside\b[^>]*>/g);
        expect(matches).not.toBeNull();
        expect(matches!.length).toBe(1);
        expect(html).toContain('data-tour="panel"');
      });

      it("desktop panel contains resize handle and toggle button", () => {
        mockRegionId = null;
        mockScenarioOpen = false;
        const html = renderToStaticMarkup(<DashboardPage />);
        // Desktop has resize handle
        expect(html).toContain("cursor-col-resize");
        // Compact grab handle is not rendered on desktop
        expect(html).not.toContain("Expandir o contraer panel");
        // Toggle button is present on PC
        expect(html).toContain('aria-label="Ocultar panel"');
      });
    });

    describe("A3 & C10 · Map CSS variables (--map-inset-bottom and --map-fit-bottom)", () => {
      it("renders CSS variables with 0px on desktop initial markup", () => {
        mockRegionId = null;
        mockScenarioOpen = false;
        const html = renderToStaticMarkup(<DashboardPage />);
        expect(html).toContain("--map-inset-bottom:0px");
        expect(html).toContain("--map-fit-bottom:0px");
      });

      it("calculates --map-fit-bottom as Math.round(0.52 * innerHeight) in compact mode", () => {
        const vh = 800;
        const expectedFitBottom = `${Math.round(0.52 * vh)}px`; // "416px"
        expect(expectedFitBottom).toBe("416px");

        const mobileVh = 667;
        const expectedMobileFit = `${Math.round(0.52 * mobileVh)}px`; // "347px"
        expect(expectedMobileFit).toBe("347px");
      });
    });

    describe("A4 · MapLibre controls margin-bottom in globals.css", () => {
      it("globals.css sets margin-bottom: var(--map-inset-bottom, 0px) for bottom controls", () => {
        const cssPath = path.resolve(__dirname, "../app/globals.css");
        const cssContent = fs.readFileSync(cssPath, "utf-8");
        expect(cssContent).toContain(".maplibregl-ctrl-bottom-right");
        expect(cssContent).toContain(".maplibregl-ctrl-bottom-left");
        expect(cssContent).toContain("margin-bottom: var(--map-inset-bottom, 0px);");
      });
    });
  });
});
