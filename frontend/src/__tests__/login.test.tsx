import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import LoginPage from "../app/login/page";
import * as authModule from "../lib/auth";
import { isValidInternalRedirect } from "../lib/authRoutes";

let mockSearchParams = new URLSearchParams();
const mockRouter = {
  push: vi.fn(),
  replace: vi.fn(),
};

vi.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
  usePathname: () => "/login",
  useSearchParams: () => mockSearchParams,
}));

describe("Login Page Component Suite (login.test.tsx)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams();
  });

  it("renders branding lockup, subtitle, and input fields with accessible autocomplete attributes", () => {
    const html = renderToStaticMarkup(<LoginPage />);

    // Brand and logo
    expect(html).toContain("Atalaya");
    expect(html).toContain("Electoral");
    expect(html).toContain("Riesgo de abstención · Elección federal 2027");

    // Form inputs with attributes
    expect(html).toContain('id="username"');
    expect(html.toLowerCase()).toContain('autocomplete="username"');
    expect(html).toContain('id="password"');
    expect(html.toLowerCase()).toContain('autocomplete="current-password"');

    // Show/Hide password toggle button
    expect(html).toContain("Mostrar contraseña");

    // Submit button
    expect(html).toContain("Entrar");

    // Legal disclaimer with team OXENT attribution
    expect(html).toContain(
      "Propuesta del equipo OXENT · Hackathon INE 2026. Acceso restringido al personal autorizado; los intentos se registran."
    );
  });

  it("applies compact two-column layout in landscape on small-height screens", () => {
    const html = renderToStaticMarkup(<LoginPage />);

    // Two-column grid in compact landscape
    expect(html).toContain("[@media(orientation:landscape)_and_(max-height:540px)]:grid");
    expect(html).toContain("[@media(orientation:landscape)_and_(max-height:540px)]:grid-cols-2");

    // Soft brand background
    expect(html).toContain("to-primary-soft/20");
  });

  it("includes accessible labels for all input controls", () => {
    const html = renderToStaticMarkup(<LoginPage />);

    expect(html).toContain('for="username"');
    expect(html).toContain("Usuario institucional");
    expect(html).toContain('for="password"');
    expect(html).toContain("Contraseña");
  });

  it("sanitizes target route so open redirects are prevented on successful login", () => {
    // Normal internal next route
    const validNext = "/campanas?zona=07";
    expect(isValidInternalRedirect(validNext)).toBe(true);

    // Malicious open redirect attempts
    expect(isValidInternalRedirect("//evil.com")).toBe(false);
    expect(isValidInternalRedirect("https://evil.com")).toBe(false);
    expect(isValidInternalRedirect("/\\evil.com")).toBe(false);
  });

  it("exports only default export to comply with Next.js page conventions", async () => {
    const pageModule = await import("../app/login/page");
    const exportedKeys = Object.keys(pageModule);

    expect(exportedKeys).toEqual(["default"]);
    expect(typeof pageModule.default).toBe("function");
  });

  it("does not call fetch to /api/* when LoginPage is mounted or rendered", () => {
    const origFetch = globalThis.fetch;
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    try {
      renderToStaticMarkup(<LoginPage />);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  describe("successful login navigation with window.location.replace", () => {
    let origWindow: any;
    let origDoc: any;
    let origActEnv: any;
    let mockReplace: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      origWindow = (globalThis as any).window;
      origDoc = (globalThis as any).document;
      origActEnv = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
      mockReplace = vi.fn();

      (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    });

    afterEach(() => {
      (globalThis as any).window = origWindow;
      (globalThis as any).document = origDoc;
      (globalThis as any).IS_REACT_ACT_ENVIRONMENT = origActEnv;
    });

    async function mountAndSubmit(nextParam?: string) {
      if (nextParam !== undefined) {
        mockSearchParams = new URLSearchParams(`next=${encodeURIComponent(nextParam)}`);
      } else {
        mockSearchParams = new URLSearchParams();
      }

      const elements: Record<string, any[]> = {};
      const fakeDoc: any = {
        nodeType: 9,
        createElement: (tag: string) => {
          const el: any = {
            tagName: tag.toUpperCase(),
            nodeType: 1,
            ownerDocument: null,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            appendChild: vi.fn(),
            removeChild: vi.fn(),
            insertBefore: vi.fn(),
            setAttribute: vi.fn(),
            removeAttribute: vi.fn(),
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
        CustomEvent: typeof CustomEvent !== "undefined" ? CustomEvent : class {
          detail: any;
          constructor(public type: string, init?: any) {
            this.detail = init?.detail;
          }
        },
        location: {
          pathname: "/login",
          search: nextParam ? `?next=${encodeURIComponent(nextParam)}` : "",
          href: "http://localhost:3000/login",
          replace: mockReplace,
        },
      };

      fakeDoc.defaultView = defaultView;
      (globalThis as any).document = fakeDoc;
      (globalThis as any).window = defaultView;

      const container = fakeDoc.createElement("div");
      container.ownerDocument = fakeDoc;

      const ReactDOM = await import("react-dom/client");
      const root = ReactDOM.createRoot(container);

      await React.act(async () => {
        root.render(<LoginPage />);
      });

      // Find input and form elements
      const inputs = elements["input"] || [];
      const userInput = inputs.find((el) => {
        const propsKey = Object.keys(el).find((k) => k.startsWith("__reactProps"));
        if (!propsKey) return false;
        return el[propsKey]?.name === "username" || el[propsKey]?.id === "username";
      });
      const passInput = inputs.find((el) => {
        const propsKey = Object.keys(el).find((k) => k.startsWith("__reactProps"));
        if (!propsKey) return false;
        return el[propsKey]?.name === "password" || el[propsKey]?.id === "password";
      });
      const formEl = (elements["form"] || [])[0];

      expect(formEl).toBeDefined();
      expect(userInput).toBeDefined();
      expect(passInput).toBeDefined();

      const userPropsKey = Object.keys(userInput).find((k) => k.startsWith("__reactProps"))!;
      const passPropsKey = Object.keys(passInput).find((k) => k.startsWith("__reactProps"))!;
      const formPropsKey = Object.keys(formEl).find((k) => k.startsWith("__reactProps"))!;

      // Simulate input changes
      await React.act(async () => {
        userInput[userPropsKey].onChange({ target: { value: "operador_ine" } });
        passInput[passPropsKey].onChange({ target: { value: "password123456" } });
      });

      // Mock authModule.login to succeed
      vi.spyOn(authModule, "login").mockResolvedValue({
        user: { username: "operador_ine" },
        expires_at: "2026-10-30T12:00:00Z",
      });

      // Submit form
      await React.act(async () => {
        await formEl[formPropsKey].onSubmit({ preventDefault: vi.fn() });
      });
    }

    it("calls window.location.replace with validated next route on login success", async () => {
      await mountAndSubmit("/campanas?zona=07");
      expect(mockReplace).toHaveBeenCalledWith("/campanas?zona=07");
    });

    it("calls window.location.replace with default / when next is malicious open redirect", async () => {
      await mountAndSubmit("https://evil.com/phishing");
      expect(mockReplace).toHaveBeenCalledWith("/");
    });

    it("calls window.location.replace with default / when next is /login itself", async () => {
      await mountAndSubmit("/login");
      expect(mockReplace).toHaveBeenCalledWith("/");
    });

    it("calls window.location.replace with default / when next parameter is not provided", async () => {
      await mountAndSubmit();
      expect(mockReplace).toHaveBeenCalledWith("/");
    });
  });
});
