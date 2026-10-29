import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  login,
  logout,
  getSession,
  redirectToLogin,
  resetRedirectState,
  AuthError,
} from "../lib/auth";
import { getMeta } from "../lib/api";
import { getCachedCampaign } from "../lib/intel/api";

describe("Auth API Client Suite (authApi.test.ts)", () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = (globalThis as any).window;

  beforeEach(() => {
    resetRedirectState();
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
  });

  describe("login()", () => {
    it("rejects empty username or password with status 400", async () => {
      await expect(login("", "pass")).rejects.toThrow(AuthError);
      await expect(login("user", "")).rejects.toThrow(AuthError);
    });

    it("sends credentials with same-origin and returns session on success", async () => {
      let capturedInit: RequestInit | undefined;
      globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        capturedInit = init;
        return new Response(
          JSON.stringify({
            user: { username: "operador_ine" },
            expires_at: "2026-10-30T12:00:00Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      const session = await login("operador_ine", "clave_segura_123");
      expect(session.user.username).toBe("operador_ine");
      expect(session.expires_at).toBe("2026-10-30T12:00:00Z");
      expect(capturedInit?.credentials).toBe("same-origin");
    });

    it("throws AuthError on 401 with backend error detail", async () => {
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return new Response(
          JSON.stringify({ detail: "Usuario o contraseña incorrectos." }),
          { status: 401, headers: { "Content-Type": "application/json" } }
        );
      });

      try {
        await login("user", "badpass");
        expect.unreachable();
      } catch (err: any) {
        expect(err).toBeInstanceOf(AuthError);
        expect(err.status).toBe(401);
        expect(err.detail).toBe("Usuario o contraseña incorrectos.");
      }
    });

    it("throws AuthError on 429 with Retry-After and retry_after_s countdown value", async () => {
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return new Response(
          JSON.stringify({
            detail: "Demasiados intentos. Intenta de nuevo en 15 minutos.",
            retry_after_s: 900,
          }),
          {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              "Retry-After": "900",
            },
          }
        );
      });

      try {
        await login("user", "pass");
        expect.unreachable();
      } catch (err: any) {
        expect(err).toBeInstanceOf(AuthError);
        expect(err.status).toBe(429);
        expect(err.retryAfterS).toBe(900);
        expect(err.detail).toContain("Demasiados intentos");
      }
    });
  });

  describe("logout()", () => {
    it("calls POST /api/auth/logout with credentials same-origin and redirects to /login", async () => {
      let capturedMethod = "";
      let capturedCredentials = "";
      globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        capturedMethod = init?.method ?? "";
        capturedCredentials = (init?.credentials as string) ?? "";
        return new Response(null, { status: 204 });
      });

      await logout();

      expect(capturedMethod).toBe("POST");
      expect(capturedCredentials).toBe("same-origin");
      expect(window.location.href).toBe("/login");
    });
  });

  describe("getSession()", () => {
    it("returns session data on status 200", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            user: { username: "analista_ine" },
            expires_at: "2026-10-30T10:00:00Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const sess = await getSession();
      expect(sess?.user.username).toBe("analista_ine");
    });

    it("returns null on status 401", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: "Sesión requerida." }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        })
      );

      const sess = await getSession();
      expect(sess).toBeNull();
    });
  });

  describe("redirectToLogin()", () => {
    it("sets window.location.href to /login?next=<encodedPath>", () => {
      window.location = {
        pathname: "/campanas",
        search: "?zona=07",
        href: "http://localhost:3000/campanas?zona=07",
      } as any;

      redirectToLogin();

      expect(window.location.href).toBe(
        "/login?next=" + encodeURIComponent("/campanas?zona=07")
      );
    });

    it("does not redirect if already on /login", () => {
      window.location = {
        pathname: "/login",
        search: "",
        href: "http://localhost:3000/login",
      } as any;

      redirectToLogin();
      expect(window.location.href).toBe("http://localhost:3000/login");
    });

    it("does not trigger duplicate redirects when called repeatedly (single-flight guard)", () => {
      window.location = {
        pathname: "/monitor",
        search: "",
        href: "http://localhost:3000/monitor",
      } as any;

      redirectToLogin();
      const firstHref = window.location.href;
      expect(firstHref).toBe("/login?next=%2Fmonitor");

      // Change location href manually to simulate intermediate state
      (window.location as any).href = "http://localhost:3000/some-other-state";
      redirectToLogin();
      // Should NOT change again because isRedirecting is true
      expect(window.location.href).toBe("http://localhost:3000/some-other-state");
    });
  });

  describe("API 401 triggers redirectToLogin()", () => {
    it("fetchJson in lib/api.ts triggers redirectToLogin on 401", async () => {
      window.location = {
        pathname: "/metodologia",
        search: "",
        href: "http://localhost:3000/metodologia",
      } as any;

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: "Sesión requerida." }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        })
      );

      await expect(getMeta()).rejects.toThrow();
      expect(window.location.href).toBe("/login?next=%2Fmetodologia");
    });

    it("requestJson in lib/intel/api.ts triggers redirectToLogin on 401", async () => {
      window.location = {
        pathname: "/campanas",
        search: "?zona=16",
        href: "http://localhost:3000/campanas?zona=16",
      } as any;

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: "Sesión requerida." }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        })
      );

      await expect(getCachedCampaign("16")).rejects.toThrow();
      expect(window.location.href).toBe("/login?next=%2Fcampanas%3Fzona%3D16");
    });
  });
});
