import { NextRequest, NextResponse } from "next/server";
import { getProvider, providerCredentials } from "@/lib/auth/oauth/providers";
import { exchangeCode, fetchUserInfo, unpackState, OAUTH_STATE_COOKIE } from "@/lib/auth/oauth/flow";
import { userFromRequest, attachSession } from "@/lib/auth/session";
import { createUser, findUserByEmail, findUserIdByOAuth, linkOAuth } from "@/lib/auth/store";
import { upsertIntegration, getIntegrationMeta } from "@/lib/auth/integrations";

export const runtime = "nodejs";

// GET /api/auth/oauth/[provider]/callback — the provider redirects here with a
// `code` + `state`. Every step is logged (server-side, NO secrets/tokens/codes)
// and the REAL provider error is surfaced to the user instead of a generic one.
export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: providerId } = await params;
  const provider = getProvider(providerId);
  const origin = req.nextUrl.origin;
  const log = (m: string) => console.log(`[oauth:${providerId}] ${m}`);

  const fail = (reason: string, detail?: string, page = "/settings") => {
    console.error(`[oauth:${providerId}] FAILED: ${reason}${detail ? ` — ${detail}` : ""}`);
    const url = new URL(`${origin}${page}`);
    url.searchParams.set("integration_error", reason);
    if (detail) url.searchParams.set("integration_detail", detail.slice(0, 240));
    const res = NextResponse.redirect(url.toString());
    res.cookies.set(OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  };

  // ── Step 0: provider known ──────────────────────────────────────────────────
  if (!provider) return fail("unknown_provider");
  log("① callback reached");

  // ── Step 1: provider-reported error (e.g. user denied consent) ──────────────
  const providerError = req.nextUrl.searchParams.get("error");
  if (providerError) {
    const desc = req.nextUrl.searchParams.get("error_description") || undefined;
    return fail(providerError, desc, providerError === "access_denied" ? "/settings" : "/settings");
  }

  // ── Step 2: authorization code received ─────────────────────────────────────
  const code = req.nextUrl.searchParams.get("code") || "";
  const returnedState = req.nextUrl.searchParams.get("state") || "";
  log(`② code_present=${!!code} state_present=${!!returnedState}`);
  if (!code) return fail("no_code", "provider returned no authorization code");

  // ── Step 3: state / CSRF validation ─────────────────────────────────────────
  const state = unpackState(req.cookies.get(OAUTH_STATE_COOKIE)?.value, returnedState);
  if (!state) return fail("invalid_state", "state cookie missing/expired or nonce mismatch (CSRF check)");
  if (state.provider !== provider.id) return fail("invalid_state", "state provider mismatch");
  log(`③ state OK — mode=${state.mode} redirect_uri=${state.redirectUri} pkce=${state.verifier ? "yes" : "no"}`);

  // ── Step 5: credentials present (log presence only — never the values) ──────
  const { clientId, clientSecret } = providerCredentials(provider);
  log(`④/⑤ client_id_set=${!!clientId} client_secret_set=${!!clientSecret}`);
  if (!clientId || !clientSecret) return fail("not_configured", `${provider.label} client id/secret missing on the server`);

  // ── Step 4/6: exchange the code for tokens (redirect_uri must match exactly) ─
  let tokens;
  try {
    log(`⑥ exchanging code — redirect_uri(exact)=${state.redirectUri}`);
    tokens = await exchangeCode(provider, { code, redirectUri: state.redirectUri, verifier: state.verifier });
    log(`✓ token exchange OK — has_refresh=${!!tokens.refreshToken} expires=${tokens.expiresAt ? "yes" : "no"} scope="${tokens.scope || ""}"`);
  } catch (e) {
    // e.message is the REAL provider error: invalid_grant / redirect_uri_mismatch
    // / invalid_client / invalid_request / network error — never a secret.
    return fail("token_exchange_failed", e instanceof Error ? e.message : "unknown token error", state.mode === "login" ? "/login" : "/settings");
  }

  // ── Step: read the account identity ─────────────────────────────────────────
  let info;
  try {
    info = await fetchUserInfo(provider, tokens.accessToken);
    log(`✓ userinfo OK — account_present=${!!info.accountId} email_present=${!!info.email}`);
  } catch (e) {
    return fail("userinfo_failed", e instanceof Error ? e.message : "unknown userinfo error", state.mode === "login" ? "/login" : "/settings");
  }
  if (!info.accountId) return fail("no_account", "provider returned no account id");

  // GitHub returns scopes comma-separated; Google space-separated.
  const grantedScopes = tokens.scope ? tokens.scope.split(/[\s,]+/).filter(Boolean) : provider.loginScopes;
  log(`granted scopes returned: "${grantedScopes.join(" ")}"`);

  // Capability upgrades are ADDITIVE: connecting a new scope group must never drop a
  // previously granted one. Merge the newly granted scopes with what's already stored.
  const mergeScopes = (userId: string) => Array.from(new Set([...(getIntegrationMeta(userId, provider.id)?.scopes ?? []), ...grantedScopes]));

  // ── Step 7/8: store the (encrypted) tokens as the user's integration ────────
  if (state.mode === "connect") {
    const user = userFromRequest(req);
    if (!user) return fail("not_signed_in", "sign in first, then connect", "/login");
    try {
      const hadBefore = !!getIntegrationMeta(user.id, provider.id);
      const scopes = mergeScopes(user.id);
      linkOAuth(provider.id, info.accountId, user.id, info.email);
      upsertIntegration(user.id, provider.id, { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: tokens.expiresAt, scopes, accountId: info.accountId, email: info.email });
      log(`⑦/⑧ integration ${hadBefore ? "UPDATED (capability upgrade)" : "CREATED"} for user ${user.id} — merged scopes="${scopes.join(" ")}"`);
    } catch (e) {
      return fail("storage_failed", e instanceof Error ? e.message : "could not save the connection");
    }
    // ⑨ Capability snapshot now reflects the connection on the next task/settings load.
    const res = NextResponse.redirect(`${origin}/settings?integration_connected=${provider.id}`);
    res.cookies.set(OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  }

  // ── mode: sign in / sign up with the provider ───────────────────────────────
  let userId = findUserIdByOAuth(provider.id, info.accountId);
  let isNew = false;
  if (!userId && info.email) {
    const existing = findUserByEmail(info.email);
    if (existing) userId = existing.id;
  }
  if (!userId) {
    const created = createUser({ email: info.email || `${provider.id}_${info.accountId}@users.volo.local`, name: info.name, emailVerified: !!info.email });
    userId = created.id;
    isNew = true;
  }
  try {
    linkOAuth(provider.id, info.accountId, userId, info.email);
    upsertIntegration(userId, provider.id, { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: tokens.expiresAt, scopes: mergeScopes(userId), accountId: info.accountId, email: info.email });
  } catch (e) {
    return fail("storage_failed", e instanceof Error ? e.message : "could not save the sign-in", "/login");
  }
  log(`✓ signed in user ${userId} (new=${isNew})`);

  // New accounts go through onboarding; returning users land where they intended.
  const dest = isNew ? "/welcome" : state.next && state.next.startsWith("/") ? state.next : "/";
  const res = NextResponse.redirect(`${origin}${dest}`);
  attachSession(res, userId);
  res.cookies.set(OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
