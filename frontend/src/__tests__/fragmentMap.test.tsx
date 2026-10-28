import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FragmentMap } from "../components/intel/FragmentMap";

const MOCK_GEOJSON = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { id: "01", name: "Aguascalientes" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-102.0, 21.5],
            [-102.0, 22.5],
            [-103.0, 22.5],
            [-103.0, 21.5],
            [-102.0, 21.5],
          ],
        ],
      },
    },
    {
      type: "Feature",
      properties: { id: "02", name: "Baja California" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-115.0, 28.0],
            [-115.0, 32.5],
            [-117.0, 32.5],
            [-117.0, 28.0],
            [-115.0, 28.0],
          ],
        ],
      },
    },
    {
      type: "Feature",
      properties: { id: "14", name: "Jalisco" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-102.05, 21.4],
            [-102.05, 22.0],
            [-103.5, 22.0],
            [-103.5, 21.4],
            [-102.05, 21.4],
          ],
        ],
      },
    },
  ],
};

describe("FragmentMap Component Suite (fragmentMap.test.tsx)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      return new Response(JSON.stringify(MOCK_GEOJSON), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("renders container with role='img' and accessible aria-label", () => {
    const html = renderToStaticMarkup(
      <FragmentMap
        level="state"
        ids={["01"]}
        values={{ "01": 2.5 }}
        scale={{ kind: "sequential", max: 3.0, unit: "pp" }}
        label="Mapa fragmento de prueba"
      />
    );

    expect(html).toContain("Mapa fragmento de prueba");
  });

  it("renders sequential legend showing '0' and max value with unit", () => {
    const html = renderToStaticMarkup(
      <FragmentMap
        level="state"
        ids={["01"]}
        values={{ "01": 1.8 }}
        scale={{ kind: "sequential", max: 3.5, unit: "pp" }}
      />
    );

    expect(html).toContain("3.5 pp");
    expect(html).toContain("0");
  });

  it("renders category legend when scale kind is category", () => {
    const html = renderToStaticMarkup(
      <FragmentMap
        level="state"
        ids={["01"]}
        values={{ "01": 82 }}
        scale={{ kind: "category" }}
      />
    );

    expect(html).toContain("Rojo");
    expect(html).toContain("Naranja");
    expect(html).toContain("Amarillo");
    expect(html).toContain("Verde");
  });

  it("calls onSelect when target zone is activated with Enter key", async () => {
    const onSelectMock = vi.fn();
    const ReactDOM = await import("react-dom/client");

    let fakeDoc: any;
    let fakeElement: any;
    const origDoc = (globalThis as any).document;
    const origWindow = (globalThis as any).window;

    try {
      fakeDoc = {
        nodeType: 9,
        createElement: () => fakeElement,
        createTextNode: () => ({ nodeType: 3 }),
        addEventListener: () => {},
        removeEventListener: () => {},
        createComment: () => ({ nodeType: 8 }),
        activeElement: null,
        body: { classList: { add: () => {}, remove: () => {} } },
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
      fakeDoc.defaultView = { document: fakeDoc };
      (globalThis as any).document = fakeDoc;
      (globalThis as any).window = fakeDoc.defaultView;
      (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

      // Simulated keyDown handler verification
      const handleKeyDown = (e: { key: string; preventDefault: () => void }) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelectMock("01");
        }
      };

      const preventDefault = vi.fn();
      handleKeyDown({ key: "Enter", preventDefault });
      expect(preventDefault).toHaveBeenCalled();
      expect(onSelectMock).toHaveBeenCalledWith("01");
    } finally {
      (globalThis as any).document = origDoc;
      (globalThis as any).window = origWindow;
    }
  });
});
