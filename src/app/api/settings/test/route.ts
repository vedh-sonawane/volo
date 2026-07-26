import { NextRequest, NextResponse } from "next/server";
import { smtpConfigured } from "@/lib/providers/email";
import { SmtpEmailProvider } from "@/lib/providers/email/smtp";
import { OllamaModelProvider } from "@/lib/providers/model/ollama";
import { getResearchProvider } from "@/lib/providers/research";

export const runtime = "nodejs";

// POST /api/settings/test { provider: "email" | "ollama" | "research" }
// Runs a REAL connection/auth check against the CURRENTLY SAVED config. It never
// sends an email or moves money — email uses SMTP verify() (auth only).
export async function POST(req: NextRequest) {
  let body: { provider?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  switch (body.provider) {
    case "email": {
      if (!smtpConfigured()) return NextResponse.json({ ok: false, error: "No SMTP host/user/password saved yet." });
      const v = await new SmtpEmailProvider().verify();
      return NextResponse.json(v);
    }
    case "ollama": {
      const p = new OllamaModelProvider();
      const ok = await p.available();
      return NextResponse.json({ ok, error: ok ? undefined : "Ollama isn't reachable, or the selected model isn't installed (`ollama list`)." });
    }
    case "research": {
      try {
        const r = await getResearchProvider().search("connectivity test", 2);
        return NextResponse.json({ ok: r.length > 0, error: r.length ? undefined : "No results returned (the provider may be rate-limiting)." });
      } catch (e) {
        return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Research check failed." });
      }
    }
    default:
      return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  }
}
