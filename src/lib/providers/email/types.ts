// ─────────────────────────────────────────────────────────────────────────────
// EmailProvider abstraction (Phase 10).
//
// Sending an email is a real, consequential action. Volo performs it ONLY when
// the user has configured their OWN free email account (e.g. a Gmail app
// password or any free SMTP) — Volo itself never uses a paid service and never
// ships credentials. With nothing configured, the default provider does not send
// at all; it produces a draft the user sends manually. Either way the send is
// gated behind explicit user approval by the engine.
// ─────────────────────────────────────────────────────────────────────────────

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain-text body (always provided — the reliable fallback for every client). */
  body: string;
  /** Optional rich HTML body; when present it's sent as multipart alongside `body`. */
  html?: string;
}

export interface SendResult {
  sent: boolean;
  /** Provider message id when actually sent. */
  id?: string;
  /** Human explanation (why not sent, or confirmation). */
  message: string;
  error?: string;
}

export interface EmailProvider {
  readonly name: string;
  /** True only when this provider can really deliver mail right now. */
  available(): Promise<boolean>;
  send(msg: EmailMessage): Promise<SendResult>;
}
