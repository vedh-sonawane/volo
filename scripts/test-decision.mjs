// Regression tests for the approval decision logic (decline / approve).
//
// Guards the reported "Decline crashes" bug at the LOGIC level: declining is a
// safe terminal action that executes NOTHING, cannot later run as if pending,
// and is idempotent under repeats. Drives the REAL applyDecision() with a
// tracked executeAction shim so any accidental execution is caught.
//
// Run: node scripts/test-decision.mjs   (wired into `npm test`)

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
function loadTs(rel, shims) {
  const src = fs.readFileSync(path.join(root, rel), "utf8");
  const js = ts.transpileModule(src, { compilerOptions: { module: "commonjs", target: "es2020" } }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", "require", js)(mod, mod.exports, (id) => (shims[id] ? shims[id] : require(id)));
  return mod.exports;
}

// Tracked executeAction: records every call so we can PROVE decline never runs it.
let execCalls = [];
let execResult = { status: "succeeded", message: "sent", confirmation: "REF-1", at: 1 };
const actionsShim = {
  executeAction: async (task, input) => {
    execCalls.push({ input });
    task.executedActions = task.executedActions || {};
    if (execResult.status === "succeeded" || execResult.status === "uncertain") task.executedActions[input.idempotencyKey] = execResult;
    return execResult;
  },
};
const decision = loadTs("src/lib/engine/decision.ts", { "@/lib/types": {}, "@/lib/actions": actionsShim });
const { applyDecision } = decision;

let pass = 0, fail = 0;
const check = (n, c, e = "") => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

function makeTask() {
  return {
    id: "task_x",
    objective: "Send an email to test@volo.dev",
    title: "decline test",
    status: "awaiting_approval",
    constraints: { outcome: "answer", entityLabel: "option", domain: "general", keywords: [], requirements: [] },
    directAction: { capability: "send_email", target: "test@volo.dev", params: { subject: "Hi", body: "Body" }, requiredMissing: [], monitor: false },
    plan: [
      { id: "s_1", tool: "reason", input: {}, status: "done", sources: [], dependsOn: [] },
      { id: "s_2", tool: "draft_email", input: {}, status: "done", sources: [], dependsOn: ["s_1"] },
      { id: "s_3", tool: "send_email", input: {}, status: "blocked_on_approval", sources: [], dependsOn: ["s_2"] },
      { id: "s_4", tool: "monitor_inbox", input: {}, status: "pending", sources: [], dependsOn: ["s_3"] },
    ],
    approvals: [{ id: "a_1", tool: "send_email", title: "Send email to test@volo.dev", description: "Send the email", payloadPreview: "…", target: "test@volo.dev", status: "pending", createdAt: 1 }],
    executedActions: {},
    timeline: [], sources: [], results: [],
  };
}
const stepStatus = (t, id) => t.plan.find((s) => s.id === id).status;

// A direct-action PAYMENT task whose validated target must survive to execution.
function makePaymentTask() {
  return {
    id: "task_pay",
    objective: "Pay $50 to sandbox://john-concert-tickets",
    title: "pay test",
    status: "awaiting_approval",
    constraints: { outcome: "answer", entityLabel: "option", domain: "general", keywords: [], requirements: [] },
    route: "direct_action",
    directAction: { capability: "payment", target: "sandbox://john-concert-tickets", params: { amount: "50", currency: "CAD" }, requiredMissing: [], monitor: false },
    plan: [
      { id: "s1", tool: "reason", input: {}, status: "done", sources: [], dependsOn: [] },
      { id: "s2", tool: "payment", input: {}, status: "blocked_on_approval", sources: [], dependsOn: ["s1"] },
    ],
    approvals: [{ id: "a_p", tool: "payment", title: "Pay CAD 50 to sandbox://john-concert-tickets", description: "Pay CAD 50", payloadPreview: "To: sandbox://john-concert-tickets", target: "sandbox://john-concert-tickets", financial: { total: 50, currency: "CAD" }, status: "pending", createdAt: 1 }],
    executedActions: {},
    timeline: [], sources: [], results: [],
  };
}

async function main() {
  console.log("Approval decline (regression):");

  // (1) Decline succeeds cleanly.
  execCalls = [];
  let task = makeTask();
  let r = await applyDecision(task, "a_1", "rejected");
  check("decline returns ok", r.ok === true, JSON.stringify(r));
  check("outcome is a clean 'rejected' terminal", r.outcome.status === "rejected" && r.outcome.performed === false);
  check("approval marked rejected", task.approvals[0].status === "rejected");
  check("decline stamps a decidedAt", typeof task.approvals[0].decidedAt === "number");

  // (2) The action is NEVER executed on decline.
  check("executeAction was NOT called on decline", execCalls.length === 0);
  check("no side effect recorded in the idempotency ledger", Object.keys(task.executedActions).length === 0);

  // (3) The action step is skipped (cannot run later), and so is its reply-monitor.
  check("send_email step skipped (not runnable later)", stepStatus(task, "s_3") === "skipped");
  check("dependent monitor step skipped", stepStatus(task, "s_4") === "skipped");

  // (4) A declined approval can NEVER be executed afterwards (approve is refused).
  const r2 = await applyDecision(task, "a_1", "approved");
  check("re-approving a declined action → conflict (refused)", r2.ok === false && r2.conflict === true, JSON.stringify(r2));
  check("still no execution after the refused re-approve", execCalls.length === 0);
  check("approval stays rejected (state not flipped)", task.approvals[0].status === "rejected");

  // (5) Repeated decline is safe/idempotent (no error state, no execution).
  const r3 = await applyDecision(task, "a_1", "rejected");
  check("repeated decline → conflict (already decided), handled safely", r3.ok === false && r3.conflict === true);
  check("repeated decline never executes anything", execCalls.length === 0);

  // (6) Unknown approval id → notFound (never throws).
  const r4 = await applyDecision(makeTask(), "does-not-exist", "rejected");
  check("unknown approval id → notFound", r4.ok === false && r4.notFound === true);

  console.log("Approval approve (contrast — proves execution DOES happen when approved):");

  // (7) Approving a fresh pending action runs the real (idempotent) pipeline.
  execCalls = [];
  execResult = { status: "succeeded", message: "sent", confirmation: "REF-9", at: 1 };
  task = makeTask();
  r = await applyDecision(task, "a_1", "approved");
  check("approve executes the action exactly once", execCalls.length === 1);
  check("approve uses the idempotency key task:approval", execCalls[0].input.idempotencyKey === "task_x:a_1", execCalls[0].input.idempotencyKey);
  check("approve carries the exact user params (verbatim)", execCalls[0].input.payload.subject === "Hi" && execCalls[0].input.payload.body === "Body");
  check("approve outcome reflects the provider result", r.outcome.performed === true && r.outcome.confirmation === "REF-9");
  check("approved action step marked done", stepStatus(task, "s_3") === "done");

  // (8) Approving again with the same approval → conflict (never double-executes).
  const r5 = await applyDecision(task, "a_1", "approved");
  check("re-approve after approve → conflict (no double execution)", r5.ok === false && r5.conflict === true && execCalls.length === 1);

  console.log("Payment target reaches the execution payload (approval-gated):");

  // (9) The validated payment target must survive INTO the execution input, and
  //     execution only happens on approval (never before / automatically).
  execCalls = [];
  execResult = { status: "succeeded", simulated: true, message: '[SANDBOX] Payment simulated CAD 50 for target "sandbox://john-concert-tickets". NO real money moved.', confirmation: "SBX-PAYMENT-Z", at: 1 };
  const ptask = makePaymentTask();
  check("nothing executed before the user approves", execCalls.length === 0);
  const pr = await applyDecision(ptask, "a_p", "approved");
  check("approving runs the payment exactly once", execCalls.length === 1);
  check("EXACT concrete target reaches the execution payload", execCalls[0].input.target === "sandbox://john-concert-tickets", execCalls[0].input.target);
  check("capability routed as payment", execCalls[0].input.capability === "payment");
  check("outcome reflects the simulated provider result", pr.outcome.performed === true && pr.outcome.confirmation === "SBX-PAYMENT-Z");

  // (10) Approval still gates re-execution (no double charge).
  const pr2 = await applyDecision(ptask, "a_p", "approved");
  check("re-approve payment → conflict (approval still required, no double-exec)", pr2.conflict === true && execCalls.length === 1);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
