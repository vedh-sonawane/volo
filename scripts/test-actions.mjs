// Deterministic tests for the real-action execution pipeline (Phase 10 hardening).
//
// Exercises the ACTUAL executeAction orchestration + providers (not a bypass),
// via the sandbox provider, covering: success, failure, timeout→uncertain,
// auth-required, idempotency (no duplicate execution), placeholder-target block,
// financial-quote requirement, and the honest "unsupported" path.
//
// Run: node scripts/test-actions.mjs   (also wired as `npm test`)

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Minimal module loader that transpiles a TS file and resolves its imports
// against provided shims / other transpiled modules.
function loadTs(rel, shims) {
  const abs = path.join(root, rel);
  const src = fs.readFileSync(abs, "utf8");
  const js = ts.transpileModule(src, { compilerOptions: { module: "commonjs", target: "es2020" } }).outputText;
  const mod = { exports: {} };
  const req = (id) => {
    if (shims[id]) return shims[id];
    throw new Error(`unexpected import: ${id}`);
  };
  new Function("module", "exports", "require", js)(mod, mod.exports, req);
  return mod.exports;
}

const shimTypes = {}; // type-only module
const shimEmail = { getEmailProvider: () => ({ name: "local-draft", available: async () => false, send: async () => ({ sent: false, message: "stub" }) }) };
const shimDraft = { draftEmail: (m) => ({ ...m, eml: "EML" }) };
const shimIcs = { makeIcs: () => "BEGIN:VCALENDAR\r\nEND:VCALENDAR" };

const providers = loadTs("src/lib/actions/providers.ts", {
  "@/lib/types": shimTypes,
  "@/lib/providers/email": shimEmail,
  "@/lib/tools/email-draft": shimDraft,
  "@/lib/tools/ics": shimIcs,
  "./types": shimTypes,
});
const shimConfig = { cfg: (k, f = "") => process.env[k] || f, secret: () => "" };
const actions = loadTs("src/lib/actions/index.ts", {
  "@/lib/types": shimTypes,
  "@/lib/providers/email": shimEmail,
  "@/lib/config": shimConfig,
  "./providers": providers,
  "./types": shimTypes,
  // No Stripe key in these tests → the payment path uses sandbox/unsupported.
  "./stripe": { StripeTestPaymentAction: class {}, stripeTestConfigured: () => false },
});
const { executeAction } = actions;

let pass = 0;
let fail = 0;
function check(name, cond, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} ${extra}`);
  }
}

function mkInput(over) {
  return { capability: "book", target: "venue@example.org", summary: "Book the venue", payload: {}, idempotencyKey: "t1:a1", financial: { total: 5000, currency: "CAD" }, ...over };
}

async function main() {
  process.env.ACTION_MODE = "sandbox";

  console.log("Real-action execution pipeline (sandbox):");

  // 1. success
  let task = { executedActions: {} };
  let r = await executeAction(task, mkInput({ idempotencyKey: "t:success" }));
  check("booking success → succeeded + confirmation", r.status === "succeeded" && !!r.confirmation, JSON.stringify(r));
  check("success recorded in idempotency ledger", !!task.executedActions["t:success"]);

  // 2. idempotency — same key must NOT re-execute
  const r2 = await executeAction(task, mkInput({ idempotencyKey: "t:success" }));
  check("duplicate approval → duplicate (not repeated)", r2.status === "duplicate", JSON.stringify(r2));

  // 3. failure
  task = { executedActions: {} };
  r = await executeAction(task, mkInput({ target: "fail@example.org", idempotencyKey: "t:fail" }));
  check("provider decline → failed", r.status === "failed", JSON.stringify(r));
  check("failed is NOT locked (retryable)", !task.executedActions["t:fail"]);

  // 4. timeout → uncertain, never auto-retried
  task = { executedActions: {} };
  r = await executeAction(task, mkInput({ target: "timeout@example.org", idempotencyKey: "t:unc" }));
  check("timeout → uncertain", r.status === "uncertain", JSON.stringify(r));
  check("uncertain recorded (so it's never auto-retried)", !!task.executedActions["t:unc"]);
  const r4 = await executeAction(task, mkInput({ target: "timeout@example.org", idempotencyKey: "t:unc" }));
  check("re-approve after uncertain → duplicate (no dup charge)", r4.status === "duplicate", JSON.stringify(r4));

  // 5. auth required → handed back to user
  task = { executedActions: {} };
  r = await executeAction(task, mkInput({ target: "3ds-auth@example.org", idempotencyKey: "t:auth" }));
  check("auth/3DS needed → requires_user", r.status === "requires_user", JSON.stringify(r));

  // 6. placeholder target blocked
  task = { executedActions: {} };
  r = await executeAction(task, mkInput({ target: "[add the provider's email]", idempotencyKey: "t:ph" }));
  check("placeholder target → failed (blocked, not executed)", r.status === "failed", JSON.stringify(r));

  // 7. financial action without a quote is refused
  task = { executedActions: {} };
  r = await executeAction(task, mkInput({ financial: undefined, idempotencyKey: "t:noq" }));
  check("financial action w/o quote → failed (refused)", r.status === "failed", JSON.stringify(r));

  // 8. unsupported in production (no sandbox) — honest, degrades gracefully
  process.env.ACTION_MODE = "";
  task = { executedActions: {} };
  r = await executeAction(task, mkInput({ capability: "payment", idempotencyKey: "t:unsup" }));
  check("payment with no integration → unsupported (honest)", r.status === "unsupported", JSON.stringify(r));
  check("unsupported provides safe fallback steps", !!(r.artifact && r.artifact.steps));
  check("unsupported not recorded (retry after config)", !task.executedActions["t:unsup"]);

  // 9. SANDBOX payment with a concrete target → simulated, honest about no money.
  process.env.ACTION_MODE = "sandbox";
  task = { executedActions: {} };
  r = await executeAction(task, { capability: "payment", target: "sandbox://john-concert-tickets", summary: "Pay", payload: { amount: "50", currency: "CAD" }, idempotencyKey: "t:pay", financial: { total: 50, currency: "CAD" } });
  check("sandbox payment → succeeded AND flagged simulated", r.status === "succeeded" && r.simulated === true, JSON.stringify(r));
  check("sandbox payment says NO real money moved", /no real money/i.test(r.message), r.message);
  check("sandbox payment does NOT claim a real transfer", !/\b(transferred|charged your card|real payment)\b/i.test(r.message), r.message);
  check("sandbox payment preserves the exact target in its record", r.message.includes("sandbox://john-concert-tickets"), r.message);

  // 9b. Email content with an unresolved placeholder is REFUSED (never sent/prepared).
  process.env.ACTION_MODE = "sandbox";
  task = { executedActions: {} };
  r = await executeAction(task, { capability: "send_email", target: "bob@example.org", summary: "", payload: { subject: "receipt", body: "Hi Bob, attached is the payment for [reason/invoice]." }, idempotencyKey: "t:ph1" });
  check("email with placeholder body → failed (never sent)", r.status === "failed" && /placeholder/i.test(r.message), JSON.stringify(r));
  check("nothing recorded for a refused placeholder send", !task.executedActions["t:ph1"]);
  // Clean, verbatim user content is NOT blocked by the guard.
  task = { executedActions: {} };
  r = await executeAction(task, { capability: "send_email", target: "bob@example.org", summary: "", payload: { subject: "your receipt", body: "here you go bob. this is your receipt." }, idempotencyKey: "t:clean" });
  check("clean email content → not blocked by the placeholder guard", !/placeholder/i.test(r.message || ""), JSON.stringify(r));

  // 10. Empty / placeholder payment targets are STILL refused (safety intact).
  task = { executedActions: {} };
  r = await executeAction(task, { capability: "payment", target: "", summary: "Pay", payload: {}, idempotencyKey: "t:pe", financial: { total: 50, currency: "CAD" } });
  check("empty payment target → failed (blocked)", r.status === "failed", JSON.stringify(r));
  task = { executedActions: {} };
  r = await executeAction(task, { capability: "payment", target: "[add the payment link]", summary: "Pay", payload: {}, idempotencyKey: "t:pp", financial: { total: 50, currency: "CAD" } });
  check("placeholder payment target → failed (blocked)", r.status === "failed", JSON.stringify(r));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
