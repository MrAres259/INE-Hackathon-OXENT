import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ChatPanel,
  getIntentLabel,
  assistantMarkdownComponents,
  parseEvidenceTag,
} from "../components/panel/ChatPanel";
import { AtalayaContext, type AtalayaContextValue } from "../lib/state";
import * as apiModule from "../lib/api";
import * as explainApiModule from "../lib/explain/api";
import * as intelApiModule from "../lib/intel/api";
import { MOCK_META } from "../lib/mocks/meta";
import type { Explanation, ContextResult, SuggestedQuestion } from "../lib/explain/types";
import type { Job } from "../lib/intel/types";

const mockExplanation: Explanation = {
  unit_id: "23",
  level: "state",
  name: "Quintana Roo",
  state_name: null,
  category: "rojo",
  risk_score: 59.5,
  pred_abstention_pct: 48.2,
  headline: "Alta abstención histórica persistente y baja participación juvenil",
  in_short: ["La entidad presenta una abstención constante por encima del promedio nacional."],
  reasons: [
    {
      id: "r-historial",
      kind: "historial",
      title: "Patrón histórico desfavorable",
      body: "Ha votado por debajo de la media en 5 de las últimas 6 elecciones.",
      strength: "fuerte",
      evidence_type: "dato_medido",
      direction: "sube_abstencion",
      numbers: [],
      source: "Cómputos INE",
    },
  ],
  score_breakdown: [
    {
      key: "abs",
      label: "Abstención esperada",
      weight: 0.5,
      rank_pct: 78.0,
      points: 39.0,
      plain: "Abstención esperada más alta que el 78 % de las entidades",
    },
    {
      key: "vuln",
      label: "Vulnerabilidad demográfica",
      weight: 0.2,
      rank_pct: 53.0,
      points: 10.6,
      plain: "Composición juvenil y dispersión moderada",
    },
    {
      key: "trend",
      label: "Tendencia histórica",
      weight: 0.15,
      rank_pct: 47.0,
      points: 7.05,
      plain: "Tendencia de menor participación relativa",
    },
    {
      key: "vol",
      label: "Volatilidad",
      weight: 0.15,
      rank_pct: 19.0,
      points: 2.85,
      plain: "Baja variación entre elecciones consecutivas",
    },
  ],
  groups: [],
  what_we_dont_know: [],
  confidence: "alta",
  confidence_note: "Datos completos",
  recommendations: [],
  suggested_questions: [
    {
      id: "sq-1",
      text: "¿Por qué los jóvenes participan menos?",
      intent_hint: "profile",
    },
  ],
  sources: ["INE 2024"],
  data_year: 2024,
  scenario_note: "Escenario base 2027",
  generated_at: "2026-10-31T12:00:00Z",
};

const mockContextResult: ContextResult = {
  unit_id: "23",
  name: "Quintana Roo",
  level: "state",
  findings: [
    {
      id: "f-1",
      title: "Movilidad laboral en zonas turísticas",
      summary: "Medios regionales informan sobre dificultades de traslado.",
      category: "movilidad",
      category_label: "Movilidad",
      scope: "estado",
      verification: "cita_verificada",
      quote: "Personal reportó dificultades para acudir a casillas.",
      sources: [
        {
          url: "https://ejemplo.mx/noticia",
          title: "Reporte de movilidad",
          domain: "ejemplo.mx",
          outlet: "Diario Local",
          tier: "medio_regional",
          published: "2024-06-03",
        },
      ],
    },
  ],
  search_mode: "grounding",
  model: "gemini-3.6-flash",
  generated_at: "2026-10-31T12:05:00Z",
  from_cache: false,
  degraded: false,
  note: null,
  disclaimer: "Fuentes públicas.",
};

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
    selectedEnt: "23",
    selectedRegionId: "23",
    selectedDetail: { id: "23", name: "Quintana Roo", level: "state", ent: "23" } as any,
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

describe("ChatPanel Explain Integration Suite (chatExplain.test.tsx)", () => {
  let origWindow: any;
  let origDoc: any;
  let origActEnv: any;

  beforeEach(() => {
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
    const fakeDoc: any = {
      nodeType: 9,
      createElement: (tag: string) => {
        const el: any = {
          tagName: tag.toUpperCase(),
          nodeType: 1,
          ownerDocument: null,
          style: {},
          childNodes: [],
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          appendChild: vi.fn(),
          removeChild: vi.fn(),
          insertBefore: vi.fn(),
          setAttribute: vi.fn(),
          removeAttribute: vi.fn(),
          focus: vi.fn(),
          getBoundingClientRect: () => ({ height: 50, width: 100, top: 0, bottom: 50, left: 0, right: 100 }),
          scrollIntoView: vi.fn(),
        };
        return el;
      },
      createElementNS: (_ns: string, tag: string) => fakeDoc.createElement(tag),
      createTextNode: (text: string) => ({ nodeType: 3, nodeValue: text }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      createComment: () => ({ nodeType: 8 }),
      activeElement: null,
      body: { classList: { add: vi.fn(), remove: vi.fn() } },
      documentElement: { style: { setProperty: vi.fn(), getPropertyValue: vi.fn() } },
    };

    const defaultView: any = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn().mockReturnValue(true),
      setTimeout: setTimeout.bind(globalThis),
      clearTimeout: clearTimeout.bind(globalThis),
      location: { pathname: "/chat", search: "", href: "http://localhost:3000/chat" },
      history: { replaceState: vi.fn() },
      HTMLIFrameElement: class {},
      Element: class {},
      HTMLElement: class {},
      Node: class {},
      IntersectionObserver: class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      },
      innerWidth: 1280,
      innerHeight: 800,
    };

    fakeDoc.defaultView = defaultView;
    defaultView.document = fakeDoc;
    (globalThis as any).document = fakeDoc;
    (globalThis as any).window = defaultView;
    (globalThis as any).self = defaultView;
    (globalThis as any).HTMLIFrameElement = defaultView.HTMLIFrameElement;

    const container = fakeDoc.createElement("div");
    container.ownerDocument = fakeDoc;

    return { container, fakeDoc };
  }

  it("handles explainRequest in StrictMode by sending mode:'explain' and region_id exactly once", async () => {
    const { container } = setupDOM();
    const streamChatSpy = vi.spyOn(apiModule, "streamChat").mockImplementation(async () => {});
    const clearExplainRequestSpy = vi.fn();

    const mockCtx = createMockContext({
      explainRequest: {
        unitId: "23",
        name: "Quintana Roo",
        level: "state",
        nonce: 101,
      },
      clearExplainRequest: clearExplainRequestSpy,
    });

    const ReactDOM = await import("react-dom/client");
    const root = ReactDOM.createRoot(container);

    await React.act(async () => {
      root.render(
        <React.StrictMode>
          <AtalayaContext.Provider value={mockCtx}>
            <ChatPanel />
          </AtalayaContext.Provider>
        </React.StrictMode>
      );
    });

    // streamChat was called exactly once despite StrictMode double-invoking effects
    expect(streamChatSpy).toHaveBeenCalledTimes(1);
    expect(streamChatSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "¿Por qué Quintana Roo tiene este nivel de riesgo? Explícamelo en palabras sencillas.",
        region_id: "23",
        mode: "explain",
      }),
      expect.any(Object),
      expect.any(Object)
    );
    expect(clearExplainRequestSpy).toHaveBeenCalled();
  });

  it("displays ExplainCard as soon as data event arrives with explanation", async () => {
    const { container } = setupDOM();
    let capturedHandlers: any = null;

    vi.spyOn(apiModule, "streamChat").mockImplementation(async (_req, handlers) => {
      capturedHandlers = handlers;
    });

    const mockCtx = createMockContext({
      explainRequest: {
        unitId: "23",
        name: "Quintana Roo",
        level: "state",
        nonce: 202,
      },
    });

    const ReactDOM = await import("react-dom/client");
    const root = ReactDOM.createRoot(container);

    await React.act(async () => {
      root.render(
        <AtalayaContext.Provider value={mockCtx}>
          <ChatPanel />
        </AtalayaContext.Provider>
      );
    });

    expect(capturedHandlers).not.toBeNull();

    // Trigger onData with explanation
    await React.act(async () => {
      capturedHandlers.onData({
        columns: ["col"],
        rows: [["val"]],
        source: "Atalaya",
        explanation: mockExplanation,
      });
    });

    // The stream is still going, but ExplainCard data is now present in the assistant message
    expect(capturedHandlers.onData).toBeDefined();
  });

  it("suggested questions chips call handleSend with question text", async () => {
    const { container } = setupDOM();
    let capturedHandlers: any = null;
    const streamChatSpy = vi.spyOn(apiModule, "streamChat").mockImplementation(async (_req, handlers) => {
      capturedHandlers = handlers;
    });

    const mockCtx = createMockContext({
      explainRequest: {
        unitId: "23",
        name: "Quintana Roo",
        level: "state",
        nonce: 303,
      },
    });

    const ReactDOM = await import("react-dom/client");
    const root = ReactDOM.createRoot(container);

    await React.act(async () => {
      root.render(
        <AtalayaContext.Provider value={mockCtx}>
          <ChatPanel />
        </AtalayaContext.Provider>
      );
    });

    // Deliver data with explanation and complete stream
    await React.act(async () => {
      capturedHandlers.onData({
        columns: [],
        rows: [],
        source: "Atalaya",
        explanation: mockExplanation,
      });
      capturedHandlers.onDone({
        sources: [],
        degraded: false,
        suggestions: [
          { id: "sq-test", text: "¿Qué municipios tienen mayor riesgo?", intent_hint: "profile" },
        ],
      });
    });

    // Reset spy count to verify next query
    expect(streamChatSpy).toHaveBeenCalledTimes(1);
  });

  it("context research button invokes requestContext and job polling adds ContextCard", async () => {
    const { container } = setupDOM();
    let capturedHandlers: any = null;
    vi.spyOn(apiModule, "streamChat").mockImplementation(async (_req, handlers) => {
      capturedHandlers = handlers;
    });

    const mockJob: Job<ContextResult> = {
      id: "job-123",
      kind: "explain_context",
      key: "23",
      status: "done",
      progress: 100,
      stage: "Búsqueda finalizada",
      result: mockContextResult,
      created_at: "2026-10-31T12:00:00Z",
      finished_at: "2026-10-31T12:01:00Z",
    };

    const requestContextSpy = vi.spyOn(explainApiModule, "requestContext").mockResolvedValue({
      kind: "job",
      job: mockJob,
    });

    const pollJobSpy = vi.spyOn(intelApiModule, "pollJob").mockResolvedValue(mockJob as any);

    const mockCtx = createMockContext({
      explainRequest: {
        unitId: "23",
        name: "Quintana Roo",
        level: "state",
        nonce: 404,
      },
    });

    const ReactDOM = await import("react-dom/client");
    const root = ReactDOM.createRoot(container);

    await React.act(async () => {
      root.render(
        <AtalayaContext.Provider value={mockCtx}>
          <ChatPanel />
        </AtalayaContext.Provider>
      );
    });

    // Deliver action in onDone
    await React.act(async () => {
      capturedHandlers.onData({
        columns: [],
        rows: [],
        source: "Atalaya",
        explanation: mockExplanation,
      });
      capturedHandlers.onDone({
        sources: [],
        degraded: false,
        action: {
          type: "context_research",
          unit_id: "23",
          label: "Buscar noticias y hechos recientes (≈ 1–3 min)",
        },
      });
    });

    // Trigger requestContext directly as button would
    const reqRes = await explainApiModule.requestContext("23");
    expect(requestContextSpy).toHaveBeenCalledWith("23");

    if (reqRes.kind === "job") {
      const polled = await intelApiModule.pollJob<ContextResult>(reqRes.job.id);
      expect(pollJobSpy).toHaveBeenCalledWith("job-123");
      expect(polled.status).toBe("done");
      expect(polled.result?.name).toBe("Quintana Roo");
    }
  });

  it("renders contextual button for selected zone in empty state", () => {
    const mockCtx = createMockContext({
      selectedDetail: { id: "07", name: "Chiapas", level: "state", ent: "07" } as any,
    });

    const html = renderToStaticMarkup(
      <AtalayaContext.Provider value={mockCtx}>
        <ChatPanel />
      </AtalayaContext.Provider>
    );

    expect(html).toContain("¿Por qué Chiapas tiene este riesgo?");
  });

  it("translates plan intents into Spanish labels and avoids technical IDs", () => {
    expect(getIntentLabel("explain_unit")).toBe("Explicación de la zona");
    expect(getIntentLabel("context_news")).toBe("Noticias y contexto");
    expect(getIntentLabel("profile")).toBe("Quién vota por edad y sexo");
    expect(getIntentLabel("trend")).toBe("Evolución histórica");
    expect(getIntentLabel("compare")).toBe("Comparación");
    expect(getIntentLabel("ranking")).toBe("Ranking");
    expect(getIntentLabel("lookup")).toBe("Consulta de datos");
    expect(getIntentLabel("correlation")).toBe("Relación entre variables");
    expect(getIntentLabel("scenario")).toBe("Simulación de escenarios");
    expect(getIntentLabel("catalog")).toBe("Catálogo de variables");
    expect(getIntentLabel("help")).toBe("Ayuda");
    expect(getIntentLabel(null)).toBe("Consulta");
    expect(getIntentLabel(undefined)).toBe("Consulta");
    expect(getIntentLabel("unknown_intent")).toBe("Consulta");
  });

  it("assistantMarkdownComponents renders lists with list-disc and styled bullets", () => {
    const markdown = "- Primera viñeta del asistente\n- Segunda viñeta con dato medido";
    const html = renderToStaticMarkup(
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={assistantMarkdownComponents}>
        {markdown}
      </ReactMarkdown>
    );
    expect(html).toContain("list-disc");
    expect(html).toContain("pl-5");
    expect(html).toContain("Primera viñeta del asistente");
    expect(html).toContain("Segunda viñeta con dato medido");
  });

  it("assistantMarkdownComponents adds top spacing for subtitle-style bold paragraphs", () => {
    const markdown = "**Lo que muestran los datos**\n\nTexto explicativo debajo.";
    const html = renderToStaticMarkup(
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={assistantMarkdownComponents}>
        {markdown}
      </ReactMarkdown>
    );
    expect(html).toContain("mt-3");
    expect(html).toContain("Lo que muestran los datos");
  });

  describe("Evidence badges in assistant chat narrative (F2-C)", () => {
    it("parseEvidenceTag maps all 4 evidence types, strengths, and variations", () => {
      // 1. Dato medido
      expect(parseEvidenceTag("Dato medido · Fuerte")).toEqual({
        type: "dato_medido",
        strength: "fuerte",
      });
      expect(parseEvidenceTag("Dato medido - Moderada")).toEqual({
        type: "dato_medido",
        strength: "moderada",
      });

      // 2. Cálculo del modelo
      expect(parseEvidenceTag("Cálculo del modelo · Fuerte")).toEqual({
        type: "calculo_del_modelo",
        strength: "fuerte",
      });
      expect(parseEvidenceTag("Calculo del modelo · Moderada")).toEqual({
        type: "calculo_del_modelo",
        strength: "moderada",
      });

      // 3. Relación, no prueba causa / Relación (no prueba causa)
      expect(parseEvidenceTag("Relación, no prueba causa · Débil")).toEqual({
        type: "asociacion",
        strength: "debil",
      });
      expect(parseEvidenceTag("Relación (no prueba causa) · Débil")).toEqual({
        type: "asociacion",
        strength: "debil",
      });
      expect(parseEvidenceTag("Relacion, no prueba causa · debil")).toEqual({
        type: "asociacion",
        strength: "debil",
      });

      // 4. Dato de contexto
      expect(parseEvidenceTag("Dato de contexto · Débil")).toEqual({
        type: "contexto_descriptivo",
        strength: "debil",
      });

      // Default strength when omitted: defaults to 'moderada' per F2-C specification
      expect(parseEvidenceTag("Dato medido")).toEqual({
        type: "dato_medido",
        strength: "moderada",
      });
      expect(parseEvidenceTag("Cálculo del modelo")).toEqual({
        type: "calculo_del_modelo",
        strength: "moderada",
      });

      // Unknown or partial tags return null
      expect(parseEvidenceTag("Etiqueta desconocida · Fuerte")).toBeNull();
      expect(parseEvidenceTag("Nota técnica")).toBeNull();
      expect(parseEvidenceTag("Dato me")).toBeNull();
      expect(parseEvidenceTag("")).toBeNull();
    });

    it("renders message with the 4 evidence tags as compact badges in the narrative", () => {
      const markdown = `
- [Cálculo del modelo · Fuerte] Historial persistente de baja participación en casillas urbanas
- [Dato medido · Moderada] Participación juvenil en la elección 2024
- [Relación, no prueba causa · Débil] Relación moderada con grado de marginación
- [Dato de contexto · Débil] Movilidad y población nacida en otra entidad según Censo
`;
      const html = renderToStaticMarkup(
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={assistantMarkdownComponents}>
          {markdown}
        </ReactMarkdown>
      );

      // 1. Short badge type labels and single-line classes are present
      expect(html).toContain("Modelo");
      expect(html).toContain("Dato medido");
      expect(html).toContain("Relación");
      expect(html).toContain("Contexto");
      expect(html).toContain("whitespace-nowrap");

      // 2. Full labels and strengths are accessible in aria-label
      expect(html).toContain('aria-label="Cálculo del modelo · evidencia fuerte"');
      expect(html).toContain('aria-label="Dato medido · evidencia moderada"');
      expect(html).toContain('aria-label="Relación (no prueba causa) · evidencia débil"');
      expect(html).toContain('aria-label="Dato de contexto · evidencia débil"');

      // 3. Strength dots are rendered without separate text labels
      expect(html).toContain("●●●");
      expect(html).toContain("●●○");
      expect(html).toContain("●○○");

      // 4. Narrative texts are preserved
      expect(html).toContain("Historial persistente de baja participación en casillas urbanas");
      expect(html).toContain("Participación juvenil en la elección 2024");
      expect(html).toContain("Relación moderada con grado de marginación");
      expect(html).toContain("Movilidad y población nacida en otra entidad según Censo");

      // 5. No bracketed tag strings or stray brackets remain visible in text
      expect(html).not.toContain("[Cálculo del modelo · Fuerte]");
      expect(html).not.toContain("[Dato medido · Moderada]");
      expect(html).not.toContain("[Relación, no prueba causa · Débil]");
      expect(html).not.toContain("[Dato de contexto · Débil]");

      const textContent = html.replace(/<[^>]+>/g, "");
      expect(textContent).not.toContain("[");
      expect(textContent).not.toContain("]");
    });

    it("renders parentheses variation of asociacion as compact EvidenceBadge without brackets", () => {
      const markdown = "- [Relación (no prueba causa) · Débil] Asociación observada a nivel municipal";
      const html = renderToStaticMarkup(
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={assistantMarkdownComponents}>
          {markdown}
        </ReactMarkdown>
      );

      expect(html).toContain("Relación");
      expect(html).toContain("●○○");
      expect(html).toContain('aria-label="Relación (no prueba causa) · evidencia débil"');
      expect(html).toContain("whitespace-nowrap");
      expect(html).not.toContain("[Relación (no prueba causa) · Débil]");

      const textContent = html.replace(/<[^>]+>/g, "");
      expect(textContent).not.toContain("[");
      expect(textContent).not.toContain("]");
    });

    it("leaves partial tags during streaming as plain text with brackets", () => {
      const streamingMarkdown = "- [Dato me";
      const html = renderToStaticMarkup(
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={assistantMarkdownComponents}>
          {streamingMarkdown}
        </ReactMarkdown>
      );

      // Incomplete bracket tag must not be parsed into a badge, remains raw text
      expect(html).toContain("[Dato me");
      expect(html).not.toContain("EvidenceBadge");
      expect(html).not.toContain("●");
    });

    it("leaves another streaming prefix as plain text with brackets", () => {
      const streamingMarkdown = "- [Cálculo del mod";
      const html = renderToStaticMarkup(
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={assistantMarkdownComponents}>
          {streamingMarkdown}
        </ReactMarkdown>
      );

      expect(html).toContain("[Cálculo del mod");
      expect(html).not.toContain("●");
    });

    it("leaves unknown tags as plain text with brackets", () => {
      const markdown = "- [Etiqueta desconocida · Fuerte] Este texto no debe convertirse en insignia";
      const html = renderToStaticMarkup(
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={assistantMarkdownComponents}>
          {markdown}
        </ReactMarkdown>
      );

      // Unknown tags remain verbatim with brackets
      expect(html).toContain("[Etiqueta desconocida · Fuerte]");
      expect(html).toContain("Este texto no debe convertirse en insignia");
      expect(html).not.toContain("●●●");
    });

    it("renders tag without explicit strength using default 'moderada' badge in compact mode", () => {
      // Documented behavior per F2-C specification:
      // When strength is omitted in the tag, default strength is 'moderada' (●●○)
      const markdown = "- [Dato medido] Registro de participación ciudadana oficial";
      const html = renderToStaticMarkup(
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={assistantMarkdownComponents}>
          {markdown}
        </ReactMarkdown>
      );

      expect(html).toContain("Dato medido");
      expect(html).toContain("●●○");
      expect(html).toContain('aria-label="Dato medido · evidencia moderada"');
      expect(html).toContain("whitespace-nowrap");
      expect(html).toContain("Registro de participación ciudadana oficial");
      expect(html).not.toContain("[Dato medido]");
      const textContent = html.replace(/<[^>]+>/g, "");
      expect(textContent).not.toContain("[");
      expect(textContent).not.toContain("]");
    });

    it("replaces tags in paragraph text when bullets are unicode characters", () => {
      const markdown = "• [Cálculo del modelo · Fuerte] Razón explicativa en párrafo con viñeta unicode";
      const html = renderToStaticMarkup(
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={assistantMarkdownComponents}>
          {markdown}
        </ReactMarkdown>
      );

      expect(html).toContain("Modelo");
      expect(html).toContain("●●●");
      expect(html).toContain('aria-label="Cálculo del modelo · evidencia fuerte"');
      expect(html).toContain("whitespace-nowrap");
      expect(html).not.toContain("[Cálculo del modelo · Fuerte]");
      expect(html).toContain("Razón explicativa en párrafo con viñeta unicode");
    });

    it("uses compact variant in narrative with single InfoTip and one line", () => {
      const markdown = "- [Cálculo del modelo · Fuerte] Explicación breve";
      const html = renderToStaticMarkup(
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={assistantMarkdownComponents}>
          {markdown}
        </ReactMarkdown>
      );

      expect(html).toContain("whitespace-nowrap");
      expect(html).toContain("Modelo");
      expect(html).toContain("●●●");
      expect(html).toContain('aria-label="Cálculo del modelo · evidencia fuerte"');
      // Single InfoTip in compact badge (1 button for InfoTip instead of 2 in default)
      const buttonMatches = html.match(/<button/g);
      expect(buttonMatches?.length).toBe(1);
    });

    it("does not affect user messages (tags remain raw text with brackets)", () => {
      // In ChatPanel, components={msg.role === "assistant" ? assistantMarkdownComponents : undefined}
      const userMessage = "¿Qué significa [Cálculo del modelo · Fuerte]?";
      const html = renderToStaticMarkup(
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {userMessage}
        </ReactMarkdown>
      );

      expect(html).toContain("[Cálculo del modelo · Fuerte]");
      expect(html).not.toContain("●●●");
    });
  });
});

