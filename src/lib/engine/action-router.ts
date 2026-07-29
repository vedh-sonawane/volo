// ─────────────────────────────────────────────────────────────────────────────
// Objective routing layer (generic, domain-agnostic).
//
// BEFORE any research or planning, decide WHAT KIND of objective this is:
//
//   • direct_action — the user asked to perform a concrete, executable action
//     (send an email to a specific address, add a calendar event with details,
//     submit a form to a given URL, pay a supported target, book a specific link)
//     AND supplied a concrete target. This must NOT be forced through the
//     research/recommendation pipeline: no web search for the target, no
//     candidate extraction, no comparison categories, no placeholder recipient,
//     and the user's exact parameters are preserved verbatim.
//
//   • mixed — an action is wanted but its target must be researched first
//     ("book the best hotel"). Research → compare → approve a specific option →
//     act, preserving that dependency order.
//
//   • research — acquire/compare real entities, or learn a procedure.
//
//   • informational — synthesize an answer from sources; no action.
//
// The decision is based on the verb, whether a concrete/validatable target is
// present for an executable capability, and that capability's required
// parameters — never on any specific domain (email/wedding/travel/etc.). Each
// capability is described by a small, generic "contract": how to recognise it,
// how to extract its parameters, and which parameters are required. Adding a
// capability means adding one contract, not touching the router.
// ─────────────────────────────────────────────────────────────────────────────

import type { ActionCapability, DirectAction, ObjectiveRoute, TaskConstraints } from "@/lib/types";

export interface RouteDecision {
  route: ObjectiveRoute;
  action?: DirectAction;
}

// ── shared, domain-neutral extractors ────────────────────────────────────────
const EMAIL_G = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;
const EMAIL_1 = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/;
const URL_1 = /https?:\/\/[^\s"'<>]+/i;
// A URI with ANY scheme (http, https, sandbox, upi, paypal, bitcoin, …). Payment
// and transfer rails use many schemes, not only the web's http(s). Generic — no
// scheme is hardcoded to a particular provider.
const ANY_URI = /[a-z][a-z0-9+.\-]*:\/\/[^\s"'<>]+/i;

// A user asking to research/choose ("find/best/cheapest…") means an action's
// target is not yet known → the action must be preceded by research (mixed).
const RESEARCH_LEAD = /\b(find|search|look\s+for|compare|research|shortlist|recommend|suggest|best|cheapest|top|nearest|good|reliable|which\s+(?:one|is)|browse|explore)\b/i;

// Signals that an INFORMATIONAL request depends on EXTERNAL or CURRENT world-state
// (so it must be researched rather than answered from general knowledge). This is
// the objective's own natural wording — the user never has to add magic keywords.
// It is generic (temporal / live-data / verification cues), not domain-specific.
const NEEDS_EXTERNAL =
  /\b(search|look\s*up|find\s+out|google|browse|research|latest|current(?:ly)?|today|tonight|right\s+now|as\s+of|up[-\s]?to[-\s]?date|recent(?:ly)?|news|headlines?|weather|forecast|stock|shares?\s+price|exchange\s+rate|scores?|standings?|schedule|open\s+now|near\s+me|nearby|this\s+(?:week|weekend|month|year)|next\s+(?:week|weekend|month|year)|in\s+20\d\d|\b20\d\d\b|sources?|cite|according\s+to|reference|verify|fact[-\s]?check|online|live|in\s+stock|availability|available\b)/i;

/** Does an informational objective require external/current facts (→ research)? */
export function needsExternalFacts(objective: string): boolean {
  return NEEDS_EXTERNAL.test(objective);
}

// Only create a reply-monitoring step when the user explicitly asks for it.
const MONITOR_REQ = /\b(monitor|watch|wait\s+for\s+(?:a\s+)?(?:reply|response|answer)|track\s+(?:the\s+)?(?:reply|response)|let\s+me\s+know\s+when|notify\s+me\s+when|follow[\s-]?up\s+(?:on|when))\b/i;

/** A real, sendable recipient — rejects placeholders / example addresses. */
function isRealEmail(a: string): boolean {
  if (!a) return false;
  if (/\[|\]|add the provider|example\.com|not found|recipient@|the provider/i.test(a)) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(a.trim());
}

function firstUrl(o: string): string {
  const m = o.match(URL_1);
  return m ? m[0].replace(/[.,;]+$/, "") : "";
}

/**
 * Extract a payment target: any URI (ANY scheme, e.g. https://…, sandbox://…,
 * upi://…) OR an email/handle. Broader than a web URL because money moves over
 * many rails. Validation downstream still rejects placeholders/empty — this only
 * captures whatever concrete target the user actually supplied, verbatim.
 */
function paymentTarget(o: string): string {
  const uri = o.match(ANY_URI);
  if (uri) return uri[0].replace(/[.,;]+$/, "");
  const email = (o.match(EMAIL_1) || [])[0];
  return email || "";
}

/** A monetary amount if one is present (normalized digits, no thousands separators). */
function extractAmount(o: string): string {
  const m =
    o.match(/(?:\$|£|€)\s?([\d,]+(?:\.\d+)?)/) ||
    o.match(/\b(?:usd|cad|gbp|eur)\s?([\d,]+(?:\.\d+)?)/i) ||
    o.match(/\b([\d,]+(?:\.\d+)?)\s*(?:dollars|pounds|euros|usd|cad|gbp|eur)\b/i);
  return m ? m[1].replace(/,/g, "") : "";
}

function extractCurrency(o: string): string {
  if (/\bcad\b|\bC\$/.test(o)) return "CAD";
  if (/\bgbp\b|£/.test(o)) return "GBP";
  if (/\beur\b|€/.test(o)) return "EUR";
  if (/\busd\b|\$/.test(o)) return "USD";
  return "";
}

// ── capability contracts ─────────────────────────────────────────────────────
// Each returns a DirectAction when its verb/intent matches, with whatever
// parameters were supplied (verbatim) and a list of what's still required.

function detectEmail(o: string): DirectAction | null {
  const hasEmailWord = /\b(e-?mail|inbox)\b/i.test(o);
  const emails = o.match(EMAIL_G) || [];
  const sendVerb = /\b(send|write|compose|shoot|forward|reply|draft|fire\s+off)\b/i.test(o);
  if (!hasEmailWord && !(sendVerb && emails.length)) return null;

  const to = pickRecipient(o, emails);
  const subject = extractSubject(o);
  const body = extractBody(o);

  const params: Record<string, string> = {};
  if (subject) params.subject = subject;
  if (body) params.body = body;

  const missing: string[] = [];
  if (!isRealEmail(to)) missing.push("recipient");
  if (!subject) missing.push("subject");
  if (!body) missing.push("body");

  return { capability: "send_email", target: isRealEmail(to) ? to : "", params, requiredMissing: missing, monitor: MONITOR_REQ.test(o) };
}

function pickRecipient(o: string, emails: string[]): string {
  const m = o.match(/\bto\s+<?([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})>?/i);
  if (m) return m[1];
  return emails[0] || "";
}

function extractSubject(o: string): string {
  const q = o.match(/\bsubject\b\s*(?:line\s*)?(?:of|:|=|is|being|reads?)?\s*["'“”](.+?)["'“”]/i);
  if (q) return q[1].trim();
  const u = o.match(/\bsubject\b\s*(?:line\s*)?(?:of|:|=|is|being)?\s+(.+?)(?=\s+(?:and\s+|,\s*)?(?:body|message|content|text)\b|[.\n;]|$)/i);
  return u ? u[1].trim() : "";
}

function extractBody(o: string): string {
  const q = o.match(/\b(?:body|message|content|text|saying|that\s+says|which\s+says)\b\s*(?:of|:|=|is|that\s+reads|reads)?\s*["'“”](.+?)["'“”]/i);
  if (q) return q[1].trim();
  const u = o.match(/\b(?:body|message|content|text|saying|that\s+says|which\s+says)\b\s*(?:of|:|=|is)?\s+(.+?)(?=[.\n;]|$)/i);
  return u ? u[1].trim() : "";
}

// A scheduling verb (many forms/tenses) — generic, never a specific phrase.
const SCHED_VERB = /\b(add(?:ing)?|creat(?:e|ing)|schedul(?:e|ing)|set(?:ting)?\s?up|mak(?:e|ing)|put(?:ting)?|new|book(?:ing)?|mark(?:ing)?|block(?:ing)?|remind|reminder|log(?:ging)?|note|jot|pencil(?:ing|ed)?|sav(?:e|ing)|set\s+aside|reserv(?:e|ing))\b/i;
// Verbs that, paired with a concrete time and NO external target, imply a calendar
// block even without the word "calendar" ("schedule coding tomorrow", "block friday").
const STRONG_TIME_VERB = /\b(schedul(?:e|ing)|block(?:ing)?|reserv(?:e|ing)|pencil(?:ing|ed)?|set\s+aside|mark(?:ing)?)\b/i;
// Calendar/event nouns (tolerant of common misspellings as defense-in-depth; the
// normalizer already canonicalizes these before routing).
const CAL_NOUN = /\b(calend[ae]r|calandar|calendr|event|meeting|appointment|reminder|invite)\b/i;

function detectCalendar(o: string): DirectAction | null {
  const date = extractDate(o);
  const time = extractTime(o);
  const hasExternalTarget = URL_1.test(o) || EMAIL_1.test(o);
  // Intent, in priority order:
  //  1) a scheduling verb + a calendar/event noun ("add coding to my calendar")
  //  2) any "calendar" mention qualified by a verb, a date, or an event noun
  //  3) a strong time-blocking verb + a concrete time, no external target
  //     ("schedule coding tomorrow", "block friday afternoon for coding")
  const intent =
    (SCHED_VERB.test(o) && CAL_NOUN.test(o)) ||
    (/\bcalend[ae]r\b/i.test(o) && (SCHED_VERB.test(o) || !!date || /\b(event|meeting|appointment|reminder|invite)\b/i.test(o))) ||
    (STRONG_TIME_VERB.test(o) && (!!date || !!time) && !hasExternalTarget);
  if (!intent) return null;

  const title = extractEventTitle(o);
  const location = extractEventLocation(o);

  const params: Record<string, string> = {};
  if (title) params.title = title;
  if (date) params.date = date;
  if (time) params.time = time;
  if (location) params.location = location;

  const missing: string[] = [];
  if (!title) missing.push("title");
  if (!date) missing.push("date");

  return { capability: "calendar_event", target: "", params, requiredMissing: missing, monitor: false };
}

function extractEventTitle(o: string): string {
  const q = o.match(/\b(?:titled|called|named|entitled)\s*["'“”]?(.+?)["'“”]?(?=\s+(?:on|at|for|with|from)\b|[.\n]|$)/i);
  if (q) return q[1].trim();
  const quoted = o.match(/["'“”](.+?)["'“”]/);
  if (quoted) return quoted[1].trim();
  // "block/put/mark X in my calendar" — the activity sits between verb and calendar.
  // Skip when the captured span is just a date ("mark tomorrow in my calendar …"),
  // so a later clause ("as coding") supplies the real title.
  const between = o.match(/\b(?:mark|add|put|block|log|note|schedule|save|create|set\s?up)\s+(.+?)\s+(?:in|on|to)\s+(?:my\s+|the\s+)?calendar\b/i);
  if (between && between[1] && !extractDate(between[1]) && !/^(?:a|an|the|it|this|that|something)$/i.test(between[1].trim())) return between[1].trim();
  // "… as CODING" — the label after "as" at the tail (skip when it's a date).
  const asLabel = o.match(/\bas\s+["'“”]?(.+?)["'“”]?\s*$/i);
  if (asLabel && asLabel[1] && !extractDate(asLabel[1])) return asLabel[1].trim();
  // "block/reserve tomorrow [afternoon] for coding" — the activity after "for" at the tail.
  const forLabel = o.match(/\bfor\s+([a-z][a-z0-9 '&/-]{0,50}?)\s*$/i);
  if (forLabel && forLabel[1] && !extractDate(forLabel[1]) && !/^(?:it|me|us|them|now|later|today|tomorrow|tonight)$/i.test(forLabel[1].trim())) return forLabel[1].trim();
  // "schedule coding tomorrow" — activity between the verb and a time reference.
  const verbActivity = o.match(/\b(?:schedule|scheduling|block|blocking|reserve|reserving|pencil|add|adding|put|mark|marking|log|note|save)\s+(?:some\s+|a\s+|an\s+|the\s+)?([a-z][a-z0-9 '&/-]{0,40}?)\s+(?:for\b|on\b|at\b|from\b|this\b|next\b|tomorrow\b|today\b|tonight\b|\d)/i);
  if (verbActivity && verbActivity[1] && !extractDate(verbActivity[1]) && !/^(?:it|me|us|them|a|an|the|some|time|aside)$/i.test(verbActivity[1].trim())) return verbActivity[1].trim();
  const ev = o.match(/\b(?:event|meeting|appointment|reminder|call)\s+(?:with|for|about)\s+(.+?)(?=\s+(?:on|at|from)\b|[.\n]|$)/i);
  if (ev) return ev[1].trim();
  return "";
}

function extractDate(o: string): string {
  const m =
    o.match(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?/i) ||
    o.match(/\b\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*(?:,?\s*\d{4})?/i) ||
    o.match(/\b\d{4}-\d{1,2}-\d{1,2}\b/) ||
    o.match(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/) ||
    o.match(/\b(?:today|tomorrow|(?:next|this)\s+(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*|(?:next|this)\s+week)\b/i);
  return m ? m[0].trim() : "";
}

function extractTime(o: string): string {
  const m = o.match(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i) || o.match(/\b\d{1,2}:\d{2}\b/);
  return m ? m[0].trim() : "";
}

function extractEventLocation(o: string): string {
  const m = o.match(/\blocation\b\s*(?::|=|is|of)?\s*(.+?)(?=[.\n;]|$)/i);
  return m ? m[1].trim() : "";
}

function detectForm(o: string): DirectAction | null {
  const intent = /\b(submit|fill\s+(?:out|in)|complete)\b[^.]*\bform\b/i.test(o) || /\bsubmit\b[^.]*\bform\b/i.test(o);
  if (!intent) return null;
  const url = firstUrl(o);
  const missing: string[] = [];
  if (!/^https?:\/\//i.test(url)) missing.push("form URL");
  return { capability: "submit_form", target: url, params: {}, requiredMissing: missing, monitor: false };
}

function detectPayment(o: string): DirectAction | null {
  const intent = /\b(pay|make\s+a\s+payment|send\s+(?:a\s+)?payment|transfer\s+(?:money|funds)|pay\s+for)\b/i.test(o);
  if (!intent) return null;
  const target = paymentTarget(o);
  const amount = extractAmount(o);
  const currency = extractCurrency(o);

  const params: Record<string, string> = {};
  if (amount) params.amount = amount;
  if (currency) params.currency = currency;

  const missing: string[] = [];
  if (!target) missing.push("payment target");
  if (!amount) missing.push("amount");

  return { capability: "payment", target, params, requiredMissing: missing, monitor: false };
}

function detectBook(o: string): DirectAction | null {
  const intent = /\b(book|reserve|make\s+a\s+(?:booking|reservation))\b/i.test(o);
  if (!intent) return null;
  const url = firstUrl(o);
  const amount = extractAmount(o);
  const currency = extractCurrency(o);

  const params: Record<string, string> = {};
  if (amount) params.amount = amount;
  if (currency) params.currency = currency;

  const missing: string[] = [];
  if (!/^https?:\/\//i.test(url)) missing.push("booking link");

  return { capability: "book", target: url, params, requiredMissing: missing, monitor: MONITOR_REQ.test(o) };
}

// Order matters only for objectives that could match two contracts; the most
// specific/parameter-rich intents come first. Calendar is checked before book so
// "schedule a meeting" isn't captured by the generic booking verb.
const CONTRACTS: ((o: string) => DirectAction | null)[] = [detectEmail, detectCalendar, detectForm, detectPayment, detectBook];

/** Does this action already have a concrete, validatable target to act on? */
function hasConcreteTarget(da: DirectAction): boolean {
  if (da.capability === "calendar_event") return true; // no external target needed
  if (da.capability === "send_email") return isRealEmail(da.target);
  if (da.capability === "payment") return !!da.target; // url or handle
  return /^https?:\/\//i.test(da.target); // submit_form / book need a URL
}

/**
 * Decide how to execute the objective. Generic across domains.
 */
export function routeObjective(objective: string, c: TaskConstraints): RouteDecision {
  for (const detect of CONTRACTS) {
    const da = detect(objective);
    if (!da) continue;

    if (hasConcreteTarget(da)) return { route: "direct_action", action: da };

    // Action intent but no concrete target. If the user is asking to find/choose
    // it, research must come first (mixed). Otherwise the target is simply
    // missing — still a direct action; ask for exactly that missing target.
    if (RESEARCH_LEAD.test(objective)) return { route: "mixed", action: da };
    return { route: "direct_action", action: da };
  }

  // No action intent.
  //  • Acquiring/comparing real entities inherently needs external data → research.
  //  • A procedure (how-to that may need official/current steps) → research.
  //  • Otherwise it's an informational/creative request: answer it DIRECTLY from
  //    knowledge/generation — UNLESS its own wording asks for current/external/
  //    verified facts, in which case it needs research. No keyword the user must
  //    add: the default for a plain question or creative ask is a direct answer.
  if (c.outcome === "candidates" || c.outcome === "procedure") return { route: "research" };
  if (needsExternalFacts(objective)) return { route: "research" };
  return { route: "direct_answer" };
}

// ── generic helpers used by the executor / summary ───────────────────────────

/** A human label for a capability (for logs and summaries). */
export function capabilityLabel(cap: ActionCapability): string {
  switch (cap) {
    case "send_email": return "email send";
    case "calendar_event": return "calendar event";
    case "submit_form": return "form submission";
    case "book": return "booking";
    case "payment": return "payment";
  }
}

/** A minimal, generic question for one missing required parameter. */
export function actionParamQuestion(cap: ActionCapability, param: string): string {
  const map: Record<string, string> = {
    recipient: "Who should this email go to? Please give the recipient's email address.",
    subject: "What should the email subject line be?",
    body: "What should the email body say? (I won't write it for you — I'll send exactly what you provide.)",
    title: "What is the title of the event?",
    date: "What date is the event on?",
    "form URL": "What is the exact URL of the form to submit?",
    "booking link": "What is the exact booking page/link for the option to book?",
    "payment target": "What is the exact payment target (a payment URL or account)?",
    amount: "What is the exact amount (and currency) to pay?",
  };
  return map[param] || `Please provide the ${param} for this ${capabilityLabel(cap)}.`;
}

// ── clarified-parameter application + content validation ─────────────────────
// Params whose answer is a TARGET (goes to da.target). All others go to da.params.
const TARGET_PARAMS = new Set(["recipient", "payment target", "booking link", "form URL"]);

/** Unresolved template markers that must NEVER reach a prepared/sent action. */
const PLACEHOLDER_MARKER = /\[[^\]]{0,120}\]|\{\{[^}]*\}\}|<[a-z][a-z0-9_ /|-]{1,40}>|\b(?:TODO|TBD|FIXME|PLACEHOLDER|XXXX)\b|__[a-z]+__/i;

/** Does a piece of prepared content still contain an unresolved placeholder? */
export function hasPlaceholder(text: string | undefined): boolean {
  return !!text && PLACEHOLDER_MARKER.test(text);
}

/** Content params (subject/body/title) that still contain unresolved placeholders. */
export function contentPlaceholderFields(da: DirectAction): string[] {
  const bad: string[] = [];
  for (const key of ["subject", "body", "title"]) {
    if (hasPlaceholder(da.params[key])) bad.push(key);
  }
  return bad;
}

/** Recompute which required params are still missing (mirrors the contracts). */
export function requiredMissingFor(capability: ActionCapability, target: string, params: Record<string, string>): string[] {
  const missing: string[] = [];
  switch (capability) {
    case "send_email":
      if (!isRealEmail(target)) missing.push("recipient");
      if (!params.subject?.trim()) missing.push("subject");
      if (!params.body?.trim()) missing.push("body");
      break;
    case "calendar_event":
      if (!params.title?.trim()) missing.push("title");
      if (!params.date?.trim()) missing.push("date");
      break;
    case "submit_form":
      if (!/^https?:\/\//i.test(target)) missing.push("form URL");
      break;
    case "book":
      if (!/^https?:\/\//i.test(target)) missing.push("booking link");
      break;
    case "payment":
      if (!target) missing.push("payment target");
      if (!params.amount?.trim()) missing.push("amount");
      break;
  }
  return missing;
}

/**
 * Overlay the user's VERBATIM clarification answers onto a direct action, keyed by
 * param name — never re-parsing them from concatenated text. Target params extract
 * a clean address/URI from the answer; content params (subject/body/title/date)
 * are taken exactly as typed. requiredMissing is then recomputed.
 */
export function applyClarifiedParams(action: DirectAction, clarified: Record<string, string>): DirectAction {
  const params = { ...action.params };
  let target = action.target;
  for (const [param, raw] of Object.entries(clarified)) {
    const v = (raw ?? "").trim();
    if (!v) continue;
    if (param === "recipient") {
      const email = (v.match(EMAIL_1) || [])[0];
      if (email) target = email;
    } else if (TARGET_PARAMS.has(param)) {
      const uri = (v.match(ANY_URI) || [])[0] || (v.match(EMAIL_1) || [])[0];
      if (uri) target = uri.replace(/[.,;]+$/, "");
    } else if (param === "amount") {
      const a = v.match(/[\d,]+(?:\.\d+)?/);
      if (a) params.amount = a[0].replace(/,/g, "");
      const cur = extractCurrency(v);
      if (cur) params.currency = cur;
    } else {
      // subject, body, title, date … taken EXACTLY as the user typed them.
      params[param] = v;
    }
  }
  return { ...action, target, params, requiredMissing: requiredMissingFor(action.capability, target, params) };
}

/** Exact, verbatim preview lines of the prepared action (never fabricated). */
export function directActionPreviewLines(da: DirectAction): string[] {
  const p = da.params;
  switch (da.capability) {
    case "send_email":
      return [`To: ${da.target}`, `Subject: ${p.subject ?? ""}`, `Body: ${p.body ?? ""}`];
    case "calendar_event":
      return [`Event: ${p.title ?? ""}`, `When: ${[p.date, p.time].filter(Boolean).join(" ") || "(unspecified)"}`, ...(p.location ? [`Where: ${p.location}`] : [])];
    case "submit_form":
      return [`Submit to: ${da.target}`];
    case "book":
      return [`Book: ${da.target}`, ...(p.amount ? [`Amount: ${p.currency ?? ""} ${p.amount}`.trim()] : [])];
    case "payment":
      return [`Pay: ${p.currency ?? ""} ${p.amount ?? ""}`.trim(), `To: ${da.target}`];
  }
}
