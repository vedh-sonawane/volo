// Produces the final human-facing result (Phase 6/9). Uses the model provider
// when one is available for nicer prose, but ALWAYS has a deterministic
// fallback built from real extracted data so the app works with zero AI.

import type {
  Comparison,
  FinalResult,
  ResultItem,
  Source,
  TaskConstraints,
} from "@/lib/types";
import type { ModelProvider } from "@/lib/providers/model";
import { schemaFor } from "./domains";
import { truncate } from "@/lib/util";

export async function summarize(
  objective: string,
  c: TaskConstraints,
  comparison: Comparison | undefined,
  sources: Source[],
  model: ModelProvider,
  limitations: string[],
  offeredActions: string[]
): Promise<FinalResult> {
  const deterministic = deterministicSummary(objective, c, comparison, sources, limitations, offeredActions);

  // Optionally enrich the summary prose with a local model — never required,
  // and we still return real takeaways/limitations regardless.
  if (await model.available()) {
    const top = comparison?.recommendedIds
      .map((id) => comparison.items.find((i) => i.id === id))
      .filter(Boolean) as ResultItem[] | undefined;
    const prompt = buildPrompt(objective, c, top ?? [], sources);
    const text = await model.generate(prompt, {
      system:
        "You are a careful research assistant. Only use the provided facts. " +
        "Do not invent prices, names, or availability. Be concise.",
      maxTokens: 300,
      temperature: 0.2,
    });
    if (text && text.length > 20) {
      return { ...deterministic, summary: truncate(text.trim(), 900) };
    }
  }
  return deterministic;
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
  const schema = schemaFor(c.domain);
  const recommended = (comparison?.recommendedIds ?? [])
    .map((id) => comparison!.items.find((i) => i.id === id))
    .filter(Boolean) as ResultItem[];

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
  if (c.domain === "howto" && recommended.length > 0) {
    headline = `Here are the steps, in order`;
    summary =
      `Volo read ${sources.length} source${sources.length === 1 ? "" : "s"} and extracted ${recommended.length} ` +
      `step${recommended.length === 1 ? "" : "s"} to follow, shown in order below. ` +
      `Each step links to the page it came from — confirm details on the official site before acting.`;
  } else if (recommended.length > 0) {
    headline = `Found ${recommended.length} ${schema.noun}${recommended.length === 1 ? "" : "s"} for your objective`;
    summary =
      `Based on ${sources.length} source${sources.length === 1 ? "" : "s"}, ` +
      `the strongest option is ${recommended[0].name}. ` +
      (comparison?.rationale ?? "") +
      ` Every value above is linked to the page it came from — verify before acting.`;
  } else {
    headline = `No verifiable ${schema.noun}s matched automatically`;
    summary =
      `Volo searched the web and read ${sources.length} page${sources.length === 1 ? "" : "s"}, ` +
      `but couldn't extract enough structured, in-budget options to recommend confidently. ` +
      `This is reported honestly rather than guessing. Try adding a specific location or loosening constraints.`;
  }

  return { headline, summary, takeaways, limitations, offeredActions };
}

function hostname(url?: string): string {
  if (!url) return "n/a";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
