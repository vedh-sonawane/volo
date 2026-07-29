import { NextRequest, NextResponse } from "next/server";
import { userFromRequest } from "@/lib/auth/session";
import { listOAuthForUser } from "@/lib/auth/store";

export const runtime = "nodejs";

// GET /api/auth/me — the current user (or null). Never returns secrets/hashes.
export async function GET(req: NextRequest) {
  const user = userFromRequest(req);
  if (!user) return NextResponse.json({ user: null });
  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerified: user.emailVerified,
      onboarding: user.onboarding ?? null,
      linkedProviders: listOAuthForUser(user.id).map((p) => p.provider),
    },
  });
}
