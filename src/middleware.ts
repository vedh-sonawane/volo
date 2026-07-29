import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Edge middleware: a cheap gate. It only checks for the PRESENCE of a session
// cookie (it can't touch the DB from the edge) and redirects page navigations to
// /login when absent. Real validation happens in the Node route handlers via
// withAuth (which return 401 for API calls). The cookie name is inlined so this
// file imports nothing node-only.
const SESSION_COOKIE = "volo_session";
const PUBLIC_PAGES = ["/login", "/signup", "/verify", "/terms", "/privacy"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // API routes protect themselves (withAuth → 401); never redirect JSON.
  if (pathname.startsWith("/api/")) return NextResponse.next();

  // Public pages + Next internals + static files pass through.
  if (
    PUBLIC_PAGES.some((p) => pathname === p || pathname.startsWith(p + "/")) ||
    pathname.startsWith("/_next/") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  if (!req.cookies.has(SESSION_COOKIE)) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
