// Behavioral tests for GENERIC direct-action routing (and its execution).
//
// Part A — routeObjective: distinguishes research / direct_action / mixed /
//   informational objectives, extracts the user's EXACT parameters, detects
//   genuinely-missing required params, and never fabricates a value. Covers
//   MULTIPLE unrelated capabilities (email, calendar, form, payment, booking) so
//   the behavior is generic, not email-specific.
//
// Part B — executeAction on a direct action: the user's exact target/subject/body
//   flow through the real execute pipeline; success, provider failure,
//   uncertain outcome, duplicate prevention, and placeholder-target blocking are
//   all honest.
//
// Run: node scripts/test-routing.mjs   (also wired into `npm test`)

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function loadTs(rel, shims) {
  const src = fs.readFileSync(path.join(root, rel), "utf8");
  const js = ts.transpileModule(src, { compilerOptions: { module: "commonjs", target: "es2020" } }).outputText;
  const mod = { exports: {} };
  const req = (id) => {
    if (shims[id]) return shims[id];
    throw new Error(`unexpected import: ${id}`);
  };
  new Function("module", "exports", "require", js)(mod, mod.exports, req);
  return mod.exports;
}

const router = loadTs("src/lib/engine/action-router.ts", { "@/lib/types": {} });
const { routeObjective, directActionPreviewLines } = router;

// Real understand()/classify() so routing decisions use the true parsed outcome
// (the user never has to hand-craft constraints — Volo derives them).
const utilFull = {
  normalizeWs: (s) => s.replace(/\s+/g, " ").trim(),
  uniq: (a) => [...new Set(a)],
  id: (p = "") => p + Math.random().toString(36).slice(2, 8),
  clamp: (n, a = 0, b = 1) => Math.min(b, Math.max(a, n)),
};
const classifyMod = loadTs("src/lib/engine/classify.ts", { "@/lib/types": {}, "@/lib/util": utilFull });
const understandMod = loadTs("src/lib/engine/understand.ts", { "@/lib/types": {}, "@/lib/util": utilFull, "./classify": classifyMod });
const understand = understandMod.understand;
const pathsMod = loadTs("src/lib/engine/paths.ts", { "@/lib/types": {}, "./action-router": router });
const planner = loadTs("src/lib/engine/planner.ts", {
  "@/lib/types": {},
  "@/lib/util": utilFull,
  "./domains": { schemaFor: () => ({ columns: [], entityHints: [] }) },
  "./classify": classifyMod,
  "./understand": understandMod,
  "./action-router": router,
  "./paths": pathsMod,
});
// Route an objective the way the engine does: parse constraints, then decide.
const routeReal = (objective) => routeObjective(objective, understand(objective));

// ── action execution pipeline (real orchestration, controllable email) ────────
let emailMode = "smtp";
let emailAvail = true;
let emailSent = true; // whether send() reports success
let lastSent = null;
const shimEmail = {
  getEmailProvider: () => ({
    name: emailMode,
    available: async () => emailAvail,
    send: async (m) => {
      lastSent = m;
      return emailSent ? { sent: true, message: "delivered", id: "MSG-1" } : { sent: false, message: "smtp refused" };
    },
  }),
};
const shimDraft = { draftEmail: (m) => ({ ...m, eml: "EML" }) };
const shimIcs = { makeIcs: () => "BEGIN:VCALENDAR\r\nEND:VCALENDAR" };
const providers = loadTs("src/lib/actions/providers.ts", {
  "@/lib/types": {},
  "@/lib/providers/email": shimEmail,
  "@/lib/tools/email-draft": shimDraft,
  "@/lib/tools/ics": shimIcs,
  "./types": {},
});
const shimConfig = { cfg: (k, f = "") => process.env[k] || f };
const actions = loadTs("src/lib/actions/index.ts", {
  "@/lib/types": {},
  "@/lib/providers/email": shimEmail,
  "@/lib/config": shimConfig,
  "./providers": providers,
  "./types": {},
  "./stripe": { StripeTestPaymentAction: class {}, stripeTestConfigured: () => false },
});
const { executeAction } = actions;

let pass = 0, fail = 0;
const check = (n, c, e = "") => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

// A direct action's supplied params must reach the provider exactly (as the
// approve route builds them).
function emailInput(da, key) {
  return { capability: "send_email", target: da.target, summary: "", payload: { subject: da.params.subject ?? "", body: da.params.body ?? "" }, idempotencyKey: key };
}

async function main() {
  // ── Part A: routing + extraction ───────────────────────────────────────────
  console.log("Direct-action routing:");

  // (1) Direct email with explicit recipient, subject, and body.
  const EMAIL = 'Send an email to sam@acme.io with subject Project Kickoff and body Let us meet Monday at 10. Do not send until I approve.';
  const d1 = routeObjective(EMAIL, { outcome: "answer" });
  check("direct email → direct_action route", d1.route === "direct_action");
  check("recognizes send_email capability", d1.action?.capability === "send_email");
  check("recipient extracted (not researched, not placeholder)", d1.action?.target === "sam@acme.io", d1.action?.target);
  check("subject preserved verbatim", d1.action?.params.subject === "Project Kickoff", JSON.stringify(d1.action?.params));
  check("body preserved verbatim", d1.action?.params.body === "Let us meet Monday at 10", JSON.stringify(d1.action?.params));
  check("no missing params when all provided", (d1.action?.requiredMissing ?? ["x"]).length === 0, JSON.stringify(d1.action?.requiredMissing));
  check("no auto reply-monitoring unless requested", d1.action?.monitor === false);

  // (2) Direct action with a MISSING required parameter (no body).
  const d2 = routeObjective("Send an email to dana@team.co with subject Weekly Sync.", { outcome: "answer" });
  check("missing body detected", (d2.action?.requiredMissing ?? []).includes("body"), JSON.stringify(d2.action?.requiredMissing));
  check("still a direct action (not research)", d2.route === "direct_action");
  check("provided subject is NOT re-asked", !(d2.action?.requiredMissing ?? []).includes("subject"));

  // (3) Placeholder / missing recipient → asked, never fabricated or researched.
  const d3 = routeObjective("Send an email with subject Hi and body Hello there.", { outcome: "answer" });
  check("missing recipient detected", (d3.action?.requiredMissing ?? []).includes("recipient"));
  check("no fabricated recipient target", d3.action?.target === "");

  // (4) Explicit reply-monitoring requested → monitor flag set.
  const d4 = routeObjective("Email jo@x.io with subject Q and body Please reply, and let me know when they respond.", { outcome: "answer" });
  check("explicit monitoring request detected", d4.action?.monitor === true);

  // (5) Direct calendar event with explicit details (a DIFFERENT capability).
  const d5 = routeObjective('Add a calendar event titled Dentist on March 3, 2026 at 9am.', { outcome: "answer" });
  check("calendar → direct_action route", d5.route === "direct_action" && d5.action?.capability === "calendar_event");
  check("event title preserved", d5.action?.params.title === "Dentist", JSON.stringify(d5.action?.params));
  check("event date captured", !!d5.action?.params.date, JSON.stringify(d5.action?.params));
  check("no external target required for calendar", d5.action?.target === "" && (d5.action?.requiredMissing ?? []).length === 0);

  // (6) Calendar missing a required param (no date).
  const d6 = routeObjective("Create a calendar event titled Standup.", { outcome: "answer" });
  check("calendar missing date detected", (d6.action?.requiredMissing ?? []).includes("date"));

  // (7) Form submission with an explicit URL target.
  const d7 = routeObjective("Submit the form at https://forms.example.org/apply for me.", { outcome: "answer" });
  check("form with URL → direct_action", d7.route === "direct_action" && d7.action?.capability === "submit_form");
  check("form target is the URL", d7.action?.target === "https://forms.example.org/apply");

  // (8) Form without a target URL → missing form URL.
  const d8 = routeObjective("Submit the registration form for me.", { outcome: "answer" });
  check("form without URL → missing form URL", (d8.action?.requiredMissing ?? []).includes("form URL"));

  // (9) Payment to a supported target with amount (yet another capability).
  const d9 = routeObjective("Pay $40 to https://pay.example.com/invoice/123.", { outcome: "answer" });
  check("payment with target+amount → direct_action", d9.route === "direct_action" && d9.action?.capability === "payment");
  check("amount captured verbatim", d9.action?.params.amount === "40", JSON.stringify(d9.action?.params));

  // (10) A RESEARCH objective still uses research (no action target).
  const r1 = routeObjective("Find three good restaurants near downtown under $30 per person.", { outcome: "candidates" });
  check("research objective → research route", r1.route === "research" && !r1.action);

  // (11) A MIXED objective: research first, THEN act on the chosen result.
  const m1 = routeObjective("Find the best hotel in Rome and book it after I approve.", { outcome: "candidates" });
  check("mixed objective → mixed route", m1.route === "mixed");
  check("mixed keeps the intended action (book)", m1.action?.capability === "book");

  // (12) Booking a SPECIFIC identified link is a direct action (no research).
  const d12 = routeObjective("Book https://hotels.example.com/room/9 for me.", { outcome: "answer" });
  check("specific booking link → direct_action", d12.route === "direct_action" && d12.action?.capability === "book");

  // (14) Exact-preservation: preview shows the user's values verbatim (no rewrite).
  const lines = directActionPreviewLines(d1.action);
  check("preview carries exact recipient/subject/body", lines.includes("To: sam@acme.io") && lines.includes("Subject: Project Kickoff") && lines.includes("Body: Let us meet Monday at 10"), JSON.stringify(lines));

  // ── Direct-answer routing (creative / informational, no research) ──────────
  // Uses the REAL parsed outcome — the user types NO special keywords; Volo infers.
  console.log("Direct-answer vs research routing:");

  // (a) A simple CREATIVE request → answered directly (the reported bug).
  const joke = routeReal("Make someone laugh with a funny joke");
  check("creative request → direct_answer (not research)", joke.route === "direct_answer", joke.route);
  const poem = routeReal("Write a short poem about the ocean");
  check("another creative request → direct_answer", poem.route === "direct_answer", poem.route);

  // (b) A general factual question that needs NO current information → direct.
  check("general knowledge question → direct_answer", routeReal("Explain how photosynthesis works").route === "direct_answer");
  check("timeless factual question → direct_answer", routeReal("What is the capital of France?").route === "direct_answer");

  // (c) A request that explicitly needs CURRENT / researched info → research.
  check("'latest news' question → research", routeReal("What is the latest news about AI regulation?").route === "research");
  check("'current' data question → research", routeReal("What is the current weather in Paris?").route === "research");
  check("explicit 'search/sources' → research", routeReal("Look up recent studies on sleep and cite the sources").route === "research");

  // (d) A direct external action → direct_action (unchanged).
  check("direct email action → direct_action", routeReal("Email sam@acme.io with subject Hi and body Hello.").route === "direct_action");

  // (e) A mixed research-then-action objective → mixed (research first, then act).
  check("research-then-action → mixed", routeReal("Find the best hotel in Rome and book it after I approve.").route === "mixed");

  // (f) A genuine multi-category comparison → research, and it truly decomposes.
  const wedding = "Find and compare suitable venues, catering companies, and photographers, then combine them into complete packages.";
  check("multi-category comparison → research route", routeReal(wedding).route === "research");
  check("genuine multi-category IS decomposable", !!classifyMod.deterministicDecompose(wedding, understand(wedding)));
  check("multi-category signal present for a real list", classifyMod.hasMultiCategorySignal(wedding, understand(wedding)) === true);

  // (g) A creative/answer request must NEVER be seen as multi-category.
  check("creative request has NO multi-category signal (no invented categories)", classifyMod.hasMultiCategorySignal("Make someone laugh with a funny joke", understand("Make someone laugh with a funny joke")) === false);

  // (h) Ambiguous/incomplete direct request → asks ONLY for the missing info.
  const incomplete = routeReal("Send an email to dana@team.co.");
  check("incomplete action → direct_action asking only what's missing", incomplete.route === "direct_action" && incomplete.action.requiredMissing.includes("subject") && incomplete.action.requiredMissing.includes("body"));

  // (i) VERIFY: a direct-answer plan contains ZERO web-research tools.
  const answerPlan = planner.buildDirectAnswerPlan("Make someone laugh with a funny joke", understand("Make someone laugh with a funny joke"));
  const tools = answerPlan.map((s) => s.tool);
  const RESEARCH_TOOLS = ["web_search", "fetch_page", "read_document", "extract_structured", "compare", "combine_domains"];
  check("direct-answer plan is exactly [reason, direct_answer]", JSON.stringify(tools) === JSON.stringify(["reason", "direct_answer"]), JSON.stringify(tools));
  check("direct-answer plan calls NO research tool (never hits the web provider)", tools.every((t) => !RESEARCH_TOOLS.includes(t)));

  // ── Payment target propagation (sandbox + clarification) ───────────────────
  console.log("Payment target propagation:");

  // A concrete non-http URI (any scheme) is a valid payment target — verbatim.
  const pay1 = routeReal("Pay $50 to sandbox://john-concert-tickets");
  check("sandbox:// target → direct_action payment", pay1.route === "direct_action" && pay1.action?.capability === "payment");
  check("exact target extracted, not emptied/transformed", pay1.action?.target === "sandbox://john-concert-tickets", pay1.action?.target);
  check("no missing params when target + amount present", (pay1.action?.requiredMissing ?? ["x"]).length === 0, JSON.stringify(pay1.action?.requiredMissing));

  // The target supplied DURING CLARIFICATION (appended to the objective) survives.
  const effAfterClarify =
    "Pay $50 for John's concert tickets.\n\nAdditional details from the user:\n- What is the exact payment target (a payment URL or account)? → sandbox://john-concert-tickets";
  const pay2 = routeReal(effAfterClarify);
  check("clarified target survives re-planning → direct_action", pay2.route === "direct_action" && pay2.action?.capability === "payment");
  check("clarified target reaches the action unchanged", pay2.action?.target === "sandbox://john-concert-tickets", pay2.action?.target);

  // The exact target appears in the approval PREVIEW.
  const payPreview = router.directActionPreviewLines(pay2.action);
  check("approval preview shows the exact target", payPreview.some((l) => l.includes("sandbox://john-concert-tickets")), JSON.stringify(payPreview));

  // Missing / placeholder targets are still asked for (never fabricated).
  const pay3 = routeReal("Pay $50 for John's concert tickets");
  check("missing target → asked, target stays empty", (pay3.action?.requiredMissing ?? []).includes("payment target") && pay3.action?.target === "");
  const pay4 = routeReal("Pay $50 to [add the payment link]");
  check("placeholder target not accepted as concrete", (pay4.action?.requiredMissing ?? []).includes("payment target"));

  // ── User-provided email fields survive clarification VERBATIM ──────────────
  console.log("Email field preservation through clarification:");

  // The exact reported scenario: a compound "pay & email" ask → recognized as an
  // email action that needs details; the user's answers must reach the payload
  // EXACTLY (no question/template remnant like "I won't write it for you").
  const emailAction = routeReal("Pay Bob $50 and email him the receipt.").action;
  check("‘pay & email’ → email action needing details", emailAction && emailAction.capability === "send_email" && emailAction.requiredMissing.includes("body"));

  const clarified = {
    recipient: "sonawane.vedh14@gmail.com",
    subject: "pay money to bob volo test",
    body: "here you go bob. this is your receipt. the test has passed.",
  };
  const filled = router.applyClarifiedParams(emailAction, clarified);
  check("recipient preserved exactly", filled.target === "sonawane.vedh14@gmail.com", filled.target);
  check("subject preserved VERBATIM", filled.params.subject === clarified.subject, filled.params.subject);
  check("body preserved VERBATIM", filled.params.body === clarified.body, filled.params.body);
  check("body has NO leaked question/template remnant", !/won't write it for you/i.test(filled.params.body));
  check("nothing required is missing after clarification", filled.requiredMissing.length === 0);

  const emailPreview = router.directActionPreviewLines(filled);
  check("approval preview shows the exact subject", emailPreview.includes("Subject: pay money to bob volo test"));
  check("approval preview shows the exact body", emailPreview.some((l) => l === "Body: here you go bob. this is your receipt. the test has passed."));

  // A messy recipient answer still yields a clean address (extracted, verbatim content untouched).
  check("messy recipient answer → clean address", router.applyClarifiedParams(emailAction, { recipient: "it's sonawane.vedh14@gmail.com thanks", subject: "s", body: "b" }).target === "sonawane.vedh14@gmail.com");

  // Placeholder validation: unresolved markers are detected and would return to clarification.
  check("clean content → no placeholder fields", router.contentPlaceholderFields(filled).length === 0);
  const phFilled = router.applyClarifiedParams(emailAction, { recipient: "a@b.co", subject: "Bob's money", body: "Hi Bob, attached is the payment for [reason/invoice]." });
  check("bracket placeholder in body detected", router.contentPlaceholderFields(phFilled).includes("body"));
  check("hasPlaceholder flags markers, not normal text", router.hasPlaceholder("Hello {{name}}") && router.hasPlaceholder("see <invoice>") && !router.hasPlaceholder("Hi Bob, here you go"));

  // ── Outcome-driven capability paths in the PLAN (no capability keywords) ───
  console.log("Outcome-driven action paths (research → contact fallback):");

  // Indirect engagement wording ("get a quote") — the user never says "email" —
  // yet the research plan gains an APPROVAL-GATED contact step after ranking.
  const quotePlan = planner.createPlan("get a quote to repaint my back fence", understand("get a quote to repaint my back fence"));
  const qTools = quotePlan.map((s) => s.tool);
  check("indirect engagement → plan researches THEN contacts", qTools.includes("web_search") && qTools.includes("compare") && qTools.includes("send_email"), JSON.stringify(qTools));
  const sendStep = quotePlan.find((s) => s.tool === "send_email");
  check("the contact step is approval-gated", sendStep && sendStep.input && sendStep.input.needs === "approval");
  check("a draft is prepared before the (gated) send", quotePlan.findIndex((s) => s.tool === "draft_email") < quotePlan.findIndex((s) => s.tool === "send_email"));

  // Proportional: a plain discovery objective must NOT append any consequential
  // action (no spam) — research only.
  const findPlan = planner.createPlan("find three well-reviewed coffee shops near downtown", understand("find three well-reviewed coffee shops near downtown"));
  const fTools = findPlan.map((s) => s.tool);
  check("plain discovery → NO consequential action appended", !["send_email", "book", "submit_form", "payment"].some((t) => fTools.includes(t)), JSON.stringify(fTools));

  // A booking-shaped outcome routes the tail to the booking capability (still gated).
  const bookPlan = planner.createPlan("find a nice restaurant for Friday and make a reservation", understand("find a nice restaurant for Friday and make a reservation"));
  const bStep = bookPlan.find((s) => s.tool === "book");
  check("booking outcome → book step, approval-gated", bStep && bStep.input.needs === "approval", JSON.stringify(bookPlan.map((s) => s.tool)));

  // ── Part B: executing a direct action honestly ─────────────────────────────
  console.log("Direct-action execution:");
  process.env.ACTION_MODE = "";
  emailMode = "smtp"; emailAvail = true;

  // (a) Successful execution — the EXACT subject/body reach the provider.
  emailSent = true; lastSent = null;
  let task = { executedActions: {} };
  let res = await executeAction(task, emailInput(d1.action, "e:ok"));
  check("direct email sends → succeeded", res.status === "succeeded", JSON.stringify(res));
  check("provider received the exact subject", lastSent?.subject === "Project Kickoff", JSON.stringify(lastSent));
  check("provider received the exact body", lastSent?.body === "Let us meet Monday at 10", JSON.stringify(lastSent));

  // (b) Duplicate execution prevention (idempotency).
  const dup = await executeAction(task, emailInput(d1.action, "e:ok"));
  check("re-approval → duplicate (not re-sent)", dup.status === "duplicate", JSON.stringify(dup));

  // (c) Provider failure is reported honestly (no false success).
  emailSent = false;
  task = { executedActions: {} };
  res = await executeAction(task, emailInput(d1.action, "e:fail"));
  check("provider failure → failed (honest)", res.status === "failed", JSON.stringify(res));
  check("failed is retryable (not locked)", !task.executedActions["e:fail"]);

  // (d) Placeholder / invalid recipient is blocked, never sent.
  emailSent = true; lastSent = null;
  task = { executedActions: {} };
  res = await executeAction(task, { capability: "send_email", target: "[add the provider's email]", summary: "", payload: { subject: "x", body: "y" }, idempotencyKey: "e:ph" });
  check("placeholder recipient → failed (blocked)", res.status === "failed", JSON.stringify(res));
  check("nothing sent for a placeholder", lastSent === null);

  // (e) Uncertain outcome is preserved and never auto-retried (sandbox path).
  // (No SMTP configured → the sandbox test double drives the send flow.)
  process.env.ACTION_MODE = "sandbox";
  emailMode = "local-draft"; emailAvail = false;
  task = { executedActions: {} };
  res = await executeAction(task, { capability: "send_email", target: "timeout@acme.io", summary: "", payload: { subject: "s", body: "b" }, idempotencyKey: "e:unc" });
  check("timeout → uncertain", res.status === "uncertain", JSON.stringify(res));
  const uncDup = await executeAction(task, { capability: "send_email", target: "timeout@acme.io", summary: "", payload: {}, idempotencyKey: "e:unc" });
  check("uncertain not auto-retried → duplicate", uncDup.status === "duplicate", JSON.stringify(uncDup));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
