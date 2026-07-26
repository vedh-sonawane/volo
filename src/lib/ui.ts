// Presentation helpers shared across client components. Keeps status → color /
// label mapping in one place so the timeline, badges, and plan stay consistent.

import type { StepStatus, Task, TaskStatus } from "@/lib/types";

export const STATUS_META: Record<
  TaskStatus,
  { label: string; color: string; active: boolean }
> = {
  understanding: { label: "Understanding objective", color: "var(--color-run)", active: true },
  planning: { label: "Creating execution plan", color: "var(--color-run)", active: true },
  researching: { label: "Researching", color: "var(--color-run)", active: true },
  extracting: { label: "Extracting information", color: "var(--color-run)", active: true },
  comparing: { label: "Comparing results", color: "var(--color-run)", active: true },
  awaiting_approval: { label: "Awaiting approval", color: "var(--color-warn)", active: false },
  awaiting_clarification: { label: "Needs your answers", color: "var(--color-warn)", active: false },
  waiting_response: { label: "Waiting for a reply", color: "var(--color-warn)", active: false },
  paused: { label: "Paused", color: "var(--color-muted)", active: false },
  completed: { label: "Completed", color: "var(--color-ok)", active: false },
  partially_completed: { label: "Partially completed", color: "var(--color-warn)", active: false },
  failed: { label: "Failed", color: "var(--color-err)", active: false },
};

/** Ordered lifecycle for the stepper (excludes terminal branches). */
export const LIFECYCLE: TaskStatus[] = [
  "understanding",
  "planning",
  "researching",
  "extracting",
  "comparing",
];

export const LEVEL_COLOR: Record<string, string> = {
  info: "var(--color-muted)",
  success: "var(--color-ok)",
  warn: "var(--color-warn)",
  error: "var(--color-err)",
};

export const STEP_META: Record<StepStatus, { color: string; label: string }> = {
  pending: { color: "var(--color-faint)", label: "Pending" },
  running: { color: "var(--color-run)", label: "Running" },
  done: { color: "var(--color-ok)", label: "Done" },
  skipped: { color: "var(--color-faint)", label: "Skipped" },
  failed: { color: "var(--color-err)", label: "Failed" },
  blocked_on_approval: { color: "var(--color-warn)", label: "Needs approval" },
  waiting: { color: "var(--color-warn)", label: "Waiting for reply" },
};

export function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function clockTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function hostOf(url?: string): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// ── Objective-level derived state (all computed from REAL task data) ─────────

/** Fraction of plan steps completed (done or skipped), 0..1. */
export function progressOf(task: Pick<Task, "plan">): number {
  if (!task.plan.length) return 0;
  const finished = task.plan.filter((s) => s.status === "done" || s.status === "skipped").length;
  return finished / task.plan.length;
}

/** Whether this objective is actively waiting on the user for input. */
export function needsInput(task: Pick<Task, "status" | "approvals">): boolean {
  return (
    task.status === "awaiting_approval" ||
    task.status === "awaiting_clarification" ||
    task.status === "waiting_response" ||
    task.approvals.some((a) => a.status === "pending")
  );
}

/** The single next thing that will happen — honest, derived from actual state. */
export function nextActionFor(task: Pick<Task, "status" | "approvals">): {
  label: string;
  actor: "user" | "system" | "none";
} {
  if (task.status === "awaiting_clarification") {
    return { label: "Answer a couple of quick questions to start", actor: "user" };
  }
  if (task.status === "waiting_response") {
    return { label: "Relay the reply you received to continue", actor: "user" };
  }
  if (task.status === "awaiting_approval" || task.approvals.some((a) => a.status === "pending")) {
    const n = task.approvals.filter((a) => a.status === "pending").length;
    return { label: n > 1 ? `Review ${n} pending decisions` : "Review a pending decision", actor: "user" };
  }
  switch (task.status) {
    case "understanding":
    case "planning":
    case "researching":
    case "extracting":
    case "comparing":
      return { label: "Volo is working — no action needed", actor: "system" };
    case "paused":
      return { label: "Resume the objective", actor: "user" };
    case "partially_completed":
      return { label: "Review what's done and what's blocked", actor: "user" };
    case "completed":
      return { label: "Review the outcome", actor: "user" };
    case "failed":
      return { label: "Review why it stopped, or start again", actor: "user" };
    default:
      return { label: "—", actor: "none" };
  }
}
