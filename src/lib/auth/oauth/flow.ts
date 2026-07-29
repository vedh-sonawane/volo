// Generic OAuth 2.0 flow helpers — provider-agnostic. PKCE + a signed/encrypted
// state cookie protect against CSRF and code injection. No provider is hardcoded;
// everything is driven by the provider definition.

import crypto from "node:crypto";
import { encryptValue, decryptValue } from "@/lib/config";
import type { OAuthProviderDef } from "./providers";
import { providerCredentials } from "./providers";

export const OAUTH_STATE_COOKIE = "volo_oauth";
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes to complete a flow

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

/** PKCE pair: a random verifier + its S256 challenge. */
export function makePkce(): { verifier: string; challenge: string } {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export interface OAuthState {
  n: string; // nonce (== the `state` query param)
  provider: string;
  mode: "login" | "connect";
  group?: string; // integration scope group (connect mode)
  verifier?: string; // PKCE
  redirectUri: string;
  next: string;
  exp: number;
}

/** Encrypt the state into a cookie value; the `n` nonce also becomes the `state` param. */
export function packState(s: Omit<OAuthState, "exp">): { cookie: string; state: string } {
  const full: OAuthState = { ...s, exp: Date.now() + STATE_TTL_MS };
  return { cookie: encryptValue(JSON.stringify(full)), state: full.n };
}

/** Decrypt + validate the state cookie against the returned `state` param. */
export function unpackState(cookie: string | undefined, returnedState: string | undefined): OAuthState | null {
  if (!cookie || !returnedState) return null;
  const raw = decryptValue(cookie);
  if (!raw) return null;
  let s: OAuthState;
  try {
    s = JSON.parse(raw);
  } catch {
    return null;
  }
  if (s.exp < Date.now()) return null;
  // Constant-time compare of the nonce (CSRF binding).
  const a = Buffer.from(s.n);
  const b = Buffer.from(returnedState);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return s;
}

/** Build the provider's authorize URL for the given scopes + PKCE challenge. */
export function buildAuthorizeUrl(p: OAuthProviderDef, opts: { redirectUri: string; scopes: string[]; state: string; challenge?: string }): string {
  const { clientId } = providerCredentials(p);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: opts.scopes.join(" "),
    state: opts.state,
    ...(p.extraAuthParams || {}),
  });
  if (p.pkce && opts.challenge) {
    params.set("code_challenge", opts.challenge);
    params.set("code_challenge_method", "S256");
  }
  return `${p.authorizeUrl}?${params.toString()}`;
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number; // ms epoch
  scope?: string;
}

/** Exchange an authorization code for tokens. */
export async function exchangeCode(p: OAuthProviderDef, opts: { code: string; redirectUri: string; verifier?: string }): Promise<TokenSet> {
  const { clientId, clientSecret } = providerCredentials(p);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: opts.code,
    redirect_uri: opts.redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  });
  if (p.pkce && opts.verifier) body.set("code_verifier", opts.verifier);
  return postToken(p, body);
}

/** Refresh an access token using a stored refresh token. */
export async function refreshAccessToken(p: OAuthProviderDef, refreshToken: string): Promise<TokenSet> {
  const { clientId, clientSecret } = providerCredentials(p);
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });
  return postToken(p, body);
}

async function postToken(p: OAuthProviderDef, body: URLSearchParams): Promise<TokenSet> {
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (p.tokenAcceptJson) headers.Accept = "application/json";
  let res: Response;
  try {
    res = await fetch(p.tokenUrl, { method: "POST", headers, body: body.toString() });
  } catch (e) {
    throw new Error(`network error reaching ${p.label} token endpoint: ${e instanceof Error ? e.message : "fetch failed"}`);
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || !data.access_token) {
    // Surface the provider's REAL error code + description (no secrets in these).
    const code = data.error ? String(data.error) : `HTTP ${res.status}`;
    const desc = data.error_description ? `: ${String(data.error_description)}` : "";
    throw new Error(`${code}${desc}`);
  }
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : undefined;
  return {
    accessToken: String(data.access_token),
    refreshToken: data.refresh_token ? String(data.refresh_token) : undefined,
    expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
    scope: data.scope ? String(data.scope) : undefined,
  };
}

/** Fetch the provider's user identity with an access token. */
export async function fetchUserInfo(p: OAuthProviderDef, accessToken: string): Promise<{ accountId: string; email?: string; name?: string }> {
  let res: Response;
  try {
    res = await fetch(p.userInfoUrl, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json", "User-Agent": "Volo" } });
  } catch (e) {
    throw new Error(`network error reaching ${p.label} userinfo: ${e instanceof Error ? e.message : "fetch failed"}`);
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: { message?: string }; error_description?: string };
    const reason = data.error?.message || data.error_description || `HTTP ${res.status}`;
    throw new Error(`userinfo failed (${reason})`);
  }
  const data = (await res.json()) as Record<string, unknown>;
  return p.parseUserInfo(data);
}
