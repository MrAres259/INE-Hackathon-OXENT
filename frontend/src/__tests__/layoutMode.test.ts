import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  layoutModeFor,
  useLayoutMode,
  useIsCompact,
  type LayoutMode,
} from "../lib/useMediaQuery";

describe("F4-A Layout Mode Suite (layoutMode.test.ts)", () => {
  describe("layoutModeFor pure function across all required viewports", () => {
    it("classifies horizontal phones as compact-landscape", () => {
      const horizontalPhones = [
        { width: 640, height: 360 },
        { width: 740, height: 360 },
        { width: 844, height: 390 },
        { width: 915, height: 412 },
        { width: 960, height: 440 },
        { width: 1080, height: 440 }, // large phone in landscape
      ];

      for (const vp of horizontalPhones) {
        expect(
          layoutModeFor({ ...vp, landscape: true }),
          `Expected ${vp.width}x${vp.height} (landscape: true) to be compact-landscape`
        ).toBe("compact-landscape");

        // When landscape flag is omitted, width > height implies landscape
        expect(
          layoutModeFor(vp),
          `Expected ${vp.width}x${vp.height} to derive compact-landscape`
        ).toBe("compact-landscape");
      }
    });

    it("classifies vertical phones as compact-portrait", () => {
      const verticalPhones = [
        { width: 360, height: 640 },
        { width: 375, height: 812 },
        { width: 412, height: 915 },
      ];

      for (const vp of verticalPhones) {
        expect(
          layoutModeFor({ ...vp, landscape: false }),
          `Expected ${vp.width}x${vp.height} to be compact-portrait`
        ).toBe("compact-portrait");

        expect(
          layoutModeFor(vp),
          `Expected ${vp.width}x${vp.height} to derive compact-portrait`
        ).toBe("compact-portrait");
      }
    });

    it("classifies tablets accurately (portrait = compact-portrait, landscape >= 1024 with height > 540 = desktop)", () => {
      // Portrait tablets
      expect(layoutModeFor({ width: 768, height: 1024, landscape: false })).toBe("compact-portrait");
      expect(layoutModeFor({ width: 820, height: 1180, landscape: false })).toBe("compact-portrait");

      // Landscape tablets >= 1024
      expect(layoutModeFor({ width: 1024, height: 600, landscape: true })).toBe("desktop");
      expect(layoutModeFor({ width: 1024, height: 768, landscape: true })).toBe("desktop");
    });

    it("classifies laptops and PCs as desktop", () => {
      const desktopViewports = [
        { width: 1280, height: 720 },
        { width: 1366, height: 768 },
        { width: 1920, height: 1080 },
      ];

      for (const vp of desktopViewports) {
        expect(layoutModeFor(vp)).toBe("desktop");
      }
    });

    it("handles boundary heights around 540px", () => {
      // At height 540 in landscape: compact-landscape
      expect(layoutModeFor({ width: 800, height: 540, landscape: true })).toBe("compact-landscape");
      expect(layoutModeFor({ width: 1024, height: 540, landscape: true })).toBe("compact-landscape");

      // At height 541 in landscape:
      // If width < 1024, falls into compact-portrait
      expect(layoutModeFor({ width: 800, height: 541, landscape: true })).toBe("compact-portrait");
      // If width >= 1024, is desktop
      expect(layoutModeFor({ width: 1024, height: 541, landscape: true })).toBe("desktop");
    });

    it("handles boundary widths around 1024px in portrait", () => {
      expect(layoutModeFor({ width: 1023, height: 1200, landscape: false })).toBe("compact-portrait");
      expect(layoutModeFor({ width: 1024, height: 1200, landscape: false })).toBe("desktop");
    });
  });

  describe("useLayoutMode hook SSR safety and matchMedia simulation", () => {
    const originalWindow = (globalThis as any).window;
    const originalDoc = (globalThis as any).document;
    const origActEnv = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;

    afterEach(() => {
      (globalThis as any).window = originalWindow;
      (globalThis as any).document = originalDoc;
      (globalThis as any).IS_REACT_ACT_ENVIRONMENT = origActEnv;
      vi.restoreAllMocks();
    });

    it("initial state is always 'desktop' for SSR hydration consistency", () => {
      function Tester() {
        const mode = useLayoutMode();
        const compact = useIsCompact();
        return React.createElement(
          "div",
          null,
          React.createElement("span", { "data-testid": "mode" }, mode),
          React.createElement("span", { "data-testid": "compact" }, String(compact))
        );
      }

      const html = renderToStaticMarkup(React.createElement(Tester));
      expect(html).toContain('data-testid="mode">desktop</span>');
      expect(html).toContain('data-testid="compact">false</span>');
    });

    it("updates layout mode to compact-landscape on mount and publishes to document.documentElement.dataset.layout", async () => {
      const ReactDOM = await import("react-dom/client");
      const windowListeners = new Map<string, Set<() => void>>();

      const defaultView: any = {
        addEventListener: (evt: string, cb: () => void) => {
          if (!windowListeners.has(evt)) windowListeners.set(evt, new Set());
          windowListeners.get(evt)!.add(cb);
        },
        removeEventListener: (evt: string, cb: () => void) => {
          windowListeners.get(evt)?.delete(cb);
        },
        HTMLIFrameElement: class {},
        innerWidth: 844,
        innerHeight: 390,
      };

      const fakeElement: any = {
        nodeType: 1,
        tagName: "DIV",
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

      const fakeDoc: any = {
        nodeType: 9,
        createElement: () => fakeElement,
        createTextNode: () => ({ nodeType: 3 }),
        addEventListener: () => {},
        removeEventListener: () => {},
        createComment: () => ({ nodeType: 8 }),
        defaultView: defaultView,
        activeElement: null,
        documentElement: {
          dataset: {},
        },
        body: {
          classList: {
            add: () => {},
            remove: () => {},
          },
        },
      };

      fakeElement.ownerDocument = fakeDoc;
      defaultView.document = fakeDoc;

      defaultView.matchMedia = vi.fn((query: string) => {
        let matches = false;
        if (query.includes("orientation: landscape") && query.includes("max-height: 540px")) {
          matches = true;
        } else if (query.includes("orientation: landscape")) {
          matches = true;
        } else if (query.includes("max-width: 1023px")) {
          matches = true;
        }
        return {
          matches,
          addEventListener: () => {},
          removeEventListener: () => {},
        };
      });

      (globalThis as any).window = defaultView;
      (globalThis as any).document = fakeDoc;
      (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

      const root = ReactDOM.createRoot(fakeElement);

      let currentMode: LayoutMode | null = null;
      let currentIsCompact: boolean | null = null;

      function HookConsumer() {
        const mode = useLayoutMode();
        const compact = useIsCompact();
        currentMode = mode;
        currentIsCompact = compact;
        return null;
      }

      React.act(() => {
        root.render(React.createElement(HookConsumer));
      });

      // Hook resolves to compact-landscape after effect
      expect(currentMode).toBe("compact-landscape");
      expect(currentIsCompact).toBe(true);
      expect(fakeDoc.documentElement.dataset.layout).toBe("compact-landscape");

      // Dynamic orientation change in hot runtime (rotate to portrait 390x844)
      defaultView.innerWidth = 390;
      defaultView.innerHeight = 844;
      defaultView.matchMedia = vi.fn((query: string) => {
        let matches = false;
        if (query.includes("max-width: 1023px")) {
          matches = true;
        }
        return {
          matches,
          addEventListener: () => {},
          removeEventListener: () => {},
        };
      });

      // Trigger resize or orientationchange on all registered listeners
      React.act(() => {
        windowListeners.get("resize")?.forEach((cb) => cb());
      });

      expect(currentMode).toBe("compact-portrait");
      expect(currentIsCompact).toBe(true);
      expect(fakeDoc.documentElement.dataset.layout).toBe("compact-portrait");

      // Clean up
      React.act(() => {
        root.unmount();
      });
    });
  });
});
