/** The Volo mark — a rising squiggle-arrow. Drawn in the CURRENT text color
 *  (`--color-ink`), so it is BLACK in light mode and WHITE in dark mode. No
 *  background box and no accent dots — just the mark. The adjacent wordmark text
 *  carries the accessible name, so the mark itself is decorative (aria-hidden). */
export function VoloMark({ size = 22 }: { size?: number }) {
  const w = Math.round(size * 1.42);
  const h = Math.round(w * 0.72);
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center align-middle"
      style={{ width: w, height: h, color: "var(--color-ink)" }}
    >
      <svg viewBox="0 0 128 96" fill="none" style={{ width: "100%", height: "100%", display: "block" }} aria-hidden="true">
        <g stroke="currentColor" strokeWidth={15} strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 58 C 24 40 38 40 46 56 C 52 68 64 70 72 60 C 84 44 92 38 106 30" />
          <path d="M88 31 L108 27 L106 47" />
        </g>
      </svg>
    </span>
  );
}
