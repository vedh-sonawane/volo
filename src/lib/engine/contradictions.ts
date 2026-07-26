// ─────────────────────────────────────────────────────────────────────────────
// Generic contradiction detection.
//
// Finds materially-conflicting constraints in an objective and returns clarifying
// questions. Domain-agnostic — it reasons about numbers, dates, ranges, and
// budgets, NOT about travel/weddings/etc. Detected kinds:
//   • duration vs an explicit date/time range (the stated length ≠ the span),
//   • a stated total budget vs (quantity × per-unit price) that exceeds it,
//   • a min/max numeric range that is inverted (min > max).
//
// Everything here is heuristic and CONSERVATIVE: it only flags a contradiction
// when it can compute both sides. When unsure it stays silent (no false alarms).
// ─────────────────────────────────────────────────────────────────────────────

import { parseMoney, toTotal, type Quantities } from "./money";

export interface Contradiction {
  question: string;
  importance: "blocking" | "optional";
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const CUM = [0, 0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]; // days before month m

interface D {
  y: number;
  m: number;
  d: number;
}
function dayIndex(x: D): number {
  return x.y * 365 + (CUM[x.m] || 0) + x.d;
}

/** Extract calendar dates from text (Month D[, YYYY] / D Month / M/D[/YYYY] / YYYY-MM-DD). */
function extractDates(text: string): D[] {
  const out: D[] = [];
  const yearNow = 2026; // relative default when no year stated; only spans matter
  const monthName = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t)?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
  const re1 = new RegExp(`\\b${monthName}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?`, "gi");
  const re2 = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${monthName}(?:,?\\s*(\\d{4}))?`, "gi");
  const re3 = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g;
  const re4 = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g;
  let m: RegExpExecArray | null;
  while ((m = re1.exec(text))) out.push({ m: MONTHS[m[1].toLowerCase()], d: Number(m[2]), y: m[3] ? Number(m[3]) : yearNow });
  while ((m = re2.exec(text))) out.push({ d: Number(m[1]), m: MONTHS[m[2].toLowerCase()], y: m[3] ? Number(m[3]) : yearNow });
  while ((m = re3.exec(text))) out.push({ y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) });
  while ((m = re4.exec(text))) out.push({ m: Number(m[1]), d: Number(m[2]), y: m[3] ? Number(m[3].length === 2 ? "20" + m[3] : m[3]) : yearNow });
  return out.filter((x) => x.m >= 1 && x.m <= 12 && x.d >= 1 && x.d <= 31);
}

/** Extract a stated duration in days and/or nights. */
function extractDuration(text: string): { days?: number; nights?: number; hours?: number } {
  const r: { days?: number; nights?: number; hours?: number } = {};
  const dm = text.match(/\b(\d{1,3})[\s-]*(?:day|days)\b/i);
  const nm = text.match(/\b(\d{1,3})[\s-]*(?:night|nights)\b/i);
  const hm = text.match(/\b(\d{1,3})[\s-]*(?:hour|hours|hr|hrs)\b/i);
  if (dm) r.days = Number(dm[1]);
  if (nm) r.nights = Number(nm[1]);
  if (hm) r.hours = Number(hm[1]);
  return r;
}

export function detectContradictions(objective: string, quantities: Quantities = {}): Contradiction[] {
  const out: Contradiction[] = [];
  const text = objective;

  // (1) Duration vs explicit date range.
  const dur = extractDuration(text);
  const dates = extractDates(text);
  if ((dur.days != null || dur.nights != null) && dates.length >= 2) {
    // Use the two furthest-apart dates as the range.
    const idx = dates.map(dayIndex);
    const span = Math.max(...idx) - Math.min(...idx); // nights between endpoints
    const inclusiveDays = span + 1;
    if (dur.nights != null && dur.nights !== span) {
      out.push({ question: `You mentioned ${dur.nights} night(s), but the dates given span ${span} night(s). Which is correct — the length of stay or the dates?`, importance: "blocking" });
    } else if (dur.days != null && dur.days !== inclusiveDays && dur.days !== span) {
      out.push({ question: `You mentioned ${dur.days} day(s), but the dates given span about ${inclusiveDays} day(s). Which is correct — the number of days or the dates?`, importance: "blocking" });
    }
  }

  // (2) Total budget vs quantity × per-unit price.
  const budgetM = matchBudget(text);
  const perUnit = matchPerUnitPrice(text, quantities);
  if (budgetM != null && perUnit != null && perUnit > budgetM * 1.001) {
    out.push({ question: `Your stated budget is ~${budgetM}, but the per-item price times the quantity comes to ~${Math.round(perUnit)} — over budget. Should I raise the budget, reduce quantity, or find cheaper options?`, importance: "blocking" });
  }

  // (3) Inverted numeric range (min > max).
  const range = text.match(/\bbetween\s+\$?\s*(\d[\d,]*)\s+and\s+\$?\s*(\d[\d,]*)/i);
  if (range) {
    const a = Number(range[1].replace(/,/g, ""));
    const b = Number(range[2].replace(/,/g, ""));
    if (a > b) out.push({ question: `You gave a range "between ${a} and ${b}", but ${a} is greater than ${b}. Did you mean the other way around?`, importance: "optional" });
  }

  return out;
}

function matchBudget(text: string): number | null {
  const m = text.match(/\b(?:budget|total|under|below|max(?:imum)?|no more than|up to|within)\s+(?:of\s+)?(?:cad|usd|gbp|eur)?\s*\$?\s*([\d,]+(?:\.\d+)?)/i);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** If the text has a per-unit price AND a matching quantity, return the total. */
function matchPerUnitPrice(text: string, quantities: Quantities): number | null {
  // Find a "$P per X / $P each / $P/person" phrase.
  const m = text.match(/(\$?\s*[\d,]+(?:\.\d+)?\s*(?:per\s+\w+|each|\/\s*\w+|pp|a\s+head|apiece))/i);
  if (!m) return null;
  const money = parseMoney(m[1]);
  if (!money || money.basis === "total" || money.basis === "unknown") return null;
  const norm = toTotal(money, quantities);
  return norm.complete ? norm.total : null;
}
