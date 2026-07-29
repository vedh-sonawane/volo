import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";

export const metadata = { title: "Privacy Policy — Volo" };

export default function PrivacyPage() {
  return (
    <main className="min-h-screen">
      <header className="max-w-2xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/"><Wordmark size={20} /></Link>
        <Link href="/login" className="btn btn-quiet text-[13px]">Back</Link>
      </header>
      <article className="max-w-2xl mx-auto px-6 pb-24">
        <h1 className="font-display text-[28px] tracking-[-0.02em]">Privacy Policy</h1>
        <p className="text-[13px] text-[var(--color-muted)]">Last updated: {new Date().getFullYear()}</p>

        <Section title="What we store">
          Your account (email, name, hashed password), your objectives and their execution history, your preferences, and
          the configuration/credentials you choose to connect. Each account’s data is isolated — no data is shared between
          users.
        </Section>
        <Section title="How secrets are protected">
          Sensitive credentials (email passwords, Stripe keys, OAuth tokens) are <strong>encrypted at rest</strong> with
          AES-256-GCM and are stored server-side only. They are <strong>never</strong> returned to your browser, written to
          logs or analytics, or included in any prompt sent to an AI model.
        </Section>
        <Section title="Payment data">
          Volo never stores card numbers, CVVs, bank passwords, or one-time codes. Payments are processed by Stripe;
          Volo only records non-sensitive references (e.g. a payment intent id) needed to report status honestly.
        </Section>
        <Section title="The AI model">
          The model receives only what it needs to plan and summarize from real, fetched content. It never receives your
          passwords, API keys, or access tokens.
        </Section>
        <Section title="Your control">
          You can view, edit, and delete your objectives, disconnect any integration, and delete your account — which
          permanently removes your account and all associated data.
        </Section>
        <Section title="Third-party services">
          When you connect a provider (Google, GitHub, Stripe, your email host), your use of that service is
          governed by that provider’s own privacy policy.
        </Section>
        <p className="mt-8 text-[13px] text-[var(--color-muted)]">
          See also the <Link href="/terms" className="link-underline">Terms of Service</Link>.
        </p>
      </article>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="text-[15px] font-[640] mb-1.5">{title}</h2>
      <p className="text-[13.5px] text-[var(--color-ink-soft)] leading-relaxed">{children}</p>
    </section>
  );
}
