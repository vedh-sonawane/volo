"use client";

import { useState } from "react";
import type { ApprovalRequest, Task } from "@/lib/types";

interface Outcome {
  performed: boolean;
  message: string;
  artifact?: { eml?: string; to?: string; subject?: string; steps?: string[]; target?: string };
}

export function Approvals({ task }: { task: Task }) {
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
          <ApprovalCard key={a.id} approval={a} taskId={task.id} />
        ))}
        {decided.map((a) => (
          <ApprovalCard key={a.id} approval={a} taskId={task.id} />
        ))}
      </div>
    </section>
  );
}

function ApprovalCard({ approval, taskId }: { approval: ApprovalRequest; taskId: string }) {
  const [status, setStatus] = useState(approval.status);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  async function decide(decision: "approved" | "rejected") {
    setBusy(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalId: approval.id, decision }),
      });
      const data = await res.json();
      if (res.ok) {
        setStatus(decision);
        setOutcome(data.outcome);
      }
    } finally {
      setBusy(false);
    }
  }

  function downloadEml() {
    if (!outcome?.artifact?.eml) return;
    const blob = new Blob([outcome.artifact.eml], { type: "message/rfc822" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "volo-draft.eml";
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

      {status === "pending" ? (
        <div className="mt-4 flex items-center gap-2">
          <button className="btn btn-accent text-[13px] !py-2" disabled={busy} onClick={() => decide("approved")}>
            {busy ? "Working…" : "Approve"}
          </button>
          <button className="btn btn-ghost text-[13px] !py-2" disabled={busy} onClick={() => decide("rejected")}>
            Decline
          </button>
        </div>
      ) : null}

      {outcome && (
        <div className="mt-3 border-t pt-3 fade-up">
          <div className="text-[12.5px] leading-relaxed" style={{ color: outcome.performed ? "var(--color-ok)" : "var(--color-warn)" }}>
            {outcome.message}
          </div>
          {outcome.artifact?.eml && (
            <div className="mt-2">
              <button className="btn btn-ghost text-[12.5px] !py-1.5" onClick={downloadEml}>
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
