// Behavioral tests for OUTCOME → capability → path reasoning, using MESSY,
// INDIRECT, natural-language objectives across UNRELATED domains. Proves Volo:
//   • infers the desired outcome from natural wording,
//   • selects RELEVANT capabilities WITHOUT the user naming them ("email",
//     "calendar", "pay", "research"…),
//   • distinguishes answer / research / execution,
//   • proposes a communication FALLBACK path when engaging a party is relevant,
//   • AVOIDS irrelevant capabilities,
//   • reports missing capabilities/credentials honestly,
// and that the reasoning is generic (not hardcoded to any domain).
//
// Run: node scripts/test-paths.mjs   (wired into `npm test`)

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

const util = { normalizeWs: (s) => s.replace(/\s+/g, " ").trim(), uniq: (a) => [...new Set(a)], id: (p = "") => p + Math.random().toString(36).slice(2, 8), clamp: (n, a = 0, b = 1) => Math.min(b, Math.max(a, n)) };
const classify = loadTs("src/lib/engine/classify.ts", { "@/lib/types": {}, "@/lib/util": util });
const understandMod = loadTs("src/lib/engine/understand.ts", { "@/lib/types": {}, "@/lib/util": util, "./classify": classify });
const router = loadTs("src/lib/engine/action-router.ts", { "@/lib/types": {} });
const paths = loadTs("src/lib/engine/paths.ts", { "@/lib/types": {}, "./action-router": router });
const understand = understandMod.understand;
const { inferOutcomeNeeds, matchPaths, selectPath, unmetPaths } = paths;

let pass = 0, fail = 0;
const check = (n, c, e = "") => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

// Two capability worlds: everything connected, vs. draft-only (no form/pay integration).
const CONNECTED = [
  { id: "answer", available: true }, { id: "research", available: true },
  { id: "communicate", available: true, detail: "email connected" }, { id: "schedule", available: true },
  { id: "submit", available: true, detail: "sandbox" }, { id: "pay", available: true, detail: "sandbox" },
];
const DRAFT_ONLY = [
  { id: "answer", available: true }, { id: "research", available: true },
  { id: "communicate", available: true, detail: "no email connected — will prepare a draft" }, { id: "schedule", available: true },
  { id: "submit", available: false, detail: "no form integration — prepare steps yourself" },
  { id: "pay", available: false, detail: "no payment integration — prepare steps yourself" },
];

const needsOf = (o) => inferOutcomeNeeds(o, understand(o));
const pathsOf = (o, caps = CONNECTED) => matchPaths(needsOf(o), caps);
const capIds = (ps) => ps.map((p) => p.capability);

function main() {
  console.log("Infer outcome from messy wording (no capability keywords):");

  // Creative / informational → answer only. No irrelevant capabilities.
  check("creative ask → answer path only", JSON.stringify(capIds(pathsOf("whip up a cheesy one-liner for my wedding toast"))) === JSON.stringify(["answer"]));
  check("plain knowledge Q → answer path only", JSON.stringify(capIds(pathsOf("explain how ocean tides actually work"))) === JSON.stringify(["answer"]));
  check("arithmetic → answer only (no pay/communicate/etc.)", JSON.stringify(capIds(pathsOf("what is 2 plus 2"))) === JSON.stringify(["answer"]));

  // Current/external facts → research (NOT direct answer).
  check("time-sensitive question → research (not answer-only)", capIds(pathsOf("what's showing at the cinema tonight")).includes("research") && !capIds(pathsOf("what's showing at the cinema tonight")).includes("answer"));

  console.log("Select relevant execution capabilities from indirect wording:");

  // Indirect engagement — user NEVER says "email". Should surface research + a
  // communicate FALLBACK path (approval-gated, depends on discovering a target).
  const quote = needsOf("get a quote to repaint my back fence");
  check("‘get a quote’ → reachParty inferred (no keyword)", quote.reachParty === true);
  const quotePaths = pathsOf("get a quote to repaint my back fence");
  check("quote → research + communicate paths", capIds(quotePaths).includes("research") && capIds(quotePaths).includes("communicate"));
  const commPath = quotePaths.find((p) => p.capability === "communicate");
  check("communicate is consequential (needs approval)", commPath.consequential === true);
  check("communicate depends on research (no target yet)", commPath.dependsOnResearch === true);

  // A supplied target means communicate does NOT need research first.
  const withTarget = needsOf("let the store at help@acme.io know my order arrived broken and I want a refund");
  check("supplied target → reachParty + haveTarget", withTarget.reachParty === true && withTarget.haveTarget === true);
  const wtComm = matchPaths(withTarget, CONNECTED).find((p) => p.capability === "communicate");
  check("communicate does NOT depend on research when target supplied", wtComm.dependsOnResearch === false);

  // Scheduling from indirect wording (calendar) — and a self-reminder is the
  // USER's task, so it must NOT trigger contact/pay.
  check("‘remind me to …’ → schedule path", capIds(pathsOf("remind me to renew my passport next month")).includes("schedule"));
  const rem = needsOf("remind me to call the plumber and pay the deposit tomorrow");
  check("self-reminder does NOT hijack contact/pay", rem.reachParty === false && rem.pay === false && rem.schedule === true);

  // Cancellation → submit path (a different domain again).
  check("‘cancel my …’ → submit path", capIds(pathsOf("cancel my newspaper subscription")).includes("submit"));

  // Payment with a concrete target → pay path, no research dependency.
  const settle = needsOf("settle the invoice at sandbox://acme-invoice-42");
  check("‘settle the invoice …’ → pay + haveTarget", settle.pay === true && settle.haveTarget === true);

  console.log("Avoid irrelevant capabilities (proportional, relevance-driven):");

  const findOnly = pathsOf("find three well-reviewed coffee shops near downtown");
  check("plain discovery → research only, no communicate/pay/schedule", JSON.stringify(capIds(findOnly)) === JSON.stringify(["research"]));
  check("creative ask never proposes a consequential path", pathsOf("suggest a name for my bakery").every((p) => !p.consequential));

  console.log("Honest missing-capability + fallback selection:");

  // Draft-only world: submit/pay relevant but NOT connected → surfaced honestly.
  const cancelDraft = pathsOf("cancel my newspaper subscription", DRAFT_ONLY);
  const unmet = unmetPaths(cancelDraft);
  check("relevant-but-unavailable capability reported (submit)", unmet.some((p) => p.capability === "submit" && p.unavailableReason));
  check("unavailable path carries a reason (missing credential/integration)", unmet.every((p) => !!p.unavailableReason));

  // Fallback selection picks the best AVAILABLE relevant path.
  const first = selectPath(quotePaths);
  check("selectPath picks an available relevant path", first && first.available === true);
  check("selectPath can skip an already-tried path", selectPath(quotePaths, ["research"]).capability !== "research");

  // Every path carries an explainable rationale.
  check("every path is explainable (has a rationale)", quotePaths.every((p) => typeof p.rationale === "string" && p.rationale.length > 10));

  console.log("Cross-domain genericity (same reasoning, unrelated domains):");
  // Each of these is a DIFFERENT domain; the SAME abstraction handles them.
  check("legal/refund domain → engage a party", needsOf("dispute a wrongful charge with my bank").reachParty === true);
  check("home-services domain → find + engage", capIds(pathsOf("find a plumber and get a quote to fix my leaking sink")).includes("communicate"));
  check("events domain → schedule", capIds(pathsOf("put my dentist appointment on the 3rd on my calendar")).includes("schedule"));
  check("commerce domain → pay", needsOf("pay my electricity bill at sandbox://utility-co").pay === true);
  check("pure trivia domain → answer only", JSON.stringify(capIds(pathsOf("who painted the Mona Lisa"))) === JSON.stringify(["answer"]));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
