// ─────────────────────────────────────────────────────────────────────────────
// Runtime configuration + secret store (server-side only).
//
// Lets a non-technical user configure Volo from the browser instead of editing
// .env. Two stores, kept strictly separate:
//   • config  — non-sensitive settings (provider selection, model name, mode).
//   • secrets — sensitive values (SMTP password), ENCRYPTED AT REST with
//     AES-256-GCM using a locally-generated key file.
//
// SECURITY: this module is server-only. Secrets are NEVER returned to the
// client in the clear, never logged, never put in prompts/model context. The
// client only ever learns whether a secret is set (a boolean) + a mask.
//
// Effective config resolution order: config store → environment variable →
// built-in default. So .env still works, but the UI can override it at runtime.
// ─────────────────────────────────────────────────────────────────────────────

// Server-only by construction (better-sqlite3 + node:crypto/fs cannot run in a browser).
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
    CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS app_secrets (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
  `);
  return _db;
}

// ── local encryption key (generated once, sits next to the DB) ───────────────
function keyPath(): string {
  const abs = path.resolve(process.cwd(), DB_PATH);
  return path.join(path.dirname(abs), "volo.key");
}
let _key: Buffer | null = null;
function encKey(): Buffer {
  if (_key) return _key;
  const p = keyPath();
  try {
    _key = fs.readFileSync(p);
    if (_key.length !== 32) throw new Error("bad key");
  } catch {
    _key = crypto.randomBytes(32);
    fs.writeFileSync(p, _key, { mode: 0o600 });
  }
  return _key;
}

function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}
function decrypt(blob: string): string | null {
  try {
    const [ivB, tagB, dataB] = blob.split(":");
    const decipher = crypto.createDecipheriv("aes-256-gcm", encKey(), Buffer.from(ivB, "base64"));
    decipher.setAuthTag(Buffer.from(tagB, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(dataB, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// ── config (non-sensitive) ───────────────────────────────────────────────────
export function getConfig(key: string): string | undefined {
  const row = db().prepare("SELECT value FROM app_config WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value;
}
export function setConfig(key: string, value: string): void {
  db().prepare("INSERT INTO app_config (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=?, updated_at=?").run(key, value, Date.now(), value, Date.now());
}
export function allConfig(): Record<string, string> {
  const rows = db().prepare("SELECT key, value FROM app_config").all() as { key: string; value: string }[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

// ── secrets (sensitive, encrypted, server-only) ──────────────────────────────
export function setSecret(key: string, value: string): void {
  if (!value) {
    db().prepare("DELETE FROM app_secrets WHERE key = ?").run(key);
    return;
  }
  db().prepare("INSERT INTO app_secrets (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=?, updated_at=?").run(key, encrypt(value), Date.now(), encrypt(value), Date.now());
}
/** Server-only: the decrypted secret. NEVER return this to the client. */
export function getSecret(key: string): string | undefined {
  const row = db().prepare("SELECT value FROM app_secrets WHERE key = ?").get(key) as { value: string } | undefined;
  if (!row) return undefined;
  return decrypt(row.value) ?? undefined;
}
export function hasSecret(key: string): boolean {
  return !!db().prepare("SELECT 1 FROM app_secrets WHERE key = ?").get(key);
}

// ── effective config: store → env → default ──────────────────────────────────
export function cfg(key: string, fallback = ""): string {
  const v = getConfig(key);
  if (v != null && v !== "") return v;
  const env = process.env[key];
  return env != null && env !== "" ? env : fallback;
}

/** Effective secret: config-store secret → env var (for .env users). */
export function secret(key: string): string {
  const s = getSecret(key);
  if (s) return s;
  return process.env[key] || "";
}

/** Is a secret configured via EITHER the store or an env var? */
export function secretConfigured(key: string): boolean {
  return hasSecret(key) || !!process.env[key];
}
