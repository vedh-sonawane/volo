// ─────────────────────────────────────────────────────────────────────────────
// Comparison stage (Phase 6). Filters options against hard constraints (e.g.
// max price), scores the rest on evidence completeness / rating / constraint
// fit, and returns a ranked Comparison with a transparent rationale.
// ─────────────────────────────────────────────────────────────────────────────

import type { Comparison, ResultItem, TaskConstraints } from "@/lib/types";
import { schemaFor } from "./domains";
import { pluralize } from "./classify";
import { clamp } from "@/lib/util";

export function parsePrice(value?: string): number | null {
  if (!value) return null;
  const m = value.replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

const PREF_STOP = new Set(["with", "that", "have", "good", "really", "very", "prefer", "preferably", "ideally", "nice", "the", "and", "for", "area", "access", "easy"]);

/** Count how many soft-preference terms a candidate's text matches (generic). */
function softPrefMatches(item: ResultItem, softPrefs?: string[]): number {
  if (!softPrefs || softPrefs.length === 0) return 0;
  const hay = (item.name + " " + (item.evidence || "") + " " + Object.values(item.attributes).join(" ")).toLowerCase();
  const terms = new Set<string>();
  for (const pref of softPrefs) {
    for (const w of pref.toLowerCase().split(/[^a-z0-9]+/)) {
      if (w.length >= 4 && !PREF_STOP.has(w)) terms.add(w);
    }
  }
  let n = 0;
  for (const t of terms) if (hay.includes(t)) n++;
  return n;
}

export function compareResults(
  allItems: ResultItem[],
  c: TaskConstraints
): Comparison {
  const schema = schemaFor(c.domain, c.outcome);
  const count = c.count ?? 3;

  // Only REAL candidate entities are eligible to be options. Informational rows
  // (government guides, FAQs, nav pages, aggregator titles) are excluded here —
  // they remain visible as sources, but are never counted or ranked as options.
  const items = allItems.filter((i) => i.kind === "candidate");
  const informationCount = allItems.length - items.length;

  const scored: ResultItem[] = [];
  const dropped: ResultItem[] = [];

  for (const item of items) {
    const price = parsePrice(item.attributes.price);
    // Hard constraint: over budget → excluded from recommendations.
    if (c.maxPrice != null && price != null && price > c.maxPrice) {
      dropped.push({
        ...item,
        score: 0,
        scoreReason: `Over budget: ${item.attributes.price} exceeds $${c.maxPrice}`,
      });
      continue;
    }

    // Score: evidence richness + confidence + rating + constraint fit.
    const fields = Object.keys(item.attributes).length;
    let score = 0;
    score += clamp(fields / Math.max(3, schema.columns.length)) * 0.35;
    score += item.confidence * 0.25;

    const rating = parsePrice(item.attributes.rating);
    if (rating != null) score += clamp(rating / 5) * 0.15;

    if (c.maxPrice != null && price != null) {
      // Reward being comfortably under budget.
      score += clamp(1 - price / c.maxPrice) * 0.15;
    } else if (price != null) {
      score += 0.05;
    }

    if (c.timeframe && /mentions/.test(item.attributes.availability || "")) score += 0.1;

    // Soft-preference bonus (hard vs soft): preferences RANK, they don't filter.
    const softMatches = softPrefMatches(item, c.softPrefs);
    if (softMatches > 0) score += Math.min(0.12, softMatches * 0.04);

    const reasons: string[] = [];
    if (softMatches > 0) reasons.push(`matches ${softMatches} preference${softMatches === 1 ? "" : "s"}`);
    if (price != null) reasons.push(`price ${item.attributes.price}`);
    if (rating != null) reasons.push(`rated ${item.attributes.rating}`);
    reasons.push(`${fields} details found`);
    if (c.maxPrice != null && price != null && price <= c.maxPrice) reasons.push("within budget");

    scored.push({
      ...item,
      score: clamp(score),
      scoreReason: reasons.join(", "),
    });
  }

  // Procedure steps are sequential — preserve extraction order and keep them all.
  // Everything else ranks by score.
  const isProcedure = c.outcome === "procedure";
  if (!isProcedure) scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const recommended = isProcedure ? scored.slice(0, 12) : scored.slice(0, count);

  const rationale = buildRationale(scored, dropped, c, recommended.length, informationCount);

  return {
    columns: schema.columns,
    items: [...scored, ...dropped],
    recommendedIds: recommended.map((r) => r.id),
    rationale,
    entityLabel: c.entityLabel,
    informationCount,
  };
}

function buildRationale(
  scored: ResultItem[],
  dropped: ResultItem[],
  c: TaskConstraints,
  recommendedCount: number,
  informationCount: number
): string {
  const label = c.entityLabel || "option";
  const plural = (n: number) => pluralize(label, n);
  const parts: string[] = [];

  if (c.outcome === "procedure") {
    parts.push(`Extracted ${scored.length} step${scored.length === 1 ? "" : "s"} in order from the sources read.`);
    return parts.join(" ");
  }

  const total = scored.length + dropped.length;
  if (total === 0) {
    parts.push(`Found 0 actual ${plural(0)}.`);
    if (informationCount > 0) {
      parts.push(
        `Read ${informationCount} page${informationCount === 1 ? "" : "s"}, but ${informationCount === 1 ? "it was" : "they were"} informational (guides, directories, or listings) rather than a real ${label} with contact/price details.`
      );
    }
    return parts.join(" ");
  }

  parts.push(
    `Evaluated ${total} actual ${plural(total)} by how much verifiable detail was found, confidence, and rating.`
  );
  if (informationCount > 0) {
    parts.push(
      `${informationCount} additional page${informationCount === 1 ? " was" : "s were"} read for information but ${informationCount === 1 ? "is" : "are"} not ${plural(2)}.`
    );
  }
  if (c.maxPrice != null && dropped.length > 0) {
    parts.push(
      `Excluded ${dropped.length} priced above the $${c.maxPrice}${c.priceUnit ? "/" + c.priceUnit : ""} budget.`
    );
  }
  parts.push(`Showing the top ${recommendedCount}.`);
  return parts.join(" ");
}
