// Premium, responsive HTML email templates for Volo's transactional auth emails.
//
// Design goals: render reliably in Gmail + major clients (table-based layout, inline
// styles, no external CSS/JS, web-safe fonts), lead with the Volo logo + wordmark,
// use bold headings and a clear code/CTA, and always include expiry + a security
// notice. Every template also returns a plain-text version (the universal fallback).

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

const INK = "#0b0b0d";
const ACCENT = "#2563eb";
const MUTED = "#6b7280";
const LINE = "#e6e8eb";
const BG = "#f4f5f7";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function header(logoUrl: string): string {
  // Logo mark immediately left of the "volo." wordmark — the app's brand lockup.
  return `
  <tr><td style="padding:28px 32px 8px 32px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="vertical-align:middle;">
        <img src="${esc(logoUrl)}" width="34" height="34" alt="Volo" style="display:block;border-radius:8px;background:#000;" />
      </td>
      <td style="vertical-align:middle;padding-left:10px;">
        <span style="font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:700;color:${INK};letter-spacing:-0.5px;">volo<span style="color:${ACCENT};">.</span></span>
      </td>
    </tr></table>
  </td></tr>`;
}

function codeBlock(code: string): string {
  return `
  <tr><td style="padding:8px 32px 4px 32px;">
    <div style="background:${BG};border:1px solid ${LINE};border-radius:14px;padding:22px;text-align:center;">
      <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:${MUTED};font-weight:600;">Your code</div>
      <div style="font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:38px;font-weight:800;letter-spacing:10px;color:${INK};padding:8px 0 2px 8px;">${esc(code)}</div>
    </div>
  </td></tr>`;
}

function ctaButton(label: string, url: string): string {
  return `
  <tr><td style="padding:20px 32px 4px 32px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="border-radius:12px;background:${ACCENT};">
        <a href="${esc(url)}" style="display:inline-block;padding:13px 26px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px;">${esc(label)}</a>
      </td>
    </tr></table>
  </td></tr>`;
}

function layout(opts: {
  preheader: string;
  logoUrl: string;
  heading: string;
  intro: string;
  code?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  expiryLine: string;
  security: string;
}): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="color-scheme" content="light"/>
<title>${esc(opts.heading)}</title></head>
<body style="margin:0;padding:0;background:${BG};">
<span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">${esc(opts.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BG};padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:#ffffff;border:1px solid ${LINE};border-radius:20px;overflow:hidden;">
    ${header(opts.logoUrl)}
    <tr><td style="padding:12px 32px 0 32px;">
      <h1 style="margin:0 0 8px 0;font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:1.25;font-weight:700;color:${INK};letter-spacing:-0.3px;">${esc(opts.heading)}</h1>
      <p style="margin:0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#374151;">${opts.intro}</p>
    </td></tr>
    ${opts.code ? codeBlock(opts.code) : ""}
    ${opts.ctaLabel && opts.ctaUrl ? ctaButton(opts.ctaLabel, opts.ctaUrl) : ""}
    <tr><td style="padding:16px 32px 0 32px;">
      <p style="margin:0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:${MUTED};">${esc(opts.expiryLine)}</p>
    </td></tr>
    <tr><td style="padding:18px 32px 0 32px;"><div style="height:1px;background:${LINE};"></div></td></tr>
    <tr><td style="padding:14px 32px 26px 32px;">
      <p style="margin:0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12.5px;line-height:1.6;color:${MUTED};"><strong style="color:#374151;">Security notice.</strong> ${esc(opts.security)}</p>
      <p style="margin:14px 0 0 0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:#9aa1ab;">Sent by Volo · you received this because someone used this address to access Volo.</p>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

const minutes = (ms: number) => Math.round(ms / 60000);

interface Ctx {
  logoUrl: string;
  code: string;
  ttlMs: number;
  verifyUrl?: string;
}

/** Signup email-ownership verification. */
export function verifyCodeEmail(c: Ctx): BuiltEmail {
  const m = minutes(c.ttlMs);
  return {
    subject: `Verify your email — code ${c.code}`,
    html: layout({
      preheader: `Your Volo verification code is ${c.code}. It expires in ${m} minutes.`,
      logoUrl: c.logoUrl,
      heading: "Confirm your email",
      intro: "Welcome to Volo. Enter this code to verify your email and activate your account.",
      code: c.code,
      ctaLabel: c.verifyUrl ? "Verify email" : undefined,
      ctaUrl: c.verifyUrl,
      expiryLine: `This code expires in ${m} minutes and can be used once.`,
      security: "If you didn’t create a Volo account, you can safely ignore this email — no account is activated until this code is entered.",
    }),
    text: `Confirm your email\n\nYour Volo verification code is: ${c.code}\nIt expires in ${m} minutes and can be used once.\n\n${c.verifyUrl ? `Verify here: ${c.verifyUrl}\n\n` : ""}If you didn’t create a Volo account, ignore this email.`,
  };
}

/** New-device login verification. */
export function loginCodeEmail(c: Ctx): BuiltEmail {
  const m = minutes(c.ttlMs);
  return {
    subject: `Your Volo sign-in code ${c.code}`,
    html: layout({
      preheader: `Your Volo sign-in code is ${c.code}. It expires in ${m} minutes.`,
      logoUrl: c.logoUrl,
      heading: "Confirm it’s you",
      intro: "We noticed a sign-in from a new device or browser. Enter this code to finish signing in.",
      code: c.code,
      ctaLabel: c.verifyUrl ? "Continue sign-in" : undefined,
      ctaUrl: c.verifyUrl,
      expiryLine: `This code expires in ${m} minutes and can be used once.`,
      security: "If this wasn’t you, do NOT share this code. Someone may have your password — change it as soon as you can. Volo will never ask you for this code.",
    }),
    text: `Confirm it’s you\n\nYour Volo sign-in code is: ${c.code}\nIt expires in ${m} minutes and can be used once.\n\nIf this wasn’t you, do not share this code and change your password.`,
  };
}

/** Password reset code. */
export function resetCodeEmail(c: Ctx): BuiltEmail {
  const m = minutes(c.ttlMs);
  return {
    subject: `Reset your Volo password — code ${c.code}`,
    html: layout({
      preheader: `Your Volo password-reset code is ${c.code}. It expires in ${m} minutes.`,
      logoUrl: c.logoUrl,
      heading: "Reset your password",
      intro: "Use this code to set a new password for your Volo account.",
      code: c.code,
      ctaLabel: c.verifyUrl ? "Reset password" : undefined,
      ctaUrl: c.verifyUrl,
      expiryLine: `This code expires in ${m} minutes and can be used once.`,
      security: "If you didn’t request a password reset, ignore this email — your password stays unchanged. Volo will never ask you for this code.",
    }),
    text: `Reset your password\n\nYour Volo password-reset code is: ${c.code}\nIt expires in ${m} minutes and can be used once.\n\nIf you didn’t request this, ignore this email.`,
  };
}

/** Anti-enumeration: someone tried to register an email that already has an account. */
export function alreadyRegisteredEmail(c: { logoUrl: string; signinUrl: string }): BuiltEmail {
  return {
    subject: "You already have a Volo account",
    html: layout({
      preheader: "Someone tried to sign up with this email — you already have a Volo account.",
      logoUrl: c.logoUrl,
      heading: "You already have an account",
      intro: `Someone just tried to create a Volo account with this email address, but one already exists. If that was you, simply <a href="${esc(c.signinUrl)}" style="color:${ACCENT};font-weight:600;text-decoration:none;">sign in</a> instead — you don’t need a new account.`,
      ctaLabel: "Sign in to Volo",
      ctaUrl: c.signinUrl,
      expiryLine: "No new account was created and nothing changed.",
      security: "If this wasn’t you, no action is needed — your account is safe. Consider changing your password if you’re unsure.",
    }),
    text: `You already have a Volo account\n\nSomeone tried to sign up with this email, but an account already exists. If that was you, sign in instead: ${c.signinUrl}\n\nNo new account was created.`,
  };
}
