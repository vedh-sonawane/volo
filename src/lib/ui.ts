// Presentation helpers shared across client components. Keeps status → color /
// label mapping in one place so the timeline, badges, and plan stay consistent.

import type { StepStatus, TaskStatus } from "@/lib/types";

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
  completed: { label: "Completed", color: "var(--color-ok)", active: false },
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
