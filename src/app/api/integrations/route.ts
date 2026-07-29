import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/guard";
import { OAUTH_PROVIDERS, providerConfigured, isScopeGroupGranted } from "@/lib/auth/oauth/providers";
import { getIntegrationMeta, deleteIntegration } from "@/lib/auth/integrations";
import { unlinkOAuth } from "@/lib/auth/store";
import type { User } from "@/lib/auth/store";

export const runtime = "nodejs";

// GET /api/integrations — the full catalog for the current user. For each
// provider: whether its OAuth app is configured (deployment creds present),
// whether THIS user has connected it, what was granted, and the scope groups they
// can connect. Never returns tokens. Honest: unconfigured providers say so.
export const GET = withAuth(async (_req: NextRequest, _ctx: unknown, user: User) => {
  const integrations = Object.values(OAUTH_PROVIDERS).map((p) => {
    const meta = getIntegrationMeta(user.id, p.id);
    const grantedScopes = meta?.scopes ?? [];
    return {
      id: p.id,
      label: p.label,
      configured: providerConfigured(p),
      connected: !!meta,
      email: meta?.email,
      grantedScopes,
      connectedAt: meta?.connectedAt,
      lastUsed: meta?.lastUsed,
      // `granted` is computed authoritatively from the group's real scopes — the UI
      // must not re-derive it from the key (see isScopeGroupGranted for why).
      scopeGroups: Object.entries(p.scopeGroups).map(([key, g]) => ({ key, label: g.label, can: g.can, granted: isScopeGroupGranted(p, key, grantedScopes) })),
    };
  });
  return NextResponse.json({ integrations });
});

// POST /api/integrations { action: "disconnect", provider } — revoke a connection
// locally (removes the encrypted tokens + link). The user can reconnect anytime.
export const POST = withAuth(async (req: NextRequest, _ctx: unknown, user: User) => {
  let body: { action?: string; provider?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (body.action === "disconnect" && body.provider) {
    deleteIntegration(user.id, body.provider);
    unlinkOAuth(body.provider, user.id);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
});
