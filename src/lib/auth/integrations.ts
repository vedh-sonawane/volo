// ─────────────────────────────────────────────────────────────────────────────
// UserIntegration store — per-user connected services + their OAuth tokens.
//
// Security: access/refresh tokens are stored ENCRYPTED (AES-256-GCM, the same
// local key as other secrets). They are NEVER returned to the browser and NEVER
// placed in a model prompt — only server-side execution code calls getAccessToken.
// Everything is scoped by user id.
// ─────────────────────────────────────────────────────────────────────────────

import Database from "better-sqlite3";
import path from "node:path";
import { encryptValue, decryptValue } from "@/lib/config";
import { getProvider } from "./oauth/providers";
import { refreshAccessToken } from "./oauth/flow";

const DB_PATH = process.env.VOLO_DB_PATH || "./.data/volo.db";
let _db: Database.Database | null = null;
function db(): Database.Database {
  if (_db) return _db;
  _db = new Database(path.resolve(process.cwd(), DB_PATH));
  _db.pragma("journal_mode = WAL");
  _db.exec(`
    CREATE TABLE IF NOT EXISTS user_integrations (
      user_id     TEXT NOT NULL,
      provider    TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'connected',
      scopes      TEXT NOT NULL DEFAULT '',
      account_id  TEXT,
      email       TEXT,
      credentials TEXT NOT NULL,   -- encrypted { accessToken, refreshToken }
      expires_at  INTEGER,
      connected_at INTEGER NOT NULL,
      last_used   INTEGER,
      PRIMARY KEY (user_id, provider)
    );
  `);
  return _db;
}

/** Safe, token-free view of an integration (for the UI / capability layer). */
export interface IntegrationMeta {
  provider: string;
  status: string;
  scopes: string[];
  email?: string;
  connectedAt: number;
  lastUsed?: number;
  expiresAt?: number;
  hasRefreshToken: boolean;
}

interface Row {
  user_id: string;
  provider: string;
  status: string;
  scopes: string;
  account_id: string | null;
  email: string | null;
  credentials: string;
  expires_at: number | null;
  connected_at: number;
  last_used: number | null;
}

function creds(row: Row): { accessToken: string; refreshToken?: string } {
  try {
    return JSON.parse(decryptValue(row.credentials) || "{}");
  } catch {
    return { accessToken: "" };
  }
}
function toMeta(row: Row): IntegrationMeta {
  return {
    provider: row.provider,
    status: row.status,
    scopes: row.scopes ? row.scopes.split(" ").filter(Boolean) : [],
    email: row.email ?? undefined,
    connectedAt: row.connected_at,
    lastUsed: row.last_used ?? undefined,
    expiresAt: row.expires_at ?? undefined,
    hasRefreshToken: !!creds(row).refreshToken,
  };
}

export function upsertIntegration(
  userId: string,
  provider: string,
  data: { accessToken: string; refreshToken?: string; expiresAt?: number; scopes: string[]; accountId?: string; email?: string }
): void {
  const now = Date.now();
  const existing = db().prepare(`SELECT * FROM user_integrations WHERE user_id=? AND provider=?`).get(userId, provider) as Row | undefined;
  // Preserve a prior refresh token if the provider didn't return a new one.
  const refreshToken = data.refreshToken || (existing ? creds(existing).refreshToken : undefined);
  const credentials = encryptValue(JSON.stringify({ accessToken: data.accessToken, refreshToken }));
  db()
    .prepare(
      `INSERT INTO user_integrations (user_id,provider,status,scopes,account_id,email,credentials,expires_at,connected_at,last_used)
       VALUES (@user_id,@provider,'connected',@scopes,@account_id,@email,@credentials,@expires_at,@connected_at,@last_used)
       ON CONFLICT(user_id,provider) DO UPDATE SET status='connected', scopes=@scopes, account_id=@account_id, email=@email, credentials=@credentials, expires_at=@expires_at`
    )
    .run({
      user_id: userId,
      provider,
      scopes: data.scopes.join(" "),
      account_id: data.accountId ?? null,
      email: data.email ?? null,
      credentials,
      expires_at: data.expiresAt ?? null,
      connected_at: existing?.connected_at ?? now,
      last_used: existing?.last_used ?? null,
    });
}

export function getIntegrationMeta(userId: string, provider: string): IntegrationMeta | null {
  const row = db().prepare(`SELECT * FROM user_integrations WHERE user_id=? AND provider=?`).get(userId, provider) as Row | undefined;
  return row ? toMeta(row) : null;
}

export function listIntegrations(userId: string): IntegrationMeta[] {
  const rows = db().prepare(`SELECT * FROM user_integrations WHERE user_id=? ORDER BY connected_at DESC`).all(userId) as Row[];
  return rows.map(toMeta);
}

export function deleteIntegration(userId: string, provider: string): void {
  db().prepare(`DELETE FROM user_integrations WHERE user_id=? AND provider=?`).run(userId, provider);
}

/** True when the user granted a given scope for a provider. */
export function integrationHasScope(userId: string, provider: string, scope: string): boolean {
  const meta = getIntegrationMeta(userId, provider);
  return !!meta && meta.scopes.includes(scope);
}

/**
 * Server-only: a valid access token for the user's integration. Refreshes it
 * transparently when expired (if a refresh token exists). Returns null when the
 * integration is missing or cannot be refreshed. NEVER expose the result to the
 * client or the model.
 */
export async function getAccessToken(userId: string, provider: string): Promise<string | null> {
  const row = db().prepare(`SELECT * FROM user_integrations WHERE user_id=? AND provider=?`).get(userId, provider) as Row | undefined;
  if (!row) return null;
  const { accessToken, refreshToken } = creds(row);
  const expiresAt = row.expires_at ?? undefined;
  const fresh = !expiresAt || expiresAt - 60_000 > Date.now(); // 60s skew
  if (fresh && accessToken) {
    db().prepare(`UPDATE user_integrations SET last_used=? WHERE user_id=? AND provider=?`).run(Date.now(), userId, provider);
    return accessToken;
  }
  // Expired → refresh if we can.
  const def = getProvider(provider);
  if (!def || !refreshToken) return accessToken || null;
  try {
    const tokens = await refreshAccessToken(def, refreshToken);
    upsertIntegration(userId, provider, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken || refreshToken,
      expiresAt: tokens.expiresAt,
      scopes: row.scopes ? row.scopes.split(" ").filter(Boolean) : [],
      accountId: row.account_id ?? undefined,
      email: row.email ?? undefined,
    });
    db().prepare(`UPDATE user_integrations SET last_used=? WHERE user_id=? AND provider=?`).run(Date.now(), userId, provider);
    return tokens.accessToken;
  } catch {
    return null; // refresh failed → treat as needing reconnection
  }
}
