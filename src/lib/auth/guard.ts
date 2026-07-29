// Route guard: require an authenticated user AND run the handler inside that
// user's data scope (so the store/config layer reads/writes only their data).

import { NextRequest, NextResponse } from "next/server";
import { runWithUser } from "./context";
import { userFromRequest } from "./session";
import type { User } from "./store";

type Handler<Ctx> = (req: NextRequest, ctx: Ctx, user: User) => Promise<Response> | Response;

export function withAuth<Ctx = unknown>(handler: Handler<Ctx>) {
  return (req: NextRequest, ctx: Ctx): Promise<Response> | Response => {
    const user = userFromRequest(req);
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    return runWithUser(user.id, () => handler(req, ctx, user));
  };
}
