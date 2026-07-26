import { NextRequest, NextResponse } from "next/server";
import type { ActionCapability, ActionResult, Task } from "@/lib/types";
import { getTask, saveTask } from "@/lib/store";
import { executeAction } from "@/lib/actions";
import type { ActionInput } from "@/lib/actions";
import { resumeTask } from "@/lib/engine/executor";
import { id as newId } from "@/lib/util";

export const runtime = "nodejs";

const ACTION_TOOLS: ActionCapability[] = ["send_email", "calendar_event", "book", "submit_form", "payment"];

// POST /api/tasks/[id]/approve — approve or reject a pending action.
//
// Honesty + safety: the approved action runs through the SAME idempotent
// executeAction pipeline used in tests. A draft/steps is never reported as
// "succeeded"; a real send/booking reports its provider confirmation; a timeout
// is "uncertain" and never auto-retried (no duplicate charge); an already-run
// action is not repeated.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  let body: { approvalId?: string; decision?: "approved" | "rejected" };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const approval = task.approvals.find((a) => a.id === body.approvalId);
  if (!approval) return NextResponse.json({ error: "Approval not found" }, { status: 404 });
  if (approval.status !== "pending") {
    return NextResponse.json({ error: "This action was already decided." }, { status: 409 });
  }

  approval.status = body.decision === "approved" ? "approved" : "rejected";
  approval.decidedAt = Date.now();

  const actionStep = task.plan.find((s) => s.tool === approval.tool && s.status === "blocked_on_approval");
  let outcome: { performed: boolean; status: ActionResult["status"] | "rejected"; message: string; artifact?: unknown; confirmation?: string };

  if (approval.status === "rejected") {
    outcome = { performed: false, status: "rejected", message: "Action declined. Nothing was sent, booked, or charged." };
    task.timeline.push(event(task, "info", `You declined: ${approval.title}. Nothing was done.`));
    if (actionStep) actionStep.status = "skipped";
    task.plan.forEach((s) => {
      if (s.tool === "monitor_inbox" && s.status === "pending") s.status = "skipped";
    });
  } else {
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
    outcome = {
      performed: result.status === "succeeded",
      status: result.status,
      message: result.message,
      artifact: result.artifact,
      confirmation: result.confirmation,
    };

    task.timeline.push(event(task, timelineLevel(result.status), timelineMessage(approval.title, result), approval.target));

    // Step status honestly reflects the real outcome.
    if (actionStep) {
      actionStep.status = result.status === "failed" ? "failed" : "done";
      actionStep.output = { status: result.status, confirmation: result.confirmation };
    }

    // HONESTY: only enter a "waiting for a reply" state if a message was ACTUALLY
    // sent. If it was a draft/unsupported/failed/uncertain, do NOT create a fake
    // monitoring state — skip the downstream monitor step.
    if (result.status !== "succeeded") {
      task.plan.forEach((s) => {
        if (s.tool === "monitor_inbox" && s.status === "pending") s.status = "skipped";
      });
      if (capability === "send_email" && result.status === "requires_user") {
        task.timeline.push(event(task, "info", "No reply is being monitored — nothing was sent yet (draft prepared for you to send)."));
      }
    }
  }

  saveTask(task);

  // Continue the objective (into a wait, or to completion). Never re-plans.
  await resumeTask(task, () => {});

  return NextResponse.json({ approval, outcome, task });
}

function buildPayload(task: Task, capability: ActionCapability): Record<string, unknown> {
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

function timelineLevel(status: ActionResult["status"]): "success" | "warn" | "error" {
  if (status === "succeeded") return "success";
  if (status === "failed") return "error";
  return "warn";
}

function timelineMessage(title: string, r: ActionResult): string {
  switch (r.status) {
    case "succeeded":
      return `Performed "${title}". ${r.message}${r.confirmation ? ` (ref ${r.confirmation})` : ""}`;
    case "duplicate":
      return `"${title}" was already executed — not repeated. ${r.message}`;
    case "uncertain":
      return `"${title}" — outcome UNCERTAIN. ${r.message}`;
    case "requires_user":
      return `"${title}" needs your authentication. ${r.message}`;
    case "unsupported":
      return `"${title}" isn't supported for real execution here. ${r.message}`;
    default:
      return `"${title}" was not performed. ${r.message}`;
  }
}

function event(task: Task, level: "info" | "success" | "warn" | "error", message: string, detail?: string) {
  return { id: newId("t_"), at: Date.now(), status: task.status, level, message, detail };
}
