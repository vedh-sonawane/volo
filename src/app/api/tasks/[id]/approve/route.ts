import { NextRequest, NextResponse } from "next/server";
import { getTask, saveTask } from "@/lib/store";
import { getTool } from "@/lib/tools/registry";
import { draftEmail } from "@/lib/tools/email-draft";
import { id as newId } from "@/lib/util";

export const runtime = "nodejs";

// POST /api/tasks/[id]/approve — approve or reject a pending action.
// Honesty: actions whose tool is not implemented in the free MVP are NEVER
// silently "done". Approving produces a safe artifact (a draft / exact steps)
// and clearly states nothing was sent.
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
    return NextResponse.json({ error: "Already decided" }, { status: 409 });
  }

  approval.status = body.decision === "approved" ? "approved" : "rejected";
  approval.decidedAt = Date.now();

  let outcome: { performed: boolean; message: string; artifact?: unknown } = {
    performed: false,
    message: "",
  };

  if (approval.status === "rejected") {
    outcome = { performed: false, message: "Action declined. Nothing was done." };
    task.timeline.push({
      id: newId("t_"),
      at: Date.now(),
      status: task.status,
      level: "info",
      message: `You declined: ${approval.title}. Nothing was sent or booked.`,
    });
  } else {
    const spec = getTool(approval.tool);
    if (spec && !spec.implemented) {
      // Honest degraded path: prepare a safe artifact, but DO NOT perform the
      // external action (not available for free).
      if (approval.tool === "send_email") {
        const draft = draftEmail({
          to: approval.target || "recipient@example.com",
          subject: `Enquiry: ${task.objective.slice(0, 60)}`,
          body: composeEnquiry(task.objective),
        });
        outcome = {
          performed: false,
          message:
            "Sending email is not enabled in the free version. A draft has been prepared for you to send from your own mail client.",
          artifact: draft,
        };
      } else {
        outcome = {
          performed: false,
          message: `${spec.description} is not enabled in the free version. ${spec.onError}`,
          artifact: { steps: bookingSteps(approval.target), target: approval.target },
        };
      }
      task.timeline.push({
        id: newId("t_"),
        at: Date.now(),
        status: task.status,
        level: "warn",
        message: `Approved "${approval.title}", but this action can't run for free. Prepared a safe draft/steps instead — nothing was sent.`,
        detail: approval.target,
      });
    } else {
      outcome = { performed: true, message: `${approval.title} completed.` };
    }
  }

  // If no more pending approvals, the task is effectively complete.
  const stillPending = task.approvals.some((a) => a.status === "pending");
  if (!stillPending && task.status === "awaiting_approval") {
    task.status = "completed";
  }
  saveTask(task);

  return NextResponse.json({ approval, outcome, task });
}

function composeEnquiry(objective: string): string {
  return [
    "Hello,",
    "",
    `I'm reaching out regarding: ${objective}.`,
    "Could you share your current pricing and availability?",
    "",
    "Thank you,",
    "(sent via a draft prepared by Volo — please edit before sending)",
  ].join("\n");
}

function bookingSteps(target?: string): string[] {
  return [
    `Open the booking page${target ? `: ${target}` : ""}.`,
    "Select your date, time, and party size.",
    "Enter your contact details.",
    "Review the total and any cancellation policy before confirming.",
    "Confirm the booking yourself — Volo never commits money on your behalf in the free version.",
  ];
}
