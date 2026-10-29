import { describe, it, expect } from "vitest";
import {
  isPublicPath,
  isValidInternalRedirect,
  getAuthRouteDecision,
  PUBLIC_PATH_PREFIXES,
  PUBLIC_EXACT_PATHS,
} from "../lib/authRoutes";
import { proxy, SESSION_COOKIE_NAME } from "../proxy";
import { NextRequest } from "next/server";

describe("Proxy & AuthRoutes Suite (proxy.test.ts)", () => {
  describe("isPublicPath() exceptions", () => {
    it("recognizes exact public paths", () => {
      for (const p of PUBLIC_EXACT_PATHS) {
        expect(isPublicPath(p), `Path ${p} should be public`).toBe(true);
      }
    });

    it("recognizes public prefix paths", () => {
      expect(isPublicPath("/_next/static/chunks/app.js")).toBe(true);
      expect(isPublicPath("/_next/image?url=logo.png")).toBe(true);
      expect(isPublicPath("/geo/states.json")).toBe(true);
      expect(isPublicPath("/geo/mun/07.json")).toBe(true);
      expect(isPublicPath("/brand/logo.svg")).toBe(true);
      expect(isPublicPath("/api/health")).toBe(true);
      expect(isPublicPath("/api/auth/login")).toBe(true);
    });

    it("identifies protected application pages as not public", () => {
      expect(isPublicPath("/")).toBe(false);
      expect(isPublicPath("/campanas")).toBe(false);
      expect(isPublicPath("/monitor")).toBe(false);
      expect(isPublicPath("/metodologia")).toBe(false);
      expect(isPublicPath("/dashboard")).toBe(false);
    });
  });

  describe("isValidInternalRedirect()", () => {
    it("accepts valid internal application paths", () => {
      expect(isValidInternalRedirect("/")).toBe(true);
      expect(isValidInternalRedirect("/campanas")).toBe(true);
      expect(isValidInternalRedirect("/monitor?zona=07")).toBe(true);
      expect(isValidInternalRedirect("/metodologia#glosario")).toBe(true);
    });

    it("rejects malicious or external redirect targets (open redirect prevention)", () => {
      expect(isValidInternalRedirect("//evil.com")).toBe(false);
      expect(isValidInternalRedirect("//google.com/path")).toBe(false);
      expect(isValidInternalRedirect("/\\evil.com")).toBe(false);
      expect(isValidInternalRedirect("https://evil.com")).toBe(false);
      expect(isValidInternalRedirect("http://evil.com")).toBe(false);
      expect(isValidInternalRedirect("javascript:alert(1)")).toBe(false);
      expect(isValidInternalRedirect(null)).toBe(false);
      expect(isValidInternalRedirect(undefined)).toBe(false);
      expect(isValidInternalRedirect("")).toBe(false);
    });
  });

  describe("getAuthRouteDecision() pure function", () => {
    it("allows unauthenticated visitor on /login", () => {
      const decision = getAuthRouteDecision({
        pathname: "/login",
        hasSession: false,
      });
      expect(decision).toEqual({ type: "next" });
    });

    it("redirects authenticated user on /login to / when no next is provided", () => {
      const decision = getAuthRouteDecision({
        pathname: "/login",
        hasSession: true,
      });
      expect(decision).toEqual({ type: "redirect", destination: "/" });
    });

    it("redirects authenticated user on /login to next destination when valid", () => {
      const decision = getAuthRouteDecision({
        pathname: "/login",
        search: "?next=/campanas%3Fzona%3D07",
        hasSession: true,
      });
      expect(decision).toEqual({
        type: "redirect",
        destination: "/campanas?zona=07",
      });
    });

    it("ignores malicious next parameter on /login and redirects safely to /", () => {
      const decision = getAuthRouteDecision({
        pathname: "/login",
        search: "?next=//attacker.com",
        hasSession: true,
      });
      expect(decision).toEqual({ type: "redirect", destination: "/" });
    });

    it("allows public static assets and API routes regardless of session", () => {
      expect(getAuthRouteDecision({ pathname: "/api/health", hasSession: false })).toEqual({
        type: "next",
      });
      expect(getAuthRouteDecision({ pathname: "/geo/states.json", hasSession: false })).toEqual({
        type: "next",
      });
      expect(getAuthRouteDecision({ pathname: "/favicon.ico", hasSession: false })).toEqual({
        type: "next",
      });
    });

    it("redirects unauthenticated user accessing protected page to /login with next param", () => {
      const decisionRoot = getAuthRouteDecision({
        pathname: "/",
        hasSession: false,
      });
      expect(decisionRoot).toEqual({
        type: "redirect",
        destination: "/login?next=%2F",
      });

      const decisionCampanas = getAuthRouteDecision({
        pathname: "/campanas",
        search: "?zona=16",
        hasSession: false,
      });
      expect(decisionCampanas).toEqual({
        type: "redirect",
        destination: "/login?next=%2Fcampanas%3Fzona%3D16",
      });
    });

    it("allows authenticated user to access protected pages", () => {
      expect(getAuthRouteDecision({ pathname: "/", hasSession: true })).toEqual({
        type: "next",
      });
      expect(getAuthRouteDecision({ pathname: "/campanas", hasSession: true })).toEqual({
        type: "next",
      });
      expect(getAuthRouteDecision({ pathname: "/monitor", hasSession: true })).toEqual({
        type: "next",
      });
    });
  });

  describe("Next 16 proxy() execution", () => {
    it("redirects unauthenticated request on / to /login", () => {
      const req = new NextRequest("http://localhost:3000/");
      const res = proxy(req);

      expect(res.status).toBe(307);
      const location = res.headers.get("location");
      expect(location).toContain("/login?next=%2F");
    });

    it("allows authenticated request on / when session cookie exists", () => {
      const req = new NextRequest("http://localhost:3000/", {
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=token_secret_123;`,
        },
      });
      const res = proxy(req);

      // NextResponse.next() sets x-middleware-next / continues
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    });

    it("redirects authenticated request on /login to / or next destination", () => {
      const req = new NextRequest("http://localhost:3000/login?next=/monitor", {
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=token_secret_123;`,
        },
      });
      const res = proxy(req);

      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toBe("http://localhost:3000/monitor");
    });

    it("allows static assets without session", () => {
      const req = new NextRequest("http://localhost:3000/favicon.ico");
      const res = proxy(req);

      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    });
  });
});
