"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Wordmark } from "@/components/Wordmark";
import { ThemeToggle } from "@/components/ThemeToggle";

type Multi = string[];

const USE_CASES = ["Personal productivity", "Research & learning", "Work tasks", "Business operations", "Scheduling & planning", "Shopping & comparisons"];
const STYLES = ["Concise & direct", "Detailed explanations", "Step-by-step guidance", "Professional", "Casual"];
const CONTROL = [
  { key: "suggest", title: "Suggest only", desc: "Research and recommend — never acts." },
  { key: "prepare", title: "Prepare actions", desc: "Drafts and plans, always asks before executing.", recommended: true },
  { key: "assisted", title: "Assisted execution", desc: "Executes actions you've approved." },
];

export default function WelcomePage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [tz, setTz] = useState("");
  const [useCases, setUseCases] = useState<Multi>([]);
  const [style, setStyle] = useState("Concise & direct");
  const [control, setControl] = useState("prepare");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      setTz(Intl.DateTimeFormat().resolvedOptions().timeZone || "");
    } catch {
      /* ignore */
    }
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => { if (d.user?.name) setName(d.user.name); })
      .catch(() => {});
  }, []);

  const steps = 4;
  const toggle = (arr: Multi, v: string, set: (m: Multi) => void) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  async function finish(skipped = false) {
    setBusy(true);
    try {
      await fetch("/api/auth/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          onboarding: skipped ? { skipped: true } : { name: name.trim(), timezone: tz, useCases, communicationStyle: style, controlLevel: control },
        }),
      });
    } finally {
      router.push("/");
    }
  }

  return (
    <main className="min-h-screen flex flex-col">
      <header className="max-w-xl w-full mx-auto px-6 h-16 flex items-center justify-between">
        <Wordmark size={22} />
        <div className="flex items-center gap-3">
          <button className="btn btn-quiet text-[12.5px]" onClick={() => finish(true)} disabled={busy}>Skip setup</button>
          <ThemeToggle />
        </div>
      </header>

      <div className="flex-1 flex items-center justify-center px-6 pb-16">
        <div className="w-full max-w-xl">
          <Progress step={step} steps={steps} />

          <div key={step} className="mt-8 fade-up">
            {step === 0 && (
              <Step title={`Welcome to Volo${name ? `, ${name}` : ""}.`} sub="Volo turns your goals into completed outcomes — researching, planning, and executing with your approval. Let's tailor it to you.">
                <label className="block">
                  <span className="text-[12.5px] font-[550] text-[var(--color-ink-soft)]">What should Volo call you?</span>
                  <input autoFocus className="field !text-[15px] !py-3 !rounded-xl mt-1.5" value={name} placeholder="Your preferred name" onChange={(e) => setName(e.target.value)} />
                </label>
                <p className="mt-3 text-[12px] text-[var(--color-faint)]">Timezone detected: <span className="font-[var(--font-mono)]">{tz || "—"}</span></p>
              </Step>
            )}

            {step === 1 && (
              <Step title="What will you mainly use Volo for?" sub="Pick any that apply — this shapes suggestions, not limits.">
                <div className="grid sm:grid-cols-2 gap-2">
                  {USE_CASES.map((u) => (
                    <Chip key={u} label={u} active={useCases.includes(u)} onClick={() => toggle(useCases, u, setUseCases)} />
                  ))}
                </div>
              </Step>
            )}

            {step === 2 && (
              <Step title="How should Volo communicate?" sub="You can change this anytime in settings.">
                <div className="flex flex-col gap-2">
                  {STYLES.map((s) => (
                    <Radio key={s} label={s} active={style === s} onClick={() => setStyle(s)} />
                  ))}
                </div>
              </Step>
            )}

            {step === 3 && (
              <Step title="How much control should Volo have?" sub="Consequential actions (emails, payments, bookings) always require your explicit approval — no matter what you choose.">
                <div className="flex flex-col gap-2">
                  {CONTROL.map((c) => (
                    <Card key={c.key} title={c.title} desc={c.desc} recommended={c.recommended} active={control === c.key} onClick={() => setControl(c.key)} />
                  ))}
                </div>
              </Step>
            )}
          </div>

          <div className="mt-8 flex items-center justify-between">
            <button className="btn btn-ghost text-[13px]" disabled={step === 0 || busy} onClick={() => setStep((s) => Math.max(0, s - 1))}>Back</button>
            {step < steps - 1 ? (
              <button className="btn btn-accent text-[13px]" disabled={busy} onClick={() => setStep((s) => s + 1)}>Continue</button>
            ) : (
              <button className="btn btn-accent btn-shine text-[13px]" disabled={busy} onClick={() => finish(false)}>{busy ? "Finishing…" : "Finish setup"}</button>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function Progress({ step, steps }: { step: number; steps: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: steps }).map((_, i) => (
        <span key={i} className="h-1 rounded-full transition-all duration-300" style={{ width: i === step ? 28 : 16, background: i <= step ? "var(--color-accent)" : "var(--color-line-strong)" }} />
      ))}
    </div>
  );
}
function Step({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div>
      <h1 className="font-display text-[26px] leading-tight tracking-[-0.02em]">{title}</h1>
      <p className="mt-2 text-[14px] text-[var(--color-muted)] leading-relaxed">{sub}</p>
      <div className="mt-6">{children}</div>
    </div>
  );
}
function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="text-left px-3.5 py-2.5 rounded-xl border text-[13.5px] transition-all" style={active ? { borderColor: "var(--color-accent)", background: "var(--color-accent-soft)", color: "var(--color-accent-ink)" } : { color: "var(--color-ink-soft)" }}>
      {label}
    </button>
  );
}
function Radio({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-3 text-left px-4 py-3 rounded-xl border transition-all" style={active ? { borderColor: "var(--color-accent)" } : {}}>
      <span className="w-4 h-4 rounded-full border flex items-center justify-center" style={{ borderColor: active ? "var(--color-accent)" : "var(--color-line-strong)" }}>
        {active && <span className="w-2 h-2 rounded-full" style={{ background: "var(--color-accent)" }} />}
      </span>
      <span className="text-[14px]">{label}</span>
    </button>
  );
}
function Card({ title, desc, active, recommended, onClick }: { title: string; desc: string; active: boolean; recommended?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="text-left px-4 py-3.5 rounded-xl border transition-all" style={active ? { borderColor: "var(--color-accent)", background: "var(--color-accent-soft)" } : {}}>
      <div className="flex items-center gap-2">
        <span className="text-[14px] font-[620]">{title}</span>
        {recommended && <span className="text-[10px] uppercase tracking-[0.12em] px-1.5 py-0.5 rounded" style={{ background: "var(--color-accent)", color: "#fff" }}>Recommended</span>}
      </div>
      <p className="mt-0.5 text-[12.5px] text-[var(--color-muted)]">{desc}</p>
    </button>
  );
}
