// ─────────────────────────────────────────────────────────────────────────────
// Generic external DATA-READ registry (domain-agnostic, data-driven).
//
// Principle: NEVER answer from the model's memory when a connected external source
// can supply the real data. When an objective matches a registered read whose
// integration the user has connected, Volo fetches the REAL data from that provider's
// API (with the user's encrypted OAuth token) and passes the facts to the model for
// FORMATTING ONLY. If the matching integration isn't connected, Volo says so — it
// never invents the data.
//
// Adding a provider/read is DATA here (one registry entry) — the engine that routes
// and renders never hardcodes a provider or a domain. GitHub repositories is the
// first entry; Gmail messages, Drive files, GitHub issues, etc. plug in the same way.
// ─────────────────────────────────────────────────────────────────────────────

import { getProvider, isScopeGroupGranted } from "@/lib/auth/oauth/providers";
import { getIntegrationMeta } from "@/lib/auth/integrations";

export interface DataReadItem {
  /** Primary display name (real, from the API — never invented). */
  title: string;
  /** A link back to the item, for the source trace. */
  url?: string;
  /** A short qualifier (e.g. "private" / "public"), optional. */
  sub?: string;
}

export interface DataReadResult {
  items: DataReadItem[];
  /** The API endpoint the data came from — recorded as the source trace. */
  sourceUrl: string;
}

export interface DataRead {
  id: string;
  /** The OAuth integration provider id this read needs (e.g. "github"). */
  provider: string;
  /** The scope group (from the provider registry) that must be granted. */
  scopeGroup: string;
  /** Human label for the data (e.g. "GitHub repositories"). */
  label: string;
  /** Human label for the provider to connect (e.g. "GitHub"). */
  connectLabel: string;
  /** Objective-intent matcher (the user's natural wording — no magic keywords). */
  match: RegExp;
  /** Perform the real API call with the user's access token. Throws on API error. */
  run: (accessToken: string) => Promise<DataReadResult>;
}

async function githubRepos(token: string): Promise<DataReadResult> {
  const sourceUrl = "https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member";
  const res = await fetch(sourceUrl, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "Volo", "X-GitHub-Api-Version": "2022-11-28" },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(`GitHub API ${res.status}: ${body.message || "request failed"}`);
  }
  const data = (await res.json().catch(() => [])) as Array<Record<string, unknown>>;
  const arr = Array.isArray(data) ? data : [];
  const items: DataReadItem[] = arr.map((r) => ({
    title: String(r.full_name || r.name || "(unnamed repo)"),
    url: r.html_url ? String(r.html_url) : undefined,
    sub: r.private ? "private" : "public",
  }));
  return { items, sourceUrl: "https://api.github.com/user/repos" };
}

export const DATA_READS: DataRead[] = [
  {
    id: "github.repos",
    provider: "github",
    scopeGroup: "repos",
    label: "GitHub repositories",
    connectLabel: "GitHub",
    // "my repos", "list my github", "read all my repositories", "github projects"…
    match:
      /\b(?:my|list|show|read|get|fetch|all)\b[^.]*\b(?:repos?|repositor(?:y|ies))\b|\b(?:repos?|repositor(?:y|ies)|projects?)\b[^.]*\bgithub\b|\bgithub\b[^.]*\b(?:repos?|repositor(?:y|ies)|projects?)\b|\b(?:list|show|my)\s+github\b/i,
    run: githubRepos,
  },
];

/** Pure intent match — returns the first registered read the objective asks for. */
export function detectDataRead(objective: string): DataRead | null {
  for (const r of DATA_READS) if (r.match.test(objective)) return r;
  return null;
}

export function getDataRead(id: string | undefined): DataRead | null {
  return DATA_READS.find((r) => r.id === id) ?? null;
}

/** Is the matched read's integration connected AND its scope granted for this user? */
export function dataReadConnected(read: DataRead, userId: string): boolean {
  const meta = getIntegrationMeta(userId, read.provider);
  if (!meta) return false;
  const p = getProvider(read.provider);
  return !!p && isScopeGroupGranted(p, read.scopeGroup, meta.scopes);
}
