export function Wordmark({ size = 22 }: { size?: number }) {
  // Text-only wordmark (no icon). A display serif with a single accent full-stop.
  return (
    <span className="wordmark select-none" style={{ fontSize: size }} aria-label="Volo">
      volo<span className="dot-accent">.</span>
    </span>
  );
}
