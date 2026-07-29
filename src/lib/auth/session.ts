// Session-cookie helpers bridging the account store to Next.js requests.
//
// The cookie is an httpOnly, SameSite=Lax, Secure-in-prod bearer token; it holds
// only the opaque token (validated against the hashed server-side session).

import type { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createSession, destroySession, getSessionUser, type User } from "./store";

export const SESSION_COOKIE = "volo_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function cookieOptions(expires: Date) {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  };
}

/** Create a session for `userId` and attach the cookie to a route response. */
export function attachSession(res: NextResponse, userId: string): void {
  const { token, expiresAt } = createSession(userId, SESSION_TTL_MS);
  res.cookies.set(SESSION_COOKIE, token, cookieOptions(new Date(expiresAt)));
}

/** Clear the session (server + cookie) on a route response. */
export function clearSession(res: NextResponse, rawToken?: string): void {
  if (rawToken) destroySession(rawToken);
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

/** The authenticated user for a route handler, or null. */
export function userFromRequest(req: NextRequest): User | null {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  return token ? getSessionUser(token) : null;
}

/** The authenticated user for a Server Component / page, or null. */
export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? getSessionUser(token) : null;
}
