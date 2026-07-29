import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, clearSession } from "@/lib/auth/session";

export const runtime = "nodejs";

// POST /api/auth/logout — destroy the current session + clear the cookie.
export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const res = NextResponse.json({ ok: true });
  clearSession(res, token);
  return res;
}
