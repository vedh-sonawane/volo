// Email drafting tool (Phase 8). Prepares a draft locally and produces a
// standards-compliant .eml string the user can download and open/send in their
// own mail client. It NEVER sends anything — honest by construction. Sending
// would require the user to configure their own free SMTP and explicitly
// approve it (see registry: send_email, not implemented in the free MVP).

export interface EmailDraft {
  to: string;
  subject: string;
  body: string;
  /** RFC 822 message suitable for saving as a .eml file. */
  eml: string;
}

export function draftEmail(input: { to: string; subject: string; body: string }): EmailDraft {
  const to = input.to.trim();
  const subject = input.subject.trim();
  const body = input.body.replace(/\r?\n/g, "\r\n");
  const eml = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `X-Volo-Draft: true (not sent)`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    body,
  ].join("\r\n");
  return { to, subject, body: input.body, eml };
}
