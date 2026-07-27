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

export function capabilitySnapshot(): CapabilityStatus[] {
  let emailReal = false;
  try {
    emailReal = getEmailProvider().name === "smtp";
  } catch {
    /* fall back to draft-only */
  }
  const sandbox = cfg("ACTION_MODE", "").toLowerCase() === "sandbox";

  return [
    { id: "answer", available: true, detail: "answered directly from knowledge/generation (a model produces the prose; nothing is fabricated)" },
    { id: "research", available: true, detail: "free web search + page reading (may rate-limit; degrades honestly)" },
    {
      id: "communicate",
      available: true,
      detail: emailReal
        ? "email connected — can send to a discovered/supplied address with your approval"
        : "no email account connected — will prepare a ready-to-send draft for you to send",
    },
    { id: "schedule", available: true, detail: "exports a standards-compliant .ics calendar file" },
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
