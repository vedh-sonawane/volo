// ─────────────────────────────────────────────────────────────────────────────
// Volo — core domain types
//
// These types are the shared contract between the execution engine (server) and
// the task workspace (client). The engine reports progress *honestly*: every
// state transition, source, and extracted fact is recorded and streamed so the
// UI never has to invent activity.
// ─────────────────────────────────────────────────────────────────────────────

/** High-level lifecycle of a task. Mirrors the phases the user sees. */
export type TaskStatus =
  | "understanding" // Understanding objective
  | "planning" // Creating execution plan
  | "researching" // Researching
  | "extracting" // Extracting information
  | "comparing" // Comparing results
  | "awaiting_approval" // Waiting for the user to approve an action
  | "awaiting_clarification" // Paused, needs the user to answer blocking questions
  | "waiting_response" // Paused, waiting for an external reply the user must relay
  | "paused" // Manually paused by the user
  | "completed" // Completed
  | "partially_completed" // Some steps done; blocked on something outside Volo
  | "failed"; // Failed with an explanation

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  understanding: "Understanding objective",
  planning: "Creating execution plan",
  researching: "Researching",
  extracting: "Extracting information",
  comparing: "Comparing results",
  awaiting_approval: "Waiting for approval",
  awaiting_clarification: "Needs a couple of answers",
  waiting_response: "Waiting for a reply",
  paused: "Paused",
  completed: "Completed",
  partially_completed: "Partially completed",
  failed: "Failed",
};

/** Status of a single plan step. */
export type StepStatus =
  | "pending"
  | "running"
  | "done"
  | "skipped"
  | "failed"
  | "blocked_on_approval"
  | "waiting"; // paused waiting for an external reply the user must relay

/**
 * Tools the engine can invoke for a step. This is the modular capability set the
 * planner dynamically selects from — web research is only a few of these. Each
 * name maps to an ExecutableTool in the tool kit (src/lib/tools/kit.ts).
 */
export type ToolName =
  // ── Reasoning / research (free, automatic) ──
  | "reason" // pure model/rule reasoning, no external calls
  | "direct_answer" // compose a direct informational/creative answer (no research)
  | "web_search" // ResearchProvider.search
  | "fetch_page" // ResearchProvider.fetch + extract
  | "read_document" // read a specific public URL/document as evidence
  | "extract_structured" // turn page content into structured rows
  | "compare" // rank/compare candidate entities
  | "combine_domains" // join ranked candidates across sub-plans (multi-domain)
  // ── Preparation (free, automatic, no external side effects) ──
  | "draft_email" // prepare an email draft (never sends)
  | "create_reminder" // store a local reminder on the objective
  | "await_approval" // pause for explicit user approval
  // ── Consequential actions (declared surface; gated behind approval) ──
  | "send_email"
  | "submit_form"
  | "book"
  | "payment"
  | "monitor_inbox"
  | "calendar_event";

/** A single structured step in the execution plan (Phase 4). */
export interface PlanStep {
  id: string;
  description: string;
  tool: ToolName;
  input: Record<string, unknown>;
  status: StepStatus;
  /**
   * Sub-plan this step belongs to (multi-domain objectives). When set, the step
   * operates in that sub-plan's scope (its own constraints/results/comparison).
   * Undefined = global scope (single-domain — unchanged behavior).
   */
  group?: string;
  /** Free-form output payload produced by the step. */
  output?: unknown;
  /** URLs / references that back this step's output. */
  sources: string[];
  error?: string;
  /** 0..1 confidence the engine assigns to this step's result. */
  confidence?: number;
  /** Steps that must finish before this one can run (enables parallelism). */
  dependsOn: string[];
  startedAt?: number;
  finishedAt?: number;
}

/** A discovered source with provenance (Phase 3 / Phase 9 citations). */
export interface Source {
  url: string;
  title: string;
  snippet?: string;
  /** When the engine actually fetched it (not just found the link). */
  fetchedAt?: number;
  /** Rough word count of extracted readable content, if fetched. */
  words?: number;
}

/**
 * A structured result row extracted from research (Phase 6). Fields are
 * intentionally generic so the same shape serves instructors / restaurants /
 * products / flights. `attributes` holds the domain-specific columns.
 */
export interface ResultItem {
  id: string;
  /**
   * Whether this row is an actual candidate entity that could satisfy the
   * objective, or merely information extracted from a source document. Only
   * "candidate" rows are counted and ranked as options.
   */
  kind: "candidate" | "information";
  /** Primary label, e.g. the instructor / restaurant / product name. */
  name: string;
  /** Domain-specific columns, e.g. { price: "$45/hr", availability: "..." }. */
  attributes: Record<string, string>;
  /** The URL this row was extracted from (evidence). */
  evidenceUrl?: string;
  /** Short quote / snippet backing the extraction. */
  evidence?: string;
  /** 0..1 confidence in this row. */
  confidence: number;
  /** Engine's overall score used for ranking in the comparison (0..1). */
  score?: number;
  /** Human-readable reason this row was ranked where it was. */
  scoreReason?: string;
}

/** The comparison table the UI renders (Phase 6). */
export interface Comparison {
  /** Column keys, in display order. Derived from ResultItem.attributes. */
  columns: string[];
  /** Only real candidate entities (never informational rows). */
  items: ResultItem[];
  /** IDs of the top picks, in order. */
  recommendedIds: string[];
  /** Plain-language summary of how the ranking was made. */
  rationale: string;
  /** Label for one candidate, e.g. "driving instructor". */
  entityLabel: string;
  /** How many pages were read but set aside as information, not candidates. */
  informationCount: number;
}

/**
 * A sub-plan for a multi-domain / combinatorial objective (BL-2). Each is an
 * independent research task (one "category") with its own scope. The model
 * authors the labels and queries dynamically — nothing domain-specific here.
 */
export interface SubPlan {
  id: string;
  /** Short, model-authored category name, e.g. "transport", "accommodation". */
  label: string;
  /** The sub-objective / search focus. */
  objective: string;
  /** Mini-constraints (own domain/entityLabel/keywords) for this category. */
  constraints: TaskConstraints;
  results: ResultItem[];
  comparison?: Comparison;
  status: "pending" | "running" | "done" | "failed";
}

/** One cross-domain combination (one pick per sub-plan). */
export interface CombinedOption {
  id: string;
  picks: {
    subPlanId: string;
    label: string;
    itemId: string;
    name: string;
    price: number | null;
    evidenceUrl?: string;
  }[];
  /** Sum of known prices across picks (null when no pick had a price). */
  totalPrice: number | null;
  /** True when totalPrice is known AND within the shared budget (if any). */
  withinBudget: boolean;
  /** Whether every pick contributed a price (else the total is a lower bound). */
  priceComplete: boolean;
  score: number;
  /** Plain-language trade-off note for this combination. */
  rationale: string;
}

/** The join result for a multi-domain objective. */
export interface Combination {
  options: CombinedOption[];
  recommendedIds: string[];
  /** Shared budget applied to the total, if the objective set one. */
  budget?: number;
  priceUnit?: string;
  rationale: string;
  /** Sub-plan labels that produced no usable options (honest gaps). */
  missing: string[];
}

/** Permission classification for tools/actions (Phase 7). */
export type PermissionLevel = "research" | "recommend" | "action";

// ── Real-action execution (Phase 10 hardening) ───────────────────────────────

/** Capabilities Volo can be asked to actually perform. */
export type ActionCapability = "send_email" | "calendar_event" | "book" | "submit_form" | "payment";

/**
 * How an objective should be executed, decided by the routing layer BEFORE any
 * research/planning. Generic across domains — the classifier looks at the verb,
 * the presence of a concrete action target, and the required parameters of an
 * executable capability, never at a specific domain.
 *   direct_answer  — answer directly from knowledge/generation; NO web research
 *   research       — acquire/compare real entities, or facts that need external/current data
 *   direct_action  — a concrete, executable action with a supplied target
 *   mixed          — research first, THEN an action on the chosen result
 *   informational  — (legacy) synthesize an answer from sources
 */
export type ObjectiveRoute = "direct_answer" | "research" | "direct_action" | "mixed" | "informational";

/**
 * A recognised direct executable action: the user supplied a concrete target and
 * (some of) the structured parameters an executable capability needs. Values are
 * taken VERBATIM from the objective — never rewritten with generic objective text
 * or fabricated. `requiredMissing` lists parameters that are genuinely absent, so
 * Volo asks only for those (and nothing it already has).
 */
export interface DirectAction {
  capability: ActionCapability;
  /** The validated concrete target (recipient email, URL…). "" for capabilities that need none (calendar). */
  target: string;
  /** Exact user-provided parameters (e.g. { subject, body } | { title, date }). Verbatim. */
  params: Record<string, string>;
  /** Required parameters/fields that are still missing (drives minimal clarification). */
  requiredMissing: string[];
  /** True only when the user explicitly asked to monitor/await a reply. */
  monitor: boolean;
}

/**
 * A generic, domain-agnostic class of capability Volo can use to move an
 * objective forward. Reasoning happens over these abstractions — never over
 * domain nouns — so the path planner works for any objective.
 *   answer       — produce information/creative output directly (no external data)
 *   research     — discover options / current facts / a party to engage, on the web
 *   communicate  — reach a relevant party through a connected channel (approval-gated)
 *   schedule     — put an event/reminder on a calendar
 *   submit       — submit a form/application/cancellation to a target (approval-gated)
 *   pay          — pay/transfer to a target (approval-gated)
 */
export type CapabilityId = "answer" | "research" | "communicate" | "schedule" | "submit" | "pay";

/** Runtime availability of a capability (is it connected/usable right now?). */
export interface CapabilityStatus {
  id: CapabilityId;
  available: boolean;
  /** Human note: how it will behave / why it's unavailable (missing credential). */
  detail?: string;
}

/**
 * A candidate way to achieve the objective, chosen for RELEVANCE (not "because it
 * exists"). Volo records these so path selection is explainable and so it can try
 * a legitimate alternative if the preferred path fails.
 */
export interface ExecutionPath {
  capability: CapabilityId;
  /** Why this path is relevant to the user's actual outcome (explainable). */
  rationale: string;
  /** True when taking this path has an external consequence → needs approval. */
  consequential: boolean;
  /** True when the path needs a target/answer discovered by research first. */
  dependsOnResearch: boolean;
  /** Is the capability connected/usable right now? */
  available: boolean;
  /** Why it isn't usable (missing capability/credential), if unavailable. */
  unavailableReason?: string;
}

/**
 * The outcome of attempting a real action. Deliberately richer than a boolean so
 * the product can tell the truth: a draft/steps is NOT "succeeded", and a
 * timeout is `uncertain` (never silently retried → no duplicate charge/booking).
 */
export type ActionStatus =
  | "succeeded" // the external side effect really happened (with confirmation)
  | "failed" // attempted and failed cleanly (safe to retry)
  | "unsupported" // no real integration configured — honest, degrade gracefully
  | "uncertain" // may or may not have happened — must be verified, do NOT retry
  | "requires_user" // needs user auth/3DS/OTP/CAPTCHA — handed back safely
  | "duplicate"; // already executed for this idempotency key — not repeated

/** A financial commitment's exact terms — shown before any money moves. */
export interface FinancialQuote {
  total: number;
  currency: string;
  fees?: number;
  taxes?: number;
  refundPolicy?: string;
  /** Masked/non-sensitive payment method label only (never raw card data). */
  account?: string;
}

/** Structured result of a real action attempt (stored for idempotency). */
export interface ActionResult {
  status: ActionStatus;
  message: string;
  /** Provider confirmation/reference id — real proof the action happened. */
  confirmation?: string;
  /** Safe artifact (e.g. .eml draft, .ics, exact steps) when not performed. */
  artifact?: unknown;
  /**
   * True when NO real money moved / no real irreversible side effect occurred —
   * i.e. a sandbox double OR a real provider's TEST mode (e.g. Stripe test keys).
   * The UI must say so plainly and never imply real money moved.
   */
  simulated?: boolean;
  /**
   * How it ran, for precise honesty:
   *   "sandbox" — Volo's built-in test double (no external call)
   *   "test"    — a REAL connected provider in TEST mode (real API call, no real money)
   *   "live"    — a real provider with real consequences (real money/booking)
   */
  mode?: "sandbox" | "test" | "live";
  at: number;
}

/** A pending action that needs explicit user approval before it runs. */
export interface ApprovalRequest {
  id: string;
  /** Which tool would run if approved. */
  tool: ToolName;
  title: string;
  /** Exactly what will happen. */
  description: string;
  /** What information will be sent. */
  payloadPreview: string;
  /** Who / where it goes (recipient, URL, service). */
  target?: string;
  /** Any cost or commitment. Null when there is none. */
  commitment?: string | null;
  status: "pending" | "approved" | "rejected";
  createdAt: number;
  decidedAt?: number;
  /** Present when this action commits money — shown for explicit confirmation. */
  financial?: FinancialQuote;
  /** The result of executing this action (set after approval). */
  result?: ActionResult;
}

/** An honest, append-only log entry for the execution timeline (Phase 2/9). */
export interface TimelineEvent {
  id: string;
  at: number;
  /** Which lifecycle phase this belongs to. */
  status: TaskStatus;
  level: "info" | "success" | "warn" | "error";
  message: string;
  /** Optional structured detail (e.g. a URL, a count). */
  detail?: string;
  stepId?: string;
}

/** The full task record — persisted locally and streamed to the client. */
export interface Task {
  id: string;
  objective: string;
  /** Short, human-readable label derived from the objective (dashboard title). */
  title: string;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  /** Structured constraints parsed from the objective (budget, count, when…). */
  constraints: TaskConstraints;
  plan: PlanStep[];
  sources: Source[];
  results: ResultItem[];
  comparison?: Comparison;
  timeline: TimelineEvent[];
  approvals: ApprovalRequest[];
  /** Final human-facing answer, produced only from real evidence. */
  finalResult?: FinalResult;
  /** Populated when status === "failed". */
  failure?: string;
  /** Which model provider actually ran, for transparency. */
  modelProvider?: string;
  /** Which research provider actually ran. */
  researchProvider?: string;
  /** Whether the plan was authored by the model or the deterministic planner. */
  plannerUsed?: "model" | "rule";
  /** The planner's one-line rationale (model-authored when plannerUsed=model). */
  planRationale?: string;
  /** The general goal model (understanding, hard/soft, missing info). */
  goal?: GoalModel;
  /** How the objective was routed (research / direct_action / mixed / informational). */
  route?: ObjectiveRoute;
  /** Set when the objective is a recognised direct executable action. */
  directAction?: DirectAction;
  /** The relevant capability paths considered (for explainability + fallback). */
  paths?: ExecutionPath[];
  /** Blocking questions awaiting the user's answers (awaiting_clarification). */
  clarifications?: Clarification[];
  /** Answers the user gave, merged into the effective objective on resume. */
  clarificationContext?: string;
  /**
   * Structured direct-action parameter answers, keyed by param name (recipient,
   * subject, body…). Captured VERBATIM from clarification answers and applied
   * directly to the action — so the exact user input reaches the payload without
   * being re-parsed from concatenated question text.
   */
  directActionParams?: Record<string, string>;
  /** True when the objective was decomposed into cross-domain sub-plans (BL-2). */
  multiDomain?: boolean;
  /** Independent research sub-plans, when multiDomain. */
  subPlans?: SubPlan[];
  /** The cross-domain combination/join result, when multiDomain. */
  combination?: Combination;
  /**
   * Set when the objective is paused waiting for an external reply Volo cannot
   * fetch for free (e.g. a provider's email response). Persists across restarts;
   * cleared when the user relays the reply and execution resumes.
   */
  waiting?: WaitState;
  /** External replies the user has relayed, in order (honest provenance). */
  externalEvents?: ExternalEvent[];
  /**
   * Idempotency ledger: results of already-executed actions keyed by
   * `${taskId}:${approvalId}`. Guarantees an action (e.g. a payment/booking) is
   * never performed twice, even across retries/restarts.
   */
  executedActions?: Record<string, ActionResult>;
}

/** A persistent "waiting for an external event" checkpoint (Phase 9). */
export interface WaitState {
  /** The plan step (a monitor/wait tool) that is blocked. */
  stepId: string;
  /** What Volo is waiting for, shown to the user. */
  prompt: string;
  since: number;
}

/** An external reply the user relayed so Volo could resume. */
export interface ExternalEvent {
  at: number;
  text: string;
}

/**
 * A missing-information item the understanding stage surfaced. `importance`
 * decides whether Volo must ask the user before executing:
 *   blocking     — execution can't safely proceed without it → ask the user
 *   optional     — helpful but not required → proceed, note the assumption
 *   researchable — Volo can find it itself → don't ask, research it
 */
export interface Clarification {
  id: string;
  question: string;
  importance: "blocking" | "optional" | "researchable";
  /** Filled in once the user answers (blocking questions). */
  answer?: string;
  /**
   * When this question fills a DIRECT-ACTION parameter (recipient, subject, body,
   * amount…), the param name. The answer is then stored VERBATIM against that
   * param — never re-parsed from free text — so the user's exact input reaches the
   * action payload unchanged (no template/question remnants leaking in).
   */
  param?: string;
}

/**
 * The general goal model produced by the understanding stage (BL-2 / goal
 * understanding). Domain-agnostic: it holds hard constraints (must be satisfied),
 * soft preferences (used to rank, not filter), assumptions Volo is making, and
 * any missing information. The planner consumes this rather than hardcoding
 * domain logic.
 */
export interface GoalModel {
  /** A plain-language restatement of what the user actually wants. */
  summary: string;
  /** Hard constraints — must hold (e.g. "total under $3,500", "4 nights"). */
  hard: string[];
  /** Soft preferences — nice to have; used to rank (e.g. "central", "cheap"). */
  soft: string[];
  /** Assumptions Volo is making in the absence of information. */
  assumptions: string[];
  /** Missing-information items, classified by importance. */
  clarifications: Clarification[];
  /** Which understanding stage produced this. */
  source: "model" | "rule";
}

/** Parsed intent + constraints (Phase 4, understanding stage). */
export interface TaskConstraints {
  /**
   * What the objective ultimately wants:
   *   candidates — acquire/compare real entities (providers, products)
   *   procedure  — learn a how-to / process (cancel, return, set up)
   *   answer     — an informational answer synthesized from sources
   * This drives whether extracted rows are treated as candidates or information.
   */
  outcome: "candidates" | "procedure" | "answer";
  /** Human label for one candidate (e.g. "driving instructor", "step"). */
  entityLabel: string;
  /** Detected domain, drives which columns we extract. */
  domain: "instructors" | "restaurants" | "products" | "flights" | "howto" | "general";
  location?: string;
  /** Upper price bound in the objective's currency, if any. */
  maxPrice?: number;
  priceUnit?: string; // e.g. "hour", "person", "night"
  /** Number of options the user asked for (e.g. "three restaurants" → 3). */
  count?: number;
  /** Party / group size (e.g. "for 6 people" → 6). Distinct from count. */
  partySize?: number;
  /** Free-form time window text, e.g. "next week", "this Saturday". */
  timeframe?: string;
  /** Extra keywords the planner should search for. */
  keywords: string[];
  /** Raw noteworthy requirements the user stated. */
  requirements: string[];
  /** Soft preferences (from the goal model) used to RANK, not filter. */
  softPrefs?: string[];
  /**
   * Known quantities used to normalize per-X prices to a comparable total
   * (generic: person/night/unit/item/use/hour/month). Domain-agnostic.
   */
  quantities?: {
    person?: number;
    night?: number;
    unit?: number;
    item?: number;
    use?: number;
    hour?: number;
    month?: number;
  };
}

/** The final outcome object (Phase 6/9). */
export interface FinalResult {
  headline: string;
  summary: string;
  /** Bullet takeaways, each ideally citing a source index. */
  takeaways: string[];
  /** Things the engine could NOT do for free / automatically (honesty). */
  limitations: string[];
  /** Actions offered to the user that require approval. */
  offeredActions: string[];
  /** The single concrete next step to move the objective forward. */
  nextAction?: string;
  /** True only when an AI model actually wrote the summary prose (honesty). */
  modelUsed?: boolean;
}

/** Lightweight objective summary for the dashboard list (derived from a Task). */
export interface ObjectiveSummary {
  id: string;
  title: string;
  objective: string;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  /** 0..1 fraction of plan steps finished. */
  progress: number;
  pendingApprovals: number;
  needsInput: boolean;
  nextAction: { label: string; actor: "user" | "system" | "none" };
  /** Most recent timeline message, for "last activity". */
  lastActivity?: string;
}

/** Server-Sent-Events payload shapes for the live execution stream. */
export type StreamEvent =
  | { type: "task"; task: Task }
  | { type: "timeline"; event: TimelineEvent }
  | { type: "status"; status: TaskStatus }
  | { type: "step"; step: PlanStep }
  | { type: "source"; source: Source }
  | { type: "results"; results: ResultItem[] }
  | { type: "comparison"; comparison: Comparison }
  | { type: "approval"; approval: ApprovalRequest }
  | { type: "final"; final: FinalResult }
  | { type: "done"; task: Task }
  | { type: "error"; message: string };
