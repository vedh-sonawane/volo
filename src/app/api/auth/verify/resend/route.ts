import { NextRequest, NextResponse } from "next/server";
import { findUserByEmail, normalizeEmail, issueEmailCode, CODE_TTL_MS, CODE_RESEND_COOLDOWN_MS, type CodePurpose } from "@/lib/auth/store";
import { appOrigin, logoUrlFor, deliverCodeEmail } from "@/lib/auth/mailer";
import { verifyCodeEmail, loginCodeEmail, resetCodeEmail } from "@/lib/auth/email-templates";

export const runtime = "nodejs";

const PURPOSES: CodePurpose[] = ["signup", "login", "reset"];

// POST /api/auth/verify/resend { email, purpose }
// Re-issues + re-sends a code, subject to the cooldown / rolling-window rate limit.
// Always responds generically (never reveals whether the account exists).
export async function POST(req: NextRequest) {
  let body: { email?: string; purpose?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const email = normalizeEmail(body.email || "");
  const purpose = body.purpose as CodePurpose;
  if (!PURPOSES.includes(purpose)) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const base = appOrigin(req.nextUrl.origin);
  const logoUrl = logoUrlFor(base);
  const user = findUserByEmail(email);

  if (user) {
    const issued = issueEmailCode(user.id, purpose);
    if (issued.ok && issued.code) {
      const verifyUrl = `${base}/verify?email=${encodeURIComponent(email)}&purpose=${purpose}`;
      const ctx = { logoUrl, code: issued.code, ttlMs: CODE_TTL_MS, verifyUrl };
      const built = purpose === "login" ? loginCodeEmail(ctx) : purpose === "reset" ? resetCodeEmail(ctx) : verifyCodeEmail(ctx);
      await deliverCodeEmail(email, built, issued.code, purpose);
    }
  }
  // Generic — clients run a local cooldown timer of CODE_RESEND_COOLDOWN_MS.
  return NextResponse.json({ ok: true, cooldownMs: CODE_RESEND_COOLDOWN_MS });
}
