"use client";

import { useCallback, useEffect, useState } from "react";

export interface Capability {
  key: string;
  label: string;
  status: string;
  detail: string;
  verified?: boolean;
}

const STATUS_META: Record<string, { text: string; color: string }> = {
  connected: { text: "Connected & executable", color: "var(--color-ok)" },
  sandbox_only: { text: "Sandbox only", color: "var(--color-warn)" },
  draft_export_only: { text: "Draft / export only", color: "var(--color-accent-ink)" },
  requires_user: { text: "Needs your action", color: "var(--color-warn)" },
  not_configured: { text: "Not configured", color: "var(--color-faint)" },
  unsupported: { text: "Unsupported", color: "var(--color-muted)" },
  connection_failed: { text: "Connection failed", color: "var(--color-err)" },
  unavailable: { text: "Temporarily unavailable", color: "var(--color-warn)" },
};

export function useCapabilities() {
  const [caps, setCaps] = useState<Capability[] | null>(null);
  const [checking, setChecking] = useState(false);
  const load = useCallback(async (deep = false) => {
    if (deep) setChecking(true);
    try {
      const res = await fetch(`/api/capabilities${deep ? "?deep=1" : ""}`, { cache: "no-store" });
      const data = await res.json();
      setCaps(data.capabilities ?? []);
    } finally {
      setChecking(false);
    }
  }, []);
  useEffect(() => {
    load(false);
  }, [load]);
  return { caps, checking, reload: load };
}

export function CapabilityPanel({ caps, checking, onRecheck }: { caps: Capability[] | null; checking: boolean; onRecheck: () => void }) {
  return (
    <section className="card p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-[650]">What Volo can actually do right now</h3>
        <button className="btn btn-ghost text-[12px] !py-1.5" onClick={onRecheck} disabled={checking}>
          {checking ? "Checking…" : "Re-check (live)"}
        </button>
      </div>
      <p className="mt-1 text-[12px] text-[var(--color-muted)]">Honest, verified status — a test/sandbox capability is never shown as a real one.</p>
      <div className="mt-3 flex flex-col divide-y">
        {(caps ?? []).map((c) => {
          const m = STATUS_META[c.status] || { text: c.status, color: "var(--color-muted)" };
          return (
            <div key={c.key} className="py-2.5 flex items-start gap-3">
              <span className="dot mt-1.5" style={{ background: m.color, width: 8, height: 8 }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] font-[550]">{c.label}</span>
                  <span className="text-[11px] px-1.5 py-0.5 rounded-full" style={{ color: m.color, background: `color-mix(in srgb, ${m.color} 12%, transparent)` }}>
                    {m.text}
                  </span>
                  {c.verified && <span className="text-[10px] text-[var(--color-faint)]">✓ live-checked</span>}
                </div>
                <div className="text-[12px] text-[var(--color-muted)] mt-0.5 leading-snug">{c.detail}</div>
              </div>
            </div>
          );
        })}
        {caps === null && <div className="py-3 text-[13px] text-[var(--color-faint)]">Loading capabilities…</div>}
      </div>
    </section>
  );
}
