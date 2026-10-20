import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import {
  MapErrorBoundary,
} from "../components/map/MapErrorBoundary";

describe("MapErrorBoundary", () => {
  const originalWindow = (globalThis as any).window;

  beforeEach(() => {
    (globalThis as any).window = {
      __atalayaMapErrors: [],
    };
  });

  afterEach(() => {
    (globalThis as any).window = originalWindow;
  });

  it("initializes in a clean non-error state", () => {
    const boundary = new MapErrorBoundary({
      children: React.createElement("div", null, "Map child"),
    });

    expect(boundary.state.hasError).toBe(false);
    expect(boundary.state.error).toBeNull();
    expect(boundary.state.resetKey).toBe(0);
  });

  it("getDerivedStateFromError updates state to error", () => {
    const error = new Error("WebGL context lost during initialization");
    const derived = MapErrorBoundary.getDerivedStateFromError(error);

    expect(derived.hasError).toBe(true);
    expect(derived.error).toBe(error);
  });

  it("componentDidCatch logs error to window.__atalayaMapErrors", () => {
    const boundary = new MapErrorBoundary({
      children: React.createElement("div", null, "Map child"),
    });

    const error = new Error("Canvas render error");
    const info: React.ErrorInfo = { componentStack: "at AtalayaMap" };

    boundary.componentDidCatch(error, info);

    expect((globalThis as any).window.__atalayaMapErrors).toBeDefined();
    expect((globalThis as any).window.__atalayaMapErrors).toContain(error);
  });

  it("handleRetry clears error, increments resetKey and invokes onReset", () => {
    const onReset = vi.fn();
    const boundary = new MapErrorBoundary({
      children: React.createElement("div", null, "Map child"),
      onReset,
    });

    boundary.state = {
      hasError: true,
      error: new Error("Test error"),
      resetKey: 0,
    };

    // Simulate setState
    boundary.setState = vi.fn((updater) => {
      const next =
        typeof updater === "function" ? updater(boundary.state) : updater;
      boundary.state = { ...boundary.state, ...next };
    }) as any;

    boundary.handleRetry();

    expect(onReset).toHaveBeenCalledTimes(1);
    expect(boundary.state.hasError).toBe(false);
    expect(boundary.state.error).toBeNull();
    expect(boundary.state.resetKey).toBe(1);
  });

  it("renders children when hasError is false", () => {
    const childElement = React.createElement("div", { id: "test-map" }, "Map content");
    const boundary = new MapErrorBoundary({ children: childElement });

    const rendered = boundary.render() as React.ReactElement<{
      children: React.ReactNode;
    }>;
    expect(rendered).toBeDefined();
    expect(rendered.type).toBe(React.Fragment);
    expect(rendered.props.children).toBe(childElement);
  });

  it("renders MapFallback with reason='error' and onRetry when hasError is true", () => {
    const boundary = new MapErrorBoundary({
      children: React.createElement("div", null, "Map child"),
    });
    boundary.state = {
      hasError: true,
      error: new Error("Critical map error"),
      resetKey: 0,
    };

    const rendered = boundary.render() as React.ReactElement<{
      reason: string;
      onRetry?: () => void;
    }>;
    expect(rendered).toBeDefined();
    expect(rendered.props.reason).toBe("error");
    expect(typeof rendered.props.onRetry).toBe("function");
  });

  it("renders custom fallback if provided when hasError is true", () => {
    const customFallback = React.createElement("div", { id: "custom-fallback" }, "Oops");
    const boundary = new MapErrorBoundary({
      children: React.createElement("div", null, "Map child"),
      fallback: customFallback,
    });
    boundary.state = {
      hasError: true,
      error: new Error("Critical map error"),
      resetKey: 0,
    };

    const rendered = boundary.render();
    expect(rendered).toBe(customFallback);
  });
});
