"use client";

import { useState } from "react";
import type { Comparison as Cmp, ResultItem, Task } from "@/lib/types";
import { hostOf } from "@/lib/ui";
import { Header } from "./PlanList";

const COLUMN_LABELS: Record<string, string> = {
  price: "Price",
  location: "Location",
  availability: "Availability",
  rating: "Rating",
  contact: "Contact",
  website: "Website",
  cuisine: "Cuisine",
  hours: "Hours",
  dietary: "Dietary",
  booking: "Booking",
  specs: "Specs",
  seller: "Seller",
  warranty: "Warranty",
  return_policy: "Return policy",
  airline: "Airline",
  route: "Route",
  times: "Times",
  stops: "Stops",
  step: "Step",
  detail: "Detail",
  source: "Source",
  summary: "Summary",
};

function label(col: string) {
  return COLUMN_LABELS[col] || col.replace(/_/g, " ");
}

export function ComparisonPanel({ task }: { task: Task }) {
  const cmp = task.comparison;
  if (!cmp) return null;

  const recommended = cmp.recommendedIds
    .map((id) => cmp.items.find((i) => i.id === id))
    .filter(Boolean) as ResultItem[];
  const others = cmp.items.filter((i) => !cmp.recommendedIds.includes(i.id));
  const entity = cmp.entityLabel || "option";
  const n = cmp.items.length;

  return (
    <section className="card p-5">
      <Header
        title="Candidates"
        hint={
          `${n} actual ${n === 1 ? entity : entity + "s"}` +
          (cmp.informationCount > 0 ? ` · ${cmp.informationCount} info page${cmp.informationCount === 1 ? "" : "s"} set aside` : "")
        }
      />
      <p className="mt-2 text-[13px] text-[var(--color-muted)] leading-relaxed">{cmp.rationale}</p>

      {recommended.length === 0 ? (
        <div className="mt-4 text-[13px] text-[var(--color-muted)] border rounded-lg p-4 bg-[var(--color-paper)]">
          No actual {entity}s were found — only informational pages (see Sources). Volo won&apos;t present a guide or
          directory as if it were a real {entity}.
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="text-left" style={{ color: "var(--color-faint)" }}>
                <th className="font-[600] text-[11px] uppercase tracking-wider py-2 pr-3">#</th>
                <th className="font-[600] text-[11px] uppercase tracking-wider py-2 pr-3">Option</th>
                {cmp.columns.map((c) => (
                  <th key={c} className="font-[600] text-[11px] uppercase tracking-wider py-2 pr-3 whitespace-nowrap">
                    {label(c)}
                  </th>
                ))}
                <th className="font-[600] text-[11px] uppercase tracking-wider py-2">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {recommended.map((item, i) => (
                <Row key={item.id} item={item} columns={cmp.columns} rank={i + 1} recommended />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {others.length > 0 && <OthersDisclosure items={others} columns={cmp.columns} />}
    </section>
  );
}

function Row({
  item,
  columns,
  rank,
  recommended,
}: {
  item: ResultItem;
  columns: string[];
  rank?: number;
  recommended?: boolean;
}) {
  return (
    <tr className="border-t align-top" style={{ borderColor: "var(--color-line)" }}>
      <td className="py-3 pr-3">
        {recommended ? (
          <span
            className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-[700]"
            style={{ background: "var(--color-ink)", color: "#fff" }}
          >
            {rank}
          </span>
        ) : (
          <span className="text-[var(--color-faint)]">—</span>
        )}
      </td>
      <td className="py-3 pr-3 max-w-[220px]">
        <div className="font-[600] text-[var(--color-ink)] leading-snug">{item.name}</div>
        <div className="mt-1 flex items-center gap-2">
          <ConfBar value={item.confidence} />
          <span className="text-[11px] text-[var(--color-faint)]">{Math.round(item.confidence * 100)}% conf</span>
        </div>
        {item.scoreReason && <div className="text-[11px] text-[var(--color-faint)] mt-1">{item.scoreReason}</div>}
      </td>
      {columns.map((c) => (
        <td key={c} className="py-3 pr-3 text-[var(--color-ink-soft)] max-w-[160px]">
          {item.attributes[c] ? (
            <span className="break-words">{item.attributes[c]}</span>
          ) : (
            <span className="text-[var(--color-faint)]" title="Not found on the source page">
              not stated
            </span>
          )}
        </td>
      ))}
      <td className="py-3">
        {item.evidenceUrl ? (
          <a
            href={item.evidenceUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[12px] link-underline text-[var(--color-accent-ink)] whitespace-nowrap"
            title={item.evidence}
          >
            {hostOf(item.evidenceUrl)} ↗
          </a>
        ) : (
          <span className="text-[var(--color-faint)] text-[12px]">—</span>
        )}
      </td>
    </tr>
  );
}

function OthersDisclosure({ items, columns }: { items: ResultItem[]; columns: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4">
      <button className="btn-quiet btn text-[12.5px]" onClick={() => setOpen((o) => !o)}>
        {open ? "Hide" : "Show"} {items.length} other option{items.length === 1 ? "" : "s"} (not recommended)
      </button>
      {open && (
        <div className="mt-2 overflow-x-auto fade-up">
          <table className="w-full border-collapse text-[13px]">
            <tbody>
              {items.map((item) => (
                <Row key={item.id} item={item} columns={columns} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ConfBar({ value }: { value: number }) {
  return (
    <span className="inline-block w-10 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--color-line)" }}>
      <span
        className="block h-full rounded-full"
        style={{
          width: `${Math.round(value * 100)}%`,
          background: value > 0.66 ? "var(--color-ok)" : value > 0.4 ? "var(--color-warn)" : "var(--color-err)",
        }}
      />
    </span>
  );
}
