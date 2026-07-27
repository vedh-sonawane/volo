// ─────────────────────────────────────────────────────────────────────────────
// Generic objective classification + candidate validation.
//
// This module encodes ONE generic idea, applicable to any objective the user
// might type: not everything the system reads is a "candidate". We distinguish
//
//   • outcome type — does the objective want to ACQUIRE/compare real entities
//     ("candidates"), learn a PROCEDURE ("procedure"), or get an informational
//     ANSWER ("answer")?
//   • candidate vs information — for a candidates objective, an extracted row is
//     only a real candidate if it looks like an actual entity (a named provider
//     /product) AND carries concrete provider signals (price, contact, rating,
//     hours, or a specific location). Government guides, FAQs, nav pages, and
//     "The 10 Best … Near Me" listings are INFORMATION, not candidates.
//
// There are NO domain-specific rules here (nothing about driving instructors,
// restaurants, etc.). The tests are structural and work for bike shops,
// campsites, universities, or anything else.
// ─────────────────────────────────────────────────────────────────────────────

import type { ResultItem, TaskConstraints } from "@/lib/types";
import { normalizeWs, uniq } from "@/lib/util";

export type OutcomeType = "candidates" | "procedure" | "answer";

// ── Generic multi-category decomposition (deterministic fallback for BL-2) ────
// Extracts a list of distinct research categories from the objective's OWN words
// so complex "compare A, B, C and D … combine into packages" objectives get a
// real multi-domain plan even without the model. No domain names are hardcoded —
// it parses the user's list. Used only as a fallback when the model planner
// doesn't return a usable decomposition.

const MULTI_SIGNAL =
  /\b(independently|separately|combine[^.]*\b(?:into|as)\b[^.]*\b(?:packages?|combinations?|bundles?)|complete[^.]*\bpackages?\b|combinations?\b|mix and match|each (?:category|component|part|of these))\b/i;

// A verb that introduces a list of things to research/compare, capturing the
// list region up to a sentence break or an "independently/separately" marker.
const LIST_LEAD =
  /\b(?:compare|research|find(?:\s+and\s+compare)?|evaluate|assess|source|get quotes for|look at|gather|shortlist)\b\s+([^.]*?)(?:\s+\bindependently\b|\s+\bseparately\b|\.|$)/i;

const ITEM_FILLERS = /^(?:suitable|various|different|several|the|best|some|good|reliable|local|potential|possible|a|an|and|or|other|multiple|relevant|appropriate|available)\s+/i;

const MONTHS_DAYS = /^(?:january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next|this|last|weekend)$/i;

function cleanCategory(s: string): string {
  let t = normalizeWs(s.toLowerCase());
  let prev = "";
  while (t !== prev) {
    prev = t;
    t = t.replace(ITEM_FILLERS, "");
  }
  return t.trim();
}

/** Find a proper-noun place mentioned in the objective (never a month/day). */
export function placeIn(objective: string): string {
  const m =
    objective.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+area\b/) ||
    objective.match(/\b(?:in|near|around|throughout|across)\s+(?:the\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/);
  if (m && !MONTHS_DAYS.test(m[1].trim())) return m[1].trim();
  return "";
}

/**
 * Decompose a complex objective into research categories, generically. Returns
 * null when the objective is not a multi-category list (so single-domain
 * objectives are unaffected).
 */
export function deterministicDecompose(objective: string, c: TaskConstraints): { label: string; query: string }[] | null {
  const m = objective.match(LIST_LEAD);
  if (!m) return null;
  const items = uniq(
    m[1]
      .split(/\s*,\s*|\s+\band\b\s+|\s+\bor\b\s+/i)
      .map(cleanCategory)
      .filter((s) => s.length >= 3 && s.length <= 40 && /[a-z]/.test(s))
  );
  const hasSignal = MULTI_SIGNAL.test(objective);
  // A 3+ item list is itself a strong multi-category signal; a 2-item list needs
  // an explicit combine/independent signal to avoid splitting single objectives
  // like "laptops for programming and gaming".
  if (!(items.length >= 3 || (items.length >= 2 && hasSignal))) return null;

  const loc = placeIn(objective) || (c.location && c.location !== "near me" && !MONTHS_DAYS.test(c.location) ? c.location : "");
  return items.slice(0, 5).map((it) => ({
    label: it,
    query: `${it}${loc ? ` ${loc}` : ""} cost price`.trim(),
  }));
}

// Generic words that carry no category identity (so two category labels aren't
// judged "the same" just because both say "best" or "options"). No domain nouns.
const CATEGORY_STOP = new Set([
  "the", "a", "an", "and", "or", "for", "of", "to", "in", "best", "top",
  "cheapest", "good", "reliable", "local", "options", "option", "service",
  "services", "provider", "providers", "company", "companies", "suitable",
]);

// Strip a simple trailing plural so "flights" matches "flight". Generic.
function stem(w: string): string {
  return w.length >= 4 && w.endsWith("s") ? w.slice(0, -1) : w;
}

function categoryWords(label: string): string[] {
  return label
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !CATEGORY_STOP.has(w))
    .map(stem);
}

/** Do two category labels refer to the same thing (share a significant word)? */
function categoriesMatch(a: string, b: string): boolean {
  const wa = new Set(categoryWords(a));
  const wb = categoryWords(b);
  if (wa.size === 0 || wb.length === 0) return a.trim().toLowerCase() === b.trim().toLowerCase();
  return wb.some((w) => wa.has(w));
}

/**
 * Never silently omit a requested category. Given the specs a planner produced
 * (model or otherwise) plus the objective, add back any category the objective
 * explicitly listed (per the generic decomposer) that the planner's specs don't
 * already cover. This guarantees every requested component becomes its own
 * researched sub-plan — which then either yields a result or is honestly reported
 * as unavailable downstream. Matching is by shared significant word — generic, no
 * hardcoded domain names.
 */
export function reconcileCategories(
  specs: { label: string; query: string }[],
  objective: string,
  c: TaskConstraints,
  cap = 6
): { label: string; query: string }[] {
  const requested = deterministicDecompose(objective, c);
  if (!requested) return specs.slice(0, cap);

  // A word shared by two or more requested categories is a common HEAD word
  // ("software" in "crm software / payroll software", "companies" in "catering
  // companies / rental companies") — it doesn't distinguish one category from
  // another, so it must not be used to judge two categories "the same". This is
  // derived from the objective's OWN list, not a hardcoded stop-list.
  const freq = new Map<string, number>();
  for (const r of requested) for (const w of new Set(categoryWords(r.label))) freq.set(w, (freq.get(w) || 0) + 1);
  const common = new Set([...freq].filter(([, n]) => n >= 2).map(([w]) => w));
  const distinctive = (label: string) => categoryWords(label).filter((w) => !common.has(w));
  const match = (a: string, b: string) => {
    const da = new Set(distinctive(a));
    const db = distinctive(b);
    if (da.size === 0 || db.length === 0) return categoriesMatch(a, b);
    return db.some((w) => da.has(w));
  };

  const out = [...specs];
  for (const req of requested) {
    if (!out.some((s) => match(s.label, req.label))) out.push(req);
  }
  return out.slice(0, cap);
}

/**
 * Does the objective genuinely call for a MULTI-category decomposition — i.e. it
 * enumerates independent categories to compare/combine, or explicitly asks to
 * combine/mix them? Used to reject invented categories: a planner may only split
 * an objective the user actually phrased as multi-category, never as a fallback
 * for "I don't know how to answer this". Generic — driven by the user's words.
 */
export function hasMultiCategorySignal(objective: string, c: TaskConstraints): boolean {
  return deterministicDecompose(objective, c) !== null || MULTI_SIGNAL.test(objective);
}

export interface ObjectiveIntent {
  outcome: OutcomeType;
  /** Human label for one candidate, e.g. "driving instructor", or "option". */
  entityLabel: string;
}

// Verbs that mean "acquire / choose among real entities".
const ACQUIRE =
  /\b(find|get|book|hire|buy|purchase|rent|reserve|choose|pick|compare|shortlist|source|locate|search for|look(?:ing)? for|need|want|recommend|suggest)\b/;

// Cues that the user wants to SELECT among options (implies candidates).
const SELECTION_CUES =
  /\b(best|top|cheapest|nearest|near me|nearby|options?|three|two|\d+\s+(?:of|best)|under\s*\$?\d|below\s*\$?\d|per\s+(?:hour|person|night)|rated|reviews?|compare|vs\.?|versus|shortlist)\b/;

// Procedure/outcome intents (a process, not a provider you pick from a list).
const PROCEDURE =
  /\b(how\s+(?:to|do|can|should|would)\b|steps?\s+to\b|guide\s+to\b|walk me through|cancel|unsubscribe|refund|return(?:ing)?\b|dispute|set\s*up|install|uninstall|troubleshoot|reset|understand\s+(?:how|the process|whether)|process\s+(?:for|of)|instructions?\s+for)\b/;

// Nouns that are outcomes/processes rather than selectable entities. If the
// acquisition target is one of these, it's a procedure ("get a refund"), not a
// list of candidates. Kept generic and small.
const PROCESS_OBJECT =
  /\b(refund|return|cancellation|subscription|chargeback|reimbursement|complaint|dispute|warranty claim|password|account)\b/;

/**
 * Classify an objective into an outcome type + a human entity label. Fully
 * deterministic and generic. (A model may refine this later — Phase 5 — but the
 * product must not depend on one, so the default is rule-based.)
 */
export function classifyObjective(objective: string, constraints: TaskConstraints): ObjectiveIntent {
  const lower = objective.toLowerCase();

  const hasAcquire = ACQUIRE.test(lower);
  const hasSelection = SELECTION_CUES.test(lower) || constraints.maxPrice != null || !!constraints.count;
  const hasProcedure = PROCEDURE.test(lower);
  const targetsProcess = PROCESS_OBJECT.test(lower);

  let outcome: OutcomeType;
  if ((hasAcquire || hasSelection) && !targetsProcess) {
    // Wants to acquire/compare concrete entities — even if "how to" also appears
    // (e.g. "find me an instructor … how to get this done" is still candidates).
    outcome = "candidates";
  } else if (hasProcedure || targetsProcess) {
    outcome = "procedure";
  } else if (hasAcquire || hasSelection) {
    outcome = "candidates";
  } else {
    outcome = "answer";
  }

  return { outcome, entityLabel: entityLabelFor(objective, outcome, constraints) };
}

// Common, generic entity nouns. Used ONLY to pick a nice singular display label
// for the candidate ("campsite", "university"). Validation never depends on it.
const ENTITY_NOUNS = [
  "instructor", "tutor", "teacher", "school", "shop", "store", "mechanic",
  "restaurant", "cafe", "campsite", "campground", "hotel", "motel", "university",
  "college", "laptop", "phone", "camera", "clinic", "dentist", "doctor",
  "plumber", "electrician", "contractor", "lawyer", "flight", "course", "class",
  "gym", "salon", "studio", "provider", "apartment", "house", "car", "bike",
  "bicycle", "agency", "hospital", "vet", "barber",
];

function entityLabelFor(objective: string, outcome: OutcomeType, c: TaskConstraints): string {
  if (outcome === "procedure") return "step";
  if (outcome === "answer") return "finding";
  const lower = objective.toLowerCase();
  // Known specific domains get their canonical noun.
  const map: Record<string, string> = {
    instructors: "instructor",
    restaurants: "restaurant",
    products: "product",
    flights: "flight option",
  };
  if (c.domain in map) return map[c.domain];
  // Otherwise pick the first recognisable entity noun the user actually typed
  // (matching singular or simple plural). Clean single word → clean copy.
  for (const noun of ENTITY_NOUNS) {
    const plural = noun.endsWith("y") ? `${noun.slice(0, -1)}(?:y|ies)` : `${noun}(?:s|es)?`;
    if (new RegExp(`\\b${plural}\\b`, "i").test(lower)) return noun;
  }
  return "option";
}

/** Simple, safe English pluralisation for display copy. */
export function pluralize(word: string, n = 2): string {
  if (n === 1) return word;
  if (/(?:s|x|ch|sh)$/i.test(word)) return word + "es";
  if (/[^aeiou]y$/i.test(word)) return word.slice(0, -1) + "ies";
  if (/s$/i.test(word)) return word;
  return word + "s";
}

// ── Action intent ────────────────────────────────────────────────────────────
// Beyond WHAT the objective wants (outcome), does it ask the system to DO
// something with external consequences — contact a provider, book, submit a
// form, cancel, request a refund? These drive which ACTION tools the planner
// appends. Generic verb detection; not tied to any objective type.

export interface ActionIntent {
  contact: boolean; // reach out to a provider (email/message enquiry)
  book: boolean; // make a booking / reservation / appointment
  submit: boolean; // submit a form / application / sign-up / cancellation
  awaitReply: boolean; // wait for and process an external reply
}

export function detectActions(objective: string): ActionIntent {
  const l = objective.toLowerCase();
  const book = /\b(book|booked|booking|reserve|reservation|schedule (?:an? )?appointment|get me (?:in|a slot|an appointment))\b/.test(l);
  const contact =
    /\b(contact|enquir|inquir|reach out|get in touch|message|e-?mail(?:\s+them)?|call them|ask them)\b/.test(l) ||
    /\bget me (?:a )?(?:refund|quote|response)\b/.test(l);
  const submit =
    /\b(submit|apply|application|sign ?up|register me|fill (?:out|in)|complete the form|cancel(?:\s+my)?|unsubscribe|request a refund)\b/.test(l);
  const wantsExecution =
    /\b(get (?:me|it) (?:done|booked|sorted)|actually (?:book|do|send|cancel)|do it for me|complete this|handle (?:it|this))\b/.test(l);

  return {
    contact: contact || book || wantsExecution,
    book,
    submit,
    awaitReply: contact || book || submit || wantsExecution,
  };
}

// ── Candidate validation ─────────────────────────────────────────────────────

// A name that is a document / navigation / action / question / listing title,
// i.e. NOT the name of a real entity. All patterns are generic.
const NON_ENTITY_NAME: RegExp[] = [
  // leading imperative / procedural verb
  /^(register|renew|apply|appeal|cancel|return|subscribe|unsubscribe|sign\s?up|sign\s?in|log\s?in|download|upload|learn|understand|discover|explore|read|browse|search|get\s+started|set\s*up|start|manage|update|change|report|track|check)\b/i,
  // question / temporal / interrogative lead
  /^(how|why|what|when|where|who|which|should|can|do|does|is|are)\b/i,
  // generic nav / section labels
  /^(fees?|costs?|pricing|prices|more\s+information|overview|introduction|conclusion|summary|faqs?|terms|privacy|policy|cookie|contact(?:\s+us)?|about(?:\s+us)?|home|menu|help|support|guides?|resources?|news|blog|articles?|category|categories|directory|listings?)\b/i,
  // listicle / aggregator titles ("The 10 Best X Near Me", "Top 5 …")
  /^(the\s+)?\d*\s*(best|top|cheapest|greatest|leading|ultimate|essential)\b/i,
  /\b(near me|reviews?|comparison|buyer'?s guide|round[- ]?up|list of|guide (?:to|for))\b/i,
];

/** Does this name look like a real entity (provider/product), not a document? */
export function isEntityName(name: string): boolean {
  const n = name.trim();
  if (n.length < 3) return false;
  if (NON_ENTITY_NAME.some((re) => re.test(n))) return false;
  // Require at least one capitalised, non-acronym word OR a model token — the
  // hallmark of a proper name. (A generic phrase like "not stated" fails this.)
  const hasProper = /\b[A-Z][a-z]{1,}\b/.test(n) || /\d/.test(n);
  return hasProper;
}

/**
 * Count concrete provider signals in a row's attributes. A page host recorded as
 * "website"/"booking"/"source" is NOT concrete (every page has a host); we count
 * only signals that a real listing carries.
 */
export function concreteSignalCount(item: ResultItem): number {
  const a = item.attributes;
  let n = 0;
  if (a.price) n++;
  if (a.rating) n++;
  if (a.contact) n++;
  if (a.hours) n++;
  // A specific location (not blank, not "near me", not "not stated") counts.
  if (a.location && !/^(near me|not stated|n\/a)$/i.test(a.location.trim())) n++;
  return n;
}

/**
 * Is this candidate topically relevant to what the objective is looking for?
 * A provider with a price + phone is only a valid candidate if it's the RIGHT
 * KIND of thing — a bike-repair search must not accept a campground just because
 * it has an address. We check the row's text against the objective's own entity
 * terms (its meaningful nouns, minus location/price noise). Generic: it uses the
 * user's words, never a hardcoded entity list.
 */
export function isTopicallyRelevant(item: ResultItem, entityTerms: string[]): boolean {
  if (entityTerms.length === 0) return true; // nothing to anchor on → don't over-filter
  const hay = (
    item.name +
    " " +
    (item.evidence || "") +
    " " +
    Object.values(item.attributes).join(" ") +
    " " +
    (item.evidenceUrl || "")
  ).toLowerCase();
  return entityTerms.some((t) => hay.includes(t));
}

// ── Specific option vs. aggregate/directory/search/informational page ─────────
// Capability: a "candidate" must be ONE specific, actionable, verifiable entity —
// not a generic aggregate page (a search-results URL, a directory/category index,
// a "browse/explore" hub, or a listicle). All patterns are structural and
// domain-agnostic: they look at the URL SHAPE and generic listing words, never at
// any particular industry. A candidate whose only evidence is such a page must
// not be presented as a confirmed specific option.

// Query params that mean "this is a search/results page", and path segments that
// are generic index/aggregate endpoints (matched as whole path segments).
const AGGREGATE_URL =
  /[?&](?:q|query|search|keyword|kw|find|term)=|\/(?:search|find|directory|browse|explore|discover|category|categories|results?|listing|listings|tag|tags|topics?|collections?|compare|best-?of|top-?\d+|s)(?:[/?#]|$)/i;

// Generic aggregate/informational titles not already caught by NON_ENTITY_NAME.
const AGGREGATE_NAME =
  /\b(?:directory|search results?|browse|explore|listings?|results?\s+for|marketplace|comparison\s+site|price\s+comparison|aggregat)\b/i;

/**
 * Does this row's evidence point at a generic aggregate/search/directory/
 * informational page rather than one specific entity? Generic & structural.
 */
export function isAggregateSource(url?: string, name?: string): boolean {
  if (url && AGGREGATE_URL.test(url)) return true;
  if (name && AGGREGATE_NAME.test(name)) return true;
  return false;
}

/**
 * Generic decision: for a "candidates" objective, is this row an actual
 * candidate entity, or merely information? Requires a real entity name, at least
 * one concrete provider signal, topical relevance to the objective, AND that its
 * evidence is a specific page — not a generic aggregate/directory/search page.
 */
export function isValidCandidate(item: ResultItem, entityTerms: string[] = []): boolean {
  return (
    isEntityName(item.name) &&
    concreteSignalCount(item) >= 1 &&
    isTopicallyRelevant(item, entityTerms) &&
    !isAggregateSource(item.evidenceUrl, item.name)
  );
}
