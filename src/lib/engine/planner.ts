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

import type { DirectAction, PlanStep, SubPlan, TaskConstraints } from "@/lib/types";
import { id } from "@/lib/util";
import { schemaFor } from "./domains";
import { detectActions } from "./classify";
import { understand } from "./understand";
import { capabilityLabel } from "./action-router";
import { inferOutcomeNeeds } from "./paths";

/**
 * Decide the approval-gated action tail for a RESEARCH plan, generically. It
 * fires not only on explicit action verbs but when the OUTCOME implies engaging a
 * party (a quote, a response, a resolution) — so indirect wording works without
 * the user naming a capability. It never runs anything: the action is always
 * gated behind explicit approval downstream.
 */
interface ActionTail {
  wants: boolean;
  tool: "send_email" | "book" | "submit_form";
  isRequest: boolean;
  awaitReply: boolean;
}
function resolveActionTail(objective: string, c: TaskConstraints): ActionTail {
  const a = detectActions(objective);
  const needs = inferOutcomeNeeds(objective, c);
  const tool: ActionTail["tool"] = a.book ? "book" : a.submit ? "submit_form" : "send_email";
  // Reaching a party (inferred from the outcome) counts as wanting to contact —
  // this is the generic research → communicate fallback path.
  const wants = a.contact || a.book || a.submit || needs.reachParty;
  return {
    wants,
    tool,
    isRequest: c.outcome === "procedure" || a.submit,
    awaitReply: a.awaitReply || (wants && tool === "send_email"),
  };
}

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

/** Append the (approval-gated) action tail if the OUTCOME implies acting. */
function appendActions(plan: PlanStep[], objective: string, c: TaskConstraints, label: string, afterId: string) {
  const t = resolveActionTail(objective, c);
  if (!t.wants) return;
  const draft = step({
    description: t.isRequest ? "Prepare the request/message needed to act" : `Draft an enquiry to the top ${label}`,
    tool: "draft_email",
    input: {},
    dependsOn: [afterId],
  });
  plan.push(draft);
  const actionDesc = t.tool === "book" ? `Make the booking` : t.tool === "submit_form" ? "Submit the request" : `Send the enquiry to the discovered party`;
  const actionStep = step({ description: `${actionDesc} — requires your approval`, tool: t.tool, input: { needs: "approval" }, dependsOn: [draft.id] });
  plan.push(actionStep);
  if (t.awaitReply) {
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

  appendActions(plan, objective, c, c.entityLabel || "option", combine.id);

  return { plan, subPlans };
}

/**
 * Build a DIRECT-ACTION plan: no research, no candidate extraction, no
 * comparison. Just validate → prepare the exact action preview → (approval-gated)
 * execute → optionally wait for a reply (only if the user asked). The user's
 * supplied parameters are carried on task.directAction and preserved verbatim by
 * the preparation/approval/execution steps — never rewritten or fabricated.
 */
export function buildDirectActionPlan(objective: string, c: TaskConstraints, action: DirectAction): PlanStep[] {
  const plan: PlanStep[] = [];
  const label = capabilityLabel(action.capability);

  const reason = step({
    description: `Validate the ${label} parameters you provided`,
    tool: "reason",
    input: { objective, constraints: c },
    dependsOn: [],
  });
  plan.push(reason);
  let lastId = reason.id;

  // A dedicated preparation step for email produces the exact, reviewable draft
  // (.eml) from the user's own recipient/subject/body. Other capabilities are
  // previewed directly at the approval step from the supplied parameters.
  if (action.capability === "send_email") {
    const prep = step({ description: `Prepare the exact email to ${action.target}`, tool: "draft_email", input: {}, dependsOn: [lastId] });
    plan.push(prep);
    lastId = prep.id;
  }

  const actDesc = directActionDescription(action);
  const act = step({ description: `${actDesc} — requires your approval`, tool: action.capability, input: { needs: "approval" }, dependsOn: [lastId] });
  plan.push(act);

  // Reply monitoring ONLY when the user explicitly asked for it.
  if (action.monitor && action.capability === "send_email") {
    plan.push(step({ description: "Wait for and read the reply, then continue", tool: "monitor_inbox", input: {}, dependsOn: [act.id] }));
  }

  return plan;
}

function directActionDescription(action: DirectAction): string {
  const p = action.params;
  switch (action.capability) {
    case "send_email":
      return `Send the email to ${action.target}`;
    case "calendar_event":
      return `Export a calendar file for "${p.title || "the event"}"`;
    case "submit_form":
      return `Submit the form at ${action.target}`;
    case "book":
      return `Book ${action.target}`;
    case "payment":
      return `Pay ${[p.currency, p.amount].filter(Boolean).join(" ") || "the amount"} to ${action.target}`;
  }
}

/**
 * Guarantee an approval-gated action tail exists on an already-authored research
 * plan (used for MIXED objectives: research → compare → approve → act). Safe to
 * call repeatedly — it no-ops if the plan already ends in an action.
 */
export function appendActionTail(plan: PlanStep[], objective: string, c: TaskConstraints): void {
  const hasAction = plan.some((s) => ["send_email", "submit_form", "book", "payment"].includes(s.tool));
  if (hasAction) return;
  const afterId = plan[plan.length - 1]?.id ?? "";
  appendActions(plan, objective, c, c.entityLabel || "option", afterId);
}

/**
 * Build a DIRECT-ANSWER plan for an informational/creative request: interpret,
 * then compose the answer directly. NO web_search / fetch / extract / compare /
 * combine — the response comes from knowledge/generation, so a search-provider
 * failure or rate-limit can never turn this into a failed research objective.
 */
export function buildDirectAnswerPlan(objective: string, c: TaskConstraints): PlanStep[] {
  const reason = step({ description: "Understand the request", tool: "reason", input: { objective, constraints: c }, dependsOn: [] });
  const answer = step({ description: "Compose a direct answer (no web research needed)", tool: "direct_answer", input: {}, dependsOn: [reason.id] });
  return [reason, answer];
}

export function createPlan(objective: string, c: TaskConstraints): PlanStep[] {
  const schema = schemaFor(c.domain, c.outcome);
  const label = c.entityLabel || "option";
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

  // 5) ACTION tools — appended ONLY when the OUTCOME implies doing something
  //    beyond researching (an explicit action verb, OR an inferred need to engage
  //    a party — a quote, a response, a resolution). This is what makes Volo an
  //    execution engine, and it works from indirect wording without the user
  //    naming a capability. Consequential steps ALWAYS require approval.
  const tail = resolveActionTail(objective, c);
  if (tail.wants) {
    // Prepare the communication/artifact first (free, safe, automatic).
    const draft = step({
      description: tail.isRequest
        ? "Prepare the request/message needed to act on this"
        : `Draft an enquiry to the top ${label}`,
      tool: "draft_email",
      input: {},
      dependsOn: [lastResearch],
    });
    plan.push(draft);

    // Then the consequential action itself — gated behind approval.
    const actionDesc = tail.tool === "book"
      ? `Book the chosen ${label}`
      : tail.tool === "submit_form"
        ? "Submit the request (application / cancellation)"
        : `Contact the discovered party`;
    const actionStep = step({
      description: `${actionDesc} — requires your approval`,
      tool: tail.tool,
      input: { needs: "approval" },
      dependsOn: [draft.id],
    });
    plan.push(actionStep);

    // If a reply is expected, represent the wait explicitly.
    if (tail.awaitReply) {
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
