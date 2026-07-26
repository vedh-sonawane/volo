// Action registry + the idempotent execution orchestrator.
//
// Provider selection is config-driven (no hardcoded "if book then …" in the
// engine): a real provider when a secure integration exists, a sandbox provider
// in test mode, and an honest "unsupported" provider otherwise. Production and
// test share the exact same execute pipeline below.

import type { ActionResult, Task } from "@/lib/types";
import type { ActionInput, ActionProvider } from "./types";
import { getEmailProvider } from "@/lib/providers/email";
import { cfg } from "@/lib/config";
import { IcsCalendarAction, LocalDraftEmailAction, SandboxAction, SmtpEmailAction, UnsupportedAction } from "./providers";

export type { ActionInput, ActionProvider } from "./types";

/** Sandbox mode routes not-yet-real capabilities through a deterministic test double. */
function sandboxMode(): boolean {
  return cfg("ACTION_MODE", "").toLowerCase() === "sandbox";
}

export function resolveActionProvider(capability: ActionInput["capability"]): ActionProvider {
  switch (capability) {
    case "send_email":
      if (getEmailProvider().name === "smtp") return new SmtpEmailAction();
      if (sandboxMode()) return new SandboxAction("send_email");
      return new LocalDraftEmailAction();
    case "calendar_event":
      return new IcsCalendarAction();
    case "book":
      return sandboxMode()
        ? new SandboxAction("book")
        : new UnsupportedAction("book", "Real booking isn't enabled — Volo has no secure booking integration configured, so it will NOT pretend to book. Here are the exact steps to book it yourself. (Set ACTION_MODE=sandbox to exercise the booking flow in test mode.)");
    case "submit_form":
      return sandboxMode()
        ? new SandboxAction("submit_form")
        : new UnsupportedAction("submit_form", "Automated form submission isn't enabled (no safe generic integration). Volo prepared the fields for you to submit yourself.");
    case "payment":
      return sandboxMode()
        ? new SandboxAction("payment")
        : new UnsupportedAction("payment", "Payments require a secure, tokenized payment integration that isn't configured. Volo will NEVER charge a card without one. Complete the payment yourself; never share card/CVV/OTP with Volo.");
    default:
      return new UnsupportedAction(capability, "This capability isn't supported.");
  }
}

/**
 * Execute an action AT MOST ONCE. Idempotency is enforced via the task ledger:
 * if this key already has a terminal result (succeeded/uncertain), we return it
 * WITHOUT re-executing — critical so a retry can never cause a duplicate charge
 * or booking. `uncertain` outcomes are recorded precisely so they are never
 * auto-retried; the user must verify.
 */
export async function executeAction(task: Task, input: ActionInput): Promise<ActionResult> {
  task.executedActions = task.executedActions || {};
  const prior = task.executedActions[input.idempotencyKey];
  if (prior && (prior.status === "succeeded" || prior.status === "uncertain")) {
    return { ...prior, status: "duplicate", message: `Already executed — not repeated (idempotent). Previous outcome: ${prior.status}. ${prior.message}` };
  }

  const provider = resolveActionProvider(input.capability);

  const v = provider.validate(input);
  if (!v.ok) {
    return { status: "failed", message: v.error || "Invalid action input — refused for safety.", at: Date.now() };
  }
  if (!(await provider.available())) {
    return { status: "unsupported", message: `The ${input.capability} capability isn't available in this configuration.`, at: Date.now() };
  }

  const result = await provider.execute(input);
  // Record only outcomes that had (or may have had) a real side effect, so those
  // are never repeated. `failed` stays retryable; `unsupported`/`requires_user`
  // don't lock the key (the user can configure/authenticate then retry).
  if (result.status === "succeeded" || result.status === "uncertain") {
    task.executedActions[input.idempotencyKey] = result;
  }
  return result;
}
