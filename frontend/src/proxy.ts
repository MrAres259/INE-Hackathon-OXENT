import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAuthRouteDecision } from "./lib/authRoutes";

export const SESSION_COOKIE_NAME = "atalaya_session";

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const hasSession = Boolean(sessionCookie && sessionCookie.trim().length > 0);

  const decision = getAuthRouteDecision({
    pathname,
    search,
    hasSession,
  });

  if (decision.type === "redirect") {
    return NextResponse.redirect(new URL(decision.destination, request.url));
  }

  return NextResponse.next();
}

export default proxy;

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     */
    "/((?!_next/static|_next/image).*)",
  ],
};
