import { NextRequest, NextResponse } from "next/server";
import { findUserByEmail, normalizeEmail, verifyEmailCode, setEmailVerified, trustDevice, createAuthToken, DEVICE_COOKIE, DEVICE_TTL_MS, type CodePurpose } from "@/lib/auth/store";
import { attachSession } from "@/lib/auth/session";

export const runtime = "nodejs";

const PURPOSES: CodePurpose[] = ["signup", "login", "reset"];

// POST /api/auth/verify { email, purpose, code }
// Confirms a one-time code. On success:
//   signup → mark email verified + sign in + remember this device
//   login  → sign in + remember this device
//   reset  → return a short-lived reset token (no sign-in) for the set-new-password step
// Failure messages are deliberately generic (never reveal whether the email exists).
export async function POST(req: NextRequest) {
  let body: { email?: string; purpose?: string; code?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const email = normalizeEmail(body.email || "");
  const purpose = body.purpose as CodePurpose;
  const code = String(body.code || "").trim();

  if (!PURPOSES.includes(purpose)) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  if (!/^\d{6}$/.test(code)) return NextResponse.json({ error: "Enter the 6-digit code from your email." }, { status: 400 });

  const invalid = NextResponse.json({ error: "That code is invalid or has expired." }, { status: 400 });
  const user = findUserByEmail(email);
  if (!user) return invalid; // don't reveal non-existence

  const result = verifyEmailCode(user.id, purpose, code);
  if (result !== "ok") {
    if (result === "expired") return NextResponse.json({ error: "That code has expired — request a new one." }, { status: 400 });
    if (result === "too_many") return NextResponse.json({ error: "Too many incorrect attempts — request a new code." }, { status: 400 });
    return invalid;
  }

  // Password reset does NOT sign the user in; it grants a short-lived token for the
  // set-new-password step so a stolen session can't be minted from a reset code.
  if (purpose === "reset") {
    const resetToken = createAuthToken(user.id, "reset", 10 * 60 * 1000);
    return NextResponse.json({ ok: true, resetToken });
  }

  if (purpose === "signup") setEmailVerified(user.id, true);

  const res = NextResponse.json({ ok: true, needsOnboarding: purpose === "signup" ? true : !user.onboarding });
  attachSession(res, user.id);
  // Remember this device so future logins here skip the code.
  res.cookies.set(DEVICE_COOKIE, trustDevice(user.id), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(DEVICE_TTL_MS / 1000),
  });
  return res;
}
