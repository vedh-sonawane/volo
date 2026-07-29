import { NextRequest, NextResponse } from "next/server";
import { computeCapabilities } from "@/lib/config/capabilities";
import { withAuth } from "@/lib/auth/guard";

export const runtime = "nodejs";

export const GET = withAuth(getImpl);

// GET /api/capabilities?deep=1 — truthful status of every capability. `deep`
// runs live connection checks (SMTP auth, research reachability). No emails are
// sent and no money moves.
async function getImpl(req: NextRequest) {
  const deep = req.nextUrl.searchParams.get("deep") === "1";
  const capabilities = await computeCapabilities(deep);
  return NextResponse.json({ capabilities });
}
