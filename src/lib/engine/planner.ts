// ─────────────────────────────────────────────────────────────────────────────
// Planner — dynamically composes an execution plan by SELECTING and SEQUENCING
// tools from the kit, based on the objective's outcome + detected action intent.
//
// This is the opposite of a fixed "search → fetch → extract → compare" pipeline:
// different objectives produce different tool sequences. A pure research
// objective gets research tools only; an objective that asks to contact, book,
// submit, or cancel additionally gets preparation + (approval-gated) action
// tools, and a wait-for-reply step when a response is expected. Deterministic
// and generic — no per-objective-type hardcoding. (An LLM planner can refine
// this selection later; the tool/engine architecture is the same either way.)
// ─────────────────────────────────────────────────────────────────────────────

import type { PlanStep, SubPlan, TaskConstraints } from "@/lib/types";
import { id } from "@/lib/util";
import { schemaFor } from "./domains";
import { detectActions } from "./classify";
import { understand } from "./understand";

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

/** Extract any explicit URLs the user pasted into the objective. */
function urlsIn(objective: string): string[] {
  return objective.match(/https?:\/\/[^\s"']+/g) ?? [];
}

/** Append the (approval-gated) action tail if the objective asks to act. */
function appendActions(plan: PlanStep[], objective: string, label: string, afterId: string) {
  const actions = detectActions(objective);
  if (!(actions.contact || actions.book || actions.submit)) return;
  const draft = step({
    description: actions.submit || actions.book ? "Prepare the request/message needed to act" : `Draft an enquiry to the top ${label}`,
    tool: "draft_email",
    input: {},
    dependsOn: [afterId],
  });
  plan.push(draft);
  const actionTool = actions.book ? "book" : actions.submit ? "submit_form" : "send_email";
  const actionDesc = actions.book ? `Make the booking` : actions.submit ? "Submit the request" : `Send the enquiry`;
  const actionStep = step({ description: `${actionDesc} — requires your approval`, tool: actionTool, input: { needs: "approval" }, dependsOn: [draft.id] });
  plan.push(actionStep);
  if (actions.awaitReply) {
    plan.push(step({ description: "Wait for and read the reply, then continue", tool: "monitor_inbox", input: {}, dependsOn: [actionStep.id] }));
  }
}

/**
 * Build a multi-domain plan (BL-2): one research group per category, then a
 * generic combine/join step, then any action tail. Each category runs the same
 * research tools in its own scope. Nothing domain-specific — the categories come
 * from the model's decomposition.
 */
export function buildMultiPlan(
  objective: string,
  c: TaskConstraints,
  subSpecs: { label: string; query: string }[],
  softPrefs: string[] = []
): { plan: PlanStep[]; subPlans: SubPlan[] } {
  const plan: PlanStep[] = [];
  const subPlans: SubPlan[] = [];

  const reason = step({
    description: `Understand the objective and split it into ${subSpecs.length} categories`,
    tool: "reason",
    input: { objective, constraints: c },
    dependsOn: [],
  });
  plan.push(reason);

  const compareIds: string[] = [];
  for (const spec of subSpecs) {
    const sid = id("sub_");
    // Each category gets its own constraints. No per-category budget — the
    // SHARED budget is enforced by the combine step. Keep more candidates so the
    // join has room to find in-budget combinations.
    const base = understand(spec.query);
    const subC: TaskConstraints = { ...base, outcome: "candidates", maxPrice: undefined, priceUnit: undefined, count: 5, softPrefs };
    subPlans.push({ id: sid, label: spec.label, objective: spec.query, constraints: subC, results: [], status: "pending" });

    const s = step({ description: `[${spec.label}] Search: "${spec.query}"`, tool: "web_search", input: { query: spec.query }, dependsOn: [reason.id], group: sid });
    const f = step({ description: `[${spec.label}] Read the most relevant pages`, tool: "fetch_page", input: {}, dependsOn: [s.id], group: sid });
    const e = step({ description: `[${spec.label}] Identify actual ${subC.entityLabel}s`, tool: "extract_structured", input: {}, dependsOn: [f.id], group: sid });
    const cmp = step({ description: `[${spec.label}] Rank ${subC.entityLabel} candidates`, tool: "compare", input: { count: 5 }, dependsOn: [e.id], group: sid });
    plan.push(s, f, e, cmp);
    compareIds.push(cmp.id);
  }

  const combine = step({
    description: c.maxPrice
      ? `Combine across categories under the $${c.maxPrice}${c.priceUnit ? "/" + c.priceUnit : ""} total budget and rank`
      : "Combine the categories into ranked cross-category options",
    tool: "combine_domains",
    input: {},
    dependsOn: compareIds,
  });
  plan.push(combine);

  appendActions(plan, objective, c.entityLabel || "option", combine.id);

  return { plan, subPlans };
}

export function createPlan(objective: string, c: TaskConstraints): PlanStep[] {
  const schema = schemaFor(c.domain, c.outcome);
  const label = c.entityLabel || "option";
  const actions = detectActions(objective);
  const plan: PlanStep[] = [];

  // 1) Always understand first.
  const understand = step({
    description:
      c.outcome === "candidates"
        ? `Understand what counts as a real ${label} and the constraints (location, budget, timing)`
        : c.outcome === "procedure"
          ? "Understand the process the objective is asking about"
          : "Understand what information the objective needs",
    tool: "reason",
    input: { objective, constraints: c },
    dependsOn: [],
  });
  plan.push(understand);
  let lastResearch = understand.id;

  // 2) Gather information. Prefer explicit URLs the user gave; otherwise search.
  const explicitUrls = urlsIn(objective);
  const researchIds: string[] = [];
  if (explicitUrls.length > 0) {
    for (const url of explicitUrls.slice(0, 4)) {
      const s = step({ description: `Read the document at ${url}`, tool: "read_document", input: { url }, dependsOn: [understand.id] });
      plan.push(s);
      researchIds.push(s.id);
    }
  } else {
    for (const q of buildQueries(objective, c)) {
      const s = step({ description: `Search the web for: "${q}"`, tool: "web_search", input: { query: q }, dependsOn: [understand.id] });
      plan.push(s);
      researchIds.push(s.id);
    }
    const fetchStep = step({
      description: c.outcome === "procedure" ? "Read the most relevant guide" : "Read the most relevant pages",
      tool: "fetch_page",
      input: {},
      dependsOn: researchIds,
    });
    plan.push(fetchStep);
    researchIds.length = 0;
    researchIds.push(fetchStep.id);
  }

  // 3) Turn what was read into structured candidates / steps / facts.
  const extractStep = step({
    description:
      c.outcome === "candidates"
        ? `Identify actual ${label}s (separating them from informational pages) and extract ${schema.columns.join(", ")}`
        : c.outcome === "procedure"
          ? "Extract the required steps, in order"
          : `Extract the key facts (${schema.columns.join(", ")})`,
    tool: "extract_structured",
    input: { columns: schema.columns },
    dependsOn: researchIds,
  });
  plan.push(extractStep);
  lastResearch = extractStep.id;

  // 4) Candidates get validated + ranked.
  if (c.outcome === "candidates") {
    const compareStep = step({
      description: c.maxPrice
        ? `Validate ${label} candidates, drop any failing the constraints, and rank the rest`
        : `Validate ${label} candidates and rank them`,
      tool: "compare",
      input: { maxPrice: c.maxPrice, count: c.count ?? 3 },
      dependsOn: [extractStep.id],
    });
    plan.push(compareStep);
    lastResearch = compareStep.id;
  }

  // 5) ACTION tools — appended ONLY when the objective actually asks to do
  //    something beyond researching. This is what makes Volo an execution engine
  //    rather than a research wrapper. Consequential steps require approval.
  const wantsAction = actions.contact || actions.book || actions.submit;
  if (wantsAction) {
    // Prepare the communication/artifact first (free, safe, automatic).
    const isRequest = c.outcome === "procedure" || actions.submit;
    const draft = step({
      description: isRequest
        ? "Prepare the request/message needed to act on this"
        : `Draft an enquiry to the top ${label}`,
      tool: "draft_email",
      input: {},
      dependsOn: [lastResearch],
    });
    plan.push(draft);

    // Then the consequential action itself — gated behind approval.
    const actionTool = actions.book ? "book" : actions.submit ? "submit_form" : "send_email";
    const actionDesc = actions.book
      ? `Book the chosen ${label}`
      : actions.submit
        ? "Submit the request (application / cancellation)"
        : `Send the enquiry to the ${label}`;
    const actionStep = step({
      description: `${actionDesc} — requires your approval`,
      tool: actionTool,
      input: { needs: "approval" },
      dependsOn: [draft.id],
    });
    plan.push(actionStep);

    // If a reply is expected, represent the wait explicitly.
    if (actions.awaitReply) {
      plan.push(step({
        description: "Wait for and read the provider's reply, then continue",
        tool: "monitor_inbox",
        input: {},
        dependsOn: [actionStep.id],
      }));
    }
  }

  return plan;
}
