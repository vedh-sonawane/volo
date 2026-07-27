// Guards against double-execution and exposes a single entry point the SSE
// route uses to run (or resume/replay) a task while streaming events.

import type { StreamEvent, Task } from "@/lib/types";
import { getTask, saveTask } from "@/lib/store";
import { runTask } from "./executor";
import { bumpGeneration, isSuperseded } from "./runcontrol";

// taskId → the generation currently executing (so a reconnect just observes
// instead of starting a second run).
const running = new Map<string, number>();

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
  if (running.has(taskId) || isTerminal(task)) {
    // Replay current snapshot; nothing to execute.
    emit({ type: "task", task });
    emit({ type: "done", task });
    return;
  }
  const myGen = bumpGeneration(taskId); // this run's generation
  running.set(taskId, myGen);
  try {
    emit({ type: "task", task });
    await runTask(task, emit, myGen);
    // Never persist a run that was superseded (cancelled / prompt edited).
    if (!isSuperseded(taskId, myGen)) saveTask(task);
  } finally {
    // Only clear the slot if we still own it (a superseding run may have taken it).
    if (running.get(taskId) === myGen) running.delete(taskId);
  }
}

/**
 * Supersede any in-flight run for a task: bump the generation (so the running
 * executor stops and stops persisting) and free the run slot so a subsequent
 * stream-open starts a fresh run. Used by cancel (then delete) and edit (then
 * reset + re-run).
 */
export function supersedeRun(taskId: string): void {
  bumpGeneration(taskId);
  running.delete(taskId);
}
