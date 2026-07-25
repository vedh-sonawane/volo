// ─────────────────────────────────────────────────────────────────────────────
// Structured extraction (Phase 6). Turns fetched, readable page content into
// evidence-backed ResultItem rows. Fully deterministic — every field is either
// pulled from the page text (with a supporting snippet) or left blank. Volo
// never invents a value it did not find.
// ─────────────────────────────────────────────────────────────────────────────

import type { FetchedPage } from "@/lib/providers/research";
import type { ResultItem, TaskConstraints } from "@/lib/types";
import { schemaFor } from "./domains";
import { clamp, hostOf, id, normalizeWs, truncate } from "@/lib/util";

const RE = {
  price: /(?:\$|usd\s?|£|€|aud\s?|cad\s?)\s?(\d{1,3}(?:[.,]\d{3})*(?:\.\d{2})?)\s*(?:\/|per|an|a)?\s*(hour|hr|person|night|day|month|week)?/i,
  phone: /(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})(?!\d)/,
  email: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i,
  rating: /\b([0-5](?:\.\d)?)\s?(?:\/\s?5|out of 5|stars?|★)/i,
  cityState: /([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?,\s?[A-Z]{2})\b/,
  hours: /\b((?:mon|tue|wed|thu|fri|sat|sun)[a-z]*(?:[-–]\s?(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*)?[^.\n]{0,30}\d{1,2}(?::\d{2})?\s?(?:am|pm))/i,
};

const LISTICLE_LINE = /^#?\s*(\d{1,2})[.)]\s+(.{3,70}?)\s*:?\s*$/;

/** Extract structured rows from all fetched pages, tagged to their source. */
export function extractStructured(
  pages: FetchedPage[],
  c: TaskConstraints
): ResultItem[] {
  const schema = schemaFor(c.domain);
  const rows: ResultItem[] = [];

  for (const page of pages) {
    if (!page.ok || page.words < 30) continue;
    const lines = page.text.split("\n");

    // 1) Mine listicle entities ("1. Joe's Driving School").
    const named = mineListicle(lines);
    const isListicle = named.length >= 2;
    if (isListicle) {
      for (const n of named.slice(0, 8)) {
        rows.push(buildRow(n.name, n.context, page, c, schema.columns, 0.6));
      }
    }

    // 2) Add the page itself as a candidate ONLY when it is NOT a listicle
    //    index — i.e. an individual entity page, official page, or prose how-to
    //    guide. This keeps listicle *titles* ("Top 10 Best…") and duplicate
    //    guide headings out of the results.
    if (!isListicle) {
      const primaryName = cleanTitle(page.title, hostOf(page.finalUrl));
      rows.push(buildRow(primaryName, page.text.slice(0, 1200), page, c, schema.columns, 0.58));
    }
  }

  return dedupeByName(rows);
}

// Strong article-subheading signals — words that almost never appear in a real
// entity name, so matching one (without a model token) marks a section heading
// rather than a named option. Deliberately narrow to avoid dropping legit names
// like "Basic Economy" or "Half Price Books".
const SECTION_WORDS =
  /\b(synergy|realities|overview|introduction|conclusion|takeaways?|verdict|faq|pros and cons|considerations)\b/i;

function mineListicle(lines: string[]): { name: string; context: string }[] {
  const out: { name: string; context: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(LISTICLE_LINE);
    if (m) {
      const name = normalizeWs(m[2]).replace(/[–—-].*$/, "").trim();
      if (name.length < 3 || name.length > 60) continue;
      if (/^(the|top|best|reasons?|tips?|ways?|steps?)\b/i.test(name)) continue;

      // A real option is either a proper noun (a capitalised, non-acronym word)
      // or carries a model token containing a digit (e.g. "RTX 4060", "M3").
      const hasModelToken = /\d/.test(name);
      const looksNamed = /\b[A-Z][a-z]{2,}\b/.test(name);
      if (!looksNamed && !hasModelToken) continue;

      // Reject editorial subheadings, which tend to (a) join clauses with "&",
      // (b) start with a gerund ("Focusing Only on Price"), or (c) contain a
      // strong section word — unless a model token proves it names a product.
      if (!hasModelToken) {
        if (/\s&\s/.test(name)) continue;
        if (/^[a-z]+ing\b/i.test(name)) continue;
        if (SECTION_WORDS.test(name)) continue;
      }

      const context = normalizeWs([lines[i], lines[i + 1], lines[i + 2]].join(" "));
      out.push({ name, context });
    }
  }
  return out;
}

function buildRow(
  name: string,
  context: string,
  page: FetchedPage,
  c: TaskConstraints,
  columns: string[],
  baseConfidence: number
): ResultItem {
  const attrs: Record<string, string> = {};
  let filled = 0;
  let evidence = "";

  // IMPORTANT (honesty): extract every field ONLY from `context` — the text
  // scoped to THIS option. We never borrow a neighbouring entity's price,
  // contact, or hours from elsewhere on the page.
  const src = context;

  const priceM = src.match(RE.price);
  if (columns.includes("price") && priceM) {
    const unit = priceM[2] ? `/${priceM[2].toLowerCase()}` : c.priceUnit ? `/${c.priceUnit}` : "";
    attrs.price = `$${priceM[1]}${unit}`;
    filled++;
    evidence = evidence || sentenceAround(src, priceM.index ?? 0);
  }

  if (columns.includes("rating")) {
    const r = src.match(RE.rating);
    if (r) {
      attrs.rating = `${r[1]}/5`;
      filled++;
    }
  }

  if (columns.includes("location")) {
    const loc =
      (c.location && c.location !== "near me" && new RegExp(escapeRe(c.location), "i").test(src)
        ? c.location
        : "") || src.match(RE.cityState)?.[1];
    if (loc) {
      attrs.location = normalizeWs(loc);
      filled++;
    }
  }

  if (columns.includes("hours")) {
    const h = src.match(RE.hours);
    if (h) {
      attrs.hours = truncate(normalizeWs(h[1]), 40);
      filled++;
    }
  }

  if (columns.includes("contact")) {
    const phone = src.match(RE.phone)?.[0];
    const email = src.match(RE.email)?.[0];
    const contact = email || (phone && phone.replace(/\D/g, "").length >= 10 ? normalizeWs(phone) : "");
    if (contact) {
      attrs.contact = contact;
      filled++;
    }
  }

  if (columns.includes("website") || columns.includes("booking")) {
    const key = columns.includes("website") ? "website" : "booking";
    attrs[key] = hostOf(page.finalUrl);
    filled++;
  }

  // Domain freeform columns get a best-effort snippet so the table is useful.
  for (const col of columns) {
    if (attrs[col]) continue;
    if (["summary", "detail", "specs", "cuisine", "step", "route", "airline", "seller", "warranty", "return_policy", "dietary", "times", "stops", "source", "availability"].includes(col)) {
      if (col === "source") attrs[col] = hostOf(page.finalUrl);
      else if (col === "availability" && c.timeframe) attrs[col] = mentions(src, c.timeframe) ? `mentions "${c.timeframe}"` : "not stated";
      else {
        const snip = pickSnippet(src, col);
        if (snip) {
          attrs[col] = truncate(snip.replace(/[.;]$/, ""), 80);
          filled++;
        }
      }
    }
  }

  if (!evidence) evidence = truncate(normalizeWs(src), 160);

  const confidence = clamp(baseConfidence + Math.min(0.3, filled * 0.06));

  return {
    id: id("r_"),
    name: truncate(name, 70),
    attributes: attrs,
    evidenceUrl: page.finalUrl,
    evidence,
    confidence,
  };
}

function pickSnippet(text: string, keyword: string): string {
  const idx = text.toLowerCase().indexOf(keyword.toLowerCase());
  if (idx >= 0) return sentenceAround(text, idx);
  return "";
}

function sentenceAround(text: string, index: number): string {
  const start = Math.max(0, text.lastIndexOf(".", index) + 1);
  let end = text.indexOf(".", index + 1);
  if (end < 0) end = Math.min(text.length, index + 160);
  return normalizeWs(text.slice(start, end + 1));
}

function mentions(text: string, term: string): boolean {
  return text.toLowerCase().includes(term.toLowerCase());
}

function cleanTitle(title: string, host: string): string {
  let t = normalizeWs(title);
  // Drop trailing " | Site Name" / " - Site Name" boilerplate.
  t = t.split(/\s[|–—-]\s/)[0];
  if (t.length < 3) t = host;
  return truncate(t, 70);
}

function dedupeByName(rows: ResultItem[]): ResultItem[] {
  const seen = new Map<string, ResultItem>();
  for (const r of rows) {
    const key = r.name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 24);
    if (!key) continue;
    const existing = seen.get(key);
    // Keep the higher-confidence / more-populated row.
    if (!existing || Object.keys(r.attributes).length > Object.keys(existing.attributes).length) {
      seen.set(key, r);
    }
  }
  return Array.from(seen.values());
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
