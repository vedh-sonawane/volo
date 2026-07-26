import { NextRequest, NextResponse } from "next/server";
import { createTask } from "@/lib/engine/create";
import { listTasks, saveTask } from "@/lib/store";
import type { ObjectiveSummary } from "@/lib/types";
import { needsInput, nextActionFor, progressOf } from "@/lib/ui";

export const runtime = "nodejs";

// POST /api/tasks — create a task from an objective (does not execute yet;
// execution starts when the client opens the /stream endpoint).
export async function POST(req: NextRequest) {
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
  // No maximum length — objectives can be as detailed as the user needs.
  const task = createTask(objective);
  saveTask(task);
  return NextResponse.json({ task }, { status: 201 });
}

// GET /api/tasks — all persisted objectives, summarized for the dashboard.
// Everything here is derived from real stored state (the DB is the source of
// truth); nothing is fabricated.
export async function GET() {
  const objectives: ObjectiveSummary[] = listTasks(100).map((t) => ({
    id: t.id,
    title: t.title || t.objective,
    objective: t.objective,
    status: t.status,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    progress: progressOf(t),
    pendingApprovals: t.approvals.filter((a) => a.status === "pending").length,
    needsInput: needsInput(t),
    nextAction: nextActionFor(t),
    lastActivity: t.timeline.length ? t.timeline[t.timeline.length - 1].message : undefined,
  }));
  return NextResponse.json({ objectives });
}
