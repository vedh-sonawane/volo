// ─────────────────────────────────────────────────────────────────────────────
// LLM planner (Phase 5).
//
// Instead of a templated pipeline, the local model AUTHORS the plan: given the
// objective, the parsed constraints, and the tool catalog, it decides which
// tools to run and in what order (and writes the actual search queries). This
// makes plans genuinely different across objectives.
//
// The model is never trusted blindly:
//   • output is parsed defensively (models wrap JSON in prose),
//   • unknown tools are dropped, ordering is repaired (search→fetch→extract),
//   • missing search queries are filled,
//   • if anything is unusable, we return null and the caller falls back to the
//     deterministic planner (so the product still works with no/again slow AI).
//
// Crucially, the model cannot bypass safety: the execution engine still gates
// every action tool behind explicit user approval regardless of the plan.
// ─────────────────────────────────────────────────────────────────────────────

import type { PlanStep, TaskConstraints } from "@/lib/types";
import type { ModelProvider } from "@/lib/providers/model";
import { KIT } from "@/lib/tools/kit";
import { id } from "@/lib/util";
import { buildQueries } from "./planner";

export interface AuthoredPlan {
  steps: PlanStep[];
  rationale: string;
  source: "model";
}

/** Result of authoring: either a single linear plan or a multi-domain split. */
export type AuthoredResult =
  | { mode: "single"; steps: PlanStep[]; rationale: string }
  | { mode: "multi"; subPlans: { label: string; query: string }[]; rationale: string };

function step(tool: string, input: Record<string, unknown>, description: string): PlanStep {
  return { id: id("s_"), status: "pending", sources: [], tool: tool as PlanStep["tool"], input, description, dependsOn: [] };
}

// Hand-written "when to use" guidance per tool, derived from the live KIT so the
// catalog can never reference a tool that doesn't exist.
const TOOL_GUIDANCE: Record<string, string> = {
  reason: "interpret the objective (always implicit; do not include).",
  web_search: "find pages on the open web. input.query = a specific search string.",
  fetch_page: "read the most relevant pages found by a prior web_search. no input.",
  read_document: "read one specific URL the user gave. input.url = the URL.",
  extract_structured: "turn read pages into candidates (real providers/products) or ordered steps. no input.",
  compare: "validate and rank candidates. ONLY for objectives that choose among options.",
  draft_email: "prepare (never send) an enquiry or request message. no input.",
  send_email: "SEND an email. REQUIRES USER APPROVAL. only if the objective asks to contact/send.",
  submit_form: "submit an application/cancellation form. REQUIRES APPROVAL. only if asked to submit/cancel/apply.",
  book: "make a booking/reservation. REQUIRES APPROVAL. only if the objective asks to book/reserve.",
  monitor_inbox: "wait for a reply then continue. only AFTER send_email/submit_form when a reply is expected.",
  calendar_event: "add a confirmed event to a calendar. REQUIRES APPROVAL.",
};

function catalog(): string {
  return Object.keys(KIT)
    .filter((name) => name !== "reason" && TOOL_GUIDANCE[name])
    .map((name) => `- ${name}: ${TOOL_GUIDANCE[name]}`)
    .join("\n");
}

function buildPrompt(objective: string, c: TaskConstraints): string {
  const facts = [
    `outcome=${c.outcome}`,
    `entity=${c.entityLabel}`,
    c.location ? `location=${c.location}` : "",
    c.maxPrice != null ? `budget=$${c.maxPrice}${c.priceUnit ? "/" + c.priceUnit : ""}` : "",
    c.timeframe ? `timeframe=${c.timeframe}` : "",
    c.count ? `wants=${c.count}` : "",
  ]
    .filter(Boolean)
    .join(", ");

  return [
    `OBJECTIVE: ${objective}`,
    `PARSED: ${facts}`,
    ``,
    `AVAILABLE TOOLS (choose only from these):`,
    catalog(),
    ``,
    `RULES:`,
    `- Put web_search before fetch_page before extract_structured.`,
    `- Include compare ONLY when the objective chooses among options (providers/products).`,
    `- Include an action tool (send_email/submit_form/book) ONLY if the objective explicitly asks to perform that action. These will require user approval.`,
    `- Add monitor_inbox only after an action when a reply is expected.`,
    `- For each web_search, write a SPECIFIC query string.`,
    `- Use 3 to 8 steps. Do not include "reason".`,
    ``,
    `Return ONLY JSON of this exact shape:`,
    `{"rationale":"one short sentence","plan":[{"tool":"web_search","input":{"query":"..."}},{"tool":"fetch_page","input":{}}]}`,
  ].join("\n");
}

interface RawStep {
  tool?: string;
  input?: Record<string, unknown>;
}

/** Ask the model to author a plan. Returns null if unavailable/invalid. */
export async function planWithModel(
  objective: string,
  c: TaskConstraints,
  model: ModelProvider
): Promise<AuthoredPlan | null> {
  if (!(await model.available())) return null;
  const text = await model.generate(buildPrompt(objective, c), {
    system:
      "You are the planning module of an autonomous objective-execution engine. " +
      "You choose which TOOLS to run to accomplish the objective. Output ONLY valid JSON. " +
      "Never invent tools. Never claim actions are performed.",
    json: true,
    temperature: 0.3,
    maxTokens: 400,
    timeoutMs: Number(process.env.OLLAMA_PLAN_TIMEOUT_MS || 240_000),
  });
  if (!text) return null;

  const parsed = parseJson(text);
  if (!parsed) return null;
  const rawSteps: RawStep[] = Array.isArray(parsed.plan) ? parsed.plan : [];
  const steps = sanitize(rawSteps, objective, c);
  if (!steps) return null;

  const rationale =
    typeof parsed.rationale === "string" && parsed.rationale.trim()
      ? parsed.rationale.trim().slice(0, 240)
      : "Plan authored by the local model.";
  return { steps, rationale, source: "model" };
}

/**
 * Author a plan, deciding single-domain vs multi-domain (BL-2). For a
 * combinatorial objective (pick one option from each of several categories and
 * evaluate the combination), the model returns category sub-plans; otherwise a
 * normal linear plan. Fully generic — the model names the categories. Returns
 * null when unavailable/unusable so the caller falls back to the deterministic
 * (single-domain) planner.
 */
export async function authorPlan(
  objective: string,
  c: TaskConstraints,
  model: ModelProvider
): Promise<AuthoredResult | null> {
  if (!(await model.available())) return null;
  const prompt = [
    `OBJECTIVE: ${objective}`,
    `PARSED: outcome=${c.outcome}, entity=${c.entityLabel}${c.maxPrice != null ? `, total_budget=$${c.maxPrice}` : ""}${c.location ? `, location=${c.location}` : ""}`,
    ``,
    `AVAILABLE TOOLS (choose only from these):`,
    catalog(),
    ``,
    `FIRST decide the shape:`,
    `- "multi": the objective needs choosing options from 2-4 INDEPENDENT categories`,
    `  and evaluating the COMBINATION across them (e.g. a shared total budget spans`,
    `  categories). List each category with a short label and a specific search query.`,
    `- "single": a normal objective handled by one ordered tool plan.`,
    ``,
    `RULES: web_search before fetch_page before extract_structured; compare only`,
    `when choosing among options; action tools (send_email/submit_form/book) only if`,
    `the objective explicitly asks to perform them (they require approval).`,
    ``,
    `Return ONLY JSON, one of:`,
    `{"mode":"multi","rationale":"one sentence","subPlans":[{"label":"short-category","query":"specific search"}]}`,
    `{"mode":"single","rationale":"one sentence","plan":[{"tool":"web_search","input":{"query":"..."}},{"tool":"fetch_page","input":{}},{"tool":"extract_structured","input":{}},{"tool":"compare","input":{}}]}`,
  ].join("\n");

  // Enough tokens for a multi-category decomposition (up to 4 sub-plans with
  // queries) — too small a budget TRUNCATES the JSON and makes it unparseable.
  // The Promise.race backstop in the provider still guards against a hang.
  const gen = () =>
    model.generate(prompt, {
      system:
        "You are the planning module of an autonomous objective-execution engine. " +
        "Output ONLY valid JSON, nothing else. Never invent tools. Never claim actions are performed.",
      json: true,
      temperature: 0.3,
      maxTokens: 600,
      timeoutMs: Number(process.env.OLLAMA_PLAN_TIMEOUT_MS || 240_000),
    });

  // One retry: transient truncation / malformed JSON shouldn't silently fall back.
  let parsed = parseJson((await gen()) || "") as { mode?: string; rationale?: unknown; plan?: unknown; subPlans?: unknown } | null;
  if (!parsed) parsed = parseJson((await gen()) || "") as typeof parsed;
  if (!parsed) return null;
  const rationale = typeof parsed.rationale === "string" && parsed.rationale.trim() ? parsed.rationale.trim().slice(0, 240) : "Plan authored by the local model.";

  if (parsed.mode === "multi" && Array.isArray(parsed.subPlans)) {
    const subPlans = (parsed.subPlans as { label?: unknown; query?: unknown }[])
      .filter((s) => s && typeof s.query === "string" && (s.query as string).trim().length > 2)
      .map((s, i) => ({
        label: (typeof s.label === "string" && s.label.trim() ? s.label : `category ${i + 1}`).slice(0, 40),
        query: (s.query as string).trim(),
      }))
      .slice(0, 4);
    // Need at least 2 categories to be a genuine combination.
    if (subPlans.length >= 2) return { mode: "multi", subPlans, rationale };
  }

  // Fall back to treating it as single if a usable plan array is present.
  const rawSteps: RawStep[] = Array.isArray(parsed.plan) ? (parsed.plan as RawStep[]) : [];
  const steps = sanitize(rawSteps, objective, c);
  if (steps) return { mode: "single", steps, rationale };
  return null;
}

/**
 * Reactive re-planning: given an observation about what happened (e.g. "0
 * candidates found"), ask the model for a short recovery plan to append. Returns
 * null when the model declines, is unavailable, or produces nothing usable —
 * genuine runtime adaptation, bounded by the caller.
 */
export async function replanWithModel(
  objective: string,
  c: TaskConstraints,
  model: ModelProvider,
  observation: string
): Promise<AuthoredPlan | null> {
  if (!(await model.available())) return null;
  const prompt = [
    `OBJECTIVE: ${objective}`,
    `SITUATION: ${observation}`,
    ``,
    `Available tools:`,
    catalog(),
    ``,
    `Decide a SHORT recovery plan (1-4 steps) to make progress, e.g. a different`,
    `web_search with a better query, reading a specific site, or stopping.`,
    `If nothing more can help, return an empty plan.`,
    ``,
    `Return ONLY JSON: {"rationale":"one sentence","plan":[{"tool":"web_search","input":{"query":"..."}}]}`,
  ].join("\n");
  const text = await model.generate(prompt, {
    system: "You are the re-planning module of an objective-execution engine. Output ONLY valid JSON.",
    json: true,
    temperature: 0.4,
    maxTokens: 250,
    timeoutMs: Number(process.env.OLLAMA_PLAN_TIMEOUT_MS || 240_000),
  });
  if (!text) return null;
  const parsed = parseJson(text);
  if (!parsed) return null;
  const rawSteps: RawStep[] = Array.isArray(parsed.plan) ? parsed.plan : [];
  if (rawSteps.length === 0) return null;
  const steps = sanitize(rawSteps, objective, c);
  if (!steps) return null;
  // Drop the injected leading "reason" step — re-planning continues an existing run.
  const recovery = steps.filter((s) => s.tool !== "reason");
  if (recovery.length === 0) return null;
  const rationale = typeof parsed.rationale === "string" ? parsed.rationale.trim().slice(0, 200) : "Recovery plan.";
  return { steps: recovery, rationale, source: "model" };
}

/** Extract the first balanced JSON object from possibly-noisy model text. */
function parseJson(text: string): { rationale?: unknown; plan?: unknown } | null {
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

function fallbackQuery(objective: string, c: TaskConstraints): string {
  return buildQueries(objective, c)[0] || objective.slice(0, 80);
}

/**
 * Validate + repair a model-authored step list into an executable plan. Respects
 * the model's tool selection and ordering; only fixes what would break the run.
 */
function sanitize(raw: RawStep[], objective: string, c: TaskConstraints): PlanStep[] | null {
  const known = raw.filter((s) => s && typeof s.tool === "string" && KIT[s.tool]);
  if (known.length === 0) return null;

  // Rebuild with coherence guarantees.
  const out: { tool: string; input: Record<string, unknown> }[] = [];
  const has = (t: string) => out.some((x) => x.tool === t);

  for (const s of known) {
    const tool = s.tool!;
    const input = (s.input && typeof s.input === "object" ? s.input : {}) as Record<string, unknown>;

    if (tool === "web_search" && !input.query) input.query = fallbackQuery(objective, c);
    if (tool === "read_document" && typeof input.url !== "string") continue; // useless without a URL

    if (tool === "extract_structured") {
      const hasReader = has("fetch_page") || has("read_document");
      if (!hasReader) {
        if (!has("web_search")) out.push({ tool: "web_search", input: { query: fallbackQuery(objective, c) } });
        out.push({ tool: "fetch_page", input: {} });
      }
    }
    // Avoid pointless consecutive duplicates (except distinct searches).
    const last = out[out.length - 1];
    if (last && last.tool === tool && tool !== "web_search") continue;
    out.push({ tool, input });
  }

  // A trailing search with nothing reading it → add a fetch.
  if (has("web_search") && !has("fetch_page")) {
    let idx = -1;
    out.forEach((x, i) => x.tool === "web_search" && (idx = i));
    out.splice(idx + 1, 0, { tool: "fetch_page", input: {} });
  }

  const capped = out.slice(0, 12);
  // Must include at least one information-gathering tool to be a real plan.
  if (!capped.some((x) => ["web_search", "read_document", "extract_structured"].includes(x.tool))) return null;

  const reasonStep = step("reason", { objective, constraints: c }, "Interpret the objective and constraints");
  const rest = capped.map((x) => step(x.tool, x.input, describe(x.tool, x.input, c)));
  const plan = [reasonStep, ...rest];
  // Linear dependencies so the engine runs them in order.
  for (let i = 1; i < plan.length; i++) plan[i].dependsOn = [plan[i - 1].id];
  return plan;
}

function describe(tool: string, input: Record<string, unknown>, c: TaskConstraints): string {
  const label = c.entityLabel || "option";
  switch (tool) {
    case "web_search":
      return `Search the web for: "${String(input.query || "")}"`;
    case "fetch_page":
      return "Read the most relevant pages found";
    case "read_document":
      return `Read the document at ${String(input.url || "")}`;
    case "extract_structured":
      return c.outcome === "candidates" ? `Identify actual ${label}s and extract their details` : "Extract the key information / steps";
    case "compare":
      return `Validate and rank the ${label} candidates`;
    case "draft_email":
      return `Prepare an enquiry/request (never sent)`;
    case "send_email":
      return `Send the message — requires your approval`;
    case "submit_form":
      return `Submit the request — requires your approval`;
    case "book":
      return `Make the booking — requires your approval`;
    case "monitor_inbox":
      return "Wait for and read the reply, then continue";
    case "calendar_event":
      return "Add the confirmed event to a calendar — requires your approval";
    default:
      return tool;
  }
}
