"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Wordmark } from "@/components/Wordmark";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AuthMesh } from "./AuthMesh";

// Microsoft accounts aren't supported — mirror the server check for instant feedback.
const MS_DOMAIN = /@(outlook|hotmail|live|msn|passport|windowslive)\.[a-z.]+$|@[^@\s]*\.onmicrosoft\.com$/i;
const MS_MESSAGE = "Volo doesn’t support Microsoft accounts (Outlook, Hotmail, Live, or MSN). Please use a different email address.";

/** Shared login / signup surface — premium, minimal, honest. */
export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState(false);
  // Surface an OAuth sign-in failure the callback bounced back here (e.g. the user
  // cancelled, or the provider rejected the exchange) — never a silent dead end.
  const oauthError = params.get("integration_error");
  const oauthDetail = params.get("integration_detail");
  const [error, setError] = useState<string | null>(oauthError ? oauthSignInError(oauthError, oauthDetail) : null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // Instant, honest feedback before hitting the server.
    if (MS_DOMAIN.test(email.trim())) {
      setError(MS_MESSAGE);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const endpoint = mode === "signup" ? "/api/auth/register" : "/api/auth/login";
      const body = mode === "signup" ? { name, email, password, acceptTerms: accept } : { email, password };
      const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Something went wrong.");
        setBusy(false);
        return;
      }
      // A one-time code was emailed → go verify it (signup ownership, or new-device login).
      if (data.needsVerification) {
        const qs = new URLSearchParams({ email, purpose: data.purpose || (mode === "signup" ? "signup" : "login") });
        if (next && next !== "/") qs.set("next", next);
        router.push(`/verify?${qs.toString()}`);
        return;
      }
      // Trusted device (login) — signed in already.
      if (data.needsOnboarding) router.push("/welcome");
      else router.push(next);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <main className="relative min-h-screen flex flex-col overflow-hidden">
      <AuthMesh />
      <header className="relative z-10 max-w-md w-full mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/login"><Wordmark size={22} /></Link>
        <ThemeToggle />
      </header>

      <div className="relative z-10 flex-1 flex items-center justify-center px-6 pb-20">
        <div className="w-full max-w-[400px]">
          <h1 className="font-display text-[28px] leading-tight tracking-[-0.02em]">
            {mode === "signup" ? "Create your account" : "Welcome back"}
          </h1>
          <p className="mt-1.5 text-[14px] text-[var(--color-muted)]">
            {mode === "signup" ? "Set up Volo in under a minute — your data stays yours." : "Sign in to your Volo workspace."}
          </p>

          <form onSubmit={submit} className="mt-7 flex flex-col gap-3.5">
            {mode === "signup" && (
              <Field label="What should Volo call you?" value={name} onChange={setName} placeholder="Your name" autoFocus />
            )}
            <Field label="Email" type="email" value={email} onChange={setEmail} placeholder="you@example.com" autoFocus={mode === "login"} />
            <Field label="Password" type="password" value={password} onChange={setPassword} placeholder={mode === "signup" ? "At least 8 characters" : "Your password"} />

            {mode === "signup" && (
              <label className="flex items-start gap-2.5 mt-1 text-[12.5px] text-[var(--color-ink-soft)] leading-relaxed">
                <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} className="mt-0.5" />
                <span>
                  I agree to the <Link href="/terms" className="link-underline">Terms of Service</Link> and{" "}
                  <Link href="/privacy" className="link-underline">Privacy Policy</Link>.
                </span>
              </label>
            )}

            {error && <div className="text-[12.5px] fade-up" style={{ color: "var(--color-err)" }} role="alert">{error}</div>}

            <button className="btn btn-accent btn-shine mt-2 w-full justify-center" disabled={busy}>
              {busy ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
            </button>

            {mode === "login" && (
              <Link href={`/verify?purpose=reset${email ? `&email=${encodeURIComponent(email)}` : ""}`} className="text-center text-[12.5px] text-[var(--color-muted)] link-underline">
                Forgot your password?
              </Link>
            )}
          </form>

          {/* Social sign-in — real OAuth, shown per provider only when configured. */}
          <SocialButtons mode={mode} next={next} />

          <p className="mt-7 text-center text-[13px] text-[var(--color-muted)]">
            {mode === "signup" ? (
              <>Already have an account? <Link href="/login" className="link-underline text-[var(--color-ink)]">Sign in</Link></>
            ) : (
              <>New to Volo? <Link href="/signup" className="link-underline text-[var(--color-ink)]">Create an account</Link></>
            )}
          </p>
        </div>
      </div>
    </main>
  );
}

function Field({ label, value, onChange, type = "text", placeholder, autoFocus }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; autoFocus?: boolean }) {
  return (
    <label className="block">
      <span className="text-[12.5px] font-[550] text-[var(--color-ink-soft)]">{label}</span>
      <input
        className="field !text-[15px] !py-3 !rounded-xl mt-1.5"
        type={type}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete={type === "password" ? "current-password" : type === "email" ? "email" : "name"}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

interface ProviderInfo { id: string; label: string; configured: boolean }

// Social providers are shown only when the server says they're configured, so we
// never present a button that can't work. Each is a REAL OAuth sign-in: it starts
// the provider flow (mode=login) which creates or links the account, then signs in.
function SocialButtons({ mode, next }: { mode: "login" | "signup"; next: string }) {
  const [providers, setProviders] = useState<ProviderInfo[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/auth/providers", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { providers: [] }))
      .then((d) => alive && setProviders(d.providers ?? []))
      .catch(() => alive && setProviders([]));
    return () => {
      alive = false;
    };
  }, []);

  if (providers === null) return <div className="mt-6 h-11 skeleton rounded-xl" />;

  const active = providers.filter((p) => p.configured && LOGOS[p.id]);
  const verb = mode === "signup" ? "Sign up" : "Continue";

  return (
    <div className="mt-6">
      <div className="flex items-center gap-3 text-[11px] text-[var(--color-faint)] uppercase tracking-[0.14em]">
        <span className="h-px flex-1" style={{ background: "var(--color-line)" }} />
        {mode === "signup" ? "Or sign up with" : "Or continue with"}
        <span className="h-px flex-1" style={{ background: "var(--color-line)" }} />
      </div>

      {active.length > 0 ? (
        <div className="mt-3 flex items-center justify-center gap-2.5">
          {active.map((p) => (
            <a
              key={p.id}
              href={`/api/auth/oauth/${p.id}/start?mode=login&next=${encodeURIComponent(next)}`}
              aria-label={`${verb} with ${p.label}`}
              title={`${verb} with ${p.label}`}
              className="group flex-1 h-11 rounded-xl border flex items-center justify-center transition-colors hover:bg-[color-mix(in_srgb,var(--color-ink)_5%,transparent)]"
              style={{ borderColor: "var(--color-line)" }}
            >
              {LOGOS[p.id]}
            </a>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-center text-[11px] text-[var(--color-faint)]">
          Social sign-in activates once a provider’s OAuth app is configured (see the setup guide).
        </p>
      )}
    </div>
  );
}

// Official brand marks (inline SVG — no network, theme-safe). Google keeps its
// four-brand colors; GitHub uses currentColor so it adapts to Paper/Ink themes.
const LOGOS: Record<string, React.ReactNode> = {
  google: (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
      <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
      <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
      <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
    </svg>
  ),
  github: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 2.9-.39c.98 0 1.97.13 2.9.39 2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.43-2.7 5.41-5.26 5.69.41.36.78 1.08.78 2.18 0 1.57-.01 2.84-.01 3.23 0 .31.21.68.8.56A10.53 10.53 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5z" />
    </svg>
  ),
};

// A friendly message for an OAuth sign-in that bounced back to the auth page.
function oauthSignInError(code: string, detail?: string | null): string {
  const base =
    code === "access_denied"
      ? "Sign-in was cancelled — you didn’t grant access."
      : code === "not_configured"
        ? "That provider isn’t configured for sign-in yet."
        : code === "invalid_state"
          ? "That sign-in attempt expired — please try again."
          : "Couldn’t complete sign-in with that provider.";
  return detail ? `${base} (${detail})` : base;
}

