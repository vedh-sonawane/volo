# Volo — Backlog

Tracked gaps and follow-ups, tied to their implementation phase. Logging here
does **not** interrupt the current roadmap; items are picked up in their phase.

---

## UI/UX interactions (design/interaction polish)

> Note: this is presentation polish, orthogonal to the execution roadmap
> (persistent-objectives Phases 1–10, of which 1–8 are done and 9–10 remain).
> It does not carry a roadmap phase number; pick it up during UI polish.

### BL-1 · "Next action" labels have no interactive control
**Status:** open · **Severity:** minor (cosmetic/interaction) · **Backend:** unaffected

**Observed:** A completed objective shows **"Next: You — Review the outcome"**
(and failed shows "Review why it stopped…"), but there is no actual button or
control to *perform* that next action. The system describes a user action
without offering an interaction for it. Candidate rows likewise have no
"select/choose" control to advance the objective toward contacting/booking a
specific option.

**Scope / where it lives (no changes made now):**
- `src/lib/ui.ts` → `nextActionFor()` returns `{ label, actor: "user" }` for
  `completed` ("Review the outcome") and `failed` states.
- `src/components/workspace/Workspace.tsx` → `NextActionBar` renders that label
  as **passive text only**.
- `src/components/workspace/Comparison.tsx` → recommended rows show data but no
  per-row action (e.g. "Choose this one").
- Note: approval actions are **not** affected — `Approvals` already renders real
  Approve/Decline buttons wired to `POST /api/tasks/[id]/approve`.

**Desired behaviour (when implemented in Phase 11):**
- `actor: "user"` next-actions should render an actionable control, not just a
  sentence. Examples:
  - completed → a CTA that scrolls to / highlights the outcome, or offers a
    concrete follow-up ("Contact the top option", "Start a related objective").
  - a recommended candidate → a **"Choose this one"** button that creates the
    contact/book approval scoped to that specific candidate.
  - failed → a **"Retry"** / **"Refine objective"** control.

**Constraints:**
- Must map to **real** backend behaviour — no faked actions. `approve` already
  exists; "select a candidate" or "retry" would need small, real endpoints.
- Objective state machine and backend logic stay intact; this is presentation +
  a thin interaction layer only.

**Acceptance:** every `actor: "user"` next-action in the workspace has a working
control that performs (or honestly prepares) the described action.

---

## Planner (later improvement — do not redesign mid-roadmap)

### BL-2 · Multi-domain / combinatorial objectives are mis-shaped
**Status:** ✅ RESOLVED — the LLM planner now decomposes into category sub-plans,
executes them as a dependency-aware DAG (each in its own scope), and runs a
generic `combine_domains` join under the shared budget. See
`src/lib/engine/{combine.ts,planner.ts:buildMultiPlan,llm-planner.ts:authorPlan}`,
scoped tools in `kit.ts`, and `MultiDomain.tsx`. Verified E2E (flight+campsite
under $300 → ranked combinations) + unit-tested join + single-domain regression.
The deterministic fallback stays single-domain (honest). Original notes kept:
**Severity (was):** significant (correctness on complex objectives)

**Observed (test objective):** a family trip "Toronto → NYC, 4 people, first week
of August, under CAD $3,500, 4 nights, compare driving/bus/train AND compare
hotels/apartments, rank the best *combination*…" was classified as a generic
`procedure`/how-to objective, so the deterministic fallback searched for travel
*guides* instead of independently researching transportation and accommodation
as separate research domains and comparing combinations.

**Why it happens:** `classify.ts` produces a single `outcome` + single
`entityLabel`, and the planner emits one linear research→extract→compare chain.
It has no notion of an objective spanning **multiple research domains**, of
**cross-option comparison** (transport × accommodation), of **constraints across
a combined option** (sum of both under a budget), or of **dependent actions**.

**Desired (future):** objectives should be decomposable into sub-objectives, each
with its own research/extract/compare, then a **combination/ranking** stage that
enforces joint constraints (e.g. transport + lodging ≤ budget) and explains
trade-offs. The LLM planner is the natural place to author this DAG (sub-plans +
a join step). Keep the deterministic fallback simple; this is an LLM-planner
enhancement, not an architecture change.

**Constraint:** do not fake it — if it can't research a domain, say so per domain.

### BL-3 · Action generated without a valid selected option
**Status:** open · **Severity:** minor (execution validation) · addressed during
later action hardening (partly guarded in Phase 10)

**Observed:** a `book`/action step + approval was generated even though no
candidate/booking option had been selected, producing a placeholder target
`[add the provider's email]`.

**Desired:** an action tool should only be planned/surfaced when a concrete
target exists (a selected candidate with a real contact/booking handle), or it
should explicitly require the user to choose an option first. A real action must
refuse to run against a placeholder target and fall back to a draft.
> Phase 10 adds the "refuse to send to a placeholder recipient → draft instead"
> guard; the planning-time "don't generate an action without a selection" part
> remains open here.
