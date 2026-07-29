// ─────────────────────────────────────────────────────────────────────────────
// Accounts + sessions + tokens + linked OAuth providers (local SQLite, server-only).
//
// Security posture:
//   • Session tokens are random 256-bit opaque bearer tokens; we store only their
//     SHA-256 hash, never the raw token. Same for email-verify / password-reset.
//   • Passwords are scrypt-hashed (see passwords.ts). Never stored/logged in clear.
//   • OAuth access/refresh tokens are stored ENCRYPTED via the secret store, keyed
//     per user — never returned to the client or put into a model prompt.
// ─────────────────────────────────────────────────────────────────────────────

import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DB_PATH = process.env.VOLO_DB_PATH || "./.data/volo.db";
let _db: Database.Database | null = null;

function db(): Database.Database {
  if (_db) return _db;
  const abs = path.resolve(process.cwd(), DB_PATH);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  _db = new Database(abs);
  _db.pragma("journal_mode = WAL");
  _db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      email         TEXT UNIQUE NOT NULL,
      name          TEXT,
      password_hash TEXT,
      email_verified INTEGER NOT NULL DEFAULT 0,
      onboarding    TEXT,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      kind       TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS oauth_accounts (
      provider            TEXT NOT NULL,
      provider_account_id TEXT NOT NULL,
      user_id             TEXT NOT NULL,
      email               TEXT,
      created_at          INTEGER NOT NULL,
      PRIMARY KEY (provider, provider_account_id)
    );
    CREATE TABLE IF NOT EXISTS email_codes (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      purpose    TEXT NOT NULL,          -- 'signup' | 'login' | 'reset'
      code_hash  TEXT NOT NULL,          -- sha256 of the 6-digit code (never plaintext)
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      attempts   INTEGER NOT NULL DEFAULT 0,
      consumed   INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_email_codes_lookup ON email_codes (user_id, purpose, created_at);
    CREATE TABLE IF NOT EXISTS trusted_devices (
      token_hash TEXT PRIMARY KEY,       -- sha256 of the device token cookie
      user_id    TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_seen  INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);
  return _db;
}

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}
function id(prefix: string): string {
  return prefix + crypto.randomBytes(9).toString("base64url");
}

// ── users ────────────────────────────────────────────────────────────────────
export interface User {
  id: string;
  email: string;
  name?: string;
  emailVerified: boolean;
  onboarding?: unknown;
  createdAt: number;
}
interface UserRow {
  id: string;
  email: string;
  name: string | null;
  password_hash: string | null;
  email_verified: number;
  onboarding: string | null;
  created_at: number;
}
function toUser(r: UserRow): User {
  return {
    id: r.id,
    email: r.email,
    name: r.name ?? undefined,
    emailVerified: !!r.email_verified,
    onboarding: r.onboarding ? safeJson(r.onboarding) : undefined,
    createdAt: r.created_at,
  };
}
function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

export function normalizeEmail(email: string): string {
  return (email || "").trim().toLowerCase();
}

export function createUser(opts: { email: string; name?: string; passwordHash?: string; emailVerified?: boolean }): User {
  const now = Date.now();
  const uid = id("u_");
  db()
    .prepare(`INSERT INTO users (id,email,name,password_hash,email_verified,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`)
    .run(uid, normalizeEmail(opts.email), opts.name ?? null, opts.passwordHash ?? null, opts.emailVerified ? 1 : 0, now, now);
  return findUserById(uid)!;
}

export function findUserById(uid: string): User | null {
  const r = db().prepare(`SELECT * FROM users WHERE id = ?`).get(uid) as UserRow | undefined;
  return r ? toUser(r) : null;
}
export function findUserByEmail(email: string): (User & { passwordHash?: string }) | null {
  const r = db().prepare(`SELECT * FROM users WHERE email = ?`).get(normalizeEmail(email)) as UserRow | undefined;
  return r ? { ...toUser(r), passwordHash: r.password_hash ?? undefined } : null;
}
export function getPasswordHash(uid: string): string | null {
  const r = db().prepare(`SELECT password_hash FROM users WHERE id = ?`).get(uid) as { password_hash: string | null } | undefined;
  return r?.password_hash ?? null;
}
export function setPasswordHash(uid: string, hash: string): void {
  db().prepare(`UPDATE users SET password_hash=?, updated_at=? WHERE id=?`).run(hash, Date.now(), uid);
}
export function setEmailVerified(uid: string, verified = true): void {
  db().prepare(`UPDATE users SET email_verified=?, updated_at=? WHERE id=?`).run(verified ? 1 : 0, Date.now(), uid);
}
export function setUserEmail(uid: string, email: string): void {
  db().prepare(`UPDATE users SET email=?, email_verified=0, updated_at=? WHERE id=?`).run(normalizeEmail(email), Date.now(), uid);
}
export function setUserName(uid: string, name: string): void {
  db().prepare(`UPDATE users SET name=?, updated_at=? WHERE id=?`).run(name, Date.now(), uid);
}
export function setOnboarding(uid: string, data: unknown): void {
  db().prepare(`UPDATE users SET onboarding=?, updated_at=? WHERE id=?`).run(JSON.stringify(data ?? {}), Date.now(), uid);
}
export function countUsers(): number {
  return (db().prepare(`SELECT COUNT(*) n FROM users`).get() as { n: number }).n;
}

// ── sessions ───────────────────────────────────────────────────────────────────
export interface NewSession {
  token: string;
  expiresAt: number;
}
export function createSession(userId: string, ttlMs: number): NewSession {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  const expiresAt = now + ttlMs;
  db().prepare(`INSERT INTO sessions (token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)`).run(sha256(token), userId, now, expiresAt);
  return { token, expiresAt };
}
export function getSessionUser(rawToken: string): User | null {
  if (!rawToken) return null;
  const r = db().prepare(`SELECT user_id, expires_at FROM sessions WHERE token_hash = ?`).get(sha256(rawToken)) as { user_id: string; expires_at: number } | undefined;
  if (!r) return null;
  if (r.expires_at < Date.now()) {
    db().prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(sha256(rawToken));
    return null;
  }
  return findUserById(r.user_id);
}
export function destroySession(rawToken: string): void {
  if (rawToken) db().prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(sha256(rawToken));
}
export function destroyUserSessions(userId: string): void {
  db().prepare(`DELETE FROM sessions WHERE user_id = ?`).run(userId);
}

// ── email-verify / password-reset tokens ──────────────────────────────────────
export function createAuthToken(userId: string, kind: "verify" | "reset", ttlMs: number): string {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  db().prepare(`INSERT INTO auth_tokens (token_hash,user_id,kind,created_at,expires_at) VALUES (?,?,?,?,?)`).run(sha256(token), userId, kind, now, now + ttlMs);
  return token;
}
/** Validate + single-use consume a token. Returns the userId or null. */
export function consumeAuthToken(rawToken: string, kind: "verify" | "reset"): string | null {
  if (!rawToken) return null;
  const h = sha256(rawToken);
  const r = db().prepare(`SELECT user_id, kind, expires_at FROM auth_tokens WHERE token_hash = ?`).get(h) as { user_id: string; kind: string; expires_at: number } | undefined;
  if (!r || r.kind !== kind || r.expires_at < Date.now()) return null;
  db().prepare(`DELETE FROM auth_tokens WHERE token_hash = ?`).run(h);
  return r.user_id;
}

// ── email verification / login codes (6-digit, hashed, single active per purpose) ──
export type CodePurpose = "signup" | "login" | "reset";

// Tunables (exported so the UI/tests can reason about them honestly).
export const CODE_TTL_MS = 10 * 60 * 1000; // a code is valid for 10 minutes
export const CODE_RESEND_COOLDOWN_MS = 45 * 1000; // min gap between sends (anti-spam)
export const CODE_WINDOW_MS = 15 * 60 * 1000; // rolling rate-limit window
export const CODE_MAX_PER_WINDOW = 5; // max sends per window
export const CODE_MAX_ATTEMPTS = 5; // wrong-guess cap before a code is burned

export interface IssueCodeResult {
  ok: boolean;
  /** The plaintext 6-digit code to email — present only when ok. Never persisted. */
  code?: string;
  /** When rate-limited, how long until another send is allowed. */
  retryAfterMs?: number;
}

/**
 * Issue a fresh 6-digit code for (user, purpose). Only the SHA-256 hash is stored.
 * Enforces a per-send cooldown and a rolling-window cap, and invalidates any prior
 * active code for that purpose so only one code is ever live (no reuse of an old one).
 */
export function issueEmailCode(userId: string, purpose: CodePurpose): IssueCodeResult {
  const now = Date.now();
  const recent = db()
    .prepare(`SELECT created_at FROM email_codes WHERE user_id=? AND purpose=? AND created_at > ? ORDER BY created_at DESC`)
    .all(userId, purpose, now - CODE_WINDOW_MS) as { created_at: number }[];
  if (recent.length >= CODE_MAX_PER_WINDOW) {
    const oldest = recent[recent.length - 1].created_at;
    return { ok: false, retryAfterMs: Math.max(0, CODE_WINDOW_MS - (now - oldest)) };
  }
  if (recent.length && now - recent[0].created_at < CODE_RESEND_COOLDOWN_MS) {
    return { ok: false, retryAfterMs: CODE_RESEND_COOLDOWN_MS - (now - recent[0].created_at) };
  }
  db().prepare(`UPDATE email_codes SET consumed=1 WHERE user_id=? AND purpose=? AND consumed=0`).run(userId, purpose);
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  db()
    .prepare(`INSERT INTO email_codes (id,user_id,purpose,code_hash,created_at,expires_at,attempts,consumed) VALUES (?,?,?,?,?,?,0,0)`)
    .run(id("ec_"), userId, purpose, sha256(code), now, now + CODE_TTL_MS);
  return { ok: true, code };
}

export type VerifyCodeResult = "ok" | "invalid" | "expired" | "too_many" | "none";

/**
 * Verify a submitted code for (user, purpose). Single-use: a correct code is burned
 * immediately; a wrong guess increments attempts and burns the code past the cap.
 * Expired codes never match. Constant-time hash comparison.
 */
export function verifyEmailCode(userId: string, purpose: CodePurpose, code: string): VerifyCodeResult {
  const now = Date.now();
  const r = db()
    .prepare(`SELECT id, code_hash, expires_at, attempts FROM email_codes WHERE user_id=? AND purpose=? AND consumed=0 ORDER BY created_at DESC LIMIT 1`)
    .get(userId, purpose) as { id: string; code_hash: string; expires_at: number; attempts: number } | undefined;
  if (!r) return "none";
  if (r.expires_at < now) {
    db().prepare(`UPDATE email_codes SET consumed=1 WHERE id=?`).run(r.id);
    return "expired";
  }
  if (r.attempts >= CODE_MAX_ATTEMPTS) {
    db().prepare(`UPDATE email_codes SET consumed=1 WHERE id=?`).run(r.id);
    return "too_many";
  }
  const provided = sha256(String(code || "").trim());
  const a = Buffer.from(provided);
  const b = Buffer.from(r.code_hash);
  const match = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!match) {
    const attempts = r.attempts + 1;
    db().prepare(`UPDATE email_codes SET attempts=?, consumed=? WHERE id=?`).run(attempts, attempts >= CODE_MAX_ATTEMPTS ? 1 : 0, r.id);
    return "invalid";
  }
  db().prepare(`UPDATE email_codes SET consumed=1 WHERE id=?`).run(r.id);
  return "ok";
}

/** Milliseconds remaining before another code can be sent for (user, purpose). */
export function codeResendCooldownMs(userId: string, purpose: CodePurpose): number {
  const last = db()
    .prepare(`SELECT created_at FROM email_codes WHERE user_id=? AND purpose=? ORDER BY created_at DESC LIMIT 1`)
    .get(userId, purpose) as { created_at: number } | undefined;
  if (!last) return 0;
  return Math.max(0, CODE_RESEND_COOLDOWN_MS - (Date.now() - last.created_at));
}

// ── trusted devices (so a returning browser skips the login code) ──────────────
export const DEVICE_COOKIE = "volo_device";
export const DEVICE_TTL_MS = 180 * 24 * 60 * 60 * 1000; // remember a device for 180 days

/** Mint a device token for a user (stored hashed) and return the raw cookie value. */
export function trustDevice(userId: string): string {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  db().prepare(`INSERT INTO trusted_devices (token_hash,user_id,created_at,last_seen,expires_at) VALUES (?,?,?,?,?)`).run(sha256(token), userId, now, now, now + DEVICE_TTL_MS);
  return token;
}

/** Is this device token a currently-trusted device for this user? Refreshes last_seen. */
export function isDeviceTrusted(userId: string, rawToken: string | undefined): boolean {
  if (!rawToken) return false;
  const h = sha256(rawToken);
  const r = db().prepare(`SELECT user_id, expires_at FROM trusted_devices WHERE token_hash=?`).get(h) as { user_id: string; expires_at: number } | undefined;
  if (!r || r.user_id !== userId || r.expires_at < Date.now()) return false;
  db().prepare(`UPDATE trusted_devices SET last_seen=? WHERE token_hash=?`).run(Date.now(), h);
  return true;
}

// ── linked OAuth accounts (framework; provider creds configured separately) ────
export function linkOAuth(provider: string, providerAccountId: string, userId: string, email?: string): void {
  db()
    .prepare(`INSERT INTO oauth_accounts (provider,provider_account_id,user_id,email,created_at) VALUES (?,?,?,?,?) ON CONFLICT(provider,provider_account_id) DO UPDATE SET user_id=excluded.user_id, email=excluded.email`)
    .run(provider, providerAccountId, userId, email ?? null, Date.now());
}
export function findUserIdByOAuth(provider: string, providerAccountId: string): string | null {
  const r = db().prepare(`SELECT user_id FROM oauth_accounts WHERE provider=? AND provider_account_id=?`).get(provider, providerAccountId) as { user_id: string } | undefined;
  return r?.user_id ?? null;
}
export function listOAuthForUser(userId: string): { provider: string; email?: string; createdAt: number }[] {
  const rows = db().prepare(`SELECT provider,email,created_at FROM oauth_accounts WHERE user_id=?`).all(userId) as { provider: string; email: string | null; created_at: number }[];
  return rows.map((r) => ({ provider: r.provider, email: r.email ?? undefined, createdAt: r.created_at }));
}
export function unlinkOAuth(provider: string, userId: string): void {
  db().prepare(`DELETE FROM oauth_accounts WHERE provider=? AND user_id=?`).run(provider, userId);
}
