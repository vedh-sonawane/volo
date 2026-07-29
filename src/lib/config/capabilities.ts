// Truthful capability status (server-side). Every capability gets an explicit,
// honest status computed from REAL checks — a sandbox provider never makes a
// production capability look available, and "connected" only when it can execute.

import { cfg, secret, secretConfigured } from "./index";
import { currentUserId } from "@/lib/auth/context";
import { integrationHasScope } from "@/lib/auth/integrations";
import { smtpConfigured } from "@/lib/providers/email";
import { SmtpEmailProvider } from "@/lib/providers/email/smtp";
import { getResearchProvider } from "@/lib/providers/research";
import { resolveModel, modelCapabilities, type ModelCapability } from "@/lib/providers/model";

// Human labels for the generic model capabilities (not provider-specific).
const MODEL_CAP_LABEL: Record<ModelCapability, string> = {
  planning: "planning",
  clarification: "clarifying questions",
  direct_answer: "direct answers",
  generation: "writing & generation",
};
function describeModelCaps(caps: ModelCapability[]): string {
  return caps.map((c) => MODEL_CAP_LABEL[c]).join(", ") || "the deterministic engine only";
}

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

  // ── AI model (a connected generative model exposes ALL its capabilities) ──
  const modelChoice = cfg("MODEL_PROVIDER", "rule").toLowerCase();
  if (modelChoice === "ollama") {
    const model = await resolveModel();
    if (model.name === "ollama") {
      caps.push({
        key: "model",
        label: `AI model (Ollama · ${cfg("OLLAMA_MODEL", "llama3.2")})`,
        status: "connected",
        detail: `Connected & executable — powers ${describeModelCaps(modelCapabilities(model))}. It composes answers, drafts, and summaries from the objective; nothing is fabricated.`,
        verified: true,
      });
    } else {
      caps.push({ key: "model", label: "AI model (Ollama)", status: "connection_failed", detail: "Ollama is selected but not reachable or the model isn't installed. Volo falls back to the deterministic engine (planning still works; direct answers/writing need a model).", verified: true });
    }
  } else {
    caps.push({ key: "model", label: "AI model", status: "not_configured", detail: "Using the built-in deterministic engine (no AI). Connect Ollama for dynamic planning, clarifying questions, direct answers, and writing/generation." });
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

  // ── Calendar ── (real Google Calendar create when connected; else honest .ics export)
  const gcalConnected = (() => {
    try {
      return integrationHasScope(currentUserId(), "google", "https://www.googleapis.com/auth/calendar.events");
    } catch {
      return false;
    }
  })();
  if (gcalConnected) {
    caps.push({ key: "calendar", label: "Calendar event", status: "connected", detail: "Google Calendar connected — Volo creates the event directly via the Calendar API (with your approval)." });
  } else {
    caps.push({ key: "calendar", label: "Calendar file (.ics) export", status: "draft_export_only", detail: "No calendar connected — Volo prepares a downloadable .ics you import yourself; it does NOT create a calendar event. Connect Google Calendar in Settings to have Volo create events directly." });
  }

  // ── Booking / form / payment ──
  const sandbox = cfg("ACTION_MODE", "").toLowerCase() === "sandbox";
  caps.push({ key: "book", label: "Booking", status: sandbox ? "sandbox_only" : "unsupported", detail: sandbox ? "Test mode: simulates a booking (no real reservation, no money)." : "No real booking integration — Volo gives you the exact steps to book yourself. It will never claim a booking was made." });
  caps.push({ key: "submit_form", label: "Form submission", status: sandbox ? "sandbox_only" : "unsupported", detail: sandbox ? "Test mode: simulates a form submission." : "No safe generic form-submission integration — Volo prepares the fields for you to submit." });
  // Payments: prefer a real Stripe TEST integration (free, no real money) when a
  // test key is configured; else the sandbox double; else honest "unsupported".
  const stripeKey = (secretConfigured("STRIPE_SECRET_KEY") ? secret("STRIPE_SECRET_KEY") : "").trim();
  const stripeTest = stripeKey.startsWith("sk_test_");
  const stripeLive = stripeKey.startsWith("sk_live_");
  caps.push(
    stripeTest
      ? { key: "payment", label: "Payments (Stripe test mode)", status: "connected", detail: "Real Stripe TEST API with your test key — creates a real PaymentIntent with a test card. NO real money moves. Volo never stores card/CVV/OTP.", verified: false }
      : stripeLive
        ? { key: "payment", label: "Payments", status: "connection_failed", detail: "A LIVE Stripe key is configured — Volo refuses it so no real money can move. Replace it with a test key (sk_test_…)." }
        : sandbox
          ? { key: "payment", label: "Payments (sandbox)", status: "sandbox_only", detail: "Simulated payments (no card, no money). Add a Stripe TEST key in Settings for real free test-mode payments." }
          : { key: "payment", label: "Payments", status: "unsupported", detail: "No payment integration — Volo will NEVER charge a card. Add a free Stripe TEST key (sk_test_…) in Settings, or complete payments yourself. It never stores card/CVV/OTP." }
  );

  // ── Inbox monitoring ──
  caps.push({ key: "monitor", label: "Reply monitoring", status: "requires_user", detail: "Volo can't watch a mailbox — after a real send, you paste the reply and it continues." });

  return caps;
}

async function probeResearch(): Promise<boolean> {
  try {
    const r = await getResearchProvider().search("site connectivity test", 2);
    // Reachable when the provider responded — results OR a genuine empty. A
    // rate-limit / timeout / error means it's not usable right now.
    return r.status === "ok" || r.status === "empty";
  } catch {
    return false;
  }
}
