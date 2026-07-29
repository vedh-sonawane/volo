import { NextRequest, NextResponse } from "next/server";
import { findUserByEmail, normalizeEmail, issueEmailCode, CODE_TTL_MS } from "@/lib/auth/store";
import { emailPolicyIssue } from "@/lib/auth/email-policy";
import { appOrigin, logoUrlFor, deliverCodeEmail } from "@/lib/auth/mailer";
import { resetCodeEmail } from "@/lib/auth/email-templates";

export const runtime = "nodejs";

// POST /api/auth/reset/request { email } — email a password-reset code.
// Always responds generically (never reveals whether the account exists).
export async function POST(req: NextRequest) {
  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const email = normalizeEmail(body.email || "");
  // Microsoft accounts can't exist here, so be honest if one is entered.
  const policy = emailPolicyIssue(email);
  if (policy) return NextResponse.json({ error: policy }, { status: 400 });

  const base = appOrigin(req.nextUrl.origin);
  const user = findUserByEmail(email);
  if (user) {
    const issued = issueEmailCode(user.id, "reset");
    if (issued.ok && issued.code) {
      await deliverCodeEmail(
        email,
        resetCodeEmail({ logoUrl: logoUrlFor(base), code: issued.code, ttlMs: CODE_TTL_MS, verifyUrl: `${base}/verify?email=${encodeURIComponent(email)}&purpose=reset` }),
        issued.code,
        "reset"
      );
    }
  }
  return NextResponse.json({ ok: true });
}
