"use client";

import type { Task } from "@/lib/types";

export function FinalResult({ task }: { task: Task }) {
  const f = task.finalResult;
  if (!f) return null;
  return (
    <section className="card p-6 fade-up" style={{ borderColor: "var(--color-line-strong)" }}>
      <div className="eyebrow mb-2">Outcome</div>
      <h2 className="text-[22px] font-[660] tracking-[-0.02em] leading-tight">{f.headline}</h2>
      <p className="mt-3 text-[15px] leading-relaxed text-[var(--color-ink-soft)]">{f.summary}</p>

      {f.takeaways.length > 0 && (
        <ul className="mt-5 flex flex-col gap-2">
          {f.takeaways.map((t, i) => (
            <li key={i} className="flex gap-3 text-[14px] leading-relaxed">
              <span className="dot mt-2" style={{ background: "var(--color-ok)" }} />
              <span className="text-[var(--color-ink)]">{t}</span>
            </li>
          ))}
        </ul>
      )}

      {f.limitations.length > 0 && (
        <div className="mt-5 border-t pt-4">
          <div className="eyebrow mb-2" style={{ color: "var(--color-warn)" }}>
            What Volo couldn&apos;t do automatically
          </div>
          <ul className="flex flex-col gap-1.5">
            {f.limitations.map((l, i) => (
              <li key={i} className="text-[13px] text-[var(--color-muted)] leading-relaxed flex gap-2">
                <span className="text-[var(--color-warn)]">·</span>
                {l}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
