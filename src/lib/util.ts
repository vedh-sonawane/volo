// Small shared helpers. No external deps.

let counter = 0;

/** Short, unique-enough id for tasks/steps/events (no crypto dep needed). */
export function id(prefix = ""): string {
  counter = (counter + 1) % 1_000_000;
  const rand = Math.floor(Math.random() * 1e9).toString(36);
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${rand}`;
}

/** Clamp a number into [min, max]. */
export function clamp(n: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, n));
}

/** Truncate text with an ellipsis. */
export function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + "…";
}

/** Collapse whitespace and trim. */
export function normalizeWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Deduplicate an array of strings preserving order. */
export function uniq(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of arr) {
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

/** Safe hostname for display / dedup. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
