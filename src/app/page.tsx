import Link from "next/link";
import { Composer } from "@/components/Composer";
import { Wordmark } from "@/components/Wordmark";

const STEPS = [
  { n: "01", t: "Understand", d: "Volo parses your objective into constraints — budget, location, timing, and how many options you want." },
  { n: "02", t: "Plan", d: "It builds a typed, step-by-step execution plan you can watch run, with sequential and parallel research." },
  { n: "03", t: "Execute", d: "It searches the web, reads real pages, and extracts structured, evidence-backed options." },
  { n: "04", t: "Report", d: "It compares options against your constraints and reports an outcome — every value linked to its source." },
];

const HONESTY = [
  { yes: true, t: "Research the open web for free", d: "Search, fetch public pages, extract and compare — no API keys, no paid services." },
  { yes: true, t: "Show its work, honestly", d: "A live timeline of exactly what it did, with sources for every factual claim." },
  { yes: true, t: "Prepare actions for you", d: "Draft an enquiry email or lay out booking steps you can review and complete." },
  { yes: false, t: "Never act without approval", d: "It won't send, submit, book, or buy on your behalf. Consequential actions always ask first." },
];

export default function Home() {
  return (
    <main className="min-h-screen">
      {/* Nav */}
      <header className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Wordmark />
        <nav className="flex items-center gap-1 text-[14px]">
          <a href="#how" className="btn btn-quiet">How it works</a>
          <a href="#honesty" className="btn btn-quiet">What it does</a>
        </nav>
      </header>

      {/* Hero */}
      <section className="relative">
        <div className="absolute inset-0 hero-grid pointer-events-none" aria-hidden />
        <div className="relative max-w-3xl mx-auto px-6 pt-16 pb-10 text-center">
          <div className="eyebrow mb-5 fade-up">Objective-to-outcome execution engine</div>
          <h1
            className="fade-up"
            style={{
              fontSize: "clamp(2.4rem, 6vw, 4rem)",
              lineHeight: 1.02,
              letterSpacing: "-0.035em",
              fontWeight: 680,
            }}
          >
            Tell us what you want done.
            <br />
            <span className="text-[var(--color-muted)]">We figure out the steps.</span>
          </h1>
          <p
            className="mt-6 mx-auto text-[17px] leading-relaxed text-[var(--color-ink-soft)] fade-up"
            style={{ maxWidth: 560 }}
          >
            Volo isn&apos;t a chatbot. Give it an objective and it plans, researches the
            web, extracts and compares real options, and reports an outcome — with
            sources, and without pretending to do things it can&apos;t.
          </p>
        </div>

        {/* Composer */}
        <div className="relative max-w-2xl mx-auto px-6 pb-20 fade-up">
          <div className="card p-4 sm:p-5" style={{ boxShadow: "0 1px 0 rgba(0,0,0,0.02), 0 12px 40px -24px rgba(0,0,0,0.25)" }}>
            <Composer />
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="max-w-6xl mx-auto px-6 py-16 border-t">
        <div className="eyebrow mb-2">How it works</div>
        <h2 className="text-[26px] font-[640] tracking-[-0.02em] mb-10" style={{ maxWidth: 620 }}>
          Objective in. Outcome out. You watch every step.
        </h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-px bg-[var(--color-line)] rounded-xl overflow-hidden border">
          {STEPS.map((s) => (
            <div key={s.n} className="bg-[var(--color-surface)] p-6">
              <div className="font-[var(--font-mono)] text-[13px] text-[var(--color-accent)] mb-4">{s.n}</div>
              <div className="text-[16px] font-[600] mb-1.5">{s.t}</div>
              <p className="text-[14px] leading-relaxed text-[var(--color-muted)]">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Honesty */}
      <section id="honesty" className="max-w-6xl mx-auto px-6 py-16 border-t">
        <div className="eyebrow mb-2">Built on honesty</div>
        <h2 className="text-[26px] font-[640] tracking-[-0.02em] mb-10" style={{ maxWidth: 620 }}>
          It never claims to have done something it didn&apos;t.
        </h2>
        <div className="grid sm:grid-cols-2 gap-4">
          {HONESTY.map((h) => (
            <div key={h.t} className="card p-5 flex gap-4">
              <div
                className="dot mt-2"
                style={{ background: h.yes ? "var(--color-ok)" : "var(--color-warn)", width: 9, height: 9 }}
              />
              <div>
                <div className="text-[15px] font-[600] mb-1">{h.t}</div>
                <p className="text-[14px] leading-relaxed text-[var(--color-muted)]">{h.d}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <footer className="max-w-6xl mx-auto px-6 py-10 border-t flex items-center justify-between text-[13px] text-[var(--color-faint)]">
        <Wordmark size={16} />
        <span>Free-first · runs locally · no paid services</span>
      </footer>
    </main>
  );
}
