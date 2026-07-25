"use client";

import type { Task } from "@/lib/types";
import { hostOf } from "@/lib/ui";
import { Header } from "./PlanList";

export function Sources({ task }: { task: Task }) {
  return (
    <section className="card p-5">
      <Header title="Sources" hint={`${task.sources.length} page${task.sources.length === 1 ? "" : "s"} read`} />
      {task.sources.length === 0 ? (
        <div className="mt-4 text-[13px] text-[var(--color-faint)]">No pages read yet.</div>
      ) : (
        <ol className="mt-4 flex flex-col gap-3">
          {task.sources.map((s, i) => (
            <li key={s.url} className="flex gap-3 fade-up">
              <span className="font-[var(--font-mono)] text-[11px] text-[var(--color-faint)] mt-0.5 w-5">
                [{i + 1}]
              </span>
              <div className="min-w-0 flex-1">
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[13px] font-[550] link-underline text-[var(--color-ink)] block truncate"
                  title={s.title}
                >
                  {s.title || s.url}
                </a>
                <div className="text-[11.5px] text-[var(--color-faint)] mt-0.5 flex items-center gap-2">
                  <span className="text-[var(--color-accent-ink)]">{hostOf(s.url)}</span>
                  {typeof s.words === "number" && <span>· {s.words} words</span>}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
