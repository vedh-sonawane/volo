// Which email addresses Volo accepts for email/password accounts.
//
// Product decision: Volo does NOT support Microsoft authentication. Microsoft
// consumer domains (Outlook / Hotmail / Live / MSN) and Microsoft-hosted tenants
// (*.onmicrosoft.com) are rejected with a clear, honest message rather than
// failing later in an opaque way.
//
// NOTE: Volo is NOT restricted to Gmail-only — every other provider (custom
// domains, Yahoo, Proton, Google Workspace, etc.) is allowed. If a Gmail-only
// policy is ever desired, add that check here; the rest of the app calls one seam.

const MICROSOFT_DOMAINS = new Set([
  "outlook.com",
  "outlook.co.uk",
  "hotmail.com",
  "hotmail.co.uk",
  "hotmail.fr",
  "live.com",
  "live.co.uk",
  "msn.com",
  "passport.com",
  "windowslive.com",
]);

export const MICROSOFT_NOT_SUPPORTED =
  "Volo doesn’t support Microsoft accounts (Outlook, Hotmail, Live, or MSN). Please sign up with a different email address — Google and most other providers work.";

export function emailDomain(email: string): string {
  return (email.split("@")[1] || "").trim().toLowerCase();
}

/** True for Microsoft consumer domains and Microsoft-hosted tenants. */
export function isMicrosoftEmail(email: string): boolean {
  const d = emailDomain(email);
  return MICROSOFT_DOMAINS.has(d) || d.endsWith(".onmicrosoft.com");
}

/** A user-facing reason the email isn't accepted, or null if it's allowed. */
export function emailPolicyIssue(email: string): string | null {
  if (isMicrosoftEmail(email)) return MICROSOFT_NOT_SUPPORTED;
  return null;
}
