"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import type { Task } from "@/lib/types";
import { useTaskStream } from "@/components/useTaskStream";
import { Wordmark } from "@/components/Wordmark";
import { ThemeToggle } from "@/components/ThemeToggle";
import { STATUS_META, nextActionFor } from "@/lib/ui";
import { Stepper } from "./Stepper";
import { PlanList } from "./PlanList";
import { Timeline } from "./Timeline";
import { Sources } from "./Sources";
import { ComparisonPanel } from "./Comparison";
import { MultiDomainPanel } from "./MultiDomain";
import { FinalResult } from "./FinalResult";
import { Approvals } from "./Approvals";
import { WaitingCard } from "./WaitingCard";
import { ClarifyCard } from "./ClarifyCard";
import { ObjectivePanel } from "./ObjectivePanel";

export function Workspace({ taskId }: { taskId: string }) {
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => setReloadToken((t) => t + 1), []);
  const { task, connected, error } = useTaskStream(taskId, reloadToken);

  if (error && !task) return <CenterMessage title="Couldn't load this task" body={error} />;
  if (!task) return <LoadingState />;

  const meta = STATUS_META[task.status];
  const running = meta.active;

  return (
    <main className="min-h-screen">
      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b glass" style={{ borderRadius: 0 }}>
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <Wordmark size={20} />
          </Link>
          <div className="flex items-center gap-3">
            <StatusBadge task={task} live={connected} />
            <span className="w-px h-5" style={{ background: "var(--color-line)" }} />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Objective (with edit + cancel controls) */}
        <div>
          <ObjectivePanel task={task} onEdited={reload} />
          <div className="mt-4">
            <Stepper task={task} />
          </div>
          <NextActionBar task={task} />
          <ConstraintsRow task={task} />
        </div>

        {task.status === "failed" && task.failure && (
          <div className="mt-6 card p-5 fade-up" style={{ borderColor: "var(--color-err)" }}>
            <div className="eyebrow mb-1" style={{ color: "var(--color-err)" }}>Task failed</div>
            <p className="text-[14px] text-[var(--color-ink-soft)]">{task.failure}</p>
            <p className="mt-2 text-[13px] text-[var(--color-muted)]">
              This is reported honestly rather than showing a fake result. You can start a new objective from the home page.
            </p>
          </div>
        )}

        {/* Two-column layout: outcome/results (main) + execution (aside) */}
        <div className="mt-8 grid lg:grid-cols-[1fr_380px] gap-6 items-start">
          <div className="flex flex-col gap-6 min-w-0">
            <ClarifyCard task={task} onAnswered={reload} />
            <GoalPanel task={task} />
            <FinalResult task={task} />
            <WaitingCard task={task} onResumed={reload} />
            <Approvals task={task} onDecided={reload} />
            {task.multiDomain ? <MultiDomainPanel task={task} /> : <ComparisonPanel task={task} />}
            {!task.finalResult && running && <ResultsSkeleton />}
            <Sources task={task} />
          </div>
          <aside className="flex flex-col gap-6 lg:sticky lg:top-20">
            <PlanList task={task} />
            <Timeline task={task} live={running && connected} />
            <ProviderNote task={task} />
          </aside>
        </div>
      </div>
    </main>
  );
}

function StatusBadge({ task, live }: { task: Task; live: boolean }) {
  const meta = STATUS_META[task.status];
  return (
    <div className="flex items-center gap-2.5">
      <span className={meta.active && live ? "dot pulse" : "dot"} style={{ background: meta.color, width: 8, height: 8 }} />
      <span className="text-[13px] font-[550]" style={{ color: meta.color }}>
        {meta.label}
      </span>
      {meta.active && (
        <span className="text-[11px] text-[var(--color-faint)] font-[var(--font-mono)]">{live ? "live" : "…"}</span>
      )}
    </div>
  );
}

function GoalPanel({ task }: { task: Task }) {
  const g = task.goal;
  if (!g || (g.hard.length === 0 && g.soft.length === 0 && g.assumptions.length === 0)) return null;
  return (
    <section className="card p-5">
      <div className="eyebrow mb-2">Understanding</div>
      <p className="text-[14px] text-[var(--color-ink-soft)] leading-relaxed">{g.summary}</p>
      <div className="mt-4 grid sm:grid-cols-2 gap-4">
        {g.hard.length > 0 && (
          <div>
            <div className="eyebrow mb-1.5" style={{ color: "var(--color-err)" }}>Must (hard)</div>
            <ul className="flex flex-col gap-1">
              {g.hard.map((h, i) => (
                <li key={i} className="text-[12.5px] text-[var(--color-ink-soft)] flex gap-1.5"><span className="text-[var(--color-err)]">•</span>{h}</li>
              ))}
            </ul>
          </div>
        )}
        {g.soft.length > 0 && (
          <div>
            <div className="eyebrow mb-1.5" style={{ color: "var(--color-accent-ink)" }}>Prefer (soft)</div>
            <ul className="flex flex-col gap-1">
              {g.soft.map((s, i) => (
                <li key={i} className="text-[12.5px] text-[var(--color-ink-soft)] flex gap-1.5"><span className="text-[var(--color-accent-ink)]">•</span>{s}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {g.assumptions.length > 0 && (
        <div className="mt-3 border-t pt-3">
          <div className="eyebrow mb-1.5">Assuming</div>
          <ul className="flex flex-col gap-1">
            {g.assumptions.map((a, i) => (
              <li key={i} className="text-[12px] text-[var(--color-muted)]">{a}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function NextActionBar({ task }: { task: Task }) {
  const next = nextActionFor(task);
  if (next.actor === "none") return null;
  const color =
    next.actor === "user" ? "var(--color-warn)" : "var(--color-run)";
  return (
    <div className="mt-4 flex items-center gap-2.5 text-[13px]">
      <span className="eyebrow" style={{ color: "var(--color-faint)" }}>Next</span>
      <span
        className="px-2.5 py-1 rounded-md font-[550]"
        style={{ color, background: `color-mix(in srgb, ${color} 12%, transparent)` }}
      >
        {next.actor === "user" ? "You: " : "Volo: "}
        {next.label}
      </span>
    </div>
  );
}

function ConstraintsRow({ task }: { task: Task }) {
  const c = task.constraints;
  const chips: string[] = [];
  chips.push(c.domain);
  if (c.location) chips.push(`📍 ${c.location}`);
  if (c.maxPrice != null) chips.push(`≤ $${c.maxPrice}${c.priceUnit ? "/" + c.priceUnit : ""}`);
  if (c.count) chips.push(`${c.count} wanted`);
  if (c.partySize) chips.push(`party of ${c.partySize}`);
  if (c.timeframe) chips.push(`🗓 ${c.timeframe}`);
  return (
    <div className="mt-4 flex items-center gap-2 flex-wrap">
      {chips.map((ch) => (
        <span key={ch} className="text-[12px] px-2.5 py-1 rounded-md border text-[var(--color-ink-soft)] bg-[var(--color-surface)]">
          {ch}
        </span>
      ))}
    </div>
  );
}

function ProviderNote({ task }: { task: Task }) {
  const model = task.modelProvider || "rule";
  const nSources = task.sources.length;
  return (
    <div className="text-[11.5px] text-[var(--color-faint)] leading-relaxed px-1">
      <div className="flex items-center gap-2 flex-wrap">
        <span>research: <span className="font-[var(--font-mono)]">{task.researchProvider || "duckduckgo"}</span></span>
        <span>·</span>
        <span>model: <span className="font-[var(--font-mono)]">{model}</span></span>
      </div>
      <p className="mt-1.5">{providerExplanation(task, model, nSources)}</p>
    </div>
  );
}

// Honest, state-accurate explanation of what each provider actually did.
function providerExplanation(task: Task, model: string, nSources: number): string {
  if (!task.finalResult) {
    return "The deterministic engine runs search, extraction, and comparison. A model, if enabled, only rewrites the final summary from already-extracted facts — it is never used to invent data.";
  }
  if (task.finalResult.modelUsed) {
    return `The ${model} model rewrote the summary using only the ${nSources} page${nSources === 1 ? "" : "s"} actually read. Every value in the table above is extracted from those pages, not generated.`;
  }
  if (model !== "rule") {
    return nSources === 0
      ? `The ${model} model was available but was NOT used here — no pages were read, so there was nothing to summarize. Nothing was fabricated.`
      : `The ${model} model was available but was NOT used for the summary this time. The honest deterministic summary is shown; nothing was fabricated.`;
  }
  return "No AI model is configured, so the deterministic engine produced this. Extraction and comparison are rule-based, and nothing is invented.";
}

function ResultsSkeleton() {
  return (
    <div className="card p-5">
      <div className="skeleton h-4 w-40 mb-4" />
      <div className="flex flex-col gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton h-9 w-full" />
        ))}
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="flex items-center gap-3 text-[var(--color-muted)]">
        <span className="spin" style={{ width: 18, height: 18, borderRadius: 999, border: "2px solid var(--color-line-strong)", borderTopColor: "var(--color-accent)" }} />
        <span className="text-[14px]">Loading task…</span>
      </div>
    </div>
  );
}

function CenterMessage({ title, body }: { title: string; body: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        <h1 className="text-[22px] font-[640] mb-2 font-display">{title}</h1>
        <p className="text-[14px] text-[var(--color-muted)] mb-6">{body}</p>
        <Link href="/" className="btn btn-accent btn-shine">Start a new objective</Link>
      </div>
    </div>
  );
}
