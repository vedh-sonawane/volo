"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

interface ScopeGroup { key: string; label: string; can: string; granted: boolean }
interface Integration {
  id: string;
  label: string;
  configured: boolean;
  connected: boolean;
  email?: string;
  grantedScopes: string[];
  connectedAt?: number;
  lastUsed?: number;
  scopeGroups: ScopeGroup[];
}

export function IntegrationsPanel() {
  const params = useSearchParams();
  const [list, setList] = useState<Integration[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/integrations", { cache: "no-store" });
    if (res.ok) setList((await res.json()).integrations);
  }, []);
  useEffect(() => { load(); }, [load]);

  const connectedNote = params.get("integration_connected");
  const errorNote = params.get("integration_error");
  const errorDetail = params.get("integration_detail");

  async function disconnect(provider: string) {
    setBusy(provider);
    try {
      await fetch("/api/integrations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "disconnect", provider }) });
      await load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card p-5">
      <h3 className="text-[14px] font-[640]">Integrations</h3>
      <p className="mt-1 text-[12.5px] text-[var(--color-muted)] leading-snug">
        Connect services so Volo can act through them — always with your approval. Tokens are encrypted on this machine
        and never shown to the browser or the AI. Volo never claims a service is connected without a real authorization.
      </p>

      {connectedNote && <Banner ok>Connected {connectedNote}. Volo now knows this capability is available.</Banner>}
      {errorNote && (
        <Banner>
          {errorMessage(errorNote, params.get("provider"))}
          {errorDetail && (
            <span className="block mt-1 font-[var(--font-mono)] text-[11.5px] opacity-90">Provider said: {errorDetail}</span>
          )}
        </Banner>
      )}

      <div className="mt-4 flex flex-col gap-3">
        {list === null ? (
          <div className="skeleton h-16 w-full" />
        ) : (
          list.map((it) => <ProviderRow key={it.id} it={it} busy={busy === it.id} onDisconnect={() => disconnect(it.id)} />)
        )}
      </div>
    </section>
  );
}

function ProviderRow({ it, busy, onDisconnect }: { it: Integration; busy: boolean; onDisconnect: () => void }) {
  return (
    <div className="border rounded-xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-[620]">{it.label}</span>
            {it.connected ? (
              <Chip color="var(--color-ok)">✓ Connected</Chip>
            ) : it.configured ? (
              <Chip color="var(--color-faint)">Not connected</Chip>
            ) : (
              <Chip color="var(--color-warn)">OAuth not configured</Chip>
            )}
          </div>
          {it.connected && it.email && <div className="text-[12px] text-[var(--color-muted)] mt-0.5">{it.email}</div>}
        </div>
        {it.connected && (
          <button className="btn btn-ghost text-[12.5px] !py-1.5" disabled={busy} onClick={onDisconnect}>{busy ? "…" : "Disconnect"}</button>
        )}
      </div>

      {!it.configured ? (
        <p className="mt-2 text-[12px] text-[var(--color-faint)]">
          The {it.label} OAuth app isn’t configured on this deployment yet. Add its client ID/secret to enable connecting
          (see the setup guide) — until then Volo won’t pretend it’s available.
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {it.scopeGroups.map((g) => {
            const granted = g.granted; // authoritative, computed server-side from real scopes
            return (
              <div key={g.key} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[13px] font-[550]">{g.label}</div>
                  <div className="text-[12px] text-[var(--color-muted)] truncate">{g.can}</div>
                </div>
                {granted ? (
                  <span className="text-[12px] text-[var(--color-ok)] shrink-0">✓ granted</span>
                ) : (
                  <a className="btn btn-ghost text-[12.5px] !py-1.5 shrink-0" href={`/api/auth/oauth/${it.id}/start?mode=connect&group=${g.key}&next=/settings`}>Connect</a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Chip({ children, color }: { children: React.ReactNode; color: string }) {
  return <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ color, background: `color-mix(in srgb, ${color} 12%, transparent)` }}>{children}</span>;
}
function Banner({ children, ok }: { children: React.ReactNode; ok?: boolean }) {
  const color = ok ? "var(--color-ok)" : "var(--color-err)";
  return <div className="mt-3 text-[12.5px] p-2.5 rounded-lg fade-up" style={{ color, background: `color-mix(in srgb, ${color} 10%, transparent)` }}>{children}</div>;
}
function errorMessage(code: string, provider?: string | null): string {
  switch (code) {
    case "not_configured": return `The ${provider || "provider"} OAuth app isn’t configured on this deployment yet. Add its client ID/secret and restart.`;
    case "invalid_state": return "That connection attempt expired or failed a security check — please try again.";
    case "no_code": return "The provider didn’t return an authorization code. Please try again.";
    case "token_exchange_failed": return "The provider rejected the token exchange — the exact reason is shown below.";
    case "userinfo_failed": return "Signed in, but couldn’t read your profile from the provider — reason below.";
    case "storage_failed": return "The connection was authorized but couldn’t be saved locally — reason below.";
    case "not_signed_in": return "Please sign in first, then connect the integration.";
    case "access_denied": return "Connection cancelled — you didn’t grant access.";
    case "redirect_uri_mismatch": return "The redirect URI doesn’t match the one registered with the provider. Register the exact callback URL, then retry.";
    case "invalid_client": return "The provider rejected the app credentials (client id/secret). Check them and restart.";
    case "invalid_grant": return "The authorization code was invalid or already used — start the connection again.";
    default: return `Connection failed (${code}).`;
  }
}
