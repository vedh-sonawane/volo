"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { ObjectiveSummary } from "@/lib/types";
import { STATUS_META, timeAgo } from "@/lib/ui";
import { Wordmark } from "@/components/Wordmark";
import { Composer } from "@/components/Composer";
import { ThemeToggle } from "@/components/ThemeToggle";

function greetingFor(date = new Date()): string {
  const h = date.getHours();
  if (h < 5) return "Good night";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 21) return "Good evening";
  return "Good night";
}

// The home screen is a persistent objective control center, not a chat log.
// It renders ONLY real objectives fetched from the backend (the DB is the source
// of truth) and polls for live state — no fake timers, no seeded example rows.
export function Dashboard() {
  const router = useRouter();
  const [objectives, setObjectives] = useState<ObjectiveSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState<string>("");

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        if (!d.user) { router.replace("/login"); return; }
        setName(d.user.name || "");
      })
      .catch(() => {});
  }, [router]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks", { cache: "no-store" });
      if (res.status === 401) { router.replace("/login"); return; }
      const data = await res.json();
      setObjectives(data.objectives ?? []);
      setError(null);
    } catch {
      setError("Couldn't reach the objective store.");
    }
  }, [router]);

  useEffect(() => {
    load();
    // Poll real state so in-flight objectives update on the dashboard. This
    // reflects the actual backend; it is not a simulated progress animation.
    const iv = setInterval(load, 4000);
    return () => clearInterval(iv);
  }, [load]);

  const list = objectives ?? [];
  const needsInput = list.filter((o) => o.needsInput);
  const active = list.filter((o) => !o.needsInput && STATUS_META[o.status].active);
  const done = list.filter((o) => !o.needsInput && !STATUS_META[o.status].active);

  return (
    <main className="min-h-screen">
      <header className="sticky top-0 z-20 border-b glass" style={{ borderRadius: 0 }}>
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <Wordmark />
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link href="/settings" className="btn btn-quiet text-[13px]">Settings</Link>
            <button
              className="btn btn-quiet text-[13px]"
              onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); router.replace("/login"); }}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <FirstRunBanner />

      <div className="max-w-5xl mx-auto px-6 pb-24">
        {/* Composer */}
        <section className="pt-10 pb-10">
          <h1
            className="font-display"
            style={{ fontSize: "clamp(1.9rem,3.8vw,2.7rem)", lineHeight: 1.06, letterSpacing: "-0.02em", fontWeight: 600 }}
          >
            {greetingFor()}
            {name && (
              <>
                , <span style={{ fontStyle: "italic" }}>{name}</span>
              </>
            )}
            .
          </h1>
          <p className="mt-2 mb-6 text-[15px] sm:text-[16px] text-[var(--color-muted)]">
            What would you like Volo to accomplish?
          </p>
          <div className="card p-4 sm:p-6">
            <Composer />
          </div>
        </section>

        {error && <div className="text-[13px] text-[var(--color-err)] mb-6">{error}</div>}

        {objectives === null ? (
          <ListSkeleton />
        ) : list.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="flex flex-col gap-10">
            {needsInput.length > 0 && (
              <Group
                title="Needs your input"
                accent="var(--color-warn)"
                hint={`${needsInput.length} waiting on you`}
              >
                {needsInput.map((o) => (
                  <ObjectiveRow key={o.id} o={o} emphasise />
                ))}
              </Group>
            )}

            <Group title="Active" hint={`${active.length}`}>
              {active.length ? (
                active.map((o) => <ObjectiveRow key={o.id} o={o} />)
              ) : (
                <Muted>No objectives are currently executing.</Muted>
              )}
            </Group>

            {done.length > 0 && (
              <Group title="Finished" hint={`${done.length}`}>
                {done.map((o) => (
                  <ObjectiveRow key={o.id} o={o} />
                ))}
              </Group>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

function Group({
  title,
  hint,
  accent,
  children,
}: {
  title: string;
  hint?: string;
  accent?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        {accent && <span className="dot" style={{ background: accent, width: 8, height: 8 }} />}
        <h2 className="text-[13px] font-[650] tracking-[-0.01em]" style={{ color: accent || "var(--color-ink)" }}>
          {title}
        </h2>
        {hint && <span className="text-[11.5px] text-[var(--color-faint)] font-[var(--font-mono)]">{hint}</span>}
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

function ObjectiveRow({ o, emphasise }: { o: ObjectiveSummary; emphasise?: boolean }) {
  const meta = STATUS_META[o.status];
  const pct = Math.round(o.progress * 100);
  return (
    <Link
      href={`/task/${o.id}`}
      className="card px-4 py-3.5 hover:border-[var(--color-line-strong)] transition-colors block fade-up"
      style={emphasise ? { borderColor: "var(--color-warn)" } : undefined}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={meta.active ? "dot pulse" : "dot"} style={{ background: meta.color, width: 8, height: 8 }} />
            <span className="text-[14.5px] font-[600] text-[var(--color-ink)] truncate">{o.title}</span>
          </div>
          {o.lastActivity && (
            <div className="text-[12.5px] text-[var(--color-muted)] mt-1 truncate pl-4">{o.lastActivity}</div>
          )}
          <div className="flex items-center gap-2 mt-2 pl-4">
            <NextActionPill next={o.nextAction} />
            <span className="text-[11.5px] text-[var(--color-faint)]">· {timeAgo(o.updatedAt)}</span>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[12px] font-[550]" style={{ color: meta.color }}>
            {meta.label}
          </div>
          <div className="mt-2 flex items-center gap-2 justify-end">
            <ProgressBar pct={pct} active={meta.active} />
            <span className="text-[11px] font-[var(--font-mono)] text-[var(--color-faint)] w-8 text-right">{pct}%</span>
          </div>
        </div>
      </div>
    </Link>
  );
}

function NextActionPill({ next }: { next: ObjectiveSummary["nextAction"] }) {
  const color =
    next.actor === "user" ? "var(--color-warn)" : next.actor === "system" ? "var(--color-run)" : "var(--color-faint)";
  return (
    <span
      className="text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ color, background: `color-mix(in srgb, ${color} 12%, transparent)` }}
    >
      {next.actor === "user" ? "→ you: " : next.actor === "system" ? "" : ""}
      {next.label}
    </span>
  );
}

function ProgressBar({ pct, active }: { pct: number; active: boolean }) {
  return (
    <span className="inline-block w-24 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--color-line)" }}>
      <span
        className="block h-full rounded-full transition-all duration-500"
        style={{ width: `${pct}%`, background: active ? "var(--color-run)" : "var(--color-ok)" }}
      />
    </span>
  );
}

// First-run onboarding: an honest one-liner about what's connected, with a link
// to finish setup. Dismissible. Truthful — reads real capability status.
function FirstRunBanner() {
  const [caps, setCaps] = useState<{ key: string; status: string }[] | null>(null);
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => {
    if (typeof window !== "undefined") setDismissed(window.localStorage.getItem("volo_onboarded") === "1");
    fetch("/api/capabilities", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setCaps(d.capabilities ?? []))
      .catch(() => {});
  }, []);
  if (dismissed || !caps) return null;
  const model = caps.find((c) => c.key === "model");
  const email = caps.find((c) => c.key === "email");
  const needsSetup = model?.status === "not_configured" || email?.status === "draft_export_only";
  if (!needsSetup) return null;
  return (
    <div className="max-w-5xl mx-auto px-6 pt-4">
      <div className="card p-4 flex items-start gap-3" style={{ borderColor: "var(--color-accent)", background: "var(--color-accent-soft)" }}>
        <div className="flex-1 min-w-0">
          <div className="text-[13.5px] font-[600]" style={{ color: "var(--color-accent-ink)" }}>Welcome — Volo works right now (free web research + honest drafts).</div>
          <p className="text-[12.5px] mt-0.5 leading-snug" style={{ color: "var(--color-accent-ink)" }}>
            To unlock AI planning and real email sending, connect them in Settings. Volo always tells you exactly what it can and can&apos;t do.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link href="/settings" className="btn btn-accent text-[12.5px] !py-1.5">Finish setup</Link>
          <button className="btn btn-quiet text-[12px] !py-1.5" onClick={() => { window.localStorage.setItem("volo_onboarded", "1"); setDismissed(true); }}>Dismiss</button>
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="card p-10 text-center">
      <div className="mx-auto mb-4 w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: "var(--color-accent-soft)", color: "var(--color-accent-ink)" }} aria-hidden>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </div>
      <h3 className="text-[17px] font-[640] mb-1.5 font-display">No objectives yet</h3>
      <p className="text-[13.5px] text-[var(--color-muted)] max-w-md mx-auto leading-relaxed">
        Describe an outcome you want completed above — not a question to answer. Volo will create a persistent
        objective, plan the work, research the web, and keep it here so you can track progress and approve actions.
      </p>
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <div className="text-[13px] text-[var(--color-faint)] px-1 py-2">{children}</div>;
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="card px-4 py-4">
          <div className="skeleton h-4 w-56 mb-2" />
          <div className="skeleton h-3 w-40" />
        </div>
      ))}
    </div>
  );
}
