// Concrete action providers, all implementing the one ActionProvider contract.

import type { ActionResult } from "@/lib/types";
import type { ActionInput, ActionProvider } from "./types";
import { getEmailProvider } from "@/lib/providers/email";
import { draftEmail } from "@/lib/tools/email-draft";
import { makeIcs } from "@/lib/tools/ics";

function now(): number {
  return Date.now();
}

/** A real email address (rejects placeholders / phone numbers / example.com). */
function isRealEmail(addr: string): boolean {
  if (!addr) return false;
  if (/\[|\]|add the provider|example\.com|not found|recipient@|the provider/i.test(addr)) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(addr.trim());
}

// ── Email: real send via the user's own SMTP ─────────────────────────────────
export class SmtpEmailAction implements ActionProvider {
  readonly capability = "send_email" as const;
  readonly name = "smtp";
  async available() {
    return getEmailProvider().name === "smtp" && (await getEmailProvider().available());
  }
  validate(input: ActionInput) {
    if (!isRealEmail(input.target)) return { ok: false, error: `No valid recipient email (got "${input.target}").` };
    return { ok: true };
  }
  async execute(input: ActionInput): Promise<ActionResult> {
    const res = await getEmailProvider().send({
      to: input.target,
      subject: String(input.payload.subject || `Enquiry`),
      body: String(input.payload.body || input.summary),
    });
    if (res.sent) return { status: "succeeded", message: res.message, confirmation: res.id, at: now() };
    return { status: "failed", message: res.message, artifact: draftEmail({ to: input.target, subject: String(input.payload.subject || "Enquiry"), body: String(input.payload.body || input.summary) }), at: now() };
  }
}

// ── Email: honest draft-only fallback (never sends) ──────────────────────────
export class LocalDraftEmailAction implements ActionProvider {
  readonly capability = "send_email" as const;
  readonly name = "local-draft";
  async available() {
    return true;
  }
  validate() {
    return { ok: true };
  }
  async execute(input: ActionInput): Promise<ActionResult> {
    const draft = draftEmail({
      to: input.target,
      subject: String(input.payload.subject || "Enquiry"),
      body: String(input.payload.body || input.summary),
    });
    return {
      status: "requires_user",
      message: "No email account is configured, so nothing was sent. A ready-to-send draft (.eml) is provided — set SMTP_* in .env to let Volo send for you.",
      artifact: draft,
      at: now(),
    };
  }
}

// ── Calendar: real local .ics generation (free, no account) ──────────────────
export class IcsCalendarAction implements ActionProvider {
  readonly capability = "calendar_event" as const;
  readonly name = "ics";
  async available() {
    return true;
  }
  validate(input: ActionInput) {
    if (!input.summary) return { ok: false, error: "No event details to put in the calendar file." };
    return { ok: true };
  }
  async execute(input: ActionInput): Promise<ActionResult> {
    const ics = makeIcs(
      { title: String(input.payload.title || input.summary).slice(0, 80), location: input.payload.location ? String(input.payload.location) : undefined, description: input.summary, durationMinutes: 60 },
      new Date()
    );
    return {
      status: "succeeded",
      message: "Exported a calendar file (.ics) — download and import it yourself. This is a file export, NOT an event created in a calendar service (Google/Outlook).",
      confirmation: "ics-exported",
      artifact: { ics, filename: "volo-event.ics" },
      at: now(),
    };
  }
}

// ── Sandbox: deterministic test double for real external actions ─────────────
// Drives the SAME orchestration as production, replacing only the side effect.
// It returns realistic structured outcomes based on the input so every path
// (success / failure / timeout-uncertain / auth-required) is testable without
// real money or irreversible bookings. Enable with ACTION_MODE=sandbox.
export class SandboxAction implements ActionProvider {
  constructor(readonly capability: ActionInput["capability"]) {}
  readonly name = "sandbox";
  async available() {
    return true;
  }
  validate(input: ActionInput) {
    if (!input.target || /\[|\]|add the|not found|placeholder/i.test(input.target)) {
      return { ok: false, error: `Refusing to act on a placeholder target ("${input.target}").` };
    }
    if ((this.capability === "payment" || this.capability === "book") && !input.financial) {
      return { ok: false, error: "A financial action needs an explicit quote (total, currency) before it can run." };
    }
    return { ok: true };
  }
  async execute(input: ActionInput): Promise<ActionResult> {
    const probe = `${input.target} ${JSON.stringify(input.payload)}`.toLowerCase();
    // Deterministic scenario selection from the input (for tests).
    if (/\btimeout\b|\buncertain\b/.test(probe)) {
      return { status: "uncertain", message: "The provider did not confirm in time. The action MAY have gone through — Volo will not retry (to avoid a duplicate). Verify before acting again.", at: now() };
    }
    if (/\b3ds\b|\botp\b|\bauth\b|captcha|verify/.test(probe)) {
      return { status: "requires_user", message: "The provider requires you to authenticate (e.g. 3-D Secure / OTP). Volo paused safely — complete it in the provider's secure flow, never here.", at: now() };
    }
    if (/\bdecline\b|\bfail\b|\berror\b|insufficient/.test(probe)) {
      return { status: "failed", message: "The provider declined the request. Nothing was charged or booked. Safe to try again.", at: now() };
    }
    // Success — a realistic confirmation reference (fake, but structured).
    const ref = `SBX-${this.capability.toUpperCase()}-${Math.abs(hash(input.idempotencyKey)).toString(36).toUpperCase()}`;
    const money = input.financial ? ` ${input.financial.currency} ${input.financial.total}${input.financial.fees ? ` (+${input.financial.fees} fees)` : ""}` : "";
    return { status: "succeeded", message: `[SANDBOX] ${labelFor(this.capability)} completed${money}. Confirmation ${ref}. (Test provider — no real money moved.)`, confirmation: ref, at: now() };
  }
}

// ── Unsupported: honest production placeholder (no real integration) ─────────
export class UnsupportedAction implements ActionProvider {
  constructor(readonly capability: ActionInput["capability"], private note: string) {}
  readonly name = "unsupported";
  async available() {
    return true; // it can always run — it just honestly reports "unsupported"
  }
  validate() {
    return { ok: true };
  }
  async execute(input: ActionInput): Promise<ActionResult> {
    return {
      status: "unsupported",
      message: this.note,
      artifact: { steps: stepsFor(this.capability, input.target), target: input.target },
      at: now(),
    };
  }
}

function labelFor(c: string): string {
  return { send_email: "Email send", calendar_event: "Calendar event", book: "Booking", submit_form: "Form submission", payment: "Payment" }[c] || c;
}

function stepsFor(capability: string, target: string): string[] {
  const where = target ? `: ${target}` : "";
  if (capability === "submit_form") {
    return [`Open the form${where}.`, "Fill in the fields Volo prepared.", "Review carefully — especially anything irreversible.", "Submit it yourself."];
  }
  if (capability === "payment") {
    return ["Volo can't take payments without a configured, secure payment integration.", "Complete the payment yourself on the provider's site.", "Never paste card numbers, CVVs, or one-time codes into Volo."];
  }
  return [`Open the booking page${where}.`, "Select your date/time and options.", "Review the total and cancellation policy.", "Confirm the booking yourself — Volo never commits money on your behalf without a real integration."];
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
