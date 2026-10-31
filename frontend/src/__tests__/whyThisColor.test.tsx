import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WhyThisColor } from "../components/panel/WhyThisColor";
import { RegionDetailPanel } from "../components/panel/RegionDetailPanel";
import type { Explanation } from "../lib/explain/types";

// Captured mocks
let mockExplainCardProps: any = null;
const mockRequestExplain = vi.fn();
const mockGetExplanation = vi.fn();

// Mock ExplainCard
vi.mock("@/components/explain/ExplainCard", () => ({
  ExplainCard: (props: any) => {
    mockExplainCardProps = props;
    return (
      <div data-testid="mock-explain-card">
        <span data-testid="card-headline">{props.explanation?.headline}</span>
        <button
          type="button"
          data-testid="btn-explain-in-chat"
          onClick={props.onExplainInChat}
        >
          Explícamelo en el asistente
        </button>
      </div>
    );
  },
}));

// Mock explain api
vi.mock("@/lib/explain/api", () => ({
  getExplanation: (...args: any[]) => mockGetExplanation(...args),
}));

// Mock state with selectedDetail for RegionDetailPanel
const mockSelectedDetail: any = {
  id: "23",
  name: "Quintana Roo",
  level: "state",
  category: "rojo",
  risk_score: 59.5,
  pred_abstention: 0.602,
  lista_nominal: 1450000,
  drivers: [
    {
      key: "graproes",
      label: "Escolaridad promedio",
      contribution_pp: -5.9,
      direction: "baja_abstencion",
    },
    {
      key: "pct_sin_servsalud",
      label: "Carencia de servicios de salud",
      contribution_pp: 3.2,
      direction: "sube_abstencion",
    },
  ],
  recommendations: [],
  series: [],
};

vi.mock("@/lib/state", () => ({
  useAtalaya: () => ({
    selectedDetail: mockSelectedDetail,
    loadingDetail: false,
    riskItems: [],
    level: "state",
    selectRegion: vi.fn(),
    selectState: vi.fn(),
    meta: null,
    scenario: "base",
    simulationResult: null,
    requestExplain: mockRequestExplain,
  }),
}));

const MOCK_EXPLANATION: Explanation = {
  unit_id: "23",
  level: "state",
  name: "Quintana Roo",
  state_name: null,
  category: "rojo",
  risk_score: 59.5,
  pred_abstention_pct: 60.2,
  headline: "Abstención persistentemente alta por movilidad residencial",
  in_short: ["Historial de baja afluencia", "Alta migración"],
  reasons: [
    {
      id: "r1",
      kind: "historial",
      title: "Patrón histórico persistente",
      body: "La entidad ha votado por debajo del promedio nacional en 5 de las últimas 6 elecciones.",
      strength: "fuerte",
      evidence_type: "dato_medido",
      direction: "sube_abstencion",
      numbers: [],
      source: "CCPC",
    },
  ],
  score_breakdown: [
    { key: "abs", label: "Abstención pronosticada", weight: 0.5, rank_pct: 78, points: 39.0, plain: "39.0 pts" },
    { key: "vuln", label: "Vulnerabilidad", weight: 0.2, rank_pct: 53, points: 10.6, plain: "10.6 pts" },
    { key: "trend", label: "Tendencia", weight: 0.15, rank_pct: 47, points: 7.05, plain: "7.05 pts" },
    { key: "vol", label: "Volatilidad", weight: 0.15, rank_pct: 19, points: 2.85, plain: "2.85 pts" },
  ],
  groups: [],
  what_we_dont_know: [],
  confidence: "alta",
  confidence_note: "Datos completos desde 2009",
  recommendations: [],
  suggested_questions: [
    { id: "q1", text: "¿Quién vota menos en Quintana Roo?", intent_hint: "explain_unit" },
  ],
  sources: ["INE CCPC", "INEGI 2020"],
  data_year: 2024,
  scenario_note: "Escenario base",
  generated_at: "2026-10-31T12:00:00Z",
};

describe("WhyThisColor Component Suite (whyThisColor.test.tsx)", () => {
  let origDoc: any;
  let origWin: any;
  let origActEnv: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExplainCardProps = null;
    origDoc = (globalThis as any).document;
    origWin = (globalThis as any).window;
    origActEnv = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    (globalThis as any).document = origDoc;
    (globalThis as any).window = origWin;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = origActEnv;
  });

  function setupFakeDOM() {
    const elements: Record<string, any[]> = {};
    const fakeDoc: any = {
      nodeType: 9,
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
          setAttribute: (k: string, v: string) => {
            el[k] = v;
          },
          removeAttribute: (k: string) => {
            delete el[k];
          },
          focus: vi.fn(),
          style: {},
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
      body: { classList: { add: vi.fn(), remove: vi.fn() } },
    };

    const defaultView: any = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn().mockReturnValue(true),
      HTMLIFrameElement: class {},
      Element: class {},
      HTMLElement: class {},
    };

    fakeDoc.defaultView = defaultView;
    (globalThis as any).document = fakeDoc;
    (globalThis as any).window = defaultView;

    return { fakeDoc, elements };
  }

  it("1. carga → tarjeta: muestra estado de carga inicial y luego la tarjeta con ExplainCard", async () => {
    let resolvePromise: (val: any) => void = () => {};
    const pendingPromise = new Promise((resolve) => {
      resolvePromise = resolve;
    });
    mockGetExplanation.mockReturnValue(pendingPromise);

    const { fakeDoc } = setupFakeDOM();
    const container = fakeDoc.createElement("div");

    const ReactDOM = await import("react-dom/client");
    const root = ReactDOM.createRoot(container);

    // Initial render: should show loading
    await React.act(async () => {
      root.render(<WhyThisColor unitId="23" name="Quintana Roo" level="state" />);
    });

    expect(mockGetExplanation).toHaveBeenCalledWith("23", expect.any(AbortSignal));
    // Loading skeleton is rendered
    expect(mockExplainCardProps).toBeNull();

    // Resolve with explanation
    await React.act(async () => {
      resolvePromise(MOCK_EXPLANATION);
    });

    // ExplainCard is now rendered with variant="panel"
    expect(mockExplainCardProps).not.toBeNull();
    expect(mockExplainCardProps.variant).toBe("panel");
    expect(mockExplainCardProps.explanation.unit_id).toBe("23");
    expect(mockExplainCardProps.explanation.headline).toBe(MOCK_EXPLANATION.headline);
  });

  it("2. cambio de zona aborta la petición anterior", async () => {
    const signals: AbortSignal[] = [];
    mockGetExplanation.mockImplementation((_id: string, signal: AbortSignal) => {
      signals.push(signal);
      return new Promise(() => {}); // never resolves
    });

    const { fakeDoc } = setupFakeDOM();
    const container = fakeDoc.createElement("div");

    const ReactDOM = await import("react-dom/client");
    const root = ReactDOM.createRoot(container);

    // Render with unitId "23"
    await React.act(async () => {
      root.render(<WhyThisColor unitId="23" name="Quintana Roo" level="state" />);
    });

    expect(signals.length).toBe(1);
    expect(signals[0].aborted).toBe(false);

    // Change zone to unitId "07"
    await React.act(async () => {
      root.render(<WhyThisColor unitId="07" name="Chiapas" level="state" />);
    });

    expect(signals.length).toBe(2);
    // The previous request was aborted!
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });

  it("3. error muestra Reintentar y permite reintentar la petición", async () => {
    let rejectPromise: (err: any) => void = () => {};
    let resolveSecondPromise: (val: any) => void = () => {};

    mockGetExplanation
      .mockImplementationOnce(() => new Promise((_, reject) => {
        rejectPromise = reject;
      }))
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveSecondPromise = resolve;
      }));

    const { fakeDoc, elements } = setupFakeDOM();
    const container = fakeDoc.createElement("div");

    const ReactDOM = await import("react-dom/client");
    const root = ReactDOM.createRoot(container);

    await React.act(async () => {
      root.render(<WhyThisColor unitId="23" name="Quintana Roo" level="state" />);
    });

    // Reject the first fetch with a generic error
    await React.act(async () => {
      rejectPromise(new Error("Network connection error"));
    });

    // Should not render card
    expect(mockExplainCardProps).toBeNull();

    // Find the retry button
    const buttons = elements["button"] || [];
    const retryBtn = buttons.find((btn) => {
      const pKey = Object.keys(btn).find((k) => k.startsWith("__reactProps"));
      return pKey && btn[pKey]?.onClick;
    });

    expect(retryBtn).toBeDefined();

    // Click Reintentar
    const retryPropsKey = Object.keys(retryBtn).find((k) => k.startsWith("__reactProps"))!;
    await React.act(async () => {
      retryBtn[retryPropsKey].onClick();
    });

    // getExplanation called a second time
    expect(mockGetExplanation).toHaveBeenCalledTimes(2);

    // Resolve second request
    await React.act(async () => {
      resolveSecondPromise(MOCK_EXPLANATION);
    });

    // Now card is displayed
    expect(mockExplainCardProps).not.toBeNull();
    expect(mockExplainCardProps.explanation.unit_id).toBe("23");
  });

  it("4. el botón llama requestExplain con id, nombre y nivel", async () => {
    mockGetExplanation.mockResolvedValue(MOCK_EXPLANATION);

    const { fakeDoc } = setupFakeDOM();
    const container = fakeDoc.createElement("div");

    const ReactDOM = await import("react-dom/client");
    const root = ReactDOM.createRoot(container);

    await React.act(async () => {
      root.render(<WhyThisColor unitId="23" name="Quintana Roo" level="state" />);
    });

    expect(mockExplainCardProps).not.toBeNull();
    expect(typeof mockExplainCardProps.onExplainInChat).toBe("function");

    // Invoke onExplainInChat callback passed to ExplainCard
    mockExplainCardProps.onExplainInChat();

    // requestExplain was called with { unitId, name, level }
    expect(mockRequestExplain).toHaveBeenCalledWith({
      unitId: "23",
      name: "Quintana Roo",
      level: "state",
    });
  });

  it("5. el detalle técnico está plegado por defecto en RegionDetailPanel", () => {
    const html = renderToStaticMarkup(<RegionDetailPanel />);

    // Section "¿Por qué este color?" is present
    expect(html).toContain("¿Por qué este color?");

    // Folded technical details element is present
    expect(html).toContain('data-testid="technical-drivers-details"');
    expect(html).toContain("Detalle técnico: factores del modelo estructural");

    // Must NOT have open attribute (folded/collapsed by default)
    expect(html).not.toMatch(/<details[^>]*\bopen\b/i);

    // Plain language technical disclaimer is present
    expect(html).toContain(
      "Estos factores salen de un modelo que compara características de todas las zonas a la vez"
    );

    // Drivers data is retained
    expect(html).toContain("Escolaridad promedio");
    expect(html).toContain("Carencia de servicios de salud");
  });
});
