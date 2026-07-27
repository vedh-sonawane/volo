// Real email sending via the USER'S OWN free SMTP account (opt-in).
//
// Enabled only when SMTP_HOST / SMTP_USER / SMTP_PASS are set — e.g. a free
// Gmail account with an app password, or any free SMTP. Volo never bundles
// credentials and never uses a paid service; this simply relays through an
// account the user already owns. Every send is still approval-gated by the
// engine, and refuses to deliver to a placeholder / invalid recipient.

import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import type { EmailMessage, EmailProvider, SendResult } from "./types";
import { cfg, secret } from "@/lib/config";

function isRealEmail(addr: string): boolean {
  if (!addr) return false;
  if (/\[|\]|add the provider|example\.com|not found|recipient@/i.test(addr)) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(addr.trim());
}

export class SmtpEmailProvider implements EmailProvider {
  readonly name = "smtp";
  private host = cfg("SMTP_HOST");
  private user = cfg("SMTP_USER");
  private pass = secret("SMTP_PASS");
  private port = Number(cfg("SMTP_PORT", "587"));
  private from = cfg("SMTP_FROM") || cfg("SMTP_USER");
  private _tx: Transporter | null = null;

  async available(): Promise<boolean> {
    return Boolean(this.host && this.user && this.pass);
  }

  /**
   * Real connection + auth check WITHOUT sending an email (nodemailer verify()).
   * This is what makes the "Test connection" button truthful — a provider is
   * only "connected" if it actually authenticates.
   */
  async verify(): Promise<{ ok: boolean; error?: string }> {
    if (!this.host || !this.user || !this.pass) return { ok: false, error: "SMTP host, user, and password are required." };
    try {
      await this.tx().verify();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "SMTP connection/auth failed." };
    }
  }

  private tx(): Transporter {
    if (!this._tx) {
      this._tx = nodemailer.createTransport({
        host: this.host,
        port: this.port,
        secure: this.port === 465,
        auth: { user: this.user, pass: this.pass },
        // Fail fast on a bad/unreachable server rather than hanging ~2 minutes.
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 15_000,
      });
    }
    return this._tx;
  }

  async send(msg: EmailMessage): Promise<SendResult> {
    // Safety: never deliver to a placeholder / unresolved recipient (BL-3 guard).
    if (!isRealEmail(msg.to)) {
      return {
        sent: false,
        message: `No valid recipient address (got "${msg.to}"). Nothing was sent — a draft is provided so you can fill in the real address and send it yourself.`,
      };
    }
    // A valid FROM matters: most providers (e.g. Gmail) reject a message whose
    // From isn't the authenticated account. Fall back to the auth user.
    const from = (this.from || this.user || "").trim();
    if (!from) {
      return { sent: false, message: "No sender address configured (set SMTP_USER / SMTP_FROM). Nothing was sent." };
    }
    // A Subject header cannot contain CR/LF — collapse to a single line so a stray
    // newline can never make the server reject the message (or enable injection).
    const subject = String(msg.subject ?? "").replace(/[\r\n]+/g, " ").trim();
    try {
      const info = await this.tx().sendMail({ from, to: msg.to, subject, text: msg.body });
      return { sent: true, id: info.messageId, message: `Sent to ${msg.to} via your configured SMTP account.` };
    } catch (e) {
      const reason = e instanceof Error ? e.message : "send failed";
      return {
        sent: false,
        // Surface the provider's actual reason so a real rejection is diagnosable.
        message: `Your SMTP account rejected the message (${reason}). Nothing was sent; a draft is provided instead.`,
        error: reason,
      };
    }
  }
}
