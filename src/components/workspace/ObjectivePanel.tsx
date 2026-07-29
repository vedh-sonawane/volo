"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type { Task } from "@/lib/types";
import { STATUS_META } from "@/lib/ui";

/**
 * The objective heading with two controls:
 *   • a pencil "Edit" that lets the user rewrite the prompt and RE-ANALYZE from
 *     scratch (the new prompt replaces the old one);
 *   • a "Cancel analysis" that, after confirmation, ERASES all progress and
 *     returns home.
 * Both handle API/network errors gracefully and never crash the UI.
 */
export function ObjectivePanel({ task, onEdited }: { task: Task; onEdited: () => void }) {
  const router = useRouter();
  // Progress can be cancelled/erased any time it isn't already finished.
  const cancellable = task.status !== "completed" && task.status !== "failed";
  const active = STATUS_META[task.status].active;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.objective);
  const [busy, setBusy] = useState(false);
  const [refining, setRefining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  // Refine the user's prompt (clarity only, same intent) and drop it into the
  // editor for review — the user still decides whether to Save & re-analyze.
  async function refine() {
    setRefining(true);
    setError(null);
    try {
      const res = await fetch(`/api/refine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objective: editing ? draft : task.objective }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok && data.refined) {
        setDraft(data.refined);
        setEditing(true);
      } else {
        setError(data?.error || "Couldn't refine the prompt right now.");
      }
    } catch {
      setError("Couldn't reach the server to refine — your prompt is unchanged.");
    } finally {
      setRefining(false);
    }
  }

  async function saveEdit() {
    const next = draft.trim();
    if (next.length < 4) {
      setError("Please enter at least a few words.");
      return;
    }
    if (next === task.objective.trim()) {
      setEditing(false);
      setError(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${task.id}/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objective: next }),
      });
      if (res.ok) {
        setEditing(false);
        onEdited(); // re-open the stream → re-analyze the new prompt
      } else {
        const d = await res.json().catch(() => null);
        setError(d?.error || `Couldn't update the prompt (HTTP ${res.status}). Nothing was changed.`);
      }
    } catch {
      setError("Couldn't reach the server, so your prompt was NOT changed. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function doCancel() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${task.id}/cancel`, { method: "POST" });
      if (res.ok) {
        router.push("/"); // progress erased — back to a clean slate
        return;
      }
      const d = await res.json().catch(() => null);
      setError(d?.error || `Couldn't cancel (HTTP ${res.status}). Your progress is unchanged.`);
      setConfirmCancel(false);
      setBusy(false);
    } catch {
      setError("Couldn't reach the server, so nothing was changed. Check your connection and try again.");
      setConfirmCancel(false);
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <div className="fade-up">
        <div className="eyebrow mb-2">Edit objective</div>
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          disabled={busy}
          className="w-full rounded-lg border bg-[var(--color-surface)] p-3 text-[16px] sm:text-[17px] leading-snug outline-none focus:border-[var(--color-accent)]"
          style={{ maxWidth: 780 }}
          placeholder="Describe what you want done…"
        />
        <div className="mt-3 flex items-center gap-2">
          <button className="btn btn-accent btn-shine text-[13px] !py-2" disabled={busy || refining} onClick={saveEdit}>
            {busy ? "Saving…" : "Save & re-analyze"}
          </button>
          <button className="btn text-[13px] !py-2 gap-1.5" disabled={busy || refining} onClick={refine} title="Let Volo rewrite your prompt more clearly (same intent)">
            {refining ? <Spinner /> : <SparkleIcon />}
            {refining ? "Refining…" : "Refine"}
          </button>
          <button
            className="btn btn-ghost text-[13px] !py-2"
            disabled={busy || refining}
            onClick={() => {
              setEditing(false);
              setDraft(task.objective);
              setError(null);
            }}
          >
            Cancel
          </button>
        </div>
        {error && (
          <p className="mt-2 text-[12.5px]" style={{ color: "var(--color-err)" }} role="alert">
            {error}
          </p>
        )}
        <p className="mt-2 text-[12px] text-[var(--color-muted)]">
          Saving replaces the prompt and re-analyzes from scratch — the current progress is cleared.
        </p>
      </div>
    );
  }

  return (
    <div className="fade-up">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="eyebrow">Objective</div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={refine}
            disabled={refining}
            className="btn-magic inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1 rounded-md transition-all"
            title="Refine your prompt — Volo rewrites it more clearly (same intent)"
            aria-label="Refine prompt"
          >
            <span className="star">{refining ? <Spinner light /> : <SparkleIcon />}</span>
            {refining ? "Refining…" : "Refine"}
          </button>
          <button
            onClick={() => {
              setDraft(task.objective);
              setError(null);
              setEditing(true);
            }}
            className="inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1 rounded-md border text-[var(--color-ink-soft)] bg-[var(--color-surface)] hover:border-[var(--color-accent)] transition-colors"
            title="Edit the prompt and re-analyze"
            aria-label="Edit prompt"
          >
            <PencilIcon />
            Edit
          </button>
          {cancellable && (
            <button
              onClick={() => {
                setError(null);
                setConfirmCancel(true);
              }}
              className="inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1 rounded-md border transition-colors"
              style={{ color: "var(--color-err)", borderColor: "color-mix(in srgb, var(--color-err) 35%, transparent)" }}
              title="Cancel the analysis and erase its progress"
              aria-label="Cancel analysis"
            >
              Cancel{active ? " analysis" : ""}
            </button>
          )}
        </div>
      </div>

      <h1 className="text-[22px] sm:text-[26px] font-[640] tracking-[-0.02em] leading-tight" style={{ maxWidth: 780 }}>
        {task.objective}
      </h1>

      {error && (
        <p className="mt-2 text-[12.5px]" style={{ color: "var(--color-err)" }} role="alert">
          {error}
        </p>
      )}

      {confirmCancel && (
        <ConfirmDialog
          busy={busy}
          onConfirm={doCancel}
          onClose={() => setConfirmCancel(false)}
        />
      )}
    </div>
  );
}

function ConfirmDialog({ busy, onConfirm, onClose }: { busy: boolean; onConfirm: () => void; onClose: () => void }) {
  // Rendered in a portal so it's centered against the VIEWPORT, never trapped by
  // any transformed/positioned ancestor.
  return createPortal(
    <div
      className="fixed inset-0 z-[60] grid place-items-center p-4"
      role="dialog"
      aria-modal="true"
      onClick={busy ? undefined : onClose}
    >
      {/* Full-screen wash: over 2.5s the whole page blurs + darkens to a near-
          black mesh-blue at ~70%, so only a ghost of the background remains. */}
      <div className="cancel-veil" aria-hidden />

      {/* The confirmation, dead-center on top of the wash. */}
      <div
        className="cancel-dialog glass glass-hi relative z-[1] w-full max-w-md p-7 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <span
          className="mx-auto mb-3 inline-flex items-center justify-center rounded-full"
          style={{ width: 46, height: 46, background: "color-mix(in srgb, var(--color-err) 20%, transparent)", color: "var(--color-err)", boxShadow: "0 0 0 6px color-mix(in srgb, var(--color-err) 9%, transparent)" }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
          </svg>
        </span>
        <h3 className="text-[19px] font-[680] font-display" style={{ color: "var(--color-ink)" }}>Cancel this analysis?</h3>
        <p className="mt-2 text-[13.5px] text-[var(--color-ink-soft)] leading-relaxed">
          This stops the analysis and <strong>permanently erases all progress</strong> for this objective — the plan,
          timeline, sources, and any results. This can&apos;t be undone.
        </p>
        <div className="mt-6 flex items-center justify-center gap-2.5">
          <button className="btn btn-ghost text-[13px] !py-2.5 !px-5" disabled={busy} onClick={onClose}>
            Keep it
          </button>
          <button
            className="btn btn-shine text-[13px] !py-2.5 !px-5"
            style={{ background: "var(--color-err)", color: "#fff" }}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "Cancelling…" : "Yes, cancel & erase"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function PencilIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

export function SparkleIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2.5l1.7 4.6 4.6 1.7-4.6 1.7L12 15.1l-1.7-4.6L5.7 8.8l4.6-1.7L12 2.5Z" />
      <path d="M18.5 14l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9.9-2.4Z" />
      <path d="M5 13l.7 1.8L7.5 15.5l-1.8.7L5 18l-.7-1.8L2.5 15.5l1.8-.7L5 13Z" />
    </svg>
  );
}

function Spinner({ light }: { light?: boolean }) {
  return (
    <span
      className="spin"
      style={{ width: 12, height: 12, borderRadius: 999, border: `2px solid ${light ? "rgba(255,210,63,0.35)" : "var(--color-line-strong)"}`, borderTopColor: light ? "#ffd23f" : "var(--color-accent)", display: "inline-block" }}
    />
  );
}
