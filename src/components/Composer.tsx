"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const EXAMPLES = [
  "Make someone laugh with a funny joke.",
  "Find me the best driving instructor near me under $60/hour with availability next week.",
  "Explain how airplanes stay in the air.",
  "Compare these laptops for programming and gaming under $1,500.",
  "Find the cheapest flight options that match these requirements.",
];

export function Composer() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const objective = value.trim();
    if (objective.length < 4) {
      setError("Describe what you want done — a few words at least.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objective }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not create the task.");
      router.push(`/task/${data.task.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="w-full">
      <div className="relative">
        <textarea
          autoFocus
          rows={3}
          value={value}
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="What do you want done?  e.g. Find me the best driving instructor near me under $60/hour with availability next week."
          className="field pr-3"
          style={{ minHeight: 128 }}
        />
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[13px] text-[var(--color-faint)]">
          Volo takes an <span className="text-[var(--color-muted)]">objective</span>, not a question. It plans, researches, and reports an outcome with sources.
        </p>
        <div className="flex items-center gap-3">
          <kbd className="text-[11px] text-[var(--color-faint)] font-[var(--font-mono)] hidden sm:inline">
            ⌘/Ctrl + ↵
          </kbd>
          <button className="btn btn-accent btn-shine" onClick={submit} disabled={busy}>
            {busy ? (
              <>
                <Spinner /> Creating…
              </>
            ) : (
              <>Run this objective →</>
            )}
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-3 text-[13px] text-[var(--color-err)] fade-up">{error}</div>
      )}

      <div className="mt-7">
        <div className="eyebrow mb-3">Try an example</div>
        <div className="flex flex-col gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              className="chip !rounded-lg !py-2.5 !px-3.5 text-left"
              onClick={() => {
                setValue(ex);
                setError(null);
              }}
              disabled={busy}
            >
              <span className="text-[var(--color-faint)] mr-1">↳</span>
              <span className="truncate">{ex}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <span
      className="spin"
      style={{
        width: 14,
        height: 14,
        borderRadius: 999,
        border: "2px solid rgba(255,255,255,0.4)",
        borderTopColor: "#fff",
        display: "inline-block",
      }}
    />
  );
}
