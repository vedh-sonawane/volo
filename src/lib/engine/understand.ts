// ─────────────────────────────────────────────────────────────────────────────
// Understanding stage — parse a natural-language objective into structured
// constraints (Phase 4). This is fully deterministic so it works with zero AI.
// ─────────────────────────────────────────────────────────────────────────────

import type { TaskConstraints } from "@/lib/types";
import { normalizeWs, uniq } from "@/lib/util";
import { classifyObjective } from "./classify";

const WORD_NUMBERS: Record<string, number> = {
  a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, couple: 2, few: 3, several: 4,
};

const DOMAIN_SIGNALS: { domain: TaskConstraints["domain"]; words: string[] }[] = [
  { domain: "instructors", words: ["instructor", "instructors", "tutor", "teacher", "lessons", "lesson", "coach", "driving instructor", "trainer"] },
  { domain: "restaurants", words: ["restaurant", "restaurants", "dinner", "lunch", "brunch", "cuisine", "eat", "dining", "table for", "cafe", "bar"] },
  { domain: "flights", words: ["flight", "flights", "fly", "airfare", "airline", "round trip", "one way", "one-way", "roundtrip"] },
  { domain: "products", words: ["laptop", "laptops", "phone", "headphones", "buy", "product", "monitor", "camera", "gpu", "compare these", "which one"] },
  { domain: "howto", words: ["how to", "how do i", "how can i", "return this", "steps to", "guide to", "instructions for", "return policy"] },
];

const STOPWORDS = new Set([
  "find", "me", "the", "best", "a", "an", "for", "and", "or", "to", "of", "in",
  "on", "with", "under", "near", "my", "i", "want", "need", "get", "that", "this",
  "these", "those", "please", "can", "you", "help", "some", "three", "two", "one",
  "four", "five", "six", "tell", "exactly", "what", "which", "is", "are", "give",
  "us", "them", "their", "options", "option", "available", "availability", "next",
  "week", "weekend", "today", "tonight", "tomorrow", "per", "hour", "person",
  "night", "cheapest", "than", "less", "below", "at", "most", "match", "matches",
  "requirements", "actually", "really", "good", "great",
]);

export function understand(objective: string): TaskConstraints {
  const raw = objective.trim();
  const lower = raw.toLowerCase();

  let domain = detectDomain(lower);
  const { maxPrice, priceUnit } = detectPrice(lower);
  const partySize = detectPartySize(lower);
  const count = detectCount(lower, domain, partySize);
  const location = detectLocation(raw);
  const timeframe = detectTimeframe(lower);
  const keywords = detectKeywords(lower);
  const requirements = detectRequirements(raw);
  const quantities = detectQuantities(lower, partySize);

  // Determine the OUTCOME the objective wants (candidates / procedure / answer).
  // This is intent-level and overrides a shallow keyword domain guess: e.g.
  // "find me an instructor … how to get this done" is a candidates objective,
  // not a how-to, even though it contains "how to".
  const base: TaskConstraints = {
    outcome: "answer",
    entityLabel: "option",
    domain,
    maxPrice,
    priceUnit,
    count,
    partySize,
    location,
    timeframe,
    keywords,
    requirements,
    quantities,
  };
  const intent = classifyObjective(raw, base);

  // Reconcile domain with the outcome so the extraction schema matches:
  //  - a candidates objective must never use the how-to (step) schema
  //  - a procedure objective always uses the how-to (step) schema
  if (intent.outcome === "candidates" && domain === "howto") domain = "general";
  if (intent.outcome === "procedure") domain = "howto";

  return {
    ...base,
    domain,
    outcome: intent.outcome,
    entityLabel: intent.entityLabel,
  };
}

function detectDomain(lower: string): TaskConstraints["domain"] {
  // Explicit how-to phrasing wins outright — even when other nouns appear
  // ("how to return a product" is a how-to, not a product comparison).
  if (/\bhow\s+(to|do|can|should|would)\b|\bsteps?\s+to\b|\breturn (this|a|my|an|the)\b|return policy|instructions for/.test(lower)) {
    return "howto";
  }
  for (const { domain, words } of DOMAIN_SIGNALS) {
    if (words.some((w) => lower.includes(w))) return domain;
  }
  return "general";
}

function detectPrice(lower: string): { maxPrice?: number; priceUnit?: string } {
  // "under $60", "below 1,500", "less than $50", "$1500"
  const m =
    lower.match(/(?:under|below|less than|max(?:imum)?|up to|no more than)\s*\$?\s*([\d,]+(?:\.\d+)?)/) ||
    lower.match(/\$\s*([\d,]+(?:\.\d+)?)/);
  let maxPrice: number | undefined;
  if (m) {
    const n = Number(m[1].replace(/,/g, ""));
    if (!Number.isNaN(n)) maxPrice = n;
  }
  let priceUnit: string | undefined;
  if (/\/\s*hour|per hour|an hour|hourly|\/hr|per hr/.test(lower)) priceUnit = "hour";
  else if (/per person|\/\s*person|each person|pp\b|a head/.test(lower)) priceUnit = "person";
  else if (/per night|\/\s*night|a night/.test(lower)) priceUnit = "night";
  return { maxPrice, priceUnit };
}

// Words that indicate group/party size, NOT the number of options wanted.
const PARTY_NOUNS = "people|persons|person|guests|adults|kids|children|of us|pax";

function detectPartySize(lower: string): number | undefined {
  const m =
    lower.match(new RegExp(`\\b(\\d{1,2})\\s+(?:${PARTY_NOUNS})\\b`)) ||
    lower.match(/\b(?:party|table|group)\s+of\s+(\d{1,2})\b/) ||
    lower.match(/\bfor\s+(\d{1,2})\s+(?:people|of us)\b/);
  if (m) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 30) return n;
  }
  for (const [word, n] of Object.entries(WORD_NUMBERS)) {
    if (n > 1 && new RegExp(`\\b${word}\\b\\s+(?:${PARTY_NOUNS})\\b`).test(lower)) return n;
  }
  return undefined;
}

// Generic quantity extraction — "5 nights", "3 units", "2 hours", "10 seats".
// Maps each plural noun to a normalization basis. Domain-agnostic.
const QTY_NOUNS: { re: RegExp; key: "night" | "unit" | "item" | "use" | "hour" | "month" }[] = [
  { re: /\b(\d{1,3})\s+nights?\b/, key: "night" },
  { re: /\b(\d{1,3})\s+hours?\b/, key: "hour" },
  { re: /\b(\d{1,3})\s+months?\b/, key: "month" },
  { re: /\b(\d{1,3})\s+(?:units?|seats?|tickets?|licen[sc]es?|rooms?|copies|copy)\b/, key: "unit" },
  { re: /\b(\d{1,3})\s+items?\b/, key: "item" },
  { re: /\b(\d{1,3})\s+(?:uses?|rides?|trips?|visits?|sessions?)\b/, key: "use" },
];

function detectQuantities(lower: string, partySize?: number): TaskConstraints["quantities"] {
  const q: NonNullable<TaskConstraints["quantities"]> = {};
  if (partySize) q.person = partySize;
  for (const { re, key } of QTY_NOUNS) {
    const m = lower.match(re);
    if (m) {
      const n = Number(m[1]);
      if (n >= 1 && n <= 999) q[key] = n;
    }
  }
  return Object.keys(q).length ? q : undefined;
}

// The domain noun(s) a "count" number would modify (e.g. "three restaurants").
const DOMAIN_NOUNS: Record<TaskConstraints["domain"], string[]> = {
  instructors: ["instructor", "instructors", "tutor", "tutors", "teacher", "teachers", "option", "options"],
  restaurants: ["restaurant", "restaurants", "place", "places", "spot", "spots", "option", "options"],
  products: ["product", "products", "laptop", "laptops", "phone", "phones", "option", "options"],
  flights: ["flight", "flights", "option", "options", "fare", "fares"],
  howto: ["step", "steps"],
  general: ["option", "options", "result", "results"],
};

function detectCount(
  lower: string,
  domain: TaskConstraints["domain"],
  partySize?: number
): number | undefined {
  const nouns = DOMAIN_NOUNS[domain].join("|");
  // Prefer a number directly modifying the domain noun ("three restaurants").
  const wordAlt = Object.keys(WORD_NUMBERS).join("|");
  const nearNoun = lower.match(
    new RegExp(`\\b(\\d{1,2}|${wordAlt})\\s+(?:of\\s+the\\s+)?(?:best\\s+|top\\s+|cheapest\\s+)?(?:${nouns})\\b`)
  );
  if (nearNoun) {
    const raw = nearNoun[1];
    const n = /^\d+$/.test(raw) ? Number(raw) : WORD_NUMBERS[raw];
    if (n >= 1 && n <= 20) return n;
  }
  // Otherwise, a standalone leading number that isn't the party size.
  for (const [word, n] of Object.entries(WORD_NUMBERS)) {
    if (n > 1 && n !== partySize && new RegExp(`\\b${word}\\b\\s+[a-z]`).test(lower)) {
      // avoid re-matching party-size phrasing
      if (!new RegExp(`\\b${word}\\b\\s+(?:${PARTY_NOUNS})`).test(lower)) return n;
    }
  }
  // Sensible default for list-style objectives.
  if (["instructors", "restaurants", "products", "flights"].includes(domain)) return 3;
  return undefined;
}

// Words that look like a place after "in/near…" but aren't (months, days).
const NON_PLACE = new Set([
  "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december", "monday", "tuesday",
  "wednesday", "thursday", "friday", "saturday", "sunday",
]);

function detectLocation(raw: string): string | undefined {
  const lower = raw.toLowerCase();
  if (/\bnear me\b|\baround me\b|\bin my area\b|\bnearby\b/.test(lower)) return "near me";
  // Prefer "<Place> area" (handles "in the Toronto area").
  const area = raw.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+area\b/);
  if (area && !NON_PLACE.has(area[1].split(/\s+/)[0].toLowerCase())) return normalizeWs(area[1]);
  // "in San Francisco", "near Boston", "around Austin TX" — but not "in September".
  const m = raw.match(/\b(?:in|near|around|at)\s+(?:the\s+)?([A-Z][A-Za-z.\-]+(?:\s+[A-Z][A-Za-z.\-]+){0,3})/);
  if (m) {
    const first = m[1].split(/\s+/)[0].toLowerCase();
    if (!NON_PLACE.has(first)) return normalizeWs(m[1]);
  }
  return undefined;
}

function detectTimeframe(lower: string): string | undefined {
  const patterns = [
    "next week", "this week", "this weekend", "next weekend", "tonight",
    "tomorrow", "today", "this saturday", "this sunday", "this friday",
    "next month", "this month",
  ];
  for (const p of patterns) if (lower.includes(p)) return p;
  const day = lower.match(/\b(?:on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  if (day) return day[1];
  return undefined;
}

function detectKeywords(lower: string): string[] {
  const words = lower
    .replace(/[^a-z0-9\s$]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
  return uniq(words).slice(0, 8);
}

function detectRequirements(raw: string): string[] {
  // Split on connectors that usually introduce constraints.
  const parts = raw
    .split(/[,.;]| with | that | who | which | and | under | near /i)
    .map((p) => normalizeWs(p))
    .filter((p) => p.length > 3);
  return uniq(parts).slice(0, 6);
}
