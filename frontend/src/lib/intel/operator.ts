// ATALAYA Intel - Operator Token Management & Hook
"use client";

import { useState, useEffect, useCallback } from "react";
import { checkOperator } from "./api";

const OPERATOR_TOKEN_KEY = "atalaya_operator_token";
const OPERATOR_CHANGE_EVENT = "atalaya:operator-change";

let memoryToken: string | null = null;

function getStorage(): Storage | null {
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
  }
  if (typeof globalThis !== "undefined" && (globalThis as any).localStorage) {
    return (globalThis as any).localStorage;
  }
  return null;
}

export function getOperatorToken(): string | null {
  const storage = getStorage();
  if (storage) {
    try {
      const token = storage.getItem(OPERATOR_TOKEN_KEY);
      return token && token.trim().length > 0 ? token.trim() : null;
    } catch {
      return memoryToken;
    }
  }
  return memoryToken;
}

export function setOperatorToken(token: string): void {
  const trimmed = token.trim();
  memoryToken = trimmed || null;
  const storage = getStorage();
  if (storage) {
    try {
      if (trimmed) {
        storage.setItem(OPERATOR_TOKEN_KEY, trimmed);
      } else {
        storage.removeItem(OPERATOR_TOKEN_KEY);
      }
    } catch {
      // LocalStorage quota or access denied
    }
  }
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    try {
      window.dispatchEvent(new CustomEvent(OPERATOR_CHANGE_EVENT, { detail: trimmed || null }));
    } catch {
      // Ignore
    }
  }
}

export function clearOperatorToken(): void {
  memoryToken = null;
  const storage = getStorage();
  if (storage) {
    try {
      storage.removeItem(OPERATOR_TOKEN_KEY);
    } catch {
      // Ignore
    }
  }
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    try {
      window.dispatchEvent(new CustomEvent(OPERATOR_CHANGE_EVENT, { detail: null }));
    } catch {
      // Ignore
    }
  }
}

export interface UseOperatorResult {
  token: string | null;
  isOperator: boolean;
  verify: (candidateToken: string) => Promise<boolean>;
  logout: () => void;
}

export function useOperator(): UseOperatorResult {
  const [token, setToken] = useState<string | null>(() => getOperatorToken());

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === OPERATOR_TOKEN_KEY) {
        setToken(e.newValue && e.newValue.trim().length > 0 ? e.newValue.trim() : null);
      }
    };
    const handleCustom = (e: Event) => {
      const ce = e as CustomEvent<string | null>;
      setToken(ce.detail);
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener(OPERATOR_CHANGE_EVENT, handleCustom);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(OPERATOR_CHANGE_EVENT, handleCustom);
    };
  }, []);

  const verify = useCallback(async (candidateToken: string): Promise<boolean> => {
    const trimmed = candidateToken.trim();
    if (!trimmed) {
      return false;
    }
    await checkOperator(trimmed);
    setOperatorToken(trimmed);
    setToken(trimmed);
    return true;
  }, []);

  const logout = useCallback(() => {
    clearOperatorToken();
    setToken(null);
  }, []);

  return {
    token,
    isOperator: true,
    verify,
    logout,
  };
}
