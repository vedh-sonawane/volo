// ─────────────────────────────────────────────────────────────────────────────
// Execution engine — a GENERIC tool runner.
//
// The engine does not know anything about "web research". It walks the plan the
// planner produced and dispatches each step to its tool in the kit, threading a
// shared blackboard between them. Research, extraction, comparison, drafting and
// actions are all just tools. When it reaches a consequential action (a tool
// that requires approval), it stops and turns that step into an ApprovalRequest
// — Volo never performs an external action automatically.
//
// Honesty rules: status advances only when a tool actually ran; sources are
// recorded only after a real fetch; a not-implemented action is never faked.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  ApprovalRequest,
  Comparison,
  PlanStep,
  ResultItem,
  Source,
  StreamEvent,
  SubPlan,
  Task,
  TaskConstraints,
  TaskStatus,
  TimelineEvent,
  ToolName,
} from "@/lib/types";
import { resolveModel } from "@/lib/providers/model";
import type { ModelProvider } from "@/lib/providers/model";
import { saveTask } from "@/lib/store";
import { id } from "@/lib/util";
import { summarize } from "./summarize";
import { createPlan, buildMultiPlan } from "./planner";
import { authorPlan, replanWithModel } from "./llm-planner";
import { understand } from "./understand";
import { understandGoal, deterministicGoal } from "./goal";
import { deterministicDecompose, reconcileCategories } from "./classify";
import { parsePrice } from "./compare";
import { cfg } from "@/lib/config";

/** Best-effort currency for a financial quote (CAD/USD/GBP/EUR), default USD. */
function currencyFor(c: TaskConstraints, priceText?: string): string {
  const hay = `${priceText ?? ""} ${c.keywords.join(" ")} ${c.location ?? ""}`.toLowerCase();
  if (/\bcad\b|canad|toronto|ontario|vancouver|montreal/.test(hay)) return "CAD";
  if (/\bgbp\b|£|london|\buk\b/.test(hay)) return "GBP";
  if (/\beur\b|€|paris|berlin|madrid/.test(hay)) return "EUR";
  return "USD";
}
import { KIT } from "@/lib/tools/kit";
import type { ToolContext } from "@/lib/tools/kit";
import type { EmailDraft } from "@/lib/tools/email-draft";

type Emit = (e: StreamEvent) => void;


// Which lifecycle status each tool represents (for the stepper / timeline).
// `reason` deliberately omitted so it doesn't regress the stepper after planning.
const STATUS_FOR_TOOL: Partial<Record<ToolName, TaskStatus>> = {
  web_search: "researching",
  fetch_page: "researching",
  read_document: "researching",
  extract_structured: "extracting",
  compare: "comparing",
  combine_domains: "comparing",
  draft_email: "comparing",
};

const MAX_REPLANS = 1;

/** Fresh run: understand → (maybe ask) → plan → execute. */
export async function runTask(task: Task, emit: Emit): Promise<void> {
  const ctx = new RunContext(task, emit);
  try {
    const model = await resolveModel();
    task.modelProvider = model.name;
    const proceed = await planPhase(ctx, model);
    if (proceed) {
      if (task.multiDomain) await executeMultiDomain(ctx, model);
      else await executeLoop(ctx, model, 0);
      await finalize(ctx, model);
    }
    // If planPhase paused for clarification, we stop here — the objective is
    // persisted in awaiting_clarification and resumes when the user answers.
  } catch (e) {
    ctx.fail(e instanceof Error ? e.message : "Unexpected error");
  }
  emit({ type: "done", task: ctx.task });
}

/** The objective plus any clarification answers the user has provided. */
function effectiveObjective(task: Task): string {
  return task.clarificationContext ? `${task.objective}\n\nAdditional details from the user:\n${task.clarificationContext}` : task.objective;
}

/**
 * Resume a persisted objective from where it stopped (Phase 9). Does NOT re-plan
 * — the plan already exists. Continues from the first step that isn't finished,
 * which is how an objective that was waiting for an external reply (or an
 * approval) picks up after the user relays it — even across a server restart.
 */
export async function resumeTask(task: Task, emit: Emit): Promise<void> {
  const ctx = new RunContext(task, emit);
  try {
    const model = await resolveModel();
    task.modelProvider = model.name;
    const start = firstUnfinishedIndex(task);
    if (start < 0) {
      await finalize(ctx, model);
    } else {
      await executeLoop(ctx, model, start);
      await finalize(ctx, model);
    }
  } catch (e) {
    ctx.fail(e instanceof Error ? e.message : "Unexpected error");
  }
  emit({ type: "done", task: ctx.task });
}

function firstUnfinishedIndex(task: Task): number {
  return task.plan.findIndex((s) => s.status === "pending" || s.status === "blocked_on_approval" || s.status === "waiting" || s.status === "running");
}

/**
 * The generic tool-runner loop. Walks the plan from `start`, dispatching each
 * step to its tool. It stops (persisting state) at two kinds of checkpoint:
 *   • a tool that requires approval → awaiting_approval
 *   • monitor_inbox with no relayed reply yet → waiting_response
 * Either way the objective is fully persisted and can be resumed later.
 */
async function executeLoop(ctx: RunContext, model: ModelProvider, start: number) {
  const task = ctx.task;
  let i = start;
  let paused = false;
  let replans = 0;

  while (i < task.plan.length) {
    const step = task.plan[i];
    const tool = KIT[step.tool];
    if (!tool) {
      markStep(ctx, step, "failed", { error: `Unknown tool: ${step.tool}` });
      i++;
      continue;
    }

    // Wait-for-external-reply checkpoint. Volo cannot watch an inbox for free,
    // so it pauses honestly until the user relays the reply (or consumes one
    // that was already relayed).
    if (step.tool === "monitor_inbox") {
      const reply = consumeReply(task);
      if (reply) {
        markStep(ctx, step, "done", { output: { reply: reply.text } });
        ctx.log("success", "Received the reply you relayed — continuing.", reply.text.slice(0, 120));
        i++;
        continue;
      }
      enterWaiting(ctx, step);
      paused = true;
      break;
    }

    // Consequential action → stop and request approval.
    if (tool.requiresApproval) {
      pauseForApproval(ctx, step);
      paused = true;
      break;
    }

    const status = STATUS_FOR_TOOL[step.tool as ToolName];
    if (status) ctx.setStatus(status);

    // Enter this step's scope (a sub-plan, or global). Marks the sub-plan active.
    ctx.currentGroup = step.group ?? null;
    if (step.group) {
      const sp = task.subPlans?.find((s) => s.id === step.group);
      if (sp && sp.status === "pending") sp.status = "running";
    }

    step.status = "running";
    step.startedAt = Date.now();
    ctx.updateStep(step);

    const result = await tool.run(step.input as Record<string, unknown>, ctx);
    ctx.currentGroup = null;
    markStep(ctx, step, result.ok ? "done" : "failed", {
      output: result.output,
      confidence: result.confidence,
      error: result.ok ? undefined : result.error,
    });
    i++;

    // Reached the end with an empty result? Let the model adapt at runtime.
    // (Single-domain only — multi-domain gaps are reported by the join stage.)
    if (i >= task.plan.length && !paused && replans < MAX_REPLANS && !task.multiDomain) {
      const extra = await maybeReplan(ctx, model);
      if (extra.length) {
        replans++;
        task.plan.push(...extra);
        ctx.emit({ type: "task", task });
      }
    }
  }
}

/**
 * Multi-domain execution: run the pre-steps (understanding), then each category
 * sub-plan IN PARALLEL (independent research streams), then the combine/join +
 * any action steps sequentially via the normal loop (which handles approvals /
 * waiting). Each parallel group runs in its own pinned scope so their state
 * never races.
 */
async function executeMultiDomain(ctx: RunContext, model: ModelProvider) {
  const plan = ctx.task.plan;
  const firstGroupIdx = plan.findIndex((s) => s.group);
  if (firstGroupIdx < 0) {
    await executeLoop(ctx, model, 0);
    return;
  }
  const afterGroups = plan.findIndex((s, i) => i > firstGroupIdx && !s.group);

  // Pre-steps (e.g. the reason step) run first, sequentially.
  for (let i = 0; i < firstGroupIdx; i++) await runOneStep(ctx, plan[i]);

  // Category sub-plans run concurrently.
  const groupSteps = plan.slice(firstGroupIdx, afterGroups < 0 ? plan.length : afterGroups);
  const groupIds = Array.from(new Set(groupSteps.map((s) => s.group!)));
  ctx.setStatus("researching");
  ctx.log("info", `Researching ${groupIds.length} categories in parallel: ${groupIds.map((g) => ctx.task.subPlans?.find((s) => s.id === g)?.label).filter(Boolean).join(", ")}.`);
  await Promise.all(
    groupIds.map((gid) =>
      runGroup(ctx, gid, groupSteps.filter((s) => s.group === gid))
    )
  );

  // Combine + actions (approvals/waiting) via the normal loop.
  if (afterGroups >= 0) await executeLoop(ctx, model, afterGroups);
}

/** Run one un-grouped (global-scope) step. */
async function runOneStep(ctx: RunContext, step: PlanStep) {
  const tool = KIT[step.tool];
  if (!tool) {
    markStep(ctx, step, "failed", { error: `Unknown tool: ${step.tool}` });
    return;
  }
  const status = STATUS_FOR_TOOL[step.tool as ToolName];
  if (status) ctx.setStatus(status);
  ctx.currentGroup = null;
  step.status = "running";
  step.startedAt = Date.now();
  ctx.updateStep(step);
  const r = await tool.run(step.input as Record<string, unknown>, ctx);
  markStep(ctx, step, r.ok ? "done" : "failed", { output: r.output, confidence: r.confidence, error: r.ok ? undefined : r.error });
}

/** Run one sub-plan's step chain in its own pinned scope (safe for parallel). */
async function runGroup(base: RunContext, groupId: string, steps: PlanStep[]) {
  const sctx = scopedCtx(base, groupId);
  const sp = base.task.subPlans?.find((s) => s.id === groupId);
  if (sp) sp.status = "running";
  for (const step of steps) {
    const tool = KIT[step.tool];
    if (!tool) {
      markStep(base, step, "failed", { error: `Unknown tool: ${step.tool}` });
      continue;
    }
    step.status = "running";
    step.startedAt = Date.now();
    base.updateStep(step);
    const r = await tool.run(step.input as Record<string, unknown>, sctx);
    markStep(base, step, r.ok ? "done" : "failed", { output: r.output, confidence: r.confidence, error: r.ok ? undefined : r.error });
  }
}

/** A ToolContext pinned to one sub-plan's scope — lets groups run in parallel. */
function scopedCtx(base: RunContext, group: string): ToolContext {
  const sp = () => base.task.subPlans!.find((s) => s.id === group)!;
  return {
    task: base.task,
    bb: base.bb,
    maxFetches: base.maxFetches,
    log: (l, m, d, s) => base.log(l, m, d, s),
    addSource: (s) => base.addSource(s),
    emit: base.emit,
    persist: () => base.persist(),
    scopeConstraints: () => sp().constraints,
    scopeBbKey: (b) => `${b}:${group}`,
    getScopeResults: () => sp().results,
    setScopeResults: (items) => {
      sp().results = items;
      base.emit({ type: "task", task: base.task });
      base.persist();
    },
    setScopeComparison: (c) => {
      const s = sp();
      s.comparison = c;
      s.status = "done";
      base.emit({ type: "task", task: base.task });
      base.persist();
    },
  };
}

// ── external-reply plumbing (Phase 9) ────────────────────────────────────────
function consumeReply(task: Task): { text: string } | null {
  const events = task.externalEvents ?? [];
  // A reply is "unconsumed" if it arrived after we started waiting. We mark the
  // waiting checkpoint cleared by removing task.waiting; a fresh relayed reply
  // is signalled by task.waiting being absent while an event exists.
  if (!task.waiting && events.length > 0) {
    return { text: events[events.length - 1].text };
  }
  return null;
}

function enterWaiting(ctx: RunContext, step: PlanStep) {
  const task = ctx.task;
  step.status = "waiting";
  step.startedAt = step.startedAt ?? Date.now();
  ctx.updateStep(step);
  const provider = topCandidate(task)?.name ?? "the provider";
  task.waiting = {
    stepId: step.id,
    prompt: `The message was sent to ${provider}. Volo can't watch your inbox — when you hear back, paste the reply here and Volo will continue.`,
    since: Date.now(),
  };
  ctx.setStatus("waiting_response");
  ctx.log("info", task.waiting.prompt);
  ctx.emit({ type: "task", task });
  ctx.persist();
}

// ── understanding + planning ─────────────────────────────────────────────────
// Returns false when it paused for clarification (execution should NOT proceed).
async function planPhase(ctx: RunContext, model: ModelProvider): Promise<boolean> {
  const task = ctx.task;
  const eff = effectiveObjective(task);

  // 1) Understand the goal generically (hard/soft/assumptions/missing-info).
  //    Re-parse constraints from the effective objective so answers count.
  ctx.setStatus("understanding");
  task.constraints = understand(eff);
  const goal = (await understandGoal(eff, task.constraints, model)) ?? deterministicGoal(eff, task.constraints);
  task.goal = goal;
  task.constraints.softPrefs = goal.soft; // soft prefs rank (don't filter)
  ctx.log(
    "info",
    `Understood the goal: ${goal.summary}`,
    [goal.hard.length ? `${goal.hard.length} hard constraint(s)` : "", goal.soft.length ? `${goal.soft.length} preference(s)` : ""].filter(Boolean).join(" · ")
  );

  // 2) Missing-information gate. Ask ONLY blocking questions, and only once
  //    (once the user has answered, proceed even if the model is still unsure —
  //    noting assumptions — rather than interrogating).
  const alreadyClarified = !!task.clarificationContext;
  const blocking = goal.clarifications.filter((q) => q.importance === "blocking");
  if (blocking.length > 0 && !alreadyClarified) {
    task.clarifications = blocking;
    ctx.setStatus("awaiting_clarification");
    ctx.log(
      "info",
      `Before starting, Volo needs ${blocking.length} quick answer${blocking.length === 1 ? "" : "s"} — only what genuinely blocks execution. Optional/researchable gaps are handled automatically.`
    );
    ctx.emit({ type: "task", task });
    ctx.persist();
    return false;
  }

  // 3) Plan authoring (dynamic single vs multi-domain), using the effective
  //    objective so clarification answers shape the plan.
  ctx.setStatus("planning");
  if (model.name !== "rule") {
    ctx.log("info", `Asking the local model (${model.name}) to design a plan — this can take a moment.`);
  }
  const authored = await authorPlan(eff, task.constraints, model);

  if (authored?.mode === "multi") {
    // Never silently drop a category the objective explicitly requested: if the
    // model's decomposition missed one the user clearly listed, add it back so it
    // gets its own researched sub-plan (and is honestly reported if unavailable).
    const specs = reconcileCategories(authored.subPlans, eff, task.constraints);
    const added = specs.length - authored.subPlans.length;
    const { plan, subPlans } = buildMultiPlan(eff, task.constraints, specs, goal.soft);
    task.plan = plan;
    task.subPlans = subPlans;
    task.multiDomain = true;
    task.plannerUsed = "model";
    task.planRationale = added > 0
      ? `${authored.rationale} (Added ${added} requested categor${added === 1 ? "y" : "ies"} the model omitted, so none is silently dropped.)`
      : authored.rationale;
    ctx.log("success", `Split into ${subPlans.length} categories: ${subPlans.map((s) => s.label).join(", ")} — then a combine step.`, task.planRationale);
  } else if (authored?.mode === "single") {
    task.plan = authored.steps;
    task.plannerUsed = "model";
    task.planRationale = authored.rationale;
    ctx.log("success", `Plan authored by ${model.name}: ${uniqueTools(task.plan).join(" → ")}`, authored.rationale);
  } else {
    // Model didn't return a usable plan. Before collapsing to a single-domain
    // plan (which could turn a complex objective into an unrelated domain), try
    // the GENERIC deterministic decomposer — if the objective lists multiple
    // research categories, build a real multi-domain plan from the user's words.
    const specs = deterministicDecompose(eff, task.constraints);
    if (specs && specs.length >= 2) {
      const { plan, subPlans } = buildMultiPlan(eff, task.constraints, specs, goal.soft);
      task.plan = plan;
      task.subPlans = subPlans;
      task.multiDomain = true;
      task.plannerUsed = "rule";
      task.planRationale =
        model.name === "rule"
          ? `Decomposed into ${subPlans.length} research categories (deterministic).`
          : `Model plan wasn't usable, but the objective clearly lists ${subPlans.length} categories — decomposed deterministically instead of guessing a single domain.`;
      ctx.log("success", `Split into ${subPlans.length} categories: ${subPlans.map((s) => s.label).join(", ")} — then a combine step.`, task.planRationale);
    } else {
      task.plan = createPlan(eff, task.constraints);
      task.plannerUsed = "rule";
      task.planRationale = model.name === "rule" ? "No AI model available — used the deterministic planner." : "Model plan was unusable — fell back to the deterministic planner.";
      ctx.log("info", `Deterministic plan: ${uniqueTools(task.plan).join(" → ")}`, task.planRationale);
    }
  }
  ctx.emit({ type: "task", task });
  ctx.persist();
  return true;
}

// ── reactive re-plan when a run comes up empty ───────────────────────────────
async function maybeReplan(ctx: RunContext, model: ModelProvider): Promise<PlanStep[]> {
  const task = ctx.task;
  if (task.constraints.outcome !== "candidates") return [];
  const candidates = task.results.filter((r) => r.kind === "candidate").length;
  if (candidates > 0) return [];
  const observation = `The plan found 0 actual ${task.constraints.entityLabel}s — the pages read were informational or blocked. Location: ${task.constraints.location ?? "unspecified"}.`;
  ctx.log("info", `No ${task.constraints.entityLabel} candidates yet — asking the model to adapt the plan.`);
  const rec = await replanWithModel(task.objective, task.constraints, model, observation);
  if (!rec || rec.steps.length === 0) {
    ctx.log("info", "No useful recovery step — reporting the gap honestly instead of guessing.");
    return [];
  }
  ctx.log("success", `Re-planned: ${uniqueTools(rec.steps).join(" → ")}`, rec.rationale);
  return rec.steps;
}

// ── finalize: summary + honest status ────────────────────────────────────────
async function finalize(ctx: RunContext, model: ModelProvider) {
  const task = ctx.task;
  const limitations = deriveLimitations(task);
  const offeredActions = offeredActionsFrom(task);
  const willUseModel = model.name !== "rule" && task.sources.length > 0 && task.results.some((r) => r.kind === "candidate");
  if (willUseModel) {
    ctx.log("info", `Writing the summary with the local model (${model.name}) — first run can take up to a minute while it loads.`);
  }

  const final = await summarize(task.objective, task.constraints, task.comparison, task.sources, model, limitations, offeredActions, task.combination);
  task.finalResult = final;
  ctx.emit({ type: "final", final });

  const pendingApproval = task.approvals.some((a) => a.status === "pending");
  if (task.waiting) {
    // Still waiting for an external reply — leave waiting_response (persisted).
    ctx.setStatus("waiting_response");
  } else if (pendingApproval) {
    ctx.setStatus("awaiting_approval");
    ctx.log("info", `Prepared the next action. It needs your approval before Volo does anything external.`);
  } else if (task.status !== "failed") {
    const unfinished = task.plan.some((s) =>
      ["pending", "blocked_on_approval", "waiting", "running"].includes(s.status)
    );
    if (unfinished) {
      ctx.setStatus("partially_completed");
      ctx.log("info", "Did everything possible for now; some steps remain outside Volo's reach.");
    } else {
      ctx.setStatus("completed");
      ctx.log("success", "Objective processed. Every value above links to its source.");
    }
  }
}

// ── approval handling ────────────────────────────────────────────────────────
function pauseForApproval(ctx: RunContext, step: PlanStep) {
  const task = ctx.task;
  step.status = "blocked_on_approval";
  ctx.updateStep(step);

  const first = topCandidate(task);
  const draft = ctx.bb.get("draft") as EmailDraft | undefined;
  // Target must match the action: a booking link for book/submit, an email for
  // contact. An empty/placeholder target is later refused by the action provider.
  const a = first?.attributes ?? {};
  const target =
    step.tool === "book"
      ? a.booking || a.website || a.contact || ""
      : step.tool === "submit_form"
        ? a.website || a.booking || ""
        : a.contact || a.website || draft?.to || "";
  const tool = KIT[step.tool];

  const title =
    step.tool === "book"
      ? `Book ${first?.name ?? "the chosen option"}`
      : step.tool === "submit_form"
        ? "Submit the request"
        : `Contact ${first?.name ?? "the provider"}`;

  // A booking with a known price is a FINANCIAL commitment — attach the exact
  // quote so the user confirms the specific amount (never store card data).
  let financial: ApprovalRequest["financial"];
  if (step.tool === "book" && first) {
    const price = parsePrice(first.attributes.price);
    if (price != null) {
      financial = {
        total: price,
        currency: currencyFor(task.constraints, first.attributes.price),
        refundPolicy: first.attributes.return_policy || first.attributes.cancellation || undefined,
      };
    }
  }

  const approval: ApprovalRequest = {
    id: id("a_"),
    tool: step.tool,
    title,
    description: step.description.replace(/ — requires your approval$/, ""),
    payloadPreview: draft ? `Subject: ${draft.subject}\n\n${draft.body.slice(0, 220)}` : "The prepared request will be shown before anything is sent.",
    target,
    commitment: tool?.onError ?? "Requires your explicit approval.",
    financial,
    status: "pending",
    createdAt: Date.now(),
  };
  task.approvals.push(approval);
  ctx.emit({ type: "approval", approval });
  ctx.persist();
}

function deriveLimitations(task: Task): string[] {
  const c = task.constraints;
  const out: string[] = [];
  if (c.location === "near me") out.push('You said "near me" without a city, so results are not geo-filtered. Add a location to sharpen them.');
  if (c.timeframe && c.outcome === "candidates") out.push(`Live availability for "${c.timeframe}" usually isn't on public pages — confirm directly with the provider.`);
  out.push("Prices and details change; Volo shows what each page said at fetch time, with the source to verify.");
  if (task.multiDomain) return out; // gaps are reported by the combination summary
  const candidates = task.results.filter((r) => r.kind === "candidate").length;
  if (c.outcome === "candidates" && candidates === 0) {
    out.push(`No actual ${c.entityLabel || "option"}s could be identified — the pages read were informational or blocked automated access. Add a specific location or a directory to search, then retry.`);
  }
  return out;
}

function offeredActionsFrom(task: Task): string[] {
  const out: string[] = [];
  for (const step of task.plan) {
    const tool = KIT[step.tool];
    if (tool && tool.requiresApproval) {
      out.push(`${step.description} (you review and approve first).`);
    }
  }
  return out;
}

function topCandidate(task: Task) {
  const cmp = task.comparison;
  if (!cmp) return null;
  return (
    cmp.recommendedIds
      .map((rid) => cmp.items.find((i) => i.id === rid))
      .find((i) => i && i.kind === "candidate") ?? null
  );
}

function uniqueTools(plan: PlanStep[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of plan) {
    if (!seen.has(s.tool)) {
      seen.add(s.tool);
      out.push(s.tool);
    }
  }
  return out;
}

// ── run context (implements ToolContext) ─────────────────────────────────────
class RunContext implements ToolContext {
  bb = new Map<string, unknown>();
  maxFetches = Number(cfg("RESEARCH_MAX_FETCHES", "6"));
  /** The sub-plan whose scope tools currently operate in (null = global). */
  currentGroup: string | null = null;
  constructor(public task: Task, public emit: Emit) {}

  private sub(): SubPlan | undefined {
    return this.currentGroup ? this.task.subPlans?.find((s) => s.id === this.currentGroup) : undefined;
  }

  scopeConstraints(): TaskConstraints {
    return this.sub()?.constraints ?? this.task.constraints;
  }

  scopeBbKey(base: string): string {
    return this.currentGroup ? `${base}:${this.currentGroup}` : base;
  }

  getScopeResults(): ResultItem[] {
    return this.sub()?.results ?? this.task.results;
  }

  setScopeResults(items: ResultItem[]) {
    const sp = this.sub();
    if (sp) {
      sp.results = items;
      this.emit({ type: "task", task: this.task }); // sub-plan state → full snapshot
    } else {
      this.task.results = items;
      this.emit({ type: "results", results: items });
    }
    this.persist();
  }

  setScopeComparison(c: Comparison) {
    const sp = this.sub();
    if (sp) {
      sp.comparison = c;
      sp.status = "done";
      this.emit({ type: "task", task: this.task });
    } else {
      this.task.comparison = c;
      this.emit({ type: "comparison", comparison: c });
    }
    this.persist();
  }

  setStatus(status: TaskStatus) {
    if (this.task.status === status) return;
    this.task.status = status;
    this.emit({ type: "status", status });
    this.persist();
  }

  log(level: TimelineEvent["level"], message: string, detail?: string, stepId?: string) {
    const event: TimelineEvent = { id: id("t_"), at: Date.now(), status: this.task.status, level, message, detail, stepId };
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
    this.log("error", `Task failed: ${message}`);
    this.emit({ type: "status", status: "failed" });
    this.persist();
  }

  persist() {
    saveTask(this.task);
  }
}

function markStep(
  ctx: RunContext,
  step: PlanStep,
  status: PlanStep["status"],
  extra: { output?: unknown; confidence?: number; error?: string }
) {
  step.status = status;
  step.finishedAt = Date.now();
  if (extra.output !== undefined) step.output = extra.output;
  if (extra.confidence !== undefined) step.confidence = extra.confidence;
  if (extra.error) step.error = extra.error;
  ctx.updateStep(step);
}
