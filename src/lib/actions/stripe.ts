// Real Stripe integration — TEST MODE ONLY (free, no real money).
//
// Stripe's Test Mode is 100% free: it's the REAL Stripe API, called with a test
// secret key (sk_test_…) and Stripe's own test cards. It creates real Stripe
// objects (a PaymentIntent with a pi_… id) and returns a real confirmation — but
// NO real money moves and nothing is really charged.
//
// SAFETY (non-negotiable):
//   • Volo ONLY accepts a TEST key. A live key (sk_live_…) is refused outright, so
//     real money can never move through Volo.
//   • The secret key is read from the encrypted secret store, used only in the
//     Authorization header, and NEVER logged, returned to the client, or put in a
//     prompt/model context.
//   • No raw card data ever touches Volo — payment uses Stripe's test PaymentMethod
//     tokens (pm_card_visa etc.), so there's no PCI surface.
//   • Every payment is still approval-gated and idempotent (Stripe Idempotency-Key).

import type { ActionResult } from "@/lib/types";
import type { ActionInput, ActionProvider } from "./types";
import { secret } from "@/lib/config";

const STRIPE_API = "https://api.stripe.com/v1/payment_intents";
const TIMEOUT_MS = 20_000;

// Currencies Stripe treats as zero-decimal (amount is NOT multiplied by 100).
const ZERO_DECIMAL = new Set(["bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf"]);

/** The configured Stripe secret key (never returned/logged elsewhere). */
function stripeKey(): string {
  return secret("STRIPE_SECRET_KEY").trim();
}

/** A usable Stripe TEST integration is configured (test key present). */
export function stripeTestConfigured(): boolean {
  return stripeKey().startsWith("sk_test_");
}

/** A LIVE key is present — Volo must refuse to use it (no real money, ever). */
export function stripeKeyIsLive(): boolean {
  return stripeKey().startsWith("sk_live_");
}

/**
 * Choose a Stripe TEST PaymentMethod so failure paths stay exercisable — exactly
 * like the sandbox did, but through the real Stripe test API. Defaults to a
 * succeeding test card. These are Stripe's own documented test tokens (no card
 * data). The signal comes from the action's own summary/target, generically.
 */
function testPaymentMethod(probe: string): string {
  if (/\b(3ds|3-?d\s?secure|otp|auth|authenticat)/i.test(probe)) return "pm_card_authenticationRequired";
  if (/\b(decline|declined|insufficient|fail|error)\b/i.test(probe)) return "pm_card_chargeDeclined";
  return "pm_card_visa";
}

function toMinorUnits(total: number, currency: string): number {
  return ZERO_DECIMAL.has(currency) ? Math.round(total) : Math.round(total * 100);
}

export class StripeTestPaymentAction implements ActionProvider {
  readonly capability = "payment" as const;
  readonly name = "stripe-test";

  async available(): Promise<boolean> {
    return stripeTestConfigured();
  }

  validate(input: ActionInput): { ok: boolean; error?: string } {
    if (!input.target || /\[|\]|add the|not found|placeholder/i.test(input.target)) {
      return { ok: false, error: `Refusing to pay a placeholder target ("${input.target}").` };
    }
    if (!input.financial) {
      return { ok: false, error: "A payment needs an explicit quote (total + currency) before it can run." };
    }
    if (stripeKeyIsLive()) {
      return { ok: false, error: "A LIVE Stripe key is configured. Volo refuses to move real money — replace it with a test key (sk_test_…)." };
    }
    if (!stripeTestConfigured()) {
      return { ok: false, error: "No Stripe TEST key configured (expected sk_test_…)." };
    }
    return { ok: true };
  }

  async execute(input: ActionInput): Promise<ActionResult> {
    const key = stripeKey();
    const fin = input.financial!;
    const currency = (fin.currency || "usd").toLowerCase();
    const amount = toMinorUnits(fin.total, currency);
    const probe = `${input.target} ${input.summary}`;
    const pm = testPaymentMethod(probe);

    const params = new URLSearchParams();
    params.set("amount", String(amount));
    params.set("currency", currency);
    params.set("payment_method", pm);
    params.append("payment_method_types[]", "card");
    params.set("confirm", "true");
    params.set("description", (input.summary || `Payment to ${input.target}`).slice(0, 300));
    params.set("metadata[volo_target]", String(input.target).slice(0, 200));
    params.set("metadata[volo_mode]", "test");

    let res: Response;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      res = await fetch(STRIPE_API, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Idempotency-Key": input.idempotencyKey,
        },
        body: params.toString(),
        signal: ctrl.signal,
      });
      clearTimeout(t);
    } catch (e) {
      const aborted = e instanceof Error && (e.name === "AbortError" || /abort/i.test(e.message));
      return {
        status: aborted ? "uncertain" : "failed",
        mode: "test",
        simulated: true,
        message: aborted
          ? "Stripe TEST request timed out — the outcome is UNCERTAIN. Volo won't retry; verify in your Stripe test dashboard. No real money moved."
          : `Couldn't reach Stripe (test): ${e instanceof Error ? e.message : "network error"}. No real money moved.`,
        at: Date.now(),
      };
    }

    let data: StripeResponse = {};
    try {
      data = (await res.json()) as StripeResponse;
    } catch {
      /* non-JSON */
    }

    if (!res.ok) {
      const err = data.error?.message || `HTTP ${res.status}`;
      const code = data.error?.code || data.error?.decline_code;
      return {
        status: "failed",
        mode: "test",
        simulated: true,
        message: `Stripe TEST payment was declined/failed: ${err}${code ? ` (${code})` : ""}. No real money moved.`,
        at: Date.now(),
      };
    }

    const status = data.status;
    const id = data.id;
    if (status === "succeeded") {
      return {
        status: "succeeded",
        mode: "test",
        simulated: true,
        confirmation: id,
        message: `Stripe TEST mode: PaymentIntent ${id} for ${fin.currency} ${fin.total} succeeded with a test card — a REAL Stripe test-API call. NO real money moved.`,
        at: Date.now(),
      };
    }
    if (status === "requires_action" || status === "requires_confirmation" || status === "requires_payment_method") {
      return {
        status: "requires_user",
        mode: "test",
        simulated: true,
        confirmation: id,
        message: `Stripe TEST PaymentIntent ${id ?? ""} needs further action (status: ${status}) — complete it in Stripe's secure flow. No real money moved.`,
        at: Date.now(),
      };
    }
    if (status === "processing") {
      return {
        status: "uncertain",
        mode: "test",
        simulated: true,
        confirmation: id,
        message: `Stripe TEST PaymentIntent ${id ?? ""} is still processing — outcome uncertain; Volo won't retry. No real money moved.`,
        at: Date.now(),
      };
    }
    return {
      status: "failed",
      mode: "test",
      simulated: true,
      message: `Stripe TEST returned an unexpected status (${status ?? "unknown"}). No real money moved.`,
      at: Date.now(),
    };
  }
}

interface StripeResponse {
  id?: string;
  status?: string;
  error?: { message?: string; code?: string; decline_code?: string; type?: string };
}
