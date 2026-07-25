// ─────────────────────────────────────────────────────────────────────────────
// Comparison stage (Phase 6). Filters options against hard constraints (e.g.
// max price), scores the rest on evidence completeness / rating / constraint
// fit, and returns a ranked Comparison with a transparent rationale.
// ─────────────────────────────────────────────────────────────────────────────

import type { Comparison, ResultItem, TaskConstraints } from "@/lib/types";
import { schemaFor } from "./domains";
import { clamp } from "@/lib/util";

export function parsePrice(value?: string): number | null {
  if (!value) return null;
  const m = value.replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

export function compareResults(
  items: ResultItem[],
  c: TaskConstraints
): Comparison {
  const schema = schemaFor(c.domain);
  const count = c.count ?? 3;

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

    const reasons: string[] = [];
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

  // How-to steps are sequential — preserve extraction order and keep them all.
  // Everything else ranks by score.
  const isHowto = c.domain === "howto";
  if (!isHowto) scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const recommended = isHowto ? scored.slice(0, 12) : scored.slice(0, count);

  const rationale = buildRationale(scored, dropped, c, recommended.length);

  return {
    columns: schema.columns,
    items: [...scored, ...dropped],
    recommendedIds: recommended.map((r) => r.id),
    rationale,
  };
}

function buildRationale(
  scored: ResultItem[],
  dropped: ResultItem[],
  c: TaskConstraints,
  recommendedCount: number
): string {
  const parts: string[] = [];
  parts.push(
    `Ranked ${scored.length} option${scored.length === 1 ? "" : "s"} by how much verifiable detail was found, confidence, and rating.`
  );
  if (c.maxPrice != null) {
    parts.push(
      dropped.length > 0
        ? `Excluded ${dropped.length} option${dropped.length === 1 ? "" : "s"} priced above the $${c.maxPrice}${c.priceUnit ? "/" + c.priceUnit : ""} budget.`
        : `Applied the $${c.maxPrice}${c.priceUnit ? "/" + c.priceUnit : ""} budget where a price was found.`
    );
  }
  parts.push(`Showing the top ${recommendedCount}.`);
  return parts.join(" ");
}
