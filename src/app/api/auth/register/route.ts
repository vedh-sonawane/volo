import { NextRequest, NextResponse } from "next/server";
import { createUser, findUserByEmail, normalizeEmail, setPasswordHash, setUserName, issueEmailCode, CODE_TTL_MS } from "@/lib/auth/store";
import { hashPassword, passwordIssue } from "@/lib/auth/passwords";
import { emailPolicyIssue } from "@/lib/auth/email-policy";
import { appOrigin, logoUrlFor, deliverEmail, deliverCodeEmail } from "@/lib/auth/mailer";
import { verifyCodeEmail, alreadyRegisteredEmail } from "@/lib/auth/email-templates";

export const runtime = "nodejs";

// POST /api/auth/register { email, password, name, acceptTerms }
// Creates a PENDING account and emails a one-time verification code. The account is
// NOT active and NO session is issued until the code is confirmed at /verify.
//
// Anti-enumeration: the response is identical whether or not the email already has
// an account. An already-registered address gets a "you already have an account"
// email instead of a code; a brand-new/unverified address gets a code.
export async function POST(req: NextRequest) {
  let body: { email?: string; password?: string; name?: string; acceptTerms?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const email = normalizeEmail(body.email || "");
  const name = (body.name || "").trim().slice(0, 80) || undefined;
  const password = body.password || "";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  const policy = emailPolicyIssue(email);
  if (policy) return NextResponse.json({ error: policy }, { status: 400 });
  const pwIssue = passwordIssue(password);
  if (pwIssue) return NextResponse.json({ error: pwIssue }, { status: 400 });
  if (!body.acceptTerms) return NextResponse.json({ error: "You must accept the Terms of Service and Privacy Policy." }, { status: 400 });

  const base = appOrigin(req.nextUrl.origin);
  const logoUrl = logoUrlFor(base);
  // Identical success shape regardless of whether the account already exists.
  const generic = NextResponse.json({ needsVerification: true, email, purpose: "signup" });

  const existing = findUserByEmail(email);

  if (existing && existing.emailVerified) {
    // Don't reveal the account exists — tell the real owner via email, respond generically.
    await deliverEmail(email, alreadyRegisteredEmail({ logoUrl, signinUrl: `${base}/login` }));
    return generic;
  }

  // New address, or an unverified account being (re)claimed — update its credentials.
  let userId: string;
  if (existing) {
    setPasswordHash(existing.id, hashPassword(password));
    if (name) setUserName(existing.id, name);
    userId = existing.id;
  } else {
    userId = createUser({ email, name, passwordHash: hashPassword(password) }).id;
  }

  const issued = issueEmailCode(userId, "signup");
  if (issued.ok && issued.code) {
    await deliverCodeEmail(
      email,
      verifyCodeEmail({ logoUrl, code: issued.code, ttlMs: CODE_TTL_MS, verifyUrl: `${base}/verify?email=${encodeURIComponent(email)}&purpose=signup` }),
      issued.code,
      "signup"
    );
  }
  return generic;
}
