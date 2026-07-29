import { NextRequest, NextResponse } from "next/server";
import { smtpConfigured } from "@/lib/providers/email";
import { SmtpEmailProvider } from "@/lib/providers/email/smtp";
import { OllamaModelProvider } from "@/lib/providers/model/ollama";
import { getResearchProvider } from "@/lib/providers/research";
import { secret } from "@/lib/config";
import { withAuth } from "@/lib/auth/guard";

export const runtime = "nodejs";

export const POST = withAuth(postImpl);

// POST /api/settings/test { provider: "email" | "ollama" | "research" }
// Runs a REAL connection/auth check against the CURRENTLY SAVED config. It never
// sends an email or moves money — email uses SMTP verify() (auth only).
async function postImpl(req: NextRequest) {
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
        // Reachable = the provider actually responded (results OR a genuine empty).
        // A rate-limit / timeout / error is reported honestly as NOT ok.
        const ok = r.status === "ok" || r.status === "empty";
        const detail =
          r.status === "rate_limited"
            ? "The free search provider is rate-limiting right now. It usually recovers within a minute — retry shortly."
            : r.status === "timeout"
              ? "The search request timed out. Check your connection and retry."
              : r.status === "error"
                ? `The search provider returned an error${r.error ? `: ${r.error}` : ""}.`
                : r.status === "empty"
                  ? "Reachable — the provider responded (no results for the probe query, which is fine)."
                  : undefined;
        return NextResponse.json({ ok, error: ok ? undefined : detail, detail: ok ? detail : undefined, status: r.status });
      } catch (e) {
        return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Research check failed." });
      }
    }
    case "stripe": {
      const key = secret("STRIPE_SECRET_KEY").trim();
      if (!key) return NextResponse.json({ ok: false, error: "No Stripe secret key saved yet." });
      if (key.startsWith("sk_live_")) {
        return NextResponse.json({ ok: false, error: "That's a LIVE key. Volo only accepts a TEST key (sk_test_…) so no real money can ever move. Replace it with your test key." });
      }
      if (!key.startsWith("sk_test_")) {
        return NextResponse.json({ ok: false, error: "That doesn't look like a Stripe TEST secret key (expected sk_test_…)." });
      }
      try {
        // A real auth check WITHOUT moving money: read the account balance.
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 12_000);
        const res = await fetch("https://api.stripe.com/v1/balance", { headers: { Authorization: `Bearer ${key}` }, signal: ctrl.signal });
        clearTimeout(t);
        if (res.ok) return NextResponse.json({ ok: true, detail: "Stripe test key authenticated — test-mode payments are enabled (no real money)." });
        const data = await res.json().catch(() => ({}));
        return NextResponse.json({ ok: false, error: `Stripe rejected the key: ${data?.error?.message || `HTTP ${res.status}`}.` });
      } catch (e) {
        return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Couldn't reach Stripe." });
      }
    }
    default:
      return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  }
}
