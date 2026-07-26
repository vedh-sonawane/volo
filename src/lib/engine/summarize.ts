// Produces the final human-facing result (Phase 6/9). Uses the model provider
// when one is available for nicer prose, but ALWAYS has a deterministic
// fallback built from real extracted data so the app works with zero AI.

import type {
  Combination,
  Comparison,
  FinalResult,
  ResultItem,
  Source,
  TaskConstraints,
} from "@/lib/types";
import type { ModelProvider } from "@/lib/providers/model";
import { pluralize } from "./classify";
import { truncate } from "@/lib/util";

export async function summarize(
  objective: string,
  c: TaskConstraints,
  comparison: Comparison | undefined,
  sources: Source[],
  model: ModelProvider,
  limitations: string[],
  offeredActions: string[],
  combination?: Combination
): Promise<FinalResult> {
  // Multi-domain objectives are summarized from the combination/join result.
  if (combination) {
    return { ...combinationSummary(c, combination, sources, limitations, offeredActions), modelUsed: false };
  }

  const deterministic = deterministicSummary(objective, c, comparison, sources, limitations, offeredActions);

  const top = (comparison?.recommendedIds ?? [])
    .map((id) => comparison!.items.find((i) => i.id === id))
    .filter(Boolean) as ResultItem[];

  // HONESTY GUARD: only let the model write prose when there is REAL evidence to
  // summarize (actual pages read AND at least one extracted option). With no
  // evidence, a model asked to "summarize" would fabricate — so we never call it
  // and instead return the honest deterministic message. This also records
  // whether the model actually contributed, so the UI can report it truthfully.
  const hasEvidence = sources.length > 0 && top.length > 0;
  if (hasEvidence && (await model.available())) {
    const prompt = buildPrompt(objective, c, top, sources);
    const text = await model.generate(prompt, {
      system:
        "You are a careful research assistant. Only use the provided facts. " +
        "Do not invent prices, names, or availability. Be concise.",
      maxTokens: 300,
      temperature: 0.2,
    });
    if (text && text.length > 20) {
      return { ...deterministic, summary: truncate(text.trim(), 900), modelUsed: true };
    }
  }
  return { ...deterministic, modelUsed: false };
}

function buildPrompt(
  objective: string,
  c: TaskConstraints,
  top: ResultItem[],
  sources: Source[]
): string {
  const facts = top
    .map(
      (t, i) =>
        `${i + 1}. ${t.name} — ${Object.entries(t.attributes)
          .map(([k, v]) => `${k}: ${v}`)
          .join("; ")} (source: ${t.evidenceUrl})`
    )
    .join("\n");
  return [
    `Objective: ${objective}`,
    `Detected type: ${c.domain}. Budget: ${c.maxPrice ?? "n/a"}. Timeframe: ${c.timeframe ?? "n/a"}.`,
    `Top options found (only use these facts):`,
    facts || "(none found)",
    `Sources: ${sources.slice(0, 5).map((s) => s.url).join(", ")}`,
    ``,
    `Write a 3-4 sentence summary of what was found and which option looks best and why. If little was found, say so honestly.`,
  ].join("\n");
}

function deterministicSummary(
  objective: string,
  c: TaskConstraints,
  comparison: Comparison | undefined,
  sources: Source[],
  limitations: string[],
  offeredActions: string[]
): FinalResult {
  const label = c.entityLabel || "option";
  const plural = (n: number) => pluralize(label, n);
  const recommended = (comparison?.recommendedIds ?? [])
    .map((id) => comparison!.items.find((i) => i.id === id))
    .filter(Boolean) as ResultItem[];
  const infoCount = comparison?.informationCount ?? 0;
  const nSources = sources.length;

  const takeaways: string[] = [];
  recommended.forEach((r, i) => {
    const bits = Object.entries(r.attributes)
      .filter(([k]) => k !== "source")
      .slice(0, 4)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    takeaways.push(`#${i + 1} ${r.name}${bits ? ` — ${bits}` : ""} [source: ${hostname(r.evidenceUrl)}]`);
  });

  let headline: string;
  let summary: string;
  const nextAction = nextActionFor(c, recommended.length, sources);

  if (c.outcome === "procedure" && recommended.length > 0) {
    headline = `Here are the steps, in order`;
    summary =
      `Volo read ${nSources} source${nSources === 1 ? "" : "s"} and extracted ${recommended.length} ` +
      `step${recommended.length === 1 ? "" : "s"} to follow, shown in order below. ` +
      `Each step links to the page it came from — confirm details on the official site before acting.`;
  } else if (c.outcome === "candidates" && recommended.length > 0) {
    headline = `Found ${recommended.length} ${plural(recommended.length)}`;
    summary =
      `From ${nSources} page${nSources === 1 ? "" : "s"} read, ${recommended.length} qualified as ` +
      `real ${plural(recommended.length)} (a named provider with concrete details). ` +
      `The strongest is ${recommended[0].name}. ` +
      (comparison?.rationale ?? "") +
      ` Every value links to the page it came from — verify before acting.`;
  } else if (c.outcome === "candidates") {
    // Honest zero-candidate case — the whole point of this fix.
    headline = `No actual ${plural(2)} found — only information`;
    summary =
      `Volo read ${nSources} page${nSources === 1 ? "" : "s"}` +
      (infoCount > 0
        ? `, but ${infoCount === 1 ? "it was" : "they were"} guides, directories, or listings — not a real ${label} with a name and contact/price. `
        : `, but none contained an actual ${label} with usable details. `) +
      `Rather than pass those off as options, Volo is reporting honestly that no qualifying ${plural(2)} were found. ` +
      `See the sources for what was read.`;
  } else {
    headline = `Information gathered`;
    summary =
      `Volo read ${nSources} page${nSources === 1 ? "" : "s"} relevant to your objective. ` +
      `See the sources below; nothing was fabricated.`;
  }

  return { headline, summary, takeaways, limitations, offeredActions, nextAction };
}

/** A concrete, generic next step to move the objective forward. */
function nextActionFor(c: TaskConstraints, candidateCount: number, sources: Source[]): string {
  const label = c.entityLabel || "option";
  if (c.outcome === "procedure") {
    return candidateCount > 0
      ? "Follow the steps above on the official site; confirm any account-specific details."
      : "No clear steps were extracted — open the official help/policy page directly.";
  }
  if (c.outcome === "candidates") {
    if (candidateCount === 0) {
      if (c.location === "near me" || !c.location) {
        return `Tell Volo your city or area, so it can search local ${pluralize(label)} directly (public search couldn't geo-filter "near me").`;
      }
      return `Provide a specific ${label} directory or site to read, or loosen a constraint — the pages found were informational, not real ${pluralize(label)}.`;
    }
    return `Pick one of the ${candidateCount} ${pluralize(label, candidateCount)} above; Volo can then prepare an enquiry (with your approval) to confirm price and availability.`;
  }
  return "Review the sources below; refine the objective if you need a specific outcome.";
}

// Honest summary of a multi-domain combination/join (BL-2).
function combinationSummary(
  c: TaskConstraints,
  combination: Combination,
  sources: Source[],
  limitations: string[],
  offeredActions: string[]
): FinalResult {
  const recs = combination.recommendedIds
    .map((rid) => combination.options.find((o) => o.id === rid))
    .filter(Boolean) as Combination["options"];
  const lims = [...limitations];
  if (combination.missing.length) {
    lims.push(`No options were found for: ${combination.missing.join(", ")}. Those categories couldn't be filled, so combinations involving them are incomplete.`);
  }
  if (recs.some((o) => !o.priceComplete)) {
    lims.push("Some combinations have unknown prices for one or more parts — their totals are lower bounds, not confirmed against the budget.");
  }

  const takeaways = recs.map((o, i) => {
    const parts = o.picks.map((p) => `${p.label}: ${p.name}${p.price != null ? ` ($${p.price})` : ""}`).join(" + ");
    const total = o.totalPrice != null ? ` — total ~$${o.totalPrice}${o.priceComplete ? "" : " (partial)"}${c.maxPrice != null ? (o.withinBudget ? " ✓ within budget" : " ✗ over/unconfirmed") : ""}` : " — prices n/a";
    return `#${i + 1} ${parts}${total}`;
  });

  let headline: string;
  let summary: string;
  if (recs.length > 0) {
    headline = `Best cross-category combination${recs.length === 1 ? "" : "s"} found`;
    summary = `Researched each category independently, then combined them. ${combination.rationale} Every option links to the page it came from — confirm prices/availability before booking.`;
  } else {
    headline = `Couldn't form a complete combination`;
    summary = `Researched the categories, but couldn't assemble a full in-budget combination. ${combination.rationale} This is reported honestly rather than guessing.`;
  }

  const nextAction =
    recs.length > 0
      ? `Confirm the current price and availability of each part of the top combination, then approve booking/contacting each provider (Volo won't book without your go-ahead).`
      : combination.missing.length
        ? `Provide a specific site/directory for: ${combination.missing.join(", ")}, or loosen a constraint, then retry.`
        : `Loosen the budget or constraints and retry.`;

  return { headline, summary, takeaways, limitations: lims, offeredActions, nextAction };
}

function hostname(url?: string): string {
  if (!url) return "n/a";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
