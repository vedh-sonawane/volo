# Volo — Architecture

This document describes how Volo is put together, the abstractions that keep it
provider-agnostic and free-first, and the honesty guarantees baked into the
execution engine.

## Design principles

1. **Free-first, zero-cost.** No paid API, model, database, hosting, search,
   browser, email, SMS, or voice service. No credit card. Anything that would
   require one is either implemented for free, mocked, or isolated behind an
   interface as a declared (non-functional) extension point.
2. **Honest by construction.** The engine never advances a status, records a
   source, or claims an action unless it really happened. Failures end in a
   `failed` state with a human explanation rather than a fabricated result.
3. **Degrades gracefully.** With no AI configured, the product is fully
   functional using deterministic parsing, extraction, and comparison.
4. **Provider-agnostic.** Research and model backends sit behind interfaces; the
   rest of the app depends only on those interfaces.

## High-level flow

```
 Client (Next.js/React)                Server (Next.js route handlers, Node runtime)
 ─────────────────────                 ───────────────────────────────────────────
 Composer ──POST /api/tasks──────────▶ createTask(): understand() + createPlan()
                                       └─ saveTask() → SQLite (+ in-proc live cache)
 Workspace ──GET  /api/tasks/:id──────▶ getTask()
           ──GET  …/:id/stream (SSE)──▶ ensureRun() → runTask(task, emit)
                                          understand → plan → research → extract
                                          → compare → finalize   (emits StreamEvents)
           ──POST …/:id/approve───────▶ approve/reject → safe artifact (never sends)
```

The client reconstructs the `Task` from incremental `StreamEvent`s, and
authoritative snapshots (`task` / `done`) replace the whole object so client
state can't drift from the server's truth.

## Directory map

```
src/
  app/
    page.tsx                     Landing page + primary objective composer
    task/[id]/page.tsx           Task workspace (renders <Workspace/>)
    api/tasks/route.ts           POST create · GET list
    api/tasks/[id]/route.ts      GET one · DELETE
    api/tasks/[id]/stream/route  SSE execution stream (runs the engine)
    api/tasks/[id]/approve/route Approve/reject a gated action (honest)
  components/
    Composer.tsx                 Objective input + examples
    useTaskStream.ts             SSE hook → live Task reconstruction
    workspace/                   Stepper, PlanList, Timeline, Comparison,
                                 Sources, FinalResult, Approvals, Workspace
  lib/
    types.ts                     Shared domain contract (Task, PlanStep, …)
    store.ts                     SQLite persistence + in-process live cache
    ui.ts                        Status/level → colour + label helpers
    providers/
      research/                  ResearchProvider abstraction
        types.ts                 interface: search(), fetch()
        duckduckgo.ts            Free live provider (HTML + Lite fallback)
        mock.ts                  Offline deterministic provider (fixtures)
        extract.ts               HTML → readable text + links (cheerio)
        index.ts                 factory (RESEARCH_PROVIDER)
      model/                     ModelProvider abstraction
        types.ts                 interface: available(), generate()
        rule.ts                  Deterministic degraded provider (no AI)
        ollama.ts                Local, free LLM provider (optional)
        index.ts                 resolveModel() with runtime fallback
    engine/
      understand.ts              Objective → TaskConstraints (deterministic)
      planner.ts                 Constraints → typed PlanStep[]
      domains.ts                 Per-domain column schemas
      extract-structured.ts      Pages → evidence-backed ResultItem[]
      compare.ts                 Filter + rank + rationale
      summarize.ts               Final result (LLM-optional, rule fallback)
      executor.ts                Orchestrates the pipeline, emits events
      create.ts                  Build initial Task
      runner.ts                  Single-run guard + replay for the SSE route
    tools/
      registry.ts                Tool catalogue (name/schema/permission/…)
      email-draft.ts             Local .eml draft (never sends)
```

## Key abstractions

### ResearchProvider (`lib/providers/research`)

```ts
interface ResearchProvider {
  name: string;
  search(query: string, limit?: number): Promise<SearchResult[]>;
  fetch(url: string): Promise<FetchedPage>;   // cleaned readable text + links
}
```

- `duckduckgo` — POSTs to the public DDG HTML endpoint, unwraps redirect links,
  and falls back to the Lite endpoint when the primary returns nothing (helps
  under rate-limiting). Best-effort and free; degrades to empty results rather
  than throwing.
- `mock` — deterministic fixtures for offline development/testing, routed
  through the same `extract.ts` pipeline as live pages.

Adding a new provider = one file + one `case` in the factory. Nothing else
changes.

### ModelProvider (`lib/providers/model`)

```ts
interface ModelProvider {
  name: string;
  available(): Promise<boolean>;
  generate(prompt: string, opts?): Promise<string | null>;  // null ⇒ use rules
}
```

- `rule` — always "unavailable" as a generator; forces deterministic templates.
  This is what guarantees Volo works with zero AI.
- `ollama` — local, free. `resolveModel()` tries the configured provider and
  falls back to `rule` if it can't run, so a stopped Ollama never breaks a task.

The engine **never requires** a model. `summarize.ts` calls the model only to
polish prose and always has a deterministic fallback built from real data.

### Tools & the approval model (`lib/tools`, Phases 7–8)

Every tool declares `name`, `description`, `input`/`output` schema,
`permission` (`research` | `recommend` | `action`), `requiresApproval`,
`implemented`, and `onError`.

- **research / recommend** tools run automatically (`web_search`, `fetch_page`,
  `extract_structured`, `compare`, `draft_email`).
- **action** tools (`send_email`, `submit_form`, `book`) are declared as the
  extension surface but are **not implemented** in the free MVP. Approving one
  produces a safe artifact (draft `.eml`, or exact booking steps) and clearly
  states nothing was sent/booked. This is enforced server-side in the approve
  route — the UI can't bypass it.

## Data & persistence

Tasks are stored as JSON in a single SQLite row (`better-sqlite3`, WAL mode) at
`VOLO_DB_PATH`. An in-process `live` map shares one object identity between the
running engine and concurrent readers, so the SSE stream reflects real state.
No external database, no network storage.

## Honesty guarantees (Phase 9)

- Status advances only after the underlying work actually happens.
- A `Source` is recorded only after the page is really fetched (with word count).
- Each extracted field is scoped to its own option — Volo never borrows a
  neighbouring entity's price/contact/hours.
- Missing values render as "not stated", never guessed.
- Over-budget options are excluded with a stated reason, not hidden.
- Consequential actions never run automatically; the free build cannot send.
- Rate-limited/empty research is reported as such, with next-step guidance.
- Every recommendation links to the exact page its evidence came from.

## Extending Volo (future, opt-in, isolated)

These are intentionally **not** wired to side effects in the free MVP. Each
would be added behind its existing interface/registry entry and gated by
approval:

- Real email sending via a user-provided free SMTP + explicit approval.
- Additional free/open research providers (self-hosted SearXNG, etc.).
- Browser automation for JS-heavy pages (local, headless).
- Calendar drafting/export (`.ics`).

Nothing above is required for the core promise: _objective in, sourced outcome
out, honestly._
