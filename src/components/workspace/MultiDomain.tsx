"use client";

import { useState } from "react";
import type { CombinedOption, ResultItem, SubPlan, Task } from "@/lib/types";
import { hostOf } from "@/lib/ui";
import { Header } from "./PlanList";

// Renders a multi-domain objective (BL-2): the cross-category combination
// ranking at the top, then each category's own researched candidates below.
export function MultiDomainPanel({ task }: { task: Task }) {
  if (!task.multiDomain || !task.subPlans) return null;
  const cmb = task.combination;
  const recommended = cmb
    ? (cmb.recommendedIds.map((id) => cmb.options.find((o) => o.id === id)).filter(Boolean) as CombinedOption[])
    : [];

  return (
    <div className="flex flex-col gap-6">
      <section className="card p-5">
        <Header
          title="Best combinations"
          hint={cmb ? `${cmb.options.length} across ${task.subPlans.length} categories` : "combining…"}
        />
        {cmb && <p className="mt-2 text-[13px] text-[var(--color-muted)] leading-relaxed">{cmb.rationale}</p>}

        {recommended.length === 0 ? (
          <div className="mt-4 text-[13px] text-[var(--color-muted)] border rounded-lg p-4 bg-[var(--color-paper)]">
            {cmb ? "No complete in-budget combination could be assembled yet — see the categories below and the limitations." : "Waiting for the categories to finish, then combining…"}
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            {recommended.map((o, i) => (
              <ComboRow key={o.id} option={o} rank={i + 1} budget={cmb?.budget} unit={cmb?.priceUnit} />
            ))}
          </div>
        )}

        {cmb && cmb.missing.length > 0 && (
          <div className="mt-3 text-[12.5px]" style={{ color: "var(--color-warn)" }}>
            Missing options for: {cmb.missing.join(", ")} — combinations for those are incomplete.
          </div>
        )}
      </section>

      <section className="card p-5">
        <Header title="By category" hint={`${task.subPlans.length} researched independently`} />
        <div className="mt-4 grid sm:grid-cols-2 gap-4">
          {task.subPlans.map((sp) => (
            <SubPlanCard key={sp.id} sub={sp} />
          ))}
        </div>
      </section>
    </div>
  );
}

function ComboRow({ option, rank, budget, unit }: { option: CombinedOption; rank: number; budget?: number; unit?: string }) {
  const badgeColor = budget == null ? "var(--color-muted)" : option.withinBudget ? "var(--color-ok)" : "var(--color-warn)";
  return (
    <div className="border rounded-lg p-3.5 bg-[var(--color-surface)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-[700] shrink-0" style={{ background: "var(--color-ink)", color: "#fff" }}>
            {rank}
          </span>
          <div className="min-w-0">
            {option.picks.map((p, idx) => (
              <span key={idx} className="text-[13px]">
                {idx > 0 && <span className="text-[var(--color-faint)]"> + </span>}
                <span className="text-[11px] uppercase tracking-wide text-[var(--color-faint)]">{p.label}: </span>
                {p.evidenceUrl ? (
                  <a href={p.evidenceUrl} target="_blank" rel="noreferrer" className="link-underline text-[var(--color-ink)] font-[550]">
                    {p.name}
                  </a>
                ) : (
                  <span className="font-[550]">{p.name}</span>
                )}
                {p.price != null && <span className="text-[var(--color-muted)]"> (${p.price})</span>}
              </span>
            ))}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[13px] font-[650]">{option.totalPrice != null ? `~$${option.totalPrice}${unit ? "/" + unit : ""}` : "price n/a"}</div>
          <div className="text-[10px] px-1.5 py-0.5 rounded-full mt-1 inline-block" style={{ color: badgeColor, background: `color-mix(in srgb, ${badgeColor} 12%, transparent)` }}>
            {budget == null ? "no budget" : !option.priceComplete ? "unconfirmed" : option.withinBudget ? "within budget" : "over budget"}
          </div>
        </div>
      </div>
    </div>
  );
}

function SubPlanCard({ sub }: { sub: SubPlan }) {
  const [open, setOpen] = useState(false);
  const cands = (sub.comparison
    ? (sub.comparison.recommendedIds.map((id) => sub.comparison!.items.find((i) => i.id === id)).filter(Boolean) as ResultItem[])
    : sub.results.filter((r) => r.kind === "candidate")
  );
  const shown = open ? cands : cands.slice(0, 3);
  return (
    <div className="border rounded-lg p-3.5 bg-[var(--color-paper)]">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-[600] capitalize">{sub.label}</span>
        <span className="text-[11px] text-[var(--color-faint)]">{cands.length} option{cands.length === 1 ? "" : "s"}</span>
      </div>
      {cands.length === 0 ? (
        <div className="mt-2 text-[12px] text-[var(--color-faint)]">{sub.status === "done" ? "No usable options found." : "Researching…"}</div>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {shown.map((r) => (
            <li key={r.id} className="text-[12.5px] flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">
                {r.evidenceUrl ? (
                  <a href={r.evidenceUrl} target="_blank" rel="noreferrer" className="link-underline text-[var(--color-ink-soft)]">{r.name}</a>
                ) : (
                  r.name
                )}
              </span>
              <span className="text-[var(--color-faint)] shrink-0">{r.attributes.price || "—"}</span>
            </li>
          ))}
          {cands.length > 3 && (
            <button className="text-[11.5px] text-[var(--color-accent-ink)] text-left mt-1" onClick={() => setOpen((o) => !o)}>
              {open ? "show less" : `show ${cands.length - 3} more`}
            </button>
          )}
        </ul>
      )}
    </div>
  );
}
