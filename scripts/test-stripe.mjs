// Tests for the REAL Stripe integration in TEST MODE (free, no real money).
//
// Drives the actual StripeTestPaymentAction with a STUBBED global fetch + a
// configurable test secret key, so every path is deterministic and offline:
//   • only test keys are accepted; a LIVE key is refused (no real money, ever),
//   • success → real PaymentIntent confirmation, flagged test/no-real-money,
//   • decline / requires-action / timeout handled honestly,
//   • the secret key is sent only in the Authorization header (never elsewhere),
//   • idempotency key + amount(cents) + lowercased currency are correct,
//   • placeholder target and missing quote are refused (safety intact).
//
// Run: node scripts/test-stripe.mjs   (wired into `npm test`)

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function loadTs(rel, shims) {
  const src = fs.readFileSync(path.join(root, rel), "utf8");
  const js = ts.transpileModule(src, { compilerOptions: { module: "commonjs", target: "es2020" } }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", "require", js)(mod, mod.exports, (id) => {
    if (shims[id]) return shims[id];
    throw new Error(`unexpected import: ${id}`);
  });
  return mod.exports;
}

// Configurable secret key + a stubbed Stripe HTTP layer.
let KEY = "sk_test_abc123";
const configShim = { secret: (k) => (k === "STRIPE_SECRET_KEY" ? KEY : "") };
const stripe = loadTs("src/lib/actions/stripe.ts", { "@/lib/types": {}, "./types": {}, "@/lib/config": configShim });
const { StripeTestPaymentAction, stripeTestConfigured, stripeKeyIsLive } = stripe;

let lastReq = null;
let mode = "succeeded"; // succeeded | declined | requires_action | timeout | neterr
function setFetch() {
  globalThis.fetch = async (url, init) => {
    lastReq = { url: String(url), init };
    if (mode === "timeout") { const e = new Error("aborted"); e.name = "AbortError"; throw e; }
    if (mode === "neterr") throw new Error("ECONNREFUSED");
    if (mode === "declined") return resp(402, { error: { message: "Your card was declined.", type: "card_error", decline_code: "generic_decline" } });
    if (mode === "requires_action") return resp(200, { id: "pi_test_ra", status: "requires_action" });
    return resp(200, { id: "pi_test_ok", status: "succeeded" });
  };
}
function resp(status, body) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}
const bodyParams = () => new URLSearchParams(lastReq.init.body);

let pass = 0, fail = 0;
const check = (n, c, e = "") => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

const input = (over) => ({ capability: "payment", target: "sandbox://bob", summary: "Pay Bob", payload: {}, idempotencyKey: "task_x:a_1", financial: { total: 50, currency: "USD" }, ...over });

async function main() {
  setFetch();
  const provider = new StripeTestPaymentAction();

  console.log("Stripe config + safety:");
  KEY = "sk_test_abc123";
  check("test key → configured", stripeTestConfigured() === true);
  check("test key → provider available", (await provider.available()) === true);
  KEY = "sk_live_danger";
  check("LIVE key → NOT treated as configured", stripeTestConfigured() === false);
  check("LIVE key detected", stripeKeyIsLive() === true);
  check("validate REFUSES a live key (no real money, ever)", provider.validate(input()).ok === false);
  KEY = "";
  check("no key → not configured", stripeTestConfigured() === false);

  KEY = "sk_test_abc123";
  check("validate refuses a placeholder target", provider.validate(input({ target: "[add target]" })).ok === false);
  check("validate refuses a payment with no quote", provider.validate(input({ financial: undefined })).ok === false);
  check("validate accepts a real target + quote", provider.validate(input()).ok === true);

  console.log("Stripe TEST execution (real API shape, mocked transport):");

  // (1) Success → real PaymentIntent, clearly test-mode / no real money.
  mode = "succeeded"; lastReq = null;
  let r = await provider.execute(input());
  check("success → status succeeded", r.status === "succeeded", JSON.stringify(r));
  check("flagged mode=test and simulated (no real money)", r.mode === "test" && r.simulated === true);
  check("carries the real PaymentIntent id as confirmation", r.confirmation === "pi_test_ok");
  check("message says NO real money moved", /no real money/i.test(r.message));

  // Request shape: auth header carries the key; nothing else leaks it.
  check("hits the Stripe payment_intents endpoint", lastReq.url.includes("api.stripe.com/v1/payment_intents"));
  check("secret key sent ONLY in the Authorization header", lastReq.init.headers.Authorization === "Bearer sk_test_abc123");
  check("key is not in the request body", !lastReq.init.body.includes("sk_test_"));
  check("idempotency key set (at-most-once)", lastReq.init.headers["Idempotency-Key"] === "task_x:a_1");
  check("amount is in minor units (cents): $50 → 5000", bodyParams().get("amount") === "5000");
  check("currency lowercased", bodyParams().get("currency") === "usd");
  check("uses a Stripe TEST card (no raw card data)", bodyParams().get("payment_method") === "pm_card_visa");
  check("confirmed immediately", bodyParams().get("confirm") === "true");

  // Zero-decimal currency (JPY) is NOT multiplied by 100.
  mode = "succeeded";
  await provider.execute(input({ financial: { total: 500, currency: "JPY" } }));
  check("zero-decimal currency (JPY) amount not ×100", bodyParams().get("amount") === "500" && bodyParams().get("currency") === "jpy");

  // (2) Decline → failed, honest, no real money. (Chooses a declining test card.)
  mode = "declined";
  r = await provider.execute(input({ summary: "Pay Bob (decline test)" }));
  check("decline → status failed", r.status === "failed", JSON.stringify(r));
  check("decline uses a declining TEST card", bodyParams().get("payment_method") === "pm_card_chargeDeclined");
  check("decline surfaces Stripe's reason + no real money", /declined/i.test(r.message) && /no real money/i.test(r.message));

  // (3) requires_action → requires_user (never claims success).
  mode = "requires_action";
  r = await provider.execute(input({ summary: "Pay with 3ds auth" }));
  check("requires_action → requires_user", r.status === "requires_user" && r.mode === "test");

  // (4) Timeout → uncertain (never auto-retried, never claimed).
  mode = "timeout";
  r = await provider.execute(input());
  check("timeout → uncertain", r.status === "uncertain" && r.mode === "test");

  // (5) Network error → failed, honest.
  mode = "neterr";
  r = await provider.execute(input());
  check("network error → failed (no real money)", r.status === "failed" && /no real money/i.test(r.message));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
