import { NextRequest, NextResponse } from "next/server";
import { getTask, deleteTask } from "@/lib/store";
import { supersedeRun } from "@/lib/engine/runner";
import { withAuth } from "@/lib/auth/guard";

export const runtime = "nodejs";

export const POST = withAuth(postImpl);

// POST /api/tasks/[id]/cancel — cancel an objective and ERASE its progress.
//
// This supersedes any in-flight analysis (the running executor stops and can no
// longer persist), then deletes the task entirely. Because the run is superseded
// BEFORE deletion, an in-flight run can never recreate the erased task.
async function postImpl(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  supersedeRun(id); // stop the in-flight run and block further writes
  deleteTask(id); // erase all progress

  return NextResponse.json({ ok: true });
}
