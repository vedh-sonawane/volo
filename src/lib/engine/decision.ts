// ─────────────────────────────────────────────────────────────────────────────
// Approval decision logic (approve / decline), separated from the HTTP route so
// it is unit-testable and has ONE well-defined contract for safety + idempotency.
//
// Guarantees:
//   • An approval can be decided at most once. A non-pending approval is a
//     conflict — never re-executed, never re-declined into a different state.
//   • DECLINING never executes the action. It is a safe terminal action: the
//     action step is skipped and can never later run as if still pending.
//   • APPROVING runs the action through the idempotent executeAction pipeline
//     (which itself prevents duplicate side effects), and the reported outcome
//     reflects the REAL provider result — never a fabricated success.
// ─────────────────────────────────────────────────────────────────────────────

import type { ActionCapability, ActionResult, ApprovalRequest, Task } from "@/lib/types";
import { executeAction } from "@/lib/actions";
import type { ActionInput } from "@/lib/actions";

const ACTION_TOOLS: ActionCapability[] = ["send_email", "calendar_event", "book", "submit_form", "payment"];

export interface DecisionOutcome {
  performed: boolean;
  status: ActionResult["status"] | "rejected";
  message: string;
  artifact?: unknown;
  confirmation?: string;
}

export interface DecisionResult {
  ok: boolean;
  /** True when the approval was already decided (HTTP 409). */
  conflict?: boolean;
  /** True when the approval id wasn't found (HTTP 404). */
  notFound?: boolean;
  error?: string;
  approval?: ApprovalRequest;
  outcome?: DecisionOutcome;
}

/**
 * Apply an approve/decline decision to a task. Mutates the task in place and
 * returns the outcome. Does NOT persist or continue execution — the caller owns
 * that (so it can persist once and continue without blocking the response).
 */
export async function applyDecision(task: Task, approvalId: string, decision: "approved" | "rejected"): Promise<DecisionResult> {
  const approval = task.approvals.find((a) => a.id === approvalId);
  if (!approval) return { ok: false, notFound: true, error: "Approval not found" };
  if (approval.status !== "pending") {
    // Already decided — never flip a decided approval or re-run it.
    return { ok: false, conflict: true, error: "This action was already decided.", approval };
  }

  approval.status = decision === "approved" ? "approved" : "rejected";
  approval.decidedAt = Date.now();

  const actionStep = task.plan.find((s) => s.tool === approval.tool && s.status === "blocked_on_approval");

  // ── DECLINE: never execute. Skip the action + any dependent wait, safely. ───
  if (approval.status === "rejected") {
    if (actionStep) actionStep.status = "skipped";
    // The declined action's downstream reply-monitor can never fire.
    task.plan.forEach((s) => {
      if (s.tool === "monitor_inbox" && s.status === "pending") s.status = "skipped";
    });
    return {
      ok: true,
      approval,
      outcome: { performed: false, status: "rejected", message: "Action declined. Nothing was sent, booked, or charged." },
    };
  }

  // ── APPROVE: run the real, idempotent action. ───────────────────────────────
  const capability = (ACTION_TOOLS.includes(approval.tool as ActionCapability) ? approval.tool : "submit_form") as ActionCapability;
  const input: ActionInput = {
    capability,
    target: approval.target || "",
    summary: approval.description,
    payload: buildPayload(task, capability),
    idempotencyKey: `${task.id}:${approval.id}`,
    financial: approval.financial,
  };

  const result = await executeAction(task, input);
  approval.result = result;

  // Step status honestly reflects the real outcome.
  if (actionStep) {
    actionStep.status = result.status === "failed" ? "failed" : "done";
    actionStep.output = { status: result.status, confirmation: result.confirmation };
  }

  // HONESTY: only keep a "waiting for a reply" step alive if a message was
  // ACTUALLY sent. Anything else (draft/unsupported/failed/uncertain) must not
  // leave a fake monitoring state.
  if (result.status !== "succeeded") {
    task.plan.forEach((s) => {
      if (s.tool === "monitor_inbox" && s.status === "pending") s.status = "skipped";
    });
  }

  return {
    ok: true,
    approval,
    outcome: { performed: result.status === "succeeded", status: result.status, message: result.message, artifact: result.artifact, confirmation: result.confirmation },
  };
}

/**
 * Build the payload for an approved action. Direct actions use the user's EXACT
 * validated parameters (never rewritten with generic objective text); research
 * enquiries fall back to a generic message.
 */
export function buildPayload(task: Task, capability: ActionCapability): Record<string, unknown> {
  const da = task.directAction;
  if (da && da.capability === capability) {
    switch (capability) {
      case "send_email":
        return { subject: da.params.subject ?? "", body: da.params.body ?? "" };
      case "calendar_event":
        return { title: da.params.title ?? task.title, location: da.params.location ?? "", date: da.params.date ?? "", time: da.params.time ?? "" };
      case "submit_form":
        return { ...da.params };
      case "payment":
        return { amount: da.params.amount ?? "", currency: da.params.currency ?? "" };
      default:
        return {};
    }
  }

  if (capability === "send_email") {
    return {
      subject: `Enquiry: ${task.objective.slice(0, 60)}`,
      body: ["Hello,", "", `I'm reaching out regarding: ${task.objective}.`, "Could you share your current pricing and availability?", "", "Thank you,", "(prepared by Volo — review before it goes out)"].join("\n"),
    };
  }
  if (capability === "calendar_event") {
    const c = task.constraints;
    return { title: task.title || task.objective.slice(0, 60), location: c.location && c.location !== "near me" ? c.location : "" };
  }
  return {};
}
