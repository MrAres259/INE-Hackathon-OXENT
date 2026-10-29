// Pure route decision logic for authentication & Next 16 Proxy
export const PUBLIC_PATH_PREFIXES = [
  "/_next/",
  "/geo/",
  "/brand/",
  "/api/",
] as const;

export const PUBLIC_EXACT_PATHS = [
  "/login",
  "/favicon.ico",
  "/icon.svg",
  "/apple-icon.png",
  "/icon.png",
] as const;

export function isPublicPath(pathname: string): boolean {
  if (!pathname) return false;
  for (const exact of PUBLIC_EXACT_PATHS) {
    if (pathname === exact) return true;
  }
  for (const prefix of PUBLIC_PATH_PREFIXES) {
    if (pathname.startsWith(prefix)) return true;
  }
  return false;
}

export function isValidInternalRedirect(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim();
  if (!trimmed.startsWith("/")) return false;
  // Disallow protocol-relative URLs like '//evil.com'
  if (trimmed.startsWith("//")) return false;
  // Disallow backslash escapes like '/\evil.com'
  if (trimmed.includes("\\")) return false;
  // Disallow scheme attempts like '/http://evil.com' or 'javascript:'
  if (trimmed.startsWith("/http:") || trimmed.startsWith("/https:")) return false;
  return true;
}

export type AuthDecision =
  | { type: "next" }
  | { type: "redirect"; destination: string };

export interface AuthRouteParams {
  pathname: string;
  search?: string;
  hasSession: boolean;
}

export function getAuthRouteDecision({
  pathname,
  search = "",
  hasSession,
}: AuthRouteParams): AuthDecision {
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;

  // 1. If currently on /login
  if (normalizedPath === "/login") {
    if (hasSession) {
      // If user already has a valid session, redirect away from /login
      let nextUrl: string | null = null;
      if (search) {
        try {
          const params = new URLSearchParams(search);
          const rawNext = params.get("next");
          if (rawNext && isValidInternalRedirect(rawNext)) {
            nextUrl = rawNext;
          }
        } catch {
          // ignore malformed search
        }
      }
      return {
        type: "redirect",
        destination: nextUrl && nextUrl !== "/login" ? nextUrl : "/",
      };
    }
    // No session on /login -> allow
    return { type: "next" };
  }

  // 2. If path is a public resource or API route
  if (isPublicPath(normalizedPath)) {
    return { type: "next" };
  }

  // 3. Protected route: if no session, redirect to /login?next=<fullPath>
  if (!hasSession) {
    const fullPath = search ? `${normalizedPath}${search}` : normalizedPath;
    const dest = `/login?next=${encodeURIComponent(fullPath)}`;
    return {
      type: "redirect",
      destination: dest,
    };
  }

  // 4. Protected route with valid session -> allow
  return { type: "next" };
}
