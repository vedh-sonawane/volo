// Builds an initial Task from a raw objective: understands constraints and lays
// out the plan up front so the workspace can render the plan before execution.

import type { Task } from "@/lib/types";
import { id } from "@/lib/util";
import { understand } from "./understand";
import { createPlan } from "./planner";

export function createTask(objective: string): Task {
  const trimmed = objective.trim();
  const constraints = understand(trimmed);
  const plan = createPlan(trimmed, constraints);
  const now = Date.now();
  return {
    id: id("task_"),
    objective: trimmed,
    status: "understanding",
    createdAt: now,
    updatedAt: now,
    constraints,
    plan,
    sources: [],
    results: [],
    timeline: [],
    approvals: [],
  };
}
