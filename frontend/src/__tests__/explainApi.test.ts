import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getExplanation,
  getCachedContext,
  requestContext,
} from "../lib/explain/api";
import { streamChat, setMockActive, isMockEnabled } from "../lib/api";
import { resetRedirectState } from "../lib/auth";
import type { ChatData, ChatDone } from "../lib/types";
import type { ContextResult, Explanation } from "../lib/explain/types";

describe("Explain API Client Suite (explainApi.test.ts)", () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = (globalThis as any).window;

  beforeEach(() => {
    resetRedirectState();
    setMockActive(false);
    vi.clearAllMocks();
    (globalThis as any).window = {
      location: {
        href: "http://localhost:3000/",
        pathname: "/",
        search: "",
      },
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    (globalThis as any).window = originalWindow;
    resetRedirectState();
    setMockActive(false);
  });

  describe("getExplanation()", () => {
    it("returns Explanation on HTTP 200", async () => {
      const mockBackendExplanation: Partial<Explanation> = {
        unit_id: "23",
        level: "state",
        name: "Quintana Roo",
        headline: "Baja participación persistente",
        risk_score: 59.5,
        reasons: [],
        score_breakdown: [],
      };

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(mockBackendExplanation), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const result = await getExplanation("23");
      expect(result).toBeDefined();
      expect(result.unit_id).toBe("23");
      expect(result.name).toBe("Quintana Roo");
      expect(result.risk_score).toBe(59.5);
    });

    it("triggers redirectToLogin on HTTP 401", async () => {
      window.location = {
        pathname: "/",
        search: "?zona=23",
        href: "http://localhost:3000/?zona=23",
      } as any;

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: "Sesión requerida." }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        })
      );

      await expect(getExplanation("23")).rejects.toThrow();
      expect(window.location.href).toBe("/login?next=%2F%3Fzona%3D23");
    });
  });

  describe("getCachedContext()", () => {
    it("returns ContextResult on HTTP 200", async () => {
      const mockContextResult: Partial<ContextResult> = {
        unit_id: "23",
        name: "Quintana Roo",
        level: "state",
        findings: [],
        from_cache: true,
      };

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(mockContextResult), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const result = await getCachedContext("23");
      expect(result).toBeDefined();
      expect(result?.unit_id).toBe("23");
      expect(result?.from_cache).toBe(true);
    });

    it("returns null on HTTP 404 without throwing", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: "Sin contexto en caché." }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        })
      );

      const result = await getCachedContext("23");
      expect(result).toBeNull();
      expect(isMockEnabled()).toBe(false);
    });

    it("triggers redirectToLogin on HTTP 401", async () => {
      window.location = {
        pathname: "/",
        search: "",
        href: "http://localhost:3000/",
      } as any;

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: "Sesión requerida." }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        })
      );

      await expect(getCachedContext("23")).rejects.toThrow();
      expect(window.location.href).toBe("/login");
    });
  });

  describe("requestContext()", () => {
    it("returns { kind: 'done', context } on HTTP 200 with cached result", async () => {
      const mockContext: Partial<ContextResult> = {
        unit_id: "23",
        name: "Quintana Roo",
        level: "state",
        findings: [],
      };

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ status: "done", context: mockContext }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const result = await requestContext("23", { refresh: false });
      expect(result.kind).toBe("done");
      if (result.kind === "done") {
        expect(result.context.unit_id).toBe("23");
      }
    });

    it("returns { kind: 'job', job } on HTTP 202 async Job response", async () => {
      const mockJob = {
        id: "job-123",
        kind: "explain_context",
        key: "23",
        status: "running",
        stage: "investigando fuentes",
        progress: 10,
        created_at: new Date().toISOString(),
      };

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(mockJob), {
          status: 202,
          headers: { "Content-Type": "application/json" },
        })
      );

      const result = await requestContext("23", { refresh: true });
      expect(result.kind).toBe("job");
      if (result.kind === "job") {
        expect(result.job.id).toBe("job-123");
        expect(result.job.kind).toBe("explain_context");
      }
    });

    it("triggers redirectToLogin on HTTP 401", async () => {
      window.location = {
        pathname: "/",
        search: "",
        href: "http://localhost:3000/",
      } as any;

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: "Sesión requerida." }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        })
      );

      await expect(requestContext("23")).rejects.toThrow();
      expect(window.location.href).toBe("/login");
    });
  });

  describe("streamChat() with mode: 'explain'", () => {
    it("sends mode: 'explain' in request body when defined", async () => {
      let sentBody: string | undefined;

      globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        sentBody = init?.body as string;
        // Return an empty SSE stream
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode("event: done\ndata: {\"sources\":[],\"degraded\":false}\n\n"));
            controller.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      });

      await streamChat(
        {
          message: "¿Por qué tiene riesgo alto?",
          history: [],
          region_id: "23",
          mode: "explain",
        },
        {}
      );

      expect(sentBody).toBeDefined();
      const parsed = JSON.parse(sentBody!);
      expect(parsed.mode).toBe("explain");
      expect(parsed.region_id).toBe("23");
      expect(parsed.message).toBe("¿Por qué tiene riesgo alto?");
    });

    it("omits mode in request body when mode is undefined", async () => {
      let sentBody: string | undefined;

      globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        sentBody = init?.body as string;
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode("event: done\ndata: {\"sources\":[],\"degraded\":false}\n\n"));
            controller.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      });

      await streamChat(
        {
          message: "¿Cuál es la participación promedio?",
          history: [],
        },
        {}
      );

      expect(sentBody).toBeDefined();
      const parsed = JSON.parse(sentBody!);
      expect(parsed.mode).toBeUndefined();
      expect("mode" in parsed).toBe(false);
    });

    it("SSE parser passes explanation and context on data event, and suggestions and action on done event", async () => {
      const mockExplanation = {
        unit_id: "23",
        headline: "Explicación en streaming",
      };
      const mockContext = {
        unit_id: "23",
        findings: [],
      };
      const mockSuggestions = [
        { id: "q1", text: "¿Qué recomiendas?", intent_hint: "recommend" },
      ];
      const mockAction = {
        type: "context_research",
        unit_id: "23",
        label: "Buscar noticias",
      };

      const ssePayload = [
        `event: data\ndata: ${JSON.stringify({
          columns: ["zona", "riesgo"],
          rows: [["23", "59.5"]],
          source: "modelo",
          explanation: mockExplanation,
          context: mockContext,
        })}\n\n`,
        `event: done\ndata: ${JSON.stringify({
          sources: ["INE"],
          degraded: false,
          suggestions: mockSuggestions,
          action: mockAction,
        })}\n\n`,
      ].join("");

      globalThis.fetch = vi.fn().mockImplementation(async () => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(ssePayload));
            controller.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      });

      let receivedData: ChatData | undefined;
      let receivedDone: ChatDone | undefined;

      await streamChat(
        {
          message: "Explícame",
          history: [],
          mode: "explain",
        },
        {
          onData: (data) => {
            receivedData = data;
          },
          onDone: (done) => {
            receivedDone = done;
          },
        }
      );

      expect(receivedData).toBeDefined();
      expect(receivedData?.explanation).toEqual(mockExplanation);
      expect(receivedData?.context).toEqual(mockContext);

      expect(receivedDone).toBeDefined();
      expect(receivedDone?.suggestions).toEqual(mockSuggestions);
      expect(receivedDone?.action).toEqual(mockAction);
    });
  });
});
