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
  | "awaiting_approval" // Waiting for user input or approval
  | "completed" // Completed
  | "failed"; // Failed with an explanation

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  understanding: "Understanding objective",
  planning: "Creating execution plan",
  researching: "Researching",
  extracting: "Extracting information",
  comparing: "Comparing results",
  awaiting_approval: "Waiting for approval",
  completed: "Completed",
  failed: "Failed",
};

/** Status of a single plan step. */
export type StepStatus =
  | "pending"
  | "running"
  | "done"
  | "skipped"
  | "failed"
  | "blocked_on_approval";

/** Tools the engine can invoke for a step. Kept small + honest for the MVP. */
export type ToolName =
  | "reason" // pure model/rule reasoning, no external calls
  | "web_search" // ResearchProvider.search
  | "fetch_page" // ResearchProvider.fetch + extract
  | "extract_structured" // turn page content into structured rows
  | "compare" // rank/compare structured rows
  | "draft_email" // prepare an email draft (no send)
  | "await_approval" // pause for explicit user approval
  // ── Consequential actions (declared surface; gated behind approval) ──
  | "send_email"
  | "submit_form"
  | "book";

/** A single structured step in the execution plan (Phase 4). */
export interface PlanStep {
  id: string;
  description: string;
  tool: ToolName;
  input: Record<string, unknown>;
  status: StepStatus;
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
  items: ResultItem[];
  /** IDs of the top picks, in order. */
  recommendedIds: string[];
  /** Plain-language summary of how the ranking was made. */
  rationale: string;
}

/** Permission classification for tools/actions (Phase 7). */
export type PermissionLevel = "research" | "recommend" | "action";

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
}

/** Parsed intent + constraints (Phase 4, understanding stage). */
export interface TaskConstraints {
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
