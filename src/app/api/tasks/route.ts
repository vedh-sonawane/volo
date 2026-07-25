import { NextRequest, NextResponse } from "next/server";
import { createTask } from "@/lib/engine/create";
import { listTasks, saveTask } from "@/lib/store";

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
  if (objective.length > 500) {
    return NextResponse.json({ error: "Objective is too long (max 500 characters)." }, { status: 400 });
  }
  const task = createTask(objective);
  saveTask(task);
  return NextResponse.json({ task }, { status: 201 });
}

// GET /api/tasks — recent tasks (for history).
export async function GET() {
  const tasks = listTasks(30).map((t) => ({
    id: t.id,
    objective: t.objective,
    status: t.status,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  }));
  return NextResponse.json({ tasks });
}
