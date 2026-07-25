"use client";

import { useEffect, useRef, useState } from "react";
import type { StreamEvent, Task } from "@/lib/types";

interface State {
  task: Task | null;
  connected: boolean;
  error: string | null;
}

/**
 * Loads a task and subscribes to its live execution stream, reconstructing the
 * Task from incremental events. Authoritative snapshots ("task"/"done") replace
 * the whole object so client state can never drift from the server's truth.
 */
export function useTaskStream(taskId: string) {
  const [state, setState] = useState<State>({ task: null, connected: false, error: null });
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let cancelled = false;

    // 1) Load the current snapshot immediately (fast first paint).
    fetch(`/api/tasks/${taskId}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.task) setState((s) => ({ ...s, task: d.task }));
      })
      .catch(() => {});

    // 2) Open the live stream (also triggers execution if not started).
    const es = new EventSource(`/api/tasks/${taskId}/stream`);
    esRef.current = es;

    es.onopen = () => setState((s) => ({ ...s, connected: true }));
    es.onmessage = (ev) => {
      if (cancelled) return;
      let event: StreamEvent;
      try {
        event = JSON.parse(ev.data);
      } catch {
        return;
      }
      setState((s) => ({ ...s, task: apply(s.task, event), error: event.type === "error" ? event.message : s.error }));
    };
    es.addEventListener("end", () => {
      es.close();
      setState((s) => ({ ...s, connected: false }));
    });
    es.onerror = () => {
      // EventSource auto-reconnects; mark disconnected but keep last state.
      setState((s) => ({ ...s, connected: false }));
      es.close();
    };

    return () => {
      cancelled = true;
      es.close();
    };
  }, [taskId]);

  return state;
}

function apply(prev: Task | null, e: StreamEvent): Task | null {
  if (e.type === "task" || e.type === "done") return e.task;
  if (!prev) return prev;
  const t: Task = { ...prev };
  switch (e.type) {
    case "status":
      t.status = e.status;
      break;
    case "timeline":
      if (!t.timeline.some((x) => x.id === e.event.id)) t.timeline = [...t.timeline, e.event];
      break;
    case "step":
      t.plan = t.plan.map((s) => (s.id === e.step.id ? e.step : s));
      break;
    case "source":
      if (!t.sources.some((x) => x.url === e.source.url)) t.sources = [...t.sources, e.source];
      break;
    case "results":
      t.results = e.results;
      break;
    case "comparison":
      t.comparison = e.comparison;
      break;
    case "approval":
      if (!t.approvals.some((a) => a.id === e.approval.id)) t.approvals = [...t.approvals, e.approval];
      break;
    case "final":
      t.finalResult = e.final;
      break;
  }
  return t;
}
