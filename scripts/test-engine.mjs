// Engine-level tests: generic multi-domain join, category decomposition,
// contradiction detection, aggregate-vs-specific classification, and money /
// quantity semantics. Deterministic, no network. Run via `npm test`.
//
// GENERALIZATION: every capability is tested across MULTIPLE UNRELATED domains
// so the assertions verify GENERIC behavior, not any single example. No test
// depends on travel/wedding/etc. — they only depend on structure (numbers,
// dates, currencies, URL shapes, list phrasing).

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function loadTs(rel, shims) {
  const src = fs.readFileSync(path.join(root, rel), "utf8");
  const js = ts.transpileModule(src, { compilerOptions: { module: "commonjs", target: "es2020" } }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", "require", js)(mod, mod.exports, (id) => (shims[id] ? shims[id] : require(id)));
  return mod.exports;
}

const util = {
  normalizeWs: (s) => s.replace(/\s+/g, " ").trim(),
  uniq: (a) => { const s = new Set(), o = []; for (const x of a) if (!s.has(x)) { s.add(x); o.push(x); } return o; },
  clamp: (n, a = 0, b = 1) => Math.min(b, Math.max(a, n)),
  id: (p = "") => p + Math.random().toString(36).slice(2, 8),
};
const money = loadTs("src/lib/engine/money.ts", {});
const combine = loadTs("src/lib/engine/combine.ts", { "@/lib/types": {}, "./money": money, "@/lib/util": util });
const classify = loadTs("src/lib/engine/classify.ts", { "@/lib/types": {}, "@/lib/util": util });
const contradictions = loadTs("src/lib/engine/contradictions.ts", { "./money": money });

let pass = 0, fail = 0;
const check = (n, c, e = "") => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

// ── join engine ──────────────────────────────────────────────────────────────
console.log("Multi-domain join:");
const item = (name, price) => ({ id: "i_" + name, kind: "candidate", name, attributes: { price: "$" + price }, confidence: 0.6, score: 0.6 });
const priced = (name, price) => ({ id: "i_" + name, kind: "candidate", name, attributes: { price }, confidence: 0.6, score: 0.6 });
const sub = (id, label, items) => ({ id, label, objective: label, constraints: {}, results: items, status: "done", comparison: { columns: [], items, recommendedIds: items.map((i) => i.id), rationale: "", entityLabel: label, informationCount: 0 } });
const r = combine.combineDomains([sub("a", "transport", [item("Budget", 89), item("Legacy", 149)]), sub("b", "lodging", [item("Camp", 38), item("Hotel", 60)])], { maxPrice: 200 });
check("forms cartesian combinations", r.options.length === 4, r.options.length);
check("ranks cheapest within budget first", r.options[0].totalPrice === 127);
check("flags over-budget combo", r.options.find((o) => o.totalPrice === 209)?.withinBudget === false);
const r2 = combine.combineDomains([sub("a", "transport", [item("Budget", 89)]), sub("c", "activities", [])], { maxPrice: 200 });
check("reports missing category honestly", JSON.stringify(r2.missing) === JSON.stringify(["activities"]));

// ── generic decomposition ────────────────────────────────────────────────────
console.log("Generic category decomposition:");
const wedding = "Find and compare suitable outdoor venues, catering companies, photographers, and rental companies independently in the Toronto area. Then combine the options into complete packages.";
const specs = classify.deterministicDecompose(wedding, { location: "September" });
check("wedding → 4 categories", specs && specs.length === 4, specs && specs.length);
check("categories are the user's words (not hardcoded)", specs && specs[0].label === "outdoor venues" && specs[1].label === "catering companies");
check("uses real place (Toronto) not a month", specs && specs[0].query.includes("Toronto") && !specs[0].query.includes("September"));
check("single-domain objective NOT decomposed", classify.deterministicDecompose("Compare laptops for programming and gaming under 1500", {}) === null);

// ── Capability #1: contradiction detection (GENERIC, cross-domain) ────────────
console.log("Contradiction detection:");
// (a) Travel / date contradiction: stated nights ≠ the date span.
const c1 = contradictions.detectContradictions("Book a 5 night stay from July 1 to July 10, 2026", {});
check("travel: nights vs date-span contradiction flagged", c1.some((x) => x.importance === "blocking"));
// (b) Non-travel temporal contradiction: equipment rental days ≠ date span.
const c2 = contradictions.detectContradictions("Rent lab equipment for 3 days, from March 2 to March 8, 2026", {});
check("non-travel: days vs date-span contradiction flagged", c2.some((x) => x.importance === "blocking"));
// (c) Consistent dates → NO false alarm (span exactly matches nights).
const c3 = contradictions.detectContradictions("Reserve a 3 night room from July 1 to July 4, 2026", {});
check("consistent duration/dates → no false contradiction", c3.length === 0, JSON.stringify(c3));
// (d) Non-travel numeric/budget contradiction: quantity × per-unit exceeds budget.
const c4 = contradictions.detectContradictions("Buy 10 licenses at $60 per license with a total budget of $300", { unit: 10 });
check("non-travel: qty×unit-price over budget flagged", c4.some((x) => x.importance === "blocking"), JSON.stringify(c4));
// (e) Inverted numeric range (logical contradiction), any domain.
const c5 = contradictions.detectContradictions("Find a monitor priced between 500 and 200 dollars", {});
check("inverted range flagged (optional)", c5.some((x) => x.importance === "optional"));
// (f) Plain objective with no conflict → silent.
const c6 = contradictions.detectContradictions("Find three bike shops near downtown", {});
check("no-conflict objective → silent", c6.length === 0);

// ── Capability #2: never silently omit a requested category ───────────────────
console.log("Category completeness (reconcile):");
// (a) Travel: model dropped one of three explicitly-requested categories.
const objA = "Compare hotels, flights, and rental cars independently, then combine into trip packages.";
const modelA = [{ label: "hotels", query: "hotels" }, { label: "flights", query: "flights" }];
const recA = classify.reconcileCategories(modelA, objA, {});
check("travel: dropped category (rental cars) added back", recA.length === 3 && recA.some((s) => /rental cars/.test(s.label)), JSON.stringify(recA.map((x) => x.label)));
// (b) Non-travel: software bundle, model dropped payroll.
const objB = "Research CRM software, accounting software, and payroll software separately, then combine into a bundle.";
const modelB = [{ label: "crm software", query: "crm" }, { label: "accounting software", query: "accounting" }];
const recB = classify.reconcileCategories(modelB, objB, {});
check("non-travel: dropped category (payroll) added back", recB.length === 3 && recB.some((s) => /payroll/.test(s.label)), JSON.stringify(recB.map((x) => x.label)));
// (c) No duplication when the model already covers all (plural/singular tolerant).
const recC = classify.reconcileCategories([{ label: "flight options", query: "flights" }, { label: "hotels", query: "hotels" }, { label: "rental car", query: "cars" }], objA, {});
check("already-complete decomposition is not duplicated", recC.length === 3, JSON.stringify(recC.map((x) => x.label)));

// ── Capability #3: specific option vs aggregate/directory/search page ─────────
console.log("Specific vs aggregate source:");
check("search-results URL is aggregate", classify.isAggregateSource("https://example.com/search?q=bike+repair") === true);
check("directory path is aggregate", classify.isAggregateSource("https://site.org/directory/plumbers") === true);
check("browse/category path is aggregate", classify.isAggregateSource("https://shop.com/browse/laptops") === true);
check("specific business page is NOT aggregate", classify.isAggregateSource("https://blueridgebikes.com/services") === false);
check("aggregate name flagged", classify.isAggregateSource(undefined, "Plumber Directory") === true);
// isValidCandidate rejects an otherwise-good row whose only evidence is a search page.
const aggRow = { name: "Trailhead Cyclery", kind: "candidate", attributes: { price: "$40", contact: "555-1000" }, evidenceUrl: "https://directory.example.com/search?q=bikes" };
const specificRow = { name: "Trailhead Cyclery", kind: "candidate", attributes: { price: "$40", contact: "555-1000" }, evidenceUrl: "https://trailheadcyclery.com/repairs" };
check("candidate on a search page is rejected", classify.isValidCandidate(aggRow, []) === false);
check("candidate on a specific page is accepted", classify.isValidCandidate(specificRow, []) === true);

// ── Capability #4: price & quantity semantics ─────────────────────────────────
console.log("Money / quantity semantics:");
const perPerson = money.parseMoney("$50 per person");
check("parses per-person basis + USD", perPerson.basis === "per_person" && perPerson.currency === "USD" && perPerson.amount === 50);
check("per-person × known people = total", money.toTotal(perPerson, { person: 4 }).total === 200);
check("per-person with UNKNOWN people → not computed", money.toTotal(perPerson, {}).complete === false);
const perNight = money.parseMoney("£120 per night");
check("parses per-night basis + GBP", perNight.basis === "per_night" && perNight.currency === "GBP");
check("per-night × nights = total", money.toTotal(perNight, { night: 3 }).total === 360);
check("total basis normalizes without quantities", money.toTotal(money.parseMoney("$200 total"), {}).total === 200);
check("plain displayed price defaults to a total", money.toTotal(money.parseMoney("$75"), {}).total === 75);
check("explicit ambiguous scope is NOT treated as a total", money.toTotal(money.parseMoney("$120, varies by selection"), {}).complete === false);
check("'from $99' captured as a starting-from qualifier", money.parseMoney("from $99").qualifier === "from");
check("currencies must match to combine", money.currencyCompatible("USD", "GBP") === false && money.currencyCompatible("USD", "USD") === true);
// (a1) Non-currency unit (seats/units) normalized by quantity before budgeting.
const rUnits = combine.combineDomains([sub("u", "supplies", [priced("Bulk", "$8 per unit")])], { maxPrice: 100, quantities: { unit: 10 } });
// $8/unit × 10 units = $80 ≤ $100 total budget.
check("per-unit quantity scaled before budgeting", rUnits.budget === 100 && rUnits.options[0].totalPrice === 80, JSON.stringify([rUnits.budget, rUnits.options[0].totalPrice]));
// (a2) A per-person budget is scaled by group size before comparing to a total.
const rPP = combine.combineDomains([sub("p", "tour", [priced("Tour", "$40 per person")])], { maxPrice: 50, priceUnit: "person", quantities: { person: 4 } });
// budget $50/person × 4 = $200 total; $40/person × 4 = $160 ≤ 200.
check("per-person budget scaled by group size", rPP.budget === 200 && rPP.options[0].totalPrice === 160, JSON.stringify([rPP.budget, rPP.options[0].totalPrice]));
// (b) Mixed currencies are NEVER summed as if equal.
const rMixed = combine.combineDomains([sub("a", "flights", [priced("AirA", "$300 total")]), sub("b", "hotel", [priced("StayUK", "£200 total")])], {});
check("mixed-currency combo is not totalled", rMixed.options[0].priceComplete === false && rMixed.options[0].totalPrice === null);
check("mixed-currency combo explains why", /mixed currencies/i.test(rMixed.options[0].rationale));
// (c) Unknown price scope is preserved, not guessed against a budget.
const rUnknown = combine.combineDomains([sub("a", "gear", [priced("KitX", "$75, price varies by config")])], { maxPrice: 100 });
check("unknown-scope price → not compared to budget", rUnknown.options[0].priceComplete === false && rUnknown.options[0].withinBudget === false);
// (d) Per-night nightly rate × nights normalized before ranking (multi-domain).
const rNights = combine.combineDomains([sub("a", "lodging", [priced("Inn", "$50 per night"), priced("Suite", "$90 per night")])], { maxPrice: 200, quantities: { night: 3 } });
check("nightly rates normalized to a stay total", rNights.options[0].totalPrice === 150 && rNights.options[0].withinBudget === true, JSON.stringify(rNights.options.map((o) => o.totalPrice)));
check("over-budget stay flagged after normalization", rNights.options.some((o) => o.totalPrice === 270 && o.withinBudget === false));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
