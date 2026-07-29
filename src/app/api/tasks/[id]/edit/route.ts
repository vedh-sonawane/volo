import { NextRequest, NextResponse } from "next/server";
import { getTask, saveTask } from "@/lib/store";
import { createTask } from "@/lib/engine/create";
import { supersedeRun } from "@/lib/engine/runner";
import { withAuth } from "@/lib/auth/guard";

export const runtime = "nodejs";

export const POST = withAuth(postImpl);

// POST /api/tasks/[id]/edit — replace the objective and RE-ANALYZE from scratch.
//
// Editing the prompt supersedes any in-flight run, then rebuilds the task from
// the new objective (same id + createdAt) with all prior progress cleared and a
// fresh, non-terminal status. Re-opening the stream then re-runs the new prompt.
async function postImpl(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const existing = getTask(id);
  if (!existing) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  let body: { objective?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const objective = (body.objective || "").trim();
  if (objective.length < 4) {
    return NextResponse.json({ error: "Please describe what you want done (a few words at least)." }, { status: 400 });
  }

  // Supersede the current run first: the old run stops and can no longer persist,
  // so it can't clobber the fresh task we're about to write.
  supersedeRun(id);

  // Rebuild from the new objective, preserving identity + original creation time.
  const fresh = createTask(objective);
  fresh.id = existing.id;
  fresh.createdAt = existing.createdAt;
  saveTask(fresh);

  return NextResponse.json({ task: fresh });
}
