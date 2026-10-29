// Client-side authentication helpers for Atalaya Electoral
import { isValidInternalRedirect } from "./authRoutes";
import { isMockEnabled } from "./api";

export const SESSION_COOKIE_NAME = "atalaya_session";

export interface AuthUser {
  username: string;
}

export interface AuthSession {
  user: AuthUser;
  expires_at: string;
}

export class AuthError extends Error {
  status: number;
  detail: string;
  retryAfterS?: number | null;

  constructor(message: string, status: number, detail?: string, retryAfterS?: number | null) {
    super(message);
    this.name = "AuthError";
    this.status = status;
    this.detail = detail || message;
    this.retryAfterS = retryAfterS;
  }
}

function parseRetryAfter(headerVal: string | null): number | null {
  if (!headerVal) return null;
  const parsed = parseFloat(headerVal);
  return Number.isFinite(parsed) ? parsed : null;
}

// Redirect guard to prevent multiple redirects or loops
let isRedirecting = false;

export function redirectToLogin(customNext?: string): void {
  if (typeof window === "undefined") return;
  if (isRedirecting) return;

  const currentPathname = window.location.pathname;
  if (currentPathname === "/login") return;

  isRedirecting = true;
  const targetNext = customNext ?? (currentPathname + window.location.search);
  const nextParam =
    targetNext && targetNext !== "/"
      ? `?next=${encodeURIComponent(targetNext)}`
      : "";

  try {
    window.location.href = `/login${nextParam}`;
  } catch {
    // If navigation fails (e.g. in non-browser env)
    isRedirecting = false;
  }
}

// Reset redirection state (useful in tests)
export function resetRedirectState(): void {
  isRedirecting = false;
}

export async function login(username: string, password: string): Promise<AuthSession> {
  const trimmedUser = username.trim();
  if (!trimmedUser || !password) {
    throw new AuthError("Usuario y contraseña requeridos.", 400, "Por favor introduce tu usuario y contraseña.");
  }

  // If in mock mode, simulate immediate success
  if (isMockEnabled()) {
    return {
      user: { username: trimmedUser },
      expires_at: new Date(Date.now() + 12 * 3600 * 1000).toISOString(),
    };
  }

  let res: Response;
  try {
    res = await fetch("/api/auth/login", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        username: trimmedUser,
        password,
      }),
    });
  } catch (netErr: any) {
    throw new AuthError(
      netErr?.message || "Error de conexión",
      0,
      "No fue posible conectar con el servidor. Verifica tu conexión de red."
    );
  }

  if (!res.ok) {
    let detail = "Error de inicio de sesión.";
    let retryAfterS = parseRetryAfter(res.headers.get("Retry-After"));

    try {
      const errJson = await res.json();
      if (errJson && typeof errJson === "object") {
        if (typeof errJson.detail === "string") {
          detail = errJson.detail;
        } else if (errJson.detail) {
          detail = JSON.stringify(errJson.detail);
        }
        if (typeof errJson.retry_after_s === "number") {
          retryAfterS = errJson.retry_after_s;
        }
      }
    } catch {
      try {
        const text = await res.text();
        if (text) detail = text;
      } catch {
        // use fallback
      }
    }

    if (res.status === 401) {
      detail = detail || "Usuario o contraseña incorrectos.";
    } else if (res.status === 429) {
      detail = detail || "Demasiados intentos. Intenta de nuevo en unos minutos.";
    }

    throw new AuthError(detail, res.status, detail, retryAfterS);
  }

  return (await res.json()) as AuthSession;
}

export async function logout(): Promise<void> {
  if (!isMockEnabled()) {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
        },
      });
    } catch {
      // Proceed with client logout even if network request fails
    }
  }

  if (typeof window !== "undefined") {
    window.location.href = "/login";
  }
}

export async function getSession(): Promise<AuthSession | null> {
  if (isMockEnabled()) {
    return {
      user: { username: "operador_demo" },
      expires_at: new Date(Date.now() + 12 * 3600 * 1000).toISOString(),
    };
  }

  try {
    const res = await fetch("/api/auth/session", {
      method: "GET",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
      },
    });

    if (res.status === 401) {
      return null;
    }

    if (!res.ok) {
      return null;
    }

    return (await res.json()) as AuthSession;
  } catch {
    return null;
  }
}
