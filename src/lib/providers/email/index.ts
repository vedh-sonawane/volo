// Email provider factory. Prefers a real (SMTP) provider when the user has
// configured their own free account; otherwise falls back to the honest
// draft-only provider. The rest of the app depends only on the interface.

import type { EmailProvider } from "./types";
import { LocalDraftEmailProvider } from "./local-draft";
import { SmtpEmailProvider } from "./smtp";
import { cfg, secretConfigured } from "@/lib/config";

export type { EmailProvider, EmailMessage, SendResult } from "./types";

/** Real SMTP requires host + user + password (password from the encrypted store or env). */
export function smtpConfigured(): boolean {
  return Boolean(cfg("SMTP_HOST") && cfg("SMTP_USER") && secretConfigured("SMTP_PASS"));
}

// Resolved per call so settings changes apply without a restart.
export function getEmailProvider(): EmailProvider {
  return smtpConfigured() ? new SmtpEmailProvider() : new LocalDraftEmailProvider();
}
