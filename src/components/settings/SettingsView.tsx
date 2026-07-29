"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Wordmark } from "@/components/Wordmark";
import { ThemeToggle } from "@/components/ThemeToggle";
import { CapabilityPanel, useCapabilities } from "./Capabilities";
import { IntegrationsPanel } from "./IntegrationsPanel";

interface SettingsData {
  config: Record<string, string>;
  secrets: Record<string, { set: boolean; mask: string }>;
}
type TestState = { ok?: boolean; error?: string; busy?: boolean };

export function SettingsView() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [pass, setPass] = useState(""); // new SMTP password (blank = keep existing)
  const [stripeKey, setStripeKey] = useState(""); // new Stripe TEST key (blank = keep existing)
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const { caps, checking, reload } = useCapabilities();

  const load = useCallback(async () => {
    const res = await fetch("/api/settings", { cache: "no-store" });
    const d: SettingsData = await res.json();
    setData(d);
    setForm(d.config);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  function set(k: string, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
    setSaved(false);
  }

  async function save() {
    setBusy(true);
    try {
      const secrets: Record<string, string> = {};
      if (pass) secrets.SMTP_PASS = pass; // only send when changed
      if (stripeKey) secrets.STRIPE_SECRET_KEY = stripeKey.trim();
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: form, secrets }),
      });
      setPass("");
      setStripeKey("");
      setSaved(true);
      await load();
      await reload(false);
    } finally {
      setBusy(false);
    }
  }

  async function test(provider: string) {
    setTests((t) => ({ ...t, [provider]: { busy: true } }));
    await save(); // test the just-saved config
    const res = await fetch("/api/settings/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider }) });
    const r = await res.json();
    setTests((t) => ({ ...t, [provider]: { ok: r.ok, error: r.error } }));
    await reload(true);
  }

  if (!data) return <div className="min-h-screen flex items-center justify-center text-[var(--color-muted)]">Loading settings…</div>;

  const smtpSet = data.secrets.SMTP_PASS?.set;
  const stripeSet = data.secrets.STRIPE_SECRET_KEY?.set;

  return (
    <main className="min-h-screen">
      <header className="sticky top-0 z-20 border-b glass" style={{ borderRadius: 0 }}>
        <div className="max-w-3xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2"><Wordmark size={20} /></Link>
          <div className="flex items-center gap-3">
            <span className="text-[12.5px] text-[var(--color-faint)]">Settings</span>
            <span className="w-px h-5" style={{ background: "var(--color-line)" }} />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-6 pb-24 flex flex-col gap-6">
        <div>
          <h1 className="text-[24px] font-[660] tracking-[-0.02em]">Configure Volo</h1>
          <p className="mt-1 text-[14px] text-[var(--color-muted)]">Set everything here — no files to edit. Secrets are encrypted on this machine and never sent to the browser or the AI model.</p>
        </div>

        <CapabilityPanel caps={caps} checking={checking} onRecheck={() => reload(true)} />

        <IntegrationsPanel />

        {/* AI / model */}
        <Card title="AI planning" note="Optional. Without it, Volo uses a fast deterministic engine (no AI). Connect Ollama for dynamic planning + clarifying questions.">
          <Select label="Model provider" value={form.MODEL_PROVIDER || "rule"} onChange={(v) => set("MODEL_PROVIDER", v)} options={[["rule", "Deterministic engine (no AI)"], ["ollama", "Local Ollama"]]} />
          {form.MODEL_PROVIDER === "ollama" && (
            <>
              <Text label="Ollama URL" value={form.OLLAMA_BASE_URL || ""} placeholder="http://127.0.0.1:11434" onChange={(v) => set("OLLAMA_BASE_URL", v)} />
              <Text label="Model name" value={form.OLLAMA_MODEL || ""} placeholder="llama3" onChange={(v) => set("OLLAMA_MODEL", v)} />
              <TestRow label="Test Ollama" state={tests.ollama} onTest={() => test("ollama")} />
            </>
          )}
        </Card>

        {/* Email */}
        <Card title="Email sending" note="Connect your own email account to send approved emails for real. Leave blank and Volo prepares a draft (.eml) you send yourself — it never sends silently.">
          <Text label="SMTP host" value={form.SMTP_HOST || ""} placeholder="smtp.gmail.com" onChange={(v) => set("SMTP_HOST", v)} />
          <Text label="SMTP user" value={form.SMTP_USER || ""} placeholder="you@gmail.com" onChange={(v) => set("SMTP_USER", v)} />
          <div>
            <label className="text-[12.5px] font-[550] text-[var(--color-ink-soft)]">Password / app password {smtpSet && <span className="text-[var(--color-ok)]">· saved</span>}</label>
            <input type="password" className="field !text-[14px] !py-2.5 !rounded-lg mt-1" value={pass} placeholder={smtpSet ? "•••••••• (leave blank to keep)" : "app password"} onChange={(e) => { setPass(e.target.value); setSaved(false); }} />
            <p className="text-[11px] text-[var(--color-faint)] mt-1">Stored encrypted on this machine (AES-256). Never shown again, never sent to the browser or AI.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Text label="Port" value={form.SMTP_PORT || ""} placeholder="587" onChange={(v) => set("SMTP_PORT", v)} />
            <Text label="From (optional)" value={form.SMTP_FROM || ""} placeholder="you@gmail.com" onChange={(v) => set("SMTP_FROM", v)} />
          </div>
          <TestRow label="Test connection (no email sent)" state={tests.email} onTest={() => test("email")} />
        </Card>

        {/* Research */}
        <Card title="Web research" note="How Volo searches the web.">
          <Select label="Research provider" value={form.RESEARCH_PROVIDER || "duckduckgo"} onChange={(v) => set("RESEARCH_PROVIDER", v)} options={[["duckduckgo", "DuckDuckGo (live web, free)"], ["mock", "Mock fixtures (offline test data)"]]} />
          <Text label="Max pages per task" value={form.RESEARCH_MAX_FETCHES || ""} placeholder="6" onChange={(v) => set("RESEARCH_MAX_FETCHES", v)} />
          <TestRow label="Test research" state={tests.research} onTest={() => test("research")} />
        </Card>

        {/* Action mode */}
        <Card title="Action execution mode" note="How consequential actions (booking, forms, payments) behave. In production they honestly report ‘unsupported’ until a real integration exists — Volo never fakes a booking or charge.">
          <Select label="Mode" value={form.ACTION_MODE || ""} onChange={(v) => set("ACTION_MODE", v)} options={[["", "Production (real where connected, else unsupported)"], ["sandbox", "Sandbox (simulate actions for testing — no real effect)"]]} />
          {form.ACTION_MODE === "sandbox" && (
            <div className="text-[12px] p-3 rounded-lg" style={{ background: "color-mix(in srgb, var(--color-warn) 10%, transparent)", color: "var(--color-warn)" }}>
              Sandbox is on: bookings/forms/payments are simulated with fake confirmations. No real money moves. Turn this off for real use.
            </div>
          )}
        </Card>

        {/* Payments — Stripe test mode */}
        <Card title="Payments (Stripe test mode)" note="Stripe Test Mode is 100% free — the real Stripe API with a test key and test cards. Volo creates a real PaymentIntent with a test card so payments actually work end-to-end, but NO real money ever moves. Only a test key (sk_test_…) is accepted; a live key is refused.">
          <div>
            <label className="text-[12.5px] font-[550] text-[var(--color-ink-soft)]">Stripe secret key (test) {stripeSet && <span className="text-[var(--color-ok)]">· saved</span>}</label>
            <input
              type="password"
              className="field !text-[14px] !py-2.5 !rounded-lg mt-1"
              value={stripeKey}
              placeholder={stripeSet ? "•••••••• (leave blank to keep)" : "sk_test_…"}
              onChange={(e) => { setStripeKey(e.target.value); setSaved(false); }}
            />
            <p className="text-[11px] text-[var(--color-faint)] mt-1">Stored encrypted on this machine (AES-256). Never shown again, never sent to the browser or AI. Volo never handles raw card data — it uses Stripe’s own test cards.</p>
          </div>
          <TestRow label="Test Stripe key (no charge)" state={tests.stripe} onTest={() => test("stripe")} />
          <div className="text-[12px] p-3 rounded-lg" style={{ background: "color-mix(in srgb, var(--color-ok) 10%, transparent)", color: "var(--color-ok)" }}>
            Get a free test key at dashboard.stripe.com → Developers → API keys (Test mode). It starts with <span className="font-[var(--font-mono)]">sk_test_</span>. Every payment is still approval-gated and clearly labelled TEST.
          </div>
        </Card>

        {/* Security note */}
        <Card title="Security & privacy" note="">
          <ul className="text-[12.5px] text-[var(--color-muted)] flex flex-col gap-1.5">
            <li>• Secrets are encrypted at rest on this machine; the AI model and the browser never receive them.</li>
            <li>• Volo never stores card numbers, CVVs, bank passwords, or one-time codes — anywhere.</li>
            <li>• Payments use Stripe TEST mode only (sk_test_…); a live key is refused so real money can never move.</li>
            <li>• This build is a single-user local app: there is no login yet, so anyone with access to this machine can use it. Multi-user accounts + per-user encrypted secrets are a documented next step, not yet built.</li>
          </ul>
        </Card>

        <div className="sticky bottom-4 flex items-center gap-3">
          <button className="btn btn-accent" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save settings"}</button>
          {saved && <span className="text-[13px] text-[var(--color-ok)] fade-up">Saved ✓ (applies immediately)</span>}
        </div>
      </div>
    </main>
  );
}

function Card({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <h3 className="text-[14px] font-[640]">{title}</h3>
      {note && <p className="mt-1 text-[12.5px] text-[var(--color-muted)] leading-snug">{note}</p>}
      <div className="mt-4 flex flex-col gap-3">{children}</div>
    </section>
  );
}
function Text({ label, value, placeholder, onChange }: { label: string; value: string; placeholder?: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-[12.5px] font-[550] text-[var(--color-ink-soft)]">{label}</label>
      <input className="field !text-[14px] !py-2.5 !rounded-lg mt-1" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div>
      <label className="text-[12.5px] font-[550] text-[var(--color-ink-soft)]">{label}</label>
      <select className="field !text-[14px] !py-2.5 !rounded-lg mt-1" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
    </div>
  );
}
function TestRow({ label, state, onTest }: { label: string; state?: TestState; onTest: () => void }) {
  return (
    <div className="flex items-center gap-3">
      <button className="btn btn-ghost text-[12.5px] !py-1.5" onClick={onTest} disabled={state?.busy}>{state?.busy ? "Testing…" : label}</button>
      {state && !state.busy && state.ok === true && <span className="text-[12.5px] text-[var(--color-ok)]">✓ works</span>}
      {state && !state.busy && state.ok === false && <span className="text-[12.5px] text-[var(--color-err)]">✗ {state.error}</span>}
    </div>
  );
}
