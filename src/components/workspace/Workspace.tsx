"use client";

import Link from "next/link";
import type { Task } from "@/lib/types";
import { useTaskStream } from "@/components/useTaskStream";
import { Wordmark } from "@/components/Wordmark";
import { STATUS_META } from "@/lib/ui";
import { Stepper } from "./Stepper";
import { PlanList } from "./PlanList";
import { Timeline } from "./Timeline";
import { Sources } from "./Sources";
import { ComparisonPanel } from "./Comparison";
import { FinalResult } from "./FinalResult";
import { Approvals } from "./Approvals";

export function Workspace({ taskId }: { taskId: string }) {
  const { task, connected, error } = useTaskStream(taskId);

  if (error && !task) return <CenterMessage title="Couldn't load this task" body={error} />;
  if (!task) return <LoadingState />;

  const meta = STATUS_META[task.status];
  const running = meta.active;

  return (
    <main className="min-h-screen">
      {/* Top bar */}
      <header className="sticky top-0 z-10 border-b" style={{ background: "color-mix(in srgb, var(--color-paper) 88%, transparent)", backdropFilter: "blur(8px)" }}>
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <Wordmark size={18} />
          </Link>
          <StatusBadge task={task} live={connected} />
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Objective */}
        <div className="fade-up">
          <div className="eyebrow mb-2">Objective</div>
          <h1 className="text-[22px] sm:text-[26px] font-[640] tracking-[-0.02em] leading-tight" style={{ maxWidth: 780 }}>
            {task.objective}
          </h1>
          <div className="mt-4">
            <Stepper task={task} />
          </div>
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
            <FinalResult task={task} />
            <Approvals task={task} />
            <ComparisonPanel task={task} />
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
  return (
    <div className="text-[11.5px] text-[var(--color-faint)] leading-relaxed px-1">
      <div className="flex items-center gap-2 flex-wrap">
        <span>research: <span className="font-[var(--font-mono)]">{task.researchProvider || "duckduckgo"}</span></span>
        <span>·</span>
        <span>model: <span className="font-[var(--font-mono)]">{task.modelProvider || "rule"}</span></span>
      </div>
      <p className="mt-1.5">
        {task.modelProvider === "rule" || !task.modelProvider
          ? "Running in degraded mode (no AI model configured). Extraction and comparison are fully deterministic and honest."
          : "A local model enriched the summary; all facts remain sourced from real pages."}
      </p>
    </div>
  );
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
        <h1 className="text-[20px] font-[640] mb-2">{title}</h1>
        <p className="text-[14px] text-[var(--color-muted)] mb-6">{body}</p>
        <Link href="/" className="btn btn-accent">Start a new objective</Link>
      </div>
    </div>
  );
}
