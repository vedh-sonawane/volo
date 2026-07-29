import { NextRequest, NextResponse } from "next/server";
import { userFromRequest } from "@/lib/auth/session";
import { setOnboarding, setUserName } from "@/lib/auth/store";

export const runtime = "nodejs";

// POST /api/auth/onboarding — save the user's onboarding answers/preferences.
// Non-blocking: onboarding is optional and can be revisited from settings.
export async function POST(req: NextRequest) {
  const user = userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { onboarding?: Record<string, unknown>; name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const onboarding = { ...(body.onboarding || {}), completedAt: Date.now() };
  setOnboarding(user.id, onboarding);
  const displayName = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  if (displayName) setUserName(user.id, displayName);

  return NextResponse.json({ ok: true });
}
