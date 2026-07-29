// ─────────────────────────────────────────────────────────────────────────────
// OAuth provider registry — data-driven, pluggable. Adding a provider = adding
// one entry here; the start/callback routes and token flow never hardcode a
// provider. App credentials (client id/secret) are DEPLOYMENT-level and come from
// environment variables (the operator sets them). Per-USER access/refresh tokens
// are stored encrypted elsewhere (integrations store) — never here.
//
// When a provider's credentials are absent, `configured()` is false and the UI
// shows "OAuth credentials not configured" instead of pretending it's available.
// ─────────────────────────────────────────────────────────────────────────────

export interface OAuthProviderDef {
  id: string;
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  /** Scopes requested for a plain "sign in" (identity only). */
  loginScopes: string[];
  /** Named capability scope groups a user can grant to connect an integration. */
  scopeGroups: Record<string, { label: string; can: string; scopes: string[] }>;
  /** Extra params on the authorize URL (e.g. Google offline access). */
  extraAuthParams?: Record<string, string>;
  /** Whether to use PKCE (Google: yes; classic GitHub OAuth app: no). */
  pkce: boolean;
  /** Some token endpoints require Accept: application/json (GitHub). */
  tokenAcceptJson?: boolean;
  /** Env var names for the deployment app credentials. */
  clientIdEnv: string;
  clientSecretEnv: string;
  /** Extract a stable account id + email from the userinfo response. */
  parseUserInfo: (data: Record<string, unknown>) => { accountId: string; email?: string; name?: string };
}

export const OAUTH_PROVIDERS: Record<string, OAuthProviderDef> = {
  google: {
    id: "google",
    label: "Google",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userInfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
    loginScopes: ["openid", "email", "profile"],
    scopeGroups: {
      gmail: { label: "Gmail", can: "Send email on your behalf (with approval)", scopes: ["https://www.googleapis.com/auth/gmail.send"] },
      calendar: { label: "Google Calendar", can: "Create and manage calendar events", scopes: ["https://www.googleapis.com/auth/calendar.events"] },
      drive: { label: "Google Drive", can: "Create and read files it makes for you", scopes: ["https://www.googleapis.com/auth/drive.file"] },
    },
    extraAuthParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
    pkce: true,
    clientIdEnv: "GOOGLE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CLIENT_SECRET",
    parseUserInfo: (d) => ({ accountId: String(d.sub ?? ""), email: (d.email as string) || undefined, name: (d.name as string) || undefined }),
  },
  github: {
    id: "github",
    label: "GitHub",
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    userInfoUrl: "https://api.github.com/user",
    loginScopes: ["read:user", "user:email"],
    scopeGroups: {
      repos: { label: "Repositories (read)", can: "View repositories, commits and issues", scopes: ["repo"] },
      issues: { label: "Issues", can: "Read and create issues (with approval)", scopes: ["repo"] },
    },
    pkce: false,
    tokenAcceptJson: true,
    clientIdEnv: "GITHUB_CLIENT_ID",
    clientSecretEnv: "GITHUB_CLIENT_SECRET",
    parseUserInfo: (d) => ({ accountId: String(d.id ?? ""), email: (d.email as string) || undefined, name: (d.name as string) || (d.login as string) || undefined }),
  },
};

export function getProvider(id: string): OAuthProviderDef | null {
  return OAUTH_PROVIDERS[id] ?? null;
}

/** Deployment app credentials for a provider (from env — operator-configured). */
export function providerCredentials(p: OAuthProviderDef): { clientId: string; clientSecret: string } {
  return { clientId: (process.env[p.clientIdEnv] || "").trim(), clientSecret: (process.env[p.clientSecretEnv] || "").trim() };
}

/** Is this provider's OAuth app configured (both id + secret present)? */
export function providerConfigured(p: OAuthProviderDef): boolean {
  const { clientId, clientSecret } = providerCredentials(p);
  return !!clientId && !!clientSecret;
}

// "Meta" scopes are identity/refresh plumbing, not a capability grant. They must
// NOT be required when deciding whether a capability scope group is granted (e.g.
// GitHub's `read:user`/`user:email` are login identity, not a capability).
const META_SCOPES = new Set(["openid", "email", "profile", "read:user", "user:email"]);

/** Last path segment of a scope, lowercased — normalizes full-URI vs short forms.
 *  e.g. "https://www.googleapis.com/auth/gmail.send" → "gmail.send"; "repo" → "repo". */
function scopeSeg(s: string): string {
  return (s.split("/").pop() || s).toLowerCase();
}

/**
 * Is a named capability scope group granted, given the scopes actually returned by
 * the provider? Segment-matched so it's robust to full-URI vs short forms and to
 * comma/space separators. This is the SINGLE source of truth for "granted" — the
 * UI must not re-derive it from group keys (a group key like "repos" is NOT the
 * scope "repo"). Returns false when the group is unknown or the user isn't connected.
 */
export function isScopeGroupGranted(p: OAuthProviderDef, groupKey: string, grantedScopes: string[]): boolean {
  const g = p.scopeGroups[groupKey];
  if (!g) return false;
  const grantedSegs = new Set(grantedScopes.map(scopeSeg));
  const required = g.scopes.map(scopeSeg).filter((s) => !META_SCOPES.has(s));
  if (required.length === 0) return false;
  return required.every((s) => grantedSegs.has(s));
}
