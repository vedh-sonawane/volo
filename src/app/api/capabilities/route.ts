import { NextRequest, NextResponse } from "next/server";
import { computeCapabilities } from "@/lib/config/capabilities";

export const runtime = "nodejs";

// GET /api/capabilities?deep=1 — truthful status of every capability. `deep`
// runs live connection checks (SMTP auth, research reachability). No emails are
// sent and no money moves.
export async function GET(req: NextRequest) {
  const deep = req.nextUrl.searchParams.get("deep") === "1";
  const capabilities = await computeCapabilities(deep);
  return NextResponse.json({ capabilities });
}
