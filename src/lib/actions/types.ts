// ─────────────────────────────────────────────────────────────────────────────
// Action capability contract (Phase 10 hardening).
//
// Every real-world side effect Volo can perform (send an email, create a
// calendar event, make a booking, submit a form, take a payment) goes through
// ONE interface. The SAME contract is implemented by:
//   • real production providers (e.g. SMTP send, local .ics),
//   • a deterministic SANDBOX provider for safe end-to-end testing, and
//   • an honest "unsupported" provider when no real integration exists.
//
// This means the approval → validate → execute → verify → record pipeline is
// identical in test and production; test doubles replace only the external side
// effect, never the orchestration.
// ─────────────────────────────────────────────────────────────────────────────

import type { ActionCapability, ActionResult, FinancialQuote } from "@/lib/types";

export interface ActionInput {
  capability: ActionCapability;
  /** The concrete target (recipient email, booking endpoint, …). */
  target: string;
  /** Human summary of exactly what will happen. */
  summary: string;
  /** Structured payload (subject/body, booking details, form fields, …). */
  payload: Record<string, unknown>;
  /** `${taskId}:${approvalId}` — guarantees at-most-once execution. */
  idempotencyKey: string;
  /** Present for money-moving actions; must be shown + confirmed first. */
  financial?: FinancialQuote;
}

export interface ActionProvider {
  readonly capability: ActionCapability;
  /** Provider id for transparency ("smtp", "sandbox", "ics", "unsupported"…). */
  readonly name: string;
  /** Whether this provider can actually perform the action right now. */
  available(): Promise<boolean>;
  /** Validate inputs (real target, no placeholders, financial terms present). */
  validate(input: ActionInput): { ok: boolean; error?: string };
  /** Perform the action and return a structured, honest result. */
  execute(input: ActionInput): Promise<ActionResult>;
}
