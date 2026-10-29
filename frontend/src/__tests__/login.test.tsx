import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
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
    expect(html).toContain("Plataforma Institucional");

    // Form inputs with attributes
    expect(html).toContain('id="username"');
    expect(html.toLowerCase()).toContain('autocomplete="username"');
    expect(html).toContain('id="password"');
    expect(html.toLowerCase()).toContain('autocomplete="current-password"');

    // Show/Hide password toggle button
    expect(html).toContain("Mostrar contraseña");

    // Submit button
    expect(html).toContain("Entrar");

    // Legal disclaimer
    expect(html).toContain(
      "Acceso restringido al personal autorizado. Los intentos se registran."
    );
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
});
