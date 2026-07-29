// Authentication + PER-USER DATA ISOLATION tests.
//
// Runs against an ISOLATED temp SQLite DB. Proves: password hashing (salted,
// constant-time), sessions (create/resolve/expire/destroy), single-use tokens,
// and — critically — that NO task/config/secret leaks between accounts, and that
// authenticated users never inherit the host's environment secrets.
//
// Run: node scripts/test-auth.mjs   (wired into `npm test`)

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import Database from "better-sqlite3";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Isolated temp DB — set BEFORE loading modules (they read the path at load time).
const tmp = path.join(root, ".data", `test-auth-${Date.now()}-${Math.floor(Math.random() * 1e6)}.db`);
process.env.VOLO_DB_PATH = tmp;

function loadTs(rel, shims = {}) {
  const src = fs.readFileSync(path.join(root, rel), "utf8");
  const js = ts.transpileModule(src, { compilerOptions: { module: "commonjs", target: "es2020", esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", "require", js)(mod, mod.exports, (id) => (id in shims ? shims[id] : require(id)));
  return mod.exports;
}

const context = loadTs("src/lib/auth/context.ts");
const passwords = loadTs("src/lib/auth/passwords.ts");
const authStore = loadTs("src/lib/auth/store.ts");
const store = loadTs("src/lib/store.ts", { "./auth/context": context, "./types": {} });
const config = loadTs("src/lib/config/index.ts", { "@/lib/auth/context": context, "@/lib/types": {} });
const emailPolicy = loadTs("src/lib/auth/email-policy.ts");

let pass = 0, fail = 0;
const check = (n, c, e = "") => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

function main() {
  console.log("Passwords (scrypt):");
  const h = passwords.hashPassword("correct horse battery staple");
  check("hash verifies the right password", passwords.verifyPassword("correct horse battery staple", h));
  check("wrong password is rejected", !passwords.verifyPassword("nope", h));
  check("malformed stored hash is rejected", !passwords.verifyPassword("x", "garbage"));
  check("weak password is flagged", !!passwords.passwordIssue("short"));
  check("strong password passes", passwords.passwordIssue("longenough123") === null);
  check("hashes are salted (two differ)", passwords.hashPassword("a") !== passwords.hashPassword("a"));

  console.log("User context:");
  check("default scope outside a request", context.currentUserId() === context.DEFAULT_USER);
  check("runWithUser sets the scope", context.runWithUser("u_A", () => context.currentUserId()) === "u_A");

  console.log("Accounts, sessions & tokens:");
  const uA = authStore.createUser({ email: "a@x.com", name: "Alice", passwordHash: h });
  const uB = authStore.createUser({ email: "b@x.com", name: "Bob", passwordHash: h });
  check("createUser + findUserByEmail", authStore.findUserByEmail("a@x.com")?.id === uA.id);
  check("email lookup is case-insensitive", authStore.findUserByEmail("A@X.com")?.id === uA.id);
  const sess = authStore.createSession(uA.id, 60_000);
  check("session token resolves to its user", authStore.getSessionUser(sess.token)?.id === uA.id);
  check("an unknown token resolves to nobody", authStore.getSessionUser("bogus-token") === null);
  authStore.destroySession(sess.token);
  check("a destroyed session is dead", authStore.getSessionUser(sess.token) === null);
  const expired = authStore.createSession(uB.id, -1);
  check("an expired session is dead", authStore.getSessionUser(expired.token) === null);
  const vt = authStore.createAuthToken(uA.id, "verify", 60_000);
  check("verify token is single-use", authStore.consumeAuthToken(vt, "verify") === uA.id && authStore.consumeAuthToken(vt, "verify") === null);
  check("a reset token can't be used as verify", authStore.consumeAuthToken(authStore.createAuthToken(uA.id, "reset", 60_000), "verify") === null);

  console.log("Email verification codes (hashed, single-use, expiring, rate-limited):");
  const raw = new Database(tmp);
  const uC = authStore.createUser({ email: "c@x.com", passwordHash: h });
  const wrongOf = (code) => String((Number(code) + 1) % 1_000_000).padStart(6, "0");

  const iss = authStore.issueEmailCode(uC.id, "signup");
  check("issue returns ok + a fresh 6-digit code", iss.ok && /^\d{6}$/.test(iss.code || ""));
  // The plaintext code is never stored — only its hash.
  const storedHash = raw.prepare("SELECT code_hash FROM email_codes WHERE user_id=? AND purpose='signup' ORDER BY created_at DESC LIMIT 1").get(uC.id).code_hash;
  check("only the code HASH is persisted (never plaintext)", typeof storedHash === "string" && storedHash.length === 64 && !storedHash.includes(iss.code));
  check("a wrong code → invalid", authStore.verifyEmailCode(uC.id, "signup", wrongOf(iss.code)) === "invalid");
  check("the correct code → ok", authStore.verifyEmailCode(uC.id, "signup", iss.code) === "ok");
  check("replaying a used code → none (single-use)", authStore.verifyEmailCode(uC.id, "signup", iss.code) === "none");

  // Expiry (backdate the row so the clock check trips).
  const exp = authStore.issueEmailCode(uC.id, "reset");
  raw.prepare("UPDATE email_codes SET expires_at=? WHERE user_id=? AND purpose='reset' AND consumed=0").run(Date.now() - 1000, uC.id);
  check("an expired code → expired (never matches)", authStore.verifyEmailCode(uC.id, "reset", exp.code) === "expired");

  // Resend cooldown.
  const first = authStore.issueEmailCode(uC.id, "login");
  check("first login code issues ok", first.ok);
  const second = authStore.issueEmailCode(uC.id, "login");
  check("an immediate re-issue is blocked by the cooldown", !second.ok && second.retryAfterMs > 0);
  check("codeResendCooldownMs reports remaining cooldown", authStore.codeResendCooldownMs(uC.id, "login") > 0);

  // Attempt cap — a code is burned after too many wrong guesses.
  const uD = authStore.createUser({ email: "d@x.com", passwordHash: h });
  const cap = authStore.issueEmailCode(uD.id, "signup");
  for (let i = 0; i < authStore.CODE_MAX_ATTEMPTS; i++) authStore.verifyEmailCode(uD.id, "signup", wrongOf(cap.code));
  check("code is burned after the attempt cap (correct code no longer works)", authStore.verifyEmailCode(uD.id, "signup", cap.code) === "none");

  // Rolling-window cap — backdate each issue past the cooldown but within the window.
  const uE = authStore.createUser({ email: "e@x.com", passwordHash: h });
  let lastOk = true;
  for (let i = 0; i < authStore.CODE_MAX_PER_WINDOW; i++) {
    lastOk = authStore.issueEmailCode(uE.id, "login").ok;
    raw.prepare("UPDATE email_codes SET created_at=created_at-? WHERE user_id=? AND purpose='login'").run(authStore.CODE_RESEND_COOLDOWN_MS + 1000, uE.id);
  }
  check("issues succeed up to the window cap", lastOk);
  const over = authStore.issueEmailCode(uE.id, "login");
  check("exceeding the rolling-window cap is blocked", !over.ok && over.retryAfterMs > 0);

  // Purpose isolation — a code for one purpose can't verify another.
  const uF = authStore.createUser({ email: "f@x.com", passwordHash: h });
  const sc = authStore.issueEmailCode(uF.id, "signup");
  authStore.issueEmailCode(uF.id, "login");
  check("a signup code does NOT verify under 'login'", authStore.verifyEmailCode(uF.id, "login", sc.code) !== "ok");
  check("the signup code still verifies under 'signup'", authStore.verifyEmailCode(uF.id, "signup", sc.code) === "ok");

  console.log("Trusted devices (skip the login code on a known browser):");
  const dTok = authStore.trustDevice(uC.id);
  check("a trusted device is recognized", authStore.isDeviceTrusted(uC.id, dTok) === true);
  check("another user's device token is rejected", authStore.isDeviceTrusted(uD.id, dTok) === false);
  check("a bogus device token is rejected", authStore.isDeviceTrusted(uC.id, "nope") === false);
  check("a missing device token is rejected", authStore.isDeviceTrusted(uC.id, undefined) === false);
  raw.close();

  console.log("Email policy (Microsoft blocked; every other provider allowed):");
  check("outlook.com is blocked with a clear message", emailPolicy.isMicrosoftEmail("a@outlook.com") && !!emailPolicy.emailPolicyIssue("a@outlook.com"));
  check("hotmail.com is blocked", !!emailPolicy.emailPolicyIssue("a@hotmail.com"));
  check("live.com is blocked", !!emailPolicy.emailPolicyIssue("a@live.com"));
  check("msn.com is blocked", !!emailPolicy.emailPolicyIssue("a@msn.com"));
  check("*.onmicrosoft.com tenants are blocked", emailPolicy.isMicrosoftEmail("a@contoso.onmicrosoft.com"));
  check("gmail.com is allowed", emailPolicy.emailPolicyIssue("a@gmail.com") === null);
  check("yahoo.com is allowed (not Gmail-only)", emailPolicy.emailPolicyIssue("a@yahoo.com") === null);
  check("a custom domain is allowed", emailPolicy.emailPolicyIssue("a@acme.dev") === null);

  console.log("Email templates (branded, code + expiry + text fallback):");
  const et = loadTs("src/lib/auth/email-templates.ts");
  const built = et.verifyCodeEmail({ logoUrl: "https://app/volo-mark.png", code: "123456", ttlMs: 10 * 60 * 1000, verifyUrl: "https://app/verify" });
  check("subject carries the code", built.subject.includes("123456"));
  check("html embeds the Volo logo + wordmark", built.html.includes("volo-mark.png") && built.html.includes(">volo<"));
  check("html shows the code and its expiry", built.html.includes("123456") && /expires in 10 minutes/i.test(built.html));
  check("plain-text fallback includes the code", built.text.includes("123456"));
  check("login-code email carries a security notice", /security notice/i.test(et.loginCodeEmail({ logoUrl: "x", code: "111111", ttlMs: 6e5 }).html));
  check("already-registered email links to sign-in (anti-enumeration)", et.alreadyRegisteredEmail({ logoUrl: "x", signinUrl: "https://app/login" }).html.includes("https://app/login"));

  console.log("Per-user data isolation (no cross-account leak):");
  const taskA = { id: "task_a1", objective: "Alice's private objective", title: "A", status: "understanding", createdAt: 1, updatedAt: 1, constraints: { outcome: "answer", entityLabel: "x", domain: "general", keywords: [], requirements: [] }, plan: [], sources: [], results: [], timeline: [], approvals: [] };
  context.runWithUser(uA.id, () => store.saveTask(taskA));
  check("owner can read their task", context.runWithUser(uA.id, () => store.getTask("task_a1"))?.objective === "Alice's private objective");
  check("another user CANNOT read it (isolation)", context.runWithUser(uB.id, () => store.getTask("task_a1")) === null);
  check("listTasks is scoped — other user sees none", context.runWithUser(uB.id, () => store.listTasks(10)).length === 0);
  check("listTasks — owner sees their own", context.runWithUser(uA.id, () => store.listTasks(10)).length === 1);
  check("deleteTask cannot delete another user's task", (() => { context.runWithUser(uB.id, () => store.deleteTask("task_a1")); return context.runWithUser(uA.id, () => store.getTask("task_a1")) !== null; })());

  console.log("Per-user config + secrets (encrypted, isolated):");
  context.runWithUser(uA.id, () => config.setSecret("SMTP_PASS", "alice-app-password"));
  check("owner reads their secret", context.runWithUser(uA.id, () => config.getSecret("SMTP_PASS")) === "alice-app-password");
  check("secret does NOT leak to another user", context.runWithUser(uB.id, () => config.getSecret("SMTP_PASS")) === undefined);
  check("hasSecret is scoped", context.runWithUser(uB.id, () => config.hasSecret("SMTP_PASS")) === false);
  context.runWithUser(uA.id, () => config.setConfig("MODEL_PROVIDER", "ollama"));
  check("config is per-user", context.runWithUser(uB.id, () => config.getConfig("MODEL_PROVIDER")) === undefined);

  console.log("Environment-secret gating (real users never inherit host env secrets):");
  process.env.STRIPE_SECRET_KEY = "sk_test_from_env";
  check("an authenticated user does NOT inherit an env secret", context.runWithUser(uA.id, () => config.secret("STRIPE_SECRET_KEY")) === "");
  check("only the local/default scope may use an env secret", context.runWithUser(context.DEFAULT_USER, () => config.secret("STRIPE_SECRET_KEY")) === "sk_test_from_env");

  console.log(`\n${pass} passed, ${fail} failed`);
}

try {
  main();
} finally {
  for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
}
if (fail > 0) process.exit(1);
