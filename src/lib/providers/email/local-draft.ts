// The default, honest email provider: it NEVER sends. It exists so the product
// works with zero configuration and never pretends an email went out.

import type { EmailMessage, EmailProvider, SendResult } from "./types";

export class LocalDraftEmailProvider implements EmailProvider {
  readonly name = "local-draft";

  async available(): Promise<boolean> {
    return false; // cannot deliver — draft only
  }

  async send(_msg: EmailMessage): Promise<SendResult> {
    return {
      sent: false,
      message:
        "Email sending isn't configured, so nothing was sent. A draft has been prepared for you to send from your own mail client.",
    };
  }
}
