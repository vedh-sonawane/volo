"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Wordmark } from "@/components/Wordmark";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AuthMesh } from "./AuthMesh";

const RESEND_COOLDOWN = 45; // seconds — mirrors the server's send cooldown

type Purpose = "signup" | "login" | "reset";
type Stage = "request" | "code" | "password";

const COPY: Record<Purpose, { title: string; blurb: (email: string) => string }> = {
  signup: { title: "Verify your email", blurb: (e) => `Enter the 6-digit code we sent to ${e || "your email"} to activate your account.` },
  login: { title: "Confirm it’s you", blurb: (e) => `New device detected. Enter the 6-digit code we sent to ${e || "your email"} to finish signing in.` },
  reset: { title: "Reset your password", blurb: (e) => `Enter the 6-digit code we sent to ${e || "your email"}, then choose a new password.` },
};

export function VerifyForm() {
  const router = useRouter();
  const params = useSearchParams();
  const purpose = (["signup", "login", "reset"].includes(params.get("purpose") || "") ? params.get("purpose") : "signup") as Purpose;
  const next = params.get("next") || "/";

  const [email, setEmail] = useState(params.get("email") || "");
  const [stage, setStage] = useState<Stage>(purpose === "reset" && !params.get("email") ? "request" : "code");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const requested = useRef(false);

  const startCooldown = useCallback(() => setCooldown(RESEND_COOLDOWN), []);
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => (c <= 1 ? 0 : c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const requestReset = useCallback(
    async (addr: string) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/auth/reset/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: addr }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error || "Couldn’t send a reset code.");
          return;
        }
        setStage("code");
        setInfo("If an account exists for that email, a reset code is on its way.");
        startCooldown();
      } finally {
        setBusy(false);
      }
    },
    [startCooldown]
  );

  // Signup/login codes were already sent by register/login. For a reset arriving with
  // an email prefilled, request the code once on mount.
  useEffect(() => {
    if (purpose === "reset" && email && !requested.current) {
      requested.current = true;
      void requestReset(email);
    } else if (purpose !== "reset") {
      startCooldown();
    }
  }, [purpose, email, requestReset, startCooldown]);

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/auth/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, purpose, code }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "That code didn’t work.");
        setBusy(false);
        return;
      }
      if (purpose === "reset") {
        setResetToken(data.resetToken);
        setStage("password");
        setBusy(false);
        return;
      }
      router.push(data.needsOnboarding ? "/welcome" : next);
    } catch {
      setError("Couldn’t reach the server. Try again.");
      setBusy(false);
    }
  }

  async function submitNewPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/reset/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resetToken, newPassword }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Couldn’t set the new password.");
        setBusy(false);
        return;
      }
      router.push(data.needsOnboarding ? "/welcome" : "/");
    } catch {
      setError("Couldn’t reach the server. Try again.");
      setBusy(false);
    }
  }

  async function resend() {
    if (cooldown > 0 || busy) return;
    setInfo(null);
    setError(null);
    if (purpose === "reset") {
      await requestReset(email);
      return;
    }
    startCooldown();
    await fetch("/api/auth/verify/resend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, purpose }) });
    setInfo("A new code is on its way if an account exists for that email.");
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
          <h1 className="font-display text-[28px] leading-tight tracking-[-0.02em]">{COPY[purpose].title}</h1>
          <p className="mt-1.5 text-[14px] text-[var(--color-muted)]">{COPY[purpose].blurb(email)}</p>

          {stage === "request" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void requestReset(email);
              }}
              className="mt-7 flex flex-col gap-3.5"
            >
              <Field label="Email" type="email" value={email} onChange={setEmail} placeholder="you@example.com" autoFocus />
              {error && <Alert>{error}</Alert>}
              <button className="btn btn-accent btn-shine mt-2 w-full justify-center" disabled={busy}>{busy ? "Sending…" : "Send reset code"}</button>
            </form>
          )}

          {stage === "code" && (
            <form onSubmit={submitCode} className="mt-7 flex flex-col gap-3.5">
              <label className="block">
                <span className="text-[12.5px] font-[550] text-[var(--color-ink-soft)]">6-digit code</span>
                <input
                  className="field !text-[24px] !py-3 !rounded-xl mt-1.5 text-center !tracking-[0.5em] font-[var(--font-mono)]"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  autoFocus
                  placeholder="••••••"
                  onChange={(e) => {
                    setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                    setError(null);
                  }}
                />
              </label>
              {error && <Alert>{error}</Alert>}
              {info && <Note>{info}</Note>}
              <button className="btn btn-accent btn-shine mt-2 w-full justify-center" disabled={busy || code.length !== 6}>{busy ? "Verifying…" : "Verify"}</button>
              <button type="button" onClick={resend} disabled={cooldown > 0 || busy} className="text-center text-[12.5px] text-[var(--color-muted)] link-underline disabled:opacity-60 disabled:no-underline">
                {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
              </button>
            </form>
          )}

          {stage === "password" && (
            <form onSubmit={submitNewPassword} className="mt-7 flex flex-col gap-3.5">
              <Field label="New password" type="password" value={newPassword} onChange={setNewPassword} placeholder="At least 8 characters" autoFocus />
              {error && <Alert>{error}</Alert>}
              <button className="btn btn-accent btn-shine mt-2 w-full justify-center" disabled={busy || newPassword.length < 8}>{busy ? "Saving…" : "Set new password"}</button>
            </form>
          )}

          <p className="mt-7 text-center text-[13px] text-[var(--color-muted)]">
            <Link href="/login" className="link-underline text-[var(--color-ink)]">Back to sign in</Link>
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
        autoComplete={type === "password" ? "new-password" : "email"}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
function Alert({ children }: { children: React.ReactNode }) {
  return <div className="text-[12.5px] fade-up" style={{ color: "var(--color-err)" }} role="alert">{children}</div>;
}
function Note({ children }: { children: React.ReactNode }) {
  return <div className="text-[12.5px] text-[var(--color-muted)] fade-up">{children}</div>;
}
