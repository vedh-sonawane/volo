// OAuth + integrations framework tests. Runs against an ISOLATED temp DB with a
// stubbed HTTP transport. Proves: provider registry + missing-credential honesty,
// PKCE, state/CSRF validation, authorize-URL building, token exchange/refresh,
// ENCRYPTED-at-rest token storage, per-user isolation, disconnect, expired-token
// refresh, and a real Gmail send (mocked) enabled by a connected integration.
//
// Run: node scripts/test-oauth.mjs   (wired into `npm test`)

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import Database from "better-sqlite3";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tmp = path.join(root, ".data", `test-oauth-${Date.now()}-${Math.floor(Math.random() * 1e6)}.db`);
process.env.VOLO_DB_PATH = tmp;
process.env.GOOGLE_CLIENT_ID = "gid.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "gsecret";
delete process.env.GITHUB_CLIENT_ID; // keep GitHub app-unconfigured for the honesty test
delete process.env.GITHUB_CLIENT_SECRET;

function loadTs(rel, shims = {}) {
  const src = fs.readFileSync(path.join(root, rel), "utf8");
  const js = ts.transpileModule(src, { compilerOptions: { module: "commonjs", target: "es2020", esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", "require", js)(mod, mod.exports, (id) => (id in shims ? shims[id] : require(id)));
  return mod.exports;
}

const context = loadTs("src/lib/auth/context.ts");
const config = loadTs("src/lib/config/index.ts", { "@/lib/auth/context": context, "@/lib/types": {} });
const providers = loadTs("src/lib/auth/oauth/providers.ts");
const flow = loadTs("src/lib/auth/oauth/flow.ts", { "@/lib/config": config, "./providers": providers });
const integrations = loadTs("src/lib/auth/integrations.ts", { "@/lib/config": config, "./oauth/providers": providers, "./oauth/flow": flow });
const gmail = loadTs("src/lib/actions/gmail.ts", { "@/lib/types": {}, "./types": {}, "@/lib/auth/context": context, "@/lib/auth/integrations": integrations });

let pass = 0, fail = 0;
const check = (n, c, e = "") => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

// stub fetch
let fetchHandler = () => resp(200, {});
function resp(status, body) { return { ok: status >= 200 && status < 300, status, async json() { return body; } }; }
globalThis.fetch = async (url, init) => fetchHandler(String(url), init);

async function main() {
  console.log("Provider registry + missing-credential honesty:");
  check("known provider resolves", providers.getProvider("google")?.id === "google");
  check("unknown provider → null", providers.getProvider("nope") === null);
  check("configured when env creds present (Google)", providers.providerConfigured(providers.getProvider("google")) === true);
  check("NOT configured without creds (GitHub) — no pretending", providers.providerConfigured(providers.getProvider("github")) === false);
  check("Microsoft provider fully removed", providers.getProvider("microsoft") === null && !("microsoft" in providers.OAUTH_PROVIDERS));

  console.log("PKCE + authorize URL:");
  const pkce = flow.makePkce();
  check("PKCE verifier + challenge generated", pkce.verifier.length > 20 && pkce.challenge.length > 20 && pkce.verifier !== pkce.challenge);
  const authUrl = flow.buildAuthorizeUrl(providers.getProvider("google"), { redirectUri: "https://app/cb", scopes: ["openid", "https://www.googleapis.com/auth/gmail.send"], state: "st8", challenge: pkce.challenge });
  check("authorize URL carries client_id, redirect, scope, state", authUrl.includes("client_id=gid") && authUrl.includes("redirect_uri=https%3A%2F%2Fapp%2Fcb") && authUrl.includes("state=st8") && authUrl.includes("gmail.send"));
  check("authorize URL includes PKCE challenge + offline access", authUrl.includes("code_challenge=") && authUrl.includes("code_challenge_method=S256") && authUrl.includes("access_type=offline"));

  console.log("State / CSRF validation:");
  const { cookie, state } = flow.packState({ n: "nonce123", provider: "google", mode: "connect", redirectUri: "https://app/cb", next: "/settings" });
  check("valid cookie + matching state → accepted", flow.unpackState(cookie, state)?.provider === "google");
  check("WRONG state (CSRF) → rejected", flow.unpackState(cookie, "attacker") === null);
  check("tampered cookie → rejected", flow.unpackState(cookie + "AA", state) === null);
  check("missing cookie/state → rejected", flow.unpackState(undefined, state) === null && flow.unpackState(cookie, undefined) === null);
  const expired = config.encryptValue(JSON.stringify({ n: "x", provider: "google", mode: "connect", redirectUri: "u", next: "/", exp: Date.now() - 1000 }));
  check("expired state → rejected", flow.unpackState(expired, "x") === null);

  console.log("Token exchange + refresh (transport mocked):");
  fetchHandler = () => resp(200, { access_token: "at_1", refresh_token: "rt_1", expires_in: 3600, scope: "openid https://www.googleapis.com/auth/gmail.send" });
  const tok = await flow.exchangeCode(providers.getProvider("google"), { code: "code", redirectUri: "https://app/cb", verifier: pkce.verifier });
  check("exchange returns access + refresh + expiry", tok.accessToken === "at_1" && tok.refreshToken === "rt_1" && tok.expiresAt > Date.now());
  fetchHandler = () => resp(400, { error: "invalid_grant", error_description: "bad code" });
  let threw = false; try { await flow.exchangeCode(providers.getProvider("google"), { code: "x", redirectUri: "u" }); } catch { threw = true; }
  check("failed exchange throws (never a fake token)", threw);

  console.log("Integration storage — encrypted, isolated, token-free UI view:");
  const A = "u_alice", B = "u_bob";
  integrations.upsertIntegration(A, "google", { accessToken: "at_secret", refreshToken: "rt_secret", expiresAt: Date.now() + 3600_000, scopes: ["https://www.googleapis.com/auth/gmail.send"], accountId: "acc_a", email: "alice@x.com" });
  const metaA = integrations.getIntegrationMeta(A, "google");
  check("meta returns scopes/email but NO tokens", metaA?.email === "alice@x.com" && metaA.scopes.includes("https://www.googleapis.com/auth/gmail.send") && !("accessToken" in metaA));
  check("scope check works", integrations.integrationHasScope(A, "google", "https://www.googleapis.com/auth/gmail.send") === true);
  check("another user does NOT see it (isolation)", integrations.getIntegrationMeta(B, "google") === null);
  check("listIntegrations is per-user", integrations.listIntegrations(A).length === 1 && integrations.listIntegrations(B).length === 0);
  // tokens are encrypted at rest
  const raw = new Database(tmp).prepare("SELECT credentials FROM user_integrations WHERE user_id=? AND provider=?").get(A, "google");
  check("tokens are ENCRYPTED at rest (not plaintext)", typeof raw.credentials === "string" && !raw.credentials.includes("at_secret") && !raw.credentials.includes("rt_secret"));

  console.log("Access token retrieval + expired refresh:");
  check("fresh token returned as-is", (await integrations.getAccessToken(A, "google")) === "at_secret");
  // expire it, provide refresh → should call refresh and return a new token
  integrations.upsertIntegration(A, "google", { accessToken: "at_old", refreshToken: "rt_secret", expiresAt: Date.now() - 1000, scopes: ["https://www.googleapis.com/auth/gmail.send"], accountId: "acc_a", email: "alice@x.com" });
  fetchHandler = () => resp(200, { access_token: "at_refreshed", expires_in: 3600 });
  check("expired token is refreshed transparently", (await integrations.getAccessToken(A, "google")) === "at_refreshed");
  check("refresh persisted the new token", (await integrations.getAccessToken(A, "google")) === "at_refreshed");

  console.log("Disconnect:");
  integrations.deleteIntegration(A, "google");
  check("disconnect removes the integration", integrations.getIntegrationMeta(A, "google") === null);
  check("after disconnect, no access token", (await integrations.getAccessToken(A, "google")) === null);

  console.log("Gmail send (real API shape, mocked) enabled by the integration:");
  // No integration → not configured for this user scope.
  check("no Gmail connection → gmailConfigured false", context.runWithUser("u_none", () => gmail.gmailConfigured()) === false);
  integrations.upsertIntegration("u_g", "google", { accessToken: "at_g", refreshToken: "rt_g", expiresAt: Date.now() + 3600_000, scopes: ["https://www.googleapis.com/auth/gmail.send"], accountId: "acc_g", email: "g@x.com" });
  check("connected Gmail → gmailConfigured true", context.runWithUser("u_g", () => gmail.gmailConfigured()) === true);
  const send = new gmail.GmailSendAction();
  let sentReq = null;
  fetchHandler = (url, init) => { sentReq = { url, init }; return resp(200, { id: "msg_123" }); };
  const r = await context.runWithUser("u_g", () => send.execute({ capability: "send_email", target: "bob@x.com", summary: "", payload: { subject: "Hi", body: "Hello" }, idempotencyKey: "k" }));
  check("Gmail send → succeeded (real, mode live)", r.status === "succeeded" && r.mode === "live" && r.confirmation === "msg_123", JSON.stringify(r));
  check("uses the user's access token in the Authorization header", sentReq.init.headers.Authorization === "Bearer at_g");
  check("posts to the Gmail send endpoint", sentReq.url.includes("gmail.googleapis.com/gmail/v1/users/me/messages/send"));
  // token missing → honest requires_user, never a fake success
  fetchHandler = () => resp(200, {});
  const r2 = await context.runWithUser("u_none", () => send.execute({ capability: "send_email", target: "bob@x.com", summary: "", payload: { subject: "Hi", body: "Hello" }, idempotencyKey: "k2" }));
  check("no token → requires_user (never fake success)", r2.status === "requires_user");

  console.log("GitHub capability scope upgrade (the reported bug — key ≠ scope):");
  // Mirror the callback's additive merge: existing ∪ newly granted (parsed from the
  // provider's scope string, which GitHub returns comma-separated).
  function simulateConnect(userId, providerId, tokenScope) {
    const granted = tokenScope.split(/[\s,]+/).filter(Boolean);
    const existing = integrations.getIntegrationMeta(userId, providerId)?.scopes ?? [];
    const merged = Array.from(new Set([...existing, ...granted]));
    integrations.upsertIntegration(userId, providerId, { accessToken: "at", refreshToken: "rt", expiresAt: Date.now() + 3600_000, scopes: merged, accountId: "acc", email: "u@x.com" });
    return merged;
  }
  const gh = providers.getProvider("github");
  const U = "u_gh";
  // 1. connect GitHub identity
  simulateConnect(U, "github", "read:user,user:email");
  check("GitHub connected after identity connect", !!integrations.getIntegrationMeta(U, "github"));
  check("repos NOT granted on identity-only connect", providers.isScopeGroupGranted(gh, "repos", integrations.getIntegrationMeta(U, "github").scopes) === false);
  // 2. upgrade to repository access (GitHub returns comma-separated cumulative scopes)
  const afterRepo = simulateConnect(U, "github", "read:user,user:email,repo");
  check("repo scope persisted (comma-separated parsed)", afterRepo.includes("repo"));
  check("repos group NOW granted after upgrade", providers.isScopeGroupGranted(gh, "repos", afterRepo) === true);
  // 3. issues capability is also 'repo'-backed → granted by the same grant
  check("issues group granted (shares the repo scope)", providers.isScopeGroupGranted(gh, "issues", afterRepo) === true);
  // 4. the OLD key-substring heuristic ("repo".includes("repos")) was the bug — guard it
  check("regression guard: old key-substring heuristic WOULD have missed it", afterRepo.some((s) => s.toLowerCase().includes("repos")) === false);
  // additive: identity scopes retained through the capability upgrade (never dropped)
  check("identity scopes retained after upgrade (additive, not replaced)", afterRepo.includes("read:user") && afterRepo.includes("user:email"));
  // segment-matching robustness across providers
  check("Google gmail group granted from full-URI scope", providers.isScopeGroupGranted(providers.getProvider("google"), "gmail", ["https://www.googleapis.com/auth/gmail.send"]) === true);
  check("Google calendar group granted from full-URI scope", providers.isScopeGroupGranted(providers.getProvider("google"), "calendar", ["https://www.googleapis.com/auth/calendar.events"]) === true);
  check("unconnected user → group not granted (honest)", providers.isScopeGroupGranted(gh, "repos", []) === false);

  console.log("Generic external data-read (GitHub repos — real API, no hallucination):");
  const dataReads = loadTs("src/lib/integrations/data-reads.ts", { "@/lib/auth/oauth/providers": providers, "@/lib/auth/integrations": integrations });
  const repoRead = dataReads.detectDataRead("read all my repos and tell me their names in github");
  check("intent 'read all my repos … in github' → github.repos", repoRead?.id === "github.repos");
  check("intent 'list my github' → github.repos", dataReads.detectDataRead("list my github")?.id === "github.repos");
  check("intent 'show my github projects' → github.repos", dataReads.detectDataRead("show my github projects")?.id === "github.repos");
  check("creative ask 'write a haiku about the ocean' → no data-read (stays direct answer)", dataReads.detectDataRead("write a haiku about the ocean") === null);
  // GitHub disconnected → connection required (must NOT answer from model memory)
  check("GitHub disconnected → dataReadConnected false (explain-connect path)", dataReads.dataReadConnected(repoRead, "u_no_github") === false);
  // U connected GitHub with the repo scope in the block above
  check("GitHub connected + repo scope → dataReadConnected true", dataReads.dataReadConnected(repoRead, U) === true);
  // Real API fetch — items are EXACTLY what the API returned (nothing invented)
  let readUrl = "";
  fetchHandler = (url) => { readUrl = String(url); return resp(200, [
    { full_name: "vedh/alpha", html_url: "https://github.com/vedh/alpha", private: false },
    { full_name: "vedh/secret", html_url: "https://github.com/vedh/secret", private: true },
  ]); };
  const fetched = await repoRead.run("tok_x");
  check("calls the GitHub /user/repos endpoint", readUrl.includes("api.github.com/user/repos"));
  check("returns EXACTLY the real repos (no hallucinated entries)", fetched.items.length === 2 && fetched.items[0].title === "vedh/alpha" && fetched.items[1].title === "vedh/secret");
  check("private/public qualifier preserved from the API", fetched.items[0].sub === "public" && fetched.items[1].sub === "private");
  check("records the real API url as the source trace", fetched.sourceUrl.includes("api.github.com/user/repos"));
  // API error → throws (never fabricates a list)
  fetchHandler = () => resp(401, { message: "Bad credentials" });
  let readThrew = false; try { await repoRead.run("tok_x"); } catch { readThrew = true; }
  check("GitHub API error → throws (never fabricates repositories)", readThrew);

  console.log(`\n${pass} passed, ${fail} failed`);
}

try {
  await main();
} finally {
  for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
}
if (fail > 0) process.exit(1);
