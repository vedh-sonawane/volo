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

## Execution model: a tool-driven engine (not a research pipeline)

Volo is an **objective-execution engine**. Web research is not the product — it
is a handful of tools among many. The flow is:

```
Objective → Understand → Plan (select + sequence tools) → Execute (generic loop)
          → Approve consequential actions → (wait) → Report
```

- **Tools** (`src/lib/tools/kit.ts`) — every capability implements one
  `ExecutableTool` interface (`run`, `permission`, `requiresApproval`,
  `implemented`, `onError`). Tools share a per-run **blackboard** so outputs flow
  between them (search URLs → fetched pages → candidates → comparison → draft).
  - Implemented, free, automatic: `reason`, `web_search`, `fetch_page`,
    `read_document`, `extract_structured`, `compare`, `draft_email`.
  - Declared but **not** implemented (honest, approval-gated): `send_email`,
    `submit_form`, `book`, `monitor_inbox`, `calendar_event`.
- **Planner** (`src/lib/engine/planner.ts`) — `createPlan` dynamically SELECTS
  and SEQUENCES tools from the objective's outcome + detected **action intent**
  (`detectActions` in `classify.ts`). Different objectives yield different plans:
  - "find an instructor" → `reason → search → fetch → extract → compare`
  - "…and get me booked" → adds `draft_email → book (approval) → monitor_inbox`
  - "get me a refund" (procedure) → `… → draft_email → send_email (approval) → monitor_inbox`
  - "cancel my subscription" → `… → draft_email → submit_form (approval) → monitor_inbox`
  - an objective containing a URL → `read_document` instead of search.
- **Engine** (`src/lib/engine/executor.ts`) — a GENERIC loop that walks the plan
  and dispatches each step to its tool. It knows nothing about "research". When
  it reaches a tool with `requiresApproval`, it stops, turns that step into an
  `ApprovalRequest`, and the objective enters `awaiting_approval`. On approval,
  a not-implemented action produces a safe artifact (draft `.eml` / exact steps)
  — it is never faked.

Adding a new capability = add one entry to `KIT` and let the planner select it.
No `if (objectiveType === …)` anywhere.

### General goal understanding + clarification (BL-2)

Volo interprets messy, underspecified goals instead of requiring a fully-formed
prompt. The pipeline is:

```
Goal → Understanding (goal model) → Missing-info gate → Plan → DAG execution
     → Combine/join → Constraint eval → Ranking → Approval → Action → Verify
```

- **Goal model** (`src/lib/engine/goal.ts`, `GoalModel`): the model extracts a
  plain-language summary, **hard constraints** (must hold → filter), **soft
  preferences** (nice → rank, never filter), **assumptions**, and
  **missing-information** items each classified `blocking` / `optional` /
  `researchable`. Domain-agnostic — no `if (insurance) ask year`. With no model,
  a deterministic goal model is derived from parsed constraints and **never
  blocks** (zero-AI path unchanged).
- **Minimum-clarification gate** (`executor.planPhase`): if there are `blocking`
  gaps and the user hasn't answered yet, the objective pauses in
  `awaiting_clarification` and asks **only those** questions (optional /
  researchable gaps are handled automatically — Volo doesn't interrogate).
  `POST /api/tasks/[id]/clarify` merges the answers into the effective objective,
  resets to a runnable state, and the reopened stream **re-plans with the
  answers** (reusing the same persist/resume machinery as Phase 9). It asks at
  most once — after answers it proceeds even if still uncertain, noting
  assumptions.
- **Hard vs soft in ranking**: hard constraints filter (e.g. the budget in
  `compare`/`combine`); soft preferences add a generic keyword-match bonus to a
  candidate's score (`compare.softPrefMatches`), which the combine stage inherits
  via per-pick scores. Transparent in the UI ("Understanding" panel: must / prefer
  / assuming).
- **Multi-domain decomposition + join** (already in place): the model splits a
  combinatorial goal into category sub-plans; `combine_domains` evaluates
  cross-category combinations under the shared budget and ranks with trade-offs.
- **Parallel DAG execution** (`executor.executeMultiDomain`): independent category
  sub-plans run **concurrently** (each in its own pinned scope via `scopedCtx`),
  then the combine + action steps run sequentially (so approval/wait checkpoints
  still work). Single-domain objectives use the unchanged sequential loop.

Everything feeds the existing approval, action (Phase 10), persistence, and
outcome layers — this is an extension of the planner/executor, not a parallel
system.

### Real actions, safety & idempotency (Phase 10 hardening)

Every consequential side effect goes through one capability contract
(`src/lib/actions/`): `ActionProvider { available, validate, execute }` with a
structured `ActionResult { status, message, confirmation, artifact }`. Status is
honest and rich — `succeeded` (with a provider confirmation), `failed`,
`uncertain` (timeout — may have happened; never auto-retried), `requires_user`
(auth/3DS/OTP → handed to the user's secure flow), `unsupported` (no integration
→ safe fallback steps), `duplicate` (idempotency hit).

- **Providers share the contract**: real (`SmtpEmailAction`, `IcsCalendarAction`),
  an honest `LocalDraftEmailAction`/`UnsupportedAction` fallback, and a
  deterministic `SandboxAction` for testing. `ACTION_MODE=sandbox` swaps in the
  sandbox for booking/form/payment — **only the external side effect changes**,
  the approval → validate → execute → verify → record pipeline is identical.
- **`executeAction`** (`src/lib/actions/index.ts`) enforces **idempotency** via a
  per-task ledger keyed by `${taskId}:${approvalId}`: a `succeeded`/`uncertain`
  action is never re-executed (no duplicate charge/booking); `failed` stays
  retryable; `unsupported`/`requires_user` don't lock the key.
- **Financial safety**: booking approvals carry a `FinancialQuote` (total,
  currency, fees, refund policy) shown for explicit confirmation of the *specific*
  charge. Volo stores **no** card numbers/CVVs/OTPs anywhere; auth happens in the
  provider's secure flow. A financial action without a quote is refused.
- **Target validation**: placeholder/malformed targets (e.g. `[add the …]`) are
  refused before execution. The approve route (`/api/tasks/[id]/approve`) drives
  this pipeline and reports the true outcome; nothing is ever reported as
  "succeeded" because the model wrote text saying so.
- **Tested** (`npm test`): success, failure, timeout→uncertain, auth-required,
  duplicate, placeholder-blocked, financial-required, and unsupported — plus a
  live sandbox booking through the real HTTP endpoint (confirmation + idempotency).

### Persistence & resume (Phase 9)

Objectives genuinely pause and resume, surviving restarts (state lives in SQLite):
- The engine stops at two persistent checkpoints — a tool that needs approval
  (`awaiting_approval`) or a `monitor_inbox` wait with no reply yet
  (`waiting_response`). Both fully persist `Task.plan` step statuses + `Task.waiting`.
- `runTask` plans+executes from the start; **`resumeTask`** continues from the
  first unfinished step with **no re-planning**. Approving an action
  (`POST …/approve`) marks the step done and calls `resumeTask`, which advances
  to the wait. Relaying a reply (`POST …/reply`) records an `externalEvent`,
  clears `Task.waiting`, and `resumeTask` consumes it to finish.
- Honesty: Volo can't watch a real inbox for free, so `monitor_inbox` waits for
  the **user to relay** the reply rather than faking inbox monitoring. Nothing is
  ever marked done that didn't happen.

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
