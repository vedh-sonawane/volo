import { VoloMark } from "./VoloMark";

export function Wordmark({ size = 22 }: { size?: number }) {
  // Brand lockup: the Volo mark immediately left of the text wordmark. A display
  // serif with a single accent full-stop. The outer element carries the a11y name.
  return (
    <span className="inline-flex items-center gap-2 select-none align-middle" aria-label="Volo">
      <VoloMark size={size} />
      <span className="wordmark" style={{ fontSize: size }} aria-hidden="true">
        volo<span className="dot-accent">.</span>
      </span>
    </span>
  );
}
