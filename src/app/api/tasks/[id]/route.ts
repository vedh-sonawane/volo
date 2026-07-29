import { NextRequest, NextResponse } from "next/server";
import { getTask, deleteTask } from "@/lib/store";
import { withAuth } from "@/lib/auth/guard";

export const runtime = "nodejs";

export const GET = withAuth(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  return NextResponse.json({ task });
});

export const DELETE = withAuth(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  deleteTask(id);
  return NextResponse.json({ ok: true });
});
