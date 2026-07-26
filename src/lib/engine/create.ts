// Builds an initial Task from a raw objective. Only the fast, deterministic
// understanding runs here; the PLAN is authored at execution time (by the model
// when available, else deterministically) so that planning can stream and adapt.

import type { Task } from "@/lib/types";
import { id, normalizeWs } from "@/lib/util";
import { understand } from "./understand";

/**
 * Derive a short dashboard title from the actual objective text. Purely generic
 * string processing — it works for ANY objective and hardcodes no phrases.
 */
function deriveTitle(objective: string): string {
  const clean = normalizeWs(objective);
  // Prefer the first clause (up to a sentence break) for a tidy label.
  const firstClause = clean.split(/[.!?]\s|[,;]\s(?=[a-z])/)[0] || clean;
  const base = firstClause.length >= 12 ? firstClause : clean;
  if (base.length <= 64) return base;
  const cut = base.slice(0, 64);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 24 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
}

export function createTask(objective: string): Task {
  const trimmed = objective.trim();
  const constraints = understand(trimmed);
  const now = Date.now();
  return {
    id: id("task_"),
    objective: trimmed,
    title: deriveTitle(trimmed),
    status: "understanding",
    createdAt: now,
    updatedAt: now,
    constraints,
    plan: [], // authored at execution time (model-driven, with deterministic fallback)
    sources: [],
    results: [],
    timeline: [],
    approvals: [],
  };
}
