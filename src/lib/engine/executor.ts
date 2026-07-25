// ─────────────────────────────────────────────────────────────────────────────
// Executor — orchestrates the objective → outcome pipeline (Phases 2-7).
//
// Honesty rules enforced here:
//   • Status only advances when the underlying work actually happened.
//   • Every source is recorded only after it is really fetched.
//   • Nothing consequential runs automatically — actions become ApprovalRequests.
//   • On any failure the task ends in `failed` with a human explanation.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  ApprovalRequest,
  PlanStep,
  Source,
  StreamEvent,
  Task,
  TaskStatus,
  TimelineEvent,
} from "@/lib/types";
import { getResearchProvider } from "@/lib/providers/research";
import type { FetchedPage, SearchResult } from "@/lib/providers/research";
import { resolveModel } from "@/lib/providers/model";
import { saveTask } from "@/lib/store";
import { hostOf, id, uniq } from "@/lib/util";
import { understand } from "./understand";
import { createPlan } from "./planner";
import { extractStructured } from "./extract-structured";
import { compareResults, parsePrice } from "./compare";
import { summarize } from "./summarize";
import { schemaFor } from "./domains";

type Emit = (e: StreamEvent) => void;

const MAX_FETCHES = Number(process.env.RESEARCH_MAX_FETCHES || 6);

export async function runTask(task: Task, emit: Emit): Promise<void> {
  const ctx = new RunContext(task, emit);
  try {
    await understandPhase(ctx);
    await planPhase(ctx);
    await researchPhase(ctx);
    await extractPhase(ctx);
    await comparePhase(ctx);
    await finalizePhase(ctx);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unexpected error";
    ctx.fail(message);
  }
  emit({ type: "done", task: ctx.task });
}

class RunContext {
  constructor(public task: Task, public emit: Emit) {}

  setStatus(status: TaskStatus) {
    this.task.status = status;
    this.emit({ type: "status", status });
    this.persist();
  }

  log(status: TaskStatus, level: TimelineEvent["level"], message: string, detail?: string, stepId?: string) {
    const event: TimelineEvent = { id: id("t_"), at: Date.now(), status, level, message, detail, stepId };
    this.task.timeline.push(event);
    this.emit({ type: "timeline", event });
    this.persist();
  }

  updateStep(step: PlanStep) {
    this.emit({ type: "step", step });
    this.persist();
  }

  addSource(s: Source) {
    if (this.task.sources.some((x) => x.url === s.url)) return;
    this.task.sources.push(s);
    this.emit({ type: "source", source: s });
    this.persist();
  }

  fail(message: string) {
    this.task.status = "failed";
    this.task.failure = message;
    this.log("failed", "error", `Task failed: ${message}`);
    this.emit({ type: "status", status: "failed" });
    this.persist();
  }

  persist() {
    saveTask(this.task);
  }
}

// ── Phase: understand ────────────────────────────────────────────────────────
async function understandPhase(ctx: RunContext) {
  ctx.setStatus("understanding");
  const step = ctx.task.plan.find((s) => s.tool === "reason");
  if (step) {
    step.status = "running";
    step.startedAt = Date.now();
    ctx.updateStep(step);
  }
  const c = ctx.task.constraints;
  const bits: string[] = [`type: ${c.domain}`];
  if (c.location) bits.push(`location: ${c.location}`);
  if (c.maxPrice != null) bits.push(`budget: $${c.maxPrice}${c.priceUnit ? "/" + c.priceUnit : ""}`);
  if (c.count) bits.push(`wants: ${c.count}`);
  if (c.partySize) bits.push(`party: ${c.partySize}`);
  if (c.timeframe) bits.push(`when: ${c.timeframe}`);
  ctx.log("understanding", "info", "Parsed the objective into constraints", bits.join(" · "));
  if (c.location === "near me") {
    ctx.log(
      "understanding",
      "warn",
      'Objective says "near me" but no specific location was given — results may be broad. Add a city for sharper results.'
    );
  }
  if (step) {
    step.status = "done";
    step.confidence = 0.9;
    step.finishedAt = Date.now();
    step.output = c;
    ctx.updateStep(step);
  }
}

// ── Phase: plan ──────────────────────────────────────────────────────────────
async function planPhase(ctx: RunContext) {
  ctx.setStatus("planning");
  ctx.log("planning", "info", `Built an execution plan with ${ctx.task.plan.length} steps`);
}

// ── Phase: research (search + fetch) ─────────────────────────────────────────
async function researchPhase(ctx: RunContext) {
  ctx.setStatus("researching");
  const research = getResearchProvider();
  ctx.task.researchProvider = research.name;

  const searchSteps = ctx.task.plan.filter((s) => s.tool === "web_search");
  // Run searches in parallel (they are independent).
  const searchResults = await Promise.all(
    searchSteps.map(async (step) => {
      step.status = "running";
      step.startedAt = Date.now();
      ctx.updateStep(step);
      const query = String(step.input.query || "");
      const results = await research.search(query, 8);
      step.status = results.length ? "done" : "failed";
      step.finishedAt = Date.now();
      step.output = results;
      step.confidence = results.length ? 0.7 : 0.2;
      if (!results.length) step.error = "No results returned (provider may be rate-limited)";
      step.sources = results.map((r) => r.url);
      ctx.updateStep(step);
      ctx.log(
        "researching",
        results.length ? "success" : "warn",
        `Search "${query}" → ${results.length} result${results.length === 1 ? "" : "s"}`,
        undefined,
        step.id
      );
      return results;
    })
  );

  const all: SearchResult[] = dedupeResults(searchResults.flat());
  if (all.length === 0) {
    ctx.log("researching", "warn", "No search results across all queries. The free provider may be temporarily rate-limiting.");
  }

  // Rank candidate pages by relevance to the constraints, then fetch top N.
  const ranked = rankCandidates(all, ctx.task);
  const toFetch = ranked.slice(0, MAX_FETCHES);

  const fetchStep = ctx.task.plan.find((s) => s.tool === "fetch_page");
  if (fetchStep) {
    fetchStep.status = "running";
    fetchStep.startedAt = Date.now();
    ctx.updateStep(fetchStep);
  }
  ctx.log("researching", "info", `Visiting the ${toFetch.length} most relevant page${toFetch.length === 1 ? "" : "s"}`);

  const pages = await Promise.all(
    toFetch.map(async (r) => {
      const page = await research.fetch(r.url);
      if (page.ok) {
        ctx.addSource({
          url: page.finalUrl,
          title: page.title || r.title,
          snippet: r.snippet,
          fetchedAt: Date.now(),
          words: page.words,
        });
        ctx.log("researching", "success", `Read ${hostOf(page.finalUrl)}`, `${page.words} words`, fetchStep?.id);
      } else {
        ctx.log("researching", "warn", `Could not read ${hostOf(r.url)}`, page.error, fetchStep?.id);
      }
      return page;
    })
  );

  const okPages = pages.filter((p) => p.ok);
  if (fetchStep) {
    fetchStep.status = okPages.length ? "done" : "failed";
    fetchStep.finishedAt = Date.now();
    fetchStep.sources = okPages.map((p) => p.finalUrl);
    fetchStep.confidence = okPages.length ? 0.7 : 0.2;
    fetchStep.output = { fetched: okPages.length };
    ctx.updateStep(fetchStep);
  }

  // Stash pages on the context for the extraction phase.
  (ctx as unknown as { pages: FetchedPage[] }).pages = okPages;
}

// ── Phase: extract ───────────────────────────────────────────────────────────
async function extractPhase(ctx: RunContext) {
  ctx.setStatus("extracting");
  const pages = (ctx as unknown as { pages?: FetchedPage[] }).pages ?? [];
  const step = ctx.task.plan.find((s) => s.tool === "extract_structured");
  if (step) {
    step.status = "running";
    step.startedAt = Date.now();
    ctx.updateStep(step);
  }
  const items = extractStructured(pages, ctx.task.constraints);
  ctx.task.results = items;
  ctx.emit({ type: "results", results: items });
  ctx.persist();
  if (step) {
    step.status = items.length ? "done" : "failed";
    step.finishedAt = Date.now();
    step.output = { extracted: items.length };
    step.confidence = items.length ? 0.6 : 0.2;
    step.sources = uniq(items.map((i) => i.evidenceUrl || "").filter(Boolean));
    if (!items.length) step.error = "No structured options could be extracted from the pages read.";
    ctx.updateStep(step);
  }
  ctx.log(
    "extracting",
    items.length ? "success" : "warn",
    `Extracted ${items.length} candidate option${items.length === 1 ? "" : "s"} with evidence`
  );
}

// ── Phase: compare ───────────────────────────────────────────────────────────
async function comparePhase(ctx: RunContext) {
  ctx.setStatus("comparing");
  const step = ctx.task.plan.find((s) => s.tool === "compare");
  if (step) {
    step.status = "running";
    step.startedAt = Date.now();
    ctx.updateStep(step);
  }
  const comparison = compareResults(ctx.task.results, ctx.task.constraints);
  ctx.task.comparison = comparison;
  ctx.emit({ type: "comparison", comparison });
  ctx.persist();
  if (step) {
    step.status = "done";
    step.finishedAt = Date.now();
    step.output = { recommended: comparison.recommendedIds.length };
    step.confidence = comparison.recommendedIds.length ? 0.7 : 0.3;
    ctx.updateStep(step);
  }
  ctx.log("comparing", "info", comparison.rationale);
}

// ── Phase: finalize (summary + offered actions/approvals) ────────────────────
async function finalizePhase(ctx: RunContext) {
  const model = await resolveModel();
  ctx.task.modelProvider = model.name;

  const { limitations, offeredActions, approvals } = deriveActions(ctx.task);
  for (const a of approvals) {
    ctx.task.approvals.push(a);
    ctx.emit({ type: "approval", approval: a });
  }

  const final = await summarize(
    ctx.task.objective,
    ctx.task.constraints,
    ctx.task.comparison,
    ctx.task.sources,
    model,
    limitations,
    offeredActions
  );
  ctx.task.finalResult = final;
  ctx.emit({ type: "final", final });

  if (approvals.length > 0) {
    ctx.setStatus("awaiting_approval");
    ctx.log("awaiting_approval", "info", `Research complete. ${approvals.length} optional action${approvals.length === 1 ? "" : "s"} await your approval.`);
  } else {
    ctx.setStatus("completed");
  }
  ctx.log(ctx.task.status, "success", "Research finished. All values above are linked to their sources.");
}

// Derive honest limitations + consequential actions that need approval.
function deriveActions(task: Task): {
  limitations: string[];
  offeredActions: string[];
  approvals: ApprovalRequest[];
} {
  const c = task.constraints;
  const schema = schemaFor(c.domain);
  const limitations: string[] = [];
  const offeredActions: string[] = [];
  const approvals: ApprovalRequest[] = [];

  const top = (task.comparison?.recommendedIds ?? [])
    .map((rid) => task.comparison!.items.find((i) => i.id === rid))
    .filter(Boolean)!;

  if (c.location === "near me") {
    limitations.push('You said "near me" without a city, so results are not geo-filtered. Add a location to sharpen them.');
  }
  if (c.timeframe) {
    limitations.push(`Live availability for "${c.timeframe}" usually isn't on public pages — confirm directly with the provider.`);
  }
  limitations.push("Prices and details change; Volo shows what each page said at fetch time, with the source to verify.");

  // Offer a consequential action appropriate to the domain — gated by approval.
  const first = top[0];
  if (first && (c.domain === "instructors")) {
    offeredActions.push("Draft an enquiry email to the top instructor (you review before anything is sent).");
    approvals.push(actionApproval(
      "send_email",
      `Contact ${first.name}`,
      `Prepare and send an enquiry asking about price and availability${c.timeframe ? ` for ${c.timeframe}` : ""}.`,
      first.attributes.contact || first.attributes.website || "contact not found on page",
      "Sending is disabled in the free version — approving produces a draft + exact steps only.",
    ));
  }
  if (first && c.domain === "restaurants") {
    offeredActions.push("Prepare a reservation request for the top restaurant (you confirm before booking).");
    approvals.push(actionApproval(
      "book",
      `Reserve at ${first.name}`,
      `Prepare a table reservation${c.partySize ? ` for ${c.partySize} people` : ""}${c.timeframe ? ` ${c.timeframe}` : ""}.`,
      first.attributes.booking || first.attributes.website || "booking link not found",
      "Booking is disabled in the free version — approving gives you the exact booking steps + link.",
    ));
  }

  if (task.results.length === 0) {
    limitations.push(`No ${schema.noun}s could be extracted automatically — the free search provider may be rate-limited, or the sites block scraping. You can retry, or add a specific location.`);
  }

  return { limitations, offeredActions, approvals };
}

function actionApproval(
  tool: ApprovalRequest["tool"],
  title: string,
  description: string,
  target: string,
  commitment: string
): ApprovalRequest {
  return {
    id: id("a_"),
    tool,
    title,
    description,
    payloadPreview: description,
    target,
    commitment,
    status: "pending",
    createdAt: Date.now(),
  };
}

// ── helpers ──────────────────────────────────────────────────────────────────
function dedupeResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const r of results) {
    const key = r.url.split("#")[0];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

const BLOCK_HOSTS = ["pinterest.", "facebook.", "instagram.", "tiktok.", "youtube.", "reddit.com/login"];

function rankCandidates(results: SearchResult[], task: Task): SearchResult[] {
  const c = task.constraints;
  const schema = schemaFor(c.domain);
  const kw = [...c.keywords, ...(c.location && c.location !== "near me" ? [c.location.toLowerCase()] : [])];
  return results
    .filter((r) => !BLOCK_HOSTS.some((h) => r.url.includes(h)))
    .map((r) => {
      const hay = `${r.title} ${r.snippet}`.toLowerCase();
      let score = 0;
      for (const k of kw) if (hay.includes(k)) score += 2;
      for (const h of schema.entityHints) if (hay.includes(h)) score += 1;
      if (parsePrice(hay) != null) score += 1;
      return { r, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.r);
}
