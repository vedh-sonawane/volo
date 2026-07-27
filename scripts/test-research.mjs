// Behavioral tests for the DuckDuckGo research provider's HONEST status model.
//
// Drives the REAL provider (parsing + search orchestration) with a stubbed
// global fetch, so every outcome is deterministic and offline:
//   • successful results, genuine zero results (empty),
//   • rate-limiting (HTTP 429 AND anomaly-page body),
//   • malformed / unparseable response (anchors present but nothing extractable),
//   • timeout (aborted request) and network error,
//   • endpoint fallback (HTML empty/failed → Lite serves results),
//   • combined-status honesty (a failure is never masked as "no results").
//
// Run: node scripts/test-research.mjs   (wired into `npm test`)

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

const util = { normalizeWs: (s) => s.replace(/\s+/g, " ").trim() };
const ddg = loadTs("src/lib/providers/research/duckduckgo.ts", {
  "@/lib/util": util,
  "./extract": { extractReadable: () => ({ title: "", text: "", links: [] }) },
  "./types": {},
});
const { DuckDuckGoProvider, parseHtml, parseLite } = ddg;
const cheerio = require("cheerio");

let pass = 0, fail = 0;
const check = (n, c, e = "") => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

// ── HTML fixtures that mirror the real DDG markup ────────────────────────────
const link = (target) => `/l/?uddg=${encodeURIComponent(target)}`;
function htmlResults() {
  return `<div id="links" class="results">
    <div class="results_links results_links_deep web-result">
      <div class="links_main links_deep result__body">
        <h2 class="result__title"><a class="result__a" href="${link("https://alpha.example/a")}">Alpha Site</a></h2>
        <a class="result__snippet">Alpha snippet text.</a>
      </div>
    </div>
    <div class="results_links web-result">
      <div class="links_main result__body">
        <h2 class="result__title"><a class="result__a" href="${link("https://beta.example/b")}">Beta Site</a></h2>
        <a class="result__snippet">Beta snippet text.</a>
      </div>
    </div>
    <div class="results_links web-result result--ad">
      <div class="links_main result__body result--ad">
        <h2 class="result__title"><a class="result__a" href="${link("https://ad.example/x")}">Sponsored</a></h2>
      </div>
    </div>
    <div class="results_links web-result">
      <div class="links_main result__body">
        <h2 class="result__title"><a class="result__a" href="${link("https://alpha.example/a")}">Alpha Dup</a></h2>
      </div>
    </div>
  </div>`;
}
const htmlEmpty = `<div id="links" class="results"><div class="no-results">No results.</div></div>`;
const htmlAnomaly = `<html><body><h1>Our systems have detected unusual traffic from your computer network.</h1></body></html>`;
const htmlUnparseable = `<div id="links" class="results"><div class="result__body"><h2><a class="result__a" href="javascript:void(0)">Broken</a></h2></div></div>`;
const liteResults = `<table><tr><td><a class="result-link" href="${link("https://gamma.example/g")}">Gamma Site</a></td></tr></table>`;
const liteEmpty = `<table class="filters"><tr><td>No more results.</td></tr></table>`;

// A minimal Response-like stub.
function resp(status, body) {
  return { status, ok: status >= 200 && status < 300, url: "", async text() { return body; } };
}
function abortErr() { const e = new Error("The operation was aborted"); e.name = "AbortError"; return e; }

// Install a fetch stub. `handler(url)` returns a Response stub or throws.
function setFetch(handler) { globalThis.fetch = async (url) => handler(String(url)); }
const isLite = (u) => u.includes("lite.duckduckgo");

async function main() {
  const provider = new DuckDuckGoProvider();

  // ── Pure parsing (exported) ────────────────────────────────────────────────
  console.log("Parsing:");
  const parsed = parseHtml(cheerio.load(htmlResults()), 8);
  check("extracts results via result anchors (not a stale wrapper class)", parsed.length === 2, JSON.stringify(parsed.map((r) => r.url)));
  check("unwraps DDG redirect to the real URL", parsed[0].url === "https://alpha.example/a", parsed[0].url);
  check("captures the snippet from the result body", parsed[0].snippet === "Alpha snippet text.", parsed[0].snippet);
  check("skips sponsored (ad) results", !parsed.some((r) => r.url.includes("ad.example")));
  check("de-duplicates repeated URLs", parsed.filter((r) => r.url === "https://alpha.example/a").length === 1);
  const parsedLite = parseLite(cheerio.load(liteResults), 8);
  check("lite parser extracts result-link anchors", parsedLite.length === 1 && parsedLite[0].url === "https://gamma.example/g");

  // ── Status model via search() ──────────────────────────────────────────────
  console.log("Search status model:");

  // (1) success
  setFetch((u) => resp(200, isLite(u) ? liteEmpty : htmlResults()));
  let r = await provider.search("anything", 8);
  check("results present → status ok", r.status === "ok" && r.results.length === 2, JSON.stringify([r.status, r.results.length]));

  // (2) genuine zero results (both endpoints respond, nothing matches)
  setFetch((u) => resp(200, isLite(u) ? liteEmpty : htmlEmpty));
  r = await provider.search("zxqwlkjhg nonexistent", 8);
  check("genuine zero results → status empty", r.status === "empty" && r.results.length === 0, JSON.stringify(r));

  // (3) rate limited by HTTP status (429 on both)
  setFetch(() => resp(429, "too many"));
  r = await provider.search("anything", 8);
  check("HTTP 429 → status rate_limited (not empty)", r.status === "rate_limited" && r.results.length === 0, JSON.stringify(r));
  check("rate_limited carries an honest reason", !!r.error);

  // (4) rate limited by anomaly/block page (200 body)
  setFetch(() => resp(200, htmlAnomaly));
  r = await provider.search("anything", 8);
  check("anomaly/block page → status rate_limited", r.status === "rate_limited", JSON.stringify(r));

  // (5) malformed / unparseable (anchors present but nothing extractable)
  setFetch(() => resp(200, htmlUnparseable));
  r = await provider.search("anything", 8);
  check("anchors present but unparseable → status error (not empty)", r.status === "error", JSON.stringify(r));

  // (6) timeout (request aborted)
  setFetch(() => { throw abortErr(); });
  r = await provider.search("anything", 8);
  check("aborted request → status timeout", r.status === "timeout", JSON.stringify(r));

  // (7) network error
  setFetch(() => { throw new Error("ECONNREFUSED"); });
  r = await provider.search("anything", 8);
  check("network failure → status error", r.status === "error" && /ECONNREFUSED/.test(r.error || ""), JSON.stringify(r));

  // (8) endpoint fallback: HTML empty → Lite serves results → overall ok
  setFetch((u) => resp(200, isLite(u) ? liteResults : htmlEmpty));
  r = await provider.search("anything", 8);
  check("HTML empty but Lite has results → ok (fallback)", r.status === "ok" && r.results.length === 1 && r.via === "lite.duckduckgo.com", JSON.stringify([r.status, r.via]));

  // (9) failure precedence: HTML 429, Lite network error → rate_limited wins
  setFetch((u) => { if (isLite(u)) throw new Error("boom"); return resp(429, "x"); });
  r = await provider.search("anything", 8);
  check("HTML rate_limited + Lite error → rate_limited (most informative)", r.status === "rate_limited", JSON.stringify(r));

  // (10) a definitive empty from either endpoint is honored over the other's failure
  setFetch((u) => (isLite(u) ? resp(200, liteEmpty) : resp(500, "err")));
  r = await provider.search("anything", 8);
  check("HTML error + Lite empty → empty (authoritative zero)", r.status === "empty", JSON.stringify(r));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
