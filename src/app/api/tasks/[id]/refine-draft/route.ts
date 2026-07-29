import { NextRequest, NextResponse } from "next/server";
import { getTask, saveTask } from "@/lib/store";
import { resolveModel } from "@/lib/providers/model";
import { refineEmail } from "@/lib/engine/refine";
import { withAuth } from "@/lib/auth/guard";

export const runtime = "nodejs";

export const POST = withAuth(postImpl);

// POST /api/tasks/[id]/refine-draft — polish the pending EMAIL draft's subject +
// body. The recipient/target is NEVER passed to the model or changed. Refined
// content is validated (no placeholders) before it replaces the draft, and the
// action still requires approval before anything is sent.
async function postImpl(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = getTask(id);
  if (!task) return NextResponse.json({ ok: false, error: "Task not found" }, { status: 404 });

  const da = task.directAction;
  const approval = task.approvals.find((a) => a.tool === "send_email" && a.status === "pending");
  if (!da || da.capability !== "send_email" || !approval) {
    return NextResponse.json({ ok: false, error: "There's no pending email draft to refine here." }, { status: 400 });
  }

  const model = await resolveModel();
  if (!(await model.available())) {
    return NextResponse.json({ ok: false, error: "Refine needs a connected AI model (Ollama). Connect one in Settings, then try again." });
  }

  const refined = await refineEmail(da.params.subject ?? "", da.params.body ?? "", model);
  if (!refined) {
    return NextResponse.json({ ok: false, error: "Couldn't polish this cleanly (it may have added a placeholder) — your draft is unchanged." });
  }

  // Update ONLY subject + body. The recipient (da.target) is untouched.
  da.params.subject = refined.subject;
  da.params.body = refined.body;
  approval.payloadPreview = `To: ${da.target}\nSubject: ${refined.subject}\n\n${refined.body.slice(0, 300)}`;
  task.timeline.push({
    id: `t_${Date.now().toString(36)}`,
    at: Date.now(),
    status: task.status,
    level: "info",
    message: "Polished the email draft (subject + body). Recipient unchanged; still needs your approval.",
  });
  saveTask(task);

  return NextResponse.json({ ok: true, task });
}
