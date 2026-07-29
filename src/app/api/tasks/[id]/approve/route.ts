import { NextRequest, NextResponse } from "next/server";
import type { ActionResult, Task } from "@/lib/types";
import { getTask, saveTask } from "@/lib/store";
import { applyDecision } from "@/lib/engine/decision";
import { resumeTask } from "@/lib/engine/executor";
import { id as newId } from "@/lib/util";
import { withAuth } from "@/lib/auth/guard";

export const runtime = "nodejs";

export const POST = withAuth(postImpl);

// POST /api/tasks/[id]/approve — approve or reject a pending action.
//
// Honesty + safety: the approved action runs through the SAME idempotent
// executeAction pipeline used in tests. A draft/steps is never reported as
// "succeeded"; a real send/booking reports its provider confirmation; a timeout
// is "uncertain" and never auto-retried (no duplicate charge); an already-run
// action is not repeated. Declining executes nothing and is a fast, safe
// terminal action.
async function postImpl(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  let body: { approvalId?: string; decision?: "approved" | "rejected" };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const decision = body.decision === "approved" ? "approved" : "rejected";

  // Apply the decision (mutates the task; approve runs the idempotent action,
  // decline executes nothing). This is the fast, safety-critical part.
  const res = await applyDecision(task, body.approvalId || "", decision);
  if (!res.ok) {
    return NextResponse.json({ error: res.error }, { status: res.conflict ? 409 : 404 });
  }
  const approval = res.approval!;
  const outcome = res.outcome!;

  // Timeline (honest record of what happened).
  if (decision === "rejected") {
    task.timeline.push(event(task, "info", `You declined: ${approval.title}. Nothing was done.`));
  } else if (approval.result) {
    const r = approval.result;
    task.timeline.push(event(task, timelineLevel(r.status), timelineMessage(approval.title, r), approval.target));
    if (approval.tool === "send_email" && r.status === "requires_user") {
      task.timeline.push(event(task, "info", "No reply is being monitored — nothing was sent yet (draft prepared for you to send)."));
    }
  }

  saveTask(task);

  // Continue the objective (into a wait, or to completion). Never re-plans.
  // A DECLINE has nothing to execute, so it concludes deterministically WITHOUT
  // touching the (possibly slow) local model — the response returns immediately
  // instead of blocking for seconds, which is what could drop the connection and
  // surface as a "Failed to fetch" in the browser.
  await resumeTask(task, () => {}, decision === "rejected" ? { forceRuleModel: true } : undefined);

  return NextResponse.json({ approval, outcome, task });
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
