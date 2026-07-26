"use client";

import { useState } from "react";
import type { Task } from "@/lib/types";

// Shown when the objective is paused because Volo needs the MINIMUM answers that
// truly block execution. It asks only blocking questions; optional/researchable
// gaps are handled automatically. Answering resumes planning with the answers.
export function ClarifyCard({ task, onAnswered }: { task: Task; onAnswered: () => void }) {
  const qs = task.clarifications ?? [];
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (task.status !== "awaiting_clarification" || qs.length === 0) return null;

  async function submit() {
    const payload = qs.map((q) => ({ id: q.id, answer: answers[q.id] || "" }));
    if (payload.every((a) => !a.answer.trim())) {
      setError("Please answer at least one question (a rough answer is fine).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${task.id}/clarify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: payload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not submit answers.");
      onAnswered();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <section className="card p-5 fade-up" style={{ borderColor: "var(--color-warn)" }}>
      <div className="flex items-center gap-2">
        <span className="dot pulse" style={{ background: "var(--color-warn)", width: 9, height: 9 }} />
        <h3 className="text-[13px] font-[650]">A couple of quick questions</h3>
      </div>
      <p className="mt-1.5 text-[12.5px] text-[var(--color-muted)] leading-relaxed">
        Volo asks only what genuinely blocks execution — everything optional or researchable is handled automatically.
      </p>

      <div className="mt-4 flex flex-col gap-3">
        {qs.map((q, i) => (
          <div key={q.id}>
            <label className="text-[13px] font-[550] text-[var(--color-ink)] flex gap-2">
              <span className="text-[var(--color-faint)]">{i + 1}.</span>
              {q.question}
            </label>
            <input
              className="field !text-[14px] !py-2.5 !rounded-lg mt-1.5"
              value={answers[q.id] || ""}
              disabled={busy}
              onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
              placeholder="Your answer…"
            />
          </div>
        ))}
      </div>

      {error && <div className="mt-2 text-[12.5px] text-[var(--color-err)]">{error}</div>}
      <div className="mt-4 flex items-center gap-2">
        <button className="btn btn-accent text-[13px] !py-2" disabled={busy} onClick={submit}>
          {busy ? "Starting…" : "Answer & start →"}
        </button>
        <span className="text-[11.5px] text-[var(--color-faint)]">Volo re-plans with your answers, then researches.</span>
      </div>
    </section>
  );
}
