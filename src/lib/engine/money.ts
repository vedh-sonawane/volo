// ─────────────────────────────────────────────────────────────────────────────
// Generic money + quantity semantics.
//
// Preserves the MEANING of a price through the whole pipeline: amount, currency,
// and pricing BASIS (total, per-person, per-night, per-unit, per-item, per-use,
// per-hour, per-month, unknown) plus a qualifier (fixed / from / estimated).
//
// This is domain-agnostic — "per-night" and "per-person" are just bases; the same
// machinery handles "per-seat", "per-license", "per-kg" via the generic per_unit
// bucket. The critical rule: NEVER add or compare prices with incompatible or
// unknown semantics as if they were equivalent. When a basis can't be normalized
// to a common total (because the needed quantity or currency is unknown), the
// uncertainty is preserved and reported rather than papered over.
// ─────────────────────────────────────────────────────────────────────────────

export type PriceBasis =
  | "total"
  | "per_person"
  | "per_night"
  | "per_unit"
  | "per_item"
  | "per_use"
  | "per_hour"
  | "per_month"
  | "unknown";

export type PriceQualifier = "fixed" | "from" | "estimated" | "unknown";

export interface Money {
  amount: number;
  /** ISO-ish currency code, or "" when unknown. */
  currency: string;
  basis: PriceBasis;
  qualifier: PriceQualifier;
  /** Whether taxes/fees are known to be excluded ("+ tax"). */
  plusFees: boolean;
  raw: string;
}

/** Known quantities used to normalize a per-X price to a total. */
export interface Quantities {
  person?: number;
  night?: number;
  unit?: number;
  item?: number;
  use?: number;
  hour?: number;
  month?: number;
}

const CUR_SYMBOL: Record<string, string> = { $: "USD", "£": "GBP", "€": "EUR" };
const CUR_CODE = /\b(usd|cad|gbp|eur|aud|nzd|inr|jpy|chf)\b/i;

const BASIS_PATTERNS: [RegExp, PriceBasis][] = [
  [/\bper\s+person\b|\/\s*person\b|\bpp\b|\bper\s+head\b|\ba\s+head\b|\beach\s+person\b/i, "per_person"],
  [/\bper\s+night\b|\/\s*night\b|\bnightly\b|\bper\s+nite\b/i, "per_night"],
  [/\bper\s+hour\b|\/\s*hr\b|\bhourly\b|\ban\s+hour\b/i, "per_hour"],
  [/\bper\s+month\b|\/\s*mo\b|\bmonthly\b|\ba\s+month\b/i, "per_month"],
  [/\bper\s+item\b|\bapiece\b/i, "per_item"],
  [/\bper\s+use\b|\bper\s+ride\b|\bper\s+trip\b|\bper\s+visit\b/i, "per_use"],
  [/\bper\s+unit\b|\bper\s+seat\b|\bper\s+ticket\b|\bper\s+license\b|\bper\s+seat\b|\beach\b/i, "per_unit"],
  [/\btotal\b|\ball[\s-]?in\b|\ball[\s-]?inclusive\b|\bin\s+total\b/i, "total"],
];

/** Parse a price string into structured Money. Returns null if no amount found. */
export function parseMoney(text: string): Money | null {
  if (!text) return null;
  const raw = text.trim();
  const lower = raw.toLowerCase();

  // amount (first monetary-looking number)
  const amtMatch = raw.replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  if (!amtMatch) return null;
  const amount = Number(amtMatch[1]);
  if (!Number.isFinite(amount)) return null;

  // currency: explicit code wins, else symbol, else unknown
  let currency = "";
  const code = raw.match(CUR_CODE);
  if (code) currency = code[1].toUpperCase();
  else {
    for (const [sym, cur] of Object.entries(CUR_SYMBOL)) if (raw.includes(sym)) { currency = cur; break; }
  }

  // basis: a displayed price is a TOTAL for that item unless a per-X marker says
  // otherwise. "unknown" is reserved for an EXPLICIT scope-ambiguity signal — we
  // never silently invent a per-unit basis, but we also don't refuse to budget a
  // plainly-stated price. This is the honest reading of a listed price.
  let basis: PriceBasis = "total";
  for (const [re, b] of BASIS_PATTERNS) {
    if (re.test(lower)) { basis = b; break; }
  }
  if (/\b(?:varies|vary|depend(?:s|ing)|price\s+on\s+request|call\s+for\s+pricing|quote\s+only|tbd|to\s+be\s+determined)\b/.test(lower)) {
    basis = "unknown";
  }

  // qualifier
  let qualifier: PriceQualifier = "unknown";
  if (/\bfrom\b|\bstarting\s+(?:at|from)\b|\bas\s+low\s+as\b|\bstarts?\s+at\b/.test(lower)) qualifier = "from";
  else if (/\bapprox\b|\babout\b|\baround\b|~|\bestimated\b|\best\.?\b|\broughly\b/.test(lower)) qualifier = "estimated";
  else qualifier = "fixed";

  const plusFees = /\+\s*(?:tax|taxes|fees?|hst|gst|vat|service)/i.test(lower) || /\bplus\s+(?:tax|fees)/i.test(lower);

  return { amount, currency, basis, qualifier, plusFees, raw };
}

const BASIS_QTY: Partial<Record<PriceBasis, keyof Quantities>> = {
  per_person: "person",
  per_night: "night",
  per_unit: "unit",
  per_item: "item",
  per_use: "use",
  per_hour: "hour",
  per_month: "month",
};

export interface NormalizedTotal {
  /** Total value in the money's currency, or null when it can't be computed. */
  total: number | null;
  /** True only when the amount was fully normalizable to a total. */
  complete: boolean;
  /** Why it could not be normalized (for honest reporting). */
  reason?: string;
}

/**
 * Normalize a price to a comparable TOTAL using known quantities. A per-X price
 * needs quantity X to become a total; if X is unknown, we preserve the
 * uncertainty (complete=false, total=null) rather than pretending the per-X
 * amount is a total.
 */
export function toTotal(m: Money, q: Quantities): NormalizedTotal {
  if (m.basis === "total") return { total: m.amount, complete: true };
  if (m.basis === "unknown") return { total: null, complete: false, reason: "price scope is unknown (couldn't tell if it's a total or per-unit)" };
  const key = BASIS_QTY[m.basis];
  if (!key) return { total: null, complete: false, reason: `unhandled basis ${m.basis}` };
  const qty = q[key];
  if (qty == null || !Number.isFinite(qty) || qty <= 0) {
    return { total: null, complete: false, reason: `it's ${m.basis.replace("_", "-")} but the ${key} count is unknown` };
  }
  return { total: m.amount * qty, complete: true };
}

/** Two amounts can be combined/compared only if currencies are compatible. */
export function currencyCompatible(a: string, b: string): boolean {
  if (!a || !b) return true; // one unknown → assume same but caller should flag
  return a === b;
}

/** Best-effort currency inference from free text (used for budgets). */
export function inferCurrency(text: string): string {
  const m = parseMoney(text);
  return m?.currency || "";
}
