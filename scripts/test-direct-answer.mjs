// Regression tests for model capability detection + direct-answer composition.
//
// The bug: a CONNECTED generative model (Ollama) was reported as "no model
// connected" for direct-answer tasks. Root cause: the answer path re-checked
// availability and conflated a generation hiccup / the rule provider with "no
// model". Fix: capabilities derive from a single source of truth (model.generative)
// and a connected generative model exposes ALL its capabilities (planning,
// clarification, direct_answer, generation). Generic — not tied to any objective.
//
// Run: node scripts/test-direct-answer.mjs   (wired into `npm test`)

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function loadTs(rel, shims = {}) {
  const src = fs.readFileSync(path.join(root, rel), "utf8");
  const js = ts.transpileModule(src, { compilerOptions: { module: "commonjs", target: "es2020", esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", "require", js)(mod, mod.exports, (id) => (id in shims ? shims[id] : require(id)));
  return mod.exports;
}

const modelTypes = loadTs("src/lib/providers/model/types.ts");
const da = loadTs("src/lib/engine/direct-answer.ts", { "@/lib/providers/model": {}, "@/lib/types": {} });
const { generateDirectAnswer, directAnswerFinal } = da;

let pass = 0, fail = 0;
const check = (n, c, e = "") => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

// A connected generative model (like Ollama). Records the prompt it received.
let lastPrompt = null;
const generativeModel = (reply) => ({ name: "ollama", generative: true, available: async () => true, generate: async (prompt) => { lastPrompt = prompt; return typeof reply === "function" ? reply(prompt) : reply; } });
// The deterministic rule provider — NOT generative.
let ruleGenerateCalls = 0;
const ruleModel = { name: "rule", generative: false, available: async () => false, generate: async () => { ruleGenerateCalls++; return null; } };

const NO_MODEL = /no ai model is connected/i;

async function answerFor(objective, model) {
  const ans = await generateDirectAnswer(objective, model);
  return { ans, final: directAnswerFinal({}, ans) };
}

async function main() {
  console.log("Model capability source of truth (generic):");
  check("a generative model exposes ALL capabilities", JSON.stringify(modelTypes.modelCapabilities({ generative: true })) === JSON.stringify(["planning", "clarification", "direct_answer", "generation"]));
  check("direct_answer + generation are among them", modelTypes.GENERATIVE_CAPABILITIES.includes("direct_answer") && modelTypes.GENERATIVE_CAPABILITIES.includes("generation"));
  check("a non-generative provider exposes none of them", modelTypes.modelCapabilities({ generative: false }).length === 0);

  console.log("A connected model answers directly (the 4 required scenarios):");

  // 1. Explain a concept.
  let r = await answerFor("Explain how airplanes stay in the air", generativeModel("Airplanes stay aloft because their wings generate lift…"));
  check("explain a concept → real answer", r.final.headline === "Direct answer" && r.final.summary.startsWith("Airplanes stay aloft") && r.final.modelUsed === true);
  check("explain → NEVER says 'no model connected'", !NO_MODEL.test(r.final.summary));

  // 2. Write an email draft.
  r = await answerFor("Write an email to my landlord about a leaking tap", generativeModel("Subject: Leaking tap\n\nHi, the tap in the kitchen is leaking…"));
  check("write an email draft → real draft", r.final.headline === "Direct answer" && /Leaking tap/.test(r.final.summary) && r.final.modelUsed === true);

  // 3. Summarize text.
  r = await answerFor("Summarize this: the quarterly report shows growth across all regions…", generativeModel("The company grew in every region this quarter."));
  check("summarize text → real summary", r.final.headline === "Direct answer" && /grew in every region/.test(r.final.summary));

  // 4. Answer a factual question.
  r = await answerFor("What is the capital of France?", generativeModel("The capital of France is Paris."));
  check("factual question → real answer", r.final.headline === "Direct answer" && /Paris/.test(r.final.summary));

  console.log("Generic (no hardcoding) + honest edge cases:");
  // The objective is passed through verbatim to the model — proves no per-scenario logic.
  await answerFor("Anything at all — zxqw unique-token-4821", generativeModel("ok"));
  check("objective passed to the model verbatim (generic)", lastPrompt.includes("zxqw unique-token-4821"));

  // A connected model that returns nothing must NOT be reported as "no model connected".
  r = await answerFor("Explain photosynthesis", generativeModel(""));
  check("connected model, empty output → honest 'didn't return' (not 'no model')", r.ans.hasModel === true && r.final.modelUsed === false && r.final.headline === "The model didn't return an answer" && !NO_MODEL.test(r.final.summary));

  // Only when there is genuinely NO generative model do we say so — and we never
  // even call generate on a non-generative provider.
  ruleGenerateCalls = 0;
  r = await answerFor("Explain photosynthesis", ruleModel);
  check("no generative model → honest 'connect a model'", r.ans.hasModel === false && NO_MODEL.test(r.final.summary));
  check("never calls generate on a non-generative provider", ruleGenerateCalls === 0);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
