import { NextRequest, NextResponse } from "next/server";
import { getTask, saveTask } from "@/lib/store";
import { resumeTask } from "@/lib/engine/executor";
import { id as newId } from "@/lib/util";
import { withAuth } from "@/lib/auth/guard";

export const runtime = "nodejs";

export const POST = withAuth(postImpl);

// POST /api/tasks/[id]/reply — relay an external reply so a waiting objective can
// resume (Phase 9). Volo can't watch an inbox for free, so the user provides the
// reply they received; Volo records it honestly and continues execution from the
// wait checkpoint. This works even after a server restart — the waiting state is
// persisted in SQLite.
async function postImpl(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  if (task.status !== "waiting_response") {
    return NextResponse.json({ error: "This objective is not waiting for a reply." }, { status: 409 });
  }

  let body: { text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const text = (body.text || "").trim();
  if (text.length < 1) {
    return NextResponse.json({ error: "Please paste the reply you received." }, { status: 400 });
  }

  // Record the relayed reply and clear the wait checkpoint so resume consumes it.
  task.externalEvents = [...(task.externalEvents ?? []), { at: Date.now(), text }];
  task.waiting = undefined;
  task.timeline.push({
    id: newId("t_"),
    at: Date.now(),
    status: "waiting_response",
    level: "info",
    message: "You relayed the reply you received. Resuming the objective.",
    detail: text.slice(0, 160),
  });
  saveTask(task);

  await resumeTask(task, () => {});

  return NextResponse.json({ task });
}
