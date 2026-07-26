// Guards against double-execution and exposes a single entry point the SSE
// route uses to run (or resume/replay) a task while streaming events.

import type { StreamEvent, Task } from "@/lib/types";
import { getTask, saveTask } from "@/lib/store";
import { runTask } from "./executor";

const running = new Set<string>();

/** States that will NOT trigger a fresh run when the stream is (re)opened. */
function isTerminal(t: Task): boolean {
  return (
    t.status === "completed" ||
    t.status === "failed" ||
    t.status === "awaiting_approval" ||
    t.status === "awaiting_clarification" ||
    t.status === "waiting_response" ||
    t.status === "paused" ||
    t.status === "partially_completed"
  );
}

/**
 * Ensures the task runs at most once. Returns immediately if the task is already
 * running (the caller should just stream current state) or terminal.
 */
export async function ensureRun(taskId: string, emit: (e: StreamEvent) => void): Promise<void> {
  const task = getTask(taskId);
  if (!task) {
    emit({ type: "error", message: "Task not found" });
    return;
  }
  if (isTerminal(task) || running.has(taskId)) {
    // Replay current snapshot; nothing to execute.
    emit({ type: "task", task });
    emit({ type: "done", task });
    return;
  }
  running.add(taskId);
  try {
    emit({ type: "task", task });
    await runTask(task, emit);
    saveTask(task);
  } finally {
    running.delete(taskId);
  }
}
