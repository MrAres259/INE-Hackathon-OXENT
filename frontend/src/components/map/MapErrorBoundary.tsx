"use client";

import React from "react";
import { MapFallback } from "./MapFallback";

export interface MapErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  onReset?: () => void;
  className?: string;
}

export interface MapErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  resetKey: number;
}

/**
 * Error boundary component wrapping map instances.
 * Catches unhandled render and lifecycle errors in child maps,
 * records the error in window.__atalayaMapErrors, and presents
 * a user-friendly fallback with a retry action that resets the boundary
 * and remounts the map component.
 */
export class MapErrorBoundary extends React.Component<
  MapErrorBoundaryProps,
  MapErrorBoundaryState
> {
  constructor(props: MapErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      resetKey: 0,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<MapErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, _errorInfo: React.ErrorInfo): void {
    if (typeof window !== "undefined") {
      window.__atalayaMapErrors = window.__atalayaMapErrors || [];
      window.__atalayaMapErrors.push(error);
    }
  }

  handleRetry = (): void => {
    this.props.onReset?.();
    this.setState((prev) => ({
      hasError: false,
      error: null,
      resetKey: prev.resetKey + 1,
    }));
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <MapFallback
          reason="error"
          onRetry={this.handleRetry}
          className={this.props.className}
        />
      );
    }

    return (
      <React.Fragment key={this.state.resetKey}>
        {this.props.children}
      </React.Fragment>
    );
  }
}
