// A fast, synchronous snapshot of which capabilities are usable RIGHT NOW.
//
// Kept separate from paths.ts (which is pure) so the path reasoner stays easy to
// test, and so the config/provider imports live in one place. Generic: it reports
// capability availability, never anything domain-specific. "communicate" is always
// available because it can honestly degrade to a ready-to-send draft when no real
// channel is connected; the detail line says which.

import type { CapabilityStatus } from "@/lib/types";
import { cfg } from "@/lib/config";
import { getEmailProvider } from "@/lib/providers/email";
import { currentUserId } from "@/lib/auth/context";
import { getIntegrationMeta } from "@/lib/auth/integrations";

function has(provider: string, scopeIncludes: string): boolean {
  try {
    const m = getIntegrationMeta(currentUserId(), provider);
    return !!m && m.scopes.some((s) => s.includes(scopeIncludes));
  } catch {
    return false;
  }
}

/**
 * A snapshot of what Volo can do right now. `modelGenerative` (from the resolved
 * model) determines the MODEL-BACKED capabilities honestly: a connected generative
 * model can answer directly / write / clarify; without one, Volo won't fabricate.
 * Passing `undefined` leaves those available (callers without model info).
 */
export function capabilitySnapshot(modelGenerative?: boolean): CapabilityStatus[] {
  let emailReal = false;
  try {
    emailReal = getEmailProvider().name === "smtp";
  } catch {
    /* fall back to draft-only */
  }
  const sandbox = cfg("ACTION_MODE", "").toLowerCase() === "sandbox";

  // Connected integrations upgrade the real capability state the planner sees.
  const gmail = has("google", "gmail.send");
  const gCal = has("google", "calendar");

  const communicateDetail = gmail
    ? "Gmail connected — sends real email from your Google account (with your approval)"
    : emailReal
      ? "email connected via SMTP — can send with your approval"
      : "no email account connected — will prepare a ready-to-send draft for you to send";

  const scheduleDetail = gCal
    ? "Google Calendar connected — creates the event directly via the Calendar API (with your approval)"
    : "exports a standards-compliant .ics calendar file (connect Google Calendar in Settings for direct events)";

  // A connected generative model can compose answers/drafts/summaries. When there
  // is no model, that capability is honestly unavailable (Volo won't fabricate).
  const canGenerate = modelGenerative !== false;

  return [
    {
      id: "answer",
      available: canGenerate,
      detail: canGenerate
        ? "a connected AI model answers directly — explanations, drafts, summaries, creative writing (nothing is fabricated)"
        : "no AI model connected — connect one (e.g. Ollama) to answer directly; Volo never fabricates an answer",
    },
    { id: "research", available: true, detail: "free web search + page reading (may rate-limit; degrades honestly)" },
    { id: "communicate", available: true, detail: communicateDetail },
    { id: "schedule", available: true, detail: scheduleDetail },
    {
      id: "submit",
      available: sandbox,
      detail: sandbox ? "sandbox test mode (simulated)" : "no form-submission integration connected — will prepare the exact fields/steps to submit yourself",
    },
    {
      id: "pay",
      available: sandbox,
      detail: sandbox ? "sandbox test mode (simulated — no real money)" : "no payment integration connected — Volo will never charge a card; it prepares the exact steps to pay yourself",
    },
  ];
}
