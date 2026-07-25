export function Wordmark({ size = 20 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2 select-none" style={{ fontSize: size }}>
      <span
        aria-hidden
        style={{
          width: size * 0.9,
          height: size * 0.9,
          borderRadius: 6,
          background: "var(--color-ink)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontWeight: 700,
          fontSize: size * 0.56,
          lineHeight: 1,
        }}
      >
        V
      </span>
      <span style={{ fontWeight: 650, letterSpacing: "-0.02em" }}>volo</span>
    </span>
  );
}
