// Real email sending via a user's connected Gmail account (Gmail API).
//
// Enabled only when the user connected Google with the gmail.send scope. Uses the
// per-user encrypted OAuth token (refreshed automatically) — the token is NEVER
// exposed to the client or the model. Sends a REAL email (mode "live"), still
// gated behind explicit approval by the engine.

import type { ActionResult } from "@/lib/types";
import type { ActionInput, ActionProvider } from "./types";
import { currentUserId } from "@/lib/auth/context";
import { getAccessToken, integrationHasScope } from "@/lib/auth/integrations";

const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

function isRealEmail(addr: string): boolean {
  if (!addr) return false;
  if (/\[|\]|add the provider|example\.com|not found|recipient@/i.test(addr)) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(addr.trim());
}

/** Has the current user connected Gmail with send permission? */
export function gmailConfigured(): boolean {
  return integrationHasScope(currentUserId(), "google", GMAIL_SEND_SCOPE);
}

function rfc822(to: string, subject: string, body: string): string {
  const safeSubject = subject.replace(/[\r\n]+/g, " ").trim();
  return [`To: ${to}`, `Subject: ${safeSubject}`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "", body].join("\r\n");
}

export class GmailSendAction implements ActionProvider {
  readonly capability = "send_email" as const;
  readonly name = "gmail";

  async available(): Promise<boolean> {
    return gmailConfigured();
  }

  validate(input: ActionInput): { ok: boolean; error?: string } {
    if (!isRealEmail(input.target)) return { ok: false, error: `No valid recipient email (got "${input.target}").` };
    return { ok: true };
  }

  async execute(input: ActionInput): Promise<ActionResult> {
    const uid = currentUserId();
    const token = await getAccessToken(uid, "google");
    if (!token) {
      return { status: "requires_user", message: "Your Gmail connection needs to be re-authorized. Reconnect Google in Settings → Integrations, then try again. Nothing was sent.", at: Date.now() };
    }
    const raw = Buffer.from(rfc822(input.target, String(input.payload.subject || "Message"), String(input.payload.body || input.summary))).toString("base64url");
    try {
      const res = await fetch(GMAIL_SEND_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ raw }),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
      if (res.ok && data.id) {
        return { status: "succeeded", mode: "live", confirmation: data.id, message: `Sent to ${input.target} via your connected Gmail account.`, at: Date.now() };
      }
      return { status: "failed", message: `Gmail rejected the message: ${data.error?.message || `HTTP ${res.status}`}. Nothing was sent.`, at: Date.now() };
    } catch (e) {
      return { status: "failed", message: `Couldn't reach Gmail: ${e instanceof Error ? e.message : "network error"}. Nothing was sent.`, at: Date.now() };
    }
  }
}
