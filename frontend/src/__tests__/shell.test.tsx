import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BrandMark, BrandLockup } from "../components/brand/BrandMark";
import {
  nearestSnap,
  nextSnap,
  getSnapHeight,
  subscribeMediaQuery,
  useIsCompact,
  SNAP_PEEK_BASE_PX,
} from "../lib/useMediaQuery";

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
});
