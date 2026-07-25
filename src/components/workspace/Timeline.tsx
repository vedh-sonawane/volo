"use client";

import { useEffect, useRef } from "react";
import type { Task } from "@/lib/types";
import { LEVEL_COLOR, clockTime } from "@/lib/ui";
import { Header } from "./PlanList";

export function Timeline({ task, live }: { task: Task; live: boolean }) {
  const endRef = useRef<HTMLDivElement>(null);
  const count = task.timeline.length;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [count]);

  return (
    <section className="card p-5">
      <Header title="Execution timeline" hint={`${count} event${count === 1 ? "" : "s"}`} />
      <div className="mt-4 max-h-[420px] overflow-auto pr-1">
        {count === 0 ? (
          <EmptyPulse live={live} />
        ) : (
          <ul className="flex flex-col gap-3">
            {task.timeline.map((ev) => (
              <li key={ev.id} className="flex gap-3 fade-up">
                <span className="dot mt-1.5" style={{ background: LEVEL_COLOR[ev.level] }} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] leading-snug text-[var(--color-ink)]">{ev.message}</div>
                  {ev.detail && (
                    <div className="text-[12px] text-[var(--color-muted)] mt-0.5 break-words font-[var(--font-mono)]">{ev.detail}</div>
                  )}
                </div>
                <span className="text-[11px] text-[var(--color-faint)] font-[var(--font-mono)] whitespace-nowrap">{clockTime(ev.at)}</span>
              </li>
            ))}
            <div ref={endRef} />
          </ul>
        )}
      </div>
    </section>
  );
}

function EmptyPulse({ live }: { live: boolean }) {
  return (
    <div className="py-6 text-center text-[13px] text-[var(--color-faint)]">
      {live ? "Waiting for the engine to report its first step…" : "No activity recorded."}
    </div>
  );
}
