// ─────────────────────────────────────────────────────────────────────────────
// ResearchProvider abstraction (Phase 3).
//
// The rest of the application MUST depend only on this interface, never on a
// concrete search backend. Swapping DuckDuckGo for another free/open source, or
// a future paid provider, means adding one file — nothing else changes.
// ─────────────────────────────────────────────────────────────────────────────

export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
}

/**
 * The honest outcome of a search. Crucially distinguishes a genuine zero-result
 * search ("empty") from a provider problem ("rate_limited" / "timeout" / "error")
 * so the engine NEVER reports a failure as "found nothing".
 *   ok           — the provider responded and returned results
 *   empty        — the provider responded normally but had zero matches
 *   rate_limited — the provider throttled/blocked us (e.g. 202/403/429, anomaly)
 *   timeout      — the request exceeded the time budget
 *   error        — network failure, bad status, or unparseable/changed markup
 */
export type SearchStatus = "ok" | "empty" | "rate_limited" | "timeout" | "error";

export interface SearchResponse {
  results: SearchResult[];
  status: SearchStatus;
  /** Human-readable reason for a non-ok status (for honest UI display). Never fabricated. */
  error?: string;
  /** Which endpoint/backend actually served the response (transparency). */
  via?: string;
}

export interface FetchedPage {
  url: string;
  finalUrl: string;
  title: string;
  /** Cleaned, readable plain text. */
  text: string;
  /** Outbound links discovered on the page (absolute URLs). */
  links: string[];
  words: number;
  ok: boolean;
  error?: string;
}

export interface ResearchProvider {
  /** Provider id for transparency in the UI. */
  readonly name: string;
  /**
   * Free-text web search. Returns ranked results AND an honest status so callers
   * can tell a genuine zero-result apart from a provider failure/rate-limit.
   */
  search(query: string, limit?: number): Promise<SearchResponse>;
  /** Fetch a URL and return cleaned, readable content + links. */
  fetch(url: string): Promise<FetchedPage>;
}
