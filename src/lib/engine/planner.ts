// ─────────────────────────────────────────────────────────────────────────────
// Planner — converts a structured objective into an ordered, typed execution
// plan (Phase 4). Deterministic; no AI required. Each step declares its tool,
// input, and dependencies so the executor can run independent research steps in
// parallel where safe.
// ─────────────────────────────────────────────────────────────────────────────

import type { PlanStep, TaskConstraints } from "@/lib/types";
import { id } from "@/lib/util";
import { schemaFor } from "./domains";

function step(partial: Omit<PlanStep, "id" | "status" | "sources">): PlanStep {
  return { id: id("s_"), status: "pending", sources: [], ...partial };
}

/** Build 2-3 focused search queries from the objective + constraints. */
export function buildQueries(objective: string, c: TaskConstraints): string[] {
  const loc = c.location && c.location !== "near me" ? ` ${c.location}` : "";
  const queries: string[] = [];
  const base = c.keywords.slice(0, 5).join(" ") || objective;

  switch (c.domain) {
    case "instructors":
      queries.push(`${base}${loc} price booking`);
      queries.push(`best ${base}${loc} reviews`);
      break;
    case "restaurants":
      queries.push(`best ${base} restaurants${loc}`);
      queries.push(`${base}${loc} menu reservation`);
      break;
    case "products":
      queries.push(`best ${base} review`);
      queries.push(`${base} price specs comparison`);
      break;
    case "flights":
      queries.push(`${base}${loc} flights price`);
      break;
    case "howto":
      queries.push(`${objective}`);
      queries.push(`${base} official instructions`);
      break;
    default:
      queries.push(objective);
      queries.push(base);
  }
  return queries.filter(Boolean).slice(0, 3);
}

export function createPlan(objective: string, c: TaskConstraints): PlanStep[] {
  const schema = schemaFor(c.domain);
  const queries = buildQueries(objective, c);
  const plan: PlanStep[] = [];

  const understand = step({
    description: "Understand location, budget, and timing requirements",
    tool: "reason",
    input: { objective, constraints: c },
    dependsOn: [],
  });
  plan.push(understand);

  // One search step per query — independent, so they can run in parallel.
  const searchIds: string[] = [];
  for (const q of queries) {
    const s = step({
      description: `Search the web for: "${q}"`,
      tool: "web_search",
      input: { query: q },
      dependsOn: [understand.id],
    });
    plan.push(s);
    searchIds.push(s.id);
  }

  const fetchStep = step({
    description: "Visit the most relevant pages and extract readable content",
    tool: "fetch_page",
    input: {},
    dependsOn: searchIds,
  });
  plan.push(fetchStep);

  const extractStep = step({
    description: `Extract structured details (${schema.columns.join(", ")})`,
    tool: "extract_structured",
    input: { columns: schema.columns },
    dependsOn: [fetchStep.id],
  });
  plan.push(extractStep);

  const compareStep = step({
    description: c.maxPrice
      ? `Filter out options failing constraints, then compare the rest`
      : `Compare the options found`,
    tool: "compare",
    input: { maxPrice: c.maxPrice, count: c.count ?? 3 },
    dependsOn: [extractStep.id],
  });
  plan.push(compareStep);

  return plan;
}
