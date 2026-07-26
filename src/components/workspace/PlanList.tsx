"use client";

import type { PlanStep, Task } from "@/lib/types";
import { STEP_META } from "@/lib/ui";

export function PlanList({ task }: { task: Task }) {
  const planned = task.plan.length > 0;
  return (
    <section className="card p-5">
      <Header
        title="Execution plan"
        hint={planned ? `${task.plan.filter((s) => s.status === "done").length}/${task.plan.length} done` : "designing…"}
      />

      {task.plannerUsed && (
        <div className="mt-2 flex items-start gap-2">
          <span
            className="text-[10px] px-1.5 py-0.5 rounded-full font-[600] uppercase tracking-wider shrink-0 mt-0.5"
            style={{
              color: task.plannerUsed === "model" ? "var(--color-accent-ink)" : "var(--color-muted)",
              background: task.plannerUsed === "model" ? "var(--color-accent-soft)" : "#f1eee7",
            }}
            title={task.plannerUsed === "model" ? "Plan authored by the local AI model" : "Deterministic plan"}
          >
            {task.plannerUsed === "model" ? "AI-planned" : "rule-planned"}
          </span>
          {task.planRationale && (
            <p className="text-[12px] text-[var(--color-muted)] leading-snug italic">{task.planRationale}</p>
          )}
        </div>
      )}

      {planned ? (
        <ol className="mt-4 flex flex-col">
          {task.plan.map((step, i) => (
            <StepRow key={step.id} step={step} index={i + 1} last={i === task.plan.length - 1} />
          ))}
        </ol>
      ) : (
        <div className="mt-4 flex items-center gap-2 text-[13px] text-[var(--color-faint)]">
          <span className="spin" style={{ width: 13, height: 13, borderRadius: 999, border: "2px solid var(--color-line-strong)", borderTopColor: "var(--color-accent)" }} />
          Designing a plan for this objective…
        </div>
      )}
    </section>
  );
}

function StepRow({ step, index, last }: { step: PlanStep; index: number; last: boolean }) {
  const meta = STEP_META[step.status];
  const running = step.status === "running";
  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center">
        <span
          className={running ? "dot pulse" : "dot"}
          style={{ background: meta.color, width: 9, height: 9, marginTop: 6 }}
        />
        {!last && <span className="w-px flex-1" style={{ background: "var(--color-line)" }} />}
      </div>
      <div className={`pb-4 ${last ? "" : ""} flex-1 min-w-0`}>
        <div className="flex items-center gap-2 justify-between">
          <span className="text-[13.5px] leading-snug" style={{ color: step.status === "pending" ? "var(--color-faint)" : "var(--color-ink)" }}>
            <span className="font-[var(--font-mono)] text-[11px] text-[var(--color-faint)] mr-2">{String(index).padStart(2, "0")}</span>
            {step.description}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2 flex-wrap">
          <Tag color={meta.color}>{meta.label}</Tag>
          <span className="text-[11px] font-[var(--font-mono)] text-[var(--color-faint)]">{step.tool}</span>
          {typeof step.confidence === "number" && step.status === "done" && (
            <span className="text-[11px] text-[var(--color-faint)]">conf {Math.round(step.confidence * 100)}%</span>
          )}
          {step.sources.length > 0 && (
            <span className="text-[11px] text-[var(--color-faint)]">· {step.sources.length} source{step.sources.length === 1 ? "" : "s"}</span>
          )}
        </div>
        {step.error && <div className="mt-1 text-[12px] text-[var(--color-err)]">{step.error}</div>}
      </div>
    </li>
  );
}

function Tag({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span
      className="text-[11px] px-2 py-0.5 rounded-full"
      style={{ color, background: color.replace("var(--color-", "").startsWith("faint") ? "#f1eee7" : `color-mix(in srgb, ${color} 12%, transparent)` }}
    >
      {children}
    </span>
  );
}

export function Header({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="text-[13px] font-[650] tracking-[-0.01em]">{title}</h3>
      {hint && <span className="text-[11.5px] text-[var(--color-faint)] font-[var(--font-mono)]">{hint}</span>}
    </div>
  );
}
