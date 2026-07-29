import { NextResponse } from "next/server";
import { OAUTH_PROVIDERS, providerConfigured } from "@/lib/auth/oauth/providers";

export const runtime = "nodejs";

// GET /api/auth/providers — PUBLIC. Lists which OAuth providers have their app
// credentials configured on this deployment, so the login/signup pages can show a
// working "continue with" button ONLY when it can actually work. Exposes no secrets
// (just id/label/configured boolean) and needs no session — the login page is
// unauthenticated by definition.
export function GET() {
  const providers = Object.values(OAUTH_PROVIDERS).map((p) => ({
    id: p.id,
    label: p.label,
    configured: providerConfigured(p),
  }));
  return NextResponse.json({ providers });
}
