import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";

export const metadata = { title: "Terms of Service — Volo" };

export default function TermsPage() {
  return (
    <main className="min-h-screen">
      <header className="max-w-2xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/"><Wordmark size={20} /></Link>
        <Link href="/login" className="btn btn-quiet text-[13px]">Back</Link>
      </header>
      <article className="max-w-2xl mx-auto px-6 pb-24 prose-volo">
        <h1 className="font-display text-[28px] tracking-[-0.02em]">Terms of Service</h1>
        <p className="text-[13px] text-[var(--color-muted)]">Last updated: {new Date().getFullYear()}</p>

        <Section title="What Volo does">
          Volo is an autonomous assistant that researches, plans, and — with your explicit approval — executes tasks
          using services you connect. Volo turns your objective into an outcome; it does not act on its own.
        </Section>
        <Section title="You are in control">
          Volo <strong>only performs a consequential external action after you explicitly approve the exact action</strong> —
          the target, channel, content, and any amount are shown to you first. Volo never sends, books, submits, or pays
          without that approval, and never claims something happened unless the connected provider confirms it.
        </Section>
        <Section title="Connected services & your accounts">
          You are responsible for the external accounts and integrations you connect (email, payments, calendars, etc.),
          for the actions you approve, and for complying with those providers’ terms. Volo acts on your behalf only within
          the permissions you grant, and you can disconnect any integration at any time.
        </Section>
        <Section title="Payments">
          Volo does <strong>not</strong> store card numbers, CVVs, bank passwords, or one-time codes. Payment processing is
          handled by Stripe. Test-mode payments move no real money. You are responsible for reviewing every charge before
          approving it.
        </Section>
        <Section title="No warranty; limitation of liability">
          Volo is provided “as is”, without warranties. To the fullest extent permitted by law, Volo and its authors are
          not liable for outcomes of actions you approve or for third-party services you connect.
        </Section>
        <Section title="Acceptable use">
          Do not use Volo for unlawful, harmful, deceptive, or abusive activity, or to spam or target people at scale.
        </Section>
        <p className="mt-8 text-[13px] text-[var(--color-muted)]">
          Questions? See the <Link href="/privacy" className="link-underline">Privacy Policy</Link>.
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
