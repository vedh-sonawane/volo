"use client";

import { useState } from "react";
import type { ApprovalRequest, Task } from "@/lib/types";
import { SparkleIcon } from "./ObjectivePanel";

function RefineSpinner() {
  return (
    <span
      className="spin"
      style={{ width: 12, height: 12, borderRadius: 999, border: "2px solid rgba(255,210,63,0.35)", borderTopColor: "#ffd23f", display: "inline-block" }}
    />
  );
}

interface Outcome {
  performed: boolean;
  status?: "succeeded" | "failed" | "unsupported" | "uncertain" | "requires_user" | "duplicate" | "rejected";
  message: string;
  confirmation?: string;
  artifact?: {
    eml?: string;
    steps?: string[];
    ics?: string;
    filename?: string;
  };
}

const OUTCOME_COLOR: Record<string, string> = {
  succeeded: "var(--color-ok)",
  duplicate: "var(--color-ok)",
  failed: "var(--color-err)",
  uncertain: "var(--color-warn)",
  requires_user: "var(--color-warn)",
  unsupported: "var(--color-warn)",
  rejected: "var(--color-muted)",
};

export function Approvals({ task, onDecided }: { task: Task; onDecided?: () => void }) {
  const pending = task.approvals.filter((a) => a.status === "pending");
  const decided = task.approvals.filter((a) => a.status !== "pending");
  if (task.approvals.length === 0) return null;

  return (
    <section className="card p-5" style={{ borderColor: "var(--color-warn)", borderWidth: 1 }}>
      <div className="flex items-center gap-2">
        <span className="dot" style={{ background: "var(--color-warn)", width: 9, height: 9 }} />
        <h3 className="text-[13px] font-[650]">Actions requiring your approval</h3>
      </div>
      <p className="mt-1.5 text-[12.5px] text-[var(--color-muted)] leading-relaxed">
        Volo prepared these, but will not send, submit, book, or buy anything without your explicit go-ahead.
      </p>
      <div className="mt-4 flex flex-col gap-3">
        {pending.map((a) => (
          <ApprovalCard key={a.id} approval={a} taskId={task.id} onDecided={onDecided} canRefine={a.tool === "send_email" && task.directAction?.capability === "send_email"} />
        ))}
        {decided.map((a) => (
          <ApprovalCard key={a.id} approval={a} taskId={task.id} onDecided={onDecided} canRefine={false} />
        ))}
      </div>
    </section>
  );
}

function ApprovalCard({ approval, taskId, onDecided, canRefine }: { approval: ApprovalRequest; taskId: string; onDecided?: () => void; canRefine?: boolean }) {
  const [status, setStatus] = useState(approval.status);
  const [busy, setBusy] = useState(false);
  const [refining, setRefining] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Polish the pending email's subject + body (recipient never changes).
  async function refineDraft() {
    setRefining(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}/refine-draft`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        onDecided?.(); // re-sync so the polished preview shows
      } else {
        setError(data?.error || "Couldn't refine the draft right now.");
      }
    } catch {
      setError("Couldn't reach the server to refine — the draft is unchanged.");
    } finally {
      setRefining(false);
    }
  }

  async function decide(decision: "approved" | "rejected") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalId: approval.id, decision }),
      });
      // The response may not be JSON if the server errored badly — read defensively.
      let data: { outcome?: Outcome; error?: string } | null = null;
      try {
        data = await res.json();
      } catch {
        /* non-JSON error body */
      }
      if (res.ok) {
        setStatus(decision);
        setOutcome(data?.outcome ?? null);
        // Let the workspace re-sync — the objective may now be waiting for a
        // reply (Phase 9) or completed.
        setTimeout(() => onDecided?.(), 400);
      } else if (res.status === 409) {
        // Already decided elsewhere (e.g. another tab) — re-sync to show truth
        // rather than leaving a stale pending card.
        setTimeout(() => onDecided?.(), 100);
        setError(data?.error || "This action was already decided. Refreshing…");
      } else {
        // Server responded with an error — keep the approval PENDING so the user
        // can retry, and show an honest message (nothing was executed).
        setError(data?.error || `The server couldn't process this (HTTP ${res.status}). The approval is still pending — please try again.`);
      }
    } catch {
      // Network failure / server unreachable — the request never completed, so the
      // approval is unchanged and still pending. Never crash the UI; report honestly.
      setError("Couldn't reach the server, so nothing was changed. Your approval is still pending — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function download(content: string, filename: string, mime: string) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="border rounded-lg p-4 bg-[var(--color-paper)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[14px] font-[600]">{approval.title}</div>
          <div className="text-[12px] font-[var(--font-mono)] text-[var(--color-faint)] mt-0.5">tool: {approval.tool} · requires approval</div>
        </div>
        <StatusPill status={status} />
      </div>

      <dl className="mt-3 grid grid-cols-[92px_1fr] gap-y-1.5 gap-x-3 text-[13px]">
        <Field k="What happens" v={approval.description} />
        {approval.target && <Field k="Target" v={approval.target} mono />}
        <Field k="Data sent" v={approval.payloadPreview} />
        {approval.commitment && <Field k="Commitment" v={approval.commitment} warn />}
      </dl>

      {approval.financial && (
        <div className="mt-3 border rounded-lg p-3" style={{ borderColor: "var(--color-err)", background: "color-mix(in srgb, var(--color-err) 5%, transparent)" }}>
          <div className="eyebrow mb-1.5" style={{ color: "var(--color-err)" }}>Financial commitment — confirm the exact charge</div>
          <div className="text-[15px] font-[700]">{approval.financial.currency} {approval.financial.total.toLocaleString()}</div>
          <div className="text-[12px] text-[var(--color-muted)] mt-0.5">
            {approval.financial.fees != null && <span>fees {approval.financial.currency} {approval.financial.fees} · </span>}
            {approval.financial.taxes != null && <span>taxes {approval.financial.currency} {approval.financial.taxes} · </span>}
            {approval.financial.account && <span>via {approval.financial.account} · </span>}
            {approval.financial.refundPolicy || "refund policy not stated"}
          </div>
          <div className="text-[11px] text-[var(--color-faint)] mt-1.5">Approving confirms this specific charge. Volo never stores card details; any provider authentication happens in the provider&apos;s secure flow.</div>
        </div>
      )}

      {status === "pending" ? (
        <div className="mt-4">
          <div className="flex items-center gap-2 flex-wrap">
            <button className="btn btn-accent btn-rainbow text-[13px] !py-2" disabled={busy || refining} onClick={() => decide("approved")}>
              {busy ? "Working…" : approval.financial ? `Confirm & pay ${approval.financial.currency} ${approval.financial.total}` : "Approve"}
            </button>
            <button className="btn btn-ghost text-[13px] !py-2" disabled={busy || refining} onClick={() => decide("rejected")}>
              Decline
            </button>
            {canRefine && (
              <button
                className="btn btn-magic text-[13px] !py-2 gap-1.5 ml-auto"
                disabled={busy || refining}
                onClick={refineDraft}
                title="Polish the subject + body (your recipient never changes)"
                aria-label="Refine email draft"
              >
                <span className="star">{refining ? <RefineSpinner /> : <SparkleIcon />}</span>
                {refining ? "Polishing…" : "Refine draft"}
              </button>
            )}
          </div>
          {error && (
            <div className="mt-2.5 text-[12.5px] leading-relaxed flex items-start gap-1.5" style={{ color: "var(--color-err)" }} role="alert">
              <span>⚠</span>
              <span>{error}</span>
            </div>
          )}
        </div>
      ) : null}

      {outcome && (
        <div className="mt-3 border-t pt-3 fade-up">
          <div className="text-[12.5px] leading-relaxed flex items-start gap-1.5" style={{ color: OUTCOME_COLOR[outcome.status || (outcome.performed ? "succeeded" : "unsupported")] || "var(--color-warn)" }}>
            <span>{outcome.performed ? "✓" : outcome.status === "failed" ? "✗" : "•"}</span>
            <span>{outcome.message}</span>
          </div>
          {outcome.confirmation && outcome.performed && (
            <div className="mt-1 text-[11.5px] text-[var(--color-faint)] font-[var(--font-mono)]">confirmation: {outcome.confirmation}</div>
          )}
          {outcome.artifact?.ics && (
            <div className="mt-2">
              <button
                className="btn btn-ghost text-[12.5px] !py-1.5"
                onClick={() => download(outcome.artifact!.ics!, outcome.artifact!.filename || "volo-event.ics", "text/calendar")}
              >
                ↓ Download calendar file (.ics)
              </button>
            </div>
          )}
          {outcome.artifact?.eml && (
            <div className="mt-2">
              <button className="btn btn-ghost text-[12.5px] !py-1.5" onClick={() => download(outcome.artifact!.eml!, "volo-draft.eml", "message/rfc822")}>
                ↓ Download draft (.eml)
              </button>
              <pre className="mt-2 text-[11.5px] whitespace-pre-wrap font-[var(--font-mono)] text-[var(--color-muted)] bg-[var(--color-surface)] border rounded-lg p-3 max-h-48 overflow-auto">
                {outcome.artifact.eml}
              </pre>
            </div>
          )}
          {outcome.artifact?.steps && (
            <ol className="mt-2 flex flex-col gap-1.5 text-[12.5px] text-[var(--color-ink-soft)]">
              {outcome.artifact.steps.map((s, i) => (
                <li key={i} className="flex gap-2">
                  <span className="font-[var(--font-mono)] text-[var(--color-faint)]">{i + 1}.</span>
                  {s}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ k, v, mono, warn }: { k: string; v: string; mono?: boolean; warn?: boolean }) {
  return (
    <>
      <dt className="text-[var(--color-faint)] text-[12px]">{k}</dt>
      <dd
        className={mono ? "font-[var(--font-mono)] text-[12px] break-words" : "break-words"}
        style={{ color: warn ? "var(--color-warn)" : "var(--color-ink-soft)" }}
      >
        {v}
      </dd>
    </>
  );
}

function StatusPill({ status }: { status: ApprovalRequest["status"] }) {
  const map = {
    pending: { c: "var(--color-warn)", t: "Pending" },
    approved: { c: "var(--color-ok)", t: "Approved" },
    rejected: { c: "var(--color-muted)", t: "Declined" },
  }[status];
  return (
    <span className="text-[11px] px-2.5 py-1 rounded-full whitespace-nowrap" style={{ color: map.c, background: `color-mix(in srgb, ${map.c} 12%, transparent)` }}>
      {map.t}
    </span>
  );
}
