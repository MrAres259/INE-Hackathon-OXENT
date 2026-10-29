"use client";

import React from "react";

export interface OperatorGateProps {
  children?: React.ReactNode;
  fallback?: React.ReactNode;
  label?: string;
  onVerified?: () => void;
  className?: string;
}

/**
 * OperatorGate - Pasarela sin UI (Ola 5: sesión = operador desbloqueado en toda la plataforma)
 */
export function OperatorGate({ children }: OperatorGateProps) {
  return <>{children}</>;
}
