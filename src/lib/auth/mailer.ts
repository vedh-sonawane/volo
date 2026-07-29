// Transactional auth email delivery. Sends premium HTML (with a plain-text
// fallback) through the configured email provider. Honest about delivery: if no
// email sender is configured it does NOT pretend to send — it reports delivered:false
// (and, in development only, logs the code to the server console so a local operator
// can still complete the flow). Codes are never returned to the client.

import { getEmailProvider } from "@/lib/providers/email";
import type { BuiltEmail } from "./email-templates";

export interface DeliveryResult {
  delivered: boolean;
  message: string;
}

/** The absolute base URL to use in email links/logos (config wins, else the request origin). */
export function appOrigin(requestOrigin: string): string {
  const configured = (process.env.APP_URL || "").trim().replace(/\/$/, "");
  return configured || requestOrigin;
}

export function logoUrlFor(origin: string): string {
  return `${origin.replace(/\/$/, "")}/volo-mark.png`;
}

export async function deliverEmail(to: string, email: BuiltEmail): Promise<DeliveryResult> {
  const provider = getEmailProvider();
  const res = await provider.send({ to, subject: email.subject, body: email.text, html: email.html });
  return { delivered: res.sent, message: res.message };
}

/**
 * Deliver an auth email that carries a one-time code. In development, if the email
 * couldn't be delivered (no SMTP configured), the code is logged server-side ONLY so
 * a local developer isn't locked out — it is never exposed to the client/response.
 */
export async function deliverCodeEmail(to: string, email: BuiltEmail, code: string, purpose: string): Promise<DeliveryResult> {
  const result = await deliverEmail(to, email);
  if (!result.delivered && process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.log(`[auth] ${purpose} code for ${to} could not be emailed (no SMTP configured). DEV code = ${code}`);
  }
  return result;
}
