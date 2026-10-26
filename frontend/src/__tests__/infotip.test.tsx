import React from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  computeTipPosition,
  InfoTip,
  type DOMRectLike,
} from "../components/ui/InfoTip";

describe("InfoTip and computeTipPosition", () => {
  const defaultViewport = { width: 800, height: 600 };
  const tipSize = { width: 100, height: 50 };

  it("computes position above when it fits (cabe arriba)", () => {
    const anchor: DOMRectLike = {
      top: 200,
      bottom: 220,
      left: 100,
      right: 120,
      width: 20,
      height: 20,
    };

    const pos = computeTipPosition(anchor, tipSize, defaultViewport, "top", 8);

    expect(pos.side).toBe("top");
    expect(pos.top).toBe(200 - 50 - 8); // 142
    expect(pos.left).toBe(100 + (20 - 100) / 2); // 60
  });

  it("flips below when it does not fit above (no cabe arriba => abajo)", () => {
    const anchor: DOMRectLike = {
      top: 20, // 20 < 50 + 8 = 58
      bottom: 40,
      left: 100,
      right: 120,
      width: 20,
      height: 20,
    };

    const pos = computeTipPosition(anchor, tipSize, defaultViewport, "top", 8);

    expect(pos.side).toBe("bottom");
    expect(pos.top).toBe(40 + 8); // 48
    expect(pos.left).toBe(100 + (20 - 100) / 2); // 60
  });

  it("clamps left edge to margin when overflowing left (recorte izquierdo)", () => {
    const anchor: DOMRectLike = {
      top: 200,
      bottom: 220,
      left: 10,
      right: 30,
      width: 20,
      height: 20,
    };

    // Unclamped left would be 10 + (20 - 100)/2 = -30
    const pos = computeTipPosition(anchor, tipSize, defaultViewport, "top", 8);

    expect(pos.side).toBe("top");
    expect(pos.left).toBe(8);
  });

  it("clamps right edge to margin when overflowing right (recorte derecho)", () => {
    const anchor: DOMRectLike = {
      top: 200,
      bottom: 220,
      left: 770,
      right: 790,
      width: 20,
      height: 20,
    };

    // Unclamped left would be 770 + (20 - 100)/2 = 730
    // Max left is viewport.width (800) - tip.width (100) - margin (8) = 692
    const pos = computeTipPosition(anchor, tipSize, defaultViewport, "top", 8);

    expect(pos.side).toBe("top");
    expect(pos.left).toBe(692);
  });

  it("renders a button with type='button' and accessible aria-label without rendering closed popover", () => {
    const html = renderToStaticMarkup(<InfoTip term="semaforo" />);

    expect(html).toContain('<button type="button"');
    expect(html).toContain('aria-label="¿Qué es Semáforo de Riesgo?"');
    // Closed popover / portal should not be present in static markup
    expect(html).not.toContain('role="tooltip"');
    expect(html).not.toContain("Clasifica cada zona por su índice");
  });

  it("renders empty string when InfoTip has no content", () => {
    const html = renderToStaticMarkup(<InfoTip />);
    expect(html).toBe("");
  });
});
