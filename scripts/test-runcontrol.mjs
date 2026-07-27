// Regression tests for run supersession — the mechanism that makes Cancel
// (erase progress) and Edit-prompt (re-analyze) safe: a superseded run must be
// recognizable so the executor stops and refuses to persist, and can therefore
// never resurrect an erased task or clobber a fresh run.
//
// Run: node scripts/test-runcontrol.mjs   (wired into `npm test`)

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
function loadTs(rel, shims = {}) {
  const src = fs.readFileSync(path.join(root, rel), "utf8");
  const js = ts.transpileModule(src, { compilerOptions: { module: "commonjs", target: "es2020" } }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", "require", js)(mod, mod.exports, (id) => (shims[id] ? shims[id] : require(id)));
  return mod.exports;
}

const rc = loadTs("src/lib/engine/runcontrol.ts");
const { bumpGeneration, currentGeneration, isSuperseded } = rc;

let pass = 0, fail = 0;
const check = (n, c, e = "") => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

console.log("Run supersession (cancel / edit safety):");

// A run captures its generation at start.
const A = "task_a";
const genA = bumpGeneration(A);
check("a started run is NOT superseded", isSuperseded(A, genA) === false);

// Cancelling / editing bumps the generation → the in-flight run is superseded.
bumpGeneration(A);
check("after supersede, the old run IS superseded (stops + won't persist)", isSuperseded(A, genA) === true);

// The fresh run (new generation) is the current one and is not superseded.
const genA2 = bumpGeneration(A);
check("the fresh run is current, not superseded", isSuperseded(A, genA2) === false);
check("generations strictly increase", genA2 > genA);

// Generations are per-task: superseding one task never affects another.
const B = "task_b";
const genB = bumpGeneration(B);
bumpGeneration(A); // churn task A
check("task B is unaffected by task A supersession", isSuperseded(B, genB) === false);
check("currentGeneration reflects the latest bump", currentGeneration(B) === genB);

// An unknown/never-run task reads generation 0 and any positive gen is stale.
check("unknown task has generation 0", currentGeneration("task_never") === 0);
check("a stale gen for an unknown task is superseded", isSuperseded("task_never", 5) === true);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
