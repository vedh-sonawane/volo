// ─────────────────────────────────────────────────────────────────────────────
// Generic cross-domain join (BL-2).
//
// Given several sub-plans (each an independent research "category" with its own
// ranked candidates), form combinations that pick one option from each category
// and evaluate them against a SHARED constraint (a joint budget), then rank by
// cost / evidence / per-domain quality and explain the trade-offs.
//
// Nothing here knows about travel, transport, or lodging. It only knows: N
// categories, pick one from each, sum a shared numeric constraint, rank. That
// generalizes to any combinatorial objective (e.g. laptop + monitor + keyboard
// under a budget; venue + caterer + photographer under a budget).
//
// Honesty: it never invents options or prices. Categories that produced no
// options are reported as `missing`; combinations with unknown prices are kept
// but flagged as unconfirmed against the budget rather than silently passed.
// ─────────────────────────────────────────────────────────────────────────────

import type { Combination, CombinedOption, ResultItem, SubPlan, TaskConstraints } from "@/lib/types";
import { clamp, id } from "@/lib/util";
import { type Money, type PriceBasis, currencyCompatible, parseMoney, toTotal } from "./money";

const PER_DOMAIN = 4; // top-K candidates per category to combine
const MAX_COMBOS = 120; // safety cap on the cartesian product
const SHOW = 4; // recommended combinations to surface

interface Pick {
  subPlanId: string;
  label: string;
  item: ResultItem;
  money: Money | null;
  /** Amount normalized to a comparable total, using known quantities. */
  total: number | null;
  complete: boolean;
  reason?: string;
}

function basisFromUnit(unit?: string): PriceBasis {
  if (!unit) return "total";
  if (/person|head|pp/.test(unit)) return "per_person";
  if (/night/.test(unit)) return "per_night";
  if (/hour|hr/.test(unit)) return "per_hour";
  if (/month|mo/.test(unit)) return "per_month";
  return "total";
}

export function combineDomains(subPlans: SubPlan[], c: TaskConstraints): Combination {
  const quantities = c.quantities || {};

  // Normalize the shared budget the same way (a "$50/person" budget must be
  // scaled by the group size before comparing against a total).
  let budgetTotal: number | null = null;
  if (c.maxPrice != null) {
    const bMoney: Money = { amount: c.maxPrice, currency: "", basis: basisFromUnit(c.priceUnit), qualifier: "fixed", plusFees: false, raw: "" };
    budgetTotal = toTotal(bMoney, quantities).total;
  }

  // Top candidates per sub-plan (in ranked order), and which categories are empty.
  const perDomain: { label: string; picks: Pick[] }[] = [];
  const missing: string[] = [];
  for (const sp of subPlans) {
    const cand = topCandidates(sp).slice(0, PER_DOMAIN);
    if (cand.length === 0) {
      missing.push(sp.label);
    } else {
      perDomain.push({
        label: sp.label,
        picks: cand.map((item) => {
          const money = parseMoney(item.attributes.price || "");
          const norm = money ? toTotal(money, quantities) : { total: null, complete: false, reason: "no price found" };
          return { subPlanId: sp.id, label: sp.label, item, money, total: norm.total, complete: norm.complete, reason: norm.reason };
        }),
      });
    }
  }
  const budget = budgetTotal;

  if (perDomain.length === 0) {
    return {
      options: [],
      recommendedIds: [],
      budget: budget ?? undefined,
      priceUnit: c.priceUnit,
      rationale: `No category produced usable options, so no combination could be formed.`,
      missing,
    };
  }

  // Cartesian product of the categories that DO have options (capped).
  let combos: Pick[][] = [[]];
  for (const d of perDomain) {
    const next: Pick[][] = [];
    for (const combo of combos) {
      for (const p of d.picks) {
        next.push([...combo, p]);
        if (next.length >= MAX_COMBOS) break;
      }
      if (next.length >= MAX_COMBOS) break;
    }
    combos = next;
  }

  const options: CombinedOption[] = combos.map((picks) => scoreCombo(picks, budget));

  // Rank: within-budget first, then cheaper complete totals, then score.
  options.sort((a, b) => {
    if (a.withinBudget !== b.withinBudget) return a.withinBudget ? -1 : 1;
    if (a.priceComplete && b.priceComplete && a.totalPrice != null && b.totalPrice != null && a.totalPrice !== b.totalPrice) {
      return a.totalPrice - b.totalPrice;
    }
    return b.score - a.score;
  });

  const overBudget = options.filter((o) => budget != null && o.priceComplete && !o.withinBudget).length;
  const uncomputable = options.filter((o) => !o.priceComplete).length;
  const recommended = options.slice(0, SHOW);

  return {
    options,
    recommendedIds: recommended.map((o) => o.id),
    // Budget is normalized to a comparable TOTAL (e.g. "$50/person × N").
    budget: budget ?? undefined,
    priceUnit: undefined,
    rationale: buildRationale(perDomain.length, options.length, overBudget, uncomputable, budget ?? undefined, missing),
    missing,
  };
}

function topCandidates(sp: SubPlan): ResultItem[] {
  const cmp = sp.comparison;
  if (!cmp) return sp.results.filter((r) => r.kind === "candidate");
  return cmp.recommendedIds
    .map((rid) => cmp.items.find((i) => i.id === rid))
    .filter((i): i is ResultItem => Boolean(i) && i!.kind === "candidate");
}

function scoreCombo(picks: Pick[], budget?: number | null): CombinedOption {
  // Currencies must be compatible to combine. Mixed KNOWN currencies → we refuse
  // to produce a single total (never add e.g. USD + GBP as if equal).
  const currencies = Array.from(new Set(picks.map((p) => p.money?.currency).filter((x): x is string => !!x)));
  const currencyOk = currencies.length <= 1;
  const currency = currencies[0] || "";

  const allNormalized = picks.every((p) => p.complete);
  // A total is only trustworthy when every part normalized AND currencies agree.
  const priceComplete = allNormalized && currencyOk && picks.length > 0;
  const totalPrice = priceComplete ? picks.reduce((s, p) => s + (p.total as number), 0) : null;

  let withinBudget = false;
  if (budget != null && totalPrice != null) withinBudget = totalPrice <= budget;

  const avgScore = picks.reduce((s, p) => s + (p.item.score ?? p.item.confidence ?? 0.3), 0) / picks.length;
  let score = avgScore * 0.6;
  if (budget != null && totalPrice != null) score += clamp(1 - totalPrice / budget) * 0.3;
  if (priceComplete) score += 0.1;

  return {
    id: id("cmb_"),
    picks: picks.map((p) => ({
      subPlanId: p.subPlanId,
      label: p.label,
      itemId: p.item.id,
      name: p.item.name,
      price: p.money?.amount ?? null,
      evidenceUrl: p.item.evidenceUrl,
    })),
    totalPrice,
    withinBudget,
    priceComplete,
    score: clamp(score),
    rationale: comboRationale(picks, totalPrice, priceComplete, budget ?? undefined, withinBudget, currency, currencyOk),
  };
}

function comboRationale(
  picks: Pick[],
  total: number | null,
  complete: boolean,
  budget?: number,
  withinBudget?: boolean,
  currency?: string,
  currencyOk?: boolean
): string {
  const cur = currency || "";
  const parts = picks.map((p) => {
    const m = p.money;
    const price = m ? `${m.currency || cur || "$"}${m.amount}${m.basis !== "total" && m.basis !== "unknown" ? "/" + m.basis.replace("per_", "") : ""}${m.qualifier === "from" ? "+" : ""}` : "price n/a";
    return `${p.label}: ${p.item.name} (${price})`;
  });
  let note: string;
  if (!currencyOk) {
    note = " — cannot total: mixed currencies, not comparable. Prices shown per part.";
  } else if (complete && total != null) {
    note = ` — total ~${cur}${total}${budget != null ? (withinBudget ? " ✓ within budget" : " ✗ over budget") : ""}`;
  } else {
    // Preserve the uncertainty honestly, naming what's missing.
    const reasons = Array.from(new Set(picks.filter((p) => !p.complete).map((p) => `${p.label}: ${p.reason || "unknown price"}`)));
    note = ` — total NOT computed (${reasons.join("; ")}). Not compared against budget.`;
  }
  return parts.join(" + ") + note;
}

function buildRationale(
  domains: number,
  count: number,
  overBudget: number,
  uncomputable: number,
  budget?: number,
  missing?: string[]
): string {
  const parts: string[] = [];
  parts.push(`Formed ${count} combination${count === 1 ? "" : "s"} across ${domains} categor${domains === 1 ? "y" : "ies"}.`);
  if (budget != null) {
    parts.push(overBudget > 0 ? `Applied a shared total budget of ~${budget}; ${overBudget} exceeded it.` : `Applied a shared total budget of ~${budget} where all prices were comparable.`);
  }
  if (uncomputable > 0) {
    parts.push(`${uncomputable} combination${uncomputable === 1 ? "" : "s"} could not be totalled (unknown price scope or mixed currencies) — those are shown but NOT compared against the budget, rather than guessing.`);
  }
  if (missing && missing.length) {
    parts.push(`No options found for: ${missing.join(", ")} — those categories are incomplete.`);
  }
  return parts.join(" ");
}
