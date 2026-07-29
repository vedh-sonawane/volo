import { NextRequest, NextResponse } from "next/server";
import { findUserByEmail, normalizeEmail, issueEmailCode, isDeviceTrusted, DEVICE_COOKIE, CODE_TTL_MS } from "@/lib/auth/store";
import { verifyPassword } from "@/lib/auth/passwords";
import { attachSession } from "@/lib/auth/session";
import { emailPolicyIssue } from "@/lib/auth/email-policy";
import { appOrigin, logoUrlFor, deliverCodeEmail } from "@/lib/auth/mailer";
import { verifyCodeEmail, loginCodeEmail } from "@/lib/auth/email-templates";

export const runtime = "nodejs";

// POST /api/auth/login { email, password }
// Verifies credentials, then requires an emailed one-time code UNLESS this browser
// is already a trusted device. Returns a generic error on bad credentials (never
// reveals whether the email exists). No session is issued until verification passes
// (except on a recognized trusted device).
export async function POST(req: NextRequest) {
  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const email = normalizeEmail(body.email || "");
  const password = body.password || "";

  // Microsoft accounts aren't supported — say so clearly rather than a generic fail.
  const policy = emailPolicyIssue(email);
  if (policy) return NextResponse.json({ error: policy }, { status: 400 });

  const user = findUserByEmail(email);
  const ok = user?.passwordHash ? verifyPassword(password, user.passwordHash) : false;
  if (!user || !ok) {
    return NextResponse.json({ error: "Incorrect email or password." }, { status: 401 });
  }

  const base = appOrigin(req.nextUrl.origin);
  const logoUrl = logoUrlFor(base);

  // If they never verified their email, resume email verification first.
  if (!user.emailVerified) {
    const issued = issueEmailCode(user.id, "signup");
    if (issued.ok && issued.code) {
      await deliverCodeEmail(email, verifyCodeEmail({ logoUrl, code: issued.code, ttlMs: CODE_TTL_MS, verifyUrl: `${base}/verify?email=${encodeURIComponent(email)}&purpose=signup` }), issued.code, "signup");
    }
    return NextResponse.json({ needsVerification: true, email, purpose: "signup" });
  }

  // Trusted device → sign in immediately. Otherwise require an emailed login code.
  if (isDeviceTrusted(user.id, req.cookies.get(DEVICE_COOKIE)?.value)) {
    const res = NextResponse.json({ ok: true, needsVerification: false, user: { id: user.id, email: user.email, name: user.name, emailVerified: user.emailVerified }, needsOnboarding: !user.onboarding });
    attachSession(res, user.id);
    return res;
  }

  const issued = issueEmailCode(user.id, "login");
  if (issued.ok && issued.code) {
    await deliverCodeEmail(email, loginCodeEmail({ logoUrl, code: issued.code, ttlMs: CODE_TTL_MS, verifyUrl: `${base}/verify?email=${encodeURIComponent(email)}&purpose=login` }), issued.code, "login");
  }
  return NextResponse.json({ needsVerification: true, email, purpose: "login" });
}
