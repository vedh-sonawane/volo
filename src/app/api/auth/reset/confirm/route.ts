import { NextRequest, NextResponse } from "next/server";
import { consumeAuthToken, setPasswordHash, setEmailVerified, findUserById, destroyUserSessions } from "@/lib/auth/store";
import { hashPassword, passwordIssue } from "@/lib/auth/passwords";
import { attachSession } from "@/lib/auth/session";

export const runtime = "nodejs";

// POST /api/auth/reset/confirm { resetToken, newPassword }
// Consumes the single-use reset token (issued by /api/auth/verify for purpose=reset),
// sets the new password, invalidates all existing sessions, and signs the user in.
export async function POST(req: NextRequest) {
  let body: { resetToken?: string; newPassword?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const resetToken = String(body.resetToken || "");
  const newPassword = body.newPassword || "";

  const pwIssue = passwordIssue(newPassword);
  if (pwIssue) return NextResponse.json({ error: pwIssue }, { status: 400 });

  const userId = consumeAuthToken(resetToken, "reset");
  if (!userId) return NextResponse.json({ error: "This reset link/code has expired. Start over." }, { status: 400 });

  setPasswordHash(userId, hashPassword(newPassword));
  setEmailVerified(userId, true); // a completed reset proves email ownership
  destroyUserSessions(userId); // sign out everywhere the old password could reach

  const user = findUserById(userId);
  const res = NextResponse.json({ ok: true, needsOnboarding: !user?.onboarding });
  attachSession(res, userId);
  return res;
}
