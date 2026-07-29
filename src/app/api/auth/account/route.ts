import { NextRequest, NextResponse } from "next/server";
import { userFromRequest, clearSession, SESSION_COOKIE } from "@/lib/auth/session";
import { getPasswordHash, setPasswordHash, setUserEmail, setUserName, findUserByEmail, destroyUserSessions, normalizeEmail } from "@/lib/auth/store";
import { hashPassword, verifyPassword, passwordIssue } from "@/lib/auth/passwords";
import { deleteUserAccount } from "@/lib/auth/admin";

export const runtime = "nodejs";

// POST /api/auth/account { action, ... } — manage the signed-in account.
// Sensitive changes (password/email/delete) require the current password.
export async function POST(req: NextRequest) {
  const user = userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { action?: string; currentPassword?: string; newPassword?: string; email?: string; name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const requirePassword = (): boolean => {
    const hash = getPasswordHash(user.id);
    return !!hash && verifyPassword(body.currentPassword || "", hash);
  };

  switch (body.action) {
    case "rename": {
      const name = (body.name || "").trim().slice(0, 80);
      if (!name) return NextResponse.json({ error: "Enter a name." }, { status: 400 });
      setUserName(user.id, name);
      return NextResponse.json({ ok: true });
    }
    case "change-password": {
      if (!requirePassword()) return NextResponse.json({ error: "Current password is incorrect." }, { status: 403 });
      const issue = passwordIssue(body.newPassword || "");
      if (issue) return NextResponse.json({ error: issue }, { status: 400 });
      setPasswordHash(user.id, hashPassword(body.newPassword!));
      destroyUserSessions(user.id); // sign out other devices
      const res = NextResponse.json({ ok: true, reauth: true });
      clearSession(res, req.cookies.get(SESSION_COOKIE)?.value);
      return res;
    }
    case "change-email": {
      if (!requirePassword()) return NextResponse.json({ error: "Current password is incorrect." }, { status: 403 });
      const email = normalizeEmail(body.email || "");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
      if (findUserByEmail(email)) return NextResponse.json({ error: "That email is already in use." }, { status: 409 });
      setUserEmail(user.id, email); // marks email unverified again
      return NextResponse.json({ ok: true });
    }
    case "delete": {
      if (!requirePassword()) return NextResponse.json({ error: "Current password is incorrect." }, { status: 403 });
      deleteUserAccount(user.id); // removes account + ALL their tasks/config/secrets
      const res = NextResponse.json({ ok: true, deleted: true });
      clearSession(res, req.cookies.get(SESSION_COOKIE)?.value);
      return res;
    }
    default:
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }
}
