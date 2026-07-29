import { NextRequest, NextResponse } from "next/server";
import { getProvider, providerConfigured } from "@/lib/auth/oauth/providers";
import { buildAuthorizeUrl, makePkce, packState, OAUTH_STATE_COOKIE } from "@/lib/auth/oauth/flow";
import { userFromRequest } from "@/lib/auth/session";
import crypto from "node:crypto";

export const runtime = "nodejs";

// GET /api/auth/oauth/[provider]/start?mode=connect&group=gmail&next=/settings
// Begins an OAuth flow. `mode=login` signs in with the provider; `mode=connect`
// (default) links an integration to the signed-in user. If the provider's OAuth
// app credentials aren't configured, we redirect back honestly — never pretend.
export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: providerId } = await params;
  const provider = getProvider(providerId);
  const origin = req.nextUrl.origin;

  if (!provider) return NextResponse.redirect(`${origin}/settings?integration_error=unknown_provider`);
  if (!providerConfigured(provider)) {
    return NextResponse.redirect(`${origin}/settings?integration_error=not_configured&provider=${provider.id}`);
  }

  const mode = req.nextUrl.searchParams.get("mode") === "login" ? "login" : "connect";
  const group = req.nextUrl.searchParams.get("group") || undefined;
  const next = req.nextUrl.searchParams.get("next") || "/settings";

  // Connecting an integration requires an authenticated user.
  if (mode === "connect") {
    const user = userFromRequest(req);
    if (!user) return NextResponse.redirect(`${origin}/login?next=/settings`);
  }

  // Scopes: identity for login; identity + the chosen capability group for connect.
  const scopes = new Set(provider.loginScopes);
  if (mode === "connect" && group && provider.scopeGroups[group]) {
    for (const s of provider.scopeGroups[group].scopes) scopes.add(s);
  }

  const redirectUri = `${origin}/api/auth/oauth/${provider.id}/callback`;
  const nonce = crypto.randomBytes(16).toString("base64url");
  const pkce = provider.pkce ? makePkce() : undefined;

  // Log the EXACT redirect_uri — it must match what's registered with the provider
  // AND is reused verbatim at token exchange. (No secrets are logged.)
  console.log(`[oauth:${provider.id}] start — mode=${mode} group=${group ?? ""} redirect_uri(exact)=${redirectUri} scopes="${[...scopes].join(" ")}"`);

  const { cookie, state } = packState({ n: nonce, provider: provider.id, mode, group, verifier: pkce?.verifier, redirectUri, next });
  const authorizeUrl = buildAuthorizeUrl(provider, { redirectUri, scopes: [...scopes], state, challenge: pkce?.challenge });

  const res = NextResponse.redirect(authorizeUrl);
  res.cookies.set(OAUTH_STATE_COOKIE, cookie, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 600 });
  return res;
}
