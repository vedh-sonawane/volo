"use client";

import type { Task } from "@/lib/types";
import { LIFECYCLE, STATUS_META } from "@/lib/ui";

const POST_ACTIVE: Task["status"][] = [
  "completed",
  "failed",
  "awaiting_approval",
  "waiting_response",
  "paused",
  "partially_completed",
];

export function Stepper({ task }: { task: Task }) {
  const terminal = POST_ACTIVE.includes(task.status);
  const currentIdx = LIFECYCLE.indexOf(task.status);

  function stateOf(i: number): "done" | "active" | "todo" {
    if (task.status === "failed") return i <= (currentIdx < 0 ? LIFECYCLE.length : currentIdx) ? "done" : "todo";
    if (terminal) return "done";
    if (i < currentIdx) return "done";
    if (i === currentIdx) return "active";
    return "todo";
  }

  return (
    <div className="flex items-center gap-1 sm:gap-2 flex-wrap">
      {LIFECYCLE.map((s, i) => {
        const st = stateOf(i);
        const meta = STATUS_META[s];
        return (
          <div key={s} className="flex items-center gap-1 sm:gap-2">
            <div className="flex items-center gap-2">
              <span
                className={st === "active" ? "dot pulse" : "dot"}
                style={{
                  background:
                    st === "done" ? "var(--color-ok)" : st === "active" ? meta.color : "var(--color-line-strong)",
                  width: 8,
                  height: 8,
                }}
              />
              <span
                className="text-[12.5px] whitespace-nowrap"
                style={{
                  color: st === "todo" ? "var(--color-faint)" : "var(--color-ink-soft)",
                  fontWeight: st === "active" ? 600 : 450,
                }}
              >
                {meta.label}
              </span>
            </div>
            {i < LIFECYCLE.length - 1 && (
              <span className="w-4 sm:w-6 h-px" style={{ background: "var(--color-line-strong)" }} />
            )}
          </div>
        );
      })}
    </div>
  );
}
