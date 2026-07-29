// Password hashing with scrypt (Node's built-in — zero dependencies, memory-hard).
// Never store plaintext; never log passwords. Verification is constant-time.

import crypto from "node:crypto";

const KEYLEN = 64;
const COST = { N: 16384, r: 8, p: 1 }; // OWASP-ish scrypt params

/** Hash a password → "scrypt$<saltB64>$<hashB64>". */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, KEYLEN, COST);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

/** Constant-time verification. Returns false on any malformed input. */
export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [algo, saltB64, hashB64] = (stored || "").split("$");
    if (algo !== "scrypt" || !saltB64 || !hashB64) return false;
    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(hashB64, "base64");
    const actual = crypto.scryptSync(password, salt, expected.length, COST);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** Basic strength check (kept simple + honest; enforced at signup). */
export function passwordIssue(password: string): string | null {
  if (typeof password !== "string" || password.length < 8) return "Use at least 8 characters.";
  if (password.length > 200) return "That password is too long.";
  return null;
}
