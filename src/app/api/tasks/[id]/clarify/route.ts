import { NextRequest, NextResponse } from "next/server";
import { getTask, saveTask } from "@/lib/store";
import { id as newId } from "@/lib/util";
import { withAuth } from "@/lib/auth/guard";

export const runtime = "nodejs";

export const POST = withAuth(postImpl);

// POST /api/tasks/[id]/clarify — the user answers the minimal blocking questions
// Volo asked. We merge the answers into the objective, clear the clarification
// state, and reset the task to a runnable state. The client then re-opens the
// SSE stream, which re-plans WITH the answers and executes. (Kept async so the
// slow re-planning doesn't block this request.)
async function postImpl(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  if (task.status !== "awaiting_clarification") {
    return NextResponse.json({ error: "This objective isn't waiting for answers." }, { status: 409 });
  }

  let body: { answers?: { id?: string; answer?: string }[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const answers = Array.isArray(body.answers) ? body.answers : [];

  // Attach answers to their questions. Direct-action parameter answers are stored
  // STRUCTURALLY (verbatim, keyed by param) so the exact text reaches the payload;
  // free-form (goal/research) answers are merged into the effective objective.
  const lines: string[] = [];
  const paramAnswers: Record<string, string> = { ...(task.directActionParams ?? {}) };
  for (const q of task.clarifications ?? []) {
    const a = answers.find((x) => x.id === q.id);
    const text = (a?.answer || "").trim();
    q.answer = text || "(no answer given)";
    if (q.param) {
      // VERBATIM — never re-parsed. Only record a real answer (skip "no answer").
      if (text) paramAnswers[q.param] = text;
    } else {
      lines.push(`- ${q.question} → ${q.answer}`);
    }
  }
  if ((task.clarifications ?? []).length === 0) {
    return NextResponse.json({ error: "Please answer at least one question." }, { status: 400 });
  }

  if (Object.keys(paramAnswers).length > 0) task.directActionParams = paramAnswers;
  if (lines.length > 0) {
    task.clarificationContext = [task.clarificationContext, ...lines].filter(Boolean).join("\n");
  }
  task.timeline.push({
    id: newId("t_"),
    at: Date.now(),
    status: "awaiting_clarification",
    level: "info",
    message: "Thanks — got your answers. Re-planning with them now.",
    detail: (lines.join(" · ") || `Recorded ${Object.keys(paramAnswers).length} detail(s).`).slice(0, 200),
  });

  // Reset to a runnable state; the reopened stream will re-plan + execute.
  task.clarifications = undefined;
  task.plan = [];
  task.subPlans = undefined;
  task.combination = undefined;
  task.multiDomain = false;
  task.status = "understanding";
  saveTask(task);

  return NextResponse.json({ task });
}
