"use client";

import { useState } from "react";
import type { Task } from "@/lib/types";
import { timeAgo } from "@/lib/ui";

// Shown when an objective is paused waiting for an external reply. Volo cannot
// watch an inbox for free, so the user relays what they received and Volo
// resumes. Honest by construction — no fake monitoring.
export function WaitingCard({ task, onResumed }: { task: Task; onResumed: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (task.status !== "waiting_response" || !task.waiting) return null;

  async function submit() {
    const reply = text.trim();
    if (reply.length < 1) {
      setError("Paste the reply you received.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${task.id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: reply }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not resume.");
      onResumed();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <section className="card p-5 fade-up" style={{ borderColor: "var(--color-warn)" }}>
      <div className="flex items-center gap-2">
        <span className="dot pulse" style={{ background: "var(--color-warn)", width: 9, height: 9 }} />
        <h3 className="text-[13px] font-[650]">Waiting for a reply</h3>
        <span className="text-[11px] text-[var(--color-faint)] font-[var(--font-mono)]">since {timeAgo(task.waiting.since)}</span>
      </div>
      <p className="mt-2 text-[13px] text-[var(--color-ink-soft)] leading-relaxed">{task.waiting.prompt}</p>

      {task.externalEvents && task.externalEvents.length > 0 && (
        <div className="mt-3 text-[12px] text-[var(--color-faint)]">
          {task.externalEvents.length} earlier repl{task.externalEvents.length === 1 ? "y" : "ies"} relayed.
        </div>
      )}

      <div className="mt-3">
        <textarea
          rows={3}
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste the reply you received (e.g. what the provider emailed back)…"
          className="field !text-[14px] !py-3"
        />
      </div>
      {error && <div className="mt-2 text-[12.5px] text-[var(--color-err)]">{error}</div>}
      <div className="mt-3 flex items-center gap-2">
        <button className="btn btn-accent text-[13px] !py-2" disabled={busy} onClick={submit}>
          {busy ? "Resuming…" : "Relay reply & continue →"}
        </button>
        <span className="text-[11.5px] text-[var(--color-faint)]">Volo continues from where it paused — even if you closed the app.</span>
      </div>
    </section>
  );
}
