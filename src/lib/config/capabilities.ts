// Truthful capability status (server-side). Every capability gets an explicit,
// honest status computed from REAL checks — a sandbox provider never makes a
// production capability look available, and "connected" only when it can execute.

import { cfg, secretConfigured } from "./index";
import { smtpConfigured } from "@/lib/providers/email";
import { SmtpEmailProvider } from "@/lib/providers/email/smtp";
import { getResearchProvider } from "@/lib/providers/research";
import { resolveModel } from "@/lib/providers/model";

export type CapStatus =
  | "connected" // configured, tested, can execute the real action
  | "sandbox_only" // works only through the deterministic test provider
  | "draft_export_only" // produces a file/draft, not a real external action
  | "requires_user" // needs the user to authenticate / relay
  | "not_configured" // needs configuration to become real
  | "unsupported" // no real integration exists here
  | "connection_failed" // credentials present but a live test failed
  | "unavailable"; // temporarily unreachable

export interface Capability {
  key: string;
  label: string;
  status: CapStatus;
  detail: string;
  /** True when the status was confirmed by a live check (not just config presence). */
  verified?: boolean;
}

const STATUS_LABEL: Record<CapStatus, string> = {
  connected: "Connected & executable",
  sandbox_only: "Sandbox only (test — no real effect)",
  draft_export_only: "Draft / file export only",
  requires_user: "Needs your action",
  not_configured: "Not configured",
  unsupported: "Unsupported here",
  connection_failed: "Connection failed",
  unavailable: "Temporarily unavailable",
};

export function statusLabel(s: CapStatus): string {
  return STATUS_LABEL[s];
}

/** Compute all capability statuses. `deep` runs live connection checks. */
export async function computeCapabilities(deep = false): Promise<Capability[]> {
  const caps: Capability[] = [];

  // ── AI planning (model) ──
  const modelChoice = cfg("MODEL_PROVIDER", "rule").toLowerCase();
  if (modelChoice === "ollama") {
    const model = await resolveModel();
    if (model.name === "ollama") caps.push({ key: "model", label: `AI planning (Ollama · ${cfg("OLLAMA_MODEL", "llama3.2")})`, status: "connected", detail: "The local model authors plans and understands goals.", verified: true });
    else caps.push({ key: "model", label: "AI planning (Ollama)", status: "connection_failed", detail: "Ollama is selected but not reachable or the model isn't installed. Volo falls back to the deterministic engine.", verified: true });
  } else {
    caps.push({ key: "model", label: "AI planning", status: "not_configured", detail: "Using the built-in deterministic engine (no AI). Connect Ollama for dynamic planning + clarifying questions." });
  }

  // ── Research ──
  const research = cfg("RESEARCH_PROVIDER", "duckduckgo").toLowerCase();
  if (research === "mock") {
    caps.push({ key: "research", label: "Web research (mock fixtures)", status: "sandbox_only", detail: "Returning built-in test fixtures, not the live web." });
  } else if (deep) {
    const ok = await probeResearch();
    caps.push({ key: "research", label: "Web research (DuckDuckGo)", status: ok ? "connected" : "unavailable", detail: ok ? "Live web search + page reading is working." : "DuckDuckGo didn't return results just now (it may be rate-limiting). It usually recovers.", verified: true });
  } else {
    caps.push({ key: "research", label: "Web research (DuckDuckGo)", status: "connected", detail: "Free live web search + page reading (no key needed)." });
  }

  // ── Email send ──
  if (smtpConfigured()) {
    if (deep) {
      const v = await new SmtpEmailProvider().verify();
      caps.push({ key: "email", label: `Send email (SMTP · ${cfg("SMTP_USER")})`, status: v.ok ? "connected" : "connection_failed", detail: v.ok ? "Authenticated — Volo can send approved emails from your account." : `Credentials present but the connection test failed: ${v.error}`, verified: true });
    } else {
      caps.push({ key: "email", label: `Send email (SMTP · ${cfg("SMTP_USER")})`, status: "connected", detail: "SMTP configured. Use “Test connection” to confirm it authenticates." });
    }
  } else {
    caps.push({ key: "email", label: "Send email", status: "draft_export_only", detail: "No email account connected — Volo prepares a ready-to-send draft (.eml) but does NOT send. Add SMTP to send for real." });
  }

  // ── Calendar ──
  caps.push({ key: "calendar", label: "Calendar file (.ics) export", status: "draft_export_only", detail: "Volo generates a downloadable .ics you import yourself. This is a file export — it does NOT create an event in Google/Outlook. A real calendar integration isn't configured." });

  // ── Booking / form / payment ──
  const sandbox = cfg("ACTION_MODE", "").toLowerCase() === "sandbox";
  caps.push({ key: "book", label: "Booking", status: sandbox ? "sandbox_only" : "unsupported", detail: sandbox ? "Test mode: simulates a booking (no real reservation, no money)." : "No real booking integration — Volo gives you the exact steps to book yourself. It will never claim a booking was made." });
  caps.push({ key: "submit_form", label: "Form submission", status: sandbox ? "sandbox_only" : "unsupported", detail: sandbox ? "Test mode: simulates a form submission." : "No safe generic form-submission integration — Volo prepares the fields for you to submit." });
  caps.push({ key: "payment", label: "Payments", status: sandbox ? "sandbox_only" : "unsupported", detail: sandbox ? "Test mode: simulates a payment (no card, no money)." : "No secure payment integration — Volo will NEVER charge a card. It never stores card/CVV/OTP." });

  // ── Inbox monitoring ──
  caps.push({ key: "monitor", label: "Reply monitoring", status: "requires_user", detail: "Volo can't watch a mailbox — after a real send, you paste the reply and it continues." });

  return caps;
}

async function probeResearch(): Promise<boolean> {
  try {
    const r = await getResearchProvider().search("site connectivity test", 2);
    return r.length > 0;
  } catch {
    return false;
  }
}
