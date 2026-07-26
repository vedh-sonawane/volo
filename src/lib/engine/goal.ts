// ─────────────────────────────────────────────────────────────────────────────
// Goal understanding (general, domain-agnostic).
//
// Turns a messy natural-language objective into a GoalModel: hard constraints
// (must hold), soft preferences (rank, don't filter), assumptions, and
// missing-information items classified as blocking / optional / researchable.
// The planner consumes this instead of hardcoding any domain logic.
//
// When a model is available it authors the goal model (and can ask minimal
// clarifying questions). With no model, a deterministic fallback derives a basic
// goal model from the parsed constraints and NEVER blocks — so the zero-AI path
// keeps working exactly as before.
// ─────────────────────────────────────────────────────────────────────────────

import type { Clarification, GoalModel, TaskConstraints } from "@/lib/types";
import type { ModelProvider } from "@/lib/providers/model";
import { id } from "@/lib/util";
import { detectContradictions } from "./contradictions";

/** Turn detected contradictions into clarifications (deterministic, generic). */
function contradictionClarifications(objective: string, c: TaskConstraints): Clarification[] {
  return detectContradictions(objective, c.quantities || {}).map((x) => ({ id: id("q_"), question: x.question, importance: x.importance }));
}

/** Merge, de-duplicating by question text. */
function mergeClarifications(a: Clarification[], b: Clarification[]): Clarification[] {
  const seen = new Set(a.map((x) => x.question.toLowerCase()));
  return [...a, ...b.filter((x) => !seen.has(x.question.toLowerCase()))];
}

const SOFT_CUES = /\b(prefer(?:ably)?|ideally|would like|nice to have|hopefully|if possible|leaning towards?|rather)\b/i;

/** Deterministic goal model from parsed constraints — never blocks. */
export function deterministicGoal(objective: string, c: TaskConstraints): GoalModel {
  const hard: string[] = [];
  if (c.maxPrice != null) hard.push(`Budget: at most $${c.maxPrice}${c.priceUnit ? "/" + c.priceUnit : ""}`);
  if (c.location && c.location !== "near me") hard.push(`Location: ${c.location}`);
  if (c.count) hard.push(`Wants ${c.count} option(s)`);
  if (c.timeframe) hard.push(`Timeframe: ${c.timeframe}`);
  const soft: string[] = [];
  if (SOFT_CUES.test(objective)) {
    // Pull the clause around a soft cue as a preference.
    const m = objective.match(new RegExp(`([^.,;]*\\b(?:prefer(?:ably)?|ideally|nice to have|if possible)\\b[^.,;]*)`, "i"));
    if (m) soft.push(m[1].trim());
  }
  return {
    summary: objective.length > 160 ? objective.slice(0, 157) + "…" : objective,
    hard,
    soft,
    assumptions: c.location === "near me" ? ['"near me" — assuming no specific city was given.'] : [],
    // Even without a model, surface any concrete contradictions (dates/budgets).
    clarifications: contradictionClarifications(objective, c),
    source: "rule",
  };
}

/**
 * Author the goal model with the model. Returns null if unavailable/unusable so
 * the caller falls back to the deterministic model.
 */
export async function understandGoal(
  objective: string,
  c: TaskConstraints,
  model: ModelProvider
): Promise<GoalModel | null> {
  if (!(await model.available())) return null;
  const prompt = [
    `OBJECTIVE: ${objective}`,
    ``,
    `Analyze this messy natural-language goal. Extract:`,
    `- "hard": constraints that MUST hold (budget, dates, counts, must-have features).`,
    `- "soft": preferences used to RANK, not to filter (e.g. "cheap", "central", "good coverage").`,
    `- "assumptions": what you'll assume if something is unstated.`,
    `- "clarifications": missing info. Classify each importance:`,
    `    "blocking" = you genuinely cannot proceed or act SAFELY without it,`,
    `    "optional" = helpful but you can proceed and note an assumption,`,
    `    "researchable" = you can find it yourself (do NOT ask the user).`,
    `Ask as FEW blocking questions as possible — only what truly blocks safe execution.`,
    ``,
    `Return ONLY minimal JSON:`,
    `{"summary":"one sentence","hard":["..."],"soft":["..."],"assumptions":["..."],"clarifications":[{"question":"...","importance":"blocking"}]}`,
  ].join("\n");

  const text = await model.generate(prompt, {
    system: "You are the goal-understanding module of an objective-execution engine. Output ONLY minimal valid JSON. Never invent facts about the user.",
    json: true,
    temperature: 0.3,
    maxTokens: 320,
    timeoutMs: Number(process.env.OLLAMA_PLAN_TIMEOUT_MS || 200_000),
  });
  if (!text) return null;
  const parsed = parseJson(text);
  if (!parsed) return null;

  const clarifications: Clarification[] = toArr(parsed.clarifications)
    .map((x) => {
      const q = typeof x?.question === "string" ? x.question.trim() : "";
      let imp = typeof x?.importance === "string" ? x.importance.toLowerCase() : "optional";
      if (imp !== "blocking" && imp !== "optional" && imp !== "researchable") imp = "optional";
      return q ? { id: id("q_"), question: q.slice(0, 200), importance: imp as Clarification["importance"] } : null;
    })
    .filter(Boolean) as Clarification[];

  // Augment the model's questions with deterministic contradiction checks the
  // model may have missed (dates/budgets are computed, not guessed).
  const merged = mergeClarifications(contradictionClarifications(objective, c), clarifications);

  return {
    summary: typeof parsed.summary === "string" && parsed.summary.trim() ? parsed.summary.trim().slice(0, 240) : objective.slice(0, 160),
    hard: toStrArr(parsed.hard).slice(0, 8),
    soft: toStrArr(parsed.soft).slice(0, 8),
    assumptions: toStrArr(parsed.assumptions).slice(0, 6),
    clarifications: merged.slice(0, 6),
    source: "model",
  };
}

interface RawGoal {
  summary?: unknown;
  hard?: unknown;
  soft?: unknown;
  assumptions?: unknown;
  clarifications?: unknown;
}

function toArr(v: unknown): { question?: unknown; importance?: unknown }[] {
  return Array.isArray(v) ? v : [];
}
function toStrArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === "string" && x.trim()).map((x) => (x as string).trim().slice(0, 160));
}

function parseJson(text: string): RawGoal | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
